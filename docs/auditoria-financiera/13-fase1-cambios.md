# Fase 1 — cambios preparados

Fecha: 2026-08-09. Estado: preparación local ampliada; no aplicada a ninguna base remota.

## Migraciones

| Orden | Archivo | Propósito | Rollback lógico |
| --- | --- | --- | --- |
| 01 | `20260809100000_fase1_authz_rls_base.sql` | helpers de membresía/permiso, permisos nuevos y RLS tenant-aware | restaurar policies versionadas; no toca históricos |
| 02 | `...101000_fase1_auditoria_reversion.sql` | auditoría, reversión y columnas de operación/business date | desactivar caller; conservar evidencia creada |
| 03 | `...102000_fase1_pago_reserva_atomico.sql` | pago+caja+cache en una transacción e idempotencia | feature flag al flujo anterior antes de revocar |
| 04 | `...103000_fase1_tienda_atomica.sql` | venta+items+stock+movimientos+caja atómicos | flag de POS; columnas aditivas permanecen |
| 05 | `...104000_fase1_restaurante_atomico.sql` | venta+items+caja, sin CMV | flag de restaurante |
| 06 | `...105000_fase1_rpc_caja_inventario_seguras.sql` | apertura/movimiento endurecidos y ajuste de stock específico | restaurar definición previa controladamente |
| 07 | `...106000_fase1_arqueo_turno_business_date.sql` | detalle de arqueo y cierre auditado | volver temporalmente al cierre anterior |
| 08 | `...107000_fase1_terraza_tenant_segura.sql` | policies/RPC Terraza sin UUID fijo | restaurar 20260623/20260705 |
| 09 | `...108000_fase1_tenant_guards_observabilidad.sql` | guards cross-hotel y snapshot de anomalías | deshabilitar triggers; no tocar filas |
| 10 | `...109000_fase1_revocacion_legacy.sql` | revocación/drop de caminos inseguros | **bloqueada hasta migrar todos los callers** |

Cada archivo incluye propósito, dependencias, riesgo, rollback lógico y tests asociados. Ninguno actualiza masivamente históricos.

## Decisiones

- `pagos_reserva` es la fuente de cobros; `reservas.monto_pagado` queda como caché actualizada exclusivamente por el RPC para operaciones nuevas.
- `client_operation_id` + `(hotel_id, source)` identifica operaciones nuevas.
- `business_date` usa `America/Bogota`; no se reescriben fechas anteriores.
- las reversiones crean un movimiento opuesto y relación explícita; el original permanece.
- items de restaurante sin `hotel_id` validan tenant mediante JOIN seguro con venta/plato.
- superadmin no tiene bypass financiero implícito.
- logs históricos permanecen intactos.

## Aplicación

Callers migrados:

- abono estándar de reserva → `procesar_pago_reserva_atomico`;
- POS tienda → `procesar_venta_tienda_atomica`;
- venta inmediata principal de restaurante → `procesar_venta_restaurante_atomica`;
- eliminar movimiento de caja → `revertir_movimiento_caja`;
- cierre de turno → `cerrar_turno_con_arqueo`;
- Terraza: UUID fijo retirado de navegación, módulo, inventario, reportes y menú público.

Se agregó `fase1OperationService.js`, que conserva el UUID en `sessionStorage` hasta éxito para reintentos por timeout/reconexión.

## Dependencias legacy retiradas

Los cobros secundarios de `uiUtils.js`, mapa de habitaciones y reservas usan ahora el RPC de pago. Los flujos inmediato y a-habitación del restaurante usan el RPC de venta; también se corrigió la función duplicada que hacía prevalecer la implementación antigua.

El gate reproducible `npm run fase1:legacy-gate` informa cero hallazgos y autoriza la migración 10. La migración 10 fue aplicada al staging gratuito el 2026-08-25; producción permanece sin ella hasta completar la matriz manual de regresión.

Se agregó configuración real por entorno en `fase1FeatureFlags.js`. `fase1LegacyRevoked=true` fuerza los cinco flags a ON y evita que la UI reabra caminos legacy después de migración 10.

## Cambios incompatibles esperados

- pagos nuevos requieren turno activo y UUID idempotente;
- precios de tienda/restaurante se validan en backend;
- una reserva/venta/producto de otro hotel produce `42501`/constraint;
- cerrar turno requiere arreglo de arqueos;
- el menú público de Terraza requiere parámetro `?hotel=<uuid>`;
- superadmin sin membresía/permiso deja de leer finanzas del hotel.
