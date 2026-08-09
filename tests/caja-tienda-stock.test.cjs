const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260806120000_restore_tienda_stock_al_eliminar_caja.sql'
);

test('eliminar el ultimo movimiento de una venta de tienda repone su stock', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /movimiento_a_eliminar\.venta_tienda_id IS NOT NULL/i);
  assert.match(sql, /NOT EXISTS[\s\S]*venta_tienda_id[\s\S]*id <> movimiento_id_param/i);
  assert.match(sql, /SUM\(cantidad\)[\s\S]*detalle_ventas_tienda/i);
  assert.match(sql, /v_stock_nuevo := v_stock_anterior \+ detalle\.cantidad/i);
  assert.match(sql, /INSERT INTO public\.movimientos_inventario/i);
  assert.match(sql, /'INGRESO'/i);
});

test('la reposicion y la eliminacion se ejecutan en la misma funcion atomica', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const updateIndex = sql.indexOf('UPDATE public.productos_tienda');
  const deleteIndex = sql.indexOf('DELETE FROM public.caja');

  assert.ok(updateIndex >= 0, 'debe actualizar productos_tienda');
  assert.ok(deleteIndex > updateIndex, 'debe eliminar caja despues de reponer el stock');
  assert.match(sql, /FOR UPDATE/i);
});
