const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const enhancer = fs.readFileSync('js/mapa-fechas-abonos-inline.js', 'utf8');
const appIndex = fs.readFileSync('app/index.html', 'utf8');

test('Ver consumos muestra la fecha del pago junto a cada servicio pagado', () => {
  assert.match(enhancer, /pago_reserva_id/);
  assert.match(enhancer, /fecha_servicio/);
  assert.match(enhancer, /\.from\('pagos_reserva'\)/);
  assert.match(enhancer, /\.select\('id, fecha_pago'\)/);
  assert.match(enhancer, /Pagado: \$\{paymentDate\}/);
  assert.match(enhancer, /paymentDateInline/);
});

test('las fechas se consultan por hotel y reserva y no crean movimientos', () => {
  assert.match(enhancer, /\.eq\('hotel_id', hotelId\)/);
  assert.match(enhancer, /\.eq\('reserva_id', reservation\.id\)/);
  assert.doesNotMatch(enhancer, /\.insert\(/);
  assert.doesNotMatch(enhancer, /\.update\(/);
  assert.doesNotMatch(enhancer, /\.delete\(/);
});

test('el asset de fechas tiene cache bust dedicado', () => {
  assert.match(appIndex, /\/js\/mapa-fechas-abonos-inline\.js\?v=20260902-fechas-abonos-2/);
});
