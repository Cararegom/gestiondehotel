-- Creador profesional de horarios v2.
-- Reemplaza la dependencia del workflow externo/VM sin borrar el historial legacy.

create table if not exists public.horario_configuracion_v2 (
  hotel_id uuid primary key references public.hoteles(id) on delete cascade,
  tipo_operacion integer not null default 8 check (tipo_operacion in (8,12)),
  descanso_minimo_horas integer not null default 12 check (descanso_minimo_horas between 8 and 24),
  dias_descanso_semana integer not null default 1 check (dias_descanso_semana between 1 and 6),
  max_noches_consecutivas integer not null default 2 check (max_noches_consecutivas between 1 and 7),
  balancear_noches boolean not null default true,
  balancear_fines_semana boolean not null default true,
  permitir_relevo_extendido boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists public.horario_turnos_v2 (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  codigo text not null,
  nombre text not null,
  hora_inicio time not null,
  hora_fin time not null,
  es_nocturno boolean not null default false,
  es_extendido boolean not null default false,
  modo_cobertura text not null default 'normal' check (modo_cobertura in ('normal','relevo')),
  orden integer not null default 0,
  activo boolean not null default true,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique(hotel_id,codigo)
);

create table if not exists public.horarios_v2 (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  fecha_inicio date not null,
  fecha_fin date not null,
  periodo text not null check (periodo in ('semana','mes','personalizado')),
  estado text not null default 'borrador' check (estado in ('borrador','publicado','cancelado')),
  calidad integer check (calidad between 0 and 100),
  validacion jsonb not null default '{"criticos":[],"advertencias":[]}'::jsonb,
  reglas_snapshot jsonb not null default '{}'::jsonb,
  creado_por uuid references public.usuarios(id) on delete set null,
  publicado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  publicado_en timestamptz,
  check (fecha_fin >= fecha_inicio),
  check (fecha_fin - fecha_inicio <= 62)
);

create table if not exists public.horario_participantes_v2 (
  horario_id uuid not null references public.horarios_v2(id) on delete cascade,
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  creado_en timestamptz not null default now(),
  primary key(horario_id,usuario_id)
);

create table if not exists public.horario_dias_v2 (
  horario_id uuid not null references public.horarios_v2(id) on delete cascade,
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  fecha date not null,
  modo_cobertura text not null default 'normal' check (modo_cobertura in ('normal','relevo')),
  primary key(horario_id,fecha)
);

create table if not exists public.horario_asignaciones_v2 (
  id uuid primary key default gen_random_uuid(),
  horario_id uuid not null references public.horarios_v2(id) on delete cascade,
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  fecha date not null,
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  tipo_asignacion text not null check (tipo_asignacion in ('turno','descanso')),
  turno_codigo text,
  bloqueado boolean not null default false,
  origen text not null default 'auto' check (origen in ('auto','manual','bloqueado')),
  motivo jsonb not null default '{}'::jsonb,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check ((tipo_asignacion='descanso' and turno_codigo is null) or (tipo_asignacion='turno' and turno_codigo is not null)),
  unique(horario_id,fecha,usuario_id)
);

create unique index if not exists ux_horario_v2_turno_por_dia
  on public.horario_asignaciones_v2(horario_id,fecha,turno_codigo)
  where tipo_asignacion='turno';

create table if not exists public.horario_solicitudes_v2 (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hoteles(id) on delete cascade,
  usuario_id uuid not null references public.usuarios(id) on delete restrict,
  fecha date not null,
  tipo text not null check (tipo in ('descanso','no_disponible','prefiere_dia','prefiere_noche','prefiere_turno')),
  turno_codigo text,
  obligatoria boolean not null default false,
  nota text,
  activo boolean not null default true,
  creado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (tipo <> 'prefiere_turno' or turno_codigo is not null)
);

create index if not exists ix_horarios_v2_hotel_fechas on public.horarios_v2(hotel_id,fecha_inicio,fecha_fin);
create index if not exists ix_horario_asig_v2_hotel_fecha on public.horario_asignaciones_v2(hotel_id,fecha);
create index if not exists ix_horario_solicitudes_v2_hotel_fecha on public.horario_solicitudes_v2(hotel_id,fecha) where activo;
create index if not exists ix_horario_turnos_v2_hotel_modo on public.horario_turnos_v2(hotel_id,modo_cobertura,activo,orden);

-- Inicializa la operación sin confiar en configuraciones legacy por usuario.
insert into public.horario_configuracion_v2(hotel_id,tipo_operacion,permitir_relevo_extendido)
select h.id,
       case when coalesce(ch.tipo_turno_global,8)::int=12 then 12 else 8 end,
       case when coalesce(ch.tipo_turno_global,8)::int=12 then false else true end
from public.hoteles h
left join public.configuracion_hotel ch on ch.hotel_id=h.id
on conflict(hotel_id) do nothing;

-- Plantillas iniciales: se pueden editar luego desde la UI del hotel.
insert into public.horario_turnos_v2(hotel_id,codigo,nombre,hora_inicio,hora_fin,es_nocturno,es_extendido,modo_cobertura,orden)
select c.hotel_id,x.codigo,x.nombre,x.inicio::time,x.fin::time,x.nocturno,x.extendido,x.modo,x.orden
from public.horario_configuracion_v2 c
cross join lateral (
  select * from (values
    ('manana','Mañana','07:00','14:00',false,false,'normal',1),
    ('tarde','Tarde','14:00','22:00',false,false,'normal',2),
    ('noche','Noche','22:00','07:00',true,false,'normal',3),
    ('dia_extendido','Día 12h','07:00','19:00',false,true,'relevo',1),
    ('noche_extendida','Noche 12h','19:00','07:00',true,true,'relevo',2)
  ) v(codigo,nombre,inicio,fin,nocturno,extendido,modo,orden)
  where c.tipo_operacion=8
  union all
  select * from (values
    ('dia','Día','07:00','19:00',false,true,'normal',1),
    ('noche','Noche','19:00','07:00',true,true,'normal',2)
  ) v(codigo,nombre,inicio,fin,nocturno,extendido,modo,orden)
  where c.tipo_operacion=12
) x
on conflict(hotel_id,codigo) do nothing;

alter table public.horario_configuracion_v2 enable row level security;
alter table public.horario_turnos_v2 enable row level security;
alter table public.horarios_v2 enable row level security;
alter table public.horario_participantes_v2 enable row level security;
alter table public.horario_dias_v2 enable row level security;
alter table public.horario_asignaciones_v2 enable row level security;
alter table public.horario_solicitudes_v2 enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'horario_configuracion_v2','horario_turnos_v2','horarios_v2','horario_participantes_v2',
    'horario_dias_v2','horario_asignaciones_v2','horario_solicitudes_v2'
  ] loop
    execute format('drop policy if exists %I on public.%I','horario_v2_select_hotel',t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id) or public.actor_is_saas_superadmin())',
      'horario_v2_select_hotel',t
    );
  end loop;
end $$;

-- El navegador solo lee. Todas las mutaciones pasan por la Edge Function autenticada.
revoke all on public.horario_configuracion_v2, public.horario_turnos_v2, public.horarios_v2,
 public.horario_participantes_v2, public.horario_dias_v2, public.horario_asignaciones_v2,
 public.horario_solicitudes_v2 from anon, authenticated;
grant select on public.horario_configuracion_v2, public.horario_turnos_v2, public.horarios_v2,
 public.horario_participantes_v2, public.horario_dias_v2, public.horario_asignaciones_v2,
 public.horario_solicitudes_v2 to authenticated;
grant select,insert,update,delete on public.horario_configuracion_v2, public.horario_turnos_v2, public.horarios_v2,
 public.horario_participantes_v2, public.horario_dias_v2, public.horario_asignaciones_v2,
 public.horario_solicitudes_v2 to service_role;

-- Reemplaza un borrador completo en una única transacción.
create or replace function public.horario_guardar_borrador_v2(
  p_horario_id uuid,
  p_participantes uuid[],
  p_dias jsonb,
  p_asignaciones jsonb,
  p_validacion jsonb,
  p_calidad integer,
  p_reglas_snapshot jsonb
) returns public.horarios_v2
language plpgsql security invoker set search_path='public'
as $$
declare v_horario public.horarios_v2;
begin
  select * into v_horario from public.horarios_v2 where id=p_horario_id for update;
  if v_horario.id is null then raise exception 'HORARIO_NO_ENCONTRADO'; end if;
  if v_horario.estado <> 'borrador' then raise exception 'HORARIO_NO_ES_BORRADOR'; end if;
  if p_calidad < 0 or p_calidad > 100 then raise exception 'CALIDAD_INVALIDA'; end if;

  delete from public.horario_asignaciones_v2 where horario_id=p_horario_id;
  delete from public.horario_dias_v2 where horario_id=p_horario_id;
  delete from public.horario_participantes_v2 where horario_id=p_horario_id;

  insert into public.horario_participantes_v2(horario_id,hotel_id,usuario_id)
  select p_horario_id,v_horario.hotel_id,u
  from unnest(coalesce(p_participantes,array[]::uuid[])) u;

  insert into public.horario_dias_v2(horario_id,hotel_id,fecha,modo_cobertura)
  select p_horario_id,v_horario.hotel_id,x.fecha,x.modo_cobertura
  from jsonb_to_recordset(coalesce(p_dias,'[]'::jsonb)) as x(fecha date,modo_cobertura text);

  insert into public.horario_asignaciones_v2(
    horario_id,hotel_id,fecha,usuario_id,tipo_asignacion,turno_codigo,bloqueado,origen,motivo
  )
  select p_horario_id,v_horario.hotel_id,x.fecha,x.usuario_id,x.tipo_asignacion,x.turno_codigo,
         coalesce(x.bloqueado,false),coalesce(x.origen,'auto'),coalesce(x.motivo,'{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_asignaciones,'[]'::jsonb)) as x(
    fecha date,usuario_id uuid,tipo_asignacion text,turno_codigo text,bloqueado boolean,origen text,motivo jsonb
  );

  update public.horarios_v2
     set validacion=coalesce(p_validacion,'{"criticos":[],"advertencias":[]}'::jsonb),
         calidad=p_calidad,
         reglas_snapshot=coalesce(p_reglas_snapshot,'{}'::jsonb),
         actualizado_en=now()
   where id=p_horario_id
   returning * into v_horario;
  return v_horario;
end;
$$;

revoke all on function public.horario_guardar_borrador_v2(uuid,uuid[],jsonb,jsonb,jsonb,integer,jsonb)
  from public,anon,authenticated;
grant execute on function public.horario_guardar_borrador_v2(uuid,uuid[],jsonb,jsonb,jsonb,integer,jsonb)
  to service_role;

-- Publica atómicamente hacia la tabla legacy consumida por el resto de la app.
create or replace function public.horario_publicar_v2(p_horario_id uuid,p_actor_id uuid)
returns public.horarios_v2
language plpgsql security invoker set search_path='public'
as $$
declare v_horario public.horarios_v2; v_criticos integer;
begin
  select * into v_horario from public.horarios_v2 where id=p_horario_id for update;
  if v_horario.id is null then raise exception 'HORARIO_NO_ENCONTRADO'; end if;
  if v_horario.estado <> 'borrador' then raise exception 'HORARIO_NO_ES_BORRADOR'; end if;
  v_criticos := jsonb_array_length(coalesce(v_horario.validacion->'criticos','[]'::jsonb));
  if v_criticos > 0 then raise exception 'HORARIO_CON_CONFLICTOS_CRITICOS'; end if;
  if not exists(select 1 from public.usuarios u where u.id=p_actor_id and u.activo is true) then
    raise exception 'ACTOR_INVALIDO';
  end if;

  delete from public.turnos_programados tp
   where tp.hotel_id=v_horario.hotel_id
     and tp.fecha between v_horario.fecha_inicio and v_horario.fecha_fin;

  insert into public.turnos_programados(hotel_id,fecha,usuario_id,tipo_turno,generado_auto)
  select a.hotel_id,a.fecha,a.usuario_id,
         case when a.tipo_asignacion='descanso' then 'descanso' else a.turno_codigo end,
         true
  from public.horario_asignaciones_v2 a
  where a.horario_id=p_horario_id;

  update public.horarios_v2
     set estado='publicado',publicado_por=p_actor_id,publicado_en=now(),actualizado_en=now()
   where id=p_horario_id
   returning * into v_horario;
  return v_horario;
end;
$$;

revoke all on function public.horario_publicar_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.horario_publicar_v2(uuid,uuid) to service_role;
