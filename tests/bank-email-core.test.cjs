const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

const corePromise = import(pathToFileURL(resolve(
  __dirname,
  '../supabase/functions/_shared/bank-email/index.ts'
)).href);
const paymentServicePromise = import(pathToFileURL(resolve(
  __dirname,
  '../supabase/functions/_shared/bank-email/payment-service.ts'
)).href);

function base64Url(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function gmailResource({
  id = 'gmail-message-1',
  subject = 'Transferencia recibida exitosamente',
  body = 'Bancolombia. Recibiste una transferencia por llave de $80.000. Referencia 123456.',
  from = 'Banco Demo <notificaciones@alerts.bank.example>',
  returnPath = '<notificaciones@alerts.bank.example>',
  authenticationResults = 'mx.google.com; spf=pass smtp.mailfrom=alerts.bank.example; dkim=pass header.d=alerts.bank.example; dmarc=pass header.from=alerts.bank.example',
  internalDate = String(Date.parse('2026-08-03T19:18:00-05:00')),
} = {}) {
  return {
    id,
    threadId: 'thread-1',
    historyId: '9001',
    internalDate,
    labelIds: ['Label_payments'],
    payload: {
      mimeType: 'multipart/alternative',
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: from },
        { name: 'Return-Path', value: returnPath },
        { name: 'Authentication-Results', value: authenticationResults },
      ],
      parts: [
        { mimeType: 'text/plain', filename: '', body: { data: base64Url(body) } },
      ],
    },
  };
}

function pilotHotelClient(rows, error = null) {
  return {
    from(table) {
      assert.equal(table, 'hoteles');
      return {
        select(columns) {
          assert.equal(columns, 'id,nombre');
          return {
            ilike(column, pattern) {
              assert.equal(column, 'nombre');
              assert.match(pattern, /Hotel Marena San Isidro/i);
              return Promise.resolve({ data: rows, error });
            },
          };
        },
      };
    },
  };
}

function config(core, overrides = {}) {
  return {
    enabled: true,
    pilotHotelName: 'Hotel Marena San Isidro',
    gmailPaymentLabel: 'PAGOS HOTEL MARENA',
    minAmountCop: 1,
    maxAmountCop: 100_000_000,
    matchWindowMinutes: 30,
    ...overrides,
  };
}

function bancolombiaRule() {
  return {
    id: 'bancolombia',
    bankName: 'Bancolombia',
    allowedFromDomains: ['bank.example'],
    allowedReturnPathDomains: ['bank.example'],
    expectedSubjectTerms: ['transferencia recibida'],
    expectedBodyTerms: ['por llave'],
    requireSpf: true,
    requireDkim: true,
    requireDmarc: true,
    parserVersion: 'test-1',
  };
}

test('1. getPilotHotel normaliza nombre y exige exactamente una coincidencia', async (t) => {
  const core = await corePromise;
  const hotel = await core.getPilotHotel(pilotHotelClient([
    { id: 'pilot-id', nombre: '  HOTEL MARENA SAN ISIDRO  ' },
    { id: 'other-id', nombre: 'Hotel Marena Norte' },
  ]), 'Hotel Marena San Isidro');
  assert.deepEqual(hotel, { id: 'pilot-id', nombre: 'HOTEL MARENA SAN ISIDRO' });

  await t.test('detiene una coincidencia normalizada ambigua', async () => {
    await assert.rejects(
      core.getPilotHotel(pilotHotelClient([
        { id: 'one', nombre: 'Hotel Marena San Isidro' },
        { id: 'two', nombre: ' hotel marena san isidro ' },
      ]), 'Hotel Marena San Isidro'),
      (error) => error.code === 'PILOT_HOTEL_AMBIGUOUS' && error.matchCount === 2
    );
  });
});

test('2. el alcance rechaza pagos de cualquier otro hotel', async () => {
  const core = await corePromise;
  const pilot = { id: 'pilot-id', nombre: 'Hotel Marena San Isidro' };
  assert.throws(() => core.assertPilotHotelScope('other-id', pilot), /BANK_EMAIL_OUTSIDE_PILOT_HOTEL/);
  assert.equal(core.isPilotHotelScope('other-id', pilot), false);
  assert.equal(core.isPilotHotelScope('pilot-id', pilot), true);
});

test('3. extrae $80.000 como entero COP 80000', async () => {
  const core = await corePromise;
  const result = core.extractSingleCopAmount('Recibiste una transferencia por llave de $80.000.');
  assert.equal(result.amountCop, 80_000);
  assert.equal(result.ambiguous, false);
});

test('4. extrae COP 120.000 como entero COP 120000', async () => {
  const core = await corePromise;
  const result = core.extractSingleCopAmount('Monto acreditado: COP 120.000');
  assert.equal(result.amountCop, 120_000);
  assert.equal(result.ambiguous, false);
});

test('4a. extrae montos COP con centavos cero sin aceptar fracciones', async () => {
  const core = await corePromise;
  for (const example of ['$35,000.00', '$35.000,00', 'COP 40000.00']) {
    const result = core.extractSingleCopAmount(`Recibiste un pago por ${example}.`);
    assert.equal(result.amountCop, example.includes('35') ? 35_000 : 40_000);
    assert.equal(result.ambiguous, false);
  }
  assert.equal(core.extractSingleCopAmount('Recibiste un pago por $35,000.50.').amountCop, null);
  assert.equal(core.parseCopInteger('35,000.50'), null);
});

test('4b. extrae fecha y hora colombiana de la transaccion cuando esta disponible', async () => {
  const core = await corePromise;
  assert.equal(
    core.extractTransactionOccurredAt(
      'Transferencia recibida el 3 de agosto de 2026, a las 7:18 p. m.',
      '2026-08-04T00:20:00.000Z'
    ),
    '2026-08-04T00:18:00.000Z'
  );
  assert.equal(
    core.extractTransactionOccurredAt('Fecha: 03/08/2026 19:18', '2026-08-04T00:20:00.000Z'),
    '2026-08-04T00:18:00.000Z'
  );
});

test('4c. reconoce el formato real de pago Bancolombia conectado a @hotelok', async () => {
  const core = await corePromise;
  const email = core.parseGmailMessage(gmailResource({
    subject: 'Alertas y notificaciones',
    body: 'Bancolombia: HOTEL OK, recibiste un pago de CLIENTE PRUEBA por $35,000.00 en tu cuenta *0000 conectado a la llave @hotelok el 04/08/2026 a las 16:17.',
    internalDate: String(Date.parse('2026-08-04T16:20:00-05:00')),
  }));
  const result = core.parseBankEmail(email, config(core), []);

  assert.equal(result.parserId, 'bancolombia');
  assert.equal(result.disposition, 'manual_review');
  assert.equal(result.amountCop, 35_000);
  assert.equal(result.senderName, 'CLIENTE PRUEBA');
  assert.equal(result.transactionOccurredAt, '2026-08-04T21:17:00.000Z');
  assert.ok(result.reasons.includes('bank_rule_not_configured'));
});

test('4d. reconoce la alerta real de transferencia Bancolombia de Marena', async () => {
  const core = await corePromise;
  const paymentService = await paymentServicePromise;
  const email = core.parseGmailMessage(gmailResource({
    subject: 'Alertas y Notificaciones',
    body: 'Bancolombia: Recibiste una transferencia por $50,000 de GLORIA GOMEZ en tu cuenta **8537, el 22/08/2026 a las 14:24. Si tienes dudas, hablemos: 018000931987.',
    from: 'Alertas y Notificaciones <alertasynotificaciones@an.notificacionesbancolombia.com>',
    returnPath: '<alertasynotificaciones@an.notificacionesbancolombia.com>',
    authenticationResults: 'mx.google.com; spf=pass smtp.mailfrom=an.notificacionesbancolombia.com; dkim=pass header.d=an.notificacionesbancolombia.com; dmarc=pass header.from=an.notificacionesbancolombia.com',
    internalDate: String(Date.parse('2026-08-22T14:25:00-05:00')),
  }));
  const result = core.parseBankEmail(email, config(core), paymentService.parseConfiguredRules());

  assert.equal(result.parserId, 'bancolombia');
  assert.equal(result.disposition, 'detected');
  assert.equal(result.amountCop, 50_000);
  assert.equal(result.senderName, 'GLORIA GOMEZ');
  assert.equal(result.transactionReference, '8537');
  assert.equal(result.transactionOccurredAt, '2026-08-22T19:24:00.000Z');
  assert.equal(result.reviewReason, null);
  assert.equal(result.parserVersion, 'bancolombia-marena-2.0.0');
  assert.equal(paymentService.isConfiguredBankSender(email), true);
});

test('5. rechaza remitentes no incluidos en la allowlist aunque el nombre visible parezca bancario', async () => {
  const core = await corePromise;
  const email = core.parseGmailMessage(gmailResource({
    from: 'Bancolombia <fraude@attacker.example>',
    returnPath: '<fraude@attacker.example>',
    authenticationResults: 'mx.google.com; spf=pass smtp.mailfrom=attacker.example; dkim=pass header.d=attacker.example; dmarc=pass header.from=attacker.example',
  }));
  const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
  assert.equal(result.disposition, 'rejected');
  assert.ok(result.reasons.includes('from_not_authorized'));
});

test('5b. no confia en Authentication-Results inyectado fuera de mx.google.com', async () => {
  const core = await corePromise;
  const email = core.parseGmailMessage(gmailResource({
    authenticationResults: 'attacker.example; spf=pass smtp.mailfrom=alerts.bank.example; dkim=pass header.d=alerts.bank.example; dmarc=pass header.from=alerts.bank.example',
  }));
  const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
  assert.equal(result.disposition, 'manual_review');
  assert.ok(result.reasons.includes('spf_missing_or_unverified'));
  assert.ok(result.reasons.includes('dkim_missing_or_unverified'));
  assert.ok(result.reasons.includes('dmarc_missing_or_unverified'));
});

test('5c. ignora un segundo Authentication-Results que suplanta a mx.google.com', async () => {
  const core = await corePromise;
  const resource = gmailResource({
    authenticationResults: 'mx.google.com; spf=none; dkim=none; dmarc=none',
  });
  resource.payload.headers.push({
    name: 'Authentication-Results',
    value: 'mx.google.com; spf=pass smtp.mailfrom=alerts.bank.example; dkim=pass header.d=alerts.bank.example; dmarc=pass header.from=alerts.bank.example',
  });
  const email = core.parseGmailMessage(resource);
  const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
  assert.equal(result.disposition, 'manual_review');
  assert.ok(result.reasons.includes('spf_missing_or_unverified'));
  assert.ok(result.reasons.includes('dkim_missing_or_unverified'));
  assert.ok(result.reasons.includes('dmarc_missing_or_unverified'));
});

test('5d. no confia en pass sin dominios de autenticacion verificables', async () => {
  const core = await corePromise;
  const email = core.parseGmailMessage(gmailResource({
    authenticationResults: 'mx.google.com; spf=pass; dkim=pass; dmarc=pass',
  }));
  const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
  assert.equal(result.disposition, 'manual_review');
  assert.ok(result.reasons.includes('authentication_domain_missing_or_unverified'));
});

test('6. rechaza transferencias enviadas o débitos', async () => {
  const core = await corePromise;
  const email = core.parseGmailMessage(gmailResource({
    subject: 'Transferencia enviada exitosamente',
    body: 'Bancolombia. Enviaste una transferencia por llave de $80.000. Referencia 123456.',
  }));
  const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
  assert.equal(result.disposition, 'rejected');
  assert.ok(result.reasons.includes('outgoing_transfer_detected'));
});

test('7. rechaza transacciones fallidas y reversadas', async (t) => {
  const core = await corePromise;
  for (const [wording, expectedReason] of [
    ['La transferencia fue rechazada por el banco por $80.000.', 'failed_transfer_detected'],
    ['La transferencia recibida fue reversada por $80.000.', 'reversed_transfer_detected'],
  ]) {
    await t.test(wording, () => {
      const email = core.parseGmailMessage(gmailResource({ body: `Bancolombia. ${wording}` }));
      const result = core.parseBankEmail(email, config(core), [bancolombiaRule()]);
      assert.equal(result.disposition, 'rejected');
      assert.ok(result.reasons.includes(expectedReason));
    });
  }
});

test('8. la clave hotel+mensaje evita duplicar el mismo correo', async () => {
  const core = await corePromise;
  const key = core.gmailMessageDeduplicationKey('pilot-id', 'gmail-123');
  const seen = new Set([key]);
  assert.equal(core.isDuplicateGmailMessage(seen, 'pilot-id', 'gmail-123'), true);
  assert.equal(core.isDuplicateGmailMessage(seen, 'other-id', 'gmail-123'), false);

  const firstFingerprint = await core.transferFingerprint({
    hotelId: 'pilot-id',
    bankName: 'Banco de prueba',
    transactionReference: 'REF-123',
    amountCop: 80_000,
    receivedAt: '2026-08-04T00:18:00.000Z',
  });
  const delayedFingerprint = await core.transferFingerprint({
    hotelId: 'pilot-id',
    bankName: 'Banco de prueba',
    transactionReference: ' ref-123 ',
    amountCop: 80_000,
    receivedAt: '2026-08-04T04:45:00.000Z',
  });
  const nextDayFingerprint = await core.transferFingerprint({
    hotelId: 'pilot-id',
    bankName: 'Banco de prueba',
    transactionReference: 'REF-123',
    amountCop: 80_000,
    receivedAt: '2026-08-04T05:18:00.000Z',
  });
  assert.equal(firstFingerprint, delayedFingerprint);
  assert.notEqual(firstFingerprint, nextDayFingerprint);
});

function expectedPayment(id, overrides = {}) {
  return {
    id,
    hotelId: 'pilot-id',
    expectedAmountCop: 80_000,
    paymentMethod: 'llave',
    status: 'pending',
    createdAt: '2026-08-04T00:05:00.000Z',
    expiresAt: '2026-08-04T01:00:00.000Z',
    ...overrides,
  };
}

const incomingPayment = {
  hotelId: 'pilot-id',
  amountCop: 80_000,
  receivedAt: '2026-08-04T00:18:00.000Z',
};

test('9. relaciona exactamente un pago pendiente compatible', async () => {
  const core = await corePromise;
  const result = core.decideExpectedPaymentMatch(incomingPayment, [
    expectedPayment('match'),
    expectedPayment('other-hotel', { hotelId: 'other-id' }),
    expectedPayment('cash', { paymentMethod: 'efectivo' }),
  ]);
  assert.deepEqual(result, {
    status: 'matched',
    matchedExpectedPaymentId: 'match',
    candidateIds: ['match'],
    reason: 'single_exact_pending_payment_match',
  });
});

test('10. dos pagos del mismo monto quedan en revisión manual sin elegir al azar', async () => {
  const core = await corePromise;
  const result = core.decideExpectedPaymentMatch(incomingPayment, [
    expectedPayment('first'),
    expectedPayment('second', { paymentMethod: 'transferencia' }),
  ]);
  assert.equal(result.status, 'manual_review');
  assert.equal(result.matchedExpectedPaymentId, null);
  assert.deepEqual(result.candidateIds, ['first', 'second']);
});

test('11. sin pago esperado compatible queda detectado y sin relación', async () => {
  const core = await corePromise;
  const result = core.decideExpectedPaymentMatch(incomingPayment, [
    expectedPayment('wrong-amount', { expectedAmountCop: 90_000 }),
    expectedPayment('expired', { expiresAt: '2026-08-03T23:00:00.000Z' }),
  ]);
  assert.equal(result.status, 'detected');
  assert.equal(result.matchedExpectedPaymentId, null);
  assert.deepEqual(result.candidateIds, []);
});

test('12. BANK_EMAIL_INTEGRATION_ENABLED solo habilita con el valor estricto true', async () => {
  const core = await corePromise;
  const disabled = core.readBankEmailConfig({
    BANK_EMAIL_INTEGRATION_ENABLED: 'false',
    BANK_EMAIL_PILOT_HOTEL_NAME: 'Hotel Marena San Isidro',
  });
  assert.equal(disabled.enabled, false);
  assert.equal(core.isBankEmailProcessingEnabled(disabled), false);

  const enabled = core.readBankEmailConfig({
    BANK_EMAIL_INTEGRATION_ENABLED: 'true',
    BANK_EMAIL_PILOT_HOTEL_NAME: 'Hotel Marena San Isidro',
  });
  assert.equal(core.isBankEmailProcessingEnabled(enabled), true);

  const paymentService = await paymentServicePromise;
  await assert.rejects(
    paymentService.analyzeBankEmail(
      {},
      { id: 'pilot-id', nombre: 'Hotel Marena San Isidro' },
      {},
      config(core, { enabled: false }),
      { save: true, source: 'simulation', isTest: true }
    ),
    (error) => error.code === 'bank_email_integration_disabled'
  );
});

test('helpers adicionales: parser genérico nunca confirma y Pub/Sub detecta reintentos', async () => {
  const core = await corePromise;
  const genericEmail = core.parseGmailMessage(gmailResource({
    subject: 'Pago recibido',
    body: 'Recibiste un pago de $80.000. Referencia TEST1234.',
  }));
  const generic = core.parseBankEmail(genericEmail, config(core), []);
  assert.equal(generic.disposition, 'manual_review');

  const gmailPayload = base64Url(JSON.stringify({
    emailAddress: 'payments@example.test',
    historyId: '987654321',
  }));
  const decoded = core.decodePubSubNotification({
    message: { data: gmailPayload, messageId: 'pubsub-1', publishTime: '2026-08-04T00:18:00Z' },
    subscription: 'projects/test/subscriptions/test',
  });
  assert.equal(decoded.gmail.historyId, '987654321');
  assert.equal(core.isPubSubRetry('pubsub-1', 'pubsub-1'), true);
  assert.equal(core.shouldClaimPubSubInboxItem('processed'), false);
  assert.equal(core.shouldClaimPubSubInboxItem('failed'), true);
  assert.equal(core.shouldDeadLetterPubSubInboxItem(7), false);
  assert.equal(core.shouldDeadLetterPubSubInboxItem(8), true);
  assert.equal(core.isTerminalMissingGmailMessage(404), true);
  assert.equal(core.isTerminalMissingGmailMessage(410), true);
  assert.equal(core.isTerminalMissingGmailMessage(429), false);
});

test('Gmail usa credenciales OAuth dedicadas y conserva compatibilidad con GOOGLE_*', async () => {
  const core = await corePromise;
  const dedicated = core.readBankEmailConfig({
    GMAIL_OAUTH_CLIENT_ID: 'gmail-client',
    GMAIL_OAUTH_CLIENT_SECRET: 'gmail-secret',
    GMAIL_OAUTH_REDIRECT_URI: 'https://example.test/gmail-callback',
    GOOGLE_CLIENT_ID: 'calendar-client',
    GOOGLE_CLIENT_SECRET: 'calendar-secret',
    GOOGLE_REDIRECT_URI: 'https://example.test/calendar-callback',
  });
  assert.equal(dedicated.googleClientId, 'gmail-client');
  assert.equal(dedicated.googleClientSecret, 'gmail-secret');
  assert.equal(dedicated.googleRedirectUri, 'https://example.test/gmail-callback');

  const legacy = core.readBankEmailConfig({
    GOOGLE_CLIENT_ID: 'legacy-client',
    GOOGLE_CLIENT_SECRET: 'legacy-secret',
    GOOGLE_REDIRECT_URI: 'https://example.test/legacy-callback',
  });
  assert.equal(legacy.googleClientId, 'legacy-client');
  assert.equal(legacy.googleClientSecret, 'legacy-secret');
  assert.equal(legacy.googleRedirectUri, 'https://example.test/legacy-callback');
});
