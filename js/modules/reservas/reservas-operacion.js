const ACTIVE_RESERVATION_STATES = ['reservada', 'confirmada', 'activa', 'ocupada', 'tiempo agotado'];

export const RESERVA_ORIGIN_OPTIONS = [
  { value: 'directa', label: 'Directa' },
  { value: 'recepcion', label: 'Recepcion' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'telefono', label: 'Telefono' },
  { value: 'booking', label: 'Booking.com' },
  { value: 'airbnb', label: 'Airbnb' },
  { value: 'expedia', label: 'Expedia' },
  { value: 'google_hotel_ads', label: 'Google Hotel Ads' },
  { value: 'google_calendar', label: 'Google Calendar' },
  { value: 'ical_google', label: 'iCal Google' },
  { value: 'referido', label: 'Referido' },
  { value: 'empresa', label: 'Empresa' }
];

const ORIGIN_LABEL_MAP = RESERVA_ORIGIN_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});

const ORIGIN_FUNNEL_MAP = {
  directa: 'Directo',
  recepcion: 'Directo',
  whatsapp: 'Mensajeria',
  telefono: 'Mensajeria',
  booking: 'OTA',
  airbnb: 'OTA',
  expedia: 'OTA',
  google_hotel_ads: 'Meta',
  google_calendar: 'Integraciones',
  ical_google: 'Integraciones',
  referido: 'Referidos',
  empresa: 'Corporativo'
};

export function getReservaOriginLabel(origin) {
  return ORIGIN_LABEL_MAP[origin] || 'Directa';
}

export function getReservaOriginFunnelStage(origin) {
  return ORIGIN_FUNNEL_MAP[origin] || 'Directo';
}

function normalizeDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeRulePriority(rule) {
  return Number.isFinite(Number(rule?.prioridad)) ? Number(rule.prioridad) : 0;
}

function normalizeWeekDayList(rule) {
  if (!Array.isArray(rule?.dias_semana)) return [];
  return rule.dias_semana
    .map((day) => Number(day))
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
}

export function matchesPricingRule(rule, context = {}) {
  if (!rule || rule.activo === false) return false;

  const arrivalDate = normalizeDate(context.fechaEntrada);
  if (!arrivalDate) return false;

  const ruleStart = rule.fecha_inicio ? normalizeDate(`${rule.fecha_inicio}T00:00:00`) : null;
  const ruleEnd = rule.fecha_fin ? normalizeDate(`${rule.fecha_fin}T23:59:59`) : null;

  if (ruleStart && arrivalDate < ruleStart) return false;
  if (ruleEnd && arrivalDate > ruleEnd) return false;

  const applicableDays = normalizeWeekDayList(rule);
  if (applicableDays.length > 0 && !applicableDays.includes(arrivalDate.getDay())) return false;

  const origin = String(context.origenReserva || 'directa');
  if (rule.origen_reserva && String(rule.origen_reserva) !== origin) return false;

  if (rule.habitacion_id && String(rule.habitacion_id) !== String(context.habitacionId || '')) return false;
  if (rule.tipo_habitacion_id && String(rule.tipo_habitacion_id) !== String(context.tipoHabitacionId || '')) return false;

  const isNoches = String(context.tipoDuracion || 'noches_manual') === 'noches_manual';
  if (isNoches && rule.aplica_noches === false) return false;
  if (!isNoches && rule.aplica_horas === false) return false;

  return true;
}

export function pickApplicablePricingRule(rules = [], context = {}) {
  const matchingRules = (Array.isArray(rules) ? rules : [])
    .filter((rule) => matchesPricingRule(rule, context))
    .sort((a, b) => {
      const priorityDiff = normalizeRulePriority(b) - normalizeRulePriority(a);
      if (priorityDiff !== 0) return priorityDiff;

      const specificityA = [a.habitacion_id, a.tipo_habitacion_id, a.origen_reserva].filter(Boolean).length;
      const specificityB = [b.habitacion_id, b.tipo_habitacion_id, b.origen_reserva].filter(Boolean).length;
      if (specificityB !== specificityA) return specificityB - specificityA;

      return String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es');
    });

  return matchingRules[0] || null;
}

export function applyPricingRule(baseAmount, rules = [], context = {}) {
  const cleanBaseAmount = Number(baseAmount) || 0;
  const appliedRule = pickApplicablePricingRule(rules, context);
  if (!appliedRule || cleanBaseAmount <= 0) {
    return {
      adjustedBaseAmount: cleanBaseAmount,
      adjustmentAmount: 0,
      appliedRule: null
    };
  }

  const ruleValue = Number(appliedRule.valor) || 0;
  let adjustedBaseAmount = cleanBaseAmount;

  if (String(appliedRule.tipo_ajuste || 'porcentaje') === 'fijo') {
    adjustedBaseAmount = cleanBaseAmount + ruleValue;
  } else {
    adjustedBaseAmount = cleanBaseAmount + (cleanBaseAmount * ruleValue / 100);
  }

  adjustedBaseAmount = Math.max(0, adjustedBaseAmount);

  return {
    adjustedBaseAmount,
    adjustmentAmount: adjustedBaseAmount - cleanBaseAmount,
    appliedRule: {
      ...appliedRule,
      label: appliedRule.nombre || 'Regla dinamica',
      adjustmentAmount: adjustedBaseAmount - cleanBaseAmount
    }
  };
}

export function getReservaToleranceStatus(reserva, config = {}, referenceDate = new Date()) {
  if (!['reservada', 'confirmada'].includes(reserva?.estado)) {
    return { level: 'sin_riesgo', label: '', tone: 'slate', helper: '' };
  }

  const arrivalDate = normalizeDate(reserva?.fecha_inicio);
  if (!arrivalDate) {
    return { level: 'sin_riesgo', label: '', tone: 'slate', helper: '' };
  }

  const now = normalizeDate(referenceDate) || new Date();
  const diffMinutes = Math.round((now.getTime() - arrivalDate.getTime()) / 60000);
  const toleranceMinutes = Math.max(0, Number(config?.minutos_tolerancia_llegada) || 60);
  const alertMinutes = Math.max(30, Number(config?.minutos_alerta_reserva) || 120);
  const arrivalDeadline = new Date(
    arrivalDate.getFullYear(),
    arrivalDate.getMonth(),
    arrivalDate.getDate(),
    23,
    59,
    59,
    999
  );

  if (now.getTime() > arrivalDeadline.getTime()) {
    return {
      level: 'no_show_sugerido',
      label: 'No-show sugerido',
      tone: 'red',
      helper: 'La fecha de llegada ya cerro y la reserva sigue pendiente.',
      overdueMinutes: diffMinutes,
      toleranceMinutes
    };
  }

  if (diffMinutes < 0 && Math.abs(diffMinutes) <= alertMinutes) {
    return {
      level: 'llegada_proxima',
      label: 'Llega pronto',
      tone: 'indigo',
      helper: `Llega en ${Math.abs(diffMinutes)} min.`,
      overdueMinutes: diffMinutes,
      toleranceMinutes
    };
  }

  if (diffMinutes >= 0 && diffMinutes <= toleranceMinutes) {
    return {
      level: 'tardanza_tolerada',
      label: 'Tardanza tolerada',
      tone: 'amber',
      helper: `Dentro de tolerancia (${toleranceMinutes} min).`,
      overdueMinutes: diffMinutes,
      toleranceMinutes
    };
  }

  if (diffMinutes > toleranceMinutes) {
    return {
      level: 'no_show_sugerido',
      label: 'No-show sugerido',
      tone: 'red',
      helper: `Supero la tolerancia por ${diffMinutes - toleranceMinutes} min.`,
      overdueMinutes: diffMinutes,
      toleranceMinutes
    };
  }

  return { level: 'sin_riesgo', label: '', tone: 'slate', helper: '', overdueMinutes: diffMinutes, toleranceMinutes };
}

export function reservationRangesOverlap(startA, endA, startB, endB) {
  const startDateA = normalizeDate(startA);
  const endDateA = normalizeDate(endA);
  const startDateB = normalizeDate(startB);
  const endDateB = normalizeDate(endB);

  if (!startDateA || !endDateA || !startDateB || !endDateB) return false;
  return startDateA < endDateB && endDateA > startDateB;
}

export function getWaitlistPriorityLabel(priority) {
  const numericPriority = Number(priority) || 1;
  if (numericPriority >= 3) return 'Urgente';
  if (numericPriority === 2) return 'Alta';
  return 'Normal';
}

export function suggestRoomsForWaitlistItem(item, rooms = [], reservations = [], referenceDate = new Date()) {
  const itemStart = normalizeDate(item?.fecha_inicio);
  const itemEnd = normalizeDate(item?.fecha_fin);
  if (!itemStart || !itemEnd) return [];

  const needsImmediateAvailability = itemStart.getTime() - (normalizeDate(referenceDate)?.getTime() || Date.now()) <= 6 * 60 * 60 * 1000;
  const desiredCapacity = Math.max(1, Number(item?.cantidad_huespedes) || 1);
  const desiredRoomId = item?.habitacion_id ? String(item.habitacion_id) : null;
  const desiredTypeId = item?.tipo_habitacion_id ? String(item.tipo_habitacion_id) : null;

  return (Array.isArray(rooms) ? rooms : [])
    .filter((room) => room?.activo !== false)
    .map((room) => {
      const roomId = String(room.id);
      const roomState = String(room.estado || 'libre');
      const roomCapacity = Number(room.capacidad_maxima) || 0;
      const roomTypeId = room.tipo_habitacion_id ? String(room.tipo_habitacion_id) : null;
      const conflictingReservations = (Array.isArray(reservations) ? reservations : []).filter((reservation) => {
        if (String(reservation?.habitacion_id || '') !== roomId) return false;
        if (!ACTIVE_RESERVATION_STATES.includes(String(reservation?.estado || ''))) return false;
        return reservationRangesOverlap(itemStart, itemEnd, reservation.fecha_inicio, reservation.fecha_fin);
      });

      if (needsImmediateAvailability && !['libre', 'disponible'].includes(roomState)) {
        return null;
      }

      if (conflictingReservations.length > 0) return null;
      if (roomCapacity > 0 && roomCapacity < desiredCapacity) return null;

      const score = [
        desiredRoomId && desiredRoomId === roomId ? 100 : 0,
        desiredTypeId && desiredTypeId === roomTypeId ? 35 : 0,
        ['libre', 'disponible'].includes(roomState) ? 20 : 0,
        roomCapacity >= desiredCapacity ? 10 : 0
      ].reduce((sum, value) => sum + value, 0);

      return {
        id: room.id,
        nombre: room.nombre,
        tipo: room.tipo,
        tipo_habitacion_id: room.tipo_habitacion_id || null,
        score
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'))
    .slice(0, 3);
}
