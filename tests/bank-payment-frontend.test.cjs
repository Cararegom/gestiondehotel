const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const validHotelId = '11111111-1111-4111-8111-111111111111';
const validEventId = '22222222-2222-4222-8222-222222222222';

const serviceSource = fs.readFileSync(
  path.join(root, 'js/services/bankPaymentService.js'),
  'utf8'
);

let serviceModulePromise;
function loadServiceModule() {
  serviceModulePromise ||= import(`data:text/javascript;base64,${Buffer.from(serviceSource).toString('base64')}`);
  return serviceModulePromise;
}

function createFunctionClient(response = {}) {
  const calls = [];
  return {
    calls,
    client: {
      functions: {
        async invoke(name, options) {
          calls.push({ name, options });
          return { data: response, error: null };
        }
      }
    }
  };
}

test('el servicio consulta elegibilidad autoritativa sin enviar hotelId', async () => {
  const service = await loadServiceModule();
  const mock = createFunctionClient({
    eligible: true,
    integrationEnabled: true,
    isAdmin: false
  });

  const result = await service.getBankPaymentPilotStatus(mock.client, validHotelId);

  assert.equal(result.canAccess, true);
  assert.deepEqual(mock.calls, [{
    name: 'bank-email-api',
    options: { body: { action: 'pilot-status' } }
  }]);
  assert.equal('hotelId' in mock.calls[0].options.body, false);
});

test('el servicio falla cerrado con hotel local invalido y valida acciones manuales', async () => {
  const service = await loadServiceModule();
  const mock = createFunctionClient({ ok: true });

  await assert.rejects(
    service.getBankPaymentPilotStatus(mock.client, 'hotel-no-valido'),
    /hotel activo/i
  );
  await assert.rejects(
    service.submitBankPaymentManualAction(mock.client, validHotelId, {
      paymentEventId: validEventId,
      manualAction: 'relate'
    }),
    /selecciona una reserva/i
  );
  await assert.rejects(
    service.submitBankPaymentManualAction(mock.client, validHotelId, {
      paymentEventId: validEventId,
      manualAction: 'reject'
    }),
    /motivo del rechazo/i
  );
  assert.equal(mock.calls.length, 0);
});

test('el listado pagina los movimientos para no ocultar transferencias antiguas', async () => {
  const service = await loadServiceModule();
  const mock = createFunctionClient({
    events: [{ id: validEventId, amount_cop: 35000 }],
    pagination: { hasMore: true, nextOffset: 200, limit: 100 }
  });

  const page = await service.listBankPaymentEvents(mock.client, validHotelId, {
    status: 'manual_review',
    offset: 100,
    limit: 100
  });

  assert.equal(page.events.length, 1);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 200);
  assert.deepEqual(mock.calls[0].options.body, {
    action: 'list',
    status: 'manual_review',
    dateFrom: null,
    dateTo: null,
    offset: 100,
    limit: 100
  });
});

test('el detalle conserva todas las allocations devueltas por el servidor', async () => {
  const service = await loadServiceModule();
  const allocations = [
    { id: '33333333-3333-4333-8333-333333333331', allocation_type: 'reservation', amount_cop: 60000 },
    { id: '33333333-3333-4333-8333-333333333332', allocation_type: 'sale', sale_type: 'tienda', amount_cop: 20000 },
    { id: '33333333-3333-4333-8333-333333333333', allocation_type: 'sale', sale_type: 'terraza', amount_cop: 20000 }
  ];
  const mock = createFunctionClient({ event: { id: validEventId, amount_cop: 100000 }, allocations });

  const detail = await service.getBankPaymentDetail(mock.client, validHotelId, validEventId);

  assert.equal(detail.allocations.length, 3);
  assert.deepEqual(detail.allocations, allocations);
  assert.deepEqual(mock.calls[0].options.body, { action: 'detail', paymentEventId: validEventId });
  assert.equal('hotelId' in mock.calls[0].options.body, false);
});

test('las mutaciones usan el contrato de la Edge Function sin confiar en el tenant del navegador', async () => {
  const service = await loadServiceModule();
  const mock = createFunctionClient({ ok: true });

  await service.submitBankPaymentManualAction(mock.client, validHotelId, {
    paymentEventId: validEventId,
    manualAction: 'confirm'
  });

  assert.equal(mock.calls[0].name, 'bank-email-api');
  assert.equal(mock.calls[0].options.body.action, 'manual-action');
  assert.equal(mock.calls[0].options.body.paymentEventId, validEventId);
  assert.equal(mock.calls[0].options.body.manualAction, 'confirm');
  assert.equal('hotelId' in mock.calls[0].options.body, false);

  await service.createBankExpectedPayment(mock.client, validHotelId, {
    operationId: '33333333-3333-4333-8333-333333333333',
    reservationId: '44444444-4444-4444-8444-444444444444',
    amountCop: 80000,
    paymentMethod: 'llave',
    expiresMinutes: 30
  });
  assert.deepEqual(mock.calls[1].options.body, {
    action: 'create-expected-payment',
    operationId: '33333333-3333-4333-8333-333333333333',
    reservationId: '44444444-4444-4444-8444-444444444444',
    amountCop: 80000,
    paymentMethod: 'llave',
    expiresMinutes: 30
  });
  assert.equal('hotelId' in mock.calls[1].options.body, false);
});

test('las acciones Gmail usan solo el contexto JWT y validan la URL OAuth de Google', async () => {
  const service = await loadServiceModule();
  const calls = [];
  const responses = {
    'gmail-status': { integration: { connected: true, connectedEmail: 'pagos@example.test' } },
    'oauth-start': { authUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test' },
    'renew-watch': { watchStatus: 'active', watchExpiration: '2026-08-10T00:00:00.000Z' },
    'test-connection': { ok: true, connectedEmail: 'pagos@example.test' },
    disconnect: { disconnected: true }
  };
  const client = {
    functions: {
      async invoke(name, options) {
        calls.push({ name, options });
        return { data: responses[options.body.action], error: null };
      }
    }
  };

  assert.equal((await service.getBankPaymentGmailStatus(client)).connected, true);
  assert.match((await service.startBankPaymentGmailOAuth(client)).authUrl, /^https:\/\/accounts\.google\.com\//);
  assert.equal((await service.renewBankPaymentGmailWatch(client)).watchStatus, 'active');
  assert.equal((await service.testBankPaymentGmailConnection(client)).ok, true);
  assert.equal((await service.disconnectBankPaymentGmail(client)).disconnected, true);
  assert.deepEqual(calls.map((call) => call.options.body), [
    { action: 'gmail-status' },
    { action: 'oauth-start' },
    { action: 'renew-watch' },
    { action: 'test-connection' },
    { action: 'disconnect' }
  ]);
  assert.ok(calls.every((call) => call.name === 'bank-email-api'));
  assert.ok(calls.every((call) => !('hotelId' in call.options.body)));

  const unsafeClient = createFunctionClient({ authUrl: 'https://attacker.example/oauth' });
  await assert.rejects(
    service.startBankPaymentGmailOAuth(unsafeClient.client),
    /URL segura/i
  );
});

test('los errores controlados de Gmail muestran la instruccion enviada por el servidor', async () => {
  const service = await loadServiceModule();
  const client = {
    functions: {
      async invoke() {
        return {
          data: null,
          error: {
            message: 'Edge Function returned a non-2xx status code',
            context: new Response(JSON.stringify({
              error: 'google_invalid_grant',
              message: 'El permiso de Google vencio o fue revocado. Pulsa Conectar Gmail.'
            }), { status: 409, headers: { 'Content-Type': 'application/json' } })
          }
        };
      }
    }
  };

  await assert.rejects(
    service.testBankPaymentGmailConnection(client),
    /permiso de Google vencio.*Conectar Gmail/i
  );
});

test('ruta, interfaz y notificaciones conservan las barreras del piloto', () => {
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const moduleSource = fs.readFileSync(
    path.join(root, 'js/modules/pagos-bancarios/pagos-bancarios.js'),
    'utf8'
  );
  const notifications = fs.readFileSync(
    path.join(root, 'js/modules/notificaciones/notificaciones.js'),
    'utf8'
  );
  const notificationService = fs.readFileSync(
    path.join(root, 'js/services/notificationCenterService.js'),
    'utf8'
  );

  assert.match(main, /'\/pagos-bancarios'.*moduleKey: 'pagos-bancarios'/);
  assert.match(main, /currentProfileHotelId === normalizedHotelId/);
  assert.match(main, /moduleKeyFromRoute === 'pagos-bancarios'/);
  assert.match(main, /await refreshBankPaymentPilotStatus\(hotelIdForModule, userForModule\.id\)/);
  assert.match(moduleSource, /state\.pilotStatus = await getBankPaymentPilotStatus/);
  assert.match(moduleSource, /if \(!state\.pilotStatus\.canAccess\)/);
  assert.match(moduleSource, /state\.pilotStatus\?\.isAdmin/);
  assert.match(moduleSource, /metadata\.is_test = true/);
  assert.match(moduleSource, /transaction_reference_masked/);
  assert.match(moduleSource, /bank-expected-payment-form/);
  assert.match(moduleSource, /createBankExpectedPayment/);
  assert.match(moduleSource, /bank-payments-load-more/);
  assert.match(moduleSource, /Distribución guardada/);
  assert.match(moduleSource, /mergeCurrentAllocations\(candidates, allocations\)/);
  assert.match(moduleSource, /saleAllocations[\s\S]*currentSale\.checked = true/);
  assert.match(notifications, /escapeHtml\(notification\.mensaje/);
  assert.match(notifications, /#\/pagos-bancarios\?payment=/);
  assert.match(notificationService, /filter: `hotel_id=eq\.\$\{context\.hotelId\}`/);
  assert.doesNotMatch(main, /PILOT_HOTEL_(?:ID|NAME)|BANK_PAYMENT_PILOT_HOTEL/);
});

test('Integraciones solo monta Correo de pagos para el piloto administrador y consume el callback hash', () => {
  const integrations = fs.readFileSync(
    path.join(root, 'js/modules/integraciones/integraciones.js'),
    'utf8'
  );

  assert.match(integrations, /bankPaymentPilotStatus\?\.eligible === true && bankPaymentPilotStatus\?\.isAdmin === true/);
  assert.match(integrations, /renderModuleLayout\(\{ showGmailPaymentCard \}\)/);
  assert.match(integrations, /gmail_payment_status/);
  assert.match(integrations, /params\.delete\('gmail_payment_status'\)/);
  assert.match(integrations, /startBankPaymentGmailOAuth/);
  assert.match(integrations, /renewBankPaymentGmailWatch/);
  assert.match(integrations, /testBankPaymentGmailConnection/);
  assert.match(integrations, /disconnectBankPaymentGmail/);
  assert.match(integrations, /window\.location\.assign\(authUrl\)/);
  assert.doesNotMatch(integrations, /Hotel Marena San Isidro|BANK_EMAIL_PILOT_HOTEL_NAME/);
});
