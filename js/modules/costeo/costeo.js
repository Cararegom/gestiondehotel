import { escapeHtml } from '../../security.js';

let root; let supabase; let hotelId; let balances = []; let cogs = []; let storePrices = new Map(); let showOnlyCostIssues = false;
const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const qty = value => new Intl.NumberFormat('es-CO', { maximumFractionDigits: 3 }).format(Number(value || 0));
const roleKey = user => String(user?.role || user?.rol || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const areaName = { store: 'Tienda', terrace: 'Terraza', restaurant: 'Restaurante' };
const COSTEO_FILTER_STORAGE_KEY = 'gestionhotel.costeo.filter';
const COSTEO_RETURN_STORAGE_KEY = 'gestionhotel.costeo.returnTo';

function readCosteoIntent() {
  const queryIndex = String(globalThis.location?.hash || '').indexOf('?');
  const params = queryIndex >= 0 ? new URLSearchParams(globalThis.location.hash.slice(queryIndex + 1)) : new URLSearchParams();
  const filter = params.get('filter') || globalThis.sessionStorage?.getItem(COSTEO_FILTER_STORAGE_KEY) || '';
  showOnlyCostIssues = filter === 'cost_issues';
  if (showOnlyCostIssues) globalThis.sessionStorage?.setItem(COSTEO_FILTER_STORAGE_KEY, 'cost_issues');
}

function clearCosteoFilter() {
  showOnlyCostIssues = false;
  globalThis.sessionStorage?.removeItem(COSTEO_FILTER_STORAGE_KEY);
}

function openRestaurantRecipe(platoId) {
  if (!platoId) return;
  globalThis.sessionStorage?.setItem('gestionhotel.restaurante.focusRecipe', JSON.stringify({ platoId, source: 'costeo', createdAt: Date.now() }));
  globalThis.location.hash = `#/restaurante?tab=platos&plato=${encodeURIComponent(platoId)}&from=costeo`;
}

function returnToPnl() {
  globalThis.sessionStorage?.removeItem(COSTEO_RETURN_STORAGE_KEY);
  const reportesRoot = root?.closest('#app-container');
  const pnlTab = reportesRoot?.querySelector('[data-report-tab="resultados"]');
  if (pnlTab) {
    pnlTab.click();
  } else {
    globalThis.location.hash = '#/reportes';
  }
}

async function loadData() {
  const [{ data: balanceRows, error: balanceError }, { data: cogsRows, error: cogsError }, { data: storeRows, error: storeError }] = await Promise.all([
    supabase.from('inventory_cost_balances').select('*').eq('hotel_id', hotelId).order('area').order('item_name'),
    supabase.from('cogs_entries').select('*').eq('hotel_id', hotelId).order('occurred_at', { ascending: false }).limit(1000),
    supabase.from('productos_tienda').select('id, precio').eq('hotel_id', hotelId)
  ]);
  if (balanceError) throw balanceError;
  if (cogsError) throw cogsError;
  if (storeError) throw storeError;
  balances = balanceRows || [];
  cogs = cogsRows || [];
  storePrices = new Map((storeRows || []).map(row => [row.id, Number(row.precio || 0)]));
  render();
}

function inventoryRows() {
  if (!balances.length) return '<tr><td colspan="6" class="p-6 text-center text-slate-500">No hay inventario para valorizar.</td></tr>';
  return balances.map(row => `<tr class="border-t">
    <td class="p-3"><span class="text-xs text-slate-500">${areaName[row.area]}</span><div class="font-medium">${escapeHtml(row.item_name)}</div></td>
    <td class="p-3 text-right">${qty(row.quantity)}</td>
    <td class="p-3 text-right">${row.area === 'store' ? money(storePrices.get(row.item_id)) : '<span class="text-slate-400">No aplica</span>'}</td>
    <td class="p-3 text-right">${money(row.average_unit_cost)}</td>
    <td class="p-3 text-right font-semibold">${money(row.inventory_value)}</td>
    <td class="p-3">${row.cost_status === 'active' ? '<span class="text-emerald-700">Costo activo</span>' : `<form class="cost-form flex gap-2" data-area="${row.area}" data-item="${row.item_id}"><input name="cost" type="number" min="0" step="0.01" required class="w-32 border rounded-lg p-2" placeholder="Costo por unidad" aria-label="Costo unitario de ${escapeHtml(row.item_name)}"><button class="bg-amber-500 hover:bg-amber-600 text-white rounded-lg px-3 font-semibold">Activar</button></form>`}</td>
  </tr>`).join('');
}

function cogsRows() {
  const rows = showOnlyCostIssues ? cogs.filter(row => row.cost_issue) : cogs;
  if (!rows.length) return `<tr><td colspan="6" class="p-6 text-center text-slate-500">${showOnlyCostIssues ? 'No hay ventas con costo pendiente.' : 'Aún no hay ventas costeadas.'}</td></tr>`;
  return rows.map(row => {
    const issueLabel = row.cost_issue === 'missing_recipe' ? 'Sin receta' : 'Costo de ingrediente en cero';
    const quality = row.cost_issue
      ? `<span class="block font-semibold text-red-600">${issueLabel}</span><span class="mt-1 block text-xs text-slate-500">${row.cost_issue === 'missing_recipe' ? 'Configura la receta real del plato y vuelve a recalcular.' : 'Corrige el costo del ingrediente y vuelve a recalcular.'}</span><div class="mt-2 flex flex-wrap justify-center gap-1">${row.area === 'restaurant' && row.item_id ? `<button type="button" class="configure-recipe rounded-lg border border-red-300 bg-white px-2 py-1 text-xs font-semibold text-red-700" data-item="${row.item_id}">Configurar receta</button>` : ''}<button type="button" class="reprocess-cogs rounded-lg bg-blue-600 px-2 py-1 text-xs font-semibold text-white" data-id="${row.id}">Recalcular CMV</button></div>`
      : (row.cost_status === 'active' ? 'Confirmado' : '<span class="text-amber-700">Estimado</span>');
    return `<tr class="border-t"><td class="p-3">${escapeHtml(row.business_date)}</td><td class="p-3"><span class="text-xs text-slate-500">${areaName[row.area]}</span><div>${escapeHtml(row.item_name)}</div></td><td class="p-3 text-right">${money(row.revenue)}</td><td class="p-3 text-right text-red-600">${money(row.total_cost)}</td><td class="p-3 text-right font-semibold ${Number(row.margin) < 0 ? 'text-red-600' : 'text-emerald-700'}">${money(row.margin)}</td><td class="p-3">${quality}</td></tr>`;
  }).join('');
}

function render() {
  const inventoryValue = balances.reduce((sum, row) => sum + Number(row.inventory_value), 0);
  const revenue = cogs.reduce((sum, row) => sum + Number(row.revenue), 0);
  const totalCogs = cogs.reduce((sum, row) => sum + Number(row.total_cost), 0);
  const pending = balances.filter(row => row.cost_status !== 'active').length;
  const costIssues = cogs.filter(row => row.cost_issue).length;
  root.innerHTML = `<section class="p-4 md:p-6 space-y-5">
    <div><h2 class="text-2xl font-bold text-slate-800">Costeo de inventario y margen</h2><p class="text-sm text-slate-500">Calcula el costo promedio móvil y congela el costo de cada venta sin modificar reportes históricos.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-4 gap-3"><article class="bg-white border rounded-xl p-4"><p class="text-sm text-slate-500">Inventario valorizado</p><strong class="text-2xl text-blue-700">${money(inventoryValue)}</strong></article><article class="bg-white border rounded-xl p-4"><p class="text-sm text-slate-500">Ventas con CMV</p><strong class="text-2xl text-slate-800">${money(revenue)}</strong></article><article class="bg-white border rounded-xl p-4"><p class="text-sm text-slate-500">Costo de lo vendido</p><strong class="text-2xl text-red-600">${money(totalCogs)}</strong></article><article class="bg-white border rounded-xl p-4"><p class="text-sm text-slate-500">Margen bruto</p><strong class="text-2xl text-emerald-600">${money(revenue - totalCogs)}</strong></article></div>
    ${pending ? `<div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900"><strong>${pending} productos requieren costo inicial.</strong><p class="text-sm mt-1">En Tienda se usa automáticamente “Precio compra”. Solo debes completar manualmente productos de otras áreas que no tengan costo.</p></div>` : ''}
    ${costIssues ? `<div class="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900"><div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"><div><strong>${costIssues} venta(s) impiden el cierre financiero.</strong><p class="text-sm mt-1">Primero corrige receta/costo real, luego pulsa Recalcular CMV. El cierre mensual no inventa costos.</p></div><button type="button" id="toggle-cost-issues" class="rounded-lg ${showOnlyCostIssues ? 'bg-slate-700' : 'bg-red-700'} px-4 py-2 text-sm font-semibold text-white">${showOnlyCostIssues ? 'Ver todas las ventas' : 'Ver solo pendientes'}</button></div></div>` : ''}
    <div class="bg-white border rounded-xl overflow-hidden"><div class="p-4 border-b"><h3 class="font-bold">Inventario valorizado</h3><p class="text-xs text-slate-500">“Precio compra” viene de la ficha de Tienda. “Costo promedio” es el valor contable y cambia al recibir compras.</p></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Área / producto</th><th class="p-3 text-right">Existencias</th><th class="p-3 text-right">Precio compra (ficha)</th><th class="p-3 text-right">Costo promedio</th><th class="p-3 text-right">Valor inventario</th><th class="p-3 text-left">Estado / acción</th></tr></thead><tbody>${inventoryRows()}</tbody></table></div></div>
    <div class="bg-white border rounded-xl overflow-hidden"><div class="p-4 border-b"><h3 class="font-bold">Margen de ventas nuevas</h3><p class="text-xs text-slate-500">Solo incluye ventas registradas después de activar esta fase.</p></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Fecha</th><th class="p-3 text-left">Área / producto</th><th class="p-3 text-right">Venta</th><th class="p-3 text-right">CMV</th><th class="p-3 text-right">Margen</th><th class="p-3 text-left">Calidad</th></tr></thead><tbody>${cogsRows()}</tbody></table></div></div>
    <p id="cost-feedback" class="text-sm"></p>
  </section>`;
  bindEvents();
}

function bindEvents() {
  root.querySelector('#toggle-cost-issues')?.addEventListener('click', () => {
    if (showOnlyCostIssues) clearCosteoFilter(); else { showOnlyCostIssues = true; globalThis.sessionStorage?.setItem(COSTEO_FILTER_STORAGE_KEY, 'cost_issues'); }
    render();
  });
  root.querySelectorAll('.configure-recipe').forEach(button => button.addEventListener('click', () => openRestaurantRecipe(button.dataset.item)));
  root.querySelectorAll('.cost-form').forEach(form => form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Guardando...';
    const cost = Number(new FormData(form).get('cost'));
    const { error } = await supabase.rpc('establecer_costo_inicial_inventario', { p_area: form.dataset.area, p_item_id: form.dataset.item, p_unit_cost: cost });
    if (error) { button.disabled = false; button.textContent = 'Activar'; const feedback = root.querySelector('#cost-feedback'); feedback.textContent = error.message; feedback.className = 'text-sm text-red-600'; return; }
    await loadData(); const feedback = root.querySelector('#cost-feedback'); feedback.textContent = 'Costo inicial guardado. Las próximas entradas usarán promedio móvil.'; feedback.className = 'text-sm text-emerald-600';
  }));
  root.querySelectorAll('.reprocess-cogs').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = 'Recalculando...';
    const { error } = await supabase.rpc('reprocesar_cmv_restaurante', { p_cogs_id: button.dataset.id });
    if (error) { button.disabled = false; button.textContent = 'Recalcular CMV'; const feedback = root.querySelector('#cost-feedback'); feedback.textContent = error.message; feedback.className = 'text-sm text-red-600'; return; }
    const shouldReturnToPnl = globalThis.sessionStorage?.getItem(COSTEO_RETURN_STORAGE_KEY) === 'resultados';
    await loadData(); const feedback = root.querySelector('#cost-feedback'); feedback.className = 'text-sm text-emerald-700';
    if (shouldReturnToPnl) {
      feedback.innerHTML = 'CMV recalculado y existencias de ingredientes actualizadas. <button type="button" id="return-to-pnl" class="ml-2 rounded-lg border border-emerald-300 bg-white px-3 py-1 text-xs font-semibold text-emerald-800">Volver al estado de resultados</button>';
      feedback.querySelector('#return-to-pnl')?.addEventListener('click', returnToPnl);
    } else {
      feedback.textContent = 'CMV recalculado y existencias de ingredientes actualizadas.';
    }
  }));
}

export async function mount(container, supabaseClient, user, currentHotelId) {
  root = container; supabase = supabaseClient; hotelId = currentHotelId; readCosteoIntent();
  if (!['admin', 'administrador'].includes(roleKey(user))) { root.innerHTML = '<p class="p-6 text-red-600">Solo el administrador puede gestionar el costeo de inventario.</p>'; return; }
  root.innerHTML = '<p class="p-6">Cargando costos...</p>';
  try { await loadData(); } catch (error) { root.innerHTML = `<p class="p-6 text-red-600">${escapeHtml(error.message)}</p>`; }
}
export function unmount() { if (root) root.innerHTML = ''; root = null; supabase = null; balances = []; cogs = []; storePrices = new Map(); showOnlyCostIssues = false; }
