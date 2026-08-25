# Fase 1 — dependencias legacy

Fecha: 2026-08-09. Inventario previo a revocar policies, grants o RPC.

## Dependencias críticas

| Acceso legacy | Callers/consumidores | Reemplazo Fase 1 | Orden seguro |
| --- | --- | --- | --- |
| `registrar_y_eliminar_mov_caja` | `js/modules/caja/caja-movimientos.js` | `revertir_movimiento_caja` | crear RPC → migrar UI → probar → revocar/drop legacy |
| `increment` genérico | `js/modules/tienda/pos.js` | incluido dentro de `procesar_venta_tienda_atomica` | crear RPC → migrar POS → probar → revocar/drop |
| pago multi-step | `reservas-pagos.js`, `uiUtils.js`, `modales-gestion.js`, `modales-alquiler.js`, `reservas.js` | `procesar_pago_reserva_atomico` | migrar cada camino antes de bloquear INSERT directo |
| actualización directa de `monto_pagado` | archivos anteriores y creación/edición de reservas | caché escrita solo dentro de RPC para pagos nuevos | preservar creación con cero; retirar incrementos directos |
| tienda multi-step | `js/modules/tienda/pos.js` | `procesar_venta_tienda_atomica` | RPC primero; mantener lecturas actuales |
| restaurante multi-step | `js/modules/restaurante/restaurante.js` (tres flujos de insert) | `procesar_venta_restaurante_atomica` | RPC primero; no agregar CMV |
| DELETE pagos/reservas | `js/modules/reservas/reservas-estado.js` y funciones de eliminación en `reservas.js` | cancelación/reversión lógica; no reparación histórica | migrar antes de revocar DELETE |
| edición método caja | `js/modules/caja/caja-movimientos.js` | RPC auditada `cambiar_metodo_movimiento_caja` | crear/auditar antes de retirar UPDATE directo |
| cierre de turno | módulos `js/modules/caja/*` y `js/services/turnoService.js` | RPC endurecida + detalle de arqueo | compatibilidad de firma durante transición |
| Terraza hardcodeada | `js/main.js` y módulos `js/modules/terraza/*`; policies/RPC 20260619–20260705 | hotel de perfil activo validado | eliminar constante sin cambiar flujo del hotel actual |

## Lecturas que dependen de acceso directo

- Caja/cierre/reportes leen `caja`, turnos, ventas e items.
- Cuenta de habitación lee `pagos_reserva`, tienda/restaurante y detalles.
- CRM/clientes y actividad de usuarios leen cabeceras de ventas.
- Reportes leen detalles de tienda y `monto_pagado` histórico.

Estas lecturas deben conservarse mediante RLS tenant-aware. No se sustituirán todas por RPC porque la consulta directa filtrada es válida cuando la base garantiza el tenant.

## Escrituras directas adicionales

- reservas se crean/actualizan en varios módulos; Fase 1 solo bloquea cambios financieros posteados, no el mantenimiento operativo legítimo;
- descuentos usan `incrementar_uso_descuento`, que no es el `increment` genérico de stock y se revisa por seguridad sin cambiar su semántica;
- compras e inventario tienen flujos separados y solicitudes autorizadas; se protegen por tenant/RPC, sin reconstruir compras históricas;
- Terraza ya usa RPC transaccionales y se endurece sin reescribir el módulo.

## Feature flags de transición

- `fase1PagosAtomicos`;
- `fase1TiendaAtomica`;
- `fase1RestauranteAtomico`;
- `fase1ReversionCaja`;
- `fase1ArqueoDetallado`.

Los callers nuevos pueden activarse por entorno. Las revocaciones legacy solo se incluyen en la migración final y nunca deben ejecutarse antes de activar y validar los flags.

## Legacy Data Freeze

No se actualizan masivamente `reservas.monto_pagado`, caja, stocks, compras, logs ni candidatos duplicados. La consistencia nueva comienza en el cutover futuro, identificada por `client_operation_id`, `business_date` y versión `fase1-v1`. Los reportes históricos mantienen las fuentes temporales documentadas en Fase 0.
