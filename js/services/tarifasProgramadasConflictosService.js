function normalizeDays(tarifa) {
  const days = Array.isArray(tarifa?.dias_semana)
    ? tarifa.dias_semana.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : [];
  return days.length ? [...new Set(days)] : [0, 1, 2, 3, 4, 5, 6];
}

function normalizeRoomIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function normalizePriority(tarifa) {
  const value = Number(tarifa?.prioridad);
  return Number.isFinite(value) ? value : 0;
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

function validDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function dateRangeOverlaps(a, b) {
  const startA = validDateKey(a?.fecha_inicio) ? String(a.fecha_inicio) : '0000-01-01';
  const endA = validDateKey(a?.fecha_fin) ? String(a.fecha_fin) : '9999-12-31';
  const startB = validDateKey(b?.fecha_inicio) ? String(b.fecha_inicio) : '0000-01-01';
  const endB = validDateKey(b?.fecha_fin) ? String(b.fecha_fin) : '9999-12-31';
  return startA <= endB && startB <= endA;
}

function overlappingDays(a, b) {
  const aDays = new Set(normalizeDays(a));
  return normalizeDays(b).filter((day) => aDays.has(day));
}

function shiftDateKey(dateKey, days) {
  const [year, month, day] = String(dateKey).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function weekdayFromDateKey(dateKey) {
  return new Date(`${dateKey}T12:00:00.000Z`).getUTCDay();
}

function calendarOverlapDays(a, b) {
  const sharedDays = overlappingDays(a, b);
  if (!sharedDays.length || !dateRangeOverlaps(a, b)) return [];

  const starts = [a?.fecha_inicio, b?.fecha_inicio].filter(validDateKey).map(String).sort();
  const ends = [a?.fecha_fin, b?.fecha_fin].filter(validDateKey).map(String).sort();
  const overlapStart = starts.length ? starts[starts.length - 1] : null;
  const overlapEnd = ends.length ? ends[0] : null;
  if (overlapStart && overlapEnd && overlapStart > overlapEnd) return [];

  // Con un rango abierto, cualquier día compartido aparecerá dentro de una ventana de 7 días.
  // Con un rango cerrado, revisar como máximo 7 días basta para probar si el weekday existe
  // realmente dentro de la intersección, evitando falsos conflictos en rangos muy cortos.
  if (!overlapStart && !overlapEnd) return sharedDays;

  const anchor = overlapStart || overlapEnd;
  const direction = overlapStart ? 1 : -1;
  const found = new Set();
  for (let index = 0; index < 7; index += 1) {
    const dateKey = shiftDateKey(anchor, direction * index);
    if (overlapStart && dateKey < overlapStart) continue;
    if (overlapEnd && dateKey > overlapEnd) continue;
    const weekday = weekdayFromDateKey(dateKey);
    if (sharedDays.includes(weekday)) found.add(weekday);
  }
  return [...found];
}

export function tarifaAplicaHabitacionScope(tarifa, habitacionId) {
  const roomId = String(habitacionId || '');
  if (!roomId) return false;

  if (tarifa?.habitacion_id && String(tarifa.habitacion_id) !== roomId) return false;

  const included = normalizeRoomIds(tarifa?.habitaciones_aplicables);
  if (included.length > 0 && !included.includes(roomId)) return false;

  const excluded = normalizeRoomIds(tarifa?.habitaciones_excluidas);
  if (excluded.includes(roomId)) return false;

  return true;
}

export function compararPrecedenciaTarifas(a, b) {
  const priorityDiff = normalizePriority(b) - normalizePriority(a);
  if (priorityDiff !== 0) return priorityDiff;

  const roomSpecificity = compareRoomScopeSpecificity(a, b);
  if (roomSpecificity !== 0) return roomSpecificity;

  const boundedDateSpecificity = Number(Boolean(b?.fecha_inicio || b?.fecha_fin)) - Number(Boolean(a?.fecha_inicio || a?.fecha_fin));
  if (boundedDateSpecificity !== 0) return boundedDateSpecificity;

  const aDays = normalizeDays(a).length;
  const bDays = normalizeDays(b).length;
  if (aDays !== bDays) return aDays - bDays;

  return 0;
}

export function detectarConflictosTarifaProgramada(candidata, existentes = [], habitacionIds = []) {
  if (!candidata || candidata.activo === false) return [];

  const modality = String(candidata.modalidad || 'noche');
  const candidateId = String(candidata.id || '');
  const rooms = normalizeRoomIds(habitacionIds);

  return (Array.isArray(existentes) ? existentes : [])
    .map((tarifa) => {
      if (!tarifa || tarifa.activo === false) return null;
      if (candidateId && String(tarifa.id || '') === candidateId) return null;
      if (String(tarifa.modalidad || 'noche') !== modality) return null;
      if (modality === 'tiempo_estancia' && String(tarifa.tiempo_estancia_id || '') !== String(candidata.tiempo_estancia_id || '')) return null;

      const diasCoincidentes = calendarOverlapDays(candidata, tarifa);
      if (!diasCoincidentes.length) return null;

      const habitacionesCoincidentes = rooms.filter(
        (roomId) => tarifaAplicaHabitacionScope(candidata, roomId) && tarifaAplicaHabitacionScope(tarifa, roomId)
      );
      const hasRoomOverlap = rooms.length > 0 ? habitacionesCoincidentes.length > 0 : true;
      if (!hasRoomOverlap) return null;

      const precedence = compararPrecedenciaTarifas(candidata, tarifa);
      return {
        tarifa,
        diasCoincidentes,
        habitacionesCoincidentes,
        ambigua: precedence === 0,
        gana: precedence < 0 ? 'candidata' : precedence > 0 ? 'existente' : 'ambigua'
      };
    })
    .filter(Boolean);
}
