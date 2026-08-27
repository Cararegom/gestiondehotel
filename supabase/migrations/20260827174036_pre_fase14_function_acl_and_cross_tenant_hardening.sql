-- Pre-Fase 14: close the implicit function API and repair the RPCs that were
-- proven capable of crossing hotel boundaries in staging.
--
-- Application migrations are owned by postgres in this project. The only
-- public functions owned by supabase_admin belong to the platform-managed
-- citext extension; they are not SECURITY DEFINER application routines.

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

create or replace function public.actualizar_compra_y_detalles(
  p_compra_id uuid,
  detalles_a_actualizar jsonb,
  ids_a_eliminar uuid[]
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_hotel_id uuid;
  v_nuevo_total_compra numeric;
  v_updates jsonb := coalesce(detalles_a_actualizar, '[]'::jsonb);
  v_delete_ids uuid[] := coalesce(ids_a_eliminar, '{}'::uuid[]);
begin
  if v_actor_id is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  select u.hotel_id
    into v_hotel_id
    from public.usuarios u
   where u.id = v_actor_id
     and u.activo is true
     and u.hotel_id is not null
   limit 1;

  if v_hotel_id is null then
    raise exception 'Usuario sin hotel activo' using errcode = '42501';
  end if;

  if not public.fase1_actor_tiene_permiso(v_hotel_id, 'tienda.operar') then
    raise exception 'No tienes permiso para editar compras de tienda' using errcode = '42501';
  end if;

  perform 1
    from public.compras_tienda c
   where c.id = p_compra_id
     and c.hotel_id = v_hotel_id
   for update;

  if not found then
    raise exception 'Compra no encontrada para el hotel autorizado' using errcode = '42501';
  end if;

  if jsonb_typeof(v_updates) <> 'array' then
    raise exception 'detalles_a_actualizar debe ser un arreglo JSON' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_updates) as rec(id uuid, cantidad numeric, precio_unitario numeric)
     where rec.id is null
        or rec.cantidad is null
        or rec.cantidad <= 0
        or rec.cantidad <> trunc(rec.cantidad)
        or rec.precio_unitario is null
        or rec.precio_unitario < 0
  ) then
    raise exception 'Detalle de compra invalido' using errcode = '22023';
  end if;

  if (
    select count(*) <> count(distinct rec.id)
      from jsonb_to_recordset(v_updates) as rec(id uuid)
  ) then
    raise exception 'No se permiten detalles repetidos' using errcode = '22023';
  end if;

  if exists (
    select 1
      from jsonb_to_recordset(v_updates) as rec(id uuid)
     where not exists (
       select 1
         from public.detalle_compras_tienda d
        where d.id = rec.id
          and d.compra_id = p_compra_id
          and d.hotel_id = v_hotel_id
     )
  ) then
    raise exception 'Un detalle no pertenece a la compra autorizada' using errcode = '42501';
  end if;

  if exists (
    select 1
      from unnest(v_delete_ids) as requested(id)
     where not exists (
       select 1
         from public.detalle_compras_tienda d
        where d.id = requested.id
          and d.compra_id = p_compra_id
          and d.hotel_id = v_hotel_id
     )
  ) then
    raise exception 'Un detalle a eliminar no pertenece a la compra autorizada' using errcode = '42501';
  end if;

  update public.detalle_compras_tienda d
     set cantidad = rec.cantidad,
         precio_unitario = rec.precio_unitario,
         subtotal = rec.cantidad * rec.precio_unitario
    from jsonb_to_recordset(v_updates) as rec(id uuid, cantidad numeric, precio_unitario numeric)
   where d.id = rec.id
     and d.compra_id = p_compra_id
     and d.hotel_id = v_hotel_id;

  if cardinality(v_delete_ids) > 0 then
    delete from public.detalle_compras_tienda d
     where d.id = any(v_delete_ids)
       and d.compra_id = p_compra_id
       and d.hotel_id = v_hotel_id;
  end if;

  select coalesce(sum(d.subtotal), 0)
    into v_nuevo_total_compra
    from public.detalle_compras_tienda d
   where d.compra_id = p_compra_id
     and d.hotel_id = v_hotel_id;

  update public.compras_tienda c
     set total_compra = round(v_nuevo_total_compra / 50) * 50
   where c.id = p_compra_id
     and c.hotel_id = v_hotel_id;
end;
$function$;

create or replace function public.cambiar_habitacion_transaccion(
  p_estado_destino public.estado_habitacion_enum,
  p_habitacion_destino_id uuid,
  p_habitacion_origen_id uuid,
  p_hotel_id uuid,
  p_motivo_cambio text,
  p_reserva_id uuid,
  p_usuario_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor public.usuarios%rowtype;
  v_reserva public.reservas%rowtype;
  v_origen public.habitaciones%rowtype;
  v_destino public.habitaciones%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Usuario no autenticado' using errcode = '42501';
  end if;

  select *
    into v_actor
    from public.usuarios u
   where u.id = auth.uid()
     and u.activo is true
     and u.hotel_id is not null
   limit 1;

  if not found then
    raise exception 'Usuario sin hotel activo' using errcode = '42501';
  end if;

  if p_usuario_id is distinct from v_actor.id then
    raise exception 'La identidad enviada no corresponde al usuario autenticado' using errcode = '42501';
  end if;

  if p_hotel_id is distinct from v_actor.hotel_id
     or not public.fase1_actor_es_miembro_activo(v_actor.hotel_id) then
    raise exception 'No puedes operar habitaciones de otro hotel' using errcode = '42501';
  end if;

  if p_habitacion_origen_id = p_habitacion_destino_id then
    raise exception 'La habitacion de destino debe ser diferente' using errcode = '22023';
  end if;

  select *
    into v_reserva
    from public.reservas r
   where r.id = p_reserva_id
     and r.hotel_id = v_actor.hotel_id
     and r.habitacion_id = p_habitacion_origen_id
   for update;
  if not found then
    raise exception 'Reserva no encontrada para el hotel y habitacion de origen' using errcode = '42501';
  end if;

  select *
    into v_origen
    from public.habitaciones h
   where h.id = p_habitacion_origen_id
     and h.hotel_id = v_actor.hotel_id
   for update;
  if not found then
    raise exception 'Habitacion de origen no autorizada' using errcode = '42501';
  end if;

  select *
    into v_destino
    from public.habitaciones h
   where h.id = p_habitacion_destino_id
     and h.hotel_id = v_actor.hotel_id
   for update;
  if not found then
    raise exception 'Habitacion de destino no autorizada' using errcode = '42501';
  end if;

  if v_destino.estado <> 'libre'::public.estado_habitacion_enum then
    raise exception 'La habitacion de destino no esta libre' using errcode = '23514';
  end if;

  update public.reservas
     set habitacion_id = p_habitacion_destino_id,
         actualizado_en = now()
   where id = p_reserva_id
     and hotel_id = v_actor.hotel_id;

  update public.cronometros
     set habitacion_id = p_habitacion_destino_id,
         actualizado_en = now()
   where reserva_id = p_reserva_id
     and habitacion_id = p_habitacion_origen_id
     and hotel_id = v_actor.hotel_id;

  update public.habitaciones
     set estado = 'limpieza'::public.estado_habitacion_enum,
         actualizado_en = now()
   where id = p_habitacion_origen_id
     and hotel_id = v_actor.hotel_id;

  update public.habitaciones
     set estado = p_estado_destino,
         actualizado_en = now()
   where id = p_habitacion_destino_id
     and hotel_id = v_actor.hotel_id;

  insert into public.cambios_habitacion(
    hotel_id, reserva_id, habitacion_origen_id, habitacion_destino_id, motivo, usuario_id
  ) values (
    v_actor.hotel_id, p_reserva_id, p_habitacion_origen_id, p_habitacion_destino_id,
    p_motivo_cambio, v_actor.id
  );

  insert into public.bitacora(hotel_id, usuario_id, modulo, accion, detalles)
  values (
    v_actor.hotel_id,
    v_actor.id,
    'reservas',
    'cambio_habitacion',
    jsonb_build_object(
      'reserva_id', p_reserva_id,
      'habitacion_origen_id', p_habitacion_origen_id,
      'habitacion_destino_id', p_habitacion_destino_id,
      'motivo', p_motivo_cambio
    )
  );
end;
$function$;

-- The browser no longer has a consumer for this unsafe legacy overload.
drop function if exists public.cambiar_habitacion_transaccion(
  uuid, uuid, uuid, text, uuid, uuid, public.estado_habitacion_enum
);

-- Close every application-owned function before rebuilding the browser API.
-- Trigger execution is unaffected; PostgreSQL invokes trigger functions through
-- their trigger bindings, not through the caller's direct EXECUTE privilege.
do $acl$
declare
  v_function record;
begin
  for v_function in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_userbyid(p.proowner) = 'postgres'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function.signature);
    -- service_role is the explicit server-only trust boundary for application
    -- routines. It is never shipped to the browser.
    execute format('grant execute on function %s to service_role', v_function.signature);
  end loop;
end;
$acl$;

-- Authenticated browser allowlist: literal RPC consumers plus the exact helpers
-- required by RLS, defaults and the financial reporting view.
grant execute on function public.abrir_turno_con_apertura(uuid,uuid,numeric,timestamp with time zone) to authenticated;
grant execute on function public.activar_reserva_terraza(uuid,uuid) to authenticated;
grant execute on function public.actualizar_amenidades_settings(public.amenidad_update[]) to authenticated;
grant execute on function public.actualizar_compra_y_detalles(uuid,jsonb,uuid[]) to authenticated;
grant execute on function public.actualizar_estado_pedido_web_tienda(uuid,uuid,text,text) to authenticated;
grant execute on function public.actualizar_metodo_pago_caja(uuid,uuid,text) to authenticated;
grant execute on function public.ajustar_stock_ingrediente(uuid,numeric,text,uuid,text) to authenticated;
grant execute on function public.anadir_stock_prestable(uuid,integer) to authenticated;
grant execute on function public.aprobar_gasto(uuid) to authenticated;
grant execute on function public.aprobar_salida_inventario_tienda(uuid,uuid) to authenticated;
grant execute on function public.asignar_metodo_cuenta(uuid,uuid) to authenticated;
grant execute on function public.cambiar_estado_periodo_financiero(date,text) to authenticated;
grant execute on function public.cambiar_habitacion_transaccion(public.estado_habitacion_enum,uuid,uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.cancelar_gasto(uuid,text) to authenticated;
grant execute on function public.cancelar_reserva_con_reversion(uuid,text,uuid) to authenticated;
grant execute on function public.cerrar_pedido_terraza(uuid,uuid,uuid,uuid,numeric,numeric) to authenticated;
grant execute on function public.cerrar_pedido_terraza_mixto(uuid,uuid,uuid,jsonb,numeric,numeric) to authenticated;
grant execute on function public.cerrar_turno_con_arqueo(uuid,jsonb,uuid,timestamp with time zone,uuid) to authenticated;
grant execute on function public.crear_cuenta_financiera(text,text,text,numeric) to authenticated;
grant execute on function public.crear_gasto(uuid,uuid,text,date,date,numeric,numeric,uuid,text,text,uuid) to authenticated;
grant execute on function public.crear_reserva_terraza(uuid,uuid,integer,text,text,timestamp with time zone,integer,numeric,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.crear_transferencia_cuenta(uuid,uuid,numeric,text,uuid,timestamp with time zone) to authenticated;
grant execute on function public.energy_cancel(uuid,text) to authenticated;
grant execute on function public.energy_confirm(uuid) to authenticated;
grant execute on function public.energy_regenerate_qr(uuid) to authenticated;
grant execute on function public.energy_scan(uuid) to authenticated;
grant execute on function public.establecer_costo_inicial_inventario(text,uuid,numeric) to authenticated;
grant execute on function public.exportar_hotel_snapshot(uuid) to authenticated;
grant execute on function public.gestionar_ingrediente_restaurante(uuid,text,text,numeric,numeric,numeric) to authenticated;
grant execute on function public.get_dashboard_metrics(uuid) to authenticated;
grant execute on function public.guardar_presupuesto_financiero(date,numeric,numeric,numeric) to authenticated;
grant execute on function public.guardar_receta_plato_atomica(uuid,jsonb) to authenticated;
grant execute on function public.incrementar_uso_descuento(uuid) to authenticated;
grant execute on function public.liquidar_consumos_reserva_atomico(uuid,uuid) to authenticated;
grant execute on function public.marcar_todas_mis_notificaciones_leidas() to authenticated;
grant execute on function public.mover_lenceria_a_lavanderia(uuid,integer) to authenticated;
grant execute on function public.obtener_estado_resultados_shadow(date,date) to authenticated;
grant execute on function public.pagar_gasto(uuid,uuid,uuid,uuid,numeric,uuid,timestamp with time zone) to authenticated;
grant execute on function public.prestar_articulo(uuid) to authenticated;
grant execute on function public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamp with time zone,text) to authenticated;
grant execute on function public.procesar_venta_restaurante_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone) to authenticated;
grant execute on function public.procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone) to authenticated;
grant execute on function public.reabrir_pedido_terraza(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.rechazar_salida_inventario_tienda(uuid,uuid,text) to authenticated;
grant execute on function public.recibir_articulo_devuelto(uuid) to authenticated;
grant execute on function public.recibir_compra_tienda_atomica(uuid,jsonb,uuid,uuid,timestamp with time zone) to authenticated;
grant execute on function public.recibir_lote_de_lavanderia(uuid,integer) to authenticated;
grant execute on function public.registrar_evento_sistema(uuid,uuid,text,text,text,text,text,text,text,jsonb) to authenticated;
grant execute on function public.registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamp with time zone) to authenticated;
grant execute on function public.reportar_perdida_lenceria(uuid,integer) to authenticated;
grant execute on function public.reprocesar_cmv_restaurante(uuid) to authenticated;
grant execute on function public.restar_stock_amenidad(uuid,integer) to authenticated;
grant execute on function public.resumen_cuentas_financieras() to authenticated;
grant execute on function public.revertir_movimiento_caja(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.saas_dashboard_snapshot() to authenticated;
grant execute on function public.saas_listar_hoteles() to authenticated;
grant execute on function public.saas_listar_integraciones_interes(integer) to authenticated;
grant execute on function public.saas_otorgar_dias_gracia(uuid,integer,text) to authenticated;
grant execute on function public.saas_recent_landing_leads(integer) to authenticated;
grant execute on function public.saas_resumen_grupos_hoteleros() to authenticated;
grant execute on function public.saas_usage_by_hotel() to authenticated;
grant execute on function public.solicitar_integracion_hotel(text,text,text,text) to authenticated;
grant execute on function public.solicitar_salida_inventario_tienda(uuid,integer,text,uuid) to authenticated;
grant execute on function public.transferir_terraza_a_tienda(uuid,integer,uuid) to authenticated;
grant execute on function public.transferir_tienda_a_terraza(uuid,integer,uuid) to authenticated;
grant execute on function public.validar_cruce_reserva(uuid,timestamp with time zone,timestamp with time zone,uuid) to authenticated;

-- RLS/default/view dependencies. These are callable but expose no arbitrary
-- mutation surface; the policies need EXECUTE under the authenticated role.
grant execute on function public.actor_is_saas_superadmin() to authenticated;
grant execute on function public.bank_email_user_has_pilot_access(uuid) to authenticated;
grant execute on function public.fase1_actor_es_miembro_activo(uuid) to authenticated;
grant execute on function public.fase1_actor_tiene_permiso(uuid,text) to authenticated;
grant execute on function public.get_current_user_hotel_id_from_profile() to authenticated;
grant execute on function public.get_current_user_hotel_id() to authenticated;
grant execute on function public.get_current_user_rol_from_profile() to authenticated;
grant execute on function public.get_current_user_rol() to authenticated;
grant execute on function public.get_my_claim(text) to authenticated;
grant execute on function public.get_my_hotel_id() to authenticated;
grant execute on function public.pre_fase14_can_bootstrap_admin_role(uuid,uuid,uuid) to authenticated;
grant execute on function public.pre_fase14_can_bootstrap_profile(uuid,uuid,text) to authenticated;
grant execute on function public.role() to authenticated;
grant execute on function public.uid() to authenticated;
grant execute on function public.usuario_actual_es_admin_hotel(uuid) to authenticated;
grant execute on function public.fase1_business_date(timestamp with time zone) to authenticated;
grant execute on function public.uuid_generate_v4() to authenticated;

-- The only intentional anonymous RPCs. They are also available to an already
-- authenticated browser visiting the public storefront/menu.
alter function public.crear_pedido_web_tienda(uuid,text,text,text,text,jsonb)
  set search_path = pg_catalog, public;
alter function public.obtener_catalogo_tienda_web(uuid)
  set search_path = pg_catalog, public;
alter function public.obtener_menu_terraza_publico(uuid)
  set search_path = pg_catalog, public;

grant execute on function public.crear_pedido_web_tienda(uuid,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.obtener_catalogo_tienda_web(uuid) to anon, authenticated;
grant execute on function public.obtener_menu_terraza_publico(uuid) to anon, authenticated;

-- Explicitly document the legacy surface that remains server-only.
revoke all on function public.decrementar_stock_producto(uuid,integer,uuid) from public, anon, authenticated;
revoke all on function public.crear_habitacion_con_tiempos(text,text,numeric,public.estado_habitacion_enum,text[],uuid,uuid[]) from public, anon, authenticated;
