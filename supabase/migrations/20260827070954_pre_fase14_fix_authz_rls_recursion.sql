create or replace function public.actor_is_saas_superadmin()
returns boolean language sql stable security definer
set search_path = pg_catalog, public
as $$
  select public.is_whitelisted_saas_superadmin_email()
    or exists (
      select 1 from public.usuarios u
      where u.id = auth.uid()
        and (u.rol = 'superadmin' or public.is_whitelisted_saas_superadmin_email(u.correo::text))
    );
$$;

revoke all on function public.actor_is_saas_superadmin() from public, anon;
grant execute on function public.actor_is_saas_superadmin() to authenticated, service_role;
