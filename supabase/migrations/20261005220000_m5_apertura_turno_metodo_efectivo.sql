-- M5 / apertura: la apertura de turno debe quedar registrada en Efectivo.
--
-- Causa raiz: abrir_turno_con_apertura insertaba la fila tipo='apertura' en
-- public.caja sin metodo_pago_id. cerrar_turno_con_arqueo (M5) rechaza con razon
-- cualquier ingreso/egreso/apertura sin metodo, por lo que ningun turno nuevo
-- podia cerrarse (M5_MOVIMIENTO_SIN_METODO).
--
-- Esta migracion:
--   1. Diagnostica y aborta si algun hotel tiene mas de un metodo Efectivo activo.
--   2. Garantiza a lo sumo un Efectivo activo por hotel (indice parcial unico).
--   3. abrir_turno_con_apertura resuelve el Efectivo del hotel y lo asigna a la
--      apertura; sin Efectivo activo falla sin crear turno ni caja.
--   4. El ledger shadow no proyecta aperturas: son la base del cajon, no dinero
--      nuevo (proyectarlas duplicaria saldo en cada turno y el trigger las
--      registraba como salida). resumen_cuentas_financieras deja de contarlas
--      como "caja sin ledger".
--   5. Trigger preventivo: una apertura nueva no puede quedar sin metodo ni con
--      un metodo de otro hotel.
--   6. Repara solo aperturas shift_open sin metodo de turnos ABIERTOS, con el
--      Efectivo del mismo hotel, dejando rastro en auditoria_operaciones.
--
-- No cambia cerrar_turno_con_arqueo ni la firma de abrir_turno_con_apertura.

begin;

-- 1. Diagnostico previo ------------------------------------------------------
do $diag$
declare
  v_row record;
  v_duplicados text;
begin
  for v_row in
    select t.hotel_id,
           count(*) as aperturas_sin_metodo,
           sum(c.monto) as monto_total,
           (select count(*)
              from public.metodos_pago m
             where m.hotel_id = t.hotel_id
               and m.activo is true
               and lower(btrim(m.nombre)) = 'efectivo') as efectivos_activos
      from public.caja c
      join public.turnos t on t.id = c.turno_id
     where t.estado = 'abierto'
       and c.tipo = 'apertura'
       and c.source = 'shift_open'
       and c.metodo_pago_id is null
     group by t.hotel_id
  loop
    raise notice 'M5 apertura diagnostico: hotel % aperturas_abiertas_sin_metodo=% monto=% efectivos_activos=%',
      v_row.hotel_id, v_row.aperturas_sin_metodo, v_row.monto_total, v_row.efectivos_activos;
  end loop;

  select string_agg(hotel_id::text || ' (' || n || ')', ', ')
    into v_duplicados
    from (
      select m.hotel_id, count(*) as n
        from public.metodos_pago m
       where m.activo is true
         and lower(btrim(m.nombre)) = 'efectivo'
       group by m.hotel_id
      having count(*) > 1
    ) d;

  if v_duplicados is not null then
    raise exception 'M5_EFECTIVO_DUPLICADO: hoteles con mas de un metodo Efectivo activo: %. Desactive o renombre los sobrantes antes de aplicar esta migracion.', v_duplicados
      using errcode = '23505';
  end if;
end
$diag$;

-- 2. Un solo Efectivo activo por hotel ---------------------------------------
create unique index if not exists metodos_pago_un_efectivo_activo_por_hotel
  on public.metodos_pago (hotel_id)
  where activo is true and lower(btrim(nombre)) = 'efectivo';

-- 3. Apertura en Efectivo ----------------------------------------------------
create or replace function public.abrir_turno_con_apertura(
  p_hotel_id uuid,
  p_usuario_id uuid,
  p_monto_inicial numeric,
  p_fecha_movimiento timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_turno public.turnos%rowtype;
  v_metodo_efectivo uuid;
begin
  if auth.uid() is null
     or p_usuario_id is distinct from auth.uid()
     or not public.fase1_actor_es_miembro_activo(p_hotel_id) then
    raise exception 'Actor/hotel no autorizado' using errcode = '42501';
  end if;

  if p_monto_inicial is null or p_monto_inicial < 0 then
    raise exception 'Monto inicial invalido' using errcode = '22023';
  end if;

  if exists (
    select 1
      from public.turnos
     where hotel_id = p_hotel_id
       and usuario_id = auth.uid()
       and estado = 'abierto'
  ) then
    raise exception 'Ya existe turno abierto' using errcode = '23505';
  end if;

  -- Se resuelve antes de crear el turno: sin Efectivo no queda nada a medias.
  select m.id
    into v_metodo_efectivo
    from public.metodos_pago m
   where m.hotel_id = p_hotel_id
     and m.activo is true
     and lower(btrim(m.nombre)) = 'efectivo'
   limit 1
   for share;

  if v_metodo_efectivo is null then
    raise exception 'M5_EFECTIVO_NO_CONFIGURADO: el hotel no tiene un metodo de pago Efectivo activo'
      using errcode = '23514';
  end if;

  insert into public.turnos(hotel_id, usuario_id, fecha_apertura, estado)
  values (p_hotel_id, auth.uid(), coalesce(p_fecha_movimiento, now()), 'abierto')
  returning * into v_turno;

  insert into public.caja(
    hotel_id,
    usuario_id,
    turno_id,
    tipo,
    concepto,
    monto,
    metodo_pago_id,
    fecha_movimiento,
    source,
    business_date
  ) values (
    p_hotel_id,
    auth.uid(),
    v_turno.id,
    'apertura',
    'Apertura de caja',
    p_monto_inicial,
    v_metodo_efectivo,
    coalesce(p_fecha_movimiento, now()),
    'shift_open',
    public.hotel_business_date(p_hotel_id, coalesce(p_fecha_movimiento, now()))
  );

  return to_jsonb(v_turno);
end
$$;

revoke all on function public.abrir_turno_con_apertura(uuid, uuid, numeric, timestamptz) from public;
revoke all on function public.abrir_turno_con_apertura(uuid, uuid, numeric, timestamptz) from anon;
grant execute on function public.abrir_turno_con_apertura(uuid, uuid, numeric, timestamptz) to authenticated, service_role;

-- 4. Ledger shadow: la apertura no es un flujo de dinero ---------------------
create or replace function public.fase2_project_caja_to_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_account uuid;
  v_direction text;
begin
  if NEW.metodo_pago_id is null
     or NEW.tipo::text = 'apertura'
     or exists (select 1 from public.account_movements where caja_id = NEW.id) then
    return NEW;
  end if;
  v_account := public.fase2_ensure_method_account(NEW.metodo_pago_id, NEW.hotel_id, NEW.usuario_id);
  v_direction := case when NEW.tipo::text = 'ingreso' then 'in' else 'out' end;
  insert into public.account_movements(
    hotel_id, account_id, direction, amount, occurred_at, business_date, description, source, caja_id,
    metodo_pago_id, turno_id, created_by, client_operation_id
  ) values (
    NEW.hotel_id, v_account, v_direction, NEW.monto, coalesce(NEW.fecha_movimiento, now()),
    coalesce(NEW.business_date, public.hotel_business_date(NEW.hotel_id, coalesce(NEW.fecha_movimiento, now()))),
    NEW.concepto, 'caja_shadow', NEW.id, NEW.metodo_pago_id, NEW.turno_id, NEW.usuario_id, NEW.client_operation_id
  );
  return NEW;
end
$$;

create or replace function public.resumen_cuentas_financieras()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_hotel uuid;
begin
  select hotel_id into v_hotel from public.usuarios where id = auth.uid() and activo is true;
  if v_hotel is null or not public.fase1_actor_tiene_permiso(v_hotel, 'finanzas.ver') then
    raise exception 'Sin permiso financiero' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'hotel_id', v_hotel, 'generated_at', now(),
    'accounts', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
      select a.id, a.name, a.account_type, a.currency, a.last_four, a.active, a.shadow_started_at,
        a.opening_balance + coalesce(sum(case m.direction when 'in' then m.amount else -m.amount end), 0) as balance
      from public.financial_accounts a
      left join public.account_movements m on m.account_id = a.id
      where a.hotel_id = v_hotel
      group by a.id
    ) x), '[]'::jsonb),
    'unmapped_methods', (select count(*) from public.metodos_pago where hotel_id = v_hotel and activo and financial_account_id is null),
    'caja_without_ledger', (
      select count(*)
        from public.caja c
       where c.hotel_id = v_hotel
         and c.metodo_pago_id is not null
         and c.tipo::text <> 'apertura'
         and c.creado_en >= (select coalesce(min(shadow_started_at), now()) from public.financial_accounts where hotel_id = v_hotel)
         and not exists (select 1 from public.account_movements m where m.caja_id = c.id)
    )
  );
end
$$;

revoke all on function public.resumen_cuentas_financieras() from public;
revoke all on function public.resumen_cuentas_financieras() from anon;
grant execute on function public.resumen_cuentas_financieras() to authenticated, service_role;

-- 5. Prevencion: ninguna apertura nueva sin metodo del mismo hotel -----------
create or replace function public.caja_apertura_requiere_metodo()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if NEW.tipo::text <> 'apertura' then
    return NEW;
  end if;

  if NEW.metodo_pago_id is null then
    -- Aperturas historicas cerradas sin metodo se toleran mientras no se
    -- conviertan en apertura ni pierdan un metodo que ya tenian.
    if TG_OP = 'UPDATE'
       and OLD.tipo::text = 'apertura'
       and OLD.metodo_pago_id is null then
      return NEW;
    end if;
    raise exception 'M5_APERTURA_SIN_METODO: la apertura de caja requiere metodo de pago'
      using errcode = '23514';
  end if;

  if not exists (
    select 1 from public.metodos_pago m
     where m.id = NEW.metodo_pago_id
       and m.hotel_id = NEW.hotel_id
  ) then
    raise exception 'M5_APERTURA_METODO_INVALIDO: el metodo de la apertura no pertenece al hotel'
      using errcode = '23514';
  end if;

  return NEW;
end
$$;

revoke all on function public.caja_apertura_requiere_metodo() from public;
revoke all on function public.caja_apertura_requiere_metodo() from anon;
revoke all on function public.caja_apertura_requiere_metodo() from authenticated;

drop trigger if exists caja_apertura_requiere_metodo_trg on public.caja;
create trigger caja_apertura_requiere_metodo_trg
before insert or update of tipo, metodo_pago_id, hotel_id on public.caja
for each row
execute function public.caja_apertura_requiere_metodo();

-- 6. Reparacion de turnos abiertos -------------------------------------------
do $repair$
declare
  v_row record;
  v_reparadas integer := 0;
  v_pendientes integer;
begin
  for v_row in
    select c.id as caja_id,
           c.hotel_id,
           c.monto,
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
       and c.source = 'shift_open'
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
      jsonb_build_object('metodo_pago_id', null, 'turno_id', v_row.turno_id, 'monto', v_row.monto),
      jsonb_build_object('metodo_pago_id', v_row.metodo_efectivo_id, 'turno_id', v_row.turno_id, 'monto', v_row.monto),
      'Migracion 20261005220000: apertura de turno abierto sin metodo asignada a Efectivo del hotel'
    );

    v_reparadas := v_reparadas + 1;
  end loop;

  select count(*)
    into v_pendientes
    from public.caja c
    join public.turnos t on t.id = c.turno_id
   where t.estado = 'abierto'
     and c.tipo = 'apertura'
     and c.source = 'shift_open'
     and c.metodo_pago_id is null;

  raise notice 'M5 apertura reparacion: aperturas reparadas=% pendientes_sin_efectivo=%', v_reparadas, v_pendientes;
  if v_pendientes > 0 then
    raise warning 'M5 apertura: % aperturas de turnos abiertos siguen sin metodo porque su hotel no tiene Efectivo activo', v_pendientes;
  end if;
end
$repair$;

commit;
