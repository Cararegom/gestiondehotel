# Fase 0 — baseline de producción

Estado: **REANUDADA Y MEDIDA EN MODO READ-ONLY**  
Fecha de corte: 2026-08-09  
Proyecto: `iikpqpdoslyduecibaij`  
Zona operativa: `America/Bogota`.

## Antecedente: por qué se detuvo anteriormente

La primera ejecución se detuvo antes de consultar producción porque no existía un canal autenticado que garantizara `read_only`, ni confirmación independiente de que el ref enlazado fuera producción. No se usó la clave pública, `service_role`, pooler ni conexión PostgreSQL alternativa; por ello los resultados de producción quedaron correctamente sin inventar.

## Reanudación mediante Supabase MCP read-only

El 2026-08-09 el propietario confirmó expresamente que `iikpqpdoslyduecibaij` es producción. `codex mcp get supabase` confirmó servidor habilitado, transporte `streamable_http` y URL con `project_ref=iikpqpdoslyduecibaij&read_only=true`. `get_project_url` devolvió `https://iikpqpdoslyduecibaij.supabase.co`. La auditoría usó exclusivamente `list_tables`, `list_migrations`, `list_edge_functions`, advisors y consultas SQL `SELECT` de catálogo/agregación. No se ejecutaron RPC de negocio, DDL ni escrituras.

## Catálogo real

Producción contiene **86 tablas en `public`**. Conteos aproximados de las fuentes centrales al corte:

| Tabla | Filas |
| --- | ---: |
| `caja` | 66.247 |
| `reservas` | 29.831 |
| `pagos_reserva` | 21.608 |
| `ventas_tienda` | 25.118 |
| `detalle_ventas_tienda` | 33.188 |
| `productos_tienda` | 851 |
| `compras_tienda` | 914 |
| `detalle_compras_tienda` | 3.746 |
| `movimientos_inventario` | 8.964 |
| `turnos` | 2.258 |
| `ventas_restaurante` | 34 |
| `terraza_pedidos` | 83 |
| `log_caja_eliminados` | 649 |
| `bitacora` | 3.380 |

Existen todas las tablas solicitadas de caja, reservas, tienda, restaurante, Terraza, logs y piloto bancario. `pagos_cargos` existe pero está vacío. No existen objetos equivalentes desplegados a `financial_transactions`, `accounts`, `account_movements`, `expenses`, `expense_payments`, `expense_categories`, `cost_centers`, `payment_applications`, `accounting_periods`, `recurring_expenses`, `budgets`, `owners_transactions`, `bank_transactions` o `bank_reconciliations`. La aproximación actual continúa siendo `caja`; `pagos_cargos` no sustituye una aplicación normalizada operativa.

## Repositorio versus producción

| Evidencia | Clasificación |
| --- | --- |
| Baseline 20260326 y migraciones operativas hasta 20260724 | ✅ Coinciden con historial productivo |
| Terraza, reservas, propinas y pagos mixtos | ✅ Desplegados |
| Piloto `20260803120000_bank_email_payments_pilot` | ✅ Desplegado |
| Repo `20260622090000_remote_schema_history_placeholder.sql` frente a producción `terraza_transferencias_sin_duplicados` | ⚠️ Producción diferente; el repo conserva un placeholder, no el SQL real |
| `20260806120000_restore_tienda_stock_al_eliminar_caja.sql` | ⚠️ Migración del repo no desplegada |
| 86 tablas reales frente a 66 del snapshot | ⚠️ Snapshot desactualizado; producción contiene objetos posteriores/no reflejados |
| Funciones de Terraza y banco posteriores al snapshot | ⚠️ Producción contiene definiciones que el snapshot no representa completamente |

Producción es la fuente de verdad. Los snapshots son útiles como antecedente, pero no como baseline actual.

## Estructura e integridad del esquema

- No hay índice único en `caja(pago_reserva_id)` ni clave de idempotencia en pagos/ventas principales.
- No hay constraint transversal que exija el mismo `hotel_id` entre pago, reserva y caja.
- `productos_tienda` conserva pares `stock`/`stock_actual` y `precio`/`precio_venta`.
- `turnos` solo persiste `balance_final`; no persiste arqueo por método, diferencia, observación o aprobador.
- Los triggers relevantes actualizan timestamps, recalculan total de Terraza y mantienen estados del piloto bancario. No existe trigger general que reconcilie pago–caja–`monto_pagado`.
- El índice parcial `uniq_turno_abierto_por_usuario_hotel` sí está desplegado.

## Despliegue por módulo

- **Tienda/compras/inventario:** desplegados y con uso material.
- **Restaurante:** desplegado, pero volumen bajo; recetas sin uso operativo (2 platos, 0 con receta).
- **Terraza:** desplegada, con 83 pedidos, 117 items y pagos mixtos; continúa restringida al UUID `38373fa5-b953-4aa9-b4e9-25b9739be5f2` tanto en policies como funciones.
- **Bancolombia:** migración y Edge Functions `bank-email-api`, `gmail-oauth-callback`, `gmail-webhook` y `gmail-watch-renew` activas. Hay integración/watch activos, pero 0 eventos bancarios y 0 expectativas: despliegue técnico, no operación conciliada demostrada.

## Conclusión del baseline

La auditoría estática describió correctamente la arquitectura y la mayoría de riesgos. Producción confirma además anomalías materiales de integridad y una exposición multi-hotel estructural crítica. El catálogo productivo es más nuevo que los snapshots, pero no contiene el nuevo núcleo financiero propuesto.
