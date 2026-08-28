const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260825165408_restringir_reversiones_caja_a_admin.sql'), 'utf8');
const caja = fs.readFileSync(path.join(root, 'js/modules/caja/caja.js'), 'utf8');
const movements = fs.readFileSync(path.join(root, 'js/modules/caja/caja-movimientos.js'), 'utf8');

test('la base de datos exige rol administrativo para cualquier reversion financiera', () => {
  assert.match(migration, /p_permiso = 'finanzas\.revertir'/);
  assert.match(migration, /usuario_actual_es_admin_hotel\(p_hotel_id\)/);
  assert.match(migration, /NOT IN \('admin', 'administrador', 'superadmin'\)/);
});

test('Caja solo muestra y procesa Revertir cuando el usuario es administrador', () => {
  assert.match(caja, /ADMIN_ROLES = \['admin', 'administrador', 'superadmin'\]/);
  assert.match(caja, /currentUserRoleNames/);
  assert.match(movements, /isAdminUser && !isReversal && !isReverted/);
  assert.match(movements, /if \(deleteButton && isAdminUser\)/);
});
