import { getBankPaymentPilotStatus } from '../../services/bankPaymentService.js';
import {
  DEFAULT_HOTEL_TIME_ZONE,
  addCalendarDays,
  detectBrowserTimeZone,
  getSupportedTimeZones,
  getTodayInTimeZone,
  getUtcRangeForHotelDates,
  normalizeTimeZone
} from '../../services/hotelTimeZoneService.js';

let root = null;
let activeModule = null;

const tabs = [
  { key: 'operativos', label: 'Reportes operativos', icon: '📊', load: () => import('./reportes.js') },
  { key: 'resultados', label: 'Estado de resultados', icon: '📈', adminOnly: true, load: () => import('./finanzas-pnl.js') },
  { key: 'cuentas', label: 'Cuentas financieras', icon: '🏦', adminOnly: true, load: () => import('../finanzas-cuentas/finanzas-cuentas.js') },
  { key: 'gastos', label: 'Gastos y cuentas por pagar', icon: '🧾', adminOnly: true, load: () => import('../gastos/gastos.js') },
  { key: 'costeo', label: 'Costeo y margen', icon: '📦', adminOnly: true, load: () => import('../costeo/costeo.js') },
  { key: 'conciliacion', label: 'Conciliación bancaria', icon: '🏦', adminOnly: true, pilotOnly: true, load: () => import('../pagos-bancarios/pagos-bancarios.js') }
];

const UTC_DAY_START_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/;
const UTC_DAY_END_RE = /^(\d{4}-\d{2}-\d{2})T23:59:59\.999Z$/;

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isAdmin(user) {
  return ['admin', 'administrador', 'superadmin'].includes(normalizeRole(user?.role || user?.rol));
}

function adjustLegacyReportBoundary(method, value, timeZone) {
  if (typeof value !== 'string') return value;
  const zone = normalizeTimeZone(timeZone, DEFAULT_HOTEL_TIME_ZONE);

  if (method === 'gte') {
    const match = UTC_DAY_START_RE.exec(value);
    if (!match) return value;
    return getUtcRangeForHotelDates(match[1], match[1], zone).startIso;
  }

  if (method === 'lte') {
    const match = UTC_DAY_END_RE.exec(value);
    if (!match) return value;
    const range = getUtcRangeForHotelDates(match[1], match[1], zone);
    return new Date(Date.parse(range.endExclusiveIso) - 1).toISOString();
  }

  return value;
}

function wrapReportQueryBuilder(builder, getTimeZone) {
  if (!builder || typeof builder !== 'object') return builder;

  return new Proxy(builder, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;

      if (['then', 'catch', 'finally'].includes(String(property))) {
        return value.bind(target);
      }

      if (property === 'gte' || property === 'lte') {
        return (column, boundary) => {
          const adjusted = adjustLegacyReportBoundary(String(property), boundary, getTimeZone());
          return wrapReportQueryBuilder(value.call(target, column, adjusted), getTimeZone);
        };
      }

      return (...args) => {
        const result = value.apply(target, args);
        if (result && typeof result === 'object' && typeof result.then === 'function') {
          return wrapReportQueryBuilder(result, getTimeZone);
        }
        return result;
      };
    }
  });
}

function createTimeZoneAwareReportClient(supabase, getTimeZone) {
  return new Proxy(supabase, {
    get(target, property) {
      const value = target[property];
      if (property === 'from') {
        return (table) => wrapReportQueryBuilder(target.from(table), getTimeZone);
      }
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

async function loadHotelTimeZone(supabase, hotelId) {
  const fallback = detectBrowserTimeZone();
  try {
    const { data, error } = await supabase
      .from('configuracion_hotel')
      .select('zona_horaria')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (error) throw error;
    return normalizeTimeZone(data?.zona_horaria, fallback);
  } catch (error) {
    console.warn('[Reportes] No se pudo cargar la zona horaria del hotel; se usará una zona segura.', error);
    return normalizeTimeZone(fallback, DEFAULT_HOTEL_TIME_ZONE);
  }
}

function renderTimeZoneOptions(selected) {
  const zones = getSupportedTimeZones();
  if (!zones.includes(selected)) zones.unshift(selected);
  return zones.map((zone) => `<option value="${zone}" ${zone === selected ? 'selected' : ''}>${zone}</option>`).join('');
}

function applyOperationalTimeZoneUi(context) {
  if (!context?.host) return;
  const today = getTodayInTimeZone(context.hotelTimeZone);
  const startInput = context.host.querySelector('#reporte-fecha-inicio');
  const endInput = context.host.querySelector('#reporte-fecha-fin');
  if (startInput) startInput.value = addCalendarDays(today, -30);
  if (endInput) endInput.value = today;

  const controls = context.host.querySelector('.reportes-controles');
  if (controls && !context.host.querySelector('#reportes-zona-horaria-activa')) {
    const info = document.createElement('p');
    info.id = 'reportes-zona-horaria-activa';
    info.className = 'mt-3 text-xs font-semibold text-slate-500';
    info.textContent = `Corte diario según zona horaria del hotel: ${context.hotelTimeZone}`;
    controls.appendChild(info);
  }
}

async function saveHotelTimeZone(context, select, status) {
  const nextZone = normalizeTimeZone(select.value, context.hotelTimeZone);
  select.disabled = true;
  if (status) {
    status.textContent = 'Guardando zona horaria…';
    status.className = 'text-xs font-semibold text-blue-100';
  }

  try {
    const { data, error } = await context.supabase
      .from('configuracion_hotel')
      .update({ zona_horaria: nextZone, actualizado_en: new Date().toISOString() })
      .eq('hotel_id', context.hotelId)
      .select('hotel_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('El hotel todavía no tiene una configuración general creada.');

    context.hotelTimeZone = nextZone;
    if (status) {
      status.textContent = `Zona activa: ${nextZone}`;
      status.className = 'text-xs font-semibold text-emerald-200';
    }
    if (context.activeTab === 'operativos') await showTab('operativos', context);
  } catch (error) {
    console.error('[Reportes] No se pudo guardar la zona horaria:', error);
    select.value = context.hotelTimeZone;
    if (status) {
      status.textContent = `No se pudo guardar: ${String(error?.message || error)}`;
      status.className = 'text-xs font-semibold text-rose-200';
    }
  } finally {
    select.disabled = false;
  }
}

async function showTab(key, context) {
  const tab = tabs.find((item) => item.key === key) || tabs[0];
  if (tab.adminOnly && !context.admin) return;
  context.activeTab = tab.key;
  if (activeModule?.unmount) activeModule.unmount(context.host);
  activeModule = null;
  context.host.innerHTML = '<div class="p-8 text-center text-slate-500">Cargando sección...</div>';
  root.querySelectorAll('[data-report-tab]').forEach((button) => {
    const selected = button.dataset.reportTab === tab.key;
    button.setAttribute('aria-selected', String(selected));
    button.className = `rounded-xl px-4 py-2.5 text-sm font-semibold transition ${selected ? 'bg-blue-600 text-white shadow' : 'bg-white text-slate-700 border border-slate-200 hover:border-blue-300'}`;
  });
  try {
    activeModule = await tab.load();
    const moduleSupabase = tab.key === 'operativos' ? context.reportSupabase : context.supabase;
    await activeModule.mount(context.host, moduleSupabase, context.user, context.hotelId, context.planDetails);
    if (tab.key === 'operativos') applyOperationalTimeZoneUi(context);
  } catch (error) {
    console.error('[Reportes] No fue posible abrir la sección:', error);
    context.host.innerHTML = `<div class="m-4 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">No fue posible abrir esta sección: ${String(error?.message || error)}</div>`;
  }
}

export async function mount(container, supabase, user, hotelId, planDetails) {
  unmount();
  root = container;
  const admin = isAdmin(user);
  const hotelTimeZone = await loadHotelTimeZone(supabase, hotelId);
  let bankPilotEnabled = false;
  if (admin) {
    try {
      const pilotStatus = await getBankPaymentPilotStatus(supabase, hotelId);
      bankPilotEnabled = pilotStatus.canAccess === true && pilotStatus.isAdmin === true;
    } catch {
      console.warn('[Reportes] No se pudo verificar el piloto de conciliación bancaria.');
    }
  }
  const visibleTabs = tabs.filter((tab) =>
    (!tab.adminOnly || admin) && (!tab.pilotOnly || bankPilotEnabled)
  );
  root.innerHTML = `
    <section class="min-h-full bg-slate-50 p-3 md:p-5">
      <header class="mb-4 rounded-2xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-700 p-5 text-white shadow-lg">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p class="text-xs font-semibold uppercase tracking-[.2em] text-blue-200">Centro de información</p>
            <h1 class="mt-1 text-2xl font-bold">Reportes${admin ? ' y finanzas' : ''}</h1>
            <p class="mt-1 max-w-3xl text-sm text-blue-100">${admin ? 'Consulta la operación y administra la información financiera desde un solo lugar.' : 'Consulta los reportes necesarios para la operación del hotel.'}</p>
          </div>
          <div class="min-w-[260px] rounded-xl border border-white/20 bg-white/10 p-3 backdrop-blur-sm">
            <label for="reportes-zona-horaria" class="block text-[11px] font-bold uppercase tracking-[.16em] text-blue-100">Zona horaria del hotel</label>
            ${admin
              ? `<select id="reportes-zona-horaria" class="mt-2 w-full rounded-lg border border-white/30 bg-white px-3 py-2 text-sm font-semibold text-slate-800">${renderTimeZoneOptions(hotelTimeZone)}</select>`
              : `<p class="mt-2 text-sm font-bold text-white">${hotelTimeZone}</p>`}
            <p id="reportes-zona-horaria-estado" class="mt-1 text-xs font-semibold text-blue-100">Los filtros de fecha usan esta zona, no UTC.</p>
          </div>
        </div>
      </header>
      <nav aria-label="Secciones de reportes" class="mb-4 flex gap-2 overflow-x-auto pb-1">
        ${visibleTabs.map((tab) => `<button type="button" data-report-tab="${tab.key}" aria-selected="false" class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><span aria-hidden="true">${tab.icon}</span> ${tab.label}</button>`).join('')}
      </nav>
      ${admin ? '<div class="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><strong>Acceso administrativo:</strong> las secciones financieras no se muestran a recepcionistas ni a otros roles operativos.</div>' : ''}
      <div id="reportes-centro-contenido"></div>
    </section>`;
  const host = root.querySelector('#reportes-centro-contenido');
  const context = {
    host,
    supabase,
    user,
    hotelId,
    planDetails,
    admin,
    hotelTimeZone,
    activeTab: 'operativos'
  };
  context.reportSupabase = createTimeZoneAwareReportClient(supabase, () => context.hotelTimeZone);

  root.querySelectorAll('[data-report-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.reportTab, context)));

  const timeZoneSelect = root.querySelector('#reportes-zona-horaria');
  const timeZoneStatus = root.querySelector('#reportes-zona-horaria-estado');
  if (timeZoneSelect) {
    timeZoneSelect.addEventListener('change', () => saveHotelTimeZone(context, timeZoneSelect, timeZoneStatus));
  }

  await showTab('operativos', context);
}

export function unmount() {
  if (activeModule?.unmount && root) activeModule.unmount(root.querySelector('#reportes-centro-contenido'));
  activeModule = null;
  if (root) root.innerHTML = '';
  root = null;
}
