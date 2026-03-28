export function getReservaRegistroISO(reserva) {
    return reserva?.creado_en || reserva?.created_at || reserva?.fecha_creacion || reserva?.actualizado_en || reserva?.fecha_inicio || null;
}

export function getReservaFilterDateISO(reserva, modoFecha) {
    if (modoFecha === 'llegada') return reserva?.fecha_inicio || getReservaRegistroISO(reserva);
    if (modoFecha === 'salida') return reserva?.fecha_fin || getReservaRegistroISO(reserva);
    return getReservaRegistroISO(reserva) || reserva?.fecha_inicio || reserva?.fecha_fin || null;
}

export function getDateMsSafe(dateLike) {
    const ms = new Date(dateLike).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

function buildDateBoundary(fecha, endOfDay = false) {
    if (!fecha) return null;
    return new Date(`${fecha}T${endOfDay ? '23:59:59' : '00:00:00'}`);
}

export function hasActiveReservaFilters(state) {
    const filtros = state.reservaFiltros;
    return Boolean(
        filtros.busqueda ||
        filtros.fechaDesde ||
        filtros.fechaHasta ||
        filtros.recepcionistaId ||
        filtros.turnoId ||
        filtros.estado ||
        filtros.origenReserva ||
        (filtros.modoFecha && filtros.modoFecha !== 'registro')
    );
}

export async function ensureReservasHistorialUsuarios(state) {
    if (state.reservasHistorialUsuarios.length > 0 || !state.supabase || !state.hotelId) {
        return state.reservasHistorialUsuarios;
    }

    const { data, error } = await state.supabase
        .from('usuarios')
        .select('id, nombre, correo, activo')
        .eq('hotel_id', state.hotelId)
        .eq('activo', true)
        .order('nombre', { ascending: true });

    if (error) {
        console.warn('[Reservas] No se pudo cargar la lista de recepcionistas/usuarios:', error.message);
        state.reservasHistorialUsuarios = [];
        return [];
    }

    state.reservasHistorialUsuarios = data || [];
    return state.reservasHistorialUsuarios;
}

export function getRecepcionistaDisplayName(state, usuarioId) {
    if (!usuarioId) return 'Usuario no disponible';
    const usuario = state.reservasHistorialUsuarios.find((item) => item.id === usuarioId);
    return usuario?.nombre || usuario?.correo || `ID: ${String(usuarioId).slice(0, 8)}...`;
}

export async function cargarTurnosParaReservas(state, reservas) {
    if (!state.supabase || !state.hotelId) return [];

    const timestamps = (reservas || [])
        .map((reserva) => getReservaRegistroISO(reserva))
        .filter(Boolean)
        .map((fechaIso) => new Date(fechaIso).getTime())
        .filter(Number.isFinite);

    if (timestamps.length === 0) {
        state.reservasHistorialTurnos = [];
        return [];
    }

    const minDate = new Date(Math.min(...timestamps) - (36 * 60 * 60 * 1000));
    const maxDate = new Date(Math.max(...timestamps) + (36 * 60 * 60 * 1000));

    const { data, error } = await state.supabase
        .from('turnos')
        .select('id, usuario_id, fecha_apertura, fecha_cierre, estado')
        .eq('hotel_id', state.hotelId)
        .gte('fecha_apertura', minDate.toISOString())
        .lte('fecha_apertura', maxDate.toISOString())
        .order('fecha_apertura', { ascending: false });

    if (error) {
        console.warn('[Reservas] No se pudieron cargar los turnos para el historial:', error.message);
        state.reservasHistorialTurnos = [];
        return [];
    }

    state.reservasHistorialTurnos = data || [];
    return state.reservasHistorialTurnos;
}

function getFallbackTurnoLabel(configHotel, fechaIso) {
    if (!fechaIso) return '';
    const fecha = new Date(fechaIso);
    if (!Number.isFinite(fecha.getTime())) return '';

    const hora = fecha.getHours();
    if (configHotel?.tipo_turno_global === 8) {
        if (hora >= 6 && hora < 14) return 'Manana';
        if (hora >= 14 && hora < 22) return 'Tarde';
        return 'Noche';
    }

    return hora >= 6 && hora < 18 ? 'Dia' : 'Noche';
}

function encontrarTurnoParaReserva(reserva, turnos = []) {
    const registroIso = getReservaRegistroISO(reserva);
    if (!registroIso || !reserva?.usuario_id) return null;

    const registroMs = new Date(registroIso).getTime();
    if (!Number.isFinite(registroMs)) return null;

    return turnos.find((turno) => {
        if (!turno || turno.usuario_id !== reserva.usuario_id || !turno.fecha_apertura) return false;
        const aperturaMs = new Date(turno.fecha_apertura).getTime();
        const cierreMs = turno.fecha_cierre
            ? new Date(turno.fecha_cierre).getTime()
            : new Date().getTime();

        return Number.isFinite(aperturaMs) && registroMs >= aperturaMs && registroMs <= cierreMs;
    }) || null;
}

function buildTurnoDisplay(state, turno, formatDateTime) {
    if (!turno) return '';
    const recepcionista = getRecepcionistaDisplayName(state, turno.usuario_id);
    const apertura = formatDateTime(turno.fecha_apertura);
    const cierre = turno.fecha_cierre ? formatDateTime(turno.fecha_cierre) : 'Turno abierto';
    return `${recepcionista} | ${apertura} - ${cierre}`;
}

export function enriquecerReservasConHistorial({ reservas, turnos, state, formatDateTime }) {
    return (reservas || []).map((reserva) => {
        const turno = encontrarTurnoParaReserva(reserva, turnos);
        const registroIso = getReservaRegistroISO(reserva);
        return {
            ...reserva,
            __registroFecha: registroIso,
            __recepcionistaNombre: getRecepcionistaDisplayName(state, reserva.usuario_id),
            __turnoId: turno?.id || '',
            __turnoApertura: turno?.fecha_apertura || null,
            __turnoLabel: turno
                ? buildTurnoDisplay(state, turno, formatDateTime)
                : getFallbackTurnoLabel(state.configHotel, registroIso || reserva?.fecha_inicio)
        };
    });
}

export function filtrarReservasHistorial(reservas, filtros) {
    const texto = String(filtros.busqueda || '').trim().toLowerCase();
    const desde = buildDateBoundary(filtros.fechaDesde, false);
    const hasta = buildDateBoundary(filtros.fechaHasta, true);

    return (reservas || []).filter((reserva) => {
        const fechaBaseIso = getReservaFilterDateISO(reserva, filtros.modoFecha);
        const fechaBase = fechaBaseIso ? new Date(fechaBaseIso) : null;

        if (desde && (!fechaBase || fechaBase < desde)) return false;
        if (hasta && (!fechaBase || fechaBase > hasta)) return false;
        if (filtros.recepcionistaId && reserva.usuario_id !== filtros.recepcionistaId) return false;
        if (filtros.turnoId && reserva.__turnoId !== filtros.turnoId) return false;
        if (filtros.estado && reserva.estado !== filtros.estado) return false;
        if (filtros.origenReserva && (reserva.origen_reserva || 'directa') !== filtros.origenReserva) return false;

        if (texto) {
            const hayMatch = [
                reserva.cliente_nombre,
                reserva.cedula,
                reserva.telefono,
                reserva.habitaciones?.nombre,
                reserva.habitaciones?.tipo,
                reserva.notas,
                reserva.__recepcionistaNombre,
                reserva.__turnoLabel
            ]
                .filter(Boolean)
                .some((valor) => String(valor).toLowerCase().includes(texto));

            if (!hayMatch) return false;
        }

        return true;
    });
}

export function poblarRecepcionistasFiltro(ui, state) {
    if (!ui.reservasRecepcionistaSelect) return;

    const valorActual = state.reservaFiltros.recepcionistaId || '';
    let optionsHtml = '<option value="">Todas</option>';
    state.reservasHistorialUsuarios.forEach((usuario) => {
        const displayName = usuario.nombre || usuario.correo || usuario.id;
        optionsHtml += `<option value="${usuario.id}">${displayName}</option>`;
    });
    ui.reservasRecepcionistaSelect.innerHTML = optionsHtml;
    ui.reservasRecepcionistaSelect.value = valorActual;
}

export function poblarTurnosFiltro(ui, state, reservas) {
    if (!ui.reservasTurnoSelect) return;

    const valorActual = state.reservaFiltros.turnoId || '';
    const turnosUnicos = [];
    const seen = new Set();

    (reservas || []).forEach((reserva) => {
        if (!reserva.__turnoId || seen.has(reserva.__turnoId)) return;
        seen.add(reserva.__turnoId);
        turnosUnicos.push({
            id: reserva.__turnoId,
            apertura: reserva.__turnoApertura,
            label: reserva.__turnoLabel
        });
    });

    turnosUnicos.sort((a, b) => getDateMsSafe(b.apertura) - getDateMsSafe(a.apertura));

    let optionsHtml = '<option value="">Todos</option>';
    turnosUnicos.forEach((turno) => {
        optionsHtml += `<option value="${turno.id}">${turno.label}</option>`;
    });

    ui.reservasTurnoSelect.innerHTML = optionsHtml;
    ui.reservasTurnoSelect.value = valorActual;
}

export function updateReservasHistorySummary(ui, state, totalReservas, reservasFiltradas) {
    if (!ui.reservasSummaryEl) return;

    const filtrosActivos = hasActiveReservaFilters(state);
    if (!filtrosActivos) {
        ui.reservasSummaryEl.innerHTML = `<span class="text-slate-600">Historial disponible: <strong>${totalReservas}</strong> reservas cargadas.</span>`;
        return;
    }

    ui.reservasSummaryEl.innerHTML = `
        <span class="text-slate-700">
            Mostrando <strong>${reservasFiltradas.length}</strong> de <strong>${totalReservas}</strong> reservas segun los filtros aplicados.
        </span>
    `;
}

export function updateReservasExperiencePanels({ reservas = [], state, getReservaToleranceStatus, formatDateTime }) {
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
        policyPill.textContent = extras.length > 0 ? `${policyText} | ${extras.join(' | ')}` : policyText;
    }
    if (lastUpdate) {
        lastUpdate.textContent = formatDateTime(new Date().toISOString());
    }
}

export function syncReservaFiltersFromUI(ui, state) {
    if (!ui.container) return;

    state.reservaFiltros.busqueda = ui.reservasSearchInput?.value?.trim() || '';
    state.reservaFiltros.fechaDesde = ui.reservasFechaDesdeInput?.value || '';
    state.reservaFiltros.fechaHasta = ui.reservasFechaHastaInput?.value || '';
    state.reservaFiltros.recepcionistaId = ui.reservasRecepcionistaSelect?.value || '';
    state.reservaFiltros.turnoId = ui.reservasTurnoSelect?.value || '';
    state.reservaFiltros.estado = ui.reservasEstadoSelect?.value || '';
    state.reservaFiltros.modoFecha = ui.reservasFechaModoSelect?.value || 'registro';
    state.reservaFiltros.origenReserva = ui.reservasOrigenSelect?.value || '';
}

export function applyReservaFiltersToUI(ui, state) {
    if (ui.reservasSearchInput) ui.reservasSearchInput.value = state.reservaFiltros.busqueda || '';
    if (ui.reservasFechaDesdeInput) ui.reservasFechaDesdeInput.value = state.reservaFiltros.fechaDesde || '';
    if (ui.reservasFechaHastaInput) ui.reservasFechaHastaInput.value = state.reservaFiltros.fechaHasta || '';
    if (ui.reservasRecepcionistaSelect) ui.reservasRecepcionistaSelect.value = state.reservaFiltros.recepcionistaId || '';
    if (ui.reservasTurnoSelect) ui.reservasTurnoSelect.value = state.reservaFiltros.turnoId || '';
    if (ui.reservasEstadoSelect) ui.reservasEstadoSelect.value = state.reservaFiltros.estado || '';
    if (ui.reservasFechaModoSelect) ui.reservasFechaModoSelect.value = state.reservaFiltros.modoFecha || 'registro';
    if (ui.reservasOrigenSelect) ui.reservasOrigenSelect.value = state.reservaFiltros.origenReserva || '';
}
