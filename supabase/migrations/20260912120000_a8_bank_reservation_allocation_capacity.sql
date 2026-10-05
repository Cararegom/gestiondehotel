-- A8: serializa las asignaciones bancarias por reserva y limita su capacidad.
-- La conciliacion enlaza eventos bancarios; no crea pagos ni movimientos de Caja.

create or replace function public.bank_email_reservation_available_amount_cop(
  p_reservation_id uuid,
  p_hotel_id uuid,
  p_exclude_payment_event_id uuid default null
)
returns bigint
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_pilot_hotel_id uuid;
  v_reservation_total numeric;
  v_reservation_paid numeric;
  v_payment_rows_total numeric;
  v_expected_total numeric;
  v_unbacked_allocated numeric;
  v_legacy_allocated numeric;
begin
  v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  if p_hotel_id is distinct from v_pilot_hotel_id then
    return null;
  end if;

  select coalesce(r.monto_total, 0), coalesce(r.monto_pagado, 0)
    into v_reservation_total, v_reservation_paid
    from public.reservas r
   where r.id = p_reservation_id
     and r.hotel_id = v_pilot_hotel_id;
  if not found then
    return null;
  end if;

  select coalesce(sum(pr.monto), 0)
    into v_payment_rows_total
    from public.pagos_reserva pr
   where pr.hotel_id = v_pilot_hotel_id
     and pr.reserva_id = p_reservation_id;

  -- Los pagos esperados pendientes vigentes y los ya enlazados tambien reservan
  -- capacidad. Al editar un evento se excluye su propio pago esperado.
  select coalesce(sum(ep.expected_amount_cop), 0)
    into v_expected_total
    from public.expected_payments ep
   where ep.hotel_id = v_pilot_hotel_id
     and ep.reservation_id = p_reservation_id
     and (
       ep.status in ('matched', 'confirmed')
       or (
         ep.status = 'pending'
         and (ep.expires_at is null or ep.expires_at >= now())
       )
     )
     and (
       p_exclude_payment_event_id is null
       or ep.matched_bank_payment_id is distinct from p_exclude_payment_event_id
     );

  -- Una allocation con caja_id ya esta incluida en pagos_reserva/monto_pagado.
  -- Solo las asignaciones bancarias aun no respaldadas por Caja consumen saldo
  -- adicional, evitando descontar dos veces el mismo cobro.
  select coalesce(sum(a.amount_cop), 0)
    into v_unbacked_allocated
    from public.bank_payment_allocations a
    join public.bank_payment_events e
      on e.id = a.payment_event_id
     and e.hotel_id = a.hotel_id
   where a.hotel_id = v_pilot_hotel_id
     and a.allocation_type = 'reservation'
     and a.reservation_id = p_reservation_id
     and a.caja_id is null
     and e.status in ('matched', 'confirmed')
     and (
       p_exclude_payment_event_id is null
       or a.payment_event_id <> p_exclude_payment_event_id
     );

  -- Conserva compatibilidad con relaciones 1:1 anteriores a allocations.
  select coalesce(sum(e.amount_cop), 0)
    into v_legacy_allocated
    from public.bank_payment_events e
   where e.hotel_id = v_pilot_hotel_id
     and e.status in ('matched', 'confirmed')
     and e.matched_expected_payment_id is null
     and e.matched_reservation_id = p_reservation_id
     and (
       p_exclude_payment_event_id is null
       or e.id <> p_exclude_payment_event_id
     )
     and not exists (
       select 1
         from public.bank_payment_allocations a
        where a.hotel_id = e.hotel_id
          and a.payment_event_id = e.id
     );

  return greatest(
    0,
    floor(
      v_reservation_total
      - greatest(v_reservation_paid, v_payment_rows_total)
      - v_expected_total
      - v_unbacked_allocated
      - v_legacy_allocated
    )::bigint
  );
end;
$function$;

revoke all on function public.bank_email_reservation_available_amount_cop(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.bank_email_reservation_available_amount_cop(uuid, uuid, uuid)
  to service_role;

comment on function public.bank_email_reservation_available_amount_cop(uuid, uuid, uuid) is
  'Saldo conciliable de una reserva del piloto; descuenta pagos, pagos esperados y allocations activas sin respaldo de Caja.';

create or replace function public.bank_email_validate_reservation_allocation_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_available bigint;
  v_event_request_total bigint;
begin
  if new.allocation_type is distinct from 'reservation' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    new.hotel_id::text || ':bank-reservation:' || new.reservation_id::text,
    0
  ));

  -- replace_bank_payment_allocations_from_caja valida antes el movimiento exacto,
  -- su monto, destino, cuenta bancaria y unicidad. Esa relacion no agrega otro
  -- cobro a la reserva y por eso no vuelve a consumir capacidad aqui.
  if current_setting('app.bank_reconciliation_caja_validated', true) = 'true' then
    return new;
  end if;

  v_available := public.bank_email_reservation_available_amount_cop(
    new.reservation_id,
    new.hotel_id,
    new.payment_event_id
  );

  select new.amount_cop + coalesce(sum(a.amount_cop), 0)
    into v_event_request_total
    from public.bank_payment_allocations a
   where a.hotel_id = new.hotel_id
     and a.payment_event_id = new.payment_event_id
     and a.allocation_type = 'reservation'
     and a.reservation_id = new.reservation_id
     and a.id is distinct from new.id;

  if v_available is null or v_event_request_total > v_available then
    raise exception 'La reserva ya fue conciliada o el valor supera su saldo conciliable (%).',
      coalesce(v_available, 0) using errcode = '22023';
  end if;

  return new;
end;
$function$;

revoke all on function public.bank_email_validate_reservation_allocation_capacity()
  from public, anon, authenticated;
grant execute on function public.bank_email_validate_reservation_allocation_capacity()
  to service_role;

drop trigger if exists bank_email_reservation_allocation_capacity_trg
  on public.bank_payment_allocations;
create trigger bank_email_reservation_allocation_capacity_trg
before insert or update of hotel_id, payment_event_id, allocation_type, reservation_id, amount_cop, caja_id
on public.bank_payment_allocations
for each row
execute function public.bank_email_validate_reservation_allocation_capacity();

-- Conserva la validacion completa del RPC de Recepcion y agrega un contexto
-- transaccional que el trigger anterior solo acepta durante esa ruta verificada.
alter function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text)
  set schema app_private;

revoke all on function app_private.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function app_private.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text)
  to service_role;

create or replace function public.replace_bank_payment_allocations_from_caja(
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
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;

  perform set_config('app.bank_reconciliation_caja_validated', 'true', true);
  begin
    v_result := app_private.replace_bank_payment_allocations_from_caja(
      p_payment_event_id,
      p_actor_id,
      p_allocations,
      p_action,
      p_review_reason,
      p_pilot_hotel_name
    );
  exception when others then
    perform set_config('app.bank_reconciliation_caja_validated', '', true);
    raise;
  end;
  perform set_config('app.bank_reconciliation_caja_validated', '', true);
  return v_result;
end;
$function$;

revoke all on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text)
  from public, anon, authenticated;
grant execute on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text)
  to service_role;

comment on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text) is
  'Wrapper service_role-only que conserva la validacion exacta de Caja y habilita su contexto solo durante la transaccion.';
