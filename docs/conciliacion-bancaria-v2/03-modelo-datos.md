# Modelo de datos

## Entidades bancarias

- `bank_payment_events`: evento detectado, monto COP, fecha, banco, referencia enmascarada, estado y columnas legacy.
- `bank_payment_allocations`: relación N:M entre el evento y su destino operativo. Cada fila apunta a `reservation`, `room` o `sale`, guarda `amount_cop > 0`, tipo de venta, actor y, cuando proviene del flujo de Caja, el `caja_id` exacto.
- `bank_payment_audit_log`: bitácora append-only de eventos y cambios administrativos.
- `expected_payments`: expectativa previa; no sustituye una operación ni un movimiento de Caja.

## Entidades operativas relacionadas

Reservas y pagos usan `reservas` y `pagos_reserva`. Las ventas usan `ventas_tienda`, `ventas_restaurante`, `terraza_pedidos` y sus detalles. Caja usa `caja`, turnos, cierres y `metodos_pago`. El ledger financiero usa cuentas, `account_movements`, gastos y transferencias entre cuentas.

## Invariantes actuales

1. El evento, la asignación, el destino y el movimiento de Caja pertenecen al mismo hotel piloto.
2. Cada asignación tiene exactamente un destino lógico y un monto entero positivo.
3. Un evento confirmado o relacionado debe cuadrar: `SUM(allocation.amount_cop) = event.amount_cop`.
4. Una venta totalmente conciliada no puede exceder su importe activo entre eventos vinculados.
5. Una reversión no borra evidencia: cambia vigencia o estado y genera auditoría.
6. Las columnas legacy no intervienen en sumas ni unicidad financiera.
7. Un movimiento de Caja solo puede respaldar una transferencia.
8. Una relación exacta de Caja conserva tipo `ingreso`, método bancario activo, monto y destino operativo equivalentes a la asignación.

## Evolución de las asignaciones

Fase 2 normalizó las relaciones múltiples y mantuvo las columnas legacy solo como resumen. `bank_payment_events_relation_state_check` reconoce asignaciones mediante metadata y `bank_email_validate_allocation_event_trg` valida las filas reales.

Fase 6 añadió `bank_email_sale_available_amount_cop` y serialización por hotel, tipo y venta para impedir que dos eventos consuman el mismo saldo disponible.

La evolución posterior añadió a `bank_payment_allocations`:

- `caja_id` nullable para conservar compatibilidad con relaciones administrativas e históricas;
- clave foránea a `caja` con `ON DELETE RESTRICT`;
- índice de consulta por `caja_id`;
- restricción única parcial para impedir que una Caja se use en dos eventos.

Las relaciones creadas desde `bank-payment-relation-api` deben guardar `caja_id`. Las filas antiguas sin ese dato se consideran legacy y solo admiten una inferencia de lectura acotada y no ambigua.

## Escritura desde Caja

`replace_bank_payment_allocations_from_caja` recibe los movimientos seleccionados, vuelve a validar hotel, monto, tipo, método, destino y unicidad dentro de la transacción, delega el reemplazo de asignaciones y persiste los `caja_id` exactos. El RPC registra la acción `link` y exige un motivo.

`bank_payment_has_valid_caja_link` verifica que todas las asignaciones del evento tengan Caja, que la suma cuadre y que cada movimiento siga cumpliendo sus invariantes. El checkout usa este resultado para no degradar una relación válida.

## Precheck obligatorio

Antes de cualquier DDL o despliegue se revisan eventos legacy mixtos, asignaciones huérfanas, sumas diferentes, destinos cross-tenant, ventas duplicadas, `caja_id` repetidos o inválidos y acciones de auditoría fuera del catálogo. El procedimiento se ejecuta aunque el entorno no tenga asignaciones activas.
