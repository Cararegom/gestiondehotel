# Flujo de recepción

Recepción continúa trabajando en Reserva, Tienda, Restaurante, Terraza y Caja. Registra la operación y su ingreso una sola vez. La conciliación relaciona la evidencia bancaria con ese movimiento existente y nunca pide recrear el cobro.

## Experiencia actual

1. Registra la operación pagada con un método bancario habilitado.
2. Caja muestra el estado de conciliación del movimiento.
3. Desde `Conciliar pago`, consulta transferencias pendientes dentro de una ventana de ±48 horas.
4. Selecciona entre 1 y 20 movimientos que pertenecen al mismo destino operativo.
5. La interfaz exige que la suma coincida exactamente con la transferencia y solicita un motivo.
6. Al confirmar, el backend guarda la relación exacta por `bank_payment_allocations.caja_id` y registra la auditoría.
7. Caja muestra el estado actualizado sin crear otro ingreso.

Una inconsistencia se presenta como revisión manual, sin detalles técnicos. La recepción puede cerrar turno aunque Gmail esté temporalmente fuera de servicio; el bloque bancario continúa siendo informativo durante el piloto.

## Límites de acceso

No puede abrir la consola completa de conciliación bancaria, editar el monto o la referencia del evento, confirmar o rechazar transferencias, redistribuirlas libremente, borrar evidencia ni ver el contenido del correo.

La ruta `#/pagos-bancarios` y las acciones completas de `bank-email-api` siguen restringidas a administradores. El flujo de Caja usa `bank-payment-relation-api`, cuyo contrato reducido permite consultar estados, listar datos sanitizados, buscar candidatos y ejecutar solo `link`.

La API de recepción no devuelve identificadores de Gmail, referencias bancarias privadas ni el cuerpo del mensaje. Los códigos internos de RPC/RLS se conservan en logs seguros y la interfaz muestra errores operativos comprensibles.

## Evolución del alcance

Fase 8 introdujo un resumen operativo de solo lectura y mantuvo el panel completo bloqueado para recepción. Fase 25 añadió la relación controlada desde Caja sin ampliar los privilegios administrativos. La evolución posterior incorporó `caja_id` para que toda relación nueva apunte al movimiento exacto y no dependa de una inferencia por monto o fecha.

## Aceptación funcional

En el hotel de prueba se debe comprobar al menos:

- recepción ve únicamente transferencias y movimientos del hotel piloto;
- otro hotel no ve menú, estados, canales Realtime ni datos del piloto;
- una suma diferente se rechaza sin cambios parciales;
- un movimiento ya usado no puede asociarse a otra transferencia;
- el motivo es obligatorio y aparece en la auditoría;
- el cierre o checkout conserva una conciliación exacta y válida;
- una relación histórica ambigua queda en revisión manual.

Esta aceptación manual está aplazada hasta disponer de datos adecuados en el hotel de prueba. Las restricciones se cubren además con pruebas automatizadas y validaciones transaccionales.
