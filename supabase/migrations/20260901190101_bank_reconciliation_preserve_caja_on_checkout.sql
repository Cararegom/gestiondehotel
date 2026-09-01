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
       and exists (
         select 1
           from public.bank_payment_allocations a
          where a.hotel_id = v_pilot_hotel_id
            and a.payment_event_id = e.id
            and a.caja_id is not null
       )
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
         metadata = e.metadata || jsonb_build_object(
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
           metadata = e.metadata || jsonb_build_object(
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
