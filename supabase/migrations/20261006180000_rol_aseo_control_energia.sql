-- Rol de aseo (Camarera / Aseador): mapa de habitaciones solo lectura, Limpieza
-- (libera habitaciones al terminar el aseo) y escaner de Control de Energia.
--
-- En produccion el rol se llama "Aseador", pero energy_actor_allowed solo
-- reconocia 'camarera', asi que el aseador no podia escanear los QR.
-- Se agrega es_nombre_rol_aseo() (mismo criterio que js/services/aseoRoleService.js)
-- y se recrean energy_actor_allowed y energy_actor_role_label a partir de sus
-- definiciones vigentes en produccion, sin cambiar nada mas.

begin;

create or replace function public.es_nombre_rol_aseo(p_nombre text)
returns boolean
language sql
immutable
security invoker
set search_path to 'public'
as $$
  select lower(trim(coalesce(p_nombre, ''))) in ('aseo', 'limpieza', 'housekeeping')
      or lower(trim(coalesce(p_nombre, ''))) like '%camarer%'
      or lower(trim(coalesce(p_nombre, ''))) like '%aseador%'
      or lower(trim(coalesce(p_nombre, ''))) like '%mucama%';
$$;
revoke all on function public.es_nombre_rol_aseo(text) from public;
revoke all on function public.es_nombre_rol_aseo(text) from anon;
grant execute on function public.es_nombre_rol_aseo(text) to authenticated, service_role;

create or replace function public.energy_actor_allowed(p_admin_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
      from public.usuarios u
     where u.id = auth.uid()
       and u.activo = true
       and (case
         when p_admin_only then
           lower(trim(coalesce(u.rol, ''))) in ('admin', 'administrador')
           or exists (
             select 1
               from public.usuarios_roles ur
               join public.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and ur.hotel_id = u.hotel_id
                and lower(trim(r.nombre)) in ('admin', 'administrador')
           )
           or exists (select 1 from public.hoteles h where h.id = u.hotel_id and h.creado_por = u.id)
         else
           lower(trim(coalesce(u.rol, ''))) in ('admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento')
           or public.es_nombre_rol_aseo(u.rol)
           or exists (
             select 1
               from public.usuarios_roles ur
               join public.roles r on r.id = ur.rol_id
              where ur.usuario_id = u.id
                and ur.hotel_id = u.hotel_id
                and (
                  lower(trim(r.nombre)) in ('admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento')
                  or public.es_nombre_rol_mantenimiento_conserje(r.nombre)
                  or public.es_nombre_rol_aseo(r.nombre)
                )
           )
           or exists (select 1 from public.hoteles h where h.id = u.hotel_id and h.creado_por = u.id)
       end)
  );
$$;

create or replace function public.energy_actor_role_label()
returns text
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    (select r.nombre
       from public.usuarios_roles ur
       join public.roles r on r.id = ur.rol_id
      where ur.usuario_id = u.id
        and ur.hotel_id = u.hotel_id
        and (
          lower(trim(r.nombre)) in ('admin', 'administrador', 'recepcionista', 'camarera', 'mantenimiento')
          or public.es_nombre_rol_mantenimiento_conserje(r.nombre)
          or public.es_nombre_rol_aseo(r.nombre)
        )
      order by case
        when lower(trim(r.nombre)) in ('administrador', 'admin') then 1
        when lower(trim(r.nombre)) = 'recepcionista' then 2
        when public.es_nombre_rol_aseo(r.nombre) then 3
        when public.es_nombre_rol_mantenimiento_conserje(r.nombre) then 4
        else 9
      end, r.nombre
      limit 1),
    nullif(trim(u.rol), ''),
    'usuario')
  from public.usuarios u
  where u.id = auth.uid() and u.activo = true;
$$;

-- Mismos privilegios que tenian en produccion.
revoke all on function public.energy_actor_allowed(boolean) from public;
revoke all on function public.energy_actor_allowed(boolean) from anon;
revoke all on function public.energy_actor_allowed(boolean) from authenticated;
grant execute on function public.energy_actor_allowed(boolean) to service_role;
revoke all on function public.energy_actor_role_label() from public;
revoke all on function public.energy_actor_role_label() from anon;
revoke all on function public.energy_actor_role_label() from authenticated;
grant execute on function public.energy_actor_role_label() to service_role;

update public.roles
   set descripcion = 'Camarera / personal de aseo: mapa de habitaciones solo lectura, limpieza y control de energia.'
 where nombre = 'Aseador';

commit;
