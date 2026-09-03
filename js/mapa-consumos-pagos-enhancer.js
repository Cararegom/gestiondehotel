import { formatCurrency } from './uiUtils.js';
import { formatInTimeZone, getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';

const ACTIVE_RESERVATION_STATES = ['activa', 'ocupada', 'tiempo agotado'];
const CONSUMOS_PAYMENT_HISTORY_ATTR = 'data-consumos-payment-history';

let consumosObserver = null;
const consumosContextCache = new WeakMap();

function formatPaymentDate(value) {
  if (!value) return 'Fecha no disponible';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';

  return formatInTimeZone(date, getRuntimeHotelTimeZone(), 'es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function cleanPaymentConcept(value) {
  const concept = String(value || '')
    .replace(/\s*-\s*Cliente:.*$/i, '')
    .trim();

  return concept || 'Pago / abono';
}

function formatPaymentMoney(value, currencySymbol = '$') {
  return formatCurrency(Number(value || 0), currencySymbol);
}

function getVisibleConsumosModal() {
  const printButton = document.getElementById('btn-imprimir-pos-local');
  if (!printButton) return null;

  const modalRoot = printButton.closest('#modal-container > div');
  if (modalRoot) return modalRoot;

  return printButton.closest('.bg-white') || null;
}

function getRoomNameFromConsumosModal(modalRoot) {
  const title = modalRoot?.querySelector('h3')?.textContent?.trim() || '';
  return title.replace(/^Detalle de Cuenta:\s*/i, '').trim();
}

function getVisibleClientName(modalRoot) {
  const clientRow = Array.from(modalRoot?.querySelectorAll('p') || [])
    .find((element) => element.textContent?.trim().toLowerCase().startsWith('cliente:'));

  return clientRow?.querySelector('strong')?.textContent?.trim() || 'Consumidor Final';
}

async function loadConsumosPaymentContext(modalRoot) {
  const cached = consumosContextCache.get(modalRoot);
  if (cached) return cached;

  const contextPromise = (async () => {
    const supabase = window.supabase;
    const hotelId = window.hotelIdGlobal;
    const roomName = getRoomNameFromConsumosModal(modalRoot);

    if (!supabase || !hotelId) {
      throw new Error('No está disponible la conexión del hotel para consultar los pagos.');
    }
    if (!roomName) {
      throw new Error('No se pudo identificar la habitación de esta cuenta.');
    }

    const { data: habitacion, error: habitacionError } = await supabase
      .from('habitaciones')
      .select('id, nombre')
      .eq('hotel_id', hotelId)
      .eq('nombre', roomName)
      .maybeSingle();

    if (habitacionError) throw habitacionError;
    if (!habitacion?.id) {
      throw new Error(`No se encontró la habitación ${roomName}.`);
    }

    const { data: reserva, error: reservaError } = await supabase
      .from('reservas')
      .select('id, cliente_nombre, cliente_cedula, cedula, fecha_inicio')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', habitacion.id)
      .in('estado', ACTIVE_RESERVATION_STATES)
      .order('fecha_inicio', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reservaError) throw reservaError;
    if (!reserva?.id) {
      throw new Error(`No se encontró una reserva activa para ${roomName}.`);
    }

    const { data: pagos, error: pagosError } = await supabase
      .from('pagos_reserva')
      .select('id, monto, fecha_pago, concepto')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .order('fecha_pago', { ascending: false });

    if (pagosError) throw pagosError;

    return {
      hotelId,
      roomName,
      habitacion,
      reserva,
      pagos: Array.isArray(pagos) ? pagos : []
    };
  })();

  consumosContextCache.set(modalRoot, contextPromise);

  try {
    return await contextPromise;
  } catch (error) {
    consumosContextCache.delete(modalRoot);
    throw error;
  }
}

function createPaymentHistorySection(context) {
  const section = document.createElement('section');
  section.setAttribute(CONSUMOS_PAYMENT_HISTORY_ATTR, 'true');
  section.className = 'border-t border-gray-200 bg-slate-50 px-4 py-4';

  const header = document.createElement('div');
  header.className = 'mb-3 flex items-center justify-between gap-3';

  const title = document.createElement('h4');
  title.className = 'text-sm font-bold text-gray-800';
  title.textContent = 'Historial de pagos y abonos';

  const count = document.createElement('span');
  count.className = 'text-xs font-semibold text-gray-500';
  count.textContent = `${context.pagos.length} movimiento${context.pagos.length === 1 ? '' : 's'}`;

  header.append(title, count);
  section.appendChild(header);

  if (context.pagos.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'rounded-lg border border-gray-200 bg-white px-3 py-3 text-sm text-gray-500';
    empty.textContent = 'No hay pagos con fecha individual registrados para esta reserva.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white';

  context.pagos.forEach((pago) => {
    const row = document.createElement('div');
    row.className = 'flex items-start justify-between gap-4 px-3 py-2.5';

    const details = document.createElement('div');
    details.className = 'min-w-0';

    const concept = document.createElement('div');
    concept.className = 'truncate text-sm font-semibold text-gray-800';
    concept.textContent = cleanPaymentConcept(pago.concepto);

    const date = document.createElement('div');
    date.className = 'mt-0.5 text-xs text-gray-500';
    date.textContent = formatPaymentDate(pago.fecha_pago);

    const amount = document.createElement('div');
    amount.className = 'whitespace-nowrap text-sm font-bold text-emerald-700';
    amount.textContent = formatPaymentMoney(
      pago.monto,
      window.hotelConfigGlobal?.moneda_local_simbolo
        || window.hotelConfigGlobal?.moneda_local
        || '$'
    );

    details.append(concept, date);
    row.append(details, amount);
    list.appendChild(row);
  });

  section.appendChild(list);
  return section;
}

function findDirectLabelRow(root, label) {
  return Array.from(root?.querySelectorAll('div') || []).find((element) => (
    Array.from(element.childNodes).some((node) => (
      node.nodeType === Node.TEXT_NODE
      && node.textContent?.includes(label)
    ))
  )) || null;
}

function renderLastPaymentDate(modalRoot, context) {
  modalRoot.querySelector('[data-consumos-last-payment]')?.remove();

  const latestPayment = context.pagos[0];
  if (!latestPayment?.fecha_pago) return;

  const paymentsAppliedRow = findDirectLabelRow(modalRoot, 'Pagos aplicados:');
  if (!paymentsAppliedRow) return;

  const lastPayment = document.createElement('div');
  lastPayment.dataset.consumosLastPayment = 'true';
  lastPayment.className = 'text-xs text-gray-500';
  lastPayment.textContent = `Último pago: ${formatPaymentDate(latestPayment.fecha_pago)}`;
  paymentsAppliedRow.insertAdjacentElement('afterend', lastPayment);
}

function renderConsumosPaymentHistory(modalRoot, context) {
  modalRoot.querySelector(`[${CONSUMOS_PAYMENT_HISTORY_ATTR}]`)?.remove();

  const scrollContainer = modalRoot.querySelector('.custom-scrollbar');
  if (!scrollContainer) return;

  scrollContainer.appendChild(createPaymentHistorySection(context));
  renderLastPaymentDate(modalRoot, context);
}

async function enhanceVisibleConsumosModal() {
  const modalRoot = getVisibleConsumosModal();
  if (!modalRoot || modalRoot.dataset.consumosPaymentHistoryState === 'loading') return;
  if (modalRoot.dataset.consumosPaymentHistoryState === 'ready') return;

  modalRoot.dataset.consumosPaymentHistoryState = 'loading';

  try {
    const context = await loadConsumosPaymentContext(modalRoot);
    if (!document.body.contains(modalRoot)) return;
    renderConsumosPaymentHistory(modalRoot, context);
    modalRoot.dataset.consumosPaymentHistoryState = 'ready';
  } catch (error) {
    console.error('[MapaSaldo] No se pudo mostrar el historial de pagos de la cuenta:', error);
    if (document.body.contains(modalRoot)) {
      modalRoot.dataset.consumosPaymentHistoryState = 'error';
    }
  }
}

function parseMoneyFromElement(element) {
  const value = element?.textContent || '';
  const numeric = value.replace(/[^\d-]/g, '');
  return Number(numeric || 0);
}

function getMoneyForLabel(modalRoot, label) {
  const row = findDirectLabelRow(modalRoot, label);
  const boldValue = row?.querySelector('span.font-bold') || row?.querySelector('span');
  return parseMoneyFromElement(boldValue);
}

function getConsumosItemsForPrint(modalRoot) {
  return Array.from(modalRoot.querySelectorAll('tbody tr')).map((row) => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) return null;

    const descriptionSpans = cells[1].querySelectorAll('span');
    const description = descriptionSpans[0]?.textContent?.trim()
      || cells[1].textContent?.trim()
      || 'Ítem';
    const state = descriptionSpans[1]?.textContent?.trim() || '';
    const quantity = Number(cells[2].textContent?.trim() || 1) || 1;
    const total = parseMoneyFromElement(cells[3]);

    return {
      cantidad: quantity,
      nombre: state ? `${description} (${state})` : description,
      total
    };
  }).filter(Boolean);
}

function escapePrintHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatPrintMoney(value) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

async function printConsumosWithPaymentHistory(modalRoot, context, printWindow) {
  const supabase = window.supabase;
  const { data: config, error: configError } = await supabase
    .from('configuracion_hotel')
    .select('*')
    .eq('hotel_id', context.hotelId)
    .maybeSingle();

  if (configError) throw configError;

  const items = getConsumosItemsForPrint(modalRoot);
  const total = getMoneyForLabel(modalRoot, 'Total de cargos:');
  const totalPagado = getMoneyForLabel(modalRoot, 'Pagos aplicados:');
  const saldo = Math.max(0, total - totalPagado);

  const paperSize = String(config?.tamano_papel || '80mm').toLowerCase();
  const thermal = paperSize === '58mm' || paperSize === '80mm';
  const pageWidth = paperSize === '58mm' ? '58mm' : (paperSize === '80mm' ? '74mm' : '100%');
  const fontSize = paperSize === '58mm' ? '10px' : (paperSize === '80mm' ? '11px' : '12px');
  const maxWidth = thermal ? '100%' : '800px';

  const hotelName = escapePrintHtml(config?.nombre_hotel || 'Hotel');
  const nit = escapePrintHtml(config?.nit_rut || '');
  const address = escapePrintHtml(config?.direccion_fiscal || '');
  const phone = escapePrintHtml(config?.telefono_fiscal || '');
  const ticketFooter = escapePrintHtml(config?.pie_ticket || 'Gracias por su visita.');
  const resolution = escapePrintHtml(config?.encabezado_ticket_l1 || '');

  const visibleClientName = getVisibleClientName(modalRoot);
  const clientName = escapePrintHtml(context.reserva?.cliente_nombre || visibleClientName);
  const clientDocument = escapePrintHtml(
    context.reserva?.cedula
      || context.reserva?.cliente_cedula
      || ''
  );
  const roomName = escapePrintHtml(context.roomName);
  const reservationCode = escapePrintHtml(
    context.reserva?.id ? context.reserva.id.split('-')[0].toUpperCase() : '---'
  );
  const issueDate = escapePrintHtml(formatPaymentDate(new Date()));

  const itemRows = items.length > 0
    ? items.map((item) => `
      <tr>
        <td class="col-cant">${escapePrintHtml(item.cantidad)}</td>
        <td class="col-desc">${escapePrintHtml(item.nombre)}</td>
        <td class="col-total">${escapePrintHtml(formatPrintMoney(item.total))}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="3" class="text-center">Sin ítems.</td></tr>';

  const paymentRows = context.pagos.length > 0
    ? context.pagos.map((pago) => `
      <div class="payment-row">
        <div class="payment-main">
          <span>${escapePrintHtml(formatPaymentDate(pago.fecha_pago))}</span>
          <span class="bold">${escapePrintHtml(formatPrintMoney(pago.monto))}</span>
        </div>
        <div class="payment-concept">${escapePrintHtml(cleanPaymentConcept(pago.concepto))}</div>
      </div>
    `).join('')
    : '<div class="text-center">Sin pagos con fecha individual.</div>';

  const html = `
    <html>
      <head>
        <title>Factura POS / Cuenta</title>
        <style>
          @page { margin: ${thermal ? '0' : '15mm'}; size: auto; }
          body {
            font-family: 'Courier New', Courier, monospace;
            font-size: ${fontSize};
            margin: 0;
            padding: ${thermal ? '2px' : '20px'};
            width: ${thermal ? pageWidth : 'auto'};
            color: #000;
            background: #fff;
          }
          .container { width: 100%; max-width: ${maxWidth}; margin: 0 auto; }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .bold { font-weight: bold; }
          .mb-1 { margin-bottom: 5px; }
          .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }
          .border-top { border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px; }
          table { width: 100%; border-collapse: collapse; margin-top: 5px; }
          th { border-bottom: 1px solid #000; padding: 2px 0; font-size: 0.9em; text-align: left; }
          td { padding: 2px 0; vertical-align: top; }
          .col-cant { width: 15%; text-align: center; }
          .col-desc { width: 55%; text-align: left; }
          .col-total { width: 30%; text-align: right; }
          .payment-row { padding: 4px 0; border-bottom: 1px dotted #999; }
          .payment-row:last-child { border-bottom: 0; }
          .payment-main { display: flex; justify-content: space-between; gap: 8px; }
          .payment-concept { margin-top: 1px; font-size: 0.85em; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="text-center mb-1">
            <div class="bold" style="font-size: 1.1em;">${hotelName}</div>
            ${nit ? `<div>NIT: ${nit}</div>` : ''}
            ${address ? `<div>${address}</div>` : ''}
            ${phone ? `<div>Tel: ${phone}</div>` : ''}
            ${resolution ? `<div style="font-size:0.8em; margin-top:2px;">${resolution}</div>` : ''}
          </div>

          <div class="border-bottom mb-1">
            <div class="bold text-center">FACTURA POS / CUENTA</div>
            <div>F: ${issueDate}</div>
            <div>Reserva: #${reservationCode}</div>
            <div>Hab: <b>${roomName}</b></div>
          </div>

          <div class="border-bottom mb-1">
            <div><b>Cliente:</b> ${clientName}</div>
            ${clientDocument ? `<div><b>ID:</b> ${clientDocument}</div>` : ''}
          </div>

          <table>
            <thead>
              <tr>
                <th class="col-cant">Cant</th>
                <th class="col-desc">Desc</th>
                <th class="col-total">Total</th>
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>

          <div class="border-top">
            <div class="bold text-center mb-1">PAGOS / ABONOS</div>
            ${paymentRows}
          </div>

          <div class="border-top">
            <div class="payment-main bold" style="font-size:1.1em;">
              <span>TOTAL:</span><span>${escapePrintHtml(formatPrintMoney(total))}</span>
            </div>
            ${totalPagado > 0 ? `
              <div class="payment-main">
                <span>Pagado:</span><span>${escapePrintHtml(formatPrintMoney(totalPagado))}</span>
              </div>
            ` : ''}
            ${saldo > 0 ? `
              <div class="payment-main bold">
                <span>PENDIENTE:</span><span>${escapePrintHtml(formatPrintMoney(saldo))}</span>
              </div>
            ` : '<div class="text-center bold" style="margin-top:5px;">¡GRACIAS POR SU PAGO!</div>'}
          </div>

          <div class="text-center" style="font-size:0.85em; margin-top:8px;">${ticketFooter}</div>
        </div>
        <script>
          window.onload = function () {
            window.print();
            window.focus();
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
}

async function interceptConsumosPrint(event) {
  const button = event.target?.closest?.('#btn-imprimir-pos-local');
  if (!button) return;

  const modalRoot = getVisibleConsumosModal();
  if (!modalRoot || !modalRoot.contains(button)) return;

  event.preventDefault();
  event.stopPropagation();

  const printWindow = window.open('', '_blank', 'width=800,height=700');
  if (!printWindow) {
    if (window.Swal?.fire) {
      await window.Swal.fire('Impresión bloqueada', 'Permite las ventanas emergentes para imprimir la factura.', 'warning');
    }
    return;
  }

  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparando factura...';

  try {
    const context = await loadConsumosPaymentContext(modalRoot);
    renderConsumosPaymentHistory(modalRoot, context);
    modalRoot.dataset.consumosPaymentHistoryState = 'ready';
    await printConsumosWithPaymentHistory(modalRoot, context, printWindow);
  } catch (error) {
    console.error('[MapaSaldo] No se pudo imprimir la cuenta con historial de pagos:', error);
    try {
      printWindow.close();
    } catch (_) {
      // Ignorar si el navegador ya cerró la ventana.
    }

    if (window.Swal?.fire) {
      await window.Swal.fire('Error', error.message || 'No se pudo imprimir la factura.', 'error');
    } else {
      window.alert(error.message || 'No se pudo imprimir la factura.');
    }
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

function mutationTouchesConsumosModal(mutation) {
  return Array.from(mutation.addedNodes || []).some((node) => {
    if (!(node instanceof Element)) return false;
    return node.matches?.('#btn-imprimir-pos-local')
      || Boolean(node.querySelector?.('#btn-imprimir-pos-local'));
  });
}

function initConsumosPaymentEnhancer() {
  const modalContainer = document.getElementById('modal-container');

  if (modalContainer && typeof MutationObserver !== 'undefined') {
    consumosObserver = new MutationObserver((mutations) => {
      if (mutations.some(mutationTouchesConsumosModal)) {
        queueMicrotask(() => enhanceVisibleConsumosModal());
      }
    });
    consumosObserver.observe(modalContainer, { childList: true, subtree: true });
  }

  document.addEventListener('click', interceptConsumosPrint, true);
  enhanceVisibleConsumosModal();
}

export function initMapaConsumosPagosEnhancer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__MAPA_CONSUMOS_PAGOS_ENHANCER_READY__) return;
  window.__MAPA_CONSUMOS_PAGOS_ENHANCER_READY__ = true;
  initConsumosPaymentEnhancer();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  initMapaConsumosPagosEnhancer();
}
