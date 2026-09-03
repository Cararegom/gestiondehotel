export const DEFAULT_HOTEL_TIME_ZONE = 'America/Bogota';

const FALLBACK_TIME_ZONES = [
  'America/Bogota',
  'America/Lima',
  'America/Guayaquil',
  'America/Panama',
  'America/Caracas',
  'America/Santo_Domingo',
  'America/Mexico_City',
  'America/Cancun',
  'America/Guatemala',
  'America/Costa_Rica',
  'America/Tegucigalpa',
  'America/Managua',
  'America/El_Salvador',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Puerto_Rico',
  'America/Santiago',
  'America/Argentina/Buenos_Aires',
  'America/Montevideo',
  'America/Asuncion',
  'America/La_Paz',
  'America/Sao_Paulo',
  'Europe/Madrid',
  'Europe/London',
  'UTC'
];

const UTC_DAY_START_RE = /^(\d{4}-\d{2}-\d{2})T00:00:00\.000Z$/;
const UTC_DAY_END_RE = /^(\d{4}-\d{2}-\d{2})T23:59:59\.999Z$/;
let runtimeHotelTimeZone = DEFAULT_HOTEL_TIME_ZONE;

export function isValidTimeZone(value) {
  const candidate = String(value || '').trim();
  if (!candidate) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(zone) ? zone : DEFAULT_HOTEL_TIME_ZONE;
  } catch {
    return DEFAULT_HOTEL_TIME_ZONE;
  }
}

// La zona del navegador nunca es la autoridad operativa. Solo Configuración puede
// usar detectBrowserTimeZone() como sugerencia inicial explícita.
export function normalizeTimeZone(value, fallback = DEFAULT_HOTEL_TIME_ZONE) {
  const candidates = [value, fallback, DEFAULT_HOTEL_TIME_ZONE, 'UTC'];
  for (const candidate of candidates) {
    if (isValidTimeZone(candidate)) return String(candidate).trim();
  }
  return 'UTC';
}

export function getRuntimeHotelTimeZone() {
  return normalizeTimeZone(runtimeHotelTimeZone, DEFAULT_HOTEL_TIME_ZONE);
}

export function setRuntimeHotelTimeZone(value) {
  const nextZone = normalizeTimeZone(value, DEFAULT_HOTEL_TIME_ZONE);
  const changed = nextZone !== runtimeHotelTimeZone;
  runtimeHotelTimeZone = nextZone;

  if (typeof window !== 'undefined') {
    window.hotelConfigGlobal = {
      ...(window.hotelConfigGlobal || {}),
      zona_horaria: nextZone
    };
    if (changed && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hotel:timezone-changed', {
        detail: { timeZone: nextZone }
      }));
    }
  }

  return nextZone;
}

export async function loadHotelTimeZone(supabase, hotelId) {
  if (!supabase || !hotelId) return setRuntimeHotelTimeZone(DEFAULT_HOTEL_TIME_ZONE);
  const { data, error } = await supabase
    .from('configuracion_hotel')
    .select('zona_horaria')
    .eq('hotel_id', hotelId)
    .maybeSingle();
  if (error) throw error;
  return setRuntimeHotelTimeZone(data?.zona_horaria || DEFAULT_HOTEL_TIME_ZONE);
}

export function getSupportedTimeZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone');
      if (Array.isArray(zones) && zones.length > 0) return zones;
    }
  } catch {
    // Use the stable fallback list below.
  }
  return [...FALLBACK_TIME_ZONES];
}

function parseDateInput(dateInput) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateInput || '').trim());
  if (!match) throw new Error('Fecha inválida. Se esperaba YYYY-MM-DD.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new Error('Fecha de calendario inválida.');
  }
  return { year, month, day };
}

function parseTimeInput(timeInput) {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(String(timeInput || '').trim());
  if (!match) throw new Error('Hora inválida. Se esperaba HH:mm[:ss[.SSS]].');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] || 0);
  const millisecond = Number(String(match[4] || '0').padEnd(3, '0'));
  if (hour > 23 || minute > 59 || second > 59) throw new Error('Hora fuera de rango.');
  return { hour, minute, second, millisecond };
}

function getTimeZoneOffsetMs(instant, timeZone) {
  const zone = normalizeTimeZone(timeZone);
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error('Instante inválido para calcular zona horaria.');

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);

  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const representedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  const instantRoundedToSecond = Math.floor(date.getTime() / 1000) * 1000;
  return representedAsUtc - instantRoundedToSecond;
}

export function zonedDateTimeToUtc(dateInput, timeInput = '00:00:00.000', timeZone = DEFAULT_HOTEL_TIME_ZONE) {
  const { year, month, day } = parseDateInput(dateInput);
  const { hour, minute, second, millisecond } = parseTimeInput(timeInput);
  const zone = normalizeTimeZone(timeZone);
  const localWallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

  let candidateMs = localWallClockAsUtc;
  for (let i = 0; i < 4; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(candidateMs), zone);
    const adjusted = localWallClockAsUtc - offset;
    if (adjusted === candidateMs) break;
    candidateMs = adjusted;
  }

  const result = new Date(candidateMs);
  if (Number.isNaN(result.getTime())) throw new Error('No se pudo convertir la fecha a UTC.');
  return result;
}

export function addCalendarDays(dateInput, days) {
  const { year, month, day } = parseDateInput(dateInput);
  const shifted = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

export function getInclusiveCalendarDayCount(startDate, endDate) {
  const start = parseDateInput(startDate);
  const end = parseDateInput(endDate);
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endMs < startMs) throw new Error('El rango de fechas está invertido.');
  return Math.floor((endMs - startMs) / 86400000) + 1;
}

export function getUtcRangeForHotelDates(startDate, endDate, timeZone = DEFAULT_HOTEL_TIME_ZONE) {
  parseDateInput(startDate);
  parseDateInput(endDate);
  if (String(startDate) > String(endDate)) throw new Error('El rango de fechas está invertido.');
  const zone = normalizeTimeZone(timeZone);
  const start = zonedDateTimeToUtc(startDate, '00:00:00.000', zone);
  const endExclusive = zonedDateTimeToUtc(addCalendarDays(endDate, 1), '00:00:00.000', zone);
  if (start.getTime() >= endExclusive.getTime()) throw new Error('Rango de fechas inválido.');
  return {
    timeZone: zone,
    startIso: start.toISOString(),
    endExclusiveIso: endExclusive.toISOString()
  };
}

export function adjustLegacyHotelDayBoundary(method, value, timeZone = getRuntimeHotelTimeZone()) {
  if (typeof value !== 'string') return value;
  const zone = normalizeTimeZone(timeZone, DEFAULT_HOTEL_TIME_ZONE);

  if (method === 'gte') {
    const match = UTC_DAY_START_RE.exec(value);
    if (!match) return value;
    return getUtcRangeForHotelDates(match[1], match[1], zone).startIso;
  }

  if (method === 'lte') {
    const match = UTC_DAY_END_RE.exec(value);
    if (!match) return value;
    const range = getUtcRangeForHotelDates(match[1], match[1], zone);
    return new Date(Date.parse(range.endExclusiveIso) - 1).toISOString();
  }

  return value;
}

function ensureTimeZoneSelected(columns) {
  if (typeof columns !== 'string') return columns;
  const trimmed = columns.trim();
  if (!trimmed || trimmed === '*' || /(^|[,\s])zona_horaria([,\s]|$)/.test(trimmed)) return columns;
  return `${columns}, zona_horaria`;
}

function syncRuntimeFromResult(table, result) {
  if (table !== 'configuracion_hotel') return result;
  const data = result?.data;
  if (data && !Array.isArray(data) && Object.prototype.hasOwnProperty.call(data, 'zona_horaria')) {
    setRuntimeHotelTimeZone(data.zona_horaria);
  }
  return result;
}

function wrapHotelTimeZoneQuery(builder, table) {
  if (!builder || typeof builder !== 'object') return builder;

  return new Proxy(builder, {
    get(target, property) {
      const value = target[property];
      if (typeof value !== 'function') return value;

      if (property === 'then') {
        return (onFulfilled, onRejected) => value.call(
          target,
          (result) => {
            const synced = syncRuntimeFromResult(table, result);
            return typeof onFulfilled === 'function' ? onFulfilled(synced) : synced;
          },
          onRejected
        );
      }

      if (property === 'catch' || property === 'finally') return value.bind(target);

      if (property === 'select' && table === 'configuracion_hotel') {
        return (...args) => {
          if (args.length > 0) args[0] = ensureTimeZoneSelected(args[0]);
          return wrapHotelTimeZoneQuery(value.apply(target, args), table);
        };
      }

      if (property === 'gte' || property === 'lte') {
        return (column, boundary) => wrapHotelTimeZoneQuery(
          value.call(target, column, adjustLegacyHotelDayBoundary(String(property), boundary)),
          table
        );
      }

      return (...args) => wrapHotelTimeZoneQuery(value.apply(target, args), table);
    }
  });
}

export function createHotelTimeZoneAwareSupabaseClient(supabase) {
  if (!supabase || typeof supabase !== 'object' || typeof supabase.from !== 'function') return supabase;

  return new Proxy(supabase, {
    get(target, property) {
      const value = target[property];
      if (property === 'from') {
        return (table) => wrapHotelTimeZoneQuery(target.from(table), String(table || ''));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

export function getDateKeyInTimeZone(value, timeZone = DEFAULT_HOTEL_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const zone = normalizeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return `${values.year}-${values.month}-${values.day}`;
}

export function getWeekdayIndexInTimeZone(value, timeZone = DEFAULT_HOTEL_TIME_ZONE) {
  const dateKey = getDateKeyInTimeZone(value, timeZone);
  if (!dateKey) return -1;
  const { year, month, day } = parseDateInput(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function getTodayInTimeZone(timeZone = DEFAULT_HOTEL_TIME_ZONE, now = new Date()) {
  return getDateKeyInTimeZone(now, timeZone);
}

export function formatInTimeZone(value, timeZone = DEFAULT_HOTEL_TIME_ZONE, locale = 'es-CO', options = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!value) return 'N/A';
  const zone = normalizeTimeZone(timeZone);
  const safeOptions = { ...options };
  Object.keys(safeOptions).forEach((key) => safeOptions[key] === undefined && delete safeOptions[key]);

  // A date-only value is a calendar date, not an instant. Keep the same day regardless of hotel zone.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const { year, month, day } = parseDateInput(String(value));
    const calendarDate = new Date(Date.UTC(year, month - 1, day, 12));
    return new Intl.DateTimeFormat(locale, { ...safeOptions, timeZone: 'UTC' }).format(calendarDate);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha Inválida';
  return new Intl.DateTimeFormat(locale, { ...safeOptions, timeZone: zone }).format(date);
}
