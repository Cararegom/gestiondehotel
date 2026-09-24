-- Hotel OK opera en el sistema como Hotel Marena San Isidro.
-- Recepcion conserva el flujo operativo de Control de Energia, pero no puede
-- listar/imprimir secretos QR. Sus escaneos se aceptan solo desde dispositivos moviles.

create or replace function public.energy_actor_is_marena_reception()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.activo = true
      and u.hotel_id = '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid
      and not public.energy_actor_allowed(true)
      and (
        lower(trim(coalesce(u.rol, ''))) = 'recepcionista'
        or exists (
          select 1
          from public.usuarios_roles ur
          join public.roles r on r.id = ur.rol_id
          where ur.usuario_id = u.id
            and ur.hotel_id = u.hotel_id
            and lower(trim(r.nombre)) = 'recepcionista'
        )
      )
  );
$function$;

revoke all on function public.energy_actor_is_marena_reception() from public;
revoke all on function public.energy_actor_is_marena_reception() from anon;
revoke all on function public.energy_actor_is_marena_reception() from authenticated;
grant execute on function public.energy_actor_is_marena_reception() to service_role;

create or replace function public.energy_actor_can_print_qr()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
    from public.usuarios u
    where u.id = auth.uid()
      and u.activo = true
      and (
        lower(trim(coalesce(u.rol, ''))) in ('admin', 'administrador')
        or exists (
          select 1
          from public.usuarios_roles ur
          join public.roles r on r.id = ur.rol_id
          where ur.usuario_id = u.id
            and ur.hotel_id = u.hotel_id
            and lower(trim(r.nombre)) in ('admin', 'administrador')
        )
        or exists (
          select 1
          from public.hoteles h
          where h.id = u.hotel_id
            and h.creado_por = u.id
        )
        or (
          u.hotel_id <> '38373fa5-b953-4aa9-b4e9-25b9739be5f2'::uuid
          and (
            lower(trim(coalesce(u.rol, ''))) = 'recepcionista'
            or exists (
              select 1
              from public.usuarios_roles ur
              join public.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and ur.hotel_id = u.hotel_id
                and lower(trim(r.nombre)) = 'recepcionista'
            )
          )
        )
      )
  );
$function$;

revoke all on function public.energy_actor_can_print_qr() from public;
revoke all on function public.energy_actor_can_print_qr() from anon;
revoke all on function public.energy_actor_can_print_qr() from authenticated;
grant execute on function public.energy_actor_can_print_qr() to service_role;

create or replace function public.energy_capabilities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user public.usuarios%rowtype;
  v_enabled boolean := false;
begin
  select * into v_user
  from public.usuarios
  where id = auth.uid() and activo = true;

  if v_user.id is null then
    return jsonb_build_object(
      'hotel_id', null,
      'can_control', false,
      'can_admin', false,
      'can_print_qr', false,
      'scan_mobile_only', false,
      'enabled', false
    );
  end if;

  select coalesce(c.energy_control_enabled, false)
  into v_enabled
  from public.configuracion_hotel c
  where c.hotel_id = v_user.hotel_id;

  return jsonb_build_object(
    'hotel_id', v_user.hotel_id,
    'can_control', public.energy_actor_allowed(false),
    'can_admin', public.energy_actor_allowed(true),
    'can_print_qr', public.energy_actor_can_print_qr(),
    'scan_mobile_only', public.energy_actor_is_marena_reception(),
    'enabled', coalesce(v_enabled, false),
    'role_label', public.energy_actor_role_label()
  );
end;
$function$;

revoke all on function public.energy_capabilities() from public;
revoke all on function public.energy_capabilities() from anon;
revoke all on function public.energy_capabilities() from authenticated;
grant execute on function public.energy_capabilities() to authenticated;
grant execute on function public.energy_capabilities() to service_role;

create or replace function public.energy_scan(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user public.usuarios%rowtype;
  v_room public.habitaciones%rowtype;
  v_check public.room_energy_checks%rowtype;
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_user_agent text := lower(coalesce(v_headers ->> 'user-agent', ''));
begin
  select * into v_user
  from public.usuarios
  where id = auth.uid() and activo = true;

  if v_user.id is null or not public.energy_actor_allowed(false) then
    raise exception 'NO_AUTORIZADO';
  end if;

  if public.energy_actor_is_marena_reception()
     and v_user_agent !~ '(android|iphone|ipad|ipod|mobile|tablet)' then
    raise exception 'ENERGY_SCAN_MOBILE_REQUIRED';
  end if;

  select h.* into v_room
  from private.room_energy_qr_secrets s
  join public.habitaciones h on h.id = s.room_id and h.hotel_id = s.hotel_id
  join public.configuracion_hotel c on c.hotel_id = h.hotel_id
  where s.token = p_token
    and h.hotel_id = v_user.hotel_id
    and h.activo = true
    and c.energy_control_enabled = true;

  if v_room.id is null then
    raise exception 'QR_INVALIDO';
  end if;

  select * into v_check
  from public.room_energy_checks
  where room_id = v_room.id
    and hotel_id = v_room.hotel_id
    and status in ('pending', 'overdue')
  order by created_at desc
  limit 1;

  if v_check.id is null then
    raise exception 'SIN_CONTROL_PENDIENTE';
  end if;

  update public.room_energy_checks
  set scanned_at = coalesce(scanned_at, now())
  where id = v_check.id and status in ('pending', 'overdue');

  return jsonb_build_object(
    'check_id', v_check.id,
    'room_name', v_room.nombre,
    'created_at', v_check.created_at,
    'due_at', v_check.due_at
  );
end;
$function$;

revoke all on function public.energy_scan(uuid) from public;
revoke all on function public.energy_scan(uuid) from anon;
revoke all on function public.energy_scan(uuid) from authenticated;
grant execute on function public.energy_scan(uuid) to authenticated;
grant execute on function public.energy_scan(uuid) to service_role;
