import { renderChecklist, renderEmptyState, renderMetricCard, renderMetricGrid, renderPageHero, renderSectionCard } from '../../services/appUiKit.js';
import { loadHotelOnboardingSnapshot } from '../../services/hotelOnboardingService.js';

let currentContainer = null;

export async function mount(container, supabase, currentUser, hotelId) {
  currentContainer = container;
  container.innerHTML = `<div class="p-8 text-center text-slate-500">Cargando onboarding...</div>`;

  if (!hotelId) {
    container.innerHTML = renderEmptyState({
      icon: '!',
      title: 'No pudimos identificar el hotel',
      description: 'Necesitamos un hotel activo para calcular los primeros pasos.',
      actionHref: '#/dashboard',
      actionLabel: 'Volver al dashboard'
    });
    return;
  }

  const snapshot = await loadHotelOnboardingSnapshot(supabase, hotelId);
  const cards = [
    renderMetricCard({ label: 'Progreso', value: `${snapshot.progress}%`, helper: `${snapshot.completeCount} de ${snapshot.steps.length} pasos listos`, tone: 'blue', icon: '•' }),
    renderMetricCard({ label: 'Habitaciones', value: snapshot.stats.habitacionesCount, helper: 'Base operativa cargada', tone: 'emerald', icon: 'H' }),
    renderMetricCard({ label: 'Equipo', value: snapshot.stats.usuariosCount, helper: 'Usuarios del hotel', tone: 'violet', icon: 'U' }),
    renderMetricCard({ label: 'Reservas', value: snapshot.stats.reservasCount, helper: 'Reservas registradas', tone: 'amber', icon: 'R' })
  ];

  const hero = renderPageHero({
    eyebrow: 'Primeros pasos',
    title: `Onboarding de ${snapshot.hotel?.nombre || 'tu hotel'}`,
    description: snapshot.nextPendingStep
      ? `El siguiente paso recomendado es: ${snapshot.nextPendingStep.title}.`
      : 'Tu operación base ya está lista. Puedes usar este panel como checklist rápido de salud inicial.',
    badges: [
      `Plan: ${snapshot.hotel?.plan || 'Sin plan'}`,
      `Estado: ${snapshot.hotel?.estado_suscripcion || 'Activo'}`
    ],
    actions: [
      { href: '#/sandbox', label: 'Abrir sandbox', className: 'button button-neutral app-touch-button' },
      { href: '#/operacion-hoy', label: 'Ver hoy en operación', className: 'button button-primary app-touch-button' }
    ]
  });

  const checklist = renderSectionCard({
    eyebrow: 'Checklist',
    title: 'Ruta mínima para salir a operar',
    description: 'Estos son los pasos que más rápido dejan el hotel listo para trabajar sin fricciones.',
    body: renderChecklist(snapshot.steps)
  });

  const recommendations = renderSectionCard({
    eyebrow: 'Siguiente foco',
    title: 'Qué conviene resolver ahora',
    description: 'Recomendaciones rápidas según el estado real del hotel.',
    body: `
      <div class="grid gap-4 md:grid-cols-2">
        <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <strong class="block text-slate-900">Prioridad operativa</strong>
          <p class="mt-2 text-sm text-slate-600">${snapshot.nextPendingStep
            ? `${snapshot.nextPendingStep.title}: ${snapshot.nextPendingStep.description}`
            : 'El onboarding base ya está completo. Conviene revisar reportes, soporte y operación diaria.'}</p>
        </article>
        <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <strong class="block text-slate-900">Capacitación</strong>
          <p class="mt-2 text-sm text-slate-600">Usa el módulo Sandbox para practicar flujos sin presión y luego pasa a Hoy en operación para revisar el día real.</p>
        </article>
      </div>
    `
  });

  container.innerHTML = `
    <div class="space-y-6">
      ${hero}
      ${renderMetricGrid(cards)}
      ${checklist}
      ${recommendations}
    </div>
  `;
}

export function unmount(container) {
  if (container && container === currentContainer) {
    container.innerHTML = '';
  }
  currentContainer = null;
}
