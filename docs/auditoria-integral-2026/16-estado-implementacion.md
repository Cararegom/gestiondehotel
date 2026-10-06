# 16 — Estado de implementación

Fecha de actualización: 2026-10-05
Corte original auditado: commit `e191845`, 2026-09-07.

Este documento registra las correcciones posteriores a la auditoría. Los documentos 01–15 conservan el diagnóstico y la evidencia encontrados en el corte original.

## Cierre técnico de producción — 2026-10-05

El despliegue de la auditoría integral quedó completado técnicamente en producción:

- las 14 migraciones de este ciclo figuran como aplicadas en el historial remoto de Supabase;
- A13/A14 quedó desbloqueado tras cerrar ocho cronómetros históricos obsoletos, sin modificar pagos ni montos; el respaldo selectivo previo quedó fuera de Git;
- no quedan cronómetros activos duplicados ni cronómetros activos ligados a reservas completadas;
- los RPC de reservas y tienda existen, deniegan ejecución a `anon` y permiten `authenticated` según su contrato;
- las 14 Edge Functions afectadas están `ACTIVE` con la política JWT esperada;
- Supabase Database Advisors no reportó errores;
- el deployment Vercel `dpl_4H6A6DSUBAHDcQMbtQUvXmcstdzS` quedó `READY`, con target `production` y alias `https://www.gestiondehotel.com`;
- los dominios principal y `app/index.html` responden HTTP 200;
- validación previa: 750/750 pruebas, sintaxis de 310 archivos, typecheck, lint y build aprobados.

La aceptación manual de los flujos con datos reales del hotel sigue siendo una actividad operativa posterior al despliegue. Las celdas de producción de la tabla siguiente conservan el corte previo del 2026-10-02 y quedan sustituidas por este cierre técnico.

## Resumen

| Hallazgo | Implementación | Supabase staging | Frontend preview | Producción (corte 2026-10-02) |
| --- | --- | --- | --- | --- |
| C1 — `crear_colaborador` | Completa y probada | Aplicada y verificada | Ready; aceptación funcional pendiente | Pendiente de aprobación |
| C2 — `actualizar_permisos_usuario` | Completa y probada | Aplicada y verificada | Ready; aceptación funcional pendiente | Pendiente de aprobación |
| C3 — `send-cash-close-report` | Completa y probada | Aplicada y verificada técnicamente (v1, `verify_jwt=true`) | Aceptación funcional pendiente | Pendiente de aprobación |
| C4 — liquidación de consumos sin validar monto | Completa y probada | Aplicada y verificada técnicamente | Aceptación funcional pendiente | Pendiente de aprobación |
| C5 — pedidos web huérfanos | Completa y probada | Aplicada y verificada técnicamente | Desplegado; aceptación funcional pendiente | Pendiente de aprobación |
| C6 — fix de cámara en archivo no servido | Completa y probada | No aplica | Desplegado y verificado técnicamente; prueba física pendiente | Pendiente de aprobación |
| C7 — filtro de clientes en UTC | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A3 — familia `alegra-*` solo validaba `Origin` | Completa y probada | Cuatro funciones activas, v1, `verify_jwt=true` | No requiere cambio de frontend | Pendiente de aprobación |
| A4 — XSS almacenado en Clientes | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A5 — XSS almacenado en Usuarios | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A6 — agrupaciones gerenciales en UTC | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A7 — checkout calculado con zona del navegador | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A8 — reserva sin bloqueo/capacidad en conciliación bancaria | Completa y probada | Aplicada y verificada técnicamente | No requiere cambio de frontend | Pendiente de aprobación |
| A9 — errores manejados de Reservas/Caja invisibles para Sentry | Completa y probada | No aplica | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A10 — fallo silencioso en validación de cruce de reservas | Completa y probada | No requiere cambio | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A11 — reportes truncados por falta de paginación | Completa y probada | No requiere cambio | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A12 — reportes de Caja con corte UTC fijo | Completa y probada | No requiere cambio | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A13 — creación/ocupación/cronómetro no atómicos | Completa y probada | Aplicada y verificada técnicamente | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A14 — check-in/checkout podían confirmar escrituras parciales | Completa y probada | Aplicada y verificada técnicamente | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A15 — dos implementaciones divergentes de venta de tienda | Completa y probada | Aplicada y verificada técnicamente | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A16 — ajuste manual de stock no atómico | Completa y probada | Aplicada y verificada técnicamente | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A17 — dos motores de recurrencia de mantenimiento | Completa y probada | Planes, automatización, checklist, métricas y guard aplicados y verificados | Desplegado y verificado técnicamente; aceptación funcional pendiente | Pendiente de aprobación |
| A18 — roadmap sobrevendía multi-propiedad | Completa y verificada | No aplica | No aplica | No aplica |
| M1 — reglas de suscripción duplicadas | Completa y probada | No aplica | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M2 — contrato incompleto de Edge Functions bancarias | Completa y probada | No requirió cambio remoto | No aplica | No aplica |
| M3 — dos correos para una transferencia | Completa y probada | Migración aplicada; tres funciones `ACTIVE` | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M4 — documentación bancaria desactualizada | Completa y verificada | No aplica | No aplica | No aplica |
| M5 — métodos inactivos omitidos del arqueo | Completa y probada | Migración aplicada y RPC verificado | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M6 — clasificación de ingresos por texto libre | Completa y probada | No requiere migración; staging sin turnos abiertos | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M7 — reservas `ocupada`/`tiempo agotado` invisibles y fuera del cruce | Completa y probada | Migración aplicada y RPC verificado | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M8 — pedidos web sin movimiento de inventario | Completa y probada con C5/A15 | Núcleo y wrapper verificados en staging | No requiere cambio adicional | Pendiente de aprobación |
| M10 — UI de mantenimiento compuesta con observers/selectores frágiles | Completa y probada | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M11 — ocupación/KPIs truncados silenciosamente | Completa y probada con A11 | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M12 — reconciliación del mapa con un `UPDATE` por habitación | Completa y probada | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M13 — polling global y consulta ineficiente en fechas de pagos | Completa y probada | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M14 — rango inicial de Reportes calculado en UTC | Completa y probada | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| M15 — offset fijo de Bogotá en conciliación bancaria | Completa y probada | `bank-email-api` v11 `ACTIVE` en staging | No requiere preview; aceptación funcional pendiente | Pendiente de aprobación |
| M16 — crecimiento silencioso de `reservas.js` | Control de deuda completo y probado | No requiere cambio remoto | No aplica | No aplica |
| M17 — extensiones del shell sin contratos cruzados | Completa y probada | No requiere migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B1 — CORS abierto en funciones de gestión de usuarios | Completa y probada | Cuatro funciones v2 `ACTIVE`; CORS remoto verificado | No requiere preview | Pendiente de aprobación |
| B2 — movimiento manual fuera de turno | Corregido antes del corte y revalidado | Migración `20260825150000` aplicada | Contrato frontend probado; aceptación funcional pendiente | Pendiente de confirmación |
| B3 — panel legacy «Ver eliminados» | Completa y probada | Usa tabla/RLS ya existentes; sin migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B4 — valores muertos de `estado_reserva_enum` | Completa y probada | Guard aplicado y verificado; staging sin reservas | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B5 — función muerta `descontar_stock_por_venta` | Completa y probada | Firma retirada y ausencia verificada | No requiere cambio de frontend | Pendiente de aprobación |
| B6 — categorías POS sin filtro explícito de hotel | Completa y probada | RLS vigente; sin migración nueva | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B7 — `mantenimiento-ui.js` fuera de la cadena activa | Completa y probada | No requiere cambio | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B8 — selector legacy de estado en Mantenimiento | Completa y probada | No requiere cambio | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B9 — fallback local de zona horaria en Mantenimiento | Completa y probada | Lectura de configuración existente; sin migración | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B10 — fecha impresa del corte según navegador | Completa y probada | No requiere cambio | Preview `READY`; aceptación funcional pendiente | Pendiente de aprobación |
| B11 — helpers de idempotencia en memoria sin uso | Completa y probada | Tres Edge Functions `ACTIVE`; sin migración | No requiere cambio de frontend | Pendiente de aprobación |
| B12 — videos y respaldo comprimido sin consumidores | Completa y probada | No requiere cambio | Preview `READY`; FAQ verificado | No aplica |

La Fase 0 tiene implementación y validación técnica en staging, pero no se considera cerrada en producción. Los cinco hallazgos de la Fase 1, A3–A17, M1–M17 y B1–B12 están implementados y probados (M9 quedó absorbido por A17 y M11 por A11); no se consideran cerrados en producción hasta completar su aceptación y despliegue aprobados. A18, M4, M16 y B12 quedaron cerrados mediante documentación, limpieza y controles de repositorio, sin cambio de lógica de runtime.

## C3 — implementación y verificación en staging

La corrección de `send-cash-close-report` aplica los siguientes controles:

- exige `Authorization: Bearer <JWT>` y valida el token mediante `auth.getUser(token)`;
- rechaza sesiones ausentes, inválidas, expiradas o anónimas;
- comprueba con el contexto del usuario que `fase1_actor_es_miembro_activo(hotelId)` sea verdadero;
- obtiene el cliente `service_role` únicamente después de autenticar y autorizar;
- limita la consulta de `configuracion_hotel` al hotel autorizado;
- ignora `fallbackEmail` como autoridad y usa, si hace falta, el correo de la identidad Auth validada;
- valida origen, método, campos permitidos y formato UUID del hotel;
- mantiene mensajes públicos genéricos y no registra tokens, contenido del reporte ni respuestas del webhook;
- declara `verify_jwt = true` explícitamente y queda cubierta por typecheck y lint.

Prueba de regresión: `tests/c3-cash-close-report-auth.test.cjs`, 11 casos aprobados. Cubre autenticación, aislamiento entre hoteles, fallo cerrado, orden de acceso privilegiado, destino confiable y contrato de configuración.

La función se desplegó el 2026-09-09 exclusivamente en Supabase staging (`vyzscuzgjdhrhzctmsuv`). Supabase la reporta `ACTIVE`, versión 1 y con `verify_jwt=true`. Dos invocaciones remotas sin una sesión válida confirmaron el bloqueo en el gateway: una sin cabecera `Authorization` devolvió HTTP 401 (`UNAUTHORIZED_NO_AUTH_HEADER`) y otra con un token malformado devolvió HTTP 401 (`UNAUTHORIZED_INVALID_JWT_FORMAT`). Ninguna prueba remota incluyó credenciales, datos financieros ni pudo alcanzar el webhook.

## Pendientes de aceptación de C3

1. Confirmar con dos usuarios reales de staging que un miembro de otro hotel obtiene 403 sin invocar el webhook.
2. Ejecutar un cierre de caja de prueba con un miembro activo del hotel y verificar el destinatario configurado.
3. Revisar los logs de la Edge Function y del webhook después de esa aceptación funcional, sin exponer contenido financiero.
4. Solicitar aprobación explícita antes de desplegar la función a producción.

## C4 — liquidación segura de consumos en staging

La migración `20260910033500_c4_liquidar_consumos_monto_seguro.sql` redefine `liquidar_consumos_reserva_atomico` y aplica estos controles:

- recalcula en PostgreSQL la cuenta completa: hospedaje, servicios, tienda y restaurante;
- descuenta los cobros directos de tienda y restaurante enlazados con movimientos reales de Caja;
- compara la deuda cobrable contra los pagos acumulados de la reserva y lanza `C4_PAGO_INSUFICIENTE` antes de modificar datos si falta dinero;
- conserva la compatibilidad con pagos parciales previos: el último pago puede ser menor que los consumos si el acumulado cubre toda la cuenta;
- bloquea reserva, pagos, consumos y movimientos de Caja en un orden estable;
- captura los UUID exactos incluidos en el cálculo y actualiza solamente esas filas, de modo que un consumo insertado concurrentemente permanece pendiente;
- impide reutilizar un pago ya consumido para cargos agregados posteriormente;
- mantiene aislamiento por hotel, actor activo y pago perteneciente al usuario autenticado;
- vincula servicios, ventas de tienda y ventas de restaurante con el pago que confirmó la liquidación;
- registra en `auditoria_operaciones` el pago, cargos, pagos acumulados, cobros externos, saldo y cantidades actualizadas;
- añade claves foráneas e índices para las nuevas relaciones y para las consultas por hotel/reserva usadas dentro de la transacción;
- conserva `SECURITY DEFINER`, `search_path` controlado, deniega ejecución a `PUBLIC`/`anon` y permite el RPC a `authenticated`/`service_role`.

La prueba `tests/c4-liquidar-consumos.test.cjs` ejecuta la migración real sobre PostgreSQL embebido. Cubre abono insuficiente, pago acumulado válido, los tres tipos de consumo, trazabilidad, auditoría, idempotencia, reutilización del pago, cobro directo de tienda, aislamiento cross-hotel y ausencia de autenticación. La suite completa quedó en 537/537 pruebas aprobadas y la sintaxis se validó en 264 archivos.

La migración se aplicó el 2026-09-09 exclusivamente a Supabase staging (`vyzscuzgjdhrhzctmsuv`) mediante `db query --file`, porque la historia remota contiene migraciones antiguas equivalentes con marcas de tiempo distintas y `db push --dry-run` se detuvo antes de aplicar nada. No se reparó ni reescribió ese historial. La verificación remota confirmó el código C4 instalado, las dos columnas de trazabilidad, ocho índices, ejecución denegada a `anon` y concedida a `authenticated`.

## Pendientes de aceptación de C4

1. Probar en el hotel de staging que un abono insuficiente deja los consumos pendientes.
2. Ejecutar “Pagar todo” con una cuenta real de prueba y confirmar saldo cero y vínculos de pago.
3. Solicitar aprobación explícita antes de aplicar la migración en producción.

## C5 — entrega segura de pedidos web en staging

La migración `20260910044500_c5_pedidos_web_entrega_segura.sql` redefine `actualizar_estado_pedido_web_tienda` y aplica estos controles:

- exige una reserva del mismo hotel y habitación en estado `activa`, `ocupada` o `tiempo agotado` antes de entregar;
- rechaza el pedido sin crear venta ni descontar inventario cuando falta esa reserva;
- exige usuario autenticado, coincidencia con `p_usuario_id`, membresía activa y permiso `tienda.operar`;
- bloquea primero el pedido, luego la reserva y después los productos en orden estable;
- valida que los ítems pertenezcan al hotel y que sus subtotales cuadren con el total confirmado;
- conserva los precios congelados cuando se creó el pedido, aunque cambie después el precio de catálogo;
- agrupa cantidades repetidas por producto para comprobar y descontar stock correctamente;
- registra venta pendiente vinculada a la reserva, detalles, stock, `movimientos_inventario` y `auditoria_operaciones` en una sola transacción;
- usa el UUID del pedido como `client_operation_id` con `source='store_web_order'` y devuelve el resultado existente en reintentos;
- registra la razón `venta_tienda_pedido_web` en inventario y la excluye del trigger de ajustes, porque el detalle de venta ya genera el CMV;
- mantiene `SECURITY DEFINER`, `search_path` controlado, deniega ejecución a `PUBLIC`/`anon` y permite el RPC a `authenticated`/`service_role`;
- añade un índice para localizar la reserva operativa por hotel, habitación, estado y fecha.

La interfaz informa antes de confirmar que se verificará una reserva activa y muestra el error transaccional si la estancia ya no existe.

El frontend se desplegó el 2026-09-10 como preview de Vercel en `https://gestiondehotel-19wo7ulu2-cararegoms-projects.vercel.app` (deployment `dpl_DgwxvSpYcAYqFtG6bq41GKxmuVE9`). Vercel lo reportó `READY` y una lectura posterior del asset publicado confirmó que contiene el mensaje de validación C5.

La prueba `tests/c5-pedidos-web.test.cjs` ejecuta la migración real sobre PostgreSQL embebido. Cubre ausencia de reserva, los tres estados admitidos, exclusión de `check_in` y reservas cerradas, precio congelado, idempotencia, falta de stock, aislamiento cross-hotel, falta de permiso, suplantación de usuario, llamada anónima, producto de otro hotel y transiciones sin venta. La suite completa quedó en 549/549 pruebas aprobadas y la sintaxis se validó en 266 archivos.

La migración se aplicó el 2026-09-10 exclusivamente a Supabase staging (`vyzscuzgjdhrhzctmsuv`) mediante `db query --file`, debido al desfase previamente documentado en la historia remota de migraciones. No se reparó ni reescribió ese historial. Antes de aplicarla, staging no contenía pedidos web pendientes, entregados ni huérfanos. La verificación remota confirmó el guard C5, permiso, idempotencia, trazabilidad, exclusión de doble CMV, índice válido, `search_path`, ejecución denegada a `anon` y concedida a `authenticated`/`service_role`.

## Pendientes de aceptación de C5

1. Crear un pedido web para una habitación ocupada del hotel de prueba, entregarlo y confirmar que aparece en la cuenta de la reserva y en el historial de inventario.
2. Intentar entregar un pedido sin reserva activa y confirmar que la UI muestra el bloqueo y conserva el stock.
3. Solicitar aprobación explícita antes de aplicar la migración en producción.

## C6 — módulo real de Control de Energía con arreglo de cámara

La corrección elimina la divergencia que impedía que el arreglo del commit `55eb53f` llegara al navegador:

- `app/index.html` ya no remapea el módulo mediante un import map;
- `js/main.js` importa directamente `control-energia.js?v=20260910-c6-camera-1`;
- `control-energia.js` queda como única implementación y conserva los límites de tiempo para cargar la librería, abrir y detener la cámara, escanear y confirmar;
- `processToken` inicia `energy_scan` sin esperar a que `scanner.stop()` termine, por lo que un cierre de cámara bloqueado no detiene la validación del QR;
- los errores inesperados se reportan mediante `HotelMonitoring.captureException` y la interfaz ofrece una acción de reintento recuperable;
- `control-energia-20260902.js` quedó reducido a un puente de compatibilidad de tres líneas para sesiones que todavía conserven el HTML anterior en caché;
- el service worker usa la versión `20260910-c6-camera-1`, precarga el módulo canónico exacto y conserva temporalmente el puente legado para transición sin conexión.

La prueba `tests/c6-energy-runtime.test.cjs` resuelve el import efectivo desde `js/main.js` y comprueba que el asset alcanzado contiene el arreglo, que no existe el remapeo anterior, que el snapshot no conserva una segunda implementación y que el service worker precarga la misma versión. También se actualizaron las pruebas históricas de carga y sintaxis para afirmar la arquitectura nueva. La suite completa quedó en 552/552 pruebas aprobadas, la sintaxis se validó en 267 archivos, el build local y el preflight de staging terminaron correctamente y `git diff --check` no encontró errores.

El frontend se desplegó el 2026-09-10 como preview de Vercel en `https://gestiondehotel-l0704rspl-cararegoms-projects.vercel.app` (deployment `dpl_8E2Vvf88t6NRTCnRiQm7r3tpizrv`). Vercel lo reportó `READY`. Las lecturas autenticadas posteriores del HTML y los cuatro assets implicados confirmaron que el import map desapareció, `main.js` solicita la versión C6, el módulo servido incluye los timeouts y ejecuta `energy_scan` sin esperar el cierre de cámara, la UI de reintento está presente y la URL antigua reexporta la implementación canónica.

## Pendientes de aceptación de C6

1. En un dispositivo móvil del hotel de prueba, denegar y luego conceder permiso de cámara para comprobar el mensaje y el reintento.
2. Escanear un QR válido y confirmar que la habitación se verifica aunque el cierre de la cámara tarde.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## C7 — filtros de Clientes en la zona horaria del hotel

La corrección reemplaza los límites de fecha interpretados como UTC por un intervalo explícito de la zona operativa:

- `clientes.js` importa `getRuntimeHotelTimeZone` y `getUtcRangeForHotelDates` desde el servicio central;
- `getClientCreatedAtUtcRange` convierte las fechas `YYYY-MM-DD` del formulario a timestamps UTC exactos;
- el inicio se aplica con `gte` y el siguiente inicio de día se aplica con `lt`, incluyendo completo el último día sin depender de `23:59:59.999`;
- los filtros que solo tienen inicio o solo fin conservan el límite correspondiente;
- los rangos invertidos se rechazan antes de consultar;
- se eliminó `new Date(dateRange.fin)` y su cálculo dependiente de UTC/navegador.

Para `America/Bogota`, filtrar únicamente el 31 de agosto de 2026 genera el intervalo `[2026-08-31T05:00:00.000Z, 2026-09-01T05:00:00.000Z)`. Por tanto, un cliente registrado a las 20:00 del 31 de agosto en Bogotá permanece dentro del resultado. La misma conversión soporta zonas con horario de verano, donde un día operativo puede durar 23 o 25 horas.

La prueba `tests/c7-clientes-timezone.test.cjs` valida el ejemplo de Bogotá, filtros parciales, un día de 25 horas en `America/New_York`, rechazo de rangos invertidos y el contrato exacto de la consulta. Junto con las pruebas existentes de centralización de zona horaria, el bloque específico quedó en 13/13. La suite completa quedó en 555/555 pruebas aprobadas, la sintaxis se validó en 268 archivos, el build local y el preflight de staging terminaron correctamente y `git diff --check` no encontró errores.

El frontend se desplegó el 2026-09-11 como preview de Vercel en `https://gestiondehotel-gp7zbco1u-cararegoms-projects.vercel.app` (deployment `dpl_DGiux442QnkkZKpSgo1HY8mZMug4`). Vercel lo reportó `READY`. Las lecturas autenticadas posteriores confirmaron que el módulo publicado usa la zona activa del hotel, construye el rango semiabierto mediante el servicio central y ya no contiene `new Date(dateRange.fin)`.

## Pendientes de aceptación de C7

1. Filtrar en el hotel de prueba una fecha con clientes registrados cerca de la medianoche y comparar el resultado con su hora local.
2. Probar por separado un filtro con solo fecha inicial y otro con solo fecha final.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A3 — autorización de la familia Alegra

La corrección cubre las tres Edge Functions citadas por la auditoría y `alegra-zapier-notify`, que repetía el mismo límite de confianza vulnerable:

- `alegra-save-config`, `alegra-test-connection` y `alegra-crear-factura` exigen un administrador activo del mismo hotel;
- `alegra-zapier-notify` exige un miembro activo del mismo hotel para conservar su uso operativo;
- las cuatro extraen un Bearer token, lo validan mediante `auth.getUser(accessToken)` y rechazan sesiones ausentes, inválidas, expiradas o anónimas;
- la membresía se resuelve con `fase1_actor_es_miembro_activo(hotelId)` usando el cliente del usuario, y el alcance administrativo con `usuario_actual_es_admin_hotel(hotelId)`;
- el cliente `service_role` se crea únicamente después de validar identidad, membresía y alcance;
- el `hotelId` debe ser UUID, los campos inesperados se rechazan y `Origin` permanece como defensa del navegador sin actuar como autorización;
- las respuestas y los logs no incluyen claves, usuarios almacenados, errores SQL ni cuerpos devueltos por Alegra/Zapier;
- el webhook operativo solo acepta una URL HTTPS configurada por el hotel;
- el upsert de configuración usa la clave primaria real `hotel_id` como conflicto;
- `supabase/config.toml`, typecheck y lint incluyen explícitamente las cuatro funciones y el helper compartido.

La prueba `tests/a3-alegra-authorization.test.cjs` aporta 34 casos. La suite completa quedó en 589/589 pruebas aprobadas, la sintaxis se validó en 269 archivos, typecheck y lint terminaron correctamente. Las cuatro funciones se desplegaron el 2026-09-11 exclusivamente en Supabase staging (`vyzscuzgjdhrhzctmsuv`), donde Supabase las reporta `ACTIVE`, versión 1 y `verify_jwt=true`. Para cada endpoint se verificó por HTTP que una solicitud sin `Authorization` y otra con token malformado devuelven 401; ninguna pudo alcanzar las credenciales ni los proveedores externos.

## Pendientes de aceptación de A3

1. Con usuarios reales de staging, confirmar 403 para un actor de otro hotel y para un miembro no administrador que intente guardar o probar la configuración.
2. Con un administrador del hotel de prueba, guardar credenciales de prueba y ejecutar la prueba de conexión sin usar datos de producción.
3. Ejecutar una notificación controlada hacia un webhook de prueba y revisar que el payload llegue una sola vez.
4. Solicitar aprobación explícita antes de desplegar las cuatro funciones a producción.

## A4 + A5 — XSS almacenado en Clientes y Usuarios

La corrección aplica los helpers centrales de `js/security.js` según el contexto de salida:

- `escapeHtml` protege texto persistido antes de insertarlo mediante `innerHTML`;
- `escapeAttribute` protege identificadores, nombres, correos, documentos, teléfonos, roles y permisos usados en atributos HTML;
- Clientes protege la tabla principal y el selector auditados, además de formularios, historial, descuentos, actividades CRM, reservas y detalle de consumos que reutilizan datos almacenados;
- las confirmaciones de SweetAlert que contienen nombre de cliente o correo de usuario escapan esos valores antes de pasarlos por la opción `html`;
- Usuarios reemplaza el helper local duplicado por los helpers centrales y protege la tabla principal, el top de ventas, roles, permisos y horario semanal;
- el horario semanal ya no construye un manejador JavaScript inline con identificadores interpolados: usa atributos de datos escapados y asigna el evento después del render;
- la versión imprimible del horario escribe el nombre del turno mediante `textContent`.

La prueba `tests/a4-a5-stored-xss.test.cjs` reproduce la ruptura de atributos y la inserción de `<img onerror>`/`<svg onload>` con datos persistidos de clientes y usuarios. Sus cuatro casos comprueban los helpers reales, ejecutan ambos renderizadores y verifican la cobertura de superficies equivalentes. La suite completa quedó en 593/593 pruebas aprobadas, la sintaxis se validó en 270 archivos, el build local y el preflight de staging terminaron correctamente y `git diff --check` no encontró errores.

El frontend se desplegó el 2026-09-11 como preview de Vercel en `https://gestiondehotel-oysvgwjna-cararegoms-projects.vercel.app` (deployment `dpl_7qozspPaVfw9kJTMySRH9fHbA56W`). Vercel lo reportó `READY`. Las lecturas autenticadas de los assets publicados confirmaron que Clientes y Usuarios importan los helpers centrales y escapan los valores señalados por A4/A5. No se desplegó nada a producción.

## Pendientes de aceptación de A4 + A5

1. Abrir Clientes y Usuarios desde el preview con el backend de staging y confirmar que nombres legítimos con comillas, apóstrofes y acentos se muestran completos.
2. Comprobar en staging que Ver, Editar, Activar/Inactivar, Reset Pass y Permisos conservan el registro seleccionado después del escape de atributos.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A6 — reportes gerenciales en la zona horaria del hotel

La corrección elimina la clasificación directa de timestamps mediante UTC y centraliza la lógica en `js/services/reportesTimeZoneService.js`:

- los rangos elegidos en Reportes se convierten desde fechas de calendario del hotel a intervalos UTC semiabiertos `[inicio, siguiente inicio de día)`;
- las consultas de ingresos, reservas, ventas de tienda y servicios usan esos mismos límites con `gte`/`lt`;
- los ingresos diarios se agrupan con `getDateKeyInTimeZone`, por lo que un movimiento nocturno permanece en el día operativo correcto;
- la demanda y los ingresos por día de semana se clasifican mediante `getWeekdayIndexInTimeZone`, sin `getUTCDay()`;
- el denominador de promedios recorre claves de calendario, sin mutar objetos `Date` mediante `getUTCDate()`/`setUTCDate()`;
- la zona usada para construir el rango viaja con los datos consultados y se reutiliza al calcular los KPI, evitando mezclar zonas si la configuración cambia durante una consulta;
- el servicio se apoya en `hotelTimeZoneService.js`, cuya zona runtime se carga desde `configuracion_hotel.zona_horaria` durante la inicialización del hotel.

La prueba `tests/a6-reportes-timezone.test.cjs` aporta cinco casos: zona runtime predeterminada, agrupación alrededor de medianoche, clasificación del viernes nocturno de Bogotá, calendario durante DST y contrato del módulo sin las operaciones UTC auditadas. La suite completa quedó en 598/598 pruebas aprobadas, la sintaxis se validó en 272 archivos, el build local y el preflight de staging terminaron correctamente.

El frontend se desplegó el 2026-09-12 como preview de Vercel en `https://gestiondehotel-lvjhluyxp-cararegoms-projects.vercel.app` (deployment `dpl_6nnK7eLBTweZsgfL4Wr7SU6mTobS`). Vercel lo reportó `READY`. Las lecturas autenticadas posteriores confirmaron que el módulo publicado importa el servicio nuevo, usa límites `endExclusiveIso` y clasifica fechas con las utilidades de la zona operativa. No se desplegó nada a producción.

## Pendientes de aceptación de A6

1. En el hotel de prueba, comparar un reporte que incluya reservas e ingresos entre las 7:00pm y medianoche con su día local esperado.
2. Revisar un rango que cruce viernes, sábado y domingo y confirmar los KPI de demanda e ingreso promedio por día.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A7 — checkout de reservas en la zona horaria del hotel

La corrección lleva la entrada y el checkout al servicio horario central y cubre las rutas activas que crean o modifican una estancia:

- `parseDateTimeInTimeZone` interpreta los valores de `datetime-local` como hora de pared del hotel, sin depender de la zona del computador o tablet;
- `getNearestCheckoutDateInTimeZone` determina el día de checkout en el calendario del hotel y convierte el resultado a un instante UTC, incluyendo estancias que cruzan cambios DST;
- `toDateTimeLocalValueInTimeZone` muestra correctamente una reserva existente al editarla o recuperarla desde la lista de espera;
- el mínimo permitido del campo de llegada se calcula con el reloj del hotel;
- la validación de fechas usa el mismo instante que después se guarda y se envía a la comprobación de cruces;
- las estancias por minutos conservan duración absoluta, mientras las estancias por noches conservan la hora de checkout local configurada;
- el alquiler directo y las extensiones por noche del Mapa consumen el mismo cálculo y reciben `zona_horaria` junto con los horarios del hotel;
- una hora local inexistente durante el salto de horario de verano se rechaza en vez de desplazarse silenciosamente.

La prueba `tests/a7-reservas-checkout-timezone.test.cjs` aporta ocho casos: dispositivo en una zona diferente, varias noches cruzando DST, duración por minutos, hora inexistente, conversión para `datetime-local`, mínimo del formulario, alquiler directo y contrato de todas las rutas activas. La suite completa quedó en 606/606 pruebas aprobadas, la sintaxis se validó en 273 archivos, el build local y el preflight de staging terminaron correctamente.

El frontend se desplegó el 2026-09-12 como preview de Vercel en `https://gestiondehotel-5onl8htxj-cararegoms-projects.vercel.app` (deployment `dpl_9nUzc2nwCMmxhWEJHjzMXqrTfhg2`). Vercel lo reportó `READY`. Las lecturas autenticadas posteriores confirmaron que el servicio publicado expone las conversiones nuevas, Reservas pasa `state.configHotel.zona_horaria` y el Mapa usa el mismo checkout zonificado. No se desplegó nada a producción.

## Pendientes de aceptación de A7

1. Desde un dispositivo de prueba configurado en una zona distinta, crear o editar una reserva y confirmar que la llegada y salida mostradas coinciden con la hora del hotel.
2. Crear una estancia por noche desde Reservas y otra desde el Mapa y comprobar que ambas terminan a la misma hora local de checkout.
3. Probar una extensión por noche y confirmar la nueva salida estimada antes de guardarla.
4. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A8 — capacidad y bloqueo de allocations bancarias de reserva

La migración `20260912120000_a8_bank_reservation_allocation_capacity.sql` cierra la asimetría señalada por la auditoría:

- `bank_email_reservation_available_amount_cop` calcula el saldo conciliable con el total de la reserva, el mayor valor entre `monto_pagado` y la suma real de `pagos_reserva`, los pagos esperados vigentes y las allocations activas sin respaldo de Caja;
- el evento que se está corrigiendo queda excluido del cálculo, por lo que repetir la misma distribución no se bloquea a sí misma;
- `bank_email_reservation_allocation_capacity_trg` se ejecuta antes de insertar o modificar una allocation de reserva, toma `pg_advisory_xact_lock` con una clave hotel/reserva y vuelve a consultar el saldo dentro de la misma transacción;
- la protección vive en la tabla interna, por lo que también cubre futuras rutas de servidor que escriban allocations;
- las allocations con `caja_id` no se vuelven a descontar porque su dinero ya está registrado en la reserva;
- `replace_bank_payment_allocations_from_caja` conserva su implementación validada en `app_private` y el wrapper público habilita la excepción de Caja solo durante esa transacción; si falla, limpia el contexto antes de propagar el error;
- los helpers y RPCs continúan denegados a `PUBLIC`, `anon` y `authenticated`, con ejecución exclusiva de `service_role`.

La prueba `tests/a8-bank-reservation-capacity.test.cjs` aporta seis casos/controles. Ejecuta la migración y la implementación privada vigente sobre PostgreSQL embebido, valida saldo con pagos y pagos esperados, evita doble conteo de Caja, rechaza la secuencia 70 + 40 contra una reserva de 100 sin alterar el segundo evento y admite el reintento del evento actual. La regresión bancaria quedó en 100/100 pruebas y la suite completa en 612/612. La sintaxis se validó en 274 archivos; el build local, el preflight de staging y `git diff --check` terminaron correctamente.

Antes de aplicar la migración, staging reportó 0 allocations activas de reserva sin respaldo de Caja, por lo que no requirió reparación histórica. La migración se aplicó el 2026-09-12 exclusivamente a Supabase staging (`vyzscuzgjdhrhzctmsuv`) mediante `db query --file`, sin reparar ni reescribir el historial remoto. La verificación posterior confirmó el trigger activo, las dos implementaciones pública/privada del RPC de Caja, `SECURITY DEFINER`, el lock, el recálculo de capacidad y los permisos esperados. No hubo cambios de frontend ni despliegue a Vercel. Producción no fue modificada.

## Pendientes de aceptación de A8

1. Cuando se retomen las pruebas manuales del hotel de prueba, asignar dos transferencias cuyo total supere una reserva y confirmar que la segunda muestra el bloqueo sin perder la primera.
2. Relacionar desde Caja una transferencia correspondiente a un pago de reserva ya registrado y confirmar que conserva el `caja_id` exacto.
3. Solicitar aprobación explícita antes de aplicar la migración en producción.

## A9 — Sentry para errores manejados de Reservas y Caja

La corrección elimina la dependencia de `console.error` en los dos dominios definidos por A9:

- `js/services/handledErrorReporter.js` centraliza el reporte y llama primero a `HotelMonitoring.captureException`, con `HotelTelemetry` como respaldo;
- cada evento usa únicamente `source` y `eventType` normalizados, por ejemplo `reservas.submit_failed` o `caja.movements_load_failed`;
- el reporter construye una excepción nueva y no copia el mensaje, stack, payload, monto, hotel, huésped, documento, pago, reserva, movimiento ni turno del error original;
- si Sentry no está inicializado o su captura falla, la función absorbe ese fallo y la operación conserva el mismo comportamiento de interfaz;
- Reservas instrumenta configuración, tarifas, descuentos, pagos, lista de espera, sincronización de calendario, cambio de habitación, filtros, historial y renderizado;
- Caja instrumenta turnos, movimientos, resumen de cierre, inventario adjunto y estado del panel bancario;
- los avisos esperados que permanecen en consola son textos estáticos y ya no interpolan eventos de calendario, nombres de habitación, conceptos financieros ni IDs de turnos.

La prueba `tests/a9-critical-modules-sentry.test.cjs` valida la llamada a `HotelMonitoring`, el respaldo de `HotelTelemetry`, la normalización de códigos, la ausencia de datos privados y que un fallo de Sentry no se propague. También comprueba que los archivos auditados de Reservas y Caja no conserven `console.error`. Junto con las pruebas existentes de redacción, deduplicación y aislamiento de entornos de Sentry, el bloque específico quedó en 14/14. La suite completa quedó en 615/615 pruebas aprobadas, la sintaxis se validó en 276 archivos, el build local y `git diff --check` terminaron correctamente. `npm run sentry:verify` confirmó la conexión de solo lectura con el proyecto; no se envió el evento sintético de `npm run sentry:test`.

El frontend se desplegó el 2026-09-12 como preview de Vercel en `https://gestiondehotel-olci7o9yg-cararegoms-projects.vercel.app` (deployment `dpl_581bNi1GiQTyb6pAmexpDsH1LZGz`). Vercel lo reportó `READY`. Las lecturas autenticadas posteriores confirmaron que el reporter publicado usa `HotelMonitoring`, genera `HandledOperationalError` y conserva `eventType` estable; los módulos publicados de Reservas y Caja importan el helper, lo invocan con su dominio y no contienen `console.error`. Producción no fue modificada.

## Pendientes de aceptación de A9

1. Provocar en el hotel de prueba un fallo controlado de carga en Reservas o Caja y confirmar que la interfaz conserva su mensaje y Sentry recibe solo el código estable, sin datos del registro.
2. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A10 — validación de cruces de reserva fail-closed

La corrección elimina los caminos que permitían continuar sin haber confirmado la disponibilidad:

- `assertBookingAvailability` concentra la llamada a `validar_cruce_reserva` y conserva los parámetros de habitación, entrada, salida y reserva excluida al editar;
- solo una respuesta booleana sin `error` se considera válida; `{ data: null, error }`, una excepción de red y una respuesta no booleana bloquean la operación;
- un cruce real lanza el mensaje de conflicto fuera del manejo de fallos técnicos, por lo que ya no puede ser capturado y descartado accidentalmente;
- un fallo técnico se reporta como `reservas.booking_conflict_validation_failed` mediante el reporter seguro de A9 y el usuario recibe únicamente una instrucción para reintentar;
- `validateAndCalculateBooking` espera esta comprobación antes de construir el payload, y `submitReservaForm` muestra el error sin llamar a `createBooking` ni `updateBooking`;
- la implementación legada delega en el mismo helper para evitar que una reactivación futura recupere el comportamiento permisivo.

La prueba `tests/a10-reservation-conflict-fail-closed.test.cjs` aporta seis controles: respuesta libre, conflicto real, error devuelto por Supabase, excepción de red, respuesta ambigua, parámetros de edición y bloqueo efectivo de las mutaciones del formulario. El bloque conjunto A7/A9/A10 quedó en 17/17 pruebas, la suite completa en 621/621 y la sintaxis se validó en 277 archivos. El build local, el preflight de staging y `git diff --check` terminaron correctamente.

El frontend se desplegó el 2026-09-12 como preview de Vercel en `https://gestiondehotel-jn9w9kkn2-cararegoms-projects.vercel.app` (deployment `dpl_HJ1NVCYgv4fvbymQ3LP8t8Bjv5mc`). Vercel lo reportó `READY`. Las lecturas autenticadas confirmaron en el asset publicado la constante del mensaje seguro, el manejo de `rpcResult.error`, la exigencia de respuesta booleana y el uso del helper compartido en las rutas activa y legada. El patrón anterior que destructuraba solo `data` ya no está publicado. Producción no fue modificada.

## Pendientes de aceptación de A10

1. En el hotel de prueba, intentar crear o editar una reserva que se cruce con otra y confirmar que el formulario muestra el conflicto sin guardar cambios.
2. Cuando se retomen las pruebas de fallos controlados, simular indisponibilidad del RPC y confirmar el mensaje de reintento y el evento estable en Sentry.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A11 — paginación completa de reportes

La corrección elimina el límite silencioso de PostgREST en las fuentes voluminosas del módulo:

- `js/services/supabasePaginationService.js` centraliza páginas de 1.000 filas y continúa hasta recibir la última página;
- si una página devuelve error o un formato ambiguo, el helper descarta el acumulado y permite que el reporte muestre el fallo en vez de calcular cifras parciales;
- se retiró el corte local de 50.000 filas que también podía producir un resultado incompleto sin error;
- todas las consultas paginadas usan un orden principal y `id` como desempate para mantener una secuencia estable entre páginas;
- `fetchKPIData` pagina reservas, ingresos de Caja, detalle de Tienda y servicios, mientras el conteo de habitaciones continúa como agregado `head`;
- el comparativo gerencial pagina sus nueve fuentes actuales y anteriores, conservando el tratamiento estricto de reservas/Caja y la degradación visible de fuentes opcionales;
- ocupación, historial de cierres, detalle de movimientos por cierre e ingresos por habitaciones también consumen el helper; esta última ruta había perdido la paginación durante el ajuste horario de A6;
- las tres rutas que ya paginaban —listado de reservas, Terraza y resumen financiero— quedaron conectadas al mismo servicio compartido.

La prueba `tests/a11-report-pagination.test.cjs` aporta seis controles: 2.505 filas recuperadas en tres páginas, total múltiplo exacto, fallo intermedio sin datos parciales, respuesta ambigua, tamaño inválido y cobertura de las 20 consultas del módulo. El bloque conjunto A6/A10/A11 quedó en 17/17 pruebas, la suite completa en 627/627 y la sintaxis se validó en 279 archivos. El build local, el preflight de staging y `git diff --check` terminaron correctamente.

El frontend se desplegó el 2026-09-13 como preview de Vercel en `https://gestiondehotel-frj2xhdqt-cararegoms-projects.vercel.app` (deployment `dpl_462quHgffxYyDXAgLUaw5ZP2k9hw`). Vercel lo reportó `READY`. Las lecturas autenticadas confirmaron el servicio de páginas publicado, el rechazo de respuestas inválidas, la ausencia del corte de 50.000 filas, 20 llamadas al helper y 20 órdenes secundarias por `id` en `reportes.js`. Producción no fue modificada.

## Pendientes de aceptación de A11

1. Cuando se retomen las pruebas del hotel de prueba, ejecutar KPI, ocupación, cierres y comparativo sobre un rango con más de 1.000 registros en al menos una fuente y contrastar los totales con Supabase.
2. Verificar que un fallo controlado en una página posterior muestre error o fuente no disponible y nunca un total parcial.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A12 — rangos de reportes según la zona operativa del hotel

La corrección elimina los cortes de calendario construidos como medianoche UTC fija:

- listado de reservas, ingresos por habitaciones, Terraza, resumen financiero, ocupación, historial de cierres y KPI usan `getReportUtcRange`, que convierte la fecha local del hotel a un intervalo UTC con inicio inclusivo y fin exclusivo;
- el historial de cierres filtra `fecha_cierre` con el mismo rango operativo y deja de perder los cierres realizados durante la tarde o noche local;
- las agrupaciones diarias de Caja y Terraza obtienen la fecha mediante la zona IANA activa del hotel, en vez de recortar el timestamp UTC;
- la ocupación recorre claves de calendario del hotel y calcula un rango zonificado por día, por lo que admite días de 23 o 25 horas;
- el comparativo gerencial calcula el período anterior por cantidad de días calendario y consulta ambos períodos con límites exclusivos, sin restar milisegundos ni depender de la zona del navegador;
- las consultas mantienen la paginación completa y el orden estable incorporados en A11.

La prueba `tests/a12-reportes-caja-timezone.test.cjs` aporta cinco controles: límites exactos de Bogotá, agrupación diaria y mensual en el hotel, fallback a `creado_en`, comparación durante DST y contrato de todas las rutas auditadas. El bloque conjunto A6/A11/A12 quedó en 15/15 pruebas, la suite completa en 632/632 y la sintaxis se validó en 280 archivos. El build local, el preflight de staging y `git diff --check` terminaron correctamente.

El frontend se desplegó el 2026-09-13 como preview de Vercel en `https://gestiondehotel-mj5fmlaba-cararegoms-projects.vercel.app` (deployment `dpl_38kiL4zPXBBivpeSV3zqxFJbkaeS`). Vercel lo reportó `READY`. Las lecturas autenticadas confirmaron cero cortes `T00:00:00.000Z`/`T23:59:59.999Z`, ocho usos de `getReportUtcRange`, el rango comparativo y 18 filtros con fin exclusivo en el asset publicado. Producción no fue modificada.

## Pendientes de aceptación de A12

1. Cuando se retomen las pruebas del hotel de prueba, comparar un reporte diario de Caja con movimientos entre las 19:00 y 23:59 hora local y confirmar que permanecen en el mismo día operativo.
2. Revisar en el hotel de prueba el historial de cierres, la ocupación y el comparativo gerencial alrededor de una medianoche local.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## A18 — estado real de multi-propiedad en el roadmap

La corrección alinea los documentos de planificación con el producto existente:

- el ítem 49 de `docs/roadmap-mejoras.md` cambió de completado `[x]` a pendiente `[ ]`;
- el texto conserva como avance real las tablas `grupos_hoteleros`/`grupo_hoteles` y el resumen numérico exclusivo de superadmin;
- el mismo ítem identifica como pendientes la gestión funcional de grupos, usuarios con varios hoteles, cambio de sede, permisos por grupo y reportes consolidados;
- la Fase 3 del orden general quedó en progreso mientras el ítem 49 permanezca abierto;
- `docs/multi-propiedad-plan.md` declara explícitamente el estado parcial, marca todas sus capacidades funcionales pendientes y exige que la Fase 1 funcione desde la aplicación con pruebas de aislamiento antes de considerar completo el roadmap;
- `docs/producto-vivo.md` e `docs/investment-readiness.md` ya describían multi-propiedad consolidado como un gap, por lo que no necesitaron cambios de contenido.

La verificación contrastó la documentación con la migración `20260328103000_prioridad6_integraciones_crecimiento.sql` y `js/modules/ops-saas/ops-saas.js`: el backend contiene las dos tablas, RLS exclusiva de superadmin y una RPC que devuelve únicamente tres conteos; el frontend consume ese resumen en tarjetas y no ofrece gestión ni consolidación por cadena. Una comprobación textual confirmó que el ítem 49 está pendiente, que el roadmap ya no lo presenta como completado y que los tres documentos de estado de la auditoría registran A18 como corregido. No hubo cambios de código, base de datos, preview ni producción.

## A13 + A14 — ciclo de estancia transaccional

La migración `20260915120000_a13_a14_reservation_lifecycle_atomic.sql` incorpora cuatro RPC `SECURITY DEFINER`, con `search_path` restringido, autorización por membresía activa del hotel, bloqueo e idempotencia:

- `crear_estancia_atomica` bloquea la habitación y confirma en una sola transacción el cliente opcional, la reserva, la ocupación, el cronómetro, el uso del descuento y los pagos iniciales;
- `realizar_checkin_reserva_atomico` conserva la duración contratada, bloquea reserva y habitación y crea el cronómetro dentro del mismo commit;
- `finalizar_estancia_reserva_atomica` finaliza la reserva, cierra cronómetros y envía la habitación a limpieza de forma indivisible;
- `forzar_limpieza_habitacion_atomica` repara únicamente habitaciones sin reserva activa y falla cerrada si detecta una estancia operativa;
- dos índices únicos parciales impiden cronómetros activos duplicados por hotel/habitación y hotel/reserva;
- las rutas de Mapa y Reservas consumen estas RPC mediante `reservationLifecycleService.js`, conservan un identificador estable para reintentos y muestran el error real antes de declarar éxito;
- el envío de notificaciones ocurre después del commit y un fallo del aviso ya no transforma una transición confirmada en un falso fallo operativo.

La prueba `tests/a13-a14-reservation-lifecycle.test.cjs` ejecuta la migración real sobre PostgreSQL embebido y aporta diez controles: contrato SQL/frontend, creación con cliente y pago, rollback al fallar el cronómetro, dos solicitudes concurrentes sobre la misma habitación, check-in y aislamiento cross-hotel, rollback de check-in, checkout idempotente, rollback de checkout, reparación huérfana fail-closed e índices únicos. El contrato financiero anterior se actualizó para comprobar que `monto_pagado` nace en cero y los pagos se ejecutan dentro de la misma transacción. El bloque A13/A14 quedó en 10/10 y la suite completa en 642/642; la sintaxis se validó en 282 archivos. El build local y el preflight de staging terminaron correctamente.

Supabase staging (`vyzscuzgjdhrhzctmsuv`) se verificó antes de escribir: no existían cronómetros activos duplicados por habitación ni por reserva. La migración completa pasó primero dentro de una transacción revertida y luego se aplicó. La comprobación remota confirmó cuatro RPC endurecidas, dos índices únicos, ejecución denegada a `anon` y concedida a `authenticated`. Debido al desfase histórico ya documentado entre migraciones locales y remotas, se aplicó mediante `db query --file` sin reparar ni reescribir el historial. Producción no fue modificada.

El frontend se desplegó el 2026-09-16 como preview de Vercel en `https://gestiondehotel-r8s42rxvt-cararegoms-projects.vercel.app` (deployment `dpl_6zL2ezDuNm8rMrit5FLqv3dJhv3v`). Vercel lo reportó `READY`. Las lecturas autenticadas confirmaron el servicio con las cuatro RPC, el alquiler directo con reserva y pagos atómicos y las rutas de check-in/checkout publicadas. Producción no fue modificada.

## Pendientes de aceptación de A13 + A14

1. Cuando se retomen las pruebas del hotel de prueba, crear una estancia con pago, hacer check-in de una reserva futura y entregar una habitación, verificando que el Mapa y Reservas reflejen el mismo estado.
2. Repetir una acción durante una conexión inestable y confirmar que el reintento devuelve el mismo resultado sin duplicar reserva, pago ni cronómetro.
3. Solicitar aprobación explícita antes de aplicar la migración o desplegar estos assets a producción.

## A15 + A16 — núcleo único de venta y ajuste atómico de inventario

La migración `20260918120000_a15_a16_tienda_inventario_atomico.sql` elimina la duplicación operativa de Tienda y completa el ajuste seguro de stock:

- `tienda_crear_venta_atomica_core` es un núcleo `SECURITY DEFINER` privado, con `search_path` restringido y ejecución revocada a `PUBLIC`, `anon`, `authenticated` y `service_role`;
- `procesar_venta_tienda_atomica` y `actualizar_estado_pedido_web_tienda` son las únicas entradas públicas de venta y delegan en ese núcleo;
- el POS toma el precio vigente del catálogo y el pedido web conserva el precio congelado en sus items; ambos comparten autorización, idempotencia, locks deterministas, stock, detalle, movimiento y auditoría;
- los items repetidos se agregan antes de bloquear, y los pagos repetidos del mismo método se consolidan antes de escribir Caja para respetar el índice idempotente;
- un identificador de operación ya usado solo puede ser recuperado por el actor que creó la venta;
- `ajustar_stock_tienda_seguro` bloquea el producto con `FOR UPDATE`, valida `inventario.ajustar`, impide stock negativo y confirma stock, movimiento y auditoría en la misma transacción;
- `inventario.js:saveMovimiento` llama a esa RPC con un identificador estable y usa el stock anterior/nuevo confirmado por el servidor; las escrituras directas separadas fueron retiradas.

La prueba `tests/a15-a16-tienda-atomicidad.test.cjs` ejecuta la migración real sobre PostgreSQL embebido y cubre precio autoritativo, venta/detalle/stock/caja/auditoría, reintento idempotente, rollback por stock o pagos, consolidación de pagos, permisos, stock negativo, cadena de ajustes, rollback al fallar el movimiento, privilegios SQL y contrato del frontend. Junto con la regresión C5, el bloque específico quedó en 21/21. La suite completa terminó en 651/651 pruebas, la sintaxis se validó en 283 archivos y tanto el build como el preflight de staging terminaron correctamente.

Supabase staging (`vyzscuzgjdhrhzctmsuv`) recibió primero un dry run transaccional revertido y después la migración mediante `db query --file`, sin alterar el historial divergente ya documentado. La verificación remota confirmó las cuatro firmas, `SECURITY DEFINER`, `search_path=pg_catalog, public`, delegación de ambos wrappers al núcleo, ejecución del núcleo denegada a `authenticated`/`service_role` y acceso a las tres RPC públicas únicamente para los roles autorizados. Producción no fue modificada.

El frontend se desplegó el 2026-09-18 como preview de Vercel en `https://gestiondehotel-d4354cc89-cararegoms-projects.vercel.app` (deployment `dpl_HKqb9MBheznHo9YsA8JoZy4ZBEis`). Vercel lo reportó `READY`. La lectura autenticada confirmó que el asset publicado llama `ajustar_stock_tienda_seguro`, conserva la operación estable, consume el stock confirmado por el servidor y ya no hace las dos escrituras directas dentro de `saveMovimiento`.

## Pendientes de aceptación de A15 + A16

1. Cuando se retomen las pruebas del hotel de prueba, ejecutar una venta POS simple y otra con pago mixto, y confirmar venta, Caja, stock e historial.
2. Entregar un pedido web con precio confirmado distinto del precio vigente del catálogo y comprobar que la cuenta conserva el precio del pedido.
3. Realizar un ingreso y una salida manual de inventario, repetir la acción durante una conexión inestable y comprobar que no se duplica el movimiento ni se pierde stock.
4. Solicitar aprobación explícita antes de aplicar la migración o desplegar estos assets a producción.

## A17 — recurrencia única de mantenimiento

La migración `20260919120000_a17_mantenimiento_recurrencia_unificada.sql` convierte el calendario de planes en la única autoridad para crear nuevas ocurrencias:

- agrupa las tareas recurrentes abiertas legacy por su configuración operativa y crea un plan preventivo por rutina;
- enlaza una sola tarea por fecha al plan y conserva duplicados existentes como tareas únicas, sin eliminar ni cancelar trabajo operativo;
- conserva sin cambios las tareas recurrentes ya cerradas para no reescribir el historial;
- calcula la primera fecha futura desde el ancla original, incluida la semántica de fin de mes, sin recorrer cientos de ocurrencias vencidas;
- exige mediante trigger que una tarea suelta use `unica`, una ejecución de plan use `personalizada` y el plan pertenezca al mismo hotel;
- mantiene el cron de alertas Fase 4 para SLA y reincidencias, mientras el cron `mantenimiento-calendario-planes` genera exclusivamente las ocurrencias de planes.
- redefine `mantenimiento_metricas()` en `20260919121500_a17_mantenimiento_metricas_planes.sql` para contar solo ejecuciones de planes preventivos y usar la fecha operativa del hotel en la ventana de siete días.

En frontend se retiró el selector `Frecuencia` de las rutas activa y anterior. `mantenimiento-mobile-ui.js`, `mantenimiento-workflow-ui.js` y `mantenimiento-ui.js` dejaron de generar la siguiente tarea al guardar o cerrar. También se eliminaron `mantenimiento-preventivo.js`, `calculateNextScheduledDate`, `findOpenPreventiveTask` y `createNextPreventiveTask`. El formulario explica que las tareas sueltas se ejecutan una vez y dirige la programación recurrente al calendario.

Supabase staging (`vyzscuzgjdhrhzctmsuv`) no tenía aún la cadena Fase 5 de planes. Se ejecutó primero un dry run transaccional de las siete migraciones de planes/checklist/incidencias más A17 y después se aplicó la misma cadena mediante `db query --file`, sin reparar el historial remoto divergente. La verificación confirmó `mantenimiento_planes`, alertas, checklist, funciones, RLS y cron activos; cero recurrencias legacy abiertas; cero tareas fuera del contrato; y rechazo real de una inserción recurrente sin plan. Un segundo dry run y verificación confirmaron que las métricas usan planes, `hotel_business_date()`, conservan el permiso de `authenticated` y niegan `anon`. Producción no fue modificada.

La prueba `tests/a17-mantenimiento-recurrencia-unificada.test.cjs` ejecuta A17 sobre PostgreSQL embebido y cubre conversión, duplicados, preservación del historial, ancla mensual, tarea única, tarea de plan, aislamiento cross-hotel y conteo preventivo desde planes en `mantenimiento_metricas()`. Las regresiones de Fase 1, Fase 3 y calendario se adaptaron al motor único. La suite completa terminó en 655/655 pruebas y la sintaxis se validó en 283 archivos.

El frontend se desplegó el 2026-09-19 como preview de Vercel en `https://gestiondehotel-g9m3iwwvi-cararegoms-projects.vercel.app` (deployment `dpl_BjEumjcQS5ud7mpuEGseVy9JKKeo`). Vercel lo reportó `READY`. La lectura autenticada de los módulos publicados confirmó el texto que dirige la recurrencia al calendario, la ausencia del selector `frecuencia` y la eliminación de las referencias al motor cliente tanto en la UI base como en workflow.

## Pendientes de aceptación de A17

1. En el hotel de prueba, programar una rutina recurrente desde el calendario y confirmar que el cron crea la ejecución esperada una sola vez.
2. Crear una tarea suelta y verificar que no aparece una segunda ejecución al cerrarla.
3. Solicitar aprobación explícita antes de aplicar la cadena SQL o desplegar estos assets a producción.

## M1 — reglas de suscripción fuera del router global

`js/services/subscriptionAccessService.js` concentra las reglas que estaban duplicadas o mezcladas con el arranque de la SPA:

- resuelve la activación de planes pendientes con una fecha de referencia explícita;
- calcula estado efectivo, dos días de gracia automática, gracia manual posterior y bloqueo fuera de gracia;
- reconoce `suscripcion_exenta`, por lo que una cuenta interna nunca queda bloqueada por fechas antiguas;
- trata fechas ausentes o inválidas de forma segura y no bloquea globalmente el router sin una fecha verificable;
- mantiene una sola lista de módulos exentos y conserva las reglas especiales de Terraza y del piloto bancario;
- decide en un único punto si una ruta se permite, redirige al administrador a Mi Cuenta o bloquea al personal;
- carga el hotel y su plan incluyendo `suscripcion_exenta`, campo que el router no consultaba antes.

`js/main.js` quedó limitado a aplicar esas decisiones y orquestar la interfaz. `accountDataService.js` eliminó su segunda implementación de plan pendiente y vencimiento; Mi Cuenta usa ahora el mismo servicio que controla el acceso global. Los fallbacks de invitado, usuario sin hotel, hotel sin plan, error de carga y superadministrador también se construyen mediante el contrato compartido.

`tests/m1-subscription-access-service.test.cjs` cubre plan pendiente, trial activo, gracia automática y manual, vencimiento confirmado, cuenta exenta, fechas inválidas, módulos incluidos/exentos/especiales, decisiones de ruta y la consulta del campo de exención. Se adaptó además la regresión histórica de Mi Cuenta. El bloque enfocado terminó en 17/17 pruebas; la suite completa en 663/663; la sintaxis se validó en 285 archivos; y el build y el preflight de staging terminaron correctamente.

El frontend se desplegó el 2026-09-21 como preview de Vercel en `https://gestiondehotel-qy89d4hh2-cararegoms-projects.vercel.app` (deployment `dpl_5d6dcj3usqrFTUVyjjLnH79UeZQQ`). Vercel lo reportó `READY`. La lectura autenticada confirmó que `main.js` importa el servicio, que el asset publicado consulta `suscripcion_exenta` y contiene una sola fuente para módulos exentos y decisiones por vencimiento. Producción no fue modificada.

## Pendientes de aceptación de M1

1. Cuando se retomen las pruebas del hotel de prueba, validar un administrador activo, uno vencido fuera de gracia, una cuenta interna exenta y un empleado de hotel vencido.
2. Confirmar visualmente que un módulo no incluido en el plan muestra la restricción y que Mi Cuenta permanece accesible para renovar.
3. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## M2 — contratos de las cinco Edge Functions bancarias

El núcleo `_shared/bank-email/*.ts` sigue siendo compartido por diseño, pero ya no puede cambiar sin verificar explícitamente cada consumidor:

- `bank-email-deploy-manifest.json` subió a versión 2 y declara `bank-email-api`, `bank-payment-relation-api`, `gmail-oauth-callback`, `gmail-webhook` y `gmail-watch-renew`;
- cada entrada fija su archivo, `verify_jwt`, mecanismo de autenticación, métodos HTTP, modo seguro de error y módulos compartidos mínimos;
- se corrigió la omisión de `bank-payment-relation-api` en el manifiesto anterior;
- `supabase/config.toml` declara explícitamente `verify_jwt=true` para esa API de relación, en vez de depender del valor predeterminado de la plataforma;
- las regresiones históricas de seguridad y release incluyen ahora la quinta función.

`tests/m2-bank-email-function-contracts.test.cjs` descubre automáticamente todos los entrypoints que importan `_shared/bank-email/` y exige que coincidan exactamente con el manifiesto. También verifica la presencia de los módulos compartidos, un solo handler por función, métodos permitidos, autenticación interna, apagado seguro, errores sin detalles internos y correspondencia con `supabase/config.toml`. Finalmente comprueba que `package.json` y `.github/workflows/ci.yml` ejecuten typecheck, lint y pruebas para los cinco consumidores y el núcleo compartido.

El bloque bancario enfocado terminó en 25/25 pruebas. La suite completa quedó en 668/668, la sintaxis se validó en 286 archivos, el typecheck de todas las Edge Functions terminó correctamente y Deno lint validó 42 archivos del bloque principal más `horario-engine`. No cambió la lógica operativa ni el esquema de la base de datos, por lo que M2 no requiere migración ni despliegue funcional. Producción y Supabase remoto no fueron modificados.

## Qué falta después de M2

M2 queda corregido técnicamente. No requiere una prueba manual del hotel porque protege el contrato de desarrollo y despliegue; el control se ejecuta automáticamente en CI.

## M3 — posibles notificaciones duplicadas de una transferencia

La migración `20260921120000_m3_bank_email_possible_duplicate_review.sql` añade una barrera conservadora en PostgreSQL:

- conserva `UNIQUE (hotel_id, gmail_message_id)` como idempotencia exacta del mismo correo;
- solo evalúa eventos Gmail detectados, sin referencia transaccional, con monto positivo y que no sean pruebas;
- serializa inserciones concurrentes con `pg_advisory_xact_lock` por hotel, banco y monto;
- exige que el evento anterior pertenezca al mismo hotel y banco, tenga el mismo monto, esté a no más de 120 segundos y coincida además por remitente normalizado o hash del contenido;
- ignora eventos rechazados o ya declarados duplicados;
- conserva los dos registros y cambia únicamente el nuevo a `manual_review` con `review_reason=possible_duplicate_transfer` y metadatos de los candidatos;
- no borra eventos ni asigna automáticamente el estado `duplicated`.

`payment-service.ts` decide el auto-match usando el estado realmente devuelto por PostgreSQL. Por ello, un posible duplicado en `manual_review` no puede relacionarse automáticamente con un pago esperado. También registra la señal en la auditoría existente. El detalle de Pagos Bancarios traduce el motivo técnico, muestra cuántas notificaciones compatibles se encontraron y pide comparar el movimiento antes de relacionarlo, aclarando que ningún pago fue descartado.

`tests/m3-bank-email-possible-duplicate.test.cjs` ejecuta el trigger real sobre PostgreSQL embebido. Cubre remitentes normalizados, hash coincidente sin remitente, mismo monto/hora con personas distintas, ventana, hotel, pruebas, referencias bancarias, estados ignorados, identidad Gmail y el bloqueo del auto-match. El bloque bancario terminó en 55/55 pruebas. La suite completa quedó en 677/677, la sintaxis se validó en 287 archivos, typecheck y Deno lint terminaron correctamente, y el build y el preflight de staging pasaron.

La migración se probó primero dentro de una transacción revertida y después se aplicó exclusivamente en Supabase staging (`vyzscuzgjdhrhzctmsuv`). La comprobación remota confirmó función `SECURITY DEFINER`, `search_path` controlado, ejecución denegada a `anon`/`authenticated`, índice presente y trigger activo. No había pares históricos compatibles. `bank-email-api` v10, `gmail-webhook` v6 y `gmail-watch-renew` v3 quedaron `ACTIVE` con sus opciones `verify_jwt` esperadas. Ese staging contiene 0 hoteles, 0 integraciones y 0 eventos bancarios, por lo que no permite una prueba funcional con dos correos reales sin configurar antes un hotel piloto.

El frontend se desplegó el 2026-09-21 como preview de Vercel en `https://gestiondehotel-mur8g0jxs-cararegoms-projects.vercel.app` (deployment `dpl_4M2xMzKEDUW5Yq5nwvKq1LMCdyVW`). Vercel lo reportó `READY` y la lectura autenticada del asset publicado confirmó la alerta de posible duplicado y el mensaje de conservación de ambos pagos. Producción no fue modificada.

## Pendientes de aceptación de M3

1. Cuando el hotel de prueba esté disponible, enviar dos correos controlados con IDs Gmail distintos que representen la misma transferencia y confirmar que el segundo queda en revisión manual.
2. Enviar dos transferencias legítimas del mismo monto dentro de la ventana, pero con remitentes y contenido distintos, y confirmar que ambas siguen como pagos recibidos sin asociar.
3. Verificar visualmente la advertencia, comparar el movimiento y resolverlo manualmente sin perder ninguno de los registros.
4. Solicitar aprobación explícita antes de aplicar la migración, las tres Edge Functions o el frontend en producción.

## M4 — documentación vigente de conciliación bancaria

Se alinearon once documentos de `docs/conciliacion-bancaria-v2/` con el código y las migraciones actuales:

- el estado de Fase 1 quedó identificado como una fotografía histórica;
- el plan refleja las Fases 1–25 ya implementadas;
- el modelo documenta `bank_payment_allocations.caja_id`, su clave foránea y su unicidad;
- los permisos separan el panel administrativo de la API limitada de recepción;
- el flujo de Caja describe `status`, `list`, `movement-statuses`, `cash-candidates` y `relate`;
- `replace_bank_payment_allocations_from_caja` y `bank_payment_has_valid_caja_link` quedaron incorporados al contrato;
- la trazabilidad sigue la cadena evento → asignación → Caja → ledger;
- checkout conserva relaciones exactas válidas y las relaciones legacy ambiguas quedan en revisión manual;
- el checklist de producción incluye las cinco Edge Functions, prechecks de `caja_id` y la prueba operativa A–K.

M4 no cambia código, base de datos ni servicios remotos. Se contrastaron los documentos con las migraciones y la Edge Function vigentes. El bloque enfocado de release, Fase 6, recepción, vínculo exacto, contratos de funciones y duplicados terminó en 40/40 pruebas. El barrido de afirmaciones obsoletas, la lectura UTF-8 de los 16 documentos del bloque y `git diff --check` terminaron sin errores.

## M5 — métodos desactivados incluidos en el arqueo de cierre

La migración `20260921130000_m5_cierre_metodos_inactivos.sql` endurece `cerrar_turno_con_arqueo`:

- deriva el conjunto obligatorio mediante la unión de métodos activos del hotel y métodos usados por `ingreso`, `egreso` o `apertura` del turno;
- exige que cada método obligatorio aparezca exactamente una vez;
- acepta un método inactivo únicamente si respalda un movimiento del turno;
- rechaza métodos ajenos, duplicados, conteos negativos o no finitos y movimientos financieros sin método;
- calcula `expected_amount` en servidor y `balance_final` desde todos los conteos validados;
- registra en auditoría la cantidad de métodos arqueados;
- conserva autorización por hotel, idempotencia, `SECURITY DEFINER`, `search_path` fijo y ejecución denegada a `anon`.

El frontend consulta el catálogo completo del hotel, presenta los activos más los inactivos realmente usados y marca estos últimos como históricos del turno. Los valores del modal, el resumen, el reporte y el payload del RPC se resuelven por `metodo_pago_id`; se conserva lectura por nombre únicamente como compatibilidad. El correo de cierre se envía después de confirmar el RPC, evitando reportar como cerrado un turno rechazado por la base de datos.

`tests/m5-cierre-metodos-inactivos.test.cjs` ejecuta la migración real sobre PostgreSQL embebido. Verifica rollback ante un método omitido, persistencia del método inactivo, expected/count/difference, balance final, duplicados, aislamiento entre hoteles, movimiento sin método y contrato frontend. El bloque financiero enfocado terminó en 51/51 pruebas; la suite completa en 684/684; la sintaxis se validó en 288 archivos; y build y preflight de staging terminaron correctamente.

Supabase staging (`vyzscuzgjdhrhzctmsuv`) tenía cero turnos abiertos, cero métodos inactivos usados por turnos abiertos, cero movimientos abiertos sin método y cero arqueos. La migración pasó primero dentro de una transacción revertida y luego se aplicó directamente, sin reescribir el historial de migraciones divergente ya documentado. La verificación remota confirmó `SECURITY DEFINER`, `search_path=pg_catalog, public`, `anon=false`, `authenticated=true`, `service_role=true` y las validaciones M5 presentes. Los Advisors de seguridad y rendimiento no reportaron errores. Producción no fue modificada.

El frontend se desplegó como preview de Vercel en `https://gestiondehotel-f80tl5gsr-cararegoms-projects.vercel.app` (deployment `dpl_AUz5y878SBjxFTdQ2yrVcv8ZcDGV`). Vercel lo reportó `READY`. Las lecturas autenticadas de los assets confirmaron la unión de métodos, conteos por UUID, etiqueta de método inactivo y envío del reporte después del RPC.

## Pendientes de aceptación de M5

1. En el hotel de prueba, abrir un turno, registrar un movimiento, desactivar ese método y comprobar que el cierre todavía exige y persiste su arqueo.
2. Verificar en `turno_arqueos` el esperado, contado y diferencia, y confirmar que `turnos.balance_final` incluye ese método.
3. Simular un reintento o cambio concurrente del catálogo y confirmar que el cierre falla cerrado o devuelve el resultado idempotente sin enviar un reporte falso.
4. Solicitar aprobación explícita antes de aplicar la migración o desplegar estos assets a producción.

## Qué falta después de M5

M5 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M6 también quedó corregido; su detalle se registra a continuación.

## M6 — clasificación estructurada de ingresos y habitaciones

`getMovementOriginKey` concentra la clasificación operativa de Caja y usa únicamente evidencia estructurada:

- `reserva_id`, `pago_reserva_id` o `source=reservation_payment` para Habitaciones;
- `venta_tienda_id`, `venta_restaurante_id` y `venta_terraza_id` para Tienda, Restaurante y Terraza;
- `source=terrace_tip`/`terrace_tip_mixed` para Propinas;
- los ingresos manuales o históricos sin vínculo verificable quedan en “Otros ingresos”.

`procesarMovimientosParaReporte`, las etiquetas del listado y el total de propinas comparten ese contrato. Se eliminó la asignación predeterminada a Habitaciones. “Otros ingresos” aparece en el reporte y participa en total de ingresos, saldo por método, balance operativo y arqueo, por lo que la mejora de clasificación no oculta dinero.

El resumen operativo recopila las reservas vinculadas al turno por `reserva_id` o mediante `pagos_reserva.reserva_id`, consulta `reservas` con su `habitacion_id` y cuenta habitaciones distintas desde esas filas. Se eliminaron `extraerHabitacionDesdeConcepto` y la expresión regular que buscaba palabras como habitación, alquiler, reserva o extensión.

`tests/m6-clasificacion-caja-estructurada.test.cjs` cubre conceptos engañosos, referencias y códigos de origen, ingresos manuales, conservación exacta de importes, balance por método, deduplicación de habitaciones y ausencia de las heurísticas retiradas. El bloque financiero enfocado terminó en 39/39 pruebas; la suite completa en 688/688; la sintaxis se validó en 289 archivos; y build, preflight y `git diff --check` terminaron correctamente.

M6 no necesita migración. La consulta de staging confirmó cero movimientos en turnos abiertos en todas las categorías, por lo que no había datos operativos pendientes que reclasificar. Producción no fue modificada.

El frontend se desplegó como preview de Vercel en `https://gestiondehotel-c39r9rz0j-cararegoms-projects.vercel.app` (deployment `dpl_GziHFJ7CNzR4Nnz7gQMW4m46hrP4`). Vercel lo reportó `READY`. Las lecturas autenticadas de los assets confirmaron el clasificador estructurado, “Otros ingresos”, la consulta de reservas, la resolución histórica por `pago_reserva_id` y la ausencia del fallback a Habitaciones.

## Pendientes de aceptación de M6

1. En el hotel de prueba, cerrar un turno con cobros de reserva, tienda, restaurante, terraza, propina y un ingreso manual.
2. Usar conceptos deliberadamente engañosos y comprobar que cada movimiento sigue la referencia estructurada, mientras el ingreso manual aparece en “Otros ingresos”.
3. Confirmar que el correo cuenta habitaciones distintas desde las reservas vinculadas y que el balance coincide con el arqueo.
4. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## Qué falta después de M6

M6 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M7 también quedó corregido; su detalle se registra a continuación.

## M7 — estados operativos visibles y cruces completos

`reservas-operacion.js` concentra los estados operativos, históricos y visibles. El listado, los filtros, los KPIs, la lista de espera y el bloqueo previo de tres horas consumen esas constantes. Las reservas `ocupada` y `tiempo agotado` aparecen entre las operaciones actuales, ofrecen abono cuando existe saldo y permiten checkout mediante la RPC transaccional ya instalada por A14. Los estados cerrados, incluido `finalizada`, quedan disponibles mediante búsqueda y filtros.

La migración `20260929120000_m7_reservas_estados_operativos.sql` redefine `validar_cruce_reserva` como `STABLE SECURITY INVOKER`, fija `search_path=pg_catalog, public`, valida habitación e intervalo, usa rangos semiabiertos `[)` e incluye `pendiente`, `reservada`, `confirmada`, `check_in`, `activa`, `ocupada` y `tiempo agotado`. La ejecución permanece denegada a `PUBLIC`/`anon` y concedida a `authenticated`/`service_role`.

`tests/m7-reservas-estados-operativos.test.cjs` ejecuta la migración real sobre PostgreSQL embebido y cubre los siete estados operativos, límites contiguos, exclusión de la reserva editada, estados cerrados, intervalos inválidos, privilegios, renderizado, colores y acciones. El bloque enfocado terminó en 37/37 pruebas; la suite completa en 692/692; la sintaxis se validó en 290 archivos; y build, preflight y `git diff --check` terminaron correctamente.

Supabase staging (`vyzscuzgjdhrhzctmsuv`) tenía cero reservas operativas, cero `ocupada` y cero `tiempo agotado`, por lo que no requirió reparación histórica. La migración pasó primero dentro de una transacción revertida y luego se aplicó directamente. La verificación remota confirmó `SECURITY INVOKER`, estabilidad, `search_path` controlado, validación de intervalos, inclusión de `tiempo agotado`, `anon=false`, `authenticated=true` y `service_role=true`. Producción no fue modificada.

El frontend se desplegó como preview de Vercel en `https://gestiondehotel-klu5q9ypr-cararegoms-projects.vercel.app` (deployment `dpl_CceQW7LBTwUMHE9qjMYtQCHTnCdw`). Vercel lo reportó `READY`; la verificación local y el build remoto confirmaron los assets M7.

## Pendientes de aceptación de M7

1. En el hotel de prueba, crear o localizar una reserva en `ocupada` y otra en `tiempo agotado`, y confirmar que ambas aparecen en Reservas.
2. Registrar un saldo pendiente, comprobar el botón de abono y completar checkout desde cada estado.
3. Intentar reservar la misma habitación en un intervalo superpuesto y confirmar el bloqueo; probar también un intervalo que empiece exactamente al finalizar el anterior.
4. Solicitar aprobación explícita antes de aplicar la migración o desplegar estos assets a producción.

## Qué falta después de M7

M7 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. La revalidación confirmó que M8 ya estaba resuelto por C5 y consolidado por A15; su cierre documental se registra a continuación.

## M8 — trazabilidad de inventario en pedidos web

M8 no requirió una nueva implementación. `20260910044500_c5_pedidos_web_entrega_segura.sql` ya agregaba una salida `venta_tienda_pedido_web` por producto entregado, y `20260918120000_a15_a16_tienda_inventario_atomico.sql` conservó esa garantía dentro de `tienda_crear_venta_atomica_core`, el núcleo compartido por POS y pedidos web.

El núcleo bloquea los productos, calcula `stock_anterior`/`stock_nuevo`, actualiza el stock e inserta `movimientos_inventario` en la misma transacción. Para pedidos web guarda `razon=venta_tienda_pedido_web` y notas con `pedido_web_id` y `venta_id`. El trigger de costeo excluye esa razón de los ajustes manuales porque `detalle_ventas_tienda` ya genera el CMV, evitando duplicarlo.

`tests/c5-pedidos-web.test.cjs` comprueba que una entrega crea exactamente una venta, un detalle, un movimiento y una auditoría, descuenta stock una sola vez y revierte todo ante errores. `tests/a15-a16-tienda-atomicidad.test.cjs` verifica que el wrapper web delega en el núcleo y conserva la razón de inventario. Ambas pruebas quedaron incluidas en la suite completa M7 de 692/692 casos aprobados.

La verificación de Supabase staging confirmó que `actualizar_estado_pedido_web_tienda` delega en `tienda_crear_venta_atomica_core` y que el núcleo instalado inserta el movimiento con las referencias esperadas. Staging contiene cero pedidos entregados y cero movimientos web, por lo que no hay historial que reparar ni una prueba funcional posible hasta usar el hotel de prueba. No se aplicaron migraciones ni despliegues adicionales para cerrar M8. Producción no fue modificada.

## Pendientes de aceptación de M8

1. En el hotel de prueba, entregar un pedido web con uno o varios productos.
2. Confirmar que cada producto aparece en el historial filtrable con razón `venta_tienda_pedido_web`, cantidades y stock anterior/nuevo correctos.
3. Verificar que el reintento no crea una segunda venta ni duplica el movimiento o el CMV.
4. Solicitar aprobación explícita antes de desplegar C5/A15 o el frontend relacionado a producción.

## Qué falta después de M8

M8 queda cerrado técnicamente como trabajo absorbido por C5/A15. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M9 ya fue absorbido por A17; M10 también quedó corregido y se registra a continuación.

## M10 — composición explícita de la interfaz de mantenimiento

`mantenimiento-ui-events.js` define un contrato único `maintenanceUiRendered` y las superficies `task-list`, `task-modal`, `plan-modal`, `calendar` y `room-checklist`. Cada capa propietaria emite el evento después de completar su render; workflow, checklist por habitaciones e incidencias escuchan únicamente la superficie que necesitan.

La composición activa ya no crea `MutationObserver` sobre el contenedor ni usa temporizadores para redescubrir nodos. La fila de estado se identifica mediante `data-task-status-row`; el botón de flujo declara `data-maintenance-transition`, por lo que los guardas de checklist e incidencias reconocen el cierre por estado `cerrado` y no por el texto visible. El calendario genera directamente sus atributos `data-google-calendar-*`, incluida la clase real de cada evento, y la capa visual se limita a instalar estilos.

El evento de modal transporta `taskId` o `planId`, eliminando la dependencia del orden de listeners de clic. Incidencias invalida respuestas asíncronas de una modal anterior mediante una generación de render, evitando que un checklist viejo bloquee una tarea distinta.

`tests/m10-mantenimiento-ui-composicion.test.cjs` prueba el contrato de eventos, las cinco emisiones, los atributos semánticos, la ausencia de observers/temporizadores y la eliminación de detecciones por texto o selectores visuales. La regresión enfocada de Mantenimiento terminó en 64/64 y la suite completa en 696/696; el control de sintaxis validó 292 archivos. Build, preflight de staging, `git diff --check` y Graphify terminaron correctamente. La verificación de navegador local confirmó contenido, ausencia de overlays y cero errores capturados; la aceptación dentro del hotel sigue aplazada hasta usar el hotel de prueba.

El frontend quedó publicado como preview protegido de Vercel en `https://gestiondehotel-uajl0b7bf-cararegoms-projects.vercel.app` (deployment `dpl_GokVkiXz1inPkYGrVFz72SiG6Y2L`). Vercel lo reportó `READY`, `target=preview` y sin URL de producción. La lectura autenticada de los assets confirmó el contrato `maintenanceUiRendered`, el selector `data-task-status-row` y la transición semántica. M10 no requiere migración ni cambió Supabase. Producción no fue modificada.

## Pendientes de aceptación de M10

1. En el hotel de prueba, abrir Mantenimiento y confirmar que resumen, filtros, SLA y acciones aparecen al cargar y después de una actualización en tiempo real.
2. Abrir una tarea con checklist por habitaciones, comprobar que el cierre se bloquea mientras existan revisiones pendientes y que una novedad sin incidencia conserva el segundo bloqueo.
3. Abrir y guardar una programación con alcance por habitación, navegar entre meses y comprobar que el calendario conserva estilos y acciones después de cada render.
4. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## Qué falta después de M10

M10 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. La revalidación confirmó que M11 ya estaba resuelto por A11; su cierre documental se registra a continuación.

## M11 — paginación completa de Ocupación y KPIs

M11 no requirió una nueva implementación. El trabajo de A11 ya extrajo `fetchAllWithPagination` a `supabasePaginationService.js` y conectó las 20 consultas voluminosas de Reportes. El helper solicita páginas de 1.000 filas hasta la última página, rechaza respuestas ambiguas y, si una página falla, devuelve `data=null` en vez de entregar un acumulado incompleto.

`generarReporteOcupacion` pagina las reservas con orden por `fecha_inicio` e `id` antes de calcular porcentajes. `fetchKPIData` pagina reservas, ingresos de Caja, detalle de ventas de Tienda y servicios; el total de habitaciones usa un conteo exacto `head`. Los errores de cualquiera de estas fuentes interrumpen el cálculo y la interfaz presenta el fallo en lugar de renderizar cifras parciales.

La revalidación ejecutó los seis casos de `tests/a11-report-pagination.test.cjs`, incluidos 2.505 registros, página final exacta, fallo intermedio, respuesta ambigua y cobertura estática de Ocupación/KPIs. El bloque conjunto A6/A11/A12 terminó en 16/16 y la suite completa vigente en 696/696. La lectura autenticada del preview `dpl_GokVkiXz1inPkYGrVFz72SiG6Y2L` confirmó el tamaño de página, el bucle por rangos, el fallo cerrado, 20 llamadas paginadas, 20 órdenes por `id`, Ocupación paginada y cuatro fuentes KPI paginadas. No se cambió código, base de datos ni servicios remotos para cerrar M11. Producción no fue modificada.

## Pendientes de aceptación de M11

1. En el hotel de prueba, generar Ocupación y KPIs sobre un período con más de 1.000 reservas o movimientos y contrastar los totales con una consulta administrativa.
2. Cuando se retomen pruebas de fallos controlados, interrumpir una página posterior a la primera y confirmar que la interfaz muestra error sin conservar cifras parciales.
3. Solicitar aprobación explícita antes de desplegar A11 o el frontend acumulado a producción.

## Qué falta después de M11

M11 queda cerrado técnicamente como trabajo absorbido por A11. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M12 también quedó corregido y se registra a continuación.

## M12 — reconciliación batch de estados operativos del mapa

`operational-room-state-sync.js` concentra la reconciliación que antes vivía dentro de `mapa-habitaciones.js`. El servicio acepta únicamente los estados derivados de una estancia activa (`ocupada` y `tiempo agotado`), descarta IDs duplicados y agrupa las correcciones por estado objetivo. Cada grupo ejecuta un solo `UPDATE` con filtro por `hotel_id` e `.in('id', roomIds)`, por lo que una recarga pasa de N peticiones HTTP a un máximo de dos.

Cada operación solicita a Supabase los IDs actualizados. El estado local solo se confirma para esas filas; una excepción, una respuesta sin arreglo o una fila ausente se contabilizan como fallo y conservan `needsOperationalResync=true` para el siguiente render. Un lote fallido no invalida otro lote exitoso y la interfaz registra el número de habitaciones afectadas sin declarar éxito prematuro.

`tests/m12-mapa-room-state-batch.test.cjs` cubre 43 correcciones resueltas en dos peticiones, aislamiento por `hotel_id`, estados admitidos, ausencia de llamadas sin trabajo, respuesta parcial, excepción de red e integración efectiva desde el render del mapa. La regresión enfocada terminó en 28/28 pruebas y la suite completa en 700/700; la sintaxis se validó en 294 archivos. Build, preflight de staging y `git diff --check` terminaron correctamente. Graphify se actualizó a 6.259 nodos, 12.235 relaciones y 496 comunidades.

El frontend quedó publicado como preview protegido de Vercel en `https://gestiondehotel-92psimc2m-cararegoms-projects.vercel.app` (deployment `dpl_ATHTUf2X5uX58VBKp4JPBikkny9r`). Vercel lo reportó `READY`, `target=preview` y sin URL de producción. Las lecturas autenticadas confirmaron el servicio batch, el filtro por `hotel_id`, el `.in('id', roomIds)`, la confirmación mediante `.select('id')` y su integración desde el render del mapa.

M12 no requiere migración ni modifica Supabase. Producción no fue modificada.

## Pendientes de aceptación de M12

1. En el hotel de prueba, abrir el mapa con varias estancias activas cuyo estado guardado esté desactualizado.
2. Confirmar en la red del navegador que todas las habitaciones con el mismo estado se actualizan en una sola petición y que el mapa conserva su estado correcto al recargar.
3. Simular un rechazo de actualización y comprobar que el mapa sigue visible, registra el fallo y reintenta en un render posterior.
4. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## Qué falta después de M12

M12 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M13 también quedó corregido y se registra a continuación.

## M13 — fechas de pagos dirigidas por el ciclo de vida del mapa

`mapa-ui-events.js` define `mapaAccountModalRendered`. `mostrarModalConsumosLocal` emite ese evento después de completar el modal y entrega el `reservationId` que ya usa para cargar la cuenta. `mapa-fechas-abonos-inline.js` escucha el contrato únicamente mientras Mapa de Habitaciones está montado; `mapa-habitaciones.js` instala el listener en `mount()` y lo retira en `unmount()`.

El complemento dejó de usar el intervalo global de 500 ms, `MutationObserver`, búsqueda del botón de impresión, lectura del nombre desde el título y reintentos por tiempo. También dejó de cargarse como script global en `app/index.html`. Una generación de render invalida respuestas asíncronas de un modal anterior.

La carga usa directamente `hotelId` y `reservationId` para consultar `servicios_x_reserva` y `pagos_reserva`. Se eliminaron la descarga completa de `habitaciones` y la segunda consulta para redescubrir la reserva activa. La coordinación con `mapa-consumos-pagos-enhancer.js` conserva una sola presentación visual de fechas e historial, incluida la limpieza después de imprimir.

Las pruebas enfocadas de M12/M13, saldo y timezone terminaron en 25/25; incluyen montaje/desmontaje, emisión del contexto conocido, ausencia de polling/observer, ausencia de consultas a habitaciones/reservas, aislamiento por hotel y reserva, fechas junto al servicio y no duplicación del historial. La suite completa terminó en 701/701 y la sintaxis se validó en 295 archivos. Build, preflight de staging y `git diff --check` terminaron correctamente. Graphify se actualizó a 6.269 nodos, 12.253 relaciones y 502 comunidades.

El frontend quedó publicado como preview protegido de Vercel en `https://gestiondehotel-1h5ivfzj7-cararegoms-projects.vercel.app` (deployment `dpl_2XQoZbcmErV8BJgv5XmQ2LZTKZJ4`). Vercel lo reportó `READY`, `target=preview` y sin URL de producción. Las lecturas autenticadas confirmaron el evento, mount/unmount, uso directo de `reservationId`, ausencia de intervalos, observers y consultas a habitaciones, integración con el mapa y retiro de la carga global.

M13 no requiere migración ni modifica Supabase. Producción no fue modificada.

## Pendientes de aceptación de M13

1. En el hotel de prueba, abrir “Ver consumos” en una habitación con varios servicios pagados y confirmar que cada fecha aparece junto al servicio correcto.
2. Cerrar y volver a abrir la cuenta, cambiar de habitación y confirmar que no se muestran datos del modal anterior ni listas duplicadas.
3. Navegar varias veces entre Mapa y otros módulos y verificar que no quedan listeners activos ni consultas periódicas en segundo plano.
4. Imprimir la factura y confirmar que incluye el historial esperado mientras el modal conserva una sola presentación visual.
5. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## Qué falta después de M13

M13 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. M14 también quedó corregido y se registra a continuación.

## M14 — rango inicial de Reportes según la fecha operativa del hotel

`reportesTimeZoneService.js` incorpora `getDefaultReportDateRange`. El helper obtiene la fecha `YYYY-MM-DD` mediante `getTodayInTimeZone`, resta días con `addCalendarDays` y devuelve el rango sin convertir una fecha de calendario a UTC. La ventana sigue siendo de 30 días hacia atrás, incluida la fecha final.

`reportes.js` usa ese helper desde el primer render, por lo que ya no muestra temporalmente una fecha UTC incorrecta mientras carga el plan del hotel. `reportes-centro-core.js` consume el mismo contrato al reafirmar la zona configurada, eliminando la segunda implementación del cálculo.

`tests/m14-report-default-dates.test.cjs` cubre Bogotá a las 9:00 p. m. cuando UTC ya avanzó al día siguiente, `Pacific/Kiritimati`, cruce de año, una semana que cruza el cambio horario de Nueva York y la integración de ambas superficies. El bloque M14/A6/A12/timezone terminó en 20/20 pruebas; la suite completa en 705/705 y la sintaxis se validó en 296 archivos. `git diff --check` terminó correctamente. `graphify update .` reconstruyó el grafo con 6282 nodos, 12269 aristas y 503 comunidades.

El preview `https://gestiondehotel-igg79n8ay-cararegoms-projects.vercel.app` (`dpl_EGxtaYVjeW5894Yt8V2SGHGDX5Dc`) quedó `READY`, con destino `preview`, autenticación de Vercel y sin URL de producción. La lectura autenticada de los assets confirmó `getDefaultReportDateRange` en el servicio y su consumo en `reportes.js` y `reportes-centro-core.js`.

M14 no requiere migración ni modifica Supabase. Producción no fue modificada.

## Pendientes de aceptación de M14

1. En el hotel de prueba, abrir Reportes durante la tarde/noche y confirmar que “Hasta” muestra el día vigente en la zona configurada del hotel.
2. Cambiar temporalmente la zona horaria del hotel de prueba a una zona adelantada y comprobar que ambos límites se ajustan por días de calendario.
3. Confirmar que el rango permanece igual al cambiar entre las pestañas del Centro de Reportes.
4. Solicitar aprobación explícita antes de desplegar estos assets a producción.

## Qué falta después de M14

M14 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. El siguiente hallazgo medio pendiente es M15: la conciliación bancaria fija manualmente el offset de Bogotá en vez de usar la zona horaria configurada del hotel.

## M15 — zonas horarias de la conciliación bancaria

La corrección separa dos conceptos que antes estaban implícitos. `BankParserRule.transactionTimeZone` identifica la zona IANA usada por el banco en el texto del correo; la regla de Bancolombia declara `America/Bogota`. El nuevo `time-zone.ts` convierte esas fechas locales a instantes, genera el bucket de `transaction_date` y alimenta la huella secundaria sin restar cinco horas manualmente. Las reglas de otros bancos pueden declarar su propia zona sin cambiar el parser.

Los filtros `Desde` y `Hasta` tienen otra semántica: representan días operativos del hotel. `bank-email-api` ahora lee `hoteles.zona_horaria` y construye un rango UTC semiabierto que respeta cambios de offset y DST. Ya no concatena `T00:00:00-05:00`.

`tests/m15-bank-email-timezone.test.cjs` cubre buckets distintos para Bogotá y Ciudad de México, conversión de la hora fuente por banco, un día de 23 horas durante el cambio horario de Nueva York y el contrato de integración. El bloque bancario enfocado terminó en 47/47 pruebas; la suite completa en 709/709, la sintaxis en 297 archivos, y `deno check`, `deno lint` y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6302 nodos, 12318 aristas y 505 comunidades.

No se requirió migración. `bank-email-api` v11 quedó `ACTIVE` en Supabase staging `vyzscuzgjdhrhzctmsuv` con `verify_jwt=true`. Como el procesamiento automático comparte el mismo núcleo, también se actualizaron `gmail-webhook` v7 y `gmail-watch-renew` v4, ambos `ACTIVE` y con sus opciones `verify_jwt=false` esperadas porque aplican autenticación específica en código. Una llamada remota sin credenciales a la API recibió `401 UNAUTHORIZED_NO_AUTH_HEADER`, confirmando que la barrera JWT sigue activa. Producción no fue modificada.

## Pendientes de aceptación de M15

1. En un hotel de prueba con la integración bancaria configurada, filtrar transferencias de un día que tenga eventos alrededor de medianoche y confirmar que el listado coincide con la zona del hotel.
2. Simular una regla bancaria con otra zona IANA y verificar el instante, la fecha de transacción y la deduplicación.
3. Solicitar aprobación explícita antes de desplegar `bank-email-api` a producción.

## Qué falta después de M15

M15 queda corregido y verificado técnicamente. La aceptación funcional queda aplazada hasta usar el hotel de prueba. El siguiente hallazgo medio pendiente es M16.

## M16 — presupuesto automático para el tamaño de Reservas

La medición actual confirmó 3289 líneas en `js/modules/reservas/reservas.js`. `docs/roadmap-mejoras.md` ya no presenta la fragmentación como completada ni conserva la cifra obsoleta de 2853 líneas. `docs/revision-modulos-especial.md` distingue el corte histórico de la medición actual y mantiene como trabajo pendiente la extracción adicional y la regresión funcional.

`scripts/check-module-size-budgets.cjs` fija 3289 como techo temporal y `npm run check:module-budgets` queda incorporado a GitHub Actions. El control permite que las extracciones reduzcan el archivo, pero falla si un cambio vuelve a aumentar el orquestador. `tests/m16-module-size-budget.test.cjs` verifica conteo estable en LF/CRLF y el presupuesto real del archivo.

El bloque M16 terminó en 2/2 pruebas; la suite completa en 711/711 y la sintaxis en 299 archivos. El presupuesto y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6316 nodos, 12335 aristas y 504 comunidades. M16 no modifica el runtime, la base de datos ni Supabase, por lo que no requiere preview ni despliegue. La reducción posterior de `reservas.js` permanece visible en el roadmap y deberá acompañarse de la regresión manual ya aplazada para el hotel de prueba.

## Qué falta después de M16

M16 queda cerrado como control de deuda verificable. El último hallazgo medio pendiente es M17.

## M17 — contratos entre extensiones del shell y módulos base

`tests/m17-runtime-extension-contracts.test.cjs` convierte la fragmentación del shell en un contrato verificable. Mantiene el inventario de diez scripts de extensión cargados directamente por `app/index.html`, exige que cada asset exista, aparezca una sola vez y tenga versión de caché, y conserva el orden en que la recuperación de Energía se instala antes de `main.js` y las extensiones después.

La misma prueba cruza cada extensión con el selector o evento publicado por su módulo base: Habitaciones y tarifas, permisos y simulador, alquiler/extensión y saldo del Mapa, creación/archivo/sesión activa de Usuarios, activación de Energía y conciliación desde Caja. También cubre `mapa-consumos-pagos-enhancer.js` y `tarifas-programadas-simulador-bootstrap.js`, que se cargan desde otra extensión en vez del HTML. `bank-payment-reception-bootstrap.js` recibió `?v=20261001-m17-contract-1`, eliminando el único asset directo sin invalidación explícita de caché.

El bloque enfocado terminó en 111/111 pruebas; la suite completa en 715/715 y la sintaxis en 300 archivos. El presupuesto de M16, el preflight de Vercel, la compilación local y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6330 nodos, 12348 aristas y 506 comunidades.

El preview `https://gestiondehotel-23d7g06e5-cararegoms-projects.vercel.app` (`dpl_ADSSnBgjaW7xuB4JVufCxN4YQaU6`) quedó `READY`, protegido con autenticación de Vercel y sin `productionUrl`. La verificación autenticada confirmó las diez extensiones directas, una sola referencia a `bank-payment-reception-bootstrap.js?v=20261001-m17-contract-1` y coincidencia SHA-256 exacta entre el asset local y el servido. M17 no requiere migración ni modifica Supabase. Producción no fue modificada.

## Pendientes de aceptación de M17

1. En el hotel de prueba, recorrer Habitaciones, Mapa, Usuarios, Configuración/Energía y Caja para confirmar que cada extensión se instala una sola vez.
2. Verificar en Caja que el acceso de conciliación sigue apareciendo solo para el piloto y rol autorizado.
3. Solicitar aprobación explícita antes de promover estos assets a producción.

## Qué falta después de M17

M17 cierra el último hallazgo medio del inventario priorizado. La ejecución continúa con los hallazgos bajos, comenzando por B1.

## B1 — CORS de funciones de gestión de usuarios

Se creó `supabase/functions/_shared/user-management-cors.ts` con una allowlist compartida para `gestiondehotel.com`, `www.gestiondehotel.com` y los hosts locales autorizados. `crear_colaborador` y `actualizar_permisos_usuario` la consumen mediante el endpoint común; `manage-user-lifecycle` bloquea un origen ajeno antes de construir el cliente privilegiado, y `delete-user` dejó de publicar el comodín aun cuando conserva su respuesta 410.

`tests/b1-user-management-cors.test.cjs` cubre el inventario sin comodines, los cuatro orígenes permitidos, `Vary: Origin`, el rechazo 403 previo al handler y el flujo sin cabecera `Origin`. El bloque B1 junto con la regresión P0 terminó en 35/35; la suite completa terminó en 720/720 y la sintaxis en 301 archivos. `deno check --node-modules-dir=auto` validó las cuatro funciones. `graphify update .` reconstruyó el grafo con 6342 nodos, 12370 aristas y 504 comunidades.

En Supabase staging `vyzscuzgjdhrhzctmsuv`, `crear_colaborador`, `actualizar_permisos_usuario`, `manage-user-lifecycle` y `delete-user` quedaron como versión 2, `ACTIVE` y `verify_jwt=true`. Los preflights remotos devolvieron 200 y reflejaron exactamente el origen permitido; `https://evil.example` recibió 403 y no fue reflejado. No hubo migración ni cambio de frontend. Producción no fue modificada.

## Qué falta después de B1

B1 queda corregido y verificado técnicamente en staging. La revisión continúa con B2.

## B2 — movimiento manual fuera del turno actual

La revisión de precedencia de migraciones mostró que el hallazgo se apoyó en la definición de `registrar_movimiento_caja_atomico` de `20260809105000`, pero el repositorio contiene una definición posterior: `20260825150000_fix_caja_movimiento_fuera_turno.sql`. Esta solo exige un turno abierto, propio y del hotel cuando `p_turno_id` no es nulo; con `NULL` conserva la validación del actor/hotel, monto, concepto y método de pago, e inserta el movimiento con `turno_id NULL`, `source='manual_cash'` y fecha operativa.

El frontend conserva el contrato esperado: `egreso_fuera_turno` decide `turnoIdToSave = null` y ese valor llega a `p_turno_id`. `tests/caja-fuera-turno.test.cjs` terminó en 2/2 y la suite completa que lo incluye terminó en 720/720. `supabase migration list --linked` confirmó que `20260825150000` está registrada tanto local como remotamente en staging. No se aplicó una migración nueva porque el arreglo ya estaba desplegado allí.

## Pendientes de aceptación de B2

1. En el hotel de prueba, registrar un ingreso o egreso con la casilla activada y confirmar que queda sin `turno_id` y fuera del arqueo actual.
2. Confirmar el estado equivalente de la definición en producción antes de darla por cerrada allí.

## Qué falta después de B2

B2 queda revalidado técnicamente. La revisión continúa con B3.

## B3 — historial activo de reversiones de Caja

El panel administrativo dejó de consultar `log_caja_eliminados`, tabla que ya no recibe escrituras. `caja-paneles.js` expone ahora `mostrarHistorialReversiones`, consulta `caja_reversiones` con filtro explícito por `hotel_id` y presenta fecha, responsable, aprobador, motivo, movimiento original y contramovimiento. `caja.js` cambió el control a «Ver reversiones» y retiró los nombres y listeners del flujo legacy.

`tests/b3-caja-reversion-history.test.cjs` fija el retiro de la consulta antigua, el filtro multi-hotel, los campos escapados y el contrato RLS/escritura atómica. El bloque enfocado de Caja terminó en 12/12; la suite completa terminó en 724/724 y la sintaxis en 302 archivos. El preflight y la compilación de Vercel pasaron. `graphify update .` reconstruyó el grafo con 6353 nodos, 12377 aristas y 512 comunidades.

El preview `https://gestiondehotel-c1bdr6q0o-cararegoms-projects.vercel.app` (`dpl_5s7FZXez74ArVyNrjemKQELEkVM7`) quedó `READY`, protegido con autenticación de Vercel y sin `productionUrl`. La comprobación autenticada confirmó coincidencia SHA-256 exacta de `caja.js` y `caja-paneles.js` entre el repositorio y el preview. B3 no requiere migración nueva. Producción no fue modificada.

## Pendientes de aceptación de B3

1. Con un administrador del hotel de prueba, abrir Caja y confirmar que «Ver reversiones» muestra las anulaciones existentes del mismo hotel.
2. Confirmar que un usuario no administrativo no recibe el control y que el modal cierra correctamente.

## Qué falta después de B3

B3 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B4, los valores muertos del enum `estado_reserva_enum`.

## B4 — contrato canónico y compatibilidad de estados de reserva

`reservas-operacion.js` ahora separa la máquina vigente de los valores heredados. Los estados abiertos canónicos son `pendiente`, `reservada`, `confirmada`, `activa` y `ocupada`; los estados terminales canónicos son `cancelada`, `completada`, `finalizada`, `no_show`, `cancelada_mantenimiento` y `finalizada_auto`. `check_in`, `check_out`, `facturada_pagada` y `tiempo agotado` quedan identificados explícitamente como legacy y fuera de `RESERVA_WRITABLE_STATES`.

La compatibilidad de lectura se mantiene para no ocultar ni reinterpretar reservas históricas. Los cuatro valores legacy siguen dentro del conjunto visible y conservan sus etiquetas. `check_in` y `tiempo agotado` también permanecen en `RESERVA_CONFLICT_STATES`, porque una fila histórica en cualquiera de esos estados representa una estancia abierta y debe impedir otra reserva sobre la misma habitación.

La migración `20261001120000_b4_reserva_estados_legacy_guard.sql` instala un trigger sobre inserciones y cambios de `reservas.estado`. El guard rechaza nuevas escrituras hacia cualquiera de los cuatro estados heredados con el código estable `B4_ESTADO_RESERVA_LEGACY_NO_ESCRIBIBLE`. No elimina valores del enum ni filas históricas; permite editar otros campos de esas filas y normalizarlas hacia un estado canónico.

`tests/b4-reserva-estados-legacy.test.cjs` aporta cuatro controles sobre la separación de estados, rechazo de inserciones/transiciones legacy, preservación y normalización del historial, y privilegios del guard. El bloque de Reservas B4/M7/A13/A14/C4 terminó en 26/26, la suite completa en 728/728 y la sintaxis se validó en 303 archivos. La compilación, el preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6384 nodos, 12407 aristas y 505 comunidades.

Antes de aplicar, Supabase staging `vyzscuzgjdhrhzctmsuv` reportó 0 reservas. La migración pasó dentro de una transacción revertida y después se aplicó mediante `db query --file`, sin reparar el historial remoto divergente. La verificación confirmó el trigger habilitado, `search_path=pg_catalog, public`, ejecución directa denegada a `anon`/`authenticated` para la función trigger y los permisos esperados del helper. Los Advisors de seguridad y rendimiento no reportaron errores. Producción no fue modificada.

El preview `https://gestiondehotel-m73cbhsbs-cararegoms-projects.vercel.app` (`dpl_DbazubahEXayWxTZcuu9mVjfbVxm`) quedó `READY`, protegido con autenticación de Vercel y sin `productionUrl`. La descarga autenticada confirmó coincidencia SHA-256 exacta de `reservas-operacion.js` (`475c91167f0f61d5d8aa17e4634dcedbf345e6d68b50255587b934b79bf9f0cd`) entre el repositorio y el preview.

## Pendientes de aceptación de B4

1. En el hotel de prueba, crear una reserva futura, hacer check-in y checkout, y confirmar que solo recorre estados canónicos.
2. Si producción contiene filas en estados heredados, inventariarlas antes del despliegue y decidir su normalización caso por caso; el guard permite conservarlas sin aceptar nuevas escrituras legacy.
3. Solicitar aprobación explícita antes de aplicar la migración y los assets en producción.

## Qué falta después de B4

B4 queda corregido y verificado técnicamente en staging y preview. El siguiente hallazgo bajo es B5, la función `descontar_stock_por_venta` confirmada como código muerto.

## B5 — retiro de `descontar_stock_por_venta`

La revisión de todo `js/` y de las migraciones posteriores confirmó que `descontar_stock_por_venta(bigint, uuid, integer)` no tenía consumidores, triggers ni funciones dependientes. Su cuerpo pertenecía al modelo anterior de restaurante: referenciaba `recetas`, `recetas_items` y `venta_restaurante_item_id`, mientras los flujos vigentes usan las RPC transaccionales de ventas, recetas, costeo y movimientos de inventario.

La migración `20261001130000_b5_drop_dead_stock_function.sql` ejecuta un único `DROP FUNCTION IF EXISTS` con la firma completa y sin `CASCADE`. `tests/b5-dead-stock-function.test.cjs` fija el alcance exacto, verifica que no existan consumidores JavaScript y ejecuta la migración real sobre PostgreSQL embebido. El bloque enfocado de Tienda/Inventario terminó en 32/32, la suite completa en 731/731 y la sintaxis se validó en 304 archivos. `git diff --check` terminó correctamente. `graphify update .` reconstruyó el grafo con 6397 nodos, 12419 aristas y 519 comunidades.

En Supabase staging `vyzscuzgjdhrhzctmsuv`, la comprobación previa confirmó que la función existía, era `SECURITY INVOKER` y solo concedía ejecución explícita a `service_role`. El `DROP` pasó primero dentro de una transacción revertida y después se aplicó mediante `db query --file`, sin reparar el historial remoto divergente. `to_regprocedure(...)` confirmó posteriormente que la firma ya no existe. Los Advisors de seguridad y rendimiento no reportaron errores. B5 no modifica frontend y no requirió un nuevo preview. Producción no fue modificada.

## Qué falta después de B5

B5 queda cerrado técnicamente en staging. El siguiente hallazgo bajo es B6: `cargarDatosPOS` confía solo en RLS al leer `categorias_producto` y no añade un filtro explícito por `hotel_id`.

## B6 — filtro tenant explícito en categorías del POS

`cargarDatosPOS()` en `js/modules/tienda/pos.js` añadió `.eq('hotel_id', tiendaState.currentHotelId)` a la consulta de `categorias_producto`. Productos, métodos de pago y habitaciones ya usaban el mismo contexto; `categorias.js` e `inventario.js` también filtraban categorías correctamente. Con este cambio, la carga del POS deja de depender exclusivamente de RLS para mantener el aislamiento entre hoteles.

`tests/b6-pos-category-tenant-filter.test.cjs` aporta tres controles: contrato de la consulta del POS, consistencia con las otras lecturas de categorías y permanencia de RLS con `fase1_actor_es_miembro_activo(hotel_id)` como segunda barrera. La regresión enfocada de Tienda terminó en 31/31, la suite completa en 734/734 y la sintaxis se validó en 305 archivos. El build, el preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6412 nodos, 12433 aristas y 505 comunidades.

El preview protegido `https://gestiondehotel-mqyl1edk2-cararegoms-projects.vercel.app` (`dpl_85NfVe6nBGkp176gWrk7h4doTLLp`) quedó `READY`, sin `productionUrl`. La descarga autenticada confirmó el filtro y coincidencia SHA-256 exacta de `pos.js` (`1b2b8f3ff45fc07e177b23747f68105f0e88049951a37b46ad73a88da17348ed`) entre el repositorio y el preview. B6 no requiere cambios de Supabase. Producción no fue modificada.

## Pendientes de aceptación de B6

1. En el hotel de prueba, abrir el POS y confirmar que solo se muestran nombres de categorías del hotel activo.
2. Si se dispone de dos hoteles con categorías distintas, alternar de sesión/contexto y confirmar que no quedan etiquetas del hotel anterior.
3. Solicitar aprobación explícita antes de promover el asset a producción.

## Qué falta después de B6

B6 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B7: confirmar y retirar `mantenimiento-ui.js` si continúa fuera de la cadena activa de montaje.

## B7 — retiro de `mantenimiento-ui.js`

La búsqueda completa del runtime confirmó que `mantenimiento-ui.js` no tenía consumidores. `js/main.js` carga la fachada `mantenimiento.js`, y la cadena canónica continúa por `mantenimiento-analytics-ui.js`, `mantenimiento-workflow-ui.js` y `mantenimiento-mobile-ui.js`. El único lector restante era una prueba histórica de A17; se actualizó para exigir la ausencia del archivo. La implementación desktop obsoleta, de 728 líneas en el árbol corregido, fue retirada.

`tests/b7-maintenance-dead-ui.test.cjs` fija dos contratos: ausencia del archivo y de referencias ejecutables, y composición completa de la cadena activa. La prueba A17 también impide que el archivo legacy reaparezca. El bloque enfocado de Mantenimiento terminó en 27/27, la suite completa en 736/736 y la sintaxis se validó en 305 archivos. El preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6397 nodos, 12316 aristas y 504 comunidades.

El preview protegido `https://gestiondehotel-2n8vard5g-cararegoms-projects.vercel.app` (`dpl_8Kv1L2ksefXa5u7XtWuzEsfQ1Tuk`) quedó `READY`, sin `productionUrl`. La descarga autenticada confirmó estado 200 y coincidencia SHA-256 exacta de `mantenimiento.js` (`10efaad914487d72d0e5e18dc65484a1cb859742977d8a29ca4ee67b5d322e44`) entre el repositorio y el preview; la ruta retirada respondió 404. B7 no requiere cambios de Supabase. Producción no fue modificada.

## Pendientes de aceptación de B7

1. En el hotel de prueba, abrir Mantenimiento y confirmar que listado, modal, workflow, métricas y calendario cargan desde la cadena canónica.
2. Crear o editar una tarea y verificar que el flujo móvil vigente conserva su comportamiento.
3. Solicitar aprobación explícita antes de promover estos assets a producción.

## Qué falta después de B7

B7 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B8: reemplazar el vocabulario legado del selector de estado en el modal base de Mantenimiento por el contrato canónico que hoy impone la capa superior.

## B8 — estado canónico en el modal base de Mantenimiento

`mantenimiento-mobile-ui.js` ahora normaliza el estado actual con `normalizeTaskState`, muestra la etiqueta canónica en un selector de solo lectura y envía un único campo oculto `estado` con ese valor. El formulario ya no contiene las opciones heredadas `en_progreso`, `completada` y `cancelada`. El guardado conserva el valor canónico y reconoce `TASK_STATES.cerrado` para los metadatos de finalización y las notificaciones.

`mantenimiento-workflow-ui.js` dejó de reemplazar y deshabilitar el selector después del render. Las transiciones continúan exclusivamente en los botones del workflow y en `mantenimiento_transicionar_tarea`; editar título, prioridad, responsable u otros datos no permite elegir un estado arbitrario. `tests/b8-maintenance-canonical-state-field.test.cjs` fija estos contratos y la regresión existente de Fase 3 ahora los comprueba en la capa base.

El bloque enfocado de Mantenimiento terminó en 30/30, la suite completa en 739/739 y la sintaxis se validó en 306 archivos. El build, el preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6407 nodos, 12329 aristas y 509 comunidades.

El preview protegido `https://gestiondehotel-aoqhydbfn-cararegoms-projects.vercel.app` (`dpl_85GhY22r5y1UvbCUd4mWs7F1vufR`) quedó `READY`, sin `productionUrl`. Las descargas autenticadas respondieron 200 y confirmaron coincidencia SHA-256 exacta de `mantenimiento-mobile-ui.js` (`2793c2a0506659f93bd336d2c5ef053ae55ab7764c9bdd136195697db2776a0f`) y `mantenimiento-workflow-ui.js` (`589d739a1db274a645fcc0b5d62a5ae15e0f29b4f5d78aa366abaf51f602ef8e`). B8 no requiere cambios de Supabase. Producción no fue modificada.

## Pendientes de aceptación de B8

1. En el hotel de prueba, abrir una tarea en cada estado canónico disponible y confirmar que el modal muestra su etiqueta correcta y no permite cambiarla desde el formulario general.
2. Editar datos no operativos y comprobar que el estado y los metadatos de cierre permanecen intactos.
3. Ejecutar una transición desde los botones del workflow y confirmar que el historial registra el cambio.
4. Solicitar aprobación explícita antes de promover estos assets a producción.

## Qué falta después de B8

B8 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B9: eliminar el fallback local `America/Bogota` del calendario de Mantenimiento y usar el contrato central de zona horaria del hotel con fallo visible cuando falte configuración válida.

## B9 — zona horaria obligatoria en el calendario de Mantenimiento

`hotelTimeZoneService.js` incorpora `loadRequiredHotelTimeZone()`, que consulta `configuracion_hotel` por el hotel activo, valida que `zona_horaria` sea una zona IANA y solo entonces actualiza el contexto horario central. A diferencia del cargador general compatible con datos antiguos, esta ruta no inventa Bogotá cuando el calendario necesita una fecha operativa confiable.

`mantenimiento-calendario-ui.js` espera esa carga antes de inicializar el mes y calcula “hoy” con `getTodayInTimeZone(getRuntimeHotelTimeZone())`. Se retiraron el acceso directo a `window.hotelConfigGlobal`, el literal `America/Bogota` y el fallback a `new Date().toISOString()`. Una configuración ausente, inválida o no accesible produce un mensaje visible dentro del calendario y retorna sin bloquear las demás superficies de Mantenimiento.

`tests/b9-maintenance-calendar-timezone.test.cjs` ejecuta el cargador estricto con una zona ausente, una inválida y `America/Mexico_City`, además de fijar la integración y el estado de error. El bloque enfocado de calendario/timezone terminó en 17/17, la suite completa en 742/742 y la sintaxis se validó en 307 archivos. El build, el preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6422 nodos, 12353 aristas y 513 comunidades.

El preview protegido `https://gestiondehotel-8cwzgpgj5-cararegoms-projects.vercel.app` (`dpl_C9ZEN5XdZwrJtALQ3X36VC2j4hVF`) quedó `READY`, sin `productionUrl`. Las descargas autenticadas respondieron 200 y confirmaron coincidencia SHA-256 exacta de `mantenimiento-calendario-ui.js` (`6c76a049e6dab83020439a670610cebc5acf214718da1c1ec58c46a41c025e4e`) y `hotelTimeZoneService.js` (`d9052172e52fe66185fc3ec59ffc43d3f77f973322a2a01a79f5313c88b4d914`). B9 no requiere migración ni modifica datos de Supabase. Producción no fue modificada.

## Pendientes de aceptación de B9

1. En un hotel de prueba con una zona distinta de Bogotá, abrir Mantenimiento cerca del cambio de día y confirmar que “Hoy” corresponde a la fecha operativa del hotel.
2. Retirar temporalmente la zona en un entorno desechable y confirmar que solo el calendario muestra el error de configuración.
3. Restaurar una zona IANA válida y comprobar que el calendario vuelve a cargar el mes correcto.
4. Solicitar aprobación explícita antes de promover estos assets a producción.

## Qué falta después de B9

B9 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B10: hacer que la fecha impresa en el corte de Caja use la zona operativa del hotel en lugar de la hora local del navegador.

## B10 — fecha operativa en la impresión del corte de Caja

`caja-cierre.js` dejó de llamar `new Date().toLocaleString()` sin zona. La fecha que recibe `imprimirCorteCajaAdaptable()` ahora se forma mediante `formatInTimeZone(new Date(), getRuntimeHotelTimeZone(), 'es-CO', { dateStyle: 'full', timeStyle: 'medium' })`, reutilizando la misma fuente horaria central del resto de la aplicación. El cambio afecta únicamente la presentación del ticket; no altera montos, movimientos ni el cierre del turno.

`tests/b10-caja-print-timezone.test.cjs` fija la integración y ejecuta el formateador con un mismo instante en Bogotá y Madrid, confirmando que cada hotel imprime su fecha correspondiente. El bloque enfocado de Caja/timezone terminó en 8/8, la suite completa en 744/744 y la sintaxis se validó en 308 archivos. El build, el preflight de Vercel y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6433 nodos, 12368 aristas y 511 comunidades.

El preview protegido `https://gestiondehotel-pvx7xm8rq-cararegoms-projects.vercel.app` (`dpl_J1KomHKer7KtuwbG3Ym6e76GiKmR`) quedó `READY`, sin `productionUrl`. La descarga autenticada respondió 200 y confirmó coincidencia SHA-256 exacta de `caja-cierre.js` (`115d42464af79fc683aec8834e407e0a0e3d36d2c3b7f8e7662e78bcb9e547fc`) entre el repositorio y el preview. B10 no requiere cambios de Supabase. Producción no fue modificada.

## Pendientes de aceptación de B10

1. En un hotel de prueba con una zona distinta a la del dispositivo, generar la vista previa del corte y confirmar la fecha/hora del hotel.
2. Imprimir en formato térmico y carta para comprobar que el texto conserva el diseño.
3. Solicitar aprobación explícita antes de promover el asset a producción.

## Qué falta después de B10

B10 queda corregido y verificado técnicamente. El siguiente hallazgo bajo es B11: confirmar que las funciones en memoria de `idempotency.ts` no tienen consumidores y retirar ese código muerto sin afectar la idempotencia persistente de pagos bancarios.

## B11 — retiro de deduplicación en memoria sin consumidores

La búsqueda completa confirmó que `gmailMessageDeduplicationKey` e `isDuplicateGmailMessage` solo eran invocados por una prueba histórica y no participaban en ninguna Edge Function. Se retiraron ambos exports y la prueba pasó a cubrir la huella secundaria que sí usa `payment-service.ts`. `idempotency.ts` permanece porque `transferFingerprint` sigue formando parte del análisis bancario.

La protección real no cambió: `findExistingDuplicate()` consulta `bank_payment_events` por `hotel_id + gmail_message_id`, la base conserva `bank_payment_events_message_key UNIQUE (hotel_id, gmail_message_id)` y la bandeja Pub/Sub exige `pubsub_message_id UNIQUE`. `tests/b11-bank-email-dead-idempotency.test.cjs` fija la ausencia de los helpers muertos, el consumidor de `transferFingerprint` y las barreras persistentes.

El bloque bancario enfocado terminó en 40/40, la suite completa en 747/747 y la sintaxis se validó en 309 archivos. `deno check`, `deno lint` y `git diff --check` terminaron correctamente. `graphify update .` reconstruyó el grafo con 6.440 nodos, 12.373 relaciones y 512 comunidades. No hubo migración ni cambio de frontend.

En Supabase staging `vyzscuzgjdhrhzctmsuv`, `bank-email-api` quedó en v12 `ACTIVE` con `verify_jwt=true`; `gmail-webhook` en v8 y `gmail-watch-renew` en v5, ambas `ACTIVE` con `verify_jwt=false` según su autenticación específica. Una solicitud remota sin credenciales a `bank-email-api` recibió 401. Producción no fue modificada.

## Qué falta después de B11

B11 queda corregido y verificado técnicamente. El último hallazgo bajo es B12: revisar el archivo de video ubicado en código y el `.rar` señalado por la auditoría, confirmar si tienen consumidores o valor documental y limpiar únicamente el ruido comprobado.

## B12 — limpieza de artefactos sin consumidores

La revisión corrigió dos imprecisiones del diagnóstico original. `gestion de tales.rar` sí estaba versionado, aunque Vercel lo excluía, y no había un único video local: `Tienda.mp4`, su copia idéntica y `Restaurante.mp4` ocupaban espacio dentro de la carpeta de código. La búsqueda completa confirmó que `faq.js` usa URLs de Google Drive para reproducir los tutoriales y conserva únicamente miniaturas PNG locales; ningún MP4 tenía consumidores.

Se retiraron los tres videos y el respaldo comprimido, 254,68 MiB en total, del árbol activo. Los objetos permanecen recuperables mediante el historial de Git. `.gitignore` excluye `*.rar` y copias de video con el patrón observado; `.vercelignore` excluye cualquier RAR o MP4 del módulo FAQ como segunda barrera. `tests/b12-repository-noise.test.cjs` verifica la ausencia de estos artefactos, el contrato remoto del FAQ y ambos controles de exclusión.

## Estado al cerrar B12

El bloque enfocado terminó en 3/3 pruebas, la suite completa en 750/750 y la sintaxis se validó en 310 archivos. El build, el preflight de Vercel y los controles de exclusión terminaron correctamente. `graphify update .` reconstruyó el grafo con 6.450 nodos, 12.382 relaciones y 517 comunidades. B12 cierra el último hallazgo bajo de la matriz y no requirió migración ni modificó Supabase.

El preview protegido `https://gestiondehotel-b4n3onyoc-cararegoms-projects.vercel.app` (`dpl_DEPCunWVpyN6vjepbHBLhBiCKkN7`) quedó `READY`, con destino `preview` y sin `productionUrl`. La lectura autenticada confirmó que `faq.js` responde 200 y que las cuatro rutas retiradas responden 404. Producción no fue modificada.

## Estado global después de B12

Todos los hallazgos catalogados C1–C7, A3–A18, M1–M17 y B1–B12 tienen corrección o control verificable. Permanecen fuera de este cierre las pruebas manuales en el hotel de ensayo, la aprobación y promoción a producción, y la decisión de emprender los refactors arquitectónicos A1/A2 descritos en la Fase 4.
