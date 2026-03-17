// ===================== CRONÓMETRO DE HABITACIÓN (100% CLIENT-SIDE) =====================
// Administra el reloj visual local de cada habitación ocupada en el mapa.

// Estado interno del módulo de cronómetros
const cronometrosInterval = {};

export function startCronometro(room, reservaActiva, listEl, playPopSound) {
    const cronometroId = `cronometro-${room.id}`;
    const cronometroDiv = listEl.querySelector(`#${cronometroId}`);

    if (!reservaActiva) {
        if (cronometroDiv) {
            cronometroDiv.innerHTML = `<span class="text-xs text-red-500 font-bold" title="No se encontró una reserva activa vinculada.">⚠ Error Datos</span>`;
        }
        console.warn(`[Cronómetro] Hab ${room.id}: estado '${room.estado}' pero sin reserva activa en room.reservas.`);
        return;
    }

    // Limpiar intervalo anterior si existe
    if (cronometrosInterval[cronometroId]) {
        clearInterval(cronometrosInterval[cronometroId]);
    }

    // --- FUNCIÓN INTERNA DE RENDERIZADO DEL CRONÓMETRO ---
    function iniciarReloj(fechaInicioStr, fechaFinStr, tipoDuracion) {
        const fechaFin = new Date(fechaFinStr);
        const fechaInicio = new Date(fechaInicioStr);
        const esDuracionAbierta = tipoDuracion === 'abierta';
        let tiempoAgotadoNotificado = room.estado === 'tiempo agotado';

        function updateCronoDisplay() {
            if (!cronometroDiv) {
                clearInterval(cronometrosInterval[cronometroId]);
                return;
            }

            const now = new Date();
            const cardElement = cronometroDiv.closest('.room-card');

            if (esDuracionAbierta) {
                if (cardElement) {
                    cardElement.classList.remove('border-yellow-500', 'border-red-600', 'border-green-500');
                    cardElement.classList.add('border-blue-500', 'ring-1', 'ring-blue-200');
                    const badgeEl = cardElement.querySelector('.badge');
                    if (badgeEl) {
                        badgeEl.className = 'badge bg-blue-100 text-blue-800 px-2.5 py-1 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm flex-shrink-0';
                        badgeEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>TIEMPO LIBRE`;
                    }
                }
                const elapsed = now - fechaInicio;
                const h = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
                const m = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
                const s = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
                const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-blue-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                cronometroDiv.innerHTML = `${iconSVG}<span class="text-blue-700 font-bold text-lg tracking-wider">${h}:${m}:${s}</span>`;

            } else {
                const diff = fechaFin - now;

                if (diff <= 0) {
                    if (!tiempoAgotadoNotificado) {
                        tiempoAgotadoNotificado = true;
                        if (typeof playPopSound === 'function') playPopSound();
                    }
                    const diffPos = Math.abs(diff);
                    const h = String(Math.floor(diffPos / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diffPos % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diffPos % 60000) / 1000)).padStart(2, '0');
                    cronometroDiv.innerHTML = `<span class="font-bold text-red-600 animate-pulse">⏰ -${h}:${m}:${s}</span>`;

                    if (cardElement) {
                        cardElement.classList.add('border-red-600', 'ring-2', 'ring-red-200');
                        cardElement.classList.remove('border-yellow-500', 'border-indigo-500', 'border-green-500', 'border-blue-500');
                        const badgeEl = cardElement.querySelector('.badge');
                        if (badgeEl) {
                            badgeEl.className = 'badge bg-red-100 text-red-700 px-2 py-1 text-[10px] uppercase font-bold rounded shadow-sm border border-black/5';
                            badgeEl.innerText = 'TIEMPO AGOTADO';
                        }
                    }
                } else {
                    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');
                    let textColor = 'text-green-600';
                    if (diff < 10 * 60 * 1000) textColor = 'text-red-500 font-bold';
                    else if (diff < 30 * 60 * 1000) textColor = 'text-orange-500 font-semibold';

                    const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                    cronometroDiv.innerHTML = `${iconSVG}<span class="${textColor}">${h}:${m}:${s}</span>`;

                    if (cardElement && cardElement.classList.contains('border-red-600') && room.estado !== 'reservada') {
                        cardElement.classList.remove('border-red-600', 'ring-2', 'ring-red-200');
                        cardElement.classList.add('border-yellow-500');
                        const badgeEl = cardElement.querySelector('.badge');
                        if (badgeEl) {
                            badgeEl.className = 'badge bg-yellow-100 text-yellow-700 px-2 py-1 text-[10px] uppercase font-bold rounded shadow-sm border border-black/5';
                            badgeEl.innerText = 'OCUPADA';
                        }
                    }
                }
            }
        }

        updateCronoDisplay();
        cronometrosInterval[cronometroId] = setInterval(updateCronoDisplay, 1000);
    }

    // --- LÓGICA PRINCIPAL ---
    if (reservaActiva) {
        iniciarReloj(reservaActiva.fecha_inicio, reservaActiva.fecha_fin, reservaActiva.tipo_duracion);
    } else {
        // Fallback global Supabase
        const supabaseGlobal = window.supabase || (window.gestionHotel && window.gestionHotel.supabase);
        if (!supabaseGlobal) {
            if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-xs text-red-500 font-bold" title="No hay datos ni conexión.">⚠ Error Datos</span>`;
            return;
        }

        supabaseGlobal.from('reservas')
            .select('fecha_inicio, fecha_fin, tipo_duracion')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .then(async ({ data: reservasFallback, error: fallbackError }) => {
                if (fallbackError || !reservasFallback || reservasFallback.length === 0) {
                    console.warn(`[Cronómetro Fallback] Hab ${room.id} ocupada pero sin reservas activas en BD.`);
                    if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-xs text-red-500 font-bold">⚠ Error Datos</span>`;
                    return;
                }
                const resFb = reservasFallback[0];
                iniciarReloj(resFb.fecha_inicio, resFb.fecha_fin, resFb.tipo_duracion);
            })
            .catch(err => console.error("Error en fallback de cronómetro:", err));
    }
}

export function clearTodosLosCronometros() {
    Object.values(cronometrosInterval).forEach(clearInterval);
    // Vaciar objeto sin romper referencia
    for (const key in cronometrosInterval) {
        if (cronometrosInterval.hasOwnProperty(key)) {
            delete cronometrosInterval[key];
        }
    }
}
