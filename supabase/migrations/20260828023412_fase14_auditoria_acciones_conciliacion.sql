-- Fase 14/24: auditoría completa de acciones administrativas de conciliación.
--
-- Objetivo:
-- - cada revisión manual deja actor, motivo y snapshot before/after;
-- - el motivo es obligatorio a nivel de base de datos;
-- - no se almacenan cuerpo del correo, referencia bancaria completa ni tokens;
-- - se conserva la auditoría específica existente de allocations.

alter table public.bank_payment_audit_log
  drop constraint if exists bank_payment_audit_log_action_check;

alter table public.bank_payment_audit_log
  add constraint bank_payment_audit_log_action_check
  check (action = any (array[
    'payment_detected'::text,
    'auto_matched'::text,
    'manual_confirmed'::text,
    'relation_changed'::text,
    'payment_rejected'::text,
    'duplicate_detected'::text,
    'parse_error'::text,
    'gmail_watch_renewed'::text,
    'gmail_watch_renewal_failed'::text,
    'gmail_connected'::text,
    'gmail_connection_failed'::text,
    'gmail_disconnected'::text,
    'matching_ambiguous'::text,
    'no_match'::text,
    'marked_reviewed'::text,
    'expected_payment_created'::text,
    'expected_payment_cancelled'::text,
    'multiple_allocation_changed'::text,
    'manual_reconciliation_state_changed'::text
  ]));

create or replace function public.bank_email_audit_manual_event_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_reason text := nullif(btrim(coalesce(new.review_reason, '')), '');
  v_before jsonb;
  v_after jsonb;
begin
  -- Solo audita una acción humana verificada. Los procesos automáticos no
  -- establecen reviewed_by/reviewed_at y por tanto no entran en este camino.
  if new.reviewed_by is null
     or new.reviewed_at is not distinct from old.reviewed_at then
    return new;
  end if;

  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.'
      using errcode = '22023';
  end if;

  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.'
      using errcode = '22023';
  end if;

  -- Snapshot deliberadamente mínimo. Excluye cuerpo del correo, remitente,
  -- referencia, fingerprints, hashes e integración OAuth.
  v_before := jsonb_build_object(
    'status', old.status,
    'reservation_id', old.matched_reservation_id,
    'room_id', old.matched_room_id,
    'sale_id', old.matched_sale_id,
    'sale_type', old.matched_sale_type,
    'expected_payment_id', old.matched_expected_payment_id,
    'review_reason', old.review_reason,
    'reviewed_by', old.reviewed_by,
    'reviewed_at', old.reviewed_at,
    'confirmed_by', old.confirmed_by,
    'confirmed_at', old.confirmed_at
  );

  v_after := jsonb_build_object(
    'status', new.status,
    'reservation_id', new.matched_reservation_id,
    'room_id', new.matched_room_id,
    'sale_id', new.matched_sale_id,
    'sale_type', new.matched_sale_type,
    'expected_payment_id', new.matched_expected_payment_id,
    'review_reason', v_reason,
    'reviewed_by', new.reviewed_by,
    'reviewed_at', new.reviewed_at,
    'confirmed_by', new.confirmed_by,
    'confirmed_at', new.confirmed_at
  );

  perform public.bank_email_write_audit(
    new.hotel_id,
    new.reviewed_by,
    'manual_reconciliation_state_changed',
    new.id,
    jsonb_build_object(
      'actor_id', new.reviewed_by,
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  );

  return new;
end;
$function$;

-- La función se ejecuta por vínculo de trigger; no forma parte de la API del navegador.
revoke all on function public.bank_email_audit_manual_event_update()
  from public, anon, authenticated;
grant execute on function public.bank_email_audit_manual_event_update()
  to service_role;

drop trigger if exists bank_email_fase14_manual_audit_trg
  on public.bank_payment_events;

create trigger bank_email_fase14_manual_audit_trg
before update on public.bank_payment_events
for each row
when (
  new.reviewed_by is not null
  and new.reviewed_at is distinct from old.reviewed_at
)
execute function public.bank_email_audit_manual_event_update();
