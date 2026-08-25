const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const migrationDir = path.join(root, 'supabase', 'migrations');
const fase1Files = fs.readdirSync(migrationDir).filter((name) => /^2026080910\d{4}_fase1_.*\.sql$/.test(name)).sort();
const sql = fase1Files.map((name) => fs.readFileSync(path.join(migrationDir, name), 'utf8')).join('\n');

test('Fase 1 is split into ten ordered migrations', () => {
  assert.equal(fase1Files.length, 10);
  assert.deepEqual(fase1Files.map((name) => name.slice(8, 14)), ['100000','101000','102000','103000','104000','105000','106000','107000','108000','109000']);
});

test('tenant authorization requires active membership and does not grant superadmin bypass', () => {
  const base = fs.readFileSync(path.join(migrationDir, fase1Files[0]), 'utf8');
  assert.match(base, /u\.activo IS TRUE[\s\S]*u\.hotel_id = p_hotel_id/i);
  assert.doesNotMatch(base, /superadmin[\s\S]*(OR|bypass)/i);
  assert.match(base, /DROP POLICY[\s\S]*ventas_tienda/i);
  assert.doesNotMatch(base, /USING\s*\(\s*true\s*\)|WITH CHECK\s*\(\s*true\s*\)/i);
});

test('financial definer RPCs require auth and safe search_path', () => {
  for (const name of ['procesar_pago_reserva_atomico','procesar_venta_tienda_atomica','procesar_venta_restaurante_atomica','revertir_movimiento_caja','cerrar_pedido_terraza','cerrar_pedido_terraza_mixto','cerrar_turno_con_arqueo']) {
    const at = sql.indexOf(`FUNCTION public.${name}`);
    assert.ok(at >= 0, `missing ${name}`);
    const fragment = sql.slice(at, at + 9000);
    assert.match(fragment, /SECURITY DEFINER[\s\S]*SET search_path\s*=\s*pg_catalog\s*,\s*public/i, name);
    assert.match(fragment, /auth\.uid\(\)/i, name);
    assert.match(fragment, /REVOKE ALL ON FUNCTION/i, name);
  }
});

test('legacy destructive RPC and generic increment are revoked only in final migration', () => {
  const finalSql = fs.readFileSync(path.join(migrationDir, fase1Files.at(-1)), 'utf8');
  assert.match(finalSql, /DROP FUNCTION IF EXISTS public\.increment/i);
  assert.match(finalSql, /DROP FUNCTION IF EXISTS public\.registrar_y_eliminar_mov_caja/i);
  assert.doesNotMatch(fase1Files.slice(0, -1).map((f) => fs.readFileSync(path.join(migrationDir, f), 'utf8')).join('\n'), /DROP FUNCTION IF EXISTS public\.(increment|registrar_y_eliminar_mov_caja)/i);
});

test('new writes carry idempotency and Bogota business date', () => {
  assert.match(sql, /client_operation_id uuid/i);
  assert.match(sql, /CREATE UNIQUE INDEX[\s\S]*client_operation_id/i);
  assert.match(sql, /AT TIME ZONE 'America\/Bogota'/i);
  assert.match(sql, /fase1_guard_caja_hotel_trg/i);
  assert.match(sql, /fase1_guard_pagos_reserva_hotel_trg/i);
});

test('migrations preserve legacy deletion logs and avoid mass historical repair', () => {
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+public\.(log_caja_eliminados|bitacora|caja_movimientos_eliminados)/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.reservas\s+SET\s+monto_pagado(?![\s\S]{0,250}WHERE\s+id\s*=\s*v_reserva\.id)/i);
});
