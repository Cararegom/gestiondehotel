const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const cajaSource = fs.readFileSync(path.join(root, 'js/modules/caja/caja-movimientos.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260825164448_conceptos_ventas_caja_legibles.sql'), 'utf8');

test('Caja consulta el detalle real de tienda y restaurante para conceptos históricos', () => {
  assert.match(cajaSource, /detalle_ventas_tienda/);
  assert.match(cajaSource, /ventas_restaurante_items/);
  assert.match(cajaSource, /getReadableSaleConcept/);
  assert.match(cajaSource, /Reversión ·/);
});

test('las ventas nuevas generan el concepto desde cantidades y nombres guardados', () => {
  assert.match(migration, /BEFORE INSERT ON public\.caja/i);
  assert.match(migration, /format\('%s x %s', detalle\.cantidad, producto\.nombre\)/);
  assert.match(migration, /format\('%s x %s', detalle\.cantidad, plato\.nombre\)/);
  assert.match(migration, /SECURITY INVOKER/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.asignar_concepto_venta_caja\(\) FROM PUBLIC/);
});
