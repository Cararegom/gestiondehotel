const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260924185000_energy_marena_reception_qr_lockdown.sql', 'utf8');
const moduleSource = fs.readFileSync('js/modules/control-energia/control-energia.js', 'utf8');

test('Hotel Marena bloquea impresion QR a recepcion y conserva admin', () => {
  assert.match(migration, /38373fa5-b953-4aa9-b4e9-25b9739be5f2/);
  assert.match(migration, /u\.hotel_id <> '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid/);
  assert.match(migration, /'admin', 'administrador'/);
  assert.match(migration, /energy_actor_can_print_qr/);
});

test('recepcion Marena exige dispositivo movil en frontend y backend', () => {
  assert.match(migration, /energy_actor_is_marena_reception/);
  assert.match(migration, /ENERGY_SCAN_MOBILE_REQUIRED/);
  assert.match(migration, /request\.headers/);
  assert.match(migration, /android\|iphone\|ipad\|ipod\|mobile\|tablet/);
  assert.match(moduleSource, /scan_mobile_only/);
  assert.match(moduleSource, /isMobileEnergyDevice/);
  assert.match(moduleSource, /Escaneo bloqueado en computador/);
});
