const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const shared = name => import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/bank-email', name)).href);
const hotel = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Hotel Demo' };
const encryptionKey = 'outlook-test-encryption-key-at-least-32-characters';
const sender = 'alertasynotificaciones@ayn.notificacionesbancolombia.com';

function environment(t, overrides = {}) {
  const previous = globalThis.Deno;
  const values = { BANK_EMAIL_INTEGRATION_ENABLED: 'true', BANK_TOKEN_ENCRYPTION_KEY: encryptionKey,
    OUTLOOK_CLIENT_ID: 'demo-client', OUTLOOK_CLIENT_SECRET: 'private-test-secret',
    SUPABASE_URL: 'https://example.supabase.co', ...overrides };
  globalThis.Deno = { env: { get: name => values[name] } };
  t.after(() => { if (previous === undefined) delete globalThis.Deno; else globalThis.Deno = previous; });
}

function bankMessage(id = 'immutable-bank-id', key = '@hotelok') {
  return { id, subject: 'Alertas y Notificaciones', receivedDateTime: '2026-10-14T20:04:53Z',
    from: { emailAddress: { address: sender } },
    body: { contentType: 'text', content: 'Bancolombia: HOTEL DEMO, recibiste un pago de PERSONA DEMO por $63,000.00 en tu cuenta *1234 conectado a la llave ' + key + ' el 14/10/2026 a las 15:04.' },
    internetMessageHeaders: [
      { name: 'Received', value: 'from inbound by CO1PR01MB.prod.outlook.com with HTTPS;' },
      { name: 'Return-Path', value: '<bounce@ayn.notificacionesbancolombia.com>' },
      { name: 'Authentication-Results', value: 'spf=pass smtp.mailfrom=ayn.notificacionesbancolombia.com; dkim=pass header.d=ayn.notificacionesbancolombia.com; dmarc=pass header.from=ayn.notificacionesbancolombia.com; compauth=pass reason=100' }
    ] };
}

async function connection() {
  const { encryptToken } = await shared('token-crypto.ts');
  return { id: '22222222-2222-4222-8222-222222222222', hotel_id: hotel.id, provider: 'microsoft',
    bank_key: '@hotelok', connected_email: 'hotel@example.test', gmail_label_name: 'Bandeja de entrada',
    outlook_delta_link: null, sync_lock_token: null, sync_locked_until: null,
    created_at: '2026-10-14T20:00:00Z', token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    access_token_encrypted: await encryptToken('test-access', encryptionKey),
    refresh_token_encrypted: await encryptToken('test-refresh', encryptionKey) };
}

function database(integration, { failFirstMatch = false } = {}) {
  const events = [], audits = [], matchCalls = [], cursorWrites = [];
  const client = { events, audits, matchCalls, cursorWrites,
    from(table) {
      assert.ok(['bank_email_integrations', 'expected_payments', 'bank_payment_events', 'bank_payment_audit_log'].includes(table), table);
      const filters = [];
      let operation = 'read', value;
      const execute = () => {
        if (table === 'bank_payment_audit_log' && operation === 'insert') {
          audits.push(value); operation = 'read'; return [];
        }
        if (table === 'bank_payment_events' && operation === 'insert') {
          assert.equal(value.hotel_id, hotel.id);
          assert.equal(value.integration_id, integration.id);
          assert.equal(value.provider, 'outlook');
          events.push({ id: 'event-' + (events.length + 1), ...value }); operation = 'read';
          return [events.at(-1)];
        }
        const rows = table === 'bank_email_integrations' ? [integration] : table === 'bank_payment_events' ? events : [];
        const selected = rows.filter(row => filters.every(([column, expected]) => row[column] === expected));
        if (operation === 'update') {
          for (const row of selected) Object.assign(row, value);
          if (selected.length && value.outlook_delta_link) cursorWrites.push(value.outlook_delta_link);
          operation = 'read';
        }
        return selected;
      };
      const builder = { select() { return this; }, eq(column, expected) { filters.push([column, expected]); return this; },
        in() { return this; }, gte() { return this; }, lte() { return this; }, limit() { return this; },
        insert(payload) { operation = 'insert'; value = payload; return this; },
        update(patch) { operation = 'update'; value = patch; return this; },
        single() { return Promise.resolve({ data: execute()[0] || null, error: null }); },
        maybeSingle() { return this.single(); },
        then(onFulfilled, onRejected) { return Promise.resolve({ data: execute(), error: null }).then(onFulfilled, onRejected); } };
      return builder;
    },
    async rpc(name, args) {
      if (name === 'claim_bank_outlook_sync') {
        assert.equal(args.p_hotel_id, hotel.id); assert.equal(args.p_integration_id, integration.id);
        if (integration.sync_lock_token) return { data: null, error: null };
        integration.sync_lock_token = 'test-lock'; return { data: 'test-lock', error: null };
      }
      assert.equal(name, 'match_bank_payment_event'); assert.equal(args.p_pilot_hotel_name, hotel.id);
      matchCalls.push(args.p_payment_event_id);
      if (failFirstMatch && matchCalls.length === 1) return { data: null, error: { code: 'temporary_failure' } };
      const event = events.find(row => row.id === args.p_payment_event_id);
      assert.ok(event); event.metadata.matching_completed = true;
      return { data: { status: 'detected' }, error: null };
    }
  };
  return client;
}

function mockGraph(t, integration, messages, { partial = false, failDetail = false } = {}) {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://graph.microsoft.com');
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    assert.equal(options.redirect, 'error');
    assert.match(options.headers.Prefer, /IdType="ImmutableId"/);
    requests.push(parsed);
    if (parsed.pathname === '/v1.0/me/') return Response.json({ mail: integration.connected_email });
    if (parsed.pathname.includes('/messages/delta')) return Response.json({
      value: partial ? messages.map(message => ({ id: message.id, from: message.from })) : messages,
      '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=next'
    });
    const id = decodeURIComponent(parsed.pathname.split('/').at(-1));
    if (failDetail) return Response.json({ error: { code: 'ErrorItemNotFound' } }, { status: 404 });
    assert.ok(messages.some(message => message.id === id));
    return Response.json(messages.find(message => message.id === id));
  });
  return requests;
}

test('Outlook configura OAuth de solo lectura y el estado nunca contiene secretos', async t => {
  environment(t);
  const { getOutlookSetupStatus, buildOutlookAuthorizationUrl } = await shared('outlook-service.ts');
  const status = getOutlookSetupStatus();
  assert.deepEqual(status, { configured: true, redirectUri: 'https://example.supabase.co/functions/v1/calendar-oauth-callback' });
  assert.ok(!JSON.stringify(status).includes('private-test-secret'));
  const url = new URL(buildOutlookAuthorizationUrl('bank-outlook.test-state'));
  assert.equal(url.hostname, 'login.microsoftonline.com');
  const scopes = url.searchParams.get('scope').split(' ');
  assert.ok(scopes.includes('Mail.Read') && scopes.includes('offline_access'));
  assert.ok(!scopes.some(scope => /Write|Send|Calendars/.test(scope)));
});

test('Outlook informa que falta configuracion sin emitir una URL de conexion incompleta', async t => {
  environment(t, { OUTLOOK_CLIENT_SECRET: '' });
  const { getOutlookSetupStatus, buildOutlookAuthorizationUrl } = await shared('outlook-service.ts');
  assert.equal(getOutlookSetupStatus().configured, false);
  assert.throws(() => buildOutlookAuthorizationUrl('state'), error => error.code === 'outlook_oauth_not_configured');
});

test('Probar Outlook valida cuenta y permiso real de lectura de Bandeja de entrada', async t => {
  environment(t);
  const { testOutlookInbox } = await shared('outlook-service.ts');
  let allowInbox = false, inboxCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/me/?')) return Response.json({ mail: 'hotel@example.test' });
    assert.match(url, /\/mailFolders\/inbox\/messages\?/); inboxCalls += 1;
    return Response.json(allowInbox ? { value: [] } : { error: { code: 'ErrorAccessDenied' } }, { status: allowInbox ? 200 : 403 });
  });
  await assert.rejects(testOutlookInbox('access', 'other@example.test'), error => error.code === 'outlook_account_mismatch');
  assert.equal(inboxCalls, 0);
  await assert.rejects(testOutlookInbox('access', 'hotel@example.test'), error => error.code === 'outlook_graph_failed');
  allowInbox = true;
  assert.deepEqual(await testOutlookInbox('access', 'hotel@example.test'), { email: 'hotel@example.test' });
});

test('Outlook completa los cambios parciales, filtra la llave y guarda el aviso una sola vez', async t => {
  environment(t);
  const { syncOutlookPayments } = await shared('outlook-service.ts');
  const integration = await connection(), admin = database(integration);
  const message = bankMessage('immutable+/bank=id');
  const requests = mockGraph(t, integration, [message, bankMessage('other-hotel', '@other-hotel')], { partial: true });
  const first = await syncOutlookPayments(admin, hotel, integration);
  assert.equal(first.processed, 1); assert.equal(admin.events.length, 1);
  assert.equal(admin.events[0].gmail_message_id, 'outlook:immutable+/bank=id');
  assert.equal(admin.events[0].amount_cop, 63000); assert.equal(admin.events[0].status, 'detected');
  assert.equal(admin.events[0].transaction_occurred_at, '2026-10-14T20:04:00.000Z');
  assert.equal(admin.matchCalls.length, 1);
  assert.ok(requests.some(url => url.pathname.includes('immutable%2B%2Fbank%3Did')));
  assert.equal(integration.watch_status, 'active'); assert.equal(integration.sync_lock_token, null);
  await syncOutlookPayments(admin, hotel, integration);
  assert.equal(admin.events.length, 1); assert.equal(admin.matchCalls.length, 1);
});

test('Outlook reintenta una relacion interrumpida sin duplicar el pago ni avanzar el cursor antes de tiempo', async t => {
  environment(t);
  const { syncOutlookPayments } = await shared('outlook-service.ts');
  const integration = await connection(), admin = database(integration, { failFirstMatch: true });
  mockGraph(t, integration, [bankMessage()]);
  await assert.rejects(syncOutlookPayments(admin, hotel, integration), error => error.code === 'payment_match_failed');
  assert.equal(admin.events.length, 1); assert.equal(admin.cursorWrites.length, 0);
  assert.equal(integration.sync_lock_token, null);
  await syncOutlookPayments(admin, hotel, integration);
  assert.equal(admin.events.length, 1); assert.equal(admin.matchCalls.length, 2);
  assert.equal(admin.events[0].metadata.matching_completed, true);
  assert.equal(admin.cursorWrites.length, 1);
});

test('Outlook conserva la autenticacion bancaria y rechaza SPF fallido en el flujo real', async t => {
  environment(t);
  const { syncOutlookPayments } = await shared('outlook-service.ts');
  const integration = await connection(), admin = database(integration);
  const message = bankMessage();
  message.internetMessageHeaders[2].value = 'spf=fail smtp.mailfrom=evil.example; dkim=fail header.d=evil.example; dmarc=fail header.from=evil.example; compauth=fail';
  mockGraph(t, integration, [message]);
  await syncOutlookPayments(admin, hotel, integration);
  assert.equal(admin.events.length, 1); assert.notEqual(admin.events[0].status, 'detected');
  assert.equal(admin.matchCalls.length, 0);
});

test('Outlook registra un correo eliminado durante la sincronizacion y continua; otro hotel queda aislado', async t => {
  environment(t);
  const { syncOutlookPayments } = await shared('outlook-service.ts');
  const integration = await connection(), admin = database(integration);
  const requests = mockGraph(t, integration, [bankMessage()], { partial: true, failDetail: true });
  await assert.rejects(syncOutlookPayments(admin, { ...hotel, id: '33333333-3333-4333-8333-333333333333' }, integration), error => error.code === 'outlook_hotel_mismatch');
  assert.equal(requests.length, 0);
  const result = await syncOutlookPayments(admin, hotel, integration);
  assert.equal(result.processed, 0); assert.equal(admin.events.length, 0);
  assert.equal(admin.audits[0].details.error_code, 'outlook_message_unavailable');
  assert.equal(admin.cursorWrites.length, 1);
});
