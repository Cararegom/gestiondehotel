const SAFE_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

function normalizeCode(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);

  return SAFE_CODE_PATTERN.test(normalized) ? normalized : fallback;
}

/**
 * Reporta un fallo manejado usando solamente codigos estables y sin copiar el
 * mensaje, payload ni identificadores del error original al evento.
 */
export function reportHandledError(source, eventType) {
  const safeSource = normalizeCode(source, 'app');
  const safeEventType = normalizeCode(eventType, 'handled_error');
  const exception = new Error(`${safeSource}.${safeEventType}`);
  exception.name = 'HandledOperationalError';

  try {
    const monitoring = globalThis.HotelMonitoring || globalThis.HotelTelemetry;
    monitoring?.captureException(exception, {
      source: safeSource,
      eventType: safeEventType
    });
  } catch {
    // La observabilidad nunca debe interrumpir la operacion principal.
  }

  return exception;
}
