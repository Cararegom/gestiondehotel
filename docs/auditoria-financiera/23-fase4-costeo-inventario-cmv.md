# Fase 4 — Costeo de inventario y CMV

Estado: implementada en modo shadow y validada en staging el 25 de agosto de 2026.

## Resultado

Se agregó un libro valorizado separado del stock operativo. No se inventan costos históricos: los artículos sin base confiable aparecen como **requiere costo inicial** hasta que administración registra el costo unitario actual.

Desde la activación:

- las compras recibidas de Tienda recalculan el costo promedio móvil;
- las ventas de Tienda congelan costo, ingreso y margen por producto;
- las recetas de Restaurante descuentan ingredientes dentro de la venta atómica y congelan el CMV del plato;
- las ventas de Terraza congelan el costo de sus productos;
- las transferencias Tienda ↔ Terraza trasladan cantidad y valor sin crear ingreso ni gasto;
- los ajustes manuales conservan cantidad y valor;
- los artículos nuevos entran automáticamente al libro de costos;
- el módulo administrativo **Costeo y margen** muestra inventario valorizado, CMV y margen bruto.

## Seguridad

Las tablas de saldos, movimientos de valoración y CMV tienen RLS por hotel. El navegador solo puede leerlas. El costo inicial se modifica mediante un RPC autorizado; las compras, ventas, recetas y transferencias escriben mediante triggers dentro de la misma transacción operativa.

## Tratamiento histórico

Las existencias presentes al momento del corte se copian con valor cero y estado `uninitialized`, salvo ingredientes que ya tenían `costo_unitario`. El administrador debe indicar el costo promedio actual antes de considerar oficial el margen. Los reportes existentes no se sustituyen todavía.

## Validación en staging

- compra de 10 unidades a COP 3.000: inventario COP 30.000 y promedio COP 3.000;
- venta a COP 5.000 con costo COP 3.000: margen COP 2.000;
- movimiento de valoración enlazado a la recepción: correcto;
- Hotel B no puede leer el CMV del Hotel A;
- staging no contenía recetas activas para una prueba no destructiva; el contrato de receta y stock queda cubierto por pruebas automatizadas y debe observarse con la primera receta real.

## Archivos

- `supabase/migrations/20260825160000_fase4_costeo_inventario_cmv.sql`
- `supabase/migrations/20260825161000_fase4_ajustes_inventario_valorizados.sql`
- `supabase/migrations/20260825162000_fase4_nuevos_items_costeo.sql`
- `supabase/migrations/20260825170000_fase4_precio_compra_costeo_tienda.sql`
- `supabase/migrations/20260825171000_fase4_restaurante_recetas_cmv.sql`
- `js/modules/costeo/costeo.js`
- `tests/fase4-costeo.test.cjs`

Para Tienda, el campo `productos_tienda.precio` ("Precio compra") inicializa automáticamente el costo del inventario existente y de productos nuevos. Cuando se recibe la primera compra valorizada, el costo promedio móvil pasa a ser la fuente contable y las ediciones posteriores de la ficha no lo sobrescriben.

Para Restaurante, cada plato activo debe tener una receta. La venta descuenta las cantidades configuradas de cada ingrediente y congela su CMV. Los registros anteriores que quedaron en cero por falta de receta se marcan como pendientes y pueden reprocesarse desde Costeo y margen después de completar la receta.

## Siguiente fase

Fase 5: P&L, presupuestos, periodos financieros y rentabilidad por centro de costo.
