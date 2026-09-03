const ACTIVE_RESERVATION_STATES = ['activa', 'ocupada', 'tiempo agotado'];
const COLOMBIA_TIME_ZONE = 'America/Bogota';
const ROW_MARKER = 'paymentDateInlineReady';

let observer = null;
let patchTimer = null;

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

function getVisibleAccountModal() {
  const button = document.getElementById('btn-imprimir-pos-local');
  if (!button) return null;
  return button.closest('#modal-container > div') || button.closest('.bg-white');
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
  const detail = cells[1]?.querySelector(':scope > span')?.textContent?.trim()
    || cells[1]?.textContent?.replace(/PAGADO|PENDIENTE|ABONADO/gi, '')?.trim()
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
  if (!paymentDate || row.dataset[ROW_MARKER] === 'true') return;

  const descriptionCell = row.querySelectorAll('td')[1];
  if (!descriptionCell) return;

  const currentDetail = descriptionCell.querySelector(':scope > span');
  if (!currentDetail) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'min-w-0 flex-1';

  const detail = document.createElement('div');
  detail.className = 'font-semibold text-gray-800';
  detail.textContent = currentDetail.textContent?.trim() || 'Servicio';

  const dateLine = document.createElement('div');
  dateLine.className = 'mt-0.5 text-[11px] font-medium text-slate-500';
  dateLine.dataset.paymentDateInline = 'true';
  dateLine.textContent = `Pagado: ${paymentDate}`;

  wrapper.append(detail, dateLine);
  currentDetail.replaceWith(wrapper);
  row.dataset[ROW_MARKER] = 'true';
}

async function loadPaymentDatesForModal(modalRoot) {
  const supabase = window.supabase;
  const hotelId = window.hotelIdGlobal;
  const roomName = getRoomName(modalRoot);

  if (!supabase || !hotelId || !roomName) return null;

  const { data: room, error: roomError } = await supabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', hotelId)
    .eq('nombre', roomName)
    .maybeSingle();

  if (roomError) throw roomError;
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
      .eq('reserva_id', reservation.id)
      .order('fecha_servicio', { ascending: true, nullsFirst: false })
      .order('creado_en', { ascending: true }),
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
  if (!modalRoot || modalRoot.dataset.paymentDatesInlineState === 'loading') return;

  const serviceRows = getServiceRows(modalRoot);
  if (serviceRows.length === 0) return;
  if (serviceRows.every((row) => row.dataset[ROW_MARKER] === 'true')) return;

  modalRoot.dataset.paymentDatesInlineState = 'loading';

  try {
    const context = await loadPaymentDatesForModal(modalRoot);
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

    modalRoot.dataset.paymentDatesInlineState = 'ready';
  } catch (error) {
    console.warn('[Mapa] No se pudieron mostrar las fechas de los abonos:', error);
    if (document.body.contains(modalRoot)) {
      modalRoot.dataset.paymentDatesInlineState = 'error';
    }
  }
}

function schedulePatch() {
  clearTimeout(patchTimer);
  patchTimer = setTimeout(() => {
    patchVisibleAccountModal();
  }, 60);
}

function initPaymentDatesInline() {
  const modalContainer = document.getElementById('modal-container');
  if (!modalContainer || typeof MutationObserver === 'undefined') return;

  observer = new MutationObserver((mutations) => {
    const accountModalTouched = mutations.some((mutation) => (
      Array.from(mutation.addedNodes || []).some((node) => (
        node instanceof Element
        && (node.matches?.('#btn-imprimir-pos-local') || node.querySelector?.('#btn-imprimir-pos-local'))
      ))
    ));

    if (accountModalTouched) schedulePatch();
  });

  observer.observe(modalContainer, { childList: true, subtree: true });
  schedulePatch();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initPaymentDatesInline();
}
