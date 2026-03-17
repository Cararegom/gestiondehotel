import { estadoColores, getAmenityIcon, playPopSound } from './helpers.js';
import { clearTodosLosCronometros, startCronometro } from './cronometro-habitacion.js';
import { showHabitacionOpcionesModal } from './modales-gestion.js';
import { escapeAttribute, escapeHtml, sanitizeUrl } from '../../security.js';

function resolveRoomFloor(room) {
    const pisoRaw = room?.piso;
    if (pisoRaw !== null && pisoRaw !== undefined && String(pisoRaw).trim() !== '') {
        const pisoStr = String(pisoRaw).trim();
        const pisoNum = Number.parseInt(pisoStr, 10);

        if (Number.isFinite(pisoNum)) {
            return {
                key: `floor-${pisoNum}`,
                label: `Piso ${pisoNum}`,
                order: pisoNum
            };
        }

        return {
            key: `floor-${pisoStr}`,
            label: pisoStr,
            order: Number.MAX_SAFE_INTEGER - 1
        };
    }

    const floorMatch = String(room?.nombre || '').match(/^[A-Za-z\-]*(\d)\d{2}(?:\D.*)?$/);
    if (floorMatch) {
        const pisoNum = Number.parseInt(floorMatch[1], 10);
        return {
            key: `floor-${pisoNum}`,
            label: `Piso ${pisoNum}`,
            order: pisoNum
        };
    }

    return {
        key: 'floor-unassigned',
        label: 'Sin piso',
        order: Number.MAX_SAFE_INTEGER
    };
}

function getRoomTypeLabel(room) {
    return room.tipo || room.tipos_habitacion?.nombre || 'General';
}

function getActiveReservation(room) {
    return Array.isArray(room?.reservas)
        ? room.reservas.find((reserva) => ['ocupada', 'activa', 'tiempo agotado'].includes(reserva.estado))
        : null;
}

function getPendingLoanedItems(reservaActiva) {
    const saldoPorArticulo = new Map();
    const historial = Array.isArray(reservaActiva?.historial_articulos_prestados)
        ? reservaActiva.historial_articulos_prestados
        : [];

    historial.forEach((item) => {
        const nombre = String(item?.articulo_nombre || 'Articulo').trim();
        const cantidad = Number(item?.cantidad || 1) || 1;
        const saldoActual = saldoPorArticulo.get(nombre) || 0;

        if (item?.accion === 'prestado') {
            saldoPorArticulo.set(nombre, saldoActual + cantidad);
        } else if (item?.accion === 'devuelto') {
            saldoPorArticulo.set(nombre, Math.max(0, saldoActual - cantidad));
        }
    });

    return [...saldoPorArticulo.entries()]
        .filter(([, saldo]) => saldo > 0)
        .map(([nombre, saldo]) => ({ nombre, saldo }));
}

export function getRoomOperationalAlerts(room) {
    const alerts = [];
    const now = new Date();
    const reservaActiva = getActiveReservation(room);
    const floorInfo = resolveRoomFloor(room);
    const pendingItems = getPendingLoanedItems(reservaActiva);
    const saldoPendienteBase = Math.max(0, Number(reservaActiva?.monto_total || 0) - Number(reservaActiva?.monto_pagado || 0));

    if (room.estado === 'tiempo agotado') {
        alerts.push({ key: 'tiempo_agotado', label: 'Tiempo agotado', tone: 'red' });
    }

    if (reservaActiva?.fecha_fin && reservaActiva?.tipo_duracion !== 'abierta') {
        const msRestantes = new Date(reservaActiva.fecha_fin).getTime() - now.getTime();
        if (msRestantes > 0 && msRestantes <= (30 * 60 * 1000)) {
            alerts.push({ key: 'checkout_proximo', label: 'Checkout pronto', tone: 'amber' });
        }
        if (msRestantes <= 0 && room.estado !== 'tiempo agotado') {
            alerts.push({ key: 'checkout_vencido', label: 'Checkout vencido', tone: 'red' });
        }
    }

    if (room.proximaReservaData?.fecha_inicio) {
        const msParaReserva = new Date(room.proximaReservaData.fecha_inicio).getTime() - now.getTime();
        if (msParaReserva > 0 && msParaReserva <= (2 * 60 * 60 * 1000)) {
            alerts.push({ key: 'reserva_proxima', label: 'Reserva en menos de 2h', tone: 'indigo' });
        }
    }

    if (saldoPendienteBase > 0) {
        alerts.push({ key: 'pago_pendiente', label: 'Pago pendiente', tone: 'rose' });
    }

    if (pendingItems.length > 0) {
        alerts.push({
            key: 'articulos_pendientes',
            label: pendingItems.length === 1 ? 'Articulo pendiente' : 'Articulos pendientes',
            tone: 'sky'
        });
    }

    if (floorInfo.key === 'floor-unassigned') {
        alerts.push({ key: 'sin_piso', label: 'Sin piso', tone: 'slate' });
    }

    return alerts;
}

function getAlertPillClasses(tone) {
    const tones = {
        red: 'bg-red-50 text-red-700 border-red-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        rose: 'bg-rose-50 text-rose-700 border-rose-200',
        sky: 'bg-sky-50 text-sky-700 border-sky-200',
        slate: 'bg-slate-100 text-slate-700 border-slate-200'
    };

    return tones[tone] || tones.slate;
}

function buildAlertChipsHtml(room) {
    const alerts = getRoomOperationalAlerts(room);
    if (alerts.length === 0) return '';

    const visibleAlerts = alerts.slice(0, 3);
    const hiddenCount = alerts.length - visibleAlerts.length;

    return `
        <div class="mt-2 flex flex-wrap gap-1.5">
            ${visibleAlerts.map((alert) => `
                <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${getAlertPillClasses(alert.tone)}">
                    ${escapeHtml(alert.label)}
                </span>
            `).join('')}
            ${hiddenCount > 0 ? `<span class="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">+${hiddenCount} alerta${hiddenCount > 1 ? 's' : ''}</span>` : ''}
        </div>
    `;
}

function getStateLabel(estado) {
    const labels = {
        libre: 'Libre',
        disponible: 'Libre',
        ocupada: 'Ocupada',
        reservada: 'Reservada',
        mantenimiento: 'Mantenimiento',
        limpieza: 'Limpieza',
        activa: 'Activa',
        'tiempo agotado': 'Tiempo agotado'
    };

    return labels[estado] || 'Otros';
}

function roomMatchesSearch(room, searchTerm) {
    if (!searchTerm) return true;

    const reservaActiva = getActiveReservation(room);
    const searchable = [
        room?.nombre,
        getRoomTypeLabel(room),
        reservaActiva?.cliente_nombre,
        room?.proximaReservaData?.cliente_nombre,
        room?.piso
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

    return searchable.includes(searchTerm);
}

function roomMatchesAlert(room, alertFilter) {
    if (alertFilter === 'todas') return true;

    const alerts = getRoomOperationalAlerts(room);
    if (alertFilter === 'con_alertas') {
        return alerts.length > 0;
    }

    return alerts.some((alert) => alert.key === alertFilter);
}

export function renderFloorFilters(currentRooms, filterContainer, toolbarContainer, gridEl, supabase, currentUser, hotelId, mainAppContainer) {
    if (!filterContainer || !gridEl) return;

    const floorsMap = new Map();
    currentRooms.forEach((room) => {
        const floorInfo = resolveRoomFloor(room);
        if (!floorsMap.has(floorInfo.key)) {
            floorsMap.set(floorInfo.key, {
                ...floorInfo,
                rooms: []
            });
        }
        floorsMap.get(floorInfo.key).rooms.push(room);
    });

    const filterGroups = [...floorsMap.values()].sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.label.localeCompare(b.label, 'es');
    });

    const stateOptions = ['todos', ...new Set(currentRooms.map((room) => room.estado).filter(Boolean))];
    const typeOptions = ['todos', ...new Set(currentRooms.map((room) => getRoomTypeLabel(room)).filter(Boolean))];
    const filterState = {
        floor: 'Todos',
        estado: 'todos',
        tipo: 'todos',
        alerta: 'todas',
        search: ''
    };

    const renderFilteredRooms = (roomsToRender) => {
        gridEl.innerHTML = '';
        clearTodosLosCronometros();

        if (roomsToRender.length === 0) {
            gridEl.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">No hay habitaciones que coincidan con los filtros aplicados.</div>';
            return;
        }

        roomsToRender.forEach((room) => {
            const card = roomCard(room, supabase, currentUser, hotelId, mainAppContainer);
            gridEl.appendChild(card);

            if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
                const reservaActiva = getActiveReservation(room);
                startCronometro(room, reservaActiva, gridEl, playPopSound);
            }
        });
    };

    const getFilteredRooms = () => {
        const searchTerm = filterState.search.trim().toLowerCase();

        return currentRooms.filter((room) => {
            const floorInfo = resolveRoomFloor(room);
            if (filterState.floor !== 'Todos' && floorInfo.key !== filterState.floor) return false;
            if (filterState.estado !== 'todos' && room.estado !== filterState.estado) return false;
            if (filterState.tipo !== 'todos' && getRoomTypeLabel(room) !== filterState.tipo) return false;
            if (!roomMatchesAlert(room, filterState.alerta)) return false;
            if (!roomMatchesSearch(room, searchTerm)) return false;
            return true;
        });
    };

    const updateResultCounter = (rooms) => {
        const counter = toolbarContainer?.querySelector('#mapa-results-counter');
        if (counter) {
            counter.textContent = `${rooms.length} de ${currentRooms.length} habitaciones visibles`;
        }
    };

    const applyFilters = () => {
        const filteredRooms = getFilteredRooms();
        renderFilteredRooms(filteredRooms);
        updateResultCounter(filteredRooms);
    };

    const renderButtons = () => {
        filterContainer.innerHTML = '';

        const btnTodos = document.createElement('button');
        btnTodos.className = `btn-floor-filter px-4 py-2 rounded-full text-sm font-medium transition-colors ${filterState.floor === 'Todos' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`;
        btnTodos.innerHTML = `Todos <span class="ml-1 text-xs opacity-80">(${currentRooms.length})</span>`;
        btnTodos.onclick = () => {
            filterState.floor = 'Todos';
            renderButtons();
            applyFilters();
        };
        filterContainer.appendChild(btnTodos);

        filterGroups.forEach((group) => {
            const count = group.rooms.length;
            const btn = document.createElement('button');
            btn.className = `btn-floor-filter px-4 py-2 rounded-full text-sm font-medium transition-colors ${filterState.floor === group.key ? 'bg-indigo-600 text-white shadow-md' : 'bg-white text-gray-600 hover:bg-gray-50 border border-gray-200'}`;
            btn.innerHTML = `${group.label} <span class="ml-1 text-xs opacity-80">(${count})</span>`;
            btn.onclick = () => {
                filterState.floor = group.key;
                renderButtons();
                applyFilters();
            };
            filterContainer.appendChild(btn);
        });
    };

    const renderToolbar = () => {
        if (!toolbarContainer) return;

        toolbarContainer.innerHTML = `
            <div class="rounded-2xl border border-slate-200 bg-white/90 p-4 shadow-sm">
                <div class="grid grid-cols-1 gap-3 md:grid-cols-5">
                    <div class="md:col-span-2">
                        <label for="mapa-room-search" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Buscar</label>
                        <input id="mapa-room-search" type="search" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" placeholder="Habitacion, huesped o tipo">
                    </div>
                    <div>
                        <label for="mapa-room-state-filter" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</label>
                        <select id="mapa-room-state-filter" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                            ${stateOptions.map((estado) => `<option value="${escapeAttribute(estado)}">${escapeHtml(estado === 'todos' ? 'Todos los estados' : getStateLabel(estado))}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label for="mapa-room-type-filter" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Tipo</label>
                        <select id="mapa-room-type-filter" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                            ${typeOptions.map((tipo) => `<option value="${escapeAttribute(tipo)}">${escapeHtml(tipo === 'todos' ? 'Todos los tipos' : tipo)}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <label for="mapa-room-alert-filter" class="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Alertas</label>
                        <select id="mapa-room-alert-filter" class="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100">
                            <option value="todas">Todas</option>
                            <option value="con_alertas">Con alertas</option>
                            <option value="checkout_proximo">Checkout proximo</option>
                            <option value="reserva_proxima">Reserva en menos de 2h</option>
                            <option value="pago_pendiente">Pago pendiente</option>
                            <option value="articulos_pendientes">Articulos pendientes</option>
                            <option value="sin_piso">Sin piso</option>
                            <option value="tiempo_agotado">Tiempo agotado</option>
                        </select>
                    </div>
                </div>
                <div class="mt-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <p id="mapa-results-counter" class="text-sm font-medium text-slate-500"></p>
                    <button id="mapa-clear-filters" type="button" class="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50">
                        Limpiar filtros
                    </button>
                </div>
            </div>
        `;

        const searchInput = toolbarContainer.querySelector('#mapa-room-search');
        const stateSelect = toolbarContainer.querySelector('#mapa-room-state-filter');
        const typeSelect = toolbarContainer.querySelector('#mapa-room-type-filter');
        const alertSelect = toolbarContainer.querySelector('#mapa-room-alert-filter');
        const clearButton = toolbarContainer.querySelector('#mapa-clear-filters');

        searchInput.value = filterState.search;
        stateSelect.value = filterState.estado;
        typeSelect.value = filterState.tipo;
        alertSelect.value = filterState.alerta;

        searchInput.addEventListener('input', (event) => {
            filterState.search = event.target.value;
            applyFilters();
        });
        stateSelect.addEventListener('change', (event) => {
            filterState.estado = event.target.value;
            applyFilters();
        });
        typeSelect.addEventListener('change', (event) => {
            filterState.tipo = event.target.value;
            applyFilters();
        });
        alertSelect.addEventListener('change', (event) => {
            filterState.alerta = event.target.value;
            applyFilters();
        });
        clearButton.addEventListener('click', () => {
            filterState.floor = 'Todos';
            filterState.estado = 'todos';
            filterState.tipo = 'todos';
            filterState.alerta = 'todas';
            filterState.search = '';

            renderButtons();
            renderToolbar();
            applyFilters();
        });
    };

    renderButtons();
    renderToolbar();
    applyFilters();
}

export function updateClienteFields(container, reservaActiva) {
    if (!reservaActiva) return;

    if (reservaActiva.cliente_id && container.querySelector('#cliente_idH')) {
        container.querySelector('#cliente_idH').value = reservaActiva.cliente_id;
        if (container.querySelector('#alquiler-cliente-select')) {
            container.querySelector('#alquiler-cliente-select').value = reservaActiva.cliente_id;
        }

        if (typeof window.mostrarFormularioCliente === 'function') {
            window.mostrarFormularioCliente(true);
        }

        if (reservaActiva.clientes) {
            if (container.querySelector('#cliente_nombre')) container.querySelector('#cliente_nombre').value = reservaActiva.clientes.nombre || '';
            if (container.querySelector('#cliente_documento')) container.querySelector('#cliente_documento').value = reservaActiva.clientes.documento || '';
            if (container.querySelector('#cliente_telefono')) container.querySelector('#cliente_telefono').value = reservaActiva.clientes.telefono || '';
            if (container.querySelector('#cliente_email')) container.querySelector('#cliente_email').value = reservaActiva.clientes.email || '';
        } else if (reservaActiva.cliente_nombre) {
            if (container.querySelector('#cliente_nombre')) container.querySelector('#cliente_nombre').value = reservaActiva.cliente_nombre;
        }
    } else if (reservaActiva.cliente_nombre) {
        if (container.querySelector('#cliente_nombre')) container.querySelector('#cliente_nombre').value = reservaActiva.cliente_nombre;
    }
}

function getTipoIcon(room) {
    if (room.tipos_habitacion?.nombre?.toLowerCase().includes('suite')) {
        return '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 text-yellow-500" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd" /></svg>';
    }

    return '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>';
}

function parseAmenities(room) {
    const amenitiesSource = room.amenidades || room.tipos_habitacion?.amenities || null;
    if (!amenitiesSource) return [];

    try {
        if (Array.isArray(amenitiesSource)) return amenitiesSource;
        if (typeof amenitiesSource === 'string') {
            return JSON.parse(amenitiesSource.replace(/''/g, '"'));
        }
    } catch (error) {
        if (typeof amenitiesSource === 'string') {
            return amenitiesSource.split(',').map((value) => value.trim()).filter(Boolean);
        }
    }

    return [];
}

function buildFutureReservationHtml(room) {
    const reservaFutura = room.proximaReservaData
        || (Array.isArray(room.reservas) ? room.reservas.find((reserva) => ['reservada', 'confirmada'].includes(reserva.estado)) : null);

    if (!reservaFutura?.fecha_inicio) return '';

    const fechaObj = new Date(reservaFutura.fecha_inicio);
    const horaStr = fechaObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
    const fechaStr = fechaObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });

    return `
        <div class="mt-2 mb-1 p-2 bg-indigo-50 border border-indigo-100 rounded-lg flex flex-col">
            <div class="flex items-center w-full">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-indigo-600 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                <span class="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">Pr\u00f3xima Reserva</span>
            </div>
            <div class="pl-5 text-sm text-indigo-900 font-semibold">${fechaStr} - ${horaStr}</div>
            <div class="pl-5 text-xs text-indigo-500 truncate w-full">${escapeHtml(reservaFutura.cliente_nombre || 'Cliente')}</div>
        </div>
    `;
}

function buildActiveGuestHtml(reservaActiva) {
    if (!reservaActiva) return '';

    const clienteActual = reservaActiva.cliente_nombre
        ? reservaActiva.cliente_nombre.split(' ').slice(0, 2).join(' ')
        : 'Sin cliente';

    return `
        <div class="mt-2 flex items-center text-sm text-slate-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5 text-slate-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
            <span class="truncate font-medium">${escapeHtml(clienteActual)}</span>
        </div>
    `;
}

function buildLoanedItemsHtml(reservaActiva) {
    const articulos = getPendingLoanedItems(reservaActiva);

    if (articulos.length === 0) return '';

    return `
        <div class="mt-2 pt-2 border-t border-slate-100 text-sm">
            <p class="flex items-center text-blue-700 font-semibold mb-1">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor"><path d="M8 4a1 1 0 011 1v1H8a1 1 0 010-2zm0 3h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V8a1 1 0 011-1z" /><path fill-rule="evenodd" d="M4 3a2 2 0 012-2h8a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V3zm2 1h8v12H6V4z" clip-rule="evenodd" /></svg>
                <span>Art\u00edculos</span>
            </p>
            <div class="flex flex-wrap gap-1">
                ${articulos.map((item) => `<span class="badge bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-medium rounded-full border border-blue-200">${escapeHtml(item.nombre)} x${item.saldo}</span>`).join('')}
            </div>
        </div>
    `;
}

function buildAmenitiesHtml(room) {
    const amenitiesList = parseAmenities(room);
    if (amenitiesList.length === 0) return '';

    const topAmenities = amenitiesList.slice(0, 4);
    let html = '<div class="flex gap-1 mt-1 opacity-80 group-hover:opacity-100 transition-opacity">';
    topAmenities.forEach((amenity) => {
        const icon = getAmenityIcon(amenity);
        if (icon) {
            html += `<div title="${escapeAttribute(amenity)}" class="p-1 min-w-[16px]">${icon}</div>`;
        }
    });
    if (amenitiesList.length > 4) {
        html += `<div class="text-[10px] text-slate-400 font-medium p-1 flex items-center">+${amenitiesList.length - 4}</div>`;
    }
    html += '</div>';
    return html;
}

export function roomCard(room, supabase, currentUser, hotelId, mainAppContainer) {
    const colorClass = estadoColores[room.estado] || estadoColores.default;
    const tipoLabel = getRoomTypeLabel(room);
    const safeRoomName = escapeHtml(room.nombre || 'Habitacion');
    const safeTipoLabel = escapeHtml(tipoLabel);
    const safeEstado = escapeHtml(room.estado || 'N/A');
    const safeRoomId = escapeAttribute(room.id || '');
    const tipoIcon = getTipoIcon(room);
    const reservaActiva = getActiveReservation(room);
    const safeImageUrl = sanitizeUrl(room.imagen_url, { allowedProtocols: ['http:', 'https:', 'blob:', 'data:'] });
    const imageBannerHTML = safeImageUrl
        ? `<div class="relative h-32 bg-slate-200 overflow-hidden"><img src="${safeImageUrl}" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" alt="Habitacion ${safeRoomName}" /></div>`
        : '';
    const futureReservationHTML = buildFutureReservationHtml(room);
    const activeGuestHTML = buildActiveGuestHtml(reservaActiva);
    const loanedItemsHTML = buildLoanedItemsHtml(reservaActiva);
    const amenitiesHTML = buildAmenitiesHtml(room);
    const alertChipsHTML = buildAlertChipsHtml(room);

    const div = document.createElement('div');
    div.className = `room-card relative bg-white rounded-xl shadow-sm border-2 ${colorClass} hover:shadow-md transition-all cursor-pointer overflow-hidden group min-h-[160px] flex flex-col justify-between`;
    div.onclick = (event) => {
        event.stopPropagation();
        try {
            showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer);
        } catch (error) {
            console.error('Error al abrir el modal de habitaci\u00f3n:', error);
            alert(`Error al abrir el modal: ${error.message}`);
        }
    };

    div.innerHTML = `
        ${imageBannerHTML}
        <div class="p-3 flex-grow flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-gray-900 text-xl tracking-tight leading-none">${safeRoomName}</h3>
                    <div class="flex items-center text-xs text-slate-500 font-medium mt-1">
                        ${tipoIcon}
                        <span class="truncate max-w-[140px]">${safeTipoLabel}</span>
                    </div>
                </div>

                <div class="flex flex-col items-end gap-1 ml-2">
                    <span class="badge ${getBadgeBackgroundColor(room.estado)} px-2 py-1 text-[10px] uppercase font-bold rounded shadow-sm border border-black/5">
                        ${safeEstado}
                    </span>
                </div>
            </div>

            ${alertChipsHTML}
            ${activeGuestHTML}
            ${futureReservationHTML}
            ${loanedItemsHTML}

            <div class="mt-auto pt-3 ${amenitiesHTML ? 'border-t border-slate-100' : ''}">
                ${amenitiesHTML || '<div class="flex-grow"></div>'}
            </div>
        </div>
        <div class="bg-slate-50/70 border-t border-slate-100 px-3 py-2 min-h-[42px] flex items-center justify-end">
            <div id="cronometro-${safeRoomId}" class="cronometro-display w-full text-right font-mono text-sm flex items-center justify-end text-slate-600">
                ${room.estado === 'ocupada' || room.estado === 'tiempo agotado'
                    ? '<svg class="animate-spin h-4 w-4 text-slate-400 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="text-slate-400 text-xs">Cargando...</span>'
                    : ''
                }
            </div>
        </div>
    `;

    return div;
}

function getBadgeBackgroundColor(estado) {
    const states = {
        libre: 'bg-green-100 text-green-700',
        disponible: 'bg-green-100 text-green-700',
        ocupada: 'bg-yellow-100 text-yellow-700',
        reservada: 'bg-indigo-100 text-indigo-700',
        mantenimiento: 'bg-red-100 text-red-700',
        limpieza: 'bg-cyan-100 text-cyan-800',
        'tiempo agotado': 'bg-red-100 text-red-700'
    };
    return states[estado] || 'bg-gray-100 text-gray-700';
}
