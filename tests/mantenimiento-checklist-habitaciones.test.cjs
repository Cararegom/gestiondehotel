const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('la migracion crea alcance y control por habitacion', () => {
  const sql = fs.readFileSync('supabase/migrations/20260905181000_mantenimiento_checklist_todas_habitaciones.sql', 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS alcance/);
  assert.match(sql, /todas_habitaciones/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.mantenimiento_tarea_habitaciones/);
  assert.match(sql, /mantenimiento_inicializar_habitaciones_tarea/);
  assert.match(sql, /mantenimiento_actualizar_habitacion_tarea/);
  assert.match(sql, /HABITACIONES_MANTENIMIENTO_PENDIENTES/);
  assert.match(sql, /h\.activo IS DISTINCT FROM false/);
});

test('el repositorio expone lectura y actualizacion de habitaciones de una tarea', () => {
  const repository = fs.readFileSync('js/modules/mantenimiento/mantenimiento-repository.js', 'utf8');
  assert.match(repository, /'alcance'/);
  assert.match(repository, /listMaintenanceTaskRooms/);
  assert.match(repository, /updateMaintenanceTaskRoom/);
  assert.match(repository, /mantenimiento_actualizar_habitacion_tarea/);
});

test('la interfaz permite alcance todas las habitaciones y progreso individual', () => {
  const ui = fs.readFileSync('js/modules/mantenimiento/mantenimiento-habitaciones-ui.js', 'utf8');
  const analytics = fs.readFileSync('js/modules/mantenimiento/mantenimiento-analytics-ui.js', 'utf8');
  assert.match(ui, /Todas las habitaciones/);
  assert.match(ui, /Checklist por habitaciones/);
  assert.match(ui, /Con novedad/);
  assert.match(ui, /No aplica/);
  assert.match(ui, /Faltan \$\{pending\}/);
  assert.match(ui, /maintenance-calendar-plan-save/);
  assert.match(analytics, /mountMaintenanceRoomChecklists/);
  assert.match(analytics, /unmountMaintenanceRoomChecklists/);
});
