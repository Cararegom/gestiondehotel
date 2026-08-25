import { escapeHtml } from '../../security.js';
import { buildOperationScope, completeStableOperation, getStableOperationId } from '../../services/fase1OperationService.js';

let root;
let supabase;
let hotelId;
let accounts = [];

const money = (value) => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(value||0));
const roleKey = (user) => String(user?.role || user?.rol || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();

async function loadData() {
  const [{ data: summary, error: summaryError }, { data: movements, error: movementError }, { data: methods }] = await Promise.all([
    supabase.rpc('resumen_cuentas_financieras'),
    supabase.from('account_movements').select('id,direction,amount,occurred_at,description,source,account_id').eq('hotel_id',hotelId).order('occurred_at',{ascending:false}).limit(100),
    supabase.from('metodos_pago').select('id,nombre,financial_account_id').eq('hotel_id',hotelId).eq('activo',true).order('nombre')
  ]);
  if (summaryError) throw summaryError;
  if (movementError) throw movementError;
  accounts = summary?.accounts || [];
  render(summary, movements || [], methods || []);
}

function accountOptions(selected='') {
  return accounts.filter(a=>a.active).map(a=>`<option value="${a.id}" ${a.id===selected?'selected':''}>${escapeHtml(a.name)} — ${money(a.balance)}</option>`).join('');
}

function render(summary, movements, methods) {
  const names = new Map(accounts.map(a=>[a.id,a.name]));
  root.innerHTML = `<section class="p-4 md:p-6 space-y-5">
    <div><h2 class="text-2xl font-bold text-slate-800">Cuentas y movimientos</h2><p class="text-sm text-slate-500">Fase 2 en modo paralelo. Los saldos incluyen únicamente movimientos desde la activación de cada cuenta.</p></div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-3">${accounts.map(a=>`<article class="bg-white border rounded-xl p-4 shadow-sm"><div class="text-xs uppercase text-slate-500">${escapeHtml(a.account_type)}</div><div class="font-semibold text-slate-800">${escapeHtml(a.name)}</div><div class="text-2xl font-bold ${Number(a.balance)<0?'text-red-600':'text-emerald-600'}">${money(a.balance)}</div></article>`).join('') || '<p class="text-slate-500">Las cuentas se crearán al registrar el próximo movimiento o manualmente aquí.</p>'}</div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <form id="create-account" class="bg-white border rounded-xl p-4 space-y-3"><h3 class="font-bold">Crear cuenta</h3><input name="name" required class="w-full border rounded p-2" placeholder="Ej. Bancolombia Hotel"><select name="type" class="w-full border rounded p-2"><option value="cash">Efectivo</option><option value="bank">Banco</option><option value="wallet">Billetera/Tarjeta</option><option value="clearing">Cuenta transitoria</option></select><input name="lastFour" class="w-full border rounded p-2" maxlength="4" pattern="[0-9]{4}" placeholder="Últimos 4 dígitos (opcional)"><input name="opening" type="number" step="0.01" class="w-full border rounded p-2" value="0" placeholder="Saldo inicial"><button class="bg-blue-600 text-white rounded px-4 py-2">Crear cuenta</button></form>
      <form id="transfer-account" class="bg-white border rounded-xl p-4 space-y-3"><h3 class="font-bold">Transferir entre cuentas</h3><select name="from" required class="w-full border rounded p-2"><option value="">Cuenta origen</option>${accountOptions()}</select><select name="to" required class="w-full border rounded p-2"><option value="">Cuenta destino</option>${accountOptions()}</select><input name="amount" required type="number" min="1" step="0.01" class="w-full border rounded p-2" placeholder="Monto"><input name="description" required class="w-full border rounded p-2" placeholder="Motivo"><button class="bg-emerald-600 text-white rounded px-4 py-2">Registrar transferencia</button></form>
    </div>
    <div class="bg-white border rounded-xl p-4"><h3 class="font-bold mb-3">Asignación de métodos de pago</h3><div class="space-y-2">${methods.map(m=>`<div class="flex gap-2 items-center"><span class="flex-1">${escapeHtml(m.nombre)}</span><select class="method-account border rounded p-2" data-method="${m.id}"><option value="">Sin asignar</option>${accountOptions(m.financial_account_id)}</select></div>`).join('')}</div></div>
    <div class="bg-white border rounded-xl overflow-hidden"><div class="p-4 border-b flex justify-between"><h3 class="font-bold">Últimos movimientos</h3><span class="text-sm ${summary?.caja_without_ledger?'text-red-600':'text-emerald-600'}">Caja sin ledger: ${summary?.caja_without_ledger||0}</span></div><div class="overflow-x-auto"><table class="min-w-full text-sm"><thead class="bg-slate-50"><tr><th class="p-3 text-left">Fecha</th><th class="p-3 text-left">Cuenta</th><th class="p-3 text-left">Concepto</th><th class="p-3 text-right">Movimiento</th></tr></thead><tbody>${movements.map(m=>`<tr class="border-t"><td class="p-3">${new Date(m.occurred_at).toLocaleString('es-CO')}</td><td class="p-3">${escapeHtml(names.get(m.account_id)||'Cuenta')}</td><td class="p-3">${escapeHtml(m.description)}</td><td class="p-3 text-right font-semibold ${m.direction==='in'?'text-emerald-600':'text-red-600'}">${m.direction==='in'?'+':'-'}${money(m.amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="p-6 text-center text-slate-500">Sin movimientos shadow todavía.</td></tr>'}</tbody></table></div></div>
    <p id="finance-feedback" class="text-sm"></p>
  </section>`;
  bindEvents();
}

function feedback(message,error=false){const el=root.querySelector('#finance-feedback');if(el){el.textContent=message;el.className=`text-sm ${error?'text-red-600':'text-emerald-600'}`;}}
function bindEvents(){
  root.querySelector('#create-account')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const {error}=await supabase.rpc('crear_cuenta_financiera',{p_name:f.get('name'),p_account_type:f.get('type'),p_last_four:f.get('lastFour')||null,p_opening_balance:Number(f.get('opening')||0)});if(error)return feedback(error.message,true);await loadData();feedback('Cuenta creada.');});
  root.querySelector('#transfer-account')?.addEventListener('submit',async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);if(f.get('from')===f.get('to'))return feedback('Las cuentas deben ser diferentes.',true);const payload={from:f.get('from'),to:f.get('to'),amount:Number(f.get('amount')),description:f.get('description')};const scope=buildOperationScope('account-transfer',payload);const {error}=await supabase.rpc('crear_transferencia_cuenta',{p_from_account_id:payload.from,p_to_account_id:payload.to,p_amount:payload.amount,p_description:payload.description,p_client_operation_id:getStableOperationId(scope),p_occurred_at:new Date().toISOString()});if(error)return feedback(error.message,true);completeStableOperation(scope);await loadData();feedback('Transferencia registrada.');});
  root.querySelectorAll('.method-account').forEach(el=>el.addEventListener('change',async()=>{if(!el.value)return;const {error}=await supabase.rpc('asignar_metodo_cuenta',{p_metodo_id:el.dataset.method,p_account_id:el.value});feedback(error?error.message:'Método asignado.',Boolean(error));}));
}

export async function mount(container,supabaseClient,user,currentHotelId){root=container;supabase=supabaseClient;hotelId=currentHotelId;if(!['admin','administrador'].includes(roleKey(user))){root.innerHTML='<p class="p-6 text-red-600">Solo el administrador puede gestionar cuentas financieras.</p>';return;}root.innerHTML='<p class="p-6">Cargando cuentas...</p>';try{await loadData();}catch(error){root.innerHTML=`<p class="p-6 text-red-600">${escapeHtml(error.message)}</p>`;}}
export function unmount(){if(root)root.innerHTML='';root=null;supabase=null;accounts=[];}
