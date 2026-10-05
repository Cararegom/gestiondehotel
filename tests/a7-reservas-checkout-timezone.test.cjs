const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');

async function loadHotelTimeZoneService() {
  const servicePath = path.join(root, 'js/services/hotelTimeZoneService.js');
  return import(`${pathToFileURL(servicePath).href}?a7=${Date.now()}`);
}

async function loadReservasCalculos() {
  const modulePath = path.join(root, 'js/modules/reservas/reservas-calculos.js');
  return import(`${pathToFileURL(modulePath).href}?a7=${Date.now()}`);
}

test('A7 interpreta datetime-local y checkout con la zona del hotel', async () => {
  const { calculateFechasEstancia } = await loadReservasCalculos();
  const result = calculateFechasEstancia(
    '2026-07-01T20:00',
    'noches_manual',
    '1',
    null,
    '12:00',
    [],
    'America/New_York'
  );

  assert.equal(result.errorFechas, null);
  assert.equal(result.fechaEntrada.toISOString(), '2026-07-02T00:00:00.000Z');
  assert.equal(result.fechaSalida.toISOString(), '2026-07-02T16:00:00.000Z');
});

test('A7 conserva noches de calendario aunque cambie el offset DST', async () => {
  const { calculateFechasEstancia } = await loadReservasCalculos();
  const result = calculateFechasEstancia(
    '2026-10-31T20:00',
    'noches_manual',
    '2',
    null,
    '12:00',
    [],
    'America/New_York'
  );

  assert.equal(result.errorFechas, null);
  assert.equal(result.fechaEntrada.toISOString(), '2026-11-01T00:00:00.000Z');
  assert.equal(result.fechaSalida.toISOString(), '2026-11-02T17:00:00.000Z');
});

test('A7 mantiene duraciones por minutos después de interpretar la llegada del hotel', async () => {
  const { calculateFechasEstancia } = await loadReservasCalculos();
  const result = calculateFechasEstancia(
    '2026-07-01T20:00',
    'tiempo_predefinido',
    '',
    'tres-horas',
    '12:00',
    [{ id: 'tres-horas', minutos: 180 }],
    'America/New_York'
  );

  assert.equal(result.errorFechas, null);
  assert.equal(result.fechaEntrada.toISOString(), '2026-07-02T00:00:00.000Z');
  assert.equal(result.fechaSalida.toISOString(), '2026-07-02T03:00:00.000Z');
});

test('A7 rechaza una hora local inexistente durante el salto DST', async () => {
  const { calculateFechasEstancia } = await loadReservasCalculos();
  const result = calculateFechasEstancia(
    '2026-03-08T02:30',
    'noches_manual',
    '1',
    null,
    '12:00',
    [],
    'America/New_York'
  );

  assert.equal(result.errorFechas, 'La fecha de entrada no es valida.');
});

test('A7 convierte instantes a valores datetime-local de la zona operativa', async () => {
  const { toDateTimeLocalValueInTimeZone } = await loadHotelTimeZoneService();

  assert.equal(
    toDateTimeLocalValueInTimeZone('2026-07-02T00:00:00.000Z', 'America/New_York'),
    '2026-07-01T20:00'
  );
  assert.equal(
    toDateTimeLocalValueInTimeZone('2026-07-02T00:00:00.000Z', 'America/Bogota'),
    '2026-07-01T19:00'
  );
});

test('A7 calcula el mínimo del formulario con el reloj del hotel', async () => {
  const uiPath = path.join(root, 'js/modules/reservas/reservas-ui.js');
  const { configureReservaFechaEntrada } = await import(`${pathToFileURL(uiPath).href}?a7=${Date.now()}`);
  const input = {};

  configureReservaFechaEntrada(input, 'America/New_York', new Date('2026-07-02T00:00:00.000Z'));

  assert.equal(input.min, '2026-07-01T19:45');
});

test('A7 aplica el mismo checkout al alquiler directo del mapa', async () => {
  const previousWindow = globalThis.window;
  globalThis.window = {};
  try {
    const mapaPath = path.join(root, 'js/modules/mapa-habitaciones/modales-alquiler.js');
    const { crearOpcionesNochesConPersonalizada } = await import(`${pathToFileURL(mapaPath).href}?a7=${Date.now()}`);
    const options = crearOpcionesNochesConPersonalizada(
      { checkout: '12:00', timeZone: 'America/New_York' },
      2,
      '2026-07-02T00:00:00.000Z'
    );

    assert.deepEqual(
      options.map((option) => option.fechaFin.toISOString()),
      ['2026-07-02T16:00:00.000Z', '2026-07-03T16:00:00.000Z']
    );
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('A7 conecta todas las rutas activas de reserva con el servicio horario central', () => {
  const calculos = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas-calculos.js'), 'utf8');
  const formulario = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas-formulario.js'), 'utf8');
  const reservas = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas.js'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'js/modules/reservas/reservas-ui.js'), 'utf8');
  const mapa = fs.readFileSync(path.join(root, 'js/modules/mapa-habitaciones/modales-alquiler.js'), 'utf8');

  assert.match(calculos, /getNearestCheckoutDateInTimeZone/);
  assert.match(calculos, /parseDateTimeInTimeZone/);
  assert.doesNotMatch(calculos, /\.setHours\(/);
  assert.doesNotMatch(calculos, /\.setDate\(/);
  assert.match(calculos, /state\.configHotel\.zona_horaria/);

  assert.match(formulario, /parseDateTimeInTimeZone/);
  assert.doesNotMatch(formulario, /new Date\(formData\.fecha_entrada\)/);

  assert.match(reservas, /toDateTimeLocalValueInTimeZone/);
  assert.doesNotMatch(reservas, /getTimezoneOffset\(\)/);

  assert.match(ui, /toDateTimeLocalValueInTimeZone/);
  assert.doesNotMatch(ui, /minDate\.getFullYear\(\)/);

  assert.match(mapa, /getNearestCheckoutDateInTimeZone/);
  assert.doesNotMatch(mapa, /\.setHours\(/);
});
