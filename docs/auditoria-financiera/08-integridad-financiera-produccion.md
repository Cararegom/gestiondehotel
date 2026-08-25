# Fase 0 — integridad financiera de producción

Estado: **MEDIDA MEDIANTE SUPABASE MCP READ-ONLY**  
Fecha: 2026-08-09. No se mostraron datos personales ni se modificó producción.

## Antecedente y reanudación

La versión anterior quedó sin métricas porque no existía acceso productivo read-only confirmado. Esa detención fue deliberada y correcta. En la **Reanudación mediante Supabase MCP read-only**, el propietario confirmó el ref y el MCP autenticado confirmó `read_only=true`; se ejecutaron únicamente agregaciones `SELECT`, primero después del catálogo y conteos básicos.

## Pagos de reserva versus caja

Base: **21.608 pagos**, monto de cada caso calculado sobre `pagos_reserva.monto`.

| Caso | Cantidad | % pagos | Monto COP |
| --- | ---: | ---: | ---: |
| Exactamente una caja | 21.354 | 98,82% | — |
| Sin caja | 251 | 1,16% | $14.987.530 |
| Múltiples cajas | 3 | 0,01% | $120.000 |
| Caja con `pago_reserva_id` huérfano | 0 | 0,00% | $0 |
| Pago distinto de suma de caja | 2 | 0,01% | diferencia absoluta $50.000 |
| Hotel diferente entre pago y alguna caja | 251 | 1,16% | requiere revisión estructural |
| Método diferente | 561 | 2,60% | requiere revisión |
| Diferencia de fecha mayor a 24 h | 0 | 0,00% | — |

La coincidencia de 251 pagos sin caja y 251 señales de hotel diferente requiere revisión por casos agregados/relaciones; no se interpreta como fraude. No existe constraint de unicidad o mismo hotel que impida recurrencia.

### Agrupación de anomalías de pagos

Por hotel (UUID técnico, sin nombres):

| Hotel | Pagos | Sin caja | Monto sin caja | Multi caja | Monto multi |
| --- | ---: | ---: | ---: | ---: | ---: |
| `38373fa5…` | 1.274 | 32 | $3.275.000 | 0 | $0 |
| `802940a9…` | 701 | 22 | $1.759.425 | 0 | $0 |
| `8434a618…` | 10.374 | 68 | $3.925.000 | 2 | $95.000 |
| `933c23e6…` | 6 | 5 | $100 | 0 | $0 |
| `a32ecc1f…` | 186 | 13 | $305.000 | 1 | $25.000 |
| `ac5e4c9d…` | 9.069 | 111 | $5.723.005 | 0 | $0 |

Por mes, los pagos sin caja se concentran entre mayo de 2025 y agosto de 2026. Los mayores montos fueron noviembre de 2025 ($2.093.295; además los 3 multi-caja por $120.000), julio de 2026 ($2.259.600), diciembre de 2025 ($1.893.130), junio de 2026 ($1.800.000) y junio de 2025 ($1.725.000). Los demás meses suman 134 casos por $5.096.505. Por método se observaron 18 UUID distintos; los mayores montos sin caja fueron `4460dabb…` ($2.355.000; 2 multi-caja por $95.000), `7298192b…` ($2.491.004), `4e979648…` ($2.015.000), `e09b4637…` ($1.680.000), `e409ae5b…` ($1.570.000) y `9e04d3f0…` ($1.489.100). No se publican nombres ni datos de usuarios.

## `reservas.monto_pagado` versus suma de pagos

| Métrica | Resultado |
| --- | ---: |
| Reservas iguales | 18.721 |
| Reservas diferentes | 11.110 |
| Registrado mayor que pagos | 11.081 |
| Registrado menor que pagos | 29 |
| `monto_pagado > 0` sin pagos | 10.695 |
| Pagos > 0 con `monto_pagado` cero/null | 8 |
| Diferencia absoluta total | $411.558.854 |
| Diferencia máxima individual | $650.000 |

`monto_pagado` no puede tratarse como derivación confiable de `pagos_reserva` para históricos sin definir una política de datos legacy.

Por hotel, las diferencias se concentran en `8434a618…` (4.841; $174.870.001), `ac5e4c9d…` (3.368; $124.072.511) y `802940a9…` (2.842; $109.883.942); `a32ecc1f…` aporta 57 por $2.682.400 y `38373fa5…`, 2 por $50.000. Por mes, el núcleo histórico está entre julio y noviembre de 2025: 10.701 reservas y $396.178.454 de diferencia absoluta; el resto suma 409 reservas y $15.380.400.

## Posibles duplicados

Se contó cada fila cuyo registro inmediatamente anterior comparte hotel, usuario, monto, método y referencia/origen relevante dentro de la ventana. Son **POSIBLES DUPLICADOS**, no duplicados confirmados ni fraude.

| Fuente | 30 s | 60 s | 120 s |
| --- | ---: | ---: | ---: |
| Pagos | 9 | 12 | 17 |
| Caja | 89 | 201 | 259 |
| Tienda | 1.597 | 2.262 | 2.857 |
| Restaurante | 3 | 4 | 5 |
| Terraza | 0 | 0 | 0 |

La señal de tienda es alta y puede incluir operaciones legítimas repetidas con productos/totales comunes. Debe revisarse con `client_operation_id` futuro, no inferirse duplicidad definitiva por tiempo.

## Tienda y costo aproximable

| Métrica | Resultado |
| --- | ---: |
| Ventas | 25.118 |
| Con detalle | 25.111 |
| Sin detalle | 7 |
| Detalles huérfanos | 0 |
| Sin caja | 176 |
| Con múltiples cajas | 116 |
| Total cabecera distinto de suma detalle | 11 |
| Productos con stock negativo | 0 |
| Productos con `stock != stock_actual` | 540 / 851 |

El estado de pago no es confiable como indicador único: 25.112 ventas figuran `pendiente`, aunque la gran mayoría tiene caja. De 664 productos vendidos, 428 tienen alguna compra conocida y 236 no. Hay 307 productos con múltiples costos históricos. **23.226 de 25.111 ventas con detalle (92,49%) son aproximadamente costeables** porque todos sus productos tienen al menos una compra conocida; 1.885 no lo son. Esto solo mide cobertura: no determina qué costo histórico correspondió a cada salida y no es CMV real.

## Compras e inventario

| Métrica | Resultado |
| --- | ---: |
| Compras | 914 |
| Sin detalle | 2 |
| Total compra distinto de suma detalle | 703 |
| Sin caja estructural | 91 |
| Con múltiples egresos | 4 |
| Estado recibido/recibida | 844 |
| Recibida sin caja | 1 |
| Caja asociada a estado no `recibida` | 808 |

Los estados `recibida` (16) y `recibido` (828) son incompatibles semánticamente; por eso “pago sin recepción” no puede afirmarse solo comparando con un literal. El modelo acopla y a la vez representa de forma ambigua recepción y pago.

Inventario contiene 8.964 movimientos: 3.419 ingresos de compra (dos nombres), 3.414 `SALIDA`, 2.129 `INGRESO`, 1 ajuste de conteo y 1 merma. No hay movimientos sin producto/ingrediente, pero **8.959 carecen de `usuario_id` estructurado**. La columna textual `usuario_responsable` no equivale a una FK verificable. No se identificaron tipos normalizados para transferencias tienda→Terraza y Terraza→tienda en esta tabla; las funciones de transferencia existen, pero no hay valorización de costo.

## Restaurante y Terraza

- Restaurante: 34 ventas, 7 sin items, 0 items huérfanos, 19 sin caja; estados: 10 pagadas, 23 pendientes y 1 pendiente por habitación. Hay 2 platos y ninguno tiene receta: 0% de platos con receta y 0% de ventas con costo teórico reconstruible mediante receta. El **costo histórico real** no existe.
- Terraza: 83 pedidos (63 pagados, 2 abiertos, 18 cancelados), 2 sin items y 33 sin caja si se toma todo estado; las ventas sin caja operativamente comparables deben separar abiertos/cancelados. El módulo está hardcodeado al hotel UUID citado en el baseline.

## Propinas

59 pedidos registran propina por **$293.600**. Caja contiene 48 movimientos de propina por **$242.600**. La diferencia entre documento y caja es $51.000. Las propinas se insertan como `caja.tipo='ingreso'` y los reportes basados en ingresos las incluyen; por tanto, hoy **sí se cuentan como ingreso**. No existe pasivo de propinas por pagar.

## Egresos y dificultad de migración

Hay 5.778 egresos. Solo 830 (14,37%) tienen `compra_tienda_id` o `referencia`; 4.948 (85,63%) dependen de texto. Clasificación analítica por texto: Inventario 1.428, Vehículo 111, Energía 87, Agua 35, Aseo 37, Mantenimiento 31, Arriendo 20, Nómina 19, Internet 7, Administración 3 y Otros 4.000. Parqueadero y Propietario no produjeron coincidencias con las reglas conservadoras. **69,23% quedó en Otros**, por lo que la migración histórica automática no es confiable.

## Turnos, fechas y borrados

- 2.258 turnos: 19 abiertos, 2.239 cerrados y 26 sin movimientos.
- 1.886 movimientos sin turno: 14 ingresos y 1.872 egresos.
- Persistencia del arqueo: únicamente `balance_final`, fechas y estado; no detalle por método ni explicación.
- Diferencias de fecha UTC vs `America/Bogota`: 17.752 caja, 6.601 pagos, 5.665 ventas de tienda y 9.027 inicios de reserva cambian de fecha civil al convertir. Esto mide exposición potencial, no confirma que cada reporte esté equivocado.
- `log_caja_eliminados`: 649 filas, JSON suma $6.254.250.725,80; `caja_movimientos_eliminados`: 0; `bitacora`: 3.380. El monto del log es evidencia de movimientos eliminados, no pérdida ni fraude.

## Piloto Bancolombia

Las seis tablas están desplegadas: 1 integración con watch activo, 1 OAuth state, 1 inbox procesado, 0 expectativas, 0 eventos y 2 registros de auditoría. Las cuatro Edge Functions están activas. Sin eventos no hay matched, pendientes de revisión, fingerprints duplicados ni montos que medir. La definición desplegada separa detección/revisión; no hay evidencia de que hoy cree caja o modifique reservas. Clasificación: **PARCIALMENTE desplegado (infraestructura activa, operación financiera aún no demostrada)**.

## Fuente autoritativa temporal

| Concepto | Fuentes actuales | Calidad/anomalía | Fuente temporal recomendada |
| --- | --- | --- | --- |
| Venta habitación | `reservas.monto_total` | documento operativo razonable | `reservas` |
| Cobro habitación | pagos + caja + agregado | 251 pagos sin caja; agregado divergente | `pagos_reserva`, conciliado contra `caja` |
| Movimiento dinero | `caja` | borrable, textual, sin cuenta | `caja` + log de eliminados para auditoría |
| Venta tienda | cabecera + detalle | 7 sin detalle; estados poco fiables | detalle, validado contra cabecera |
| Inventario | productos + movimientos | 540 stocks divergentes; actor ausente | `stock_actual` solo operativo; movimientos como evidencia |
| Compra | compra + detalle + caja | 703 totales divergentes; estados ambiguos | detalle de compra; caja solo para pago |
| Restaurante | venta + items | bajo volumen, 7 sin items | items/cabecera, conciliados |
| Terraza | pedidos + items + caja | mejor encapsulado; hotel fijo | pedido/items para venta, caja para cobro |
| Gastos | caja egreso | 85,63% texto | `caja` con clasificación manual controlada |
| Turnos | turnos + caja | arqueo no persistido | `turnos` para estado; `caja` para movimientos |

## ¿Podemos calcular utilidad real hoy?

**NO.** Puede estimarse flujo de caja y cobertura aproximada de costos de tienda, pero no hay CMV histórico, gastos devengados, cuentas, aplicaciones de pago, propietario ni periodos contables confiables.
