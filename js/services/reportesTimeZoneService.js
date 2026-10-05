import {
  addCalendarDays,
  getDateKeyInTimeZone,
  getInclusiveCalendarDayCount,
  getRuntimeHotelTimeZone,
  getTodayInTimeZone,
  getUtcRangeForHotelDates,
  getWeekdayIndexInTimeZone
} from './hotelTimeZoneService.js';

export function getDefaultReportDateRange({
  timeZone = getRuntimeHotelTimeZone(),
  now = new Date(),
  daysBack = 30,
} = {}) {
  const normalizedDaysBack = Math.max(0, Math.trunc(Number(daysBack) || 0));
  const endDate = getTodayInTimeZone(timeZone, now);

  return {
    startDate: addCalendarDays(endDate, -normalizedDaysBack),
    endDate,
  };
}

export function getReportUtcRange(startDate, endDate, timeZone = getRuntimeHotelTimeZone()) {
  return getUtcRangeForHotelDates(startDate, endDate, timeZone);
}

export function getReportComparisonRanges(startDate, endDate, timeZone = getRuntimeHotelTimeZone()) {
  const totalDays = getInclusiveCalendarDayCount(startDate, endDate);
  const previousEndDate = addCalendarDays(startDate, -1);
  const previousStartDate = addCalendarDays(previousEndDate, -(totalDays - 1));

  return {
    current: getUtcRangeForHotelDates(startDate, endDate, timeZone),
    previous: getUtcRangeForHotelDates(previousStartDate, previousEndDate, timeZone),
    previousStartDate,
    previousEndDate,
    totalDays
  };
}

export function buildReportDateKeys(startDate, endDate) {
  const totalDays = getInclusiveCalendarDayCount(startDate, endDate);
  return Array.from({ length: totalDays }, (_, index) => addCalendarDays(startDate, index));
}

export function aggregateIncomeByHotelDate(movements = [], timeZone = getRuntimeHotelTimeZone()) {
  return (movements || []).reduce((totals, movement) => {
    const dateKey = getDateKeyInTimeZone(movement?.fecha_movimiento ?? movement?.creado_en, timeZone);
    const amount = Number(movement?.monto);
    if (!dateKey || !Number.isFinite(amount)) return totals;
    totals[dateKey] = (totals[dateKey] || 0) + amount;
    return totals;
  }, {});
}

export function aggregateAmountsByHotelPeriod(
  movements = [],
  grouping = 'diario',
  timeZone = getRuntimeHotelTimeZone()
) {
  const totals = {};

  for (const movement of movements || []) {
    const dateKey = getDateKeyInTimeZone(movement?.fecha_movimiento ?? movement?.creado_en, timeZone);
    const amount = Number(movement?.monto);
    if (!dateKey || !Number.isFinite(amount)) continue;

    const [year, month] = dateKey.split('-').map(Number);
    let periodKey = dateKey;
    switch (grouping) {
      case 'mensual': periodKey = `${year}-M${String(month).padStart(2, '0')}`; break;
      case 'bimestral': periodKey = `${year}-B${Math.floor((month - 1) / 2) + 1}`; break;
      case 'trimestral': periodKey = `${year}-T${Math.floor((month - 1) / 3) + 1}`; break;
      case 'semestral': periodKey = `${year}-S${Math.floor((month - 1) / 6) + 1}`; break;
      case 'anual': periodKey = String(year); break;
      default: periodKey = dateKey;
    }
    totals[periodKey] = (totals[periodKey] || 0) + amount;
  }

  return totals;
}

export function calculateHotelWeekdayMetrics({
  reservas = [],
  movimientosIngreso = [],
  startDate,
  endDate,
  timeZone = getRuntimeHotelTimeZone()
} = {}) {
  const demandaPorDia = new Array(7).fill(0);
  const ingresosPorDiaSemana = new Array(7).fill(0);
  const conteoDeDiasEnRango = new Array(7).fill(0);

  for (const reserva of reservas || []) {
    const weekday = getWeekdayIndexInTimeZone(reserva?.fecha_inicio, timeZone);
    if (weekday >= 0) demandaPorDia[weekday] += 1;
  }

  for (const movement of movimientosIngreso || []) {
    const weekday = getWeekdayIndexInTimeZone(movement?.fecha_movimiento, timeZone);
    const amount = Number(movement?.monto);
    if (weekday >= 0 && Number.isFinite(amount)) ingresosPorDiaSemana[weekday] += amount;
  }

  for (const dateKey of buildReportDateKeys(startDate, endDate)) {
    const dayStart = getUtcRangeForHotelDates(dateKey, dateKey, timeZone).startIso;
    const weekday = getWeekdayIndexInTimeZone(dayStart, timeZone);
    if (weekday >= 0) conteoDeDiasEnRango[weekday] += 1;
  }

  return { demandaPorDia, ingresosPorDiaSemana, conteoDeDiasEnRango };
}
