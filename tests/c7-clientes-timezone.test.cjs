const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const CLIENTES_PATH = path.join(ROOT, 'js/modules/clientes/clientes.js');

async function loadClientesModule() {
  const url = `${pathToFileURL(CLIENTES_PATH).href}?c7=${Date.now()}`;
  return import(url);
}

test('C7 convierte el dia operativo de Bogota a un rango UTC semiabierto', async () => {
  const { getClientCreatedAtUtcRange } = await loadClientesModule();
  assert.equal(typeof getClientCreatedAtUtcRange, 'function');

  const range = getClientCreatedAtUtcRange(
    { inicio: '2026-08-31', fin: '2026-08-31' },
    'America/Bogota'
  );

  assert.deepEqual(range, {
    timeZone: 'America/Bogota',
    startIso: '2026-08-31T05:00:00.000Z',
    endExclusiveIso: '2026-09-01T05:00:00.000Z'
  });
  assert.ok(Date.parse('2026-09-01T01:00:00.000Z') < Date.parse(range.endExclusiveIso));
});

test('C7 soporta filtros parciales y dias con cambio de horario', async () => {
  const { getClientCreatedAtUtcRange } = await loadClientesModule();

  assert.deepEqual(
    getClientCreatedAtUtcRange({ inicio: '2026-09-01' }, 'America/Bogota'),
    {
      timeZone: 'America/Bogota',
      startIso: '2026-09-01T05:00:00.000Z',
      endExclusiveIso: null
    }
  );
  assert.deepEqual(
    getClientCreatedAtUtcRange({ fin: '2026-09-01' }, 'America/Bogota'),
    {
      timeZone: 'America/Bogota',
      startIso: null,
      endExclusiveIso: '2026-09-02T05:00:00.000Z'
    }
  );

  const dst = getClientCreatedAtUtcRange(
    { inicio: '2026-11-01', fin: '2026-11-01' },
    'America/New_York'
  );
  assert.equal((Date.parse(dst.endExclusiveIso) - Date.parse(dst.startIso)) / 3600000, 25);
  assert.throws(
    () => getClientCreatedAtUtcRange(
      { inicio: '2026-09-02', fin: '2026-09-01' },
      'America/Bogota'
    ),
    /rango de fechas está invertido/i
  );
});

test('C7 aplica al query los limites ISO calculados y elimina la aritmetica UTC local', () => {
  const source = fs.readFileSync(CLIENTES_PATH, 'utf8');

  assert.match(source, /hotelTimeZoneService\.js/);
  assert.match(source, /getRuntimeHotelTimeZone/);
  assert.match(source, /getUtcRangeForHotelDates/);
  assert.match(source, /\.gte\('fecha_creado',\s*createdAtRange\.startIso\)/);
  assert.match(source, /\.lt\('fecha_creado',\s*createdAtRange\.endExclusiveIso\)/);
  assert.doesNotMatch(source, /new Date\(dateRange\.fin\)/);
  assert.doesNotMatch(source, /\.gte\('fecha_creado',\s*dateRange\.inicio\)/);
});
