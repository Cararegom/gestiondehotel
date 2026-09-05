const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260905184500_mantenimiento_incidencias_desde_checklist.sql', 'utf8');
const ui = fs.readFileSync('js/modules/mantenimiento/mantenimiento-incidencias-ui.js', 'utf8');
const entry = fs.readFileSync('js/modules/mantenimiento/mantenimiento.js', 'utf8');

test('una novedad por habitación puede convertirse en una tarea vinculada e idempotente', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS incidencia_tarea_id uuid/);
  assert.match(migration, /mantenimiento_crear_incidencia_desde_habitacion/);
  assert.match(migration, /IF v_item\.incidencia_tarea_id IS NOT NULL/);
  assert.match(migration, /IF v_item\.estado <> 'novedad'/);
  assert.match(migration, /INCIDENCIA_REQUIERE_OBSERVACION/);
  assert.match(migration, /Corregir novedad · Habitación/);
  assert.match(migration, /'programado'::public\.tipo_tarea_enum/);
  assert.match(migration, /UPDATE public\.mantenimiento_tarea_habitaciones[\s\S]*incidencia_tarea_id = v_incident\.id/);
});

test('el backend impide cerrar la revisión general con novedades sin seguimiento', () => {
  assert.match(migration, /mantenimiento_exigir_incidencias_novedades/);
  assert.match(migration, /mth\.estado = 'novedad'/);
  assert.match(migration, /mth\.incidencia_tarea_id IS NULL/);
  assert.match(migration, /INCIDENCIAS_MANTENIMIENTO_PENDIENTES/);
  assert.match(migration, /BEFORE UPDATE OF estado ON public\.tareas_mantenimiento/);
});

test('la interfaz ofrece crear y abrir la incidencia y conserva la fachada pequeña', () => {
  assert.match(ui, /Crear incidencia/);
  assert.match(ui, /Incidencia vinculada/);
  assert.match(ui, /mantenimiento_crear_incidencia_desde_habitacion/);
  assert.match(ui, /maintenance-room-incident-create/);
  assert.match(ui, /sin incidencia/);
  assert.match(entry, /mountMaintenanceIncidentActions/);
  assert.match(entry, /unmountMaintenanceIncidentActions/);
  assert.ok(entry.split(/\r?\n/).length < 15);
});
