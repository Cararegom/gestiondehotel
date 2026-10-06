# Auditoría integral 2026 — Tienda e Inventario (incluye Restaurante y Terraza)

Fecha: 2026-09-07
Alcance: `js/modules/tienda/`, `js/modules/restaurante/`, `js/modules/terraza/`, `js/modules/costeo/costeo.js`, migraciones SQL relacionadas (fase1 tienda atómica, fase4 costeo/CMV, terraza).
Metodología: lectura de código y migraciones versionadas, exploración con `graphify explain`/`graphify query` sobre `graphify-out/graph.json`. Sin acceso a Supabase en vivo — todo lo aquí afirmado sobre RLS/funciones se basa en migraciones versionadas, no en el catálogo real de producción.

Documentación previa leída primero, como se pidió: `docs/auditoria-financiera/23-fase4-costeo-inventario-cmv.md` (costeo/CMV, "shadow mode", validado en staging el 25 de agosto de 2026) y `docs/auditoria-financiera/01-estado-actual.md` (estado del 2026-08-09, previo a fase1/fase4 — varios hallazgos suyos ya están resueltos, ver sección 6).

---

## 1. `js/modules/tienda/helpers.js` — análisis de responsabilidades

`graphify explain "js/modules/tienda/helpers.js"` confirma que es el nodo con más grado de entrada de todo el dominio tienda: **las 9 páginas restantes de `js/modules/tienda/` dependen de él** (`tienda.js`, `inventario.js`, `pos.js`, `compras.js`, `compras-pendientes.js`, `pedidos-web.js`, `historial-movimientos.js`, `categorias.js`, `proveedores.js`, `lista-compras.js` — confirmado leyendo el archivo, 243 líneas).

Responsabilidades mezcladas en un solo archivo (leído completo):

| Bloque | Líneas | Tipo de responsabilidad |
| --- | --- | --- |
| `TIENDA_TABS`, `normalizeRoleKey`, `isMeseroRole`, `getTiendaTabsForCurrentUser` | 4-33 | Lógica de autorización/rol (qué pestañas ve un mesero) |
| `checkTurnoActivo` | 35-45 | Lógica de negocio (llama a `turnoService`, bloquea la operación si no hay turno) |
| `injectTiendaStyles` | 47-157 | CSS-in-JS (110 líneas de estilos embebidos como string) |
| `formatCurrency` | 159-161 | Helper de formato puro |
| `showGlobalLoading` / `hideGlobalLoading` / `closeModal` / `getTabContentEl` / `getModalContainerEl` | 163-196 | Utilidades de DOM/UI genéricas |
| `renderTiendaTabsShell` | 198-230 | Renderizado de UI (shell de pestañas) |
| `mostrarInfoModalGlobal` | 232-243 | Wrapper de UI sobre SweetAlert2 |

**Veredicto**: no es solo un archivo de helpers puros de formato — mezcla al menos 4 categorías distintas (autorización, lógica de negocio de caja/turno, CSS-in-JS, y utilidades de UI/DOM). Es manejable en 243 líneas, pero su alto grado de entrada (9 dependientes) significa que **cualquier cambio en `checkTurnoActivo` o en `getTiendaTabsForCurrentUser` afecta silenciosamente a los 9 módulos**, y ese acoplamiento no es evidente por el nombre "helpers". Recomendación (no bloqueante, calidad): dividir en `tienda/auth.js` (roles/tabs), `tienda/ui-shell.js` (modal/loading/DOM), `tienda/styles.js` (CSS) y dejar `helpers.js` solo con `formatCurrency` y utilidades puras. No until ahora causa bugs, pero es la señal de "God helper" que el usuario sospechaba — confirmada.

---

## 2. Flujo reconstruido: venta → movimiento de inventario → stock → CMV → ajustes → historial → caja

### 2.1 Tienda — venta por POS (camino principal, bien diseñado)
`js/modules/tienda/pos.js:registrarVentaPOS → procesarVentaConPagos` llama al RPC `procesar_venta_tienda_atomica` (`supabase/migrations/20260809103000_fase1_tienda_atomica.sql`), que en una sola transacción:
1. valida actor, hotel, permiso `tienda.operar`;
2. es **idempotente** vía `client_operation_id` (protege contra doble clic/doble venta, un riesgo que la auditoría financiera anterior había señalado como no resuelto — **ahora sí lo está** para este camino);
3. bloquea cada `productos_tienda` con `FOR UPDATE` antes de validar y descontar stock;
4. valida descuento (`descuentos`), valida que la suma de pagos cuadre con el total;
5. inserta `ventas_tienda` + `detalle_ventas_tienda`, actualiza `stock_actual`, inserta `movimientos_inventario` (tipo `SALIDA`, razón `venta_tienda_atomica`);
6. si es pago inmediato, inserta `caja` (ingreso) por cada método de pago;
7. registra `auditoria_operaciones`.

### 2.2 Costeo/CMV — diseño por triggers (fase4), no por RPC
`supabase/migrations/20260825160000_fase4_costeo_inventario_cmv.sql` no modifica el RPC de venta: engancha un **trigger `AFTER INSERT` sobre `detalle_ventas_tienda`** (`fase4_store_sale_cogs`) que congela costo promedio móvil y margen en `cogs_entries`, y un trigger `AFTER UPDATE OF recibido` sobre `detalle_compras_tienda` (`fase4_store_purchase_cost`) que recalcula el costo promedio al recibir compra. Restaurante usa `platos_recetas` vía trigger sobre `ventas_restaurante_items`; Terraza vía trigger sobre `terraza_pedidos` al pasar a `estado='pagado'`; las transferencias Tienda↔Terraza vía trigger sobre `bitacora`. Los ajustes manuales de `movimientos_inventario` también tienen su propio trigger (`fase4_inventory_adjustment_cost`, `20260825161000`), que excluye explícitamente las razones `venta_tienda_atomica` / `ingreso_compra` para no contar el costo dos veces.

**Esto es la fortaleza más importante del dominio**: al enganchar el costeo a las tablas de hechos (no al RPC), el CMV se calcula correctamente sin importar cuál de los varios caminos de venta insertó la fila — ver 2.3.

### 2.3 Tienda — segundo camino de venta: Pedidos Web (`pedidos-web.js`)
> **Estado posterior al corte (2026-09-18):** A15 consolidó ambos caminos sobre `tienda_crear_venta_atomica_core`, un núcleo SQL privado que concentra autorización, locks deterministas, validación de stock, creación de venta/detalle, movimiento, idempotencia y auditoría. El POS conserva precio autoritativo de catálogo y el pedido web conserva el precio congelado al confirmar el pedido. Las RPC públicas son envoltorios del núcleo y este no es ejecutable por `authenticated` ni `service_role`.

`js/modules/tienda/pedidos-web.js` llama al RPC `actualizar_estado_pedido_web_tienda` (`supabase/migrations/20260619180000_tienda_web_pedidos.sql`, anterior a fase1). Al marcar un pedido como "entregado", este RPC **duplica manualmente** la lógica de `procesar_venta_tienda_atomica` (inserta `ventas_tienda` + `detalle_ventas_tienda`, decrementa `stock_actual`) pero:
- no usa `movimientos_inventario` (sin registro de auditoría de esa salida de stock — no aparecerá en el "Historial de Movimientos" ni en `historial-movimientos.js` filtrable);
- no tiene `client_operation_id`/idempotencia;
- la autorización solo exige que el usuario actúe a nombre de sí mismo y pertenezca al hotel — no exige el permiso `tienda.operar` que sí exige el RPC atómico.

Sí se beneficia del costeo automático (2.2), porque el trigger está en la tabla `detalle_ventas_tienda`, no en el RPC — el CMV se calcula igual de bien para este camino. Ver hallazgo H2/H3 más abajo por el problema real que sí introduce.

### 2.4 Tienda — ajustes manuales de stock (`inventario.js:saveMovimiento`)
> **Estado posterior al corte (2026-09-18):** A16 conectó `saveMovimiento` con `ajustar_stock_tienda_seguro`. La RPC bloquea el producto con `FOR UPDATE`, calcula el stock desde el valor confirmado en servidor y registra stock, movimiento y auditoría en una sola transacción idempotente. La UI dejó de insertar el movimiento y actualizar el producto por separado.

Camino distinto de los dos anteriores: no usa ningún RPC atómico. Hace, desde el navegador, **dos llamadas Supabase separadas y no transaccionales**: `INSERT` en `movimientos_inventario` y luego `UPDATE productos_tienda.stock_actual`, sin bloqueo de fila ni condición optimista sobre el valor leído. Ver hallazgo H4.

### 2.5 Compras (`compras-pendientes.js` → `recibir_compra_tienda_atomica`)
Bien diseñado, análogo a 2.1: RPC atómico (`supabase/migrations/20260825120000_recibir_compra_tienda_atomica.sql`) con `FOR UPDATE`, idempotencia por `client_operation_id`, valida que la suma de pagos cuadre con el total de la compra, actualiza `detalle_compras_tienda.recibido` (dispara el trigger de costeo 2.2), inserta `movimientos_inventario` (`ingreso_compra`) y `caja` (egreso) en la misma transacción, y `auditoria_operaciones`.

### 2.6 Historial de inventario filtrable (feature reciente, commits `6698da6`/`e191845`)
`historial-movimientos.js` filtra siempre por `hotel_id` (`.eq('hotel_id', tiendaState.currentHotelId)`), pagina en bloques de 1000 y usa `getUtcRangeForHotelDates`/`getRuntimeHotelTimeZone` (`services/hotelTimeZoneService.js`) para construir el rango de fechas en la zona horaria del hotel — esto corrige exactamente el problema que la auditoría financiera anterior señaló ("los rangos se construyen con Z/UTC mientras la operación es Bogotá"). **Bien resuelto** para este módulo. Nota: solo cubre `movimientos_inventario`, por lo que hereda el hueco de 2.3 (los pedidos web entregados no generan fila ahí).

### 2.7 Caja
Los tres RPCs atómicos (venta, compra, y los de Terraza) insertan en `caja` dentro de la misma transacción cuando corresponde. El camino de pedidos web (2.3) marca la venta como `estado_pago='pendiente'` y no toca `caja` — el cobro se espera al liquidar la habitación.

---

## 3. Hallazgos con severidad

### H1 — CRITICAL: pedidos web entregados sin reserva activa quedan huérfanos (stock descontado, cobro imposible)

> **Estado posterior al corte (2026-09-10):** C5 corregido, probado y aplicado en Supabase staging mediante `20260910044500_c5_pedidos_web_entrega_segura.sql`. La entrega ahora exige una reserva del mismo hotel y habitación en estado `activa`, `ocupada` o `tiempo agotado`; si no existe, la transacción se rechaza antes de crear la venta o descontar stock. También se añadieron permiso `tienda.operar`, idempotencia por pedido, bloqueo de filas, auditoría y trazabilidad de inventario. Producción y la aceptación funcional con el hotel de prueba siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).
`actualizar_estado_pedido_web_tienda` (`supabase/migrations/20260619180000_tienda_web_pedidos.sql`, líneas 409-436) busca una reserva activa así:
```sql
SELECT r.id INTO v_reserva_id FROM public.reservas r
 WHERE r.hotel_id = v_pedido.hotel_id AND r.habitacion_id = v_pedido.habitacion_id
   AND r.estado IN ('activa', 'check_in', 'ocupada')
 ORDER BY r.fecha_inicio DESC NULLS LAST LIMIT 1;
```
Si no encuentra ninguna (huésped ya hizo check-out, la reserva cambió de estado, o el pedido web quedó pendiente más tiempo del que dura la estancia), `v_reserva_id` queda `NULL` y aun así se inserta la venta con `reserva_id = NULL`, se descuenta stock y se marca `entregado`. El cálculo de cuenta de habitación en `js/modules/mapa-habitaciones/modales-gestion.js` (línea 1831-1835) filtra estrictamente:
```js
.from('ventas_tienda').select('id, total_venta, estado_pago').eq('hotel_id', hotelId).eq('reserva_id', reserva.id)
```
Una venta con `reserva_id = NULL` **nunca aparecerá en ninguna cuenta de habitación**, ni tiene movimiento de `caja` (queda `estado_pago='pendiente'` para siempre). Resultado: el producto sale físicamente (stock ya descontado, mesero ya entregó), pero el cobro se pierde silenciosamente — no hay pantalla que liste "ventas de tienda pendientes sin reserva". Es un bug de dinero real, no solo de datos.

Corrección sugerida: si `v_reserva_id` es `NULL` al momento de entregar, la función debería rechazar la entrega ("no hay reserva activa en esta habitación, verifica antes de entregar") o exponer explícitamente estas ventas huérfanas en algún reporte de cobros pendientes.

### H2 — HIGH: dos implementaciones divergentes de "venta de tienda" con distinto nivel de garantías

> **Estado posterior al corte (2026-09-18):** A15 resuelto, probado y aplicado en Supabase staging mediante `20260918120000_a15_a16_tienda_inventario_atomico.sql`. `procesar_venta_tienda_atomica` y `actualizar_estado_pedido_web_tienda` delegan en un único núcleo privado. El núcleo agrega productos duplicados, bloquea en orden estable, valida stock/pagos/descuentos, consolida métodos de pago repetidos y confirma venta, detalle, stock, movimiento, caja y auditoría en una transacción. Mantiene explícitamente las dos políticas correctas de precio: catálogo para POS y precio congelado para pedidos web. Producción y aceptación funcional siguen pendientes.
`procesar_venta_tienda_atomica` (fase1, atómico, idempotente, exige `tienda.operar`, registra `movimientos_inventario` y `auditoria_operaciones`) y `actualizar_estado_pedido_web_tienda` (pre-fase1, sin idempotencia, sin `movimientos_inventario`, autorización más débil) hacen esencialmente lo mismo — insertar en `ventas_tienda`/`detalle_ventas_tienda` y descontar stock — con código SQL completamente distinto y mantenido por separado. Ya han divergido de forma visible: los estados de reserva considerados "activa" difieren entre el flujo JS de POS (`pos.js` línea 756: `['activa', 'ocupada', 'tiempo agotado']`) y el flujo SQL de pedidos web (`['activa', 'check_in', 'ocupada']`) — ninguna de las dos listas es superconjunto de la otra. Esta divergencia es la causa raíz de H1. Recomendación: unificar sobre `procesar_venta_tienda_atomica` (pasarle `p_modo='habitacion'` desde `actualizar_estado_pedido_web_tienda` en vez de reimplementar el insert) o al menos centralizar la lista de estados de reserva "activa" en una función SQL reutilizable.

### H3 — MEDIUM: entrega de pedido web no dispara `movimientos_inventario`

> **Estado posterior al corte (2026-09-10):** resuelto junto con C5. Cada producto descontado genera una salida `venta_tienda_pedido_web` con stock anterior/nuevo y referencias al pedido y a la venta. El trigger de ajustes de CMV excluye esta razón porque el detalle de venta ya genera el costo, evitando doble contabilización.
Consecuencia directa de H2: el stock descontado por `actualizar_estado_pedido_web_tienda` no deja rastro en `movimientos_inventario`, por lo que no aparece en el historial filtrable (`historial-movimientos.js`, sección 2.6) ni en el historial legado de `inventario.js`. Un administrador reconciliando salidas de stock contra ventas no podrá explicar la diferencia entre `stock_actual` y la suma de movimientos registrados si hay pedidos web entregados.

### H4 — HIGH: ajuste manual de stock (`inventario.js:saveMovimiento`) no es atómico ni bloquea la fila — riesgo de "lost update"
> **Estado posterior al corte (2026-09-18):** A16 resuelto, probado y aplicado en Supabase staging con la misma migración de A15. `saveMovimiento` usa una operación estable y llama exclusivamente a `ajustar_stock_tienda_seguro`; la función bloquea la fila, rechaza stock negativo y actores sin permiso, conserva idempotencia y revierte también el stock si falla el movimiento o la auditoría. El frontend usa los valores anterior/nuevo devueltos por el servidor para refrescar la tabla y emitir el aviso de stock bajo.

A diferencia de los tres RPCs atómicos del dominio (2.1, 2.5, y los de Terraza), el ajuste manual de INGRESO/SALIDA (líneas 728-811 de `js/modules/tienda/inventario.js`) hace, desde el navegador:
```js
const stockAnterior = producto.stock_actual; // leído de un array cacheado en memoria
...
await tiendaState.currentSupabase.from('movimientos_inventario').insert([movimientoData]); // 1
await tiendaState.currentSupabase.from('productos_tienda').update({ stock_actual: nuevoStock, ... }).eq('id', productoId); // 2
```
Sin `FOR UPDATE`, sin transacción, y sin condición `.eq('stock_actual', stockAnterior)` en el `UPDATE` para detectar cambios concurrentes. Si dos usuarios ajustan el mismo producto casi al mismo tiempo (o un ajuste coincide con una venta POS), el segundo `UPDATE` sobrescribe el stock con un valor calculado sobre datos obsoletos — lost update clásico. Además, si la llamada 1 tiene éxito y la 2 falla (red, RLS, error), queda un `movimientos_inventario` que no corresponde al `stock_actual` real, y el trigger de costeo (`fase4_inventory_adjustment_cost`) ya habrá procesado ese movimiento contra `inventory_cost_balances`, contaminando la valorización. Recomendación: mover este flujo a un RPC atómico con `FOR UPDATE`, igual que `procesar_venta_tienda_atomica`/`recibir_compra_tienda_atomica`.

### H5 — LOW: `descontar_stock_por_venta` es código muerto confirmado — apto para retirar

> **Estado posterior al corte (B5, 2026-10-02): corregido, probado y aplicado en Supabase staging.** La migración `20261001130000_b5_drop_dead_stock_function.sql` elimina únicamente la firma obsoleta, sin `CASCADE`. La revisión confirmó que no tenía consumidores JavaScript ni dependencias SQL posteriores; staging solo concedía ejecución a `service_role`. El dry run transaccional pasó y la comprobación remota posterior confirmó que la función ya no existe. Producción no fue modificada. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

En el corte auditado, el grep de todo `js/` y `supabase/migrations/` encontraba la función únicamente en `supabase/migrations/20260326191500_baseline_public_schema.sql` (definición original) y ninguna invocación desde JavaScript, triggers o funciones posteriores. La auditoría financiera anterior (01-estado-actual.md) ya la señalaba como "función obsoleta" por referenciar tablas (`recetas`, `recetas_items`) que no existen en el esquema capturado. No era un riesgo activo porque nadie la llamaba, pero dejarla disponible confundía futuras auditorías y mantenía una superficie innecesaria si alguna vez recibía permisos adicionales.

### H6 — LOW: `cargarDatosPOS` no filtra `categorias_producto` por `hotel_id` explícitamente

> **Estado posterior al corte (B6, 2026-10-02): corregido y probado.** `cargarDatosPOS()` aplica ahora `.eq('hotel_id', tiendaState.currentHotelId)` a la lectura de categorías, igual que las demás superficies de Tienda. La regresión comprueba el filtro explícito y conserva la política RLS tenant-safe como segunda barrera. El preview protegido quedó `READY` y el asset publicado coincide exactamente con el local. No se requirió migración; producción y la aceptación funcional siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/tienda/pos.js` líneas 112-114:
```js
const { data: categorias } = await tiendaState.currentSupabase.from('categorias_producto').select('id, nombre');
```
Sin `.eq('hotel_id', ...)`. Hoy esto no es una fuga de datos porque `supabase/migrations/20260827070843_pre_fase14_tenant_policy_cleanup.sql` ya restringe `categorias_producto` con una política RLS `for all ... using (fase1_actor_es_miembro_activo(hotel_id))`, así que el resultado real ya viene acotado al hotel del usuario. Pero es una inconsistencia de estilo (todo el resto del módulo sí filtra explícitamente) y una dependencia implícita y no documentada en RLS: si esa política cambiara alguna vez a `USING (true)` (ya ocurrió antes en este mismo proyecto según la auditoría financiera de 01-estado-actual.md), este query dejaría de estar protegido sin que nadie lo note en el código JS. Recomendación: añadir el filtro explícito como defensa en profundidad.

---

## 4. Qué está bien resuelto (no solo problemas)

- **RPCs atómicas para las operaciones críticas de dinero/stock**: `procesar_venta_tienda_atomica` y `recibir_compra_tienda_atomica` usan `SECURITY DEFINER`, `FOR UPDATE` sobre las filas de producto/turno/compra, validación de hotel y permiso, e idempotencia por `client_operation_id` — resuelven exactamente los riesgos de "venta no atómica" y "sin idempotency key" que la auditoría financiera de agosto había señalado para el flujo de Tienda.
- **Diseño de costeo/CMV por triggers sobre las tablas de hechos** (`detalle_ventas_tienda`, `detalle_compras_tienda`, `movimientos_inventario`, `ventas_restaurante_items`, `terraza_pedidos`, `bitacora`), en vez de embebido en cada RPC de venta. Esto hace que el CMV se calcule correctamente sin importar cuántos caminos de inserción distintos existan (incluido el camino legado de pedidos web, H2), y evita doble conteo excluyendo explícitamente las razones/tipos ya cubiertos por otro trigger.
- **RLS reforzada de forma consistente en fase1/pre-fase14**: `movimientos_inventario`, `ventas_tienda`, `detalle_ventas_tienda` y `categorias_producto` pasaron de políticas permisivas o inexistentes (según documentó la propia auditoría financiera) a políticas que exigen membresía activa del hotel y, para escritura, el permiso de negocio correspondiente (`tienda.operar`, `inventario.ajustar`).
- **Separación de responsabilidades entre categorías/proveedores/productos/compras**: cada archivo (`categorias.js`, `proveedores.js`, `compras.js`, `compras-pendientes.js`, `lista-compras.js`) tiene un alcance claro y consistente, todos apoyados en el mismo `tiendaState` singleton — la estructura modular en sí es razonable, el problema identificado es específicamente la mezcla de responsabilidades dentro de `helpers.js`, no la organización del módulo en general.
- **Historial de inventario filtrable reciente** corrige correctamente el filtrado por `hotel_id` y el sesgo de zona horaria (UTC vs. hora del hotel) que documentaba la auditoría financiera anterior.

---

## 5. Archivos revisados

- `js/modules/tienda/helpers.js`, `pos.js`, `inventario.js`, `pedidos-web.js`, `historial-movimientos.js`, `compras-pendientes.js`, `categorias.js`, `state.js`
- `js/modules/mapa-habitaciones/modales-gestion.js` (cuenta de habitación, para verificar H1)
- `js/modules/costeo/costeo.js`
- `supabase/migrations/20260809103000_fase1_tienda_atomica.sql`
- `supabase/migrations/20260825120000_recibir_compra_tienda_atomica.sql`
- `supabase/migrations/20260825160000_fase4_costeo_inventario_cmv.sql`
- `supabase/migrations/20260825161000_fase4_ajustes_inventario_valorizados.sql`
- `supabase/migrations/20260619180000_tienda_web_pedidos.sql`
- `supabase/migrations/20260809100000_fase1_authz_rls_base.sql`
- `supabase/migrations/20260827070843_pre_fase14_tenant_policy_cleanup.sql`
- `supabase/migrations/20260326191500_baseline_public_schema.sql` (definición muerta de `descontar_stock_por_venta`)
- `docs/auditoria-financiera/23-fase4-costeo-inventario-cmv.md`, `docs/auditoria-financiera/01-estado-actual.md`
