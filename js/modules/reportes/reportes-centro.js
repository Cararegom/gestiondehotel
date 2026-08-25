let root = null;
let activeModule = null;

const tabs = [
  { key: 'operativos', label: 'Reportes operativos', icon: '📊', load: () => import('./reportes.js') },
  { key: 'resultados', label: 'Estado de resultados', icon: '📈', adminOnly: true, load: () => import('./finanzas-pnl.js') },
  { key: 'cuentas', label: 'Cuentas financieras', icon: '🏦', adminOnly: true, load: () => import('../finanzas-cuentas/finanzas-cuentas.js') },
  { key: 'gastos', label: 'Gastos y cuentas por pagar', icon: '🧾', adminOnly: true, load: () => import('../gastos/gastos.js') },
  { key: 'costeo', label: 'Costeo y margen', icon: '📦', adminOnly: true, load: () => import('../costeo/costeo.js') }
];

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isAdmin(user) {
  return ['admin', 'administrador', 'superadmin'].includes(normalizeRole(user?.role || user?.rol));
}

async function showTab(key, context) {
  const tab = tabs.find((item) => item.key === key) || tabs[0];
  if (tab.adminOnly && !context.admin) return;
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
    await activeModule.mount(context.host, context.supabase, context.user, context.hotelId, context.planDetails);
  } catch (error) {
    console.error('[Reportes] No fue posible abrir la sección:', error);
    context.host.innerHTML = `<div class="m-4 rounded-xl border border-red-200 bg-red-50 p-5 text-red-700">No fue posible abrir esta sección: ${String(error?.message || error)}</div>`;
  }
}

export async function mount(container, supabase, user, hotelId, planDetails) {
  unmount();
  root = container;
  const admin = isAdmin(user);
  const visibleTabs = tabs.filter((tab) => !tab.adminOnly || admin);
  root.innerHTML = `
    <section class="min-h-full bg-slate-50 p-3 md:p-5">
      <header class="mb-4 rounded-2xl bg-gradient-to-r from-slate-950 via-blue-950 to-blue-700 p-5 text-white shadow-lg">
        <p class="text-xs font-semibold uppercase tracking-[.2em] text-blue-200">Centro de información</p>
        <h1 class="mt-1 text-2xl font-bold">Reportes${admin ? ' y finanzas' : ''}</h1>
        <p class="mt-1 max-w-3xl text-sm text-blue-100">${admin ? 'Consulta la operación y administra la información financiera desde un solo lugar.' : 'Consulta los reportes necesarios para la operación del hotel.'}</p>
      </header>
      <nav aria-label="Secciones de reportes" class="mb-4 flex gap-2 overflow-x-auto pb-1">
        ${visibleTabs.map((tab) => `<button type="button" data-report-tab="${tab.key}" aria-selected="false" class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"><span aria-hidden="true">${tab.icon}</span> ${tab.label}</button>`).join('')}
      </nav>
      ${admin ? '<div class="mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"><strong>Acceso administrativo:</strong> las secciones financieras no se muestran a recepcionistas ni a otros roles operativos.</div>' : ''}
      <div id="reportes-centro-contenido"></div>
    </section>`;
  const host = root.querySelector('#reportes-centro-contenido');
  const context = { host, supabase, user, hotelId, planDetails, admin };
  root.querySelectorAll('[data-report-tab]').forEach((button) => button.addEventListener('click', () => showTab(button.dataset.reportTab, context)));
  await showTab('operativos', context);
}

export function unmount() {
  if (activeModule?.unmount && root) activeModule.unmount(root.querySelector('#reportes-centro-contenido'));
  activeModule = null;
  if (root) root.innerHTML = '';
  root = null;
}
