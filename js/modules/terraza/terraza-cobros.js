import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { turnoService } from '../../services/turnoService.js';
import { imprimirTicketOperacion } from '../../services/thermalPrintService.js';

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
  const metodoNombre = options.metodoNombre || pedido.metodo?.nombre || 'Metodo';
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
    tipLabel: 'Propina sugerida',
    total,
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
    doc.text(`Propina sugerida: ${money(propina)}`, 380, totalLineY, { align: 'left' });
    totalLineY += 22;
    doc.setFontSize(13);
    doc.text(`Total a cobrar: ${money(total)}`, 380, totalLineY, { align: 'left' });
  } else {
    doc.setFontSize(13);
    doc.text(`Total a cobrar: ${money(total)}`, 380, totalLineY, { align: 'left' });
  }

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
    const inputOptions = Object.fromEntries(metodos.map((metodo) => [metodo.id, metodo.nombre || 'Sin nombre']));
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
  const metodo = state.metodosPago.find((item) => item.id === metodoPagoId);
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

  const { data, error } = await state.supabase.rpc('cerrar_pedido_terraza', {
    p_pedido_id: pedido.id,
    p_metodo_pago_id: metodoPagoId,
    p_usuario_id: state.user.id,
    p_turno_id: turno.id,
    p_propina_monto: propinaMonto,
    p_propina_sugerida_monto: propinaSugerida
  });

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
