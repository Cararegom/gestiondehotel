export function configureReservaFechaEntrada(fechaEntradaInput) {
    if (!fechaEntradaInput) return;
    const now = new Date();
    const minDate = new Date(now.getTime() - 15 * 60 * 1000);
    const year = minDate.getFullYear();
    const month = (minDate.getMonth() + 1).toString().padStart(2, '0');
    const day = minDate.getDate().toString().padStart(2, '0');
    const hours = minDate.getHours().toString().padStart(2, '0');
    const minutes = minDate.getMinutes().toString().padStart(2, '0');
    fechaEntradaInput.min = `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function resetReservaFormToCreateMode({
    ui,
    state,
    clearFeedback,
    renderPricingRuleSummary,
    actualizarVisibilidadPago,
    configureFechaEntrada
}) {
    if (ui.form) {
        ui.form.reset();
        if (ui.tipoCalculoDuracionEl) {
            ui.tipoCalculoDuracionEl.value = 'noches_manual';
            ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));
        }
        if (ui.fechaEntradaInput) configureFechaEntrada(ui.fechaEntradaInput);
        if (ui.origenReservaSelect) ui.origenReservaSelect.value = 'directa';

        const esCobroAlCheckin = state.configHotel.cobro_al_checkin;
        ui.togglePaymentFieldsVisibility(esCobroAlCheckin);

        if (esCobroAlCheckin) {
            if (ui.form.elements.tipo_pago) {
                ui.form.elements.tipo_pago.disabled = false;
                ui.form.elements.tipo_pago.value = 'parcial';
                ui.form.elements.tipo_pago.dispatchEvent(new Event('change'));
            }
            if (ui.form.elements.metodo_pago_id) ui.form.elements.metodo_pago_id.disabled = false;
            if (ui.form.elements.monto_abono) ui.form.elements.monto_abono.value = '';
        }
    }
    if (ui.formTitle) ui.formTitle.textContent = 'Registrar Nueva Reserva';
    if (ui.submitButton) ui.submitButton.textContent = 'Registrar Reserva';
    if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'none';

    state.isEditMode = false;
    state.editingReservaId = null;
    state.editingOriginalHabitacionId = null;
    state.currentBookingTotal = 0;
    state.descuentoAplicado = null;
    state.currentPricingRule = null;

    const codigoInput = document.getElementById('codigo-descuento-reserva');
    if (codigoInput) codigoInput.value = '';
    const feedbackEl = document.getElementById('feedback-descuento-reserva');
    if (feedbackEl) clearFeedback(feedbackEl);
    const resumenEl = document.getElementById('descuento-resumen-reserva');
    if (resumenEl) resumenEl.style.display = 'none';

    ui.updateTotalDisplay();
    renderPricingRuleSummary();
    actualizarVisibilidadPago();
    if (ui.pricingRuleForm) {
        ui.pricingRuleForm.reset();
        const originField = ui.pricingRuleForm.querySelector('select[name="origen_reserva"]');
        if (originField) originField.value = '';
        const habitacionField = ui.pricingRuleForm.querySelector('select[name="habitacion_id"]');
        if (habitacionField) habitacionField.value = '';
    }
}

export function getReservaBorderColor(estado) {
    const colors = {
        reservada: 'border-yellow-400',
        confirmada: 'border-green-500',
        activa: 'border-blue-500',
        cancelada: 'border-red-500',
        no_show: 'border-purple-500',
        completada: 'border-gray-400',
        cancelada_mantenimiento: 'border-orange-500',
        finalizada_auto: 'border-slate-400'
    };
    return colors[estado] || 'border-gray-300';
}

export function getReservaBgColor(estado) {
    const colors = {
        reservada: 'bg-yellow-100',
        confirmada: 'bg-green-100',
        activa: 'bg-blue-100',
        cancelada: 'bg-red-100',
        no_show: 'bg-purple-100',
        completada: 'bg-gray-100',
        cancelada_mantenimiento: 'bg-orange-100',
        finalizada_auto: 'bg-slate-100'
    };
    return colors[estado] || 'bg-gray-200';
}

export function getReservaTextColor(estado) {
    const colors = {
        reservada: 'text-yellow-800',
        confirmada: 'text-green-800',
        activa: 'text-blue-800',
        cancelada: 'text-red-800',
        no_show: 'text-purple-800',
        completada: 'text-gray-700',
        cancelada_mantenimiento: 'text-orange-800',
        finalizada_auto: 'text-slate-700'
    };
    return colors[estado] || 'text-gray-700';
}
