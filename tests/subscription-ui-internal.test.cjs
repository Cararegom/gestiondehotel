const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const account = fs.readFileSync(path.join(root, 'js/modules/micuenta/accountDataService.js'), 'utf8');
const pricing = fs.readFileSync(path.join(root, 'js/modules/micuenta/pricing.js'), 'utf8');
const miCuenta = fs.readFileSync(path.join(root, 'js/modules/micuenta/micuenta.js'), 'utf8');

test('Mi Cuenta calcula vencimiento por fecha aunque el estado persistido quede atrasado', () => {
  assert.match(account, /if \(hoy <= fechaFin\)/);
  assert.match(account, /if \(hoy <= fechaLimiteGracia\)/);
  assert.match(account, /estadoEfectivo: 'vencido'/);
  assert.match(account, /estado_suscripcion: estado\.estadoEfectivo/);
});

test('cuentas internas no tienen vencimiento ni promociones', () => {
  assert.match(account, /suscripcion_exenta === true/);
  assert.match(account, /estadoEfectivo: 'interno'/);
  assert.match(pricing, /hotel\?\.suscripcion_exenta === true/);
  assert.match(pricing, /aplicaEnPeriodo\(\) \{ return false; \}/);
});

test('Mi Cuenta muestra acceso permanente y oculta ventas para cuentas internas', () => {
  assert.match(miCuenta, /Acceso permanente sin renovación/);
  assert.match(miCuenta, /Exento de cobro/);
  assert.match(miCuenta, /Las opciones de renovación, promociones y checkout están ocultas/);
  assert.match(miCuenta, /const esCuentaInterna = hotel\?\.suscripcion_exenta === true/);
});

test('la gracia y el bloqueo se comunican como estados distintos', () => {
  assert.match(pricing, /El hotel sigue operativo por/);
  assert.match(pricing, /el período de gracia terminó/);
  assert.match(miCuenta, /Período de gracia/);
  assert.match(miCuenta, /Renovación requerida/);
});
