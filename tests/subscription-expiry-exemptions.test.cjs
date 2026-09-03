const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260903090000_subscription_expiry_internal_exemptions.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');

const INTERNAL_HOTELS = [
  '38373fa5-b953-4aa9-b4e9-25b9739be5f2', // Marena San Isidro
  'ac5e4c9d-a8cc-4c53-ab03-0e4ed1549195', // Corales del Mar
  '8434a618-0f58-46c9-ad91-da23987b7e99', // Dora Smith
  'a32ecc1f-9821-4448-8d36-8463bf542149'  // Dora Smith de prueba
];

test('la migracion crea una exencion explicita y protege hoteles internos', () => {
  assert.match(migration, /suscripcion_exenta boolean not null default false/i);
  assert.match(migration, /proteger_suscripcion_exenta_hotel/i);
  assert.match(migration, /new\.estado_suscripcion := 'activo'/i);

  for (const hotelId of INTERNAL_HOTELS) {
    assert.match(migration, new RegExp(hotelId.replace(/-/g, '\\-')));
  }
});

test('solo hoteles no exentos vencen por fecha', () => {
  assert.match(migration, /coalesce\(suscripcion_exenta, false\) = false/i);
  assert.match(migration, /estado_suscripcion in \('trial', 'activo'\)/i);
  assert.match(migration, /coalesce\(suscripcion_fin, trial_fin\) < now\(\)/i);
  assert.match(migration, /estado_suscripcion = 'vencido'/i);
});

test('la sincronizacion queda automatizada cada hora', () => {
  assert.match(migration, /sincronizar-estados-suscripcion-cada-hora/);
  assert.match(migration, /'17 \* \* \* \*'/);
  assert.match(migration, /select public\.sincronizar_estados_suscripcion\(\);/i);
});

test('las funciones administrativas no quedan ejecutables por clientes', () => {
  assert.match(migration, /revoke execute on function public\.proteger_suscripcion_exenta_hotel\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /revoke execute on function public\.sincronizar_estados_suscripcion\(\)[\s\S]*from public, anon, authenticated/i);
});
