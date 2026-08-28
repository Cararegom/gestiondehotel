import { supabase } from './supabaseClient.js';

const FUNCTION_NAME = 'bank-payment-relation-api';
const PANEL_ID = 'bank-reception-relation-panel';
const MODAL_ID = 'bank-reception-relation-modal';
let eligibility = null;
let eligibilityPromise = null;
let injectionBusy = false;
let currentTransfer = null;
let currentMovements = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatCop(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatDate(value) {
  if (!value) return 'Hora no disponible';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Hora no disponible';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function statusLabel(status) {
  const labels = {
    detected: 'Pendiente de relacion',
    matched: 'Relacion existente',
    manual_review: 'Requiere relacion'
  };
  return labels[String(status || '')] || 'Pendiente';
}

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    body: { action, ...payload }
  });
  if (error) {
    let message = error.message || 'No se pudo completar la operacion.';
    try {
      const response = error.context;
      if (response && typeof response.clone === 'function') {
        const body = await response.clone().json();
        if (body?.message) message = body.message;
      }
    } catch {
      // El cliente no siempre expone el cuerpo del error.
    }
    throw new Error(message);
  }
  if (data?.error) throw new Error(data.message || 'La operacion fue rechazada.');
  return data || {};
}

async function canUseRelationFlow() {
  if (eligibility !== null) return eligibility;
  if (eligibilityPromise) return eligibilityPromise;
  eligibilityPromise = (async () => {
    try {
      const data = await invoke('status');
      eligibility = data.eligible === true && data.canRelatePayments === true;
    } catch {
      eligibility = false;
    } finally {
      eligibilityPromise = null;
    }
    return eligibility;
  })();
  return eligibilityPromise;
}

function isCajaRoute() {
  return String(window.location.hash || '').split('?')[0] === '#/caja';
}

async function injectPanel() {
  if (injectionBusy || !isCajaRoute() || document.getElementById(PANEL_ID)) return;
  const caja = document.querySelector('.caja-module');
  if (!caja) return;
  injectionBusy = true;
  try {
    if (!(await canUseRelationFlow()) || !isCajaRoute() || document.getElementById(PANEL_ID)) return;
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'rounded-3xl border border-sky-200 bg-sky-50 p-4 md:p-5 shadow-sm';
    panel.innerHTML = `
      <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-xs uppercase tracking-widest font-semibold text-sky-700">Transferencias</p>
          <h3 class="text-lg font-bold text-slate-900 mt-1">Relacionar pago con Caja</h3>
          <p class="text-sm text-slate-600 mt-1">Selecciona la transferencia y los movimientos que ya registraste. No se muestran datos sensibles del correo bancario.</p>
        </div>
        <button id="bank-reception-open" type="button" class="button bg-sky-600 hover:bg-sky-700 text-white font-bold px-5 py-3 rounded-2xl whitespace-nowrap">
          Relacionar transferencia
        </button>
      </div>`;
    caja.prepend(panel);
    panel.querySelector('#bank-reception-open')?.addEventListener('click', () => openRelationModal());
  } finally {
    injectionBusy = false;
  }
}

function getModalHost() {
  return document.getElementById('modal-container-secondary') || document.body;
}

function closeModal() {
  const host = getModalHost();
  if (host.id === 'modal-container-secondary') {
    host.innerHTML = '';
    host.classList.add('hidden');
  } else {
    document.getElementById(MODAL_ID)?.remove();
  }
  currentTransfer = null;
  currentMovements = [];
}

function mountModalShell() {
  const host = getModalHost();
  const shell = `
    <div id="${MODAL_ID}" class="bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[92vh] overflow-hidden flex flex-col">
      <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
        <div>
          <p class="text-xs uppercase tracking-widest text-sky-600 font-semibold">Caja · relacion bancaria</p>
          <h2 class="text-xl font-bold text-slate-900">Relacionar transferencia</h2>
        </div>
        <button id="bank-reception-close" type="button" class="text-2xl text-slate-500 hover:text-slate-900" aria-label="Cerrar">&times;</button>
      </div>
      <div id="bank-reception-content" class="p-5 overflow-y-auto flex-1">
        <p class="text-center text-slate-500 py-8">Cargando transferencias...</p>
      </div>
    </div>`;
  if (host.id === 'modal-container-secondary') {
    host.innerHTML = shell;
    host.classList.remove('hidden');
  } else {
    const wrapper = document.createElement('div');
    wrapper.className = 'fixed inset-0 bg-black/60 z-[1050] flex items-center justify-center p-4';
    wrapper.innerHTML = shell;
    document.body.appendChild(wrapper);
  }
  document.getElementById('bank-reception-close')?.addEventListener('click', closeModal);
}

function modalContent() {
  return document.getElementById('bank-reception-content');
}

async function openRelationModal() {
  mountModalShell();
  try {
    const data = await invoke('list');
    renderTransferList(Array.isArray(data.transfers) ? data.transfers : []);
  } catch (error) {
    const content = modalContent();
    if (content) content.innerHTML = `<div class="rounded-2xl bg-red-50 border border-red-200 p-4 text-red-700">${escapeHtml(error.message)}</div>`;
  }
}

function renderTransferList(transfers) {
  const content = modalContent();
  if (!content) return;
  if (!transfers.length) {
    content.innerHTML = `
      <div class="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-emerald-800">
        No hay transferencias pendientes para relacionar en este momento.
      </div>`;
    return;
  }
  content.innerHTML = `
    <p class="text-sm text-slate-600 mb-4">Elige el monto que te reporto el cliente. Por seguridad no veras nombre del pagador, referencia ni contenido del correo.</p>
    <div class="space-y-3">
      ${transfers.map((transfer) => `
        <button type="button" data-transfer-id="${escapeHtml(transfer.id)}" class="bank-reception-transfer w-full text-left rounded-2xl border border-slate-200 p-4 hover:border-sky-400 hover:bg-sky-50 transition">
          <div class="flex items-center justify-between gap-3">
            <strong class="text-xl text-slate-900">${formatCop(transfer.amountCop)}</strong>
            <span class="text-xs font-semibold rounded-full bg-amber-100 text-amber-800 px-3 py-1">${escapeHtml(statusLabel(transfer.status))}</span>
          </div>
          <div class="text-sm text-slate-500 mt-2">Recibida: ${escapeHtml(formatDate(transfer.receivedAt))}</div>
        </button>`).join('')}
    </div>`;
  content.querySelectorAll('.bank-reception-transfer').forEach((button) => {
    button.addEventListener('click', () => loadCashCandidates(button.dataset.transferId));
  });
}

async function loadCashCandidates(paymentEventId) {
  const content = modalContent();
  if (!content) return;
  content.innerHTML = '<p class="text-center text-slate-500 py-8">Buscando movimientos de Caja...</p>';
  try {
    const data = await invoke('cash-candidates', { paymentEventId });
    currentTransfer = data.transfer || null;
    currentMovements = Array.isArray(data.movements) ? data.movements : [];
    renderCashCandidates();
  } catch (error) {
    content.innerHTML = `<div class="rounded-2xl bg-red-50 border border-red-200 p-4 text-red-700">${escapeHtml(error.message)}</div>`;
  }
}

function selectedTotal() {
  return [...document.querySelectorAll('.bank-reception-movement:checked')]
    .reduce((sum, input) => sum + Number(input.dataset.amount || 0), 0);
}

function refreshSelectionSummary() {
  const total = selectedTotal();
  const expected = Number(currentTransfer?.amountCop || 0);
  const totalEl = document.getElementById('bank-reception-selected-total');
  const pendingEl = document.getElementById('bank-reception-selected-pending');
  const submit = document.getElementById('bank-reception-submit');
  if (totalEl) totalEl.textContent = formatCop(total);
  if (pendingEl) {
    const difference = expected - total;
    pendingEl.textContent = difference === 0 ? 'Cuadra exactamente' : `Faltan ${formatCop(difference)}`;
    pendingEl.className = `text-sm font-semibold ${difference === 0 ? 'text-emerald-700' : difference < 0 ? 'text-red-700' : 'text-amber-700'}`;
  }
  if (submit) submit.disabled = total !== expected || total <= 0;
}

function renderCashCandidates() {
  const content = modalContent();
  if (!content || !currentTransfer) return;
  content.innerHTML = `
    <button id="bank-reception-back" type="button" class="text-sm text-sky-700 font-semibold mb-4">&larr; Cambiar transferencia</button>
    <div class="rounded-2xl bg-slate-900 text-white p-4 mb-4">
      <span class="text-xs uppercase tracking-widest text-slate-300">Transferencia a relacionar</span>
      <div class="text-2xl font-bold mt-1">${formatCop(currentTransfer.amountCop)}</div>
      <div class="text-sm text-slate-300 mt-1">${escapeHtml(formatDate(currentTransfer.receivedAt))}</div>
    </div>
    <p class="text-sm text-slate-600 mb-3">Marca los movimientos de Caja que componen exactamente ese valor.</p>
    <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
      ${currentMovements.length ? currentMovements.map((movement) => `
        <label class="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 cursor-pointer hover:bg-slate-50">
          <input type="checkbox" class="bank-reception-movement mt-1 h-5 w-5" value="${escapeHtml(movement.id)}" data-amount="${Number(movement.amountCop || 0)}">
          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center justify-between gap-2">
              <strong class="text-slate-900">${formatCop(movement.amountCop)}</strong>
              <span class="text-xs rounded-full bg-slate-100 px-2 py-1 text-slate-600">${escapeHtml(movement.targetType || 'Caja')}</span>
            </span>
            <span class="block text-sm text-slate-700 mt-1">${escapeHtml(movement.concept || 'Movimiento de Caja')}</span>
            <span class="block text-xs text-slate-400 mt-1">${escapeHtml(formatDate(movement.occurredAt))}</span>
          </span>
        </label>`).join('') : '<div class="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-amber-800">No encontre movimientos bancarios de Caja cercanos a esta transferencia.</div>'}
    </div>
    <div class="grid grid-cols-2 gap-3 mt-4">
      <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3">
        <span class="text-xs uppercase text-slate-500">Seleccionado</span>
        <strong id="bank-reception-selected-total" class="block text-lg mt-1">${formatCop(0)}</strong>
      </div>
      <div class="rounded-2xl bg-slate-50 border border-slate-200 p-3">
        <span class="text-xs uppercase text-slate-500">Resultado</span>
        <span id="bank-reception-selected-pending" class="block text-sm font-semibold text-amber-700 mt-2">Faltan ${formatCop(currentTransfer.amountCop)}</span>
      </div>
    </div>
    <label class="block mt-4">
      <span class="text-sm font-semibold text-slate-700">Motivo de la relacion</span>
      <input id="bank-reception-reason" type="text" maxlength="500" class="mt-2 w-full rounded-xl border border-slate-300 px-3 py-3" placeholder="Ej: Cliente indico que pago habitacion y tienda">
    </label>
    <button id="bank-reception-submit" type="button" disabled class="mt-4 w-full button bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold py-3 rounded-2xl">Guardar relacion</button>
    <p class="text-xs text-slate-500 mt-3">Relacionar no confirma manualmente el banco y no crea un nuevo ingreso en Caja.</p>`;

  document.getElementById('bank-reception-back')?.addEventListener('click', openRelationModal);
  content.querySelectorAll('.bank-reception-movement').forEach((input) => input.addEventListener('change', refreshSelectionSummary));
  document.getElementById('bank-reception-submit')?.addEventListener('click', submitRelation);
  refreshSelectionSummary();
}

async function submitRelation() {
  const button = document.getElementById('bank-reception-submit');
  if (!button || !currentTransfer) return;
  const movementIds = [...document.querySelectorAll('.bank-reception-movement:checked')].map((input) => input.value);
  const reason = String(document.getElementById('bank-reception-reason')?.value || '').trim();
  if (!reason) {
    alert('Escribe el motivo de la relacion.');
    return;
  }
  button.disabled = true;
  button.textContent = 'Guardando...';
  try {
    await invoke('relate', {
      paymentEventId: currentTransfer.id,
      movementIds,
      reason
    });
    const content = modalContent();
    if (content) {
      content.innerHTML = `
        <div class="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 text-emerald-800">
          <strong class="block text-lg">Relacion guardada</strong>
          <span class="block mt-1">La transferencia de ${formatCop(currentTransfer.amountCop)} quedo distribuida entre los movimientos seleccionados.</span>
        </div>
        <button id="bank-reception-done" class="mt-4 w-full button bg-slate-900 text-white font-bold py-3 rounded-2xl">Cerrar</button>`;
      document.getElementById('bank-reception-done')?.addEventListener('click', () => {
        closeModal();
        window.location.reload();
      });
    }
  } catch (error) {
    alert(error.message || 'No se pudo guardar la relacion.');
    button.disabled = false;
    button.textContent = 'Guardar relacion';
  }
}

function scheduleInjection() {
  window.setTimeout(() => injectPanel(), 120);
}

window.addEventListener('hashchange', () => {
  if (!isCajaRoute()) {
    document.getElementById(PANEL_ID)?.remove();
    return;
  }
  scheduleInjection();
});

const observer = new MutationObserver(() => {
  if (isCajaRoute() && !document.getElementById(PANEL_ID)) scheduleInjection();
});
observer.observe(document.body, { childList: true, subtree: true });

scheduleInjection();
