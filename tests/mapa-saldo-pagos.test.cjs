const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const datos = fs.readFileSync('js/modules/mapa-habitaciones/datos.js', 'utf8');
const gestion = fs.readFileSync('js/modules/mapa-habitaciones/modales-gestion.js', 'utf8');
const alquiler = fs.readFileSync('js/modules/mapa-habitaciones/modales-alquiler.js', 'utf8');
const saldoMapa = fs.readFileSync('js/mapa-saldo-enhancer.js', 'utf8');
const pagosConsumos = fs.readFileSync('js/mapa-consumos-pagos-enhancer.js', 'utf8');
const appIndex = fs.readFileSync('app/index.html', 'utf8');

test('el mapa reconoce pagos historicos sin duplicar pagos normalizados', () => {
  assert.match(datos, /select\('monto_total, monto_pagado'\)/);
  assert.match(datos, /Math\.max\(pagosRegistrados, Number\(reserva\?\.monto_pagado \|\| 0\)\)/);
  assert.match(gestion, /Math\.max\(pagosRegistrados, asInt\(reserva\.monto_pagado\)\)/);
});

test('liberar habitacion no vuelve a cobrar consumos que ya figuran pagados', () => {
  assert.match(datos, /calcularPagoExternoVentas/);
  assert.match(datos, /deudaPendienteCobrable/);
  assert.match(datos, /saldoPendiente: Math\.max\(0, deudaPendienteCobrable - Number\(totalPagado \|\| 0\)\)/);
  assert.match(datos, /select\('id, total_venta, estado_pago'\)/);
  assert.match(datos, /select\('id, monto_total, total_venta, estado_pago'\)/);
  assert.match(datos, /select\('tipo, monto, venta_tienda_id'\)/);
  assert.match(datos, /select\('tipo, monto, venta_restaurante_id'\)/);
  assert.match(datos, /resultados\.find\(\(resultado\) => resultado\.error\)/);
  assert.match(gestion, /calcularResumenSaldoCheckout\(\{/);
  assert.doesNotMatch(gestion, /totalPagado - totalExtrasPagados/);
});

test('una reserva nueva no se declara pagada antes de persistir el pago', () => {
  assert.match(alquiler, /pagosLimpios\.length > 0 && !turnoActivoId/);
  assert.match(alquiler, /monto_pagado: 0/);
  assert.match(alquiler, /procesarPagosReservaAtomicos/);
});

test('el mapa muestra saldo real reutilizando la misma fuente financiera del checkout', () => {
  assert.match(saldoMapa, /import \{ calcularResumenSaldoCheckout \} from '\.\/modules\/mapa-habitaciones\/datos\.js'/);
  assert.match(saldoMapa, /import \{ formatCurrency \} from '\.\/uiUtils\.js'/);
  assert.match(saldoMapa, /calcularResumenSaldoCheckout\(\{/);
  assert.match(saldoMapa, /saldoPendiente/);
  assert.match(saldoMapa, /Debe \$\{formatCurrency/);
  assert.match(saldoMapa, /'Al día'/);
  assert.match(appIndex, /\/js\/mapa-saldo-enhancer\.js\?v=20260902-mapa-saldo-1/);
});

test('el saldo del mapa se carga en lote y siempre queda aislado por hotel', () => {
  assert.match(saldoMapa, /\.eq\('hotel_id', hotelId\)/);
  assert.match(saldoMapa, /\.in\('reserva_id', reservaIds\)/);
  assert.match(saldoMapa, /Promise\.all\(\[/);
  assert.match(saldoMapa, /servicios_x_reserva/);
  assert.match(saldoMapa, /ventas_tienda/);
  assert.match(saldoMapa, /ventas_restaurante/);
  assert.match(saldoMapa, /pagos_reserva/);
  assert.match(saldoMapa, /\.from\('caja'\)/);
  assert.doesNotMatch(saldoMapa, /\.insert\(/);
  assert.doesNotMatch(saldoMapa, /\.update\(/);
  assert.doesNotMatch(saldoMapa, /\.delete\(/);
});

test('el saldo sigue a la misma reserva cuando cambia de habitacion', () => {
  assert.match(saldoMapa, /saldoByHabitacion\.set\(reserva\.habitacion_id/);
  assert.match(saldoMapa, /reservaId: reserva\.id/);
  assert.match(saldoMapa, /habitacionId: reserva\.habitacion_id/);
  assert.match(saldoMapa, /getRoomIdFromCard/);
  assert.match(saldoMapa, /saldosByHabitacion\.get\(roomId\)/);
});

test('el mapa conserva compatibilidad con pagos legacy y pagos_reserva', () => {
  assert.match(saldoMapa, /const pagosRegistrados = sumPayments/);
  assert.match(saldoMapa, /Math\.max\(pagosRegistrados, Number\(reserva\?\.monto_pagado \|\| 0\)\)/);
  assert.match(saldoMapa, /movimientosCajaTienda/);
  assert.match(saldoMapa, /movimientosCajaRestaurante/);
});

test('el indicador se refresca por render y mutaciones de tarjetas sin polling', () => {
  assert.match(saldoMapa, /document\.addEventListener\('renderRoomsComplete'/);
  assert.match(saldoMapa, /MutationObserver/);
  assert.match(saldoMapa, /mutationTouchesRoomMap/);
  assert.doesNotMatch(saldoMapa, /setInterval\(/);
});

test('ver consumos muestra fechas de pagos y las incluye en la factura POS', () => {
  assert.match(saldoMapa, /import '\.\/mapa-consumos-pagos-enhancer\.js'/);
  assert.match(pagosConsumos, /Historial de pagos y abonos/);
  assert.match(pagosConsumos, /select\('id, monto, fecha_pago, concepto'\)/);
  assert.match(pagosConsumos, /getRuntimeHotelTimeZone/);
  assert.match(pagosConsumos, /formatInTimeZone/);
  assert.doesNotMatch(pagosConsumos, /America\/Bogota/);
  assert.match(pagosConsumos, /Último pago:/);
  assert.match(pagosConsumos, /btn-imprimir-pos-local/);
  assert.match(pagosConsumos, /PAGOS \/ ABONOS/);
  assert.match(pagosConsumos, /cleanPaymentConcept/);
  assert.doesNotMatch(pagosConsumos, /\.insert\(/);
  assert.doesNotMatch(pagosConsumos, /\.update\(/);
  assert.doesNotMatch(pagosConsumos, /\.from\(['"][^'"]+['"]\)\s*\.delete\(/);
});
