import {
  addCalendarDays,
  getDateKeyInTimeZone,
  getRuntimeHotelTimeZone
} from './hotelTimeZoneService.js';

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanMoney(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function weekdayFromDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return -1;
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

function normalizePriority(tarifa) {
  const priority = Number(tarifa?.prioridad);
  return Number.isFinite(priority) ? priority : 0;
}

function normalizeDays(tarifa) {
  return Array.isArray(tarifa?.dias_semana)
    ? tarifa.dias_semana.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
}

function normalizeRoomIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function roomScopeRank(tarifa) {
  if (tarifa?.habitacion_id) return 3;
  if (normalizeRoomIds(tarifa?.habitaciones_aplicables).length > 0) return 2;
  if (normalizeRoomIds(tarifa?.habitaciones_excluidas).length > 0) return 1;
  return 0;
}

function compareRoomScopeSpecificity(a, b) {
  const rankDiff = roomScopeRank(b) - roomScopeRank(a);
  if (rankDiff !== 0) return rankDiff;

  const aIncluded = normalizeRoomIds(a?.habitaciones_aplicables);
  const bIncluded = normalizeRoomIds(b?.habitaciones_aplicables);
  if (aIncluded.length && bIncluded.length && aIncluded.length !== bIncluded.length) {
    return aIncluded.length - bIncluded.length;
  }

  const aExcluded = normalizeRoomIds(a?.habitaciones_excluidas);
  const bExcluded = normalizeRoomIds(b?.habitaciones_excluidas);
  if (aExcluded.length && bExcluded.length && aExcluded.length !== bExcluded.length) {
    return bExcluded.length - aExcluded.length;
  }

  return 0;
}

function dateKeyForContext(value, timeZone) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
  return getDateKeyInTimeZone(value, timeZone);
}

export function tarifaProgramadaAplica(tarifa, {
  fecha,
  habitacionId = null,
  tiempoEstanciaId = null,
  modalidad = 'noche',
  timeZone = getRuntimeHotelTimeZone()
} = {}) {
  if (!tarifa || tarifa.activo === false) return false;
  if (String(tarifa.modalidad || 'noche') !== String(modalidad || 'noche')) return false;

  const dateKey = dateKeyForContext(fecha, timeZone);
  if (!dateKey) return false;

  if (tarifa.fecha_inicio && dateKey < String(tarifa.fecha_inicio)) return false;
  if (tarifa.fecha_fin && dateKey > String(tarifa.fecha_fin)) return false;

  const days = normalizeDays(tarifa);
  if (days.length > 0 && !days.includes(weekdayFromDateKey(dateKey))) return false;

  const currentRoomId = String(habitacionId || '');
  if (tarifa.habitacion_id && String(tarifa.habitacion_id) !== currentRoomId) return false;

  const includedRooms = normalizeRoomIds(tarifa.habitaciones_aplicables);
  if (includedRooms.length > 0 && (!currentRoomId || !includedRooms.includes(currentRoomId))) return false;

  const excludedRooms = normalizeRoomIds(tarifa.habitaciones_excluidas);
  if (currentRoomId && excludedRooms.includes(currentRoomId)) return false;

  if (modalidad === 'tiempo_estancia') {
    if (!tiempoEstanciaId) return false;
    if (String(tarifa.tiempo_estancia_id || '') !== String(tiempoEstanciaId)) return false;
  }

  return true;
}

export function seleccionarTarifaProgramada(tarifas = [], context = {}) {
  return (Array.isArray(tarifas) ? tarifas : [])
    .filter((tarifa) => tarifaProgramadaAplica(tarifa, context))
    .sort((a, b) => {
      const priorityDiff = normalizePriority(b) - normalizePriority(a);
      if (priorityDiff !== 0) return priorityDiff;

      const roomSpecificity = compareRoomScopeSpecificity(a, b);
      if (roomSpecificity !== 0) return roomSpecificity;

      const boundedDateSpecificity = Number(Boolean(b.fecha_inicio || b.fecha_fin)) - Number(Boolean(a.fecha_inicio || a.fecha_fin));
      if (boundedDateSpecificity !== 0) return boundedDateSpecificity;

      const aDays = normalizeDays(a).length || 7;
      const bDays = normalizeDays(b).length || 7;
      if (aDays !== bDays) return aDays - bDays;

      return String(a.id || a.nombre || '').localeCompare(String(b.id || b.nombre || ''), 'es');
    })[0] || null;
}

function resolveBaseNightPrice(room, guests) {
  const backup = cleanMoney(room?.precio, 0);
  if (guests <= 1) {
    return cleanMoney(room?.precio_1_persona, 0)
      || backup
      || cleanMoney(room?.precio_2_personas, 0);
  }
  return cleanMoney(room?.precio_2_personas, 0)
    || backup
    || cleanMoney(room?.precio_1_persona, 0);
}

export function resolverPrecioNoche({
  room,
  huespedes = 1,
  fecha,
  tarifas = [],
  timeZone = getRuntimeHotelTimeZone()
} = {}) {
  const guests = Math.max(1, Number(huespedes) || 1);
  const baseOccupancy = Math.max(1, Number(room?.capacidad_base) || 2);
  const dateKey = dateKeyForContext(fecha, timeZone);
  const tarifa = seleccionarTarifaProgramada(tarifas, {
    fecha: dateKey,
    habitacionId: room?.id,
    modalidad: 'noche',
    timeZone
  });

  const baseNightPrice = resolveBaseNightPrice(room, guests);
  const exactPrice = toNumberOrNull(tarifa?.precio_final);
  const programmedOccupancyPrice = guests <= 1
    ? toNumberOrNull(tarifa?.precio_1_persona)
    : toNumberOrNull(tarifa?.precio_2_personas);

  const lodgingPrice = exactPrice ?? programmedOccupancyPrice ?? baseNightPrice;
  const baseExtraGuestPrice = cleanMoney(room?.precio_huesped_adicional, 0);
  const programmedExtraGuestPrice = toNumberOrNull(tarifa?.precio_huesped_adicional);
  const extraGuestUnitPrice = programmedExtraGuestPrice ?? baseExtraGuestPrice;
  const extraGuests = Math.max(0, guests - baseOccupancy);
  const extraGuestsAmount = extraGuests * extraGuestUnitPrice;

  return {
    fecha: dateKey,
    precioHospedaje: cleanMoney(lodgingPrice, 0),
    huespedesAdicionales: extraGuests,
    precioHuespedAdicional: cleanMoney(extraGuestUnitPrice, 0),
    montoHuespedesAdicionales: cleanMoney(extraGuestsAmount, 0),
    total: cleanMoney(lodgingPrice, 0) + cleanMoney(extraGuestsAmount, 0),
    tarifaAplicada: tarifa || null
  };
}

export function calcularEstanciaNochesProgramada({
  room,
  huespedes = 1,
  fechaEntrada,
  cantidadNoches = 1,
  tarifas = [],
  timeZone = getRuntimeHotelTimeZone()
} = {}) {
  const nights = Math.max(1, Number(cantidadNoches) || 1);
  const firstDateKey = dateKeyForContext(fechaEntrada, timeZone);
  if (!firstDateKey) {
    return { total: 0, montoHospedaje: 0, montoHuespedesAdicionales: 0, desglose: [], tarifasAplicadas: [] };
  }

  const breakdown = [];
  for (let index = 0; index < nights; index += 1) {
    const dateKey = addCalendarDays(firstDateKey, index);
    breakdown.push(resolverPrecioNoche({ room, huespedes, fecha: dateKey, tarifas, timeZone }));
  }

  const lodgingAmount = breakdown.reduce((sum, item) => sum + item.precioHospedaje, 0);
  const extraGuestsAmount = breakdown.reduce((sum, item) => sum + item.montoHuespedesAdicionales, 0);
  const appliedTariffs = breakdown.map((item) => item.tarifaAplicada).filter(Boolean);

  return {
    total: lodgingAmount + extraGuestsAmount,
    montoHospedaje: lodgingAmount,
    montoHuespedesAdicionales: extraGuestsAmount,
    desglose: breakdown,
    tarifasAplicadas: appliedTariffs
  };
}

export function resolverPrecioTiempoEstancia({
  room,
  tiempo,
  huespedes = 1,
  fecha,
  tarifas = [],
  timeZone = getRuntimeHotelTimeZone()
} = {}) {
  const guests = Math.max(1, Number(huespedes) || 1);
  const minutes = Math.max(0, Number(tiempo?.minutos) || 0);
  const dateKey = dateKeyForContext(fecha, timeZone);
  const tarifa = seleccionarTarifaProgramada(tarifas, {
    fecha: dateKey,
    habitacionId: room?.id,
    tiempoEstanciaId: tiempo?.id,
    modalidad: 'tiempo_estancia',
    timeZone
  });

  let basePrice = cleanMoney(tiempo?.precio, 0);
  if (basePrice <= 0 && minutes > 0) {
    const baseHour = cleanMoney(room?.precio_base_hora, 0);
    if (baseHour > 0) basePrice = (minutes / 60) * baseHour;
  }

  const programmedPrice = toNumberOrNull(tarifa?.precio_final);
  const lodgingPrice = programmedPrice ?? basePrice;
  const baseOccupancy = Math.max(1, Number(room?.capacidad_base) || 2);
  const extraGuests = Math.max(0, guests - baseOccupancy);
  const baseExtraGuestPrice = cleanMoney(room?.precio_huesped_adicional, 0);
  const programmedExtraGuestPrice = toNumberOrNull(tarifa?.precio_huesped_adicional);
  const extraGuestUnitPrice = programmedExtraGuestPrice ?? baseExtraGuestPrice;
  const extraGuestsAmount = extraGuests * extraGuestUnitPrice;

  return {
    fecha: dateKey,
    precioHospedaje: cleanMoney(lodgingPrice, 0),
    huespedesAdicionales: extraGuests,
    precioHuespedAdicional: cleanMoney(extraGuestUnitPrice, 0),
    montoHuespedesAdicionales: cleanMoney(extraGuestsAmount, 0),
    total: cleanMoney(lodgingPrice, 0) + cleanMoney(extraGuestsAmount, 0),
    tarifaAplicada: tarifa || null
  };
}

export async function cargarTarifasProgramadas(supabase, hotelId) {
  if (!supabase || !hotelId) return [];
  const { data, error } = await supabase
    .from('tarifas_programadas_habitacion')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order('prioridad', { ascending: false });

  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw error;
  }
  return data || [];
}
