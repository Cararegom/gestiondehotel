-- M5 / apertura (complemento de 20261005220000): deja cerrables todos los turnos
-- abiertos cuya apertura quedo sin metodo de pago.
--
-- 20261005220000 solo reparo aperturas con source='shift_open'. En produccion
-- quedaron 11 aperturas de turnos abiertos sin metodo:
--   * 8 legadas con source NULL (anteriores a la columna source) en hoteles que
--     si tienen Efectivo activo.
--   * 3 en hoteles sin metodo Efectivo activo (MONACO'S, Oseands Sands, mtb).
--
-- Esta migracion:
--   1. Crea el metodo "Efectivo" (activo) solo en hoteles que tienen una apertura
--      sin metodo en un turno abierto y no tienen Efectivo activo. Si existe uno
--      inactivo llamado Efectivo, lo reactiva en vez de duplicarlo.
--   2. Asigna el Efectivo del mismo hotel a toda apertura sin metodo de un turno
--      abierto, sin importar source. No toca turnos cerrados, ingresos, egresos
--      ni montos, y no crea movimientos ni asientos de ledger.
--   3. Deja rastro de cada cambio en auditoria_operaciones.

begin;

do $repair$
declare
  v_row record;
  v_metodo uuid;
  v_metodos_creados integer := 0;
  v_reparadas integer := 0;
  v_pendientes integer;
begin
  -- 1. Efectivo para hoteles con aperturas bloqueadas y sin Efectivo activo.
  for v_row in
    select distinct on (t.hotel_id) t.hotel_id, t.usuario_id
      from public.caja c
      join public.turnos t on t.id = c.turno_id and t.hotel_id = c.hotel_id
     where t.estado = 'abierto'
       and c.tipo = 'apertura'
       and c.metodo_pago_id is null
       and not exists (
         select 1 from public.metodos_pago m
          where m.hotel_id = t.hotel_id
            and m.activo is true
            and lower(btrim(m.nombre)) = 'efectivo'
       )
     order by t.hotel_id, t.fecha_apertura desc
  loop
    select m.id into v_metodo
      from public.metodos_pago m
     where m.hotel_id = v_row.hotel_id
       and lower(btrim(m.nombre)) = 'efectivo'
     order by m.creado_en
     limit 1
     for update;

    if v_metodo is not null then
      update public.metodos_pago set activo = true where id = v_metodo;
    else
      insert into public.metodos_pago(hotel_id, nombre, activo)
      values (v_row.hotel_id, 'Efectivo', true)
      returning id into v_metodo;
    end if;

    insert into public.auditoria_operaciones(
      hotel_id, actor_id, accion, entidad, entity_id, after_data, reason
    ) values (
      v_row.hotel_id,
      v_row.usuario_id,
      'metodos_pago.crear_efectivo_reparacion',
      'metodos_pago',
      v_metodo,
      jsonb_build_object('metodo_pago_id', v_metodo, 'nombre', 'Efectivo', 'activo', true),
      'Migracion 20261006150000: el hotel tenia turnos abiertos con apertura sin metodo y ningun Efectivo activo'
    );

    v_metodos_creados := v_metodos_creados + 1;
  end loop;

  -- 2. Asignar Efectivo a toda apertura sin metodo de turnos abiertos.
  for v_row in
    select c.id as caja_id,
           c.hotel_id,
           c.monto,
           c.source,
           t.id as turno_id,
           t.usuario_id as turno_usuario_id,
           m.id as metodo_efectivo_id
      from public.caja c
      join public.turnos t
        on t.id = c.turno_id
       and t.hotel_id = c.hotel_id
      join public.metodos_pago m
        on m.hotel_id = c.hotel_id
       and m.activo is true
       and lower(btrim(m.nombre)) = 'efectivo'
     where t.estado = 'abierto'
       and c.tipo = 'apertura'
       and c.metodo_pago_id is null
     for update of c
  loop
    update public.caja
       set metodo_pago_id = v_row.metodo_efectivo_id
     where id = v_row.caja_id
       and metodo_pago_id is null;

    insert into public.auditoria_operaciones(
      hotel_id, actor_id, accion, entidad, entity_id, before_data, after_data, reason
    ) values (
      v_row.hotel_id,
      v_row.turno_usuario_id,
      'caja.reparar_metodo_apertura',
      'caja',
      v_row.caja_id,
      jsonb_build_object('metodo_pago_id', null, 'turno_id', v_row.turno_id, 'monto', v_row.monto, 'source', v_row.source),
      jsonb_build_object('metodo_pago_id', v_row.metodo_efectivo_id, 'turno_id', v_row.turno_id, 'monto', v_row.monto, 'source', v_row.source),
      'Migracion 20261006150000: apertura de turno abierto sin metodo asignada a Efectivo del hotel'
    );

    v_reparadas := v_reparadas + 1;
  end loop;

  select count(*)
    into v_pendientes
    from public.caja c
    join public.turnos t on t.id = c.turno_id
   where t.estado = 'abierto'
     and c.tipo in ('ingreso', 'egreso', 'apertura')
     and c.metodo_pago_id is null;

  raise notice 'M5 apertura legado: efectivos_creados=% aperturas_reparadas=% movimientos_abiertos_sin_metodo=%',
    v_metodos_creados, v_reparadas, v_pendientes;

  if v_pendientes > 0 then
    raise exception 'M5_REPARACION_INCOMPLETA: quedan % movimientos de turnos abiertos sin metodo', v_pendientes
      using errcode = '23514';
  end if;
end
$repair$;

commit;
