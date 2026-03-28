import {
  clearAppFeedback,
  formatCurrency,
  formatDateTime,
  hideGlobalLoading,
  showAppFeedback,
  showGlobalLoading
} from '../../uiUtils.js';
import { escapeHtml } from '../../security.js';
import { logMonitoringEvent } from '../../services/monitoringService.js';
import { registrarAccionSensible } from '../../services/sensitiveAuditService.js';

let currentContainerEl = null;
let currentSupabaseInstance = null;
let currentUser = null;
let currentHotelId = null;
let listeners = [];
let hotelSearchTerm = '';
let hotelsCache = [];

function addListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  listeners.push({ element, type, handler });
}

function cleanupListeners() {
  listeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
  listeners = [];
}

function renderMetricCard(label, value, tone = 'slate') {
  const toneClasses = {
    slate: 'from-slate-50 to-slate-100 border-slate-200 text-slate-800',
    green: 'from-emerald-50 to-green-100 border-emerald-200 text-emerald-800',
    red: 'from-rose-50 to-red-100 border-rose-200 text-rose-800',
    blue: 'from-blue-50 to-cyan-100 border-blue-200 text-blue-800',
    amber: 'from-amber-50 to-yellow-100 border-amber-200 text-amber-800'
  };

  return `
    <article class="rounded-2xl border bg-gradient-to-br ${toneClasses[tone] || toneClasses.slate} p-4 shadow-sm">
      <p class="text-xs uppercase tracking-[0.25em] opacity-70">${escapeHtml(label)}</p>
      <p class="mt-2 text-3xl font-black">${escapeHtml(String(value ?? 0))}</p>
    </article>
  `;
}

function renderSecuritySummary(security = {}) {
  const withoutRls = security.tables_without_rls || [];
  const noPolicies = security.tables_with_rls_no_policies || [];
  const policyCounts = security.policy_counts || {};

  return `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Seguridad / RLS</p>
          <h3 class="mt-1 text-xl font-bold text-slate-900">Auditoría del esquema</h3>
        </div>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <div class="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p class="text-sm font-semibold text-rose-800">Tablas sin RLS</p>
          <p class="mt-2 text-3xl font-black text-rose-700">${withoutRls.length}</p>
          <p class="mt-2 text-xs text-rose-700">${withoutRls.length ? escapeHtml(withoutRls.join(', ')) : 'Todo el esquema relevante tiene RLS activado.'}</p>
        </div>
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-800">Con RLS pero sin políticas</p>
          <p class="mt-2 text-3xl font-black text-amber-700">${noPolicies.length}</p>
          <p class="mt-2 text-xs text-amber-700">${noPolicies.length ? escapeHtml(noPolicies.join(', ')) : 'No hay tablas con RLS vacío.'}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-sm font-semibold text-slate-800">Cobertura de políticas</p>
          <div class="mt-2 max-h-40 space-y-2 overflow-y-auto pr-1 text-xs text-slate-700">
            ${Object.keys(policyCounts).length
              ? Object.entries(policyCounts)
                  .sort((a, b) => a[0].localeCompare(b[0], 'es'))
                  .map(([tableName, count]) => `<div class="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2"><span>${escapeHtml(tableName)}</span><strong>${escapeHtml(String(count))}</strong></div>`)
                  .join('')
              : '<p>No hay datos de políticas.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderRecentPayments(payments = []) {
  if (!payments.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay pagos recientes para mostrar.</p>';
  }

  return `
    <div class="overflow-x-auto">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-50 text-slate-500">
          <tr>
            <th class="px-3 py-2 text-left">Fecha</th>
            <th class="px-3 py-2 text-left">Hotel</th>
            <th class="px-3 py-2 text-left">Plan</th>
            <th class="px-3 py-2 text-left">Método</th>
            <th class="px-3 py-2 text-right">Monto</th>
          </tr>
        </thead>
        <tbody>
          ${payments.map((payment) => `
            <tr class="border-t border-slate-100">
              <td class="px-3 py-2">${escapeHtml(formatDateTime(payment.fecha))}</td>
              <td class="px-3 py-2">${escapeHtml(payment.hotel_nombre || 'Sin hotel')}</td>
              <td class="px-3 py-2">${escapeHtml(payment.plan || 'N/A')}</td>
              <td class="px-3 py-2">${escapeHtml(payment.metodo_pago || 'N/A')}</td>
              <td class="px-3 py-2 text-right font-semibold">${escapeHtml(formatCurrency(payment.monto || 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecentEvents(events = []) {
  if (!events.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay eventos recientes registrados.</p>';
  }

  return `
    <div class="space-y-3">
      ${events.map((event) => {
        const tone = event.level === 'error' || event.level === 'fatal'
          ? 'border-rose-200 bg-rose-50'
          : event.level === 'warn'
          ? 'border-amber-200 bg-amber-50'
          : 'border-slate-200 bg-white';

        return `
          <article class="rounded-xl border ${tone} p-4 shadow-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p class="text-xs uppercase tracking-[0.25em] text-slate-400">${escapeHtml(event.level || 'info')} · ${escapeHtml(event.source || 'app')}</p>
                <h4 class="mt-1 text-sm font-bold text-slate-900">${escapeHtml(event.message || 'Evento')}</h4>
              </div>
              <span class="text-xs text-slate-500">${escapeHtml(formatDateTime(event.created_at))}</span>
            </div>
            <div class="mt-2 flex flex-wrap gap-2 text-xs text-slate-600">
              <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(event.hotel_nombre || 'Sin hotel')}</span>
              <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(event.event_type || 'general')}</span>
              <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(event.route || 'sin ruta')}</span>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function getFilteredHotels() {
  const term = hotelSearchTerm.trim().toLowerCase();
  if (!term) {
    return hotelsCache;
  }
  return hotelsCache.filter((hotel) =>
    `${hotel.nombre || ''} ${hotel.plan || ''} ${hotel.estado_suscripcion || ''}`.toLowerCase().includes(term)
  );
}

function renderHotelsTable() {
  const hotels = getFilteredHotels();
  const tbody = currentContainerEl.querySelector('#ops-saas-hotels-body');
  const counter = currentContainerEl.querySelector('#ops-saas-hotels-counter');

  if (!tbody || !counter) return;

  counter.textContent = `${hotels.length} hotel(es) visibles`;

  if (!hotels.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-6 text-center text-sm text-slate-500">No hay hoteles que coincidan con la búsqueda.</td></tr>';
    return;
  }

  tbody.innerHTML = hotels.map((hotel) => `
    <tr class="border-t border-slate-100">
      <td class="px-4 py-3 font-medium text-slate-800">${escapeHtml(hotel.nombre || 'Sin nombre')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(hotel.plan || 'N/A')}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(hotel.estado_suscripcion || 'N/A')}</td>
      <td class="px-4 py-3 text-slate-600">${hotel.activo ? 'Activo' : 'Inactivo'}</td>
      <td class="px-4 py-3 text-slate-600">${escapeHtml(formatDateTime(hotel.creado_en))}</td>
      <td class="px-4 py-3 text-right">
        <button
          type="button"
          class="ops-saas-export rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700"
          data-hotel-id="${escapeHtml(hotel.id)}"
          data-hotel-name="${escapeHtml(hotel.nombre || 'hotel')}"
        >
          Exportar backup
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.ops-saas-export').forEach((button) => {
    addListener(button, 'click', async () => {
      await exportHotelSnapshot(button.dataset.hotelId, button.dataset.hotelName);
    });
  });
}

async function exportHotelSnapshot(hotelId, hotelName) {
  if (!hotelId || !currentSupabaseInstance) {
    return;
  }

  showGlobalLoading(`Exportando datos de ${hotelName || 'hotel'}...`);
  try {
    const { data, error } = await currentSupabaseInstance.rpc('exportar_hotel_snapshot', {
      p_hotel_id: hotelId
    });

    if (error) {
      throw error;
    }

    const payload = JSON.stringify(data, null, 2);
    const blob = new Blob([payload], { type: 'application/json;charset=utf-8' });
    const fileName = `backup-${(hotelName || 'hotel').toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    showAppFeedback(`Backup exportado para ${hotelName || 'hotel'}.`, 'success');
    await registrarAccionSensible({
      supabase: currentSupabaseInstance,
      hotelId,
      usuarioId: currentUser?.id || null,
      modulo: 'Ops SaaS',
      accion: 'EXPORTAR_BACKUP_HOTEL',
      detalles: {
        hotel_objetivo: hotelName || 'hotel',
        scope: 'saas'
      }
    });
    await logMonitoringEvent({
      source: 'ops-saas',
      level: 'info',
      eventType: 'hotel_snapshot_exported',
      message: `Se exportó un backup de ${hotelName || 'hotel'}.`,
      details: { hotelId, hotelName },
      scope: 'saas',
      dedupeKey: `ops-export-${hotelId}-${Date.now()}`
    });
  } catch (error) {
    console.error('[Ops SaaS] Error exportando hotel:', error);
    showAppFeedback(`No se pudo exportar ${hotelName || 'el hotel'}: ${error.message}`, 'error');
    await logMonitoringEvent({
      source: 'ops-saas',
      level: 'error',
      eventType: 'hotel_snapshot_export_failed',
      message: 'Fallo exportando backup de hotel',
      details: { hotelId, hotelName, error: error.message },
      scope: 'saas',
      dedupeKey: `ops-export-failed-${hotelId}-${error.message}`
    });
  } finally {
    hideGlobalLoading();
  }
}

function renderConsole(snapshot) {
  const metrics = snapshot?.metrics || {};
  currentContainerEl.innerHTML = `
    <div class="space-y-6 p-4 md:p-8">
      <section class="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-2xl">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-blue-200">Consola SaaS</p>
            <h1 class="mt-2 text-3xl font-black">Centro global de operación</h1>
            <p class="mt-2 max-w-3xl text-sm text-blue-100">Supervisión global de hoteles, pagos, errores recientes, seguridad y exportaciones operativas del SaaS.</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="ops-saas-refresh" class="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20">Actualizar</button>
          </div>
        </div>
        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          ${renderMetricCard('Hoteles', metrics.total_hoteles || 0, 'blue')}
          ${renderMetricCard('Usuarios', metrics.total_usuarios || 0, 'slate')}
          ${renderMetricCard('Turnos abiertos', metrics.turnos_abiertos || 0, 'amber')}
          ${renderMetricCard('Reservas activas', metrics.reservas_activas || 0, 'green')}
          ${renderMetricCard('Incidencias chat', metrics.incidencias_chat || 0, 'blue')}
          ${renderMetricCard('Errores 24h', metrics.errores_24h || 0, 'red')}
        </div>
      </section>

      ${renderSecuritySummary(snapshot?.security)}

      <section class="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Backups / Hoteles</p>
              <h2 class="mt-1 text-xl font-bold text-slate-900">Exportación por hotel</h2>
              <p id="ops-saas-hotels-counter" class="mt-1 text-sm text-slate-500">0 hotel(es) visibles</p>
            </div>
            <input
              id="ops-saas-hotel-search"
              type="search"
              placeholder="Buscar hotel, plan o estado"
              class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white md:max-w-xs"
            >
          </div>
          <div class="mt-4 overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-slate-50 text-slate-500">
                <tr>
                  <th class="px-4 py-3 text-left">Hotel</th>
                  <th class="px-4 py-3 text-left">Plan</th>
                  <th class="px-4 py-3 text-left">Suscripción</th>
                  <th class="px-4 py-3 text-left">Activo</th>
                  <th class="px-4 py-3 text-left">Creado</th>
                  <th class="px-4 py-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody id="ops-saas-hotels-body"></tbody>
            </table>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Pagos recientes</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Actividad comercial</h2>
          <div class="mt-4">${renderRecentPayments(snapshot?.recent_payments || [])}</div>
        </article>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Errores y eventos</p>
        <h2 class="mt-1 text-xl font-bold text-slate-900">Eventos recientes del sistema</h2>
        <div class="mt-4">${renderRecentEvents(snapshot?.recent_events || [])}</div>
      </section>
    </div>
  `;

  const refreshButton = currentContainerEl.querySelector('#ops-saas-refresh');
  const hotelSearchInput = currentContainerEl.querySelector('#ops-saas-hotel-search');

  addListener(refreshButton, 'click', () => {
    void loadConsole();
  });
  addListener(hotelSearchInput, 'input', (event) => {
    hotelSearchTerm = event.target.value || '';
    renderHotelsTable();
  });

  renderHotelsTable();
}

async function loadConsole() {
  if (!currentSupabaseInstance || !currentContainerEl) {
    return;
  }

  currentContainerEl.innerHTML = `
    <div class="p-8">
      <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
        Cargando consola SaaS...
      </div>
    </div>
  `;

  try {
    const [{ data: snapshot, error: snapshotError }, { data: hotels, error: hotelsError }] = await Promise.all([
      currentSupabaseInstance.rpc('saas_dashboard_snapshot'),
      currentSupabaseInstance.rpc('saas_listar_hoteles')
    ]);

    if (snapshotError) throw snapshotError;
    if (hotelsError) throw hotelsError;

    hotelsCache = hotels || [];
    renderConsole(snapshot || {});
  } catch (error) {
    console.error('[Ops SaaS] Error cargando consola:', error);
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          No se pudo cargar la consola SaaS: ${escapeHtml(error.message || 'Error desconocido')}
        </div>
      </div>
    `;
    await logMonitoringEvent({
      source: 'ops-saas',
      level: 'error',
      eventType: 'console_load_failed',
      message: 'No se pudo cargar la consola SaaS',
      details: { error: error.message || 'Error desconocido' },
      scope: 'saas',
      dedupeKey: `ops-console-failed-${error.message}`
    });
  }
}

export async function mount(container, sbInstance, user, hotelId) {
  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentUser = user;
  currentHotelId = hotelId;
  hotelSearchTerm = '';
  hotelsCache = [];
  cleanupListeners();
  clearAppFeedback();

  if (!currentUser) {
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          Debes iniciar sesión para acceder a la consola SaaS.
        </div>
      </div>
    `;
    return;
  }

  showGlobalLoading('Cargando consola SaaS...');
  try {
    await loadConsole();
  } finally {
    hideGlobalLoading();
  }
}

export function unmount() {
  cleanupListeners();
  currentContainerEl = null;
  currentSupabaseInstance = null;
  currentUser = null;
  currentHotelId = null;
  hotelSearchTerm = '';
  hotelsCache = [];
}
