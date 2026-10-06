-- Caja: edicion administrativa completa de un movimiento en un turno abierto.
--
-- Hasta ahora solo existia actualizar_metodo_pago_caja (cualquier rol de caja,
-- solo metodo). Esta RPC permite a admin/administrador/superadmin corregir tipo,
-- monto, concepto, metodo y fecha de un movimiento, con motivo obligatorio,
-- sincronizando el asiento del ledger shadow y dejando auditoria completa.
--
-- Limites deliberados:
--   * Solo turnos abiertos (un turno cerrado ya tiene arqueo).
--   * No se editan reversiones ni movimientos ya revertidos.
--   * La apertura conserva tipo 'apertura'; ingreso/egreso solo cambian entre si.
--   * Monto y tipo no se cambian si el movimiento esta ligado a otra entidad
--     (reserva, venta, compra, anticipo, gasto pagado, conciliacion bancaria):
--     editarlo aqui descuadraria ese modulo.

begin;

create or replace function public.editar_movimiento_caja_admin(
  p_movimiento_id uuid,
  p_tipo text,
  p_monto numeric,
  p_concepto text,
  p_metodo_pago_id uuid,
  p_fecha_movimiento timestamptz,
  p_motivo text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor public.usuarios%rowtype;
  v_mov public.caja%rowtype;
  v_turno public.turnos%rowtype;
  v_rol_nombre text;
  v_es_admin boolean;
  v_tipo_nuevo text := lower(btrim(coalesce(p_tipo, '')));
  v_concepto text;
  v_motivo text;
  v_vinculado boolean;
  v_cambia_monto_o_tipo boolean;
  v_account_id uuid;
  v_before jsonb;
  v_after jsonb;
  v_ledger_before jsonb;
  v_ledger_after jsonb;
  v_ledger_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  select * into v_actor
    from public.usuarios
   where id = auth.uid() and activo is true
   limit 1;
  if not found then
    raise exception 'Usuario no autorizado' using errcode = '42501';
  end if;

  select r.nombre into v_rol_nombre
    from public.usuarios_roles ur
    join public.roles r on r.id = ur.rol_id
   where ur.usuario_id = auth.uid()
     and ur.hotel_id = v_actor.hotel_id
   order by ur.creado_en desc
   limit 1;
  v_es_admin := lower(coalesce(v_rol_nombre, '')) in ('admin', 'administrador', 'superadmin')
             or lower(coalesce(v_actor.rol::text, '')) in ('admin', 'administrador', 'superadmin');
  if not v_es_admin then
    raise exception 'CAJA_EDICION_SOLO_ADMIN: solo un administrador puede editar movimientos de caja'
      using errcode = '42501';
  end if;

  select * into v_mov from public.caja where id = p_movimiento_id for update;
  if not found then
    raise exception 'Movimiento de caja no encontrado' using errcode = 'P0002';
  end if;
  if v_mov.hotel_id is distinct from v_actor.hotel_id then
    raise exception 'No puedes modificar movimientos de otro hotel' using errcode = '42501';
  end if;

  -- FOR SHARE bloquea un cierre concurrente (cerrar_turno_con_arqueo usa FOR UPDATE).
  select * into v_turno from public.turnos where id = v_mov.turno_id for share;
  if not found or v_turno.estado <> 'abierto' or v_turno.fecha_cierre is not null then
    raise exception 'CAJA_EDICION_TURNO_CERRADO: solo se pueden editar movimientos de turnos abiertos'
      using errcode = '23514';
  end if;

  if v_mov.original_movement_id is not null
     or v_mov.source = 'caja_reversal'
     or exists (select 1 from public.caja_reversiones cr where cr.original_movement_id = v_mov.id) then
    raise exception 'CAJA_EDICION_REVERSION: no se editan reversiones ni movimientos revertidos'
      using errcode = '23514';
  end if;

  if v_mov.tipo::text = 'apertura' then
    if v_tipo_nuevo <> 'apertura' then
      raise exception 'CAJA_EDICION_TIPO_INVALIDO: la apertura no puede cambiar de tipo' using errcode = '22023';
    end if;
  elsif v_mov.tipo::text in ('ingreso', 'egreso') then
    if v_tipo_nuevo not in ('ingreso', 'egreso') then
      raise exception 'CAJA_EDICION_TIPO_INVALIDO: el tipo debe ser ingreso o egreso' using errcode = '22023';
    end if;
  else
    raise exception 'CAJA_EDICION_TIPO_INVALIDO: este tipo de movimiento no es editable' using errcode = '22023';
  end if;

  if p_monto is null or p_monto <= 0 or p_monto::text in ('NaN', 'Infinity') then
    raise exception 'CAJA_EDICION_MONTO_INVALIDO: el monto debe ser mayor que cero' using errcode = '22023';
  end if;

  v_concepto := regexp_replace(btrim(coalesce(p_concepto, '')), '[[:cntrl:]]+', ' ', 'g');
  if v_concepto = '' or char_length(v_concepto) > 500 then
    raise exception 'CAJA_EDICION_CONCEPTO_INVALIDO: el concepto es obligatorio (maximo 500 caracteres)' using errcode = '22023';
  end if;

  v_motivo := regexp_replace(btrim(coalesce(p_motivo, '')), '[[:cntrl:]]+', ' ', 'g');
  v_motivo := regexp_replace(v_motivo, '[[:space:]]+', ' ', 'g');
  if v_motivo = '' or char_length(v_motivo) > 500 then
    raise exception 'CAJA_EDICION_MOTIVO_REQUERIDO: indica el motivo de la correccion (maximo 500 caracteres)' using errcode = '22023';
  end if;

  if p_metodo_pago_id is null or not exists (
    select 1 from public.metodos_pago m
     where m.id = p_metodo_pago_id
       and m.hotel_id = v_mov.hotel_id
       and (m.activo is true or m.id is not distinct from v_mov.metodo_pago_id)
  ) then
    raise exception 'CAJA_EDICION_METODO_INVALIDO: metodo de pago invalido o inactivo para este hotel' using errcode = '22023';
  end if;

  if p_fecha_movimiento is null
     or (p_fecha_movimiento is distinct from v_mov.fecha_movimiento
         and (p_fecha_movimiento < v_turno.fecha_apertura
              or p_fecha_movimiento > now() + interval '5 minutes')) then
    raise exception 'CAJA_EDICION_FECHA_INVALIDA: la fecha debe estar entre la apertura del turno y ahora' using errcode = '22023';
  end if;

  v_cambia_monto_o_tipo := p_monto <> v_mov.monto or v_tipo_nuevo <> v_mov.tipo::text;
  if v_cambia_monto_o_tipo then
    v_vinculado := v_mov.reserva_id is not null
      or v_mov.pago_reserva_id is not null
      or v_mov.venta_tienda_id is not null
      or v_mov.venta_restaurante_id is not null
      or v_mov.venta_terraza_id is not null
      or v_mov.reserva_terraza_id is not null
      or v_mov.compra_tienda_id is not null
      or exists (select 1 from public.terraza_reservas tr where tr.caja_anticipo_id = v_mov.id)
      or exists (select 1 from public.expense_payments ep where ep.caja_id = v_mov.id)
      or exists (select 1 from public.bank_payment_allocations bpa where bpa.caja_id = v_mov.id);
    if v_vinculado then
      raise exception 'CAJA_EDICION_VINCULADO: este movimiento esta ligado a una reserva, venta, gasto o conciliacion; corrige el monto desde ese modulo o revierte el movimiento'
        using errcode = '23514';
    end if;
  end if;

  if not v_cambia_monto_o_tipo
     and v_concepto = v_mov.concepto
     and p_metodo_pago_id is not distinct from v_mov.metodo_pago_id
     and p_fecha_movimiento is not distinct from v_mov.fecha_movimiento then
    return jsonb_build_object('id', v_mov.id, 'sin_cambios', true, 'ledger_sincronizado', true);
  end if;

  v_before := to_jsonb(v_mov);
  select to_jsonb(m) into v_ledger_before
    from public.account_movements m
   where m.caja_id = v_mov.id
   for update;

  update public.caja
     set tipo = v_tipo_nuevo::public.tipo_movimiento_caja_enum,
         monto = p_monto,
         concepto = v_concepto,
         metodo_pago_id = p_metodo_pago_id,
         fecha_movimiento = p_fecha_movimiento,
         business_date = public.hotel_business_date(v_mov.hotel_id, p_fecha_movimiento),
         actualizado_en = now()
   where id = v_mov.id
  returning * into v_mov;

  if v_ledger_before is not null then
    v_account_id := public.fase2_ensure_method_account(p_metodo_pago_id, v_mov.hotel_id, auth.uid());
    update public.account_movements
       set account_id = v_account_id,
           metodo_pago_id = p_metodo_pago_id,
           direction = case when v_tipo_nuevo = 'ingreso' then 'in' else 'out' end,
           amount = p_monto,
           description = v_concepto,
           occurred_at = p_fecha_movimiento,
           business_date = v_mov.business_date
     where caja_id = v_mov.id
       and hotel_id = v_mov.hotel_id;
    get diagnostics v_ledger_count = row_count;
    if v_ledger_count <> 1 then
      raise exception 'No se pudo sincronizar el asiento financiero de Caja' using errcode = 'P0001';
    end if;
    select to_jsonb(m) into v_ledger_after from public.account_movements m where m.caja_id = v_mov.id;
  end if;

  v_after := to_jsonb(v_mov);

  insert into public.auditoria_operaciones(
    hotel_id, actor_id, accion, entidad, entity_id, before_data, after_data, reason
  ) values (
    v_mov.hotel_id,
    auth.uid(),
    'caja.editar_movimiento_admin',
    'caja',
    v_mov.id,
    v_before || jsonb_build_object('ledger', v_ledger_before),
    v_after || jsonb_build_object('ledger', v_ledger_after, 'changed_at', now()),
    v_motivo
  );

  return jsonb_build_object(
    'id', v_mov.id,
    'sin_cambios', false,
    'ledger_sincronizado', v_ledger_before is null or v_ledger_count = 1,
    'movimiento', v_after
  );
end
$$;

revoke all on function public.editar_movimiento_caja_admin(uuid, text, numeric, text, uuid, timestamptz, text) from public;
revoke all on function public.editar_movimiento_caja_admin(uuid, text, numeric, text, uuid, timestamptz, text) from anon;
grant execute on function public.editar_movimiento_caja_admin(uuid, text, numeric, text, uuid, timestamptz, text) to authenticated, service_role;

commit;
