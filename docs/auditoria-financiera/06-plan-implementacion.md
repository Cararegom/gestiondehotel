# Auditoría financiera — plan de implementación

## Principio de transición

No reemplazar todo de una vez. Crear el nuevo núcleo en paralelo, verificarlo contra `caja` y módulos actuales, migrar por flujo y retirar compatibilidad solo después de conciliación. Cada fase debe incluir respaldo, migración ensayada, feature flag, métricas y rollback lógico.

## Fase 0 — Confirmación y saneamiento previo (1–2 semanas)

Objetivo: convertir esta auditoría estática en baseline productivo firmado.

1. capturar esquema y funciones directamente de producción;
2. inventariar grants, RLS, volumen y valores nulos/huérfanos;
3. confirmar qué migraciones de Terraza/banco están desplegadas;
4. medir discrepancias `pagos_reserva` ↔ `caja` ↔ `reservas.monto_pagado`;
5. medir ventas sin detalles/caja, caja duplicada y stock negativo/divergente;
6. acordar definiciones de venta, ingreso, gasto, pago, CMV y día hotelero;
7. definir roles y límites de gasto;
8. congelar nombres de fuentes/reportes actuales como baseline de comparación.

Entregable: informe de calidad de datos con conteos, casos para corrección y decisión de fuente autoritativa por flujo.

## Fase 1 — Seguridad, trazabilidad y consistencia de cobros (3–5 semanas)

Esta debe ser la primera implementación.

### Seguridad

- corregir RLS abiertas y habilitar RLS en tablas financieras;
- eliminar políticas `true` y grants innecesarios;
- asegurar RPC `SECURITY DEFINER` con `auth.uid()`, permiso, hotel y `search_path`;
- aplicar permisos financieros backend.

### Integridad

- crear RPCs atómicos e idempotentes para pago de reserva, tienda y restaurante;
- validar total de pagos mixtos, turno, método y hotel;
- establecer `client_operation_id` único;
- reconciliar/derivar `reservas.monto_pagado` desde pagos;
- reemplazar borrado físico por estados/reversión;
- registrar auditoría antes/después y razón;
- normalizar `business_date`/zona horaria.

No crear todavía P&L completo. Primero impedir nueva deuda de datos.

Criterios de salida:

- 100% de cobros nuevos se crean en una transacción;
- cero políticas financieras abiertas entre hoteles en pruebas;
- reintentar la misma operación no duplica;
- toda anulación conserva original y reversión;
- prueba automatizada para operación a las 23:30 Bogotá.

## Fase 2 — Cuentas y libro de movimientos de dinero (3–4 semanas)

- crear `accounts` y `account_movements`;
- mapear métodos a cuentas;
- persistir arqueos y diferencias por método/cuenta;
- registrar transferencias cuenta↔cuenta sin tratarlas como ingreso/gasto;
- proyectar temporalmente a `caja` o hacer dual-write transaccional;
- dashboard de saldos por caja/banco.

Conciliar diariamente total nuevo versus `caja`; diferencia esperada cero por fuente migrada.

## Fase 3 — Gastos, proveedores y cuentas por pagar (4–6 semanas)

- ampliar `proveedores`;
- crear categorías, centros de costo, `expenses` y `expense_payments`;
- soportar pendiente, parcial, pagado, vencido, cancelado;
- evidencias/facturas y aprobación por monto;
- recurrencias como borradores;
- porcentaje hotel/personal para vehículo;
- retiros/aportes del propietario separados;
- bandeja simple para recepción y completa para administración/contabilidad.

Migración: no convertir automáticamente todo egreso histórico en gasto contable. Importarlo como “movimiento legacy no clasificado” y clasificar solo periodos necesarios.

## Fase 4 — Costeo de inventario y CMV (4–7 semanas)

- escoger costo promedio móvil;
- convertir recepción de compra en aumento de cantidad y valor;
- guardar costo unitario/total en venta o `cogs_entries`;
- implementar costo para transferencias tienda↔terraza;
- congelar costo de recetas de restaurante al vender;
- registrar pérdidas/ajustes/devoluciones con cantidad y valor;
- inventario valorizado y margen por producto/área.

Criterio: cerveza comprada $3.000 y vendida $6.000 produce venta 6.000, CMV 3.000, margen 3.000 en el mismo periodo de venta.

## Fase 5 — P&L, centros y presupuestos (3–5 semanas)

- crear/activar `financial_transactions` como fuente de devengo;
- mapear cada documento a categoría y centro;
- P&L mensual con drill-down;
- separar utilidad operacional de flujos de propietario, activos y deuda;
- presupuesto mensual, real, diferencia y porcentaje;
- cerrar/reabrir periodos con autorización y auditoría.

Validar dos meses contra cálculo manual del contador/propietario.

## Fase 6 — Conciliación bancaria (3–6 semanas)

- reutilizar parsers, fingerprint y auditoría del piloto;
- generalizar a `bank_transactions` y cuentas;
- importar Gmail Bancolombia como un adaptador;
- matching por referencia, monto, ventana temporal y expectativa;
- soportar conciliado, pago sin venta, venta sin pago, diferencia y duplicado;
- revisión humana, comisiones, pagos agrupados/parciales;
- nunca convertir correo en ingreso irreversible sin confirmación/regla segura.

## Fase 7 — Activos y pasivos mínimos (opcional, 3–4 semanas)

- registro simple de activo y compra financiada;
- préstamo/pasivo, principal, interés, cuotas y saldo;
- separar adquisición, pago de principal, interés y flujo;
- exportación para contador; evitar contabilidad avanzada innecesaria.

## Estrategia de migración

1. **Shadow mode:** calcular nuevo resultado sin mostrarlo como oficial.
2. **Dual write controlado:** solo mediante un RPC, nunca dos llamadas frontend independientes.
3. **Reconciliación diaria:** viejo versus nuevo por hotel, fuente, método y fecha.
4. **Cutover por módulo:** Terraza → Tienda → Restaurante → Habitaciones → Gastos.
5. **Compatibilidad:** vistas de lectura para pantallas antiguas; no triggers bidireccionales complejos.
6. **Archivo legacy:** preservar IDs originales y `legacy_source_id`.

## Pruebas mínimas por fase

- aislamiento de dos hoteles y cinco roles;
- doble clic/reintento/timeouts;
- pago parcial/mixto y reversión;
- venta cargada a habitación y pago posterior;
- cierre a medianoche Bogotá;
- compra recibida no pagada y pagos parciales;
- transferencia entre cuentas sin afectar P&L;
- retiro propietario sin gasto operativo;
- activo financiado con principal/interés;
- costo promedio, devolución, pérdida y transferencia;
- periodo cerrado;
- conciliación duplicada/ambigua.

## Observabilidad y controles

- alertas por ventas sin transacción financiera, pagos sin movimiento de cuenta y diferencias de dual-write;
- métricas por hotel sin exponer montos a superadmin salvo permiso;
- job de integridad diario;
- exportación CSV/JSON de auditoría;
- bitácora inmutable con actor, origen, request/idempotency ID y antes/después;
- backup y restauración ensayada antes de migraciones monetarias.

## Archivos principales revisados

- `supabase/migrations/20260326191500_baseline_public_schema.sql`
- `supabase/snapshots/database-context.json`
- `supabase/snapshots/public-functions.json`
- migraciones `20260619*`–`20260705*` de Terraza/inventario
- migración local `20260803120000_bank_email_payments_pilot.sql`
- `js/modules/caja/*`
- `js/modules/reportes/reportes.js`
- `js/modules/tienda/{pos,compras,compras-pendientes,inventario}.js`
- `js/modules/restaurante/{restaurante,inventario}.js`
- `js/modules/terraza/*`
- `js/modules/reservas/*`
- `js/modules/mapa-habitaciones/{datos,modales-gestion}.js`
- `js/uiUtils.js`, `js/main.js`, `js/services/turnoService.js`
- Edge Functions del piloto bancario y envío de cierre.
