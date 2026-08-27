const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const migration = fs.readFileSync('supabase/migrations/20260827015126_fase10_sincronizar_metodo_pago_caja_ledger.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260827052344_premerge_bank_feature_hardening.sql', 'utf8');
const cashModule = fs.readFileSync('js/modules/caja/caja-movimientos.js', 'utf8');

test('Fase 10 cambia el metodo exclusivamente mediante el RPC atomico', () => {
  assert.match(cashModule, /rpc\('actualizar_metodo_pago_caja'/);
  assert.doesNotMatch(cashModule, /from\('caja'\)[\s\S]{0,120}\.update\(\{ metodo_pago_id/);
  assert.match(migration, /REVOKE UPDATE \(metodo_pago_id\) ON public\.caja FROM authenticated/);
});

test('checkpoint bloquea turnos cerrados y exige motivo de efectivo a banco por tipo contable', () => {
  assert.match(hardening, /v_turno_estado='cerrado'/);
  assert.match(hardening, /v_old_account_type='cash' AND v_new_account_type='bank'/);
  assert.match(hardening, /El motivo es obligatorio/);
  assert.match(hardening, /char_length\(v_reason\)>500/);
  assert.match(hardening, /financial_accounts/);
});

test('checkpoint conserva idempotencia, auditoria y notificacion no bloqueante', () => {
  assert.match(hardening, /IS NOT DISTINCT FROM p_metodo_pago_id/);
  assert.match(hardening, /auditoria_operaciones/);
  assert.match(hardening, /financial_account_id.*account_type.*ledger/s);
  assert.match(hardening, /EXCEPTION WHEN OTHERS THEN\s+NULL/);
});

test('Fase 10 sincroniza Caja y ledger sin modificar datos financieros restantes', () => {
  const rpc = migration.slice(
    migration.indexOf('CREATE OR REPLACE FUNCTION public.actualizar_metodo_pago_caja'),
    migration.indexOf("$function$;", migration.indexOf('CREATE OR REPLACE FUNCTION public.actualizar_metodo_pago_caja')) + 11
  );
  assert.match(rpc, /FOR UPDATE/);
  assert.match(rpc, /fase2_ensure_method_account/);
  assert.match(rpc, /UPDATE public\.account_movements[\s\S]*metodo_pago_id = p_metodo_pago_id[\s\S]*account_id = v_account_id/);
  assert.match(rpc, /auditoria_operaciones/);
  const cashUpdate = rpc.slice(rpc.indexOf('UPDATE public.caja'), rpc.indexOf('RETURNING * INTO v_movimiento') + 29);
  assert.match(cashUpdate, /SET metodo_pago_id = p_metodo_pago_id,[\s\S]*actualizado_en = now\(\)/);
  assert.doesNotMatch(cashUpdate, /(?:monto|concepto|turno_id|hotel_id|usuario_id)\s*=/i);
});

test('Fase 10 conserva autorizacion tenant y cierra ejecucion publica', () => {
  assert.match(migration, /v_movimiento\.hotel_id IS DISTINCT FROM v_actor\.hotel_id/);
  assert.match(migration, /hotel_id = v_actor\.hotel_id[\s\S]*activo IS TRUE/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.actualizar_metodo_pago_caja\(uuid, uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.actualizar_metodo_pago_caja\(uuid, uuid\) TO authenticated, service_role/);
});

test('Fase 10 repara solo asientos que ya tienen relacion explicita con Caja', () => {
  const repair = migration.slice(migration.indexOf('DO $repair$'));
  assert.match(repair, /JOIN public\.account_movements m ON m\.caja_id = c\.id/);
  assert.match(repair, /m\.metodo_pago_id IS DISTINCT FROM c\.metodo_pago_id/);
  assert.match(repair, /m\.account_id IS DISTINCT FROM mp\.financial_account_id/);
  assert.doesNotMatch(repair, /INSERT INTO public\.account_movements/);
});
