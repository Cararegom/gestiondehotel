-- Segundo grupo reversible: tablas legacy que seguian sin RLS.
do $$
declare t text;
begin
  foreach t in array array[
    'amenidades_inventario','cambios_habitacion','cambios_plan','clientes_descuentos',
    'configuracion_turnos','crm_actividades','historial_articulos_prestados','historial_chat',
    'integraciones_calendar','inventario_lenceria','inventario_prestables','log_amenidades_uso',
    'log_lenceria_uso','mi_tabla','planes','programacion_config','referidos','tipos_de_habitacion'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- Operacion tenant: conserva el CRUD actual, ahora aislado por perfil activo del hotel.
do $$
declare t text;
begin
  foreach t in array array[
    'amenidades_inventario','cambios_habitacion','clientes_descuentos','configuracion_turnos',
    'crm_actividades','historial_articulos_prestados','inventario_lenceria','inventario_prestables',
    'log_amenidades_uso','log_lenceria_uso','tipos_de_habitacion'
  ] loop
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.fase1_actor_es_miembro_activo(hotel_id)) with check (public.fase1_actor_es_miembro_activo(hotel_id))', t || '_tenant_access', t);
  end loop;
end $$;

-- Historial de plan: lectura del propio hotel; escritura solo de backend/webhooks.
revoke all on table public.cambios_plan from authenticated;
grant select on table public.cambios_plan to authenticated;
create policy "cambios_plan_tenant_select" on public.cambios_plan for select to authenticated
  using (public.fase1_actor_es_miembro_activo(hotel_id));

-- Catalogo global inmutable desde clientes.
revoke all on table public.planes from authenticated;
grant select on table public.planes to authenticated;
create policy "planes_catalog_select" on public.planes for select to authenticated using (activo is true);

-- Configuracion de programacion solo administrativa.
grant select, insert, update, delete on table public.programacion_config to authenticated;
create policy "programacion_config_admin_access" on public.programacion_config for all to authenticated
  using (public.usuario_actual_es_admin_hotel(hotel_id))
  with check (public.usuario_actual_es_admin_hotel(hotel_id));

-- Referidos: cada usuario ve los que le pertenecen; las altas pasan por Edge Function.
revoke all on table public.referidos from authenticated;
grant select on table public.referidos to authenticated;
create policy "referidos_owner_select" on public.referidos for select to authenticated
  using (referidor_id = auth.uid());

-- Tablas exclusivamente de servidor o legado sin consumidor activo.
revoke all on table public.integraciones_calendar, public.historial_chat, public.mi_tabla from authenticated;

comment on table public.historial_chat is 'D server_only: sin acceso directo anon/authenticated';
comment on table public.integraciones_calendar is 'D server_only: gestionada por Edge Functions de calendario';
comment on table public.mi_tabla is 'E legacy_unknown: cerrada hasta demostrar consumidor y contrato';
