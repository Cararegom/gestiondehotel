const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const caja = fs.readFileSync(path.join(root, 'js/modules/caja/caja-cierre.js'), 'utf8');

test('B10 imprime el corte con la zona operativa del hotel', () => {
  assert.match(caja, /hotelTimeZoneService\.js/);
  assert.match(caja, /formatInTimeZone\(\s*new Date\(\),\s*getRuntimeHotelTimeZone\(\),\s*'es-CO'/);
  assert.doesNotMatch(caja, /new Date\(\)\.toLocaleString/);
});

test('B10 distingue el instante impreso entre dos zonas IANA', async () => {
  const serviceUrl = pathToFileURL(path.join(root, 'js/services/hotelTimeZoneService.js')).href;
  const { formatInTimeZone } = await import(`${serviceUrl}?b10=${Date.now()}`);
  const instant = '2026-09-07T02:30:00.000Z';
  const options = { dateStyle: 'full', timeStyle: 'medium' };

  const bogota = formatInTimeZone(instant, 'America/Bogota', 'es-CO', options);
  const madrid = formatInTimeZone(instant, 'Europe/Madrid', 'es-CO', options);

  assert.notEqual(bogota, madrid);
  assert.match(bogota, /6/);
  assert.match(madrid, /7/);
});
