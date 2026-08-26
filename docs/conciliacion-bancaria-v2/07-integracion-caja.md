# Integración con Caja

`caja` es la fuente operativa del turno. La conciliación no inserta, revierte ni modifica montos de Caja. El trigger `fase2_project_caja_to_account_trg` proyecta inserciones al ledger y `fase1_guard_caja_hotel_trg` protege referencias de hotel.

## Diseño

Una relación persistida, no una coincidencia permanente por fecha/monto/concepto, debe resolver el estado bancario del movimiento. Para métodos de transferencia: pendiente, verificado o revisión; para efectivo: no aplica. El enlace puede derivarse inicialmente por entidad operativa, pero debe terminar en una clave explícita y auditable.

## Cierre

Efectivo conserva arqueo ciego. Banco muestra registrado por sistema, confirmado, pendiente y diferencia. Es informativo y no bloquea mientras Gmail esté caído.

## Método de pago

Las migraciones productivas de cambio de método ya están representadas localmente. Existe `actualizar_metodo_pago_caja`, que limita actor/tenant y audita, y también un grant de columna usado por el frontend legacy. Como la proyección actual a cuenta es `AFTER INSERT`, la Fase 10 deberá eliminar la escritura directa y comprobar/sincronizar el asiento asociado sin alterar el comportamiento permitido de otros hoteles.

## Pruebas

Confirmar no aumenta ingresos ni ledger; cambiar método no altera monto, concepto, hotel, turno o autor; otro hotel no obtiene estado. Rollback: retirar join/badges informativos, sin borrar conciliaciones.
