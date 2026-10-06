import { formatInTimeZone, getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';
import { MAPA_ACCOUNT_MODAL_RENDERED_EVENT } from './modules/mapa-habitaciones/mapa-ui-events.js';

const PATCH_VERSION = 'v4';
const ROW_MARKER = 'paymentDateInlineReady';

let renderedListener = null;
let renderGeneration = 0;
let runtimeContext = null;

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

export async function loadPaymentContext(supabase, hotelId, reservationId) {
  if (!supabase || !hotelId || !reservationId) return null;

  const [servicesResult, paymentsResult] = await Promise.all([
    supabase
      .from('servicios_x_reserva')
      .select('id, descripcion_manual, precio_cobrado, estado_pago, pago_reserva_id, fecha_servicio, creado_en, servicio:servicios_adicionales(nombre)')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reservationId),
    supabase
      .from('pagos_reserva')
      .select('id, fecha_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reservationId)
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (paymentsResult.error) throw paymentsResult.error;

  return {
    services: Array.isArray(servicesResult.data) ? servicesResult.data : [],
    payments: Array.isArray(paymentsResult.data) ? paymentsResult.data : []
  };
}

async function patchAccountModal(modalRoot, reservationId, generation) {
  removeDuplicatePaymentLists(modalRoot);

  const serviceRows = getServiceRows(modalRoot);
  if (serviceRows.length === 0) return;
  if (serviceRows.every((row) => row.dataset[ROW_MARKER] === PATCH_VERSION)) return;

  try {
    const context = await loadPaymentContext(
      runtimeContext?.supabase,
      runtimeContext?.hotelId,
      reservationId,
    );
    if (
      !context
      || generation !== renderGeneration
      || !runtimeContext
      || !document.body.contains(modalRoot)
    ) return;

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

export function unmountMapaPaymentDates() {
  if (renderedListener && typeof document !== 'undefined') {
    document.removeEventListener(MAPA_ACCOUNT_MODAL_RENDERED_EVENT, renderedListener);
  }

  renderedListener = null;
  runtimeContext = null;
  renderGeneration += 1;
}

export function mountMapaPaymentDates({ supabase, hotelId } = {}) {
  unmountMapaPaymentDates();
  if (!supabase || !hotelId || typeof document === 'undefined') return;

  runtimeContext = { supabase, hotelId };
  renderedListener = (event) => {
    const modalRoot = event?.detail?.modalRoot;
    const reservationId = event?.detail?.reservationId;
    if (!modalRoot || !reservationId) return;

    const generation = ++renderGeneration;
    void patchAccountModal(modalRoot, reservationId, generation);
  };

  document.addEventListener(MAPA_ACCOUNT_MODAL_RENDERED_EVENT, renderedListener);
}
