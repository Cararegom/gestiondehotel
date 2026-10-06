const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = resolve(__dirname, '..');

async function loadPaginationService() {
  const modulePath = resolve(projectRoot, 'js/services/supabasePaginationService.js');
  return import(`${pathToFileURL(modulePath).href}?a11=${Date.now()}-${Math.random()}`);
}

function getFunctionSource(source, name, nextName) {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `No se encontro ${name}`);
  assert.notEqual(end, -1, `No se encontro ${nextName}`);
  return source.slice(start, end);
}

test('A11 obtiene todas las filas cuando el resultado supera una pagina de PostgREST', async () => {
  const { fetchAllWithPagination } = await loadPaginationService();
  const records = Array.from({ length: 2505 }, (_, index) => ({ id: index + 1 }));
  const ranges = [];
  const queryBuilder = {
    range: async (from, to) => {
      ranges.push([from, to]);
      return { data: records.slice(from, to + 1), error: null };
    }
  };

  const result = await fetchAllWithPagination(queryBuilder);

  assert.equal(result.error, null);
  assert.equal(result.data.length, 2505);
  assert.equal(result.data[0].id, 1);
  assert.equal(result.data.at(-1).id, 2505);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('A11 consulta una pagina final vacia cuando el total es multiplo exacto', async () => {
  const { fetchAllWithPagination } = await loadPaginationService();
  const records = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const ranges = [];
  const queryBuilder = {
    range: async (from, to) => {
      ranges.push([from, to]);
      return { data: records.slice(from, to + 1), error: null };
    }
  };

  const result = await fetchAllWithPagination(queryBuilder, { pageSize: 2 });

  assert.deepEqual(result.data, records);
  assert.deepEqual(ranges, [[0, 1], [2, 3], [4, 5]]);
});

test('A11 falla sin devolver un conjunto parcial si una pagina produce error', async () => {
  const { fetchAllWithPagination } = await loadPaginationService();
  const expectedError = new Error('timeout de PostgREST');
  let calls = 0;
  const queryBuilder = {
    range: async () => {
      calls += 1;
      if (calls === 1) return { data: [{ id: 1 }, { id: 2 }], error: null };
      return { data: null, error: expectedError };
    }
  };

  const result = await fetchAllWithPagination(queryBuilder, { pageSize: 2 });

  assert.equal(result.data, null);
  assert.equal(result.error, expectedError);
  assert.equal(calls, 2);
});

test('A11 rechaza respuestas ambiguas y tamanos de pagina invalidos', async () => {
  const { fetchAllWithPagination } = await loadPaginationService();
  const invalidResponse = await fetchAllWithPagination({
    range: async () => ({ data: null, error: null })
  });

  assert.equal(invalidResponse.data, null);
  assert.match(invalidResponse.error.message, /respuesta invalida/);
  await assert.rejects(
    () => fetchAllWithPagination({ range: async () => ({ data: [], error: null }) }, { pageSize: 0 }),
    /entero positivo/
  );
});

test('A11 pagina cada fuente de KPI y del comparativo gerencial', () => {
  const source = readFileSync(resolve(projectRoot, 'js/modules/reportes/reportes.js'), 'utf8');
  const kpiSource = getFunctionSource(source, 'fetchKPIData', 'generarReporteComparativoGerencial');
  const comparativoSource = getFunctionSource(source, 'generarReporteComparativoGerencial', 'mount');

  assert.equal((kpiSource.match(/fetchAllWithPagination\s*\(/g) || []).length, 4);
  assert.equal((comparativoSource.match(/fetchAllWithPagination\s*\(/g) || []).length, 9);
  assert.match(kpiSource, /habitaciones[\s\S]*head:\s*true/);
});

test('A11 pagina ocupacion, cierres, detalle e ingresos sin un corte silencioso local', () => {
  const reportes = readFileSync(resolve(projectRoot, 'js/modules/reportes/reportes.js'), 'utf8');
  const pagination = readFileSync(resolve(projectRoot, 'js/services/supabasePaginationService.js'), 'utf8');
  const expectedCalls = {
    generarReporteIngresosPorPeriodo: 'generarReporteIngresosTerraza',
    generarReporteOcupacion: 'mostrarDetalleCierreCajaModal',
    mostrarDetalleCierreCajaModal: 'generarReporteCierresDeCaja',
    generarReporteCierresDeCaja: 'generarReporteKPIsAvanzados'
  };

  for (const [name, nextName] of Object.entries(expectedCalls)) {
    const functionSource = getFunctionSource(reportes, name, nextName);
    assert.equal(
      (functionSource.match(/fetchAllWithPagination\s*\(/g) || []).length,
      1,
      name
    );
  }

  assert.equal((reportes.match(/fetchAllWithPagination\s*\(/g) || []).length, 20);
  assert.equal((reportes.match(/\.order\('id', \{ ascending: true \}\)/g) || []).length, 20);
  assert.doesNotMatch(pagination, /50000|50,000|break.*limite/i);
});
