const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const ledger = fs.readFileSync('supabase/migrations/20260825130000_fase2_cuentas_ledger_shadow.sql', 'utf8');
const expenses = fs.readFileSync('supabase/migrations/20260825140000_fase3_gastos_cuentas_por_pagar.sql', 'utf8');
const bankApi = fs.readFileSync('supabase/functions/bank-email-api/index.ts', 'utf8');
const audit = fs.readFileSync('scripts/fase13-financial-trace-audit.sql', 'utf8');

test('Fase 13 conserva una sola proyeccion de Caja al ledger', () => {
  assert.match(ledger, /caja_id uuid UNIQUE REFERENCES public\.caja/);
  assert.match(ledger, /fase2_project_caja_to_account_trg/);
  assert.match(ledger, /EXISTS\(SELECT 1 FROM public\.account_movements WHERE caja_id=NEW\.id\)/);
  assert.match(audit, /NOT EXISTS[\s\S]*account_movements m WHERE m\.caja_id = c\.id/);
});

test('Fase 13 enlaza gastos y conciliacion sin materializar dinero dos veces', () => {
  assert.match(expenses, /caja_id uuid NOT NULL UNIQUE/);
  assert.match(expenses, /account_movement_id uuid NOT NULL UNIQUE/);
  const statusesSection = bankApi.slice(bankApi.indexOf("if (action === 'cash-movement-statuses')"), bankApi.indexOf("if (action === 'list')"));
  assert.match(statusesSection, /bank_payment_allocations/);
  assert.doesNotMatch(statusesSection, /\.insert\(|\.update\(|\.delete\(/);
});
