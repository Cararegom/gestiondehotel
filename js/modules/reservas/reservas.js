// js/modules/reservas/reservas.js
import {
    showError,
    showSuccess,
    showLoading,
    clearFeedback,
    setFormLoadingState,
    formatCurrency,
    formatDateTime,
    formatMinutesToHoursMinutes,
    registrarUsoDescuento 
} from '../../uiUtils.js';
import { turnoService } from '../../services/turnoService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { showClienteSelectorModal, mostrarFormularioCliente } from '../clientes/clientes.js';
import { syncReservasConGoogleCalendar as syncReservasConGoogleCalendarModule } from './reservas-sync.js';
import {
    calculateFechasEstancia as calculateFechasEstanciaModule,
    calculateMontos as calculateMontosModule,
    validateAndCalculateBooking as validateAndCalculateBookingModule
} from './reservas-calculos.js';
import { buscarDescuentoParaReserva as buscarDescuentoParaReservaModule } from './reservas-descuentos.js';
import {
    cargarHabitaciones as cargarHabitacionesModule,
    cargarMetodosPago as cargarMetodosPagoModule,
    cargarTiemposEstancia as cargarTiemposEstanciaModule,
    loadInitialData as loadInitialDataModule
} from './reservas-data.js';
import {
    showPagoMixtoModal as showPagoMixtoModalModule,
    mostrarModalAbonoReserva as mostrarModalAbonoReservaModule
} from './reservas-pagos.js';
import {
    getReservaRegistroISO as getReservaRegistroISOModule,
    getReservaFilterDateISO as getReservaFilterDateISOModule,
    getDateMsSafe as getDateMsSafeModule,
    hasActiveReservaFilters as hasActiveReservaFiltersModule,
    ensureReservasHistorialUsuarios as ensureReservasHistorialUsuariosModule,
    cargarTurnosParaReservas as cargarTurnosParaReservasModule,
    enriquecerReservasConHistorial as enriquecerReservasConHistorialModule,
    filtrarReservasHistorial as filtrarReservasHistorialModule,
    poblarRecepcionistasFiltro as poblarRecepcionistasFiltroModule,
    poblarTurnosFiltro as poblarTurnosFiltroModule,
    updateReservasHistorySummary as updateReservasHistorySummaryModule,
    updateReservasExperiencePanels as updateReservasExperiencePanelsModule,
    syncReservaFiltersFromUI as syncReservaFiltersFromUIModule,
    applyReservaFiltersToUI as applyReservaFiltersToUIModule
} from './reservas-historial.js';
import {
    renderReservasGrupo as renderReservasGrupoModule,
    buildReservasListHtml
} from './reservas-render.js';
import { getAccionesReservaHTML as getAccionesReservaHTMLModule } from './reservas-acciones.js';
import {
    gatherReservaFormData,
    validateReservaInitialInputs,
    submitReservaForm
} from './reservas-formulario.js';
import { handleReservaListActions } from './reservas-lista-acciones.js';
import {
    configureReservaFechaEntrada,
    resetReservaFormToCreateMode,
    getReservaBorderColor,
    getReservaBgColor,
    getReservaTextColor
} from './reservas-ui.js';
import {
    handleReservaDelete,
    handleReservaEstadoUpdate,
    cancelarReservaConReembolsoFlow
} from './reservas-estado.js';
import {
    RESERVA_ORIGIN_OPTIONS,
    getReservaOriginLabel,
    getReservaOriginFunnelStage,
    getReservaToleranceStatus,
    getWaitlistPriorityLabel,
    suggestRoomsForWaitlistItem
} from './reservas-operacion.js';
import { escapeHtml } from '../../security.js';
// --- MÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œDULO DE ESTADO GLOBAL ---
const state = {
    isModuleMounted: false,
    isEditMode: false,
    editingReservaId: null,
    editingOriginalHabitacionId: null,
    descuentoAplicado: null,
    tiemposEstanciaDisponibles: [],
    reservasHistorialUsuarios: [],
    reservasHistorialTurnos: [],
    pricingRules: [],
    currentPricingRule: null,
    waitlistItems: [],
    waitlistSuggestionsCache: {},
    pricingRulesAvailable: true,
    waitlistAvailable: true,
    reservaFiltros: {
        busqueda: '',
        fechaDesde: '',
        fechaHasta: '',
        recepcionistaId: '',
        turnoId: '',
        estado: '',
        modoFecha: 'registro',
        origenReserva: ''
    },
    currentUser: null,
    hotelId: null,
    supabase: null,
    currentBookingTotal: 0,
    configHotel: {
        cobro_al_checkin: true,
        checkin_hora_config: "15:00",
        checkout_hora_config: "12:00",
        impuestos_incluidos_en_precios: false,
        porcentaje_impuesto_principal: 0,
        nombre_impuesto_principal: null,
        tipo_turno_global: 12,
        moneda_local_simbolo: '$',      // Nuevo, con default
        moneda_codigo_iso_info: 'COP',  // Nuevo, con default
        moneda_decimales_info: '0',     // Nuevo, con default
        minutos_tolerancia_llegada: 60,
        minutos_alerta_reserva: 120,
        minutos_alerta_checkout: 30
    }
};

// --- MÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œDULO DE UI (VISTA) ---
function getEstadoHabitacionSegunReservaPendiente(fechaInicio) {
    const inicioReserva = new Date(fechaInicio || '');
    if (Number.isNaN(inicioReserva.getTime())) {
        return 'libre';
    }

    const ahora = new Date();
    const dosHorasMs = 2 * 60 * 60 * 1000;
    const tiempoFaltante = inicioReserva.getTime() - ahora.getTime();
    const limiteLlegada = new Date(
        inicioReserva.getFullYear(),
        inicioReserva.getMonth(),
        inicioReserva.getDate(),
        23,
        59,
        59,
        999
    );
    const reservaPendienteMismoDia = tiempoFaltante <= 0 && ahora.getTime() <= limiteLlegada.getTime();

    return (tiempoFaltante > 0 && tiempoFaltante <= dosHorasMs) || reservaPendienteMismoDia
        ? 'reservada'
        : 'libre';
}

const ui = {
    container: null, form: null, feedbackDiv: null, formTitle: null,
    submitButton: null, cancelEditButton: null, reservasListEl: null,
    fechaEntradaInput: null, tipoCalculoDuracionEl: null, nochesManualContainer: null,
    cantidadNochesInput: null, tiempoPredefinidoContainer: null, tiempoEstanciaIdSelect: null,
    habitacionIdSelect: null, totalReservaDisplay: null,
    fieldsetPago: null,
    reservasFiltrosForm: null,
    reservasSearchInput: null,
    reservasFechaModoSelect: null,
    reservasFechaDesdeInput: null,
    reservasFechaHastaInput: null,
    reservasRecepcionistaSelect: null,
    reservasTurnoSelect: null,
    reservasEstadoSelect: null,
    reservasOrigenSelect: null,
    reservasClearFiltersButton: null,
    reservasSummaryEl: null,
    origenReservaSelect: null,
    pricingRuleSummary: null,
    pricingRulesPanel: null,
    pricingRuleForm: null,
    waitlistListEl: null,
    waitlistSummaryEl: null,
    waitlistActionButton: null,
    // AquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ declaramos las variables para los nuevos elementos del selector de clientes
    clienteSearchInput: null,
    btnBuscarCliente: null,
    btnCrearCliente: null,
    clienteIdHiddenInput: null,
    clienteNombreDisplay: null, // Este es el div que contiene el span del nombre seleccionado
    
    init(containerEl) {
        // Es crucial que containerEl no sea null y que el HTML ya estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â© inyectado
        if (!containerEl) {
            console.error("ui.init: El contenedor del mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³dulo es null. No se pueden inicializar los elementos de la UI.");
            return;
        }
        this.container = containerEl;
        this.form = containerEl.querySelector('#reserva-form');
        this.feedbackDiv = containerEl.querySelector('#reserva-feedback');
        this.formTitle = containerEl.querySelector('#form-title');
        this.submitButton = containerEl.querySelector('#submit-button');
        this.cancelEditButton = containerEl.querySelector('#cancel-edit-button');
        this.reservasListEl = containerEl.querySelector('#reservas-list');
        this.fechaEntradaInput = containerEl.querySelector('#fecha_entrada');
        this.tipoCalculoDuracionEl = containerEl.querySelector('#tipo_calculo_duracion');
        this.nochesManualContainer = containerEl.querySelector('#noches-manual-container');
        this.cantidadNochesInput = containerEl.querySelector('#cantidad_noches');
        this.tiempoPredefinidoContainer = containerEl.querySelector('#tiempo-predefinido-container');
        this.tiempoEstanciaIdSelect = containerEl.querySelector('#tiempo_estancia_id');
        this.habitacionIdSelect = containerEl.querySelector('#habitacion_id');
        this.totalReservaDisplay = containerEl.querySelector('#total-reserva-calculado-display');
        this.fieldsetPago = containerEl.querySelector('#fieldset-pago-adicionales');
        this.reservasFiltrosForm = containerEl.querySelector('#reservas-history-filters');
        this.reservasSearchInput = containerEl.querySelector('#reservas_search');
        this.reservasFechaModoSelect = containerEl.querySelector('#reservas_fecha_modo');
        this.reservasFechaDesdeInput = containerEl.querySelector('#reservas_fecha_desde');
        this.reservasFechaHastaInput = containerEl.querySelector('#reservas_fecha_hasta');
        this.reservasRecepcionistaSelect = containerEl.querySelector('#reservas_recepcionista');
        this.reservasTurnoSelect = containerEl.querySelector('#reservas_turno');
        this.reservasEstadoSelect = containerEl.querySelector('#reservas_estado_filter');
        this.reservasOrigenSelect = containerEl.querySelector('#reservas_origen_filter');
        this.reservasClearFiltersButton = containerEl.querySelector('#btn-limpiar-filtros-reservas');
        this.reservasSummaryEl = containerEl.querySelector('#reservas-history-summary');
        this.origenReservaSelect = containerEl.querySelector('#origen_reserva');
        this.pricingRuleSummary = containerEl.querySelector('#pricing-rule-summary');
        this.pricingRulesPanel = containerEl.querySelector('#pricing-rules-panel');
        this.pricingRuleForm = containerEl.querySelector('#pricing-rule-form');
        this.waitlistListEl = containerEl.querySelector('#reservas-waitlist-list');
        this.waitlistSummaryEl = containerEl.querySelector('#reservas-waitlist-summary');
        this.waitlistActionButton = containerEl.querySelector('#btn-enviar-lista-espera');
        this.cedulaInput = containerEl.querySelector('#cedula');
        this.clienteSearchInput = containerEl.querySelector('#cliente_search_input'); // Nuevo input de bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsqueda
        this.btnBuscarCliente = containerEl.querySelector('#btn_buscar_cliente');     // BotÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsqueda
        this.btnCrearCliente = containerEl.querySelector('#btn_crear_cliente');       // BotÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para crear cliente
        this.clienteIdHiddenInput = containerEl.querySelector('#cliente_id_hidden');  // Input oculto para guardar el cliente_id
        this.clienteNombreDisplay = containerEl.querySelector('#cliente_nombre_display'); // Para mostrar el nombre del cliente seleccionado
        if (!this.form) console.error("ui.init: #reserva-form es null.");
        if (!this.clienteNombreDisplay) console.error("ui.init: #cliente_nombre_display es null.");
        if (!this.clienteSearchInput) console.error("ui.init: #cliente_search_input es null.");
   
    },
    async showConfirmationModal(message, title = "Confirmar accion") {
        if (typeof Swal !== 'undefined') {
            const result = await Swal.fire({
                title,
                text: message,
                icon: 'warning',
                showCancelButton: true,
                confirmButtonColor: '#3085d6',
                cancelButtonColor: '#d33',
                confirmButtonText: 'Si, continuar',
                cancelButtonText: 'No, cancelar'
            });
            return result.isConfirmed;
        }
        return window.confirm(message);
    },

    showInfoModal(message, title = "Informacion") {
        if (typeof Swal !== 'undefined') Swal.fire(title, message, 'info');
        else alert(title + '\n\n' + message);
    },

   // REEMPLAZA ESTA FUNCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN EN EL OBJETO ui
updateTotalDisplay(montoDescontado = 0) {
    if (!this.totalReservaDisplay) return;

    // Actualiza el total principal
    this.totalReservaDisplay.textContent = formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0));

    // Muestra u oculta el resumen del descuento
    const descuentoResumenEl = document.getElementById('descuento-resumen-reserva');
    if (descuentoResumenEl) {
        if (state.descuentoAplicado && montoDescontado > 0) {
            descuentoResumenEl.innerHTML = `
                <span class="font-semibold">${state.descuentoAplicado.nombre}:</span>
                <span class="font-bold">-${formatCurrency(montoDescontado, state.configHotel?.moneda_local_simbolo || '$')}</span>
            `;
            descuentoResumenEl.style.display = 'block';
        } else {
            descuentoResumenEl.style.display = 'none';
        }
    }

    // Muestra la informaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de impuestos
    let impuestoMsg = "";
    if (state.configHotel.porcentaje_impuesto_principal > 0 && state.configHotel.nombre_impuesto_principal) {
        impuestoMsg = state.configHotel.impuestos_incluidos_en_precios
            ? `(Incluye ${state.configHotel.nombre_impuesto_principal})`
            : `(+ ${state.configHotel.porcentaje_impuesto_principal}% ${state.configHotel.nombre_impuesto_principal})`;
    }
    this.totalReservaDisplay.innerHTML += ` <small class="text-gray-500 text-xs ml-1">${impuestoMsg}</small>`;

    const totalSupportEl = document.getElementById('reserva-total-support');
    if (totalSupportEl) {
        if (state.currentBookingTotal > 0) {
            if (state.descuentoAplicado && montoDescontado > 0) {
                totalSupportEl.textContent = `Descuento aplicado por ${formatCurrency(montoDescontado, state.configHotel?.moneda_local_simbolo || '$')}.`;
            } else if (impuestoMsg) {
                totalSupportEl.textContent = impuestoMsg.replace(/[()]/g, '');
            } else {
                totalSupportEl.textContent = 'Total listo para registrar o cobrar.';
            }
        } else {
            totalSupportEl.textContent = 'Completa los datos principales para calcular el valor.';
        }
    }

    const totalCaptionEl = document.getElementById('reserva-total-caption');
    if (totalCaptionEl) {
        totalCaptionEl.textContent = state.isEditMode ? 'Total estimado de la reserva editada' : 'Total estimado de la reserva';
    }

    // Actualiza el total en el modal de pago
    const valorTotalPagoEl = document.getElementById('valor-total-pago');
    if (valorTotalPagoEl) {
        valorTotalPagoEl.textContent = formatCurrency(state.currentBookingTotal, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0));
    }
},

    togglePaymentFieldsVisibility(visible) {
        if (this.fieldsetPago) {
            this.fieldsetPago.style.display = visible ? '' : 'none';
            const paymentMessage = document.getElementById('payment-message-checkout');
            if (!visible && paymentMessage) {
                paymentMessage.style.display = 'block';
            } else if (paymentMessage) {
                paymentMessage.style.display = 'none';
            }
        }
        const tipoPagoEl = this.form.elements.tipo_pago;
        const metodoPagoEl = this.form.elements.metodo_pago_id;
        const montoAbonoEl = this.form.elements.monto_abono;

        if (tipoPagoEl) tipoPagoEl.required = visible;
        if (metodoPagoEl) metodoPagoEl.required = false;
        if (montoAbonoEl) montoAbonoEl.required = false;

        if (!visible) {
            if (tipoPagoEl) tipoPagoEl.value = 'parcial';
            if (metodoPagoEl) metodoPagoEl.value = '';
            if (montoAbonoEl) montoAbonoEl.value = '';
        }

        const policyPill = document.getElementById('reservas-policy-pill');
        if (policyPill) {
            policyPill.textContent = visible ? 'Cobro al Check-in' : 'Cobro al Check-out';
        }
    }
};

function getOriginOptionsHtml(selectedValue = 'directa', includeAllOption = false) {
    const normalizedSelected = selectedValue == null ? '' : String(selectedValue);
    let optionsHtml = includeAllOption
        ? `<option value="" ${normalizedSelected === '' ? 'selected' : ''}>Todas</option>`
        : '';
    optionsHtml += RESERVA_ORIGIN_OPTIONS.map((option) => `
        <option value="${option.value}" ${normalizedSelected === String(option.value) ? 'selected' : ''}>${option.label}</option>
    `).join('');
    return optionsHtml;
}

function getFunnelBadgeClasses(stage) {
    switch (stage) {
        case 'OTA':
            return 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700';
        case 'Mensajeria':
            return 'border-emerald-200 bg-emerald-50 text-emerald-700';
        case 'Corporativo':
            return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'Referidos':
            return 'border-cyan-200 bg-cyan-50 text-cyan-700';
        case 'Meta':
            return 'border-violet-200 bg-violet-50 text-violet-700';
        case 'Integraciones':
            return 'border-slate-200 bg-slate-100 text-slate-700';
        default:
            return 'border-blue-200 bg-blue-50 text-blue-700';
    }
}

function getToleranceBadgeClasses(level) {
    switch (level) {
        case 'llegada_proxima':
            return 'border-indigo-200 bg-indigo-50 text-indigo-700';
        case 'tardanza_tolerada':
            return 'border-amber-200 bg-amber-50 text-amber-700';
        case 'no_show_sugerido':
            return 'border-red-200 bg-red-50 text-red-700';
        default:
            return 'border-slate-200 bg-slate-100 text-slate-700';
    }
}

function formatPricingRuleImpact(rule) {
    if (!rule) return '';
    const adjustmentAmount = Number(rule.adjustmentAmount || 0);
    const sign = adjustmentAmount >= 0 ? '+' : '-';
    return `${rule.label} (${sign}${formatCurrency(Math.abs(adjustmentAmount), state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0, 10))})`;
}

function renderPricingRuleSummary() {
    if (!ui.pricingRuleSummary) return;

    if (!state.currentPricingRule) {
        ui.pricingRuleSummary.innerHTML = `
            <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Sin tarifa dinamica aplicada. El sistema tomara el precio base configurado para la habitacion o el tiempo de estancia.
            </div>
        `;
        return;
    }

    const adjustmentAmount = Number(state.currentPricingRule.adjustmentAmount || 0);
    const isIncrease = adjustmentAmount >= 0;
    ui.pricingRuleSummary.innerHTML = `
        <div class="rounded-2xl border px-4 py-3 text-sm ${isIncrease ? 'border-blue-200 bg-blue-50 text-blue-800' : 'border-emerald-200 bg-emerald-50 text-emerald-800'}">
            <p class="font-semibold">Tarifa dinamica activa: ${escapeHtml(state.currentPricingRule.label || 'Regla dinamica')}</p>
            <p class="mt-1">${isIncrease ? 'Ajuste aplicado' : 'Descuento aplicado'} sobre la estancia base: <strong>${formatCurrency(adjustmentAmount, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0, 10))}</strong></p>
        </div>
    `;
}

function buildPricingRuleDaysOptions(selectedDays = []) {
    const weekdays = [
        { value: 0, label: 'Dom' },
        { value: 1, label: 'Lun' },
        { value: 2, label: 'Mar' },
        { value: 3, label: 'Mie' },
        { value: 4, label: 'Jue' },
        { value: 5, label: 'Vie' },
        { value: 6, label: 'Sab' }
    ];

    return weekdays.map((day) => `
        <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">
            <input type="checkbox" name="dias_semana" value="${day.value}" ${selectedDays.includes(day.value) ? 'checked' : ''}>
            <span>${day.label}</span>
        </label>
    `).join('');
}

function formatWeekdaysForRule(rule) {
    const weekdays = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
    if (!Array.isArray(rule?.dias_semana) || rule.dias_semana.length === 0) {
        return 'Todos los dias';
    }

    return rule.dias_semana
        .map((day) => weekdays[Number(day)] || null)
        .filter(Boolean)
        .join(', ');
}

function renderPricingRulesPanel() {
    if (!ui.pricingRulesPanel) return;

    if (state.pricingRulesAvailable === false) {
        ui.pricingRulesPanel.innerHTML = `
            <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                Las reglas dinamicas ya quedaron listas en la app, pero esta base aun no tiene aplicada la migracion operativa de Prioridad 3. Cuando se active, podras guardarlas desde este panel.
            </div>
        `;
        return;
    }

    const rules = Array.isArray(state.pricingRules) ? [...state.pricingRules] : [];
    const rulesHtml = rules.length > 0
        ? rules.map((rule) => {
            const weekdays = formatWeekdaysForRule(rule);
            const scope = [
                rule.origen_reserva ? `Origen: ${getReservaOriginLabel(rule.origen_reserva)}` : null,
                rule.habitacion_id ? `Habitacion especifica` : null,
                rule.fecha_inicio || rule.fecha_fin ? `${rule.fecha_inicio || 'Siempre'} -> ${rule.fecha_fin || 'Siempre'}` : null,
                `Dias: ${weekdays}`
            ].filter(Boolean).join(' | ');

            return `
                <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <p class="text-sm font-bold text-slate-900">${escapeHtml(rule.nombre || 'Regla')}</p>
                            <p class="mt-1 text-xs text-slate-500">${escapeHtml(scope)}</p>
                            ${rule.descripcion ? `<p class="mt-2 text-sm text-slate-600">${escapeHtml(rule.descripcion)}</p>` : ''}
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">${escapeHtml(rule.tipo_ajuste === 'fijo' ? 'Monto fijo' : 'Porcentaje')}</span>
                            <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">${escapeHtml(String(rule.valor))}${rule.tipo_ajuste === 'fijo' ? '' : '%'}</span>
                            <button type="button" class="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700" data-pricing-rule-delete="${rule.id}">Eliminar</button>
                        </div>
                    </div>
                </article>
            `;
        }).join('')
        : `
            <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500">
                Aun no hay reglas dinamicas. Puedes crear ajustes por origen de reserva, dia de la semana o periodo.
            </div>
        `;

    ui.pricingRulesPanel.innerHTML = `
        <div class="space-y-4">
            ${rulesHtml}
        </div>
    `;
}

function updatePricingRuleRoomOptions() {
    const roomSelect = ui.pricingRuleForm?.querySelector('select[name="habitacion_id"]');
    if (!roomSelect || !ui.habitacionIdSelect) return;

    const options = Array.from(ui.habitacionIdSelect.options || [])
        .filter((option) => option.value)
        .map((option) => `<option value="${option.value}">${escapeHtml(option.textContent.trim())}</option>`)
        .join('');

    roomSelect.innerHTML = `<option value="">Todas las habitaciones</option>${options}`;
}

async function showReservaSuccessModal(message) {
    if (typeof Swal !== 'undefined') {
        await Swal.fire('\u00c9xito', message, 'success');
        return;
    }
    if (typeof ui.showInfoModal === 'function') {
        ui.showInfoModal(message, '\u00c9xito');
        return;
    }
    alert(`\u00c9xito\n\n${message}`);
}

function buildWaitlistItemPayload(formData, fechas) {
    const selectedOption = ui.habitacionIdSelect?.selectedOptions?.[0];
    const selectedTipoHabitacionId = selectedOption?.dataset?.tipoHabitacionId || formData.habitacion_info_dom?.tipo_habitacion_id || null;

    return {
        hotel_id: state.hotelId,
        cliente_id: formData.cliente_id || null,
        cliente_nombre: formData.cliente_nombre.trim(),
        cedula: formData.cedula?.trim() || null,
        telefono: formData.telefono?.trim() || null,
        habitacion_id: formData.habitacion_id || null,
        tipo_habitacion_id: selectedTipoHabitacionId || null,
        fecha_inicio: fechas.fechaEntrada.toISOString(),
        fecha_fin: fechas.fechaSalida.toISOString(),
        cantidad_huespedes: parseInt(formData.cantidad_huespedes, 10) || 1,
        origen_reserva: formData.origen_reserva || 'directa',
        prioridad: 1,
        estado: 'pendiente',
        notas: formData.notas?.trim() || null,
        creada_por: state.currentUser?.id || null
    };
}

async function refreshWaitlistItems() {
    if (!state.supabase || !state.hotelId) return [];

    try {
        const [itemsResult, roomsResult, reservationsResult] = await Promise.all([
            state.supabase
                .from('lista_espera_reservas')
                .select('*')
                .eq('hotel_id', state.hotelId)
                .neq('estado', 'cancelada')
                .order('fecha_inicio', { ascending: true }),
            state.supabase
                .from('habitaciones')
                .select('id, nombre, tipo, estado, activo, capacidad_maxima, tipo_habitacion_id')
                .eq('hotel_id', state.hotelId)
                .eq('activo', true)
                .order('nombre', { ascending: true }),
            state.supabase
                .from('reservas')
                .select('id, habitacion_id, fecha_inicio, fecha_fin, estado')
                .eq('hotel_id', state.hotelId)
                .in('estado', ['reservada', 'confirmada', 'activa', 'ocupada', 'tiempo agotado'])
        ]);

        if (itemsResult.error) throw itemsResult.error;
        if (roomsResult.error) throw roomsResult.error;
        if (reservationsResult.error) throw reservationsResult.error;

        const rooms = roomsResult.data || [];
        const reservations = reservationsResult.data || [];
        state.waitlistItems = (itemsResult.data || []).map((item) => ({
            ...item,
            __suggestions: suggestRoomsForWaitlistItem(item, rooms, reservations, new Date())
        }));
        state.waitlistAvailable = true;
    } catch (error) {
        console.warn('[Reservas] No se pudo cargar la lista de espera:', error.message);
        state.waitlistItems = [];
        state.waitlistAvailable = false;
    }

    renderWaitlistPanel();
    return state.waitlistItems;
}

function renderWaitlistPanel() {
    if (!ui.waitlistListEl || !ui.waitlistSummaryEl) return;

    if (state.waitlistAvailable === false) {
        ui.waitlistSummaryEl.innerHTML = '';
        ui.waitlistListEl.innerHTML = `
            <div class="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-800">
                La lista de espera y la reasignacion inteligente ya estan listas en la app, pero esta base aun no tiene aplicada la migracion operativa de Prioridad 3.
            </div>
        `;
        return;
    }

    const items = Array.isArray(state.waitlistItems) ? state.waitlistItems : [];
    const pendientes = items.filter((item) => item.estado === 'pendiente').length;
    const contactados = items.filter((item) => item.estado === 'contactado').length;

    ui.waitlistSummaryEl.innerHTML = `
        <div class="flex flex-wrap gap-2 text-sm">
            <span class="rounded-full border border-slate-200 bg-white px-3 py-1 font-semibold text-slate-700">Pendientes: ${pendientes}</span>
            <span class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-semibold text-amber-700">Contactados: ${contactados}</span>
            <span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Activos: ${items.length}</span>
        </div>
    `;

    if (items.length === 0) {
        ui.waitlistListEl.innerHTML = `
            <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No hay clientes en lista de espera. Usa el boton "Enviar a lista de espera" cuando no puedas confirmar una habitacion ahora mismo.
            </div>
        `;
        return;
    }

    ui.waitlistListEl.innerHTML = items.map((item) => {
        const suggestions = Array.isArray(item.__suggestions) ? item.__suggestions : [];
        const priorityLabel = getWaitlistPriorityLabel(item.prioridad);
        const originLabel = getReservaOriginLabel(item.origen_reserva);
        const funnelLabel = getReservaOriginFunnelStage(item.origen_reserva);
        const roomLabel = item.habitacion_id ? 'Habitacion deseada' : 'Sin habitacion fija';

        return `
            <article class="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <p class="text-lg font-bold text-slate-900">${escapeHtml(item.cliente_nombre || 'Sin nombre')}</p>
                            <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">${escapeHtml(priorityLabel)}</span>
                            <span class="rounded-full border ${getFunnelBadgeClasses(funnelLabel)} px-3 py-1 text-xs font-semibold">${escapeHtml(originLabel)}</span>
                        </div>
                        <p class="mt-2 text-sm text-slate-500">${escapeHtml(roomLabel)} ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â¢ ${escapeHtml(item.cantidad_huespedes || 1)} huespedes</p>
                        <p class="mt-1 text-sm text-slate-500">${formatDateTime(item.fecha_inicio)} -> ${formatDateTime(item.fecha_fin)}</p>
                        ${item.notas ? `<p class="mt-2 text-sm text-slate-600">${escapeHtml(item.notas)}</p>` : ''}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button type="button" class="button button-info text-xs px-3 py-2" data-waitlist-action="contactado" data-waitlist-id="${item.id}">Marcar contactado</button>
                        <button type="button" class="button button-success text-xs px-3 py-2" data-waitlist-action="convertida" data-waitlist-id="${item.id}">Marcar convertida</button>
                        <button type="button" class="button button-danger text-xs px-3 py-2" data-waitlist-action="cancelada" data-waitlist-id="${item.id}">Cancelar</button>
                    </div>
                </div>

                <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div class="flex items-center justify-between gap-2">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Sugerencias inteligentes</p>
                        <span class="text-xs font-semibold text-slate-400">${suggestions.length} opcion${suggestions.length === 1 ? '' : 'es'}</span>
                    </div>
                    <div class="mt-3 flex flex-wrap gap-2">
                        ${suggestions.length > 0
                            ? suggestions.map((suggestion) => `
                                <button type="button" class="rounded-full border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700" data-waitlist-action="usar-sugerencia" data-waitlist-id="${item.id}" data-room-id="${suggestion.id}">
                                    ${escapeHtml(suggestion.nombre)}
                                </button>
                            `).join('')
                            : '<span class="text-sm text-slate-500">No hay habitaciones sugeridas con la disponibilidad actual.</span>'}
                    </div>
                </div>
            </article>
        `;
    }).join('');
}

async function updateWaitlistItemStatus(waitlistId, estado) {
    const { error } = await state.supabase
        .from('lista_espera_reservas')
        .update({ estado, actualizado_en: new Date().toISOString() })
        .eq('id', waitlistId)
        .eq('hotel_id', state.hotelId);

    if (error) throw error;
}

async function prefillReservaFromWaitlist(waitlistId, roomId = null) {
    const item = state.waitlistItems.find((entry) => String(entry.id) === String(waitlistId));
    if (!item || !ui.form) return;

    updateClienteFieldsFromWaitlist(item);
    ui.form.elements.fecha_entrada.value = new Date(new Date(item.fecha_inicio).getTime() - (new Date(item.fecha_inicio).getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    ui.form.elements.cantidad_huespedes.value = item.cantidad_huespedes || 1;
    ui.form.elements.notas.value = item.notas || '';
    if (ui.origenReservaSelect) ui.origenReservaSelect.value = item.origen_reserva || 'directa';
    if (ui.habitacionIdSelect && roomId) ui.habitacionIdSelect.value = roomId;
    if (ui.tipoCalculoDuracionEl) ui.tipoCalculoDuracionEl.value = 'noches_manual';
    const diffMs = new Date(item.fecha_fin).getTime() - new Date(item.fecha_inicio).getTime();
    const noches = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
    if (ui.cantidadNochesInput) ui.cantidadNochesInput.value = noches;
    ui.tipoCalculoDuracionEl?.dispatchEvent(new Event('change'));

    await updateWaitlistItemStatus(waitlistId, 'contactado');
    await refreshWaitlistItems();
    await recalcularYActualizarTotalUI();
    ui.form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showSuccess(ui.feedbackDiv, 'La reserva en espera ya quedo cargada en el formulario para continuar.');
}

function updateClienteFieldsFromWaitlist(item) {
    const newClientFieldsContainer = ui.container?.querySelector('#new-client-fields');
    if (!item) return;

    if (ui.clienteIdHiddenInput) ui.clienteIdHiddenInput.value = item.cliente_id || '';
    if (ui.form?.elements.cliente_nombre) ui.form.elements.cliente_nombre.value = item.cliente_nombre || '';
    if (ui.form?.elements.cedula) ui.form.elements.cedula.value = item.cedula || '';
    if (ui.form?.elements.telefono) ui.form.elements.telefono.value = item.telefono || '';

    if (ui.clienteNombreDisplay && item.cliente_id) {
        ui.clienteNombreDisplay.querySelector('#selected_client_name').textContent = item.cliente_nombre || 'Cliente';
        ui.clienteNombreDisplay.classList.remove('hidden');
        if (newClientFieldsContainer) newClientFieldsContainer.style.display = 'none';
    } else if (ui.clienteNombreDisplay) {
        ui.clienteNombreDisplay.classList.add('hidden');
        if (newClientFieldsContainer) newClientFieldsContainer.style.display = 'block';
    }
}

async function handleSaveWaitlistFromForm() {
    if (state.waitlistAvailable === false) {
        showError(ui.feedbackDiv, 'La lista de espera aun no esta disponible en esta base. Falta aplicar la migracion operativa de Prioridad 3.');
        return;
    }

    const formData = gatherFormData();
    validateInitialInputs({
        ...formData,
        habitacion_id: formData.habitacion_id || 'lista-espera'
    });

    const fechas = calculateFechasEstancia(
        formData.fecha_entrada,
        formData.tipo_calculo_duracion,
        formData.cantidad_noches,
        formData.tiempo_estancia_id,
        state.configHotel.checkout_hora_config
    );

    if (fechas.errorFechas) {
        throw new Error(fechas.errorFechas);
    }

    const payload = buildWaitlistItemPayload(formData, fechas);
    const { error } = await state.supabase.from('lista_espera_reservas').insert(payload);
    if (error) throw error;

    await refreshWaitlistItems();
    showSuccess(ui.feedbackDiv, 'Cliente agregado a la lista de espera.');
}

async function handleWaitlistPanelClick(event) {
    const actionButton = event.target.closest('[data-waitlist-action]');
    if (!actionButton) return;

    const waitlistId = actionButton.dataset.waitlistId;
    const action = actionButton.dataset.waitlistAction;

    try {
        if (action === 'usar-sugerencia') {
            await prefillReservaFromWaitlist(waitlistId, actionButton.dataset.roomId);
            return;
        }

        if (['contactado', 'convertida', 'cancelada'].includes(action)) {
            await updateWaitlistItemStatus(waitlistId, action);
            await refreshWaitlistItems();
            return;
        }
    } catch (error) {
        console.error('[Reservas] Error manejando lista de espera:', error);
        showError(ui.feedbackDiv, `No se pudo actualizar la lista de espera: ${error.message}`);
    }
}

async function handlePricingRuleSave(event) {
    event.preventDefault();
    if (!ui.pricingRuleForm) return;
    if (state.pricingRulesAvailable === false) {
        showError(ui.feedbackDiv, 'Las reglas dinamicas aun no estan disponibles en esta base. Falta aplicar la migracion operativa de Prioridad 3.');
        return;
    }

    const formData = new FormData(ui.pricingRuleForm);
    const diasSemana = formData.getAll('dias_semana').map((value) => Number(value)).filter((value) => Number.isInteger(value));
    const payload = {
        hotel_id: state.hotelId,
        nombre: String(formData.get('nombre') || '').trim(),
        descripcion: String(formData.get('descripcion') || '').trim() || null,
        tipo_ajuste: formData.get('tipo_ajuste') || 'porcentaje',
        valor: Number(formData.get('valor') || 0),
        fecha_inicio: formData.get('fecha_inicio') || null,
        fecha_fin: formData.get('fecha_fin') || null,
        dias_semana: diasSemana,
        origen_reserva: formData.get('origen_reserva') || null,
        habitacion_id: formData.get('habitacion_id') || null,
        aplica_noches: formData.get('aplica_noches') === 'on',
        aplica_horas: formData.get('aplica_horas') === 'on',
        prioridad: Number(formData.get('prioridad') || 0),
        activo: true,
        creada_por: state.currentUser?.id || null
    };

    if (!payload.nombre) {
        showError(ui.feedbackDiv, 'Debes asignar un nombre a la regla tarifaria.');
        return;
    }

    const { error } = await state.supabase.from('reglas_tarifas').insert(payload);
    if (error) {
        showError(ui.feedbackDiv, `No se pudo guardar la regla: ${error.message}`);
        return;
    }

    ui.pricingRuleForm.reset();
    await loadInitialData();
    renderPricingRulesPanel();
    renderPricingRuleSummary();
    showSuccess(ui.feedbackDiv, 'Regla dinamica guardada correctamente.');
}

async function handlePricingRulePanelClick(event) {
    const deleteButton = event.target.closest('[data-pricing-rule-delete]');
    if (!deleteButton) return;

    const ruleId = deleteButton.dataset.pricingRuleDelete;
    const confirmed = await ui.showConfirmationModal('Deseas eliminar esta regla tarifaria?');
    if (!confirmed) return;

    const { error } = await state.supabase
        .from('reglas_tarifas')
        .delete()
        .eq('id', ruleId)
        .eq('hotel_id', state.hotelId);

    if (error) {
        showError(ui.feedbackDiv, `No se pudo eliminar la regla: ${error.message}`);
        return;
    }

    state.pricingRules = state.pricingRules.filter((rule) => String(rule.id) !== String(ruleId));
    renderPricingRulesPanel();
    await recalcularYActualizarTotalUI();
    showSuccess(ui.feedbackDiv, 'Regla tarifaria eliminada.');
}



// En js/modules/reservas/reservas.js

function gatherFormData() {
    return gatherReservaFormData(ui);
}





function validateInitialInputs(formData) {
    return validateReservaInitialInputs({ formData, state, formatCurrency });
}



//-----------calendario------------//
// Parser para eventos creados desde tu app (si los tuvieras)
// REEMPLAZA ESTAS DOS FUNCIONES EN: js/modules/reservas/reservas.js

// Parser para eventos creados desde tu app (mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s robusto)
function parseEventoGoogle(evento) {
  if (!evento.summary) return null;
  // ExpresiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n regular mejorada: mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s flexible con los espacios
  const summaryRegex = /Reserva\s*\|\s*Cliente:\s*([^|]+?)\s*\|\s*Room:\s*([^|]+?)\s*\|\s*HuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©spedes:\s*(\d+)/i;
  const match = evento.summary.match(summaryRegex);
  
  // Si el formato del tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­tulo no coincide, no se puede procesar.
  if (!match) return null;

  const [, cliente_nombre, habitacion_nombre, cantidad_huespedes_str] = match;

  // ValidaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡sica de los datos extraÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­dos
  if (!cliente_nombre.trim() || !habitacion_nombre.trim()) return null;

  let telefono = null, cedula = null;
  if (evento.description) {
    const telMatch = evento.description.match(/Tel[eÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©]fono:\s*([\d\s\-\+]+)/i);
    if (telMatch) telefono = telMatch[1].trim();
    
    const cedulaMatch = evento.description.match(/C[eÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©]dula:\s*([A-Za-z0-9\-\.]+)/i);
    if (cedulaMatch) cedula = cedulaMatch[1].trim();
  }

  return {
    cliente_nombre: cliente_nombre.trim(),
    cantidad_huespedes: parseInt(cantidad_huespedes_str, 10) || 1,
    // Importante: Guardamos el NOMBRE de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para buscar su ID despuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©s
    habitacion_nombre: habitacion_nombre.trim(), 
    telefono,
    cedula,
    fecha_inicio: evento.start.dateTime || evento.start.date,
    fecha_fin: evento.end.dateTime || evento.end.date,
    google_event_id: evento.id,
    descripcion: evento.description || '', 
    origen_reserva: 'google_calendar'
  };
}

// Parser para eventos de iCal (Booking, Airbnb, etc. - mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s robusto)
function parseEventoICal(evento, habitaciones) {
    if (!evento.summary && !evento.location) return null;
    
    let habitacionNombreDetectado = null;
    
    // Busca el nombre de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n en el tÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­tulo (summary) o en la ubicaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n (location)
    const roomRegex = /(?:Room|HabitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n)\s*:?\s*([^\s(]+)/i;
    const summaryMatch = evento.summary ? evento.summary.match(roomRegex) : null;
    const locationMatch = evento.location ? evento.location.match(roomRegex) : null;

    if (summaryMatch && summaryMatch[1]) {
        habitacionNombreDetectado = summaryMatch[1].trim();
    } else if (locationMatch && locationMatch[1]) {
        habitacionNombreDetectado = locationMatch[1].trim();
    }

    // Si no se encuentra un nombre de habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n, no podemos continuar
    if (!habitacionNombreDetectado) return null;

    // Busca el ID de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n haciendo una comparaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n insensible a mayÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsculas/minÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsculas
    const habitacionObj = habitaciones.find(h => h.nombre.trim().toLowerCase() === habitacionNombreDetectado.toLowerCase());
    
    // Si no se encuentra una habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n coincidente en la BD, se descarta el evento.
    if (!habitacionObj) {
        console.warn(`[Sync ICal] Evento de ${evento.summary} descartado. No se encontrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n con el nombre: "${habitacionNombreDetectado}"`);
        return null;
    }

    // El resto del parseo de la descripciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n se mantiene igual
    let cliente_nombre = evento.summary.replace(roomRegex, "").replace("(Imported)", "").trim() || "Reserva Externa";
    let cantidad_huespedes = 1;

    if (evento.description) {
        const huespedesMatch = evento.description.match(/HuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©spedes?:\s*(\d+)/i);
        if (huespedesMatch) cantidad_huespedes = parseInt(huespedesMatch[1], 10);
    }
    
    return {
        cliente_nombre,
        cantidad_huespedes,
        habitacion_id: habitacionObj.id, // Usamos el ID encontrado
        fecha_inicio: evento.start.dateTime || evento.start.date,
        fecha_fin: evento.end.dateTime || evento.end.date,
        google_event_id: evento.id,
        origen_reserva: 'ical_google',
        descripcion: evento.description || ''
    };
}




// FunciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n principal de sincronizaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n
// REEMPLAZA ESTA FUNCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN EN: js/modules/reservas/reservas.js

async function syncReservasConGoogleCalendar(state) {
  return syncReservasConGoogleCalendarModule({
    supabase: state?.supabase,
    hotelId: state?.hotelId,
    currentUserId: state?.currentUser?.id,
    onNewReservations: renderReservas
  });
}

async function syncReservasConGoogleCalendarLegacy(state) {
  try {
    if (!state.hotelId) return;

    // 1. Obtener datos locales (reservas existentes y habitaciones con su ID y nombre)
    const [reservasResult, habitacionesResult] = await Promise.all([
        state.supabase.from('reservas').select('google_event_id').eq('hotel_id', state.hotelId).not('google_event_id', 'is', null),
        state.supabase.from('habitaciones').select('id, nombre').eq('hotel_id', state.hotelId)
    ]);

    if (reservasResult.error || habitacionesResult.error) {
        console.error("[Sync] Error obteniendo datos locales:", { reservError: reservasResult.error, habError: habitacionesResult.error });
        return;
    }
    const reservasActuales = reservasResult.data;
    const habitaciones = habitacionesResult.data;

    // 2. Invocar la Edge Function
    const { data: dataEventos, error: errorInvocacion } = await state.supabase.functions.invoke(
      'calendar-sync-events', { body: { hotelId: state.hotelId } }
    );
    if (errorInvocacion) {
      console.error('CRÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂTICO: Error al invocar la Edge Function:', errorInvocacion);
      return;
    }
    const eventosGoogle = dataEventos.events;
    if (!Array.isArray(eventosGoogle)) return;
    
    let nuevasReservasInsertadas = 0;
    for (const evento of eventosGoogle) {
      if (evento.status === "cancelled") continue;
      
      const yaExiste = reservasActuales.some(r => r.google_event_id === evento.id);
      if (yaExiste) continue;

      // 3. Parsear el evento
      let reservaParsed = parseEventoGoogle(evento) || parseEventoICal(evento, habitaciones);
      if (!reservaParsed) continue;

      // 4. Asegurar que tenemos un habitacion_id
      if (!reservaParsed.habitacion_id && reservaParsed.habitacion_nombre) {
          const habEncontrada = habitaciones.find(h => h.nombre.trim().toLowerCase() === reservaParsed.habitacion_nombre.toLowerCase());
          if (habEncontrada) {
              reservaParsed.habitacion_id = habEncontrada.id;
          } else {
              console.warn(`[Sync] Evento descartado. No se encontrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ ID para habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n nombrada: "${reservaParsed.habitacion_nombre}"`);
              continue;
          }
      }
      if (!reservaParsed.habitacion_id) continue;

      // 5. Preparar e insertar
      const reservaParaInsertar = { ...reservaParsed, hotel_id: state.hotelId, estado: 'reservada', monto_total: 0, monto_pagado: 0, usuario_id: state.currentUser.id };
      delete reservaParaInsertar.descripcion;
      delete reservaParaInsertar.habitacion_nombre; // Limpiar campo temporal

      const { data: insertData, error: insertError } = await state.supabase
        .from('reservas').insert(reservaParaInsertar).select().single();
      
      if (insertError) {
        console.error("[Sync] ERROR AL INSERTAR EN SUPABASE:", insertError.message, "--> Objeto:", reservaParaInsertar);
      } else {
        console.log("%c[Sync] ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â°XITO! Reserva insertada:", "color: green; font-weight: bold;", insertData);
        nuevasReservasInsertadas++;
        reservasActuales.push({ google_event_id: insertData.google_event_id });
      }
    }

    if (nuevasReservasInsertadas > 0) {
        console.log(`[Sync] ${nuevasReservasInsertadas} nuevas reservas sincronizadas. Refrescando UI.`);
        await renderReservas();
    }
  } catch (e) {
    console.error("Error catastrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³fico en syncReservasConGoogleCalendar:", e);
  }
}

//------------------fin de reservas google---------------------//
function calculateFechasEstancia(fechaEntradaStr, tipoCalculo, cantidadNochesStr, tiempoEstanciaId, checkoutHoraConfig) {
    return calculateFechasEstanciaModule(
        fechaEntradaStr,
        tipoCalculo,
        cantidadNochesStr,
        tiempoEstanciaId,
        checkoutHoraConfig,
        state.tiemposEstanciaDisponibles
    );
}

function calculateFechasEstanciaLegacy(fechaEntradaStr, tipoCalculo, cantidadNochesStr, tiempoEstanciaId, checkoutHoraConfig) {
    const fechaEntrada = new Date(fechaEntradaStr);
    if (isNaN(fechaEntrada.getTime())) return { errorFechas: "La fecha de entrada no es vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lida." };
    let fechaSalida, cantidadDuracionOriginal;
    const tipoDuracionOriginal = tipoCalculo;

    if (tipoCalculo === "noches_manual") {
        cantidadDuracionOriginal = parseInt(cantidadNochesStr) || 1;
        if (cantidadDuracionOriginal < 1) return { errorFechas: "Cantidad de noches debe ser al menos 1." };
        fechaSalida = new Date(fechaEntrada);
        const [hh, mm] = (checkoutHoraConfig || "12:00").split(':').map(Number);
        fechaSalida.setHours(hh || 0, mm || 0, 0, 0);
        if (fechaEntrada.getTime() >= fechaSalida.getTime()) {
            fechaSalida.setDate(fechaSalida.getDate() + 1);
        }
        const nochesExtra = Math.max(0, cantidadDuracionOriginal - 1);
        if (nochesExtra > 0) {
            fechaSalida.setDate(fechaSalida.getDate() + nochesExtra);
        }
    } else {
        if (!tiempoEstanciaId) return { errorFechas: "No se seleccionÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ un tiempo de estancia." };
        const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
        if (!tiempo || typeof tiempo.minutos !== 'number' || tiempo.minutos <= 0) return { errorFechas: "Tiempo de estancia predefinido invÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido." };
        cantidadDuracionOriginal = tiempo.minutos;
        fechaSalida = new Date(fechaEntrada.getTime() + (tiempo.minutos * 60 * 1000));
    }
    if (fechaSalida <= fechaEntrada) return { errorFechas: "La fecha de salida debe ser posterior a la de llegada." };
    return { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas: null };
}



function esTiempoEstanciaNoches(tiempoEstanciaId) {
    if (!tiempoEstanciaId || !state.tiemposEstanciaDisponibles) return false;
    const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoEstanciaId);
    return tiempo && tiempo.minutos >= (22 * 60) && tiempo.minutos <= (26 * 60);
}



// En js/modules/reservas/reservas.js

function calculateMontos(habitacionInfo, huespedes, tipoDuracion, cantDuracion, tiempoId, precioLibreActivado, precioLibreValor) {
    return calculateMontosModule({
        habitacionInfo,
        huespedes,
        tipoDuracion,
        cantDuracion,
        tiempoId,
        precioLibreActivado,
        precioLibreValor,
        tiemposEstanciaDisponibles: state.tiemposEstanciaDisponibles,
        descuentoAplicado: state.descuentoAplicado,
        configHotel: state.configHotel
    });
}

function calculateMontosLegacy(habitacionInfo, huespedes, tipoDuracion, cantDuracion, tiempoId, precioLibreActivado, precioLibreValor) {
    if (!habitacionInfo) return { errorMonto: "InformaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n no disponible." };

    let montoEstanciaBaseBruto = 0;
    let montoPorHuespedesAdicionales = 0;
    let montoDescontado = 0;
    let totalAntesDeImpuestos;

    // --- CASO 1: PRECIO MANUAL ---
    if (precioLibreActivado && typeof precioLibreValor === 'number' && precioLibreValor >= 0) {
        montoEstanciaBaseBruto = precioLibreValor;
        totalAntesDeImpuestos = precioLibreValor;
    } else {
        // --- CASO 2: CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂLCULO AUTOMÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂTICO ---

        // A. CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo por NOCHES
        if (tipoDuracion === "noches_manual") {
            let precioNocheUnitario = 0;

            // Precio base (1 vs 2 personas)
            if (huespedes === 1 && habitacionInfo.precio_1_persona > 0) {
                precioNocheUnitario = habitacionInfo.precio_1_persona;
            } else if (huespedes >= 2 && habitacionInfo.precio_2_personas > 0) {
                precioNocheUnitario = habitacionInfo.precio_2_personas;
            } else {
                precioNocheUnitario = habitacionInfo.precio_general || 0;
            }

            montoEstanciaBaseBruto = precioNocheUnitario * cantDuracion;

            // B. CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo de HuÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©spedes Adicionales
            // Asumimos que el precio base cubre hasta 2 personas (o la capacidad base de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n)
            const baseOcupacion = habitacionInfo.capacidad_base || 2; 

            // --- CAMBIO IMPORTANTE: Eliminamos el bloqueo por capacidad mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡xima ---
            // Si hay mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡s huÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©spedes que la base, cobramos extras sin importar el lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­mite teÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³rico
            if (huespedes > baseOcupacion) {
                const extraHuespedes = huespedes - baseOcupacion;
                montoPorHuespedesAdicionales = extraHuespedes * (habitacionInfo.precio_huesped_adicional || 0) * cantDuracion;
            }

        } else {
            // C. CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo por TIEMPO PREDEFINIDO
            const tiempo = state.tiemposEstanciaDisponibles.find(ts => ts.id === tiempoId);
            if (tiempo && typeof tiempo.precio === 'number' && tiempo.precio >= 0) {
                montoEstanciaBaseBruto = tiempo.precio;
            } else {
                return { errorMonto: "Precio no definido para el tiempo seleccionado." };
            }
        }

        const totalAntesDeDescuento = montoEstanciaBaseBruto + montoPorHuespedesAdicionales;

        // 3. Calcular descuento
        if (state.descuentoAplicado) {
            if (state.descuentoAplicado.tipo === 'fijo') {
                montoDescontado = parseFloat(state.descuentoAplicado.valor);
            } else if (state.descuentoAplicado.tipo === 'porcentaje') {
                montoDescontado = totalAntesDeDescuento * (parseFloat(state.descuentoAplicado.valor) / 100);
            }
        }
        montoDescontado = Math.min(totalAntesDeDescuento, montoDescontado);
        totalAntesDeImpuestos = totalAntesDeDescuento - montoDescontado;
    }

    // --- CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂLCULO DE IMPUESTOS ---
    let montoImpuestoCalculado = 0;
    let baseImponibleFinal = totalAntesDeImpuestos;

    if (state.configHotel.impuestos_incluidos_en_precios && state.configHotel.porcentaje_impuesto_principal > 0) {
        baseImponibleFinal = totalAntesDeImpuestos / (1 + (state.configHotel.porcentaje_impuesto_principal / 100));
        montoImpuestoCalculado = totalAntesDeImpuestos - baseImponibleFinal;
    } else if (state.configHotel.porcentaje_impuesto_principal > 0) {
        montoImpuestoCalculado = baseImponibleFinal * (state.configHotel.porcentaje_impuesto_principal / 100);
    }

    return {
        montoEstanciaBase: Math.round(montoEstanciaBaseBruto),
        montoPorHuespedesAdicionales: Math.round(montoPorHuespedesAdicionales),
        montoDescontado: Math.round(montoDescontado),
        montoImpuesto: Math.round(montoImpuestoCalculado),
        baseSinImpuestos: Math.round(baseImponibleFinal),
        errorMonto: null
    };
}

// En js/modules/reservas/reservas.js

async function validateAndCalculateBooking(formData) {
    return validateAndCalculateBookingModule({
        formData,
        state,
        updateTotalDisplay: (montoDescontado) => {
            if (ui && typeof ui.updateTotalDisplay === 'function') {
                ui.updateTotalDisplay(montoDescontado);
            }
        }
    });
}

async function validateAndCalculateBookingLegacy(formData) {
    // 1. Obtiene informaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n (USANDO DATOS DEL DOM - MÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂS RÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂPIDO Y SEGURO)
    const habitacionInfo = formData.habitacion_info_dom;

    // Si por alguna razÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n fallÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ la carga del DOM, lanzamos error
    if (!habitacionInfo) {
        throw new Error("Seleccione una habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lida para calcular.");
    }

    // 2. Calcula las fechas de entrada y salida
    const { fechaEntrada, fechaSalida, tipoDuracionOriginal, cantidadDuracionOriginal, errorFechas } = calculateFechasEstancia(
        formData.fecha_entrada, 
        formData.tipo_calculo_duracion, 
        formData.cantidad_noches, 
        formData.tiempo_estancia_id, 
        state.configHotel.checkout_hora_config
    );
    if (errorFechas) throw new Error(errorFechas);

    // 3. CÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo de Montos
    const { montoEstanciaBase, montoPorHuespedesAdicionales, montoDescontado, montoImpuesto, baseSinImpuestos, errorMonto } = calculateMontos(
        habitacionInfo, 
        parseInt(formData.cantidad_huespedes), 
        tipoDuracionOriginal, 
        cantidadDuracionOriginal, 
        formData.tiempo_estancia_id, 
        formData.precio_libre_toggle, 
        parseFloat(formData.precio_libre_valor)
    );
    
    // IMPORTANTE: Si hay error de monto (ej: exceso de capacidad), lanzamos el error
    if (errorMonto) throw new Error(errorMonto);

    // Actualizar Estado Global y UI INMEDIATAMENTE
    state.currentBookingTotal = baseSinImpuestos + montoImpuesto;
    if (ui && typeof ui.updateTotalDisplay === 'function') { 
        ui.updateTotalDisplay(montoDescontado);
    }
    
    // 4. ValidaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de cruce de reservas (CORREGIDO PARA EDICIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN)
    const HORAS_BLOQUEO_PREVIO = 3;
    
    // Construimos la consulta base
    let queryProxima = state.supabase
        .from('reservas')
        .select('id, fecha_inicio')
        .eq('habitacion_id', formData.habitacion_id)
        .in('estado', ['reservada', 'confirmada', 'activa'])
        .gte('fecha_inicio', fechaEntrada.toISOString());

    // --- CORRECCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN CRÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂTICA AQUÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â ---
    // Si estamos en modo ediciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n, excluimos la reserva que estamos editando
    // para que no se detecte como un conflicto consigo misma.
    if (state.isEditMode && state.editingReservaId) {
        queryProxima = queryProxima.neq('id', state.editingReservaId);
    }
    
    // Ejecutamos la consulta construida
    const { data: proximaReserva } = await queryProxima
        .order('fecha_inicio', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (proximaReserva) {
        const inicioProximaReserva = new Date(proximaReserva.fecha_inicio);
        const inicioBloqueo = new Date(inicioProximaReserva.getTime() - HORAS_BLOQUEO_PREVIO * 60 * 60 * 1000);
        if (fechaSalida > inicioBloqueo) {
            throw new Error(`Conflicto: Se cruza con una reserva futura (Inicia: ${formatDateTime(inicioProximaReserva)}).`);
        }
    }

    // ValidaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n RPC (Cruce estricto en BD)
    try {
        const { data: hayCruce, error: errCruce } = await state.supabase.rpc('validar_cruce_reserva', {
            p_habitacion_id: formData.habitacion_id, 
            p_entrada: fechaEntrada.toISOString(),
            p_salida: fechaSalida.toISOString(), 
            // Esto ya estaba bien, pero es vital que siga aquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­:
            p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
        });

        if (hayCruce === true) {
            throw new Error("Conflicto: La habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n NO estÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡ disponible para estas fechas.");
        }
    } catch (e) {
        // Ignoramos errores de RPC faltante para no bloquear el precio, solo advertimos
        console.warn("ValidaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de cruce RPC omitida o fallida:", e.message);
    }
    
    // Preparar notas
    let notasFinales = formData.notas.trim() || null;
    if (formData.precio_libre_toggle) {
        const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(parseFloat(formData.precio_libre_valor), state.configHotel?.moneda_local_simbolo)}]`;
        notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
    }

    // 5. Construir Objetos Finales
    const datosReserva = {
        cliente_id: formData.cliente_id,
        cliente_nombre: formData.cliente_nombre.trim(),
        cedula: formData.cedula.trim() || null,
        telefono: formData.telefono.trim() || null,
        cantidad_huespedes: parseInt(formData.cantidad_huespedes),
        habitacion_id: formData.habitacion_id,
        habitacion_nombre: formData.habitacion_info_dom?.nombre || null,
        fecha_inicio: fechaEntrada.toISOString(),
        fecha_fin: fechaSalida.toISOString(),
        estado: state.isEditMode ? undefined : 'reservada',
        hotel_id: state.hotelId,
        usuario_id: state.currentUser.id,
        tipo_duracion: tipoDuracionOriginal,
        cantidad_duracion: cantidadDuracionOriginal,
        tiempo_estancia_id: tipoDuracionOriginal === 'tiempo_predefinido' ? formData.tiempo_estancia_id : null,
        monto_estancia_base_sin_impuestos: baseSinImpuestos,
        monto_impuestos_estancia: montoImpuesto,
        porcentaje_impuestos_aplicado: state.configHotel.porcentaje_impuesto_principal,
        nombre_impuesto_aplicado: state.configHotel.nombre_impuesto_principal,
        monto_total: state.currentBookingTotal,
        descuento_aplicado_id: state.descuentoAplicado?.id || null,
        monto_descontado: montoDescontado,
        notas: notasFinales,
        origen_reserva: 'directa',
        id_temporal_o_final: state.isEditMode ? state.editingReservaId : `TEMP-${Date.now()}`
    };
    
    const datosPago = {
        monto_abono: parseFloat(formData.monto_abono) || 0,
        metodo_pago_id: formData.metodo_pago_id || null,
        tipo_pago: formData.tipo_pago
    };
    
    return { datosReserva, datosPago };
}




// En js/modules/reservas/reservas.js

async function recalcularYActualizarTotalUI() {
    // Limpiamos mensajes de error previos
    const feedbackSmall = document.getElementById('reserva-feedback'); 
    if(feedbackSmall) feedbackSmall.innerHTML = '';

    try {
        const formData = gatherFormData();

        // LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³gica de descuento automÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡tico
        if (!state.descuentoAplicado || state.descuentoAplicado.tipo_descuento_general !== 'codigo') {
            state.descuentoAplicado = await buscarDescuentoParaReserva(formData, null);
        }

        // CondiciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­nima para calcular
        if (formData.habitacion_id && formData.fecha_entrada &&
            ( (formData.tipo_calculo_duracion === 'noches_manual' && formData.cantidad_noches && parseInt(formData.cantidad_noches) > 0) ||
              (formData.tipo_calculo_duracion === 'tiempo_predefinido' && formData.tiempo_estancia_id) )
        ) {
            await validateAndCalculateBooking(formData); 
            renderPricingRuleSummary();
        } else {
            // Faltan datos esenciales, ponemos 0 silenciosamente
            state.currentBookingTotal = 0;
            state.currentPricingRule = null;
            if (ui && typeof ui.updateTotalDisplay === 'function') ui.updateTotalDisplay(); 
            renderPricingRuleSummary();
        }
    } catch (calcError) {
        console.warn("[Reservas] Error al calcular:", calcError.message);
        
        // Si el error NO es de conflicto (ej: es de capacidad excedida), ponemos 0
        if (!calcError.message.includes('Conflicto')) {
             state.currentBookingTotal = 0;
             state.currentPricingRule = null;
             if (ui && typeof ui.updateTotalDisplay === 'function') ui.updateTotalDisplay();
             renderPricingRuleSummary();
             
             // VISUALIZAR EL ERROR: Si es error de capacidad u otro, mostrarlo sutilmente
             if (ui.feedbackDiv) {
                 ui.feedbackDiv.innerHTML = `<p class="text-xs text-orange-600 mt-1">ÃƒÆ’Ã‚Â¢Ãƒâ€¦Ã‚Â¡Ãƒâ€šÃ‚Â ÃƒÆ’Ã‚Â¯Ãƒâ€šÃ‚Â¸Ãƒâ€šÃ‚Â ${calcError.message}</p>`;
             }
        }
    }
}

// En js/modules/reservas/reservas.js

async function cargarHabitaciones() {
    return cargarHabitacionesModule({
        supabase: state.supabase,
        hotelId: state.hotelId,
        ui,
        state
    });
}

async function cargarHabitacionesLegacy() {
    if (!ui.habitacionIdSelect) return;
    ui.habitacionIdSelect.innerHTML = `<option value="">Cargando habitaciones...</option>`;
    ui.habitacionIdSelect.disabled = true;
    
    const { data: rooms, error } = await state.supabase.from('habitaciones')
        .select('id, nombre, tipo, estado, precio, capacidad_base, capacidad_maxima, precio_huesped_adicional, precio_1_persona, precio_2_personas')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .order('nombre', { ascending: true });

    if (error) {
        ui.habitacionIdSelect.innerHTML = `<option value="">Error al cargar</option>`;
    } else if (!rooms || rooms.length === 0) {
        ui.habitacionIdSelect.innerHTML = `<option value="">No hay habitaciones</option>`;
    } else {
        let optionsHtml = `<option value="">Selecciona habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n...</option>`;
        
        rooms.forEach(room => {
            const isAvailable = room.estado === 'libre';
            const disabledAttribute = !isAvailable ? 'disabled' : '';
            const statusLabel = !isAvailable && room.estado 
                ? ` (${room.estado.charAt(0).toUpperCase() + room.estado.slice(1)})` 
                : '';

            // CAMBIO AQUÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â: Si capacidad_maxima es null, usamos 20 para no bloquear el cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo de extras
            const capMax = room.capacidad_maxima || 20;

            optionsHtml += `
                <option 
                    value="${room.id}" 
                    data-precio="${room.precio || 0}" 
                    data-precio-1="${room.precio_1_persona || 0}" 
                    data-precio-2="${room.precio_2_personas || 0}" 
                    data-capacidad-base="${room.capacidad_base || 2}" 
                    data-capacidad-maxima="${capMax}" 
                    data-precio-extra="${room.precio_huesped_adicional || 0}"
                    ${disabledAttribute}
                >
                    ${room.nombre} (${formatCurrency(room.precio_2_personas || room.precio, state.configHotel?.moneda_local_simbolo || '$')})${statusLabel}
                </option>
            `;
        });
        
        ui.habitacionIdSelect.innerHTML = optionsHtml;
    }
    
    ui.habitacionIdSelect.disabled = false;
}

async function cargarMetodosPago() {
    return cargarMetodosPagoModule({
        supabase: state.supabase,
        hotelId: state.hotelId,
        ui,
        onPaymentVisibilityChange: actualizarVisibilidadPago
    });
}

async function cargarMetodosPagoLegacy() {
    if (!ui.form || !ui.form.elements.metodo_pago_id) return;
    const select = ui.form.elements.metodo_pago_id;
    select.innerHTML = `<option value="">Cargando mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todos...</option>`;
    
    // 1. Obtener mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todos de pago de la BD
    const { data, error } = await state.supabase.from('metodos_pago').select('id, nombre')
        .eq('hotel_id', state.hotelId).eq('activo', true).order('nombre');
    
    if (error) { 
        select.innerHTML = `<option value="">Error</option>`; 
        return; 
    }
    
    let metodosDisponibles = data || [];

    // 2. INYECTAR LA OPCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN DE PAGO MIXTO
    metodosDisponibles.unshift({ id: "mixto", nombre: "Pago Mixto" }); 
    
    // 3. Renderizar las opciones
    let optionsHtml = `<option value="">Selecciona mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todo de pago...</option>`;
    if (metodosDisponibles.length > 0) { 
        metodosDisponibles.forEach(pago => optionsHtml += `<option value="${pago.id}">${pago.nombre}</option>`); 
    } else { 
        optionsHtml = `<option value="">No hay mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todos de pago</option>`; 
    }
    select.innerHTML = optionsHtml;

    actualizarVisibilidadPago();
}


/**
 * Muestra un modal secundario para dividir el pago en varios mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todos.
 * Este modal utiliza el contenedor 'modal-container-secondary'.
 * @param {number} totalAPagar - El monto total que se debe cubrir.
 * @param {Array} metodosPago - La lista de mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todos de pago disponibles (debe ser un array de objetos {id, nombre}).
 * @param {Function} onConfirm - Callback que se ejecuta con el array de pagos al confirmar.
 */
async function showPagoMixtoModal(totalAPagar, metodosPago, onConfirm) {
    return showPagoMixtoModalModule({
        totalAPagar,
        metodosPago,
        configHotel: state.configHotel,
        onConfirm,
        onCancel: () => {
            if (ui.form?.elements?.metodo_pago_id) ui.form.elements.metodo_pago_id.value = '';
            const submitBtnPrincipal = document.getElementById('submit-button');
            if (submitBtnPrincipal) {
                submitBtnPrincipal.disabled = false;
                submitBtnPrincipal.textContent = 'Registrar Reserva';
            }
        }
    });
}


async function cargarTiemposEstancia() {
    return cargarTiemposEstanciaModule({
        supabase: state.supabase,
        hotelId: state.hotelId,
        ui,
        state
    });
}

async function cargarTiemposEstanciaLegacy() {
    if (!ui.tiempoEstanciaIdSelect) return;
    const { data, error } = await state.supabase
        .from('tiempos_estancia')
        .select('id, nombre, minutos, precio')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .order('minutos', { ascending: true });
    ui.tiempoEstanciaIdSelect.innerHTML = "";
    if (error || !data || !data.length) {
        const opt = document.createElement('option'); opt.value = "";
        opt.textContent = error ? "Error cargando tiempos" : "No hay tiempos predefinidos";
        ui.tiempoEstanciaIdSelect.appendChild(opt);
        state.tiemposEstanciaDisponibles = []; return;
    }
    state.tiemposEstanciaDisponibles = data;
    const placeholder = document.createElement('option');
    placeholder.value = ""; placeholder.textContent = "Selecciona un tiempo...";
    ui.tiempoEstanciaIdSelect.appendChild(placeholder);
    data.forEach(ts => {
        const option = document.createElement('option'); option.value = ts.id;
        const horasAprox = formatMinutesToHoursMinutes(ts.minutos);
        option.textContent = `${ts.nombre} (${formatCurrency(ts.precio, state.configHotel?.moneda_local_simbolo || '$', state.configHotel?.moneda_codigo_iso_info || 'COP', parseInt(state.configHotel?.moneda_decimales_info || 0))}) - ${horasAprox}`;
        option.setAttribute('data-precio', ts.precio);
        ui.tiempoEstanciaIdSelect.appendChild(option);
    });
}


// PEGA ESTAS DOS NUEVAS FUNCIONES EN reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo o automÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡tico.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */
// PEGA ESTAS DOS NUEVAS FUNCIONES EN reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo o automÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡tico.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */

// PEGA ESTA FUNCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN FALTANTE EN TU ARCHIVO reservas.js

/**
 * Busca un descuento aplicable para la reserva actual, por cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo o automÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡tico.
 * @param {object} formData - Los datos actuales del formulario de reserva.
 * @param {string|null} codigoManual - El cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento si es aplicable, o null.
 */
// En reservas.js, reemplaza esta funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n completa

// En reservas.js, reemplaza esta funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n completa

async function buscarDescuentoParaReserva(formData, codigoManual = null) {
    return buscarDescuentoParaReservaModule({
        supabase: state.supabase,
        hotelId: state.hotelId,
        formData,
        codigoManual
    });
}

async function buscarDescuentoParaReservaLegacy(formData, codigoManual = null) {
    if (!formData.habitacion_id && !codigoManual && !formData.cliente_id) return null;

    const ahora = new Date().toISOString();
    let query = state.supabase.from('descuentos').select('*')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

    const orConditions = ['tipo_descuento_general.eq.automatico'];
    if (codigoManual) { orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`); }
    if (formData.cliente_id) { orConditions.push(`cliente_id.eq.${formData.cliente_id}`); }
    query = query.or(orConditions.join(','));

    const { data: descuentosPotenciales, error } = await query;
    if (error) { console.error("Error buscando descuentos de reserva:", error); return null; }

    const descuentosValidos = descuentosPotenciales.filter(d => (d.usos_maximos || 0) === 0 || (d.usos_actuales || 0) < d.usos_maximos);

    // Prioridad de bÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsqueda:
    if (formData.cliente_id) { const d = descuentosValidos.find(d => d.cliente_id === formData.cliente_id); if (d) return d; }
    if (codigoManual) { const d = descuentosValidos.find(d => d.codigo && d.codigo.toUpperCase() === codigoManual.toUpperCase()); if (d) return d; }
    
    for (const descuento of descuentosValidos) {
        const aplicabilidad = descuento.aplicabilidad;
        const itemsAplicables = descuento.habitaciones_aplicables || [];

        if (aplicabilidad === 'tiempos_estancia_especificos') {
             // --- LÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œGICA NUEVA Y CORRECTA ---
            if (formData.tipo_calculo_duracion === 'noches_manual' && itemsAplicables.includes('NOCHE_COMPLETA')) {
                return descuento;
            }
            if (formData.tipo_calculo_duracion === 'tiempo_predefinido' && formData.tiempo_estancia_id && itemsAplicables.includes(formData.tiempo_estancia_id)) {
                return descuento;
            }
        }
        else if (aplicabilidad === 'habitaciones_especificas' && formData.habitacion_id && itemsAplicables.includes(formData.habitacion_id)) {
            return descuento;
        }
        else if (aplicabilidad === 'reserva_total') {
            return descuento;
        }
    }
    
    return null;
}


async function handleAplicarDescuentoReserva() {
    const feedbackEl = document.getElementById('feedback-descuento-reserva');
    const codigoInput = document.getElementById('codigo-descuento-reserva');
    const codigo = codigoInput.value.trim();

    clearFeedback(feedbackEl);
    if (!codigo) {
        state.descuentoAplicado = null;
        await recalcularYActualizarTotalUI(); // Recalcula sin descuento
        return;
    }

    feedbackEl.textContent = 'Buscando...';
    try {
        const formData = gatherFormData();
        state.descuentoAplicado = await buscarDescuentoParaReserva(formData, codigo);
        
        if (state.descuentoAplicado) {
            showSuccess(feedbackEl, `ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â¡Descuento "${state.descuentoAplicado.nombre}" aplicado!`);
        } else {
            showError(feedbackEl, 'El cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³digo no es vÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lido o no aplica a esta reserva.');
        }
        await recalcularYActualizarTotalUI();

    } catch (err) {
        showError(feedbackEl, `Error: ${err.message}`);
    }
}

async function loadInitialData() {
    const result = await loadInitialDataModule({
        supabase: state.supabase,
        hotelId: state.hotelId,
        state,
        ui,
        showError,
        renderReservas,
        onPaymentVisibilityChange: actualizarVisibilidadPago
    });

    updatePricingRuleRoomOptions();
    renderPricingRulesPanel();
    renderPricingRuleSummary();
    await refreshWaitlistItems();
    return result;
}

async function loadInitialDataLegacy() {
    if (!ui.habitacionIdSelect || !ui.form?.elements.metodo_pago_id || !ui.tiempoEstanciaIdSelect) {
        console.error("[Reservas] Elementos de UI para carga inicial no encontrados.");
        return;
    }
    try {
        const { data: config, error: configError } = await state.supabase
            .from('configuracion_hotel')
            .select(`
                cobro_al_checkin, 
                checkin_hora_config, 
                checkout_hora_config, 
                impuestos_incluidos_en_precios, 
                porcentaje_impuesto_principal, 
                nombre_impuesto_principal,
                moneda_local_simbolo, 
                moneda_codigo_iso_info, 
                moneda_decimales_info 
            `)
            .eq('hotel_id', state.hotelId)
            .single();

        if (configError && configError.code !== 'PGRST116') throw configError;

        if (config) {
            state.configHotel.cobro_al_checkin = config.cobro_al_checkin === true;
            state.configHotel.checkin_hora_config = config.checkin_hora_config || "15:00";
            state.configHotel.checkout_hora_config = config.checkout_hora_config || "12:00";
            state.configHotel.impuestos_incluidos_en_precios = config.impuestos_incluidos_en_precios === true;
            state.configHotel.porcentaje_impuesto_principal = parseFloat(config.porcentaje_impuesto_principal) || 0;
            state.configHotel.nombre_impuesto_principal = config.nombre_impuesto_principal || null;
            state.configHotel.moneda_local_simbolo = config.moneda_local_simbolo || '$';
            state.configHotel.moneda_codigo_iso_info = config.moneda_codigo_iso_info || 'COP';
            state.configHotel.moneda_decimales_info = config.moneda_decimales_info !== null ? String(config.moneda_decimales_info) : '0';
        } else {
            console.warn(`[Reservas] No se encontrÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ configuraciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n para el hotel ${state.hotelId}. Usando valores predeterminados.`);
        }
        ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);

    } catch (err) {
        console.error("[Reservas] Error cargando configuraciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n del hotel:", err);
        if (ui.feedbackDiv) showError(ui.feedbackDiv, "Error crÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­tico: No se pudo cargar la configuraciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n del hotel.");
        ui.togglePaymentFieldsVisibility(state.configHotel.cobro_al_checkin);
    }
    await Promise.all([cargarHabitaciones(), cargarMetodosPago(), cargarTiemposEstancia()]);
    await renderReservas();
}


// js/modules/reservas/reservas.js

/**
 * Crea una nueva reserva y registra los movimientos de pago y caja asociados.
 * @param {{datosReserva: object, datosPago: {monto_abono: number, metodo_pago_id: string, tipo_pago: string, pagosMixtos: Array<{metodo_pago_id: string, monto: number}>}}} payload
 * @returns {Promise<object>} La reserva insertada.
 */


// js/modules/reservas/reservas.js

async function createBooking(payload) {
    const { datosReserva, datosPago } = payload;
    
    // 1. LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³gica de Cliente (BÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºsqueda o CreaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n)
    let clienteIdFinal = datosReserva.cliente_id;
    if (!clienteIdFinal && datosReserva.cliente_nombre) {
         const { data: clienteExistente } = await state.supabase
            .from('clientes')
            .select('id')
            .eq('cedula', datosReserva.cedula)
            .eq('hotel_id', state.hotelId)
            .maybeSingle(); // Usamos maybeSingle para evitar errores si no existe
            
         if(clienteExistente) {
             clienteIdFinal = clienteExistente.id;
         } else {
             const { data: nuevo, error: errNuevo } = await state.supabase.from('clientes').insert({
                 nombre: datosReserva.cliente_nombre, 
                 documento: datosReserva.cedula,
                 telefono: datosReserva.telefono, 
                 hotel_id: state.hotelId
             }).select('id').single();
             
             if(nuevo) clienteIdFinal = nuevo.id;
             if(errNuevo) console.error("Error creando cliente rÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡pido:", errNuevo);
         }
    }

    // 2. Preparar objeto de reserva LIMPIO 
    const reservaParaInsertar = {
        hotel_id: state.hotelId,
        habitacion_id: datosReserva.habitacion_id,
        cliente_id: clienteIdFinal,
        cliente_nombre: datosReserva.cliente_nombre,
        
        cliente_cedula: datosReserva.cedula || null,
        cliente_telefono: datosReserva.telefono || null,
        cedula: datosReserva.cedula || null,
        telefono: datosReserva.telefono || null,
        
        fecha_inicio: datosReserva.fecha_inicio,
        fecha_fin: datosReserva.fecha_fin,
        
        cantidad_huespedes: datosReserva.cantidad_huespedes,
        tiempo_estancia_id: datosReserva.tiempo_estancia_id,
        tipo_duracion: datosReserva.tipo_duracion,
        cantidad_duracion: datosReserva.cantidad_duracion,
        
        monto_total: datosReserva.monto_total,
        monto_estancia_base: datosReserva.monto_estancia_base_sin_impuestos || 0,
        monto_estancia_base_sin_impuestos: datosReserva.monto_estancia_base_sin_impuestos,
        monto_impuestos_estancia: datosReserva.monto_impuestos_estancia,
        porcentaje_impuestos_aplicado: datosReserva.porcentaje_impuestos_aplicado,
        nombre_impuesto_aplicado: datosReserva.nombre_impuesto_aplicado,
        monto_descontado: datosReserva.monto_descontado,
        descuento_aplicado_id: datosReserva.descuento_aplicado_id,
        
        notas: datosReserva.notas,
        origen_reserva: datosReserva.origen_reserva || 'directa',
        usuario_id: state.currentUser.id,
        
        // --- CORRECCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN AQUÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â ---
        // Si es "mixto" o viene vacÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­o, enviamos NULL.
        // Esto evita el error "invalid input syntax for type uuid: 'mixto'"
        metodo_pago_id: (datosPago.metodo_pago_id === 'mixto' || !datosPago.metodo_pago_id) ? null : datosPago.metodo_pago_id, 
        
        monto_pagado: 0 
    };

    // 3. Calcular total pagado ahora
    const pagosAProcesar = datosPago.pagosMixtos || [];
    const totalPagadoAhora = pagosAProcesar.reduce((sum, pago) => sum + pago.monto, 0);

    reservaParaInsertar.monto_pagado = totalPagadoAhora;

    // 4. Determinar estado compatible con el ENUM de la BD
    if (totalPagadoAhora >= datosReserva.monto_total && datosReserva.monto_total > 0) {
        reservaParaInsertar.estado = 'confirmada'; 
    } else if (totalPagadoAhora > 0) {
        reservaParaInsertar.estado = 'reservada'; // Parcialmente pagada
    } else {
        reservaParaInsertar.estado = 'reservada'; // Pendiente/Sin pago
    }

    // 5. Insertar Reserva
    const { data: reservaInsertada, error: errInsert } = await state.supabase
        .from('reservas')
        .insert(reservaParaInsertar)
        .select()
        .single();

    if (errInsert) {
        console.error("Error detallado Supabase (Insert Reserva):", errInsert);
        throw new Error(`Error al guardar reserva en BD: ${errInsert.message}`);
    }

    const nuevaReservaId = reservaInsertada.id;

    // 6. REGISTRAR PAGOS Y MOVIMIENTOS DE CAJA
    if (totalPagadoAhora > 0) {
        const turnoId = turnoService.getActiveTurnId();
        
        if (!turnoId) console.warn("Advertencia: No hay turno activo, el pago se registra en reserva pero no en caja.");
        
        const conceptoPago = totalPagadoAhora >= datosReserva.monto_total ? 'Pago completo de reserva' : 'Abono inicial de reserva';
        
        const pagosParaInsertar = pagosAProcesar.map(p => ({
            hotel_id: state.hotelId,
            reserva_id: nuevaReservaId,
            monto: p.monto,
            fecha_pago: new Date().toISOString(),
            metodo_pago_id: p.metodo_pago_id, // AquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ SÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â van los UUIDs correctos seleccionados en el modal
            usuario_id: state.currentUser.id,
            concepto: conceptoPago
        }));

        const { data: pagosData, error: errPagosReserva } = await state.supabase
            .from('pagos_reserva')
            .insert(pagosParaInsertar)
            .select('id, metodo_pago_id, monto');

        if (errPagosReserva) {
            console.error("Error al registrar pagos_reserva", errPagosReserva);
        } else if (turnoId && pagosData && pagosData.length > 0) {
            // Registrar en Caja
            const { data: habitacionConceptoData } = await state.supabase
                .from('habitaciones')
                .select('nombre')
                .eq('id', datosReserva.habitacion_id)
                .maybeSingle();

            const habitacionNombreConcepto = habitacionConceptoData?.nombre || datosReserva.habitacion_nombre || datosReserva.habitacion_id || 'N/A';
            const movimientosCaja = pagosData.map(pagoRegistrado => {
                return {
                    hotel_id: state.hotelId,
                    tipo: 'ingreso',
                    monto: pagoRegistrado.monto,
                    concepto: `RESERVA ${habitacionNombreConcepto} (${datosPago.tipo_pago === 'completo' ? 'Pago completo' : 'Abono'}) - Cliente: ${datosReserva.cliente_nombre}`,
                    fecha_movimiento: new Date().toISOString(),
                    metodo_pago_id: pagoRegistrado.metodo_pago_id,
                    usuario_id: state.currentUser.id,
                    turno_id: turnoId,
                    reserva_id: nuevaReservaId,
                    pago_reserva_id: pagoRegistrado.id 
                };
            });
            await state.supabase.from('caja').insert(movimientosCaja);
        }
    }

    // Registrar bitÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡cora
    await registrarEnBitacora({
        supabase: state.supabase, 
        hotel_id: state.hotelId, 
        usuario_id: state.currentUser.id, 
        modulo: 'Reservas', 
        accion: 'CREAR_RESERVA', 
        detalles: { id: nuevaReservaId, cliente: datosReserva.cliente_nombre }
    });

    return reservaInsertada;
}

// js/modules/reservas/reservas.js

async function updateBooking(payload) {
    const { datosReserva } = payload;
    delete datosReserva.hotel_id;
    delete datosReserva.estado;
    delete datosReserva.usuario_id;
    delete datosReserva.id_temporal_o_final;
    delete datosReserva.monto_pagado;

    const reservaUpd = {
        ...datosReserva,
        monto_total: state.currentBookingTotal,
        actualizado_en: new Date().toISOString()
    };

    const { data: updatedReserva, error } = await state.supabase.from('reservas')
        .update(reservaUpd)
        .eq('id', state.editingReservaId)
        .select()
        .single();

    if (error) throw new Error(`Error actualizando reserva: ${error.message}`);
    
    // --- INICIO DE LA LÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œGICA DE CORRECCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN ---
    const nuevaHabitacionId = updatedReserva.habitacion_id;
    const originalHabitacionId = state.editingOriginalHabitacionId;

    // Si la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n original existe y es diferente a la nueva, actualizamos los estados.
    if (originalHabitacionId && nuevaHabitacionId !== originalHabitacionId) {
        console.log(`[Reservas] Se detectÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³ cambio de habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de ${originalHabitacionId} a ${nuevaHabitacionId}. Actualizando estados.`);

        // Liberar la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n original
        const { error: errOldHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: 'libre' })
            .eq('id', originalHabitacionId);

        if (errOldHab) console.error("Error al liberar la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n original:", errOldHab);

        const nuevoEstadoHabitacion = getEstadoHabitacionSegunReservaPendiente(updatedReserva.fecha_inicio);

        // Ajustar la nueva habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n segÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºn la ventana real de bloqueo
        const { error: errNewHab } = await state.supabase
            .from('habitaciones')
            .update({ estado: nuevoEstadoHabitacion })
            .eq('id', nuevaHabitacionId);

        if (errNewHab) console.error("Error al actualizar la nueva habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de la reserva:", errNewHab);
    }
    // --- FIN DE LA LÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œGICA DE CORRECCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN ---

    // LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³gica de descuento (ya existente)
    if (updatedReserva.descuento_aplicado_id) {
       const { error: rpcError } = await state.supabase.rpc('incrementar_uso_descuento', {
           descuento_id_param: updatedReserva.descuento_aplicado_id
       });
       if (rpcError) {
           console.error("Advertencia: No se pudo incrementar el uso del descuento al actualizar la reserva.", rpcError);
       }
    }

    return updatedReserva;
}


// js/modules/reservas/reservas.js

async function prepareEditReserva(reservaId) {
    if (ui.feedbackDiv) clearFeedback(ui.feedbackDiv);
    showLoading(ui.feedbackDiv, "Cargando datos para editar...");

    const { data: r, error } = await state.supabase
        .from('reservas')
        .select(`*, habitaciones(nombre)`)
        .eq('id', reservaId)
        .single();

    clearFeedback(ui.feedbackDiv);
    if (error || !r) {
        console.error("Error cargando reserva para editar:", error);
        throw new Error(`No se pudo cargar la reserva (ID: ${reservaId.substring(0,8)}). Puede que ya no exista o haya un error de red.`);
    }

    // <-- LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚ÂNEA AÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ADIDA: Guardamos el ID de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n original en el estado global del mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³dulo.
    state.editingOriginalHabitacionId = r.habitacion_id;

    ui.form.elements.cliente_nombre.value = r.cliente_nombre || '';
    ui.form.elements.cedula.value = r.cedula || '';
    ui.form.elements.telefono.value = r.telefono || '';
    ui.form.elements.cantidad_huespedes.value = r.cantidad_huespedes || 1;
    ui.form.elements.habitacion_id.value = r.habitacion_id;
    if (ui.origenReservaSelect) ui.origenReservaSelect.value = r.origen_reserva || 'directa';

    if (r.fecha_inicio) {
        const fEntrada = new Date(r.fecha_inicio);
        ui.form.elements.fecha_entrada.value = new Date(fEntrada.getTime() - (fEntrada.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    } else {
        ui.form.elements.fecha_entrada.value = '';
    }

    if (r.tiempo_estancia_id && r.tipo_duracion === 'tiempo_predefinido') {
        ui.tipoCalculoDuracionEl.value = 'tiempo_predefinido';
        ui.form.elements.tiempo_estancia_id.value = r.tiempo_estancia_id;
    } else {
        ui.tipoCalculoDuracionEl.value = 'noches_manual';
        ui.form.elements.cantidad_noches.value = r.cantidad_duracion || 1;
    }
    if (ui.tipoCalculoDuracionEl) ui.tipoCalculoDuracionEl.dispatchEvent(new Event('change'));

    ui.form.elements.tipo_pago.value = 'parcial';
    ui.form.elements.tipo_pago.disabled = true;
    ui.form.elements.metodo_pago_id.value = '';
    ui.form.elements.metodo_pago_id.disabled = true;
    document.getElementById('abono-container').style.display = 'none';
    document.getElementById('total-pago-completo').style.display = 'none';
    if(ui.form.elements.monto_abono) ui.form.elements.monto_abono.value = '';

    ui.form.elements.notas.value = r.notas || '';
    ui.formTitle.textContent = `Editar Reserva: ${r.cliente_nombre} (Hab: ${r.habitaciones?.nombre || 'N/A'})`;
    ui.submitButton.textContent = "Actualizar Reserva";
    if (ui.cancelEditButton) ui.cancelEditButton.style.display = 'inline-flex';
    if (ui.form) ui.form.scrollIntoView({ behavior: 'smooth', block: 'start' });

    state.isEditMode = true;
    state.editingReservaId = reservaId;
    await recalcularYActualizarTotalUI();
}

async function handleDeleteReserva(reservaId) {
    const successMessage = await handleReservaDelete({
        reservaId,
        ui,
        state,
        showLoading,
        clearFeedback,
        showSuccess,
        registrarEnBitacora,
        resetFormToCreateMode,
        renderReservas
    });
    if (successMessage) {
        await showReservaSuccessModal(successMessage);
    }
    return successMessage;
}


async function handleUpdateEstadoReserva(reservaId, nuevoEstadoReserva, nuevoEstadoHabitacion, habitacionIdReserva, forzarDisponibleHabitacion = false) {
    const successMessage = await handleReservaEstadoUpdate({
        reservaId,
        nuevoEstadoReserva,
        nuevoEstadoHabitacion,
        habitacionIdReserva,
        forzarDisponibleHabitacion,
        ui,
        state,
        showLoading,
        clearFeedback,
        showSuccess,
        registrarEnBitacora,
        resetFormToCreateMode,
        renderReservas
    });
    if (successMessage) {
        await showReservaSuccessModal(successMessage);
    }
    return successMessage;
}

async function puedeHacerCheckIn(reservaId) {
    if (!state.configHotel.cobro_al_checkin) {
        return true;
    }
    const { data: r, error: errR } = await state.supabase.from('reservas')
        .select('monto_total, id')
        .eq('id', reservaId).single();
    if (errR || !r) {
        console.error("Error obteniendo reserva para verificar check-in:", errR);
        return false;
    }
    const { data: p, error: errP } = await state.supabase.from('pagos_reserva')
        .select('monto').eq('reserva_id', reservaId);
    if (errP) {
        console.error("Error obteniendo pagos para verificar check-in:", errP);
        return false;
    }
    const totalPagado = p ? p.reduce((s, i) => s + Number(i.monto), 0) : 0;
    if (!r.monto_total || r.monto_total <= 0) return true;
    return totalPagado >= r.monto_total;
}

function getReservaRegistroISO(reserva) {
    return getReservaRegistroISOModule(reserva);
}

function getReservaFilterDateISO(reserva, modoFecha) {
    return getReservaFilterDateISOModule(reserva, modoFecha);
}

function getDateMsSafe(dateLike) {
    return getDateMsSafeModule(dateLike);
}

function hasActiveReservaFilters() {
    return hasActiveReservaFiltersModule(state);
}

async function ensureReservasHistorialUsuarios() {
    return ensureReservasHistorialUsuariosModule(state);
}

async function cargarTurnosParaReservas(reservas) {
    return cargarTurnosParaReservasModule(state, reservas);
}

function enriquecerReservasConHistorial(reservas, turnos) {
    return enriquecerReservasConHistorialModule({
        reservas,
        turnos,
        state,
        formatDateTime
    });
}

function filtrarReservasHistorial(reservas) {
    return filtrarReservasHistorialModule(reservas, state.reservaFiltros);
}

function poblarRecepcionistasFiltro() {
    return poblarRecepcionistasFiltroModule(ui, state);
}

function poblarTurnosFiltro(reservas) {
    return poblarTurnosFiltroModule(ui, state, reservas);
}

function updateReservasHistorySummary(totalReservas, reservasFiltradas) {
    return updateReservasHistorySummaryModule(ui, state, totalReservas, reservasFiltradas);
}

function updateReservasExperiencePanels(reservas = []) {
    const activas = reservas.filter((reserva) => ['reservada', 'confirmada', 'activa'].includes(reserva.estado)).length;
    const historial = reservas.filter((reserva) => ['cancelada', 'completada', 'no_show', 'cancelada_mantenimiento', 'finalizada_auto'].includes(reserva.estado)).length;
    const pendientes = reservas.filter((reserva) => Number(reserva.pendiente || 0) > 0).length;
    const noShowSugeridos = reservas.filter((reserva) => {
        const tolerance = getReservaToleranceStatus(reserva, state.configHotel, new Date());
        return tolerance.level === 'no_show_sugerido';
    }).length;
    const waitlistPendientes = (state.waitlistItems || []).filter((item) => item.estado === 'pendiente').length;

    const hoy = new Date();
    const inicioHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime();
    const finHoy = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59).getTime();
    const llegadasHoy = reservas.filter((reserva) => {
        const llegadaMs = getDateMsSafe(reserva.fecha_inicio);
        return llegadaMs >= inicioHoy && llegadaMs <= finHoy;
    }).length;

    const kpiActivas = document.getElementById('reservas-kpi-activas');
    const kpiLlegadas = document.getElementById('reservas-kpi-llegadas');
    const kpiPendientes = document.getElementById('reservas-kpi-pendientes');
    const kpiHistorial = document.getElementById('reservas-kpi-historial');
    const policyPill = document.getElementById('reservas-policy-pill');
    const lastUpdate = document.getElementById('reservas-last-update');

    if (kpiActivas) kpiActivas.textContent = String(activas);
    if (kpiLlegadas) kpiLlegadas.textContent = String(llegadasHoy);
    if (kpiPendientes) kpiPendientes.textContent = String(pendientes);
    if (kpiHistorial) kpiHistorial.textContent = String(historial);

    if (policyPill) {
        const policyText = state.configHotel.cobro_al_checkin ? 'Cobro al Check-in' : 'Cobro al Check-out';
        const extras = [];
        if (waitlistPendientes > 0) extras.push(`${waitlistPendientes} en espera`);
        if (noShowSugeridos > 0) extras.push(`${noShowSugeridos} no-show sugerido`);
        policyPill.textContent = extras.length > 0 ? `${policyText} ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ${extras.join(' ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â· ')}` : policyText;
    }
    if (lastUpdate) {
        lastUpdate.textContent = formatDateTime(new Date().toISOString());
    }
}

let reservasSearchDebounceTimer = null;

function syncReservaFiltersFromUI() {
    return syncReservaFiltersFromUIModule(ui, state);
}

function applyReservaFiltersToUI() {
    return applyReservaFiltersToUIModule(ui, state);
}

function scheduleReservasFilterRender() {
    syncReservaFiltersFromUI();
    clearTimeout(reservasSearchDebounceTimer);
    reservasSearchDebounceTimer = setTimeout(() => {
        renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error));
    }, 220);
}

async function handleReservasFiltersSubmit(event) {
    event.preventDefault();
    syncReservaFiltersFromUI();
    await renderReservas();
}

async function resetReservasFilters() {
    state.reservaFiltros = {
        busqueda: '',
        fechaDesde: '',
        fechaHasta: '',
        recepcionistaId: '',
        turnoId: '',
        estado: '',
        modoFecha: 'registro',
        origenReserva: ''
    };
    applyReservaFiltersToUI();
    await renderReservas();
}


async function renderReservas() {
    if (!state.isModuleMounted) {
        console.log("[Reservas] renderReservas abortado porque el modulo ya no esta montado.");
        return;
    }
    if (!ui.reservasListEl) {
        console.error("[Reservas] reservasListEl no encontrado en UI para renderizar.");
        return;
    }

    showLoading(ui.reservasListEl, "Cargando reservas...");
    clearFeedback(ui.reservasListEl);

    await ensureReservasHistorialUsuarios();
    poblarRecepcionistasFiltro();

    const estadosVisibles = ['reservada', 'confirmada', 'activa', 'cancelada', 'completada', 'no_show', 'cancelada_mantenimiento', 'finalizada_auto'];

    const { data: rs, error } = await state.supabase
        .from('reservas')
        .select(`
            *,
            habitaciones(nombre, tipo),
            pagos_reserva(monto),
            cancelador:cancelado_por_usuario_id(nombre)
        `)
        .eq('hotel_id', state.hotelId)
        .in('estado', estadosVisibles)
        .order('fecha_inicio', { ascending: false })
        .limit(500);

    if (error) {
        showError(ui.reservasListEl, `Error cargando reservas: ${error.message}`);
        console.error("[Reservas] Render: Error detallado en la consulta:", error);
        return;
    }

    let htmlGeneral = '';
    if (rs && rs.length > 0) {
        rs.forEach((reserva) => {
            const abonado = reserva.pagos_reserva ? reserva.pagos_reserva.reduce((suma, pago) => suma + Number(pago.monto), 0) : 0;
            reserva.abonado = abonado;
            reserva.pendiente = Math.max((reserva.monto_total || 0) - abonado, 0);
        });

        const turnos = await cargarTurnosParaReservas(rs);
        const reservasEnriquecidas = enriquecerReservasConHistorial(rs, turnos);
        updateReservasExperiencePanels(reservasEnriquecidas);
        poblarTurnosFiltro(reservasEnriquecidas);

        const reservasFiltradas = filtrarReservasHistorial(reservasEnriquecidas);
        updateReservasHistorySummary(reservasEnriquecidas.length, reservasFiltradas);
        htmlGeneral = buildReservasListHtml({
            reservasEnriquecidas,
            reservasFiltradas,
            filtrosActivos: hasActiveReservaFilters(),
            modoFecha: state.reservaFiltros.modoFecha,
            renderReservasGrupo,
            getDateMsSafe,
            getReservaFilterDateISO,
            getReservaRegistroISO
        });
    } else {
        updateReservasExperiencePanels([]);
        poblarTurnosFiltro([]);
        updateReservasHistorySummary(0, []);
        htmlGeneral = buildReservasListHtml({
            reservasEnriquecidas: [],
            reservasFiltradas: [],
            filtrosActivos: hasActiveReservaFilters(),
            modoFecha: state.reservaFiltros.modoFecha,
            renderReservasGrupo,
            getDateMsSafe,
            getReservaFilterDateISO,
            getReservaRegistroISO
        });
    }

    try {
        if (!ui.reservasListEl) {
            ui.reservasListEl = document.getElementById('reservas-list');
            if (!ui.reservasListEl) return;
        }
        ui.reservasListEl.style.display = 'block';
        ui.reservasListEl.innerHTML = htmlGeneral;
    } catch (e) {
        console.error("[Reservas] Render: Error al insertar HTML en el DOM:", e);
        if (ui.reservasListEl) {
            ui.reservasListEl.innerHTML = "<p class='error-indicator'>Error critico al mostrar la lista de reservas. Revise la consola.</p>";
        }
    }
}


function renderReservasGrupo(titulo, grupo) {
    return renderReservasGrupoModule({
        titulo,
        grupo,
        state,
        getAccionesReservaHTML,
        getBorderColorForEstado,
        getBgColorForEstado,
        getTextColorForEstado,
        getFunnelBadgeClasses,
        getToleranceBadgeClasses,
        getReservaOriginLabel,
        getReservaOriginFunnelStage,
        getReservaToleranceStatus,
        escapeHtml,
        formatCurrency,
        formatDateTime
    });
}

async function mostrarModalAbonoReserva(reservaActual) {
    return mostrarModalAbonoReservaModule({
        reservaActual,
        supabase: state.supabase,
        hotelId: state.hotelId,
        currentUser: state.currentUser,
        configHotel: state.configHotel,
        onRefresh: renderReservas
    });
}



function getAccionesReservaHTML(reserva) {
    return getAccionesReservaHTMLModule(reserva, state.currentUser);
}


function configureFechaEntrada(fechaEntradaInput) {
    return configureReservaFechaEntrada(fechaEntradaInput);
}


function resetFormToCreateMode() {
    return resetReservaFormToCreateMode({
        ui,
        state,
        clearFeedback,
        renderPricingRuleSummary,
        actualizarVisibilidadPago,
        configureFechaEntrada
    });
}


function getBorderColorForEstado(e) {
    return getReservaBorderColor(e);
}
function getBgColorForEstado(e) {
    return getReservaBgColor(e);
}
function getTextColorForEstado(e) {
    return getReservaTextColor(e);
}

async function handleExternalUpdate(event) {
    // Opcional: verificar event.detail.origen si necesitas lÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³gica diferente
    console.log("[Reservas] Evento 'datosActualizados' recibido. Refrescando lista de reservas.", event.detail);
    await renderReservas();
}



async function handleFormSubmit(event) {
    return submitReservaForm({
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
    });
}


async function handleListActions(event) {
    return handleReservaListActions({
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
    });
}


/**
 * Proceso completo para cancelar una reserva, incluyendo la reversiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n de pagos.
 * 1. Busca todos los pagos de la reserva en 'pagos_reserva'.
 * 2. Con los IDs de esos pagos, elimina los movimientos correspondientes de 'caja'.
 * 3. Elimina los registros de 'pagos_reserva'.
 * 4. Finalmente, actualiza el estado de la reserva a 'cancelada' y de la habitaciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n a 'libre'.
 */
async function cancelarReservaConReembolso(reservaId, habitacionId) {
    const successMessage = await cancelarReservaConReembolsoFlow({
        reservaId,
        habitacionId,
        ui,
        state,
        showLoading,
        showSuccess,
        renderReservas
    });
    if (successMessage) {
        await showReservaSuccessModal(successMessage);
    }
    return successMessage;
}


function actualizarVisibilidadPago() {
    // Referencias a los elementos que vamos a manipular
    const tipoPagoSelect = ui.form.elements.tipo_pago;
    const abonoContainer = ui.container.querySelector('#abono-container');
    const totalPagoCompletoContainer = ui.container.querySelector('#total-pago-completo');
    const metodoPagoSelect = ui.form.elements.metodo_pago_id;
    const montoAbonoInput = ui.form.elements.monto_abono;

    // Salir si algÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Âºn elemento no se encuentra, para evitar errores
    if (!tipoPagoSelect || !abonoContainer || !totalPagoCompletoContainer || !metodoPagoSelect || !montoAbonoInput) {
        console.error("No se encontraron todos los elementos del formulario de pago.");
        return;
    }

    // LÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³gica principal
    if (tipoPagoSelect.value === 'completo') {
        // Si es PAGO COMPLETO:
        abonoContainer.style.display = 'none'; // Ocultar campo de abono
        totalPagoCompletoContainer.style.display = 'block'; // Mostrar el total a pagar
        montoAbonoInput.required = false; // El abono ya no es requerido
        montoAbonoInput.value = ''; // Limpiar el valor del abono
        
        // El mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todo de pago es requerido solo si hay un total mayor a cero
        metodoPagoSelect.required = state.currentBookingTotal > 0;

    } else {
        // Si es PAGO PARCIAL:
        abonoContainer.style.display = 'block'; // Mostrar campo de abono
        totalPagoCompletoContainer.style.display = 'none'; // Ocultar el total a pagar
        
        // El mÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©todo de pago es requerido solo si se ingresa un abono mayor a cero
        const abonoActual = parseFloat(montoAbonoInput.value) || 0;
        metodoPagoSelect.required = abonoActual > 0;
    }
}
// En tu archivo reservas.js, reemplaza tu funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n mount por esta versiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n definitiva

// En tu archivo reservas.js, reemplaza TODA la funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n mount con esta versiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n:

// En tu archivo reservas.js, REEMPLAZA TODA la funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n mount con esta versiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n final:

export async function mount(container, supabaseClient, user, hotelId) {
    // --- 1. CONFIGURACIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN INICIAL DEL ESTADO ---
    state.isModuleMounted = true;
    state.supabase = supabaseClient;
    state.currentUser = user;
    state.hotelId = hotelId;
    

    if (!user || !user.id) {
        container.innerHTML = `<p class="error-box">Usuario no autenticado. Acceso denegado.</p>`;
        return;
    }
    if (!hotelId) {
        container.innerHTML = `<p class="error-box">ID del hotel no disponible. MÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³dulo de reservas no puede operar.</p>`;
        return;
    }
    await turnoService.getTurnoAbierto(supabaseClient, user.id, hotelId);

    console.log("[Reservas Mount] Iniciando montaje...");

    // --- 2. RENDERIZAR LA ESTRUCTURA HTML PRINCIPAL (CORREGIDA SIN DUPLICADOS) ---
    // REEMPLAZA el contenido de container.innerHTML en tu funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n mount CON ESTE BLOQUE COMPLETO

container.innerHTML = `
    <div class="max-w-7xl mx-auto mt-8 px-4 pb-10">
        <section class="relative overflow-hidden rounded-[28px] border border-slate-200 bg-[radial-gradient(circle_at_top_left,_rgba(37,99,235,0.14),_transparent_34%),linear-gradient(135deg,_#ffffff,_#f8fbff_48%,_#f1f5f9)] p-6 shadow-[0_22px_80px_-36px_rgba(15,23,42,0.55)] md:p-8">
            <div class="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-blue-200/30 blur-3xl"></div>
            <div class="absolute bottom-0 right-0 h-28 w-28 rounded-full bg-emerald-200/30 blur-2xl"></div>
            <div class="relative flex flex-col gap-6">
                <div class="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div class="max-w-3xl">
                        <div class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-blue-700 shadow-sm">
                            Centro de Reservas
                        </div>
                        <h2 id="form-title" class="mt-4 text-3xl font-black tracking-tight text-slate-900 md:text-4xl">Registrar Nueva Reserva</h2>
                        <p class="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-[15px]">
                            Gestiona llegadas, pagos y seguimiento del historial desde una sola vista mas clara y rapida para recepcion.
                        </p>
                    </div>
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:min-w-[360px]">
                        <div class="rounded-2xl border border-white/70 bg-white/85 p-4 shadow-sm backdrop-blur">
                            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">Politica de cobro</p>
                            <p id="reservas-policy-pill" class="mt-2 text-lg font-bold text-slate-900">Cargando...</p>
                            <p class="mt-1 text-xs text-slate-500">Se actualiza segun la configuracion del hotel.</p>
                        </div>
                        <div class="rounded-2xl border border-white/70 bg-slate-900 p-4 text-white shadow-sm">
                            <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-300">Ultima actualizacion</p>
                            <p id="reservas-last-update" class="mt-2 text-lg font-bold">Sin datos</p>
                            <p class="mt-1 text-xs text-slate-300">La vista se refresca al guardar o filtrar.</p>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <article class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Activas</p>
                        <p id="reservas-kpi-activas" class="mt-2 text-3xl font-black text-slate-900">0</p>
                        <p class="mt-1 text-xs text-slate-500">Reservadas, confirmadas y activas</p>
                    </article>
                    <article class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Llegan Hoy</p>
                        <p id="reservas-kpi-llegadas" class="mt-2 text-3xl font-black text-blue-700">0</p>
                        <p class="mt-1 text-xs text-slate-500">Check-ins programados para hoy</p>
                    </article>
                    <article class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Con Saldo</p>
                        <p id="reservas-kpi-pendientes" class="mt-2 text-3xl font-black text-amber-600">0</p>
                        <p class="mt-1 text-xs text-slate-500">Reservas con pago pendiente</p>
                    </article>
                    <article class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm backdrop-blur">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Historial</p>
                        <p id="reservas-kpi-historial" class="mt-2 text-3xl font-black text-emerald-700">0</p>
                        <p class="mt-1 text-xs text-slate-500">Completadas, canceladas y no show</p>
                    </article>
                </div>
            </div>
        </section>

        <form id="reserva-form" class="relative mt-8 space-y-8 overflow-hidden rounded-[32px] border border-slate-200 bg-[radial-gradient(circle_at_top_right,_rgba(37,99,235,0.12),_transparent_24%),linear-gradient(180deg,_#ffffff,_#f8fbff)] p-6 shadow-[0_24px_80px_-36px_rgba(15,23,42,0.45)] md:p-8">
            <div class="grid gap-4 rounded-[26px] border border-slate-200 bg-white/85 p-5 shadow-sm lg:grid-cols-[1.15fr_0.85fr]">
                <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-blue-700">Reserva Studio</p>
                    <h3 class="mt-2 text-2xl font-black tracking-tight text-slate-900">Una vista mas limpia para registrar reservas sin perder contexto</h3>
                    <p class="mt-3 text-sm leading-6 text-slate-600">Ahora el formulario resalta mejor las decisiones importantes: cliente, estancia, descuentos, pago y seguimiento posterior.</p>
                </div>
                <div class="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                    <div class="rounded-2xl border border-blue-100 bg-blue-50/80 p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">Rapido</p>
                        <p class="mt-2 text-sm font-semibold text-slate-900">Selecciona cliente y habitacion</p>
                    </div>
                    <div class="rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Claro</p>
                        <p class="mt-2 text-sm font-semibold text-slate-900">Total y pago siempre visibles</p>
                    </div>
                    <div class="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-4">
                        <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Ordenado</p>
                        <p class="mt-2 text-sm font-semibold text-slate-900">Historial mas facil de buscar</p>
                    </div>
                </div>
            </div>
            <div class="grid gap-4 md:grid-cols-3">
                <div class="rounded-[24px] border border-blue-100 bg-[linear-gradient(180deg,_#ffffff,_#eef5ff)] px-4 py-4 shadow-sm">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Paso 1</p>
                    <p class="mt-2 text-base font-bold text-slate-900">Selecciona o crea el cliente</p>
                    <p class="mt-1 text-sm text-slate-500">Busca uno existente o diligencia los datos manualmente.</p>
                </div>
                <div class="rounded-[24px] border border-indigo-100 bg-[linear-gradient(180deg,_#ffffff,_#f4f3ff)] px-4 py-4 shadow-sm">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Paso 2</p>
                    <p class="mt-2 text-base font-bold text-slate-900">Configura estancia y valor</p>
                    <p class="mt-1 text-sm text-slate-500">Define fechas, habitacion, cantidad de huespedes y descuentos.</p>
                </div>
                <div class="rounded-[24px] border border-emerald-100 bg-[linear-gradient(180deg,_#ffffff,_#ecfdf5)] px-4 py-4 shadow-sm">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Paso 3</p>
                    <p class="mt-2 text-base font-bold text-slate-900">Registra el pago</p>
                    <p class="mt-1 text-sm text-slate-500">Aplica el metodo correspondiente y guarda la reserva.</p>
                </div>
            </div>

            <fieldset class="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#fafcff)] p-6 shadow-sm">
                <legend class="px-3 text-lg font-bold text-slate-700">1. Datos del Cliente</legend>
                <p class="mb-4 text-sm text-slate-500">Manten la ficha del huesped ordenada desde el inicio para agilizar futuras reservas y check-ins.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                    <div class="md:col-span-2">
                        <label for="cliente_search_input" class="font-semibold text-sm text-gray-700 block mb-1">Buscar Cliente Existente</label>
                        <div class="flex items-center gap-2">
                            <input name="cliente_search_input" id="cliente_search_input" class="form-control flex-grow" placeholder="Click en 'Buscar' para abrir el selector" readonly/>
                            <button type="button" id="btn_buscar_cliente" class="button button-info">Buscar</button>
                            <button type="button" id="btn_crear_cliente" class="button button-success p-2 rounded-full" title="Crear Nuevo Cliente">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>
                            </button>
                        </div>
                        <input type="hidden" name="cliente_id_hidden" id="cliente_id_hidden" />
                        <div id="cliente_nombre_display" class="mt-3 hidden flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-blue-800 shadow-sm">
                            <div><strong class="mr-2">Cliente:</strong> <span id="selected_client_name"></span></div>
                            <button type="button" id="btn_clear_cliente" class="text-red-500 font-bold text-lg leading-none" title="Deseleccionar cliente">&times;</button>
                        </div>
                    </div>
                    <div id="new-client-fields" class="md:col-span-2">
                        <p class="text-sm text-gray-500 mb-2">O ingresa los datos para un cliente nuevo:</p>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div>
                                <label for="cliente_nombre" class="font-semibold text-sm text-gray-700">Nombre completo*</label>
                                <input name="cliente_nombre" id="cliente_nombre" class="form-control" required maxlength="120" />
                            </div>
                            <div>
                                <label for="cedula" class="font-semibold text-sm text-gray-700">Cedula / ID</label>
                                <input name="cedula" id="cedula" class="form-control" maxlength="30" />
                            </div>
                            <div>
                                <label for="telefono" class="font-semibold text-sm text-gray-700">Telefono</label>
                                <input name="telefono" id="telefono" type="tel" class="form-control" maxlength="30" />
                            </div>
                        </div>
                    </div>
                </div>
            </fieldset>

           <fieldset class="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fbff)] p-6 shadow-sm">
    <legend class="px-3 text-lg font-bold text-slate-700">2. Detalles de la Reserva</legend>
    <p class="mb-4 text-sm text-slate-500">Calcula la estancia con mayor claridad y deja visibles las decisiones clave para recepcion.</p>
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
        <div>
            <label for="fecha_entrada" class="font-semibold text-sm text-gray-700">Fecha y hora de llegada*</label>
            <input type="datetime-local" name="fecha_entrada" id="fecha_entrada" class="form-control" required />
        </div>
        <div>
            <label for="tipo_calculo_duracion" class="font-semibold text-sm text-gray-700">Calcular duracion por*</label>
            <select name="tipo_calculo_duracion" id="tipo_calculo_duracion" class="form-control" required>
                <option value="noches_manual">Noches (manual)</option>
                <option value="tiempo_predefinido">Tiempo predefinido</option>
            </select>
        </div>
        <div id="noches-manual-container">
            <label for="cantidad_noches" class="font-semibold text-sm text-gray-700">Cantidad de noches*</label>
            <input name="cantidad_noches" id="cantidad_noches" type="number" min="1" max="90" value="1" class="form-control" />
        </div>
        <div id="tiempo-predefinido-container" style="display:none;">
            <label for="tiempo_estancia_id" class="font-semibold text-sm text-gray-700">Selecciona tiempo de estancia*</label>
            <select name="tiempo_estancia_id" id="tiempo_estancia_id" class="form-control"></select>
        </div>
        <div>
            <label for="habitacion_id" class="font-semibold text-sm text-gray-700">Habitacion*</label>
            <select name="habitacion_id" id="habitacion_id" class="form-control" required></select>
        </div>
        <div>
            <label for="cantidad_huespedes" class="font-semibold text-sm text-gray-700">Cantidad de huespedes*</label>
            <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" min="1" max="20" value="2" class="form-control" required />
        </div>
        <div>
            <label for="origen_reserva" class="font-semibold text-sm text-gray-700">Fuente de reserva</label>
            <select name="origen_reserva" id="origen_reserva" class="form-control">
                ${getOriginOptionsHtml('directa')}
            </select>
        </div>

        <div class="lg:col-span-3 md:col-span-2 pt-3 mt-3 border-t border-slate-200">
            <label class="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" id="precio_libre_toggle" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600">
                <span class="font-semibold text-indigo-700">Asignar Precio Manual (Libre)</span>
            </label>
            <div id="precio_libre_container" class="mt-2" style="display:none;">
                <label for="precio_libre_valor" class="font-semibold text-sm text-gray-700">Valor Total de la Estancia (sin impuestos)</label>
                <input type="number" id="precio_libre_valor" name="precio_libre_valor" class="form-control mt-1 text-lg font-bold" placeholder="Ingrese el valor total">
            </div>
            <div id="pricing-rule-summary" class="mt-4"></div>
        </div>
        </div>
</fieldset>
            
            <fieldset class="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#fcfffe)] p-6 shadow-sm">
                <legend class="px-3 text-lg font-bold text-slate-700">Descuento</legend>
                <p class="mb-4 text-sm text-slate-500">Aplica promociones manuales o valida descuentos del cliente antes de confirmar.</p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4 items-center">
                    <div>
                        <label for="codigo-descuento-reserva" class="font-semibold text-sm text-gray-700">Codigo de descuento (opcional)</label>
                        <div class="flex items-center gap-2 mt-1">
                            <input type="text" id="codigo-descuento-reserva" class="form-control flex-grow" placeholder="PROMO2025">
                            <button type="button" id="btn-aplicar-descuento-reserva" class="button button-info">Aplicar</button>
                        </div>
                        <div id="feedback-descuento-reserva" class="text-xs mt-1 h-4"></div>
                    </div>
                    <div id="descuento-resumen-reserva" class="text-sm text-green-600 bg-green-50 p-3 rounded-2xl border border-green-200 shadow-sm" style="display: none;">
                        </div>
                </div>
            </fieldset>
            <div class="overflow-hidden rounded-[28px] border border-blue-200 bg-[linear-gradient(135deg,_#eff6ff,_#ffffff_55%,_#ecfeff)] shadow-[0_24px_60px_-34px_rgba(37,99,235,0.45)]">
                <div class="grid gap-4 p-5 md:grid-cols-[1.1fr_0.9fr] md:items-center">
                    <div>
                        <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Resumen en vivo</p>
                        <p class="mt-2 text-sm text-slate-600">El total se recalcula automaticamente cuando cambias habitacion, fechas, huespedes o descuentos.</p>
                    </div>
                    <div class="rounded-[24px] border border-white/80 bg-white/85 p-5 text-center shadow-inner">
                        <p id="reserva-total-caption" class="text-sm font-semibold text-blue-700">Total estimado de la reserva</p>
                        <p id="total-reserva-calculado-display" class="mt-2 text-3xl font-extrabold text-blue-600">$0</p>
                        <p id="reserva-total-support" class="mt-2 text-xs text-slate-500">Sin descuentos ni impuestos aplicados aun.</p>
                    </div>
                </div>
            </div>

            <div id="payment-message-checkout" class="hidden rounded-[22px] border border-orange-200 bg-orange-50 p-4 text-center text-sm text-orange-700 shadow-sm">
                La politica del hotel es <strong class="font-semibold">Cobro al Check-out</strong>. Los detalles del pago se gestionaran al finalizar la estancia.
            </div>

            <fieldset id="fieldset-pago-adicionales" class="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#fefefe)] p-6 shadow-sm">
                 <legend class="px-3 text-lg font-bold text-slate-700">3. Pago y adicionales</legend>
                 <p class="mb-4 text-sm text-slate-500">Deja claro si la reserva entra con abono, pago completo o si el cobro queda para salida.</p>
                 <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mt-4">
                     <div>
                         <label for="tipo_pago" class="font-semibold text-sm text-gray-700">Tipo de pago*</label>
                         <select id="tipo_pago" name="tipo_pago" class="form-control" required>
                             <option value="parcial">Pago parcial (abono)</option>
                             <option value="completo">Pago completo</option>
                         </select>
                     </div>
                     <div>
                         <label for="metodo_pago_id" class="font-semibold text-sm text-gray-700">Metodo de pago*</label>
                         <select name="metodo_pago_id" id="metodo_pago_id" class="form-control"></select>
                     </div>
                     <div id="abono-container" class="md:col-span-2">
                         <label for="monto_abono" class="font-semibold text-sm text-gray-700">Valor a abonar</label>
                         <input name="monto_abono" id="monto_abono" type="number" min="0" step="1000" class="form-control" placeholder="0" />
                     </div>
                     <div id="total-pago-completo" class="md:col-span-2 hidden">
                         <div class="text-center py-4">
                             <span class="text-2xl font-bold text-green-600">Total a pagar: <span id="valor-total-pago">$0</span></span>
                         </div>
                     </div>
                 </div>
            </fieldset>

            <fieldset class="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#fafafa)] p-6 shadow-sm">
                <legend class="px-3 text-lg font-bold text-slate-700">4. Notas</legend>
                <p class="mb-4 text-sm text-slate-500">Usa este espacio para observaciones operativas relevantes para recepcion y limpieza.</p>
                <div>
                    <label for="notas" class="font-semibold text-sm text-gray-700">Notas adicionales (visibles para el staff)</label>
                    <textarea name="notas" id="notas" class="form-control mt-2" maxlength="500" rows="2" placeholder="Ej: Solicitud especial del cliente, llegada tardia..."></textarea>
                </div>
            </fieldset>

            <div class="flex flex-col sm:flex-row gap-4 pt-4 justify-center">
                <button type="submit" id="submit-button" class="button button-success py-3 px-6 rounded-2xl text-lg shadow-[0_14px_30px_-18px_rgba(16,185,129,0.75)]">Registrar reserva</button>
                <button type="button" id="cancel-edit-button" class="button button-neutral py-3 px-6 rounded-2xl hidden">Cancelar edicion</button>
            </div>
        </form>

        <div id="reserva-feedback" class="mt-6"></div>

        <section class="mt-10 grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <div class="overflow-hidden rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fbff)] p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.42)]">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Revenue control</p>
                        <h3 class="text-2xl font-bold text-slate-800">Reglas de tarifa dinamica</h3>
                        <p class="text-sm text-slate-600">Crea ajustes por origen, dias o periodos para que el total de la reserva se adapte mejor a la operacion real.</p>
                    </div>
                    <span class="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-semibold text-blue-700">Aplican sobre la estancia base</span>
                </div>
                <div id="pricing-rules-panel" class="mt-5"></div>
            </div>

            <section class="overflow-hidden rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.42)]">
                <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Nueva regla</p>
                <h3 class="mt-2 text-xl font-bold text-slate-900">Configurar ajuste rapido</h3>
                <form id="pricing-rule-form" class="mt-5 space-y-4">
                    <div class="grid gap-4 md:grid-cols-2">
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Nombre de la regla</label>
                            <input type="text" name="nombre" class="form-control" placeholder="Ej. Fin de semana OTA" required>
                        </div>
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Origen comercial</label>
                            <select name="origen_reserva" class="form-control">
                                ${getOriginOptionsHtml('', true)}
                            </select>
                        </div>
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Tipo de ajuste</label>
                            <select name="tipo_ajuste" class="form-control">
                                <option value="porcentaje">Porcentaje</option>
                                <option value="fijo">Monto fijo</option>
                            </select>
                        </div>
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Valor</label>
                            <input type="number" name="valor" class="form-control" step="0.01" placeholder="10 o 20000">
                        </div>
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Desde</label>
                            <input type="date" name="fecha_inicio" class="form-control">
                        </div>
                        <div>
                            <label class="font-semibold text-sm text-gray-700">Hasta</label>
                            <input type="date" name="fecha_fin" class="form-control">
                        </div>
                        <div class="md:col-span-2">
                            <label class="font-semibold text-sm text-gray-700">Habitacion (opcional)</label>
                            <select name="habitacion_id" class="form-control">
                                <option value="">Todas las habitaciones</option>
                            </select>
                        </div>
                    </div>
                    <div>
                        <label class="font-semibold text-sm text-gray-700">Dias de la semana</label>
                        <div class="mt-2 flex flex-wrap gap-2">
                            ${buildPricingRuleDaysOptions([])}
                        </div>
                    </div>
                    <div class="grid gap-3 md:grid-cols-2">
                        <label class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                            <input type="checkbox" name="aplica_noches" checked>
                            <span>Aplica para reservas por noches</span>
                        </label>
                        <label class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700">
                            <input type="checkbox" name="aplica_horas" checked>
                            <span>Aplica para reservas por horas</span>
                        </label>
                    </div>
                    <div>
                        <label class="font-semibold text-sm text-gray-700">Descripcion</label>
                        <textarea name="descripcion" rows="2" class="form-control" placeholder="Ej. Ajuste para fines de semana o alta demanda."></textarea>
                    </div>
                    <div class="flex justify-end">
                        <button type="submit" class="button button-info rounded-2xl px-5 py-3">Guardar regla</button>
                    </div>
                </form>
            </section>
        </section>

        <section class="mt-10 overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,_#fffdf7,_#ffffff)] p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.42)]">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Operacion comercial</p>
                    <h3 class="text-2xl font-bold text-slate-800">Lista de espera y reasignacion</h3>
                    <p class="text-sm text-slate-600">Cuando hoy no puedas asignar la habitacion ideal, deja el cliente en seguimiento y usa sugerencias automaticas para retomarlo despues.</p>
                </div>
                <div id="reservas-waitlist-summary"></div>
            </div>
            <div class="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" id="btn-enviar-lista-espera" class="button button-warning rounded-2xl px-5 py-3">Enviar a lista de espera</button>
                <span class="text-sm text-slate-500">Usa el formulario actual como base para crear el seguimiento.</span>
            </div>
            <div id="reservas-waitlist-list" class="mt-5 space-y-4"></div>
        </section>

        <section class="mt-10 overflow-hidden rounded-[32px] border border-slate-200 bg-[linear-gradient(180deg,_#f8fafc,_#ffffff)] p-6 shadow-[0_18px_60px_-36px_rgba(15,23,42,0.42)]">
            <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h3 class="text-2xl font-bold text-slate-800">Historial y busqueda de reservas</h3>
                    <p class="text-sm text-slate-600">Filtra por fecha, recepcionista, fuente comercial o turno para revisar reservas registradas y encontrar rapido cualquier movimiento.</p>
                </div>
                <div id="reservas-history-summary" class="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm"></div>
            </div>

            <div class="mt-5 grid gap-4 md:grid-cols-3">
                <div class="rounded-[22px] border border-blue-100 bg-blue-50/80 p-4">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">Busqueda</p>
                    <p class="mt-2 text-sm font-semibold text-slate-900">Cliente, habitacion o recepcionista</p>
                </div>
                <div class="rounded-[22px] border border-indigo-100 bg-indigo-50/80 p-4">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-700">Filtro</p>
                    <p class="mt-2 text-sm font-semibold text-slate-900">Fecha de registro, llegada o salida</p>
                </div>
                <div class="rounded-[22px] border border-emerald-100 bg-emerald-50/80 p-4">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Seguimiento</p>
                    <p class="mt-2 text-sm font-semibold text-slate-900">Turno, estado y recepcionista en una sola vista</p>
                </div>
            </div>

            <form id="reservas-history-filters" class="mt-5 grid grid-cols-1 gap-4 rounded-[28px] border border-slate-200 bg-slate-50/80 p-5 shadow-inner md:grid-cols-2 xl:grid-cols-4">
                <div class="xl:col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_search" class="font-semibold text-sm text-gray-700 block mb-1">Buscar</label>
                    <input id="reservas_search" class="form-control" placeholder="Cliente, habitacion, nota o recepcionista" />
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_fecha_modo" class="font-semibold text-sm text-gray-700 block mb-1">Tipo de fecha</label>
                    <select id="reservas_fecha_modo" class="form-control">
                        <option value="registro">Fecha de registro</option>
                        <option value="llegada">Fecha de llegada</option>
                        <option value="salida">Fecha de salida</option>
                    </select>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_estado_filter" class="font-semibold text-sm text-gray-700 block mb-1">Estado</label>
                    <select id="reservas_estado_filter" class="form-control">
                        <option value="">Todos</option>
                        <option value="reservada">Reservada</option>
                        <option value="confirmada">Confirmada</option>
                        <option value="activa">Activa</option>
                        <option value="completada">Completada</option>
                        <option value="cancelada">Cancelada</option>
                        <option value="no_show">No presentado</option>
                    </select>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_fecha_desde" class="font-semibold text-sm text-gray-700 block mb-1">Desde</label>
                    <input type="date" id="reservas_fecha_desde" class="form-control" />
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_fecha_hasta" class="font-semibold text-sm text-gray-700 block mb-1">Hasta</label>
                    <input type="date" id="reservas_fecha_hasta" class="form-control" />
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_recepcionista" class="font-semibold text-sm text-gray-700 block mb-1">Recepcionista</label>
                    <select id="reservas_recepcionista" class="form-control">
                        <option value="">Todas</option>
                    </select>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_turno" class="font-semibold text-sm text-gray-700 block mb-1">Turno</label>
                    <select id="reservas_turno" class="form-control">
                        <option value="">Todos</option>
                    </select>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-4">
                    <label for="reservas_origen_filter" class="font-semibold text-sm text-gray-700 block mb-1">Origen</label>
                    <select id="reservas_origen_filter" class="form-control">
                        ${getOriginOptionsHtml('', true)}
                    </select>
                </div>
                <div class="flex items-end gap-3 xl:col-span-4">
                    <button type="submit" class="button button-info rounded-2xl px-5 py-3 shadow-sm">Buscar</button>
                    <button type="button" id="btn-limpiar-filtros-reservas" class="button button-neutral rounded-2xl px-5 py-3">Limpiar filtros</button>
                </div>
            </form>
        </section>

        <div id="reservas-list" class="mt-8 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"></div>
    </div>
    
    <div id="modal-container-secondary" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4" style="display:none;"></div>
`;

    // --- 3. INICIALIZAR REFERENCIAS A LA UI ---
    ui.init(container);
    applyReservaFiltersToUI();

    // --- 4. LÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œGICA Y LISTENERS DE EVENTOS ---
    
// DENTRO DE LA FUNCIÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œN mount, REEMPLAZA la funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n interna updateClienteFields
// EN: js/modules/reservas/reservas.js

const updateClienteFields = (cliente) => {
    const newClientFieldsContainer = ui.container.querySelector('#new-client-fields');
    if (cliente) {
        // Rellena los campos con el cliente seleccionado
        ui.clienteIdHiddenInput.value = cliente.id;
        ui.clienteNombreDisplay.querySelector('#selected_client_name').textContent = cliente.nombre;
        ui.form.elements.cliente_nombre.value = cliente.nombre; // Llenar tambiÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â©n el input manual
        ui.form.elements.cedula.value = cliente.documento || '';
        ui.form.elements.telefono.value = cliente.telefono || '';
        // Muestra el panel del cliente seleccionado y oculta los campos de nuevo cliente
        ui.clienteNombreDisplay.classList.remove('hidden');
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'none';
        ui.form.elements.cliente_nombre.required = false; // El nombre ya no es requerido
    } else {
        // Limpia todos los campos si no hay cliente seleccionado
        ui.clienteIdHiddenInput.value = '';
        ['cliente_nombre', 'cedula', 'telefono'].forEach(name => {
            if (ui.form.elements[name]) ui.form.elements[name].value = '';
        });
        // Oculta el panel y vuelve a mostrar los campos para un nuevo cliente
        ui.clienteNombreDisplay.classList.add('hidden');
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'block';
        ui.form.elements.cliente_nombre.required = true;
    }
};
    
    if (ui.btnBuscarCliente) {
    ui.btnBuscarCliente.onclick = () => {
        showClienteSelectorModal(state.supabase, state.hotelId, {
            onSelect: async (cliente) => {
                updateClienteFields(cliente);
                clearFeedback(ui.feedbackDiv);
                // ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã‹Å“ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â° AquÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­ llamas a recalcular con el nuevo cliente seleccionado
                await recalcularYActualizarTotalUI();
            }
        });
    };
}


    const btnCrearCliente = container.querySelector('#btn_crear_cliente');
    if (btnCrearCliente) {
        btnCrearCliente.onclick = () => {
            mostrarFormularioCliente(null, state.supabase, state.hotelId, { 
                afterSave: (nuevoCliente) => {
                    updateClienteFields(nuevoCliente);
                    showSuccess(ui.feedbackDiv, `Cliente "${nuevoCliente.nombre}" creado y seleccionado.`);
                    setTimeout(() => clearFeedback(ui.feedbackDiv), 2500);
                }
            });
        };
    }
    
    container.querySelector('#btn_clear_cliente')?.addEventListener('click', () => updateClienteFields(null));
    
    // Listeners que afectan el cÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo del total y la UI


const setupEventListeners = () => {
    // Referencias a los elementos de la UI
    const togglePrecioLibre = ui.container.querySelector('#precio_libre_toggle');
    const containerPrecioLibre = ui.container.querySelector('#precio_libre_container');

    // Listener para mostrar/ocultar el campo de precio libre
    if (togglePrecioLibre && containerPrecioLibre) {
        togglePrecioLibre.addEventListener('change', () => {
            containerPrecioLibre.style.display = togglePrecioLibre.checked ? 'block' : 'none';
        });
    }

    // Lista de todos los inputs que deben disparar un recÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¡lculo del total
    const inputsToRecalculate = [
        ui.habitacionIdSelect,
        ui.cantidadNochesInput,
        ui.tiempoEstanciaIdSelect,
        ui.form.elements.cantidad_huespedes,
        ui.fechaEntradaInput,
        ui.origenReservaSelect,
        togglePrecioLibre, // La casilla de precio libre
        ui.container.querySelector('#precio_libre_valor') // El input del valor de precio libre
    ];

    inputsToRecalculate.forEach(el => {
        if (el) {
            const eventType = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(eventType, () => recalcularYActualizarTotalUI());
        }
    });
    
    // Listeners existentes que se mantienen
    const btnAplicarDescuento = ui.container.querySelector('#btn-aplicar-descuento-reserva');
    if (btnAplicarDescuento) {
        btnAplicarDescuento.addEventListener('click', handleAplicarDescuentoReserva);
    }

    if (ui.tipoCalculoDuracionEl) {
        ui.tipoCalculoDuracionEl.addEventListener('change', () => {
            const esNochesManual = ui.tipoCalculoDuracionEl.value === 'noches_manual';
            if(ui.nochesManualContainer) ui.nochesManualContainer.style.display = esNochesManual ? '' : 'none';
            if(ui.cantidadNochesInput) ui.cantidadNochesInput.required = esNochesManual;
            if(ui.tiempoPredefinidoContainer) ui.tiempoPredefinidoContainer.style.display = esNochesManual ? 'none' : '';
            if(ui.tiempoEstanciaIdSelect) ui.tiempoEstanciaIdSelect.required = !esNochesManual;
        });
    }

    if (ui.form.elements.tipo_pago) ui.form.elements.tipo_pago.addEventListener('change', actualizarVisibilidadPago);
    if (ui.form.elements.monto_abono) ui.form.elements.monto_abono.addEventListener('input', actualizarVisibilidadPago);

    if (ui.form) ui.form.addEventListener('submit', handleFormSubmit);
    if (ui.cancelEditButton) ui.cancelEditButton.addEventListener('click', () => resetFormToCreateMode());
    if (ui.reservasListEl) ui.reservasListEl.addEventListener('click', handleListActions);
    if (ui.waitlistListEl) ui.waitlistListEl.addEventListener('click', handleWaitlistPanelClick);
    if (ui.waitlistActionButton) ui.waitlistActionButton.addEventListener('click', () => {
        handleSaveWaitlistFromForm().catch((error) => {
            console.error('[Reservas] Error enviando a lista de espera:', error);
            showError(ui.feedbackDiv, `No se pudo enviar a lista de espera: ${error.message}`);
        });
    });
    if (ui.pricingRuleForm) ui.pricingRuleForm.addEventListener('submit', handlePricingRuleSave);
    if (ui.pricingRulesPanel) ui.pricingRulesPanel.addEventListener('click', handlePricingRulePanelClick);
    if (ui.reservasFiltrosForm) ui.reservasFiltrosForm.addEventListener('submit', handleReservasFiltersSubmit);
    if (ui.reservasClearFiltersButton) ui.reservasClearFiltersButton.addEventListener('click', () => {
        resetReservasFilters().catch((error) => console.error('[Reservas] Error limpiando filtros:', error));
    });
    if (ui.reservasSearchInput) ui.reservasSearchInput.addEventListener('input', scheduleReservasFilterRender);
    if (ui.reservasFechaModoSelect) ui.reservasFechaModoSelect.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasFechaDesdeInput) ui.reservasFechaDesdeInput.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasFechaHastaInput) ui.reservasFechaHastaInput.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasRecepcionistaSelect) ui.reservasRecepcionistaSelect.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasTurnoSelect) ui.reservasTurnoSelect.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasEstadoSelect) ui.reservasEstadoSelect.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    if (ui.reservasOrigenSelect) ui.reservasOrigenSelect.addEventListener('change', () => { syncReservaFiltersFromUI(); renderReservas().catch((error) => console.error('[Reservas] Error aplicando filtros:', error)); });
    
    document.addEventListener('datosActualizados', handleExternalUpdate);
};   


await loadInitialData(); 
    setupEventListeners();   
    
    await syncReservasConGoogleCalendar(state); 
    
    resetFormToCreateMode(); 
    
    console.log("[Reservas Mount] Montaje completado y listeners adjuntados.");
}



export function unmount(container) {
     state.isModuleMounted = false;
    clearTimeout(reservasSearchDebounceTimer);
    console.log("Modulo Reservas desmontado.");
    console.log("Modulo Reservas desmontado.");
    if (ui.form && typeof handleFormSubmit === 'function') {
        ui.form.removeEventListener('submit', handleFormSubmit);
    }
    if (ui.reservasListEl && typeof handleListActions === 'function') {
        ui.reservasListEl.removeEventListener('click', handleListActions);
    }
    if (ui.cancelEditButton && typeof resetFormToCreateMode === 'function') {
        ui.cancelEditButton.onclick = null;
    }
    if (ui.tipoCalculoDuracionEl) {
         ui.tipoCalculoDuracionEl.onchange = null;
    }
     const tipoPagoSelectEl = document.getElementById('tipo_pago');
     if(tipoPagoSelectEl && ui.togglePaymentFieldsVisibility) { // Asegurar que la funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n exista
        // No hay una funciÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â³n especÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â­fica para remover, pero el onchange se pierde con el innerHTML
     }

    document.removeEventListener('datosActualizados', handleExternalUpdate);

    state.isEditMode = false;
    state.editingReservaId = null;
    state.tiemposEstanciaDisponibles = [];
    state.reservasHistorialUsuarios = [];
    state.reservasHistorialTurnos = [];
    state.pricingRules = [];
    state.currentPricingRule = null;
    state.waitlistItems = [];
    state.waitlistSuggestionsCache = {};
    state.pricingRulesAvailable = true;
    state.waitlistAvailable = true;
    state.reservaFiltros = {
        busqueda: '',
        fechaDesde: '',
        fechaHasta: '',
        recepcionistaId: '',
        turnoId: '',
        estado: '',
        modoFecha: 'registro',
        origenReserva: ''
    };
    state.currentBookingTotal = 0;
    state.configHotel = {
        cobro_al_checkin: true,
        checkin_hora_config: "15:00",
        checkout_hora_config: "12:00",
        impuestos_incluidos_en_precios: false,
        porcentaje_impuesto_principal: 0,
        nombre_impuesto_principal: null,
        tipo_turno_global: 12,
        moneda_local_simbolo: '$',
        moneda_codigo_iso_info: 'COP',
        moneda_decimales_info: '0',
        minutos_tolerancia_llegada: 60,
        minutos_alerta_reserva: 120,
        minutos_alerta_checkout: 30
    };
    if (ui.container) {
        ui.container.innerHTML = '';
    }
    ui.container = null; ui.form = null; ui.feedbackDiv = null; ui.formTitle = null;
    ui.submitButton = null; ui.cancelEditButton = null; ui.reservasListEl = null;
    ui.fechaEntradaInput = null; ui.tipoCalculoDuracionEl = null; ui.nochesManualContainer = null;
    ui.cantidadNochesInput = null; ui.tiempoPredefinidoContainer = null; ui.tiempoEstanciaIdSelect = null;
    ui.habitacionIdSelect = null; ui.totalReservaDisplay = null; ui.fieldsetPago = null; ui.cedulaInput = null;
    ui.reservasFiltrosForm = null; ui.reservasSearchInput = null; ui.reservasFechaModoSelect = null;
    ui.reservasFechaDesdeInput = null; ui.reservasFechaHastaInput = null; ui.reservasRecepcionistaSelect = null;
    ui.reservasTurnoSelect = null; ui.reservasEstadoSelect = null; ui.reservasClearFiltersButton = null;
    ui.reservasSummaryEl = null; ui.reservasOrigenSelect = null; ui.origenReservaSelect = null;
    ui.pricingRuleSummary = null; ui.pricingRulesPanel = null; ui.pricingRuleForm = null;
    ui.waitlistListEl = null; ui.waitlistSummaryEl = null; ui.waitlistActionButton = null;
    
    console.log("Reservas module unmounted and listeners removed.");
}
