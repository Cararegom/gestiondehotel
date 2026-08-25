const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260825120000_recibir_compra_tienda_atomica.sql', 'utf8');
const caller = fs.readFileSync('js/modules/tienda/compras-pendientes.js', 'utf8');

test('purchase receipt is atomic, tenant-safe and idempotent', () => {
  assert.match(migration, /FUNCTION public\.recibir_compra_tienda_atomica/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path\s*=\s*pg_catalog, public/);
  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /fase1_actor_tiene_permiso\(v_compra\.hotel_id,'tienda\.operar'\)/);
  assert.match(migration, /client_operation_id=p_client_operation_id/);
  assert.match(migration, /UPDATE public\.productos_tienda[\s\S]*INSERT INTO public\.caja[\s\S]*UPDATE public\.compras_tienda/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,anon/);
});

test('pending purchases use only the atomic receipt RPC', () => {
  assert.match(caller, /rpc\('recibir_compra_tienda_atomica'/);
  assert.doesNotMatch(caller, /rpc\('ajustar_stock_producto'/);
  assert.doesNotMatch(caller, /from\('caja'\)\.insert/);
});
