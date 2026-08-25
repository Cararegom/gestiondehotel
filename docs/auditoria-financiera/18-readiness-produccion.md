# Readiness de producción — Fase 1

> Documento histórico previo al cutover. La decisión vigente está en `20-cierre-fase1.md`: Fase 1 aplicada el 2026-08-25.

Fecha: 2026-08-09.

## Decisión

**READY_FOR_PRODUCTION = NO**

Bloqueadores críticos exactos:

1. no existe staging confirmado con ref distinto de `iikpqpdoslyduecibaij`;
2. migraciones 01–09 no se han ejecutado en PostgreSQL;
3. no existen fixtures Auth/multi-hotel ni pruebas reales RLS, anon y cross-tenant;
4. quedan 5 inserts directos de `pagos_reserva`;
5. quedan 6 escrituras directas de restaurante;
6. compras pendientes todavía requiere una RPC tenant/actor específica;
7. atomicidad, rollback e idempotencia no se demostraron contra base real;
8. business date, arqueo, Terraza, reversión y smoke tests runtime están pendientes;
9. migración 10 no fue aplicada y correctamente permanece bloqueada;
10. no se repitió la suite post-migración 10.

Producción no fue modificada y los datos legacy modificados son 0.
