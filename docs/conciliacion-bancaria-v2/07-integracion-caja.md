# Integración con Caja

## Estado actual

La relación nueva entre una transferencia bancaria y Caja se guarda de forma explícita en `bank_payment_allocations.caja_id`.

Ese identificador apunta al movimiento exacto de `caja` que representa el ingreso. La conciliación no depende de volver a inferir la relación por monto, fecha, reserva o venta después de guardarla.

Las relaciones históricas que no tienen `caja_id` conservan una compatibilidad de lectura limitada. Si una relación histórica produce más de un candidato, el sistema falla de forma cerrada y la envía a revisión manual.

## Cadena de trazabilidad

```text
bank_payment_events
  -> bank_payment_allocations
  -> bank_payment_allocations.caja_id
  -> caja
  -> account_movements.caja_id
```

La transferencia sigue siendo la evidencia bancaria. Caja sigue siendo el registro operativo del ingreso. La conciliación agrega el vínculo entre ambos registros y no crea un segundo movimiento monetario.

## Condiciones para relacionar un movimiento

El backend acepta una relación únicamente cuando se cumplen todas estas condiciones:

- la transferencia pertenece al hotel piloto;
- su estado permite relación: `detected` o `manual_review`;
- se seleccionan entre 1 y 20 movimientos de Caja;
- cada movimiento pertenece al mismo hotel y es de tipo `ingreso`;
- el método de pago es bancario, está activo y corresponde a una cuenta bancaria habilitada;
- el movimiento no es una reversión ni está relacionado con otra transferencia;
- la reserva o venta de la asignación coincide exactamente con el destino persistido en Caja;
- la suma de los movimientos seleccionados coincide exactamente con el monto de la transferencia;
- el usuario autenticado tiene un rol operativo admitido y pertenece al hotel piloto.

La operación se ejecuta mediante `replace_bank_payment_allocations_from_caja`. El RPC vuelve a validar los datos dentro de la transacción, actualiza las asignaciones, guarda cada `caja_id` y registra la acción en auditoría. Su ejecución directa está reservada al backend con `service_role`.

## Restricciones de integridad

- `bank_payment_allocations.caja_id` tiene una clave foránea hacia `caja` con `ON DELETE RESTRICT`.
- Existe una restricción única parcial: un movimiento de Caja no puede respaldar dos transferencias.
- La validación se repite en base de datos para evitar depender solo del navegador o de la Edge Function.
- `bank_payment_has_valid_caja_link` comprueba que todas las asignaciones tengan un movimiento válido, que los montos cuadren y que hotel, tipo, método y destino coincidan.

## Uso desde recepción

Recepción realiza la relación desde Caja mediante `bank-payment-relation-api`. Esa API ofrece únicamente las acciones necesarias para este flujo:

- consultar el estado del servicio;
- listar transferencias pendientes con campos sanitizados;
- consultar el estado de conciliación de movimientos de Caja;
- buscar candidatos dentro de una ventana de ±48 horas;
- relacionar la transferencia con los movimientos seleccionados.

La API no expone el cuerpo del correo, referencias privadas de Gmail ni las acciones administrativas de confirmar, rechazar o redistribuir libremente. La relación exige un motivo operativo y el monto debe cuadrar antes de confirmar.

## Convivencia con el flujo administrativo

El panel administrativo conserva el detalle completo y las acciones avanzadas mediante `bank-email-api`. Las asignaciones creadas desde el flujo específico de Caja usan el vínculo exacto por `caja_id`; las asignaciones administrativas o históricas pueden no tenerlo y no se presentan como conciliación exacta de Caja.

## Checkout y cambios posteriores

El checkout no rompe una conciliación que ya tenga un vínculo de Caja válido. Antes de modificar el estado se consulta `bank_payment_has_valid_caja_link`.

La reparación posterior también cubre datos heredados:

- vuelve a reconocer como conciliada una transferencia con relación exacta y válida;
- mantiene en revisión manual cualquier relación histórica ambigua;
- nunca elige silenciosamente entre varios movimientos candidatos.

## Compatibilidad histórica

La primera implementación de Fase 9 resolvía el estado mediante referencias operativas como `pago_reserva_id`, `reserva_id`, `venta_id` y asignaciones por reserva o venta. Ese mecanismo se conserva solo como respaldo para filas antiguas sin `caja_id`.

Para toda relación nueva, la fuente de verdad es `bank_payment_allocations.caja_id`.
