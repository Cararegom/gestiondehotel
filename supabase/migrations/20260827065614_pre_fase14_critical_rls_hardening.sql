-- Hotfix previo a Fase 14/24: aislamiento tenant y bloqueo de escalacion RBAC.

create or replace function public.get_current_user_hotel_id_from_profile()
returns uuid language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case when public.actor_is_saas_superadmin() then null::uuid
    else (select u.hotel_id from public.usuarios u where u.id = auth.uid() limit 1)
  end;
$$;

create or replace function public.get_current_user_rol_from_profile()
returns public.rol_usuario_enum language sql stable security definer
set search_path = pg_catalog, public
as $$
  select case when public.actor_is_saas_superadmin() then 'superadmin'::public.rol_usuario_enum
    else coalesce((select nullif(u.rol, '') from public.usuarios u where u.id = auth.uid() limit 1), 'recepcionista')::public.rol_usuario_enum
  end;
$$;

create or replace function public.pre_fase14_can_bootstrap_profile(p_user_id uuid, p_hotel_id uuid, p_role text)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and p_user_id = auth.uid()
    and lower(coalesce(p_role, 'admin')) in ('admin', 'administrador')
    and exists (select 1 from public.hoteles h where h.id = p_hotel_id and h.creado_por = auth.uid())
    and not exists (select 1 from public.usuarios u where u.id = auth.uid());
$$;

create or replace function public.pre_fase14_can_bootstrap_admin_role(p_user_id uuid, p_hotel_id uuid, p_role_id uuid)
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null
    and p_user_id = auth.uid()
    and exists (select 1 from public.usuarios u where u.id = auth.uid() and u.hotel_id = p_hotel_id and u.activo is true)
    and exists (select 1 from public.hoteles h where h.id = p_hotel_id and h.creado_por = auth.uid())
    and exists (select 1 from public.roles r where r.id = p_role_id and lower(r.nombre) in ('admin', 'administrador'))
    and not exists (select 1 from public.usuarios_roles ur where ur.usuario_id = auth.uid());
$$;

revoke all on function public.pre_fase14_can_bootstrap_profile(uuid, uuid, text) from public, anon;
revoke all on function public.pre_fase14_can_bootstrap_admin_role(uuid, uuid, uuid) from public, anon;
grant execute on function public.pre_fase14_can_bootstrap_profile(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.pre_fase14_can_bootstrap_admin_role(uuid, uuid, uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['clientes','ventas','pagos','permisos','roles','roles_permisos','usuarios_roles','usuarios_permisos','turnos_programados','tiempos_estancia']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

revoke all on table public.clientes, public.ventas, public.pagos, public.permisos, public.roles,
  public.roles_permisos, public.usuarios_roles, public.usuarios_permisos,
  public.turnos_programados, public.tiempos_estancia from anon;
grant select, insert, update, delete on public.clientes to authenticated;
grant select on public.ventas, public.pagos, public.permisos, public.roles, public.roles_permisos to authenticated;
grant select, insert, delete on public.usuarios_roles to authenticated;
grant select, insert, update, delete on public.usuarios_permisos, public.turnos_programados to authenticated;
grant select, insert, update, delete on public.tiempos_estancia to authenticated;

drop policy if exists "clientes_tenant_select" on public.clientes;
drop policy if exists "clientes_tenant_insert" on public.clientes;
drop policy if exists "clientes_tenant_update" on public.clientes;
drop policy if exists "clientes_tenant_delete" on public.clientes;
create policy "clientes_tenant_select" on public.clientes for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "clientes_tenant_insert" on public.clientes for insert to authenticated with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "clientes_tenant_update" on public.clientes for update to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "clientes_tenant_delete" on public.clientes for delete to authenticated using (public.usuario_actual_es_admin_hotel(hotel_id));

create policy "ventas_tenant_select" on public.ventas for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "pagos_tenant_select" on public.pagos for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id));

create policy "roles_catalog_select" on public.roles for select to authenticated using (true);
create policy "permisos_catalog_select" on public.permisos for select to authenticated using (true);
create policy "roles_permisos_catalog_select" on public.roles_permisos for select to authenticated using (true);

drop policy if exists "Allow insert for onboarding" on public.usuarios_roles;
drop policy if exists "admin_full_access" on public.usuarios_roles;
create policy "usuarios_roles_tenant_select" on public.usuarios_roles for select to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "usuarios_roles_admin_insert" on public.usuarios_roles for insert to authenticated
  with check ((public.usuario_actual_es_admin_hotel(hotel_id) and not exists (
    select 1 from public.roles r where r.id = rol_id and lower(r.nombre) = 'superadmin'
  )) or public.pre_fase14_can_bootstrap_admin_role(usuario_id, hotel_id, rol_id));
create policy "usuarios_roles_admin_delete" on public.usuarios_roles for delete to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id));

create policy "usuarios_permisos_tenant_select" on public.usuarios_permisos for select to authenticated
  using (usuario_id = auth.uid() or exists (
    select 1 from public.usuarios target where target.id = usuario_id and public.usuario_actual_es_admin_hotel(target.hotel_id)
  ));
create policy "usuarios_permisos_admin_insert" on public.usuarios_permisos for insert to authenticated
  with check (exists (select 1 from public.usuarios target where target.id = usuario_id and public.usuario_actual_es_admin_hotel(target.hotel_id)));
create policy "usuarios_permisos_admin_update" on public.usuarios_permisos for update to authenticated
  using (exists (select 1 from public.usuarios target where target.id = usuario_id and public.usuario_actual_es_admin_hotel(target.hotel_id)))
  with check (exists (select 1 from public.usuarios target where target.id = usuario_id and public.usuario_actual_es_admin_hotel(target.hotel_id)));
create policy "usuarios_permisos_admin_delete" on public.usuarios_permisos for delete to authenticated
  using (exists (select 1 from public.usuarios target where target.id = usuario_id and public.usuario_actual_es_admin_hotel(target.hotel_id)));

drop policy if exists "Permitir a usuarios ver turnos de su propio hotel" on public.turnos_programados;
create policy "turnos_programados_tenant_select" on public.turnos_programados for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "turnos_programados_admin_insert" on public.turnos_programados for insert to authenticated with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "turnos_programados_admin_update" on public.turnos_programados for update to authenticated using (public.usuario_actual_es_admin_hotel(hotel_id)) with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "turnos_programados_admin_delete" on public.turnos_programados for delete to authenticated using (public.usuario_actual_es_admin_hotel(hotel_id));

drop policy if exists "TiemposEstancia_AccesoDeleteHotel" on public.tiempos_estancia;
drop policy if exists "TiemposEstancia_AccesoLecturaHotel" on public.tiempos_estancia;
drop policy if exists "TiemposEstancia_AccesoUpdateHotel" on public.tiempos_estancia;
drop policy if exists "allow_insert_tiempos_estancia" on public.tiempos_estancia;
drop policy if exists "allow_insert_tiempos_estancia_authenticated" on public.tiempos_estancia;
create policy "tiempos_estancia_tenant_select" on public.tiempos_estancia for select to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "tiempos_estancia_admin_insert" on public.tiempos_estancia for insert to authenticated with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "tiempos_estancia_admin_update" on public.tiempos_estancia for update to authenticated using (public.usuario_actual_es_admin_hotel(hotel_id)) with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "tiempos_estancia_admin_delete" on public.tiempos_estancia for delete to authenticated using (public.usuario_actual_es_admin_hotel(hotel_id));

-- La tabla usuarios ya tenia RLS, pero sus politicas permitian lectura publica y auto-escalacion.
revoke all on table public.usuarios from anon;
drop policy if exists "Allow insert for onboarding" on public.usuarios;
drop policy if exists "admin_full_access" on public.usuarios;
drop policy if exists "only_admin_can_delete_users" on public.usuarios;
drop policy if exists "only_admin_can_insert_users" on public.usuarios;
drop policy if exists "only_admin_can_update_users" on public.usuarios;
drop policy if exists "same_hotel_can_select_users" on public.usuarios;
drop policy if exists "user_can_select_own_profile" on public.usuarios;
drop policy if exists "user_can_update_own_profile" on public.usuarios;
create policy "usuarios_own_or_tenant_select" on public.usuarios for select to authenticated
  using (id = auth.uid() or public.fase1_actor_es_miembro_activo(hotel_id) or public.actor_is_saas_superadmin());
create policy "usuarios_bootstrap_insert" on public.usuarios for insert to authenticated
  with check (public.pre_fase14_can_bootstrap_profile(id, hotel_id, rol));
create policy "usuarios_admin_update" on public.usuarios for update to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id))
  with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "usuarios_admin_delete" on public.usuarios for delete to authenticated
  using (id <> auth.uid() and public.usuario_actual_es_admin_hotel(hotel_id));

create or replace function public.pre_fase14_protect_user_authority()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if auth.uid() is not null and not public.actor_is_saas_superadmin()
     and (new.hotel_id is distinct from old.hotel_id or new.rol is distinct from old.rol
       or new.correo is distinct from old.correo or new.email is distinct from old.email) then
    raise exception 'No se permite modificar identidad, hotel o rol desde el cliente' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists pre_fase14_protect_user_authority on public.usuarios;
create trigger pre_fase14_protect_user_authority before update on public.usuarios
for each row execute function public.pre_fase14_protect_user_authority();

-- RLS existente: se elimina acceso anonimo redundante y las politicas PUBLIC se restringen.
revoke all on table public.caja, public.reservas from anon;
drop policy if exists "Caja_hotel" on public.caja;
create policy "Caja_hotel" on public.caja for all to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
drop policy if exists "Reservas_hotel" on public.reservas;
create policy "Reservas_hotel" on public.reservas for all to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
