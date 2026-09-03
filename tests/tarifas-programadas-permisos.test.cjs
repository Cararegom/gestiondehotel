const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260903174500_tarifas_programadas_solo_admin.sql', 'utf8');
const guard = fs.readFileSync('js/tarifas-programadas-admin-guard.js', 'utf8');
const index = fs.readFileSync('app/index.html', 'utf8');

test('la base de datos permite escribir tarifas únicamente a administradores del hotel', () => {
  assert.match(migration, /tarifas_programadas_insert_admin/);
  assert.match(migration, /tarifas_programadas_update_admin/);
  assert.match(migration, /tarifas_programadas_delete_admin/);
  assert.match(migration, /usuario_actual_es_admin_hotel\(hotel_id\)/);
  assert.doesNotMatch(migration, /CREATE POLICY tarifas_programadas_(insert|update|delete)_hotel/);
});

test('la UI entra en modo solo lectura si el usuario no es administrador', () => {
  assert.match(guard, /usuario_actual_es_admin_hotel/);
  assert.match(guard, /applyReadOnlyMode/);
  assert.match(guard, /form\.replaceWith\(notice\)/);
  assert.match(guard, /querySelectorAll\('\[data-action\]'\)/);
  assert.match(guard, /return false/);
});

test('el guard de permisos se carga junto con la administración de tarifas', () => {
  assert.match(index, /habitaciones-tarifas-bootstrap\.js/);
  assert.match(index, /tarifas-programadas-admin-guard\.js/);
  assert.match(index, /mapa-tarifas-programadas-bootstrap\.js/);
});
