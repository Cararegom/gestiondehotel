import { notificarHabitacionLiberada } from '../../services/NotificationService.js';
import { buildOperationScope, completeStableOperation, getStableOperationId } from '../../services/fase1OperationService.js';

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

    const updatesReserva = { estado: nuevoEstadoReserva, actualizado_en: new Date().toISOString() };

    if (nuevoEstadoReserva === 'activa') {
        const { data: reservaOriginal, error: errFetchOriginal } = await state.supabase
            .from('reservas')
            .select('fecha_inicio, fecha_fin')
            .eq('id', reservaId)
            .single();

        if (errFetchOriginal || !reservaOriginal) {
            clearFeedback(ui.feedbackDiv);
            throw new Error('Error obteniendo datos originales de la reserva para el check-in.');
        }

        const fechaInicioOriginal = new Date(reservaOriginal.fecha_inicio);
        const fechaFinOriginal = new Date(reservaOriginal.fecha_fin);
        const duracionOriginalMs = fechaFinOriginal.getTime() - fechaInicioOriginal.getTime();

        const nuevaFechaInicio = new Date();
        updatesReserva.fecha_inicio = nuevaFechaInicio.toISOString();
        updatesReserva.fecha_fin = new Date(nuevaFechaInicio.getTime() + duracionOriginalMs).toISOString();
    }

    if (nuevoEstadoReserva === 'completada') {
        updatesReserva.fecha_fin = new Date().toISOString();
    }

    const { error: errRes } = await state.supabase.from('reservas').update(updatesReserva).eq('id', reservaId);
    clearFeedback(ui.feedbackDiv);
    if (errRes) throw new Error(`Error actualizando estado de la reserva: ${errRes.message}`);

    const successLabels = {
        confirmada: 'Reserva confirmada correctamente.',
        activa: 'Check-in realizado correctamente.',
        completada: 'Check-out realizado correctamente.',
        no_show: 'Reserva marcada como No Presentado.'
    };

    let msgExito = successLabels[nuevoEstadoReserva] || `Reserva actualizada a ${nuevoEstadoReserva}.`;
    let habActualizada = false;

    if (habitacionIdReserva && nuevoEstadoHabitacion) {
        const { data: habitacionActualizada, error: errHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: nuevoEstadoHabitacion })
            .eq('id', habitacionIdReserva)
            .select('id, nombre')
            .single();
        if (errHab) {
            msgExito += ` (Pero hubo un error actualizando la habitacion: ${errHab.message})`;
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
