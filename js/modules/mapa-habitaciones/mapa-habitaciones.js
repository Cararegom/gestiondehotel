import { turnoService, checkTurnoActivo } from '../../services/turnoService.js';
import { showClienteSelectorModal, mostrarFormularioCliente } from '../clientes/clientes.js';
import { registrarUsoDescuento } from '../../uiUtils.js';
import { renderFloorFilters, getRoomOperationalAlerts } from './room-card.js';
import { startCronometro, clearTodosLosCronometros } from './cronometro-habitacion.js';

let containerGlobal = null;
let supabaseGlobal = null;
let currentUserGlobal = null;
let hotelIdGlobal = null;
let hotelConfigGlobal = null;
let currentRooms = [];
let refreshListener = null;

function syncWindowBridges() {
  window.turnoService = turnoService;
  window.supabase = supabaseGlobal;
  window.hotelConfigGlobal = hotelConfigGlobal;
  window.hotelIdGlobal = hotelIdGlobal;
  window.currentUserGlobal = currentUserGlobal;
  window.showClienteSelectorModal = showClienteSelectorModal;
  window.mostrarFormularioCliente = mostrarFormularioCliente;
  window.registrarUsoDescuento = registrarUsoDescuento;
}

function buildBaseLayout(container) {
  container.innerHTML = `
    <div class="mb-8 px-4 md:px-0">
      <h2 class="text-3xl font-bold text-gray-800 flex items-center">
        Mapa de Habitaciones
      </h2>
    </div>

    <div id="mapa-kpi-container" class="mb-6 grid grid-cols-2 gap-3 px-4 md:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9 md:px-0"></div>
    <div id="mapa-toolbar-container" class="mb-4 px-4 md:px-0"></div>
    <div id="floor-filter-container" class="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-slate-200 px-4 md:px-0"></div>

    <div id="room-map-list" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 px-4 md:px-0"></div>

    <div id="modal-container" class="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto" style="display:none;"></div>
    <div id="modal-container-secondary" class="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 p-4 pt-8 overflow-y-auto" style="display:none;"></div>
  `;
}

function sortRooms(rooms) {
  rooms.sort((a, b) => {
    const pisoA = Number.isFinite(Number.parseInt(a?.piso, 10)) ? Number.parseInt(a.piso, 10) : Number.MAX_SAFE_INTEGER;
    const pisoB = Number.isFinite(Number.parseInt(b?.piso, 10)) ? Number.parseInt(b.piso, 10) : Number.MAX_SAFE_INTEGER;

    if (pisoA !== pisoB) {
      return pisoA - pisoB;
    }

    const getNumber = (nombre) => {
      const match = String(nombre || '').match(/\d+/);
      return match ? parseInt(match[0], 10) : Infinity;
    };
    return getNumber(a.nombre) - getNumber(b.nombre);
  });
}

function getReservationArrivalDayDeadline(reserva) {
  if (!reserva?.fecha_inicio) return null;

  const fechaInicio = new Date(reserva.fecha_inicio);
  if (Number.isNaN(fechaInicio.getTime())) return null;

  return new Date(
    fechaInicio.getFullYear(),
    fechaInicio.getMonth(),
    fechaInicio.getDate(),
    23,
    59,
    59,
    999
  );
}

function isUpcomingReservation(reserva, referenceDate = new Date()) {
  if (!reserva?.fecha_inicio || !['reservada', 'confirmada'].includes(reserva.estado)) {
    return false;
  }

  const fechaInicio = new Date(reserva.fecha_inicio);
  if (Number.isNaN(fechaInicio.getTime())) return false;

  if (fechaInicio.getTime() > referenceDate.getTime()) {
    return true;
  }

  const limiteLlegada = getReservationArrivalDayDeadline(reserva);
  return Boolean(limiteLlegada) && referenceDate.getTime() <= limiteLlegada.getTime();
}

function filterReservationsForMap(reservas, referenceDate = new Date()) {
  return (Array.isArray(reservas) ? reservas : []).filter((reserva) => {
    if (['activa', 'ocupada', 'tiempo agotado'].includes(reserva?.estado)) {
      return true;
    }

    return isUpcomingReservation(reserva, referenceDate);
  });
}

function applyUpcomingReservationLocks(rooms) {
  const ahora = new Date();
  const dosHorasMs = 2 * 60 * 60 * 1000;

  rooms.forEach((room) => {
    room.proximaReservaData = null;
    if (!Array.isArray(room.reservas) || room.reservas.length === 0) return;

    const reservasFuturas = room.reservas
      .filter((r) => isUpcomingReservation(r, ahora))
      .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

    if (reservasFuturas.length === 0) return;

    const proxima = reservasFuturas[0];
    const inicioReserva = new Date(proxima.fecha_inicio);
    const tiempoFaltante = inicioReserva.getTime() - ahora.getTime();
    const limiteLlegada = getReservationArrivalDayDeadline(proxima);
    const reservaPendienteMismoDia = Boolean(limiteLlegada)
      && tiempoFaltante <= 0
      && ahora.getTime() <= limiteLlegada.getTime();

    room.proximaReservaData = proxima;

    if ((tiempoFaltante <= dosHorasMs && tiempoFaltante > 0) || reservaPendienteMismoDia) {
      if (!['ocupada', 'tiempo agotado', 'limpieza', 'mantenimiento'].includes(room.estado)) {
        room.estado = 'reservada';
      }
    }
  });
}

function attachRefreshListener(gridEl) {
  if (refreshListener) {
    document.removeEventListener('renderRoomsComplete', refreshListener);
  }

  refreshListener = async (event) => {
    const detail = event?.detail || {};
    if (detail.action === 'refresh' || detail.force === true) {
      await renderRooms(gridEl, supabaseGlobal, currentUserGlobal, hotelIdGlobal);
      return;
    }

    if (Array.isArray(detail.rooms)) {
      clearTodosLosCronometros();
      detail.rooms.forEach((room) => {
        if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
          const reservaActiva = Array.isArray(room.reservas)
            ? room.reservas.find((r) => ['activa', 'ocupada', 'tiempo agotado'].includes(r.estado))
            : null;
          startCronometro(room, reservaActiva, gridEl, window.playPopSound);
        }
      });
    }
  };

  document.addEventListener('renderRoomsComplete', refreshListener);
}

function normalizeRoomShape(room) {
  const normalizedEstado = room.estado === 'disponible' ? 'libre' : room.estado;

  return {
    ...room,
    estado: normalizedEstado,
    reservas: Array.isArray(room.reservas) ? room.reservas : [],
    tipos_habitacion: room.tipos_habitacion || {
      nombre: room.tipo || 'General',
      amenities: room.amenidades || room.amenities || null
    }
  };
}

function buildReservasByHabitacion(reservas) {
  return (Array.isArray(reservas) ? reservas : []).reduce((acc, reserva) => {
    const habitacionId = reserva?.habitacion_id;
    if (!habitacionId) return acc;

    if (!acc[habitacionId]) {
      acc[habitacionId] = [];
    }

    acc[habitacionId].push(reserva);
    return acc;
  }, {});
}

function buildItemsByReserva(items) {
  return (Array.isArray(items) ? items : []).reduce((acc, item) => {
    const reservaId = item?.reserva_id;
    if (!reservaId) return acc;

    if (!acc[reservaId]) {
      acc[reservaId] = [];
    }

    acc[reservaId].push(item);
    return acc;
  }, {});
}

function isSameCalendarDay(date, referenceDate = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false;

  return date.getFullYear() === referenceDate.getFullYear()
    && date.getMonth() === referenceDate.getMonth()
    && date.getDate() === referenceDate.getDate();
}

function renderMapaKpis(rooms, kpiContainer) {
  if (!kpiContainer) return;

  const now = new Date();
  const roomsList = Array.isArray(rooms) ? rooms : [];
  const countByState = roomsList.reduce((acc, room) => {
    const estado = room?.estado || 'otros';
    acc[estado] = (acc[estado] || 0) + 1;
    return acc;
  }, {});

  const llegadasHoy = roomsList.reduce((acc, room) => {
    const hasArrivalToday = Array.isArray(room?.reservas) && room.reservas.some((reserva) => isSameCalendarDay(new Date(reserva.fecha_inicio), now));
    return acc + (hasArrivalToday ? 1 : 0);
  }, 0);

  const salidasHoy = roomsList.reduce((acc, room) => {
    const hasCheckoutToday = Array.isArray(room?.reservas) && room.reservas.some((reserva) => isSameCalendarDay(new Date(reserva.fecha_fin), now));
    return acc + (hasCheckoutToday ? 1 : 0);
  }, 0);

  const conAlertas = roomsList.filter((room) => getRoomOperationalAlerts(room).length > 0).length;

  const cards = [
    { label: 'Libres', value: (countByState.libre || 0) + (countByState.disponible || 0), accent: 'text-green-700', bg: 'bg-green-50 border-green-200' },
    { label: 'Ocupadas', value: countByState.ocupada || 0, accent: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
    { label: 'Reservadas', value: countByState.reservada || 0, accent: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
    { label: 'Limpieza', value: countByState.limpieza || 0, accent: 'text-cyan-700', bg: 'bg-cyan-50 border-cyan-200' },
    { label: 'Mantenimiento', value: countByState.mantenimiento || 0, accent: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
    { label: 'Tiempo agotado', value: countByState['tiempo agotado'] || 0, accent: 'text-red-700', bg: 'bg-red-50 border-red-200' },
    { label: 'Llegadas hoy', value: llegadasHoy, accent: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
    { label: 'Salidas hoy', value: salidasHoy, accent: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
    { label: 'Con alertas', value: conAlertas, accent: 'text-rose-700', bg: 'bg-rose-50 border-rose-200' }
  ];

  kpiContainer.innerHTML = cards.map((card) => `
    <div class="rounded-2xl border px-4 py-3 shadow-sm ${card.bg}">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">${card.label}</p>
      <p class="mt-2 text-3xl font-black ${card.accent}">${card.value}</p>
    </div>
  `).join('');
}

async function fetchRoomsMapData(supabase, hotelId) {
  const estadosMapa = ['reservada', 'confirmada', 'activa', 'ocupada', 'tiempo agotado'];

  const [habitacionesResult, reservasResult] = await Promise.all([
    supabase
      .from('habitaciones')
      .select('*')
      .eq('hotel_id', hotelId)
      .order('nombre', { ascending: true }),
    supabase
      .from('reservas')
      .select('id, habitacion_id, estado, fecha_inicio, fecha_fin, tipo_duracion, cliente_nombre, monto_total, monto_pagado')
      .eq('hotel_id', hotelId)
      .in('estado', estadosMapa)
      .order('fecha_inicio', { ascending: true })
  ]);

  if (habitacionesResult.error) {
    console.error('Error cargando habitaciones desde Supabase:', habitacionesResult.error);
    throw habitacionesResult.error;
  }

  if (reservasResult.error) {
    console.error('Error cargando reservas para el mapa:', reservasResult.error);
    throw reservasResult.error;
  }

  const now = new Date();
  const reservasBase = filterReservationsForMap(reservasResult.data, now);
  const reservaIds = reservasBase.map((reserva) => reserva.id).filter(Boolean);

  let historialByReserva = {};
  if (reservaIds.length > 0) {
    const { data: historialData, error: historialError } = await supabase
      .from('historial_articulos_prestados')
      .select('id, reserva_id, habitacion_id, articulo_nombre, accion, item_prestable_id')
      .eq('hotel_id', hotelId)
      .in('reserva_id', reservaIds);

    if (historialError) {
      console.warn('No se pudo cargar historial_articulos_prestados para el mapa:', historialError);
    } else {
      historialByReserva = buildItemsByReserva(historialData);
    }
  }

  const reservasConHistorial = reservasBase.map((reserva) => ({
    ...reserva,
    historial_articulos_prestados: historialByReserva[reserva.id] || []
  }));

  const reservasByHabitacion = buildReservasByHabitacion(reservasConHistorial);

  return (Array.isArray(habitacionesResult.data) ? habitacionesResult.data : []).map((room) => normalizeRoomShape({
    ...room,
    reservas: reservasByHabitacion[room.id] || []
  }));
}

export async function mount(container, supabase, currentUser, hotelId) {
  containerGlobal = container;
  supabaseGlobal = supabase;
  currentUserGlobal = currentUser;
  hotelIdGlobal = hotelId;

  try {
    const { data: configData, error: configError } = await supabase
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    if (configError) {
      console.error('Error critico cargando configuracion del hotel:', configError);
      container.innerHTML = '<div class="p-4 text-red-700 bg-red-100 rounded">Error cargando la configuracion esencial del hotel.</div>';
      return;
    }

    hotelConfigGlobal = configData || {};
    hotelConfigGlobal.cobro_al_checkin = Object.prototype.hasOwnProperty.call(hotelConfigGlobal, 'cobro_al_checkin')
      ? hotelConfigGlobal.cobro_al_checkin
      : true;
    hotelConfigGlobal.checkin_hora_config = hotelConfigGlobal.checkin_hora_config || '15:00';
    hotelConfigGlobal.checkout_hora_config = hotelConfigGlobal.checkout_hora_config || '12:00';
    syncWindowBridges();
  } catch (error) {
    console.error('Excepcion al cargar configuracion del hotel:', error);
    container.innerHTML = '<div class="p-4 text-red-700 bg-red-100 rounded">Error fatal al cargar la configuracion del hotel.</div>';
    return;
  }

  const hayTurno = await checkTurnoActivo(supabase, hotelId, currentUser.id);
  if (!hayTurno) return;

  buildBaseLayout(container);

  const roomsListEl = container.querySelector('#room-map-list');
  if (!roomsListEl) {
    console.error('No se encontro el contenedor #room-map-list.');
    return;
  }

  attachRefreshListener(roomsListEl);
  await renderRooms(roomsListEl, supabase, currentUser, hotelId);
}

export async function renderRooms(gridEl, supabase, currentUser, hotelId) {
  if (!gridEl) return;

  const filterContainer = document.getElementById('floor-filter-container');
  const toolbarContainer = document.getElementById('mapa-toolbar-container');
  const kpiContainer = document.getElementById('mapa-kpi-container');
  clearTodosLosCronometros();

  gridEl.innerHTML = '<div class="col-span-full text-center text-slate-500 p-6">Cargando habitaciones...</div>';

  let habitaciones = [];
  try {
    habitaciones = await fetchRoomsMapData(supabase, hotelId);
  } catch (error) {
    console.error('Error cargando habitaciones:', error);
    gridEl.innerHTML = `<div class="col-span-full text-red-600 p-4 bg-red-100 rounded-md">Error: ${error?.message || 'No se pudieron cargar las habitaciones.'}</div>`;
    return;
  }

  currentRooms = Array.isArray(habitaciones) ? habitaciones : [];
  applyUpcomingReservationLocks(currentRooms);
  sortRooms(currentRooms);
  renderMapaKpis(currentRooms, kpiContainer);

  const mainAppContainer = gridEl;
  renderFloorFilters(currentRooms, filterContainer, toolbarContainer, gridEl, supabase, currentUser, hotelId, mainAppContainer);
}

export function unmount(container) {
  if (refreshListener) {
    document.removeEventListener('renderRoomsComplete', refreshListener);
    refreshListener = null;
  }

  clearTodosLosCronometros();

  if (container) {
    container.innerHTML = '';
  }

  containerGlobal = null;
  supabaseGlobal = null;
  currentUserGlobal = null;
  hotelIdGlobal = null;
  hotelConfigGlobal = null;
  currentRooms = [];
  window.supabase = null;
  window.hotelConfigGlobal = null;
  window.hotelIdGlobal = null;
  window.currentUserGlobal = null;
}
