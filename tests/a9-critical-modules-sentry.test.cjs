const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const projectRoot = resolve(__dirname, '..');
const importFile = (path) => import(`data:text/javascript;base64,${readFileSync(resolve(projectRoot, path)).toString('base64')}`);

test('el reporter envia solo codigos estables y no copia datos del error original', async () => {
  const { reportHandledError } = await importFile('js/services/handledErrorReporter.js');
  const previousMonitoring = globalThis.HotelMonitoring;
  const previousTelemetry = globalThis.HotelTelemetry;
  const captured = [];
  globalThis.HotelMonitoring = {
    captureException: (error, context) => captured.push({ error, context })
  };
  delete globalThis.HotelTelemetry;

  try {
    const original = new Error('Reserva de Ana Perez, cedula 123456789 y correo ana@example.test');
    const reported = reportHandledError('Reservas', 'Submit Failed', original);

    assert.equal(reported.name, 'HandledOperationalError');
    assert.equal(reported.message, 'reservas.submit_failed');
    assert.equal(captured.length, 1);
    assert.equal(captured[0].error, reported);
    assert.deepEqual(captured[0].context, {
      source: 'reservas',
      eventType: 'submit_failed'
    });
    assert.equal(JSON.stringify(captured).includes('Ana Perez'), false);
    assert.equal(JSON.stringify(captured).includes('123456789'), false);
    assert.equal(JSON.stringify(captured).includes('ana@example.test'), false);
  } finally {
    if (previousMonitoring === undefined) delete globalThis.HotelMonitoring;
    else globalThis.HotelMonitoring = previousMonitoring;
    if (previousTelemetry === undefined) delete globalThis.HotelTelemetry;
    else globalThis.HotelTelemetry = previousTelemetry;
  }
});

test('el reporter usa HotelTelemetry como respaldo y nunca rompe el flujo', async () => {
  const { reportHandledError } = await importFile('js/services/handledErrorReporter.js');
  const previousMonitoring = globalThis.HotelMonitoring;
  const previousTelemetry = globalThis.HotelTelemetry;
  const captured = [];
  delete globalThis.HotelMonitoring;
  globalThis.HotelTelemetry = {
    captureException: (error, context) => captured.push({ error, context })
  };

  try {
    assert.doesNotThrow(() => reportHandledError('CAJA!', 'Estado bancario no disponible'));
    assert.equal(captured[0].error.message, 'caja.estado_bancario_no_disponible');
    assert.deepEqual(captured[0].context, {
      source: 'caja',
      eventType: 'estado_bancario_no_disponible'
    });

    globalThis.HotelTelemetry.captureException = () => { throw new Error('Sentry fuera de servicio'); };
    assert.doesNotThrow(() => reportHandledError('caja', 'render_failed'));
  } finally {
    if (previousMonitoring === undefined) delete globalThis.HotelMonitoring;
    else globalThis.HotelMonitoring = previousMonitoring;
    if (previousTelemetry === undefined) delete globalThis.HotelTelemetry;
    else globalThis.HotelTelemetry = previousTelemetry;
  }
});

test('reservas y caja no dejan fallos operativos en console.error', () => {
  const files = [
    'js/modules/reservas/reservas.js',
    'js/modules/reservas/reservas-calculos.js',
    'js/modules/reservas/reservas-data.js',
    'js/modules/reservas/reservas-descuentos.js',
    'js/modules/reservas/reservas-formulario.js',
    'js/modules/reservas/reservas-historial.js',
    'js/modules/reservas/reservas-lista-acciones.js',
    'js/modules/reservas/reservas-pagos.js',
    'js/modules/reservas/reservas-sync.js',
    'js/modules/caja/caja.js',
    'js/modules/caja/caja-cierre.js',
    'js/modules/caja/caja-movimientos.js',
    'js/modules/caja/caja-turnos.js'
  ];

  for (const file of files) {
    const source = readFileSync(resolve(projectRoot, file), 'utf8');
    assert.doesNotMatch(source, /console\.error\s*\(/, file);
    assert.match(source, /reportHandledError\s*\(/, file);
  }
});
