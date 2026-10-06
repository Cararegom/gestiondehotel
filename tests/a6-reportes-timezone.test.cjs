const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(root, 'js/services/reportesTimeZoneService.js');
const reportesPath = path.join(root, 'js/modules/reportes/reportes.js');

async function loadService() {
  return import(`${pathToFileURL(servicePath).href}?a6=${Date.now()}`);
}

test('A6 usa por defecto la zona horaria activa del hotel', async () => {
  const hotelTimeZoneService = await import(pathToFileURL(
    path.join(root, 'js/services/hotelTimeZoneService.js')
  ).href);
  const { aggregateIncomeByHotelDate } = await loadService();

  hotelTimeZoneService.setRuntimeHotelTimeZone('America/New_York');
  try {
    assert.deepEqual(
      { ...aggregateIncomeByHotelDate([{ fecha_movimiento: '2026-09-05T02:30:00.000Z', monto: 50000 }]) },
      { '2026-09-04': 50000 }
    );
  } finally {
    hotelTimeZoneService.setRuntimeHotelTimeZone('America/Bogota');
  }
});

test('A6 agrupa ingresos por el día calendario del hotel', async () => {
  const { aggregateIncomeByHotelDate } = await loadService();
  const totals = aggregateIncomeByHotelDate([
    { fecha_movimiento: '2026-09-05T00:30:00.000Z', monto: 80000 },
    { fecha_movimiento: '2026-09-05T05:15:00.000Z', monto: 20000 },
    { fecha_movimiento: 'fecha-invalida', monto: 999 }
  ], 'America/Bogota');

  assert.deepEqual({ ...totals }, {
    '2026-09-04': 80000,
    '2026-09-05': 20000
  });
});

test('A6 clasifica un check-in e ingreso del viernes nocturno como viernes en Bogotá', async () => {
  const { calculateHotelWeekdayMetrics } = await loadService();
  const metrics = calculateHotelWeekdayMetrics({
    reservas: [{ fecha_inicio: '2026-09-05T01:00:00.000Z' }],
    movimientosIngreso: [{ fecha_movimiento: '2026-09-05T01:30:00.000Z', monto: 120000 }],
    startDate: '2026-09-04',
    endDate: '2026-09-06',
    timeZone: 'America/Bogota'
  });

  assert.equal(metrics.demandaPorDia[5], 1, 'viernes debe recibir el check-in');
  assert.equal(metrics.demandaPorDia[6], 0, 'sábado no debe recibir el check-in por usar UTC');
  assert.equal(metrics.ingresosPorDiaSemana[5], 120000);
  assert.equal(metrics.ingresosPorDiaSemana[6], 0);
  assert.equal(metrics.conteoDeDiasEnRango[5], 1);
  assert.equal(metrics.conteoDeDiasEnRango[6], 1);
  assert.equal(metrics.conteoDeDiasEnRango[0], 1);
});

test('A6 conserva las fechas de calendario durante cambios DST y produce límites semiabiertos', async () => {
  const { buildReportDateKeys, getReportUtcRange } = await loadService();

  assert.deepEqual(
    [...buildReportDateKeys('2026-10-31', '2026-11-02')],
    ['2026-10-31', '2026-11-01', '2026-11-02']
  );
  assert.deepEqual(
    { ...getReportUtcRange('2026-11-01', '2026-11-01', 'America/New_York') },
    {
      timeZone: 'America/New_York',
      startIso: '2026-11-01T04:00:00.000Z',
      endExclusiveIso: '2026-11-02T05:00:00.000Z'
    }
  );
});

test('A6 conecta reportes.js al servicio y elimina las clasificaciones UTC auditadas', () => {
  const source = fs.readFileSync(reportesPath, 'utf8');

  assert.match(source, /reportesTimeZoneService\.js/);
  assert.match(source, /aggregateIncomeByHotelDate/);
  assert.match(source, /calculateHotelWeekdayMetrics/);
  assert.match(source, /getReportUtcRange/);
  assert.match(source, /\.lt\('fecha_movimiento', reportRange\.endExclusiveIso\)/);
  assert.doesNotMatch(source, /getUTCDay\(\)/);
  assert.doesNotMatch(source, /setUTCDate\(d\.getUTCDate\(\) \+ 1\)/);
  assert.doesNotMatch(source, /mov\.fecha_movimiento\.slice\(0, 10\)/);
});
