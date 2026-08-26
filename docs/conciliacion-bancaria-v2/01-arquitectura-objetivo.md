# Arquitectura objetivo

## Fuentes de verdad

| Nivel | Fuente de verdad | Responsabilidad |
|---|---|---|
| Banco | `bank_payment_events` | Evidencia inmutable y enmascarada de entrada/salida detectada |
| Relación | `bank_payment_allocations` | Distribución de un evento entre registros operativos |
| Operación | reservas, `pagos_reserva`, ventas de tienda/restaurante/terraza | Qué compró o pagó el huésped |
| Caja | `caja` | Movimiento operativo del turno; nunca se duplica al conciliar |
| Finanzas | cuentas y ledger de Fase 2 financiera | Proyección contable/financiera de la operación |
| Auditoría | `bank_payment_audit_log` | Quién cambió una relación, cuándo, por qué y antes/después |

Flujo: correo bancario → Edge Function → `bank_payment_events` → propuesta → confirmación administrativa → `bank_payment_allocations` → estado de verificación visible en Caja. La conciliación enlaza; no cobra ni inserta un segundo movimiento.

## Decisión sobre columnas legacy

`matched_reservation_id`, `matched_room_id`, `matched_sale_id` y `matched_sale_type` se conservan por compatibilidad, pero dejan de ser fuente de verdad. Serán un resumen solo cuando la relación sea inequívoca; en distribuciones múltiples o mixtas podrán quedar `NULL`. Todo cálculo nuevo leerá allocations. Esta decisión evita representar de forma falsa una relación N:M en cuatro columnas 1:1.

## Principios

- COP como `bigint`, sin decimales.
- Suma exacta para estado confirmado.
- Máximo de 50 allocations por evento.
- Escritura mediante RPC/Edge Function con transacción, bloqueo y auditoría.
- Lectura mínima y enriquecida por servidor, sin cuerpos de email ni cuentas completas.
- Feature gate por UUID del hotel en servidor y frontend; apagable sin afectar operación normal.
- Heurísticas solo proponen; la relación final queda persistida.

## Compatibilidad y retiro

Si el piloto se desactiva, Gmail deja de ingerir y se ocultan conciliación/estados. Reservas, ventas, Caja, ledger y cierres siguen usando sus datos operativos. Las allocations se conservan como historial y no son necesarias para registrar nuevas operaciones.
