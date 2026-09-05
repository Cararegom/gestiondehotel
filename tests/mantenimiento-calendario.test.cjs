const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCalendarDomain() {
  let source = fs.readFileSync('js/modules/mantenimiento/mantenimiento-calendario-domain.js', 'utf8');
  source = source
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  source += '\nthis.__api = { nextPlanOccurrenceDate, expandMaintenancePlanOccurrences, recurrenceFromPreset, getRecurrencePreset, normalizeReminderDays };';
  const context = { Date, Intl, Math, Number, String, Array, Set, Object };
  vm.runInNewContext(source, context);
  return context.__api;
}

test('la recurrencia semanal permanece anclada al dia programado', () => {
  const { nextPlanOccurrenceDate } = loadCalendarDomain();
  assert.equal(nextPlanOccurrenceDate('2026-09-07', '2026-09-07', 'semana', 1), '2026-09-14');
  assert.equal(nextPlanOccurrenceDate('2026-09-14', '2026-09-07', 'semana', 1), '2026-09-21');
});

test('soporta cada 15 dias y cada tres meses', () => {
  const { nextPlanOccurrenceDate } = loadCalendarDomain();
  assert.equal(nextPlanOccurrenceDate('2026-09-07', '2026-09-07', 'dia', 15), '2026-09-22');
  assert.equal(nextPlanOccurrenceDate('2026-09-07', '2026-09-07', 'mes', 3), '2026-12-07');
});

test('la recurrencia mensual conserva el dia ancla al volver a existir', () => {
  const { nextPlanOccurrenceDate } = loadCalendarDomain();
  assert.equal(nextPlanOccurrenceDate('2026-01-31', '2026-01-31', 'mes', 1), '2026-02-28');
  assert.equal(nextPlanOccurrenceDate('2026-02-28', '2026-01-31', 'mes', 1), '2026-03-31');
});

test('expande preventivos en calendario sin depender del cierre de tareas', () => {
  const { expandMaintenancePlanOccurrences } = loadCalendarDomain();
  const occurrences = expandMaintenancePlanOccurrences({
    id: 'plan-1',
    clase: 'preventivo',
    titulo: 'Revisar aires',
    fecha_inicio: '2026-09-07',
    recurrencia_unidad: 'semana',
    recurrencia_intervalo: 1,
    activo: true
  }, '2026-09-01', '2026-09-30');
  assert.deepEqual(
    Array.from(occurrences, (item) => item.date),
    ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']
  );
});

test('normaliza recordatorios y evita duplicados', () => {
  const { normalizeReminderDays } = loadCalendarDomain();
  assert.deepEqual(Array.from(normalizeReminderDays([30, 15, 7, 1, 0, 7])), [30, 15, 7, 1, 0]);
});

test('el dominio expone presets requeridos por operacion hotelera', () => {
  const source = fs.readFileSync('js/modules/mantenimiento/mantenimiento-calendario-domain.js', 'utf8');
  assert.match(source, /Cada 15 días/);
  assert.match(source, /Cada 3 meses/);
  assert.match(source, /Cada 6 meses/);
  assert.match(source, /Cada año/);
  assert.match(source, /Personalizada/);
});

test('el calendario permite crear desde una fecha y maneja vencimientos', () => {
  const ui = fs.readFileSync('js/modules/mantenimiento/mantenimiento-calendario-ui.js', 'utf8');
  assert.match(ui, /data-calendar-date/);
  assert.match(ui, /\+ Programar tarea/);
  assert.match(ui, /Vencimiento/);
  assert.match(ui, /getDefaultReminderDays/);
  assert.match(ui, /requiere_evidencia/);
  assert.match(ui, /checklist/);
});

test('el modulo principal monta y desmonta el calendario', () => {
  const analytics = fs.readFileSync('js/modules/mantenimiento/mantenimiento-analytics-ui.js', 'utf8');
  assert.match(analytics, /mountMaintenanceCalendar/);
  assert.match(analytics, /refreshMaintenanceCalendar/);
  assert.match(analytics, /unmountMaintenanceCalendar/);
});

test('la migracion crea planes aislados por hotel y solo administracion los modifica', () => {
  const migration = fs.readFileSync('supabase/migrations/20260905124500_mantenimiento_planes_calendario.sql', 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.mantenimiento_planes/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /usuario_actual_es_admin_hotel/);
  assert.match(migration, /actor_is_saas_superadmin/);
  assert.match(migration, /tareas_mantenimiento_plan_id_fkey/);
  assert.match(migration, /UNIQUE INDEX IF NOT EXISTS ux_tareas_mantenimiento_plan_fecha/);
});

test('la automatizacion usa zona horaria del hotel y alertas deduplicadas', () => {
  const migration = fs.readFileSync('supabase/migrations/20260905130000_mantenimiento_planes_automatizacion.sql', 'utf8');
  assert.match(migration, /hotel_business_date/);
  assert.match(migration, /mantenimiento_plan_alertas_emitidas/);
  assert.match(migration, /'mantenimiento'::public\.rol_usuario_enum/);
  assert.match(migration, /'admin'::public\.rol_usuario_enum/);
  assert.match(migration, /mantenimiento-calendario-planes/);
  assert.match(migration, /\*\/15 \* \* \* \*/);
});
