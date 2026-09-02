const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260902060000_rol_mantenimiento_conserje.sql', 'utf8');
const guard = fs.readFileSync('js/maintenance-concierge-access.js', 'utf8');
const index = fs.readFileSync('app/index.html', 'utf8');
const mapFacade = fs.readFileSync('js/modules/mapa-habitaciones/mapa-habitaciones.js', 'utf8');
const readonlyMap = fs.readFileSync('js/modules/mapa-habitaciones/mapa-habitaciones-readonly.js', 'utf8');
const operationalMap = fs.readFileSync('js/modules/mapa-habitaciones/mapa-habitaciones-operativo.js', 'utf8');
const notifications = fs.readFileSync('js/services/notificationCenterService.js', 'utf8');
const repository = fs.readFileSync('js/modules/mantenimiento/mantenimiento-repository.js', 'utf8');
const quickReport = fs.readFileSync('js/modules/mantenimiento/mantenimiento-quick-report.js', 'utf8');

test('el catalogo crea Mantenimiento / Conserje y solo hereda mantenimiento', () => {
  assert.match(migration, /'Mantenimiento \/ Conserje'/);
  assert.match(migration, /p\.nombre = 'ver_mantenimiento'/);
  assert.doesNotMatch(migration, /p\.nombre = 'ver_caja'/);
  assert.doesNotMatch(migration, /p\.nombre = 'crear_reservas'/);
  assert.doesNotMatch(migration, /p\.nombre = 'ver_usuarios'/);
});

test('el mapa del conserje se resuelve en servidor sin datos privados de la reserva', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mapa_mantenimiento_conserje\(\)/);
  assert.match(migration, /usuario_actual_es_mantenimiento_conserje\(\)/);
  assert.match(migration, /'fecha_inicio'/);
  assert.match(migration, /'fecha_fin'/);
  assert.match(migration, /'tipo_duracion'/);
  assert.doesNotMatch(migration, /cliente_nombre/);
  assert.doesNotMatch(migration, /monto_total/);
  assert.doesNotMatch(migration, /monto_pagado/);
  assert.doesNotMatch(migration, /documento_cliente/);
});

test('control de energia reconoce el nuevo rol sin elevarlo a administrador', () => {
  assert.match(migration, /es_nombre_rol_mantenimiento_conserje\(r\.nombre\)/);
  assert.match(migration, /CASE WHEN p_admin_only THEN/);
  const adminBranch = migration.match(/CASE WHEN p_admin_only THEN([\s\S]*?)ELSE/)?.[1] || '';
  assert.doesNotMatch(adminBranch, /es_nombre_rol_mantenimiento_conserje/);
  assert.match(migration, /energy_actor_role_label/);
});

test('el guard limita navegación a cuatro vistas operativas', () => {
  const allowedBlock = guard.match(/const ALLOWED_ROUTES = new Set\(\[([\s\S]*?)\]\);/)?.[1] || '';
  for (const route of ['/mapa-habitaciones', '/mantenimiento', '/control-energia', '/notificaciones']) {
    assert.match(allowedBlock, new RegExp(route.replace('/', '\\/')));
  }
  for (const route of ['/dashboard', '/reservas', '/caja', '/usuarios', '/tienda', '/restaurante', '/reportes', '/clientes']) {
    assert.doesNotMatch(allowedBlock, new RegExp(route.replace('/', '\\/')));
  }
  assert.match(guard, /stopImmediatePropagation\(\)/);
  assert.match(guard, /replaceInitialHash\(\)/);
});

test('el bootstrap valida el perfil antes de importar main', () => {
  const guardIndex = index.indexOf('initializeMaintenanceConciergeAccess');
  const mainIndex = index.indexOf("await import('/js/main.js?v=20260902-energy-loader-1')");
  assert.ok(guardIndex >= 0);
  assert.ok(mainIndex > guardIndex);
  assert.match(index, /await initializeMaintenanceConciergeAccess\(\)/);
});

test('el mapa normal de recepción queda preservado tras una fachada estable', () => {
  assert.match(mapFacade, /mapa-habitaciones-readonly\.js/);
  assert.match(mapFacade, /mapa-habitaciones-operativo\.js/);
  assert.match(mapFacade, /isMaintenanceConciergeUser/);
  assert.match(operationalMap, /showHabitacionOpcionesModal|renderFloorFilters/);
  assert.match(operationalMap, /checkTurnoActivo/);
});

test('el mapa restringido no abre modal, no exige turno y usa el RPC minimo', () => {
  assert.match(readonlyMap, /rpc\('mapa_mantenimiento_conserje'\)/);
  assert.match(readonlyMap, /aria-disabled/);
  assert.match(readonlyMap, /SOLO LECTURA/);
  assert.doesNotMatch(readonlyMap, /showHabitacionOpcionesModal/);
  assert.doesNotMatch(readonlyMap, /checkTurnoActivo/);
  assert.doesNotMatch(readonlyMap, /cliente_nombre/);
  assert.doesNotMatch(readonlyMap, /monto_total/);
  assert.doesNotMatch(readonlyMap, /monto_pagado/);
  assert.doesNotMatch(readonlyMap, /buildRoomCard[\s\S]*?onclick\s*=/);
});

test('el reloj se inicia después de insertar la tarjeta', () => {
  assert.match(readonlyMap, /const card = buildRoomCard\(room\);\s*list\.appendChild\(card\);\s*startRoomTimer\(room, list\);/);
});

test('notificaciones mapea el rol nuevo al canal mantenimiento', () => {
  assert.match(notifications, /role\.includes\('mantenimiento'\) \|\| role\.includes\('conserje'\)/);
  assert.match(notifications, /'mantenimiento'/);
});

test('mantenimiento reconoce roles modernos para autoasignar al encargado', () => {
  assert.match(repository, /usuarios_roles\(roles\(nombre\)\)/);
  assert.match(quickReport, /isMaintenanceAssigneeUser/);
  assert.match(quickReport, /role\.includes\('mantenimiento'\)/);
  assert.match(quickReport, /role\.includes\('conserje'\)/);
  assert.match(quickReport, /user\.usuarios_roles/);
});
