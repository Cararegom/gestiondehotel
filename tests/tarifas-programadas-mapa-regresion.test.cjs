const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/mapa-tarifas-programadas-bootstrap.js', 'utf8');

test('Mapa intercepta alquiler directo y extensión con el mismo motor de tarifas', () => {
  assert.match(source, /#btn-alquilar-directo/);
  assert.match(source, /#btn-extender-tiempo/);
  assert.match(source, /showAlquilarModal/);
  assert.match(source, /showExtenderTiempoModal/);
  assert.match(source, /calcularEstanciaNochesProgramada/);
  assert.match(source, /resolverPrecioTiempoEstancia/);
});

test('una extensión por noche comienza a tarifarse desde la fecha fin de la estancia activa', () => {
  assert.match(source, /const extensionStart = new Date\(activeReservation\.fecha_fin\)/);
  assert.match(source, /dateProvider: \(\) => extensionStart/);
});

test('sin override por horas conserva exactamente tiempos_estancia.precio', () => {
  assert.match(
    source,
    /if \(!priceResult\.tarifaAplicada\) return Number\(timeTarget\.precio\) \|\| 0;/
  );
});

test('con override, la extensión por horas usa el total programado y el alquiler usa hospedaje base', () => {
  assert.match(source, /mode === 'extension'/);
  assert.match(source, /Number\(priceResult\.total\) \|\| 0/);
  assert.match(source, /Number\(priceResult\.precioHospedaje\) \|\| 0/);
});
