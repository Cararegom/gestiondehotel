-- Fase 15/24: mínimos privilegios para conciliación bancaria.
--
-- - mueve el helper RLS del esquema expuesto public a app_private;
-- - conserva acceso RLS sin convertir el helper en RPC público;
-- - exige administrador efectivo (rol directo, asignado o dueño) en cada
--   actualización manual auditada;
-- - mantiene los RPC de escritura bancarios como service_role-only.

create schema if not exists app_private authorization postgres;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated, service_role;

create or replace function app_private.bank_email_user_has_pilot_access(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
  select coalesce(
    auth.uid() is not null
    and exists (
      select 1
      from public.hoteles h
      where h.id = p_hotel_id
        and lower(btrim(h.nombre)) = 'hotel marena san isidro'
    )
    and exists (
      select 1
      from public.usuarios u
      where u.id = auth.uid()
        and u.hotel_id = p_hotel_id
        and u.activo is true
    ),
    false
  );
$function$;

revoke all on function app_private.bank_email_user_has_pilot_access(uuid)
  from public, anon;
grant execute on function app_private.bank_email_user_has_pilot_access(uuid)
  to authenticated, service_role;

create or replace function app_private.bank_email_actor_is_pilot_admin(
  p_actor_id uuid,
  p_hotel_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, app_private
as $function$
  select coalesce(
    exists (
      select 1
      from public.usuarios u
      where u.id = p_actor_id
        and u.hotel_id = p_hotel_id
        and u.activo is true
        and exists (
          select 1
          from public.hoteles h
          where h.id = p_hotel_id
            and lower(btrim(h.nombre)) = 'hotel marena san isidro'
        )
        and (
          lower(btrim(coalesce(u.rol::text, ''))) in (
            'admin', 'administrador', 'superadmin',
            'super administrador', 'superadministrador'
          )
          or exists (
            select 1
            from public.hoteles h
            where h.id = p_hotel_id
              and h.creado_por = p_actor_id
          )
          or exists (
            select 1
            from public.usuarios_roles ur
            join public.roles r on r.id = ur.rol_id
            where ur.usuario_id = p_actor_id
              and ur.hotel_id = p_hotel_id
              and lower(btrim(coalesce(r.nombre, ''))) in (
                'admin', 'administrador', 'superadmin',
                'super administrador', 'superadministrador'
              )
          )
        )
    ),
    false
  );
$function$;

revoke all on function app_private.bank_email_actor_is_pilot_admin(uuid,uuid)
  from public, anon, authenticated;
grant execute on function app_private.bank_email_actor_is_pilot_admin(uuid,uuid)
  to service_role;

-- Endurece el trigger de Fase 14 sin duplicar la lógica de negocio de los RPC.
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
  if new.reviewed_by is null
     or new.reviewed_at is not distinct from old.reviewed_at then
    return new;
  end if;

  if not app_private.bank_email_actor_is_pilot_admin(new.reviewed_by, new.hotel_id) then
    raise exception 'Solo un administrador efectivo del hotel piloto puede conciliar pagos.'
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.'
      using errcode = '22023';
  end if;

  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.'
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

revoke all on function public.bank_email_audit_manual_event_update()
  from public, anon, authenticated;
grant execute on function public.bank_email_audit_manual_event_update()
  to service_role;

-- Las políticas siguen disponibles para authenticated, pero el helper ya no
-- vive en un esquema expuesto por la Data API.
drop policy if exists bank_payment_events_select_pilot
  on public.bank_payment_events;
create policy bank_payment_events_select_pilot
on public.bank_payment_events
for select
to authenticated
using (app_private.bank_email_user_has_pilot_access(hotel_id));

drop policy if exists expected_payments_select_pilot
  on public.expected_payments;
create policy expected_payments_select_pilot
on public.expected_payments
for select
to authenticated
using (app_private.bank_email_user_has_pilot_access(hotel_id));

-- Ya no debe existir una versión invocable por RPC dentro de public.
drop function if exists public.bank_email_user_has_pilot_access(uuid);
