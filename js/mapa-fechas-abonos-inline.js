const ACTIVE_RESERVATION_STATES = ['activa', 'ocupada', 'tiempo agotado'];
const COLOMBIA_TIME_ZONE = 'America/Bogota';
const PATCH_VERSION = 'v3';
const ROW_MARKER = 'paymentDateInlineReady';
const HISTORY_MARKER = 'paymentHistoryReady';
const RETRY_MS = 1200;
const POLL_MS = 500;

const lastAttemptByModal = new WeakMap();
let pollTimer = null;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseMoney(value) {
  return Number(String(value || '').replace(/[^\d-]/g, '') || 0);
}

function formatMoney(value) {
  return `$ ${Number(value || 0).toLocaleString('es-CO')}`;
}

function formatPaymentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('es-CO', {
    timeZone: COLOMBIA_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(date);
}

function cleanConcept(value) {
  return String(value || 'Pago / abono')
    .replace(/\s*-\s*Cliente:.*$/i, '')
    .trim() || 'Pago / abono';
}

function getVisibleAccountModal() {
  const buttons = Array.from(document.querySelectorAll('#btn-imprimir-pos-local'));
  for (const button of buttons) {
    const modal = button.closest('.bg-white') || button.closest('#modal-container > div');
    if (modal && document.body.contains(modal)) return modal;
  }
  return null;
}

function getRoomName(modalRoot) {
  const title = modalRoot?.querySelector('h3')?.textContent?.trim() || '';
  return title.replace(/^Detalle de Cuenta:\s*/i, '').trim();
}

function getServiceRows(modalRoot) {
  return Array.from(modalRoot?.querySelectorAll('tbody tr') || []).filter((row) => {
    const origin = row.querySelector('td')?.textContent?.trim().toLowerCase();
    return origin === 'servicio';
  });
}

function getServiceIdentityFromRow(row) {
  const cells = row.querySelectorAll('td');
  const descriptionCell = cells[1];
  const detailSpan = Array.from(descriptionCell?.querySelectorAll('span') || [])
    .find((span) => !/^(PAGADO|PENDIENTE|ABONADO)$/i.test(span.textContent?.trim() || ''));
  const detail = detailSpan?.textContent?.trim()
    || descriptionCell?.textContent?.replace(/PAGADO|PENDIENTE|ABONADO/gi, '')?.trim()
    || '';

  return {
    detail: normalizeText(detail),
    amount: parseMoney(cells[3]?.textContent)
  };
}

function getServiceIdentity(service) {
  return {
    detail: normalizeText(service?.servicio?.nombre || service?.descripcion_manual || 'Servicio'),
    amount: Number(service?.precio_cobrado || 0)
  };
}

function findServiceForRow(row, services, usedIndexes) {
  const rowIdentity = getServiceIdentityFromRow(row);

  let index = services.findIndex((service, candidateIndex) => {
    if (usedIndexes.has(candidateIndex)) return false;
    const serviceIdentity = getServiceIdentity(service);
    return serviceIdentity.detail === rowIdentity.detail
      && serviceIdentity.amount === rowIdentity.amount;
  });

  if (index === -1) {
    index = services.findIndex((_, candidateIndex) => !usedIndexes.has(candidateIndex));
  }

  if (index === -1) return null;
  usedIndexes.add(index);
  return services[index];
}

function addPaymentDateToRow(row, paymentDate) {
  if (!paymentDate || row.dataset[ROW_MARKER] === PATCH_VERSION) return;

  const descriptionCell = row.querySelectorAll('td')[1];
  if (!descriptionCell) return;

  const detailSpan = Array.from(descriptionCell.querySelectorAll('span'))
    .find((span) => !/^(PAGADO|PENDIENTE|ABONADO)$/i.test(span.textContent?.trim() || ''));
  if (!detailSpan) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'min-w-0 flex-1';

  const detail = document.createElement('div');
  detail.className = 'font-semibold text-gray-800';
  detail.textContent = detailSpan.textContent?.trim() || 'Servicio';

  const dateLine = document.createElement('div');
  dateLine.className = 'mt-1 text-[11px] font-semibold text-blue-700';
  dateLine.dataset.paymentDateInline = 'true';
  dateLine.textContent = `Pagado: ${paymentDate}`;

  wrapper.append(detail, dateLine);
  detailSpan.replaceWith(wrapper);
  row.dataset[ROW_MARKER] = PATCH_VERSION;
}

function renderPaymentHistory(modalRoot, payments) {
  if (modalRoot.dataset[HISTORY_MARKER] === PATCH_VERSION) return;

  const table = modalRoot.querySelector('table');
  const scrollArea = table?.parentElement;
  if (!table || !scrollArea) return;

  const oldSection = scrollArea.querySelector('[data-payment-history-section]');
  if (oldSection) oldSection.remove();

  const section = document.createElement('section');
  section.dataset.paymentHistorySection = 'true';
  section.className = 'border-t border-slate-200 bg-slate-50 px-4 py-4';

  const heading = document.createElement('div');
  heading.className = 'mb-3 flex items-center justify-between gap-3';

  const title = document.createElement('h4');
  title.className = 'text-sm font-bold text-slate-800';
  title.textContent = 'Historial de pagos y abonos';

  const count = document.createElement('span');
  count.className = 'text-xs font-semibold text-slate-500';
  count.textContent = `${payments.length} movimiento${payments.length === 1 ? '' : 's'}`;

  heading.append(title, count);
  section.appendChild(heading);

  if (payments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-500';
    empty.textContent = 'No hay pagos con fecha individual registrados para esta reserva.';
    section.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white';

    [...payments]
      .sort((a, b) => new Date(b?.fecha_pago || 0).getTime() - new Date(a?.fecha_pago || 0).getTime())
      .forEach((payment) => {
        const row = document.createElement('div');
        row.className = 'flex items-start justify-between gap-4 px-3 py-2.5';

        const left = document.createElement('div');
        left.className = 'min-w-0';

        const concept = document.createElement('div');
        concept.className = 'text-sm font-semibold text-slate-800';
        concept.textContent = cleanConcept(payment?.concepto);

        const date = document.createElement('div');
        date.className = 'mt-0.5 text-xs font-medium text-blue-700';
        date.textContent = formatPaymentDate(payment?.fecha_pago) || 'Fecha no disponible';

        const amount = document.createElement('div');
        amount.className = 'shrink-0 text-sm font-bold text-emerald-700';
        amount.textContent = formatMoney(payment?.monto);

        left.append(concept, date);
        row.append(left, amount);
        list.appendChild(row);
      });

    section.appendChild(list);
  }

  scrollArea.appendChild(section);
  modalRoot.dataset[HISTORY_MARKER] = PATCH_VERSION;
}

async function resolveRoom(supabase, hotelId, roomName) {
  const { data, error } = await supabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', hotelId);

  if (error) throw error;
  const normalizedTarget = normalizeText(roomName);
  return (data || []).find((room) => normalizeText(room?.nombre) === normalizedTarget) || null;
}

async function loadPaymentContext(modalRoot) {
  const supabase = window.supabase;
  const hotelId = window.hotelIdGlobal;
  const roomName = getRoomName(modalRoot);

  if (!supabase || !hotelId || !roomName) return null;

  const room = await resolveRoom(supabase, hotelId, roomName);
  if (!room?.id) return null;

  const { data: reservation, error: reservationError } = await supabase
    .from('reservas')
    .select('id, fecha_inicio')
    .eq('hotel_id', hotelId)
    .eq('habitacion_id', room.id)
    .in('estado', ACTIVE_RESERVATION_STATES)
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (reservationError) throw reservationError;
  if (!reservation?.id) return null;

  const [servicesResult, paymentsResult] = await Promise.all([
    supabase
      .from('servicios_x_reserva')
      .select('id, descripcion_manual, precio_cobrado, estado_pago, pago_reserva_id, fecha_servicio, creado_en, servicio:servicios_adicionales(nombre)')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reservation.id),
    supabase
      .from('pagos_reserva')
      .select('id, fecha_pago, monto, concepto')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reservation.id)
      .order('fecha_pago', { ascending: false })
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  return {
    reservation,
    services: Array.isArray(servicesResult.data) ? servicesResult.data : [],
    payments: Array.isArray(paymentsResult.data) ? paymentsResult.data : []
  };
}

async function patchVisibleAccountModal() {
  const modalRoot = getVisibleAccountModal();
  if (!modalRoot) return;

  if (
    modalRoot.dataset[ROW_MARKER] === PATCH_VERSION
    && modalRoot.dataset[HISTORY_MARKER] === PATCH_VERSION
  ) return;

  const lastAttempt = lastAttemptByModal.get(modalRoot) || 0;
  if (Date.now() - lastAttempt < RETRY_MS) return;
  lastAttemptByModal.set(modalRoot, Date.now());

  const serviceRows = getServiceRows(modalRoot);
  if (serviceRows.length === 0) return;

  try {
    const context = await loadPaymentContext(modalRoot);
    if (!context || !document.body.contains(modalRoot)) return;

    const paymentById = new Map(context.payments.map((payment) => [payment.id, payment]));
    const paidServices = context.services.filter((service) => (
      String(service?.estado_pago || '').toLowerCase() === 'pagado'
    ));
    const usedIndexes = new Set();

    serviceRows.forEach((row) => {
      const service = findServiceForRow(row, paidServices, usedIndexes);
      if (!service) return;

      const linkedPayment = service.pago_reserva_id
        ? paymentById.get(service.pago_reserva_id)
        : null;
      const dateValue = linkedPayment?.fecha_pago || service.fecha_servicio || service.creado_en;
      addPaymentDateToRow(row, formatPaymentDate(dateValue));
    });

    renderPaymentHistory(modalRoot, context.payments);
    modalRoot.dataset[ROW_MARKER] = PATCH_VERSION;
  } catch (error) {
    console.warn('[Mapa] No se pudieron mostrar las fechas de pagos y abonos:', error);
  }
}

function startReliableWatcher() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    patchVisibleAccountModal();
  }, POLL_MS);

  if (typeof MutationObserver !== 'undefined' && document.body) {
    const observer = new MutationObserver(() => {
      patchVisibleAccountModal();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  patchVisibleAccountModal();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startReliableWatcher, { once: true });
  } else {
    startReliableWatcher();
  }
}
