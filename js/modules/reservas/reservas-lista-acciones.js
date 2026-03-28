export async function handleReservaListActions({
    event,
    ui,
    state,
    formatCurrency,
    prepareEditReserva,
    cancelarReservaConReembolso,
    handleUpdateEstadoReserva,
    puedeHacerCheckIn,
    mostrarModalAbonoReserva,
    handleDeleteReserva
}) {
    const btn = event.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const reservaId = btn.getAttribute('data-id');
    const habitacionId = btn.getAttribute('data-habitacion-id') || null;

    btn.disabled = true;
    const originalButtonText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-tiny"></span>';

    try {
        switch (action) {
            case 'editar':
                await prepareEditReserva(reservaId);
                break;

            case 'cancelar_reserva': {
                const confirmCancel = await ui.showConfirmationModal('Esta seguro de cancelar esta reserva? Cualquier pago o abono registrado sera revertido de la caja.');
                if (confirmCancel) {
                    await cancelarReservaConReembolso(reservaId, habitacionId);
                }
                break;
            }

            case 'confirmar':
                await handleUpdateEstadoReserva(reservaId, 'confirmada', null, habitacionId);
                break;

            case 'checkin': {
                const puedeCheckin = await puedeHacerCheckIn(reservaId);
                if (!puedeCheckin && state.configHotel.cobro_al_checkin) {
                    if (ui.feedbackDiv) {
                        ui.feedbackDiv.innerHTML = `<div class="error-indicator">Debe registrar el pago completo de la reserva para poder hacer Check-in.</div>`;
                    }
                    Swal.fire({
                        title: 'Pago Pendiente',
                        html: `La politica del hotel requiere el pago completo (${formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$')}) antes del Check-in. <br/>Por favor, registre el pago restante utilizando el boton "Abonar".`,
                        icon: 'warning',
                        confirmButtonText: 'Entendido'
                    });
                    return;
                }
                const confirmCheckin = await ui.showConfirmationModal('Confirmar Check-in para esta reserva? La habitacion se marcara como ocupada.');
                if (confirmCheckin) {
                    await handleUpdateEstadoReserva(reservaId, 'activa', 'ocupada', habitacionId);
                }
                break;
            }

            case 'checkout': {
                const { data: reservaCheckout, error: errCheckout } = await state.supabase
                    .from('reservas')
                    .select('monto_total, monto_pagado')
                    .eq('id', reservaId)
                    .single();

                if (errCheckout || !reservaCheckout) {
                    if (ui.feedbackDiv) {
                        ui.feedbackDiv.innerHTML = '<div class="error-indicator">Error al obtener detalles de la reserva para el checkout.</div>';
                    }
                    return;
                }

                const pendienteCheckout = (reservaCheckout.monto_total || 0) - (reservaCheckout.monto_pagado || 0);
                if (pendienteCheckout > 0) {
                    Swal.fire({
                        title: 'Pago Pendiente en Checkout',
                        html: `Esta reserva tiene un saldo pendiente de <strong>${formatCurrency(pendienteCheckout, state.configHotel?.moneda_local_simbolo || '$')}</strong>.<br/>Debe saldar la cuenta antes de completar el Check-out. Use el boton "Abonar".`,
                        icon: 'error',
                        confirmButtonText: 'Entendido'
                    });
                    return;
                }

                const confirmCheckout = await ui.showConfirmationModal("Confirmar Check-out para esta reserva? La reserva se marcara como completada y la habitacion como 'limpieza'.");
                if (confirmCheckout) {
                    await handleUpdateEstadoReserva(reservaId, 'completada', 'limpieza', habitacionId);
                }
                break;
            }

            case 'abonar': {
                const { data: reservaActual, error: errRA } = await state.supabase
                    .from('reservas')
                    .select('*')
                    .eq('id', reservaId)
                    .single();
                if (errRA || !reservaActual) throw new Error('Reserva no encontrada para abonar.');
                await mostrarModalAbonoReserva(reservaActual);
                break;
            }

            case 'no_show': {
                const confirmNoShow = await ui.showConfirmationModal("Marcar esta reserva como 'No Presentado'? La habitacion se liberara, pero el dinero registrado NO se devolvera.");
                if (confirmNoShow) {
                    await handleUpdateEstadoReserva(reservaId, 'no_show', 'libre', habitacionId, true);
                }
                break;
            }

            case 'eliminar':
                await handleDeleteReserva(reservaId);
                break;

            case 'ver_detalles':
                ui.showInfoModal(`Funcionalidad "Ver Detalles" para reserva ${reservaId.substring(0, 8)} aun no implementada.`, 'En Desarrollo');
                break;

            default:
                console.warn('Accion no reconocida en lista de reservas:', action);
        }
    } catch (err) {
        console.error(`Error en accion '${action}' para reserva ${reservaId}:`, err);
        if (ui.feedbackDiv) {
            ui.feedbackDiv.innerHTML = `<div class="error-indicator">${err.message}</div>`;
        }
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalButtonText;
    }
}
