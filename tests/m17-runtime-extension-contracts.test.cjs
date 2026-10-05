const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const root = resolve(__dirname, '..');
const read = (file) => readFileSync(resolve(root, file), 'utf8');
const html = read('app/index.html');

const directExtensions = [
  'js/energy-module-recovery.js',
  'js/habitaciones-tarifas-bootstrap.js',
  'js/tarifas-programadas-admin-guard.js',
  'js/mapa-tarifas-programadas-bootstrap.js',
  'js/mapa-saldo-enhancer.js',
  'js/usuarios-crear-colaborador-hotfix.js',
  'js/user-active-session-guard.js',
  'js/modules/usuarios/usuarios-archivo-enhancer.js',
  'js/energy-activation-guard.js',
  'js/bank-payment-reception-bootstrap.js'
];

const directContracts = [
  {
    extension: 'js/energy-module-recovery.js',
    base: 'js/main.js',
    shared: '#/control-energia'
  },
  {
    extension: 'js/habitaciones-tarifas-bootstrap.js',
    base: 'js/modules/habitaciones/habitaciones.js',
    shared: 'habitaciones-lista-container'
  },
  {
    extension: 'js/tarifas-programadas-admin-guard.js',
    base: 'js/habitaciones-tarifas-bootstrap.js',
    shared: 'habitaciones-tarifas-programadas'
  },
  {
    extension: 'js/mapa-tarifas-programadas-bootstrap.js',
    base: 'js/modules/mapa-habitaciones/modales-gestion.js',
    shared: 'btn-alquilar-directo'
  },
  {
    extension: 'js/mapa-saldo-enhancer.js',
    base: 'js/modules/mapa-habitaciones/mapa-habitaciones.js',
    shared: 'renderRoomsComplete'
  },
  {
    extension: 'js/usuarios-crear-colaborador-hotfix.js',
    base: 'js/modules/usuarios/usuarios.js',
    shared: 'form-crear-editar-usuario'
  },
  {
    extension: 'js/user-active-session-guard.js',
    base: 'js/modules/usuarios/usuarios.js',
    extensionAnchor: ".select('activo')",
    baseAnchor: 'usuario-activo'
  },
  {
    extension: 'js/modules/usuarios/usuarios-archivo-enhancer.js',
    base: 'js/modules/usuarios/usuarios.js',
    shared: 'usuarios-module'
  },
  {
    extension: 'js/energy-activation-guard.js',
    base: 'js/modules/configuracion/configuracion-core.js',
    shared: 'energy_control_enabled'
  },
  {
    extension: 'js/bank-payment-reception-bootstrap.js',
    base: 'js/modules/caja/caja.js',
    shared: 'caja-module'
  }
];

function localScriptSources() {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["'](\/js\/[^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
}

test('M17 mantiene un inventario único y versionado de extensiones cargadas por el shell', () => {
  const sources = localScriptSources();
  for (const file of directExtensions) {
    const prefix = `/${file}?v=`;
    const matches = sources.filter((source) => source.startsWith(prefix));
    assert.equal(matches.length, 1, `${file} debe cargarse una vez y con version`);
    assert.ok(existsSync(resolve(root, file)), `${file} debe existir`);
  }
});

test('M17 conserva el orden de recuperación, entrada principal y extensiones', () => {
  const sources = localScriptSources();
  const recoveryIndex = sources.findIndex((source) => source.startsWith('/js/energy-module-recovery.js?v='));
  const mainIndex = sources.findIndex((source) => source.startsWith('/js/main.js?v='));
  assert.ok(recoveryIndex >= 0 && recoveryIndex < mainIndex);

  for (const file of directExtensions.filter((file) => file !== 'js/energy-module-recovery.js')) {
    const extensionIndex = sources.findIndex((source) => source.startsWith(`/${file}?v=`));
    assert.ok(extensionIndex > mainIndex, `${file} debe instalarse despues de main.js`);
  }
});

test('M17 cruza cada extensión directa con el contrato DOM o evento de su módulo base', () => {
  for (const contract of directContracts) {
    const extension = read(contract.extension);
    const base = read(contract.base);
    const extensionAnchor = contract.extensionAnchor || contract.shared;
    const baseAnchor = contract.baseAnchor || contract.shared;
    assert.ok(extension.includes(extensionAnchor), `${contract.extension} debe consumir ${extensionAnchor}`);
    assert.ok(base.includes(baseAnchor), `${contract.base} debe publicar ${baseAnchor}`);
  }
});

test('M17 verifica también las extensiones encadenadas fuera del HTML', () => {
  const saldo = read('js/mapa-saldo-enhancer.js');
  const consumos = read('js/mapa-consumos-pagos-enhancer.js');
  const modales = read('js/modules/mapa-habitaciones/modales-gestion.js');
  assert.match(saldo, /import ['"]\.\/mapa-consumos-pagos-enhancer\.js['"]/);
  assert.match(consumos, /btn-imprimir-pos-local/);
  assert.match(modales, /btn-imprimir-pos-local/);

  const guard = read('js/tarifas-programadas-admin-guard.js');
  const simulator = read('js/tarifas-programadas-simulador-bootstrap.js');
  const tariffBase = read('js/habitaciones-tarifas-bootstrap.js');
  assert.match(guard, /import\(['"]\.\/tarifas-programadas-simulador-bootstrap\.js['"]\)/);
  assert.match(simulator, /habitaciones-tarifas-programadas/);
  assert.match(tariffBase, /habitaciones-tarifas-programadas/);
});
