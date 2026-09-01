-- La conciliacion bancaria durable depende del movimiento exacto de Caja.
-- Cerrar/finalizar una reserva no invalida un pago si todas sus asignaciones
-- siguen respaldadas por movimientos de Caja validos y por el mismo valor.

create or replace function public.bank_payment_has_valid_caja_link(
  p_payment_event_id uuid,
  p_hotel_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.bank_payment_events e
     where e.id = p_payment_event_id
       and e.hotel_id = p_hotel_id
       and exists (
         select 1
           from public.bank_payment_allocations a
          where a.payment_event_id = e.id
            and a.hotel_id = e.hotel_id
       )
       and e.amount_cop::numeric = (
         select coalesce(sum(a.amount_cop), 0)::numeric
           from public.bank_payment_allocations a
          where a.payment_event_id = e.id
            and a.hotel_id = e.hotel_id
       )
       and not exists (
         select 1
           from public.bank_payment_allocations a
           left join public.caja c
             on c.id = a.caja_id
           left join public.metodos_pago m
             on m.id = c.metodo_pago_id
            and m.hotel_id = c.hotel_id
           left join public.financial_accounts fa
             on fa.id = m.financial_account_id
            and fa.hotel_id = c.hotel_id
          where a.payment_event_id = e.id
            and a.hotel_id = e.hotel_id
            and (
              a.caja_id is null
              or c.id is null
              or c.hotel_id is distinct from e.hotel_id
              or c.tipo is distinct from 'ingreso'
              or coalesce(c.source, '') = 'caja_reversal'
              or c.original_movement_id is not null
              or c.monto::numeric is distinct from a.amount_cop::numeric
              or m.id is null
              or fa.id is null
              or fa.account_type is distinct from 'bank'
              or (
                a.allocation_type = 'reservation'
                and c.reserva_id is distinct from a.reservation_id
              )
              or (
                a.allocation_type = 'sale'
                and (
                  (a.sale_type = 'tienda' and c.venta_tienda_id is distinct from a.sale_id)
                  or (a.sale_type = 'restaurante' and c.venta_restaurante_id is distinct from a.sale_id)
                  or (a.sale_type = 'terraza' and c.venta_terraza_id is distinct from a.sale_id)
                  or a.sale_type not in ('tienda', 'restaurante', 'terraza')
                )
              )
            )
       )
  );
$function$;

revoke all on function public.bank_payment_has_valid_caja_link(uuid, uuid) from public;
revoke all on function public.bank_payment_has_valid_caja_link(uuid, uuid) from anon;
revoke all on function public.bank_payment_has_valid_caja_link(uuid, uuid) from authenticated;
grant execute on function public.bank_payment_has_valid_caja_link(uuid, uuid) to service_role;

create or replace function public.bank_email_handle_reservation_update()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_pilot_hotel_id uuid;
  v_reason text;
  v_event_ids uuid[];
  v_all_event_ids uuid[];
  v_event_id uuid;
  v_cancelled integer := 0;
begin
  begin
    v_pilot_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  exception when others then
    return new;
  end;
  if old.hotel_id is distinct from v_pilot_hotel_id then
    return new;
  end if;

  v_reason := case
    when new.hotel_id is distinct from old.hotel_id then 'reservation_hotel_changed'
    when new.estado::text not in (
      'activa', 'check_in', 'ocupada', 'pendiente', 'reservada',
      'confirmada', 'tiempo agotado'
    ) then 'reservation_inactive'
    when new.habitacion_id is distinct from old.habitacion_id then 'reservation_room_changed'
    when new.monto_total is distinct from old.monto_total
      or new.monto_pagado is distinct from old.monto_pagado then 'reservation_balance_changed'
    else null
  end;
  if v_reason is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    v_pilot_hotel_id::text || ':expected-matching',
    0
  ));

  select array_agg(distinct e.id order by e.id)
    into v_event_ids
    from public.bank_payment_events e
   where e.hotel_id = v_pilot_hotel_id
     and e.status = 'matched'
     and (
       e.matched_reservation_id = old.id
       or e.matched_expected_payment_id in (
         select ep.id
           from public.expected_payments ep
          where ep.hotel_id = v_pilot_hotel_id
            and ep.reservation_id = old.id
       )
     )
     and not (
       v_reason = 'reservation_inactive'
       and public.bank_payment_has_valid_caja_link(e.id, v_pilot_hotel_id)
     );

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    select array_agg(distinct event_id order by event_id)
      into v_all_event_ids
      from (
        select unnest(coalesce(v_event_ids, array[]::uuid[])) as event_id
        union
        select e.id
          from public.bank_payment_events e
         where e.hotel_id = v_pilot_hotel_id
           and e.matched_reservation_id = old.id
      ) affected;
  else
    v_all_event_ids := v_event_ids;
  end if;

  update public.bank_payment_events e
     set status = 'manual_review',
         matched_expected_payment_id = null,
         matched_reservation_id = case
           when new.hotel_id is distinct from old.hotel_id then null
           else e.matched_reservation_id
         end,
         matched_room_id = case
           when new.habitacion_id is distinct from old.habitacion_id then null
           else e.matched_room_id
         end,
         review_reason = v_reason,
         metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
           'reservation_invalidated', true,
           'reservation_invalidation_reason', v_reason,
           'reservation_invalidated_at', now()
         )
   where e.id = any(coalesce(v_event_ids, array[]::uuid[]));

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    update public.bank_payment_events e
       set matched_reservation_id = case
             when new.hotel_id is distinct from old.hotel_id then null
             else e.matched_reservation_id
           end,
           matched_room_id = case
             when new.habitacion_id is distinct from old.habitacion_id then null
             else e.matched_room_id
           end,
           metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
             'reservation_relation_changed', true,
             'relation_invalidated', true,
             'reservation_relation_change_reason', v_reason,
             'reservation_relation_changed_at', now()
           )
     where e.hotel_id = v_pilot_hotel_id
       and e.matched_reservation_id = old.id
       and e.status <> 'matched';
  end if;

  update public.expected_payments ep
     set status = 'cancelled',
         matched_bank_payment_id = null,
         reservation_id = case
           when new.hotel_id is distinct from old.hotel_id then null
           else ep.reservation_id
         end,
         room_id = case
           when new.habitacion_id is distinct from old.habitacion_id then null
           else ep.room_id
         end,
         updated_at = now()
   where ep.hotel_id = v_pilot_hotel_id
     and ep.reservation_id = old.id
     and ep.status in ('pending', 'matched');
  get diagnostics v_cancelled = row_count;

  if new.hotel_id is distinct from old.hotel_id
     or new.habitacion_id is distinct from old.habitacion_id then
    update public.expected_payments ep
       set reservation_id = case
             when new.hotel_id is distinct from old.hotel_id then null
             else ep.reservation_id
           end,
           room_id = case
             when new.habitacion_id is distinct from old.habitacion_id then null
             else ep.room_id
           end,
           updated_at = now()
     where ep.hotel_id = v_pilot_hotel_id
       and ep.reservation_id = old.id
       and ep.status in ('confirmed', 'cancelled', 'expired');
  end if;

  if v_cancelled > 0 then
    perform public.bank_email_write_audit(
      v_pilot_hotel_id, null, 'expected_payment_cancelled', null,
      jsonb_build_object(
        'reason', v_reason,
        'reservation_id', old.id,
        'cancelled_count', v_cancelled
      )
    );
  end if;
  foreach v_event_id in array coalesce(v_all_event_ids, array[]::uuid[]) loop
    perform public.bank_email_write_audit(
      v_pilot_hotel_id, null, 'relation_changed', v_event_id,
      jsonb_build_object('reason', v_reason, 'reservation_id', old.id)
    );
  end loop;
  foreach v_event_id in array coalesce(v_event_ids, array[]::uuid[]) loop
    perform public.bank_email_notify_payment_event(v_event_id);
  end loop;
  return new;
end;
$function$;

-- Si cambia la evidencia contable de Caja, la conciliacion debe volver a revision.
create or replace function public.bank_reconciliation_handle_caja_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_link record;
begin
  if not (
    new.hotel_id is distinct from old.hotel_id
    or new.tipo is distinct from old.tipo
    or new.monto is distinct from old.monto
    or new.metodo_pago_id is distinct from old.metodo_pago_id
    or new.reserva_id is distinct from old.reserva_id
    or new.venta_tienda_id is distinct from old.venta_tienda_id
    or new.venta_restaurante_id is distinct from old.venta_restaurante_id
    or new.venta_terraza_id is distinct from old.venta_terraza_id
    or new.source is distinct from old.source
    or new.original_movement_id is distinct from old.original_movement_id
  ) then
    return new;
  end if;

  for v_link in
    select distinct a.payment_event_id, a.hotel_id
      from public.bank_payment_allocations a
      join public.bank_payment_events e
        on e.id = a.payment_event_id
       and e.hotel_id = a.hotel_id
     where a.caja_id = old.id
       and e.status = 'matched'
  loop
    if not public.bank_payment_has_valid_caja_link(v_link.payment_event_id, v_link.hotel_id) then
      update public.bank_payment_events e
         set status = 'manual_review',
             matched_expected_payment_id = null,
             review_reason = 'cash_movement_changed',
             metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
               'cash_movement_invalidated', true,
               'cash_movement_id', old.id,
               'cash_movement_invalidated_at', now()
             )
       where e.id = v_link.payment_event_id
         and e.hotel_id = v_link.hotel_id
         and e.status = 'matched';

      if found then
        perform public.bank_email_write_audit(
          v_link.hotel_id,
          null,
          'relation_changed',
          v_link.payment_event_id,
          jsonb_build_object(
            'reason', 'cash_movement_changed',
            'caja_id', old.id
          )
        );
        perform public.bank_email_notify_payment_event(v_link.payment_event_id);
      end if;
    end if;
  end loop;

  return new;
end;
$function$;

revoke all on function public.bank_reconciliation_handle_caja_update() from public;
revoke all on function public.bank_reconciliation_handle_caja_update() from anon;
revoke all on function public.bank_reconciliation_handle_caja_update() from authenticated;

drop trigger if exists bank_reconciliation_caja_update_trg on public.caja;
create trigger bank_reconciliation_caja_update_trg
after update of hotel_id, tipo, monto, metodo_pago_id, reserva_id,
  venta_tienda_id, venta_restaurante_id, venta_terraza_id, source, original_movement_id
on public.caja
for each row execute function public.bank_reconciliation_handle_caja_update();

-- Repara conciliaciones anteriores al despliegue de caja_id que ya fueron
-- degradadas solo porque la reserva termino, siempre que Caja siga integra.
do $do$
declare
  v_event record;
  v_original_reason text;
begin
  for v_event in
    select e.id, e.hotel_id
      from public.bank_payment_events e
     where e.status = 'manual_review'
       and e.review_reason = 'reservation_inactive'
       and public.bank_payment_has_valid_caja_link(e.id, e.hotel_id)
  loop
    select l.details #>> '{after,review_reason}'
      into v_original_reason
      from public.bank_payment_audit_log l
     where l.payment_event_id = v_event.id
       and l.action = 'manual_reconciliation_state_changed'
     order by l.created_at desc
     limit 1;

    update public.bank_payment_events e
       set status = 'matched',
           review_reason = coalesce(nullif(v_original_reason, ''), 'Conciliado con Caja'),
           metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
             'reservation_inactive_repaired_from_caja', true,
             'reservation_inactive_repaired_at', now()
           )
     where e.id = v_event.id
       and e.status = 'manual_review'
       and e.review_reason = 'reservation_inactive';

    if found then
      perform public.bank_email_write_audit(
        v_event.hotel_id,
        null,
        'relation_changed',
        v_event.id,
        jsonb_build_object(
          'reason', 'reservation_inactive_repaired_from_caja',
          'source', 'migration'
        )
      );
      perform public.bank_email_notify_payment_event(v_event.id);
    end if;
  end loop;

  -- Las relaciones legacy que comparten una misma reserva/monto y no tienen
  -- caja_id no pueden considerarse conciliadas de forma inequivoca.
  for v_event in
    select distinct e.id, e.hotel_id
      from public.bank_payment_events e
      join public.bank_payment_allocations a
        on a.payment_event_id = e.id
       and a.hotel_id = e.hotel_id
     where e.status = 'matched'
       and a.caja_id is null
       and exists (
         select 1
           from public.bank_payment_allocations a2
           join public.bank_payment_events e2
             on e2.id = a2.payment_event_id
            and e2.hotel_id = a2.hotel_id
          where a2.payment_event_id <> a.payment_event_id
            and a2.hotel_id = a.hotel_id
            and a2.allocation_type = a.allocation_type
            and a2.reservation_id is not distinct from a.reservation_id
            and a2.sale_id is not distinct from a.sale_id
            and a2.sale_type is not distinct from a.sale_type
            and a2.amount_cop = a.amount_cop
            and a2.caja_id is null
       )
  loop
    update public.bank_payment_events e
       set status = 'manual_review',
           review_reason = 'legacy_caja_link_ambiguous',
           metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(
             'legacy_caja_link_ambiguous', true,
             'legacy_caja_link_reviewed_at', now()
           )
     where e.id = v_event.id
       and e.status = 'matched';

    if found then
      perform public.bank_email_write_audit(
        v_event.hotel_id,
        null,
        'relation_changed',
        v_event.id,
        jsonb_build_object(
          'reason', 'legacy_caja_link_ambiguous',
          'source', 'migration'
        )
      );
      perform public.bank_email_notify_payment_event(v_event.id);
    end if;
  end loop;
end
$do$;
