# Checklist de producción

## Antes

- [ ] `HEAD` aprobado y migraciones de producción representadas en Git.
- [ ] Prechecks sin allocations inválidas, cross-tenant o dobles.
- [ ] Backup/rollback y kill switch verificados.
- [ ] Constraints, RPC, RLS/GRANT y `SECURITY DEFINER` revisados.
- [ ] Tests SQL/backend/frontend y regresión completos.
- [ ] Solo UUID de Hotel Marena habilitado.

## Prueba operativa A–H

- [ ] A. Reserva por transferencia crea un movimiento y queda pendiente banco.
- [ ] B. Correo/simulación controlada aparece sin recargar y puede asociarse.
- [ ] C. Confirmación cambia a verificado sin duplicar Caja/ledger.
- [ ] D. Una transferencia distribuye habitación + varias ventas con suma exacta.
- [ ] E. Cerrar sesión/reabrir conserva todas las allocations.
- [ ] F. Cierre muestra resumen bancario informativo y efectivo ciego.
- [ ] G. Recepción opera/ve estados pero no administra conciliación.
- [ ] H. Otro hotel no ve ni puede inferir ninguna parte del piloto.

## Después

- [ ] Auditoría contiene actor, hotel, acción, motivo y before/after mínimos.
- [ ] Logs sin secretos ni cuerpo de email.
- [ ] Advisors revisados y métricas/errores observados.
- [ ] Documentación y versiones de migración/Edge Function actualizadas.
- [ ] Riesgos residuales aceptados explícitamente.

## Estado actual

Fases 1 a 8 completadas. Fases 9–24 pendientes; no marcar el piloto listo para recepción hasta completar estados de Caja, regresión y prueba controlada final.
