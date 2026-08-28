# Ajuste: recepción relaciona transferencias desde Caja

## Objetivo
Permitir que recepción relacione una transferencia bancaria con movimientos operativos ya registrados en Caja, manteniendo separados los privilegios de confirmación bancaria.

## Permisos
- Recepción puede ejecutar únicamente la acción `link` para relacionar/distribuir una transferencia.
- Recepción no puede ejecutar `confirm`, `reject` ni `mark_reviewed`.
- La suma de las asignaciones debe coincidir exactamente con el valor de la transferencia.
- Toda acción manual exige motivo y queda auditada con actor, acción y motivo.
- La interfaz operativa no expone pagador, referencia bancaria, Gmail ni contenido del correo.

## Validación de staging — 2026-08-28
- GitHub Actions CI #112: PASS completo (dependency audit, syntax, Deno typecheck, lint, tests y build).
- Migración `recepcion_relacion_pagos_bancarios` registrada en staging como versión `20260828065711`.
- Edge Function `bank-payment-relation-api` v1: ACTIVE, `verify_jwt=true`, SHA256 `1c2ea995bb01b0a418e650a9a4191a2c4fe4dd26d9be9516628e7c11c0f79eef`.
- Suite transaccional de comportamiento: 5/5 PASS y `ROLLBACK`.
  1. Recepción relaciona COP 60.000 de habitación + COP 22.500 de tienda contra transferencia COP 82.500.
  2. Auditoría normalizada persiste actor, acción `link` y motivo.
  3. Recepción recibe SQLSTATE `42501` al intentar `confirm` y el evento sigue sin confirmar.
  4. Motivo vacío para `link` recibe SQLSTATE `22023` y no modifica el evento.
  5. Snapshot de auditoría manual no incluye campos bancarios sensibles comprobados.
- Verificación post-rollback: 0 hoteles, usuarios, habitaciones, reservas, ventas, eventos, allocations y auditorías del fixture.
- Security Advisor: 0 ERROR atribuibles al ajuste; continúan WARN/INFO históricos del proyecto.
- Performance Advisor: 0 ERROR atribuibles al ajuste; continúan WARN/INFO históricos del proyecto.
- Logs de Edge Functions posteriores al despliegue: sin entradas de error registradas al momento del gate.

## Estado de release
Staging validado. Producción permanece sin cambios hasta autorización explícita para merge y despliegue.
