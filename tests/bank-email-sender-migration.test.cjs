const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const shared = name => import(pathToFileURL(resolve(__dirname, '../supabase/functions/_shared/bank-email', name)).href);
const hotel = { id: '11111111-1111-4111-8111-111111111111', nombre: 'Hotel Demo' };
const oldDomain = 'an.notificacionesbancolombia.com';
const newDomain = 'ayn.notificacionesbancolombia.com';
const settings = { enabled: true, pilotHotelId: hotel.id, pilotHotelName: hotel.nombre,
  minAmountCop: 1, maxAmountCop: 100_000_000, matchWindowMinutes: 30, gmailPaymentLabel: 'PAGOS' };

function environment(t, overrides = {}) {
  const previous = globalThis.Deno;
  const values = { BANK_EMAIL_INTEGRATION_ENABLED: 'true', BANK_TOKEN_ENCRYPTION_KEY: 'test-encryption-secret-with-at-least-32-characters', ...overrides };
  globalThis.Deno = { env: { get: name => values[name] } };
  t.after(() => { if (previous === undefined) delete globalThis.Deno; else globalThis.Deno = previous; });
}

function message(id = '1111111111111111', { domain = newDomain, key = '@hotelok', spf = 'pass' } = {}) {
  const html = '<html><body><p>Bancolombia: HOTEL DEMO, recibiste un pago de PERSONA DEMO por $40,000.00 en tu cuenta *1234 conectado a la llave ' + key + ' el 13/10/2026 a las 16:08.</p></body></html>';
  return { id, threadId: id, labelIds: ['INBOX'], internalDate: String(Date.parse('2026-10-13T21:08:34Z')),
    payload: { mimeType: 'text/html', headers: [
      { name: 'Subject', value: 'Alertas y Notificaciones' },
      { name: 'From', value: 'alertasynotificaciones@' + domain },
      { name: 'Return-Path', value: '<bounce@' + domain + '>' },
      { name: 'Received', value: 'from mail.' + domain + ' by mx.google.com with ESMTPS;' },
      { name: 'Authentication-Results', value: 'mx.google.com; spf=' + spf + ' smtp.mailfrom=bounce@' + domain + '; dkim=pass header.i=@' + domain + '; dmarc=pass header.from=' + domain }
    ], body: { data: Buffer.from(html, 'utf8').toString('base64url') } } };
}

test('ambos remitentes oficiales aceptan HTML autenticado; fallos SPF y dominios parecidos no acreditan pagos', async t => {
  environment(t);
  const { parseGmailMessage } = await shared('gmail-message.ts');
  const { parseBankEmail } = await shared('bankParsers/index.ts');
  const { parseConfiguredRules, isConfiguredBankSender } = await shared('payment-service.ts');
  for (const domain of [oldDomain, newDomain]) {
    const email = parseGmailMessage(message('1111111111111111', { domain }));
    assert.equal(isConfiguredBankSender(email), true);
    const parsed = parseBankEmail(email, settings, parseConfiguredRules());
    assert.equal(parsed.disposition, 'detected');
    assert.equal(parsed.amountCop, 40_000);
    assert.equal(parsed.senderName, 'PERSONA DEMO');
    assert.equal(parsed.transactionOccurredAt, '2026-10-13T21:08:00.000Z');
  }
  const spoofed = parseGmailMessage(message('1111111111111111', { domain: newDomain + '.evil.example' }));
  assert.equal(isConfiguredBankSender(spoofed), false);
  const failed = parseGmailMessage(message('1111111111111111', { spf: 'fail' }));
  assert.notEqual(parseBankEmail(failed, settings, parseConfiguredRules()).disposition, 'detected');
});

test('migra reglas configuradas del remitente anterior conservando expresiones, limites y autenticacion', async t => {
  const custom = { id: 'bancolombia', bankName: 'Bancolombia', allowedFromAddresses: ['alertasynotificaciones@' + oldDomain],
    allowedFromDomains: [oldDomain], allowedReturnPathDomains: [oldDomain], allowedAuthenticationDomains: [oldDomain],
    requireSpf: true, requireDkim: true, requireDmarc: true, successExpressions: ['custom-success'], parserVersion: 'custom-7' };
  const other = { id: 'other-bank', bankName: 'Other', allowedFromDomains: [oldDomain] };
  environment(t, { BANK_EMAIL_RULES_JSON: JSON.stringify([custom, other]) });
  const { parseConfiguredRules, isConfiguredBankSender } = await shared('payment-service.ts');
  const { parseGmailMessage } = await shared('gmail-message.ts');
  const rules = parseConfiguredRules();
  for (const field of ['allowedFromDomains', 'allowedReturnPathDomains', 'allowedAuthenticationDomains']) {
    assert.deepEqual(rules[0][field], [oldDomain, newDomain]);
  }
  assert.equal(isConfiguredBankSender(parseGmailMessage(message())), true);
  assert.deepEqual(rules[0].successExpressions, custom.successExpressions);
  assert.equal(rules[0].parserVersion, 'custom-7');
  assert.equal(rules[0].requireSpf && rules[0].requireDkim && rules[0].requireDmarc, true);
  assert.deepEqual(rules[1], other);
});

function adminClient(integration) {
  const events = [], audits = [], matches = [];
  return { events, audits, matches,
    from(table) {
      assert.ok(['bank_email_integrations', 'bank_payment_events', 'expected_payments', 'bank_payment_audit_log'].includes(table), table);
      const filters = [];
      let inserted;
      const rows = () => {
        if (table === 'bank_payment_audit_log' && inserted) { audits.push(inserted); inserted = null; return []; }
        if (table === 'bank_payment_events' && inserted) {
          assert.equal(inserted.hotel_id, hotel.id);
          events.push({ id: 'event-' + (events.length + 1), ...inserted }); inserted = null;
          return [events.at(-1)];
        }
        const data = table === 'bank_email_integrations' ? [integration] : table === 'bank_payment_events' ? events : [];
        return data.filter(row => filters.every(([column, value]) => row[column] === value));
      };
      const builder = {
        select() { return this; }, eq(column, value) { filters.push([column, value]); return this; },
        in() { return this; }, gte() { return this; }, lte() { return this; }, limit() { return this; },
        insert(value) { inserted = value; return this; },
        update() { assert.fail('La recuperacion no debe modificar el cursor ni la cola'); },
        maybeSingle() { return Promise.resolve({ data: rows()[0] || null, error: null }); },
        single() { return this.maybeSingle(); },
        then(resolveResult, reject) { return Promise.resolve({ data: rows(), error: null }).then(resolveResult, reject); }
      };
      return builder;
    },
    async rpc(name, args) {
      assert.equal(name, 'match_bank_payment_event');
      assert.equal(args.p_pilot_hotel_name, hotel.id);
      const event = events.find(row => row.id === args.p_payment_event_id);
      assert.ok(event);
      event.metadata.matching_completed = true;
      matches.push(event.id);
      return { data: { status: 'detected' }, error: null };
    }
  };
}

async function integration() {
  const { encryptToken } = await shared('token-crypto.ts');
  const secret = globalThis.Deno.env.get('BANK_TOKEN_ENCRYPTION_KEY');
  return { id: '22222222-2222-4222-8222-222222222222', hotel_id: hotel.id, provider: 'google', bank_key: '@hotelok',
    connected_email: 'hotel@example.test', gmail_label_name: 'PAGOS', gmail_history_id: '999999',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    access_token_encrypted: await encryptToken('test-access', secret), refresh_token_encrypted: await encryptToken('test-refresh', secret) };
}

test('la recuperacion usa la cuenta y llave del hotel, guarda una vez y no retrocede el cursor', async t => {
  environment(t);
  const { replayGmailMessages, parseGmailReplayRequest } = await shared('gmail-replay.ts');
  const connection = await integration();
  const admin = adminClient(connection);
  const ids = ['1111111111111111', '2222222222222222', '3333333333333333'];
  const fetched = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-access');
    if (url.endsWith('/profile')) return Response.json({ emailAddress: connection.connected_email });
    const id = /\/messages\/([a-f0-9]+)\?format=full$/.exec(url)?.[1];
    assert.ok(id); fetched.push(id);
    return Response.json(message(id, id === ids[1] ? { key: '@other-hotel' } : id === ids[2] ? { domain: newDomain + '.evil.example' } : {}));
  });
  const request = parseGmailReplayRequest({ action: 'replay-messages', hotelId: hotel.id, messageIds: [...ids, ids[0]] });
  assert.deepEqual(request.messageIds, ids);
  const first = await replayGmailMessages(admin, hotel, request.messageIds);
  assert.deepEqual(first, { saved: 1, duplicates: 0, ignored: 2, unavailable: 0, parseErrors: 0 });
  assert.equal(admin.events.length, 1);
  assert.equal(admin.events[0].integration_id, connection.id);
  assert.equal(admin.events[0].status, 'detected');
  assert.equal(admin.events[0].amount_cop, 40000);
  assert.equal(admin.matches.length, 1);
  const again = await replayGmailMessages(admin, hotel, [ids[0]]);
  assert.equal(again.saved, 0);
  assert.equal(again.duplicates, 1);
  assert.equal(admin.events.length, 1);
  assert.equal(admin.matches.length, 1);
  assert.equal(connection.gmail_history_id, '999999');
  assert.deepEqual(fetched, [...ids, ids[0]]);
});

test('la recuperacion rechaza solicitudes excesivas y una cuenta Gmail diferente antes de leer mensajes', async t => {
  environment(t);
  const { replayGmailMessages, parseGmailReplayRequest } = await shared('gmail-replay.ts');
  for (const body of [null, {}, { action: 'replay-messages', hotelId: hotel.id, messageIds: [] },
    { action: 'replay-messages', hotelId: hotel.id, messageIds: Array(51).fill('1111111111111111') },
    { action: 'replay-messages', hotelId: hotel.id, messageIds: ['../other-user'] }]) {
    assert.throws(() => parseGmailReplayRequest(body), error => error.code === 'invalid_replay_request');
  }
  const admin = adminClient(await integration());
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls += 1; assert.ok(url.endsWith('/profile'));
    return Response.json({ emailAddress: 'other@example.test' });
  });
  await assert.rejects(replayGmailMessages(admin, hotel, ['1111111111111111']), error => error.code === 'gmail_account_mismatch');
  assert.equal(calls, 1);
  assert.equal(admin.events.length, 0);
});
