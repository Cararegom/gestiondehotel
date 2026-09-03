const REDACTED = '[Filtered]';
const SENSITIVE_KEY = /password|passwd|contrase|token|secret|authorization|api.?key|cookie|email|correo|phone|telefono|documento|cedula|huesped|guest|cliente|customer|direccion|address|tarjeta|credit.?card|request.?body|response.?body|payload|url\.(query|fragment)|query_string/i;
const VERIFY_SPAN = 'sentry.connection_check';

export function cleanUrl(value) {
  try {
    const url = new URL(value, 'https://gestiondehotel.com');
    if (!['http:', 'https:'].includes(url.protocol)) return REDACTED;
    const path = url.pathname
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':id')
      .replace(/\/\d{6,}(?=\/|$)/g, '/:id')
      .replace(/[^/]*(?:@|%40)[^/]*/gi, ':email');
    return `${url.origin}${path}`;
  } catch {
    return REDACTED;
  }
}

export function cleanText(value) {
  return String(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, cleanUrl)
    .replace(/\b(?:sntrys|sntryu)_[A-Za-z0-9_-]+\b/gi, REDACTED)
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27}\b/gi, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED)
    .replace(/\b(Bearer|Basic)\s+\S+/gi, `$1 ${REDACTED}`)
    .replace(/\b(password|passwd|token|secret|api_?key|authorization)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, `$1=${REDACTED}`)
    .replace(/\b\d{7,16}\b/g, REDACTED);
}

function scrub(value, seen = new WeakSet(), depth = 0) {
  if (typeof value === 'string') return cleanText(value);
  if (value == null || typeof value !== 'object') return value;
  if (depth > 12 || seen.has(value)) return REDACTED;
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const [key, nested] of Object.entries(value)) {
    const protocolId = /^(event_id|trace_id|span_id|parent_span_id)$/.test(key)
      && typeof nested === 'string' && /^(?:[a-f0-9]{16}|[a-f0-9]{32})$/i.test(nested);
    const samplingValue = /^(sample_rand|sample_rate)$/.test(key)
      && typeof nested === 'string' && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(nested);
    result[key] = protocolId || samplingValue ? nested
      : SENSITIVE_KEY.test(key) ? REDACTED : scrub(nested, seen, depth + 1);
  }
  seen.delete(value);
  return result;
}

export function sanitizeEvent(event) {
  const result = scrub(event);
  // No enviar perfiles, formularios, cabeceras, cookies ni variables locales.
  delete result.user;
  delete result.extra;
  delete result.breadcrumbs;
  if (result.contexts) result.contexts = result.contexts.trace ? { trace: result.contexts.trace } : {};
  if (result.request) {
    result.request = {
      ...(event.request.url ? { url: cleanUrl(event.request.url) } : {}),
      ...(event.request.method ? { method: event.request.method } : {}),
    };
  }
  for (const exception of result.exception?.values || []) {
    for (const frame of exception.stacktrace?.frames || []) delete frame.vars;
  }
  return result;
}

export function sanitizeBreadcrumb(breadcrumb) {
  // DOM y consola pueden contener nombres, valores de formularios y datos de negocio.
  if (/^(console|ui\.)/.test(breadcrumb.category || '')) return null;
  const result = scrub(breadcrumb);
  for (const key of ['url', 'from', 'to']) {
    if (result.data?.[key]) result.data[key] = cleanUrl(breadcrumb.data[key]);
  }
  return result;
}

function routeName(value) {
  const path = String(value || '/').replace(/^#/, '').split(/[?#]/)[0];
  // Las rutas de la aplicacion son estaticas. No incluir IDs ni parametros libres.
  return /^\/[a-z-]+$/.test(path) ? path : '/';
}

export function installTelemetry(sdk, root, defaults, buildRelease) {
  if (root.HotelTelemetry) return root.HotelTelemetry;
  const override = root.__HOTEL_APP_CONFIG__?.sentry || {};
  const isProduction = defaults.productionHosts.includes(root.location?.hostname);
  const enabled = defaults.enabled !== false && (override.enabled ?? isProduction);
  const rate = Number(override.tracesSampleRate ?? defaults.tracesSampleRate);
  const sampleRate = Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : 0.1;
  const environment = override.environment || (isProduction ? (defaults.productionEnvironment || 'production') : 'development');
  let client = null;
  let status = enabled ? 'initializing' : 'disabled';
  let firstRoute = true;
  const recentErrors = new Map();
  const verificationDeliveries = new Map();
  let lastTrace = null;
  const safely = (callback, fallback = null) => {
    try { return callback(); } catch { return fallback; }
  };

  function captureException(error, { source = 'app', eventType = 'handled_error' } = {}) {
    if (!client) return null;
    return safely(() => {
      const exception = error instanceof Error ? error : new Error(cleanText(error?.message || error || 'Error desconocido'));
      const key = `${source}|${eventType}|${cleanText(exception.message)}`;
      const now = Date.now();
      for (const [entry, time] of recentErrors) if (now - time > 30000) recentErrors.delete(entry);
      if (recentErrors.has(key)) return null;
      if (recentErrors.size >= 100) recentErrors.delete(recentErrors.keys().next().value);
      recentErrors.set(key, now);
      return sdk.captureException(exception, {
        tags: { source: cleanText(source), event_type: cleanText(eventType) },
      });
    });
  }

  function startRoute(path) {
    if (!client) return () => {};
    return safely(() => {
      const name = routeName(path);
      sdk.setTag('app.route', name);
      sdk.getCurrentScope().setTransactionName(name);
      const pageLoadSpan = firstRoute && sdk.getActiveSpan();
      firstRoute = false;
      if (pageLoadSpan && sdk.spanToJSON(pageLoadSpan).op === 'pageload') {
        pageLoadSpan.updateName(name);
        pageLoadSpan.setAttribute('sentry.source', 'route');
      } else {
        sdk.startBrowserTracingNavigationSpan(client, {
          name, op: 'navigation', attributes: { 'sentry.source': 'route' },
        });
      }
      const span = sdk.startInactiveSpan({ name, op: 'ui.route.mount' });
      return () => safely(() => span.end());
    }, () => {});
  }

  async function verifyConnection() {
    if (!client) return { enabled: false, status };
    try {
      const { eventId, traceId } = sdk.startNewTrace(() => sdk.startSpan({
        name: VERIFY_SPAN, op: 'test', forceTransaction: true,
      }, (span) => ({
        traceId: span.spanContext().traceId,
        eventId: sdk.captureException(new Error('Gestiondehotel: verificacion manual de conexion Sentry'), {
          tags: { source: 'manual_verification', test_event: 'true' },
        }),
      })));
      const flushed = await sdk.flush(5000);
      const eventHttpStatus = verificationDeliveries.get(eventId) ?? null;
      const traceHttpStatus = verificationDeliveries.get(traceId) ?? null;
      const accepted = [eventHttpStatus, traceHttpStatus].every((code) => code >= 200 && code < 300);
      return { enabled: true, eventId, traceId, flushed, accepted, eventHttpStatus, traceHttpStatus, environment };
    } catch {
      return { enabled: true, flushed: false, environment };
    }
  }

  const api = Object.freeze({
    captureException, startRoute, verifyConnection,
    getStatus: () => ({ enabled: !!client, status, environment, tracesSampleRate: sampleRate, lastTrace }),
  });
  root.HotelTelemetry = api;
  if (!enabled) return api;

  try {
    client = sdk.init({
      dsn: override.dsn || defaults.dsn,
      environment,
      release: override.release || buildRelease,
      sendDefaultPii: false,
      sendClientReports: false,
      defaultIntegrations: false,
      autoSessionTracking: false,
      enableLogs: false,
      maxBreadcrumbs: 0,
      tracePropagationTargets: [],
      integrations: [
        sdk.inboundFiltersIntegration(), sdk.browserApiErrorsIntegration(),
        sdk.globalHandlersIntegration(), sdk.linkedErrorsIntegration(), sdk.dedupeIntegration(),
        sdk.breadcrumbsIntegration({ console: false, dom: false }),
        sdk.browserTracingIntegration({
          instrumentNavigation: false,
          enableInp: false,
          beforeStartSpan: (options) => ({
            ...options,
            name: options.op === 'navigation' ? routeName(options.name)
              : root.location?.pathname?.startsWith('/app')
                ? routeName(root.location.hash)
                : cleanUrl(root.location?.href || '/'),
          }),
        }),
      ],
      tracesSampler: (context) => context.name === VERIFY_SPAN ? 1 : sampleRate,
      beforeBreadcrumb: sanitizeBreadcrumb,
      beforeSend: (event) => defaults.sanitizeErrorEvent
        ? defaults.sanitizeErrorEvent(sanitizeEvent(event)) : sanitizeEvent(event),
      beforeSendTransaction: sanitizeEvent,
      beforeSendSpan: (span) => scrub(span),
    });
    client?.on?.('afterSendEvent', (event, response) => {
      const httpStatus = response?.statusCode ?? null;
      if (event.type === 'transaction') lastTrace = { name: event.transaction, httpStatus };
      if (event.tags?.test_event === 'true' || event.transaction === VERIFY_SPAN) {
        if (verificationDeliveries.size >= 20) verificationDeliveries.delete(verificationDeliveries.keys().next().value);
        verificationDeliveries.set(event.type === 'transaction' ? event.contexts?.trace?.trace_id : event.event_id, httpStatus);
      }
    });
    status = client ? 'ready' : 'unavailable';
  } catch {
    client = null;
    status = 'unavailable';
  }
  return api;
}
