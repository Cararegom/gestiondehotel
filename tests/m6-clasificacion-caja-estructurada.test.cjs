const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const cierrePath = path.join(root, 'js/modules/caja/caja-cierre.js');
const movimientosPath = path.join(root, 'js/modules/caja/caja-movimientos.js');
const turnosPath = path.join(root, 'js/modules/caja/caja-turnos.js');
const cierreSource = fs.readFileSync(cierrePath, 'utf8');
const movimientosSource = fs.readFileSync(movimientosPath, 'utf8');
const turnosSource = fs.readFileSync(turnosPath, 'utf8');

async function loadModules() {
  const cacheKey = Date.now();
  const cierre = await import(`${pathToFileURL(cierrePath).href}?m6=${cacheKey}`);
  const movimientos = await import(`${pathToFileURL(movimientosPath).href}?m6=${cacheKey}`);
  return { cierre, movimientos };
}

test('M6 clasifica ingresos por referencias y source, aunque el concepto sea engañoso', async () => {
  const { movimientos } = await loadModules();
  const { getMovementOriginKey, getMovementOriginMeta } = movimientos;

  assert.equal(getMovementOriginKey({ tipo: 'ingreso', venta_tienda_id: 'sale-1', concepto: 'Habitación 101' }), 'tienda');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', venta_restaurante_id: 'sale-2', concepto: 'Tienda' }), 'cocina');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', venta_terraza_id: 'sale-3', concepto: 'Reserva' }), 'terraza');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', venta_terraza_id: 'sale-4', source: 'terrace_tip_mixed' }), 'propinas');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', pago_reserva_id: 'payment-1', concepto: 'Restaurante' }), 'habitaciones');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', source: 'store_web_order' }), 'tienda');
  assert.equal(getMovementOriginKey({ tipo: 'ingreso', source: 'reservation_payment' }), 'habitaciones');

  const manual = { tipo: 'ingreso', source: 'manual_cash', concepto: 'Habitación 999' };
  assert.equal(getMovementOriginKey(manual), 'otros');
  assert.equal(getMovementOriginMeta(manual).label, 'Otros ingresos');
});

test('M6 conserva todos los importes y separa los ingresos sin vínculo en Otros ingresos', async () => {
  const { cierre } = await loadModules();
  const movimientos = [
    { tipo: 'apertura', monto: 50, metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'ingreso', monto: 100, pago_reserva_id: 'payment-1', concepto: 'Restaurante', metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'ingreso', monto: 200, venta_tienda_id: 'sale-1', concepto: 'Habitación 101', metodos_pago: { nombre: 'Tarjeta' } },
    { tipo: 'ingreso', monto: 30, source: 'terrace_tip', venta_terraza_id: 'sale-2', metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'ingreso', monto: 40, source: 'manual_cash', concepto: 'Habitación 999', metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'egreso', monto: 20, source: 'manual_cash', concepto: 'Compra', metodos_pago: { nombre: 'Efectivo' } }
  ];

  const reporte = cierre.procesarMovimientosParaReporte(movimientos);
  assert.equal(reporte.habitaciones.ventas, 1);
  assert.equal(reporte.tienda.ventas, 1);
  assert.equal(reporte.propinas.ventas, 1);
  assert.equal(reporte.otros.ventas, 1);
  assert.equal(reporte.habitaciones.pagos.Efectivo, 100);
  assert.equal(reporte.otros.pagos.Efectivo, 40);

  const totales = cierre.calcularTotalesSistemaCierre(reporte, [
    { id: 'cash', nombre: 'Efectivo' },
    { id: 'card', nombre: 'Tarjeta' }
  ]);
  assert.equal(totales.totalIngresos, 370);
  assert.equal(totales.totalGastos, 20);
  assert.equal(totales.balanceFinal, 400);
  assert.deepEqual(totales.totalesPorMetodo.Efectivo, {
    ingreso: 170,
    gasto: 20,
    balance: 150,
    esperadoArqueo: 200
  });
});

test('M6 obtiene habitaciones del modelo de reservas y no del texto del movimiento', async () => {
  const { cierre } = await loadModules();
  const movimientos = [
    { tipo: 'ingreso', monto: 100, reserva_id: 'reservation-1', metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'ingreso', monto: 50, reserva_id: 'reservation-1', metodos_pago: { nombre: 'Efectivo' } },
    { tipo: 'ingreso', monto: 80, reserva_id: 'reservation-2', metodos_pago: { nombre: 'Tarjeta' } },
    { tipo: 'ingreso', monto: 25, source: 'manual_cash', concepto: 'Habitación 999', metodos_pago: { nombre: 'Efectivo' } }
  ];
  const reporte = cierre.procesarMovimientosParaReporte(movimientos);
  const resumen = cierre.construirResumenOperativoCierre({
    movimientos,
    reporte,
    reservasTurno: [
      { id: 'reservation-1', habitacion_id: 'room-1', habitaciones: { id: 'room-1', nombre: '101' } },
      { id: 'reservation-2', habitacion_id: 'room-2', habitaciones: { id: 'room-2', nombre: '102' } },
      { id: 'reservation-3', habitacion_id: 'room-2', habitaciones: { id: 'room-2', nombre: '102' } }
    ]
  });

  assert.equal(resumen.habitacionesAlquiladas, 2);
  assert.equal(resumen.habitacionesCobros, 3);

  const sinReservas = cierre.construirResumenOperativoCierre({
    movimientos: [{ tipo: 'ingreso', source: 'manual_cash', concepto: 'Habitación 999', monto: 25 }],
    reservasTurno: []
  });
  assert.equal(sinReservas.habitacionesAlquiladas, 0);
  assert.equal(sinReservas.habitacionesCobros, 0);
});

test('M6 consulta reservas vinculadas y elimina las heurísticas de clasificación por concepto', () => {
  assert.match(turnosSource, /pagos_reserva\(reserva_id\)/);
  assert.match(turnosSource, /movimiento\?\.reserva_id \|\| movimiento\?\.pagos_reserva\?\.reserva_id/);
  assert.match(turnosSource, /from\('reservas'\)[\s\S]*select\('id, habitacion_id, habitaciones\(id, nombre\)'\)[\s\S]*\.in\('id', reservaIdsTurno\)/);
  assert.match(turnosSource, /reservasTurno:\s*reservasTurno \|\| \[\]/);
  assert.match(cierreSource, /categoriaOrigen = getMovementOriginKey\(movimiento\)/);
  assert.match(cierreSource, /OTROS INGRESOS:/);
  assert.doesNotMatch(cierreSource, /extraerHabitacionDesdeConcepto/);
  assert.doesNotMatch(cierreSource, /Movimiento de ingreso no clasificado, asignado a Habitaciones/);
  assert.doesNotMatch(movimientosSource, /concept\.includes\('(propina|tienda|producto|terraza|restaurante|cocina|habitaci|alquiler|reserva|extensi)/);
});
