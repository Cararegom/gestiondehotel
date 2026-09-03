const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const facade = fs.readFileSync('js/modules/configuracion/configuracion.js', 'utf8');
const source = fs.readFileSync('js/modules/configuracion/configuracion-core.js', 'utf8');

test('Configuracion conserva el interruptor accesible para Control de Energia', () => {
  assert.match(facade, /configuracion-core\.js/);
  assert.match(source, /id="energy_control_enabled"/);
  assert.match(source, /role="switch"/);
  assert.match(source, /peer-checked:bg-emerald-500/);
  assert.match(source, /ACTIVADO/);
  assert.match(source, /DESACTIVADO/);
});

test('el interruptor persiste la bandera por el hotel actual', () => {
  assert.match(source, /update\(\{ energy_control_enabled: enabled/);
  assert.match(source, /\.eq\('hotel_id', currentHotelId\)/);
  assert.match(source, /window\.location\.reload\(\)/);
});
