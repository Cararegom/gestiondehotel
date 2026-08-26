# Plan de implementación por fases

Cada cambio de esquema se hará en una migración nueva, con precheck de datos y sin editar migraciones ejecutadas. Cada fase termina con revisión, pruebas y checkpoint antes de continuar.

| Fase | Problema / causa | Solución y superficies | Pruebas / aceptación | Riesgo / rollback |
|---|---|---|---|---|
| 1 | Estado supuesto y deriva producción/repositorio | Auditar código, Edge Functions, esquema y permisos; estos documentos | `HEAD=origin/main`, inventario y hallazgos reproducibles | Solo documentación; revertir carpeta |
| 2 ✅ | Constraints legacy/auditoría bloqueaban allocations | Aplicado: constraints compatibles; RPC valida en dos pasadas, bloquea y reemplaza; índices de FK/consulta | Probado: suma exacta, relación única, split mixto, auditoría y fallo conserva distribución | Monitorear locks/errores; rollback mediante migración compensatoria |
| 3 ✅ | Detalle y UI leían una sola relación | Aplicado: `bank-email-api`, servicio y módulo devuelven, enriquecen, muestran y restauran `allocations[]` | 121 pruebas; reabrir conserva importes y destinos; guardia ante varias reservas | Monitorear latencia; rollback de Edge Function y frontend |
| 4 ✅ | Reserva tomaba monto total del evento | Aplicado en API piloto: compromiso directo por suma de `amount_cop` de allocations `reservation` | split 60/40 acredita 60; eventos no comprometidos no acreditan | Monitorear saldo de candidatos; rollback a v17 |
| 5 ✅ | “pagado” se excluía aunque fuera conciliable | Aplicado: dominio `bank_email_sale_is_reconcilable`; candidatos bancarios de tienda/restaurante/terraza sin filtrar por cobro | venta Bancolombia pagada es conciliable; efectivo y otro hotel no | Candidatos falsos; rollback de migración y Edge v18 |
| 6 | Una venta puede reutilizarse | Validación de total conciliado activo, preparada para parciales/reversiones | segunda conciliación completa rechazada | falsos bloqueos; enviar a revisión |
| 7 | Candidatos poco humanos/costosos | DTO agregado, orden temporal, lote de detalles, límites | nombres/cantidades/fechas; sin UUID principal ni N+1 | latencia; paginación/fallback |
| 8 | Recepción necesita estado, no privilegio admin | Matriz RLS/RPC y vista read-only mínima | recepción lee estado; no redistribuye; otro hotel no lee | escalamiento; revocar vista/RPC |
| 9 | Caja no muestra verificación persistida | Vínculo explícito allocation↔operación/caja y badges | pendiente/verificado/revisión; 0 ingresos nuevos | asociación errónea; ocultar badges |
| 10 | Cambio de método puede divergir ledger | Recuperar migraciones faltantes; RPC de una sola columna y auditoría/sync | solo cambia método, mismo hotel/turno/monto/concepto | deriva financiera; deshabilitar acción |
| 11 | Cierre trata banco como arqueo manual | Panel informativo: registrado, confirmado, pendiente, diferencia; efectivo sigue ciego | Gmail caído no bloquea cierre | confusión operativa; ocultar panel |
| 12 | Salidas se rechazan sin clasificar | Diseñar bandeja separada de movimientos salientes; no mezclar con ingresos | ninguna salida entra como ingreso negativo | alcance alto; mantener solo diseño |
| 13 | Riesgo de segundo sistema financiero | Mapear operación→Caja→ledger→conciliación; no duplicar asientos | trazabilidad de punta a punta | doble contabilización; apagar proyección piloto |
| 14–15 | Auditoría/permisos incompletos | before/after, motivo, actor; mínimos privilegios; cerrar `SECURITY DEFINER` | matriz admin/recepción/otro hotel/anon | romper acceso; migración de restauración puntual |
| 16–17 | Regex no prueba comportamiento | pgTAP/SQL, backend, frontend y regresión completa | 18 casos obligatorios + módulos existentes | datos de prueba; transacciones/fixtures aislados |
| 18–20 | Piloto y UX operativa | Gate UUID; estados simples para recepción; consola completa admin | ninguna evidencia en otro hotel | filtración tenant; kill switch |
| 21–24 | Logs, despliegue y prueba final | logs estructurados, migrations, deploy y checklist controlado | E2E A–H sin dinero arbitrario | operación real; rollback por componente |

## Orden inmediato

Las Fases 2 a 5 están aplicadas exclusivamente sobre la infraestructura protegida del piloto. La siguiente es la Fase 6: impedir que una venta ya totalmente conciliada se reutilice en otro evento bancario.
