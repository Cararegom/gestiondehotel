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
let dashboardSnapshotCache = null;
let usageByHotelCache = [];
let landingLeadsCache = [];
let integrationRequestsCache = [];
let groupSummaryCache = null;

function addListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  listeners.push({ element, type, handler });
}

function cleanupListeners() {
  listeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
  listeners = [];
}

function formatCompactDate(value) {
  if (!value) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(new Date(value));
  } catch (_) {
    return 'Sin fecha';
  }
}

function formatRelativeDays(value) {
  if (!value) return 'Sin fecha';
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return 'Sin fecha';

  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Hoy';
  if (diffDays > 0) return `En ${diffDays} dia${diffDays === 1 ? '' : 's'}`;
  return `Hace ${Math.abs(diffDays)} dia${Math.abs(diffDays) === 1 ? '' : 's'}`;
}

function getHotelCutoffDate(hotel) {
  const dates = [hotel?.suscripcion_fin, hotel?.trial_fin, hotel?.gracia_hasta]
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime());

  return dates[0] || null;
}

function getHotelStatusMeta(hotel) {
  const rawStatus = String(hotel?.estado_suscripcion || 'sin_estado').toLowerCase();
  const hasActiveGrace = hotel?.gracia_hasta && new Date(hotel.gracia_hasta) >= new Date();

  if (hasActiveGrace) {
    return {
      label: 'Con gracia',
      badgeClass: 'bg-blue-100 text-blue-700',
      panelClass: 'border-blue-200 bg-blue-50'
    };
  }

  if (rawStatus === 'activo') {
    return {
      label: 'Activo',
      badgeClass: 'bg-emerald-100 text-emerald-700',
      panelClass: 'border-emerald-200 bg-emerald-50'
    };
  }

  if (rawStatus === 'trial') {
    return {
      label: 'Trial',
      badgeClass: 'bg-amber-100 text-amber-700',
      panelClass: 'border-amber-200 bg-amber-50'
    };
  }

  if (rawStatus === 'vencido') {
    return {
      label: 'Vencido',
      badgeClass: 'bg-rose-100 text-rose-700',
      panelClass: 'border-rose-200 bg-rose-50'
    };
  }

  return {
    label: rawStatus || 'N/A',
    badgeClass: 'bg-slate-100 text-slate-700',
    panelClass: 'border-slate-200 bg-slate-50'
  };
}

function renderMetricCard(label, value, tone = 'slate', helperText = '') {
  const toneClasses = {
    slate: 'from-slate-50 to-slate-100 border-slate-200 text-slate-800',
    green: 'from-emerald-50 to-green-100 border-emerald-200 text-emerald-800',
    red: 'from-rose-50 to-red-100 border-rose-200 text-rose-800',
    blue: 'from-blue-50 to-cyan-100 border-blue-200 text-blue-800',
    amber: 'from-amber-50 to-yellow-100 border-amber-200 text-amber-800'
  };

  return `
    <article class="rounded-2xl border bg-gradient-to-br ${toneClasses[tone] || toneClasses.slate} p-4 shadow-sm">
      <p class="text-[11px] uppercase tracking-[0.28em] opacity-70">${escapeHtml(label)}</p>
      <p class="mt-2 text-3xl font-black">${escapeHtml(String(value ?? 0))}</p>
      ${helperText ? `<p class="mt-2 text-xs opacity-80">${escapeHtml(helperText)}</p>` : ''}
    </article>
  `;
}

function renderRevenueByPlan(items = []) {
  if (!items.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay pagos del mes para clasificar por plan.</p>';
  }

  return `
    <div class="space-y-3">
      ${items.map((item) => `
        <div class="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
          <div>
            <p class="text-sm font-semibold text-slate-800">${escapeHtml(String(item.plan || 'Sin plan').toUpperCase())}</p>
            <p class="text-xs text-slate-500">Ingresos del mes actual</p>
          </div>
          <strong class="text-sm text-slate-900">${escapeHtml(formatCurrency(Number(item.revenue || 0)))}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function renderMonthlyIncome(series = []) {
  if (!series.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay historial mensual disponible.</p>';
  }

  return `
    <div class="space-y-3">
      ${series.map((item) => `
        <div class="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3">
          <div>
            <p class="text-sm font-semibold text-slate-800">${escapeHtml(item.period || 'Periodo')}</p>
            <p class="text-xs text-slate-500">${escapeHtml(formatCompactDate(item.month_start))}</p>
          </div>
          <strong class="text-sm text-slate-900">${escapeHtml(formatCurrency(Number(item.revenue || 0)))}</strong>
        </div>
      `).join('')}
    </div>
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
            <th class="px-3 py-2 text-left">Metodo</th>
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
              <td class="px-3 py-2 text-right font-semibold">${escapeHtml(formatCurrency(Number(payment.monto || 0)))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLandingLeads(leads = []) {
  if (!leads.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Todavia no hay leads recientes desde la landing.</p>';
  }

  return `
    <div class="space-y-3">
      ${leads.map((lead) => `
        <article class="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-900">${escapeHtml(lead.full_name || 'Lead sin nombre')}</p>
              <p class="text-xs text-slate-500">${escapeHtml(lead.business_name || lead.country || 'Sin negocio definido')}</p>
            </div>
            <span class="rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-700">${escapeHtml(lead.status || 'nuevo')}</span>
          </div>
          <div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
            ${lead.email ? `<span class="rounded-full bg-white px-2 py-1">${escapeHtml(lead.email)}</span>` : ''}
            ${lead.whatsapp ? `<span class="rounded-full bg-white px-2 py-1">${escapeHtml(lead.whatsapp)}</span>` : ''}
            ${lead.plan_interest ? `<span class="rounded-full bg-white px-2 py-1">Plan: ${escapeHtml(lead.plan_interest)}</span>` : ''}
            ${lead.room_count ? `<span class="rounded-full bg-white px-2 py-1">${escapeHtml(String(lead.room_count))} habitaciones</span>` : ''}
          </div>
          <p class="mt-3 text-xs text-slate-500">${escapeHtml(formatDateTime(lead.created_at))}</p>
        </article>
      `).join('')}
    </div>
  `;
}

function renderIntegrationRequestsGlobal(requests = []) {
  if (!requests.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay solicitudes globales de integraciones por revisar.</p>';
  }

  return `
    <div class="space-y-3">
      ${requests.map((request) => `
        <article class="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-sm font-semibold text-slate-900">${escapeHtml(request.proveedor || 'Proveedor')}</p>
              <p class="text-xs text-slate-500">${escapeHtml(request.hotel_nombre || 'Sin hotel')} · ${escapeHtml(request.categoria || 'integracion')}</p>
            </div>
            <span class="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-700">${escapeHtml(request.estado || 'nuevo')}</span>
          </div>
          ${request.notas ? `<p class="mt-3 text-sm text-slate-600">${escapeHtml(request.notas)}</p>` : ''}
          <div class="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
            <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(request.usuario_correo || 'Sin correo')}</span>
            <span class="rounded-full bg-slate-100 px-2 py-1">${escapeHtml(formatDateTime(request.created_at))}</span>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderUsageByHotel(items = []) {
  if (!items.length) {
    return '<p class="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay uso por hotel disponible todavia.</p>';
  }

  return `
    <div class="overflow-x-auto">
      <table class="min-w-[1080px] text-sm">
        <thead class="bg-slate-50 text-slate-500">
          <tr>
            <th class="px-3 py-2 text-left">Hotel</th>
            <th class="px-3 py-2 text-left">Plan</th>
            <th class="px-3 py-2 text-right">Habitaciones</th>
            <th class="px-3 py-2 text-right">Usuarios</th>
            <th class="px-3 py-2 text-right">Reservas 30d</th>
            <th class="px-3 py-2 text-right">Caja 30d</th>
            <th class="px-3 py-2 text-right">Tienda 30d</th>
            <th class="px-3 py-2 text-right">Rest. 30d</th>
            <th class="px-3 py-2 text-right">Incidencias</th>
            <th class="px-3 py-2 text-right">Errores</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr class="border-t border-slate-100">
              <td class="px-3 py-2 font-semibold text-slate-900">${escapeHtml(item.hotel_nombre || 'Sin hotel')}</td>
              <td class="px-3 py-2">${escapeHtml(String(item.plan || 'N/A').toUpperCase())}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.habitaciones_activas || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.usuarios_activos || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.reservas_30d || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.movimientos_caja_30d || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.ventas_tienda_30d || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.ventas_restaurante_30d || 0))}</td>
              <td class="px-3 py-2 text-right">${escapeHtml(String(item.incidencias_30d || 0))}</td>
              <td class="px-3 py-2 text-right font-semibold ${Number(item.errores_30d || 0) > 0 ? 'text-rose-700' : 'text-slate-700'}">${escapeHtml(String(item.errores_30d || 0))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderGroupSummary(summary = {}) {
  return `
    <div class="grid gap-3 md:grid-cols-3">
      <div class="rounded-xl border border-blue-200 bg-blue-50 p-4">
        <p class="text-xs uppercase tracking-[0.22em] text-blue-500">Grupos activos</p>
        <p class="mt-2 text-3xl font-black text-blue-800">${escapeHtml(String(summary.total_grupos || 0))}</p>
      </div>
      <div class="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <p class="text-xs uppercase tracking-[0.22em] text-emerald-500">Hoteles agrupados</p>
        <p class="mt-2 text-3xl font-black text-emerald-800">${escapeHtml(String(summary.hoteles_agrupados || 0))}</p>
      </div>
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <p class="text-xs uppercase tracking-[0.22em] text-amber-500">Sin grupo</p>
        <p class="mt-2 text-3xl font-black text-amber-800">${escapeHtml(String(summary.hoteles_sin_grupo || 0))}</p>
      </div>
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
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="text-[11px] uppercase tracking-[0.24em] text-slate-400">${escapeHtml(event.level || 'info')} · ${escapeHtml(event.source || 'app')}</p>
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

function renderSecuritySummary(security = {}) {
  const withoutRls = security.tables_without_rls || [];
  const noPolicies = security.tables_with_rls_no_policies || [];
  const policyCounts = security.policy_counts || {};

  return `
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Seguridad / RLS</p>
          <h3 class="mt-1 text-xl font-bold text-slate-900">Auditoria del esquema</h3>
        </div>
      </div>
      <div class="mt-4 grid gap-4 lg:grid-cols-3">
        <div class="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <p class="text-sm font-semibold text-rose-800">Tablas sin RLS</p>
          <p class="mt-2 text-3xl font-black text-rose-700">${withoutRls.length}</p>
          <p class="mt-2 text-xs text-rose-700">${withoutRls.length ? escapeHtml(withoutRls.join(', ')) : 'Todo el esquema relevante tiene RLS activado.'}</p>
        </div>
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p class="text-sm font-semibold text-amber-800">Con RLS pero sin politicas</p>
          <p class="mt-2 text-3xl font-black text-amber-700">${noPolicies.length}</p>
          <p class="mt-2 text-xs text-amber-700">${noPolicies.length ? escapeHtml(noPolicies.join(', ')) : 'No hay tablas con RLS vacio.'}</p>
        </div>
        <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p class="text-sm font-semibold text-slate-800">Cobertura de politicas</p>
          <div class="mt-2 max-h-44 space-y-2 overflow-y-auto pr-1 text-xs text-slate-700">
            ${Object.keys(policyCounts).length
              ? Object.entries(policyCounts)
                .sort((a, b) => a[0].localeCompare(b[0], 'es'))
                .map(([tableName, count]) => `
                  <div class="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
                    <span>${escapeHtml(tableName)}</span>
                    <strong>${escapeHtml(String(count))}</strong>
                  </div>
                `)
                .join('')
              : '<p>No hay datos de politicas.</p>'}
          </div>
        </div>
      </div>
    </section>
  `;
}

function getFilteredHotels() {
  const term = hotelSearchTerm.trim().toLowerCase();
  if (!term) {
    return hotelsCache;
  }

  return hotelsCache.filter((hotel) =>
    [
      hotel.nombre,
      hotel.plan,
      hotel.estado_suscripcion,
      hotel.ciudad,
      hotel.pais,
      hotel.correo,
      hotel.telefono
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(term)
  );
}

function renderHotelDeadline(hotel) {
  const cutoff = getHotelCutoffDate(hotel);
  const baseDate = hotel.suscripcion_fin || hotel.trial_fin;
  const grace = hotel.gracia_hasta;

  return `
    <div class="space-y-1">
      <div class="text-sm font-semibold text-slate-800">${escapeHtml(formatCompactDate(cutoff))}</div>
      <div class="text-xs text-slate-500">${escapeHtml(formatRelativeDays(cutoff))}</div>
      ${baseDate ? `<div class="text-[11px] text-slate-500">Base: ${escapeHtml(formatCompactDate(baseDate))}</div>` : ''}
      ${grace ? `<div class="text-[11px] font-semibold text-blue-700">Gracia hasta ${escapeHtml(formatCompactDate(grace))}</div>` : ''}
    </div>
  `;
}

function renderHotelsTable() {
  const hotels = getFilteredHotels();
  const tbody = currentContainerEl.querySelector('#ops-saas-hotels-body');
  const counter = currentContainerEl.querySelector('#ops-saas-hotels-counter');

  if (!tbody || !counter) return;

  counter.textContent = `${hotels.length} hotel(es) visibles`;

  if (!hotels.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="px-4 py-6 text-center text-sm text-slate-500">No hay hoteles que coincidan con la busqueda.</td></tr>';
    return;
  }

  tbody.innerHTML = hotels.map((hotel) => {
    const statusMeta = getHotelStatusMeta(hotel);
    return `
      <tr class="border-t border-slate-100 align-top">
        <td class="px-4 py-4">
          <div class="space-y-1">
            <div class="font-semibold text-slate-900">${escapeHtml(hotel.nombre || 'Sin nombre')}</div>
            <div class="text-xs text-slate-500">${escapeHtml([hotel.ciudad, hotel.pais].filter(Boolean).join(', ') || 'Sin ubicacion')}</div>
            <div class="text-xs text-slate-500">${escapeHtml(hotel.correo || 'Sin correo')}</div>
            <div class="text-xs text-slate-500">${escapeHtml(hotel.telefono || 'Sin telefono')}</div>
          </div>
        </td>
        <td class="px-4 py-4">
          <div class="space-y-2">
            <span class="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">${escapeHtml(String(hotel.plan || 'N/A').toUpperCase())}</span>
            <div class="text-xs text-slate-500">${hotel.total_usuarios || 0} usuario(s)</div>
          </div>
        </td>
        <td class="px-4 py-4">
          <div class="space-y-2">
            <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}">${escapeHtml(statusMeta.label)}</span>
            <div class="text-xs text-slate-500">${hotel.activo ? 'Hotel activo' : 'Hotel inactivo'}</div>
          </div>
        </td>
        <td class="px-4 py-4">${renderHotelDeadline(hotel)}</td>
        <td class="px-4 py-4 text-right font-semibold text-slate-900">${escapeHtml(formatCurrency(Number(hotel.ingresos_mes_actual || 0)))}</td>
        <td class="px-4 py-4 text-xs text-slate-500">${escapeHtml(formatCompactDate(hotel.ultimo_pago))}</td>
        <td class="px-4 py-4 text-xs text-slate-500">${escapeHtml(formatCompactDate(hotel.creado_en))}</td>
        <td class="px-4 py-4">
          <div class="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              class="ops-saas-grace rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-amber-600"
              data-hotel-id="${escapeHtml(hotel.id)}"
              data-hotel-name="${escapeHtml(hotel.nombre || 'hotel')}"
            >
              Dar gracia
            </button>
            <button
              type="button"
              class="ops-saas-export rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white shadow hover:bg-blue-700"
              data-hotel-id="${escapeHtml(hotel.id)}"
              data-hotel-name="${escapeHtml(hotel.nombre || 'hotel')}"
            >
              Exportar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.ops-saas-export').forEach((button) => {
    addListener(button, 'click', async () => {
      await exportHotelSnapshot(button.dataset.hotelId, button.dataset.hotelName);
    });
  });

  tbody.querySelectorAll('.ops-saas-grace').forEach((button) => {
    addListener(button, 'click', async () => {
      await requestGraceDays(button.dataset.hotelId, button.dataset.hotelName);
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

    if (error) throw error;

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
      message: `Se exporto un backup de ${hotelName || 'hotel'}.`,
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

async function requestGraceDays(hotelId, hotelName) {
  if (!hotelId || !currentSupabaseInstance) return;

  let dias = '';
  let motivo = '';

  if (window.Swal) {
    const result = await window.Swal.fire({
      title: `Otorgar dias de gracia`,
      html: `
        <div class="space-y-3 text-left">
          <p class="text-sm text-slate-600">Hotel: <strong>${escapeHtml(hotelName || 'hotel')}</strong></p>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Dias</label>
            <input id="swal-grace-days" type="number" min="1" max="90" class="swal2-input" placeholder="Ej: 5">
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Motivo (opcional)</label>
            <textarea id="swal-grace-reason" class="swal2-textarea" placeholder="Ej: pago en proceso, soporte comercial, ajuste manual"></textarea>
          </div>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: 'Guardar gracia',
      cancelButtonText: 'Cancelar',
      focusConfirm: false,
      preConfirm: () => {
        const daysValue = document.getElementById('swal-grace-days')?.value || '';
        const reasonValue = document.getElementById('swal-grace-reason')?.value || '';
        const parsedDays = Number(daysValue);
        if (!Number.isFinite(parsedDays) || parsedDays <= 0 || parsedDays > 90) {
          window.Swal.showValidationMessage('Ingresa entre 1 y 90 dias.');
          return false;
        }
        return {
          dias: parsedDays,
          motivo: String(reasonValue || '').trim()
        };
      }
    });

    if (!result.isConfirmed || !result.value) {
      return;
    }

    dias = result.value.dias;
    motivo = result.value.motivo;
  } else {
    dias = Number(window.prompt(`Cuantos dias de gracia quieres otorgar a ${hotelName || 'este hotel'}?`, '3'));
    if (!dias) return;
    motivo = window.prompt('Motivo (opcional):', '') || '';
  }

  showGlobalLoading(`Otorgando gracia a ${hotelName || 'hotel'}...`);
  try {
    const { data, error } = await currentSupabaseInstance.rpc('saas_otorgar_dias_gracia', {
      p_hotel_id: hotelId,
      p_dias: Number(dias),
      p_motivo: motivo || null
    });

    if (error) throw error;

    showAppFeedback(
      `Se otorgaron ${dias} dia(s) de gracia a ${hotelName || 'el hotel'} hasta ${formatCompactDate(data?.gracia_hasta)}.`,
      'success'
    );

    await registrarAccionSensible({
      supabase: currentSupabaseInstance,
      hotelId,
      usuarioId: currentUser?.id || null,
      modulo: 'Ops SaaS',
      accion: 'DIAS_GRACIA_OTORGADOS_UI',
      detalles: {
        hotel_objetivo: hotelName || 'hotel',
        dias,
        motivo: motivo || '',
        gracia_hasta: data?.gracia_hasta || null
      }
    });

    await logMonitoringEvent({
      source: 'ops-saas',
      level: 'info',
      eventType: 'grace_days_granted',
      message: `Se otorgaron dias de gracia a ${hotelName || 'hotel'}.`,
      details: { hotelId, hotelName, dias, gracia_hasta: data?.gracia_hasta || null },
      scope: 'saas',
      dedupeKey: `ops-grace-${hotelId}-${Date.now()}`
    });

    await loadConsole();
  } catch (error) {
    console.error('[Ops SaaS] Error otorgando gracia:', error);
    showAppFeedback(`No se pudo otorgar gracia a ${hotelName || 'el hotel'}: ${error.message}`, 'error');
    await logMonitoringEvent({
      source: 'ops-saas',
      level: 'error',
      eventType: 'grace_days_failed',
      message: 'No se pudo otorgar dias de gracia',
      details: { hotelId, hotelName, dias, error: error.message },
      scope: 'saas',
      dedupeKey: `ops-grace-failed-${hotelId}-${error.message}`
    });
  } finally {
    hideGlobalLoading();
  }
}

function renderConsole(snapshot) {
  const metrics = snapshot?.metrics || {};
  const groupSummary = groupSummaryCache || snapshot?.group_summary || {};

  currentContainerEl.innerHTML = `
    <div class="space-y-6 p-4 md:p-8">
      <section class="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-2xl">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-blue-200">Admin Panel SaaS</p>
            <h1 class="mt-2 text-3xl font-black">Centro global de operacion</h1>
            <p class="mt-2 max-w-3xl text-sm text-blue-100">Gestiona hoteles, revisa ingresos mensuales, detecta incidencias y otorga dias de gracia desde una sola consola.</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="ops-saas-refresh" class="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20">Actualizar</button>
          </div>
        </div>
        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          ${renderMetricCard('Hoteles', metrics.total_hoteles || 0, 'blue', 'Base total registrada')}
          ${renderMetricCard('Ingresos del mes', formatCurrency(Number(metrics.ingresos_mes_actual || 0)), 'green', 'Pagos recibidos este mes')}
          ${renderMetricCard('Mes anterior', formatCurrency(Number(metrics.ingresos_mes_anterior || 0)), 'slate', 'Comparativo mensual')}
          ${renderMetricCard('Crecimiento', `${Number(metrics.crecimiento_ingresos_pct || 0)}%`, 'amber', 'Vs. mes anterior')}
          ${renderMetricCard('Hoteles con gracia', metrics.hoteles_con_gracia || 0, 'blue', 'Soporte comercial/operativo')}
        </div>
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${renderMetricCard('Hoteles activos', metrics.hoteles_activos || 0, 'green')}
        ${renderMetricCard('Hoteles trial', metrics.hoteles_trial || 0, 'amber')}
        ${renderMetricCard('Hoteles vencidos', metrics.hoteles_vencidos || 0, 'red')}
        ${renderMetricCard('Incidencias chat', metrics.incidencias_chat || 0, 'blue')}
      </section>

      <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        ${renderMetricCard('Leads landing 30d', metrics.landing_leads_30d || 0, 'blue', 'Captados por Laura y formularios')}
        ${renderMetricCard('Solicitudes integracion', metrics.solicitudes_integracion_pendientes || 0, 'amber', 'Pendientes de priorizacion')}
        ${renderMetricCard('Grupos hoteleros', metrics.grupos_hoteleros_activos || 0, 'green', 'Cuentas multi-propiedad activas')}
        ${renderMetricCard('Pagos del mes', metrics.pagos_mes_actual || 0, 'slate', 'Transacciones SaaS registradas')}
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.25fr_0.95fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Ingresos</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Resumen financiero mensual</h2>
          <div class="mt-4 grid gap-4 lg:grid-cols-2">
            <div>
              <h3 class="text-sm font-semibold text-slate-700">Ingresos por plan</h3>
              <div class="mt-3">${renderRevenueByPlan(snapshot?.revenue_by_plan || [])}</div>
            </div>
            <div>
              <h3 class="text-sm font-semibold text-slate-700">Ultimos 6 meses</h3>
              <div class="mt-3">${renderMonthlyIncome(snapshot?.monthly_income || [])}</div>
            </div>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Pagos recientes</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Actividad comercial</h2>
          <div class="mt-4">${renderRecentPayments(snapshot?.recent_payments || [])}</div>
        </article>
      </section>

      <section class="grid gap-6 xl:grid-cols-[0.85fr_1.15fr_1fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Multi-propiedad</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Resumen de grupos hoteleros</h2>
          <div class="mt-4">${renderGroupSummary(groupSummary)}</div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Landing / comercial</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Leads recientes</h2>
          <div class="mt-4">${renderLandingLeads(landingLeadsCache)}</div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Integraciones</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Solicitudes por revisar</h2>
          <div class="mt-4">${renderIntegrationRequestsGlobal(integrationRequestsCache)}</div>
        </article>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Hoteles</p>
            <h2 class="mt-1 text-xl font-bold text-slate-900">Gestion global de cuentas</h2>
            <p id="ops-saas-hotels-counter" class="mt-1 text-sm text-slate-500">0 hotel(es) visibles</p>
          </div>
          <input
            id="ops-saas-hotel-search"
            type="search"
            placeholder="Buscar hotel, ciudad, estado o contacto"
            class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-blue-300 focus:bg-white md:max-w-sm"
          >
        </div>
        <div class="mt-4 overflow-x-auto">
          <table class="min-w-[1180px] text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-4 py-3 text-left">Hotel</th>
                <th class="px-4 py-3 text-left">Plan</th>
                <th class="px-4 py-3 text-left">Estado</th>
                <th class="px-4 py-3 text-left">Vencimiento / gracia</th>
                <th class="px-4 py-3 text-right">Ingresos mes</th>
                <th class="px-4 py-3 text-left">Ultimo pago</th>
                <th class="px-4 py-3 text-left">Creado</th>
                <th class="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody id="ops-saas-hotels-body"></tbody>
          </table>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Pricing futuro</p>
            <h2 class="mt-1 text-xl font-bold text-slate-900">Uso consolidado por hotel</h2>
            <p class="mt-2 text-sm text-slate-600">Sirve para identificar expansion, cuentas pesadas y oportunidades de pricing o planes multi-propiedad.</p>
          </div>
        </div>
        <div class="mt-4">${renderUsageByHotel(usageByHotelCache)}</div>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Errores y eventos</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Eventos recientes del sistema</h2>
          <div class="mt-4">${renderRecentEvents(snapshot?.recent_events || [])}</div>
        </section>

        ${renderSecuritySummary(snapshot?.security)}
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
        Cargando admin panel SaaS...
      </div>
    </div>
  `;

  try {
    const [
      { data: snapshot, error: snapshotError },
      { data: hotels, error: hotelsError },
      { data: usageByHotel, error: usageError },
      { data: landingLeads, error: leadsError },
      { data: integrationRequests, error: integrationsError },
      { data: groupSummary, error: groupSummaryError }
    ] = await Promise.all([
      currentSupabaseInstance.rpc('saas_dashboard_snapshot'),
      currentSupabaseInstance.rpc('saas_listar_hoteles'),
      currentSupabaseInstance.rpc('saas_usage_by_hotel'),
      currentSupabaseInstance.rpc('saas_recent_landing_leads'),
      currentSupabaseInstance.rpc('saas_listar_integraciones_interes'),
      currentSupabaseInstance.rpc('saas_resumen_grupos_hoteleros')
    ]);

    if (snapshotError) throw snapshotError;
    if (hotelsError) throw hotelsError;
    if (usageError) console.warn('[Ops SaaS] saas_usage_by_hotel no disponible:', usageError);
    if (leadsError) console.warn('[Ops SaaS] saas_recent_landing_leads no disponible:', leadsError);
    if (integrationsError) console.warn('[Ops SaaS] saas_listar_integraciones_interes no disponible:', integrationsError);
    if (groupSummaryError) console.warn('[Ops SaaS] saas_resumen_grupos_hoteleros no disponible:', groupSummaryError);

    dashboardSnapshotCache = snapshot || {};
    hotelsCache = hotels || [];
    usageByHotelCache = usageByHotel || [];
    landingLeadsCache = landingLeads || [];
    integrationRequestsCache = integrationRequests || [];
    groupSummaryCache = groupSummary || {};
    renderConsole(dashboardSnapshotCache);
  } catch (error) {
    console.error('[Ops SaaS] Error cargando consola:', error);
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          No se pudo cargar el admin panel: ${escapeHtml(error.message || 'Error desconocido')}
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
  dashboardSnapshotCache = null;
  usageByHotelCache = [];
  landingLeadsCache = [];
  integrationRequestsCache = [];
  groupSummaryCache = null;
  cleanupListeners();
  clearAppFeedback();

  if (!currentUser) {
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          Debes iniciar sesion para acceder al admin panel.
        </div>
      </div>
    `;
    return;
  }

  showGlobalLoading('Cargando admin panel SaaS...');
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
  dashboardSnapshotCache = null;
  usageByHotelCache = [];
  landingLeadsCache = [];
  integrationRequestsCache = [];
  groupSummaryCache = null;
}
