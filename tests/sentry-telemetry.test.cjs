const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const importFile = (path) => import(`data:text/javascript;base64,${readFileSync(resolve(__dirname, '..', path)).toString('base64')}`);
let telemetry;
test.before(async () => { telemetry = await importFile('js/telemetry/sentry-client.js'); });
const defaults = {
  dsn: 'https://public@example.ingest.sentry.io/123',
  productionHosts: ['gestiondehotel.com', 'www.gestiondehotel.com'],
  tracesSampleRate: 0.1,
};

function setup({ hostname = 'gestiondehotel.com', override, initError = false } = {}) {
  const root = {
    location: { hostname, pathname: '/app/index.html', hash: '#/reservas?cliente=privado', href: `https://${hostname}/app/index.html#/reservas?cliente=privado` },
    __HOTEL_APP_CONFIG__: { sentry: override },
  };
  const calls = { errors: [], navigations: [], tags: [], ended: 0 };
  const active = { updateName: (name) => { calls.pageName = name; }, setAttribute() {} };
  const sdk = {
    ...Object.fromEntries(['inboundFiltersIntegration', 'browserApiErrorsIntegration', 'globalHandlersIntegration', 'linkedErrorsIntegration', 'dedupeIntegration'].map((name) => [name, () => ({ name })])),
    init(options) { calls.options = options; if (initError) throw new Error('SDK unavailable'); return {}; },
    breadcrumbsIntegration: (options) => ({ name: 'Breadcrumbs', options }),
    browserTracingIntegration: (options) => ({ name: 'BrowserTracing', options }),
    captureException(error, context) { calls.errors.push({ error, context }); return 'event-id'; },
    setTag: (key, value) => calls.tags.push([key, value]),
    getCurrentScope: () => ({ setTransactionName() {} }),
    getActiveSpan: () => active,
    spanToJSON: () => ({ op: 'pageload' }),
    startBrowserTracingNavigationSpan: (client, options) => calls.navigations.push(options),
    startInactiveSpan: () => ({ end: () => { calls.ended++; } }),
    startNewTrace: (callback) => callback(),
    startSpan: (options, callback) => { calls.testSpan = options; return callback(); },
    flush: async () => true,
  };
  const api = telemetry.installTelemetry(sdk, root, defaults, 'test-release');
  return { api, root, sdk, calls };
}

test('solo produccion se activa por defecto, con muestreo y una unica instalacion', () => {
  const { api, calls, sdk, root } = setup();
  assert.equal(api.getStatus().enabled, true);
  assert.equal(calls.options.environment, 'production');
  assert.equal(calls.options.tracesSampler({ name: '/reservas' }), 0.1);
  assert.equal(calls.options.tracesSampler({ name: 'sentry.connection_check' }), 1);
  assert.equal(calls.options.sendDefaultPii, false);
  assert.equal(calls.options.defaultIntegrations, false);
  assert.equal(calls.options.sendClientReports, false);
  assert.deepEqual(calls.options.tracePropagationTargets, []);
  assert.equal(telemetry.installTelemetry(sdk, root, defaults), api);
  assert.equal(setup({ hostname: 'localhost' }).api.getStatus().enabled, false);
  assert.equal(setup({ hostname: 'preview.vercel.app' }).api.getStatus().enabled, false);
  assert.equal(setup({ override: { enabled: false } }).calls.options, undefined);
  const disabled = setup({ hostname: 'localhost' });
  delete disabled.root.HotelTelemetry;
  assert.equal(telemetry.installTelemetry(disabled.sdk, disabled.root, { ...defaults, enabled: false }).getStatus().enabled, false);
  const staging = setup({ hostname: 'localhost', override: { enabled: true, environment: 'staging', tracesSampleRate: 1 } });
  assert.equal(staging.calls.options.environment, 'staging');
  assert.equal(staging.calls.options.tracesSampler({ name: '/reservas' }), 1);
});

test('errores y trazas conservan correlacion y eliminan datos sensibles', () => {
  const original = {
    event_id: 'abcdef1234567890abcdef1234567890',
    user: { email: 'guest@example.test', id: 'guest-id' },
    extra: { nombre: 'Nombre privado' },
    request: {
      url: 'https://gestiondehotel.com/password-reset.html?token=private#access_token=private',
      headers: { authorization: 'Bearer private' }, cookies: 'private', data: { password: 'private' },
    },
    contexts: { trace: { trace_id: 'abcdef1234567890abcdef1234567890', span_id: '1234567890123456' } },
    sdkProcessingMetadata: { dynamicSamplingContext: { sample_rand: '0.1234567890123456', sample_rate: '0.1' } },
    exception: { values: [{
      value: 'Fallo guest@example.test telefono 3001234567 password="private value"',
      stacktrace: { frames: [{ filename: 'https://gestiondehotel.com/js/main.js?token=private', vars: { password: 'private' } }] },
    }] },
    spans: [{ description: 'GET https://example.test/items?email=guest@example.test', data: {
      'url.full': 'https://example.test/items?token=private',
      'url.query': 'nombre=Nombre privado', 'url.fragment': 'secret',
      'http.request.header.authorization': 'Bearer private',
    } }],
  };
  const event = telemetry.sanitizeEvent(original);
  const serialized = JSON.stringify(event);
  for (const privateValue of ['guest@example.test', '3001234567', 'private', 'Nombre privado', '?token=', '?email=']) {
    assert.equal(serialized.includes(privateValue), false, privateValue);
  }
  assert.equal(event.event_id, original.event_id);
  assert.deepEqual(event.contexts.trace, original.contexts.trace);
  assert.deepEqual(event.sdkProcessingMetadata, original.sdkProcessingMetadata);
  assert.equal(event.request.url, 'https://gestiondehotel.com/password-reset.html');
  assert.equal(event.user, undefined);
  assert.equal(original.request.data.password, 'private', 'no mutar el evento original');
  assert.equal(telemetry.sanitizeBreadcrumb({ category: 'console', message: 'private' }), null);
  assert.equal(telemetry.sanitizeBreadcrumb({ category: 'ui.click', message: 'private' }), null);
  assert.equal(telemetry.sanitizeBreadcrumb({ category: 'navigation', data: { to: '/app/?token=private#access_token=private' } }).data.to, 'https://gestiondehotel.com/app/');
});

test('el router renombra pageload y abre una traza en las siguientes rutas', () => {
  const { api, calls } = setup();
  const firstEnd = api.startRoute('/reservas?cliente=privado');
  assert.equal(calls.pageName, '/reservas');
  assert.equal(calls.navigations.length, 0);
  firstEnd();
  const secondEnd = api.startRoute('/caja?token=private');
  assert.equal(calls.navigations[0].name, '/caja');
  secondEnd();
  assert.equal(calls.ended, 2);
  assert.deepEqual(calls.tags.at(-1), ['app.route', '/caja']);
});

test('un fallo de Sentry no impide iniciar ni terminar una operacion', async () => {
  const { api } = setup({ initError: true });
  assert.equal(api.getStatus().status, 'unavailable');
  assert.equal(api.captureException(new Error('error')), null);
  assert.doesNotThrow(api.startRoute('/caja'));
  assert.equal((await api.verifyConnection()).enabled, false);
  const ready = setup();
  ready.sdk.startInactiveSpan = () => { throw new Error('tracing failed'); };
  assert.doesNotThrow(ready.api.startRoute('/reservas'));
  ready.sdk.captureException = () => { throw new Error('capture failed'); };
  assert.equal(ready.api.captureException(new Error('test')), null);
});

test('los errores manuales se deduplican sin perder el Error original', () => {
  const { api, calls } = setup();
  const error = new Error('mount failed');
  assert.equal(api.captureException(error, { source: 'router' }), 'event-id');
  assert.equal(api.captureException(error, { source: 'router' }), null);
  assert.equal(calls.errors[0].error, error);
  assert.equal(calls.errors.length, 1);
});

test('el registro interno remite errores manejados aunque no haya sesion inicializada', async () => {
  const monitoring = await importFile('js/services/monitoringService.js');
  const previous = globalThis.HotelTelemetry;
  const errors = [];
  globalThis.HotelTelemetry = { captureException: (...args) => errors.push(args) };
  try {
    const error = new Error('mount failed');
    await monitoring.logMonitoringEvent({ level: 'error', source: 'router', eventType: 'module_mount_failed', message: 'Fallo', exception: error, details: { error: error.message } });
    await monitoring.logMonitoringEvent({ level: 'info', message: 'Informacion' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], error);
    assert.equal(errors[0][1].eventType, 'module_mount_failed');
  } finally {
    globalThis.HotelTelemetry = previous;
  }
});

test('SDK real: la verificacion envia error y transaccion con el mismo trace_id', async () => {
  const realSdk = require('@sentry/browser');
  const envelopes = [];
  let client;
  const sdk = { ...realSdk, init(options) {
    client = realSdk.init({ ...options, transport: () => ({
      send: async (envelope) => { envelopes.push(envelope); return { statusCode: 200 }; },
      flush: async () => true,
    }) });
    return client;
  } };
  const policy = await importFile('js/monitoring/sentry-policy.mjs');
  const api = telemetry.installTelemetry(sdk, { location: { hostname: 'gestiondehotel.com', pathname: '/', href: 'https://gestiondehotel.com/' } }, { ...defaults, productionEnvironment: 'prod', sanitizeErrorEvent: policy.sanitizeSentryEvent });
  try {
    const result = await api.verifyConnection();
    assert.equal(result.flushed, true);
    assert.equal(result.accepted, true);
    assert.equal(result.eventHttpStatus, 200);
    assert.equal(result.traceHttpStatus, 200);
    const items = envelopes.flatMap((envelope) => envelope[1]);
    const event = items.find(([header]) => header.type === 'event')?.[1];
    const transaction = items.find(([header]) => header.type === 'transaction')?.[1];
    assert.ok(event, 'se envio la excepcion');
    assert.ok(transaction, 'se envio la traza de verificacion');
    assert.equal(event.event_id, result.eventId);
    assert.equal(event.tags.test_event, 'true');
    assert.equal(transaction.transaction, 'sentry.connection_check');
    assert.equal(event.contexts.trace.trace_id, transaction.contexts.trace.trace_id);
  } finally {
    await client?.close(1000);
  }
});
