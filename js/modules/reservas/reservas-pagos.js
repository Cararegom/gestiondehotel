import { formatCurrency } from '../../uiUtils.js';
import { turnoService } from '../../services/turnoService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

function getCurrencyArgs(configHotel = {}) {
  return [
    configHotel?.moneda_local_simbolo || '$',
    configHotel?.moneda_codigo_iso_info || 'COP',
    parseInt(configHotel?.moneda_decimales_info || 0, 10)
  ];
}

export async function showPagoMixtoModal({
  totalAPagar,
  metodosPago,
  configHotel,
  onConfirm,
  onCancel
}) {
  const modalContainer = document.getElementById('modal-container-secondary');
  if (!modalContainer) {
    throw new Error('No se encontró el contenedor del modal secundario.');
  }

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = '';

  let metodosArray = Array.isArray(metodosPago) ? metodosPago : [];
  if (metodosArray.length === 0 && metodosPago && metodosPago.length) {
    metodosArray = Array.from(metodosPago);
  }

  const metodosDisponibles = metodosArray.filter((mp) => mp.id !== 'mixto' && mp.id);
  if (metodosDisponibles.length === 0) {
    Swal.fire('Error', 'No hay métodos de pago válidos disponibles para realizar un pago mixto.', 'error');
    modalContainer.style.display = 'none';
    return;
  }

  const opcionesMetodosHTML = metodosDisponibles
    .map((mp) => `<option value="${mp.id}">${mp.nombre}</option>`)
    .join('');

  const [currencySymbol] = getCurrencyArgs(configHotel);
  const modalContent = document.createElement('div');
  modalContent.className = 'bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto animate-fade-in-up';
  modalContent.innerHTML = `
    <form id="form-pago-mixto">
      <h3 class="text-xl font-bold mb-2 text-indigo-700">Pago Mixto</h3>
      <p class="mb-4 text-gray-600">Divida el total de <strong class="text-2xl">${formatCurrency(totalAPagar, currencySymbol)}</strong>.</p>
      <div id="lista-pagos-mixtos" class="space-y-3 pr-2 max-h-60 overflow-y-auto"></div>
      <button type="button" id="btn-agregar-pago-mixto" class="button button-neutral w-full mt-4 text-sm py-2">Agregar Otro Método</button>
      <hr class="my-4">
      <div class="flex justify-between items-center text-lg font-bold">
        <span class="text-gray-700">Total Cubierto:</span>
        <span id="total-cubierto-mixto">${formatCurrency(0, currencySymbol)}</span>
      </div>
      <div class="flex justify-between items-center text-lg font-bold mt-1">
        <span class="text-gray-700">Faltante por Pagar:</span>
        <span id="faltante-pago-mixto" class="text-red-600">${formatCurrency(totalAPagar, currencySymbol)}</span>
      </div>
      <div class="flex gap-3 mt-6">
        <button type="submit" id="btn-confirmar-pago-mixto" class="button button-success flex-1 py-2.5" disabled>Confirmar Pago</button>
        <button type="button" id="btn-cancelar-pago-mixto" class="button button-danger flex-1 py-2.5">Cancelar</button>
      </div>
    </form>
  `;
  modalContainer.appendChild(modalContent);

  const formMixto = modalContent.querySelector('#form-pago-mixto');
  const listaPagosDiv = modalContent.querySelector('#lista-pagos-mixtos');
  const btnConfirmar = modalContent.querySelector('#btn-confirmar-pago-mixto');

  const closeModal = () => {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
  };

  const actualizarTotalesMixtos = () => {
    let totalCubierto = 0;
    listaPagosDiv.querySelectorAll('input.monto-pago-mixto').forEach((input) => {
      totalCubierto += Number(input.value) || 0;
    });
    const faltante = totalAPagar - totalCubierto;
    modalContent.querySelector('#total-cubierto-mixto').textContent = formatCurrency(totalCubierto, currencySymbol);
    const faltanteEl = modalContent.querySelector('#faltante-pago-mixto');

    if (Math.abs(faltante) < 0.01) {
      btnConfirmar.disabled = false;
      faltanteEl.textContent = formatCurrency(0, currencySymbol);
      faltanteEl.className = 'text-green-600';
    } else {
      btnConfirmar.disabled = true;
      faltanteEl.textContent = formatCurrency(faltante, currencySymbol);
      faltanteEl.className = faltante > 0 ? 'text-red-600' : 'text-orange-500';
    }
  };

  const agregarFilaDePago = (montoInicial = 0) => {
    const newRow = document.createElement('div');
    newRow.className = 'pago-mixto-row flex items-center gap-2';
    newRow.innerHTML = `
      <select class="form-control flex-grow">${opcionesMetodosHTML}</select>
      <input type="number" class="form-control w-32 monto-pago-mixto" placeholder="Monto" min="0" step="any" value="${montoInicial > 0 ? montoInicial.toFixed(2) : ''}">
      <button type="button" class="btn-remover-pago-mixto text-red-500 hover:text-red-700 text-2xl font-bold">&times;</button>
    `;
    listaPagosDiv.appendChild(newRow);

    newRow.querySelector('.btn-remover-pago-mixto').onclick = () => {
      newRow.remove();
      actualizarTotalesMixtos();
    };
    newRow.querySelector('.monto-pago-mixto').addEventListener('input', actualizarTotalesMixtos);

    if (listaPagosDiv.children.length > 1) {
      newRow.querySelector('select').selectedIndex = 0;
    }
  };

  modalContent.querySelector('#btn-agregar-pago-mixto').onclick = agregarFilaDePago;

  agregarFilaDePago(totalAPagar);
  actualizarTotalesMixtos();

  modalContent.querySelector('#btn-cancelar-pago-mixto').onclick = () => {
    closeModal();
    if (typeof onCancel === 'function') {
      onCancel();
    }
  };

  formMixto.onsubmit = async (event) => {
    event.preventDefault();
    btnConfirmar.disabled = true;
    btnConfirmar.textContent = 'Procesando...';

    const pagosFinales = [];
    listaPagosDiv.querySelectorAll('.pago-mixto-row').forEach((row) => {
      const selectEl = row.querySelector('select');
      const montoInput = row.querySelector('input');
      const metodoId = selectEl.value;
      const monto = parseFloat(montoInput.value) || 0;

      if (metodoId && metodoId !== 'mixto' && monto > 0) {
        pagosFinales.push({ metodo_pago_id: metodoId, monto });
      }
    });

    if (!pagosFinales.length) {
      Swal.fire('Error', 'No se ha definido ningún pago válido o los montos son 0.', 'error');
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Pago';
      return;
    }

    try {
      await onConfirm(pagosFinales);
      closeModal();
    } catch (error) {
      console.error('Error en pago mixto:', error);
      btnConfirmar.disabled = false;
      btnConfirmar.textContent = 'Confirmar Pago';
      Swal.fire('Error', 'Hubo un problema al procesar el pago. Intente nuevamente.', 'error');
    }
  };
}

export async function mostrarModalAbonoReserva({
  reservaActual,
  supabase,
  hotelId,
  currentUser,
  configHotel,
  onRefresh
}) {
  const [currencySymbol, currencyCode, currencyDecimals] = getCurrencyArgs(configHotel);

  const { data: metodosPago, error: metodosPagoError } = await supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('nombre');

  if (metodosPagoError || !metodosPago?.length) {
    Swal.fire('Error', 'No hay métodos de pago activos configurados en el sistema.', 'error');
    return;
  }

  const opcionesMetodoPago = metodosPago
    .map((metodoPago) => `<option value="${metodoPago.id}">${metodoPago.nombre}</option>`)
    .join('');

  const { data: pagosExistentes, error: pagosExistentesError } = await supabase
    .from('pagos_reserva')
    .select('monto')
    .eq('reserva_id', reservaActual.id);

  if (pagosExistentesError) {
    Swal.fire('Error', 'No se pudieron cargar los pagos existentes para esta reserva.', 'error');
    return;
  }

  const totalAbonado = pagosExistentes
    ? pagosExistentes.reduce((sum, pago) => sum + Number(pago.monto), 0)
    : 0;
  const montoPendiente = Math.max(0, (reservaActual.monto_total || 0) - totalAbonado);

  if (montoPendiente === 0 && reservaActual.monto_total > 0) {
    Swal.fire('Información', 'Esta reserva ya ha sido pagada en su totalidad.', 'info');
    return;
  }

  const { value: formValue, isConfirmed } = await Swal.fire({
    title: `Registrar Abono para ${reservaActual.cliente_nombre}`,
    html: `
      <p class="mb-2 text-sm">Reserva ID: <span class="font-mono">${reservaActual.id.substring(0, 8)}</span></p>
      <p class="mb-2 text-sm">Total Reserva: <strong class="text-blue-600">${formatCurrency(reservaActual.monto_total, currencySymbol, currencyCode, currencyDecimals)}</strong></p>
      <p class="mb-2 text-sm">Total Abonado: <strong class="text-green-600">${formatCurrency(totalAbonado, currencySymbol, currencyCode, currencyDecimals)}</strong></p>
      <p class="mb-4 text-lg">Pendiente: <strong class="text-red-600">${formatCurrency(montoPendiente, currencySymbol, currencyCode, currencyDecimals)}</strong></p>
      <input id="swal-abono-monto" class="swal2-input" type="number" min="1" ${montoPendiente > 0 ? `max="${montoPendiente}"` : ''} placeholder="Valor a abonar (máx. ${formatCurrency(montoPendiente, currencySymbol, currencyCode, currencyDecimals)})" value="${montoPendiente > 0 ? montoPendiente : ''}">
      <select id="swal-metodo-pago" class="swal2-input">
        <option value="">Seleccione método de pago...</option>
        ${opcionesMetodoPago}
      </select>`,
    focusConfirm: false,
    preConfirm: () => {
      const monto = parseFloat(document.getElementById('swal-abono-monto').value) || 0;
      const metodo = document.getElementById('swal-metodo-pago').value;
      if (monto <= 0) {
        Swal.showValidationMessage('El monto del abono debe ser mayor a cero.');
        return false;
      }
      if (montoPendiente > 0 && monto > montoPendiente) {
        Swal.showValidationMessage(`El monto no puede exceder el pendiente de ${formatCurrency(montoPendiente, currencySymbol, currencyCode, currencyDecimals)}.`);
        return false;
      }
      if (!metodo) {
        Swal.showValidationMessage('Debe seleccionar un método de pago.');
        return false;
      }
      return { monto, metodo };
    },
    confirmButtonText: 'Registrar Abono',
    showCancelButton: true,
    cancelButtonText: 'Cancelar'
  });

  if (!isConfirmed || !formValue) return;

  const { data: nuevoPago, error: errorAbono } = await supabase
    .from('pagos_reserva')
    .insert({
      reserva_id: reservaActual.id,
      monto: formValue.monto,
      metodo_pago_id: formValue.metodo,
      fecha_pago: new Date().toISOString(),
      hotel_id: hotelId,
      usuario_id: currentUser.id
    })
    .select()
    .single();

  if (errorAbono) {
    Swal.fire('Error', `No se pudo registrar el abono en la reserva: ${errorAbono.message}`, 'error');
    return;
  }

  const nuevoTotalAbonado = totalAbonado + formValue.monto;
  const { error: updateReservaError } = await supabase
    .from('reservas')
    .update({ monto_pagado: nuevoTotalAbonado, actualizado_en: new Date().toISOString() })
    .eq('id', reservaActual.id);

  if (updateReservaError) {
    Swal.fire('Advertencia', `Abono registrado, pero hubo un error actualizando el total pagado de la reserva: ${updateReservaError.message}`, 'warning');
  }

  const turnoId = turnoService.getActiveTurnId();
  let movimientoCajaOk = false;

  if (!turnoId) {
    Swal.fire('Advertencia', 'Abono registrado en la reserva, pero NO se registró en caja (No hay turno activo). Registre el ingreso manualmente en caja.', 'warning');
  } else {
    const movimientoCaja = {
      hotel_id: hotelId,
      tipo: 'ingreso',
      monto: formValue.monto,
      concepto: `Abono Reserva ${reservaActual.cliente_nombre} (#${reservaActual.id.substring(0, 8)})`,
      referencia: reservaActual.id,
      metodo_pago_id: formValue.metodo,
      usuario_id: currentUser.id,
      turno_id: turnoId,
      reserva_id: reservaActual.id,
      pago_reserva_id: nuevoPago.id
    };

    const { error: cajaError } = await supabase.from('caja').insert(movimientoCaja);
    if (cajaError) {
      Swal.fire('Advertencia', `Abono registrado en reserva, pero hubo un error al registrar el movimiento en caja: ${cajaError.message}`, 'warning');
    } else {
      movimientoCajaOk = true;
    }
  }

  if (movimientoCajaOk) {
    Swal.fire('¡Éxito!', 'Abono registrado exitosamente en la reserva y en la caja.', 'success');
  }

  await registrarEnBitacora({
    supabase,
    hotel_id: hotelId,
    usuario_id: currentUser.id,
    modulo: 'Reservas',
    accion: 'REGISTRAR_ABONO',
    detalles: {
      reserva_id: reservaActual.id,
      monto_abonado: formValue.monto,
      metodo_pago_id: formValue.metodo
    }
  });

  if (typeof onRefresh === 'function') {
    await onRefresh();
  }

  document.dispatchEvent(new CustomEvent('datosActualizados', {
    detail: { origen: 'reservas', accion: 'abono' }
  }));
}
