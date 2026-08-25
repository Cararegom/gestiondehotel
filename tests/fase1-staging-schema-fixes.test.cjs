const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260825100000_fix_movimientos_inventario_id_default.sql', 'utf8');

test('movimientos de inventario recuperan un id autogenerado', () => {
  assert.match(sql, /CREATE SEQUENCE IF NOT EXISTS public\.movimientos_inventario_id_seq/);
  assert.match(sql, /max\(id\) FROM public\.movimientos_inventario/);
  assert.match(sql, /ALTER COLUMN id SET DEFAULT nextval/);
});
