const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260903061000_bitacora_timezone_operativa.sql', 'utf8');
const bitacora = fs.readFileSync('js/modules/bitacora/bitacora.js', 'utf8');

test('Bitacora calcula fecha operativa y zona por cada hotel sin perder RLS', () => {
  assert.match(migration, /view public\.bitacora_operativa/i);
  assert.match(migration, /security_invoker\s*=\s*true/i);
  assert.match(migration, /hotel_business_date/);
  assert.match(migration, /hotel_time_zone/);
  assert.match(migration, /creado_en at time zone 'UTC'/i);
  assert.match(migration, /revoke all on public\.bitacora_operativa from public, anon/i);
  assert.match(migration, /grant select on public\.bitacora_operativa to authenticated, service_role/i);
});

test('Bitacora filtra por business_date y formatea cada fila con la zona de su hotel', () => {
  assert.match(bitacora, /from\('bitacora_operativa'\)/);
  assert.match(bitacora, /gte\('business_date', fechaInicio\)/);
  assert.match(bitacora, /lte\('business_date', fechaFin\)/);
  assert.match(bitacora, /formatInTimeZone\(/);
  assert.match(bitacora, /entry\.zona_horaria/);
  assert.match(bitacora, /creado_en_instante/);
  assert.doesNotMatch(bitacora, /T00:00:00\.000Z/);
  assert.doesNotMatch(bitacora, /T23:59:59\.999Z/);
});
