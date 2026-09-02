const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const entry = fs.readFileSync('js/modules/mantenimiento/mantenimiento.js', 'utf8');
const analyticsUi = fs.readFileSync('js/modules/mantenimiento/mantenimiento-analytics-ui.js', 'utf8');
const workflowUi = fs.readFileSync('js/modules/mantenimiento/mantenimiento-workflow-ui.js', 'utf8');
const ui = fs.readFileSync('js/modules/mantenimiento/mantenimiento-mobile-ui.js', 'utf8');
const domain = fs.readFileSync('js/modules/mantenimiento/mantenimiento-domain.js', 'utf8');
const repository = fs.readFileSync('js/modules/mantenimiento/mantenimiento-repository.js', 'utf8');
const preventive = fs.readFileSync('js/modules/mantenimiento/mantenimiento-preventivo.js', 'utf8');
const evidence = fs.readFileSync('js/modules/mantenimiento/mantenimiento-evidencias.js', 'utf8');
const enumMigration = fs.readFileSync('supabase/migrations/20260902032000_mantenimiento_tipo_profesional.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260902032500_mantenimiento_fase1_hardening.sql', 'utf8');
const roomStateHardening = fs.readFileSync('supabase/migrations/20260902033500_mantenimiento_fase1_estado_habitacion.sql', 'utf8');

test('maintenance entrypoint remains a small stable facade after the analytics evolution', () => {
  assert.ok(entry.split(/\r?\n/).length < 15);
  assert.match(entry, /mantenimiento-analytics-ui\.js/);
  assert.match(analyticsUi, /mantenimiento-workflow-ui\.js/);
  assert.match(workflowUi, /mantenimiento-mobile-ui\.js/);
  assert.match(ui, /mantenimiento-domain\.js/);
  assert.match(ui, /mantenimiento-repository\.js/);
  assert.match(ui, /mantenimiento-preventivo\.js/);
  assert.match(ui, /mantenimiento-evidencias\.js/);
});

test('maintenance professional types are persisted directly and legacy marker is only read for compatibility', () => {
  assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'bloqueante'/i);
  assert.match(enumMigration, /ADD VALUE IF NOT EXISTS 'programado'/i);
  assert.match(hardening, /SET tipo = 'programado'/i);
  assert.match(hardening, /SET tipo = 'bloqueante'/i);
  assert.match(hardening, /REPLACE\(COALESCE\(descripcion, ''\), '\[PROGRAMADO\]'/i);
  assert.doesNotMatch(ui, /\[PROGRAMADO\]/);
  assert.match(domain, /LEGACY_PROGRAMMED_MARKER/);
});

test('active frontend no longer cancels reservations or timers when maintenance is created', () => {
  assert.doesNotMatch(ui, /cancelada_mantenimiento/);
  assert.doesNotMatch(ui, /from\(['"]reservas['"]\)/);
  assert.doesNotMatch(ui, /from\(['"]cronometros['"]\)/);
  assert.match(hardening, /MANTENIMIENTO_HABITACION_OCUPADA/);
  assert.match(hardening, /impedir_activar_reserva_en_mantenimiento/);
});

test('task creation remains idempotent and guards repeated submit', () => {
  assert.match(hardening, /solicitud_id uuid/);
  assert.match(hardening, /ux_tareas_mantenimiento_solicitud_id/);
  assert.match(ui, /submit\.disabled = true/);
  assert.match(ui, /solicitud_id: requestId/);
});

test('completion records the actual actor and does not delete audit history with users', () => {
  assert.match(ui, /realizada_por: completed/);
  assert.match(hardening, /NEW\.realizada_por := v_actor/);
  assert.match(hardening, /ON DELETE SET NULL/);
  assert.doesNotMatch(hardening, /ON DELETE CASCADE/);
});

test('new maintenance evidence uses private tenant-isolated storage and signed URLs', () => {
  assert.match(hardening, /'mantenimiento-evidencias'/);
  assert.match(hardening, /false,\s*12582912/);
  assert.match(hardening, /split_part\(name, '\/', 1\) = public\.get_current_user_hotel_id\(\)::text/);
  assert.match(evidence, /createSignedUrl/);
  assert.doesNotMatch(evidence, /getPublicUrl/);
});

test('maintenance queries are indexed and tenant scoped', () => {
  assert.match(hardening, /ix_tareas_mantenimiento_hotel_estado_fecha/);
  assert.match(hardening, /ix_tareas_mantenimiento_hotel_habitacion_estado/);
  assert.match(hardening, /ix_tareas_mantenimiento_hotel_asignada_estado/);
  assert.match(repository, /\.eq\('hotel_id', hotelId\)/);
  assert.match(hardening, /FOR UPDATE TO authenticated[\s\S]*WITH CHECK/);
});

test('blocked room cannot escape maintenance state before its blocking task is resolved', () => {
  assert.match(roomStateHardening, /mantenimiento_habitacion_tiene_bloqueo\(NEW\.id\)/);
  assert.match(roomStateHardening, /NEW\.estado := 'mantenimiento'/);
  assert.match(roomStateHardening, /HABITACION_BLOQUEADA_MANTENIMIENTO/);
});

test('realtime subscription is filtered by hotel', () => {
  assert.match(ui, /filter: `hotel_id=eq\.\$\{hotelId\}`/);
});

test('preventive scheduling remains isolated from UI', () => {
  assert.match(preventive, /calculateNextScheduledDate/);
  assert.match(preventive, /findOpenPreventiveTask/);
  assert.match(preventive, /createNextPreventiveTask/);
});
