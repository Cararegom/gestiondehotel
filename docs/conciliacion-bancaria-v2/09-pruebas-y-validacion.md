# Pruebas y validación

## Fase 9/24 — Caja y estado bancario

- Marena: la columna bancaria se habilita por UUID exacto.
- Otro hotel: la columna permanece oculta y no llama `cash-movement-statuses`.
- La API exige usuario operativo activo del piloto y limita la solicitud a 200 movimientos.
- La relación usa claves persistidas de pagos/ventas y allocations; no usa monto, fecha o concepto.
- La consulta es de solo lectura: no inserta pagos, Caja ni ledger.
- Efectivo, egresos y reversiones quedan como `No aplica`.

## Capas

- SQL/pgTAP o transacciones de prueba para constraints, RPC, RLS y atomicidad.
- Backend para parser, idempotencia, DTO y códigos de error.
- Frontend para restauración, sumas, permisos y mensajes humanos.
- Regresión de reservas/liberación, pagos, Caja/cierre, Tienda, Restaurante, Terraza, inventarios, gastos, cuentas, reportes, auth y roles.

## Casos financieros obligatorios

1. 60.000→reserva; 40.000→tienda; 100.000→60.000 reserva+20.000 tienda+20.000 terraza.
2. Sumas 90.000 y 110.000 para evento 100.000: rechazo sin cambios.
3. Destino de otro hotel, recepción redistribuyendo y admin de otro hotel: rechazo.
4. Admin Marena: aceptación y auditoría.
5. Reabrir tres allocations: aparecen tres; reserva usa solo su allocation.
6. Venta pagada por transferencia: candidata sin segundo cobro.
7. Venta totalmente conciliada: segunda relación rechazada/revisión.
8. Falla de auditoría o allocation: estado y distribución anteriores intactos.
9. Correo duplicado: un evento; Gmail caído: operación/Caja continúan.

## Evidencias por fase

Guardar comando, resultado, versión de migración/Edge Function y actor de prueba. Usar `metadata.is_test=true`; no usar transferencias reales arbitrarias. Ejecutar advisors de seguridad/rendimiento después de DDL. Ninguna fase se acepta solo por regex sobre archivos.

## Evidencia Fase 2 — 2026-08-25

Se ejecutó un fixture SQL dentro de `BEGIN … ROLLBACK` en producción, usando un evento `simulation` con `metadata.is_test=true`. Validó: allocation única y resumen legacy; rechazo de 90.000 contra evento de 100.000; conservación byte a byte de la distribución anterior después del rechazo; distribución mixta 60.000 reserva + 40.000 tienda; columnas legacy nulas para el caso mixto; suma real 100.000; dos entradas `multiple_allocation_changed`. Tras el rollback quedaron 0 eventos y 0 allocations de la prueba. Se verificó además que el RPC no es ejecutable por `PUBLIC`, `anon` ni `authenticated`, y sí por `service_role`.

## Evidencia Fase 3 — 2026-08-25

`bank-email-api` v17 obtiene allocations filtrando simultáneamente por hotel piloto y evento, y enriquece reservas, habitaciones, ventas y sus detalles sin exponer datos de otro tenant. El servicio conserva el arreglo y la UI presenta la distribución persistida, reincorpora destinos ya pagados que no aparecen entre candidatos y restaura cada importe. Una guardia bloquea el reemplazo si un registro histórico contiene varias reservas. Resultado local: 121 pruebas aprobadas, sintaxis validada en 156 archivos, `deno check` y `deno lint` sin errores.

## Evidencia Fase 4 — 2026-08-25

`bank-email-api` v18 dejó de acreditar a una reserva el monto completo de `bank_payment_events`. Para eventos `matched` o `confirmed` sin expectativa asociada, suma exclusivamente allocations de tipo `reservation`, filtradas por el UUID del piloto. Las pruebas de comportamiento validan un split 60.000 reserva + 40.000 ventas y descartan eventos pendientes o montos inválidos. Resultado local: 124 pruebas aprobadas, sintaxis validada en 157 archivos, `deno check` y `deno lint` sin errores. El precheck productivo encontró un solo hotel piloto, cero eventos comprometidos y cero sumas inválidas; no se modificaron datos.

## Evidencia Fase 5 — 2026-08-26

La migración productiva `20260826181130_fase5_ventas_bancarias_conciliables` creó el dominio conciliable y actualizó el reemplazo atómico de allocations. Una venta real de Tienda marcada `pagado` con método Bancolombia devolvió `true`; una venta en efectivo y una venta de otro hotel devolvieron `false`. Los permisos efectivos fueron `anon=false`, `authenticated=false`, `service_role=true`. La API v19 consulta únicamente métodos bancarios del piloto y ya no filtra candidatos por `estado_pago`. Resultado local: 126 pruebas aprobadas, sintaxis validada en 158 archivos, typecheck y lint sin errores. Los advisors no atribuyeron hallazgos nuevos a los objetos de esta fase; permanecen hallazgos históricos fuera de alcance documentados en la auditoría general.

## Evidencia Fase 6 — 2026-08-26

La migración productiva `20260826183106_fase6_prevenir_doble_conciliacion` incorporó saldo disponible y bloqueo transaccional por venta. Un fixture `simulation` ejecutado dentro de `BEGIN … ROLLBACK` comprobó saldo parcial de 1.500 sobre una venta de 2.500, exclusión correcta del evento actual, saldo cero tras completar la asignación y retorno nulo para otro hotel. La API v20 descuenta allocations activas y oculta candidatos sin saldo. Resultado local previo al despliegue: 129 pruebas aprobadas, sintaxis validada en 159 archivos, typecheck y lint sin errores.

## Evidencia Fase 7 — 2026-08-26

`bank-email-api` v21 consulta en lotes detalles y catálogos de Tienda, Restaurante y Terraza, limita ventas a siete días alrededor de la transferencia y devuelve como máximo 60 candidatos ordenados por cercanía temporal. Las reservas incluyen total, pagado, pendiente, huésped, habitación y fecha. La interfaz muestra valor disponible, fecha/hora y distancia temporal sin usar UUID como etiqueta principal. El esquema productivo confirmó una sola coincidencia del piloto, 14 hoteles no piloto y las tres tablas de detalle requeridas. Resultado local: 132 pruebas aprobadas, sintaxis validada en 160 archivos, typecheck y lint sin errores.

## Evidencia Fase 8 — 2026-08-26

`bank-email-api` v22 separa `canManageReconciliation` de `canViewOperationalStatus`. Las lecturas completas y mutaciones exigen administrador dentro de la Edge Function; recepción conserva un resumen sin información bancaria sensible. Producción confirmó 10 perfiles operativos y un administrador activo en el único hotel piloto, además de 14 hoteles no piloto. Resultado local: 135 pruebas aprobadas, sintaxis validada en 161 archivos, typecheck y lint sin errores.
