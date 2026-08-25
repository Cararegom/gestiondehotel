# Cierre operativo de la Fase 1

Fecha: 2026-08-25.

## Estado

**FASE_1_IMPLEMENTADA = SÍ**

Las migraciones financieras 01–10 y las correcciones posteriores están aplicadas tanto en staging (`vyzscuzgjdhrhzctmsuv`) como en producción (`iikpqpdoslyduecibaij`). El historial remoto de producción está actualizado.

## Controles cerrados

- pago de reserva, tienda y restaurante mediante RPC atómicas e idempotentes;
- reversión de caja sin borrado destructivo;
- cierre de turno con arqueo y fecha de negocio Bogotá;
- aislamiento por hotel y permisos backend;
- rutas antiguas retiradas: gate con cero hallazgos;
- recepción de compra, inventario y egreso unidos en `recibir_compra_tienda_atomica`;
- pago de compra inmediato o mixto, dentro o fuera del turno;
- corrección compatible del identificador de movimientos de inventario;
- contratos de respuesta de pagos normalizados en frontend.

## Evidencia

- suite: 76/76 pruebas aprobadas;
- staging de compra: stock 8→9 una sola vez;
- primer intento `idempotent=false`, reintento `idempotent=true`;
- un único movimiento de caja para el pago probado;
- migración de compra desplegada primero en staging y después en producción.

## Límites deliberados

Esta fase no convierte compras históricas ni crea cuentas por pagar. La recepción sigue representando pago inmediato; crédito de proveedor, vencimientos y pagos parciales pertenecen a la Fase 3. No se repara automáticamente ningún histórico.

## Siguiente fase

La siguiente implementación recomendada es la Fase 2: cuentas y libro de movimientos de dinero, comenzando en shadow mode y conciliando contra `caja` antes de mostrar saldos como oficiales.
