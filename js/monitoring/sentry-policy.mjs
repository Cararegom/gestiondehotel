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

// Allow only diagnostics: no users, form values, headers, cookies, console
// breadcrumbs, request bodies, extra contexts or arbitrary application tags.
export function sanitizeSentryEvent(event) {
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
  clean.tags = { application: 'gestiondehotel' };
  return clean;
}

export function sentryEnvironment(hostname) {
  if (['gestiondehotel.com', 'www.gestiondehotel.com'].includes(hostname)) return 'prod';
  if (hostname === 'localhost' || hostname === '[::1]' || hostname === '::1' || /^127\./.test(hostname)) return 'development';
  return 'preview';
}
