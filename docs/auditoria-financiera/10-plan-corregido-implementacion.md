# Fase 0 — plan corregido de implementación

Estado: **FASE 0 MEDIDA; FASE 1 NO INICIADA**  
Fecha: 2026-08-09.

## Antecedente y reanudación mediante Supabase MCP read-only

El plan anterior era provisional porque la auditoría productiva se había detenido por falta de acceso read-only confirmado. Esa explicación se mantiene. Tras la confirmación expresa del proyecto y el acceso MCP `read_only=true`, se midieron catálogo, seguridad e integridad sin modificar producción. Los datos obligan a priorizar seguridad y consistencia antes del nuevo modelo financiero.

## Decisión

**No es seguro comenzar Fase 1 todavía.** No porque el objetivo sea incorrecto, sino porque una corrección directa de RLS/RPC en producción, sin matriz de roles probada y transición operativa, puede bloquear el hotel; y porque todavía no existe autorización del propietario para implementar. La Fase 0 termina aquí.

## Bloqueadores exactos

1. aprobar por escrito el inicio y alcance de Fase 1;
2. definir matriz backend de recepcionista, administrador, contabilidad, propietario y superadmin por operación;
3. preparar inventario exacto de clientes/RPC que dependen de cada policy abierta;
4. crear pruebas de aislamiento con dos hoteles y pruebas por rol en entorno no productivo;
5. diseñar revocación segura de EXECUTE para `registrar_y_eliminar_mov_caja`, `increment` y wrappers de Terraza, incluyendo reemplazos para flujos activos;
6. preparar backup/restauración ensayada, ventana de cambio, feature flags y rollback lógico;
7. acordar que los históricos no se repararán automáticamente y definir tratamiento legacy de `monto_pagado`, stock y estados de compra.

## Alcance exacto recomendado para Fase 1, una vez autorizada

### 1. Contención de seguridad

- sustituir policies abiertas `true` de tienda, detalle, productos, proveedores e inventario por tenant + permiso;
- habilitar RLS con policies verificadas en restaurante, items, platos, recetas, ingredientes, bitácora y logs;
- retirar grants/EXECUTE cliente innecesarios;
- endurecer cada DEFINER con `auth.uid()`, hotel, rol/permiso y `search_path` fijo;
- retirar `increment` genérico y el borrado físico inseguro mediante reemplazos compatibles.

### 2. Detener nueva inconsistencia

- RPC idempotente y atómico para pago de reserva + caja + agregado derivado;
- RPC idempotente para venta/detalle/stock/caja de tienda;
- RPC idempotente para restaurante;
- restricción/idempotency key por hotel y origen;
- validación del mismo `hotel_id` en todas las referencias;
- observabilidad diaria de pagos/ventas sin caja y múltiples cajas.

### 3. Trazabilidad y tiempo

- reemplazar DELETE financiero por reversión enlazada, conservando el original;
- auditoría antes/después con actor real y razón;
- `business_date` en `America/Bogota` para nuevas operaciones;
- persistir arqueo por método, esperado, contado, diferencia, nota y aprobador.

Fuera de Fase 1: reparar históricos, recalcular `monto_pagado`, sincronizar `stock`/`stock_actual`, crear P&L, CMV, cuentas, gastos, presupuestos o conciliación bancaria completa.

## Orden de ejecución futuro

```text
Autorización y matriz de roles
→ pruebas de aislamiento en entorno no productivo
→ contención de RPC/grants y RLS por lotes
→ RPC idempotente de pagos
→ tienda
→ restaurante
→ reversión/auditoría/business_date/arqueo
→ shadow monitoring y conciliación diaria
→ aprobación de salida de Fase 1
```

## Fuentes temporales durante la transición

- venta: documento e items del módulo;
- cobro: `pagos_reserva`, conciliado contra `caja`;
- flujo de dinero: `caja`, incluyendo revisión del log de eliminados;
- inventario: `stock_actual` solo como saldo operativo, con movimientos como evidencia;
- compras: detalles para valor adquirido; caja para pagos;
- gastos: caja egreso con clasificación manual, nunca conversión automática a contabilidad.

## Criterios de salida de Fase 1

- cero policies financieras abiertas o tablas financieras expuestas en pruebas de dos hoteles;
- cero RPC cliente con DEFINER inseguro o SQL dinámico genérico;
- 100% de cobros nuevos transaccionales e idempotentes;
- ninguna anulación nueva elimina físicamente evidencia;
- fecha hotelera correcta a las 23:30 Bogotá;
- arqueo nuevo persistido por método;
- monitoreo durante un periodo acordado sin nuevas diferencias pago–caja atribuibles al flujo nuevo.

No se implementó ninguna de estas acciones. Se espera autorización expresa.
