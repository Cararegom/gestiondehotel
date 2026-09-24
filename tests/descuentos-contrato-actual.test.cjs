const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadService() {
  let source = fs.readFileSync('js/services/descuentosService.js', 'utf8');
  source = source
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');
  source += `\nmodule.exports = {\n    normalizarCodigoDescuento,\n    descuentoEstaVigente,\n    descuentoCoincideConAcceso,\n    descuentoAplicaAReserva,\n    serviciosAplicablesAlDescuento,\n    productosTiendaAplicablesAlDescuento,\n    seleccionarDescuentoPreferido,\n    calcularMontoDescuento,\n    calcularResumenDescuentoTienda\n  };`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    Date,
    Number,
    String,
    Array,
    Math
  };
  vm.runInNewContext(source, sandbox, { filename: 'descuentosService.js' });
  return sandbox.module.exports;
}

const service = loadService();
const now = new Date('2026-09-03T18:00:00.000Z');

function discount(overrides = {}) {
  return {
    id: 'd1',
    activo: true,
    tipo: 'porcentaje',
    valor: 10,
    tipo_descuento_general: 'automatico',
    aplicabilidad: 'reserva_total',
    habitaciones_aplicables: [],
    usos_maximos: 0,
    usos_actuales: 0,
    ...overrides
  };
}

test('vigencia respeta fecha_inicio, fecha_fin, expiracion y limite de usos', () => {
  assert.equal(service.descuentoEstaVigente(discount(), now), true);
  assert.equal(service.descuentoEstaVigente(discount({ fecha_inicio: '2026-09-04T00:00:00Z' }), now), false);
  assert.equal(service.descuentoEstaVigente(discount({ fecha_fin: '2026-09-02T23:59:59Z' }), now), false);
  assert.equal(service.descuentoEstaVigente(discount({ expiracion: '2026-09-03T17:59:59Z' }), now), false);
  assert.equal(service.descuentoEstaVigente(discount({ usos_maximos: 5, usos_actuales: 5 }), now), false);
  assert.equal(service.descuentoEstaVigente(discount({ usos_maximos: 5, usos_actuales: 4 }), now), true);
});

test('un descuento por codigo nunca se vuelve automatico sin el codigo correcto', () => {
  const porCodigo = discount({ tipo_descuento_general: 'codigo', codigo: 'AMOR10' });
  assert.equal(service.descuentoCoincideConAcceso(porCodigo, {}), false);
  assert.equal(service.descuentoCoincideConAcceso(porCodigo, { codigoManual: 'amor10' }), true);
  assert.equal(service.descuentoCoincideConAcceso(porCodigo, { codigoManual: 'OTRO' }), false);
});

test('cliente especifico gana a codigo y automatico cuando todos aplican', () => {
  const automatico = discount({ id: 'auto' });
  const codigo = discount({ id: 'code', tipo_descuento_general: 'codigo', codigo: 'VIP10' });
  const cliente = discount({ id: 'client', tipo_descuento_general: 'cliente_especifico', cliente_id: 'c1' });
  const selected = service.seleccionarDescuentoPreferido(
    [automatico, codigo, cliente],
    { clienteId: 'c1', codigoManual: 'vip10' },
    () => true
  );
  assert.equal(selected.id, 'client');
});

test('reserva soporta total, todas las habitaciones, habitacion especifica y noche completa', () => {
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'reserva_total' }), {}), true);
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'todas_las_habitaciones' }), { habitacionId: '101' }), true);
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'habitaciones_especificas', habitaciones_aplicables: ['102'] }), { habitacionId: '101' }), false);
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'habitaciones_especificas', habitaciones_aplicables: ['102'] }), { habitacionId: '102' }), true);
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'tiempos_estancia_especificos', habitaciones_aplicables: ['NOCHE_COMPLETA'] }), { esNoche: true }), true);
  assert.equal(service.descuentoAplicaAReserva(discount({ aplicabilidad: 'tiempos_estancia_especificos', habitaciones_aplicables: ['t-3h'] }), { tiempoEstanciaId: 't-3h' }), true);
});

test('servicios adicionales usan los ids actuales y calculan porcentaje con tipo', () => {
  const descuento = discount({
    aplicabilidad: 'servicios_adicionales',
    habitaciones_aplicables: ['spa'],
    tipo: 'porcentaje',
    valor: 10
  });
  const servicios = [
    { servicio_id: 'spa', nombre: 'Spa', cantidad: 2, precio: 50000 },
    { servicio_id: 'late', nombre: 'Late checkout', cantidad: 1, precio: 30000 }
  ];
  const afectados = service.serviciosAplicablesAlDescuento(descuento, servicios);
  assert.equal(afectados.length, 1);
  assert.equal(afectados[0].servicio_id, 'spa');
  assert.equal(service.calcularMontoDescuento(descuento, 100000), 10000);
});

test('tienda calcula subtotal descuento y total desde una sola fuente', () => {
  const carrito = [
    { id: 'agua', cantidad: 2, precio_venta: 5000 },
    { id: 'cerveza', cantidad: 1, precio_venta: 10000 }
  ];
  const descuento = discount({
    aplicabilidad: 'productos_tienda',
    habitaciones_aplicables: ['cerveza'],
    tipo: 'porcentaje',
    valor: 20
  });
  const resumen = service.calcularResumenDescuentoTienda(carrito, descuento);
  assert.equal(resumen.subtotal, 20000);
  assert.equal(resumen.baseDescuento, 10000);
  assert.equal(resumen.montoDescuento, 2000);
  assert.equal(resumen.total, 18000);
  assert.deepEqual(Array.from(resumen.productosAfectados).map((item) => item.id), ['cerveza']);
});

test('tienda no reutiliza categorías de restaurante como alcance de tienda', () => {
  const carrito = [{ id: 'agua', categoria_id: 'bebidas', cantidad: 1, precio_venta: 5000 }];
  const descuento = discount({
    aplicabilidad: 'categorias_restaurante',
    habitaciones_aplicables: ['bebidas'],
    valor: 50
  });
  const resumen = service.calcularResumenDescuentoTienda(carrito, descuento);
  assert.equal(resumen.baseDescuento, 0);
  assert.equal(resumen.montoDescuento, 0);
  assert.equal(resumen.total, 5000);
});

test('descuento fijo nunca supera la base cobrada', () => {
  assert.equal(service.calcularMontoDescuento(discount({ tipo: 'fijo', valor: 80000 }), 50000), 50000);
});

test('Mapa elimina los campos legacy del esquema anterior', () => {
  const source = fs.readFileSync('js/modules/mapa-habitaciones/descuentos-helper.js', 'utf8');
  assert.doesNotMatch(source, /\.condiciones\b/);
  assert.doesNotMatch(source, /\.aplicable_a\b/);
  assert.doesNotMatch(source, /\.tipo_descuento\b/);
  assert.doesNotMatch(source, /buscarDescuentoAplicable/);
  assert.doesNotMatch(source, /\.\.\.args/);
  assert.match(source, /descuentosService\.js/);
});

test('Reservas deja de duplicar la consulta y usa el servicio compartido', () => {
  const source = fs.readFileSync('js/modules/reservas/reservas-descuentos.js', 'utf8');
  assert.match(source, /descuentosService\.js/);
  assert.doesNotMatch(source, /\.from\(['\"]descuentos['\"]\)/);
  assert.match(source, /descuentoAplicaAReserva/);
});
