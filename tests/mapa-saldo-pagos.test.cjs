const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const datos = fs.readFileSync('js/modules/mapa-habitaciones/datos.js', 'utf8');
const gestion = fs.readFileSync('js/modules/mapa-habitaciones/modales-gestion.js', 'utf8');
const alquiler = fs.readFileSync('js/modules/mapa-habitaciones/modales-alquiler.js', 'utf8');

test('el mapa reconoce pagos historicos sin duplicar pagos normalizados', () => {
  assert.match(datos, /select\('monto_total, monto_pagado'\)/);
  assert.match(datos, /Math\.max\(pagosRegistrados, Number\(reserva\?\.monto_pagado \|\| 0\)\)/);
  assert.match(gestion, /Math\.max\(pagosRegistrados, asInt\(reserva\.monto_pagado\)\)/);
});

test('una reserva nueva no se declara pagada antes de persistir el pago', () => {
  assert.match(alquiler, /pagosLimpios\.length > 0 && !turnoActivoId/);
  assert.match(alquiler, /monto_pagado: 0/);
  assert.match(alquiler, /procesarPagosReservaAtomicos/);
});
