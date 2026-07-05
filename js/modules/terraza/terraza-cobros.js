import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';
import { imprimirTicketOperacion } from '../../services/thermalPrintService.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

function buildReceiptItems(pedido, deps) {
  const { getItemDisplayName, getPedidoItems } = deps;
  return getPedidoItems(pedido).map((item) => ({
    nombre: getItemDisplayName(item),
    cantidad: item.cantidad,
    precio: item.precio_unitario,
    total: item.subtotal
  }));
}

export async function printOrderReceipt(pedido, deps, options = {}) {
  const {
    getPedidoItems,
    totalPedido,
    getPedidoEstadoMeta,
    getPedidoSuggestedTipAmount,
    getPedidoTipAmount,
    getTipInputAmount,
    numberOrZero,
    getReservaForPedido,
    getPedidoReservaSaldo,
    getPedidoLocationLabel,
    getReservaAnticipo,
    money,
    state
  } = deps;

  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para imprimir.');
  }

  const subtotal = totalPedido(pedido);
  const estadoMeta = getPedidoEstadoMeta(pedido);
  const paid = options.paid ?? pedido.estado === 'pagado';
  const metodoNombre = options.metodoNombre
    || (Array.isArray(pedido.pagos_mixtos) && pedido.pagos_mixtos.length ? 'Pago mixto' : null)
    || pedido.metodo?.nombre
    || 'Metodo';
  const suggestedTip = getPedidoSuggestedTipAmount(pedido);
  const storedTip = getPedidoTipAmount(pedido);
  const defaultTip = pedido.estado === 'abierto'
    ? getTipInputAmount(storedTip || suggestedTip)
    : storedTip;
  const propina = Math.max(0, numberOrZero(options.propinaMonto ?? defaultTip));
  const reserva = getReservaForPedido(pedido);
  const anticipoAplicado = Math.min(subtotal, numberOrZero(options.anticipoAplicado ?? getPedidoReservaSaldo(pedido)));
  const saldoConsumo = Math.max(0, subtotal - anticipoAplicado);
  const total = saldoConsumo + propina;
  const statusNote = pedido.estado === 'cancelado'
    ? 'Cuenta cancelada. No debe cobrarse nuevamente sin reapertura.'
    : (paid ? 'Cuenta pagada.' : 'Recibo previo al cobro.');
  const payments = [];
  if (paid && anticipoAplicado > 0) {
    payments.push({ label: 'Anticipo consumible', amount: anticipoAplicado });
  }
  if (paid && total > 0) {
    payments.push({ label: metodoNombre, amount: total });
  }

  await imprimirTicketOperacion({
    supabase: state.supabase,
    hotelId: state.hotelId,
    documentLabel: paid ? 'Ticket Terraza' : estadoMeta.documentLabel,
    clientName: pedido.cliente_nombre || null,
    meta: [
      { label: 'Ubicacion', value: getPedidoLocationLabel(pedido) },
      { label: 'Estado', value: paid ? 'Pagado' : estadoMeta.receiptStatus }
    ],
    items: buildReceiptItems(pedido, deps),
    subtotal,
    discount: anticipoAplicado,
    tip: propina,
    tipLabel: 'Propina voluntaria',
    total,
    totalLabel: 'TOTAL A PAGAR',
    payments,
    notes: reserva
      ? `${statusNote} Reserva: ${reserva.cliente_nombre || 'cliente'} - anticipo consumible ${money(getReservaAnticipo(reserva))}.`
      : statusNote
  });
}

export function downloadOrderReceiptPdf(pedido, deps) {
  const {
    canDownloadPdf,
    getItemDisplayName,
    getPedidoItems,
    getPedidoEstadoMeta,
    getPedidoReservaSaldo,
    getPedidoSuggestedTipAmount,
    getPedidoTipAmount,
    getSafeFileName,
    getTipInputAmount,
    getPedidoLocationLabel,
    money,
    totalPedido
  } = deps;

  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para descargar.');
  }
  if (!canDownloadPdf()) {
    throw new Error('La descarga en PDF esta desactivada en Configuracion de Terraza.');
  }
  if (typeof window.jspdf === 'undefined') {
    throw new Error('La libreria jsPDF no esta cargada. No se puede generar el PDF.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const subtotal = totalPedido(pedido);
  const estadoMeta = getPedidoEstadoMeta(pedido);
  const suggestedTip = getPedidoSuggestedTipAmount(pedido);
  const storedTip = getPedidoTipAmount(pedido);
  const propina = pedido.estado === 'abierto' ? getTipInputAmount(storedTip || suggestedTip) : storedTip;
  const anticipoAplicado = Math.min(subtotal, getPedidoReservaSaldo(pedido));
  const total = Math.max(0, subtotal - anticipoAplicado) + propina;
  const locationLabel = getPedidoLocationLabel(pedido);
  const items = getPedidoItems(pedido).map((item) => [
    getItemDisplayName(item),
    String(item.cantidad || 0),
    money(item.precio_unitario),
    money(item.subtotal)
  ]);

  doc.setFontSize(18);
  doc.text(pedido.estado === 'pagado' ? 'Ticket Terraza' : estadoMeta.documentLabel, 40, 44);
  doc.setFontSize(10);
  doc.text(`Ubicacion: ${locationLabel}`, 40, 64);
  doc.text(`Estado: ${estadoMeta.receiptStatus}`, 40, 80);
  doc.text(`Fecha: ${new Date().toLocaleString('es-CO')}`, 40, 96);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      startY: 116,
      head: [['Producto', 'Cant.', 'Precio', 'Subtotal']],
      body: items,
      theme: 'grid',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 }
    });
  } else {
    doc.setFontSize(10);
    let y = 116;
    items.forEach((row) => {
      doc.text(`${row[1]} x ${row[0]} - ${row[3]}`, 40, y);
      y += 16;
    });
  }

  const finalY = (doc.lastAutoTable?.finalY || 140) + 24;
  doc.setFontSize(11);
  doc.text(`Subtotal: ${money(subtotal)}`, 380, finalY, { align: 'left' });
  let totalLineY = finalY + 18;
  if (anticipoAplicado > 0) {
    doc.text(`Anticipo consumible: -${money(anticipoAplicado)}`, 380, totalLineY, { align: 'left' });
    totalLineY += 18;
  }
  if (propina > 0) {
    doc.text(`Propina voluntaria: ${money(propina)}`, 380, totalLineY, { align: 'left' });
    totalLineY += 22;
  }
  doc.setDrawColor(22, 101, 52);
  doc.setLineWidth(2);
  doc.roundedRect(36, totalLineY - 16, 540, 42, 5, 5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(
    `TOTAL A PAGAR: ${money(total)}`,
    48,
    totalLineY + 10,
    { align: 'left' }
  );

  const suffix = new Date().toISOString().slice(0, 10);
  doc.save(`recibo-terraza-${getSafeFileName(locationLabel)}-${suffix}.pdf`);
}

export async function choosePaymentMethod(deps) {
  const { getMetodosPagoActivos, render, state } = deps;
  const metodos = getMetodosPagoActivos();
  if (!metodos.length) {
    throw new Error('No hay metodos de pago activos. Activalos o crealos en Configuracion.');
  }

  if (typeof Swal !== 'undefined') {
    const opciones = metodos.length > 1
      ? [...metodos, { id: 'mixto', nombre: 'Pago mixto' }]
      : metodos;
    const inputOptions = Object.fromEntries(opciones.map((metodo) => [metodo.id, metodo.nombre || 'Sin nombre']));
    const result = await Swal.fire({
      title: 'Metodo de pago',
      input: 'radio',
      inputOptions,
      inputValue: state.selectedMetodoPagoId || metodos[0].id,
      showCancelButton: true,
      confirmButtonText: 'Seleccionar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
      inputValidator: (value) => (!value ? 'Selecciona un metodo de pago.' : undefined)
    });

    if (result.isConfirmed && result.value) {
      state.selectedMetodoPagoId = result.value;
      render();
    }
    return;
  }

  const opciones = metodos.map((metodo, index) => `${index + 1}. ${metodo.nombre}`).join('\n');
  const seleccionado = window.prompt(`Selecciona el metodo de pago:\n${opciones}`);
  const indice = Number(seleccionado) - 1;
  if (metodos[indice]) {
    state.selectedMetodoPagoId = metodos[indice].id;
    render();
  }
}

async function collectMixedPayments(totalAPagar, metodos, money) {
  if (typeof Swal === 'undefined') {
    throw new Error('El pago mixto requiere el selector de pagos de la aplicacion.');
  }

  const opciones = metodos.map((metodo) => (
    `<option value="${escapeAttribute(metodo.id)}">${escapeHtml(metodo.nombre || 'Metodo')}</option>`
  )).join('');

  const result = await Swal.fire({
    title: 'Pago mixto',
    html: `
      <div class="text-left">
        <p class="mb-3 text-sm text-slate-600">Distribuye exactamente <strong>${money(totalAPagar)}</strong> entre los metodos recibidos.</p>
        <div id="terraza-pagos-mixtos" class="space-y-2"></div>
        <button type="button" id="terraza-agregar-pago" class="mt-3 w-full rounded-lg border border-blue-200 px-3 py-2 text-sm font-bold text-blue-700">+ Agregar metodo</button>
        <div class="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <div class="flex justify-between"><span>Cubierto</span><strong id="terraza-pago-cubierto">${money(0)}</strong></div>
          <div class="mt-1 flex justify-between"><span>Faltante</span><strong id="terraza-pago-faltante" class="text-red-600">${money(totalAPagar)}</strong></div>
        </div>
      </div>`,
    showCancelButton: true,
    confirmButtonText: 'Confirmar cobro',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#16a34a',
    focusConfirm: false,
    didOpen: () => {
      const popup = Swal.getPopup();
      const list = popup.querySelector('#terraza-pagos-mixtos');
      const addRow = (amount = '') => {
        const row = document.createElement('div');
        row.className = 'terraza-pago-row grid grid-cols-[1fr_130px_32px] gap-2';
        row.innerHTML = `
          <select class="form-control">${opciones}</select>
          <input type="number" min="0.01" step="0.01" class="form-control terraza-pago-monto" value="${escapeAttribute(String(amount))}" placeholder="Monto">
          <button type="button" class="rounded text-xl font-bold text-red-600" aria-label="Quitar pago">&times;</button>`;
        row.querySelector('button').addEventListener('click', () => {
          row.remove();
          updateTotals();
        });
        list.appendChild(row);
      };
      const updateTotals = () => {
        const covered = [...list.querySelectorAll('.terraza-pago-monto')]
          .reduce((sum, input) => sum + Number(input.value || 0), 0);
        const missing = totalAPagar - covered;
        popup.querySelector('#terraza-pago-cubierto').textContent = money(covered);
        const missingEl = popup.querySelector('#terraza-pago-faltante');
        missingEl.textContent = money(missing);
        missingEl.className = Math.abs(missing) < 0.01 ? 'text-green-600' : 'text-red-600';
      };
      popup.querySelector('#terraza-agregar-pago').addEventListener('click', () => {
        addRow();
        updateTotals();
      });
      list.addEventListener('input', updateTotals);
      list.addEventListener('change', updateTotals);
      addRow(totalAPagar);
      addRow();
      updateTotals();
    },
    preConfirm: () => {
      const rows = [...Swal.getPopup().querySelectorAll('.terraza-pago-row')];
      const pagos = rows.map((row) => ({
        metodo_pago_id: row.querySelector('select').value,
        monto: Number(row.querySelector('input').value || 0)
      })).filter((pago) => pago.monto > 0);
      const totalCubierto = pagos.reduce((sum, pago) => sum + pago.monto, 0);
      if (pagos.length < 2) {
        Swal.showValidationMessage('Agrega al menos dos pagos con monto.');
        return false;
      }
      if (new Set(pagos.map((pago) => pago.metodo_pago_id)).size !== pagos.length) {
        Swal.showValidationMessage('No repitas el mismo metodo; suma su monto en una sola fila.');
        return false;
      }
      if (Math.abs(totalCubierto - totalAPagar) >= 0.01) {
        Swal.showValidationMessage(`Los pagos deben sumar exactamente ${money(totalAPagar)}.`);
        return false;
      }
      return pagos;
    }
  });

  return result.isConfirmed ? result.value : null;
}

export async function paySelectedOrder(deps) {
  const {
    getPedidoReservaSaldo,
    getPedidoSeleccionado,
    getPedidoItems,
    getSelectedLocationLabel,
    getSuggestedTip,
    getTipInputAmount,
    money,
    refreshAndRender,
    showFeedback,
    state,
    totalPedido
  } = deps;

  const pedido = getPedidoSeleccionado();
  if (!pedido || !getPedidoItems(pedido).length) {
    throw new Error('No hay consumos para cobrar.');
  }

  const metodoPagoId = state.selectedMetodoPagoId;
  let metodo = state.metodosPago.find((item) => item.id === metodoPagoId);
  const total = totalPedido(pedido);
  const propinaSugerida = getSuggestedTip(total);
  const propinaMonto = getTipInputAmount(propinaSugerida);
  const anticipoAplicado = Math.min(total, getPedidoReservaSaldo(pedido));
  const saldoAConsumir = Math.max(0, total - anticipoAplicado);
  const saldoACobrar = saldoAConsumir + propinaMonto;
  const label = getSelectedLocationLabel();

  if (saldoACobrar > 0 && !metodoPagoId) {
    throw new Error('Selecciona un metodo de pago para el saldo pendiente.');
  }

  const turno = await turnoService.getTurnoAbierto(state.supabase, state.user.id, state.hotelId);
  if (!turno) {
    throw new Error('No hay un turno de caja abierto. Abre turno en Caja antes de cobrar.');
  }

  let pagosMixtos = null;
  if (metodoPagoId === 'mixto' && saldoACobrar > 0) {
    pagosMixtos = await collectMixedPayments(saldoACobrar, state.metodosPago.filter((item) => item.activo !== false), money);
    if (!pagosMixtos) return;
    metodo = {
      id: 'mixto',
      nombre: pagosMixtos.map((pago) => {
        const nombre = state.metodosPago.find((item) => item.id === pago.metodo_pago_id)?.nombre || 'Metodo';
        return `${nombre}: ${money(pago.monto)}`;
      }).join(' + ')
    };
  }

  const rpcName = pagosMixtos ? 'cerrar_pedido_terraza_mixto' : 'cerrar_pedido_terraza';
  const rpcParams = {
    p_pedido_id: pedido.id,
    p_usuario_id: state.user.id,
    p_turno_id: turno.id,
    p_propina_monto: propinaMonto,
    p_propina_sugerida_monto: propinaSugerida,
    ...(pagosMixtos
      ? { p_pagos: pagosMixtos }
      : { p_metodo_pago_id: metodoPagoId === 'mixto' ? null : metodoPagoId })
  };
  const { data, error } = await state.supabase.rpc(rpcName, rpcParams);

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo cobrar la cuenta.');

  await registrarEnBitacora({
    supabase: state.supabase,
    hotel_id: state.hotelId,
    usuario_id: state.user.id,
    modulo: 'Terraza',
    accion: 'Cobro de cuenta',
    detalles: {
      pedido_id: pedido.id,
      total,
      anticipo_aplicado: anticipoAplicado,
      saldo_consumo_cobrado: saldoAConsumir,
      propina_monto: propinaMonto,
      total_cobrado: saldoACobrar,
      pagos: pagosMixtos || [{ metodo_pago_id: metodoPagoId, monto: saldoACobrar }],
      ubicacion: label
    }
  });

  try {
    await printOrderReceipt(
      { ...pedido, estado: 'pagado', metodo, propina_monto: propinaMonto, propina_sugerida_monto: propinaSugerida },
      deps,
      { paid: true, metodoNombre: metodo?.nombre || 'Metodo', propinaMonto, anticipoAplicado }
    );
  } catch (printError) {
    console.warn('[Terraza] No se pudo imprimir el ticket:', printError);
  }

  await refreshAndRender();
  showFeedback(`Cuenta cerrada. Anticipo aplicado: ${money(anticipoAplicado)}. Cobrado ahora: ${money(saldoACobrar)}.`, 'success');
}
