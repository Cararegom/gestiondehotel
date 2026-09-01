-- Permite preparar Control de Energia antes de activarlo y delegar la impresion
-- de QR a recepcionistas sin concederles regeneracion ni administracion.

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
        lower(trim(coalesce(u.rol, ''))) in ('admin', 'administrador', 'recepcionista')
        or exists (
          select 1
          from public.usuarios_roles ur
          join public.roles r on r.id = ur.rol_id
          where ur.usuario_id = u.id
            and ur.hotel_id = u.hotel_id
            and lower(trim(r.nombre)) in ('admin', 'administrador', 'recepcionista')
        )
        or exists (
          select 1
          from public.hoteles h
          where h.id = u.hotel_id
            and h.creado_por = u.id
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

create or replace function public.energy_list_qr_tokens()
returns table (
  room_id uuid,
  room_name text,
  token uuid,
  generated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_hotel_id uuid;
begin
  if not public.energy_actor_can_print_qr() then
    raise exception 'NO_AUTORIZADO';
  end if;

  select u.hotel_id into v_hotel_id
  from public.usuarios u
  where u.id = auth.uid() and u.activo = true;

  return query
  select h.id, h.nombre, s.token, s.created_at
  from public.habitaciones h
  left join private.room_energy_qr_secrets s
    on s.room_id = h.id and s.hotel_id = h.hotel_id
  where h.hotel_id = v_hotel_id
    and h.activo = true
  order by h.nombre;
end;
$function$;

revoke all on function public.energy_list_qr_tokens() from public;
revoke all on function public.energy_list_qr_tokens() from anon;
revoke all on function public.energy_list_qr_tokens() from authenticated;
grant execute on function public.energy_list_qr_tokens() to authenticated;
grant execute on function public.energy_list_qr_tokens() to service_role;

-- No permite activar el flujo obligatorio si existen habitaciones activas
-- sin QR generado. Generar no equivale a instalar: la interfaz pedira igualmente
-- confirmacion humana antes de activar.
create or replace function public.energy_require_qr_before_enable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_missing integer := 0;
begin
  if new.energy_control_enabled = true
     and (tg_op = 'INSERT' or old.energy_control_enabled is distinct from true) then
    select count(*)::integer
    into v_missing
    from public.habitaciones h
    left join private.room_energy_qr_secrets s
      on s.room_id = h.id and s.hotel_id = h.hotel_id
    where h.hotel_id = new.hotel_id
      and h.activo = true
      and s.room_id is null;

    if v_missing > 0 then
      raise exception using
        errcode = 'P0001',
        message = 'ENERGY_QR_FALTANTES:' || v_missing::text;
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.energy_require_qr_before_enable() from public;
revoke all on function public.energy_require_qr_before_enable() from anon;
revoke all on function public.energy_require_qr_before_enable() from authenticated;
grant execute on function public.energy_require_qr_before_enable() to service_role;

drop trigger if exists configuracion_hotel_energy_require_qr_before_enable on public.configuracion_hotel;
create trigger configuracion_hotel_energy_require_qr_before_enable
before insert or update of energy_control_enabled on public.configuracion_hotel
for each row
execute function public.energy_require_qr_before_enable();
