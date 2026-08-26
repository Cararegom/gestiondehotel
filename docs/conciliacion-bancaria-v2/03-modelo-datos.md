# Modelo de datos

## Entidades bancarias

- `bank_payment_events`: evento detectado, monto COP, fecha, banco, referencia enmascarada, estado y columnas legacy.
- `bank_payment_allocations`: relación principal N:M. Un registro apunta a `reservation`, `room` o `sale` y guarda `amount_cop > 0`, tipo de venta y actor.
- `bank_payment_audit_log`: bitácora append-only de eventos y cambios administrativos.
- `expected_payments`: expectativa previa; actualmente sin filas y no sustituye una operación.

## Entidades operativas relacionadas

Reservas/pagos: reservas y `pagos_reserva`. Ventas: `ventas_tienda` + `detalle_ventas_tienda`, `ventas_restaurante`, `terraza_pedidos` y ventas legacy. Caja: `caja`, turnos/cierres y `metodos_pago`. Finanzas: tablas de cuentas/ledger y gastos creadas por las migraciones `fase2_cuentas_ledger_shadow`, `fase2_gestion_cuentas_rpc` y `fase3_gastos_cuentas_por_pagar`.

## Invariantes objetivo

1. Evento y destino pertenecen al mismo hotel piloto.
2. Cada allocation tiene exactamente un destino lógico y monto entero positivo.
3. Confirmado implica `SUM(allocation.amount_cop)=event.amount_cop`.
4. Una venta totalmente conciliada no puede exceder su importe activo entre eventos confirmados.
5. Reversión no borra evidencia: cambia vigencia/estado y audita.
6. Las columnas legacy no intervienen en sumas ni unicidad financiera.

## Cambios aplicados en Fase 2

`bank_payment_events_legacy_target_summary_check` conserva la exclusividad únicamente para el resumen legacy; una distribución múltiple deja esas columnas en `NULL`. `bank_payment_events_relation_state_check` reconoce allocations mediante metadata, y `bank_email_validate_allocation_event_trg` comprueba contra las filas reales. Auditoría admite explícitamente `multiple_allocation_changed`. Fases posteriores pueden necesitar una referencia explícita al movimiento de `caja`; se elegirá después de mapear claves reales de cada origen, sin heurística permanente.

## Precheck obligatorio

Antes de DDL: buscar eventos legacy mixtos, allocations huérfanas, sumas diferentes, destinos cross-tenant, ventas duplicadas y acciones de auditoría fuera del catálogo. La fotografía actual tiene cero allocations, pero el precheck debe vivir en el procedimiento de despliegue.

## Cambios aplicados en Fase 6

`bank_email_sale_available_amount_cop` calcula el importe restante de una venta descontando allocations de eventos `matched` o `confirmed`. El evento que se está editando se excluye para permitir corregir su distribución. `replace_bank_payment_allocations` serializa por hotel, tipo y venta mediante advisory lock y rechaza cualquier importe superior al saldo disponible.
