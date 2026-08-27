# Integración con Caja

`caja` es la fuente operativa del turno. La conciliación no inserta, revierte ni modifica montos de Caja. El trigger `fase2_project_caja_to_account_trg` proyecta inserciones al ledger y `fase1_guard_caja_hotel_trg` protege referencias de hotel.

## Diseño

Una relación persistida, no una coincidencia permanente por fecha/monto/concepto, debe resolver el estado bancario del movimiento. Para métodos de transferencia: pendiente, verificado o revisión; para efectivo: no aplica. El enlace puede derivarse inicialmente por entidad operativa, pero debe terminar en una clave explícita y auditable.

## Fase 9 aplicada

Caja consulta al backend protegido solo cuando el `hotel_id` activo es el UUID del piloto. El backend vuelve a validar usuario, rol operativo y tenant, y relaciona cada movimiento mediante sus claves persistidas (`pago_reserva_id`/`reserva_id`, `venta_tienda_id`, `venta_restaurante_id` o `venta_terraza_id`) con `bank_payment_allocations` y su evento. No compara monto, fecha ni concepto y no escribe en Caja.

La columna queda completamente oculta para otros hoteles y no se invoca el backend bancario. En Marena, efectivo, egresos y reversiones muestran `No aplica`; una transferencia sin evento confirmado muestra `Esperando verificación`; `confirmed` muestra `Confirmado por banco`; `manual_review` muestra `Revisión administrativa`.

## Cierre

Efectivo conserva arqueo ciego. Banco muestra registrado por sistema, confirmado, pendiente y diferencia. Es informativo y no bloquea mientras Gmail esté caído.

## Método de pago

La Fase 10 reemplazó la escritura directa por `actualizar_metodo_pago_caja`. El RPC bloquea el movimiento, valida actor, rol, tenant y método activo, resuelve la cuenta financiera y actualiza Caja y `account_movements` en la misma transacción. Registra before/after de ambos registros en auditoría. El grant directo `UPDATE (metodo_pago_id)` fue revocado.

La reparación productiva se limitó a asientos con relación explícita `account_movements.caja_id`: pasó de 5 métodos y 6 cuentas divergentes a cero. No cambió montos, direcciones, fechas, conceptos, turnos, autores ni creó movimientos.

## Pruebas

Confirmar no aumenta ingresos ni ledger; cambiar método no altera monto, concepto, hotel, turno o autor; otro hotel no obtiene estado. Rollback: retirar join/badges informativos, sin borrar conciliaciones.
