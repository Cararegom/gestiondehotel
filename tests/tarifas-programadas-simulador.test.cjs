const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadConflictService() {
  let source = fs.readFileSync('js/services/tarifasProgramadasConflictosService.js', 'utf8');
  source = source.replace(/export\s+function\s+/g, 'function ');
  source += `\nmodule.exports = { tarifaAplicaHabitacionScope, compararPrecedenciaTarifas, detectarConflictosTarifaProgramada };`;
  const sandbox = { module: { exports: {} }, exports: {}, Number, String, Array, Set, Date };
  vm.runInNewContext(source, sandbox, { filename: 'tarifasProgramadasConflictosService.js' });
  return sandbox.module.exports;
}

const service = loadConflictService();
const rooms = ['101', '102', 'vip'];

const weekday = {
  id: 'weekday',
  nombre: 'Semana',
  modalidad: 'noche',
  dias_semana: [1, 2, 3, 4, 5],
  habitaciones_excluidas: ['vip'],
  prioridad: 10,
  activo: true
};

const weekend = {
  id: 'weekend',
  nombre: 'Fin de semana',
  modalidad: 'noche',
  dias_semana: [0, 6],
  habitaciones_excluidas: ['vip'],
  prioridad: 10,
  activo: true
};

test('semana y fin de semana no generan un falso conflicto', () => {
  const conflicts = service.detectarConflictosTarifaProgramada(weekday, [weekend], rooms);
  assert.equal(conflicts.length, 0);
});

test('dos reglas con mismo alcance, días y prioridad se consideran ambiguas', () => {
  const duplicate = { ...weekday, id: 'duplicate', nombre: 'Otra semana' };
  const conflicts = service.detectarConflictosTarifaProgramada(duplicate, [weekday], rooms);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].ambigua, true);
  assert.deepEqual(Array.from(conflicts[0].habitacionesCoincidentes), ['101', '102']);
});

test('una regla de temporada con mayor prioridad puede superponerse de forma controlada', () => {
  const season = {
    ...weekday,
    id: 'season',
    fecha_inicio: '2026-12-20',
    fecha_fin: '2027-01-05',
    prioridad: 100
  };
  const conflicts = service.detectarConflictosTarifaProgramada(season, [weekday], rooms);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].ambigua, false);
  assert.equal(conflicts[0].gana, 'candidata');
});

test('un rango de un solo día no choca con un weekday que no ocurre ese día', () => {
  const christmasFriday = {
    ...weekday,
    id: 'christmas',
    dias_semana: [],
    fecha_inicio: '2026-12-25',
    fecha_fin: '2026-12-25'
  };
  const mondayOnly = {
    ...weekday,
    id: 'monday',
    dias_semana: [1],
    fecha_inicio: '2026-12-20',
    fecha_fin: '2026-12-31'
  };
  const conflicts = service.detectarConflictosTarifaProgramada(christmasFriday, [mondayOnly], rooms);
  assert.equal(conflicts.length, 0);
});

test('una tarifa exclusiva de la habitación VIP no choca con una tarifa que la excluye', () => {
  const vip = {
    id: 'vip-only',
    modalidad: 'noche',
    habitacion_id: 'vip',
    dias_semana: [1, 2, 3, 4, 5],
    prioridad: 10,
    activo: true
  };
  const conflicts = service.detectarConflictosTarifaProgramada(vip, [weekday], rooms);
  assert.equal(conflicts.length, 0);
});

test('el simulador usa el mismo cálculo nocturno del motor real y admite el borrador', () => {
  const source = fs.readFileSync('js/tarifas-programadas-simulador-bootstrap.js', 'utf8');
  assert.match(source, /calcularEstanciaNochesProgramada/);
  assert.match(source, /previewTariffs\(section\)/);
  assert.match(source, /Borrador sin guardar/);
  assert.match(source, /Simular precio/);
});

test('un conflicto ambiguo bloquea submit antes de la mutación existente', () => {
  const source = fs.readFileSync('js/tarifas-programadas-simulador-bootstrap.js', 'utf8');
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /conflicts\.some\(\(item\) => item\.ambigua\)/);
  assert.match(source, /addEventListener\('submit'.*true\)/s);
});

test('el simulador se carga de forma opcional después del guard de permisos', () => {
  const guard = fs.readFileSync('js/tarifas-programadas-admin-guard.js', 'utf8');
  assert.match(guard, /enforceTariffPermissions\(\)\.catch/);
  assert.match(guard, /import\('\.\/tarifas-programadas-simulador-bootstrap\.js'\)\.catch/);
});
