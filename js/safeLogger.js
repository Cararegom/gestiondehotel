(function installSafeLogger(globalObject) {
  if (globalObject.safeLogger) return;
  const REDACTED = '[REDACTED]';
  const sensitiveKey = /(^|_)(access|refresh)?_?token$|authorization|password|secret|session|supabase|credential|api_?key|email|documento|cedula|telefono/i;
  const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const uuidPattern = /\b([0-9a-f]{8})-[0-9a-f-]{27}\b/gi;

  function sanitizeString(value) {
    return String(value).replace(jwtPattern, REDACTED).replace(emailPattern, REDACTED).replace(uuidPattern, '$1-...');
  }

  function sanitize(value, seen = new WeakSet(), depth = 0) {
    if (typeof value === 'string') return sanitizeString(value);
    if (value == null || typeof value !== 'object') return value;
    if (depth > 5 || seen.has(value)) return '[REDACTED_OBJECT]';
    seen.add(value);
    if (value instanceof Error) return { name: value.name, message: sanitizeString(value.message), code: value.code || undefined };
    if (Array.isArray(value)) return value.map((item) => sanitize(item, seen, depth + 1));
    const result = {};
    Object.entries(value).forEach(([key, item]) => {
      result[key] = sensitiveKey.test(key) ? REDACTED : sanitize(item, seen, depth + 1);
    });
    return result;
  }

  const original = {};
  ['debug', 'log', 'info', 'warn', 'error'].forEach((level) => {
    original[level] = globalObject.console?.[level]?.bind(globalObject.console) || (() => {});
  });
  const logger = {};
  Object.keys(original).forEach((level) => {
    logger[level] = (...args) => original[level](...args.map((arg) => sanitize(arg)));
    if (globalObject.console) globalObject.console[level] = logger[level];
  });
  logger.sanitize = sanitize;
  globalObject.safeLogger = Object.freeze(logger);
})(globalThis);
