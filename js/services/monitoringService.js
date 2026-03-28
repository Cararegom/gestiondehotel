let monitoringSupabase = null;
let monitoringContext = {
  userId: null,
  hotelId: null,
  role: null
};
let listenersInstalled = false;
let windowErrorHandler = null;
let windowRejectionHandler = null;
const dedupeCache = new Map();
const DEDUPE_WINDOW_MS = 30000;

function getCurrentRoute() {
  return window.location.hash?.slice(1) || window.location.pathname || '/';
}

function cleanupDedupeCache() {
  const now = Date.now();
  for (const [key, timestamp] of dedupeCache.entries()) {
    if ((now - timestamp) > DEDUPE_WINDOW_MS) {
      dedupeCache.delete(key);
    }
  }
}

function shouldSkipDuplicate(key) {
  cleanupDedupeCache();
  if (dedupeCache.has(key)) {
    return true;
  }
  dedupeCache.set(key, Date.now());
  return false;
}

function sanitizeDetails(value, depth = 0) {
  if (depth > 4) {
    return '[max-depth]';
  }

  if (value === null || value === undefined) {
    return value ?? null;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || null
    };
  }

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => sanitizeDetails(item, depth + 1));
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value).slice(0, 40);
    return Object.fromEntries(entries.map(([key, nestedValue]) => [key, sanitizeDetails(nestedValue, depth + 1)]));
  }

  if (typeof value === 'function') {
    return '[function]';
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

async function sendEvent(payload) {
  if (!monitoringSupabase || !monitoringContext.userId) {
    return null;
  }

  const dedupeKey = payload.dedupeKey || [
    payload.scope || 'hotel',
    payload.source || 'app',
    payload.level || 'info',
    payload.eventType || 'generic',
    payload.message || '',
    payload.route || getCurrentRoute()
  ].join('|');

  if (shouldSkipDuplicate(dedupeKey)) {
    return null;
  }

  try {
    const { data, error } = await monitoringSupabase.rpc('registrar_evento_sistema', {
      p_hotel_id: monitoringContext.hotelId,
      p_usuario_id: monitoringContext.userId,
      p_scope: payload.scope || 'hotel',
      p_source: payload.source || 'app',
      p_level: payload.level || 'info',
      p_event_type: payload.eventType || 'generic',
      p_message: payload.message || 'Evento sin mensaje',
      p_route: payload.route || getCurrentRoute(),
      p_user_agent: navigator.userAgent || null,
      p_details: sanitizeDetails({
        ...payload.details,
        user_role: monitoringContext.role || null
      })
    });

    if (error) {
      console.warn('[Monitoring] No se pudo registrar evento:', error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.warn('[Monitoring] Error inesperado registrando evento:', error);
    return null;
  }
}

function installGlobalListeners() {
  if (listenersInstalled) {
    return;
  }

  windowErrorHandler = (event) => {
    const err = event.error;
    const message = err?.message || event.message || 'Error global no controlado';
    void sendEvent({
      source: 'window',
      level: 'error',
      eventType: 'unhandled_error',
      message,
      details: {
        filename: event.filename || null,
        lineno: event.lineno || null,
        colno: event.colno || null,
        error: sanitizeDetails(err)
      },
      dedupeKey: `window-error|${event.filename || ''}|${event.lineno || ''}|${message}`
    });
  };

  windowRejectionHandler = (event) => {
    const reason = event.reason;
    const message =
      reason?.message ||
      (typeof reason === 'string' ? reason : 'Promesa rechazada sin manejo');

    void sendEvent({
      source: 'window',
      level: 'error',
      eventType: 'unhandled_rejection',
      message,
      details: {
        reason: sanitizeDetails(reason)
      },
      dedupeKey: `unhandled-rejection|${message}`
    });
  };

  window.addEventListener('error', windowErrorHandler);
  window.addEventListener('unhandledrejection', windowRejectionHandler);
  listenersInstalled = true;
}

export function initMonitoring({ supabase, user, hotel, role }) {
  monitoringSupabase = supabase || monitoringSupabase;
  monitoringContext = {
    userId: user?.id || null,
    hotelId: hotel?.id || user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id || null,
    role: role || null
  };

  installGlobalListeners();
}

export function destroyMonitoring() {
  if (listenersInstalled && windowErrorHandler) {
    window.removeEventListener('error', windowErrorHandler);
  }
  if (listenersInstalled && windowRejectionHandler) {
    window.removeEventListener('unhandledrejection', windowRejectionHandler);
  }

  listenersInstalled = false;
  windowErrorHandler = null;
  windowRejectionHandler = null;
  monitoringSupabase = null;
  monitoringContext = { userId: null, hotelId: null, role: null };
  dedupeCache.clear();
}

export async function logMonitoringEvent({
  source = 'app',
  level = 'info',
  eventType = 'custom',
  message,
  details = {},
  scope = 'hotel',
  route = null,
  dedupeKey = null
}) {
  return sendEvent({
    source,
    level,
    eventType,
    message,
    details,
    scope,
    route,
    dedupeKey
  });
}

