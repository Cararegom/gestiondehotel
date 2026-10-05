import { notificarHabitacionLiberada } from '../../services/NotificationService.js';
import { buildOperationScope, completeStableOperation, getStableOperationId } from '../../services/fase1OperationService.js';
import {
    finalizarEstanciaReservaAtomica,
    realizarCheckinReservaAtomico
} from '../../services/reservationLifecycleService.js';

async function cancelarConReversion(supabase, reservaId, reason) {
    const scope = buildOperationScope('cancelar-reserva', { reservaId, reason });
    const { data, error } = await supabase.rpc('cancelar_reserva_con_reversion', {
        p_reserva_id: reservaId, p_reason: reason, p_client_operation_id: getStableOperationId(scope)
    });
    if (error) throw error;
    completeStableOperation(scope);
    return data;
}

export async function handleReservaDelete({
    reservaId,
    ui,
    state,
    showLoading,
    clearFeedback,
    showSuccess,
    registrarEnBitacora,
    resetFormToCreateMode,
    renderReservas
}) {
    const { data: reserva, error: fetchError } = await state.supabase
        .from('reservas')
        .select('cliente_nombre, habitacion_id, estado')
        .eq('id', reservaId)
        .single();

    if (fetchError || !reserva) {
        throw new Error(`No se encontro la reserva a eliminar (ID: ${reservaId.substring(0, 8)}).`);
    }

    const confirmed = await ui.showConfirmationModal(`¿Cancelar la reserva de ${reserva.cliente_nombre || 'cliente desconocido'}? Los pagos y movimientos originales se conservarán y cualquier dinero cobrado se revertirá.`);
    if (!confirmed) return;

    showLoading(ui.feedbackDiv, 'Cancelando reserva y creando reversiones...');
    await cancelarConReversion(state.supabase, reservaId, 'Cancelación solicitada desde Reservas');
    clearFeedback(ui.feedbackDiv);
    const successMessage = 'Reserva cancelada; la evidencia financiera original fue conservada.';
    showSuccess(ui.feedbackDiv, successMessage);
    await registrarEnBitacora({
        supabase: state.supabase,
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id,
        modulo: 'Reservas',
        accion: 'CANCELAR_RESERVA_CON_REVERSION',
        detalles: { reserva_id: reservaId, cliente: reserva.cliente_nombre, habitacion_id: reserva.habitacion_id }
    });

    resetFormToCreateMode();
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'delete' } }));
    return successMessage;
}

export async function handleReservaEstadoUpdate({
    reservaId,
    nuevoEstadoReserva,
    nuevoEstadoHabitacion,
    habitacionIdReserva,
    ui,
    state,
    showLoading,
    clearFeedback,
    showSuccess,
    registrarEnBitacora,
    resetFormToCreateMode,
    renderReservas
}) {
    if (!ui.feedbackDiv) return;
    showLoading(ui.feedbackDiv, `Actualizando estado a ${nuevoEstadoReserva}...`);

    let lifecycleResult = null;
    let directTransition = false;
    try {
        if (nuevoEstadoReserva === 'activa') {
            lifecycleResult = await realizarCheckinReservaAtomico(state.supabase, reservaId);
        } else if (nuevoEstadoReserva === 'completada') {
            lifecycleResult = await finalizarEstanciaReservaAtomica(state.supabase, {
                reservaId,
                estadoFinal: 'completada'
            });
        } else {
            directTransition = true;
            const { error: errRes } = await state.supabase
                .from('reservas')
                .update({ estado: nuevoEstadoReserva, actualizado_en: new Date().toISOString() })
                .eq('id', reservaId);
            if (errRes) throw new Error(`Error actualizando estado de la reserva: ${errRes.message}`);
        }
    } finally {
        clearFeedback(ui.feedbackDiv);
    }

    const successLabels = {
        confirmada: 'Reserva confirmada correctamente.',
        activa: 'Check-in realizado correctamente.',
        completada: 'Check-out realizado correctamente.',
        no_show: 'Reserva marcada como No Presentado.'
    };

    let msgExito = successLabels[nuevoEstadoReserva] || `Reserva actualizada a ${nuevoEstadoReserva}.`;
    let habActualizada = false;

    if (lifecycleResult?.habitacion) {
        habActualizada = lifecycleResult.habitacion;
        msgExito += ` Estado de habitacion actualizado a ${lifecycleResult.habitacion.estado}.`;

        if (nuevoEstadoReserva === 'completada') {
            try {
                await notificarHabitacionLiberada(state.supabase, {
                    hotelId: state.hotelId,
                    habitacion: lifecycleResult.habitacion,
                    actor: state.currentUser
                });
            } catch (notificationError) {
                console.error('El checkout se completó, pero falló la notificación:', notificationError);
                msgExito += ' No se pudo enviar la notificacion al equipo de limpieza.';
            }
        }
    } else if (habitacionIdReserva && nuevoEstadoHabitacion) {
        const { data: habitacionActualizada, error: errHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: nuevoEstadoHabitacion })
            .eq('id', habitacionIdReserva)
            .select('id, nombre')
            .single();
        if (errHab) {
            throw new Error(`Error actualizando el estado de la habitacion: ${errHab.message}`);
        } else {
            habActualizada = true;
            msgExito += ` Estado de habitacion actualizado a ${nuevoEstadoHabitacion}.`;

            if (nuevoEstadoReserva === 'completada' && nuevoEstadoHabitacion === 'limpieza') {
                await notificarHabitacionLiberada(state.supabase, {
                    hotelId: state.hotelId,
                    habitacion: habitacionActualizada,
                    actor: state.currentUser
                });
            }
        }
    }

    showSuccess(ui.feedbackDiv, msgExito);
    if (directTransition) {
        await registrarEnBitacora({
            supabase: state.supabase,
            hotel_id: state.hotelId,
            usuario_id: state.currentUser.id,
            modulo: 'Reservas',
            accion: `CAMBIO_ESTADO_RESERVA_${nuevoEstadoReserva.toUpperCase()}`,
            detalles: {
                reserva_id: reservaId,
                nuevo_estado_reserva: nuevoEstadoReserva,
                habitacion_id: habitacionIdReserva,
                nuevo_estado_hab: nuevoEstadoHabitacion
            }
        });
    }

    resetFormToCreateMode();
    await renderReservas();
    if (habActualizada) {
        document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'updateEstado' } }));
    }
    return msgExito;
}

export async function cancelarReservaConReembolsoFlow({
    reservaId,
    habitacionId,
    ui,
    state,
    showLoading,
    showSuccess,
    renderReservas
}) {
    if (!ui.feedbackDiv) return;
    showLoading(ui.feedbackDiv, 'Cancelando y revirtiendo pagos...');

    await cancelarConReversion(state.supabase, reservaId, 'Cancelación con reembolso desde estado de reserva');

    const successMessage = 'Reserva cancelada y pagos revertidos exitosamente.';
    showSuccess(ui.feedbackDiv, successMessage);
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'cancel' } }));
    return successMessage;
}
