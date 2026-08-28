const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const fase14 = fs.readFileSync('supabase/migrations/20260828023412_fase14_auditoria_acciones_conciliacion.sql', 'utf8');
const fase15 = fs.readFileSync('supabase/migrations/20260828024228_fase15_minimos_privilegios_conciliacion.sql', 'utf8');
const auditContext = fs.readFileSync('supabase/migrations/20260828025943_fase14_fix_manual_audit_context.sql', 'utf8');
const assignedAdminFix = fs.readFileSync('supabase/migrations/20260828030602_fase15_fix_assigned_admin_allocations.sql', 'utf8');
const behavior = fs.readFileSync('scripts/fase16-17-bank-reconciliation-behavior.sql', 'utf8');
const bankService = fs.readFileSync('js/services/bankPaymentService.js', 'utf8');

test('Fase 14 permite la accion normalizada de auditoria y limita datos sensibles', () => {
  assert.match(fase14, /manual_reconciliation_state_changed/);
  assert.match(fase14, /'before'/);
  assert.match(fase14, /'after'/);
  assert.match(fase14, /'actor_id'/);
  assert.match(fase14, /'reason'/);
  assert.match(fase14, /REVOKE ALL ON FUNCTION public\.bank_email_audit_manual_event_update\(\)/i);
});

test('Fase 15 mueve el helper RLS privilegiado a app_private', () => {
  assert.match(fase15, /create schema if not exists app_private/i);
  assert.match(fase15, /app_private\.bank_email_user_has_pilot_access/);
  assert.match(fase15, /drop function if exists public\.bank_email_user_has_pilot_access/i);
  assert.match(fase15, /app_private\.bank_email_actor_is_pilot_admin/);
  assert.match(fase15, /usuarios_roles/);
  assert.match(fase15, /roles/);
});

test('Fase 14 corregida no depende de timestamps para detectar la accion manual', () => {
  assert.match(auditContext, /app\.bank_reconciliation_manual_actor/);
  assert.match(auditContext, /app\.bank_reconciliation_manual_reason/);
  assert.match(auditContext, /app\.bank_reconciliation_manual_action/);
  assert.match(auditContext, /Toda accion manual de conciliacion requiere un motivo/);
  assert.match(auditContext, /set schema app_private/);
  assert.match(auditContext, /from public, anon, authenticated/i);
  assert.doesNotMatch(auditContext, /reviewed_at\s+is\s+distinct\s+from\s+old\.reviewed_at/i);
});

test('Fase 15 usa administrador efectivo tambien para redistribuir allocations', () => {
  assert.match(assignedAdminFix, /app_private\.bank_email_actor_is_pilot_admin\(p_actor_id, v_hotel_id\)/);
  assert.doesNotMatch(assignedAdminFix, /v_actor\.rol/);
  assert.match(assignedAdminFix, /Toda accion manual de conciliacion requiere un motivo/);
  assert.match(assignedAdminFix, /clock_timestamp\(\)/);
});

test('el servicio exige motivo para toda accion administrativa antes de invocar la API', () => {
  const manualAction = bankService.slice(
    bankService.indexOf('export async function submitBankPaymentManualAction'),
    bankService.indexOf('export async function simulateBankPaymentEmail')
  );
  assert.match(manualAction, /if \(!payload\.reviewReason\)/);
  assert.match(manualAction, /Indica el motivo de la accion administrativa/);
  assert.doesNotMatch(manualAction, /payload\.manualAction === 'reject' && !payload\.reviewReason/);
});

test('Fases 16-17 versionan 18 aserciones de comportamiento y siempre hacen rollback', () => {
  for (let i = 1; i <= 18; i += 1) {
    assert.match(behavior, new RegExp(`assert_true\\(${i},`), `falta caso ${i}`);
  }
  assert.match(behavior, /metadata\.is_test|"is_test":true/);
  assert.match(behavior, /rollback;\s*$/i);
  assert.match(behavior, /expected',18/);
  assert.match(behavior, /gmail_message_id duplicado/);
  assert.match(behavior, /Gmail ausente no bloquea Caja\/ledger/);
  assert.match(behavior, /recepcionista bloqueada/);
  assert.match(behavior, /admin de otro hotel bloqueado/);
});
