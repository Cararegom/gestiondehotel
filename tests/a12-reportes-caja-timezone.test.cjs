const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = resolve(__dirname, '..');

async function loadReportTimeZoneService() {
  const modulePath = resolve(projectRoot, 'js/services/reportesTimeZoneService.js');
  return import(`${pathToFileURL(modulePath).href}?a12=${Date.now()}-${Math.random()}`);
}

function getFunctionSource(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `No se encontro ${name}`);
  assert.notEqual(end, -1, `No se encontro ${nextName}`);
  return source.slice(start, end);
}

test('A12 incluye los movimientos en el dia calendario de Bogota', async () => {
  const { aggregateIncomeByHotelDate, getReportUtcRange } = await loadReportTimeZoneService();
  const range = getReportUtcRange('2026-09-01', '2026-09-01', 'America/Bogota');
  const totals = aggregateIncomeByHotelDate([
    { fecha_movimiento: '2026-09-01T04:59:59.999Z', monto: 10 },
    { fecha_movimiento: '2026-09-01T05:00:00.000Z', monto: 20 },
    { fecha_movimiento: '2026-09-02T04:59:59.999Z', monto: 30 },
    { fecha_movimiento: '2026-09-02T05:00:00.000Z', monto: 40 }
  ], 'America/Bogota');

  assert.equal(range.startIso, '2026-09-01T05:00:00.000Z');
  assert.equal(range.endExclusiveIso, '2026-09-02T05:00:00.000Z');
  assert.deepEqual(totals, {
    '2026-08-31': 10,
    '2026-09-01': 50,
    '2026-09-02': 40
  });
});

test('A12 agrupa periodos con la zona del hotel y admite creado_en como respaldo', async () => {
  const { aggregateAmountsByHotelPeriod } = await loadReportTimeZoneService();
  const rows = [
    { fecha_movimiento: '2026-02-01T04:30:00.000Z', monto: 10 },
    { creado_en: '2026-02-01T05:30:00.000Z', monto: '25' }
  ];

  assert.deepEqual(aggregateAmountsByHotelPeriod(rows, 'diario', 'America/Bogota'), {
    '2026-01-31': 10,
    '2026-02-01': 25
  });
  assert.deepEqual(aggregateAmountsByHotelPeriod(rows, 'mensual', 'America/Bogota'), {
    '2026-M01': 10,
    '2026-M02': 25
  });
});

test('A12 calcula el periodo comparativo por dias de hotel incluso durante DST', async () => {
  const { getReportComparisonRanges } = await loadReportTimeZoneService();
  const ranges = getReportComparisonRanges('2026-03-08', '2026-03-08', 'America/New_York');

  assert.equal(ranges.totalDays, 1);
  assert.equal(ranges.previousStartDate, '2026-03-07');
  assert.equal(ranges.previousEndDate, '2026-03-07');
  assert.equal((Date.parse(ranges.current.endExclusiveIso) - Date.parse(ranges.current.startIso)) / 3600000, 23);
  assert.equal((Date.parse(ranges.previous.endExclusiveIso) - Date.parse(ranges.previous.startIso)) / 3600000, 24);
});

test('A12 elimina los cortes UTC fijos de todas las rutas auditadas de Reportes', () => {
  const source = readFileSync(resolve(projectRoot, 'js/modules/reportes/reportes.js'), 'utf8');
  const expectedRangeFunctions = {
    generarReporteListadoReservas: 'generarReporteIngresosPorPeriodo',
    generarReporteIngresosPorPeriodo: 'generarReporteIngresosTerraza',
    generarReporteIngresosTerraza: 'generarReporteFinancieroGlobal',
    generarReporteFinancieroGlobal: 'generarReporteOcupacion',
    generarReporteOcupacion: 'mostrarDetalleCierreCajaModal',
    generarReporteCierresDeCaja: 'generarReporteKPIsAvanzados'
  };

  assert.doesNotMatch(source, /T00:00:00\.000Z|T23:59:59\.999Z/);
  for (const [name, nextName] of Object.entries(expectedRangeFunctions)) {
    const functionSource = getFunctionSource(source, name, nextName);
    assert.match(functionSource, /getReportUtcRange\s*\(/, name);
    assert.match(functionSource, /\.lt\('[^']+',\s*reportRange\.endExclusiveIso\)/, name);
    assert.doesNotMatch(functionSource, /\.lte\('(fecha_inicio|fecha_movimiento|fecha_cierre)'/, name);
  }
});

test('A12 usa rangos comparables y agrupaciones segun el calendario del hotel', () => {
  const source = readFileSync(resolve(projectRoot, 'js/modules/reportes/reportes.js'), 'utf8');
  const comparative = getFunctionSource(source, 'generarReporteComparativoGerencial', 'mount');
  const occupancy = getFunctionSource(source, 'generarReporteOcupacion', 'mostrarDetalleCierreCajaModal');

  assert.match(source, /aggregateIncomeByHotelDate\(movimientos\)/);
  assert.match(source, /aggregateAmountsByHotelPeriod\(movimientos, agrupacion\)/);
  assert.match(comparative, /getReportComparisonRanges\(fechaInicioInput, fechaFinInput\)/);
  assert.equal((comparative.match(/\.lt\('[^']+',\s*(?:currentRange|previousRange)\.endExclusiveIso\)/g) || []).length, 8);
  assert.doesNotMatch(comparative, /periodLengthMs|\.lte\('(fecha_inicio|fecha_movimiento|creado_en)'/);
  assert.match(occupancy, /buildReportDateKeys\(fechaInicioInput, fechaFinInput\)/);
  assert.match(occupancy, /getReportUtcRange\(currentDateStr, currentDateStr\)/);
});
