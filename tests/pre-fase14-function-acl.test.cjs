const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const migration = fs.readFileSync(
  path.resolve(__dirname, '../supabase/migrations/20260827174036_pre_fase14_function_acl_and_cross_tenant_hardening.sql'),
  'utf8'
);

test('la migracion 10 cierra defaults y reconstruye ACL por firma', () => {
  assert.match(migration, /alter default privileges for role postgres in schema public[\s\S]*revoke execute on functions from public, anon, authenticated/i);
  assert.match(migration, /pg_get_userbyid\(p\.proowner\) = 'postgres'/i);
  assert.match(migration, /revoke all on function %s from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute on all functions in schema public to authenticated/i);
});

test('la allowlist anon contiene exclusivamente los tres endpoints publicos', () => {
  const anonGrants = [...migration.matchAll(/grant execute on function\s+([^;]+?)\s+to\s+anon(?:,\s*authenticated)?\s*;/gi)]
    .map((match) => match[1].replace(/\s+/g, ' ').trim())
    .sort();
  assert.deepEqual(anonGrants, [
    'public.crear_pedido_web_tienda(uuid,text,text,text,text,jsonb)',
    'public.obtener_catalogo_tienda_web(uuid)',
    'public.obtener_menu_terraza_publico(uuid)'
  ]);
});

test('actualizar compra deriva hotel y restringe cada detalle a su compra', () => {
  assert.match(migration, /v_actor_id uuid := auth\.uid\(\)/i);
  assert.match(migration, /fase1_actor_tiene_permiso\(v_hotel_id, 'tienda\.operar'\)/i);
  assert.match(migration, /d\.compra_id = p_compra_id[\s\S]*d\.hotel_id = v_hotel_id/i);
  assert.match(migration, /Un detalle no pertenece a la compra autorizada/i);
  assert.match(migration, /Un detalle a eliminar no pertenece a la compra autorizada/i);
});

test('cambio de habitacion usa identidad autoritativa y elimina el overload legacy', () => {
  assert.match(migration, /p_usuario_id is distinct from v_actor\.id/i);
  assert.match(migration, /p_hotel_id is distinct from v_actor\.hotel_id/i);
  assert.match(migration, /r\.hotel_id = v_actor\.hotel_id/i);
  assert.match(migration, /drop function if exists public\.cambiar_habitacion_transaccion\([\s\S]*p_nuevo_estado_destino|drop function if exists public\.cambiar_habitacion_transaccion\([\s\S]*public\.estado_habitacion_enum/i);
});

test('RPC legacy sin consumidor quedan fuera de anon y authenticated', () => {
  assert.match(migration, /revoke all on function public\.decrementar_stock_producto\(uuid,integer,uuid\) from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.crear_habitacion_con_tiempos\([\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.decrementar_stock_producto[^;]*to authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.crear_habitacion_con_tiempos[^;]*to authenticated/i);
});
