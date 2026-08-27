# Auditoría de seguridad previa a Fase 14/24

> Actualización 2026-08-27: una décima migración cerró los ACL generales de funciones, reforzó las RPC multi-tenant y dejó solo tres endpoints públicos intencionales. El inventario, pruebas y riesgos posteriores están en `pre-fase14-function-acl-release-gate.md`.

Fecha del corte: 2026-08-27. Alcance: frontend, autenticación, CSP, ChatKit y esquema `public` de Supabase. No contiene filas de clientes, correos, teléfonos, referencias bancarias ni tokens.

## Estado del despliegue

- Producción (`iikpqpdoslyduecibaij`): auditada, todavía sin este hotfix por requerirse aprobación expresa del checkpoint de staging.
- Staging (`vyzscuzgjdhrhzctmsuv`): hotfix aplicado y pruebas de ataque ejecutadas.
- Fase 14/24: no iniciada.

## Resultado antes/después

| Entorno | Tablas | RLS desactivado | Tablas con CRUD anon | Errores Security Advisor |
| --- | ---: | ---: | ---: | ---: |
| Producción, antes | 108 | 28 | 28 o más con privilegios anon parciales/amplios | 31 |
| Staging, antes | 107 | 28 | 28 o más con privilegios anon parciales/amplios | 31 equivalentes |
| Staging, después | 107 | 0 | 0 | 0 |

Staging difiere por una tabla: `hotel_features` solo existe en producción. Ya tenía RLS activo y queda clasificada como A.

## Convenciones de la matriz

- A: `tenant_private`.
- B: `global_readonly_catalog`.
- C: `public_intake` únicamente mediante RPC/Edge Function validada.
- D: `server_only`.
- E: `legacy_unknown`, cerrado hasta demostrar un consumidor.
- En staging todas las tablas listadas tienen `RLS=true`, `FORCE=false`, `anon=----` y `service_role=SIUD` (bypass deliberado de backend). `S/I/U/D` significa SELECT/INSERT/UPDATE/DELETE concedido; RLS decide qué filas son visibles.

## Matriz completa por clasificación

Cada nombre de esta sección representa una tabla del inventario. Las políticas nominales críticas aparecen en la sección siguiente; la consulta reproducible del final obtiene el detalle literal de todas las políticas y grants.

| Esquema | Clase | Tablas | Política/grant efectivo en staging |
| --- | --- | --- | --- |
| public | A | `account_movements`, `account_transfers`, `amenidades_inventario`, `auditoria_operaciones`, `bitacora`, `caja`, `caja_movimientos_eliminados`, `caja_reversiones`, `cambios_habitacion`, `cambios_plan`, `categorias_producto`, `clientes`, `clientes_descuentos`, `cogs_entries`, `compras_tienda`, `configuracion_hotel`, `configuracion_turnos`, `cost_centers`, `crm_actividades`, `cronometros`, `descuentos`, `detalle_compras_tienda`, `detalle_ventas_tienda`, `eventos_sistema`, `expense_categories`, `expense_payments`, `expense_settings`, `expenses`, `financial_accounts`, `financial_budgets`, `financial_periods`, `grupo_hoteles`, `grupos_hoteleros`, `habitacion_tiempos_permitidos`, `habitaciones`, `historial_articulos_prestados`, `hoteles`, `ingredientes`, `inspecciones_limpieza`, `integraciones`, `integraciones_hotel`, `integraciones_interes`, `inventario_lenceria`, `inventario_prestables`, `inventory_cost_balances`, `inventory_valuation_movements`, `lista_espera_reservas`, `log_amenidades_uso`, `log_caja_eliminados`, `log_lenceria_uso`, `metodos_pago`, `movimientos_inventario`, `notificaciones`, `pagos`, `pagos_cargos`, `pagos_reserva`, `platos`, `platos_recetas`, `productos_tienda`, `programacion_config`, `proveedores`, `referidos`, `reglas_tarifas`, `reservas`, `room_energy_checks`, `servicios_adicionales`, `servicios_x_reserva`, `solicitudes_salida_inventario_tienda`, `tareas_mantenimiento`, `terraza_configuracion`, `terraza_mesas`, `terraza_pedido_items`, `terraza_pedidos`, `terraza_productos`, `terraza_reservas`, `tiempos_estancia`, `tienda_pedido_web_items`, `tienda_pedidos_web`, `tipos_de_habitacion`, `tipos_servicio`, `turno_arqueos`, `turnos`, `turnos_programados`, `usuarios`, `usuarios_permisos`, `usuarios_roles`, `ventas`, `ventas_restaurante`, `ventas_restaurante_items`, `ventas_tienda`; producción además `hotel_features` | Acceso autenticado aislado por `hotel_id` derivado de `auth.uid() -> usuarios`; operaciones financieras sensibles escriben por RPC y sus tablas base conservan políticas de lectura o administración. |
| public | B | `permisos`, `planes`, `roles`, `roles_permisos` | Solo SELECT autenticado; INSERT/UPDATE/DELETE desde navegador revocados o bloqueados por RLS. |
| public | C | Ninguna tabla expuesta directamente | Únicas RPC anon permitidas: `obtener_catalogo_tienda_web`, `obtener_menu_terraza_publico`, `crear_pedido_web_tienda`. Los referidos usan Edge Function autenticada. |
| public | D | `bank_email_integrations`, `bank_email_oauth_states`, `bank_email_pubsub_inbox`, `bank_payment_allocations`, `bank_payment_audit_log`, `bank_payment_events`, `expected_payments`, `historial_chat`, `integraciones_calendar`, `landing_conversion_events`, `landing_leads`, `oauth_tokens` | Sin acceso directo anon; las tablas bancarias y de secretos no conceden CRUD authenticated. Algunas tablas de telemetría permiten solo SELECT de superadmin mediante RLS. |
| public | E | `mi_tabla` | RLS activo, sin policy y sin privilegios anon/authenticated. |

## Matriz crítica de políticas vigentes en staging

| Tabla | Políticas | authenticated | Motivo |
| --- | --- | --- | --- |
| `clientes` | `clientes_tenant_select/insert/update/delete` | SIUD | Miembro activo del mismo hotel; DELETE administrativo. |
| `ventas` | `ventas_tenant_select` | S | Legacy de lectura; escrituras cerradas al navegador. |
| `pagos` | `pagos_tenant_select` | S efectivo por RLS | Facturación: lectura del hotel, escritura de backend/webhook. |
| `reservas` | `Reservas_hotel` | SIUD | Tenant por perfil autoritativo. |
| `caja` | `Caja_hotel` | S directo; mutaciones por RPC | Tenant por perfil autoritativo. |
| `usuarios` | `usuarios_own_or_tenant_select`, `usuarios_bootstrap_insert`, `usuarios_admin_update/delete` | SIUD sujeto a RLS | Sin lectura pública; trigger impide cambiar rol, hotel o identidad desde cliente. |
| `usuarios_roles` | `usuarios_roles_tenant_select`, `usuarios_roles_admin_insert/delete` | SID | Solo admin del hotel; bootstrap inicial estrecho; nunca asigna superadmin. |
| `usuarios_permisos` | `usuarios_permisos_tenant_select`, `usuarios_permisos_admin_insert/update/delete` | SIUD | Usuario propio o administrador del hotel objetivo. |
| `roles`, `permisos`, `roles_permisos` | `*_catalog_select` | S efectivo | Catálogos globales inmutables para clientes. |
| `turnos_programados` | `turnos_programados_tenant_select`, `*_admin_insert/update/delete` | SIUD | Lectura tenant, gestión admin. |
| `tiempos_estancia` | `tiempos_estancia_tenant_select`, `*_admin_insert/update/delete` | SIUD | Lectura tenant, gestión admin. |
| `configuracion_hotel` | `configuracion_hotel_tenant_select`, `*_admin_*` | SIUD | Lectura tenant, escritura admin; excepción acotada al bootstrap. |
| `hoteles` | `hoteles_tenant_select`, `hoteles_onboarding_insert`, `hoteles_admin_update`, `hoteles_superadmin_delete` | SIUD | Sin catálogo público de hoteles; onboarding conserva contrato. |
| `categorias_producto`, `compras_tienda`, `detalle_compras_tienda` | `*_tenant_access` | SIUD | Eliminadas políticas permisivas y dependencias de JWT metadata. |
| `notificaciones` | `notificaciones_tenant_select/insert/update`, `notificaciones_admin_delete` | SIUD | No depende de `app_metadata` para el tenant. |

Los helpers `get_current_user_hotel_id_from_profile`, `get_my_current_hotel_id`, `get_current_user_rol_from_profile` y `get_my_current_rol` ahora consultan `usuarios`; no confían en `user_metadata`. `actor_is_saas_superadmin` es `SECURITY DEFINER` con `search_path` fijo para evitar recursión RLS.

El RPC legacy `crear_usuario_con_perfil_y_roles_basico(...)` era `SECURITY DEFINER` y ejecutable por PUBLIC/anon/authenticated. Quedó revocado para esos roles.

## Pruebas de ataque en staging

Todas se ejecutaron dentro de transacciones con rollback y fixtures sintéticos de dos hoteles.

| Prueba | Resultado |
| --- | --- |
| anon SELECT `clientes` | 42501 permission denied |
| anon DELETE `ventas` | 42501 permission denied |
| anon UPDATE `pagos` | 42501 permission denied |
| anon INSERT `usuarios_roles` | 42501 permission denied |
| Recepción hotel A lee `clientes`/`reservas` hotel B | 0 filas |
| Recepción hotel A actualiza categorías hotel B | 0 filas |
| Recepción intenta asignarse Administrador | 42501 por RLS |
| Recepción intenta cambiar su columna `rol` | 0 filas modificadas |
| Admin lee módulos operativos/financieros de su hotel | OK |
| Admin crea/actualiza/elimina cliente de prueba | OK, rollback |
| Onboarding crea hotel, configuración, perfil y rol inicial | OK, rollback |

## Frontend, autenticación y registros

- `authService.onAuthStateChange` publica un único contrato `{ event, session, user }`.
- `INITIAL_SESSION` se resuelve una vez; `main.js` ignora `SIGNED_IN`/`TOKEN_REFRESHED` duplicados del mismo usuario.
- El hotel de autorización se obtiene del perfil `usuarios`, no de metadata editable.
- Se eliminaron logs del cliente Supabase, sesión, correo, payload de reserva, UUID de hotel y detalle completo del plan.
- `safeLogger` sanitiza recursivamente claves sensibles, JWT, correos y UUID completos antes de escribir en consola.
- El escaneo encontró solo las dos claves anon publicables del frontend. No encontró service-role key, private key, Google client secret ni URL Postgres con contraseña versionada. `.env.staging.local` está ignorado por Git.

## ChatKit, CSP y extensiones

- ChatKit ya no tiene `<preload>` ni `<script>` global en landing o app.
- El widget interno y el comercial cargan el script al abrir o expresar intención de abrir el chat.
- La ruta `#/pagos-bancarios` no inicializa ChatKit por sí misma.
- Se eliminó `'unsafe-eval'` de las cuatro CSP que lo incluían. Se conserva temporalmente `'unsafe-inline'` y el comodín `https:` porque reducirlos requiere inventariar scripts/estilos inline y dominios de todos los módulos; hacerlo a ciegas rompería login, pagos o widgets.
- `contentscript.js`, `MaxListenersExceededWarning` y mensajes `ObjectMultiplex` no pertenecen al repositorio. Validación recomendada: repetir en incógnito con extensiones deshabilitadas. No se modificó código externo.

## Security Advisors

- Producción antes: 321 hallazgos; 31 ERROR (`rls_disabled_in_public` y `policy_exists_rls_disabled` incluidos).
- Staging después: 205 hallazgos de seguridad; 0 ERROR, 195 WARN y 10 INFO. Permanecen WARN de `function_search_path_mutable`, funciones `SECURITY DEFINER` authenticated intencionales, extensión en public y protección de contraseñas filtradas deshabilitada. Las tres advertencias anon restantes corresponden exactamente a las tres RPC públicas permitidas.
- Performance, producción antes: 462 hallazgos; 230 WARN y 232 INFO.
- Performance, staging después: 350 hallazgos; 88 WARN y 262 INFO. El hotfix redujo las advertencias ligadas a políticas, pero la optimización histórica de índices y políticas permisivas queda fuera de este cambio de emergencia.
- Referencias: [RLS sin policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [search path mutable](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [RLS init plan](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan) y [políticas permisivas múltiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Integridad financiera Fase 13 en staging

La consulta read-only `scripts/fase13-financial-trace-audit.sql` se ejecutó después del hardening:

| Control | Resultado |
| --- | ---: |
| Movimientos shadow | 10 |
| `sin_ledger` | 0 |
| `divergentes` | 0 |
| Allocations de otro hotel | 0 |
| Allocations con monto inválido | 0 |
| Gmail IDs duplicados por hotel | 0 |
| Métodos/cuentas de otro hotel | 0 |
| Ledger/Caja de otro hotel | 0 |

La misma auditoría deberá repetirse en producción inmediatamente después del rollout; no se ha ejecutado como post-deploy porque producción todavía no ha recibido el hotfix.

## Verificación automatizada

- `npm test`: 157 aprobadas, 0 fallidas.
- `npm run check:syntax`: sintaxis validada en 167 archivos.
- `deno check` de `registrar-pre-referido`: aprobado.
- `git diff --check`: aprobado.

## Migraciones del hotfix

1. `20260827065614_pre_fase14_critical_rls_hardening.sql`
2. `20260827065753_pre_fase14_remaining_rls_hardening.sql`
3. `20260827065954_pre_fase14_revoke_anon_table_access.sql`
4. `20260827070445_pre_fase14_revoke_anon_function_access.sql`
5. `20260827070530_pre_fase14_close_public_function_defaults.sql`
6. `20260827070843_pre_fase14_tenant_policy_cleanup.sql`
7. `20260827070954_pre_fase14_fix_authz_rls_recursion.sql`
8. `20260827071044_pre_fase14_fix_onboarding_config.sql`
9. `20260827071537_pre_fase14_fix_metadata_helpers.sql`

## Consulta reproducible de inventario

```sql
select c.relname as table_name,
       c.relrowsecurity as rls,
       c.relforcerowsecurity as force_rls,
       has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_full_crud,
       has_table_privilege('authenticated', c.oid, 'SELECT') as authenticated_select,
       coalesce(string_agg(p.policyname || ':' || p.cmd, ', ' order by p.policyname), 'sin policy') as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.schemaname = n.nspname and p.tablename = c.relname
where n.nspname = 'public' and c.relkind in ('r', 'p')
group by c.oid, c.relname, c.relrowsecurity, c.relforcerowsecurity
order by c.relname;
```

## Checkpoint

El checkpoint RLS inicial de staging quedó aprobado por pruebas automatizadas y SQL. La auditoría posterior del release gate encontró RPC legacy `SECURITY DEFINER` ejecutables por `authenticated` sin aislamiento tenant; por ello el despliegue a producción está bloqueado hasta corregirlas mediante una migración nueva. Ver `docs/security/pre-fase14-release-gate.md`. No se debe iniciar Fase 14/24.
