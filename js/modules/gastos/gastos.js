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
    <form id="expense-form" class="bg-white border rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
      <h3 class="font-bold md:col-span-3">Registrar gasto</h3>
      <select name="category" required class="border rounded p-2">${options(state.categories, 'Categoría')}</select><select name="center" required class="border rounded p-2">${options(state.centers, 'Centro de costo')}</select><select name="supplier" class="border rounded p-2">${options(state.suppliers, 'Proveedor (opcional)')}</select>
      <input name="description" required class="border rounded p-2 md:col-span-2" placeholder="Descripción"><input name="document" class="border rounded p-2" placeholder="Factura o soporte">
      <label class="text-sm">Fecha del gasto<input name="expenseDate" type="date" required value="${today()}" class="block w-full border rounded p-2"></label><label class="text-sm">Vencimiento<input name="dueDate" type="date" class="block w-full border rounded p-2"></label><input name="receipt" type="url" class="border rounded p-2 self-end" placeholder="Enlace del soporte (opcional)">
      <input name="subtotal" required type="number" min="0" step="0.01" class="border rounded p-2" placeholder="Subtotal"><input name="tax" type="number" min="0" step="0.01" value="0" class="border rounded p-2" placeholder="Impuestos"><button class="bg-blue-600 text-white rounded px-4 py-2">Registrar gasto</button>
    </form>
    <div class="bg-white border rounded-xl overflow-hidden"><div class="p-4 border-b"><h3 class="font-bold">Obligaciones registradas</h3></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Fecha / vence</th><th class="p-3 text-left">Descripción</th><th class="p-3 text-left">Estado</th><th class="p-3 text-right">Total</th><th class="p-3 text-right">Saldo</th><th class="p-3 text-right">Acciones</th></tr></thead><tbody>${state.expenses.map(expense => {
      const paid = paidByExpense.get(expense.id) || 0;
      const balance = Number(expense.total_amount) - paid;
      const isOverdue = ['pending', 'partial'].includes(expense.status) && expense.due_date && expense.due_date < today();
      return `<tr class="border-t"><td class="p-3 whitespace-nowrap">${escapeHtml(expense.expense_date)}<div class="text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-500'}">${expense.due_date ? `Vence ${escapeHtml(expense.due_date)}` : 'Sin vencimiento'}${isOverdue ? ' · Vencido' : ''}</div></td><td class="p-3"><div class="font-medium">${escapeHtml(expense.description)}</div><div class="text-xs text-slate-500">${escapeHtml(expense.document_number || 'Sin documento')}</div></td><td class="p-3">${labels[expense.status] || escapeHtml(expense.status)}</td><td class="p-3 text-right">${money(expense.total_amount)}</td><td class="p-3 text-right font-semibold">${money(balance)}</td><td class="p-3 text-right whitespace-nowrap">${expense.status === 'pending_approval' ? `<button data-action="approve" data-id="${expense.id}" class="text-blue-600 mr-2">Aprobar</button>` : ''}${['pending', 'partial'].includes(expense.status) ? `<button data-action="pay" data-id="${expense.id}" data-balance="${balance}" class="text-emerald-600 mr-2">Pagar</button>` : ''}${!['paid', 'cancelled'].includes(expense.status) && paid === 0 ? `<button data-action="cancel" data-id="${expense.id}" class="text-red-600">Cancelar</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="p-6 text-center text-slate-500">Aún no hay gastos registrados.</td></tr>'}</tbody></table></div></div>
    <p id="expense-feedback" class="text-sm"></p>
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
    if (button.dataset.action === 'cancel') {
      const reason = window.prompt('Motivo de cancelación:');
      if (reason) await runRpc('cancelar_gasto', { p_expense_id: button.dataset.id, p_reason: reason }, 'Gasto cancelado.');
      return;
    }
    const amount = Number(window.prompt(`Monto a pagar (saldo ${money(button.dataset.balance)}):`, button.dataset.balance));
    if (!amount || amount <= 0 || amount > Number(button.dataset.balance)) return feedback('Monto de pago inválido.', true);
    const accountList = state.accounts.map((account, index) => `${index + 1}. ${account.name}`).join('\n');
    const accountIndex = Number(window.prompt(`Selecciona la cuenta:\n${accountList}`)) - 1;
    const account = state.accounts[accountIndex];
    if (!account) return feedback('Cuenta inválida.', true);
    const methods = state.methods.filter(method => method.financial_account_id === account.id);
    const methodList = methods.map((method, index) => `${index + 1}. ${method.nombre}`).join('\n');
    const method = methods[Number(window.prompt(`Selecciona el método:\n${methodList}`)) - 1];
    if (!method) return feedback('La cuenta no tiene un método de pago seleccionado.', true);
    const payload = { expense: button.dataset.id, account: account.id, method: method.id, amount };
    const scope = buildOperationScope('expense-payment', payload);
    await runRpc('pagar_gasto', { p_expense_id: payload.expense, p_account_id: payload.account, p_metodo_pago_id: payload.method, p_turno_id: null, p_amount: payload.amount, p_client_operation_id: getStableOperationId(scope), p_paid_at: new Date().toISOString() }, 'Pago registrado.', scope);
  }));
}

export async function mount(container, supabaseClient, user, currentHotelId) {
  root = container; supabase = supabaseClient; hotelId = currentHotelId;
  if (!['admin', 'administrador'].includes(roleKey(user))) { root.innerHTML = '<p class="p-6 text-red-600">Solo el administrador puede gestionar gastos y cuentas por pagar.</p>'; return; }
  root.innerHTML = '<p class="p-6">Cargando gastos...</p>';
  try { await loadData(); } catch (error) { root.innerHTML = `<p class="p-6 text-red-600">${escapeHtml(error.message)}</p>`; }
}

export function unmount() { if (root) root.innerHTML = ''; root = null; supabase = null; state = { expenses: [], payments: [], categories: [], centers: [], suppliers: [], accounts: [], methods: [] }; }
