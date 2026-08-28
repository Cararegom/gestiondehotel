const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const pilotHotelPromise = import(pathToFileURL(path.join(
  root,
  'supabase/functions/_shared/bank-email/pilot-hotel.ts'
)).href);

const pilotId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const pilotName = 'Hotel Marena San Isidro';

function exactHotelClient(rows, calls = []) {
  return {
    from(table) {
      assert.equal(table, 'hoteles');
      return {
        select(columns) {
          assert.equal(columns, 'id,nombre');
          return {
            eq(column, value) {
              calls.push({ method: 'eq', column, value });
              return Promise.resolve({ data: rows, error: null });
            },
            ilike(column, value) {
              calls.push({ method: 'ilike', column, value });
              return Promise.resolve({ data: rows, error: null });
            }
          };
        }
      };
    }
  };
}

test('Fase 18 resuelve el hotel piloto por UUID exacto y no por coincidencia de nombre', async () => {
  const { getPilotHotel } = await pilotHotelPromise;
  const calls = [];
  const hotel = await getPilotHotel(exactHotelClient([
    { id: pilotId, nombre: pilotName },
    { id: otherId, nombre: pilotName }
  ], calls), pilotName, pilotId);

  assert.deepEqual(hotel, { id: pilotId, nombre: pilotName });
  assert.deepEqual(calls, [{ method: 'eq', column: 'id', value: pilotId }]);
});

test('Fase 18 falla cerrado ante UUID ausente, invalido, inexistente o nombre discordante', async () => {
  const { getPilotHotel } = await pilotHotelPromise;

  await assert.rejects(
    getPilotHotel(exactHotelClient([]), pilotName, ''),
    (error) => error.code === 'PILOT_HOTEL_ID_REQUIRED'
  );
  await assert.rejects(
    getPilotHotel(exactHotelClient([]), pilotName, 'marena'),
    (error) => error.code === 'PILOT_HOTEL_ID_INVALID'
  );
  await assert.rejects(
    getPilotHotel(exactHotelClient([]), pilotName, pilotId),
    (error) => error.code === 'PILOT_HOTEL_NOT_FOUND'
  );
  await assert.rejects(
    getPilotHotel(exactHotelClient([{ id: pilotId, nombre: 'Hotel equivocado' }]), pilotName, pilotId),
    (error) => error.code === 'PILOT_HOTEL_ID_NAME_MISMATCH'
  );
});

test('Fase 18 obliga BANK_EMAIL_PILOT_HOTEL_ID dentro del runtime Deno de Edge Functions', () => {
  const source = fs.readFileSync(
    path.join(root, 'supabase/functions/_shared/bank-email/pilot-hotel.ts'),
    'utf8'
  );
  const edgeFiles = [
    'supabase/functions/bank-email-api/index.ts',
    'supabase/functions/gmail-oauth-callback/index.ts',
    'supabase/functions/gmail-webhook/index.ts',
    'supabase/functions/gmail-watch-renew/index.ts'
  ];

  assert.match(source, /Deno\?\s*:\s*\{\s*env/);
  assert.match(source, /BANK_EMAIL_PILOT_HOTEL_ID/);
  assert.match(source, /\.eq\("id", configuredId\)/);
  assert.match(source, /PILOT_HOTEL_ID_REQUIRED/);
  for (const relativePath of edgeFiles) {
    const edgeSource = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(edgeSource, /getPilotHotel/);
  }
});

test('Fase 19 mantiene para recepcion solo estados bancarios simples y sin consola tecnica', () => {
  const caja = fs.readFileSync(path.join(root, 'js/modules/caja/caja-movimientos.js'), 'utf8');
  const flow = fs.readFileSync(path.join(root, 'docs/conciliacion-bancaria-v2/05-flujo-recepcionista.md'), 'utf8');

  assert.match(caja, /pending:\s*\['Esperando verificacion'/);
  assert.match(caja, /verified:\s*\['Confirmado por banco'/);
  assert.match(caja, /review:\s*\['Revision administrativa'/);
  assert.match(caja, /not_applicable:\s*\['No aplica'/);
  assert.match(flow, /No puede abrir la consola completa/);
  assert.match(flow, /sin detalles tecnicos/i);
});

test('Fase 20 conserva consola completa solo para administrador y bloquea otro hotel', () => {
  const api = fs.readFileSync(path.join(root, 'supabase/functions/bank-email-api/index.ts'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(root, 'js/modules/pagos-bancarios/pagos-bancarios.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');

  for (const action of ['list', 'detail', 'candidates', 'manual-action']) {
    assert.match(api, new RegExp(`action === '${action}'[\\s\\S]{0,260}requirePilotAdministrator`));
  }
  assert.match(api, /assertSamePilotHotel\(context, pilotHotel\.id\)/);
  assert.match(moduleSource, /if \(!state\.pilotStatus\.canAccess\)/);
  assert.match(moduleSource, /state\.pilotStatus\?\.isAdmin/);
  assert.match(main, /moduleKeyFromRoute === 'pagos-bancarios'/);
  assert.match(main, /currentProfileHotelId === normalizedHotelId/);
});
