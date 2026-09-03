const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

async function loadTimeZoneService() {
  const url = pathToFileURL(path.join(root, 'js/services/hotelTimeZoneService.js')).href;
  return import(url);
}

test('los cortes de reportes respetan la medianoche del hotel y no UTC', async () => {
  const service = await loadTimeZoneService();
  const bogota = service.getUtcRangeForHotelDates('2026-09-01', '2026-09-02', 'America/Bogota');
  assert.equal(bogota.startIso, '2026-09-01T05:00:00.000Z');
  assert.equal(bogota.endExclusiveIso, '2026-09-03T05:00:00.000Z');
  assert.equal(
    service.getDateKeyInTimeZone('2026-09-01T00:35:16.145Z', 'America/Bogota'),
    '2026-08-31'
  );
});

test('los rangos soportan zonas con horario de verano', async () => {
  const service = await loadTimeZoneService();
  const spring = service.getUtcRangeForHotelDates('2026-03-08', '2026-03-08', 'America/New_York');
  const fall = service.getUtcRangeForHotelDates('2026-11-01', '2026-11-01', 'America/New_York');
  assert.equal((Date.parse(spring.endExclusiveIso) - Date.parse(spring.startIso)) / 3600000, 23);
  assert.equal((Date.parse(fall.endExclusiveIso) - Date.parse(fall.startIso)) / 3600000, 25);
});

test('el centro de Reportes corrige los límites UTC legacy usando la zona del hotel', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/reportes/reportes-centro.js'), 'utf8');
  assert.match(source, /hotelTimeZoneService\.js/);
  assert.match(source, /select\('zona_horaria'\)/);
  assert.match(source, /adjustLegacyReportBoundary/);
  assert.match(source, /getUtcRangeForHotelDates/);
  assert.match(source, /createTimeZoneAwareReportClient/);
  assert.match(source, /UTC_DAY_START_RE/);
  assert.match(source, /UTC_DAY_END_RE/);
});

test('un administrador puede configurar la zona IANA del hotel desde Reportes', () => {
  const source = fs.readFileSync(path.join(root, 'js/modules/reportes/reportes-centro.js'), 'utf8');
  const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260903042000_hotel_timezone_reportes.sql'), 'utf8');
  assert.match(source, /id="reportes-zona-horaria"/);
  assert.match(source, /update\(\{ zona_horaria: nextZone/);
  assert.match(source, /Corte diario según zona horaria del hotel/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS zona_horaria text/);
  assert.match(migration, /hotel_business_date/);
});
