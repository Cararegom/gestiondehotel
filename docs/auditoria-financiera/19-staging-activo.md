# Staging financiero activo

Fecha: 2026-08-25.

## Identidad

- Proyecto: `gestiondehotel-staging`
- Project ref: `vyzscuzgjdhrhzctmsuv`
- Región: `us-east-2`
- Plan: gratuito
- Producción: `iikpqpdoslyduecibaij`
- Los refs son distintos y staging no contiene datos productivos.

## Esquema desplegado

- baseline y migraciones históricas;
- Fase 1 migraciones 01–10;
- migración 10 aplicada solo en staging el 2026-08-25, después de que el gate llegó a cero;
- Control de Energía;
- corrección de secuencia para `movimientos_inventario.id` descubierta en runtime.

## Fixtures

- Hotel A: `a32ecc1f-9821-4448-8d36-8463bf542149`;
- Hotel B: `b0000000-0000-4000-8000-000000000002`;
- dos habitaciones en Hotel A y una en Hotel B;
- administradores A/B y recepcionista A;
- métodos de pago y producto ficticio para pruebas.

Las credenciales están únicamente en `.env.staging.local`, ignorado por Git.

## Selección desde Live Server

- Entrar a staging: `login.html?backend=staging`
- Volver a producción: `login.html?backend=production`

La selección queda guardada por origen y las sesiones usan claves separadas. Staging muestra una insignia roja fija.

## Resultados runtime iniciales

- Hotel A solo ve sus dos habitaciones;
- Hotel B solo ve su habitación;
- Hotel A no puede leer habitaciones ni obtener permisos del Hotel B;
- permiso `tienda.operar` válido dentro del tenant;
- venta de tienda atómica completada;
- reintento con el mismo `client_operation_id` devuelve la misma venta;
- el stock bajó una sola vez, de 10 a 8;
- un fallo previo por esquema incompleto revirtió la transacción completa.

## Pendiente antes de producción

> Estado posterior: la Fase 1 y la recepción atómica de compras ya fueron desplegadas en producción. El cierre actualizado está en `20-cierre-fase1.md`.

- los 11 callers legacy ya fueron retirados y el gate autoriza la migración 10;
- ejecutar matriz completa de pagos, restaurante, caja, arqueo y Terraza;
- probar errores inducidos y concurrencia;
- validar manualmente los flujos críticos con la migración 10 activa en staging;
- mantener producción sin la migración 10 hasta completar esas pruebas.
