const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260902061000_usuarios_archivo_seguro.sql', 'utf8');
const lifecycle = fs.readFileSync('supabase/functions/manage-user-lifecycle/index.ts', 'utf8');
const legacyDelete = fs.readFileSync('supabase/functions/delete-user/index.ts', 'utf8');
const enhancer = fs.readFileSync('js/modules/usuarios/usuarios-archivo-enhancer.js', 'utf8');
const guard = fs.readFileSync('js/user-active-session-guard.js', 'utf8');
const appHtml = fs.readFileSync('app/index.html', 'utf8');

test('usuarios conserva empleados retirados con fecha de archivo', () => {
  assert.match(migration, /archivado_en timestamptz/);
  assert.match(migration, /archivado_por uuid/);
  assert.match(migration, /WHERE activo IS FALSE/);
  assert.match(migration, /ix_usuarios_hotel_activo_nombre/);
});

test('el inspector de historial cubre referencias operativas dinámicamente', () => {
  assert.match(migration, /usuario_dependencias_operativas/);
  assert.match(migration, /pg_constraint/);
  assert.match(migration, /confrelid = 'public\.usuarios'::regclass/);
  assert.match(migration, /EXECUTE format/);
  assert.match(migration, /tiene_historial/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.usuario_dependencias_operativas\(uuid\)[\s\S]*authenticated/);
  assert.match(migration, /GRANT EXECUTE[\s\S]*service_role/);
});

test('el ciclo de usuario exige administrador activo y mismo hotel', () => {
  assert.match(lifecycle, /Solo un administrador activo/);
  assert.match(lifecycle, /No puedes gestionar usuarios de otro hotel/);
  assert.match(lifecycle, /No puedes retirar o eliminar tu propio usuario/);
  assert.match(lifecycle, /propietario principal del hotel no puede retirarse/);
});

test('retirar empleado desactiva perfil y bloquea Auth', () => {
  assert.match(lifecycle, /action === "archive"/);
  assert.match(lifecycle, /activo: false/);
  assert.match(lifecycle, /archivado_en: new Date\(\)\.toISOString\(\)/);
  assert.match(lifecycle, /archivado_por: actor\.id/);
  assert.match(lifecycle, /ban_duration: "876000h"/);
});

test('reactivar recupera perfil y acceso Auth', () => {
  assert.match(lifecycle, /action === "reactivate"/);
  assert.match(lifecycle, /ban_duration: "none"/);
  assert.match(lifecycle, /activo: true, archivado_en: null, archivado_por: null/);
});

test('borrado definitivo requiere inactivo y cero historial', () => {
  assert.match(lifecycle, /Primero retira al empleado/);
  assert.match(lifecycle, /usuario_dependencias_operativas/);
  assert.match(lifecycle, /USER_HAS_HISTORY/);
  assert.match(lifecycle, /admin\.auth\.admin\.deleteUser\(userId\)/);
  assert.match(lifecycle, /from\("usuarios"\)[\s\S]*\.delete\(\)/);
});

test('la función delete-user legacy ya no puede borrar cuentas', () => {
  assert.match(legacyDelete, /DIRECT_USER_DELETE_DISABLED/);
  assert.doesNotMatch(legacyDelete, /auth\.admin\.deleteUser/);
});

test('la lista muestra activos por defecto y separa archivados', () => {
  assert.match(enhancer, /root\.dataset\.userListView = 'active'/);
  assert.match(enhancer, /Personal activo/);
  assert.match(enhancer, /Archivados/);
  assert.match(enhancer, /row\.hidden = row\.dataset\.lifecycleStatus !== view/);
  assert.match(enhancer, /Retirar empleado/);
  assert.match(enhancer, /Eliminar definitivamente/);
});

test('la capa segura intercepta los controles legacy de activar y eliminar', () => {
  assert.match(enhancer, /\['toggle-activo', 'eliminar'\]/);
  assert.match(enhancer, /event\.stopImmediatePropagation\(\)/);
  assert.match(enhancer, /manage-user-lifecycle/);
  assert.match(enhancer, /USER_HAS_HISTORY/);
  assert.match(enhancer, /hideLegacyActiveCheckbox/);
});

test('un empleado archivado con sesión abierta es expulsado', () => {
  assert.match(guard, /\.select\('activo'\)/);
  assert.match(guard, /profile\.activo === false/);
  assert.match(guard, /supabase\.auth\.signOut\(\)/);
  assert.match(guard, /login\.html\?access=archived/);
  assert.match(guard, /CHECK_INTERVAL_MS = 30000/);
  assert.match(guard, /visibilitychange/);
});

test('la aplicación carga el archivo seguro y el guard global', () => {
  assert.match(appHtml, /user-active-session-guard\.js/);
  assert.match(appHtml, /usuarios-archivo-enhancer\.js/);
});
