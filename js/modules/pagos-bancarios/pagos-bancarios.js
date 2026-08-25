import { escapeAttribute, escapeHtml } from '../../security.js';
import {
  renderMetricCard,
  renderMetricGrid,
  renderPageHero,
  renderSectionCard
} from '../../services/appUiKit.js';
import {
  BANK_PAYMENT_STATUSES,
  createBankExpectedPayment,
  getBankExpectedPaymentOptions,
  getBankPaymentCandidates,
  getBankPaymentDetail,
  getBankPaymentPilotStatus,
  isUuid,
  listBankPaymentEvents,
  simulateBankPaymentEmail,
  submitBankPaymentManualAction,
  subscribeToBankPaymentEvents
} from '../../services/bankPaymentService.js';
import { formatCurrency, formatDateTime, showAppFeedback } from '../../uiUtils.js';

const STATUS_META = Object.freeze({
  detected: { label: 'Pago recibido sin asociar', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  matched: { label: 'Asociado, pendiente de confirmar', className: 'border-violet-200 bg-violet-50 text-violet-700' },
  confirmed: { label: 'Conciliado', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  manual_review: { label: 'Revision manual', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  rejected: { label: 'Rechazado', className: 'border-red-200 bg-red-50 text-red-700' },
  duplicated: { label: 'Duplicado', className: 'border-slate-200 bg-slate-100 text-slate-700' }
});
const EVENT_PAGE_SIZE = 100;
const BANK_FIRST_WORKFLOW = true;

function createState() {
  return {
    container: null,
    supabase: null,
    user: null,
    hotelId: null,
    pilotStatus: null,
    events: [],
    hasMoreEvents: false,
    nextEventsOffset: 0,
    listeners: [],
    modalListeners: [],
    subscription: null,
    refreshTimer: null,
    liveRefreshInterval: null,
    requestSequence: 0,
    currentDetailId: null,
    mounted: false
  };
}

let state = createState();

function addListener(element, type, handler, options) {
  if (!element) return;
  element.addEventListener(type, handler, options);
  state.listeners.push({ element, type, handler, options });
}

function cleanupListeners() {
  state.listeners.forEach(({ element, type, handler, options }) => {
    element?.removeEventListener(type, handler, options);
  });
  state.listeners = [];
}

function addModalListener(element, type, handler, options) {
  if (!element) return;
  element.addEventListener(type, handler, options);
  state.modalListeners.push({ element, type, handler, options });
}

function cleanupModalListeners() {
  state.modalListeners.forEach(({ element, type, handler, options }) => {
    element?.removeEventListener(type, handler, options);
  });
  state.modalListeners = [];
}

function firstValue(source, keys, fallback = null) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return fallback;
}

function eventAmount(event) {
  const value = Number(firstValue(event, ['amount_cop', 'amountCop', 'monto', 'amount'], 0));
  return Number.isFinite(value) ? Math.trunc(value) : 0;
}

function eventDate(event) {
  return firstValue(event, ['email_received_at', 'received_at', 'detected_at', 'created_at', 'creado_en']);
}

function eventReference(event) {
  return String(firstValue(event, ['transaction_reference_masked', 'transaction_reference', 'reference', 'referencia'], '') || '').trim();
}

function maskReference(value) {
  const reference = String(value || '').replace(/\s+/g, '').trim();
  if (!reference) return 'No disponible';
  if (/^[*\u2022]+[^*\u2022]{1,4}$/u.test(reference)) return reference;
  if (reference.length <= 4) return `••••${reference}`;
  return `••••${reference.slice(-4)}`;
}

function shortId(value) {
  const text = String(value || '');
  return text ? text.slice(0, 8) : '';
}

function getStatusMeta(status) {
  return STATUS_META[status] || { label: status || 'Sin estado', className: 'border-slate-200 bg-slate-50 text-slate-700' };
}

function formatCop(value) {
  return formatCurrency(Number(value) || 0, '$', 'COP', 0);
}

function getReservationLabel(event) {
  const relation = event?.matched_reservation || event?.reservation || event?.reservas || null;
  const reservationId = firstValue(event, ['matched_reservation_id', 'reservation_id']) || relation?.id;
  if (!reservationId) return 'Sin reserva';
  const client = firstValue(relation, ['cliente_nombre', 'guest_name', 'nombre_cliente']);
  return client ? `${client} · #${shortId(reservationId)}` : `Reserva #${shortId(reservationId)}`;
}

function getRoomLabel(event) {
  const relation = event?.matched_room || event?.room || event?.habitaciones || null;
  const roomId = firstValue(event, ['matched_room_id', 'room_id']) || relation?.id;
  const name = firstValue(relation, ['nombre', 'name']) || firstValue(event, ['room_name', 'habitacion_nombre']);
  if (name) return `Habitacion ${name}`;
  return roomId ? `Habitacion #${shortId(roomId)}` : 'Sin habitacion';
}

function getConfirmedByLabel(event) {
  const actor = event?.confirmed_by_user || event?.reviewed_by_user || event?.usuarios || null;
  return firstValue(actor, ['nombre', 'name', 'correo', 'email']) || firstValue(event, ['confirmed_by_name', 'reviewed_by_name']) || '—';
}

function isTestEvent(event) {
  return event?.metadata?.is_test === true || event?.is_test === true;
}

function renderStatusBadge(status) {
  const meta = getStatusMeta(status);
  return `<span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${meta.className}">${escapeHtml(meta.label)}</span>`;
}

function showModuleFeedback(message, type = 'info') {
  const element = state.container?.querySelector('#bank-payments-feedback');
  if (!element) return;
  const classes = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
    info: 'border-blue-200 bg-blue-50 text-blue-700'
  };
  element.textContent = message;
  element.className = `rounded-2xl border px-4 py-3 text-sm ${classes[type] || classes.info}`;
  element.style.display = 'block';
}

function clearModuleFeedback() {
  const element = state.container?.querySelector('#bank-payments-feedback');
  if (!element) return;
  element.textContent = '';
  element.style.display = 'none';
}

function renderMetrics() {
  const container = state.container?.querySelector('#bank-payments-metrics');
  if (!container) return;
  const count = (status) => state.events.filter((event) => event.status === status).length;
  const total = state.events.reduce((sum, event) => sum + eventAmount(event), 0);

  container.innerHTML = renderMetricGrid([
    renderMetricCard({ label: 'Recibidos sin asociar', value: count('detected'), helper: 'Esperan el registro en el sistema', tone: 'blue', icon: 'IN' }),
    renderMetricCard({ label: 'Revision manual', value: count('manual_review'), helper: 'Requieren una decision', tone: 'amber', icon: '!' }),
    renderMetricCard({ label: 'Conciliados', value: count('confirmed'), helper: 'Pago y registro validados', tone: 'emerald', icon: 'OK' }),
    renderMetricCard({ label: 'Rechazados', value: count('rejected'), helper: 'Descartados por revision', tone: 'rose', icon: 'X' }),
    renderMetricCard({
      label: 'Monto listado',
      value: formatCop(total),
      helper: `${state.events.length} movimientos cargados${state.hasMoreEvents ? ' · hay mas' : ''}`,
      tone: 'violet',
      icon: 'COP'
    })
  ], 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-5');
}

function renderEventsTable() {
  const listElement = state.container?.querySelector('#bank-payments-list');
  if (!listElement) return;

  if (!state.events.length) {
    listElement.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <p class="text-lg font-bold text-slate-800">No hay pagos para estos filtros</p>
        <p class="mt-2 text-sm text-slate-500">Los correos validos apareceran aqui sin mostrar su contenido completo.</p>
      </div>
    `;
    renderMetrics();
    return;
  }

  listElement.innerHTML = `
    <div class="overflow-x-auto">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Monto</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Banco</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Pagador</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Recibido</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Referencia</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Estado</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Relacion</th>
            <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Confirmo</th>
            <th class="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">Accion</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 bg-white">
          ${state.events.map((event) => {
            const validId = isUuid(event.id);
            return `
              <tr class="hover:bg-slate-50">
                <td class="whitespace-nowrap px-4 py-4 font-bold text-slate-900">${escapeHtml(formatCop(eventAmount(event)))}</td>
                <td class="px-4 py-4 text-slate-700">
                  <span class="block">${escapeHtml(firstValue(event, ['bank_name', 'bankName'], 'No identificado'))}</span>
                  ${isTestEvent(event) ? '<span class="mt-1 inline-flex rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-fuchsia-700">Prueba</span>' : ''}
                </td>
                <td class="px-4 py-4 text-slate-700">${escapeHtml(firstValue(event, ['sender_name', 'payer_name'], 'No disponible'))}</td>
                <td class="whitespace-nowrap px-4 py-4 text-slate-600">${escapeHtml(formatDateTime(eventDate(event)))}</td>
                <td class="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-600">${escapeHtml(maskReference(eventReference(event)))}</td>
                <td class="px-4 py-4">${renderStatusBadge(event.status)}</td>
                <td class="px-4 py-4 text-slate-600">
                  <span class="block">${escapeHtml(getReservationLabel(event))}</span>
                  <span class="mt-1 block text-xs text-slate-400">${escapeHtml(getRoomLabel(event))}</span>
                </td>
                <td class="px-4 py-4 text-slate-600">${escapeHtml(getConfirmedByLabel(event))}</td>
                <td class="px-4 py-4 text-right">
                  <button type="button" class="bank-payment-detail button button-primary px-3 py-2 text-xs" data-payment-event-id="${validId ? escapeAttribute(event.id) : ''}" ${validId ? '' : 'disabled'}>Ver detalles</button>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${state.hasMoreEvents ? `
      <div class="border-t border-slate-200 bg-slate-50 px-4 py-4 text-center">
        <button type="button" id="bank-payments-load-more" class="button button-neutral">Cargar más transferencias</button>
      </div>
    ` : ''}
  `;
  renderMetrics();
}

function renderShell() {
  const hero = renderPageHero({
    eyebrow: 'Fase 6 · Piloto Marena San Isidro',
    title: 'Conciliación bancaria',
    description: 'Primero se recibe el pago y luego la recepcionista registra la reserva o venta. Aquí el administrador asocia ambos registros para comprobar que correspondan.',
    badges: ['Solo administradores', 'No duplica ingresos en Caja', 'Revisión humana ante ambigüedad'],
    actions: [
      { id: 'bank-payments-refresh', label: 'Actualizar', className: 'button button-neutral app-touch-button' }
    ]
  });

  const filters = renderSectionCard({
    eyebrow: 'Busqueda',
    title: 'Filtrar movimientos',
    description: 'Limita la vista por estado y fecha de recepcion.',
    body: `
      <form id="bank-payments-filters" class="grid gap-4 md:grid-cols-3">
        <div>
          <label for="bank-payment-status" class="form-label">Estado</label>
          <select id="bank-payment-status" name="status" class="form-control">
            <option value="">Todos</option>
            ${BANK_PAYMENT_STATUSES.map((status) => `<option value="${escapeAttribute(status)}">${escapeHtml(getStatusMeta(status).label)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="bank-payment-date-from" class="form-label">Desde</label>
          <input id="bank-payment-date-from" name="dateFrom" type="date" class="form-control">
        </div>
        <div>
          <label for="bank-payment-date-to" class="form-label">Hasta</label>
          <input id="bank-payment-date-to" name="dateTo" type="date" class="form-control">
        </div>
        <div class="flex flex-wrap gap-3 md:col-span-3">
          <button type="submit" class="button button-primary">Aplicar filtros</button>
          <button type="button" id="bank-payments-clear-filters" class="button button-neutral">Limpiar</button>
        </div>
      </form>
    `
  });

  const simulation = state.pilotStatus?.isAdmin
    ? renderSectionCard({
        eyebrow: 'Desarrollo / administracion',
        title: 'Simular correo bancario',
        description: 'Prueba el parser sin Gmail. Guardar crea un evento identificado con metadata.is_test = true.',
        body: `
          <form id="bank-payment-simulator" class="space-y-4">
            <div class="grid gap-4 md:grid-cols-2">
              <div>
                <label for="bank-sim-subject" class="form-label">Asunto</label>
                <input id="bank-sim-subject" name="subject" class="form-control" maxlength="500" required placeholder="Transferencia recibida exitosamente">
              </div>
              <div>
                <label for="bank-sim-from" class="form-label">From (opcional)</label>
                <input id="bank-sim-from" name="from" class="form-control" maxlength="320" placeholder="notificaciones@banco.example">
              </div>
            </div>
            <div>
              <label for="bank-sim-body" class="form-label">Contenido</label>
              <textarea id="bank-sim-body" name="body" class="form-control" rows="6" maxlength="100000" required placeholder="Recibiste una transferencia por llave de $80.000. Referencia 123456."></textarea>
            </div>
            <details class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary class="cursor-pointer font-semibold text-slate-700">Cabeceras tecnicas opcionales</summary>
              <div class="mt-4 grid gap-4 md:grid-cols-2">
                <div><label class="form-label">Return-Path</label><input name="returnPath" class="form-control" maxlength="320"></div>
                <div><label class="form-label">Fecha recibida</label><input name="receivedAt" type="datetime-local" class="form-control"></div>
                <div class="md:col-span-2"><label class="form-label">Authentication-Results</label><textarea name="authenticationResults" class="form-control" rows="3" maxlength="4000"></textarea></div>
              </div>
            </details>
            <div class="flex flex-wrap gap-3">
              <button type="submit" data-simulation-save="false" class="button button-primary">Analizar sin guardar</button>
              <button type="submit" data-simulation-save="true" class="button button-success">Guardar evento de prueba</button>
            </div>
          </form>
          <div id="bank-simulation-result" class="mt-5" aria-live="polite"></div>
        `
      })
    : '';

  const expectedPaymentSetup = !BANK_FIRST_WORKFLOW && state.pilotStatus?.isAdmin
    ? renderSectionCard({
        eyebrow: 'Preparar cobro',
        title: 'Crear pago esperado para una reserva',
        description: 'Crea una intencion temporal. No registra dinero en Caja ni marca la reserva como pagada.',
        body: `
          <form id="bank-expected-payment-form" class="grid gap-4 md:grid-cols-2">
            <div class="md:col-span-2">
              <label for="bank-expected-reservation" class="form-label">Reserva activa</label>
              <select id="bank-expected-reservation" name="reservationId" class="form-control" required>
                <option value="">Selecciona una reserva...</option>
                ${renderCandidateOptions(state.expectedOptions.reservations, reservationCandidateLabel)}
              </select>
            </div>
            <div>
              <label for="bank-expected-amount" class="form-label">Monto esperado (COP)</label>
              <input id="bank-expected-amount" name="amountCop" type="number" min="1" max="100000000" step="1" class="form-control" required placeholder="80000">
            </div>
            <div>
              <label for="bank-expected-method" class="form-label">Metodo</label>
              <select id="bank-expected-method" name="paymentMethod" class="form-control" required>
                <option value="llave">Llave</option>
                <option value="transferencia">Transferencia</option>
              </select>
            </div>
            <div>
              <label for="bank-expected-expiration" class="form-label">Vigencia</label>
              <select id="bank-expected-expiration" name="expiresMinutes" class="form-control">
                <option value="30">30 minutos</option>
                <option value="60">1 hora</option>
                <option value="120">2 horas</option>
              </select>
            </div>
            <div class="flex items-end">
              <button type="submit" class="button button-success w-full">Crear pago esperado</button>
            </div>
          </form>
          <div id="bank-expected-payment-feedback" class="mt-4 text-sm" aria-live="polite"></div>
        `
      })
    : '';

  state.container.innerHTML = `
    <div class="space-y-6">
      ${hero}
      <div id="bank-payments-feedback" style="display:none;" role="alert"></div>
      <div id="bank-payments-metrics"></div>
      ${filters}
      ${expectedPaymentSetup}
      <div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
        <strong>Flujo del hotel:</strong> el pago bancario aparece primero como recibido sin asociar. Después de que la recepcionista registre la operación, el administrador abre el pago, selecciona esa reserva o venta y lo confirma. Esta acción no crea cobros ni movimientos adicionales en Caja.
      </div>
      <section class="app-section-card">
        <div class="app-section-card__header">
          <div>
            <p class="app-section-card__eyebrow">Movimientos</p>
            <h2 class="app-section-card__title">Pagos detectados</h2>
            <p class="app-section-card__description">La referencia y cualquier dato bancario se muestran de forma parcial.</p>
          </div>
        </div>
        <div id="bank-payments-list" class="app-section-card__body">
          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">Cargando movimientos...</div>
        </div>
      </section>
      ${simulation}
    </div>
  `;
}

async function handleExpectedPaymentSubmit(event) {
  event.preventDefault();
  if (!state.mounted || !state.pilotStatus?.isAdmin) return;
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const feedback = state.container?.querySelector('#bank-expected-payment-feedback');
  const formData = new FormData(form);
  const operationSignature = JSON.stringify({
    reservationId: formData.get('reservationId'),
    amountCop: Number(formData.get('amountCop')),
    paymentMethod: formData.get('paymentMethod'),
    expiresMinutes: Number(formData.get('expiresMinutes'))
  });
  if (state.expectedOperation?.signature !== operationSignature) {
    state.expectedOperation = { id: crypto.randomUUID(), signature: operationSignature };
  }
  if (button) button.disabled = true;
  if (feedback) {
    feedback.textContent = 'Creando pago esperado...';
    feedback.className = 'mt-4 text-sm text-blue-700';
  }
  try {
    const result = await createBankExpectedPayment(state.supabase, state.hotelId, {
      operationId: state.expectedOperation.id,
      reservationId: formData.get('reservationId'),
      amountCop: Number(formData.get('amountCop')),
      paymentMethod: formData.get('paymentMethod'),
      expiresMinutes: Number(formData.get('expiresMinutes'))
    });
    if (!state.mounted) return;
    state.expectedOperation = null;
    form.reset();
    try {
      state.expectedOptions = await getBankExpectedPaymentOptions(state.supabase, state.hotelId);
      const reservationSelect = form.querySelector('#bank-expected-reservation');
      if (reservationSelect) {
        reservationSelect.innerHTML = `
          <option value="">Selecciona una reserva...</option>
          ${renderCandidateOptions(state.expectedOptions.reservations, reservationCandidateLabel)}
        `;
      }
    } catch {
      console.warn('[Pagos bancarios] No se pudo refrescar el saldo de reservas.');
    }
    if (feedback) {
      const expiration = result.expectedPayment?.expires_at
        ? ` Vence ${formatDateTime(result.expectedPayment.expires_at)}.`
        : '';
      feedback.textContent = `Pago esperado creado correctamente.${expiration}`;
      feedback.className = 'mt-4 text-sm text-emerald-700';
    }
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message || 'No se pudo crear el pago esperado.';
      feedback.className = 'mt-4 text-sm text-red-700';
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function readFilters() {
  const form = state.container?.querySelector('#bank-payments-filters');
  if (!form) return {};
  const data = new FormData(form);
  return {
    status: String(data.get('status') || ''),
    dateFrom: String(data.get('dateFrom') || ''),
    dateTo: String(data.get('dateTo') || '')
  };
}

async function loadEvents({ silent = false, append = false } = {}) {
  if (!state.mounted) return;
  const sequence = ++state.requestSequence;
  const listElement = state.container?.querySelector('#bank-payments-list');
  const loadMoreButton = append ? state.container?.querySelector('#bank-payments-load-more') : null;
  if (loadMoreButton) {
    loadMoreButton.disabled = true;
    loadMoreButton.textContent = 'Cargando...';
  }
  if (!silent && !append && listElement) {
    listElement.innerHTML = '<div class="rounded-2xl border border-slate-200 bg-slate-50 p-8 text-center text-slate-500">Cargando movimientos...</div>';
  }
  clearModuleFeedback();

  try {
    const page = await listBankPaymentEvents(state.supabase, state.hotelId, {
      ...readFilters(),
      offset: append ? state.nextEventsOffset : 0,
      limit: EVENT_PAGE_SIZE
    });
    if (!state.mounted || sequence !== state.requestSequence) return;
    if (append) {
      const knownIds = new Set(state.events.map((event) => event.id));
      state.events = [...state.events, ...page.events.filter((event) => !knownIds.has(event.id))];
    } else {
      state.events = page.events;
    }
    state.hasMoreEvents = page.hasMore;
    state.nextEventsOffset = page.nextOffset ?? state.events.length;
    renderEventsTable();
  } catch (error) {
    if (!state.mounted || sequence !== state.requestSequence) return;
    if (!append) {
      state.events = [];
      state.hasMoreEvents = false;
      state.nextEventsOffset = 0;
      renderEventsTable();
    } else if (loadMoreButton) {
      loadMoreButton.disabled = false;
      loadMoreButton.textContent = 'Cargar más transferencias';
    }
    showModuleFeedback(error.message || 'No se pudieron cargar los pagos bancarios.', 'error');
  }
}

function scheduleRefresh() {
  window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => {
    void loadEvents({ silent: true });
  }, 350);
}

function getModalContainer() {
  return document.getElementById('modal-container-secondary');
}

function closeDetailModal({ clearHash = true } = {}) {
  cleanupModalListeners();
  const modal = getModalContainer();
  if (modal?.querySelector('[data-bank-payment-modal="true"]')) {
    modal.innerHTML = '';
    modal.style.display = 'none';
  }
  state.currentDetailId = null;

  if (clearHash && getRequestedPaymentId()) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#/pagos-bancarios`);
  }
}

function renderCandidateOptions(items, labelBuilder) {
  return items
    .filter((item) => isUuid(item?.id))
    .map((item) => `<option value="${escapeAttribute(item.id)}">${escapeHtml(labelBuilder(item))}</option>`)
    .join('');
}

function reservationCandidateLabel(item) {
  const amount = Number(firstValue(item, ['outstanding_amount_cop', 'pending_amount_cop', 'pending', 'pendiente', 'monto_pendiente'], 0));
  const client = firstValue(item, ['cliente_nombre', 'guest_name', 'nombre_cliente'], 'Sin nombre');
  const room = firstValue(item?.room || item?.habitaciones, ['nombre', 'name']) || firstValue(item, ['room_name', 'habitacion_nombre']);
  return `#${shortId(item.id)} · ${client}${room ? ` · Hab. ${room}` : ''}${amount > 0 ? ` · Pendiente ${formatCop(amount)}` : ''}`;
}

function roomCandidateLabel(item) {
  const name = firstValue(item, ['nombre', 'name'], `#${shortId(item.id)}`);
  const status = firstValue(item, ['estado', 'status']);
  return `Habitacion ${name}${status ? ` · ${status}` : ''}`;
}

function expectedPaymentCandidateLabel(item) {
  const amount = Number(firstValue(item, ['expected_amount_cop', 'amount_cop', 'monto'], 0));
  const reservationId = firstValue(item, ['reservation_id', 'reserva_id']);
  return `${formatCop(amount)}${reservationId ? ` · Reserva #${shortId(reservationId)}` : ''}`;
}

function salesCandidateOptions(items) {
  return items
    .filter((item) => isUuid(item?.id))
    .map((item) => {
      const type = String(firstValue(item, ['sale_type', 'type', 'entity_type', 'tipo'], '') || '').slice(0, 80);
      const amount = Number(firstValue(item, ['amount_cop', 'total_venta', 'monto_total', 'total'], 0));
      const label = `${type || 'Venta'} #${shortId(item.id)}${amount > 0 ? ` · ${formatCop(amount)}` : ''}`;
      return `<option value="${escapeAttribute(item.id)}" data-sale-type="${escapeAttribute(type)}">${escapeHtml(label)}</option>`;
    })
    .join('');
}

function detailRelationSummary(event) {
  const parts = [getReservationLabel(event), getRoomLabel(event)].filter((value) => !value.startsWith('Sin '));
  return parts.length ? parts.join(' · ') : 'Sin relacion confirmada';
}

function renderDetailModal(event, candidates) {
  const modal = getModalContainer();
  if (!modal || !state.mounted || state.currentDetailId !== event?.id) return;
  cleanupModalListeners();
  const status = getStatusMeta(event.status);
  const reservations = candidates?.reservations || [];
  const rooms = candidates?.rooms || [];
  const sales = candidates?.sales || [];
  const expectedPayments = candidates?.expectedPayments || [];

  modal.innerHTML = `
    <div data-bank-payment-modal="true" class="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
      <div class="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-6 py-5">
        <div>
          <p class="text-xs font-semibold uppercase tracking-widest text-blue-700">Pago bancario</p>
          <h2 class="mt-1 text-2xl font-black text-slate-900">${escapeHtml(formatCop(eventAmount(event)))}</h2>
          <p class="mt-1 text-sm text-slate-500">${escapeHtml(firstValue(event, ['bank_name', 'bankName'], 'Banco no identificado'))} · ${escapeHtml(formatDateTime(eventDate(event)))}</p>
          ${isTestEvent(event) ? '<span class="mt-2 inline-flex rounded-full border border-fuchsia-200 bg-fuchsia-50 px-2 py-1 text-xs font-bold uppercase tracking-wider text-fuchsia-700">Evento de prueba</span>' : ''}
        </div>
        <button type="button" data-bank-detail-close="true" class="button-icon rounded-full bg-white p-2 text-xl text-slate-500" aria-label="Cerrar">×</button>
      </div>
      <div class="max-h-[80vh] overflow-y-auto p-6">
        <div class="grid gap-4 md:grid-cols-3">
          <article class="rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Estado</p>
            <div class="mt-2">${renderStatusBadge(event.status)}</div>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Referencia parcial</p>
            <p class="mt-2 font-mono font-bold text-slate-800">${escapeHtml(maskReference(eventReference(event)))}</p>
          </article>
          <article class="rounded-2xl border border-slate-200 bg-white p-4">
            <p class="text-xs font-semibold uppercase tracking-wider text-slate-400">Relacion actual</p>
            <p class="mt-2 text-sm font-semibold text-slate-800">${escapeHtml(detailRelationSummary(event))}</p>
          </article>
        </div>

        <div class="mt-6 grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 md:grid-cols-2">
          <div><span class="text-xs font-semibold uppercase text-slate-400">Remitente</span><p class="mt-1 text-sm text-slate-700">${escapeHtml(firstValue(event, ['sender_name', 'payer_name'], 'No disponible'))}</p></div>
          <div><span class="text-xs font-semibold uppercase text-slate-400">Analisis</span><p class="mt-1 text-sm text-slate-700">${escapeHtml(firstValue(event, ['review_reason', 'analysis_reason'], 'Sin observaciones'))}</p></div>
          <div><span class="text-xs font-semibold uppercase text-slate-400">Parser</span><p class="mt-1 text-sm text-slate-700">${escapeHtml(firstValue(event, ['parser_version'], 'No informado'))}</p></div>
          <div><span class="text-xs font-semibold uppercase text-slate-400">ID interno</span><p class="mt-1 font-mono text-xs text-slate-500">${escapeHtml(event.id)}</p></div>
        </div>

        <section class="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-5">
          <h3 class="text-lg font-bold text-blue-900">Relacion y revision manual</h3>
          <p class="mt-1 text-sm text-blue-700">Selecciona solo datos del hotel actual. El servidor vuelve a validar cada relacion.</p>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <label class="form-label" for="bank-detail-reservation">Reserva</label>
              <select id="bank-detail-reservation" class="form-control"><option value="">Sin seleccionar</option>${renderCandidateOptions(reservations, reservationCandidateLabel)}</select>
            </div>
            <div>
              <label class="form-label" for="bank-detail-room">Habitacion</label>
              <select id="bank-detail-room" class="form-control"><option value="">Sin seleccionar</option>${renderCandidateOptions(rooms, roomCandidateLabel)}</select>
            </div>
            <div class="${BANK_FIRST_WORKFLOW ? 'hidden' : ''}">
              <label class="form-label" for="bank-detail-expected">Pago esperado</label>
              <select id="bank-detail-expected" class="form-control"><option value="">Sin seleccionar</option>${renderCandidateOptions(expectedPayments, expectedPaymentCandidateLabel)}</select>
            </div>
            <div>
              <label class="form-label" for="bank-detail-sale">Venta</label>
              <select id="bank-detail-sale" class="form-control"><option value="">Sin seleccionar</option>${salesCandidateOptions(sales)}</select>
            </div>
            <div class="md:col-span-2">
              <label class="form-label" for="bank-detail-reason">Motivo u observacion</label>
              <textarea id="bank-detail-reason" class="form-control" rows="3" maxlength="500" placeholder="Obligatorio para rechazar; opcional para revision."></textarea>
            </div>
          </div>
          <div id="bank-detail-feedback" class="mt-4 text-sm" aria-live="polite"></div>
          <div class="mt-4 flex flex-wrap gap-3">
            ${event.status === 'duplicated'
              ? '<span class="text-sm font-semibold text-slate-500">Este duplicado no admite acciones.</span>'
              : ['confirmed', 'rejected'].includes(event.status)
                ? '<button type="button" data-bank-manual-action="review" class="button button-warning">Marcar revisado</button>'
                : `
                  <button type="button" data-bank-manual-action="relate" class="button button-primary">Relacionar seleccion</button>
                  <button type="button" data-bank-manual-action="confirm" class="button button-success">Confirmar</button>
                  <button type="button" data-bank-manual-action="review" class="button button-warning">Marcar revisado</button>
                  <button type="button" data-bank-manual-action="reject" class="button button-danger">Rechazar</button>
                `}
          </div>
        </section>
        <p class="mt-4 text-xs text-slate-400">Estado recibido: ${escapeHtml(status.label)}. No se muestra el cuerpo completo del correo ni informacion bancaria sensible.</p>
      </div>
    </div>
  `;
  modal.style.display = 'flex';

  const currentSelections = [
    ['#bank-detail-reservation', event.matched_reservation_id],
    ['#bank-detail-room', event.matched_room_id],
    ['#bank-detail-expected', event.matched_expected_payment_id]
  ];
  for (const [selector, value] of currentSelections) {
    const select = modal.querySelector(selector);
    if (select && value && [...select.options].some((option) => option.value === value)) {
      select.value = value;
    }
  }
  const saleSelect = modal.querySelector('#bank-detail-sale');
  if (
    saleSelect && event.matched_sale_id &&
    [...saleSelect.options].some((option) =>
      option.value === event.matched_sale_id &&
      option.dataset.saleType === event.matched_sale_type
    )
  ) {
    saleSelect.value = event.matched_sale_id;
  }

  addModalListener(modal.querySelector('[data-bank-detail-close="true"]'), 'click', () => closeDetailModal());
  addModalListener(modal, 'click', (clickEvent) => {
    if (clickEvent.target === modal) closeDetailModal();
  });
  addModalListener(document, 'keydown', (keyEvent) => {
    if (keyEvent.key === 'Escape') closeDetailModal();
  });
  modal.querySelectorAll('[data-bank-manual-action]').forEach((button) => {
    addModalListener(button, 'click', () => handleManualAction(event.id, button.dataset.bankManualAction, modal));
  });
}

function renderModalLoading() {
  const modal = getModalContainer();
  if (!modal) return;
  cleanupModalListeners();
  modal.innerHTML = `
    <div data-bank-payment-modal="true" class="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
      <p class="text-lg font-bold text-slate-800">Cargando pago bancario...</p>
      <p class="mt-2 text-sm text-slate-500">Validando acceso y datos relacionados.</p>
    </div>
  `;
  modal.style.display = 'flex';
}

function renderModalError(message) {
  const modal = getModalContainer();
  if (!modal) return;
  cleanupModalListeners();
  modal.innerHTML = `
    <div data-bank-payment-modal="true" class="w-full max-w-lg rounded-3xl bg-white p-8 text-center shadow-2xl">
      <p class="text-lg font-bold text-red-700">No se pudo abrir el pago</p>
      <p class="mt-2 text-sm text-slate-600">${escapeHtml(message)}</p>
      <button type="button" data-bank-detail-close="true" class="button button-neutral mt-5">Cerrar</button>
    </div>
  `;
  modal.style.display = 'flex';
  addModalListener(modal.querySelector('[data-bank-detail-close="true"]'), 'click', () => closeDetailModal());
  addModalListener(document, 'keydown', (keyEvent) => {
    if (keyEvent.key === 'Escape') closeDetailModal();
  });
}

async function openPaymentDetail(paymentEventId, { syncHash = true } = {}) {
  if (!state.mounted || !isUuid(paymentEventId)) return;
  state.currentDetailId = paymentEventId;
  renderModalLoading();
  if (syncHash) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}#/pagos-bancarios?payment=${encodeURIComponent(paymentEventId)}`);
  }

  try {
    const event = await getBankPaymentDetail(state.supabase, state.hotelId, paymentEventId);
    if (!state.mounted || state.currentDetailId !== paymentEventId) return;
    if (!event || !isUuid(event.id)) throw new Error('El pago no existe o ya no esta disponible.');

    let candidates = { reservations: [], rooms: [], sales: [], expectedPayments: [] };
    try {
      candidates = await getBankPaymentCandidates(state.supabase, state.hotelId, paymentEventId);
    } catch (error) {
      console.warn('[Pagos bancarios] No se cargaron candidatos; el detalle sigue disponible.');
    }
    if (!state.mounted || state.currentDetailId !== paymentEventId) return;
    renderDetailModal(event, candidates);
  } catch (error) {
    if (!state.mounted || state.currentDetailId !== paymentEventId) return;
    renderModalError(error.message || 'No fue posible consultar el movimiento.');
  }
}

async function handleManualAction(paymentEventId, manualAction, modal) {
  if (!state.mounted || !isUuid(paymentEventId)) return;
  const feedback = modal.querySelector('#bank-detail-feedback');
  const buttons = [...modal.querySelectorAll('[data-bank-manual-action]')];
  const reservationId = modal.querySelector('#bank-detail-reservation')?.value || null;
  const roomId = modal.querySelector('#bank-detail-room')?.value || null;
  const expectedPaymentId = modal.querySelector('#bank-detail-expected')?.value || null;
  const saleSelect = modal.querySelector('#bank-detail-sale');
  const selectedSale = saleSelect?.selectedOptions?.[0];
  const saleId = saleSelect?.value || null;
  const saleType = selectedSale?.dataset?.saleType || null;
  const reviewReason = modal.querySelector('#bank-detail-reason')?.value || null;

  buttons.forEach((button) => { button.disabled = true; });
  if (feedback) {
    feedback.textContent = 'Procesando accion...';
    feedback.className = 'mt-4 text-sm text-blue-700';
  }

  try {
    await submitBankPaymentManualAction(state.supabase, state.hotelId, {
      paymentEventId,
      manualAction,
      reservationId,
      roomId,
      expectedPaymentId,
      saleId,
      saleType,
      reviewReason
    });
    closeDetailModal();
    await loadEvents({ silent: true });
    showAppFeedback('Pago bancario actualizado correctamente.', 'success');
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message || 'No se pudo completar la accion.';
      feedback.className = 'mt-4 text-sm text-red-700';
    }
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function getRequestedPaymentId() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  const [path, query = ''] = hash.split('?');
  if (path !== '/pagos-bancarios') return null;
  const paymentId = new URLSearchParams(query).get('payment');
  return isUuid(paymentId) ? paymentId : null;
}

function handleModuleHashChange() {
  if (!state.mounted) return;
  const requestedId = getRequestedPaymentId();
  if (requestedId && requestedId !== state.currentDetailId) {
    void openPaymentDetail(requestedId, { syncHash: false });
  }
}

function buildSimulationPreview(result) {
  const parsed = result?.result || result?.parsed || result?.analysis || result || {};
  const toSave = result?.wouldBeSaved || result?.dataToSave || result?.wouldSave || result?.event || parsed?.dataToSave || {};
  const match = result?.match && typeof result.match === 'object' ? result.match : {};
  const amount = Number(firstValue(parsed, ['amount_cop', 'amountCop', 'amount', 'monto'], firstValue(toSave, ['amount_cop', 'amountCop'], 0)));
  const reference = firstValue(parsed, ['transaction_reference', 'transactionReference', 'reference', 'referencia'], firstValue(toSave, ['transaction_reference'], ''));
  const status = firstValue(match, ['status'], firstValue(parsed, ['status', 'estado', 'disposition'], firstValue(toSave, ['status'], 'Sin estado')));

  return {
    banco: firstValue(parsed, ['bank_name', 'bankName', 'bank'], firstValue(toSave, ['bank_name'], 'No identificado')),
    monto_cop: Number.isFinite(amount) ? Math.trunc(amount) : 0,
    referencia_parcial: maskReference(reference),
    estado: status,
    reserva_relacionada: firstValue(parsed, ['matched_reservation_id', 'reservationId'], firstValue(toSave, ['matched_reservation_id'], null)),
    habitacion_relacionada: firstValue(parsed, ['matched_room_id', 'roomId'], firstValue(toSave, ['matched_room_id'], null)),
    pago_esperado_relacionado: firstValue(match, ['matchedExpectedPaymentId', 'matched_expected_payment_id'], firstValue(parsed, ['matched_expected_payment_id', 'expectedPaymentId'], firstValue(toSave, ['matched_expected_payment_id'], null))),
    motivo_revision: firstValue(parsed, ['review_reason', 'reviewReason', 'reason', 'reviewReason'], firstValue(match, ['reason'], firstValue(toSave, ['review_reason'], null))),
    se_guardaria_como_prueba: result?.saved === true || toSave?.metadata?.is_test === true,
    parser_version: firstValue(parsed, ['parser_version'], firstValue(toSave, ['parser_version'], null))
  };
}

function renderSimulationResult(result, saved) {
  const container = state.container?.querySelector('#bank-simulation-result');
  if (!container) return;
  const preview = buildSimulationPreview(result);
  container.innerHTML = `
    <div class="rounded-2xl border ${saved ? 'border-emerald-200 bg-emerald-50' : 'border-blue-200 bg-blue-50'} p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wider ${saved ? 'text-emerald-700' : 'text-blue-700'}">${saved ? 'Evento de prueba guardado' : 'Vista previa sin guardar'}</p>
          <h3 class="mt-1 text-xl font-bold text-slate-900">${escapeHtml(formatCop(preview.monto_cop))} · ${escapeHtml(preview.banco)}</h3>
        </div>
        ${renderStatusBadge(preview.estado)}
      </div>
      <dl class="mt-4 grid gap-3 text-sm md:grid-cols-2">
        <div><dt class="font-semibold text-slate-500">Referencia</dt><dd class="text-slate-800">${escapeHtml(preview.referencia_parcial)}</dd></div>
        <div><dt class="font-semibold text-slate-500">Motivo de revision</dt><dd class="text-slate-800">${escapeHtml(preview.motivo_revision || 'Sin observaciones')}</dd></div>
        <div><dt class="font-semibold text-slate-500">Reserva</dt><dd class="text-slate-800">${escapeHtml(preview.reserva_relacionada ? `#${shortId(preview.reserva_relacionada)}` : 'Sin relacion')}</dd></div>
        <div><dt class="font-semibold text-slate-500">Habitacion</dt><dd class="text-slate-800">${escapeHtml(preview.habitacion_relacionada ? `#${shortId(preview.habitacion_relacionada)}` : 'Sin relacion')}</dd></div>
        <div><dt class="font-semibold text-slate-500">Pago esperado</dt><dd class="text-slate-800">${escapeHtml(preview.pago_esperado_relacionado ? `#${shortId(preview.pago_esperado_relacionado)}` : 'Sin relacion')}</dd></div>
        <div><dt class="font-semibold text-slate-500">Parser</dt><dd class="text-slate-800">${escapeHtml(preview.parser_version || 'No informado')}</dd></div>
      </dl>
      <details class="mt-4 rounded-xl border border-white bg-white p-4">
        <summary class="cursor-pointer text-sm font-semibold text-slate-700">Datos seguros que se mostrarian/guardarian</summary>
        <pre class="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-600">${escapeHtml(JSON.stringify(preview, null, 2))}</pre>
      </details>
    </div>
  `;
}

async function handleSimulationSubmit(event) {
  event.preventDefault();
  if (!state.pilotStatus?.isAdmin) return;
  const form = event.currentTarget;
  const submitter = event.submitter;
  const save = submitter?.dataset?.simulationSave === 'true';
  const formData = new FormData(form);
  const buttons = [...form.querySelectorAll('button[type="submit"]')];
  const resultElement = state.container?.querySelector('#bank-simulation-result');
  buttons.forEach((button) => { button.disabled = true; });
  if (resultElement) resultElement.textContent = 'Analizando correo simulado...';

  try {
    const result = await simulateBankPaymentEmail(state.supabase, state.hotelId, {
      subject: formData.get('subject'),
      body: formData.get('body'),
      from: formData.get('from'),
      returnPath: formData.get('returnPath'),
      authenticationResults: formData.get('authenticationResults'),
      receivedAt: formData.get('receivedAt'),
      save
    });
    if (!state.mounted) return;
    renderSimulationResult(result, save);
    if (save) await loadEvents({ silent: true });
  } catch (error) {
    if (resultElement) {
      resultElement.textContent = error.message || 'No se pudo ejecutar la simulacion.';
      resultElement.className = 'mt-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700';
    }
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function wireModuleEvents() {
  addListener(state.container.querySelector('#bank-payments-refresh'), 'click', () => loadEvents());
  addListener(state.container.querySelector('#bank-payments-filters'), 'submit', (event) => {
    event.preventDefault();
    void loadEvents();
  });
  addListener(state.container.querySelector('#bank-payments-clear-filters'), 'click', () => {
    state.container.querySelector('#bank-payments-filters')?.reset();
    void loadEvents();
  });
  addListener(state.container.querySelector('#bank-payments-list'), 'click', (event) => {
    if (event.target.closest('#bank-payments-load-more')) {
      void loadEvents({ silent: true, append: true });
      return;
    }
    const button = event.target.closest('.bank-payment-detail');
    if (button && isUuid(button.dataset.paymentEventId)) {
      void openPaymentDetail(button.dataset.paymentEventId);
    }
  });
  addListener(state.container.querySelector('#bank-payment-simulator'), 'submit', handleSimulationSubmit);
  addListener(state.container.querySelector('#bank-expected-payment-form'), 'submit', handleExpectedPaymentSubmit);
  addListener(window, 'hashchange', handleModuleHashChange);
}

function renderClosedState(message) {
  state.container.innerHTML = `
    <div class="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-widest text-slate-400">Funcion no disponible</p>
      <h1 class="mt-3 text-2xl font-black text-slate-900">Pagos bancarios</h1>
      <p class="mt-3 text-sm text-slate-600">${escapeHtml(message)}</p>
      <a href="#/dashboard" class="button button-primary mt-6">Volver al dashboard</a>
    </div>
  `;
}

export async function mount(container, supabase, user, hotelId) {
  unmount();
  state = createState();
  state.container = container;
  state.supabase = supabase;
  state.user = user;
  state.hotelId = hotelId;
  state.mounted = true;

  if (!user?.id || !isUuid(hotelId)) {
    renderClosedState('No fue posible verificar una sesion y un hotel validos.');
    return;
  }

  container.innerHTML = '<div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">Verificando acceso al piloto...</div>';

  try {
    state.pilotStatus = await getBankPaymentPilotStatus(supabase, hotelId);
  } catch (error) {
    console.warn('[Pagos bancarios] La verificacion autoritativa fallo; acceso cerrado.');
    renderClosedState('No se pudo verificar el acceso al piloto. Intenta de nuevo mas tarde.');
    return;
  }

  if (!state.pilotStatus.canAccess) {
    renderClosedState('Esta funcion no esta habilitada para el hotel o usuario actual.');
    return;
  }

  if (!BANK_FIRST_WORKFLOW && state.pilotStatus.isAdmin) {
    try {
      state.expectedOptions = await getBankExpectedPaymentOptions(supabase, hotelId);
    } catch {
      console.warn('[Pagos bancarios] No se cargaron las reservas para pagos esperados.');
    }
  }

  renderShell();
  wireModuleEvents();
  await loadEvents();

  if (!state.mounted) return;
  state.subscription = subscribeToBankPaymentEvents(supabase, hotelId, scheduleRefresh);
  state.liveRefreshInterval = window.setInterval(() => {
    if (state.mounted && !document.hidden) void loadEvents({ silent: true });
  }, 10000);
  const requestedId = getRequestedPaymentId();
  if (requestedId) void openPaymentDetail(requestedId, { syncHash: false });
}

export function unmount() {
  if (!state) return;
  state.mounted = false;
  state.requestSequence += 1;
  window.clearTimeout(state.refreshTimer);
  window.clearInterval(state.liveRefreshInterval);
  cleanupListeners();
  cleanupModalListeners();
  if (state.subscription) {
    state.subscription.unsubscribe().catch(() => {});
  }
  closeDetailModal({ clearHash: false });
  state = createState();
}
