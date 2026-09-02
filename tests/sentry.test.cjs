const test = require('node:test');
const assert = require('node:assert/strict');

const policy = import('../js/monitoring/sentry-policy.mjs');

test('Sentry excluye datos de usuario, peticiones y contexto sensible del evento', async () => {
  const { sanitizeSentryEvent } = await policy;
  const event = sanitizeSentryEvent({
    event_id: '1234567890abcdef1234567890abcdef',
    environment: 'prod',
    user: { email: 'huesped@example.test' },
    extra: { password: 'private-password' },
    contexts: { session: { token: 'private-token' } },
    breadcrumbs: [{ message: 'private-console' }],
    request: { url: 'https://gestiondehotel.com/app/index.html?token=private-query#access_token=private-fragment', headers: { Authorization: 'Bearer private-header' }, data: 'private-body' },
    tags: { hotel_id: 'private-hotel' },
    exception: { values: [{ type: 'TypeError', value: 'Error de prueba', stacktrace: { frames: [{ filename: 'https://gestiondehotel.com/js/main.js?token=private-stack', function: 'router', lineno: 12, colno: 4, vars: { password: 'private-local' }, pre_context: ['private-source'] }] } }] },
  });
  assert.equal(event.request.url, 'https://gestiondehotel.com/app/index.html');
  assert.equal(event.exception.values[0].stacktrace.frames[0].lineno, 12);
  assert.equal(event.exception.values[0].stacktrace.frames[0].function, 'router');
  assert.doesNotMatch(JSON.stringify(event), /private-|huesped@example|Authorization|pre_context/);
  assert.equal(event.user, undefined);
  assert.equal(event.breadcrumbs, undefined);
});

test('Sentry redacta tokens, correos e identificadores dentro del mensaje', async () => {
  const { cleanText } = await policy;
  const clean = cleanText('Correo guest@example.test telefono 3001234567 Bearer secreto-token password=secreto-pass sntrys_ABCdef123 https://site.test/callback?token=secreto-query#secreto-fragment');
  assert.doesNotMatch(clean, /guest@|3001234567|secreto|sntrys_/);
  assert.match(clean, /https:\/\/site\.test\/callback/);
});

test('Sentry separa produccion, localhost y previews', async () => {
  const { sentryEnvironment } = await policy;
  assert.equal(sentryEnvironment('gestiondehotel.com'), 'prod');
  assert.equal(sentryEnvironment('www.gestiondehotel.com'), 'prod');
  assert.equal(sentryEnvironment('localhost'), 'development');
  assert.equal(sentryEnvironment('127.0.0.1'), 'development');
  assert.equal(sentryEnvironment('preview.vercel.app'), 'preview');
});
