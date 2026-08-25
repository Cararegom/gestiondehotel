let root = null;
let supabase = null;
let state = null;

const money = (value) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const number = (value) => Number(value || 0);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
const monthStart = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
const monthEnd = (date = new Date()) => new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);

function roleKey(user) {
  return String(user?.role || user?.rol || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function card(label, value, tone, detail = '') {
  return `<article class="rounded-2xl border ${tone} bg-white p-4 shadow-sm"><p class="text-xs font-semibold uppercase tracking-wide text-slate-500">${label}</p><p class="mt-2 text-2xl font-bold text-slate-900">${money(value)}</p>${detail ? `<p class="mt-1 text-xs text-slate-500">${detail}</p>` : ''}</article>`;
}

function budgetRow(label, actual, budget) {
  const difference = number(actual) - number(budget);
  const progress = number(budget) > 0 ? (number(actual) / number(budget)) * 100 : null;
  return `<tr class="border-t border-slate-100"><td class="px-3 py-3 font-medium">${label}</td><td class="px-3 py-3 text-right">${money(actual)}</td><td class="px-3 py-3 text-right">${money(budget)}</td><td class="px-3 py-3 text-right ${difference >= 0 ? 'text-emerald-700' : 'text-red-700'}">${money(difference)}</td><td class="px-3 py-3 text-right">${progress === null ? 'Sin meta' : `${progress.toFixed(1)}%`}</td></tr>`;
}

function render(data) {
  const summary = data.summary || {};
  const budget = data.budget || {};
  const quality = data.quality || {};
  const periodMonth = state.from.slice(0, 7);
  const period = (data.periods || []).find((item) => String(item.month).slice(0, 7) === periodMonth);
  root.querySelector('#pnl-results').innerHTML = `
    <div class="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Informe de control (shadow):</strong> sirve para validar cifras antes de convertirlo en contabilidad oficial. No modifica Caja, ventas, inventario ni gastos.</div>
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      ${card('Ingresos', summary.revenue, 'border-emerald-200')}
      ${card('Costo de lo vendido', summary.cogs, 'border-red-200')}
      ${card('Margen bruto', summary.gross_profit, 'border-blue-200')}
      ${card('Gastos operativos', summary.opex, 'border-orange-200')}
      ${card('Resultado operativo', summary.operating_profit, 'border-violet-200')}
    </div>
    <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="border-b border-slate-200 p-4"><h2 class="font-bold text-slate-900">Resultado por área</h2><p class="text-xs text-slate-500">Ingresos menos costo de ventas y gastos operativos.</p></div><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th class="px-3 py-3">Área</th><th class="px-3 py-3 text-right">Ingreso</th><th class="px-3 py-3 text-right">CMV</th><th class="px-3 py-3 text-right">Gastos</th><th class="px-3 py-3 text-right">Resultado</th></tr></thead><tbody>${(data.areas || []).map((row) => `<tr class="border-t border-slate-100"><td class="px-3 py-3 font-medium">${escapeHtml(row.area)}</td><td class="px-3 py-3 text-right">${money(row.revenue)}</td><td class="px-3 py-3 text-right">${money(row.cogs)}</td><td class="px-3 py-3 text-right">${money(row.opex)}</td><td class="px-3 py-3 text-right font-semibold">${money(row.result)}</td></tr>`).join('') || '<tr><td colspan="5" class="p-5 text-center text-slate-500">No hay movimientos en este rango.</td></tr>'}</tbody></table></div></section>
      <section class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="border-b border-slate-200 p-4"><h2 class="font-bold text-slate-900">Real frente a presupuesto</h2><p class="text-xs text-slate-500">Acumulado de los meses incluidos en el rango.</p></div><div class="overflow-x-auto"><table class="w-full text-sm"><thead class="bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-3 text-left">Concepto</th><th class="px-3 py-3 text-right">Real</th><th class="px-3 py-3 text-right">Meta</th><th class="px-3 py-3 text-right">Diferencia</th><th class="px-3 py-3 text-right">Avance</th></tr></thead><tbody>${budgetRow('Ingresos', summary.revenue, budget.revenue)}${budgetRow('CMV', summary.cogs, budget.cogs)}${budgetRow('Gastos', summary.opex, budget.opex)}</tbody></table></div></section>
    </div>
    <div class="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 class="font-bold text-slate-900">Presupuesto mensual</h2><p class="mb-4 text-xs text-slate-500">Define metas de ingresos y topes previstos de CMV y gastos para comparar ejecución.</p><form id="budget-form" class="grid grid-cols-1 gap-3 sm:grid-cols-2"><label class="text-sm font-medium">Mes<input id="budget-month" type="month" required value="${periodMonth}" class="mt-1 w-full rounded-lg border border-slate-300 p-2.5"></label><label class="text-sm font-medium">Meta de ingresos<input id="budget-revenue" type="number" min="0" step="1" required placeholder="Ej. 30000000" class="mt-1 w-full rounded-lg border border-slate-300 p-2.5"></label><label class="text-sm font-medium">Presupuesto de costo de ventas<input id="budget-cogs" type="number" min="0" step="1" required placeholder="Ej. 8000000" class="mt-1 w-full rounded-lg border border-slate-300 p-2.5"></label><label class="text-sm font-medium">Presupuesto de gastos operativos<input id="budget-opex" type="number" min="0" step="1" required placeholder="Ej. 12000000" class="mt-1 w-full rounded-lg border border-slate-300 p-2.5"></label><button class="rounded-lg bg-blue-600 px-4 py-2.5 font-semibold text-white sm:col-span-2">Guardar presupuesto</button></form></section>
      <section class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><h2 class="font-bold text-slate-900">Cierre del periodo</h2><p class="text-sm text-slate-600">Mes consultado: <strong>${periodMonth}</strong></p><p class="mt-2 text-sm">Estado: <span class="rounded-full px-2 py-1 text-xs font-semibold ${period?.status === 'closed' ? 'bg-slate-800 text-white' : 'bg-emerald-100 text-emerald-800'}">${period?.status === 'closed' ? 'Cerrado' : 'Abierto'}</span></p><p class="mt-3 text-xs text-slate-500">El cierre deja evidencia administrativa del corte. En esta fase shadow no bloquea todavía movimientos operativos.</p><div class="mt-4 flex gap-2"><button id="close-period" class="rounded-lg bg-slate-900 px-4 py-2.5 font-semibold text-white">Cerrar mes</button><button id="open-period" class="rounded-lg border border-slate-300 px-4 py-2.5 font-semibold text-slate-700">Reabrir mes</button></div><div class="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-600"><strong>Calidad:</strong> ${number(quality.cogs_with_issues)} venta(s) con novedad de costo y ${number(quality.uncosted_inventory)} inventario(s) sin costo activo.</div></section>
    </div>
    <section class="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="border-b border-slate-200 p-4"><h2 class="font-bold text-slate-900">Trazabilidad del resultado</h2><p class="text-xs text-slate-500">Hasta 300 movimientos que conforman este informe.</p></div><div class="max-h-[420px] overflow-auto"><table class="w-full min-w-[760px] text-sm"><thead class="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500"><tr><th class="px-3 py-3 text-left">Fecha</th><th class="px-3 py-3 text-left">Tipo</th><th class="px-3 py-3 text-left">Área / categoría</th><th class="px-3 py-3 text-left">Descripción</th><th class="px-3 py-3 text-right">Valor</th></tr></thead><tbody>${(data.transactions || []).map((row) => `<tr class="border-t border-slate-100"><td class="px-3 py-3">${escapeHtml(row.business_date)}</td><td class="px-3 py-3">${escapeHtml(row.kind)}</td><td class="px-3 py-3">${escapeHtml(row.area)} · ${escapeHtml(row.category)}</td><td class="px-3 py-3">${escapeHtml(row.description)}</td><td class="px-3 py-3 text-right font-medium">${money(row.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="p-5 text-center text-slate-500">Sin movimientos.</td></tr>'}</tbody></table></div></section>`;
  bindActions();
}

async function loadReport() {
  const feedback = root.querySelector('#pnl-feedback');
  feedback.textContent = 'Calculando el estado de resultados...';
  feedback.className = 'mb-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-800';
  const { data, error } = await supabase.rpc('obtener_estado_resultados_shadow', { p_from: state.from, p_to: state.to });
  if (error) throw error;
  render(data || {});
  feedback.textContent = 'Informe actualizado.';
  feedback.className = 'mb-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800';
}

function bindActions() {
  root.querySelector('#budget-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = event.submitter;
    button.disabled = true;
    try {
      const { error } = await supabase.rpc('guardar_presupuesto_financiero', {
        p_period_month: `${root.querySelector('#budget-month').value}-01`,
        p_revenue_budget: number(root.querySelector('#budget-revenue').value),
        p_cogs_budget: number(root.querySelector('#budget-cogs').value),
        p_opex_budget: number(root.querySelector('#budget-opex').value)
      });
      if (error) throw error;
      await loadReport();
    } catch (error) { alert(`No se pudo guardar el presupuesto: ${error.message}`); }
    finally { button.disabled = false; }
  });
  const changePeriod = async (status) => {
    try {
      const { error } = await supabase.rpc('cambiar_estado_periodo_financiero', { p_period_month: `${state.from.slice(0, 7)}-01`, p_status: status });
      if (error) throw error;
      await loadReport();
    } catch (error) { alert(`No se pudo cambiar el periodo: ${error.message}`); }
  };
  root.querySelector('#close-period')?.addEventListener('click', () => changePeriod('closed'));
  root.querySelector('#open-period')?.addEventListener('click', () => changePeriod('open'));
}

export async function mount(container, supabaseClient, user) {
  unmount();
  root = container;
  supabase = supabaseClient;
  if (!['admin', 'administrador', 'superadmin'].includes(roleKey(user))) {
    root.innerHTML = '<div class="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">Solo el administrador puede consultar información financiera.</div>';
    return;
  }
  state = { from: monthStart(), to: monthEnd() };
  root.innerHTML = `<section><div class="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><p class="text-xs font-semibold uppercase tracking-[.18em] text-blue-600">Fase 5 · Control financiero</p><h1 class="text-2xl font-bold text-slate-900">Estado de resultados</h1><p class="text-sm text-slate-500">Ingresos, costo de ventas, gastos y resultado operativo trazables.</p></div><form id="pnl-filter" class="flex flex-col gap-2 sm:flex-row sm:items-end"><label class="text-sm font-medium">Desde<input id="pnl-from" type="date" value="${state.from}" class="mt-1 block rounded-lg border border-slate-300 p-2.5"></label><label class="text-sm font-medium">Hasta<input id="pnl-to" type="date" value="${state.to}" class="mt-1 block rounded-lg border border-slate-300 p-2.5"></label><button class="rounded-lg bg-blue-600 px-5 py-2.5 font-semibold text-white">Actualizar</button></form></div></div><div id="pnl-feedback" role="status" aria-live="polite"></div><div id="pnl-results"></div></section>`;
  root.querySelector('#pnl-filter').addEventListener('submit', async (event) => {
    event.preventDefault();
    state.from = root.querySelector('#pnl-from').value;
    state.to = root.querySelector('#pnl-to').value;
    if (!state.from || !state.to || state.from > state.to) return alert('Selecciona un rango de fechas válido.');
    try { await loadReport(); } catch (error) { alert(`No se pudo generar el informe: ${error.message}`); }
  });
  try { await loadReport(); } catch (error) {
    root.querySelector('#pnl-feedback').className = 'rounded-lg bg-red-50 p-4 text-red-700';
    root.querySelector('#pnl-feedback').textContent = `No se pudo generar el informe: ${error.message}`;
  }
}

export function unmount() {
  if (root) root.innerHTML = '';
  root = null;
  supabase = null;
  state = null;
}
