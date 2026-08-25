# Auditoría financiera — estado actual

Fecha de corte: 2026-08-09  
Alcance: ingresos, gastos, caja, habitaciones, reservas, tienda, restaurante, terraza, inventarios, reportes, trazabilidad, permisos y multi-hotel.

## 1. Alcance y fuentes

Esta auditoría es estática y de solo lectura. No se ejecutaron migraciones, no se modificó la base de datos y no se cambió código del sistema. Las fuentes revisadas fueron:

- frontend JavaScript en `js/modules`, `js/services`, `js/uiUtils.js` y `js/main.js`;
- esquema base en `supabase/migrations/20260326191500_baseline_public_schema.sql`;
- migraciones posteriores, incluidas Terraza, pagos mixtos y el piloto bancario;
- snapshot versionado `supabase/snapshots/database-context.json` y funciones de `public-functions.json`;
- Edge Functions, especialmente el piloto Gmail/Bancolombia y el envío de cierres;
- pruebas y documentación técnica existente.

Limitación importante: el snapshot contiene 66 tablas y representa el esquema capturado, mientras que migraciones posteriores agregan objetos que no aparecen allí. No se consultó el catálogo de la base productiva durante esta auditoría; por eso se distingue entre **confirmado en snapshot**, **definido en migración** y **usado por frontend**. Una migración local no prueba por sí sola que el objeto esté desplegado.

## 2. Conclusión ejecutiva

Hoy el sistema registra operación hotelera y cobros, pero no posee un módulo contable. La entidad central es `caja`: una bitácora de entradas y salidas usada para turnos, arqueos y reportes. En paralelo existen documentos operativos (`reservas`, `ventas_tienda`, `ventas_restaurante`, `terraza_pedidos`, `compras_tienda`) y registros de cobro (`pagos_reserva`). No hay un libro financiero único, cuentas contables, cuentas de efectivo/banco, cuentas por pagar, pagos de facturas, retiros/aportes del propietario, presupuestos, activos, pasivos ni cierres contables.

Consecuencias:

- sí se puede estimar cuánto dinero entró o salió según `caja`;
- sí se puede desglosar parte de los ingresos por referencias de venta y método de pago;
- no se puede calcular utilidad real ni P&L confiable;
- no se puede calcular costo de mercancía vendida de tienda o terraza;
- restaurante tiene costo unitario de ingredientes, pero no un costeo histórico confiable por venta;
- “balance neto” actual es flujo de caja (`ingresos - egresos`), no utilidad;
- los procesos distribuidos en varias escrituras frontend pueden quedar incompletos;
- hay borrado físico y edición directa de movimientos financieros;
- el aislamiento multi-hotel es inconsistente en RLS, aunque muchas consultas frontend sí filtran `hotel_id`.

## 3. Modelo financiero actual

### 3.1 Documentos operativos

| Área | Documento principal | Detalle | Estado/cobro |
| --- | --- | --- | --- |
| Habitaciones | `reservas` | estancia, precio, impuestos, descuento | `monto_pagado` agregado y `pagos_reserva` |
| Servicios | `servicios_x_reserva` | cantidad y `precio_cobrado` | `estado_pago`, `pago_reserva_id` |
| Tienda | `ventas_tienda` | `detalle_ventas_tienda` | `estado_pago`, opcionalmente cargada a habitación |
| Restaurante | `ventas_restaurante` | `ventas_restaurante_items` | `estado_pago`, opcionalmente cargada a habitación |
| Terraza | `terraza_pedidos` | `terraza_pedido_items` | abierto/pagado/cancelado, anticipo y propina en migraciones |
| Compra tienda | `compras_tienda` | `detalle_compras_tienda` | estado de orden/recepción, no cuenta por pagar |

### 3.2 Registro de dinero

`caja` registra `tipo` (`apertura`, `ingreso`, `egreso`, `ajuste`, `cierre`), monto, concepto, método, usuario, turno y referencias opcionales. Es simultáneamente:

1. diario de movimientos del turno;
2. fuente de saldo esperado;
3. fuente de reportes de ingresos/egresos;
4. mecanismo para registrar gastos manuales;
5. vínculo de cobros con habitaciones, tienda, restaurante, terraza y compras.

Esto simplifica la operación, pero mezcla venta, cobro, gasto, pago y transferencia en una sola semántica. Un egreso manual de “nómina”, una compra de inventario y un retiro del propietario son indistinguibles salvo por texto libre.

### 3.3 Turnos y arqueo

- `abrir_turno_con_apertura` crea atómicamente `turnos` y un movimiento `caja` tipo `apertura`.
- Existe índice único para un turno abierto por usuario/hotel.
- Los ingresos/egresos se asocian opcionalmente a `turno_id`; la interfaz permite egresos fuera de turno.
- El cierre lee movimientos del turno, clasifica por texto/referencias y calcula apertura + ingresos - egresos.
- El usuario declara valor real por **cada método de pago**, no solo efectivo.
- `cerrar_turno_con_balance` guarda únicamente `balance_final`; no persiste el arqueo detallado, diferencias por método, observación, aprobador ni conteo de denominaciones.
- No se crea un movimiento de cierre ni una transferencia formal del turno a una cuenta.

Fortalezas: apertura/cierre protegidos por RPC, bloqueo de turnos ajenos, asociación por turno y comparación esperado/real. Debilidades: arqueo no persistido, clasificación textual y ausencia de cuentas reales.

## 4. Cómo entran hoy los ingresos

### 4.1 Habitaciones, reservas y abonos

Una reserva almacena el valor comprometido en `reservas.monto_total`. El dinero cobrado se registra en `pagos_reserva`; luego normalmente se crea un `caja` tipo ingreso enlazado por `pago_reserva_id` y `reserva_id`, y se actualiza `reservas.monto_pagado`.

Hay varios caminos de cobro:

- modal de abono de reservas en `reservas-pagos.js`;
- cuenta detallada de habitación en `modales-gestion.js`;
- cobro de consumos en `uiUtils.js`;
- creación/edición histórica en `reservas.js`;
- cancelación/reembolso lógico en `reservas-estado.js`.

No todos usan una transacción SQL. Por ejemplo, el modal de abono inserta `pagos_reserva`, actualiza `reservas.monto_pagado` y después inserta `caja`. Si no hay turno, conserva el pago sin movimiento de caja. Si cualquier paso falla, el estado queda parcial. La interfaz incluso informa al usuario que registre el ingreso manualmente, lo cual rompe el vínculo e introduce riesgo de duplicación.

Los pagos parciales existen para alojamiento/consumos a través de múltiples filas en `pagos_reserva`. Sin embargo, no existe una asignación normalizada de cada pago a cada cargo: `pagos_cargos` aparece en el esquema, pero no se encontró un flujo operativo que lo use; los extras se marcan globalmente pagados al liquidar, lo que impide reconstruir con precisión aplicaciones parciales.

### 4.2 Servicios y consumos de habitación

`servicios_x_reserva` registra servicios cobrados o manuales. Tienda y restaurante pueden generar ventas pendientes ligadas a `reserva_id`. La cuenta de habitación suma:

`reserva.monto_total + servicios + ventas_tienda + ventas_restaurante - pagos_reserva`.

Al pagar, se crea uno o varios pagos y movimientos de caja, y después se cambian estados de todos los consumos pendientes a pagado. No hay distribución del pago por concepto ni prioridades de aplicación persistidas. Terraza no forma parte de esta cuenta de habitación.

### 4.3 Tienda

El POS calcula subtotal y descuento en el navegador. Luego:

1. inserta `ventas_tienda`;
2. inserta cada `detalle_ventas_tienda`;
3. decrementa `productos_tienda.stock_actual` mediante el RPC genérico `increment`;
4. si es pago inmediato, inserta uno o varios ingresos en `caja`;
5. si se carga a habitación, deja la venta pendiente y no crea caja.

No es atómico. Una falla puede dejar venta sin detalles, stock sin venta, venta sin caja o caja parcial. Tampoco se revisan todos los errores dentro del bucle. No existe idempotency key para impedir doble venta por reintento/doble clic.

### 4.4 Restaurante

El flujo activo inserta `ventas_restaurante`, sus items y movimientos `caja` desde el frontend en llamadas separadas. Puede ser pago inmediato o cargo pendiente a habitación. Los platos pueden tener recetas (`platos_recetas`) y los ingredientes tienen `costo_unitario`, pero no se encontró en el flujo activo una deducción confiable y atómica de ingredientes por cada venta. La función antigua `descontar_stock_por_venta` referencia tablas/columnas (`recetas`, `recetas_items`, `venta_restaurante_item_id`) que no están en el esquema capturado, señal de lógica obsoleta o no operativa.

### 4.5 Terraza

Terraza está limitada en código y RLS a un hotel específico. Sus migraciones ofrecen el flujo más transaccional:

- items recalculan el total del pedido mediante trigger;
- el cierre de cuenta es un RPC con validación de actor, turno, hotel, total, anticipo, propina y stock;
- los pagos mixtos se dividen en movimientos `caja` dentro de una transacción;
- `caja.venta_terraza_id` permite reportar consumo y propina.

No obstante, el costo del producto no existe en `terraza_productos`; solo precio y stock. Las transferencias desde tienda mueven unidades, no capas/valor de costo. Por tanto, tampoco hay margen bruto de Terraza.

### 4.6 Otros ingresos y propinas

La pantalla de caja permite movimientos manuales de ingreso/egreso con concepto libre, método y fecha incluso retroactiva. No existe catálogo de conceptos ni aprobación. Las propinas de Terraza se separan por movimiento/concepto, pero no hay pasivo de propinas por pagar a empleados; los reportes las incluyen dentro de ingresos totales.

## 5. Cómo salen hoy los recursos

### 5.1 Gastos generales

No existe tabla `expenses`/`gastos`. Un gasto operativo es simplemente una fila `caja` tipo `egreso` con concepto libre. Puede registrarse dentro o fuera de turno y con fecha anterior.

Campos disponibles de hecho: hotel, usuario, turno opcional, método, monto, concepto y fecha. No hay categoría normalizada, subcategoría, proveedor obligatorio, factura/comprobante, vencimiento, estado pendiente/pagado, pagos parciales, recurrencia, presupuesto, centro de costo, cuenta origen, impuestos, periodo contable, aprobación ni distribución hotel/personal.

### 5.2 Compras de tienda

`compras_tienda` registra orden, proveedor, total y estado; `detalle_compras_tienda` registra cantidades y precio unitario. Al recibir:

1. se incrementa stock y se registra movimiento de inventario;
2. se marca la compra recibida;
3. se crean egresos en `caja` por los métodos elegidos.

Recepción física y pago están acoplados. No se puede recibir hoy y pagar después, pagar parcialmente, registrar crédito de proveedor ni vencimiento. Tampoco hay una operación atómica que abarque recepción, stock, estado y caja.

### 5.3 Pérdidas, ajustes y devoluciones

Tienda permite movimientos manuales y solicitudes autorizadas de salida. `movimientos_inventario` conserva stock anterior/nuevo y razón. Se encontraron transferencias tienda↔terraza y restauración de stock cuando se elimina un movimiento de caja de tienda en una migración reciente. No existe valorización monetaria de pérdidas, devoluciones de cliente/proveedor ni costo histórico asociado al movimiento.

### 5.4 Conceptos inexistentes

No hay soporte estructural para nómina, servicios públicos, activos, préstamos, deuda, aportes/retiros del propietario, transferencias entre cuentas, porcentaje de uso de vehículo, cuentas por pagar o gastos recurrentes. Todo podría escribirse como texto libre en `caja`, pero quedaría contablemente mezclado.

## 6. Venta, costo y utilidad

### Tienda

`productos_tienda` tiene `precio`, `precio_venta`, stock y proveedor, pero no costo. El precio de compra solo vive en cada `detalle_compras_tienda.precio_unitario`. La venta no guarda costo unitario histórico ni capa consumida. Por tanto:

- venta de cerveza: sí, $6.000;
- costo vendido: no determinable confiablemente;
- margen bruto: no determinable;
- inventario valorizado: no determinable con precisión;
- utilidad por producto: no disponible.

Los reportes presentan los $6.000 como ingreso y el resumen “balance neto” solo resta egresos de caja. Si la compra se pagó en otro periodo, el resultado del periodo queda distorsionado; no es utilidad.

### Restaurante

`ingredientes.costo_unitario` permitiría una estimación actual de receta, pero falta costo histórico por lote/compra y consumo confirmado por venta. Cambiar el costo actual reescribiría implícitamente el pasado si se calcula a posteriori. No hay margen por plato confiable.

### Terraza

No existe costo unitario en `terraza_productos`. La relación opcional con producto de tienda no congela costo. No hay CMV ni margen.

## 7. Reportes actuales

Los reportes financieros consultan principalmente `caja` y suman en JavaScript:

- reporte global: ingresos, egresos y `ingresos - egresos`;
- ingresos de habitaciones: filtra por `reserva_id` o patrones de texto del concepto;
- Terraza: filtra por `venta_terraza_id` y separa propina por texto;
- cierre: clasifica áreas por palabras del concepto y, ante ingreso desconocido, lo asigna a habitaciones;
- KPI: combina reservas, caja, detalles de tienda y servicios, cada uno por su propia fecha.

Problemas de definición:

- “ingreso” equivale a entrada de caja, no ingreso devengado;
- “gasto” equivale a salida de caja, no gasto incurrido;
- “balance neto” no es utilidad;
- reservas se muestran por `monto_total` aunque no estén cobradas en listados/KPI operativos;
- algunas vistas de actividad de usuario suman `pagos_reserva` + ventas de tienda + restaurante, pudiendo contar consumos pagados dentro de un pago de habitación y también como ventas;
- las categorías dependen de texto y pueden cambiar por ortografía;
- los rangos se construyen con `Z` (UTC) mientras la operación es Bogotá; pagos nocturnos pueden caer en el día equivocado;
- se alternan `fecha_movimiento`, `fecha`, `fecha_venta`, `creado_en` y `created_at`.

## 8. Contabilidad versus flujo de caja

| Concepto | Soporte actual | Evaluación |
| --- | --- | --- |
| Venta | Sí, por módulos | Fragmentada |
| Ingreso de dinero | Sí, `caja`/`pagos_reserva` | Duplicado en dos fuentes, no siempre sincronizado |
| Gasto incurrido | No | Solo egreso pagado |
| Pago de gasto | Parcial | Egreso libre, sin documento origen |
| Compra | Sí, tienda | Acoplada a recepción/pago |
| Activo | No | Se confundiría con egreso |
| Deuda/pasivo | No | No hay saldos ni cuotas |
| Retiro/aporte propietario | No | Se confundiría con ingreso/egreso operativo |
| Transferencia entre cuentas | No | Podría duplicar ingreso/egreso |
| Cuenta por cobrar | Parcial | Saldo de habitación derivado; sin ledger de cargos/aplicaciones |
| Cuenta por pagar | No | No existen factura, vencimiento, saldo o pagos |

## 9. Multi-hotel y permisos

El frontend normalmente obtiene `currentHotelId` y filtra consultas. Las tablas centrales contienen `hotel_id`, pero hay excepciones y dependencias indirectas. La seguridad no debe depender del filtro del navegador.

Hallazgos del snapshot:

- 37 de 66 tablas no tienen RLS, incluidas `ventas_restaurante`, items, ingredientes, platos, bitácora y logs de caja;
- políticas permisivas `USING (true)`/`WITH CHECK (true)` en ventas/detalles/productos/proveedores anulan políticas restrictivas paralelas;
- `movimientos_inventario` permite lectura e inserción a cualquier autenticado sin validar hotel;
- `caja` tiene RLS por hotel, pero `FOR ALL` permite a cualquier usuario del hotel insertar, actualizar y borrar;
- `pagos_reserva` permite CRUD completo a cualquier usuario del hotel;
- las políticas no separan recepcionista, contabilidad, propietario y administrador.

La navegación usa roles y algunas pantallas ocultan acciones a no administradores, pero esto es control de interfaz, no autorización suficiente. El sistema de `permisos` existe para gestión de usuarios, pero no se encontró aplicado consistentemente a las operaciones financieras ni a RLS.

## 10. Trazabilidad

Aspectos positivos:

- múltiples tablas tienen `creado_en`/`actualizado_en`, usuario y hotel;
- `bitacora` registra algunas acciones de módulos;
- `registrar_y_eliminar_mov_caja` copia el movimiento a `log_caja_eliminados` antes de borrarlo;
- el piloto bancario propone auditoría inmutable y deduplicación.

Carencias:

- movimientos de caja se borran físicamente;
- el método de pago se edita directamente sin guardar antes/después ni razón;
- reservas y pagos pueden borrarse físicamente;
- ventas/detalles permiten DELETE por RLS;
- `updated_by`, `source`, `reference_type`, reversión y razón no son uniformes;
- el log de caja guarda JSON, pero la función `SECURITY DEFINER` de borrado capturada no valida actor, hotel ni rol;
- `bitacora` no tiene RLS en el snapshot y no cubre todas las escrituras;
- no hay periodos cerrados ni bloqueo retroactivo.

## 11. Datos que sí y no pueden obtenerse

### Disponibles con reservas

- movimientos de caja por periodo, método y turno;
- ventas nominales por módulo cuando las relaciones están completas;
- pagos de reservas y saldo operativo de habitación;
- cantidades de inventario y algunos movimientos;
- compras/recepciones de tienda;
- esperado versus declarado durante la pantalla de cierre (no histórico completo).

### No disponibles de forma confiable

- utilidad bruta y operacional;
- CMV por producto/área/periodo;
- inventario valorizado y costo promedio;
- gastos incurridos versus pagados;
- cuentas por pagar y antigüedad;
- caja/banco por cuenta financiera real;
- retiros/aportes del propietario;
- activos, pasivos, préstamos y capital;
- presupuesto versus real;
- P&L mensual;
- flujo de caja separado de utilidad;
- rentabilidad por centro de costo;
- conciliación bancaria completa;
- historial inmutable y saldo reconstruible.

## 12. Qué conservar y qué rediseñar

Conservar: documentos operativos, `hotel_id`, métodos de pago, turnos, referencias desde caja, detalle de ventas, proveedores, compras, movimientos de inventario, recetas, bitácora y el enfoque transaccional de Terraza/piloto bancario.

Rediseñar: `caja` como fuente universal, cobros frontend multi-paso, clasificación textual, borrado físico, RLS permisiva, fechas/zonas horarias, costo de inventario, asignación de pagos y arqueo no persistido.

Agregar: ledger financiero liviano, cuentas, gastos/facturas y pagos, centros de costo, categorías, CMV histórico, propietario, presupuestos, periodos y conciliación bancaria.
