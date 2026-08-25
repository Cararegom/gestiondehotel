# Fase 1 — pruebas y resultados

> Resultados históricos previos a staging. El cierre vigente, incluida la suite 76/76 y la prueba runtime de compras, está en `20-cierre-fase1.md`.

Fecha: 2026-08-09.

## Ejecutado localmente

| Comando | Resultado |
| --- | --- |
| `npm run check:syntax` | 132 archivos válidos |
| `npm test` | 62/62 tests aprobados, 0 fallos |
| `npm run fase1:legacy-gate` | bloqueo esperado: pagos=5, restaurante=6; increment/delete/UUID fijo=0 |

Los tests nuevos verifican:

- diez migraciones pequeñas y ordenadas;
- ausencia de `USING(true)`/`WITH CHECK(true)` en las policies Fase 1;
- `auth.uid()`, `SECURITY DEFINER`, `search_path=pg_catalog,public` y revocación a anon;
- revocación de `increment` y RPC de borrado solo en la migración final;
- idempotencia y business date;
- preservación de logs e inexistencia de reparación masiva;
- callers principales migrados;
- ausencia en frontend de llamadas a `increment`/borrado y UUID fijo de Terraza;
- fechas 18:30, 19:30, 23:30 y 00:30 Bogotá.

## No ejecutado

No hay Supabase CLI ni Docker en el entorno. El MCP productivo permanece `read_only=true` y no se usó para aplicar migraciones. Tampoco se creó una branch remota porque el canal configurado es exclusivamente de lectura y no se autorizó costo/creación mediante otro mecanismo.

Por tanto están **pendientes y son obligatorias** en branch/staging:

1. aplicar las migraciones 01–09 y validar sintaxis/objetos reales;
2. fixtures Hotel A/Hotel B y JWT para recepción, admin, mesero, contabilidad/propietario explícitos, inactivo, sin hotel y soporte;
3. SELECT/INSERT/UPDATE/DELETE cross-tenant;
4. cada RPC con anon, usuario equivocado, UUID B, monto cero/negativo, estado inválido;
5. doble clic, timeout, reconexión y operación repetida;
6. errores inducidos después de insertar cabecera para demostrar rollback total;
7. anticipos, propina y pago mixto de Terraza;
8. arqueo propio/forzado y diferencias por método;
9. smoke tests de reserva, tienda, restaurante, compras, caja, reportes y cancelación;
10. aplicar migración 10 solo después de migrar los callers restantes y repetir todo.

## Resultado por criterio

| Criterio | Estado |
| --- | --- |
| policies Fase 1 sin `true` | ✅ contrato estático |
| RLS sensible | ✅ definido, ⏳ no aplicado/testeado |
| aislamiento Hotel A/B | ⏳ requiere branch |
| anon sin RPC peligrosa | ✅ definido, ⏳ requiere branch |
| DEFINER seguros | ✅ contrato estático, ⏳ ejecución pendiente |
| `increment` fuera de callers | ✅ |
| reversión sustituye borrado de caja | ✅ caller principal |
| pago/tienda/restaurante atómicos | ✅ SQL preparado, ⏳ rollback real pendiente |
| Terraza sin UUID fijo | ✅ código/migraciones Fase 1 |
| cross-hotel rechazado | ✅ triggers/RPC definidos, ⏳ ejecución pendiente |
| business date | ✅ JS; ⏳ SQL pendiente |
| arqueo persistido | ✅ definido/caller, ⏳ ejecución pendiente |
| históricos intactos | ✅ revisión estática |
| todos los callers legacy retirados | ❌ quedan flujos secundarios |

## Casos fallidos/bloqueados

- ejecución PostgreSQL local: bloqueada por ausencia de CLI/Docker;
- staging/branch: no disponible con autorización read-only;
- revocación final: bloqueada por callers secundarios;
- restaurante: el RPC actual no incorpora todavía descuentos/impuestos del flujo avanzado; no debe activarse para esos casos hasta ampliar el contrato y probarlo.

Conclusión: los tests de repositorio pasan, pero los criterios de aprobación productiva aún no se cumplen.
