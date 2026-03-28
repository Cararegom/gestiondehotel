import { renderEmptyState, renderMetricCard, renderMetricGrid, renderPageHero, renderSectionCard } from '../../services/appUiKit.js';
import { activateSandboxScenario, clearSandboxState, getSandboxScenarios, loadSandboxState } from '../../services/demoSandboxService.js';
import { showAppFeedback } from '../../uiUtils.js';

let currentContainer = null;
let listeners = [];

function bind(element, type, handler) {
  element.addEventListener(type, handler);
  listeners.push({ element, type, handler });
}

function renderSandbox(container) {
  const activeScenario = loadSandboxState();
  const scenarios = getSandboxScenarios();

  const hero = renderPageHero({
    eyebrow: 'Modo sandbox',
    title: 'Practica y demo sin tocar la operación real',
    description: activeScenario
      ? `Tienes activo el escenario "${activeScenario.name}". Puedes usarlo como guía comercial o de capacitación.`
      : 'Carga un escenario demostrativo para explicar el sistema o entrenar recepción sin depender de datos reales.',
    badges: activeScenario ? [`Escenario: ${activeScenario.name}`, `Activado: ${new Date(activeScenario.activatedAt).toLocaleString('es-CO')}`] : [],
    actions: [
      { href: '#/onboarding', label: 'Ver onboarding', className: 'button button-neutral app-touch-button' },
      { href: '#/operacion-hoy', label: 'Hoy en operación', className: 'button button-primary app-touch-button' }
    ]
  });

  const scenarioPicker = renderSectionCard({
    eyebrow: 'Escenarios',
    title: 'Elige un contexto de demostración',
    description: 'Estos escenarios viven localmente y no escriben nada en la base del hotel.',
    body: `
      <div class="grid gap-4 lg:grid-cols-3">
        ${scenarios.map((scenario) => `
          <article class="rounded-2xl border ${activeScenario?.id === scenario.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'} p-5 shadow-sm">
            <h3 class="text-lg font-bold text-slate-900">${scenario.name}</h3>
            <p class="mt-2 text-sm text-slate-600">${scenario.description}</p>
            <button type="button" class="button ${activeScenario?.id === scenario.id ? 'button-neutral' : 'button-primary'} app-touch-button mt-4" data-sandbox-load="${scenario.id}">
              ${activeScenario?.id === scenario.id ? 'Activo' : 'Cargar escenario'}
            </button>
          </article>
        `).join('')}
      </div>
    `
  });

  const activeDetail = activeScenario
    ? renderSectionCard({
        eyebrow: 'Vista actual',
        title: activeScenario.name,
        description: 'Resumen visual del escenario cargado para presentar o entrenar.',
        actions: [
          { label: 'Limpiar sandbox', className: 'button button-danger app-touch-button', attrs: 'data-sandbox-clear="true"' }
        ],
        body: `
          ${renderMetricGrid([
            renderMetricCard({ label: 'Ocupación', value: activeScenario.metrics.ocupacion, helper: 'Visión rápida del escenario', tone: 'blue' }),
            renderMetricCard({ label: 'Llegadas', value: activeScenario.metrics.llegadas, helper: 'Movimientos del día', tone: 'emerald' }),
            renderMetricCard({ label: 'Salidas', value: activeScenario.metrics.salidas, helper: 'Ritmo operativo', tone: 'amber' }),
            renderMetricCard({ label: 'Venta extra', value: activeScenario.metrics.ventaExtra, helper: 'Upsell estimado', tone: 'violet' })
          ], 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4')}
          <div class="mt-6 grid gap-4 lg:grid-cols-2">
            <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <strong class="block text-slate-900">Puntos clave</strong>
              <ul class="mt-3 space-y-2 text-sm text-slate-600">
                ${activeScenario.highlights.map((item) => `<li>${item}</li>`).join('')}
              </ul>
            </article>
            <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <strong class="block text-slate-900">Línea de tiempo demo</strong>
              <ul class="mt-3 space-y-2 text-sm text-slate-600">
                ${activeScenario.timeline.map((item) => `<li>${item}</li>`).join('')}
              </ul>
            </article>
          </div>
        `
      })
    : renderEmptyState({
        icon: 'D',
        title: 'Aún no hay un escenario activo',
        description: 'Carga uno de los contextos de demo para ver métricas y ejemplos listos para capacitación.',
        actionHref: '#/sandbox',
        actionLabel: 'Elegir escenario'
      });

  container.innerHTML = `
    <div class="space-y-6">
      ${hero}
      ${scenarioPicker}
      ${activeDetail}
    </div>
  `;
}

export async function mount(container) {
  currentContainer = container;
  renderSandbox(container);

  bind(container, 'click', (event) => {
    const loadButton = event.target.closest('[data-sandbox-load]');
    if (loadButton) {
      const scenario = activateSandboxScenario(loadButton.dataset.sandboxLoad);
      if (scenario) {
        showAppFeedback(`Sandbox activado: ${scenario.name}`, 'success');
        renderSandbox(container);
      }
      return;
    }

    const clearButton = event.target.closest('[data-sandbox-clear]');
    if (clearButton) {
      clearSandboxState();
      showAppFeedback('Sandbox limpiado. Ya no quedan escenarios demo activos.', 'info');
      renderSandbox(container);
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
