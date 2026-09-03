const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadPricingService() {
  let source = fs.readFileSync('js/services/tarifasProgramadasService.js', 'utf8');
  source = source
    .replace(/import\s*\{[\s\S]*?\}\s*from\s*['"]\.\/hotelTimeZoneService\.js['"];?/, '')
    .replace(/export\s+async\s+function\s+/g, 'async function ')
    .replace(/export\s+function\s+/g, 'function ');

  source += `\nmodule.exports = {
    tarifaProgramadaAplica,
    seleccionarTarifaProgramada,
    resolverPrecioNoche,
    calcularEstanciaNochesProgramada,
    resolverPrecioTiempoEstancia
  };`;

  const sandbox = {
    module: { exports: {} },
    exports: {},
    Date,
    Intl,
    Number,
    String,
    Array,
    Math,
    console,
    getRuntimeHotelTimeZone: () => 'America/Bogota',
    getDateKeyInTimeZone: (value) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return String(value);
      const date = value instanceof Date ? value : new Date(value);
      return date.toISOString().slice(0, 10);
    },
    addCalendarDays: (dateKey, days) => {
      const [year, month, day] = dateKey.split('-').map(Number);
      const shifted = new Date(Date.UTC(year, month - 1, day + Number(days || 0)));
      return shifted.toISOString().slice(0, 10);
    }
  };

  vm.runInNewContext(source, sandbox, { filename: 'tarifasProgramadasService.js' });
  return sandbox.module.exports;
}

const service = loadPricingService();

const room = {
  id: 'room-1',
  precio: 80000,
  precio_1_persona: 60000,
  precio_2_personas: 80000,
  precio_huesped_adicional: 15000,
  capacidad_base: 2,
  precio_base_hora: 10000
};

const weekdayTariff = {
  id: 'weekday',
  nombre: 'Amanecida L-V',
  modalidad: 'noche',
  dias_semana: [1, 2, 3, 4, 5],
  precio_final: 60000,
  prioridad: 10,
  activo: true
};

const weekendTariff = {
  id: 'weekend',
  nombre: 'Amanecida fin de semana',
  modalidad: 'noche',
  dias_semana: [0, 6],
  precio_final: 70000,
  prioridad: 10,
  activo: true
};

test('sin tarifa programada conserva exactamente la tarifa base de Habitaciones', () => {
  const result = service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-04', tarifas: [] });
  assert.equal(result.precioHospedaje, 80000);
  assert.equal(result.total, 80000);
  assert.equal(result.tarifaAplicada, null);
});

test('aplica L-V 60.000 y sábado-domingo 70.000 como precio final', () => {
  const tariffs = [weekdayTariff, weekendTariff];
  assert.equal(service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-04', tarifas: tariffs }).total, 60000);
  assert.equal(service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-05', tarifas: tariffs }).total, 70000);
  assert.equal(service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-06', tarifas: tariffs }).total, 70000);
});

test('una estancia viernes-sábado-domingo se calcula noche por noche', () => {
  const result = service.calcularEstanciaNochesProgramada({
    room,
    huespedes: 2,
    fechaEntrada: '2026-09-04',
    cantidadNoches: 3,
    tarifas: [weekdayTariff, weekendTariff]
  });

  assert.equal(result.total, 200000);
  assert.deepEqual(Array.from(result.desglose, (item) => item.total), [60000, 70000, 70000]);
});

test('una regla de habitación específica gana a una general con la misma prioridad', () => {
  const general = { ...weekendTariff, id: 'general', habitacion_id: null, precio_final: 70000 };
  const specific = { ...weekendTariff, id: 'specific', habitacion_id: 'room-1', precio_final: 65000 };
  const result = service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-05', tarifas: [general, specific] });
  assert.equal(result.total, 65000);
  assert.equal(result.tarifaAplicada.id, 'specific');
});

test('la prioridad explícita domina cuando dos reglas se superponen', () => {
  const normal = { ...weekendTariff, id: 'normal', prioridad: 10, precio_final: 70000 };
  const special = { ...weekendTariff, id: 'special', prioridad: 100, precio_final: 90000 };
  const result = service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-09-05', tarifas: [normal, special] });
  assert.equal(result.total, 90000);
  assert.equal(result.tarifaAplicada.id, 'special');
});

test('una tarifa de temporada respeta fecha de inicio y fin', () => {
  const season = {
    id: 'season',
    modalidad: 'noche',
    dias_semana: [],
    fecha_inicio: '2026-12-24',
    fecha_fin: '2027-01-02',
    precio_final: 100000,
    prioridad: 100,
    activo: true
  };
  assert.equal(service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-12-25', tarifas: [season] }).total, 100000);
  assert.equal(service.resolverPrecioNoche({ room, huespedes: 2, fecha: '2026-12-23', tarifas: [season] }).total, 80000);
});

test('la tarifa programada de un tiempo de estancia reemplaza su precio sin tocar el registro base', () => {
  const tiempo = { id: '2h', minutos: 120, precio: 30000 };
  const tariff = {
    id: '2h-weekday',
    modalidad: 'tiempo_estancia',
    tiempo_estancia_id: '2h',
    dias_semana: [1, 2, 3, 4, 5],
    precio_final: 25000,
    prioridad: 10,
    activo: true
  };
  const result = service.resolverPrecioTiempoEstancia({ room, tiempo, huespedes: 2, fecha: '2026-09-04', tarifas: [tariff] });
  assert.equal(result.total, 25000);
  assert.equal(tiempo.precio, 30000);
});

test('huéspedes adicionales usan override programado o fallback de Habitación', () => {
  const override = { ...weekendTariff, id: 'extra', precio_final: 70000, precio_huesped_adicional: 20000 };
  const programmed = service.resolverPrecioNoche({ room, huespedes: 3, fecha: '2026-09-05', tarifas: [override] });
  const fallback = service.resolverPrecioNoche({ room, huespedes: 3, fecha: '2026-09-05', tarifas: [weekendTariff] });
  assert.equal(programmed.total, 90000);
  assert.equal(fallback.total, 85000);
});

test('el motor usa la zona horaria central del hotel y no la del navegador', () => {
  const source = fs.readFileSync('js/services/tarifasProgramadasService.js', 'utf8');
  assert.match(source, /getRuntimeHotelTimeZone/);
  assert.match(source, /getDateKeyInTimeZone/);
  assert.match(source, /addCalendarDays/);
  assert.doesNotMatch(source, /new Date\(\)\.getDay\(\)/);
});
