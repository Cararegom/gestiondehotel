# Revision especial de modulos

Esta revision ordena los modulos que conviene intervenir con mas cuidado, segun:

- tamano del codigo
- riesgo operativo
- mezcla de responsabilidades
- cantidad de puntos de fallo visibles
- impacto en caja, reservas, cobros o experiencia diaria

Fecha de corte: 2026-03-28

## Prioridad recomendada

1. `reservas`
2. `caja`
3. `mapa-habitaciones`
4. `reportes`
5. `restaurante`
6. `clientes`
7. `limpieza`
8. `habitaciones`

## Resumen rapido

| Modulo | Archivos principales | Tamano aprox. | Riesgo | Motivo principal |
| --- | --- | ---: | --- | --- |
| `reservas` | `reservas.js` + 8 apoyos | 2853 lineas en archivo principal | Muy alto | Toca disponibilidad, pagos, check-in, lista de espera, descuentos y sincronizacion |
| `caja` | `caja.js` | 2184 lineas | Muy alto | Toca dinero real, arqueo, corte, correo y movimientos sensibles |
| `mapa-habitaciones` | `modales-gestion.js`, `mapa-habitaciones.js`, `room-card.js` | 2854 lineas entre piezas clave | Muy alto | Es el centro operativo diario y mezcla cobros, cambios de habitacion, consumos y estados |
| `reportes` | `reportes.js` | 2002 lineas | Alto | Consulta muchas fuentes, genera comparativos y es sensible a errores silenciosos |
| `restaurante` | `restaurante.js` + `inventario.js` | 1781 lineas principal | Alto | POS, caja, cuenta a habitacion, descuentos e inventario en el mismo flujo |
| `clientes` | `clientes.js` | 1440 lineas | Medio-alto | CRM, modales, validaciones, selector y actividades comerciales mezcladas |
| `limpieza` | `limpieza.js` | 1382 lineas | Medio | Mucha UI modal, inventario de lenceria/amenidades y reportes en un solo archivo |
| `habitaciones` | `habitaciones.js` | 1248 lineas | Medio | Configuracion fuerte, pero menos critica minuto a minuto que reservas/caja |

## Hallazgos por modulo

### 1. Reservas

Estado actual:
- Ya tiene apoyo en `reservas-data.js`, `reservas-calculos.js`, `reservas-operacion.js`, `reservas-sync.js` y `reservas-descuentos.js`.
- Ya se completo el refactor operativo con `reservas-pagos.js`, `reservas-historial.js`, `reservas-render.js`, `reservas-acciones.js`, `reservas-formulario.js`, `reservas-lista-acciones.js`, `reservas-ui.js` y `reservas-estado.js`.
- `reservas.js` sigue siendo grande, pero ya quedo como orquestador y salio el codigo legacy duplicado que seguia colgando tras los wrappers.

Avance ya realizado:
- Se saco el flujo de pago mixto y abonos a `reservas-pagos.js`.
- Se movio la capa de historial, turnos y filtros a `reservas-historial.js`.
- Se saco la construccion del listado y las tarjetas de reserva a `reservas-render.js`.
- La logica activa de botones y estados visibles del listado ya se delega a `reservas-acciones.js`.
- La coordinacion de clics del listado ya corre aparte en `reservas-lista-acciones.js`.
- El flujo activo del formulario ya se delega a `reservas-formulario.js` y los helpers visuales/estado del formulario a `reservas-ui.js`.
- La orquestacion activa de borrado, cambio de estado y cancelacion con reversion ya se delega a `reservas-estado.js`.
- `reservas.js` ya consume esos bloques como dependencias en vez de cargar todo inline.
- Se eliminaron los renders legacy y el cuerpo muerto que habia quedado duplicado despues de varios wrappers.

Senales de riesgo que siguen vigentes:
- Muchas validaciones, errores y `Swal.fire` repartidos.
- Sigue mezclando UI, reglas de negocio, pagos, descuentos, check-in, cambio de estados y sincronizacion, aunque bastante menos que antes.
- Varias rutas de error siguen ligadas a caja y disponibilidad, asi que conviene una pasada manual de regresion funcional antes de darlo por totalmente cerrado.

Por que va primero:
- Si `reservas` falla, golpea ocupacion, ingresos y operacion completa.
- Es el modulo con mayor superficie funcional y mas puntos de integracion.

Que haria aqui:
- sacar el flujo de pagos/abonos a un servicio propio
- separar formulario, listado, acciones y modal de pago
- concentrar reglas de disponibilidad en una sola capa
- reducir dependencia directa del DOM en el archivo principal

### 2. Caja

Estado actual:
- Ya mejoro mucho por las RPCs atomicas y el cierre corregido.
- Ya no esta concentrado en un solo archivo: el modulo se partio en `caja-turnos.js`, `caja-movimientos.js`, `caja-cierre.js` y `caja-paneles.js`.
- `caja.js` quedo como coordinador visual y bajo de `2184` a `740` lineas.

Avance ya realizado:
- Se extrajo la logica de apertura, cierre, verificacion de turno y supervision a `caja-turnos.js`.
- Se saco la tabla de movimientos, filtros, paginacion, edicion de metodo y eliminacion segura a `caja-movimientos.js`.
- Se movieron arqueo, resumen previo al corte, impresion adaptable, HTML del correo y envio del reporte a `caja-cierre.js`.
- Los modales auxiliares de historial de eliminados y turnos abiertos quedaron en `caja-paneles.js`.
- `caja.js` ya coordina estado, render y listeners, sin cargar el calculo financiero ni el correo inline.

Senales de riesgo:
- Sigue teniendo una UI abierta bastante grande porque el panel del turno concentra mucho HTML y listeners.
- Cualquier error aqui afecta dinero real y confianza del administrador, asi que el siguiente paso natural no es mas refactor sino regresion funcional.

Por que va segundo:
- Es menos grande que `reservas`, pero mas delicado financieramente.
- Debe quedar mas facil de auditar y mantener.

Que haria aqui:
- correr regresion manual completa de apertura, ingreso, egreso, ajuste con fecha anterior, supervision, arqueo, corte, impresion y correo
- solo despues decidir si conviene partir tambien la vista `renderizarUIAbierta` en un builder aparte

### 3. Mapa Habitaciones

Estado actual:
- Ya esta mejor partido que antes.
- Pero `modales-gestion.js` sigue demasiado pesado.

Senales de riesgo:
- El mapa centraliza muchos flujos: liberar, cambiar habitacion, cobrar, ver consumos, servicios, mantenimiento.
- Es muy facil que un ajuste rompa otra accion relacionada.

Por que va tercero:
- Es la pantalla mas usada en operacion diaria.
- Tiene alta dependencia de estados correctos de reservas, caja, limpieza y mantenimiento.

Que haria aqui:
- separar modales por dominio: cobros, cambios de habitacion, consumos, mantenimiento
- dejar `mapa-habitaciones.js` solo como coordinador y render
- reducir acoplamiento entre `room-card` y modales

### 4. Reportes

Estado actual:
- Potente, pero concentrado en un solo archivo grande.

Senales de riesgo:
- Muchas consultas, reportes heterogeneos y carga condicional.
- Si algo falla, puede hacerlo de forma silenciosa o dificil de rastrear.

Por que va cuarto:
- No bloquea la operacion minuto a minuto tanto como caja/reservas.
- Pero impacta decisiones gerenciales y confianza en datos.

Que haria aqui:
- dividir por tipo de reporte
- extraer data providers por reporte
- centralizar validacion de rangos y exportaciones

### 5. Restaurante

Estado actual:
- Ya tiene draft local y mejora visual.
- Sigue muy concentrado en `restaurante.js`.

Senales de riesgo:
- POS, carga a habitacion, inventario, descuentos y caja muy juntos.
- Hay duplicacion de flujos de cierre de venta.

Que haria aqui:
- separar venta mostrador, consumo a habitacion, historial e inventario
- unificar pipeline de finalizar venta

### 6. Clientes

Estado actual:
- Ya tiene mejoras CRM y segmentacion.

Senales de riesgo:
- Muchas responsabilidades: CRUD, selector, modales, actividades, CRM y validaciones.
- Menos critico que reservas/caja, pero aun denso.

Que haria aqui:
- separar CRM/actividades del mantenimiento de ficha del cliente
- desacoplar selector modal y detalle

### 7. Limpieza

Estado actual:
- Funcionalmente rico, pero todavia muy modal-dependiente.

Senales de riesgo:
- Amenidades, lenceria, inspecciones, inventario prestable e historiales en un solo archivo.
- Alto volumen de UI imperativa.

Que haria aqui:
- separar inventario, inspecciones y reportes
- limpiar duplicaciones de modales y tabs

### 8. Habitaciones

Estado actual:
- Grande, pero mas estable conceptualmente.

Senales de riesgo:
- Mucha configuracion y formularios.
- Menos puntos de fallo diarios que los anteriores.

Que haria aqui:
- separar tiempos de estancia, tipos y CRUD de habitaciones
- reducir logica inline de formularios

## Recomendacion practica

Si vamos a hacerlo bien, yo seguiria este orden real:

1. `reservas`
2. `caja`
3. `mapa-habitaciones`

Y solo despues:

4. `reportes`
5. `restaurante`
6. `clientes`
7. `limpieza`
8. `habitaciones`

## Meta de cada revision

Cada modulo deberia salir con:

- menos lineas en el archivo principal
- menos mezcla de UI y negocio
- menos queries directas desperdigadas
- puntos de error mas faciles de rastrear
- helpers y servicios reutilizables
- pruebas o chequeos minimos si el riesgo lo amerita
