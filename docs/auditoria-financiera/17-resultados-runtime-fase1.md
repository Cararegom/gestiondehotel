# Resultados runtime Fase 1

Fecha: 2026-08-09. Este documento distingue resultados ejecutados de contratos estáticos.

| Área | Resultado real |
| --- | --- |
| JavaScript/sintaxis | 132 archivos válidos |
| Tests Node | 62/62 aprobados, 0 fallos |
| Gate legacy | ejecutado; bloquea migración 10 con 5 inserts directos de pagos y 6 escrituras directas de restaurante |
| PostgreSQL migrations 01–09 | NO EJECUTADAS; staging no disponible |
| RLS autenticada Hotel A/B | NO EJECUTADA |
| anon | NO EJECUTADA |
| RPC/cross-tenant | NO EJECUTADA |
| atomicidad/rollback | NO EJECUTADA en PostgreSQL |
| idempotencia | contrato estático aprobado; runtime pendiente |
| business date SQL | NO EJECUTADA |
| arqueo | NO EJECUTADO |
| Terraza | UUID fijo ausente del frontend; runtime pendiente |
| smoke test | NO EJECUTADO |

No se fabricaron resultados. Las pruebas runtime solicitadas requieren URL/anon key, usuarios Auth sintéticos y acceso administrativo exclusivamente del staging.

## Cambios comprobados estáticamente

- cancelación ya no contiene DELETE de `pagos_reserva` ni `caja`; usa `cancelar_reserva_con_reversion`;
- el original financiero se conserva y se crea movimiento opuesto enlazado;
- restaurante calcula subtotal con precio autoritativo, valida descuento del tenant y obtiene impuesto de `configuracion_hotel`;
- `fase1LegacyRevoked=true` fuerza caminos seguros y no permite volver a legacy desde flags;
- `increment`, `registrar_y_eliminar_mov_caja` y el UUID fijo de Terraza tienen cero callers activos según el gate.
