-- S1/S2 auditoria 2026-11-03: la suscripcion de un hotel solo la decide el servidor.
--
-- S1: la politica hoteles_admin_update deja que el admin del hotel actualice toda
-- la fila, incluidas las columnas de plan, vencimiento, gracia y exencion.
-- S2: el registro (script.js) calculaba el trial en el navegador e insertaba el
-- hotel con esos valores; la politica de insercion solo exigia creado_por = auth.uid().
-- Ademas, desde 20260827070843 ese INSERT ... RETURNING choca con
-- hoteles_tenant_select (el usuario aun no es miembro), asi que el alta fallaba, y
-- usuarios/usuarios_roles se insertaban aparte sin comprobar errores.
--
-- Cambios:
--   1. Trigger BEFORE INSERT OR UPDATE en hoteles:
--      * UPDATE desde el navegador (authenticated/anon): rechaza cambios en las
--        columnas de suscripcion.
--      * INSERT desde el navegador: ignora lo que mande el cliente y asigna el
--        trial de 30 dias con la hora del servidor (defensa en profundidad; con el
--        punto 3 ya no hay politica de INSERT para authenticated).
--      Quedan fuera service_role (webhooks de pago), el superadmin SaaS y las
--      funciones SECURITY DEFINER (saas_otorgar_dias_gracia, el cron de
--      sincronizar_estados_suscripcion, registrar_hotel_inicial), que corren con el
--      rol del propietario.
--   2. RPC registrar_hotel_inicial: crea hotel + perfil admin + rol en una sola
--      transaccion, con el trial calculado en el servidor y el referido validado.
--   3. Se retira hoteles_onboarding_insert: el alta solo pasa por la RPC y no
--      puede quedar un hotel sin administrador.
--
-- No modifica filas existentes: suscripciones, pagos y exenciones vigentes quedan igual.

create or replace function public.blindar_suscripcion_hotel()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_columnas_protegidas constant text[] := array[
    'plan', 'plan_id', 'plan_pendiente', 'plan_pendiente_id', 'plan_pendiente_desde',
    'estado_suscripcion', 'trial_inicio', 'trial_fin', 'suscripcion_inicio', 'suscripcion_fin',
    'suscripcion_exenta', 'suscripcion_exenta_motivo',
    'gracia_hasta', 'gracia_motivo', 'gracia_actualizada_en',
    'referido_por', 'fecha_inicio_prueba', 'fecha_vencimiento', 'bloqueado', 'activo', 'creado_por'
  ];
  v_old jsonb;
  v_new jsonb;
  v_columna text;
  v_trial_inicio timestamptz;
begin
  -- La funcion es SECURITY INVOKER a proposito: current_user es el rol que ejecuta
  -- la sentencia (authenticated/anon via PostgREST), no el propietario.
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if current_user = 'authenticated' and coalesce(public.actor_is_saas_superadmin(), false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_trial_inicio := now();
    -- jsonb_populate_record ignora claves sin columna, asi no falla si alguna
    -- columna heredada no existe en un entorno.
    new := jsonb_populate_record(new, jsonb_build_object(
      'plan', 'max',
      'plan_id', null,
      'plan_pendiente', null,
      'plan_pendiente_id', null,
      'plan_pendiente_desde', null,
      'estado_suscripcion', 'trial',
      'trial_inicio', v_trial_inicio,
      'trial_fin', v_trial_inicio + interval '30 days',
      'suscripcion_inicio', null,
      'suscripcion_fin', v_trial_inicio + interval '30 days',
      'suscripcion_exenta', false,
      'suscripcion_exenta_motivo', null,
      'gracia_hasta', null,
      'gracia_motivo', null,
      'gracia_actualizada_en', null,
      'referido_por', null,
      'fecha_inicio_prueba', null,
      'fecha_vencimiento', null,
      'bloqueado', false,
      'activo', true
    ));
    return new;
  end if;

  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_columna in array v_columnas_protegidas loop
    if (v_new -> v_columna) is distinct from (v_old -> v_columna) then
      raise exception 'La suscripcion del hotel solo se puede modificar desde el sistema de pagos (columna %).', v_columna
        using errcode = '42501';
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function public.blindar_suscripcion_hotel()
  from public, anon, authenticated;

comment on function public.blindar_suscripcion_hotel() is
  'S1/S2: el navegador no puede fijar ni cambiar plan, vencimiento, gracia ni exencion de un hotel. El trial de 30 dias se calcula con la hora del servidor.';

-- El nombre ordena este trigger antes de trg_proteger_suscripcion_exenta_hotel
-- (PostgreSQL dispara los BEFORE del mismo evento por orden alfabetico).
drop trigger if exists trg_blindar_suscripcion_hotel on public.hoteles;
create trigger trg_blindar_suscripcion_hotel
before insert or update on public.hoteles
for each row
execute function public.blindar_suscripcion_hotel();

create or replace function public.registrar_hotel_inicial(
  p_nombre_hotel text,
  p_nombre_admin text,
  p_referido_por text default null
)
returns uuid
language plpgsql
security definer
-- No vacio a proposito: los triggers heredan este search_path y after_insert_hotel_add_config
-- (trg_add_configuracion_hotel) usa "configuracion_hotel" sin esquema. pg_temp va al final para que
-- un objeto temporal no suplante a uno de public; dentro de la funcion todo va calificado.
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_correo text;
  v_nombre_hotel text := nullif(btrim(coalesce(p_nombre_hotel, '')), '');
  v_nombre_admin text := nullif(btrim(coalesce(p_nombre_admin, '')), '');
  v_referido uuid;
  v_rol_admin uuid;
  v_trial_inicio timestamptz := now();
  v_hotel_id uuid;
begin
  if v_uid is null then
    raise exception 'Debes iniciar sesion para registrar el hotel.' using errcode = '42501';
  end if;
  if v_nombre_hotel is null or length(v_nombre_hotel) > 150 or v_nombre_admin is null or length(v_nombre_admin) > 150 then
    raise exception 'Nombre del hotel o del administrador invalido.' using errcode = '22023';
  end if;

  -- Una cuenta de Auth solo crea un hotel, y nunca si ya es colaborador de otro.
  if exists (select 1 from public.usuarios u where u.id = v_uid) then
    raise exception 'Esta cuenta ya pertenece a un hotel.' using errcode = '42501';
  end if;

  -- El correo sale de la identidad verificada por Supabase Auth, no del formulario.
  select a.email::text into v_correo from auth.users a where a.id = v_uid;
  if v_correo is null then
    raise exception 'La cuenta no tiene correo registrado.' using errcode = '42501';
  end if;

  -- Referido: enlace ?ref=<hotel_id> de Mi cuenta. Solo se guarda si es un hotel real.
  if p_referido_por ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select h.id into v_referido from public.hoteles h where h.id = p_referido_por::uuid;
  end if;

  select r.id into v_rol_admin
    from public.roles r
   where lower(btrim(r.nombre)) in ('admin', 'administrador')
   order by r.nombre
   limit 1;
  if v_rol_admin is null then
    raise exception 'No existe el rol Administrador.' using errcode = 'P0002';
  end if;

  insert into public.hoteles(
    nombre, correo, plan, estado_suscripcion, trial_inicio, trial_fin, suscripcion_fin, creado_por, referido_por
  ) values (
    v_nombre_hotel, v_correo, 'max', 'trial', v_trial_inicio, v_trial_inicio + interval '30 days',
    v_trial_inicio + interval '30 days', v_uid, v_referido
  ) returning id into v_hotel_id;

  insert into public.usuarios(id, nombre, hotel_id, correo, rol)
  values (v_uid, v_nombre_admin, v_hotel_id, v_correo, 'admin');

  insert into public.usuarios_roles(usuario_id, rol_id, hotel_id)
  values (v_uid, v_rol_admin, v_hotel_id);

  return v_hotel_id;
end;
$$;

revoke all on function public.registrar_hotel_inicial(text, text, text) from public, anon;
grant execute on function public.registrar_hotel_inicial(text, text, text) to authenticated;

comment on function public.registrar_hotel_inicial(text, text, text) is
  'Alta atomica desde el registro: hotel con trial de 30 dias (hora del servidor), perfil admin y rol Administrador. Si algo falla no queda nada creado.';

drop policy if exists "hoteles_onboarding_insert" on public.hoteles;
