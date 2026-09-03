import { formatInTimeZone, getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';

const ACTIVE_RESERVATION_STATES = ['activa', 'ocupada', 'tiempo agotado'];
const PATCH_VERSION = 'v4';
const ROW_MARKER = 'paymentDateInlineReady';
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

function formatPaymentDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return formatInTimeZone(date, getRuntimeHotelTimeZone(), 'es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
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
    || descriptionCell?.textContent?.replace(/PAGADO|PENDIENTE|ABONADO/gi, '')?.replace(/Fecha pago:.*$/i, '')?.trim()
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
  if (!paymentDate) return;

  const descriptionCell = row.querySelectorAll('td')[1];
  if (!descriptionCell) return;

  const existingDate = descriptionCell.querySelector('[data-payment-date-inline]');
  if (existingDate) {
    existingDate.textContent = `Fecha pago: ${paymentDate}`;
    row.dataset[ROW_MARKER] = PATCH_VERSION;
    return;
  }

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
  dateLine.textContent = `Fecha pago: ${paymentDate}`;

  wrapper.append(detail, dateLine);
  detailSpan.replaceWith(wrapper);
  row.dataset[ROW_MARKER] = PATCH_VERSION;
}

function removeDuplicatePaymentLists(modalRoot) {
  modalRoot.querySelectorAll(
    '[data-consumos-payment-history], [data-payment-history-section], [data-consumos-last-payment]'
  ).forEach((element) => element.remove());
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
      .select('id, fecha_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reservation.id)
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  return {
    services: Array.isArray(servicesResult.data) ? servicesResult.data : [],
    payments: Array.isArray(paymentsResult.data) ? paymentsResult.data : []
  };
}

async function patchVisibleAccountModal() {
  const modalRoot = getVisibleAccountModal();
  if (!modalRoot) return;

  removeDuplicatePaymentLists(modalRoot);

  const serviceRows = getServiceRows(modalRoot);
  if (serviceRows.length === 0) return;
  if (serviceRows.every((row) => row.dataset[ROW_MARKER] === PATCH_VERSION)) return;

  const lastAttempt = lastAttemptByModal.get(modalRoot) || 0;
  if (Date.now() - lastAttempt < RETRY_MS) return;
  lastAttemptByModal.set(modalRoot, Date.now());

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

    removeDuplicatePaymentLists(modalRoot);
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
