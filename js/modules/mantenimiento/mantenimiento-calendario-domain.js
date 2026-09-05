export const MAINTENANCE_PLAN_CLASSES = Object.freeze({
  tarea: 'tarea',
  preventivo: 'preventivo',
  vencimiento: 'vencimiento'
});

export const MAINTENANCE_PLAN_CLASS_LABELS = Object.freeze({
  tarea: 'Tarea programada',
  preventivo: 'Preventivo',
  vencimiento: 'Vencimiento'
});

export const RECURRENCE_PRESETS = Object.freeze([
  { id: 'ninguna', label: 'No repetir', unit: 'ninguna', interval: 1 },
  { id: 'diaria', label: 'Cada día', unit: 'dia', interval: 1 },
  { id: 'semanal', label: 'Cada semana', unit: 'semana', interval: 1 },
  { id: 'quincenal', label: 'Cada 15 días', unit: 'dia', interval: 15 },
  { id: 'mensual', label: 'Cada mes', unit: 'mes', interval: 1 },
  { id: 'bimestral', label: 'Cada 2 meses', unit: 'mes', interval: 2 },
  { id: 'trimestral', label: 'Cada 3 meses', unit: 'mes', interval: 3 },
  { id: 'semestral', label: 'Cada 6 meses', unit: 'mes', interval: 6 },
  { id: 'anual', label: 'Cada año', unit: 'anio', interval: 1 },
  { id: 'personalizada', label: 'Personalizada', unit: null, interval: null }
]);

function clampInteger(value, fallback = 1, min = 1, max = 365) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseIsoDate(value) {
  const match = String(value || '').slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return { year, month, day, date };
}

function toIsoDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0')
  ].join('-');
}

export function compareIsoDates(a, b) {
  return String(a || '').slice(0, 10).localeCompare(String(b || '').slice(0, 10));
}

export function addDaysIso(value, days) {
  const parsed = parseIsoDate(value);
  if (!parsed) return null;
  const date = new Date(parsed.date.getTime());
  date.setUTCDate(date.getUTCDate() + Math.trunc(Number(days) || 0));
  return toIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addMonthsAnchored(currentIso, anchorIso, monthsToAdd) {
  const current = parseIsoDate(currentIso);
  const anchor = parseIsoDate(anchorIso);
  if (!current || !anchor) return null;

  const targetIndex = current.year * 12 + (current.month - 1) + monthsToAdd;
  const targetYear = Math.floor(targetIndex / 12);
  const targetMonth = (targetIndex % 12) + 1;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth, 0)).getUTCDate();
  return toIsoDate(targetYear, targetMonth, Math.min(anchor.day, lastDay));
}

function addYearsAnchored(currentIso, anchorIso, yearsToAdd) {
  const current = parseIsoDate(currentIso);
  const anchor = parseIsoDate(anchorIso);
  if (!current || !anchor) return null;

  const targetYear = current.year + yearsToAdd;
  const lastDay = new Date(Date.UTC(targetYear, anchor.month, 0)).getUTCDate();
  return toIsoDate(targetYear, anchor.month, Math.min(anchor.day, lastDay));
}

export function nextPlanOccurrenceDate(currentIso, anchorIso, unit, interval = 1) {
  const normalizedUnit = String(unit || 'ninguna');
  const normalizedInterval = clampInteger(interval);
  if (!parseIsoDate(currentIso) || !parseIsoDate(anchorIso)) return null;

  if (normalizedUnit === 'ninguna') return null;
  if (normalizedUnit === 'dia') return addDaysIso(currentIso, normalizedInterval);
  if (normalizedUnit === 'semana') return addDaysIso(currentIso, normalizedInterval * 7);
  if (normalizedUnit === 'mes') return addMonthsAnchored(currentIso, anchorIso, normalizedInterval);
  if (normalizedUnit === 'anio') return addYearsAnchored(currentIso, anchorIso, normalizedInterval);
  return null;
}

export function getRecurrencePreset(plan = {}) {
  const unit = String(plan.recurrencia_unidad || 'ninguna');
  const interval = clampInteger(plan.recurrencia_intervalo);
  const match = RECURRENCE_PRESETS.find((preset) => (
    preset.id !== 'personalizada'
    && preset.unit === unit
    && preset.interval === interval
  ));
  return match?.id || 'personalizada';
}

export function recurrenceFromPreset(presetId, customUnit = 'dia', customInterval = 1) {
  const preset = RECURRENCE_PRESETS.find((item) => item.id === presetId);
  if (preset && preset.id !== 'personalizada') {
    return { unit: preset.unit, interval: preset.interval };
  }
  const allowed = ['dia', 'semana', 'mes', 'anio'];
  return {
    unit: allowed.includes(customUnit) ? customUnit : 'dia',
    interval: clampInteger(customInterval)
  };
}

export function getPlanRecurrenceLabel(plan = {}) {
  const preset = getRecurrencePreset(plan);
  const presetMeta = RECURRENCE_PRESETS.find((item) => item.id === preset);
  if (presetMeta && preset !== 'personalizada') return presetMeta.label;

  const amount = clampInteger(plan.recurrencia_intervalo);
  const unit = String(plan.recurrencia_unidad || 'dia');
  const singular = { dia: 'día', semana: 'semana', mes: 'mes', anio: 'año' }[unit] || 'día';
  const plural = { dia: 'días', semana: 'semanas', mes: 'meses', anio: 'años' }[unit] || 'días';
  return `Cada ${amount} ${amount === 1 ? singular : plural}`;
}

export function normalizeReminderDays(value, fallback = [1, 0]) {
  const raw = Array.isArray(value) ? value : fallback;
  const unique = [...new Set(raw
    .map((item) => Math.trunc(Number(item)))
    .filter((item) => Number.isFinite(item) && item >= 0 && item <= 365))];
  if (!unique.length) return [0];
  return unique.sort((a, b) => b - a).slice(0, 10);
}

export function expandMaintenancePlanOccurrences(plan, rangeStart, rangeEnd, limit = 250) {
  const start = String(rangeStart || '').slice(0, 10);
  const end = String(rangeEnd || '').slice(0, 10);
  const anchor = String(plan?.fecha_inicio || '').slice(0, 10);
  if (!parseIsoDate(start) || !parseIsoDate(end) || !parseIsoDate(anchor)) return [];
  if (compareIsoDates(start, end) > 0) return [];

  const unit = String(plan?.recurrencia_unidad || 'ninguna');
  const interval = clampInteger(plan?.recurrencia_intervalo);
  const finish = plan?.fecha_fin ? String(plan.fecha_fin).slice(0, 10) : null;
  const output = [];
  const maxItems = Math.max(1, Math.min(Math.trunc(Number(limit) || 250), 1000));
  let current = anchor;
  let guard = 0;

  while (current && compareIsoDates(current, start) < 0) {
    if (unit === 'ninguna') return [];
    current = nextPlanOccurrenceDate(current, anchor, unit, interval);
    guard += 1;
    if (guard > 5000) return [];
  }

  while (
    current
    && compareIsoDates(current, end) <= 0
    && (!finish || compareIsoDates(current, finish) <= 0)
    && output.length < maxItems
  ) {
    output.push({
      date: current,
      planId: plan.id || null,
      clase: plan.clase || MAINTENANCE_PLAN_CLASSES.preventivo,
      titulo: plan.titulo || 'Mantenimiento',
      ubicacion: plan.ubicacion || null,
      prioridad: Number(plan.prioridad) || 0,
      asignada_a: plan.asignada_a || null,
      activo: plan.activo !== false
    });

    if (unit === 'ninguna') break;
    const next = nextPlanOccurrenceDate(current, anchor, unit, interval);
    if (!next || next === current) break;
    current = next;
    guard += 1;
    if (guard > 5000) break;
  }

  return output;
}

export function getDefaultReminderDays(planClass) {
  if (planClass === MAINTENANCE_PLAN_CLASSES.vencimiento) return [30, 15, 7, 1, 0];
  return [1, 0];
}

export function getPlanClassLabel(planClass) {
  return MAINTENANCE_PLAN_CLASS_LABELS[planClass] || MAINTENANCE_PLAN_CLASS_LABELS.preventivo;
}
