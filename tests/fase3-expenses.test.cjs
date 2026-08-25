const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260825140000_fase3_gastos_cuentas_por_pagar.sql', 'utf8');
const ui = fs.readFileSync('js/modules/gastos/gastos.js', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');

test('Fase 3 creates tenant-scoped expenses, catalogues and payments', () => {
  for (const table of ['expense_categories', 'cost_centers', 'expense_settings', 'expenses', 'expense_payments']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(migration, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(migration, /UNIQUE\(hotel_id,client_operation_id\)/);
  assert.match(migration, /CHECK\(round\(subtotal\+tax_amount,2\)=round\(total_amount,2\)\)/);
});

test('Gastos is an admin-only routed module using the authorized RPCs', () => {
  assert.match(main, /\/gastos/);
  assert.match(main, /moduleKey: 'gastos', adminOnly: true/);
  assert.match(ui, /rpc\(name, args\)/);
  for (const rpc of ['crear_gasto', 'aprobar_gasto', 'pagar_gasto', 'cancelar_gasto']) assert.match(ui, new RegExp(rpc));
  assert.match(ui, /Solo el administrador/);
});

test('expense writes are RPC-only and tenant authorized', () => {
  assert.match(migration, /REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public\.expenses,public\.expense_payments FROM authenticated/);
  assert.match(migration, /fase1_actor_tiene_permiso\(hotel_id,'gastos\.ver'\)/);
  assert.match(migration, /FUNCTION public\.crear_gasto/);
  assert.match(migration, /FUNCTION public\.aprobar_gasto/);
  assert.match(migration, /FUNCTION public\.pagar_gasto/);
  assert.match(migration, /FUNCTION public\.cancelar_gasto/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.crear_gasto[\s\S]*FROM PUBLIC,anon/);
});

test('payments preserve caja compatibility and ledger traceability', () => {
  assert.match(migration, /INSERT INTO public\.caja/);
  assert.match(migration, /'expense_payment'/);
  assert.match(migration, /SELECT id INTO v_movement FROM public\.account_movements WHERE caja_id=v_caja/);
  assert.match(migration, /UPDATE public\.account_movements SET expense_payment_id=v_payment\.id/);
  assert.match(migration, /IF round\(v_paid\+p_amount,2\)>round\(v_expense\.total_amount,2\)/);
  assert.match(migration, /'paid' ELSE 'partial'/);
});

test('approval and cancellation rules protect financial history', () => {
  assert.match(migration, /approval_threshold/);
  assert.match(migration, /'pending_approval' ELSE 'pending'/);
  assert.match(migration, /status<>'pending_approval'/);
  assert.match(migration, /EXISTS\(SELECT 1 FROM public\.expense_payments/);
  assert.match(migration, /El gasto pagado requiere/);
});
