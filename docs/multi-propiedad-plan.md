# Plan Multi-Propiedad

Objetivo: preparar `gestiondehotel` para cadenas o grupos con varios hoteles.

Estado: **en progreso**. La base de datos inicial y un resumen administrativo existen, pero la experiencia multi-propiedad todavia no esta implementada como funcion completa del producto.

## Base actual

- Existen las tablas `grupos_hoteleros` y `grupo_hoteles`.
- Un hotel puede asociarse a un grupo desde la base de datos.
- El superadmin ve cantidades globales de grupos, hoteles agrupados y hoteles sin grupo.
- Las politicas actuales reservan la administracion de estas tablas al superadmin SaaS.

Esta base no incluye todavia una interfaz para administrar grupos ni una vista operativa consolidada por cadena.

## Fase 1

- [ ] Crear una interfaz segura para crear grupos y asociar hoteles.
- [ ] Ver un resumen consolidado por grupo.
- [ ] Mostrar ingresos, ocupacion e incidencias por grupo.

## Fase 2

- [ ] Permitir usuarios con acceso a multiples hoteles.
- [ ] Cambiar rapido entre hoteles del mismo grupo.
- [ ] Crear reportes consolidados por cadena.

## Fase 3

- [ ] Definir pricing especial para grupos.
- [ ] Implementar permisos por hotel y por grupo.
- [ ] Habilitar operacion compartida de soporte, contabilidad y supervisores.

## Criterio de finalizacion

El item 49 del roadmap solo puede marcarse como completado cuando, como minimo, la Fase 1 funcione desde la aplicacion y tenga pruebas de aislamiento entre grupos y hoteles. Las Fases 2 y 3 permanecen como evolucion posterior del producto.

## Casos de uso

- Una misma familia administra 2 o mas hoteles.
- Una cadena pequena quiere centralizar supervision.
- Un operador necesita comparar desempeno por sede.
