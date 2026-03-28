export function renderReservasGrupo({
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
}) {
    const tituloSeguro = escapeHtml(titulo);
    let html = `
        <div class="mt-8 first:mt-0">
            <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Grupo</p>
                    <h3 class="text-2xl font-black tracking-tight text-slate-900">${tituloSeguro}</h3>
                </div>
                <span class="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm">${grupo.length} reserva${grupo.length === 1 ? '' : 's'}</span>
            </div>
    `;
    html += `<div class="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">`;

    grupo.forEach((r) => {
        const estadoActual = (r.estado || 'N/A').toUpperCase().replace(/_/g, ' ');
        const monedaSimbolo = state.configHotel?.moneda_local_simbolo || '$';
        const monedaISO = state.configHotel?.moneda_codigo_iso_info || 'COP';
        const monedaDecimales = parseInt(state.configHotel?.moneda_decimales_info || 0, 10);
        const clienteNombre = escapeHtml(r.cliente_nombre || 'Cliente desconocido');
        const inicialCliente = escapeHtml((r.cliente_nombre || 'R').trim().charAt(0).toUpperCase() || 'R');
        const habitacionNombre = escapeHtml(r.habitaciones?.nombre || 'N/A');
        const recepcionNombre = escapeHtml(r.__recepcionistaNombre || 'Usuario no disponible');
        const turnoLabel = escapeHtml(r.__turnoLabel || '');
        const notas = escapeHtml(r.notas || '');
        const cancelador = escapeHtml(r.cancelador?.nombre || 'Usuario desconocido');
        const originLabel = getReservaOriginLabel(r.origen_reserva || 'directa');
        const funnelLabel = getReservaOriginFunnelStage(r.origen_reserva || 'directa');
        const tolerance = getReservaToleranceStatus(r, state.configHotel, new Date());

        html += `
        <article class="group overflow-hidden rounded-[26px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] p-5 shadow-[0_16px_45px_-28px_rgba(15,23,42,0.45)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_60px_-28px_rgba(37,99,235,0.28)] ${getBorderColorForEstado(r.estado)} border-l-4">
            <div class="flex items-start justify-between gap-4">
                <div class="flex items-start gap-3">
                    <div class="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-lg font-black text-white shadow-sm">${inicialCliente}</div>
                    <div>
                        <p class="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">Reserva</p>
                        <h4 class="text-lg font-bold text-slate-900">${clienteNombre}</h4>
                        <p class="mt-1 text-sm text-slate-500">${habitacionNombre} - ${r.cantidad_huespedes || 'N/A'} huespedes</p>
                    </div>
                </div>
                <span class="text-xs font-semibold px-2.5 py-1 rounded-full ${getBgColorForEstado(r.estado)} ${getTextColorForEstado(r.estado)}">${estadoActual}</span>
            </div>

            <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div class="rounded-2xl border border-slate-200 bg-white p-3">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Llega</p>
                    <p class="mt-1 text-sm font-semibold text-slate-800">${formatDateTime(r.fecha_inicio)}</p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-3">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Sale</p>
                    <p class="mt-1 text-sm font-semibold text-slate-800">${formatDateTime(r.fecha_fin)}</p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-3">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Registrada</p>
                    <p class="mt-1 text-sm font-semibold text-slate-800">${r.__registroFecha ? formatDateTime(r.__registroFecha) : 'N/A'}</p>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white p-3">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Recepcion</p>
                    <p class="mt-1 text-sm font-semibold text-slate-800">${recepcionNombre}</p>
                </div>
            </div>

            <div class="mt-4 flex flex-wrap gap-2 text-sm">
                <span class="rounded-full border ${getFunnelBadgeClasses(funnelLabel)} px-3 py-1 font-semibold">${escapeHtml(originLabel)}</span>
                <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-semibold text-slate-700">${escapeHtml(funnelLabel)}</span>
                ${turnoLabel ? `<span class="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 font-semibold text-slate-700">Turno: ${turnoLabel}</span>` : ''}
                <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-semibold text-blue-700">Total: ${formatCurrency(r.monto_total, monedaSimbolo, monedaISO, monedaDecimales)}</span>
                ${r.abonado > 0 ? `<span class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700">Abonado: ${formatCurrency(r.abonado, monedaSimbolo, monedaISO, monedaDecimales)}</span>` : ''}
                ${r.pendiente > 0 ? `<span class="rounded-full border border-red-200 bg-red-50 px-3 py-1 font-semibold text-red-700">Pendiente: ${formatCurrency(r.pendiente, monedaSimbolo, monedaISO, monedaDecimales)}</span>` : ''}
                ${tolerance?.label ? `<span class="rounded-full border ${getToleranceBadgeClasses(tolerance.level)} px-3 py-1 font-semibold">${escapeHtml(tolerance.label)}</span>` : ''}
            </div>

            ${notas ? `
                <div class="mt-4 rounded-2xl border border-slate-200 bg-white/90 p-3 text-sm text-slate-600">
                    <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Notas</p>
                    <p class="mt-1 italic">${notas}</p>
                </div>
            ` : ''}

            ${tolerance?.helper ? `
                <div class="mt-4 rounded-2xl border ${getToleranceBadgeClasses(tolerance.level)} px-3 py-3 text-sm">
                    <p class="font-semibold">${escapeHtml(tolerance.label || 'Seguimiento')}</p>
                    <p class="mt-1">${escapeHtml(tolerance.helper || '')}</p>
                </div>
            ` : ''}

            ${r.estado === 'cancelada' ? `
                <div class="mt-4 rounded-2xl border border-red-100 bg-red-50 p-3 text-xs text-red-700">
                    <p><strong>Cancelado por:</strong> ${cancelador}</p>
                    <p><strong>Fecha cancelacion:</strong> ${formatDateTime(r.fecha_cancelacion)}</p>
                </div>
            ` : ''}

            <div class="mt-5 rounded-2xl border border-slate-200 bg-slate-50/85 p-3">
                <div class="flex flex-wrap gap-2">
                    ${getAccionesReservaHTML(r)}
                </div>
            </div>
        </article>`;
    });

    html += `</div></div>`;
    return html;
}

export function buildReservasListHtml({
    reservasEnriquecidas = [],
    reservasFiltradas = [],
    filtrosActivos = false,
    modoFecha = 'registro',
    renderReservasGrupo,
    getDateMsSafe,
    getReservaFilterDateISO,
    getReservaRegistroISO
}) {
    const estadosHistorialPorDefecto = ['cancelada', 'no_show', 'cancelada_mantenimiento'];

    if (!Array.isArray(reservasEnriquecidas) || reservasEnriquecidas.length === 0) {
        return `<div class="mb-10"><div class="mb-5"><p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Reservas</p><h2 class="text-2xl font-black tracking-tight text-slate-900">Sin movimientos para mostrar</h2></div><div class="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">No hay reservas para mostrar.</div></div>`;
    }

    let htmlGeneral = '';

    if (filtrosActivos) {
        const resultadosOrdenados = [...reservasFiltradas].sort((a, b) => {
            return getDateMsSafe(getReservaFilterDateISO(b, modoFecha)) - getDateMsSafe(getReservaFilterDateISO(a, modoFecha));
        });

        htmlGeneral += `<div class="mb-10"><div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Resultados</p><h2 class="text-2xl font-black tracking-tight text-slate-900">Busqueda e historial</h2></div><span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-600">${resultadosOrdenados.length} coincidencia${resultadosOrdenados.length === 1 ? '' : 's'}</span></div>`;
        if (resultadosOrdenados.length > 0) {
            htmlGeneral += renderReservasGrupo('Coincidencias', resultadosOrdenados);
        } else {
            htmlGeneral += `<div class="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">No se encontraron reservas con esos filtros.</div>`;
        }
        htmlGeneral += `</div>`;
        return htmlGeneral;
    }

    const reservasActivas = reservasEnriquecidas
        .filter((reserva) => ['reservada', 'confirmada', 'activa'].includes(reserva.estado))
        .sort((a, b) => getDateMsSafe(a.fecha_inicio) - getDateMsSafe(b.fecha_inicio));

    const reservasHistorial = reservasEnriquecidas
        .filter((reserva) => estadosHistorialPorDefecto.includes(reserva.estado))
        .sort((a, b) => {
            const fechaB = getReservaRegistroISO(b) || b.fecha_cancelacion || b.fecha_fin;
            const fechaA = getReservaRegistroISO(a) || a.fecha_cancelacion || a.fecha_fin;
            return getDateMsSafe(fechaB) - getDateMsSafe(fechaA);
        });
    const reservasCompletadasOcultas = reservasEnriquecidas.filter((reserva) => ['completada', 'finalizada_auto'].includes(reserva.estado)).length;

    htmlGeneral += `<div class="mb-10"><div class="mb-5"><p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Operacion</p><h2 class="text-2xl font-black tracking-tight text-slate-900">Reservas actuales y proximas</h2></div>`;
    if (reservasActivas.length > 0) {
        const groupedActivas = reservasActivas.reduce((acc, reserva) => {
            (acc[reserva.estado] = acc[reserva.estado] || []).push(reserva);
            return acc;
        }, {});

        ['reservada', 'confirmada', 'activa'].forEach((estado) => {
            if (groupedActivas[estado]?.length) {
                htmlGeneral += renderReservasGrupo(estado.charAt(0).toUpperCase() + estado.slice(1), groupedActivas[estado]);
            }
        });
    } else {
        htmlGeneral += `<div class="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">No hay reservas activas o proximas para mostrar.</div>`;
    }
    htmlGeneral += `</div>`;

    htmlGeneral += `<div class="mb-10"><div class="mb-5"><p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Seguimiento</p><h2 class="text-2xl font-black tracking-tight text-slate-900">Historial de reservas</h2></div>`;
    if (reservasCompletadasOcultas > 0) {
        htmlGeneral += `<div class="mb-4 rounded-[20px] border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">Las reservas completadas solo se muestran cuando usas el formulario de busqueda o filtros.</div>`;
    }
    if (reservasHistorial.length > 0) {
        const groupedHistorial = reservasHistorial.reduce((acc, reserva) => {
            (acc[reserva.estado] = acc[reserva.estado] || []).push(reserva);
            return acc;
        }, {});

        estadosHistorialPorDefecto.forEach((estado) => {
            if (groupedHistorial[estado]?.length) {
                htmlGeneral += renderReservasGrupo(estado.toUpperCase().replace(/_/g, ' '), groupedHistorial[estado]);
            }
        });
    } else {
        htmlGeneral += `<div class="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-slate-500">No hay historial para mostrar. Usa la busqueda si necesitas ver reservas completadas.</div>`;
    }
    htmlGeneral += `</div>`;

    return htmlGeneral;
}
