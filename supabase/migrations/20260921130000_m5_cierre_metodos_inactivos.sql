-- M5: el cierre debe incluir los metodos activos y todo metodo usado en el turno,
-- aunque haya sido desactivado despues de registrar un movimiento.

create or replace function public.cerrar_turno_con_arqueo(
  p_turno_id uuid,
  p_arqueos jsonb,
  p_client_operation_id uuid,
  p_fecha_cierre timestamptz default now(),
  p_approved_by uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_t public.turnos%rowtype;
  v_a jsonb;
  v_method uuid;
  v_required_method uuid;
  v_counted numeric;
  v_expected numeric;
  v_total numeric := 0;
  v_existing integer;
  v_payload_methods uuid[] := array[]::uuid[];
begin
  if auth.uid() is null
     or p_client_operation_id is null
     or p_arqueos is null
     or jsonb_typeof(p_arqueos) <> 'array'
     or jsonb_array_length(p_arqueos) = 0 then
    raise exception 'M5_ARQUEO_PAYLOAD_INVALIDO: payload de arqueo invalido'
      using errcode = '22023';
  end if;

  select *
    into v_t
    from public.turnos
   where id = p_turno_id
   for update;

  if not found or not public.fase1_actor_es_miembro_activo(v_t.hotel_id) then
    raise exception 'Turno fuera del hotel autorizado' using errcode = '42501';
  end if;

  if v_t.usuario_id <> auth.uid()
     and not public.fase1_actor_tiene_permiso(v_t.hotel_id, 'finanzas.cerrar_turno') then
    raise exception 'Sin permiso para cerrar turno ajeno' using errcode = '42501';
  end if;

  select count(*)
    into v_existing
    from public.turno_arqueos
   where turno_id = v_t.id
     and client_operation_id = p_client_operation_id;

  if v_t.estado = 'cerrado' and v_existing > 0 then
    return jsonb_build_object('turno_id', v_t.id, 'idempotent', true);
  end if;

  if v_t.estado <> 'abierto' or v_t.fecha_cierre is not null then
    raise exception 'Turno no esta abierto' using errcode = '23514';
  end if;

  if p_approved_by is not null and not exists (
    select 1
      from public.usuarios u
     where u.id = p_approved_by
       and u.hotel_id = v_t.hotel_id
       and u.activo
  ) then
    raise exception 'Aprobador invalido' using errcode = '42501';
  end if;

  if exists (
    select 1
      from public.caja c
     where c.turno_id = v_t.id
       and c.tipo in ('ingreso', 'egreso', 'apertura')
       and c.metodo_pago_id is null
  ) then
    raise exception 'M5_MOVIMIENTO_SIN_METODO: existe un movimiento financiero sin metodo de pago'
      using errcode = '23514';
  end if;

  for v_a in select value from jsonb_array_elements(p_arqueos)
  loop
    begin
      v_method := nullif(v_a ->> 'metodo_pago_id', '')::uuid;
      v_counted := nullif(v_a ->> 'counted_amount', '')::numeric;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'M5_ARQUEO_PAYLOAD_INVALIDO: metodo o conteo invalido'
          using errcode = '22023';
    end;

    if v_method is null
       or v_counted is null
       or v_counted < 0
       or v_counted::text in ('NaN', 'Infinity', '-Infinity') then
      raise exception 'M5_ARQUEO_PAYLOAD_INVALIDO: metodo o conteo invalido'
        using errcode = '22023';
    end if;

    if v_method = any(v_payload_methods) then
      raise exception 'M5_METODO_DUPLICADO: el metodo aparece mas de una vez en el arqueo'
        using errcode = '22023';
    end if;

    if not exists (
      select 1
        from public.metodos_pago m
       where m.id = v_method
         and m.hotel_id = v_t.hotel_id
         and (
           m.activo is true
           or exists (
             select 1
               from public.caja c
              where c.turno_id = v_t.id
                and c.metodo_pago_id = m.id
                and c.tipo in ('ingreso', 'egreso', 'apertura')
           )
         )
    ) then
      raise exception 'M5_METODO_INVALIDO: metodo ajeno, inactivo sin movimientos o inexistente'
        using errcode = '22023';
    end if;

    v_payload_methods := array_append(v_payload_methods, v_method);
  end loop;

  for v_required_method in
    select required.id
      from (
        select m.id
          from public.metodos_pago m
         where m.hotel_id = v_t.hotel_id
           and m.activo is true
        union
        select c.metodo_pago_id
          from public.caja c
         where c.turno_id = v_t.id
           and c.tipo in ('ingreso', 'egreso', 'apertura')
           and c.metodo_pago_id is not null
      ) required
  loop
    if not (v_required_method = any(v_payload_methods)) then
      raise exception 'M5_ARQUEO_INCOMPLETO: falta un metodo activo o usado en el turno'
        using errcode = '23514';
    end if;
  end loop;

  for v_a in select value from jsonb_array_elements(p_arqueos)
  loop
    v_method := (v_a ->> 'metodo_pago_id')::uuid;
    v_counted := (v_a ->> 'counted_amount')::numeric;

    select greatest(coalesce(sum(
      case
        when c.tipo in ('ingreso', 'apertura') then c.monto
        when c.tipo = 'egreso' then -c.monto
        else 0
      end
    ), 0), 0)
      into v_expected
      from public.caja c
     where c.turno_id = v_t.id
       and c.metodo_pago_id is not distinct from v_method;

    insert into public.turno_arqueos(
      turno_id,
      hotel_id,
      metodo_pago_id,
      expected_amount,
      counted_amount,
      note,
      counted_by,
      counted_at,
      approved_by,
      client_operation_id
    ) values (
      v_t.id,
      v_t.hotel_id,
      v_method,
      v_expected,
      v_counted,
      nullif(btrim(v_a ->> 'note'), ''),
      auth.uid(),
      coalesce(p_fecha_cierre, now()),
      p_approved_by,
      p_client_operation_id
    );

    v_total := v_total + v_counted;
  end loop;

  update public.turnos
     set estado = 'cerrado',
         fecha_cierre = coalesce(p_fecha_cierre, now()),
         balance_final = v_total
   where id = v_t.id;

  insert into public.auditoria_operaciones(
    hotel_id,
    actor_id,
    accion,
    entidad,
    entity_id,
    before_data,
    after_data,
    reason,
    client_operation_id
  ) values (
    v_t.hotel_id,
    auth.uid(),
    'turno.cerrar',
    'turnos',
    v_t.id,
    to_jsonb(v_t),
    jsonb_build_object(
      'balance_final', v_total,
      'business_date', public.fase1_business_date(coalesce(p_fecha_cierre, now())),
      'metodos_arqueados', cardinality(v_payload_methods)
    ),
    'Cierre con arqueo completo de metodos activos y usados',
    p_client_operation_id
  );

  return jsonb_build_object(
    'turno_id', v_t.id,
    'balance_final', v_total,
    'business_date', public.fase1_business_date(coalesce(p_fecha_cierre, now())),
    'metodos_arqueados', cardinality(v_payload_methods),
    'idempotent', false
  );
end
$$;

revoke all on function public.cerrar_turno_con_arqueo(uuid, jsonb, uuid, timestamptz, uuid) from public;
revoke all on function public.cerrar_turno_con_arqueo(uuid, jsonb, uuid, timestamptz, uuid) from anon;
grant execute on function public.cerrar_turno_con_arqueo(uuid, jsonb, uuid, timestamptz, uuid) to authenticated, service_role;
