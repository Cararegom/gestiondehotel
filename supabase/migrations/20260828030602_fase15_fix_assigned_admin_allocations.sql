-- Fase 15: unifica la autorización de allocations con el concepto de administrador efectivo.
create or replace function app_private.replace_bank_payment_allocations(
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
  v_hotel_id uuid;
  v_event_snapshot public.bank_payment_events%rowtype;
  v_event public.bank_payment_events%rowtype;
  v_item jsonb;
  v_normalized jsonb := '[]'::jsonb;
  v_previous jsonb := '[]'::jsonb;
  v_type text;
  v_sale_type text;
  v_reservation_id uuid;
  v_room_id uuid;
  v_sale_id uuid;
  v_amount bigint;
  v_available bigint;
  v_total bigint := 0;
  v_count integer;
  v_legacy_reservation uuid;
  v_legacy_room uuid;
  v_legacy_sale uuid;
  v_legacy_sale_type text;
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_reason text := nullif(btrim(coalesce(p_review_reason, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;
  if lower(btrim(coalesce(p_pilot_hotel_name, ''))) <> 'hotel marena san isidro' then
    raise exception 'Hotel piloto no valido.' using errcode = '42501';
  end if;
  if v_action not in ('link', 'confirm') or jsonb_typeof(p_allocations) is distinct from 'array' then
    raise exception 'La distribucion enviada no es valida.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_allocations);
  if v_count < 1 or v_count > 50 then
    raise exception 'La distribucion debe contener entre 1 y 50 destinos.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'Toda accion manual de conciliacion requiere un motivo.' using errcode = '22023';
  end if;
  if length(v_reason) > 500 then
    raise exception 'El motivo no puede superar 500 caracteres.' using errcode = '22023';
  end if;

  v_hotel_id := public.resolve_bank_email_pilot_hotel('Hotel Marena San Isidro');
  if not app_private.bank_email_actor_is_pilot_admin(p_actor_id, v_hotel_id) then
    raise exception 'Solo un administrador efectivo puede conciliar pagos.' using errcode = '42501';
  end if;

  select * into v_event_snapshot from public.bank_payment_events
   where id = p_payment_event_id and hotel_id = v_hotel_id;
  if not found or v_event_snapshot.status in ('duplicated', 'rejected') then
    raise exception 'El pago bancario no admite esta distribucion.' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item ->> 'amountCop', '') !~ '^[0-9]+$' then
      raise exception 'Cada destino debe incluir un valor entero en COP.' using errcode = '22023';
    end if;
    v_type := lower(btrim(coalesce(v_item ->> 'type', '')));
    v_amount := (v_item ->> 'amountCop')::bigint;
    if v_amount <= 0 then
      raise exception 'Cada valor distribuido debe ser mayor que cero.' using errcode = '22023';
    end if;
    v_total := v_total + v_amount;

    if v_type = 'reservation' then
      begin v_reservation_id := (v_item ->> 'reservationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La reserva seleccionada no es valida.' using errcode = '22023';
      end;
      select r.habitacion_id into v_room_id from public.reservas r
       where r.id = v_reservation_id and r.hotel_id = v_hotel_id;
      if not found then
        raise exception 'La reserva seleccionada no pertenece al hotel.' using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_normalized) n
        where n ->> 'allocation_type' = 'reservation' and n ->> 'reservation_id' = v_reservation_id::text) then
        raise exception 'La reserva esta repetida en la distribucion.' using errcode = '22023';
      end if;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type','reservation','reservation_id',v_reservation_id,'room_id',v_room_id,'amount_cop',v_amount));
    elsif v_type = 'sale' then
      begin v_sale_id := (v_item ->> 'saleId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La venta seleccionada no es valida.' using errcode = '22023';
      end;
      v_sale_type := lower(btrim(coalesce(v_item ->> 'saleType', '')));
      if v_sale_type not in ('tienda','restaurante','terraza','venta')
         or not public.bank_email_sale_is_reconcilable(v_sale_type,v_sale_id,v_hotel_id) then
        raise exception 'La venta no existe, no pertenece al piloto o no usa un metodo bancario conciliable.' using errcode = '22023';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(v_hotel_id::text || ':bank-sale:' || v_sale_type || ':' || v_sale_id::text,0));
      v_available := public.bank_email_sale_available_amount_cop(v_sale_type,v_sale_id,v_hotel_id,p_payment_event_id);
      if v_available is null or v_amount > v_available then
        raise exception 'La venta ya fue conciliada o el valor supera su saldo conciliable (%).',coalesce(v_available,0) using errcode = '22023';
      end if;
      if exists (select 1 from jsonb_array_elements(v_normalized) n
        where n ->> 'allocation_type'='sale' and n ->> 'sale_type'=v_sale_type and n ->> 'sale_id'=v_sale_id::text) then
        raise exception 'Una venta esta repetida en la distribucion.' using errcode = '22023';
      end if;
      v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
        'allocation_type','sale','sale_id',v_sale_id,'sale_type',v_sale_type,'amount_cop',v_amount));
    else
      raise exception 'Tipo de distribucion no reconocido.' using errcode = '22023';
    end if;
  end loop;

  if v_total is distinct from v_event_snapshot.amount_cop then
    raise exception 'La suma distribuida debe ser exactamente igual a la transferencia (%).',v_event_snapshot.amount_cop using errcode = '22023';
  end if;

  select * into v_event from public.bank_payment_events
   where id=p_payment_event_id and hotel_id=v_hotel_id for update;
  if not found or v_event.status in ('duplicated','rejected')
     or v_event.amount_cop is distinct from v_event_snapshot.amount_cop
     or v_event.updated_at is distinct from v_event_snapshot.updated_at then
    raise exception 'El pago bancario cambio mientras se validaba. Vuelve a abrirlo.' using errcode='40001';
  end if;

  select coalesce(jsonb_agg(to_jsonb(a)-'hotel_id'-'created_by' order by a.created_at,a.id),'[]'::jsonb)
    into v_previous from public.bank_payment_allocations a where a.payment_event_id=v_event.id;
  delete from public.bank_payment_allocations where payment_event_id=v_event.id;
  insert into public.bank_payment_allocations(hotel_id,payment_event_id,allocation_type,reservation_id,room_id,sale_id,sale_type,amount_cop,created_by)
  select v_hotel_id,v_event.id,n->>'allocation_type',
    case when n->>'allocation_type'='reservation' then (n->>'reservation_id')::uuid end,
    case when n->>'allocation_type'='reservation' then (n->>'room_id')::uuid end,
    case when n->>'allocation_type'='sale' then (n->>'sale_id')::uuid end,
    case when n->>'allocation_type'='sale' then n->>'sale_type' end,
    (n->>'amount_cop')::bigint,p_actor_id
  from jsonb_array_elements(v_normalized) n;

  if v_count=1 then
    v_item:=v_normalized->0;
    if v_item->>'allocation_type'='reservation' then
      v_legacy_reservation:=(v_item->>'reservation_id')::uuid;
      v_legacy_room:=(v_item->>'room_id')::uuid;
    else
      v_legacy_sale:=(v_item->>'sale_id')::uuid;
      v_legacy_sale_type:=v_item->>'sale_type';
    end if;
  end if;

  update public.bank_payment_events set
    status=case when v_action='confirm' then 'confirmed' else 'matched' end,
    matched_reservation_id=v_legacy_reservation, matched_room_id=v_legacy_room,
    matched_sale_id=v_legacy_sale, matched_sale_type=v_legacy_sale_type,
    matched_expected_payment_id=null, review_reason=v_reason,
    reviewed_by=p_actor_id, reviewed_at=clock_timestamp(),
    confirmed_by=case when v_action='confirm' then p_actor_id else null end,
    confirmed_at=case when v_action='confirm' then clock_timestamp() else null end,
    metadata=(coalesce(metadata,'{}'::jsonb)-'relation_deleted'-'relation_invalidated') || jsonb_build_object(
      'allocation_count',v_count,'allocated_amount_cop',v_total,'allocation_source','bank_payment_allocations'),
    updated_at=clock_timestamp()
  where id=v_event.id returning * into v_event;

  perform public.bank_email_write_audit(v_hotel_id,p_actor_id,'multiple_allocation_changed',v_event.id,jsonb_build_object(
    'action',v_action,'reason',v_reason,'previous_allocations',v_previous,'new_allocations',v_normalized,
    'allocation_count',v_count,'amount_cop',v_total));

  return jsonb_build_object('payment_event',to_jsonb(v_event),'allocations',(
    select coalesce(jsonb_agg(to_jsonb(a)-'hotel_id'-'created_by' order by a.created_at,a.id),'[]'::jsonb)
    from public.bank_payment_allocations a where a.payment_event_id=v_event.id));
end;
$function$;

revoke all on function app_private.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  from public, anon, authenticated;
grant execute on function app_private.replace_bank_payment_allocations(uuid,uuid,jsonb,text,text,text)
  to service_role;
