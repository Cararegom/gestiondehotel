const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260825130000_fase2_cuentas_ledger_shadow.sql','utf8');
const uiSql = fs.readFileSync('supabase/migrations/20260825131000_fase2_gestion_cuentas_rpc.sql','utf8');
const ui = fs.readFileSync('js/modules/finanzas-cuentas/finanzas-cuentas.js','utf8');
const main = fs.readFileSync('js/main.js','utf8');

test('Fase 2 creates tenant-scoped accounts and an immutable shadow ledger', () => {
  for (const table of ['financial_accounts','account_transfers','account_movements']) {
    assert.match(sql,new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql,new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql,/account_movements[\s\S]*caja_id uuid UNIQUE/);
  assert.match(sql,/REVOKE INSERT,UPDATE,DELETE[\s\S]*account_movements FROM authenticated/);
});

test('financial accounts UI uses authorized RPCs and is routed', () => {
  assert.match(uiSql,/FUNCTION public\.crear_cuenta_financiera/);
  assert.match(uiSql,/FUNCTION public\.asignar_metodo_cuenta/);
  assert.match(ui,/rpc\('resumen_cuentas_financieras'/);
  assert.match(ui,/rpc\('crear_transferencia_cuenta'/);
  assert.match(main,/\/finanzas-cuentas/);
  assert.match(main,/moduleKey: 'finanzas-cuentas', adminOnly: true/);
});

test('each new cash movement projects to the ledger inside PostgreSQL', () => {
  assert.match(sql,/FUNCTION public\.fase2_project_caja_to_account/);
  assert.match(sql,/AFTER INSERT ON public\.caja/);
  assert.match(sql,/INSERT INTO public\.account_movements/);
  assert.match(sql,/NEW\.tipo::text='ingreso'[\s\S]*'in'[\s\S]*'out'/);
});

test('account transfers are balanced, authorized and idempotent', () => {
  assert.match(sql,/FUNCTION public\.crear_transferencia_cuenta/);
  assert.match(sql,/finanzas\.cuentas_gestionar/);
  assert.match(sql,/client_operation_id=p_client_operation_id/);
  assert.match(sql,/v_from\.id,'out'[\s\S]*v_to\.id,'in'/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.crear_transferencia_cuenta[\s\S]*FROM PUBLIC,anon/);
});
