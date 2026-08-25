# Fase 1 — plan de cutover, backup y rollback

Estado: borrador operativo; producción no autorizada.

## Precondiciones

1. branch/staging con clon de esquema y fixtures anon/multi-hotel;
2. migrar callers restantes documentados en 13;
3. suite SQL/JS y smoke tests sin fallos;
4. confirmar cero policies financieras abiertas y cero EXECUTE anon;
5. validar monitoreo con cero anomalías atribuibles al flujo nuevo;
6. aprobación humana explícita.

## Backup y restauración

Antes de producción, verificar backup administrado reciente y realizar un backup lógico consistente de esquema, policies, grants, funciones y tablas afectadas. Registrar hora, identificador, retención y responsable. Ensayar restauración en proyecto aislado: no hacer el primer restore durante una emergencia productiva.

Cambios aditivos (columnas/tablas/índices) son reversibles lógicamente, pero no se deben borrar si ya contienen auditoría/reversiones. RLS/grants/funciones se revierten restaurando definiciones versionadas. Las operaciones creadas con el modelo nuevo no se convierten al modelo antiguo automáticamente.

## Feature flags

- `fase1PagosAtomicos`;
- `fase1TiendaAtomica`;
- `fase1RestauranteAtomico`;
- `fase1ReversionCaja`;
- `fase1ArqueoDetallado`.

La configuración por entorno está implementada en `fase1FeatureFlags.js`. Antes de migración 10 permite transición controlada; después, `fase1LegacyRevoked=true` fuerza RPC seguras y el rollback exige infraestructura controlada, no un flag hacia un writer revocado.

## Orden exacto futuro

1. activar modo mantenimiento breve para cambios de grants/RLS;
2. verificar backup y snapshot de métricas legacy;
3. aplicar migraciones 01–02;
4. probar login, membresía, lecturas y reversión en canary;
5. aplicar 03 y activar pagos atómicos en un hotel/usuario controlado;
6. observar integridad; luego 04 y tienda;
7. 05 restaurante solo tras resolver descuentos/impuestos;
8. 06–07 caja/inventario/arqueo;
9. 08 Terraza y validar anticipo/propina/mixto;
10. 09 guards/observabilidad;
11. mantener migración 10 retenida hasta cero callers directos;
12. aplicar 10, repetir smoke tests y cerrar ventana.

## Validación inmediata

- `fase1_integrity_snapshot` por hotel;
- pago nuevo tiene exactamente una caja y mismo hotel/método;
- total tienda = suma items = suma caja inmediata;
- stock/movimiento/venta se crean juntos;
- fallo inducido no deja filas parciales;
- anon recibe denegación;
- Hotel A no ve/escribe B;
- arqueo y auditoría quedan persistidos;
- logs históricos mantienen conteos de baseline, incluidos los 649 de `log_caja_eliminados`.

## Rollback

- desactivar flag del módulo afectado;
- no borrar datos nuevos ni auditoría;
- restaurar función/policy/grant anterior solo si el caller anterior sigue desplegado;
- revertir migraciones en orden inverso hasta la última compatible;
- si existe corrupción estructural, aislar escrituras y restaurar en proyecto alterno según ensayo; no ejecutar reparación improvisada;
- comparar métricas pre/post y documentar incidente.

## Shadow monitoring

Durante 14 días, ejecutar diariamente por hotel y desde la fecha de cutover:

- pagos vs caja (0 sin caja, 0 múltiples no intencionales);
- venta tienda vs detalles/caja;
- restaurante vs items/caja;
- referencias cross-hotel (0);
- stock negativo nuevo (0);
- DELETE financiero físico (0).

Alertar; nunca reparar automáticamente.

## Recomendación actual

**NO aplicar producción todavía.** Faltan runtime SQL en branch/staging, pruebas multi-hotel reales, migración de callers secundarios, feature flags reales y resolución de descuentos/impuestos de restaurante.
