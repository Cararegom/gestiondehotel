# Fase 12/24 — Diseño de movimientos bancarios salientes

## Decisión

Una transferencia enviada, débito, retiro o reversión de ingreso no es un pago recibido ni un egreso contable confirmado. El correo es evidencia bancaria y debe conservarse en una bandeja administrativa separada llamada **Movimientos bancarios por clasificar**.

Esta fase no activa escrituras financieras. El parser actual continúa rechazando `sent` / `outgoing_transfer_detected`, por lo que ninguna salida crea ingresos negativos, movimientos de Caja, gastos, pagos o asientos del ledger.

## Modelo propuesto para una fase posterior

### `bank_outgoing_events`

- `id`, `hotel_id`, `integration_id` y huella irreversible del mensaje para deduplicación.
- `bank_name`, `amount_cop` siempre positivo, `transaction_occurred_at` y referencia parcial.
- `counterparty_name` cuando sea extraíble de forma segura.
- `kind`: `transfer`, `debit`, `withdrawal`, `reversal` u `other`.
- `status`: `unclassified`, `classified`, `needs_review`, `ignored` o `duplicated`.
- `parser_id`, `parser_version`, `review_reason` y metadatos técnicos sin cuerpo completo del correo.
- Restricción única por `(hotel_id, integration_id, message_fingerprint)`.
- RLS habilitado; sin acceso para `anon`; lectura y clasificación exclusivamente administrativa.

### `bank_outgoing_allocations`

Permite distribuir una salida entre uno o varios destinos sin crear un segundo documento financiero:

- `expense_payment` → `expense_payments.id` para un gasto ya pagado.
- `expense` → `expenses.id` cuando la salida corresponde a una cuenta por pagar existente.
- `account_transfer` → `account_transfers.id` para traslado entre cuentas propias.
- `owner_withdrawal`, `refund` u `other` → documento financiero explícito antes de enlazar.

Cada asignación guarda monto positivo, actor, fecha y operación idempotente. La suma no puede superar el monto del evento. Un destino no puede usar dos veces el mismo evento y toda corrección conserva before/after en auditoría.

## Flujo

1. El webhook autentica el correo y determina primero su dirección.
2. `incoming` sigue el flujo actual de pagos recibidos.
3. `outgoing` se guarda únicamente como evidencia sin clasificar y nunca entra en `bank_payment_events`.
4. Solo un administrador abre la bandeja, revisa monto, fecha y contraparte y selecciona un destino existente.
5. Si falta el gasto o transferencia, el administrador lo crea mediante los RPC financieros existentes y luego enlaza la evidencia; la clasificación no duplica Caja ni ledger.
6. Ignorar exige motivo. Reclasificar exige motivo y auditoría.

## Interfaz propuesta

La bandeja vivirá dentro de **Reportes → Conciliación bancaria**, en una pestaña independiente de **Pagos recibidos**. Mostrará fecha, monto positivo, banco, contraparte parcial, tipo sugerido, estado y acción. Recepción no verá la pestaña ni recibirá globos por salidas.

Nunca se mostrará una salida como “Rechazada” entre pagos recibidos. Los estados serán humanos: **Por clasificar**, **Requiere revisión**, **Clasificada**, **Ignorada** y **Duplicada**.

## Seguridad y consistencia

- Piloto limitado por el UUID/nombre autoritativo de Hotel Marena San Isidro.
- Autorización derivada de `usuarios` y `usuarios_roles`, no de `user_metadata`.
- Escrituras únicamente por RPC/Edge Function con actor autenticado, hotel validado, bloqueo de filas e idempotencia.
- No se almacenan cuerpo HTML, asunto completo, tokens OAuth ni referencia bancaria completa en respuestas al navegador.
- La clasificación nunca inserta directamente en Caja o ledger. Solo enlaza un documento creado por el flujo financiero autorizado.

## Migración de eventos históricos

Una futura migración copiará únicamente eventos `rejected` cuyo motivo verificable sea `outgoing_transfer_detected`. No modificará ni borrará el registro histórico original; lo marcará como migrado mediante relación auditable. Los rechazos por remitente no confiable, autenticación fallida o monto inválido no se convertirán en salidas.

## Criterios para activar la implementación

- Pruebas de transferencia enviada, débito, retiro, reversión y correo falsificado.
- Cero ingresos, Caja, gastos o ledger antes de clasificación explícita.
- Clasificación idempotente y aislada por hotel.
- Un gasto existente se enlaza sin duplicarlo.
- Recepción y otro hotel reciben 403 y no ven conteos.
- Gmail caído no afecta Caja ni el cierre del turno.

## Rollback

Ocultar la pestaña y detener la captura de salidas. La evidencia queda sin clasificar; no hay asientos que revertir porque esta fase no automatiza efectos financieros.
