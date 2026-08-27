# Release gate de funciones previo a Fase 14/24

Fecha: 2026-08-27. Rama: `security/pre-fase14-hotfix`. Staging: `vyzscuzgjdhrhzctmsuv`.

## Decisión

**RELEASE GATE DE STAGING: APROBADO.**

Esta aprobación cubre únicamente el hotfix de ACL de funciones y aislamiento entre hoteles probado en staging. No autoriza cambios en Supabase producción, `main`, Vercel producción ni el inicio de la Fase 14/24.

## Normalización previa de staging

Staging no contenía ocho definiciones finales necesarias para representar el código actual. Se aplicaron allí, sin escribir en producción: `fase2_endurecer_bank_payment_allocations`, `fase2_indices_bank_payment_allocations`, `grant_authenticated_insert_movimientos_inventario`, `fase5_ventas_bancarias_conciliables`, `fase6_prevenir_doble_conciliacion`, `fase10_sincronizar_metodo_pago_caja_ledger`, `alertas_transferencias_recepcionistas` y `premerge_bank_feature_hardening`.

No se aplicaron los snapshots históricos/sustituidos `20260826000109_permitir_cambio_metodo_pago_caja.sql` y `20260826000318_grant_update_metodo_pago_caja.sql`.

## Migración 10

La migración `20260827174036_pre_fase14_function_acl_and_cross_tenant_hardening.sql` fue creada con Supabase CLI, validada dentro de una transacción con rollback y aplicada solamente a staging con la versión remota `20260827174434`.

Cambios principales:

- Los privilegios por defecto del propietario real de objetos de aplicación (`postgres`) revocan `EXECUTE` a `PUBLIC`, `anon` y `authenticated`, y lo conservan para `service_role`.
- Todas las funciones de aplicación quedaron cerradas por defecto y se reconstruyó una lista explícita de acceso.
- `actualizar_compra_y_detalles` valida identidad, hotel, permiso, compra, detalles y productos dentro del mismo tenant.
- La firma activa de `cambiar_habitacion_transaccion` obtiene actor y hotel desde `auth.uid()`, valida todos los recursos y registra al actor real.
- Se eliminó la sobrecarga legacy insegura de `cambiar_habitacion_transaccion`.
- `decrementar_stock_producto` y `crear_habitacion_con_tiempos` quedaron disponibles solo para servidor.
- Funciones de trigger, banca interna, criptografía y OAuth permanecen cerradas al navegador, salvo las funciones explícitamente enumeradas.

## Inventario ACL posterior

| Control | Resultado |
| --- | ---: |
| Funciones públicas totales | 234 |
| Funciones de aplicación (`postgres`) | 189 |
| Funciones de extensión `citext` (`supabase_admin`) | 45 |
| Funciones de aplicación ejecutables por `PUBLIC` | 0 |
| Funciones de aplicación ejecutables por `anon` | 3 |
| Funciones de aplicación ejecutables por `authenticated` | 86 |
| Funciones de aplicación ejecutables por `service_role` | 189 |
| Funciones de aplicación cerradas a `authenticated` | 103 |
| Triggers ejecutables directamente por `authenticated` | 0 |

ACL por defecto de `postgres` en `public`: `{postgres=X/postgres,service_role=X/postgres}`. El ACL por defecto de `supabase_admin` no pudo ni debió modificarse: esa cuenta posee exclusivamente las 45 funciones administradas por la extensión `citext`.

## Lista permitida para `authenticated`

Funciones usadas directamente por el cliente:

```text
abrir_turno_con_apertura(uuid,uuid,numeric,timestamp with time zone)
activar_reserva_terraza(uuid,uuid)
actualizar_amenidades_settings(amenidad_update[])
actualizar_compra_y_detalles(uuid,jsonb,uuid[])
actualizar_estado_pedido_web_tienda(uuid,uuid,text,text)
actualizar_metodo_pago_caja(uuid,uuid,text)
ajustar_stock_ingrediente(uuid,numeric,text,uuid,text)
anadir_stock_prestable(uuid,integer)
aprobar_gasto(uuid)
aprobar_salida_inventario_tienda(uuid,uuid)
asignar_metodo_cuenta(uuid,uuid)
cambiar_estado_periodo_financiero(date,text)
cambiar_habitacion_transaccion(estado_habitacion_enum,uuid,uuid,uuid,text,uuid,uuid)
cancelar_gasto(uuid,text)
cancelar_reserva_con_reversion(uuid,text,uuid)
cerrar_pedido_terraza(uuid,uuid,uuid,uuid,numeric,numeric)
cerrar_pedido_terraza_mixto(uuid,uuid,uuid,jsonb,numeric,numeric)
cerrar_turno_con_arqueo(uuid,jsonb,uuid,timestamp with time zone,uuid)
crear_cuenta_financiera(text,text,text,numeric)
crear_gasto(uuid,uuid,text,date,date,numeric,numeric,uuid,text,text,uuid)
crear_reserva_terraza(uuid,uuid,integer,text,text,timestamp with time zone,integer,numeric,uuid,uuid,uuid,text)
crear_transferencia_cuenta(uuid,uuid,numeric,text,uuid,timestamp with time zone)
energy_cancel(uuid,text)
energy_confirm(uuid)
energy_regenerate_qr(uuid)
energy_scan(uuid)
establecer_costo_inicial_inventario(text,uuid,numeric)
exportar_hotel_snapshot(uuid)
gestionar_ingrediente_restaurante(uuid,text,text,numeric,numeric,numeric)
get_dashboard_metrics(uuid)
guardar_presupuesto_financiero(date,numeric,numeric,numeric)
guardar_receta_plato_atomica(uuid,jsonb)
incrementar_uso_descuento(uuid)
liquidar_consumos_reserva_atomico(uuid,uuid)
marcar_todas_mis_notificaciones_leidas()
mover_lenceria_a_lavanderia(uuid,integer)
obtener_estado_resultados_shadow(date,date)
pagar_gasto(uuid,uuid,uuid,uuid,numeric,uuid,timestamp with time zone)
prestar_articulo(uuid)
procesar_pago_reserva_atomico(uuid,numeric,uuid,uuid,uuid,timestamp with time zone,text)
procesar_venta_restaurante_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone)
procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamp with time zone)
reabrir_pedido_terraza(uuid,uuid,uuid,text)
rechazar_salida_inventario_tienda(uuid,uuid,text)
recibir_articulo_devuelto(uuid)
recibir_compra_tienda_atomica(uuid,jsonb,uuid,uuid,timestamp with time zone)
recibir_lote_de_lavanderia(uuid,integer)
registrar_evento_sistema(uuid,uuid,text,text,text,text,text,text,text,jsonb)
registrar_movimiento_caja_atomico(uuid,uuid,uuid,text,numeric,text,uuid,timestamp with time zone)
reportar_perdida_lenceria(uuid,integer)
reprocesar_cmv_restaurante(uuid)
restar_stock_amenidad(uuid,integer)
resumen_cuentas_financieras()
revertir_movimiento_caja(uuid,text,uuid,uuid)
saas_dashboard_snapshot()
saas_listar_hoteles()
saas_listar_integraciones_interes(integer)
saas_otorgar_dias_gracia(uuid,integer,text)
saas_recent_landing_leads(integer)
saas_resumen_grupos_hoteleros()
saas_usage_by_hotel()
solicitar_integracion_hotel(text,text,text,text)
solicitar_salida_inventario_tienda(uuid,integer,text,uuid)
transferir_terraza_a_tienda(uuid,integer,uuid)
transferir_tienda_a_terraza(uuid,integer,uuid)
validar_cruce_reserva(uuid,timestamp with time zone,timestamp with time zone,uuid)
```

Tres endpoints públicos intencionales, los únicos ejecutables por `anon`:

```text
crear_pedido_web_tienda(uuid,text,text,text,text,jsonb)
obtener_catalogo_tienda_web(uuid)
obtener_menu_terraza_publico(uuid)
```

Helpers requeridos por RLS:

```text
actor_is_saas_superadmin()
bank_email_user_has_pilot_access(uuid)
fase1_actor_es_miembro_activo(uuid)
fase1_actor_tiene_permiso(uuid,text)
get_current_user_hotel_id_from_profile()
get_current_user_hotel_id()
get_current_user_rol_from_profile()
get_current_user_rol()
get_my_claim(text)
get_my_hotel_id()
pre_fase14_can_bootstrap_admin_role(uuid,uuid,uuid)
pre_fase14_can_bootstrap_profile(uuid,uuid,text)
role()
uid()
usuario_actual_es_admin_hotel(uuid)
```

Dependencias requeridas por vista/default:

```text
fase1_business_date(timestamp with time zone)
uuid_generate_v4()
```

La lista cerrada se define por exclusión: las otras 103 funciones de aplicación, los 34 triggers, las rutas bancarias internas, criptografía/OAuth y las firmas legacy no son ejecutables por clientes autenticados.

## Prueba transaccional multi-tenant

Todos los fixtures se crearon dentro de una transacción y terminaron con `ROLLBACK`.

| Caso | Resultado |
| --- | --- |
| Actualizar compra del mismo hotel | Permitido |
| Actualizar compra de otro hotel | Bloqueado |
| Inyectar detalle de otra compra | Bloqueado |
| Decrementar stock de otro hotel | Bloqueado para cliente |
| Crear habitación en otro hotel | Bloqueado para cliente |
| Cambiar habitación del mismo hotel | Permitido |
| Cambiar habitación de otro hotel | Bloqueado |
| Ejecutar rutas internas con `service_role` | Permitido |
| Integridad del Hotel B al finalizar | Sin cambios |

## Regresión y calidad

- `npm test`: 162 pruebas aprobadas, 0 fallos.
- `npm run check:syntax`: 168 archivos validados.
- `npm run typecheck`: cuatro Edge Functions Deno aprobadas.
- `npm run lint`: 31 archivos Deno sin errores.
- El escaneo del frontend no encontró RPC referenciadas ausentes de la lista compatible.
- La prueba estática nueva valida defaults, lista `anon`, compra, cambio de habitación y cierre de RPC legacy.

## Advisors, finanzas y secretos

Security Advisor: 139 hallazgos, 0 `ERROR`, 128 `WARN`, 11 `INFO`. Los avisos incluyen 67 `SECURITY DEFINER` autenticadas de la lista explícita, 56 `search_path` mutable, 11 tablas RLS sin política, los 3 endpoints públicos intencionales, `citext` en `public` y protección de contraseñas filtradas.

Performance Advisor: 352 hallazgos: 195 claves foráneas sin índice, 71 políticas permisivas múltiples, 68 índices sin uso, 17 `auth_rls_initplan` y una tabla sin llave primaria.

Control Fase 13: 10 movimientos shadow, 0 sin ledger, 0 divergentes, 0 allocations inválidas, 0 Gmail duplicados, 0 métodos o ledger cruzados entre hoteles.

Escaneo de 413 archivos: 0 JWT `service_role`, 0 llaves privadas, 0 URL con contraseña de base de datos y 0 secretos literales de servicio.

## Riesgos residuales

- Los tres endpoints públicos requieren seguimiento de abuso/rate limiting propio del flujo de pedidos web.
- Permanecen 56 advertencias de `search_path`; `anon` y `authenticated` no tienen `CREATE` en `public`, pero conviene reducirlas gradualmente.
- Los defaults de `supabase_admin` corresponden a la extensión administrada `citext`, no a objetos de negocio.
- Esta aprobación es evidencia de staging; la promoción a producción exige autorización expresa y un checkpoint nuevo.

## Rollback y promoción

El rollback debe ser una migración compensatoria, nunca editar o revertir migraciones ya registradas. Ante una función de cliente omitida, se prefiere un forward-fix que conceda solamente su firma. Restaurar ACL amplios o la sobrecarga legacy solo sería una medida de emergencia y reabriría el riesgo demostrado. La migración 10 no modifica datos financieros.

Orden recomendado tras autorización: verificar drift de producción, aplicar primero las migraciones de seguridad previas en su orden, aplicar esta migración 10, repetir ACL/ataques/tests/Advisors/Fase 13 y recién entonces decidir el despliegue web. La Fase 14/24 sigue sin iniciar.
