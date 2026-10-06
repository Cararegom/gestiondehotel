# Plan de implementación por fases

Cada cambio de esquema se implementó mediante una migración nueva, con precheck de datos y sin editar migraciones ejecutadas. Esta tabla conserva el propósito de cada fase y refleja su estado al 21 de septiembre de 2026.

| Fase | Estado | Resultado principal |
|---|---|---|
| 1 | ✅ | Auditoría de código, Edge Functions, esquema, permisos y deriva. |
| 2 | ✅ | Constraints compatibles, reemplazo atómico de asignaciones e índices. |
| 3 | ✅ | API y UI leen, muestran y restauran `allocations[]`. |
| 4 | ✅ | La reserva acredita únicamente la suma asignada a ella. |
| 5 | ✅ | Dominio de ventas bancarias conciliables separado del estado pagado. |
| 6 | ✅ | Saldo conciliable y locks impiden reutilizar una venta. |
| 7 | ✅ | Candidatos humanos, acotados, ordenados y consultados en lotes. |
| 8 | ✅ | Panel completo solo para administración; recepción recibe resumen sanitario. |
| 9 | ✅ | Caja muestra estado bancario sin crear movimientos. La lectura inicial por referencias quedó como compatibilidad legacy. |
| 10 | ✅ | Cambio de método sincroniza Caja y ledger dentro de un RPC atómico. |
| 11 | ✅ | Cierre muestra el bloque bancario informativo y conserva el arqueo de efectivo. |
| 12 | ✅ diseño | Modelo de movimientos salientes definido y separado del flujo de ingresos. |
| 13 | ✅ | Mapa canónico documento → Caja → ledger → evidencia bancaria. |
| 14–15 | ✅ | Auditoría before/after, actor, motivo y mínimos privilegios. |
| 16–17 | ✅ | Pruebas SQL, backend, frontend y regresión financiera. |
| 18–20 | ✅ | Gate del piloto, UX operativa y aislamiento por hotel. |
| 21–24 | ✅ | Logs, despliegue controlado, checklist y release técnico. |
| 25 | ✅ | Recepción relaciona desde Caja mediante una API limitada a `link`. |
| Posterior a 25 | ✅ | `bank_payment_allocations.caja_id`, unicidad por Caja, validación de integridad y preservación durante checkout. |
| Auditoría M3 | ✅ | Posibles notificaciones duplicadas se conservan y pasan a revisión manual. |

## Evolución de Fase 9 a Fase 25

Fase 9 introdujo una lectura de estado a partir de referencias persistidas de pagos, reservas y ventas. Fase 25 habilitó una acción operativa limitada para recepción. La evolución posterior eliminó la ambigüedad en relaciones nuevas al guardar el identificador exacto en `bank_payment_allocations.caja_id`.

El respaldo por referencia, monto y ventana temporal solo existe para filas antiguas sin `caja_id`. Si aparecen varios candidatos, el sistema no elige uno y devuelve revisión manual.

## Estado de cierre técnico

Las Fases 1 a 25 están cerradas técnicamente. El flujo administrativo, la relación desde recepción, el vínculo exacto con Caja, la auditoría y las restricciones de base de datos están implementados y cubiertos por pruebas automatizadas.

Antes de producción quedan dos gates externos al desarrollo de estas fases:

1. ejecutar la aceptación funcional aplazada con datos controlados del hotel de prueba;
2. obtener autorización explícita para aplicar migraciones y desplegar Edge Functions y frontend en producción.

El diseño de movimientos bancarios salientes de Fase 12 continúa como alcance futuro independiente; no se mezcla con la conciliación de ingresos.
