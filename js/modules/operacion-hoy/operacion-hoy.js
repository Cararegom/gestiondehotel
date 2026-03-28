import { renderEmptyState, renderMetricCard, renderMetricGrid, renderPageHero, renderSectionCard } from '../../services/appUiKit.js';
import { loadOperationTodaySnapshot } from '../../services/operationTodayService.js';

let currentContainer = null;
let listeners = [];

function bind(element, type, handler) {
  element.addEventListener(type, handler);
  listeners.push({ element, type, handler });
}

function renderSimpleList(items, emptyText, type) {
  if (!items.length) {
    return `<div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">${emptyText}</div>`;
  }

  return `
    <div class="space-y-3">
      ${items.map((item) => `
        <article class="rounded-2xl border ${type === 'attention' ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'} p-4 shadow-sm">
          <div class="flex items-start justify-between gap-3">
            <div>
              <strong class="block text-slate-900">${item.cliente_nombre || item.title || 'Registro'}</strong>
              <p class="mt-1 text-sm text-slate-600">${item.habitaciones?.nombre || item.helper || 'Sin detalle adicional'}</p>
              ${item.schedule ? `<small class="mt-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">${item.schedule}</small>` : ''}
            </div>
            ${item.route ? `<a href="${item.route}" class="button button-neutral app-touch-button">Abrir</a>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

async function renderModule(container, supabase, hotelId) {
  if (!hotelId) {
    container.innerHTML = renderEmptyState({
      icon: '!',
      title: 'No encontramos un hotel activo',
      description: 'Esta vista necesita un hotel cargado para revisar el día operativo.',
      actionHref: '#/dashboard',
      actionLabel: 'Volver al dashboard'
    });
    return;
  }

  const snapshot = await loadOperationTodaySnapshot(supabase, hotelId);

  const hero = renderPageHero({
    eyebrow: 'Operación diaria',
    title: 'Hoy en operación',
    description: 'Una sola vista para revisar el día: llegadas, salidas, ocupación, limpieza, mantenimiento y urgencias.',
    actions: [
      { label: 'Actualizar', className: 'button button-primary app-touch-button', attrs: 'data-operacion-refresh="true"' },
      { href: '#/dashboard', label: 'Volver al dashboard', className: 'button button-neutral app-touch-button' }
    ]
  });

  const cards = [
    renderMetricCard({ label: 'Llegadas hoy', value: snapshot.metrics.arrivalsToday, helper: 'Reservas con ingreso hoy', tone: 'blue', icon: 'IN' }),
    renderMetricCard({ label: 'Salidas hoy', value: snapshot.metrics.departuresToday, helper: 'Checkouts del día', tone: 'violet', icon: 'OUT' }),
    renderMetricCard({ label: 'Habitaciones ocupadas', value: snapshot.metrics.occupiedNow, helper: 'Pulso actual del hotel', tone: 'emerald', icon: 'H' }),
    renderMetricCard({ label: 'Por limpiar', value: snapshot.metrics.cleaningNow, helper: 'Habitaciones listas por cerrar', tone: 'amber', icon: 'L' }),
    renderMetricCard({ label: 'Mantenimientos abiertos', value: snapshot.metrics.maintenanceOpen, helper: 'Tareas activas', tone: 'rose', icon: 'M' }),
    renderMetricCard({ label: 'Turnos abiertos', value: snapshot.metrics.openShifts, helper: 'Caja y recepción activas', tone: 'slate', icon: 'T' })
  ];

  const arrivals = renderSectionCard({
    eyebrow: 'Recepción',
    title: 'Llegadas del día',
    description: 'Check-ins programados para hoy con foco operativo.',
    body: renderSimpleList(snapshot.arrivals, 'No hay llegadas pendientes para hoy.', 'arrivals')
  });

  const departures = renderSectionCard({
    eyebrow: 'Cierre',
    title: 'Salidas del día',
    description: 'Check-outs programados y seguimiento rápido.',
    body: renderSimpleList(snapshot.departures, 'No hay salidas programadas hoy.', 'departures')
  });

  const attention = renderSectionCard({
    eyebrow: 'Atención inmediata',
    title: 'Lo que conviene revisar primero',
    description: 'Alertas mezcladas de reservas, limpieza, mantenimiento y checkout.',
    body: renderSimpleList(snapshot.attentionList, 'No hay alertas inmediatas en este momento.', 'attention')
  });

  container.innerHTML = `
    <div class="space-y-6">
      ${hero}
      ${renderMetricGrid(cards, 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3')}
      <div class="grid gap-6 xl:grid-cols-2">
        ${arrivals}
        ${departures}
      </div>
      ${attention}
    </div>
  `;
}

export async function mount(container, supabase, currentUser, hotelId) {
  currentContainer = container;
  container.innerHTML = `<div class="p-8 text-center text-slate-500">Cargando operación diaria...</div>`;
  await renderModule(container, supabase, hotelId);

  bind(container, 'click', async (event) => {
    const refreshButton = event.target.closest('[data-operacion-refresh]');
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Actualizando...';
      try {
        await renderModule(container, supabase, hotelId);
      } finally {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Actualizar';
      }
    }
  });
}

export function unmount(container) {
  listeners.forEach(({ element, type, handler }) => element.removeEventListener(type, handler));
  listeners = [];
  if (container && container === currentContainer) {
    container.innerHTML = '';
  }
  currentContainer = null;
}
