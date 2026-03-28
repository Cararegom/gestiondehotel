export function gatherReservaFormData(ui) {
    if (!ui.form) return {};
    const formElements = ui.form.elements;

    const clienteIdSeleccionado = ui.clienteIdHiddenInput?.value || null;
    let nombreCliente = formElements.cliente_nombre?.value || '';
    let cedulaCliente = formElements.cedula?.value || '';
    let telefonoCliente = formElements.telefono?.value || '';

    if (clienteIdSeleccionado && ui.clienteNombreDisplay && !ui.clienteNombreDisplay.classList.contains('hidden')) {
        nombreCliente = ui.clienteNombreDisplay.querySelector('#selected_client_name')?.textContent || nombreCliente;
    }

    const habitacionSelect = formElements.habitacion_id;
    let habitacionInfoDOM = null;

    if (habitacionSelect && habitacionSelect.selectedIndex >= 0) {
        const selectedOption = habitacionSelect.options[habitacionSelect.selectedIndex];
        if (selectedOption.value) {
            habitacionInfoDOM = {
                id: selectedOption.value,
                precio_general: parseFloat(selectedOption.getAttribute('data-precio') || '0'),
                precio_1_persona: parseFloat(selectedOption.getAttribute('data-precio-1') || '0'),
                precio_2_personas: parseFloat(selectedOption.getAttribute('data-precio-2') || '0'),
                tipo_habitacion_id: selectedOption.getAttribute('data-tipo-habitacion-id') || null,
                capacidad_base: parseFloat(selectedOption.getAttribute('data-capacidad-base') || '2'),
                capacidad_maxima: parseFloat(selectedOption.getAttribute('data-capacidad-maxima') || '10'),
                precio_huesped_adicional: parseFloat(selectedOption.getAttribute('data-precio-extra') || '0')
            };
        }
    }

    return {
        cliente_id: clienteIdSeleccionado,
        cliente_nombre: nombreCliente,
        cedula: cedulaCliente,
        telefono: telefonoCliente,
        habitacion_id: formElements.habitacion_id?.value || '',
        habitacion_info_dom: habitacionInfoDOM,
        fecha_entrada: formElements.fecha_entrada?.value || '',
        tipo_calculo_duracion: formElements.tipo_calculo_duracion?.value || 'noches_manual',
        cantidad_noches: formElements.cantidad_noches?.value || '1',
        tiempo_estancia_id: formElements.tiempo_estancia_id?.value || '',
        cantidad_huespedes: formElements.cantidad_huespedes?.value || '1',
        metodo_pago_id: formElements.metodo_pago_id?.value || '',
        tipo_pago: formElements.tipo_pago?.value || 'parcial',
        monto_abono: formElements.monto_abono?.value || '0',
        notas: formElements.notas?.value || '',
        precio_libre_toggle: formElements.precio_libre_toggle?.checked || false,
        precio_libre_valor: formElements.precio_libre_valor?.value || '0',
        origen_reserva: formElements.origen_reserva?.value || 'directa'
    };
}

export function validateReservaInitialInputs({ formData, state, formatCurrency }) {
    if (!formData.cliente_id && !formData.cliente_nombre.trim()) {
        throw new Error('El nombre del cliente es obligatorio o debe seleccionar un cliente existente.');
    }

    if (!formData.habitacion_id) throw new Error('Debe seleccionar una habitacion.');
    if (!formData.fecha_entrada) throw new Error('La fecha y hora de llegada son obligatorias.');

    const fechaEntradaDate = new Date(formData.fecha_entrada);
    if (Number.isNaN(fechaEntradaDate.getTime())) throw new Error('La fecha de llegada no es valida.');

    const unDiaEnMs = 24 * 60 * 60 * 1000;
    if (!state.isEditMode && fechaEntradaDate < new Date(Date.now() - 10 * 60 * 1000)) {
        throw new Error('La fecha y hora de llegada no pueden ser en el pasado para nuevas reservas.');
    } else if (state.isEditMode && fechaEntradaDate < new Date(Date.now() - 7 * unDiaEnMs)) {
        throw new Error('Al editar, la fecha y hora de llegada no pueden ser mas de 7 dias en el pasado.');
    }

    if (formData.tipo_calculo_duracion === 'noches_manual' && (!formData.cantidad_noches || parseInt(formData.cantidad_noches, 10) < 1)) {
        throw new Error('La cantidad de noches debe ser al menos 1.');
    }
    if (formData.tipo_calculo_duracion === 'tiempo_predefinido' && !formData.tiempo_estancia_id) {
        throw new Error('Debe seleccionar un tiempo de estancia predefinido.');
    }
    if (!formData.cantidad_huespedes || parseInt(formData.cantidad_huespedes, 10) < 1) {
        throw new Error('La cantidad de huespedes debe ser al menos 1.');
    }

    if (state.configHotel.cobro_al_checkin && !state.isEditMode) {
        const montoAbonoNum = parseFloat(formData.monto_abono) || 0;
        if (formData.tipo_pago === 'completo' && state.currentBookingTotal > 0 && !formData.metodo_pago_id) {
            throw new Error("Si selecciona 'Pago completo' y hay un total a pagar, debe elegir un metodo de pago.");
        }
        if (formData.tipo_pago === 'parcial' && montoAbonoNum > 0 && !formData.metodo_pago_id) {
            throw new Error('Si registra un abono mayor a cero, debe seleccionar un metodo de pago.');
        }
        if (montoAbonoNum < 0) {
            throw new Error('El monto del abono no puede ser negativo.');
        }
        if (montoAbonoNum > state.currentBookingTotal && state.currentBookingTotal > 0) {
            throw new Error(`El abono (${formatCurrency(montoAbonoNum, state.configHotel?.moneda_local_simbolo || '$')}) no puede exceder el total de la reserva (${formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$')}).`);
        }
    }
}

export async function submitReservaForm({
    event,
    ui,
    state,
    turnoService,
    setFormLoadingState,
    clearFeedback,
    showError,
    showSuccess,
    validateAndCalculateBooking,
    createBooking,
    updateBooking,
    showPagoMixtoModal,
    showReservaSuccessModal,
    renderReservas,
    resetFormToCreateMode,
    gatherFormData,
    validateInitialInputs
}) {
    event.preventDefault();
    if (!ui.form || !ui.feedbackDiv || !ui.submitButton) return;

    const originalButtonText = ui.submitButton.textContent;
    setFormLoadingState(ui.form, true, ui.submitButton, originalButtonText, state.isEditMode ? 'Actualizando...' : 'Registrando...');
    clearFeedback(ui.feedbackDiv);

    try {
        const formData = gatherFormData();
        validateInitialInputs(formData);
        const bookingPayload = await validateAndCalculateBooking(formData);

        const montoTotalCosto = state.currentBookingTotal;
        const metodoPagoId = formData.metodo_pago_id;
        const tipoPago = formData.tipo_pago;

        const seIntentaPagar = (tipoPago === 'completo' && montoTotalCosto > 0) ||
            (tipoPago === 'parcial' && parseFloat(formData.monto_abono) > 0);

        if (state.configHotel.cobro_al_checkin && seIntentaPagar) {
            const turnoId = turnoService.getActiveTurnId();
            if (!turnoId) {
                throw new Error('ACCION BLOQUEADA: No hay un turno de caja activo para procesar el pago.');
            }
        }

        if (!state.isEditMode && state.configHotel.cobro_al_checkin && tipoPago === 'completo' && montoTotalCosto > 0) {
            if (metodoPagoId === 'mixto') {
                setFormLoadingState(ui.form, false, ui.submitButton, originalButtonText);

                const { data: metodosPagoDB, error: errDB } = await state.supabase
                    .from('metodos_pago')
                    .select('id, nombre')
                    .eq('hotel_id', state.hotelId)
                    .eq('activo', true)
                    .order('nombre');

                if (errDB) throw new Error('Error al cargar metodos de pago.');

                const metodosPagoList = metodosPagoDB || [];
                metodosPagoList.unshift({ id: 'mixto', nombre: 'Pago Mixto' });

                await showPagoMixtoModal(montoTotalCosto, metodosPagoList, async (pagosMixtos) => {
                    bookingPayload.datosPago.pagosMixtos = pagosMixtos;
                    await createBooking(bookingPayload);
                    showSuccess(ui.feedbackDiv, 'Reserva creada exitosamente con pago mixto.');
                    await showReservaSuccessModal('La reserva fue confirmada correctamente.');
                    resetFormToCreateMode();
                    await renderReservas();
                    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'create' } }));
                });
                return;
            }

            bookingPayload.datosPago.pagosMixtos = [{
                metodo_pago_id: metodoPagoId,
                monto: montoTotalCosto
            }];
        } else if (!state.isEditMode && state.configHotel.cobro_al_checkin && tipoPago === 'parcial' && parseFloat(formData.monto_abono) > 0) {
            bookingPayload.datosPago.pagosMixtos = [{
                metodo_pago_id: metodoPagoId,
                monto: parseFloat(formData.monto_abono)
            }];
        } else {
            bookingPayload.datosPago.pagosMixtos = [];
        }

        if (state.isEditMode) {
            await updateBooking(bookingPayload);
            showSuccess(ui.feedbackDiv, 'Reserva actualizada exitosamente.');
        } else {
            await createBooking(bookingPayload);
            showSuccess(ui.feedbackDiv, 'Reserva creada exitosamente.');
            await showReservaSuccessModal('La reserva fue confirmada correctamente.');
        }

        resetFormToCreateMode();
        await renderReservas();
        document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: state.isEditMode ? 'update' : 'create' } }));
    } catch (err) {
        console.error('Error en submit:', err);
        showError(ui.feedbackDiv, err.message);
    } finally {
        if (ui.form.elements.metodo_pago_id.value !== 'mixto' || state.isEditMode) {
            setFormLoadingState(ui.form, false, ui.submitButton, originalButtonText);
        }
    }
}
