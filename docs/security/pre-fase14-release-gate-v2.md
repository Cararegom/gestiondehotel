# PRE-FASE14 RELEASE GATE v2

Fecha: 2026-08-27

Rama: `security/pre-fase14-hotfix`

Producción Supabase: `iikpqpdoslyduecibaij`

Staging Supabase: `vyzscuzgjdhrhzctmsuv`

## Decisión

**GO candidate.** El paquete corregido está listo para un checkpoint explícito de
promoción, pero este documento no autoriza aplicarlo en producción.

No se escribió en Supabase producción, no se fusionó `main`, no se desplegó
Vercel y no se inició la Fase 14/24. `origin/main` permaneció en
`a6727b0e384bfe6b1c9e2821d455563ad8a4020e` durante toda la validación.

## Correcciones del paquete

- La migración 5 ahora cierra los defaults de funciones de `postgres`, revoca
  `EXECUTE` a `PUBLIC`, `anon` y `authenticated` sobre las funciones existentes,
  conserva `service_role` y reconstruye una allowlist por firma.
- `actualizar_compra_y_detalles` y `cambiar_habitacion_transaccion` permanecen
  cerradas en la migración 5. Solo se abren cuando la migración 10 instala sus
  definiciones con aislamiento por hotel.
- La migración 10 ya no depende de `public.role()`, `public.uid()` ni
  `public.uuid_generate_v4()`. Eran wrappers exclusivos del staging anterior;
  no existen en producción y no son necesarios por el frontend ni por RLS.
- Se agregaron pruebas que impiden reintroducir un grant global, abrir antes de
  tiempo los dos RPC vulnerables o depender de esos wrappers.

## Respaldo y restauración

| Origen | Herramienta | Copia cifrada | Integridad |
| --- | --- | --- | --- |
| Producción PostgreSQL 15.8, solo lectura | `pg_dump 15.19` | `C:\Users\AG-ve\AppData\Local\GestionDeHotel\backups\pre-fase14-v2-20260827-143410\production-full-pg15.dump.7z` | 25.345.747 bytes; SHA-256 `132C26E3C8772B2A0D4D6E96B21DEB2F86F5BCE1D847FC6DEEB887DEC983D11F`; 2.332 entradas |
| Staging PostgreSQL 17.6 | `pg_dump 17.11 --role postgres` | `C:\Users\AG-ve\AppData\Local\GestionDeHotel\backups\staging-pre-fase14-v2-20260827-174856\staging-public-pg17.dump.7z` | 126.194 bytes; SHA-256 `2C88EE8CD2DA632438756A6F33E9F0F02FEEA9EB354C0DA2CE45B57AC7E56318`; 1.708 entradas |

Ambas copias usan AES-256 y cabecera cifrada de 7-Zip. Las claves no están en el
repositorio: quedaron protegidas con DPAPI `CurrentUser` bajo
`HKCU\Software\GestionDeHotel\BackupKeys`. Las copias temporales sin cifrar se
eliminaron después de validar catálogo e integridad.

Supabase no permite al rol temporal bloquear tablas internas de Auth ni leer
directamente `supabase_migrations`; por eso la copia preventiva de staging cubre
exactamente `public`, el único esquema que se reconstruyó. Auth, Storage y los
esquemas administrados no fueron limpiados.

El primer dump de producción fue rechazado al intentar restaurarlo porque la
canalización había agregado un BOM. El gate de restore detectó el problema; esa
copia inválida y su clave se eliminaron y se generó la copia válida indicada
arriba.

## Prueba PostgreSQL 15

El esquema y los datos `public` de producción se restauraron localmente en
PostgreSQL 15.19: 15 hoteles, 54 usuarios, 31.293 reservas y 164 políticas RLS.
Las diez migraciones se ejecutaron en orden, sin correcciones intermedias.

| Migración | Tiempo | ACL `PUBLIC / anon / authenticated / service_role` |
| --- | ---: | --- |
| 1 | 324 ms | 168 / 192 / 228 / 234 |
| 2 | 193 ms | 168 / 192 / 228 / 234 |
| 3 | 228 ms | 168 / 192 / 228 / 234 |
| 4 | 200 ms | 168 / 168 / 228 / 234 |
| 5 | 411 ms | **0 / 3 / 81 / 234** |
| 6 | 258 ms | 0 / 3 / 81 / 234 |
| 7 | 169 ms | 0 / 3 / 81 / 234 |
| 8 | 183 ms | 0 / 3 / 81 / 234 |
| 9 | 186 ms | 0 / 3 / 83 / 234 |
| 10 | 335 ms | **0 / 3 / 83 / 233** |

El conteo incluye funciones administradas por extensiones en los pasos previos;
el cierre de las migraciones 5 y 10 actúa únicamente sobre funciones de
aplicación propiedad de `postgres`.

## Staging limpio PostgreSQL 17

Staging se respaldó, se retiraron con `supabase migration repair` las diez
versiones anteriores, se reconstruyó `public` desde el esquema de producción sin
datos operativos y se aplicó el paquete definitivo. Se registraron exactamente
las versiones locales de las diez migraciones.

Tiempos: 8.719, 2.754, 1.059, 1.316, 2.198, 2.467, 1.192, 1.025, 1.512 y
11.306 ms. Resultado final:

| Control | Resultado |
| --- | ---: |
| Tablas `public` | 108 |
| Funciones de aplicación | 186 |
| `EXECUTE` de aplicación para `PUBLIC` | 0 |
| `EXECUTE` de aplicación para `anon` | 3 |
| `EXECUTE` de aplicación para `authenticated` | 83 |
| `EXECUTE` de aplicación para `service_role` | 186 |
| Políticas RLS | 164 |
| Tablas sin RLS | 0 |
| Tablas RLS sin política | 11 |
| Wrappers `role/uid/uuid_generate_v4` en `public` | 0 |
| Versiones del paquete en historial | 10 |

Los únicos RPC anónimos son `crear_pedido_web_tienda`,
`obtener_catalogo_tienda_web` y `obtener_menu_terraza_publico`.

Los seis RPC internos verificados —`asignar_concepto_venta_caja`,
`bank_email_sale_available_amount_cop`, `bank_email_sale_is_reconcilable`,
`bank_email_validate_allocation_event`, `cerrar_turno_con_balance` y
`replace_bank_payment_allocations`— quedaron `anon=false`,
`authenticated=false`, `service_role=true`.

## Ataques multi-hotel

Los fixtures usaron dos usuarios reales de Auth, existieron solo dentro de una
transacción y terminaron con `ROLLBACK`.

| Caso | Resultado |
| --- | --- |
| Editar compra del mismo hotel | PASS, permitido |
| Editar compra de otro hotel | PASS, bloqueado `42501` |
| Inyectar detalle de otra compra/hotel | PASS, bloqueado `42501` |
| Ejecutar inventario server-only como cliente | PASS, bloqueado `42501` |
| Cambiar habitación del mismo hotel | PASS, permitido |
| Cambiar habitación de otro hotel | PASS, bloqueado `42501` |
| Sobrecarga legacy de cambio de habitación | PASS, ausente |
| Integridad final del Hotel B | PASS, sin cambios |

## Integridad financiera Fase 13

Staging está intencionalmente sin datos operativos después del rebuild. La
auditoría read-only devolvió: movimientos shadow 0, `sin_ledger` 0,
`divergentes` 0, allocations cross-tenant 0, montos inválidos 0, Gmail IDs
duplicados 0, métodos/cuentas cross-tenant 0 y ledger/caja cross-tenant 0.

## Pruebas y Advisors

- `npm test`: 166 aprobadas, 0 fallos.
- `npm run check:syntax`: 168 archivos.
- `npm run typecheck`: cuatro Edge Functions Deno.
- `npm run lint`: 31 archivos.
- Escaneo de 444 archivos: 0 JWT `service_role`, 0 llaves privadas, 0 URL de
  base de datos con contraseña y 0 claves literales de servicio.
- Security Advisor: 140 hallazgos, 129 WARN, 11 INFO y **0 ERROR**.
- Performance Advisor: 380 hallazgos, 112 WARN, 268 INFO y **0 ERROR**.

Deuda conocida de Advisors: 57 funciones con search path mutable, 11 tablas RLS
sin políticas, 67 funciones `SECURITY DEFINER` autenticadas de la allowlist, los
tres endpoints anónimos, `citext` en `public`, protección de contraseñas filtradas
deshabilitada, 195 claves foráneas sin índice, 72 índices sin uso, 71 políticas
permisivas múltiples, 41 `auth_rls_initplan` y una tabla sin PK.

Referencias: [RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[search path mutable](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
[funciones authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[FK sin índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys) y
[políticas permisivas múltiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## Hashes del paquete

Los hashes siguientes corresponden al contenido canónico almacenado por Git
(saltos de línea LF), para que sean reproducibles en cualquier sistema operativo.

| Migración | SHA-256 |
| --- | --- |
| `20260827065614` | `647A494872EB78B00F9FE6C3654AE9219F54EDE805E36ABFFD7A62CE74C97142` |
| `20260827065753` | `68DC631CF3C64D16DEBDAAB17629D66BCF72522EBAA78703B4B08BBF2EBEB070` |
| `20260827065954` | `3D85998993272423550A93A17AB2C368C48339B13D62CFD8439D36201CA3B442` |
| `20260827070445` | `D7145F31AA81FB5D38CE6C82EF86923B85229BDBC2BFF335D31934A67E3FF5BE` |
| `20260827070530` | `DBC3BB50F7A8B17D93143CC0800152BECF6BD8FACD0106C84B7E55EEB2DBE21B` |
| `20260827070843` | `0C8271826A1A2F8C50784552B4FE38E6659870DDF5C03ABEB2EDC350BE8E9E8F` |
| `20260827070954` | `BFCCEA1BFE36895BACB07BD2ACD9AF4D2770F49ED0A09D61CA9A87842687D80B` |
| `20260827071044` | `278655B1633677792799483DEC6FAAFF94D72D03C59A010E7B28DC22009D4E3F` |
| `20260827071537` | `E77929A92AB85D07DBFAA954D45AC9F459CDF40AB8FDAA2AE62808000A5E6205` |
| `20260827174036` | `36064E49C066AC34BD62DDFF88AE34B5A45B077116D1F11952741B3F43C463B4` |

## Riesgo residual y promoción

- La deuda de Advisors no bloquea este hotfix, pero debe tratarse por cambios
  pequeños y medidos, no ampliando ACL para silenciar avisos.
- El laboratorio local no reproduce todos los servicios administrados de
  Supabase; por eso la validación se repitió en staging real PostgreSQL 17.6.
- El rollback productivo debe ser una migración compensatoria. No se deben
  editar migraciones ya registradas ni restaurar grants globales.
- Antes de producción se requiere una autorización nueva y explícita. Después
  de aplicarlo habría que repetir inmediatamente ACL, ataques, Advisors y Fase
  13 contra producción antes de considerar cualquier despliegue web.

**Estado final del checkpoint: GO candidate; pendiente de autorización expresa
para producción.**
