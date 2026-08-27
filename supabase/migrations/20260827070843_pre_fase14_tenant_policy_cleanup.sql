do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies
    where schemaname='public' and tablename in (
      'categorias_producto','configuracion_hotel','hoteles','compras_tienda',
      'detalle_compras_tienda','notificaciones'
    )
  loop execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename); end loop;
end $$;

create policy "categorias_producto_tenant_access" on public.categorias_producto for all to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "compras_tienda_tenant_access" on public.compras_tienda for all to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "detalle_compras_tienda_tenant_access" on public.detalle_compras_tienda for all to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));

create policy "configuracion_hotel_tenant_select" on public.configuracion_hotel for select to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "configuracion_hotel_admin_insert" on public.configuracion_hotel for insert to authenticated
  with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "configuracion_hotel_admin_update" on public.configuracion_hotel for update to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id)) with check (public.usuario_actual_es_admin_hotel(hotel_id));
create policy "configuracion_hotel_admin_delete" on public.configuracion_hotel for delete to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id));

create policy "hoteles_tenant_select" on public.hoteles for select to authenticated
  using (public.fase1_actor_es_miembro_activo(id) or public.actor_is_saas_superadmin());
create policy "hoteles_onboarding_insert" on public.hoteles for insert to authenticated
  with check (creado_por = auth.uid() and not exists (select 1 from public.usuarios u where u.id = auth.uid()));
create policy "hoteles_admin_update" on public.hoteles for update to authenticated
  using (public.usuario_actual_es_admin_hotel(id) or public.actor_is_saas_superadmin())
  with check (public.usuario_actual_es_admin_hotel(id) or public.actor_is_saas_superadmin());
create policy "hoteles_superadmin_delete" on public.hoteles for delete to authenticated
  using (public.actor_is_saas_superadmin());

create policy "notificaciones_tenant_select" on public.notificaciones for select to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "notificaciones_tenant_insert" on public.notificaciones for insert to authenticated
  with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "notificaciones_tenant_update" on public.notificaciones for update to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id));
create policy "notificaciones_admin_delete" on public.notificaciones for delete to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id));
