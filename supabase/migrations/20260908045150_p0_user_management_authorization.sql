-- P0: JWT actor -> active profile -> hotel -> explicit permission -> bounded operation.
-- No production data changes. Apply before deploying the two Edge Functions/frontend.
-- SECURITY DEFINER is confined to atomic user-management entry points and policy guards;
-- it is needed to write the now closed RBAC tables, not to conceal an RLS error.
begin;
create schema if not exists p0_private;
revoke all on schema p0_private from public, anon, authenticated;

-- Preserve the existing SaaS entry point, but never trust usuarios.correo (bootstrap
-- input) or a stale JWT email to grant global authority. Auth owns confirmed identity.
create or replace function public.actor_is_saas_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users a where a.id = auth.uid() and (
      (a.email_confirmed_at is not null and public.is_whitelisted_saas_superadmin_email(coalesce(a.email, '')))
      or exists (select 1 from public.usuarios u where u.id = a.id and u.rol = 'superadmin')
    )
  );
$$;
revoke all on function public.actor_is_saas_superadmin() from public, anon;
grant execute on function public.actor_is_saas_superadmin() to authenticated, service_role;

-- This existing profile trigger inherits the caller's search_path. Qualify its table
-- so it also works from the hardened RPCs and cannot resolve a temporary shadow table.
create or replace function public.crear_configuracion_turno_default()
returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.configuracion_turnos
    (hotel_id, usuario_id, activo, tipo_turno, horas_turno, turnos_por_semana, dias_descanso)
  values (new.hotel_id, new.id, true, 'rotativo', 8, 5, 2);
  return new;
end;
$$;

create function p0_private.is_protected_user(p_user_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = p_user_id and (
      lower(coalesce(u.rol, '')) ~ 'super|saas'
      or exists (select 1 from auth.users a where a.id = u.id
        and public.is_whitelisted_saas_superadmin_email(coalesce(a.email, '')))
      or exists (select 1 from public.usuarios_roles ur join public.roles r on r.id = ur.rol_id
        where ur.usuario_id = u.id and lower(r.nombre) ~ 'super|saas')
    )
  );
$$;

create function p0_private.actor_hotel(p_requested uuid)
returns uuid language plpgsql set search_path = '' as $$
declare v_actor public.usuarios%rowtype; v_hotel uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select * into v_actor from public.usuarios where id = auth.uid() for update;
  if not found or v_actor.activo is not true then raise exception 'Forbidden' using errcode = '42501'; end if;
  if public.actor_is_saas_superadmin() then
    v_hotel := coalesce(p_requested, v_actor.hotel_id);
  else
    v_hotel := v_actor.hotel_id;
    if v_hotel is null or (p_requested is not null and p_requested <> v_hotel)
      or not public.fase1_actor_es_miembro_activo(v_hotel)
      or not public.usuario_actual_es_admin_hotel(v_hotel)
      or not public.fase1_actor_tiene_permiso(v_hotel, 'editar_usuarios') then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
  end if;
  if v_hotel is null or not exists (select 1 from public.hoteles where id = v_hotel) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return v_hotel;
end;
$$;

create function p0_private.can_grant(p_hotel uuid, p_permission uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.permisos p where p.id = p_permission
    and (public.actor_is_saas_superadmin() or (
      not exists (select 1 from public.usuarios_permisos up
        where up.usuario_id = auth.uid() and up.permiso_id = p.id and up.permitido is false)
      and public.fase1_actor_tiene_permiso(p_hotel, p.nombre)
    )));
$$;

create function p0_private.check_roles(p_hotel uuid, p_roles uuid[])
returns void language plpgsql set search_path = '' as $$
begin
  if p_roles is null or cardinality(p_roles) < 1 or cardinality(p_roles) > 20
    or array_position(p_roles, null) is not null
    or cardinality(p_roles) <> (select count(distinct x) from unnest(p_roles) x) then
    raise exception 'Invalid roles' using errcode = '22023';
  end if;
  -- The role catalog is global (there is no roles.hotel_id). Scope assignments by hotel.
  if exists (select 1 from unnest(p_roles) x left join public.roles r on r.id = x
    where r.id is null or lower(btrim(r.nombre)) not in
      ('administrador','admin','recepcionista','gerente','aseador','mesero/a','mesero','mesera',
       'mantenimiento / conserje','mantenimiento','conserje'))
    or exists (select 1 from public.roles_permisos rp where rp.rol_id = any(p_roles)
      and not p0_private.can_grant(p_hotel, rp.permiso_id)) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
end;
$$;

create function p0_private.target_hotel(p_user_id uuid, p_requested uuid)
returns uuid language plpgsql set search_path = '' as $$
declare v_hotel uuid;
begin
  -- Resolve the target's stored hotel, then authorize the actor before locking/mutating it.
  select hotel_id into v_hotel from public.usuarios where id = p_user_id;
  perform p0_private.actor_hotel(coalesce(p_requested, v_hotel));
  select hotel_id into v_hotel from public.usuarios where id = p_user_id for update;
  if not found or p_user_id = auth.uid() or p0_private.is_protected_user(p_user_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  perform p0_private.actor_hotel(v_hotel);
  if p_requested is not null and p_requested <> v_hotel then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  return v_hotel;
end;
$$;

create function public.p0_autorizar_colaborador(p_hotel_id uuid, p_roles uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid;
begin
  v_hotel := p0_private.actor_hotel(p_hotel_id);
  perform p0_private.check_roles(v_hotel, p_roles);
  return v_hotel;
end;
$$;

create function public.p0_finalizar_colaborador(p_usuario_id uuid, p_hotel_id uuid,
  p_roles uuid[], p_nombre text, p_activo boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid; v_email text;
begin
  v_hotel := public.p0_autorizar_colaborador(p_hotel_id, p_roles);
  if p_nombre is null or length(btrim(p_nombre)) < 3 or length(p_nombre) > 200 or p_activo is null then
    raise exception 'Invalid profile' using errcode = '22023';
  end if;
  -- A caller cannot claim an unrelated Auth account or forge user_metadata to finalize it.
  select a.email into v_email from auth.users a where a.id = p_usuario_id
    and a.raw_app_meta_data ->> 'p0_created_by' = auth.uid()::text
    and a.raw_app_meta_data ->> 'p0_hotel_id' = v_hotel::text
    and a.banned_until > now() for update;
  if not found or p_usuario_id = auth.uid()
    or public.is_whitelisted_saas_superadmin_email(coalesce(v_email, ''))
    or exists (select 1 from public.usuarios where id = p_usuario_id) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;
  insert into public.usuarios(id, nombre, correo, hotel_id, activo)
    values (p_usuario_id, btrim(p_nombre), v_email, v_hotel, p_activo);
  insert into public.usuarios_roles(usuario_id, rol_id, hotel_id)
    select p_usuario_id, r, v_hotel from unnest(p_roles) r;
  -- Single-use provisioning proof, consumed atomically with profile and roles.
  update auth.users set raw_app_meta_data = raw_app_meta_data - 'p0_created_by' - 'p0_hotel_id'
    where id = p_usuario_id;
end;
$$;

create function public.p0_actualizar_permisos_usuario(p_usuario_id uuid, p_hotel_id uuid, p_permisos jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid; v_item jsonb; v_id uuid; v_checked boolean; v_default boolean;
begin
  v_hotel := p0_private.target_hotel(p_usuario_id, p_hotel_id);
  if p_permisos is null or jsonb_typeof(p_permisos) <> 'array' then
    raise exception 'Invalid permissions' using errcode = '22023';
  end if;
  if jsonb_array_length(p_permisos) > 500 then raise exception 'Invalid permissions' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_permisos) e
    group by e->>'permiso_id' having count(*) > 1) then
    raise exception 'Duplicate permission' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_permisos) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'checked') is distinct from 'boolean'
      or jsonb_typeof(v_item->'permiso_id') is distinct from 'string'
      or (v_item - 'checked' - 'permiso_id') <> '{}'::jsonb then
      raise exception 'Invalid permission' using errcode = '22023';
    end if;
    v_id := (v_item->>'permiso_id')::uuid;
    v_checked := (v_item->>'checked')::boolean;
    if not exists (select 1 from public.permisos where id = v_id) then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
    -- Full frontend snapshots include unchecked permissions the actor does not own.
    -- They can revoke them, but can never grant one (including by deleting an override).
    if v_checked and not p0_private.can_grant(v_hotel, v_id) then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
    select exists (select 1 from public.usuarios_roles ur join public.roles_permisos rp on rp.rol_id = ur.rol_id
      where ur.usuario_id = p_usuario_id and ur.hotel_id = v_hotel and rp.permiso_id = v_id) into v_default;
    -- The live table has no UNIQUE(usuario_id, permiso_id) constraint. Serialize on
    -- the target profile and replace the override atomically, without a blind upsert.
    delete from public.usuarios_permisos up where up.usuario_id = p_usuario_id and up.permiso_id = v_id
      and exists (select 1 from public.usuarios u where u.id = up.usuario_id and u.hotel_id = v_hotel);
    if v_checked <> v_default then
      insert into public.usuarios_permisos(usuario_id, permiso_id, permitido)
        select u.id, v_id, v_checked from public.usuarios u where u.id = p_usuario_id and u.hotel_id = v_hotel;
    end if;
  end loop;
end;
$$;

create function public.p0_editar_colaborador(p_usuario_id uuid, p_hotel_id uuid,
  p_roles uuid[], p_nombre text, p_activo boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hotel uuid;
begin
  v_hotel := p0_private.target_hotel(p_usuario_id, p_hotel_id);
  perform p0_private.check_roles(v_hotel, p_roles);
  if p_nombre is null or length(btrim(p_nombre)) < 3 or length(p_nombre) > 200 or p_activo is null then
    raise exception 'Invalid profile' using errcode = '22023';
  end if;
  update public.usuarios set nombre = btrim(p_nombre), activo = p_activo where id = p_usuario_id and hotel_id = v_hotel;
  delete from public.usuarios_roles where usuario_id = p_usuario_id and hotel_id = v_hotel;
  insert into public.usuarios_roles(usuario_id, rol_id, hotel_id)
    select p_usuario_id, r, v_hotel from unnest(p_roles) r;
end;
$$;

-- Close REST bypasses. The existing owner bootstrap remains available for onboarding.
revoke insert, update, delete on public.usuarios_permisos from public, authenticated, anon;
revoke update, delete on public.usuarios_roles from public, authenticated, anon;
revoke truncate, references, trigger on public.usuarios, public.usuarios_roles, public.usuarios_permisos,
  public.roles, public.roles_permisos, public.permisos from public, authenticated, anon;
drop policy usuarios_roles_admin_insert on public.usuarios_roles;
create policy usuarios_roles_admin_insert on public.usuarios_roles for insert to authenticated
  with check (public.pre_fase14_can_bootstrap_admin_role(usuario_id, hotel_id, rol_id));

-- Protect SaaS identities from direct profile changes too. Retain the original identity
-- guard and permit only the existing, derived maintenance-role trigger transition.
create function public.p0_puede_gestionar_perfil(p_usuario_id uuid, p_hotel_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and p_usuario_id <> auth.uid()
    and not p0_private.is_protected_user(p_usuario_id)
    and exists (select 1 from public.usuarios actor where actor.id = auth.uid() and actor.activo is true
      and (public.actor_is_saas_superadmin() or (actor.hotel_id = p_hotel_id
        and public.usuario_actual_es_admin_hotel(p_hotel_id)
        and public.fase1_actor_tiene_permiso(p_hotel_id, 'editar_usuarios'))));
$$;
revoke all on function public.p0_puede_gestionar_perfil(uuid, uuid) from public, anon, service_role;
grant execute on function public.p0_puede_gestionar_perfil(uuid, uuid) to authenticated;
create policy p0_usuarios_update_guard on public.usuarios as restrictive for update to authenticated
  using (public.p0_puede_gestionar_perfil(id, hotel_id))
  with check (public.p0_puede_gestionar_perfil(id, hotel_id));
create policy p0_usuarios_delete_guard on public.usuarios as restrictive for delete to authenticated
  using (public.p0_puede_gestionar_perfil(id, hotel_id));

create or replace function public.pre_fase14_protect_user_authority()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and not public.actor_is_saas_superadmin() then
    if p0_private.is_protected_user(old.id) then raise exception 'Forbidden' using errcode = '42501'; end if;
    if new.id is distinct from old.id or new.hotel_id is distinct from old.hotel_id
      or new.correo is distinct from old.correo or new.email is distinct from old.email then
      raise exception 'Forbidden' using errcode = '42501';
    end if;
    if new.rol is distinct from old.rol and not (
      pg_trigger_depth() > 1 and lower(btrim(old.rol)) in
        ('usuario','recepcionista','aseador','mesero/a','mesero','mesera','conserje','gerente','mantenimiento')
      and new.rol in ('usuario', 'mantenimiento')
      and (new.rol = 'mantenimiento') = exists (select 1 from public.usuarios_roles ur join public.roles r on r.id = ur.rol_id
        where ur.usuario_id = old.id and ur.hotel_id = old.hotel_id and public.es_nombre_rol_mantenimiento_conserje(r.nombre))
    ) then raise exception 'Forbidden' using errcode = '42501'; end if;
  end if;
  return new;
end;
$$;

revoke all on all functions in schema p0_private from public, anon, authenticated, service_role;
revoke all on function public.p0_autorizar_colaborador(uuid, uuid[]) from public, anon, service_role;
revoke all on function public.p0_finalizar_colaborador(uuid, uuid, uuid[], text, boolean) from public, anon, service_role;
revoke all on function public.p0_actualizar_permisos_usuario(uuid, uuid, jsonb) from public, anon, service_role;
revoke all on function public.p0_editar_colaborador(uuid, uuid, uuid[], text, boolean) from public, anon, service_role;
grant execute on function public.p0_autorizar_colaborador(uuid, uuid[]) to authenticated;
grant execute on function public.p0_finalizar_colaborador(uuid, uuid, uuid[], text, boolean) to authenticated;
grant execute on function public.p0_actualizar_permisos_usuario(uuid, uuid, jsonb) to authenticated;
grant execute on function public.p0_editar_colaborador(uuid, uuid, uuid[], text, boolean) to authenticated;
commit;
