-- Persist the exact Caja movement used by reception during bank reconciliation.
-- This prevents the same Caja row from being reused by two bank transfers.

alter table public.bank_payment_allocations
  add column if not exists caja_id uuid;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bank_payment_allocations_caja_id_fkey'
      AND conrelid = 'public.bank_payment_allocations'::regclass
  ) THEN
    ALTER TABLE public.bank_payment_allocations
      ADD CONSTRAINT bank_payment_allocations_caja_id_fkey
      FOREIGN KEY (caja_id) REFERENCES public.caja(id) ON DELETE RESTRICT;
  END IF;
END
$do$;

create unique index if not exists bank_payment_allocations_caja_id_unique
  on public.bank_payment_allocations (caja_id)
  where caja_id is not null;

create index if not exists bank_payment_allocations_event_caja_idx
  on public.bank_payment_allocations (payment_event_id, caja_id)
  where caja_id is not null;

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
set search_path to 'pg_catalog', 'public', 'app_private'
as $function$
declare
  v_hotel_id uuid;
  v_item jsonb;
  v_caja_id uuid;
  v_caja public.caja%rowtype;
  v_type text;
  v_sale_type text;
  v_target_id uuid;
  v_amount bigint;
  v_updated integer;
  v_result jsonb;
  v_links jsonb := '[]'::jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Esta funcion solo puede ejecutarse desde el servidor.' using errcode = '42501';
  end if;
  if p_actor_id is null then
    raise exception 'Falta el usuario verificado.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_allocations) is distinct from 'array' or jsonb_array_length(p_allocations) < 1 then
    raise exception 'La distribucion enviada no es valida.' using errcode = '22023';
  end if;

  v_hotel_id := public.resolve_bank_email_pilot_hotel(p_pilot_hotel_name);

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    begin
      v_caja_id := (v_item ->> 'cajaId')::uuid;
    exception when invalid_text_representation then
      raise exception 'El movimiento de Caja no es valido.' using errcode = '22023';
    end;
    if v_caja_id is null then
      raise exception 'Cada distribucion de recepcion debe conservar su movimiento de Caja.' using errcode = '22023';
    end if;

    if coalesce(v_item ->> 'amountCop', '') !~ '^[0-9]+$' then
      raise exception 'Cada distribucion debe incluir un valor entero en COP.' using errcode = '22023';
    end if;
    v_amount := (v_item ->> 'amountCop')::bigint;
    if v_amount <= 0 then
      raise exception 'Cada valor distribuido debe ser mayor que cero.' using errcode = '22023';
    end if;

    select c.* into v_caja
      from public.caja c
     where c.id = v_caja_id
       and c.hotel_id = v_hotel_id
     for share;
    if not found then
      raise exception 'El movimiento de Caja no pertenece al hotel piloto.' using errcode = '22023';
    end if;
    if v_caja.tipo is distinct from 'ingreso' or v_caja.source = 'caja_reversal' or v_caja.original_movement_id is not null then
      raise exception 'El movimiento de Caja no es un ingreso conciliable.' using errcode = '22023';
    end if;
    if v_caja.monto::numeric is distinct from v_amount::numeric then
      raise exception 'El valor del movimiento de Caja no coincide con la distribucion.' using errcode = '22023';
    end if;
    if not exists (
      select 1
        from public.metodos_pago m
        join public.financial_accounts fa
          on fa.id = m.financial_account_id
         and fa.hotel_id = v_hotel_id
       where m.id = v_caja.metodo_pago_id
         and m.hotel_id = v_hotel_id
         and m.activo is true
         and fa.active is true
         and fa.account_type = 'bank'
    ) then
      raise exception 'El movimiento de Caja no usa una cuenta bancaria conciliable.' using errcode = '22023';
    end if;

    if exists (
      select 1
        from public.bank_payment_allocations a
       where a.caja_id = v_caja_id
         and a.payment_event_id <> p_payment_event_id
    ) then
      raise exception 'El movimiento de Caja ya esta conciliado con otra transferencia.' using errcode = '23505';
    end if;

    v_type := lower(btrim(coalesce(v_item ->> 'type', '')));
    if v_type = 'reservation' then
      begin
        v_target_id := (v_item ->> 'reservationId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La reserva seleccionada no es valida.' using errcode = '22023';
      end;
      if v_caja.reserva_id is distinct from v_target_id then
        raise exception 'La reserva de Caja no coincide con la distribucion.' using errcode = '22023';
      end if;
      v_sale_type := null;
    elsif v_type = 'sale' then
      begin
        v_target_id := (v_item ->> 'saleId')::uuid;
      exception when invalid_text_representation then
        raise exception 'La venta seleccionada no es valida.' using errcode = '22023';
      end;
      v_sale_type := lower(btrim(coalesce(v_item ->> 'saleType', '')));
      if (v_sale_type = 'tienda' and v_caja.venta_tienda_id is distinct from v_target_id)
         or (v_sale_type = 'restaurante' and v_caja.venta_restaurante_id is distinct from v_target_id)
         or (v_sale_type = 'terraza' and v_caja.venta_terraza_id is distinct from v_target_id)
         or v_sale_type not in ('tienda', 'restaurante', 'terraza') then
        raise exception 'La venta de Caja no coincide con la distribucion.' using errcode = '22023';
      end if;
    else
      raise exception 'Tipo de distribucion no reconocido.' using errcode = '22023';
    end if;

    v_links := v_links || jsonb_build_array(jsonb_build_object(
      'caja_id', v_caja_id,
      'type', v_type,
      'target_id', v_target_id,
      'sale_type', v_sale_type,
      'amount_cop', v_amount
    ));
  end loop;

  v_result := public.replace_bank_payment_allocations(
    p_payment_event_id,
    p_actor_id,
    p_allocations,
    p_action,
    p_review_reason,
    p_pilot_hotel_name
  );

  for v_item in select value from jsonb_array_elements(v_links)
  loop
    v_caja_id := (v_item ->> 'caja_id')::uuid;
    v_type := v_item ->> 'type';
    v_target_id := (v_item ->> 'target_id')::uuid;
    v_sale_type := nullif(v_item ->> 'sale_type', '');

    if v_type = 'reservation' then
      update public.bank_payment_allocations
         set caja_id = v_caja_id
       where payment_event_id = p_payment_event_id
         and allocation_type = 'reservation'
         and reservation_id = v_target_id;
    else
      update public.bank_payment_allocations
         set caja_id = v_caja_id
       where payment_event_id = p_payment_event_id
         and allocation_type = 'sale'
         and sale_id = v_target_id
         and sale_type = v_sale_type;
    end if;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception 'No se pudo conservar el vinculo exacto con Caja.' using errcode = 'P0001';
    end if;
  end loop;

  perform public.bank_email_write_audit(
    v_hotel_id,
    p_actor_id,
    'cash_movement_linked',
    p_payment_event_id,
    jsonb_build_object('links', v_links, 'link_count', jsonb_array_length(v_links))
  );

  return v_result || jsonb_build_object(
    'cash_links', v_links,
    'cash_link_count', jsonb_array_length(v_links)
  );
end;
$function$;

revoke all on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text) from public;
revoke all on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text) from anon;
revoke all on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text) from authenticated;
grant execute on function public.replace_bank_payment_allocations_from_caja(uuid, uuid, jsonb, text, text, text) to service_role;
