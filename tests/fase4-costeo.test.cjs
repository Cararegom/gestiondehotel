const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260825160000_fase4_costeo_inventario_cmv.sql', 'utf8');
const adjustmentSql = fs.readFileSync('supabase/migrations/20260825161000_fase4_ajustes_inventario_valorizados.sql', 'utf8');
const newItemsSql = fs.readFileSync('supabase/migrations/20260825162000_fase4_nuevos_items_costeo.sql', 'utf8');
const ui = fs.readFileSync('js/modules/costeo/costeo.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');

test('Fase 4 creates immutable tenant-scoped valuation and COGS records', () => {
  for (const table of ['inventory_cost_balances', 'inventory_valuation_movements', 'cogs_entries']) {
    assert.match(sql, new RegExp(`CREATE TABLE public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER/);
  assert.match(sql, /cost_status text NOT NULL DEFAULT 'uninitialized'/);
});

test('moving average receives purchases and freezes store sale COGS', () => {
  assert.match(sql, /v_value:=v\.inventory_value\+\(p_qty\*p_unit\)/);
  assert.match(sql, /v_avg:=CASE WHEN v_qty=0 THEN 0 ELSE v_value\/v_qty END/);
  assert.match(sql, /fase4_store_purchase_cost/);
  assert.match(sql, /fase4_store_sale_cogs/);
  assert.match(sql, /NEW\.subtotal-\(v_cost\*NEW\.cantidad\)/);
});

test('restaurant recipes, terrace sales and transfers carry cost', () => {
  assert.match(sql, /fase4_restaurant_sale_cogs/);
  assert.match(sql, /UPDATE public\.ingredientes SET stock_actual=stock_actual-v_qty/);
  assert.match(sql, /fase4_terrace_sale_cogs/);
  assert.match(sql, /fase4_transfer_cost/);
  assert.match(sql, /Transferencia Tienda a Terraza/);
  assert.match(adjustmentSql, /fase4_inventory_adjustment_cost/);
  assert.match(newItemsSql, /fase4_seed_new_inventory_item/);
  for (const table of ['productos_tienda', 'terraza_productos', 'ingredientes']) assert.match(newItemsSql, new RegExp(`AFTER INSERT ON public\\.${table}`));
});

test('admin cost dashboard exposes initialization, valuation and margin', () => {
  assert.match(main, /moduleKey: 'costeo', adminOnly: true/);
  assert.match(ui, /inventory_cost_balances/);
  assert.match(ui, /cogs_entries/);
  assert.match(ui, /establecer_costo_inicial_inventario/);
  assert.match(ui, /Inventario valorizado/);
  assert.match(ui, /Margen bruto/);
});
