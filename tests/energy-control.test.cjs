const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260824120000_energy_control_pilot.sql', 'utf8');
const moduleSource = fs.readFileSync('js/modules/control-energia/control-energia.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const alertFn = fs.readFileSync('supabase/functions/process-energy-alerts/index.ts', 'utf8');

test('energy pilot is tenant-configured and disabled by default', () => {
  assert.match(migration, /energy_control_enabled boolean NOT NULL DEFAULT false/);
  assert.match(migration, /lower\(trim\(nombre\)\)='marena san isidro'/);
  assert.match(main, /currentEnergyControlEnabled/);
});

test('cleaning transition creates one pending check and blocks release', () => {
  assert.match(migration, /NEW\.estado = 'limpieza'/);
  assert.match(migration, /room_energy_checks_one_open_per_room/);
  assert.match(migration, /CONTROL_ENERGIA_PENDIENTE/);
});

test('scan and confirmation are server-authorized and race safe', () => {
  for (const role of ['admin','recepcionista','camarera','mantenimiento']) assert.match(migration, new RegExp(role));
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /h\.energy_qr_token=p_token/);
  assert.doesNotMatch(moduleSource, /marcar.*revisad[oa]/i);
});

test('QR regeneration replaces the old token', () => {
  assert.match(migration, /energy_regenerate_qr/);
  assert.match(migration, /energy_qr_token=v_token/);
  assert.match(moduleSource, /Regenerar QR/);
});

test('overdue alert is deduplicated', () => {
  assert.match(alertFn, /is\('admin_alert_sent_at', null\)/);
  assert.match(alertFn, /status: 'overdue'/);
  assert.match(alertFn, /MAKE_CASH_CLOSE_WEBHOOK_URL/);
});
