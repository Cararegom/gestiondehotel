const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const automation = fs.readFileSync('supabase/migrations/20260902050000_mantenimiento_fase4_automatizacion.sql', 'utf8');
const metrics = fs.readFileSync('supabase/migrations/20260902050500_mantenimiento_fase4_metricas.sql', 'utf8');
const repository = fs.readFileSync('js/modules/mantenimiento/mantenimiento-repository.js', 'utf8');
const analyticsUi = fs.readFileSync('js/modules/mantenimiento/mantenimiento-analytics-ui.js', 'utf8');
const entry = fs.readFileSync('js/modules/mantenimiento/mantenimiento.js', 'utf8');

test('Fase 4 programa alertas con Supabase Cron usando la API de pg_cron', () => {
  assert.match(automation, /CREATE EXTENSION IF NOT EXISTS pg_cron/i);
  assert.match(automation, /cron\.schedule\(/);
  assert.match(automation, /mantenimiento-alertas-fase4/);
  assert.match(automation, /'\*\/5 \* \* \* \*'/);
  assert.doesNotMatch(automation, /INSERT\s+INTO\s+cron\.job/i);
  assert.doesNotMatch(automation, /UPDATE\s+cron\.job/i);
});

test('La activacion evita alertar masivamente tareas historicas', () => {
  assert.match(automation, /activado_en timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(automation, /tm\.creado_en >= c\.activado_en/);
  assert.match(automation, /INSERT INTO public\.mantenimiento_configuracion\(hotel_id, activado_en\)/);
});

test('Las alertas son idempotentes por tarea y tipo', () => {
  assert.match(automation, /UNIQUE \(tarea_id, tipo_alerta\)/);
  assert.match(automation, /ON CONFLICT \(tarea_id, tipo_alerta\) DO NOTHING/g);
  assert.match(automation, /sla_proximo/);
  assert.match(automation, /sla_vencido/);
  assert.match(automation, /preventivo_proximo/);
  assert.match(automation, /reincidencia/);
});

test('Las alertas reutilizan el centro de notificaciones y llegan a mantenimiento', () => {
  assert.match(automation, /INSERT INTO public\.notificaciones/);
  assert.match(automation, /'mantenimiento'::public\.rol_usuario_enum/);
  assert.match(automation, /'urgencia_operativa'::public\.tipo_notificacion_enum/);
  assert.match(automation, /'tarea_mantenimiento'::public\.tipo_notificacion_enum/);
  assert.match(automation, /'mantenimiento_requerido'::public\.tipo_notificacion_enum/);
});

test('La configuracion es tenant-safe y la tabla de deduplicacion no se expone al cliente', () => {
  assert.match(automation, /ALTER TABLE public\.mantenimiento_configuracion ENABLE ROW LEVEL SECURITY/);
  assert.match(automation, /fase1_actor_es_miembro_activo\(hotel_id\)/);
  assert.match(automation, /usuario_actual_es_admin_hotel\(hotel_id\)/);
  assert.match(automation, /ALTER TABLE public\.mantenimiento_alertas_emitidas ENABLE ROW LEVEL SECURITY/);
  assert.match(automation, /REVOKE ALL ON public\.mantenimiento_alertas_emitidas FROM anon, authenticated/);
});

test('El barrido automatico no queda disponible para usuarios autenticados', () => {
  assert.match(automation, /SECURITY INVOKER/);
  assert.match(automation, /REVOKE ALL ON FUNCTION public\.mantenimiento_emitir_alertas\(timestamptz\)[\s\S]*authenticated/);
  assert.match(automation, /GRANT EXECUTE ON FUNCTION public\.mantenimiento_emitir_alertas\(timestamptz\)[\s\S]*service_role/);
});

test('Las metricas se resuelven desde el hotel autenticado y no aceptan hotel arbitrario', () => {
  assert.match(metrics, /v_hotel uuid := public\.get_current_user_hotel_id\(\)/);
  assert.match(metrics, /SECURITY INVOKER/);
  assert.match(metrics, /tm\.hotel_id = v_hotel/g);
  assert.doesNotMatch(metrics, /p_hotel_id/);
});

test('El RPC gerencial incluye SLA, reincidencias, responsables y preventivos', () => {
  assert.match(metrics, /cumplimiento_sla_pct/);
  assert.match(metrics, /tiempo_promedio_resolucion_min/);
  assert.match(metrics, /'reincidencias'/);
  assert.match(metrics, /'categorias'/);
  assert.match(metrics, /'responsables'/);
  assert.match(metrics, /'preventivos'/);
});

test('El repositorio consume las metricas mediante RPC con periodo acotado', () => {
  assert.match(repository, /export async function getMaintenanceMetrics/);
  assert.match(repository, /rpc\('mantenimiento_metricas'/);
  assert.match(repository, /Math\.max\(7, Math\.min/);
});

test('La capa final conserva flujo Fase 3 y agrega control gerencial responsive', () => {
  assert.match(entry, /mantenimiento-analytics-ui\.js/);
  assert.match(analyticsUi, /mantenimiento-workflow-ui\.js/);
  assert.match(analyticsUi, /Control de mantenimiento/);
  assert.match(analyticsUi, /Reincidencias/);
  assert.match(analyticsUi, /Carga por responsable/);
  assert.match(analyticsUi, /Preventivos próximos/);
  assert.match(analyticsUi, /maintenanceChanged/);
  assert.match(analyticsUi, /setInterval\(\(\) => refreshMetrics\(false\), 60000\)/);
});
