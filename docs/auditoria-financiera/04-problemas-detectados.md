# Auditoría financiera — problemas detectados

## Criterio de severidad

- **CRÍTICO**: permite mezcla/exposición entre hoteles, fraude, pérdida de trazabilidad o estados financieros materialmente falsos.
- **ALTO**: puede producir inconsistencias monetarias frecuentes o impide cálculos esenciales.
- **MEDIO**: reduce precisión/control y escala mal, pero tiene mitigaciones operativas.
- **BAJO**: deuda técnica o ambigüedad con impacto limitado inmediato.

## Resumen

| Severidad | Hallazgos |
| --- | ---: |
| CRÍTICO | 6 |
| ALTO | 10 |
| MEDIO | 8 |
| BAJO | 3 |

## CRÍTICO

### C-01 — RLS permisiva anula el aislamiento multi-hotel

- **Qué ocurre:** varias tablas tienen políticas `USING (true)`/`WITH CHECK (true)` junto a políticas por hotel. PostgreSQL combina políticas permisivas con OR, de modo que la política abierta gana.
- **Dónde:** baseline líneas 3050–3107, 3154–3199, 3429–3459 y 3521–3556.
- **Tablas:** `categorias_producto`, `detalle_ventas_tienda`, `proveedores`, `ventas_tienda`, `productos_tienda`.
- **Riesgo:** un usuario autenticado puede leer/modificar/eliminar datos de otro hotel si realiza consultas directas, aunque la UI filtre.
- **Ejemplo:** consultar `ventas_tienda` sin `.eq('hotel_id', ...)` puede devolver ventas cruzadas por la política SELECT verdadera.

### C-02 — Tablas financieras sin RLS

- **Qué ocurre:** 37/66 tablas del snapshot no tienen RLS.
- **Dónde:** `docs/supabase-rls-audit.md`; esquema capturado.
- **Tablas relevantes:** `ventas_restaurante`, `ventas_restaurante_items`, `ingredientes`, `platos`, `platos_recetas`, `bitacora`, `log_caja_eliminados`, inventarios de limpieza.
- **Riesgo:** exposición o mutación transversal; los items de restaurante ni siquiera llevan `hotel_id` en el snapshot.
- **Ejemplo:** una consulta directa a `ventas_restaurante` podría acceder a todos los hoteles conforme a grants, sin que el filtro frontend sea una barrera.

### C-03 — Cobros y ventas no atómicos

- **Qué ocurre:** una operación comercial se reparte en varios inserts/updates/RPC desde el navegador.
- **Archivos/funciones:** `js/modules/tienda/pos.js:726`; `js/modules/restaurante/restaurante.js:529`; `js/modules/reservas/reservas-pagos.js:168`; `js/modules/mapa-habitaciones/modales-gestion.js:1801`; `js/uiUtils.js:465`.
- **Tablas:** ventas/detalles/stock, `pagos_reserva`, `reservas`, `caja`.
- **Riesgo:** venta sin caja, caja sin detalle, pago sin caja, stock incorrecto, duplicación por reintento.
- **Ejemplo:** en abonos se inserta el pago antes de caja; sin turno el código conserva el pago y pide crear ingreso manual, perdiendo vínculo o duplicándolo.

### C-04 — Borrado físico de evidencias financieras

- **Qué ocurre:** se borran reservas, pagos y movimientos de caja; ventas/detalles admiten DELETE.
- **Archivos/funciones:** `reservas-estado.js:3` y `:168`; `caja-movimientos.js:321`; RPC `registrar_y_eliminar_mov_caja`.
- **Tablas:** `reservas`, `pagos_reserva`, `caja`, ventas y detalles.
- **Riesgo:** historia financiera incompleta, fraude y reportes retroactivos variables.
- **Ejemplo:** cancelar una reserva elimina caja y pagos en lugar de registrar reembolso/reversión.

### C-05 — RPC de borrado `SECURITY DEFINER` sin autorización capturada

- **Qué ocurre:** `registrar_y_eliminar_mov_caja` recibe el usuario actor como parámetro, copia la fila y la borra, pero no valida `auth.uid()`, rol ni hotel y no fija `search_path`.
- **Dónde:** `supabase/snapshots/public-functions.json`, función indicada; invocación `caja-movimientos.js:342`.
- **Riesgo:** si EXECUTE está disponible para un rol cliente, cualquier actor podría intentar borrar un movimiento conocido de otro hotel y suplantar `eliminado_por`.
- **Ejemplo:** pasar UUID de movimiento y UUID arbitrario como eliminador.

### C-06 — No existe costo de ventas ni utilidad real

- **Qué ocurre:** tienda/Terraza no guardan costo; restaurante no congela costo por venta. El reporte llama “balance neto” a ingresos de caja menos egresos.
- **Dónde:** esquema `productos_tienda`, `detalle_ventas_tienda`, `terraza_productos`; `reportes.js:820–833`.
- **Riesgo:** decisiones de precio y rentabilidad basadas en cifras materialmente incorrectas.
- **Ejemplo:** cerveza comprada en marzo y vendida en abril: marzo muestra egreso/pérdida y abril muestra $6.000 completos de “balance”, sin CMV de $3.000.

## ALTO

### A-01 — `caja` mezcla flujo de caja y resultado

- **Qué ocurre:** ingresos, gastos, compras, retiros y transferencias potenciales comparten `tipo` y concepto libre.
- **Dónde:** `caja`; `reportes.js:775`.
- **Riesgo:** no se distingue operación, inversión, financiación o propietario; no hay P&L.

### A-02 — Fuente duplicada de pagos sin reconciliación interna

- **Qué ocurre:** `pagos_reserva`, `reservas.monto_pagado` y `caja` representan el mismo cobro.
- **Dónde:** flujos de pago citados.
- **Riesgo:** tres saldos distintos; no hay constraint de unicidad ni job de detección.
- **Ejemplo:** el pago se inserta, falla caja y después se agrega manualmente sin `pago_reserva_id`.

### A-03 — RLS concede CRUD financiero por pertenecer al hotel

- **Qué ocurre:** `caja` usa `FOR ALL` por hotel; `pagos_reserva` da SELECT/INSERT/UPDATE/DELETE a usuarios del hotel.
- **Dónde:** baseline 3292–3297 y 3306–3326.
- **Riesgo:** recepcionista puede alterar/importes/borrar pagos mediante API directa; la UI no equivale a permiso.

### A-04 — El arqueo no se persiste

- **Qué ocurre:** valores reales y diferencias se calculan en memoria/HTML; `turnos` solo recibe `balance_final`.
- **Dónde:** `caja-cierre.js:346–445`; `caja-turnos.js:515`.
- **Riesgo:** no se puede auditar faltante por método, quién contó, quién aprobó ni la explicación.

### A-05 — Clasificación financiera por texto libre

- **Qué ocurre:** reportes/cierre buscan “tienda”, “reserva”, “nómina”, etc.; desconocidos se asignan a habitaciones.
- **Dónde:** `caja-cierre.js:31–56`; `reportes.js` función `categorizarMovimiento`.
- **Riesgo:** errores silenciosos y categorías no comparables.
- **Ejemplo:** “Pago minibar” sin palabra tienda se clasifica como habitaciones.

### A-06 — Fechas UTC y fechas heterogéneas

- **Qué ocurre:** rangos se crean con sufijo `Z`; cada módulo usa columnas distintas.
- **Dónde:** `reportes.js:298–311`, `:398–425`, `:788–802`.
- **Riesgo:** operación después de las 19:00 Bogotá puede quedar en otra fecha UTC; cierres y reportes discrepan.

### A-07 — Compras, recepción y pago acoplados

- **Qué ocurre:** al recibir una compra se aumenta stock, marca recibido y crea egreso; no existe deuda.
- **Dónde:** `compras-pendientes.js:125–207`.
- **Riesgo:** imposible registrar factura pendiente/parcial y distinguir compra de pago.

### A-08 — Función genérica de stock insegura/obsoleta

- **Qué ocurre:** POS llama `increment(table_name, column_name, row_id, amount)`; la función genérica permite nombres dinámicos y el flujo no aporta hotel.
- **Dónde:** `tienda/pos.js:805`; snapshot de funciones.
- **Riesgo:** superficie de abuso, falta de validación de stock/hotel e historial incompleto.

### A-09 — No hay idempotencia en ventas/cobros principales

- **Qué ocurre:** ventas/pagos frontend no tienen `client_operation_id` único.
- **Dónde:** payloads de POS y pagos.
- **Riesgo:** doble clic, timeout/reintento o reconexión puede duplicar venta y cobro.

### A-10 — Pagos parciales sin aplicación por cargo

- **Qué ocurre:** saldo se deriva globalmente y luego todos los extras pendientes pueden marcarse pagados.
- **Dónde:** `modales-gestion.js:1870–1891`, `:1952–1966`; `uiUtils.js:465`.
- **Riesgo:** no se sabe qué parte pagó alojamiento, tienda o restaurante; cuentas por cobrar y revenue por área son ambiguos.

## MEDIO

### M-01 — Campos legacy duplicados

- **Qué ocurre:** `productos_tienda` contiene `precio`/`precio_venta` y `stock`/`stock_actual`; restaurante tiene `monto_total`/`total_venta` y fechas alternativas.
- **Riesgo:** módulos distintos leen valores distintos.

### M-02 — Edición de método sin historial

- **Qué ocurre:** admin actualiza directamente `caja.metodo_pago_id`.
- **Dónde:** `caja-movimientos.js:274–306`.
- **Riesgo:** cambia arqueos/reportes históricos sin razón ni antes/después.

### M-03 — Métodos de pago no están tipificados ni ligados a cuentas

- **Qué ocurre:** solo hay nombre libre.
- **Riesgo:** “Transferencia”, “Llave” y “QR” no identifican banco/cuenta; no se concilia saldo.

### M-04 — Propinas tratadas como ingreso

- **Qué ocurre:** Terraza crea movimiento de ingreso y el reporte suma propina dentro de total.
- **Riesgo:** si pertenece al personal debería ser pasivo por pagar, no revenue del hotel.

### M-05 — Funciones históricas incompatibles con esquema

- **Qué ocurre:** `procesar_venta_tienda_simple_y_caja` intenta columnas antiguas en `ventas_tienda`; `descontar_stock_por_venta` usa tablas no capturadas.
- **Dónde:** snapshot de funciones.
- **Riesgo:** código muerto/confusión y llamadas futuras que fallen.

### M-06 — Ausencia de cierre de periodo

- **Qué ocurre:** se aceptan movimientos con fecha anterior y se pueden editar/borrar.
- **Dónde:** `caja.js:615–671`.
- **Riesgo:** reportes mensuales cambian después de aprobados.

### M-07 — Compras/ventas sin moneda ni precisión uniforme

- **Qué ocurre:** hay `numeric` de distintas precisiones y frontend usa Number/parseFloat/asInt.
- **Riesgo:** redondeos e incompatibilidad si se habilitan monedas/decimales.

### M-08 — Terraza hardcodeada a un hotel

- **Qué ocurre:** UUID fijo en frontend y RLS.
- **Dónde:** `main.js:99`; migración Terraza.
- **Riesgo:** no escala al SaaS multi-hotel sin migración/configuración.

## BAJO

### B-01 — Dos tablas de log de caja similares

`log_caja_eliminados` y `caja_movimientos_eliminados` aumentan ambigüedad y pueden tener cobertura diferente.

### B-02 — Categorías de reporte en cliente

Además de ser frágiles, duplican reglas entre Reportes y Cierre y dificultan pruebas/versionado de definiciones.

### B-03 — Sin documentación de fuente autoritativa

No hay contrato formal que declare si venta, pago o caja manda para cada KPI. Distintas pantallas eligen fuentes diferentes.

## Observación sobre el piloto bancario

La migración local `20260803120000_bank_email_payments_pilot.sql` corrige varios patrones (fingerprints, estados, auditoría, restricciones y revisión), pero era un cambio no versionado al comenzar la auditoría y no se asumió desplegado. Debe integrarse al nuevo modelo, no crear un segundo subsistema financiero paralelo.
