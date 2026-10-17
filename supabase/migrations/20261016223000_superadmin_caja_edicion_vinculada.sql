-- Correccion controlada por superadmin desde Caja, con sincronizacion de origen y arqueos.
-- Conserva privilegios ordinarios de administrador sobre turnos abiertos no vinculados.
-- Motivo y valores anteriores/posteriores quedan en auditoria_operaciones.
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
  v_es_superadmin boolean;
  v_closed boolean := false;
  v_delta numeric := 0;
  v_related_before jsonb := '{}'::jsonb;
  v_related_after jsonb := '{}'::jsonb;
  v_arqueos_before jsonb;
  v_arqueos_after jsonb;
  v_related_count integer;
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
  -- El superadmin SaaS es reconocido por auth.users/email confirmado, no
  -- necesariamente por la columna usuarios.rol (puede ser 'admin').
  v_es_superadmin := public.actor_is_saas_superadmin();
  v_es_admin := v_es_admin or v_es_superadmin;
  if not v_es_admin then
    raise exception 'CAJA_EDICION_SOLO_ADMIN: solo un administrador puede editar movimientos de caja'
      using errcode = '42501';
  end if;

  select * into v_mov from public.caja where id = p_movimiento_id for update;
  if not found then
    raise exception 'Movimiento de caja no encontrado' using errcode = 'P0002';
  end if;
  if v_mov.hotel_id is distinct from v_actor.hotel_id
     and not (v_es_superadmin and exists (
       select 1 from public.usuarios_roles ur
       where ur.usuario_id = auth.uid() and ur.hotel_id = v_mov.hotel_id
     )) then
    raise exception 'No puedes modificar movimientos de otro hotel' using errcode = '42501';
  end if;

  -- La correccion de un cierre historico es solo del superadmin.
  if v_mov.turno_id is not null then
    select * into v_turno from public.turnos where id = v_mov.turno_id for share;
    if not found then
      raise exception 'CAJA_EDICION_TURNO_INVALIDO' using errcode = '23514';
    end if;
    v_closed := v_turno.estado = 'cerrado' and v_turno.fecha_cierre is not null;
    if not (v_turno.estado = 'abierto' and v_turno.fecha_cierre is null)
       and not (v_es_superadmin and v_closed) then
      raise exception 'CAJA_EDICION_TURNO_CERRADO: solo superadmin puede corregir un turno cerrado'
        using errcode = '23514';
    end if;
  elsif not v_es_superadmin then
    raise exception 'CAJA_EDICION_SIN_TURNO: solo superadmin puede corregir movimientos fuera de turno'
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

  if p_fecha_movimiento is null or p_fecha_movimiento > now() + interval '5 minutes'
     or (p_fecha_movimiento is distinct from v_mov.fecha_movimiento
         and v_mov.turno_id is not null
         and (p_fecha_movimiento < v_turno.fecha_apertura
              or p_fecha_movimiento > coalesce(v_turno.fecha_cierre, now() + interval '5 minutes'))) then
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
    if v_vinculado and not v_es_superadmin then
      raise exception 'CAJA_EDICION_VINCULADO: la correccion del monto de reservas o ventas es exclusiva del superadministrador'
        using errcode = '23514';
    end if;
    if v_vinculado and v_tipo_nuevo <> v_mov.tipo::text then
      raise exception 'CAJA_EDICION_TIPO_VINCULADO: el tipo de una reserva o venta debe mantenerse; utiliza una reversion para reclasificar'
        using errcode = '23514';
    end if;
    if v_vinculado and exists (
      select 1 from public.bank_payment_allocations b where b.caja_id = v_mov.id
    ) then
      raise exception 'CAJA_EDICION_CONCILIADO: desvincula o revisa la conciliacion bancaria antes de corregir el monto'
        using errcode = '23514';
    end if;
    if v_vinculado and v_mov.reserva_terraza_id is not null
       and v_mov.venta_terraza_id is null
       and not exists (select 1 from public.terraza_reservas tr where tr.caja_anticipo_id = v_mov.id) then
      raise exception 'CAJA_EDICION_TERRAZA_ESPECIAL: corrige esta operacion desde Terraza'
        using errcode = '23514';
    end if;
    if v_vinculado and v_mov.compra_tienda_id is not null then
      raise exception 'CAJA_EDICION_COMPRA: un pago de inventario debe corregirse desde compras para conservar sus abonos'
        using errcode = '23514';
    end if;
  end if;

  if not v_cambia_monto_o_tipo
     and v_concepto = v_mov.concepto
     and p_metodo_pago_id is not distinct from v_mov.metodo_pago_id
     and p_fecha_movimiento is not distinct from v_mov.fecha_movimiento then
    return jsonb_build_object('id', v_mov.id, 'sin_cambios', true, 'ledger_sincronizado', true);
  end if;

  if v_closed and p_metodo_pago_id is distinct from v_mov.metodo_pago_id
     and exists (select 1 from public.turno_arqueos a where a.turno_id = v_turno.id)
     and not exists (
       select 1 from public.turno_arqueos a
       where a.turno_id = v_turno.id and a.metodo_pago_id = p_metodo_pago_id
     ) then
    raise exception 'CAJA_EDICION_ARQUEO_METODO: el metodo nuevo no fue arqueado en el cierre historico'
      using errcode = '23514';
  end if;
  v_before := to_jsonb(v_mov);
  v_delta := p_monto - v_mov.monto;
  if v_closed then
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_arqueos_before
    from public.turno_arqueos a where a.turno_id = v_turno.id;
  end if;
  select to_jsonb(m) into v_ledger_before
    from public.account_movements m
   where m.caja_id = v_mov.id
   for update;

  -- Mantener sincronizados los datos fuente. Nunca se crean pagos nuevos.
  -- Un pago compartido por varios movimientos requiere intervencion especifica.
  if v_delta <> 0 and v_mov.pago_reserva_id is not null then
    if (select count(*) from public.caja c
        where c.pago_reserva_id = v_mov.pago_reserva_id
          and c.original_movement_id is null and c.source is distinct from 'caja_reversal') <> 1 then
      raise exception 'CAJA_EDICION_PAGO_COMPARTIDO: varios movimientos usan el mismo pago; requiere conciliacion individual'
        using errcode = '23514';
    end if;
  end if;

  if v_mov.pago_reserva_id is not null
     and (v_delta <> 0 or p_metodo_pago_id is distinct from v_mov.metodo_pago_id) then
    select to_jsonb(p) into v_related_before from public.pagos_reserva p
      where p.id = v_mov.pago_reserva_id and p.hotel_id = v_mov.hotel_id for update;
    if v_related_before is null then
      raise exception 'CAJA_EDICION_PAGO_NO_ENCONTRADO' using errcode = '23514';
    end if;
    update public.pagos_reserva
      set monto = case when v_delta <> 0 then p_monto else monto end,
          metodo_pago_id = p_metodo_pago_id
      where id = v_mov.pago_reserva_id and hotel_id = v_mov.hotel_id;
    select to_jsonb(p) into v_related_after from public.pagos_reserva p
      where p.id = v_mov.pago_reserva_id;
    if v_delta <> 0 then
      -- Ajuste incremental: no borra abonos historicos que no tengan
      -- su registro en pagos_reserva (existen movimientos legacy).
      update public.reservas r
        set monto_pagado = coalesce(r.monto_pagado, 0) + v_delta
        where r.id = (v_related_after->>'reserva_id')::uuid and r.hotel_id = v_mov.hotel_id
          and coalesce(r.monto_pagado, 0) + v_delta >= 0;
      get diagnostics v_related_count = row_count;
      if v_related_count <> 1 then
        raise exception 'CAJA_EDICION_RESERVA: no se pudo ajustar el monto pagado'
          using errcode = '23514';
      end if;
    end if;
  elsif v_delta <> 0 and v_mov.reserva_id is not null
      and v_mov.venta_tienda_id is null and v_mov.venta_restaurante_id is null
      and v_mov.venta_terraza_id is null then
    update public.reservas
      set monto_pagado = coalesce(monto_pagado, 0) + v_delta
      where id = v_mov.reserva_id and hotel_id = v_mov.hotel_id
        and coalesce(monto_pagado, 0) + v_delta >= 0;
    get diagnostics v_related_count = row_count;
    if v_related_count <> 1 then
      raise exception 'CAJA_EDICION_RESERVA: no se pudo conciliar el monto pagado de la reserva'
        using errcode = '23514';
    end if;
  end if;

  if v_delta <> 0 and v_mov.venta_tienda_id is not null then
    if (select count(*) from public.caja c
        where c.venta_tienda_id = v_mov.venta_tienda_id
          and c.original_movement_id is null and c.source is distinct from 'caja_reversal') <> 1 then
      raise exception 'CAJA_EDICION_TIENDA_MULTIPLE: la venta tiene mas de un movimiento de Caja; requiere conciliacion individual'
        using errcode = '23514';
    end if;
    update public.ventas_tienda
       set total_venta = coalesce(total_venta, 0) + v_delta
     where id = v_mov.venta_tienda_id and hotel_id = v_mov.hotel_id
       and coalesce(total_venta, 0) + v_delta >= 0;
    get diagnostics v_related_count = row_count;
    if v_related_count <> 1 then
      raise exception 'CAJA_EDICION_TIENDA: la venta quedaria negativa o no existe'
        using errcode = '23514';
    end if;
  end if;

  if v_delta <> 0 and v_mov.venta_restaurante_id is not null then
    if (select count(*) from public.caja c
        where c.venta_restaurante_id = v_mov.venta_restaurante_id
          and c.original_movement_id is null and c.source is distinct from 'caja_reversal') <> 1 then
      raise exception 'CAJA_EDICION_RESTAURANTE_MULTIPLE: la venta tiene varios cobros; requiere conciliacion individual'
        using errcode = '23514';
    end if;
    update public.ventas_restaurante
       set total_venta = case when total_venta is null then null else total_venta + v_delta end,
           monto_total = case when monto_total is null then null else monto_total + v_delta end
     where id = v_mov.venta_restaurante_id and hotel_id = v_mov.hotel_id
       and coalesce(total_venta, monto_total, 0) + v_delta >= 0;
    get diagnostics v_related_count = row_count;
    if v_related_count <> 1 then
      raise exception 'CAJA_EDICION_RESTAURANTE: la venta quedaria negativa o no existe'
        using errcode = '23514';
    end if;
  end if;

  if v_delta <> 0 and v_mov.venta_terraza_id is not null then
    if (select count(*) from public.caja c
        where c.venta_terraza_id = v_mov.venta_terraza_id
          and c.original_movement_id is null and c.source is distinct from 'caja_reversal') <> 1 then
      raise exception 'CAJA_EDICION_TERRAZA_MIXTA: venta dividida entre pagos; corrigela en Terraza'
        using errcode = '23514';
    end if;
    update public.terraza_pedidos
      set total = coalesce(total, 0) + v_delta
      where id = v_mov.venta_terraza_id and hotel_id = v_mov.hotel_id
        and coalesce(total, 0) + v_delta >= 0;
    get diagnostics v_related_count = row_count;
    if v_related_count <> 1 then
      raise exception 'CAJA_EDICION_TERRAZA: no se pudo actualizar el pedido'
        using errcode = '23514';
    end if;
  end if;

  if exists (select 1 from public.expense_payments e where e.caja_id = v_mov.id) then
    update public.expense_payments set amount = p_monto, metodo_pago_id = p_metodo_pago_id
    where caja_id = v_mov.id and hotel_id = v_mov.hotel_id;
  end if;

  if v_delta <> 0 and exists (
    select 1 from public.terraza_reservas tr where tr.caja_anticipo_id = v_mov.id
  ) then
    update public.terraza_reservas tr
       set anticipo_consumible = p_monto
     where tr.caja_anticipo_id = v_mov.id and tr.hotel_id = v_mov.hotel_id
       and coalesce(tr.saldo_consumido, 0) <= p_monto;
    get diagnostics v_related_count = row_count;
    if v_related_count <> 1 then
      raise exception 'CAJA_EDICION_ANTICIPO: el anticipo corregido es menor que el consumo'
        using errcode = '23514';
    end if;
  end if;

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

  if v_closed then
    -- Se conservan los valores que conto el cajero y el balance final firmado;
    -- solo se recalcula el esperado/diferencia del arqueo historico.
    update public.turno_arqueos a
       set expected_amount = greatest(coalesce((
         select sum(case when c.tipo in ('ingreso','apertura') then c.monto
                         when c.tipo = 'egreso' then -c.monto else 0 end)
         from public.caja c
         where c.turno_id = v_turno.id and c.metodo_pago_id = a.metodo_pago_id
       ), 0), 0)
     where a.turno_id = v_turno.id;
    select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_arqueos_after
      from public.turno_arqueos a where a.turno_id = v_turno.id;
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
    v_before || jsonb_build_object('ledger', v_ledger_before, 'related', v_related_before, 'arqueos', v_arqueos_before),
    v_after || jsonb_build_object('ledger', v_ledger_after, 'related', v_related_after,
      'arqueos', v_arqueos_after, 'delta_monto', v_delta, 'turno_cerrado', v_closed, 'changed_at', now()),
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
