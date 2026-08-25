import { escapeHtml } from '../../security.js';
import { buildOperationScope, completeStableOperation, getStableOperationId } from '../../services/fase1OperationService.js';

let root;
let supabase;
let hotelId;
let state = { expenses: [], payments: [], categories: [], centers: [], suppliers: [], accounts: [], methods: [] };

const money = value => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value || 0));
const roleKey = user => String(user?.role || user?.rol || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const labels = { pending_approval: 'Por aprobar', pending: 'Pendiente', partial: 'Pago parcial', paid: 'Pagado', cancelled: 'Cancelado' };
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });

async function loadData() {
  const requests = [
    supabase.from('expenses').select('*').eq('hotel_id', hotelId).order('expense_date', { ascending: false }).limit(250),
    supabase.from('expense_payments').select('expense_id,amount').eq('hotel_id', hotelId),
    supabase.from('expense_categories').select('id,name').eq('hotel_id', hotelId).eq('active', true).order('display_order'),
    supabase.from('cost_centers').select('id,name').eq('hotel_id', hotelId).eq('active', true).order('name'),
    supabase.from('proveedores').select('id,nombre').eq('hotel_id', hotelId).eq('activo', true).order('nombre'),
    supabase.from('financial_accounts').select('id,name,active').eq('hotel_id', hotelId).eq('active', true).order('name'),
    supabase.from('metodos_pago').select('id,nombre,financial_account_id').eq('hotel_id', hotelId).eq('activo', true).not('financial_account_id', 'is', null).order('nombre')
  ];
  const results = await Promise.all(requests);
  const failed = results.find(result => result.error);
  if (failed) throw failed.error;
  [state.expenses, state.payments, state.categories, state.centers, state.suppliers, state.accounts, state.methods] = results.map(result => result.data || []);
  render();
}

function options(items, placeholder) {
  return `<option value="">${placeholder}</option>${items.map(item => `<option value="${item.id}">${escapeHtml(item.name || item.nombre)}</option>`).join('')}`;
}

function render() {
  const paidByExpense = state.payments.reduce((map, payment) => map.set(payment.expense_id, (map.get(payment.expense_id) || 0) + Number(payment.amount)), new Map());
  const outstanding = state.expenses.filter(e => ['pending_approval', 'pending', 'partial'].includes(e.status)).reduce((sum, e) => sum + Number(e.total_amount) - (paidByExpense.get(e.id) || 0), 0);
  const overdue = state.expenses.filter(e => ['pending', 'partial'].includes(e.status) && e.due_date && e.due_date < today()).length;
  root.innerHTML = `<section class="p-4 md:p-6 space-y-5">
    <div><h2 class="text-2xl font-bold text-slate-800">Gastos y cuentas por pagar</h2><p class="text-sm text-slate-500">Registra obligaciones, apruébalas cuando corresponda y controla pagos parciales sin perder su vínculo con Caja y Cuentas financieras.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3"><article class="bg-white border rounded-xl p-4"><div class="text-sm text-slate-500">Saldo por pagar</div><div class="text-2xl font-bold text-amber-600">${money(outstanding)}</div></article><article class="bg-white border rounded-xl p-4"><div class="text-sm text-slate-500">Vencidos</div><div class="text-2xl font-bold text-red-600">${overdue}</div></article><article class="bg-white border rounded-xl p-4"><div class="text-sm text-slate-500">Registros</div><div class="text-2xl font-bold text-slate-700">${state.expenses.length}</div></article></div>
    <form id="expense-form" class="bg-white border rounded-2xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4 shadow-sm">
      <div class="md:col-span-3"><h3 class="text-lg font-bold text-slate-800">Registrar un nuevo gasto</h3><p class="text-sm text-slate-500">Los campos marcados con * son obligatorios. El total será subtotal más impuestos.</p></div>
      <label class="text-sm font-medium text-slate-700">Categoría del gasto *<span class="block text-xs font-normal text-slate-500 mb-1">Ejemplo: servicios públicos, nómina o mantenimiento.</span><select name="category" required class="w-full border border-slate-300 rounded-lg p-2.5 bg-white">${options(state.categories, 'Selecciona una categoría')}</select></label>
      <label class="text-sm font-medium text-slate-700">Área que generó el gasto *<span class="block text-xs font-normal text-slate-500 mb-1">Centro de costo: habitaciones, tienda, terraza, etc.</span><select name="center" required class="w-full border border-slate-300 rounded-lg p-2.5 bg-white">${options(state.centers, 'Selecciona un área')}</select></label>
      <label class="text-sm font-medium text-slate-700">Proveedor<span class="block text-xs font-normal text-slate-500 mb-1">Empresa o persona a quien se le debe pagar.</span><select name="supplier" class="w-full border border-slate-300 rounded-lg p-2.5 bg-white">${options(state.suppliers, 'Sin proveedor registrado')}</select></label>
      <label class="text-sm font-medium text-slate-700 md:col-span-2">Concepto o descripción *<span class="block text-xs font-normal text-slate-500 mb-1">Describe claramente qué se compró o qué servicio se recibió.</span><input name="description" required class="w-full border border-slate-300 rounded-lg p-2.5" placeholder="Ej. Factura de energía del hotel, agosto 2026"></label>
      <label class="text-sm font-medium text-slate-700">Número de factura o soporte<span class="block text-xs font-normal text-slate-500 mb-1">Código impreso en la factura o recibo.</span><input name="document" class="w-full border border-slate-300 rounded-lg p-2.5" placeholder="Ej. FE-45821"></label>
      <label class="text-sm font-medium text-slate-700">Fecha en que nació el gasto *<span class="block text-xs font-normal text-slate-500 mb-1">Fecha de compra o emisión de la factura.</span><input name="expenseDate" type="date" required value="${today()}" class="w-full border border-slate-300 rounded-lg p-2.5"></label>
      <label class="text-sm font-medium text-slate-700">Fecha límite de pago<span class="block text-xs font-normal text-slate-500 mb-1">Déjala vacía si el gasto no tiene vencimiento.</span><input name="dueDate" type="date" class="w-full border border-slate-300 rounded-lg p-2.5"></label>
      <label class="text-sm font-medium text-slate-700">Enlace al comprobante<span class="block text-xs font-normal text-slate-500 mb-1">URL de la factura o foto guardada en línea.</span><input name="receipt" type="url" class="w-full border border-slate-300 rounded-lg p-2.5" placeholder="https://..."></label>
      <label class="text-sm font-medium text-slate-700">Valor antes de impuestos *<span class="block text-xs font-normal text-slate-500 mb-1">Escribe solo números, sin puntos de miles.</span><input name="subtotal" required type="number" min="0" step="0.01" class="w-full border border-slate-300 rounded-lg p-2.5" placeholder="Ej. 120000"></label>
      <label class="text-sm font-medium text-slate-700">Impuestos incluidos<span class="block text-xs font-normal text-slate-500 mb-1">IVA u otros impuestos; usa 0 si no aplican.</span><input name="tax" type="number" min="0" step="0.01" value="0" class="w-full border border-slate-300 rounded-lg p-2.5"></label>
      <div class="flex items-end"><button class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg px-4 py-3 shadow-sm">Registrar gasto</button></div>
    </form>
    <div class="bg-white border rounded-xl overflow-hidden"><div class="p-4 border-b"><h3 class="font-bold">Obligaciones registradas</h3></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Fecha / vence</th><th class="p-3 text-left">Descripción</th><th class="p-3 text-left">Estado</th><th class="p-3 text-right">Total</th><th class="p-3 text-right">Saldo</th><th class="p-3 text-right">Acciones</th></tr></thead><tbody>${state.expenses.map(expense => {
      const paid = paidByExpense.get(expense.id) || 0;
      const balance = Number(expense.total_amount) - paid;
      const isOverdue = ['pending', 'partial'].includes(expense.status) && expense.due_date && expense.due_date < today();
      return `<tr class="border-t"><td class="p-3 whitespace-nowrap">${escapeHtml(expense.expense_date)}<div class="text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'}">${expense.due_date ? `Vence ${escapeHtml(expense.due_date)}` : 'Sin vencimiento'}${isOverdue ? ' · Vencido' : ''}</div></td><td class="p-3"><div class="font-medium">${escapeHtml(expense.description)}</div><div class="text-xs text-slate-500">${escapeHtml(expense.document_number || 'Sin documento')}</div></td><td class="p-3">${labels[expense.status] || escapeHtml(expense.status)}</td><td class="p-3 text-right">${money(expense.total_amount)}</td><td class="p-3 text-right font-semibold">${money(balance)}</td><td class="p-3 text-right whitespace-nowrap">${expense.status === 'pending_approval' ? `<button data-action="approve" data-id="${expense.id}" class="text-blue-600 mr-2">Aprobar</button>` : ''}${['pending', 'partial'].includes(expense.status) ? `<button data-action="pay" data-id="${expense.id}" data-balance="${balance}" class="text-emerald-600 mr-2">Pagar</button>` : ''}${!['paid', 'cancelled'].includes(expense.status) && paid === 0 ? `<button data-action="cancel" data-id="${expense.id}" class="text-red-600">Cancelar</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="p-6 text-center text-slate-500">Aún no hay gastos registrados.</td></tr>'}</tbody></table></div></div>
    <p id="expense-feedback" class="text-sm"></p>
    <div id="expense-modal" class="hidden fixed inset-0 z-[10000] bg-slate-950/60 backdrop-blur-sm p-4 items-center justify-center" role="dialog" aria-modal="true"><div id="expense-modal-card" class="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"></div></div>
  </section>`;
  bindEvents();
}

function feedback(message, isError = false) {
  const element = root.querySelector('#expense-feedback');
  if (element) { element.textContent = message; element.className = `text-sm ${isError ? 'text-red-600' : 'text-emerald-600'}`; }
}

async function runRpc(name, args, success, scope) {
  const { error } = await supabase.rpc(name, args);
  if (error) return feedback(error.message, true);
  if (scope) completeStableOperation(scope);
  await loadData();
  feedback(success);
}

function closeModal() {
  const modal = root.querySelector('#expense-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  modal.querySelector('#expense-modal-card').innerHTML = '';
}

function showPaymentModal(expenseId, balance) {
  const expense = state.expenses.find(item => item.id === expenseId);
  const modal = root.querySelector('#expense-modal');
  const card = modal.querySelector('#expense-modal-card');
  card.innerHTML = `<form id="payment-form">
    <div class="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-5 text-white"><div class="flex items-start justify-between gap-4"><div><p class="text-xs font-semibold uppercase tracking-wider text-emerald-100">Registrar salida de dinero</p><h3 class="text-xl font-bold mt-1">Pagar cuenta pendiente</h3><p class="text-sm text-emerald-50 mt-1">${escapeHtml(expense?.description || 'Gasto registrado')}</p></div><button type="button" data-close-modal class="text-2xl leading-none text-white/80 hover:text-white" aria-label="Cerrar">×</button></div></div>
    <div class="p-6 space-y-5">
      <div class="rounded-xl bg-amber-50 border border-amber-200 p-4 flex justify-between items-center"><span class="text-sm font-medium text-amber-900">Saldo pendiente actualmente</span><strong class="text-xl text-amber-700">${money(balance)}</strong></div>
      <label class="block text-sm font-semibold text-slate-700">1. ¿Cuánto vas a pagar?<span class="block text-xs font-normal text-slate-500 mt-1 mb-2">Puedes pagar el saldo completo o registrar un abono parcial.</span><div class="relative"><span class="absolute left-3 top-2.5 text-slate-500">$</span><input name="amount" type="number" min="1" max="${balance}" step="0.01" value="${balance}" required class="w-full border border-slate-300 rounded-lg py-2.5 pl-7 pr-3 text-lg font-semibold" aria-describedby="payment-balance-help"></div><span id="payment-balance-help" class="block text-xs text-slate-500 mt-1">Máximo permitido: ${money(balance)}</span></label>
      <label class="block text-sm font-semibold text-slate-700">2. ¿De qué cuenta saldrá el dinero?<span class="block text-xs font-normal text-slate-500 mt-1 mb-2">Selecciona la caja, banco o billetera que realmente se usó.</span><select name="account" required class="w-full border border-slate-300 rounded-lg p-2.5 bg-white">${options(state.accounts, 'Selecciona la cuenta de salida')}</select></label>
      <label class="block text-sm font-semibold text-slate-700">3. ¿Cómo se realizó el pago?<span class="block text-xs font-normal text-slate-500 mt-1 mb-2">Se mostrarán únicamente los métodos asignados a la cuenta elegida.</span><select name="method" required disabled class="w-full border border-slate-300 rounded-lg p-2.5 bg-slate-50"><option value="">Primero selecciona una cuenta</option></select></label>
      <p id="modal-feedback" class="hidden text-sm rounded-lg p-3"></p>
    </div>
    <div class="bg-slate-50 border-t px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2"><button type="button" data-close-modal class="px-5 py-2.5 rounded-lg border border-slate-300 font-semibold text-slate-700 hover:bg-white">Cancelar</button><button type="submit" class="px-5 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 font-semibold text-white shadow-sm">Confirmar pago</button></div>
  </form>`;
  modal.classList.remove('hidden'); modal.classList.add('flex');
  card.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  const form = card.querySelector('#payment-form');
  const accountSelect = form.elements.account;
  const methodSelect = form.elements.method;
  accountSelect.addEventListener('change', () => {
    const methods = state.methods.filter(method => method.financial_account_id === accountSelect.value);
    methodSelect.innerHTML = options(methods, methods.length ? 'Selecciona el método utilizado' : 'Esta cuenta no tiene métodos asignados');
    methodSelect.disabled = methods.length === 0;
    methodSelect.classList.toggle('bg-slate-50', methods.length === 0);
    methodSelect.classList.toggle('bg-white', methods.length > 0);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const data = new FormData(form);
    const amount = Number(data.get('amount'));
    const modalFeedback = card.querySelector('#modal-feedback');
    if (!amount || amount <= 0 || amount > balance) { modalFeedback.textContent = 'El monto debe ser mayor que cero y no puede superar el saldo pendiente.'; modalFeedback.className = 'text-sm rounded-lg p-3 bg-red-50 text-red-700'; return; }
    const payload = { expense: expenseId, account: data.get('account'), method: data.get('method'), amount };
    const scope = buildOperationScope('expense-payment', payload);
    const submit = form.querySelector('[type="submit"]'); submit.disabled = true; submit.textContent = 'Registrando...';
    const { error } = await supabase.rpc('pagar_gasto', { p_expense_id: payload.expense, p_account_id: payload.account, p_metodo_pago_id: payload.method, p_turno_id: null, p_amount: payload.amount, p_client_operation_id: getStableOperationId(scope), p_paid_at: new Date().toISOString() });
    if (error) { modalFeedback.textContent = error.message; modalFeedback.className = 'text-sm rounded-lg p-3 bg-red-50 text-red-700'; submit.disabled = false; submit.textContent = 'Confirmar pago'; return; }
    completeStableOperation(scope); closeModal(); await loadData(); feedback('Pago registrado correctamente.');
  });
}

function showCancelModal(expenseId) {
  const modal = root.querySelector('#expense-modal');
  const card = modal.querySelector('#expense-modal-card');
  card.innerHTML = `<form id="cancel-form"><div class="bg-gradient-to-r from-red-600 to-rose-600 px-6 py-5 text-white"><div class="flex justify-between"><div><p class="text-xs font-semibold uppercase tracking-wider text-red-100">Esta acción quedará registrada</p><h3 class="text-xl font-bold mt-1">Cancelar gasto</h3></div><button type="button" data-close-modal class="text-2xl" aria-label="Cerrar">×</button></div></div><div class="p-6"><label class="block text-sm font-semibold text-slate-700">Motivo de la cancelación *<span class="block text-xs font-normal text-slate-500 mt-1 mb-2">Explica por qué esta obligación ya no debe pagarse.</span><textarea name="reason" required minlength="5" rows="4" class="w-full border border-slate-300 rounded-lg p-3" placeholder="Ej. La factura fue anulada por el proveedor"></textarea></label></div><div class="bg-slate-50 border-t px-6 py-4 flex justify-end gap-2"><button type="button" data-close-modal class="px-5 py-2.5 rounded-lg border font-semibold">Volver</button><button class="px-5 py-2.5 rounded-lg bg-red-600 text-white font-semibold">Confirmar cancelación</button></div></form>`;
  modal.classList.remove('hidden'); modal.classList.add('flex');
  card.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', closeModal));
  card.querySelector('#cancel-form').addEventListener('submit', async event => { event.preventDefault(); const reason = new FormData(event.currentTarget).get('reason'); closeModal(); await runRpc('cancelar_gasto', { p_expense_id: expenseId, p_reason: reason }, 'Gasto cancelado.'); });
}

function bindEvents() {
  root.querySelector('#expense-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = { category: form.get('category'), center: form.get('center'), description: form.get('description'), expenseDate: form.get('expenseDate'), dueDate: form.get('dueDate') || null, subtotal: Number(form.get('subtotal')), tax: Number(form.get('tax') || 0), supplier: form.get('supplier') || null, document: form.get('document') || null, receipt: form.get('receipt') || null };
    const scope = buildOperationScope('expense-create', payload);
    await runRpc('crear_gasto', { p_category_id: payload.category, p_cost_center_id: payload.center, p_description: payload.description, p_expense_date: payload.expenseDate, p_due_date: payload.dueDate, p_subtotal: payload.subtotal, p_tax_amount: payload.tax, p_supplier_id: payload.supplier, p_document_number: payload.document, p_receipt_url: payload.receipt, p_client_operation_id: getStableOperationId(scope) }, 'Gasto registrado.', scope);
  });
  root.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    if (button.dataset.action === 'approve') return runRpc('aprobar_gasto', { p_expense_id: button.dataset.id }, 'Gasto aprobado.');
    if (button.dataset.action === 'cancel') return showCancelModal(button.dataset.id);
    showPaymentModal(button.dataset.id, Number(button.dataset.balance));
  }));
  root.querySelector('#expense-modal')?.addEventListener('click', event => { if (event.target.id === 'expense-modal') closeModal(); });
}

export async function mount(container, supabaseClient, user, currentHotelId) {
  root = container; supabase = supabaseClient; hotelId = currentHotelId;
  if (!['admin', 'administrador'].includes(roleKey(user))) { root.innerHTML = '<p class="p-6 text-red-600">Solo el administrador puede gestionar gastos y cuentas por pagar.</p>'; return; }
  root.innerHTML = '<p class="p-6">Cargando gastos...</p>';
  try { await loadData(); } catch (error) { root.innerHTML = `<p class="p-6 text-red-600">${escapeHtml(error.message)}</p>`; }
}

export function unmount() { if (root) root.innerHTML = ''; root = null; supabase = null; state = { expenses: [], payments: [], categories: [], centers: [], suppliers: [], accounts: [], methods: [] }; }
