# Fase 25 — Recepción relaciona transferencias desde Caja

## Objetivo

Permitir que recepción relacione una transferencia bancaria con movimientos operativos ya registrados en Caja, manteniendo separados los privilegios de confirmación bancaria y evitando un segundo registro monetario.

## Contrato actual de la API

La Edge Function `bank-payment-relation-api` exige JWT y acepta estas acciones:

| Acción | Resultado |
|---|---|
| `status` | Confirma si la integración está disponible para el usuario y hotel actuales. |
| `list` | Devuelve transferencias pendientes con un conjunto mínimo de campos. |
| `movement-statuses` | Resuelve el estado bancario de movimientos de Caja. |
| `cash-candidates` | Busca movimientos compatibles dentro de una ventana de ±48 horas. |
| `relate` | Relaciona la transferencia con movimientos exactos de Caja. |

El servidor valida sesión, perfil activo, rol operativo y pertenencia al hotel piloto. Solo se pueden relacionar eventos en estado `detected` o `manual_review`.

## Reglas de relación

- Se seleccionan entre 1 y 20 movimientos.
- Todos pertenecen al hotel piloto y son ingresos no revertidos.
- El método de pago es bancario, está activo y apunta a una cuenta bancaria habilitada.
- Cada movimiento coincide con el destino operativo de su asignación.
- Ningún movimiento está relacionado con otra transferencia.
- La suma seleccionada coincide exactamente con `bank_payment_events.amount_cop`.
- La acción es siempre `link` y exige un motivo de hasta 500 caracteres.

La API invoca `replace_bank_payment_allocations_from_caja`. El RPC repite las validaciones dentro de la transacción, guarda `bank_payment_allocations.caja_id` y registra actor, acción y motivo. El navegador no puede ejecutar ese RPC directamente.

## Datos visibles para recepción

La respuesta limita cada transferencia a su identificador operativo, monto, estado, remitente truncado y fechas necesarias. No expone el cuerpo del correo, referencias o identificadores de Gmail ni metadata bancaria privada.

Recepción no puede ejecutar `confirm`, `reject`, `mark_reviewed` ni las acciones avanzadas de redistribución disponibles en el panel administrativo.

## Lectura del estado en Caja

Para relaciones nuevas, `movement-statuses` consulta primero el vínculo exacto por `bank_payment_allocations.caja_id`. El mecanismo histórico por destino, monto y ventana temporal se usa únicamente cuando la asignación heredada no tiene `caja_id`.

Si el respaldo histórico encuentra más de un candidato, no elige uno: devuelve revisión manual. De esta manera el flujo falla de forma cerrada.

## Validación histórica de staging — 2026-08-28

La primera versión de la fase quedó validada con:

- GitHub Actions CI #112 completo;
- migración `recepcion_relacion_pagos_bancarios` aplicada en staging;
- `bank-payment-relation-api` v1 activa con `verify_jwt=true`;
- suite transaccional de 5 casos con `ROLLBACK`;
- rechazo de `confirm` para recepción;
- rechazo de motivo vacío;
- auditoría sin campos bancarios sensibles;
- fixture eliminado sin datos residuales.

Esta evidencia corresponde a la implementación inicial. Las migraciones posteriores agregaron el vínculo exacto por `caja_id`, su restricción única, la verificación de integridad y la preservación durante checkout.

## Estado actual de release

El contrato actual está cubierto por `tests/recepcion-bank-relation.test.cjs` y `tests/conciliacion-caja-id.test.cjs`. La aceptación manual con datos reales del hotel de prueba continúa aplazada. Producción permanece sin cambios hasta una autorización explícita de despliegue.
