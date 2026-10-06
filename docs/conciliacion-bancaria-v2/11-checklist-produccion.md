# Checklist de producción

Este checklist es el gate manual para pasar el piloto de conciliación bancaria a operación productiva. No autoriza por sí solo un despliegue: producción permanece sin cambios hasta una aprobación explícita.

## Estado actual

- Fases 1–24 del piloto bancario están implementadas y cubiertas por documentación, pruebas y manifiesto de despliegue.
- Fase 25 y su evolución posterior permiten a recepción relacionar movimientos exactos mediante `bank_payment_allocations.caja_id`; la implementación inicial se validó en staging el 2026-08-28.
- La prueba operativa A–K sigue pendiente en el ambiente objetivo antes de declarar el piloto listo para operación general.
- El alcance productivo permitido sigue limitado al UUID de Hotel Marena configurado por variables de entorno.

## Antes

- [ ] `HEAD` aprobado y migraciones de producción representadas en Git.
- [ ] Prechecks sin allocations inválidas, cross-tenant, sumas divergentes ni `caja_id` repetidos o incompatibles.
- [ ] Backup/rollback y kill switch verificados.
- [ ] Constraints, RPC, RLS/GRANT y `SECURITY DEFINER` revisados.
- [ ] Tests SQL/backend/frontend y regresión completos.
- [ ] Solo UUID de Hotel Marena habilitado.
- [ ] Las cinco Edge Functions comparadas contra `supabase/functions/bank-email-deploy-manifest.json`, incluida `bank-payment-relation-api`.
- [ ] Confirmar que producción no tiene funciones o migraciones fuera de Git para este piloto.

## Prueba operativa A–K

- [ ] A. Reserva por transferencia crea un movimiento y queda pendiente banco.
- [ ] B. Correo/simulación controlada aparece sin recargar y puede asociarse.
- [ ] C. Confirmación cambia a verificado sin duplicar Caja/ledger.
- [ ] D. Una transferencia distribuye habitación + varias ventas con suma exacta.
- [ ] E. Cerrar sesión/reabrir conserva todas las allocations.
- [ ] F. Cierre muestra resumen bancario informativo y efectivo ciego.
- [ ] G. Recepción ve estados y ejecuta solo `link` desde Caja; no confirma, rechaza ni usa el panel administrativo.
- [ ] H. Otro hotel no ve ni puede inferir ninguna parte del piloto.
- [ ] I. La relación guarda el `caja_id` exacto y el mismo movimiento no puede usarse en otra transferencia.
- [ ] J. Checkout conserva una relación exacta válida y una relación legacy ambigua queda en revisión manual.
- [ ] K. Dos notificaciones compatibles de una posible transferencia duplicada se conservan; la segunda pasa a revisión manual sin auto-match.

## Después

- [ ] Auditoría contiene actor, hotel, acción, motivo y before/after mínimos.
- [ ] Logs sin secretos ni cuerpo de email.
- [ ] Advisors revisados y métricas/errores observados.
- [ ] Documentación y versiones de migración/Edge Function actualizadas.
- [ ] Riesgos residuales aceptados explícitamente.

## Evidencia local requerida antes de solicitar aprobación

- `node --test tests/fases21-24-release.test.cjs tests/fase6-conciliacion-bancaria.test.cjs tests/recepcion-bank-relation.test.cjs tests/conciliacion-caja-id.test.cjs tests/m3-bank-email-possible-duplicate.test.cjs`
- `npm run check:syntax`
- `npm run sentry:issues` solo como consulta read-only si se quiere revisar salud antes del gate.

## Resultado esperado del gate

Si A–K pasa sin diferencias materiales, el siguiente paso es preparar una solicitud de aprobación con: commit exacto, migraciones incluidas, funciones a desplegar, variables requeridas, plan de rollback y riesgos residuales. Si falla algún punto, el piloto queda en staging y se corrige antes de volver a pedir aprobación.
