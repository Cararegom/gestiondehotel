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

    const confirmed = await ui.showConfirmationModal(`Esta seguro de que desea eliminar permanentemente la reserva de ${reserva.cliente_nombre || 'cliente desconocido'}? Esta accion no se puede deshacer y tambien eliminara los pagos asociados.`);
    if (!confirmed) return;

    showLoading(ui.feedbackDiv, 'Eliminando reserva y pagos asociados...');

    const { error: errPagos } = await state.supabase.from('pagos_reserva').delete().eq('reserva_id', reservaId);
    if (errPagos) {
        clearFeedback(ui.feedbackDiv);
        throw new Error(`Error al eliminar pagos de la reserva: ${errPagos.message}. La reserva no fue eliminada.`);
    }

    const { error: deleteError } = await state.supabase.from('reservas').delete().eq('id', reservaId);
    clearFeedback(ui.feedbackDiv);
    if (deleteError) throw new Error(`Error al eliminar la reserva: ${deleteError.message}`);

    if (['activa', 'confirmada', 'reservada'].includes(reserva.estado) && reserva.habitacion_id) {
        const { error: errHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: 'libre' })
            .eq('id', reserva.habitacion_id);
        if (errHab) console.warn('Advertencia al actualizar estado de habitacion tras eliminar reserva:', errHab.message);
    }

    const successMessage = 'Reserva y sus pagos asociados eliminados exitosamente.';
    showSuccess(ui.feedbackDiv, successMessage);
    await registrarEnBitacora({
        supabase: state.supabase,
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id,
        modulo: 'Reservas',
        accion: 'ELIMINAR_RESERVA',
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
        const { error: errHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: nuevoEstadoHabitacion })
            .eq('id', habitacionIdReserva);
        if (errHab) {
            msgExito += ` (Pero hubo un error actualizando la habitacion: ${errHab.message})`;
        } else {
            habActualizada = true;
            msgExito += ` Estado de habitacion actualizado a ${nuevoEstadoHabitacion}.`;
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

    const { data: pagos, error: errPagos } = await state.supabase
        .from('pagos_reserva')
        .select('id')
        .eq('reserva_id', reservaId);

    if (errPagos) {
        throw new Error(`Error buscando pagos para cancelar: ${errPagos.message}`);
    }

    if (pagos && pagos.length > 0) {
        const idsDePagos = pagos.map((pago) => pago.id);

        const { error: errCaja } = await state.supabase
            .from('caja')
            .delete()
            .in('pago_reserva_id', idsDePagos);

        if (errCaja) {
            throw new Error(`Error revirtiendo ingresos en caja: ${errCaja.message}`);
        }

        const { error: errPagosDelete } = await state.supabase
            .from('pagos_reserva')
            .delete()
            .eq('reserva_id', reservaId);

        if (errPagosDelete) {
            throw new Error(`Error eliminando el historial de pagos de la reserva: ${errPagosDelete.message}`);
        }
    }

    const ahora = new Date().toISOString();
    const { error: updateError } = await state.supabase
        .from('reservas')
        .update({
            estado: 'cancelada',
            monto_pagado: 0,
            actualizado_en: ahora,
            cancelado_por_usuario_id: state.currentUser.id,
            fecha_cancelacion: ahora
        })
        .eq('id', reservaId);

    if (updateError) {
        throw new Error(`Error al actualizar el estado de la reserva: ${updateError.message}`);
    }

    if (habitacionId) {
        const { error: errHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: 'libre' })
            .eq('id', habitacionId);

        if (errHab) {
            console.warn('Advertencia: Reserva cancelada, pero hubo un error al liberar la habitacion.', errHab);
        }
    }

    const successMessage = 'Reserva cancelada y pagos revertidos exitosamente.';
    showSuccess(ui.feedbackDiv, successMessage);
    await renderReservas();
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'reservas', accion: 'cancel' } }));
    return successMessage;
}
