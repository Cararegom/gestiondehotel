# Base de conocimiento inicial para el agente interno

Este archivo resume como funciona Gestion de Hotel desde el punto de vista del usuario interno del sistema.
Su objetivo es ayudar al agente a responder dudas operativas y a recoger incidencias con buen contexto.

## Enfoque del agente

El agente interno debe servir para dos cosas:
- responder preguntas sobre como usar el sistema
- recoger reportes de fallas, errores o comportamientos inesperados

No es un agente comercial.
No debe vender planes.
No debe inventar funciones.

Si una duda o incidencia no puede resolverse con esta base, el canal de escalamiento es:
- support@gestiondehotel.com

## Modulos principales del sistema

Los modulos principales visibles en la aplicacion incluyen:
- Dashboard
- Reservas
- Mapa Hotel
- Habitaciones
- Caja y Turnos
- Usuarios
- Clientes
- Servicios
- Tienda
- Restaurante
- Limpieza
- Reportes
- Mantenimiento
- Descuentos
- Integraciones
- Mi cuenta

## Dashboard

El Dashboard es el resumen ejecutivo del hotel.
Sirve para ver rapidamente:
- reservas activas hoy
- ingresos por habitaciones hoy
- ocupacion actual
- ventas de tienda hoy
- proximos check-ins
- proximos check-outs
- tendencias de ingresos y ocupacion recientes

Tambien incluye accesos rapidos hacia otros modulos operativos.

## Mapa de Habitaciones

El Mapa de Habitaciones es la vista operativa principal del hotel.
Desde ahi se ve el estado visual de cada habitacion y se ejecutan acciones rapidas.

Estados visuales comunes:
- Libre: la habitacion esta disponible
- Ocupada: tiene huesped activo
- Limpieza: requiere limpieza
- Reservada: tiene llegada proxima o pendiente de check-in
- Tiempo agotado: la estancia contratada se vencio
- Mantenimiento: esta fuera de servicio operativo

Funciones habituales del mapa:
- alquilar una habitacion
- extender tiempo
- ver consumos
- liberar habitacion
- enviar a limpieza
- enviar a mantenimiento
- gestionar articulos prestados
- revisar proximas reservas

La tarjeta de habitacion puede mostrar:
- huesped actual
- proxima reserva o reserva pendiente
- articulos prestados pendientes
- alertas operativas
- cronometro de estancia

## Reservas

El modulo de Reservas sirve para crear y gestionar reservas futuras.

Flujo general:
1. registrar o seleccionar cliente
2. elegir fecha y hora de llegada
3. definir duracion y habitacion
4. indicar huespedes
5. aplicar descuento si corresponde
6. registrar pago o abono si la politica del hotel lo exige
7. guardar la reserva

Estados comunes:
- reservada
- confirmada
- activa
- cancelada
- no_show
- completada

Desde reservas se puede:
- confirmar una reserva
- editarla
- cancelarla
- hacer check-in
- marcar no presentado

El check-in no necesariamente se limita a la hora exacta de llegada. En los flujos operativos puede mantenerse disponible durante el dia de llegada segun la logica del sistema.

## Habitaciones y tiempos de estancia

Este modulo es de configuracion.
No es el mapa operativo.

Permite:
- crear habitaciones
- editar habitaciones
- definir capacidad
- definir precios por ocupacion
- configurar amenidades
- administrar tiempos de estancia

Los tiempos de estancia son opciones tarifarias como:
- 1 hora
- 2 horas
- 6 horas
- noche completa

Cada tiempo tiene:
- nombre
- duracion en minutos
- precio
- estado activo o inactivo

## Caja y Turnos

La Caja controla ingresos, egresos y turnos operativos.

Ideas clave:
- sin turno activo, muchos cobros quedan bloqueados
- cada movimiento debe quedar asociado a turno y responsable cuando aplica
- el cierre de caja genera resumen y control operativo

El modulo puede incluir:
- apertura de turno
- registro de ingresos y egresos
- arqueo
- cierre de turno
- historial de movimientos
- filtros y gestion de turnos abiertos

Procesos criticos:
- abrir turno
- cobrar
- registrar movimientos
- cerrar turno

Si una incidencia bloquea caja, cobros o cierre, la prioridad debe considerarse alta.

## Usuarios, roles, permisos y horarios

El modulo de Usuarios sirve para administrar accesos del equipo.

Desde este modulo se puede:
- crear usuarios nuevos
- editar usuarios existentes
- activar o desactivar usuarios
- asignar uno o varios roles
- ajustar permisos individuales
- resetear contrasenas
- organizar horarios semanales de recepcionistas
- definir si el hotel usa turnos de 8 horas o 12 horas

### Como crear un usuario para una recepcionista

La ruta operativa esperada es el modulo:
- Usuarios

En la parte superior del modulo hay un formulario de creacion y edicion de usuario.

Campos principales del formulario:
- Nombre Completo
- Correo Electronico
- Contrasena
- Roles Asignados
- Usuario Activo

Flujo recomendado:
1. entrar al modulo Usuarios
2. en el formulario de arriba, escribir el nombre completo
3. escribir el correo electronico que usara para iniciar sesion
4. asignar una contrasena temporal de minimo 8 caracteres
5. seleccionar al menos un rol
6. para una recepcionista, elegir el rol Recepcionista
7. dejar activo el checkbox de Usuario Activo si debe entrar de inmediato
8. hacer clic en Guardar Usuario

Reglas importantes:
- para usuarios nuevos la contrasena debe tener minimo 8 caracteres
- se debe seleccionar al menos un rol
- el correo del usuario es su acceso de inicio de sesion

### Como editar un usuario

En la tabla inferior del modulo aparecen los usuarios existentes.
Desde alli se puede:
- editar
- activar o desactivar
- abrir permisos
- resetear contrasena
- eliminar permanentemente en los casos habilitados

Cuando se edita un usuario:
- el formulario superior se llena con sus datos
- el boton pasa a modo Actualizar Usuario
- se pueden cambiar nombre, estado y roles

### Roles y permisos

Conceptos:
- Rol: grupo de acceso general segun el cargo, por ejemplo Recepcionista o Admin
- Permisos: ajustes individuales por usuario

Uso recomendado:
- asigna primero el rol base correcto
- usa el boton Permisos solo para casos especiales

### Horarios de recepcion

El mismo modulo incluye configuracion y horario semanal de recepcionistas.

Funciones:
- definir si el hotel trabaja con turnos de 8 horas o 12 horas
- ver una tabla semanal de recepcionistas
- asignar turno por dia y usuario
- marcar descanso
- imprimir el horario semanal

La tabla de horario se alimenta con usuarios que tengan el rol Recepcionista.

Si el sistema no muestra recepcionistas en el horario:
- revisar que el usuario este activo
- revisar que tenga asignado el rol Recepcionista

### Limites y validaciones

El numero de usuarios puede estar limitado por el plan del hotel.
Si el hotel excede el limite permitido, la operacion puede quedar restringida hasta cambiar de plan.

## Clientes y CRM

El modulo de Clientes sirve para:
- crear clientes
- buscarlos
- editar sus datos
- ver historial de visitas
- ver historial de gastos
- registrar actividades CRM
- administrar descuentos personalizados

Tambien puede ser usado desde otros modulos como selector de cliente al crear reservas.

## Tienda

El modulo de Tienda incluye varias areas:
- POS o punto de venta
- inventario
- categorias
- proveedores
- lista de compras
- compras
- compras pendientes

Sirve para:
- vender productos
- registrar entradas y salidas de inventario
- administrar stock
- recibir compras pendientes

## Limpieza

El modulo de Limpieza sirve para controlar el aseo de habitaciones y el consumo de recursos.

Puede incluir:
- confirmacion de limpieza
- uso de amenidades
- uso y salida de lenceria
- gestion de lavanderia
- reportes de perdidas o danos de ropa

## Mantenimiento

El modulo de Mantenimiento sirve para sacar habitaciones de operacion cuando hay danos, reparaciones o tareas tecnicas pendientes.

Desde el mapa una habitacion puede enviarse a mantenimiento.
Cuando esto ocurre, deja de estar disponible para operacion normal hasta que se gestione el caso.

## Integraciones

El modulo de Integraciones permite conectar servicios externos como calendarios.
Su objetivo principal es sincronizar disponibilidad y reducir riesgo de sobreventa.

## Que debe hacer el agente cuando hay una incidencia

Si el usuario dice que algo:
- no guarda
- no carga
- trae datos viejos
- muestra valores incorrectos
- se ve roto en celular
- no deja cobrar
- no deja hacer check-in
- no permite cerrar turno

el agente debe pasar de modo ayuda a modo triage.

Debe recoger, como minimo:
- modulo
- accion realizada
- resultado esperado
- resultado real
- mensaje de error exacto
- dispositivo: celular, tablet o computador
- navegador si aplica
- captura si el usuario la tiene

## Como clasificar la gravedad

Alta prioridad:
- bloquea caja
- bloquea cobros
- bloquea check-in o check-out
- bloquea alquiler o liberacion de habitaciones
- bloquea reservas activas
- afecta pagos o facturacion

Media prioridad:
- muestra datos incorrectos
- mezcla reservas viejas con activas
- un listado o filtro esta mal
- una tarjeta o panel muestra informacion incoherente

Baja prioridad:
- mejoras visuales
- textos raros
- alineacion
- dudas de uso sin bloqueo

## Respuesta esperada del agente

Cuando la duda es operativa:
- responder paso a paso
- nombrar el modulo correcto
- decir que boton o accion usar
- no mezclar demasiadas cosas

Cuando la duda es una falla:
- diagnosticar con calma
- no culpar al usuario
- no inventar la causa tecnica
- resumir bien el caso
- dejarlo listo para escalar

Cuando ya tenga suficiente contexto para dejar un caso estructurado, el agente debe presentar el resumen con este encabezado:

REPORTE DE INCIDENCIA

Y debajo usar siempre estos mismos campos:
- Modulo
- Pantalla o flujo
- Accion realizada
- Resultado esperado
- Resultado real
- Mensaje de error
- Dispositivo o navegador
- Momento aproximado
- Impacto operativo
- Prioridad sugerida

## Regla final

Si la base de conocimiento no alcanza para responder con seguridad:
- el agente no debe inventar
- debe pedir el dato minimo faltante
- o debe proponer escalar el caso a support@gestiondehotel.com
