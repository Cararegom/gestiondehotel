const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260825180845_fase5_pnl_presupuestos_periodos.sql', 'utf8');
const indexSql = fs.readFileSync('supabase/migrations/20260825180939_fase5_indices_auditoria.sql', 'utf8');
const closingSql = fs.readFileSync('supabase/migrations/20260825182301_fase5_bloqueo_cierre_calidad.sql', 'utf8');
const main = fs.readFileSync('js/main.js', 'utf8');
const hub = fs.readFileSync('js/modules/reportes/reportes-centro.js', 'utf8');
const pnl = fs.readFileSync('js/modules/reportes/finanzas-pnl.js', 'utf8');

test('Fase 5 builds a traceable shadow P&L with budgets and periods', () => {
  assert.match(sql, /VIEW public\.financial_transactions[\s\S]*security_invoker = true/);
  for (const table of ['financial_budgets', 'financial_periods']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /obtener_estado_resultados_shadow/);
  assert.match(sql, /guardar_presupuesto_financiero/);
  assert.match(sql, /cambiar_estado_periodo_financiero/);
  assert.match(sql, /usuario_actual_es_admin_hotel/);
  assert.match(sql, /REVOKE ALL ON public\.financial_transactions FROM PUBLIC, anon, authenticated/);
  for (const column of ['created_by', 'updated_by', 'closed_by', 'reopened_by']) assert.match(indexSql, new RegExp(`\\(${column}\\)`));
});

test('financial close is blocked until every sale has a valid frozen cost', () => {
  assert.match(closingSql, /No se puede cerrar el mes/);
  assert.match(closingSql, /cost_issue IS NOT NULL/);
  assert.match(closingSql, /'issues',v_issues/);
  assert.match(closingSql, /'can_close',jsonb_array_length\(v_issues\)=0/);
  assert.match(pnl, /Pendientes que impiden cerrar el mes/);
  assert.match(pnl, /Configurar receta/);
});

test('Reportes is the visible hub while legacy finance routes remain protected', () => {
  assert.match(main, /reportes-centro\.js/);
  assert.doesNotMatch(main, /path: '#\/finanzas-cuentas'/);
  assert.doesNotMatch(main, /path: '#\/gastos'/);
  assert.doesNotMatch(main, /path: '#\/costeo'/);
  assert.match(main, /'\/finanzas-cuentas':[^{]*\{[^}]*adminOnly: true/);
  assert.match(main, /routeConfig = navLinksConfig[^;]+\|\| routeEntry/);
  assert.match(hub, /Reportes operativos/);
  assert.match(hub, /Estado de resultados/);
  assert.match(hub, /adminOnly: true/);
});

test('P&L UI uses only authorized financial RPCs for writes and reads', () => {
  assert.match(pnl, /rpc\('obtener_estado_resultados_shadow'/);
  assert.match(pnl, /rpc\('guardar_presupuesto_financiero'/);
  assert.match(pnl, /rpc\('cambiar_estado_periodo_financiero'/);
  assert.doesNotMatch(pnl, /\.from\('financial_(budgets|periods|transactions)'\)/);
  assert.match(pnl, /Informe de control \(shadow\)/);
});
