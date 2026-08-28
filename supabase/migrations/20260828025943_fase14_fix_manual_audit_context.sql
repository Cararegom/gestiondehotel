-- Correccion Fase 14/15: contexto explicito para toda accion administrativa de conciliacion.
-- Evita depender de reviewed_at/now(), que puede repetirse dentro de la misma transaccion.

-- Mueve las implementaciones privilegiadas fuera del esquema expuesto. Los nombres
-- public se recrean abajo como wrappers pequenos, service_role-only, que validan
-- motivo y fijan el contexto transaccional consumido por el trigger de auditoria.
alter function public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)
  set schema app_private;

alter function public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  set schema app_private;

revoke all on function app_private.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function app_private.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)
  to service_role;

revoke all on function app_private.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function app_private.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  to service_role;

create or replace function public.bank_email_audit_manual_event_update()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_actor_text text := nullif(current_setting('app.bank_reconciliation_manual_actor', true), '');
  v_reason text := nullif(btrim(coalesce(current_setting('app.bank_reconciliation_manual_reason', true), '')), '');
  v_action text := nullif(btrim(coalesce(current_setting('app.bank_reconciliation_manual_action', true), '')), '');
  v_actor uuid;
  v_before jsonb;
  v_after jsonb;
begin
  -- Los procesos automaticos no establecen este contexto y salen sin auditoria manual.
  if v_actor_text is null then
    return new;
  end if;

  begin
    v_actor := v_actor_text::uuid;
  exception when invalid_text_representation then
    raise exception 'Contexto de actor de conciliacion invalido.' using errcode = '42501';
  end;

  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.'
      using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.'
      using errcode = '22023';
  end if;
  if v_action not in ('link', 'confirm', 'reject', 'mark_reviewed') then
    raise exception 'Contexto de accion manual de conciliacion invalido.'
      using errcode = '22023';
  end if;

  if new.reviewed_by is distinct from v_actor then
    raise exception 'El actor auditado no coincide con el administrador verificado.'
      using errcode = '42501';
  end if;
  if not app_private.bank_email_actor_is_pilot_admin(v_actor, new.hotel_id) then
    raise exception 'Solo un administrador efectivo del hotel piloto puede conciliar pagos.'
      using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(new.review_reason, '')), '') is distinct from v_reason then
    raise exception 'El motivo persistido no coincide con el motivo auditado.'
      using errcode = '22023';
  end if;

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
    v_actor,
    'manual_reconciliation_state_changed',
    new.id,
    jsonb_build_object(
      'actor_id', v_actor,
      'action', v_action,
      'reason', v_reason,
      'before', v_before,
      'after', v_after
    )
  );

  return new;
end;
$function$;

revoke all on function public.bank_email_audit_manual_event_update()
  from public, anon, authenticated;
grant execute on function public.bank_email_audit_manual_event_update()
  to service_role;

drop trigger if exists bank_email_fase14_manual_audit_trg
  on public.bank_payment_events;
create trigger bank_email_fase14_manual_audit_trg
before update on public.bank_payment_events
for each row
when (new.reviewed_by is not null)
execute function public.bank_email_audit_manual_event_update();

create or replace function public.review_bank_payment_event(
  p_payment_event_id uuid,
  p_action text,
  p_actor_id uuid,
  p_reservation_id uuid default null,
  p_room_id uuid default null,
  p_sale_id uuid default null,
  p_sale_type text default null,
  p_expected_payment_id uuid default null,
  p_review_reason text default null,
  p_pilot_hotel_name text default 'Hotel Marena San Isidro'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_reason text := nullif(btrim(coalesce(p_review_reason, '')), '');
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'Falta el usuario verificado.' using errcode = '42501';
  end if;
  if v_action not in ('link', 'confirm', 'reject', 'mark_reviewed') then
    raise exception 'Accion manual no valida.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  perform set_config('app.bank_reconciliation_manual_actor', p_actor_id::text, true);
  perform set_config('app.bank_reconciliation_manual_reason', v_reason, true);
  perform set_config('app.bank_reconciliation_manual_action', v_action, true);

  v_result := app_private.review_bank_payment_event(
    p_payment_event_id,
    v_action,
    p_actor_id,
    p_reservation_id,
    p_room_id,
    p_sale_id,
    p_sale_type,
    p_expected_payment_id,
    v_reason,
    p_pilot_hotel_name
  );

  perform set_config('app.bank_reconciliation_manual_actor', '', true);
  perform set_config('app.bank_reconciliation_manual_reason', '', true);
  perform set_config('app.bank_reconciliation_manual_action', '', true);
  return v_result;
end;
$function$;

revoke all on function public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.review_bank_payment_event(uuid,text,uuid,uuid,uuid,uuid,text,uuid,text,text)
  to service_role;

create or replace function public.replace_bank_payment_allocations(
  p_payment_event_id uuid,
  p_actor_id uuid,
  p_allocations jsonb,
  p_action text,
  p_review_reason text default null,
  p_pilot_hotel_name text default 'Hotel Marena San Isidro'
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, app_private
as $function$
declare
  v_reason text := nullif(btrim(coalesce(p_review_reason, '')), '');
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'Falta el usuario verificado.' using errcode = '42501';
  end if;
  if v_action not in ('link', 'confirm') then
    raise exception 'La accion de distribucion no es valida.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  perform set_config('app.bank_reconciliation_manual_actor', p_actor_id::text, true);
  perform set_config('app.bank_reconciliation_manual_reason', v_reason, true);
  perform set_config('app.bank_reconciliation_manual_action', v_action, true);

  v_result := app_private.replace_bank_payment_allocations(
    p_payment_event_id,
    p_actor_id,
    p_allocations,
    v_action,
    v_reason,
    p_pilot_hotel_name
  );

  perform set_config('app.bank_reconciliation_manual_actor', '', true);
  perform set_config('app.bank_reconciliation_manual_reason', '', true);
  perform set_config('app.bank_reconciliation_manual_action', '', true);
  return v_result;
end;
$function$;

revoke all on function public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function public.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  to service_role;
