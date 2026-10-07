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
 * Reporta codigos estables y diagnosticos tecnicos validados. Nunca copia el
 * mensaje, stack, payload ni identificadores del error original al evento.
 */
export function reportHandledError(source, eventType, originalError) {
  const safeSource = normalizeCode(source, 'app');
  const safeEventType = normalizeCode(eventType, 'handled_error');
  const exception = new Error(`${safeSource}.${safeEventType}`);
  exception.name = 'HandledOperationalError';

  try {
    const diagnostics = [];
    const code = originalError?.code;
    if (typeof code === 'string' && /^(?:[0-9]{2}[0-9A-Z]{3}|(?:F0|HV|P0|XX)[0-9A-Z]{3}|PGRST(?:\d{3}|X00))$/.test(code)) {
      diagnostics.push(`code=${code}`);
    }
    const status = originalError?.status;
    if (Number.isInteger(status) && (status === 0 || (status >= 400 && status <= 599))) {
      diagnostics.push(`status=${status}`);
    }
    if (!code && /^(?:TypeError:\s*)?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?)$/i.test(String(originalError?.message || ''))) {
      diagnostics.push('kind=network');
    } else if (originalError?.name === 'AbortError' || /^AbortError:/.test(String(originalError?.message || ''))) {
      diagnostics.push('kind=abort');
    }
    if (diagnostics.length) exception.message += ` [${diagnostics.join('; ')}]`;

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
