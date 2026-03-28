# Auditoria RLS y Permisos

Generado: 2026-03-27T23:08:24.475Z

## Resumen

- Tablas analizadas en `public`: 66
- Tablas sin RLS: 37
- Tablas con RLS pero sin politicas: 0
- Funciones `SECURITY DEFINER`: 32

## Tablas Sin RLS

- amenidades_inventario
- bitacora
- caja_movimientos_eliminados
- cambios_habitacion
- cambios_plan
- clientes
- clientes_descuentos
- configuracion_turnos
- crm_actividades
- historial_articulos_prestados
- historial_chat
- ingredientes
- integraciones_calendar
- inventario_lenceria
- inventario_prestables
- log_amenidades_uso
- log_caja_eliminados
- log_lenceria_uso
- mi_tabla
- pagos
- pagos_cargos
- permisos
- planes
- platos
- platos_recetas
- programacion_config
- referidos
- roles
- roles_permisos
- tiempos_estancia
- tipos_de_habitacion
- turnos_programados
- usuarios_permisos
- usuarios_roles
- ventas
- ventas_restaurante
- ventas_restaurante_items

## Tablas Con RLS Pero Sin Politicas

- Ninguna.

## Cobertura Por Tabla

| Tabla | RLS | Politicas |
| --- | --- | ---: |
| amenidades_inventario | No | 0 |
| bitacora | No | 0 |
| caja | Si | 1 |
| caja_movimientos_eliminados | No | 0 |
| cambios_habitacion | No | 0 |
| cambios_plan | No | 0 |
| categorias_producto | Si | 6 |
| clientes | No | 0 |
| clientes_descuentos | No | 0 |
| compras_tienda | Si | 2 |
| configuracion_hotel | Si | 8 |
| configuracion_turnos | No | 0 |
| crm_actividades | No | 0 |
| cronometros | Si | 2 |
| descuentos | Si | 4 |
| detalle_compras_tienda | Si | 3 |
| detalle_ventas_tienda | Si | 5 |
| eventos_sistema | Si | 2 |
| habitacion_tiempos_permitidos | Si | 1 |
| habitaciones | Si | 2 |
| historial_articulos_prestados | No | 0 |
| historial_chat | No | 0 |
| hoteles | Si | 13 |
| ingredientes | No | 0 |
| integraciones | Si | 1 |
| integraciones_calendar | No | 0 |
| integraciones_hotel | Si | 7 |
| inventario_lenceria | No | 0 |
| inventario_prestables | No | 0 |
| log_amenidades_uso | No | 0 |
| log_caja_eliminados | No | 0 |
| log_lenceria_uso | No | 0 |
| metodos_pago | Si | 1 |
| mi_tabla | No | 0 |
| movimientos_inventario | Si | 2 |
| notificaciones | Si | 6 |
| oauth_tokens | Si | 2 |
| pagos | No | 0 |
| pagos_cargos | No | 0 |
| pagos_reserva | Si | 4 |
| permisos | No | 0 |
| planes | No | 0 |
| platos | No | 0 |
| platos_recetas | No | 0 |
| productos_tienda | Si | 7 |
| programacion_config | No | 0 |
| proveedores | Si | 9 |
| referidos | No | 0 |
| reservas | Si | 1 |
| roles | No | 0 |
| roles_permisos | No | 0 |
| servicios_adicionales | Si | 3 |
| servicios_x_reserva | Si | 2 |
| tareas_mantenimiento | Si | 1 |
| tiempos_estancia | No | 5 |
| tipos_de_habitacion | No | 0 |
| tipos_servicio | Si | 2 |
| turnos | Si | 5 |
| turnos_programados | No | 1 |
| usuarios | Si | 8 |
| usuarios_permisos | No | 0 |
| usuarios_roles | No | 2 |
| ventas | No | 0 |
| ventas_restaurante | No | 0 |
| ventas_restaurante_items | No | 0 |
| ventas_tienda | Si | 6 |

## Funciones SECURITY DEFINER

- abrir_turno_con_apertura(p_hotel_id uuid, p_usuario_id uuid, p_monto_inicial numeric, p_fecha_movimiento timestamp with time zone)
- actualizar_compra_y_detalles(p_compra_id uuid, detalles_a_actualizar jsonb, ids_a_eliminar uuid[])
- actualizar_ultimo_inicio_sesion()
- cambiar_habitacion_transaccion(p_estado_destino estado_habitacion_enum, p_habitacion_destino_id uuid, p_habitacion_origen_id uuid, p_hotel_id uuid, p_motivo_cambio text, p_reserva_id uuid, p_usuario_id uuid)
- cambiar_habitacion_transaccion(p_reserva_id uuid, p_habitacion_origen_id uuid, p_habitacion_destino_id uuid, p_motivo_cambio text, p_usuario_id uuid, p_hotel_id uuid, p_nuevo_estado_destino estado_habitacion_enum)
- cerrar_turno_con_balance(p_turno_id uuid, p_usuario_id uuid, p_balance_final numeric, p_fecha_cierre timestamp with time zone)
- crear_habitacion_con_tiempos(p_nombre text, p_tipo text, p_precio numeric, p_estado estado_habitacion_enum, p_amenidades text[], p_hotel_id uuid, p_tiempos_estancia_ids uuid[])
- crear_usuario_con_perfil_y_roles_basico(p_email text, p_password text, p_nombre text, p_hotel_id uuid, p_roles_ids uuid[], p_activo boolean)
- crypto_aead_det_decrypt(additional_data bytea, ciphertext bytea)
- crypto_aead_det_encrypt(additional_data bytea, plaintext bytea)
- decrementar_stock_producto(id_producto uuid, cantidad_a_restar integer, p_hotel_id uuid)
- derive_key(key_id bigint, key_len integer, context bytea)
- encrypt_oauth_token(plaintext text, additional_data text)
- encrypt_text(plaintext text, key bytea, nonce bytea)
- exportar_hotel_snapshot(p_hotel_id uuid)
- extender_tiempo_cronometro(p_cronometro_id uuid, p_minutos_extra integer)
- get_current_hotel_id()
- get_my_hotel_id()
- get_my_role()
- handle_new_user()
- is_hotel_admin(hotel_id_to_check uuid)
- pgsodium_crypto_aead_det_decrypt(additional_data bytea, ciphertext bytea)
- pgsodium_crypto_aead_det_encrypt(additional_data bytea, plaintext bytea)
- procesar_venta_tienda_simple_y_caja(p_producto_id uuid, p_cantidad_vendida integer, p_precio_unitario_venta numeric, p_metodo_pago_id uuid, p_usuario_id uuid, p_hotel_id uuid)
- registrar_evento_sistema(p_hotel_id uuid, p_usuario_id uuid, p_scope text, p_source text, p_level text, p_event_type text, p_message text, p_route text, p_user_agent text, p_details jsonb)
- registrar_movimiento_caja_atomico(p_hotel_id uuid, p_usuario_id uuid, p_turno_id uuid, p_tipo text, p_monto numeric, p_concepto text, p_metodo_pago_id uuid, p_fecha_movimiento timestamp with time zone)
- registrar_reserva_completa(p_cliente_nombre text, p_habitacion_id uuid, p_tiempo_estancia_id uuid, p_fecha_inicio_str text, p_monto_total_reserva numeric, p_monto_pagado_inicial numeric, p_metodo_pago_id uuid, p_hotel_id uuid, p_usuario_id_registro uuid, p_notas text, p_estado_reserva estado_reserva_enum)
- registrar_y_eliminar_mov_caja(movimiento_id_param uuid, eliminado_por_usuario_id_param uuid)
- rls_audit_summary()
- saas_dashboard_snapshot()
- saas_listar_hoteles()
- sync_user_metadata_from_profile()

## Observaciones

- Este reporte se genera a partir de los snapshots versionados en `supabase/snapshots`.
- Las tablas sin RLS o con RLS sin politicas deben revisarse antes de exponer nuevos flujos sensibles.
- La consola SaaS usa esta misma linea de auditoria para resumir cobertura de seguridad.