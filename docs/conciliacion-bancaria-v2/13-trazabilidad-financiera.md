# Fase 13/24 — Trazabilidad financiera de punta a punta

## Principio rector

El documento operativo explica **qué ocurrió**; Caja registra **cómo entró o salió el dinero**; `account_movements` proyecta ese movimiento a la cuenta financiera; la conciliación bancaria aporta **evidencia externa**. Ninguna capa vuelve a cobrar ni crea un segundo asiento por confirmar un correo.

## Mapa canónico

| Operación | Documento fuente | Movimiento de dinero | Ledger | Evidencia bancaria |
|---|---|---|---|---|
| Habitación/reserva | `reservas` + `pagos_reserva` | `caja.pago_reserva_id` | `account_movements.caja_id` | allocation `reservation` |
| Tienda | `ventas_tienda` + detalles | uno o varios `caja.venta_tienda_id` por pagos mixtos/reversiones | un ledger por cada Caja | allocation `sale/tienda` |
| Restaurante | `ventas_restaurante` + ítems | uno o varios `caja.venta_restaurante_id` | un ledger por cada Caja | allocation `sale/restaurante` |
| Terraza | `terraza_pedidos` + pagos/ítems | uno o varios `caja.venta_terraza_id` | un ledger por cada Caja | allocation `sale/terraza` |
| Gasto/cuenta por pagar | `expenses` + `expense_payments` | `expense_payments.caja_id` | `expense_payments.account_movement_id` | futura evidencia saliente, solo enlace |
| Transferencia entre cuentas | `account_transfers` | no pasa por Caja | exactamente `out` + `in` | futura evidencia saliente, solo enlace |

## Cardinalidades obligatorias

- Un movimiento de Caja dentro del período shadow y con método de pago produce exactamente un `account_movements` por `caja_id`.
- Un pago de gasto referencia exactamente una Caja y el mismo movimiento del ledger.
- Una venta puede tener varias filas de Caja por pago mixto o reversiones; eso no representa ventas duplicadas.
- Una transferencia entre cuentas produce dos movimientos de ledger con el mismo `transfer_id` y direcciones distintas.
- Una allocation bancaria enlaza evidencia con un documento operativo. No inserta ni actualiza Caja, pagos, ventas o ledger.
- Confirmar, revisar o rechazar un evento bancario no cambia el monto operativo ya registrado.

## Flujo de escritura

1. El RPC operativo crea el documento y su movimiento de Caja en una sola transacción.
2. El trigger `fase2_project_caja_to_account_trg` proyecta la fila de Caja al ledger.
3. `account_movements.caja_id UNIQUE` impide una segunda proyección.
4. El cambio de método usa `actualizar_metodo_pago_caja`, que actualiza Caja y ledger en la misma transacción.
5. La conciliación guarda únicamente `bank_payment_allocations`; las lecturas de Caja resuelven el estado mediante las referencias persistidas.

## Resultado productivo del 26 de agosto de 2026

Consulta de solo lectura ejecutada sobre el proyecto `iikpqpdoslyduecibaij`:

- 402 movimientos operativos dentro de shadow desde el 25 de agosto.
- 0 movimientos sin ledger.
- 0 divergencias de hotel, monto o dirección Caja↔ledger.
- 208 pagos de reserva recientes y 0 sin Caja.
- 2 pagos de gastos y 0 relaciones incompletas o divergentes.
- 0 allocations con hotel divergente, monto inválido o suma superior al evento.
- Actualmente hay 0 allocations confirmadas; por tanto la arquitectura está validada, pero el caso real completo deberá incluirse en las pruebas E2E de las Fases 21–24.

## Datos históricos

Existen 251 pagos de reserva anteriores al endurecimiento sin `caja.pago_reserva_id` y 11 entre el 10 y el 23 de agosto. Son datos legacy anteriores al corte actual; no se rellenan automáticamente porque crear Caja retrospectiva alteraría cierres históricos. Desde el 25 de agosto el indicador es cero.

Las referencias repetidas de tienda, restaurante y terraza no se consideran por sí solas duplicados: esos módulos permiten pagos mixtos y reversiones. La prueba correcta se hace por `caja.id → account_movements.caja_id`, donde la relación es única.

## Regla para desarrollos siguientes

Toda nueva integración financiera debe elegir un único documento fuente y reutilizar Caja/ledger existentes. Si recibe evidencia externa, debe enlazarla; nunca volver a materializar el dinero. Cualquier excepción requiere migración, idempotencia, auditoría y una prueba que demuestre que reintentar no aumenta saldos.

## Rollback

Esta fase no cambia esquema ni datos. Para retirar la conciliación se ocultan sus estados y allocations; Caja y ledger permanecen intactos.
