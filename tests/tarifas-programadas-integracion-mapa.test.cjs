const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const bootstrap = fs.readFileSync('js/mapa-tarifas-programadas-bootstrap.js', 'utf8');
const reservasCalculos = fs.readFileSync('js/modules/reservas/reservas-calculos.js', 'utf8');
const pricingService = fs.readFileSync('js/services/tarifasProgramadasService.js', 'utf8');
const index = fs.readFileSync('app/index.html', 'utf8');

test('Mapa y Reservas consumen el mismo motor central de tarifas programadas', () => {
  assert.match(bootstrap, /tarifasProgramadasService\.js/);
  assert.match(reservasCalculos, /tarifasProgramadasService\.js/);
  assert.match(bootstrap, /calcularEstanciaNochesProgramada/);
  assert.match(reservasCalculos, /calcularEstanciaNochesProgramada/);
  assert.match(bootstrap, /resolverPrecioTiempoEstancia/);
  assert.match(reservasCalculos, /resolverPrecioTiempoEstancia/);
});

test('el alquiler directo del mapa intercepta el flujo antes del cálculo legacy', () => {
  assert.match(bootstrap, /#btn-alquilar-directo/);
  assert.match(bootstrap, /openDirectRentWithScheduledTariffs/);
  assert.match(bootstrap, /event\.stopImmediatePropagation\(\)/);
  assert.match(index, /mapa-tarifas-programadas-bootstrap\.js/);
});

test('Extender estancia usa la fecha de salida actual como inicio tarifario', () => {
  assert.match(bootstrap, /#btn-extender-tiempo/);
  assert.match(bootstrap, /openExtensionWithScheduledTariffs/);
  assert.match(bootstrap, /activeReservation\.fecha_fin/);
  assert.match(bootstrap, /extensionStart/);
  assert.match(bootstrap, /showExtenderTiempoModal/);
});

test('las extensiones por horas reciben el total programado incluyendo huéspedes adicionales', () => {
  assert.match(bootstrap, /mode === 'extension'/);
  assert.match(bootstrap, /Number\(priceResult\.total\)/);
  assert.match(bootstrap, /timesByMinutes/);
});

test('las noches separan hospedaje y huésped adicional para no duplicar cargos', () => {
  assert.match(bootstrap, /montoHospedaje/);
  assert.match(bootstrap, /montoHuespedesAdicionales/);
  assert.match(bootstrap, /averageExtraGuestUnit/);
  assert.doesNotMatch(bootstrap, /scheduled\.total\s*\/\s*scheduled\.nights/);
});

test('el motor conserva fallback a los precios base si no hay regla programada', () => {
  assert.match(pricingService, /resolveBaseNightPrice/);
  assert.match(pricingService, /programmedOccupancyPrice\s*\?\?\s*baseNightPrice/);
  assert.match(pricingService, /programmedPrice\s*\?\?\s*basePrice/);
});
