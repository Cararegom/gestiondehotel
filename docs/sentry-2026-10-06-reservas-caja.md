# Investigación de Reservas y Caja — 6 de octubre de 2026

## Resultado y alcance

Se preparó una corrección sobre `main` en `708b1e0f0fe6056b0a62bf8495c749d2c2e6ec61`.
Hay un defecto reproducible en Caja: una caída de la consulta auxiliar de estados bancarios impide mostrar movimientos y totales que ya se cargaron correctamente. Los registros de producción contienen un HTTP 503 de `bank-email-api` a las 22:09:56.811 UTC, coincidente con la incidencia de Caja. La correspondencia con esa llamada es una inferencia respaldada por el orden del flujo; el cuerpo de la petición y el error original del evento de Sentry no están disponibles.

No se confirmó una única causa de backend para los tres avisos. El defecto común confirmado está en `reportHandledError`: recibía el error como tercer argumento, pero lo descartaba. Por eso los eventos antiguos no permiten distinguir un fallo de red, JWT, permisos, SQL o una excepción del navegador.

En Reservas se añadió una recuperación conservadora de lecturas ante fallos de transporte. Esa recuperación está probada con fallos simulados; **no demuestra que los dos eventos históricos de Reservas fueran fallos de red**.

La rama contiene la propuesta y sus regresiones. No se cambió `main`, no se modificó la base de datos y no se promovió una versión a producción.

## Evidencia consultada

| Incidencia | Ruta | Hora UTC indicada | Hora Colombia | Release del correo |
| --- | --- | --- | --- | --- |
| [7777359632](https://gestion-de-hotel.sentry.io/issues/7777359632/) — `reservation_relations_load_failed` | `/reservas` | 19:56 | 14:56 | `4af3c30de17ef611220f4f3644c8573e72375b17` |
| [7777419940](https://gestion-de-hotel.sentry.io/issues/7777419940/) — `reservation_list_load_failed` | `/reservas` | 20:31 | 15:31 | `708b1e0f0fe6056b0a62bf8495c749d2c2e6ec61` |
| [7777578973](https://gestion-de-hotel.sentry.io/issues/7777578973/) — `movements_load_failed` | `/caja` | 22:09 | 17:09 | `708b1e0f0fe6056b0a62bf8495c749d2c2e6ec61` |

Las notificaciones originales se leyeron desde Gmail. El detalle autenticado de Sentry no estuvo accesible en este entorno. También se encontró otra notificación de relaciones de Reservas, [7777686389](https://gestion-de-hotel.sentry.io/issues/7777686389/), en el release `708b1e0`; refuerza que el fallo no se limita al release anterior.

Los registros de Supabase de producción se consultaron entre 19:50 y 23:30 UTC. Para separar el tráfico de la aplicación del tráfico externo se filtró `X-Client-Info = gestiondehotel-web` y el método GET:

| Endpoint de lectura | Respuestas registradas | HTTP |
| --- | ---: | --- |
| `reservas` | 527 | 200 |
| `pagos_reserva` | 284 | 200 |
| `habitaciones` | 297 | 200 |
| `usuarios` | 1449 | 200 |
| `caja` | 36 | 200 |
| `caja_reversiones` | 24 | 200 |
| `detalle_ventas_tienda` | 18 | 200 |

No hubo entradas de `ventas_restaurante_items` para ese filtro y ventana. Un 200 registrado por el servidor no prueba que el navegador recibiera o procesara la respuesta; las peticiones que no llegan al servidor tampoco aparecen aquí.

Los 401 examinados cerca de los avisos correspondían a un crawler con `UNAUTHORIZED_MISSING_API_KEY`, sin identificación del cliente web. No justifican atribuir estas incidencias a una sesión vencida de recepción. Las ocho tablas implicadas conservan RLS habilitado y permiso SELECT para `authenticated`; la autorización efectiva de cada fila depende de sus políticas.

Para Caja, `function_edge_logs` muestra esta secuencia:

| Hora UTC | Servicio | HTTP |
| --- | --- | --- |
| 22:09:56.317 | `bank-email-api` | 200 |
| 22:09:56.811 | `bank-email-api` | 503 |
| 22:10:20.584 | `bank-email-api` | 200 |

El código consulta primero el estado del piloto y luego los estados de movimientos. La segunda consulta estaba fuera de un catch propio: su fallo terminaba en `caja.movements_load_failed`. No se estableció la causa interna del 503 del servicio.

## Comparación del código y de las hipótesis

| Hipótesis | Resultado |
| --- | --- |
| RPC compartido | Las lecturas de lista y relaciones de Reservas usan SELECT; Caja añade llamadas a la Edge Function bancaria. No hay un RPC común en estos puntos. |
| Permisos o RLS | No se registraron fallos HTTP de estas lecturas del cliente web en la ventana consultada. Se verificaron permisos de tabla y RLS; no se alteraron políticas. |
| Sesión | El cliente usa Supabase JS `2.39.7`, sesión persistente y refresco automático. Los 401 examinados eran solicitudes externas sin API key. No se confirmó un defecto de refresco. |
| Consulta SQL o relaciones | Las consultas implicadas alcanzaron HTTP 200. Eso limita, pero no elimina, esta hipótesis; los eventos antiguos no guardaron sus códigos. |
| Cambio reciente | La auditoría integrada incorporó el reporter y la división de consultas. Entre `4af3c30` y `708b1e0`, los cambios de los módulos estudiados son de clases CSS; los servicios de reporte y banca no cambiaron. No hay evidencia que atribuya estos fallos a Tailwind. |
| Dependencia bancaria de Caja | Hay un 503 correlacionado y un punto de fallo reproducible: una consulta auxiliar bloquea toda la lista. |
| Transporte en Reservas | Compatible con la evidencia disponible, pero sin confirmación histórica. Se cubre mediante una mitigación de lectura estrictamente acotada. |

En la misma ventana aparecieron errores de `clientes.cedula` y de permisos de `bitacora`. Son fallos de otros puntos del flujo; no se amplió esta corrección para resolverlos ni se los atribuyó a las tres incidencias sin evidencia.

## Corrección

1. **Caja:** aislar `getBankPaymentCashStatuses` en un catch. Si falla, cargar los movimientos y sus totales, mostrar **Verificación no disponible**, y reportar `caja.bank_cash_statuses_load_failed`. No mostrar `No aplica`, `Confirmado` ni otro estado bancario supuesto.
2. **Lecturas:** `readQueryWithNetworkRetry` reconstruye un SELECT y repite como máximo una vez, tras 150 ms, únicamente ante el formato de fallo de fetch de PostgREST: HTTP 0, código vacío y un mensaje de transporte reconocido. También maneja el TypeError nativo equivalente. No repite JWT, permisos, SQL, HTTP 4xx/5xx, abort ni errores de programación. Solo los puntos de lectura identificados usan este helper.
3. **Relaciones de Reservas:** conservar lotes de 100 y repetir únicamente el lote fallido, sin duplicar pagos ni filas ya acumuladas. Mantener el cliente y el hotel capturados para la consulta de lista.
4. **Diagnóstico:** conservar en el error sintético exclusivamente códigos SQLSTATE/PostgREST validados, el estado HTTP y categorías cerradas de red/abort. No enviar el mensaje, detalles, hint, stack original ni identificadores. El servicio bancario conserva el HTTP de su respuesta fallida para que el reporte distinga un 503.
5. **Prueba de tamaño:** conservar el límite de 3289 líneas de Reservas y aceptar reducciones. La prueba anterior exigía exactamente 3289 y fallaba al extraer el lector de lotes. El módulo quedó en 3276 líneas.

No se modificaron RPC de escritura, cálculos financieros, sesión, roles ni migraciones. Las llamadas POST bancarias no se reintentan.

## Regresiones y resultados

`tests/reservas-caja-read-recovery.test.cjs` ejecuta el cargador real de Caja y la función real de render de Reservas, con respuestas de datos, UI y banca aisladas. Son pruebas de runtime con dependencias simuladas; no una prueba completa en navegador conectado a producción.

| Caso | Comprobación |
| --- | --- |
| Lectura sana | Una ejecución; conserva la respuesta. |
| Red temporal o persistente | Recuperación en el segundo intento o fallo visible tras dos intentos. |
| JWT, permisos, timeout SQL, relaciones, abort y TypeError de programación | Una ejecución; conserva el fallo. |
| 205 reservas en tres lotes | Repite solo el lote fallido; 205 pagos únicos, suma exacta. |
| Lista, habitaciones, pagos y canceladores de Reservas | Recuperación y conservación de abonado, pendiente y relaciones. |
| Caja, detalle de tienda/restaurante y reversiones | Recuperación y conservación de ingresos, egresos, balance y conceptos. |
| Pagos de Reserva inaccesibles | No muestra reservas con abonos o saldos supuestos. |
| Diagnóstico privado | Conserva código/HTTP; descarta campos libres y datos personales; sobrevive al saneamiento de Sentry. |
| Banca HTTP 503 | Caja sigue mostrando movimientos y balance; el estado bancario queda explícitamente no disponible. |
| Guardar y refrescar una reserva | Una creación aunque el SELECT de refresco se ejecute dos veces. |

Validación final:

- Regresiones nuevas: **18/18**.
- En la base anterior, manteniendo el helper nuevo para ejecutar sus pruebas unitarias pero los cargadores y servicios originales, **14 de esas 18 pruebas fallan**. Esto demuestra los cambios de comportamiento de los cargadores y del diagnóstico; no reproduce los eventos históricos con datos reales.
- Bloque enfocado de Caja, Reservas, Sentry y límites: **32/32**.
- Suite completa: **796/796**.
- `npm run check:syntax`: **319 archivos**.
- `npm run check:module-budgets`, `npm run build` y `git diff --check`: correctos.
- `npm audit --audit-level=high`: **0 vulnerabilidades**.
- Consulta de catálogo en producción: RLS y SELECT de las ocho tablas comprobados; sin modificaciones.

`graphify-out/graph.json` no estaba en el checkout y `graphify` no está instalado en este entorno; no se pudo ejecutar su actualización. No se tocaron Edge Functions, por lo que no se repitió su lint/typecheck de Deno.

## Límites y comprobación tras publicar

Esta propuesta corrige el bloqueo reproducible de Caja y un defecto confirmado de diagnóstico. La recuperación de Reservas es una mitigación probada, no una atribución definitiva de los dos eventos antiguos.

Una vez publicado el cambio, verificar en un entorno de pruebas que Caja conserve filas y totales al simular un 503 de la consulta bancaria y que el estado se recupere al recargar con el servicio disponible. Para una nueva incidencia de Reservas, el código/HTTP añadido permitirá decidir entre transporte, autenticación, permisos y SQL. Si el fallo reaparece sin esos diagnósticos, será necesaria una reproducción con el mensaje de pantalla o un registro de red del navegador; los eventos antiguos descartaron ese dato.

No se marcaron las incidencias de Sentry como resueltas ni se afirmó que la propuesta estuviera instalada en producción.

Referencias técnicas: [formato de errores de PostgREST JS 1.9.2](https://github.com/supabase/postgrest-js/blob/v1.9.2/src/PostgrestBuilder.ts), [códigos de PostgREST](https://supabase.com/docs/guides/api/rest/postgrest-error-codes), [changelog de Supabase](https://supabase.com/changelog).
