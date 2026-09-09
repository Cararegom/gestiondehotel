const REDACTED = '[REDACTED]';

export function cleanUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '[non-http]';
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(value).split(/[?#]/, 1)[0];
  }
}

export function cleanText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"')]+/gi, cleanUrl)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:sntrys|sntryu)_[A-Za-z0-9_-]+\b/gi, REDACTED)
    .replace(/\bBearer\s+[^\s,;]+/gi, REDACTED)
    .replace(/\b(?:password|token|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, REDACTED)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, REDACTED)
    .replace(/\b\d{7,}\b/g, REDACTED)
    .slice(0, 1000);
}

function cleanFrames(frames) {
  if (!Array.isArray(frames)) return undefined;
  return frames.slice(-50).map((frame) => ({
    filename: frame.filename ? cleanText(cleanUrl(frame.filename)) : undefined,
    function: frame.function ? cleanText(frame.function) : undefined,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
  }));
}

function hasFrame(event, predicate) {
  return (event?.exception?.values || []).some((exception) =>
    (exception?.stacktrace?.frames || []).some(predicate)
  );
}

export function isBenignBrowserLifecycleError(event) {
  const messages = [
    event?.message,
    ...(event?.exception?.values || []).map((exception) => exception?.value),
  ].filter(Boolean).map((value) => String(value));

  const mediaRemoved = messages.some((message) =>
    /AbortError:\s*The play\(\) request was interrupted because the media was removed from the document/i.test(message)
  );
  if (mediaRemoved) return true;

  const alquilerModalRemoved = messages.some((message) =>
    /Cannot set properties of null \(setting ['"]innerHTML['"]\)/i.test(message)
  ) && hasFrame(event, (frame) =>
    frame?.function === 'recalcularYActualizarTotalAlquiler' &&
    /\/js\/modules\/mapa-habitaciones\/modales-alquiler\.js(?:$|[?#])/i.test(String(frame?.filename || ''))
  );

  return alquilerModalRemoved;
}

// Allow only diagnostics: no users, form values, headers, cookies, console
// breadcrumbs, request bodies, extra contexts or arbitrary application tags.
export function sanitizeSentryEvent(event) {
  // Chrome puede rechazar play() durante una navegacion si el elemento de audio
  // desaparece del DOM. Tambien puede terminar una recalculacion asincrona del modal
  // de alquiler despues de que el usuario ya lo cerro. Ambos son eventos de ciclo de
  // vida del navegador y no fallos funcionales que deban alertar en produccion.
  if (isBenignBrowserLifecycleError(event)) return null;

  const clean = {};
  for (const key of ['event_id', 'timestamp', 'platform', 'level', 'environment', 'release']) {
    if (event[key] !== undefined) clean[key] = event[key];
  }
  if (event.message) clean.message = cleanText(event.message);
  if (event.exception?.values) {
    clean.exception = { values: event.exception.values.slice(-5).map((exception) => ({
      type: cleanText(exception.type || 'Error'),
      value: cleanText(exception.value || ''),
      stacktrace: exception.stacktrace ? { frames: cleanFrames(exception.stacktrace.frames) } : undefined,
      mechanism: exception.mechanism ? {
        type: exception.mechanism.type,
        handled: exception.mechanism.handled,
      } : undefined,
    })) };
  }
  if (event.request?.url) clean.request = { url: cleanText(cleanUrl(event.request.url)) };
  // Solo los identificadores tecnicos necesarios para enlazar el error con su traza.
  if (event.contexts?.trace) {
    clean.contexts = { trace: {} };
    for (const key of ['trace_id', 'span_id', 'parent_span_id']) {
      const value = event.contexts.trace[key];
      if (typeof value === 'string' && /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/i.test(value)) clean.contexts.trace[key] = value;
    }
    for (const key of ['op', 'status']) {
      if (typeof event.contexts.trace[key] === 'string') clean.contexts.trace[key] = cleanText(event.contexts.trace[key]);
    }
  }
  clean.tags = { application: 'gestiondehotel' };
  for (const key of ['source', 'event_type', 'app.route', 'test_event']) {
    if (event.tags?.[key] !== undefined) clean.tags[key] = cleanText(event.tags[key]);
  }
  return clean;
}

export function sentryEnvironment(hostname) {
  if (['gestiondehotel.com', 'www.gestiondehotel.com'].includes(hostname)) return 'prod';
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)) return 'development';
  return 'preview';
}
