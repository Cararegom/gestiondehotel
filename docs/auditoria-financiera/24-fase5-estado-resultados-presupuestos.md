# Fase 5 — Estado de resultados, presupuestos y periodos

## Decisión de producto

`Reportes` pasa a ser el centro de información del hotel. Los reportes operativos siguen disponibles para los roles que ya los utilizaban. Dentro de la misma pantalla, únicamente el administrador ve:

- Estado de resultados.
- Cuentas financieras.
- Gastos y cuentas por pagar.
- Costeo y margen.

Las rutas anteriores se conservan por compatibilidad, aunque ya no aparecen como opciones independientes en el menú.

## Alcance financiero

Se incorpora un estado de resultados en modo `shadow`, es decir, informativo y trazable, sin modificar la operación. Consolida:

- Ingresos de habitaciones, servicios y otros movimientos válidos de Caja.
- Ingresos y costo de ventas congelado de Tienda, Restaurante y Terraza desde `cogs_entries`.
- Gastos operativos no cancelados desde Cuentas por pagar.
- Reversiones de ingresos como valores negativos.

El informe presenta ingresos, CMV, margen bruto, gastos y resultado operativo; desglose por área, gastos por centro de costo y hasta 300 movimientos de trazabilidad.

## Presupuestos y cierre

El administrador puede definir por mes una meta de ingresos, presupuesto de CMV y presupuesto de gastos operativos. También puede cerrar o reabrir el mes, dejando auditoría del actor y fecha.

Durante esta fase `shadow`, cerrar un periodo deja evidencia administrativa pero no bloquea movimientos operativos. Ese bloqueo debe activarse solamente después de validar cifras y formalizar el procedimiento de cierre.

## Seguridad

- Las tablas nuevas tienen RLS.
- Los cambios se hacen únicamente mediante funciones autorizadas.
- Las funciones verifican en la base de datos que el usuario sea administrador activo del hotel.
- La vista consolidada no se expone directamente al navegador.
- Recepción no ve las pestañas financieras ni puede ejecutar sus funciones.

## Criterio de salida

Antes de considerar el estado de resultados como oficial se debe completar al menos un cierre mensual de prueba, conciliarlo contra Caja/CxP/inventarios y resolver cualquier venta con novedad de costo.

## Control de cierre incorporado

El cierre mensual se rechaza si el periodo contiene una venta con `cost_issue`. El informe muestra el producto, fecha, ingreso y causa, junto con accesos a Restaurante y Costeo y margen. Esta validación solo protege el cierre financiero: no bloquea Caja, ventas, recepción ni liberación de habitaciones.

En la comprobación productiva del 25 de agosto de 2026 se identificó una venta de `mojarra` por $12.000 sin CMV porque el plato no tiene receta configurada. El sistema no asignó un costo ficticio. Para resolverla se debe:

1. configurar en Restaurante los ingredientes y cantidades reales de la mojarra;
2. verificar que esos ingredientes tengan costo y existencias;
3. usar `Recalcular` en Costeo y margen;
4. confirmar que el informe indique cero ventas con costo pendiente;
5. ejecutar el cierre mensual de prueba.
