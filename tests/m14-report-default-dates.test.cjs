const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const reportesSource = fs.readFileSync(path.join(root, 'js/modules/reportes/reportes.js'), 'utf8');
const centerSource = fs.readFileSync(path.join(root, 'js/modules/reportes/reportes-centro-core.js'), 'utf8');

async function loadService() {
  const servicePath = path.join(root, 'js/services/reportesTimeZoneService.js');
  return import(`${pathToFileURL(servicePath).href}?m14=${Date.now()}-${Math.random()}`);
}

test('M14 usa la fecha operativa de Bogota cuando UTC ya esta en el dia siguiente', async () => {
  const { getDefaultReportDateRange } = await loadService();

  assert.deepEqual(getDefaultReportDateRange({
    timeZone: 'America/Bogota',
    now: new Date('2026-09-07T02:00:00.000Z'),
  }), {
    startDate: '2026-08-07',
    endDate: '2026-09-06',
  });
});

test('M14 respeta zonas adelantadas y cruces de mes y anio', async () => {
  const { getDefaultReportDateRange } = await loadService();

  assert.deepEqual(getDefaultReportDateRange({
    timeZone: 'Pacific/Kiritimati',
    now: new Date('2026-01-01T10:30:00.000Z'),
  }), {
    startDate: '2025-12-03',
    endDate: '2026-01-02',
  });
});

test('M14 permite ventanas configurables sin depender de la zona del navegador', async () => {
  const { getDefaultReportDateRange } = await loadService();

  assert.deepEqual(getDefaultReportDateRange({
    timeZone: 'America/New_York',
    now: new Date('2026-03-08T04:30:00.000Z'),
    daysBack: 7,
  }), {
    startDate: '2026-02-28',
    endDate: '2026-03-07',
  });
});

test('M14 conecta ambas superficies al helper y elimina los defaults UTC auditados', () => {
  assert.match(reportesSource, /getDefaultReportDateRange\(\)/);
  assert.match(centerSource, /getDefaultReportDateRange\(\{ timeZone: context\.hotelTimeZone \}\)/);
  assert.doesNotMatch(reportesSource, /thirtyDaysAgo\.toISOString\(\)|today\.toISOString\(\)\.split\('T'\)/);
  assert.doesNotMatch(centerSource, /addCalendarDays\(today, -30\)/);
});
