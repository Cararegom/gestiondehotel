# Plan de implementación por fases

Cada cambio de esquema se hará en una migración nueva, con precheck de datos y sin editar migraciones ejecutadas. Cada fase termina con revisión, pruebas y checkpoint antes de continuar.

| Fase | Problema / causa | Solución y superficies | Pruebas / aceptación | Riesgo / rollback |
|---|---|---|---|---|
| 1 | Estado supuesto y deriva producción/repositorio | Auditar código, Edge Functions, esquema y permisos; estos documentos | `HEAD=origin/main`, inventario y hallazgos reproducibles | Solo documentación; revertir carpeta |
| 2 ✅ | Constraints legacy/auditoría bloqueaban allocations | Aplicado: constraints compatibles; RPC valida en dos pasadas, bloquea y reemplaza; índices de FK/consulta | Probado: suma exacta, relación única, split mixto, auditoría y fallo conserva distribución | Monitorear locks/errores; rollback mediante migración compensatoria |
| 3 ✅ | Detalle y UI leían una sola relación | Aplicado: `bank-email-api`, servicio y módulo devuelven, enriquecen, muestran y restauran `allocations[]` | 121 pruebas; reabrir conserva importes y destinos; guardia ante varias reservas | Monitorear latencia; rollback de Edge Function y frontend |
| 4 ✅ | Reserva tomaba monto total del evento | Aplicado en API piloto: compromiso directo por suma de `amount_cop` de allocations `reservation` | split 60/40 acredita 60; eventos no comprometidos no acreditan | Monitorear saldo de candidatos; rollback a v17 |
| 5 ✅ | “pagado” se excluía aunque fuera conciliable | Aplicado: dominio `bank_email_sale_is_reconcilable`; candidatos bancarios de tienda/restaurante/terraza sin filtrar por cobro | venta Bancolombia pagada es conciliable; efectivo y otro hotel no | Candidatos falsos; rollback de migración y Edge v18 |
| 6 ✅ | Una venta podía reutilizarse | Aplicado: saldo conciliable por venta, exclusión del evento actual y bloqueo transaccional por destino | parcial conserva saldo; segunda conciliación completa rechazada; otro hotel aislado | Monitorear contención; rollback de migración y Edge v19 |
| 7 ✅ | Candidatos poco humanos/costosos | Aplicado: DTO humano, ventana de 7 días, orden por cercanía y detalles en lotes | reserva con total/pagado/pendiente; ventas con productos, cantidades, contexto y fecha | Ventas fuera de ventana; reabrir conserva destino actual |
| 8 ✅ | Recepción necesitaba estado, no privilegio admin | Aplicado: resumen sanitario read-only; list/detail/candidates/actions solo admin en servidor y ruta | recepción conserva alertas y resumen; URL/acciones administrativas bloqueadas; otro hotel no lee | Error de rol; rollback a Edge v21 |
| 9 ✅ | Caja no mostraba verificación persistida | Aplicado: estado read-only resuelto por referencias persistidas pago/reserva/venta↔allocation; columna exclusiva del piloto | pendiente/verificado/revisión/no aplica; 0 escrituras e ingresos nuevos | asociación ambigua en varias transferencias de una reserva; ocultar columna y volver Edge v22 |
| 10 ✅ | Cambio de método divergía del ledger | Aplicado: RPC atómico actualiza solo método/cuenta, audita before/after y elimina UPDATE directo | 0 divergencias método/cuenta; mismo hotel/turno/monto/concepto; anon bloqueado | error al mapear cuenta; migración compensatoria restaura RPC anterior y grant puntual |
| 11 | Cierre trata banco como arqueo manual | Panel informativo: registrado, confirmado, pendiente, diferencia; efectivo sigue ciego | Gmail caído no bloquea cierre | confusión operativa; ocultar panel |
| 12 | Salidas se rechazan sin clasificar | Diseñar bandeja separada de movimientos salientes; no mezclar con ingresos | ninguna salida entra como ingreso negativo | alcance alto; mantener solo diseño |
| 13 | Riesgo de segundo sistema financiero | Mapear operación→Caja→ledger→conciliación; no duplicar asientos | trazabilidad de punta a punta | doble contabilización; apagar proyección piloto |
| 14–15 | Auditoría/permisos incompletos | before/after, motivo, actor; mínimos privilegios; cerrar `SECURITY DEFINER` | matriz admin/recepción/otro hotel/anon | romper acceso; migración de restauración puntual |
| 16–17 | Regex no prueba comportamiento | pgTAP/SQL, backend, frontend y regresión completa | 18 casos obligatorios + módulos existentes | datos de prueba; transacciones/fixtures aislados |
| 18–20 | Piloto y UX operativa | Gate UUID; estados simples para recepción; consola completa admin | ninguna evidencia en otro hotel | filtración tenant; kill switch |
| 21–24 | Logs, despliegue y prueba final | logs estructurados, migrations, deploy y checklist controlado | E2E A–H sin dinero arbitrario | operación real; rollback por componente |

## Orden inmediato

Las Fases 2 a 10 están aplicadas. Las superficies bancarias siguen limitadas al piloto; la Fase 10 endurece el flujo compartido de Caja sin cambiar su comportamiento funcional. La siguiente es la Fase 11: separar en el cierre el efectivo arqueable de los valores bancarios registrados, confirmados y pendientes.
