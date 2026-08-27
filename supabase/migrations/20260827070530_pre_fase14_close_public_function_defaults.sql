-- Close both existing and future application functions before rebuilding the
-- browser allowlist. Extension-owned functions (for example citext) remain
-- under the platform owner's ACL and are deliberately outside this migration.
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;

do $$
declare
  v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and pg_get_userbyid(p.proowner) = 'postgres'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      v_function
    );
    execute format('grant execute on function %s to service_role', v_function);
  end loop;
end;
$$;

-- Explicit authenticated surface available at this point in the package.
-- actualizar_compra_y_detalles and cambiar_habitacion_transaccion remain
-- closed until migration 10 installs their tenant-safe definitions.
do $$
declare
  v_signature text;
  v_function regprocedure;
begin
  foreach v_signature in array array[
    'public.abrir_turno_con_apertura(uuid,uuid,numeric,timestamp with time zone)',
    'public.activar_reserva_terraza(uuid,uuid)',
    'public.actualizar_amenidades_settings(public.amenidad_update[])',
    'public.actualizar_estado_pedido_web_tienda(uuid,uuid,text,text)',
    'public.actualizar_metodo_pago_caja(uuid,uuid,text)',
    'public.ajustar_stock_ingrediente(uuid,numeric,text,uuid,text)',
    'public.anadir_stock_prestable(uuid,integer)',
    'public.aprobar_gasto(uuid)',
    'public.aprobar_salida_inventario_tienda(uuid,uuid)',
    'public.asignar_metodo_cuenta(uuid,uuid)',
    'public.cambiar_estado_periodo_financiero(date,text)',
    'public.cancelar_gasto(uuid,text)',
    'public.cancelar_reserva_con_reversion(uuid,text,uuid)',
    'public.cerrar_pedido_terraza(uuid,uuid,uuid,uuid,numeric,numeric)',
    'public.cerrar_pedido_terraza_mixto(uuid,uuid,uuid,jsonb,numeric,numeric)',
    'public.cerrar_turno_con_arqueo(uuid,jsonb,uuid,timestamp with time zone,uuid)',
    'public.crear_cuenta_financiera(text,text,text,numeric)',
    'public.crear_gasto(uuid,uuid,text,date,date,numeric,numeric,uuid,text,text,uuid)',
    'public.crear_reserva_terraza(uuid,uuid,integer,text,text,timestamp with time zone,integer,numeric,uuid,uuid,uuid,text)',
    'public.crear_transferencia_cuenta(uuid,uuid,numeric,text,uuid,timestamp with time zone)',
    'public.energy_cancel(uuid,text)',
    'public.energy_confirm(uuid)',
    'public.energy_regenerate_qr(uuid)',
    'public.energy_scan(uuid)',
    'public.establecer_costo_inicial_inventario(text,uuid,numeric)',
    'public.exportar_hotel_snapshot(uuid)',
    'public.gestionar_ingrediente_restaurante(uuid,text,text,numeric,numeric,numeric)',
    'public.get_dashboard_metrics(uuid)',
    'public.guardar_presupuesto_financiero(date,numeric,numeric,numeric)',
    'public.guardar_receta_plato_atomica(uuid,jsonb)',
    'public.incrementar_uso_descuento(uuid)',
    'public.liquidar_consumos_reserva_atomico(uuid,uuid)',
    'public.marcar_todas_mis_notificaciones_leidas()',
    'public.mover_lenceria_a_lavanderia(uuid,integer)',
    'public.obtener_estado_resultados_shadow(date,date)',
    'public.pagar_gasto(uuid,uuid,uuid,uuid,numeric,uuid,timestamp with time zone)',
    'public.prestar_articulo(uuid)',
    'public.procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamp with time zone,text)',
    'public.procesar_venta_restaurante_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone)',
    'public.procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone)',
    'public.reabrir_pedido_terraza(uuid,uuid,uuid,text)',
    'public.rechazar_salida_inventario_tienda(uuid,uuid,text)',
    'public.recibir_articulo_devuelto(uuid)',
    'public.recibir_compra_tienda_atomica(uuid,jsonb,uuid,uuid,timestamp with time zone)',
    'public.recibir_lote_de_lavanderia(uuid,integer)',
    'public.registrar_evento_sistema(uuid,uuid,text,text,text,text,text,text,text,jsonb)',
    'public.registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamp with time zone)',
    'public.reportar_perdida_lenceria(uuid,integer)',
    'public.reprocesar_cmv_restaurante(uuid)',
    'public.restar_stock_amenidad(uuid,integer)',
    'public.resumen_cuentas_financieras()',
    'public.revertir_movimiento_caja(uuid,text,uuid,uuid)',
    'public.saas_dashboard_snapshot()',
    'public.saas_listar_hoteles()',
    'public.saas_listar_integraciones_interes(integer)',
    'public.saas_otorgar_dias_gracia(uuid,integer,text)',
    'public.saas_recent_landing_leads(integer)',
    'public.saas_resumen_grupos_hoteleros()',
    'public.saas_usage_by_hotel()',
    'public.solicitar_integracion_hotel(text,text,text,text)',
    'public.solicitar_salida_inventario_tienda(uuid,integer,text,uuid)',
    'public.transferir_terraza_a_tienda(uuid,integer,uuid)',
    'public.transferir_tienda_a_terraza(uuid,integer,uuid)',
    'public.validar_cruce_reserva(uuid,timestamp with time zone,timestamp with time zone,uuid)',
    'public.actor_is_saas_superadmin()',
    'public.bank_email_user_has_pilot_access(uuid)',
    'public.fase1_actor_es_miembro_activo(uuid)',
    'public.fase1_actor_tiene_permiso(uuid,text)',
    'public.get_current_user_hotel_id_from_profile()',
    'public.get_current_user_hotel_id()',
    'public.get_current_user_rol_from_profile()',
    'public.get_current_user_rol()',
    'public.get_my_claim(text)',
    'public.get_my_hotel_id()',
    'public.pre_fase14_can_bootstrap_admin_role(uuid,uuid,uuid)',
    'public.pre_fase14_can_bootstrap_profile(uuid,uuid,text)',
    'public.usuario_actual_es_admin_hotel(uuid)',
    'public.fase1_business_date(timestamp with time zone)'
  ]
  loop
    v_function := to_regprocedure(v_signature);
    if v_function is null then
      raise exception 'Authenticated function allowlist drift: %', v_signature;
    end if;
    execute format('grant execute on function %s to authenticated', v_function);
  end loop;
end;
$$;

-- The only intentional anonymous RPCs. They are safe public catalog/order
-- endpoints and must also remain callable by an authenticated browser.
grant execute on function public.crear_pedido_web_tienda(uuid,text,text,text,text,jsonb)
  to anon, authenticated;
grant execute on function public.obtener_catalogo_tienda_web(uuid)
  to anon, authenticated;
grant execute on function public.obtener_menu_terraza_publico(uuid)
  to anon, authenticated;

-- Keep the legacy user-bootstrap RPC closed even if its ownership changes.
revoke all on function public.crear_usuario_con_perfil_y_roles_basico(text,text,text,uuid,uuid[],boolean)
  from public, anon, authenticated;
