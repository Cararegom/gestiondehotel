# Release gate de seguridad previo a producción

Fecha: 2026-08-27. Rama: `security/pre-fase14-hotfix`. Base: `a6727b0e384bfe6b1c9e2821d455563ad8a4020e`.

## Decisión

**RELEASE GATE PRE-PRODUCCIÓN: BLOQUEADO.**

El hotfix aprobado inicialmente conserva `Security Advisor ERROR = 0` en staging, pero una revisión manual adicional encontró RPC legacy `SECURITY DEFINER` ejecutables por `authenticated` sin autorización de actor ni aislamiento tenant. Una prueba transaccional con rollback confirmó que una identidad del Hotel A podía modificar una compra y el stock del Hotel B y crear una habitación en el Hotel B.

No se modificó Supabase producción, `main`, Vercel producción ni la lógica financiera. Fase 14/24 no se inició.

## Migraciones versionadas

Estas son las nueve migraciones aplicadas a staging. No fueron regeneradas ni modificadas después del checkpoint:

| Migración | Bytes | SHA-256 local |
| --- | ---: | --- |
| `20260827065614_pre_fase14_critical_rls_hardening.sql` | 11829 | `647a494872eb78b00f9fe6c3654ae9219f54ede805e36abffd7a62ce74c97142` |
| `20260827065753_pre_fase14_remaining_rls_hardening.sql` | 3231 | `68dc631cf3c64d16debdaab17629d66bcf72522ebaa78703b4b08bbf2ebeb070` |
| `20260827065954_pre_fase14_revoke_anon_table_access.sql` | 438 | `3d85998993272423550a93a17ab2c368c48339b13d62cfd8439d36201ca3b442` |
| `20260827070445_pre_fase14_revoke_anon_function_access.sql` | 383 | `d7145f31aa81fb5d38ce6c82ef86923b85229bdbc2bff335d31934a67e3ff5be` |
| `20260827070530_pre_fase14_close_public_function_defaults.sql` | 708 | `e95a36ab1b68f331cd232682ef9267039c0b8adf4bdbc9e211ae0291d950d5f8` |
| `20260827070843_pre_fase14_tenant_policy_cleanup.sql` | 3244 | `0c8271826a1a2f8c50784552b4fe38e6659870ddf5c03abeb2edc350be8e9e8f` |
| `20260827070954_pre_fase14_fix_authz_rls_recursion.sql` | 574 | `bfccea1bfe36895bacb07bd2acd9af4d2770f49ed0a09d61ca9a87842687d80b` |
| `20260827071044_pre_fase14_fix_onboarding_config.sql` | 344 | `278655b1633677792799483dec6faaff94d72d03c59a010e7b28dc22009d4e3f` |
| `20260827071537_pre_fase14_fix_metadata_helpers.sql` | 720 | `8cb22540269c4d389a1291e79c707e39ac41afb60fc52a32d63f72bdf643ea50` |

Supabase conserva nombre y versión de migración, no el archivo SQL original ni su hash. La equivalencia byte a byte no puede reconstruirse independientemente desde la base. La procedencia de despliegue y la verificación semántica sí coinciden: las nueve entradas existen en staging y ninguna existe en producción; staging tiene 107 tablas públicas, 0 con RLS desactivado, 0 con acceso CRUD directo de `anon`, las 45 policies esperadas, helpers autoritativos basados en `usuarios`, trigger de protección de autoridad y cierre del RPC legacy de creación de usuarios.

## Funciones anónimas intencionales

Staging conserva exactamente tres funciones `SECURITY DEFINER` ejecutables por `anon`.

| Función | Justificación y datos | Validación/tenant | Riesgo y decisión |
| --- | --- | --- | --- |
| `obtener_catalogo_tienda_web(uuid)` | Alimenta la tienda pública. Devuelve marca básica del hotel, WhatsApp y productos activos con precio, existencia e imagen. | UUID tipado; exige hotel activo, respeta `tienda_web_activa` y filtra productos por `hotel_id`. | Permite scraping de un catálogo intencionalmente público. Conviene rate limiting. Se mantiene pública. |
| `obtener_menu_terraza_publico(uuid)` | Alimenta la carta pública. Devuelve marca/dirección básica, precio de michelada y productos activos. | UUID tipado; exige hotel activo y filtra configuración/productos por `hotel_id`. | Permite scraping de información comercial pública. Conviene rate limiting. Se mantiene pública. |
| `crear_pedido_web_tienda(uuid,text,text,text,text,jsonb)` | Crea pedido, items y notificación; devuelve código, total y mensaje/WhatsApp. | Hotel activo, tienda habilitada, 1-30 items, cantidades 1-99, producto activo del mismo hotel, stock y precio recalculados en servidor. | Puede recibir spam: faltan rate limiting, idempotencia, CAPTCHA y límites explícitos para habitación/nombre/teléfono/observaciones. Debe migrarse a Edge Function o incorporar controles antiabuso antes de expansión. Se mantiene por compatibilidad pública. |

Las tres fijan `search_path=public`. Es estable pero menos estricto que `pg_catalog, public`; deben endurecerse en una migración posterior sin editar las nueve ya aplicadas. No devuelven clientes, reservas ni datos financieros privados.

## Inventario `SECURITY DEFINER` para authenticated

Total en staging: **132 firmas**.

### INTENCIONAL CLIENT-CALLABLE — 52

`abrir_turno_con_apertura`, `activar_reserva_terraza`, `actualizar_compra_y_detalles`, `actualizar_estado_pedido_web_tienda`, `aprobar_salida_inventario_tienda`, `asignar_metodo_cuenta`, `cambiar_estado_periodo_financiero`, `cambiar_habitacion_transaccion` (2 overloads), `cancelar_reserva_con_reversion`, `cerrar_turno_con_arqueo`, `crear_cuenta_financiera`, `crear_pedido_web_tienda`, `crear_reserva_terraza`, `crear_transferencia_cuenta`, `energy_cancel`, `energy_confirm`, `energy_regenerate_qr`, `energy_scan`, `establecer_costo_inicial_inventario`, `exportar_hotel_snapshot`, `gestionar_ingrediente_restaurante`, `guardar_presupuesto_financiero`, `guardar_receta_plato_atomica`, `liquidar_consumos_reserva_atomico`, `marcar_todas_mis_notificaciones_leidas`, `obtener_catalogo_tienda_web`, `obtener_estado_resultados_shadow`, `obtener_menu_terraza_publico`, `pagar_gasto`, `procesar_pago_reserva_atomico`, `procesar_venta_restaurante_atomica`, `procesar_venta_tienda_atomica`, `reabrir_pedido_terraza`, `rechazar_salida_inventario_tienda`, `recibir_compra_tienda_atomica`, `registrar_evento_sistema`, `registrar_movimiento_caja_atomico`, `reprocesar_cmv_restaurante`, `resumen_cuentas_financieras`, `revertir_movimiento_caja`, `saas_dashboard_snapshot`, `saas_listar_hoteles`, `saas_listar_integraciones_interes`, `saas_otorgar_dias_gracia`, `saas_recent_landing_leads`, `saas_resumen_grupos_hoteleros`, `saas_usage_by_hotel`, `solicitar_integracion_hotel`, `solicitar_salida_inventario_tienda`, `transferir_terraza_a_tienda`, `transferir_tienda_a_terraza`.

La etiqueta significa que existe un consumidor frontend, no que la función sea segura. `actualizar_compra_y_detalles` y el overload legacy de `cambiar_habitacion_transaccion` requieren cierre o reemplazo antes de producción.

### INTERNAL / DEBERÍA CERRARSE — 23

Funciones de trigger que no necesitan ejecución directa desde el navegador: `bank_email_after_payment_insert`, `bank_email_assert_pilot_row`, `bank_email_cancel_pending_on_reservation_payment`, `bank_email_guard_notification_update`, `bank_email_handle_reservation_update`, `bank_email_mark_deleted_relation`, `bank_email_validate_audit_log`, `bank_email_validate_expected_payment`, `bank_email_validate_integration_link`, `bank_email_validate_match_reciprocity`, `bank_email_validate_payment_event`, `create_energy_check_on_cleaning`, `fase2_project_caja_to_account`, `fase4_inventory_adjustment_cost`, `fase4_restaurant_sale_cogs`, `fase4_seed_new_inventory_item`, `fase4_store_purchase_cost`, `fase4_store_sale_cogs`, `fase4_sync_store_reference_cost`, `fase4_terrace_sale_cogs`, `fase4_transfer_cost`, `pre_fase14_protect_user_authority`, `recalcular_total_pedido_terraza`.

Se debe revocar `EXECUTE` a `authenticated` mediante una migración nueva. Los triggers continuarán ejecutándolas como parte de PostgreSQL.

### REVISAR POSTERIORMENTE — 57

`actor_is_saas_superadmin`, `actualizar_ultimo_inicio_sesion`, `ajustar_stock_tienda_seguro`, `aprobar_gasto`, `bank_email_notification_is_visible`, `bank_email_notify_payment_event`, `bank_email_sale_belongs_to_hotel`, `bank_email_sale_is_payable`, `bank_email_user_has_pilot_access`, `bank_email_write_audit`, `cancelar_gasto`, `cerrar_pedido_terraza`, `cerrar_pedido_terraza_mixto`, `cerrar_turno_con_balance`, `claim_bank_email_pubsub_inbox`, `crear_gasto`, `crear_habitacion_con_tiempos`, `create_expected_bank_payment`, `crypto_aead_det_decrypt`, `crypto_aead_det_encrypt`, `decrementar_stock_producto`, `derive_key`, `encrypt_oauth_token`, `encrypt_text`, `energy_actor_allowed`, `extender_tiempo_cronometro`, `fase1_actor_es_miembro_activo`, `fase1_actor_tiene_permiso`, `fase1_integrity_snapshot`, `fase2_ensure_method_account`, `fase4_cost_in`, `fase4_cost_out`, `get_current_hotel_id`, `get_current_user_hotel_id_from_profile`, `get_current_user_rol_from_profile`, `get_my_current_hotel_id`, `get_my_current_rol`, `get_my_hotel_id`, `get_my_role`, `handle_new_user`, `is_hotel_admin`, `match_bank_payment_event`, `pgsodium_crypto_aead_det_decrypt`, `pgsodium_crypto_aead_det_encrypt`, `pre_fase14_can_bootstrap_admin_role`, `pre_fase14_can_bootstrap_profile`, `procesar_venta_tienda_simple_y_caja`, `registrar_reserva_completa`, `replace_bank_payment_allocations`, `resolve_bank_email_pilot_hotel`, `review_bank_payment_event`, `rls_audit_summary`, `sync_user_metadata_from_profile`, `usuario_actual_es_admin_hotel`, `usuario_actual_es_admin_terraza`, `usuario_actual_tiene_rol_transferencia`, `usuario_tiene_turno_abierto_transferencia`.

Prioridad máxima: `crear_habitacion_con_tiempos`, `decrementar_stock_producto`, `extender_tiempo_cronometro`, `procesar_venta_tienda_simple_y_caja`, `registrar_reserva_completa`, helpers criptográficos/OAuth y cualquier RPC financiera o administrativa sin `auth.uid()`, rol y tenant autoritativos. Quince firmas carecen de `SET search_path` fijo.

La causa inmediata es `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated` en la quinta migración. Antes de producción debe sustituirse, mediante migración adicional, por revocación general más allowlist explícita de RPC revisadas.

## Prueba negativa que bloquea el release

Ejecutada en staging dentro de `BEGIN ... ROLLBACK`, con dos hoteles y datos sintéticos:

| Actor Hotel A contra Hotel B | Resultado |
| --- | --- |
| `actualizar_compra_y_detalles` | Modificó cantidad y precio: **vulnerable** |
| `decrementar_stock_producto` | Redujo stock: **vulnerable** |
| `crear_habitacion_con_tiempos` | Creó habitación: **vulnerable** |

El rollback eliminó todos los fixtures. No se tocaron filas reales ni datos financieros.

## Matriz de compatibilidad

| Configuración | Resultado | Evidencia |
| --- | --- | --- |
| A. Frontend viejo `a6727b0` + DB vieja | **PASS funcional / FAIL seguridad legacy** | Es el baseline productivo actual. |
| B. Frontend nuevo + Edge hardened + DB vieja | **PASS funcional condicionado** | Los cambios de Auth/log/ChatKit/CSP son compatibles. `registrar-pre-referido` debe desplegarse junto al frontend porque cambió el contrato. La DB vieja sigue insegura durante este intervalo. |
| C. Frontend viejo + DB hardened | **FAIL** | El frontend viejo inserta directamente en `referidos`; la DB hardened lo bloquea. Además no contiene los cambios de Auth/logging. No hacer DB-first. |
| D. Frontend nuevo + DB hardened | **PASS funcional / FAIL gate de seguridad** | Suite y módulos pasan, pero las RPC legacy permiten mutaciones cross-tenant demostradas. |

## Orden recomendado cuando se cierre el bloqueo

1. Crear una décima migración nueva; no editar las nueve existentes.
2. En staging, revocar `authenticated` de todas las funciones y conceder solo una allowlist revisada; cerrar triggers/helpers directos y reparar o retirar RPC legacy vulnerables.
3. Repetir pruebas cross-tenant, módulos, Advisors, secret scan y Fase 13.
4. Versionar la corrección en esta rama y aprobar nuevamente el gate.
5. Desplegar frontend y `registrar-pre-referido` hardened primero; smoke test de login/onboarding/operación.
6. Aplicar DB por los grupos descritos abajo, con smoke test después de cada grupo.
7. Ejecutar Fase 13 y verificación multi-hotel final. Solo entonces promover/mergear según autorización.

## Rollback por grupo

| Grupo | Migraciones | Cambio/módulos | Rollback seguro | Riesgo de datos |
| --- | --- | --- | --- | --- |
| Identidad/RBAC/finanzas | 1 | RLS/grants/policies de clientes, ventas, pagos, usuarios, roles, turnos, Caja y reservas | Migración compensatoria que restaure el snapshot de policies/ACL previo; revertir frontend si depende del contrato nuevo. | DDL; sin pérdida. Reabrir ACL legacy restaura vulnerabilidades. |
| Legacy restante | 2 | Planes, cambios de plan, programación, referidos y tablas server-only | Restaurar grants/policies exactas desde snapshot. Para referidos, volver al frontend anterior solo junto con su grant anterior. | DDL; sin pérdida. |
| Tablas anon | 3 | Revoca acceso anon a tablas/secuencias | Restaurar únicamente grants públicos demostrados, nunca `GRANT ALL`. | DDL; sin pérdida; reexposición de datos si se revierte ampliamente. |
| Funciones anon/auth | 4-5 | Revoca defaults y crea allowlist anon; concede funciones a authenticated | Restaurar ACL por firma desde snapshot. No revertir con `GRANT ALL`; la concesión amplia es el bloqueo actual. | DDL; sin pérdida. |
| Policies tenant | 6 | Categorías, compras, configuración, hoteles y notificaciones | Restaurar policies previas en orden y comprobar onboarding. | DDL; sin pérdida; riesgo de aislamiento si se restaura metadata editable. |
| Recursión authz | 7 | Helper superadmin con `search_path` fijo | Revertir solo junto con policies dependientes; no restaurar la variante recursiva de forma aislada. | Sin pérdida; riesgo de bloqueo operativo. |
| Onboarding | 8 | Excepción estrecha para configuración inicial | Restaurar policy previa únicamente si también se revierte el flujo de onboarding. | Sin pérdida; riesgo de impedir altas. |
| Helpers autoritativos | 9 | Hotel/rol desde `usuarios`, no metadata JWT editable | Revertir solo como rollback completo; no volver a confiar en `user_metadata` en operación normal. | Sin pérdida; riesgo de escalación si se revierte. |

No se usarán `UPDATE`/`DELETE` financieros como rollback. Frontend y Edge pueden volver a su deployment anterior; DB requiere migraciones compensatorias auditadas, no modificación de archivos ya aplicados.

## Controles complementarios

- Secret scan: 0 secretos reales versionados; no hay JWT `service_role`, private keys ni contraseña DB. Las referencias de secretos son variables de entorno.
- Fase 13 en staging: `sin_ledger=0`, `divergentes=0`.
- Security Advisor staging: **0 ERROR**, con WARN/INFO todavía presentes; no se describe como “completamente limpio”.
- `contentscript.js`: externo al repositorio; prueba incógnito pendiente y no bloqueante para DB.
- Producción: no contiene ninguna de las nueve migraciones.
- Vercel producción: `app/index.html`, `js/main.js` y `js/authService.js` coinciden con `origin/main` en el momento del gate.
- Fase 14/24: **NO INICIADA**.
