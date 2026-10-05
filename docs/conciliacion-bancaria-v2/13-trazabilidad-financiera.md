# Fase 13/24 — Trazabilidad financiera de punta a punta

## Principio rector

El documento operativo explica **qué ocurrió**; Caja registra **cómo entró o salió el dinero**; `account_movements` proyecta ese movimiento a la cuenta financiera; la conciliación bancaria aporta **evidencia externa**. Ninguna capa vuelve a cobrar ni crea un segundo asiento por relacionar o confirmar un correo.

## Mapa canónico

| Operación | Documento fuente | Movimiento de dinero | Ledger | Evidencia bancaria |
|---|---|---|---|---|
| Habitación/reserva | `reservas` + `pagos_reserva` | `caja.pago_reserva_id` | `account_movements.caja_id` | allocation `reservation` + `allocation.caja_id` |
| Tienda | `ventas_tienda` + detalles | una o varias `caja.venta_tienda_id` | un ledger por cada Caja | allocation `sale/tienda` + `allocation.caja_id` |
| Restaurante | `ventas_restaurante` + ítems | una o varias `caja.venta_restaurante_id` | un ledger por cada Caja | allocation `sale/restaurante` + `allocation.caja_id` |
| Terraza | `terraza_pedidos` + pagos/ítems | una o varias `caja.venta_terraza_id` | un ledger por cada Caja | allocation `sale/terraza` + `allocation.caja_id` |
| Gasto/cuenta por pagar | `expenses` + `expense_payments` | `expense_payments.caja_id` | `expense_payments.account_movement_id` | futura evidencia saliente, solo enlace |
| Transferencia entre cuentas | `account_transfers` | no pasa por Caja | exactamente `out` + `in` | futura evidencia saliente, solo enlace |

## Cardinalidades obligatorias

- Un movimiento de Caja dentro del período shadow y con método de pago produce exactamente un `account_movements` por `caja_id`.
- Un pago de gasto referencia exactamente una Caja y el mismo movimiento del ledger.
- Una venta puede tener varias filas de Caja por pago mixto o reversiones; eso no representa ventas duplicadas.
- Una transferencia entre cuentas produce dos movimientos de ledger con el mismo `transfer_id` y direcciones distintas.
- Una asignación bancaria enlaza evidencia, documento operativo y, para el flujo de recepción, el movimiento exacto de Caja.
- Un `caja.id` no puede estar asociado a dos eventos bancarios.
- Confirmar, revisar, rechazar o relacionar un evento no cambia el monto operativo ya registrado.

## Flujo de escritura

1. El RPC operativo crea el documento y su movimiento de Caja en una sola transacción.
2. `fase2_project_caja_to_account_trg` proyecta la fila de Caja al ledger.
3. `account_movements.caja_id UNIQUE` impide una segunda proyección.
4. El cambio de método usa `actualizar_metodo_pago_caja`, que actualiza Caja y ledger en la misma transacción.
5. La conciliación guarda `bank_payment_allocations` y, desde recepción, el `caja_id` exacto de cada movimiento seleccionado.
6. La restricción única parcial impide reutilizar una Caja en otra transferencia.
7. Las lecturas resuelven primero el vínculo exacto. La inferencia histórica solo se usa para filas antiguas sin `caja_id` y falla de forma cerrada si es ambigua.

## Integridad durante checkout

`bank_payment_has_valid_caja_link` comprueba que el evento cuadre y que cada asignación conserve hotel, monto, tipo, método y destino compatibles con su Caja. Un checkout no degrada un evento que mantiene ese vínculo válido.

Los datos heredados que antes quedaron en `manual_review` con razón `reservation_inactive` pueden volver a `matched` si la relación exacta es válida. Una relación legacy ambigua conserva `manual_review`; nunca se elige un movimiento silenciosamente.

## Evidencia productiva histórica — 26 de agosto de 2026

La consulta de solo lectura ejecutada entonces sobre producción encontró:

- 402 movimientos operativos dentro de shadow desde el 25 de agosto;
- 0 movimientos sin ledger;
- 0 divergencias de hotel, monto o dirección Caja↔ledger;
- 208 pagos de reserva recientes y 0 sin Caja;
- 2 pagos de gastos y 0 relaciones incompletas o divergentes;
- 0 asignaciones con hotel divergente, monto inválido o suma superior al evento.

En esa fecha todavía no había asignaciones confirmadas. Esta evidencia es histórica y no sustituye la aceptación funcional pendiente con transferencias reales en el hotel de prueba.

## Datos históricos

Existen pagos de reserva anteriores al endurecimiento sin `caja.pago_reserva_id`. No se rellenan automáticamente porque crear Caja retrospectiva alteraría cierres históricos.

Las referencias repetidas de tienda, restaurante y terraza tampoco son duplicados por sí solas: esos módulos permiten pagos mixtos y reversiones. La comprobación financiera correcta sigue la cadena `caja.id -> account_movements.caja_id`; la evidencia bancaria añade `bank_payment_allocations.caja_id -> caja.id`.

## Regla para desarrollos siguientes

Toda integración financiera elige un único documento fuente y reutiliza Caja y ledger existentes. La evidencia externa se enlaza; no vuelve a materializar el dinero. Cualquier excepción requiere migración, idempotencia, auditoría y una prueba que demuestre que un reintento no aumenta saldos.

## Rollback

Retirar la interfaz de conciliación oculta sus estados y relaciones; Caja y ledger permanecen intactos. El esquema de vínculo exacto solo se revierte después de comprobar que no existan `caja_id` activos y de conservar la evidencia de auditoría.
