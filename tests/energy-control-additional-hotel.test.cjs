const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync(
  'supabase/migrations/20260824123000_enable_energy_control_hotel_a32ecc1f.sql',
  'utf8'
);

test('habilita Control de Energia para el hotel adicional por UUID', () => {
  assert.match(migration, /a32ecc1f-9821-4448-8d36-8463bf542149/);
  assert.match(migration, /energy_control_enabled/);
  assert.match(migration, /ON CONFLICT \(hotel_id\) DO UPDATE/);
  assert.doesNotMatch(migration, /nombre\s*=/i);
});
