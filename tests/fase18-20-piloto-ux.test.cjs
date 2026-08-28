const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pilotId = '38373fa5-b953-4aa9-b4e9-25b9739be5f2';
const otherId = 'ac5e4c9d-a8cc-4c53-ab03-0e4ed1549195';

const configPromise = import(pathToFileURL(path.join(
  root,
  'supabase/functions/_shared/bank-email/config.ts'
)).href);
const pilotPromise = import(pathToFileURL(path.join(
  root,
  'supabase/functions/_shared/bank-email/pilot-hotel.ts'
)).href);

function pilotClient(rows = [], error = null) {
  return {
    from(table) {
      assert.equal(table, 'hoteles');
      return {
        select(columns) {
          assert.equal(columns, 'id,nombre');
          return {
            eq(column, value) {
              assert.equal(column, 'id');
              return Promise.resolve({
                data: rows.filter((row) => row.id === value),
                error
              });
            },
            ilike() {
              return Promise.resolve({ data: rows, error });
            }
          };
        }
      };
    }
  };
}

test('Fase 18 exige UUID autoritativo para habilitar el piloto', async () => {
  const config = await configPromise;
  const runtime = config.readBankEmailConfig({
    BANK_EMAIL_INTEGRATION_ENABLED: 'true',
    BANK_EMAIL_PILOT_HOTEL_ID: pilotId.toUpperCase(),
    BANK_EMAIL_PILOT_HOTEL_NAME: 'Hotel Marena San Isidro',
    GMAIL_PAYMENT_LABEL: 'PAGOS HOTEL MARENA'
  });

  assert.equal(runtime.pilotHotelId, pilotId);
  assert.equal(runtime.pilotHotelName, 'Hotel Marena San Isidro');
  assert.doesNotThrow(() => config.assertBankEmailConfig(runtime));
  assert.equal(config.isBankEmailProcessingEnabled(runtime), true);

  const withoutId = { ...runtime, pilotHotelId: '' };
  assert.throws(() => config.assertBankEmailConfig(withoutId), /PILOT_HOTEL_ID.*UUID/i);
  assert.equal(config.isBankEmailProcessingEnabled(withoutId), false);

  const invalidId = { ...runtime, pilotHotelId: 'hotel-marena' };
  assert.throws(() => config.assertBankEmailConfig(invalidId), /PILOT_HOTEL_ID.*UUID/i);
  assert.equal(config.isBankEmailProcessingEnabled(invalidId), false);

  const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  assert.match(envExample, /BANK_EMAIL_PILOT_HOTEL_ID=/);
  assert.match(envExample, /Authoritative tenant gate/);
});

test('Fase 18 resuelve el hotel por UUID y falla cerrado ante mismatch', async () => {
  const pilot = await pilotPromise;
  const client = pilotClient([
    { id: pilotId, nombre: 'Hotel Marena San Isidro' },
    { id: otherId, nombre: 'Hotel Otro' }
  ]);

  const resolved = await pilot.getPilotHotel(
    client,
    'Hotel Marena San Isidro',
    pilotId
  );
  assert.deepEqual(resolved, { id: pilotId, nombre: 'Hotel Marena San Isidro' });
  assert.equal(pilot.isPilotHotelScope(pilotId, resolved), true);
  assert.equal(pilot.isPilotHotelScope(otherId, resolved), false);
  assert.throws(() => pilot.assertPilotHotelScope(otherId, resolved), /BANK_EMAIL_OUTSIDE_PILOT_HOTEL/);

  await assert.rejects(
    pilot.getPilotHotel(client, 'Hotel Marena San Isidro', otherId),
    (error) => error?.code === 'PILOT_HOTEL_ID_NAME_MISMATCH'
  );
  await assert.rejects(
    pilot.getPilotHotel(client, 'Hotel Marena San Isidro', 'no-es-uuid'),
    (error) => error?.code === 'PILOT_HOTEL_ID_INVALID'
  );
});

test('Fase 19 mantiene a recepcion en estados simples sin evidencia bancaria sensible', () => {
  const caja = fs.readFileSync(path.join(root, 'js/modules/caja/caja-movimientos.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'js/services/bankPaymentService.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'supabase/functions/bank-email-api/index.ts'), 'utf8');

  assert.match(caja, /pending:\s*\['Esperando verificacion'/);
  assert.match(caja, /verified:\s*\['Confirmado por banco'/);
  assert.match(caja, /review:\s*\['Revision administrativa'/);
  assert.match(caja, /not_applicable:\s*\['No aplica'/);
  assert.doesNotMatch(caja, /gmail_message_id|gmail_thread_id|email_subject|transaction_reference|raw_content_hash|review_reason/);

  assert.match(service, /\['pending', 'verified', 'review', 'not_applicable'\]/);
  assert.match(api, /action === 'operational-summary'/);
  assert.match(api, /isPilotOperationalUser/);
  assert.match(api, /select\('status, updated_at'\)/);
  assert.doesNotMatch(api, /operational-summary'[\s\S]{0,1800}transaction_reference|operational-summary'[\s\S]{0,1800}sender_name/);
});

test('Fase 20 conserva la consola completa solo para administracion del piloto', () => {
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'js/services/bankPaymentService.js'), 'utf8');
  const notifications = fs.readFileSync(path.join(root, 'js/modules/notificaciones/notificaciones.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'supabase/functions/bank-email-api/index.ts'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'supabase/functions/_shared/bank-email/server.ts'), 'utf8');

  assert.match(main, /'\/pagos-bancarios'.*adminOnly: true/);
  assert.match(service, /canAccess:\s*data\.eligible === true && data\.integrationEnabled === true && data\.canManageReconciliation === true/);
  assert.match(notifications, /paymentEventId && \['admin', 'administrador', 'superadmin'\]\.includes\(currentBellContext\?\.role\)/);

  for (const action of ['list', 'detail', 'candidates', 'manual-action']) {
    const pattern = new RegExp(`action === '${action.replace('-', '\\-')}'[\\s\\S]{0,180}requirePilotAdministrator`);
    assert.match(api, pattern);
  }
  assert.match(server, /context\.profile\.hotel_id !== pilotHotelId/);
  assert.match(server, /administrator_required/);
});
