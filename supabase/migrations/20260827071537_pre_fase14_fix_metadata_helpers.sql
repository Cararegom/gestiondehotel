-- Pre-Fase 14 metadata helpers.
-- Authorization must come from authoritative profile/role tables, never user_metadata.

create or replace function public.get_my_current_hotel_id()
returns uuid language sql stable security definer
set search_path = pg_catalog, public
as $$
  select u.hotel_id
  from public.usuarios u
  where u.id = auth.uid()
    and u.activo is true
  limit 1;
$$;

create or replace function public.get_my_current_rol()
returns text language sql stable security definer
set search_path = pg_catalog, public
as $$
  select u.rol
  from public.usuarios u
  where u.id = auth.uid()
    and u.activo is true
  limit 1;
$$;

-- Resolve the effective operational role used by RLS.
-- Many staff profiles intentionally keep usuarios.rol = 'usuario' while their
-- real role lives in usuarios_roles. Never cast that generic value to the enum:
-- it is not a valid rol_usuario_enum and would make RLS queries fail.
-- Unknown/unassigned roles resolve to NULL (deny by default) instead of being
-- silently promoted to recepcionista.
create or replace function public.get_current_user_rol_from_profile()
returns public.rol_usuario_enum
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select case
    when public.actor_is_saas_superadmin() then 'superadmin'::public.rol_usuario_enum
    else (
      select candidate.role_value
      from (
        -- Assigned roles are the authoritative operational role for generic
        -- staff profiles. Keep admin ahead of reception and other operations.
        select
          case lower(btrim(r.nombre))
            when 'superadmin' then 'superadmin'::public.rol_usuario_enum
            when 'administrador' then 'admin'::public.rol_usuario_enum
            when 'admin' then 'admin'::public.rol_usuario_enum
            when 'recepcionista' then 'recepcionista'::public.rol_usuario_enum
            when 'recepcion' then 'recepcionista'::public.rol_usuario_enum
            when 'recepción' then 'recepcionista'::public.rol_usuario_enum
            when 'mesero/a' then 'mesero'::public.rol_usuario_enum
            when 'mesero' then 'mesero'::public.rol_usuario_enum
            when 'mesera' then 'mesero'::public.rol_usuario_enum
            when 'camarera' then 'camarera'::public.rol_usuario_enum
            when 'camarero' then 'camarera'::public.rol_usuario_enum
            when 'limpieza' then 'camarera'::public.rol_usuario_enum
            when 'conserje' then 'conserje'::public.rol_usuario_enum
            when 'mantenimiento' then 'mantenimiento'::public.rol_usuario_enum
            else null
          end as role_value,
          case lower(btrim(r.nombre))
            when 'superadmin' then 5
            when 'administrador' then 10
            when 'admin' then 10
            when 'recepcionista' then 20
            when 'recepcion' then 20
            when 'recepción' then 20
            when 'mesero/a' then 30
            when 'mesero' then 30
            when 'mesera' then 30
            when 'camarera' then 40
            when 'camarero' then 40
            when 'limpieza' then 40
            when 'conserje' then 50
            when 'mantenimiento' then 60
            else 999
          end as priority
        from public.usuarios u
        join public.usuarios_roles ur
          on ur.usuario_id = u.id
         and ur.hotel_id = u.hotel_id
        join public.roles r
          on r.id = ur.rol_id
        where u.id = auth.uid()
          and u.activo is true

        union all

        -- Direct roles remain a safe fallback only when they map explicitly to
        -- the enum. The generic text value 'usuario' intentionally maps to NULL.
        select
          case lower(btrim(u.rol))
            when 'superadmin' then 'superadmin'::public.rol_usuario_enum
            when 'administrador' then 'admin'::public.rol_usuario_enum
            when 'admin' then 'admin'::public.rol_usuario_enum
            when 'recepcionista' then 'recepcionista'::public.rol_usuario_enum
            when 'recepcion' then 'recepcionista'::public.rol_usuario_enum
            when 'recepción' then 'recepcionista'::public.rol_usuario_enum
            when 'mesero/a' then 'mesero'::public.rol_usuario_enum
            when 'mesero' then 'mesero'::public.rol_usuario_enum
            when 'mesera' then 'mesero'::public.rol_usuario_enum
            when 'camarera' then 'camarera'::public.rol_usuario_enum
            when 'camarero' then 'camarera'::public.rol_usuario_enum
            when 'limpieza' then 'camarera'::public.rol_usuario_enum
            when 'conserje' then 'conserje'::public.rol_usuario_enum
            when 'mantenimiento' then 'mantenimiento'::public.rol_usuario_enum
            else null
          end as role_value,
          case lower(btrim(u.rol))
            when 'superadmin' then 6
            when 'administrador' then 15
            when 'admin' then 15
            when 'recepcionista' then 25
            when 'recepcion' then 25
            when 'recepción' then 25
            when 'mesero/a' then 35
            when 'mesero' then 35
            when 'mesera' then 35
            when 'camarera' then 45
            when 'camarero' then 45
            when 'limpieza' then 45
            when 'conserje' then 55
            when 'mantenimiento' then 65
            else 999
          end as priority
        from public.usuarios u
        where u.id = auth.uid()
          and u.activo is true
      ) as candidate
      where candidate.role_value is not null
      order by candidate.priority
      limit 1
    )
  end;
$function$;

revoke all on function public.get_my_current_hotel_id(), public.get_my_current_rol(), public.get_current_user_rol_from_profile() from public, anon;
grant execute on function public.get_my_current_hotel_id(), public.get_my_current_rol(), public.get_current_user_rol_from_profile() to authenticated, service_role;
