const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const service = fs.readFileSync('js/services/hotelTimeZoneService.js', 'utf8');
const client = fs.readFileSync('js/supabaseClient.js', 'utf8');
const config = fs.readFileSync('js/modules/configuracion/configuracion.js', 'utf8');
const reports = fs.readFileSync('js/modules/reportes/reportes-centro.js', 'utf8');
const dashboard = fs.readFileSync('js/modules/dashboard/dashboard.js', 'utf8');
const paymentDates = fs.readFileSync('js/mapa-fechas-abonos-inline.js', 'utf8');
const paymentHistory = fs.readFileSync('js/mapa-consumos-pagos-enhancer.js', 'utf8');
const calendar = fs.readFileSync('supabase/functions/calendar-create-event/index.ts', 'utf8');
const outlook = fs.readFileSync('supabase/functions/outlook-calendar-events/index.ts', 'utf8');
const energy = fs.readFileSync('supabase/functions/process-energy-alerts/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260903050000_hotel_timezone_systemwide.sql', 'utf8');

test('la zona operativa nunca depende del navegador como fallback implícito', () => {
  assert.match(service, /normalizeTimeZone\(value, fallback = DEFAULT_HOTEL_TIME_ZONE\)/);
  assert.match(service, /getRuntimeHotelTimeZone/);
  assert.match(service, /setRuntimeHotelTimeZone/);
  assert.match(service, /createHotelTimeZoneAwareSupabaseClient/);
  assert.match(service, /adjustLegacyHotelDayBoundary/);
});

test('el cliente global convierte cortes UTC legacy con la zona cargada desde Configuración', () => {
  assert.match(client, /createHotelTimeZoneAwareSupabaseClient/);
  assert.match(client, /const supabaseBase = createClient/);
  assert.match(client, /export const supabase = createHotelTimeZoneAwareSupabaseClient\(supabaseBase\)/);
  assert.match(service, /table === 'configuracion_hotel'/);
  assert.match(service, /ensureTimeZoneSelected/);
  assert.match(service, /property === 'gte' \|\| property === 'lte'/);
});

test('Configuración es la administración visible y Reportes queda solo lectura', () => {
  assert.match(config, /Zona horaria oficial del hotel/);
  assert.match(config, /\.from\('configuracion_hotel'\)/);
  assert.match(config, /zona_horaria: nextTimeZone/);
  assert.match(reports, /Se administra únicamente desde Configuración del hotel/);
});

test('base financiera, dashboard, mantenimiento y horarios consumen hotel_time_zone', () => {
  assert.match(migration, /FUNCTION public\.hotel_time_zone\(p_hotel_id uuid\)/);
  assert.match(migration, /FUNCTION public\.hotel_business_date/);
  assert.match(migration, /public\.hotel_business_date\(' \|\| r\.hotel_expr/);
  assert.match(migration, /hotel_business_date\(c\.hotel_id/);
  assert.match(migration, /hotel_business_date\(r\.hotel_id/);
  assert.match(migration, /get_dashboard_metrics/);
  assert.match(migration, /public\.hotel_time_zone\(p_hotel_id\)/);
  assert.match(migration, /mantenimiento_emitir_alertas/);
  assert.match(migration, /mantenimiento_metricas/);
  assert.match(migration, /preparar_tarea_mantenimiento_fase3/);
  assert.match(migration, /trg_horario_forzar_zona_hotel/);
  assert.match(migration, /trg_sincronizar_zona_horaria_configuracion/);
});

test('Dashboard agrupa días por la fecha operativa del hotel y no por UTC del navegador', () => {
  assert.match(dashboard, /getRuntimeHotelTimeZone/);
  assert.match(dashboard, /getTodayInTimeZone/);
  assert.match(dashboard, /getUtcRangeForHotelDates/);
  assert.match(dashboard, /\.select\('monto, business_date'\)/);
  assert.match(dashboard, /entry\.business_date/);
  assert.match(dashboard, /formatInTimeZone/);
  assert.doesNotMatch(dashboard, /T00:00:00\.000Z/);
  assert.doesNotMatch(dashboard, /T23:59:59\.999Z/);
  assert.doesNotMatch(dashboard, /toISOString\(\)\.slice\(0,\s*10\)/);
  assert.doesNotMatch(dashboard, /getFullYear\(\).*getMonth\(\).*getDate\(\)/s);
});

test('calendarios, alertas y fechas de pagos ya no fijan Bogotá localmente', () => {
  for (const source of [calendar, outlook, energy]) {
    assert.match(source, /hotel_time_zone/);
    assert.doesNotMatch(source, /timeZone:\s*['"]America\/Bogota['"]/);
  }
  for (const source of [paymentDates, paymentHistory]) {
    assert.match(source, /getRuntimeHotelTimeZone/);
    assert.match(source, /formatInTimeZone/);
    assert.doesNotMatch(source, /COLOMBIA_TIME_ZONE/);
  }
});
