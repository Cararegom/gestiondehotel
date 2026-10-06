# Auditoría integral 2026 — 11. Observabilidad, manejo de errores y performance

Alcance: revisión estática de código (sin acceso en vivo a Supabase ni a Sentry).
Metodología: `graphify query` para ubicar módulos/comunidades relevantes (caja, reservas,
pagos-bancarios, mapa-habitaciones, reportes), seguido de lectura directa de cada archivo
citado para confirmar el hallazgo línea por línea. Todo lo reportado abajo es **EXTRACTED**
(verificado abriendo el archivo real), no inferencia del grafo.

---

## PARTE A — Observabilidad y manejo de errores

### Contexto: cómo está configurado Sentry hoy

`docs/sentry.md` + `js/telemetry/sentry-client.js` confirman:

- El SDK (`@sentry/browser`) se carga en landing, login, dashboard, tienda-web y menú público.
- Captura automática de excepciones no controladas y promesas rechazadas no controladas
  (`unhandledrejection`), con muestreo de trazas del 10 %.
- **Los breadcrumbs de consola están explícitamente desactivados**:
  `js/telemetry/sentry-client.js:182` → `sdk.breadcrumbsIntegration({ console: false, dom: false })`,
  y `sanitizeBreadcrumb` (línea 70) además descarta cualquier breadcrumb cuya categoría empiece
  por `console` o `ui.` aunque se colara.
- Existe una API manual de reporte: `globalThis.HotelMonitoring?.captureException(error)`.

**Consecuencia directa y verificada:** cualquier `console.error()`/`console.warn()` usado como
manejo de error dentro de un `try/catch` **nunca llega a Sentry** — ni como evento, ni como
breadcrumb de contexto en un evento posterior. Si el error no vuelve a lanzarse (`throw`) para
que lo capture el handler global de `unhandledrejection`, es invisible para el equipo.

### Hallazgo A-1 (HIGH) — Los módulos críticos (caja, reservas) casi nunca usan `HotelMonitoring.captureException`; dependen de `console.error` que Sentry ignora

**Estado posterior al corte (A9, 2026-09-12): corregido y probado para `reservas/*` y `caja/*`.** El helper central `js/services/handledErrorReporter.js` genera excepciones con códigos estables de dominio/operación, llama a `HotelMonitoring.captureException` con respaldo de `HotelTelemetry` y no copia mensajes, payloads, montos ni identificadores del error original. Los fallos operativos que quedaban en `console.error` y los `catch` degradables relevantes de ambos dominios usan ahora ese helper. Los avisos esperados que permanecen en consola son estáticos y no contienen datos de reserva, huéspedes, turnos o movimientos. El alcance de A9 definido en el plan no modifica todavía `pagos-bancarios`.

Evidencia cuantitativa (grep sobre el árbol real):

- `js/modules/reservas/*.js`: 46 usos de `console.error`, **0** usos de `captureException`.
- `js/modules/caja/*.js`: 4 usos de `console.error`, **0** usos de `captureException`.
- `js/modules/pagos-bancarios/pagos-bancarios.js`: múltiples `catch (error)` con solo
  `console.warn(...)` (p. ej. línea 455 `'[Pagos bancarios] No se pudo refrescar el saldo de
  reservas.'`, línea 852, línea 1083 `'La verificacion autoritativa fallo; acceso cerrado.'`).
- En todo `js/modules/`, `captureException`/`HotelMonitoring` solo se usan en
  `js/modules/control-energia/control-energia.js` y `js/main.js`.

Ejemplos concretos donde un fallo real de negocio queda solo en la consola del navegador del
usuario (nadie en el equipo se entera salvo que el usuario reporte el problema):

- `js/modules/reservas/reservas.js:2001-2006` — si el RPC `incrementar_uso_descuento` falla tras
  editar una reserva, solo se hace `console.error("Advertencia: No se pudo incrementar el uso del
  descuento...", rpcError)`. El contador de uso del descuento queda desincronizado de forma
  silenciosa y permanente; nadie lo audita.
- `js/modules/reservas/reservas.js:1990-1996` — si falla la actualización del estado de la nueva
  habitación al mover una reserva, solo `console.error(...)`; la habitación puede quedar en un
  estado inconsistente con la reserva.
- `js/modules/pagos-bancarios/pagos-bancarios.js:1082-1083` — fallo de la verificación
  "autoritativa" de acceso al piloto bancario: se cierra el acceso pero solo se deja constancia en
  `console.warn`, sin evento en Sentry que permita saber cuántas veces/para quién ocurre.

**Contraste con lo bien hecho:** `js/modules/control-energia/control-energia.js:28-35` define un
helper `reportError(code, error)` que trunca y sanea el mensaje y llama a
`globalThis.HotelMonitoring?.captureException(...)`. Es el único módulo de negocio que reporta
activamente a Sentry sus errores capturados. **Recomendación:** extraer este helper a
`js/uiUtils.js` o `js/services/` y adoptarlo en `caja/`, `reservas/`, `pagos-bancarios/` en cada
`catch` que hoy termina solo en `console.error`/`console.warn`.

**Severidad:** HIGH — no es un bug funcional inmediato, pero significa que la telemetría de
errores del negocio más sensible (dinero, disponibilidad de habitaciones) es prácticamente ciega
salvo que el error escale a excepción no controlada.

### Hallazgo A-2 (HIGH) — Validación de cruce de reservas: si el RPC falla, el conflicto se ignora y la reserva se crea igual

**Estado posterior al corte (A10, 2026-09-12): corregido y probado.** La validación compartida ahora exige una respuesta booleana válida del RPC. Un error devuelto por Supabase, una excepción de red o una respuesta ambigua bloquean el guardado, reportan `reservas.booking_conflict_validation_failed` y muestran un mensaje seguro para reintentar. Un cruce real conserva el error de conflicto y tampoco permite crear o actualizar la reserva. Las rutas activa y legada consumen el mismo helper; producción no fue modificada.

`js/modules/reservas/reservas-calculos.js:264-277`:

```js
try {
  const { data: hayCruce } = await state.supabase.rpc('validar_cruce_reserva', {
    p_habitacion_id: formData.habitacion_id,
    p_entrada: fechaEntrada.toISOString(),
    p_salida: fechaSalida.toISOString(),
    p_reserva_id_excluida: state.isEditMode ? state.editingReservaId : null
  });

  if (hayCruce === true) {
    throw new Error('Conflicto: La habitacion NO esta disponible para estas fechas.');
  }
} catch (error) {
  console.warn('Validacion de cruce RPC omitida o fallida:', error.message);
}
```

Dos problemas reales:

1. No se destructura `error` de la respuesta del RPC. Si Supabase devuelve `{ data: null, error }`
   (fallo de red, RPC caído, timeout), `hayCruce` es `undefined`, la condición `hayCruce === true`
   es falsa, **no se lanza excepción**, y el flujo continúa como si la habitación estuviera libre.
2. El único `catch` que sí atraparía un `throw` explícito de error de red termina en
   `console.warn` — la operación de guardado de la reserva sigue adelante igualmente.

**Escenario real:** una caída momentánea de red o un timeout de PostgREST durante la validación de
cruce hace que dos reservas se creen para la misma habitación en fechas solapadas, sin que el
usuario ni el sistema se enteren del fallo de validación. Esto es justo el tipo de bug que "la
operación parece exitosa" que se pidió identificar.

**Corrección propuesta:** destructurar `error` explícitamente y, si existe, **bloquear** la
creación (fail-closed) en lugar de dejarla pasar, mostrando al usuario que no se pudo verificar
disponibilidad y debe reintentar. Reportar el fallo con `captureException`.

**Severidad:** HIGH (impacto en integridad de datos operativos: doble reserva de habitación).

### Hallazgo A-3 (MEDIUM) — Reporte de ocupación silencia truncamiento de datos sin decírselo al usuario (ver también B-1)

**Estado posterior al corte (A11, revalidado como M11 el 2026-09-30): corregido y probado.** Ocupación consume ahora todas las páginas de reservas con un orden estable y rechaza errores o respuestas ambiguas antes de calcular y renderizar porcentajes. El mismo cierre se aplicó al resto de fuentes voluminosas descritas en B-1. La revalidación confirmó 20 consultas paginadas con 20 órdenes secundarios por `id`, cuatro fuentes KPI paginadas y el asset vigente en preview.

Relacionado con el hallazgo de performance B-1 más abajo: cuando una consulta de reportes se trunca
en 1000 filas por el límite por defecto de PostgREST, no hay `error` (la consulta es "exitosa"),
por lo que el reporte se renderiza con normalidad pero con cifras incompletas. Desde la perspectiva
de "operación falla pero la interfaz parece exitosa", este es el caso más insidioso de todos:
no hay excepción, no hay mensaje de error, solo un número equivocado que un gerente puede usar para
tomar decisiones. Ver B-1 para el detalle técnico y archivos afectados.

**Severidad:** MEDIUM-HIGH (silenciosamente afecta la confiabilidad de reportes financieros/KPIs).

### Hallazgo A-4 (LOW) — `unmount()` de `reservas.js` desmonta de forma inconsistente respecto a `mount()`

`js/modules/reservas/reservas.js:3214-3243` (`unmount`) solo hace `removeEventListener` explícito
para `ui.form` (submit) y `ui.reservasListEl` (click), y `document.removeEventListener('datosActualizados', ...)`.
Sin embargo `mount()` (líneas ~3118-3198) registra más de 15 listeners adicionales
(`ui.waitlistListEl`, `ui.pricingRuleForm`, `ui.pricingRulesPanel`, `ui.reservasFiltrosForm`,
inputs de filtros, etc.) que `unmount()` nunca remueve explícitamente.

En la práctica esto **no es una fuga de memoria activa** siempre que el router reemplace por
completo el `innerHTML` del contenedor del módulo en cada navegación (los nodos DOM y sus
listeners se recolectan junto con el nodo). Pero es inconsistente con el patrón correcto que sí
usan `caja.js` (arreglo `moduleListeners` + `forEach(removeEventListener)`, líneas 41, 517-518,
762-766) y `pagos-bancarios.js` (`addListener`/`cleanupListeners`, líneas 57-63, 1120). Si en el
futuro se reutiliza el contenedor sin recrearlo, o si `renderReservas()` re-renderiza sub-secciones
sin volver a pasar por `mount()`, esto sí generaría listeners duplicados.

**Corrección propuesta:** migrar `reservas.js` al mismo patrón `moduleListeners`/`addListener` que
ya usan `caja.js` y `pagos-bancarios.js`, por consistencia y para blindar contra refactors futuros.

**Severidad:** LOW (riesgo latente, no confirmado como fuga activa hoy).

### Lo que está bien diseñado (Parte A)

- **Filtrado de datos sensibles en Sentry** (`js/telemetry/sentry-client.js`): se redactan URLs,
  patrones de credenciales/correos/IDs, y se excluyen cookies, cabeceras, cuerpos de petición y
  datos de usuario — alineado con la regla de no exponer datos de huéspedes.
- **`registrarEnBitacora`** (`js/services/bitacoraservice.js:22-48`) nunca relanza el error: un
  fallo al escribir la bitácora de auditoría no aborta la operación principal (crear/editar
  reserva, cobro, etc.), que es el comportamiento correcto — un log de auditoría no debe bloquear
  el negocio.
- **`control-energia.js`** tiene el único helper reutilizable de reporte a Sentry
  (`reportError`, líneas 28-35) — patrón candidato a generalizar al resto de módulos (ver A-1).
- **`caja.js`** y **`pagos-bancarios.js`** manejan sistemáticamente `{ data, error }` en sus RPCs
  de dinero (`registrar_movimiento_caja_atomico`, `abrir_turno_con_apertura`,
  `cerrar_turno_con_arqueo`, `revertir_movimiento_caja`, `actualizar_metodo_pago_caja`) y siempre
  muestran `showError`/`showSuccess` al usuario — no se detectaron flujos de caja que ignoren el
  `error` del RPC.
- **`procesarPagoReservaAtomico`** (`js/services/fase1OperationService.js:21-39`) relanza (`throw`)
  cualquier error del RPC en vez de tragarlo, y además implementa idempotencia de cliente
  (`getStableOperationId`/`completeStableOperation` con `sessionStorage`) para evitar
  doble-cobro si el usuario reintenta tras un fallo de red — buen diseño defensivo.

---

## PARTE B — Performance

### Hallazgo B-1 (HIGH) — La mayoría de reportes NO paginan y pueden truncarse silenciosamente en 1000 filas

**Estado posterior al corte (A11, 2026-09-13): corregido y probado.** La paginación se extrajo a `js/services/supabasePaginationService.js` y se aplicó a las 20 lecturas voluminosas de Reportes, incluidas las cuatro fuentes de datos de KPI, las nueve del comparativo gerencial, ocupación, historial y detalle de cierres, e ingresos por habitaciones. Cada consulta usa orden estable y el helper deja de devolver resultados parciales ante errores, respuestas inválidas o un corte local arbitrario. El frontend se verificó en preview; producción no fue modificada.

`js/modules/reportes/reportes.js` define un helper correcto y documentado:

```js
// líneas 189-224
/**
 * Obtiene todos los registros de una consulta de Supabase utilizando paginación.
 * Maneja automáticamente el límite de 1,000 filas por consulta.
 */
async function fetchAllWithPagination(queryBuilder) { ... while(true) { .range(from, from+999) ... } }
```

Los propios desarrolladores documentaron que conocen el límite por defecto de PostgREST/Supabase
(1000 filas por página). Sin embargo, de los **9 tipos de reporte** ofrecidos en el selector
(línea ~228), solo **3 funciones** usan `fetchAllWithPagination`:

- `generarReporteListadoReservas` (línea 313) ✔
- `generarReporteIngresosPorPeriodo` (línea 507, vía `generarReporteIngresosTerraza`) ✔
- `generarReporteFinancieroGlobal` (línea 800) ✔

Los siguientes **hacen `.select()` directo sin `.range()` ni el helper**, quedando expuestos a que
Supabase les devuelva como máximo 1000 filas sin lanzar `error` (la consulta "tiene éxito" con
datos incompletos):

- **`fetchKPIData`** (`reportes.js:1397-1420`, usado por "KPIs de Rendimiento del Hotel"): 5
  consultas en `Promise.all` sobre `reservas`, `caja`, `detalle_ventas_tienda`,
  `servicios_x_reserva` filtradas solo por rango de fechas, sin `.range()`/`.limit()`. Para un
  hotel con alta rotación y un periodo largo (ej. "todo el año"), los ingresos totales, el número
  de reservas y el consumo de servicios pueden truncarse a 1000 filas cada uno, produciendo KPIs
  incorrectos sin ningún indicio visual de que faltan datos.
- **`generarReporteOcupacion`** (`reportes.js:918-968`): `.from('reservas').select(...)` sin
  paginar — en hoteles con muchas habitaciones/reservas y periodos largos, el cálculo de
  ocupación por día puede excluir reservas más allá de la fila 1000.
- **`generarReporteCierresDeCaja`** (`reportes.js:1282-1296`): igual, sin paginar.
- **`generarReporteComparativoGerencial`** (`reportes.js:1674-1714` y siguientes): 9 consultas en
  paralelo (`reservas`, `caja` actual y periodo anterior, `lista_espera_reservas`, reglas,
  inspecciones, mantenimiento), ninguna paginada — es el reporte más pesado y el más expuesto al
  truncamiento, ya que compara dos periodos completos.

**Por qué es "silencioso":** al no exceder ningún límite que Supabase reporte como `error`, el
`try/catch` de cada función nunca se activa; el reporte se renderiza con normalidad y solo un
análisis manual del conteo de filas revelaría el problema. Esto conecta directamente con A-3.

**Corrección propuesta:** envolver las 4 funciones señaladas (o al menos sus consultas de mayor
volumen: `reservas` y `caja`) con `fetchAllWithPagination`, o mover los cálculos agregados
(sumas, conteos, promedios) a funciones/RPCs de PostgreSQL (`SUM()`, `COUNT()`, agregaciones por
fecha) para no traer filas crudas al cliente en absoluto — esto también reduce el payload de red
para reportes de periodos largos.

**Severidad:** HIGH (impacto directo en confiabilidad de datos financieros/gerenciales para
hoteles con volumen medio-alto; no requiere que nada "se rompa" para producir cifras erróneas).

### Hallazgo B-2 (MEDIUM) — N+1 al reconciliar estados de habitación en el mapa

> **Estado al 2026-09-30:** corregido y probado como M12. La reconciliación se extrajo a
> `operational-room-state-sync.js`, agrupa las habitaciones por estado operativo y ejecuta un
> `UPDATE ... IN (...)` por grupo, siempre aislado por `hotel_id`. El mapa pasa de N peticiones a
> un máximo de dos (`ocupada` y `tiempo agotado`). Solo confirma en memoria los IDs devueltos por
> Supabase; errores, respuestas ambiguas y filas omitidas permanecen pendientes para reintento.
> La suite M12 cubre lotes, aislamiento por hotel y fallos parciales; no requiere migración.

`js/modules/mapa-habitaciones/mapa-habitaciones.js:184-212` (`syncOperationalRoomStates`):

```js
const results = await Promise.all(corrections.map((room) => (
  supabase.from('habitaciones').update({ estado: room.estado }).eq('hotel_id', hotelId).eq('id', room.id)
)));
```

Por cada habitación cuyo estado operativo calculado en cliente difiere del guardado en BD
(`needsOperationalResync`), se dispara **una petición HTTP independiente** a Supabase. Están en
paralelo (`Promise.all`), lo que mitiga la latencia total, pero sigue siendo N round-trips donde
podría ser 1 (por ejemplo, agrupando por `estado` destino y usando `.in('id', [...])` para cada
grupo, o un RPC único que reciba un array de `{id, estado}` y haga un `UPDATE ... FROM unnest(...)`
atómico). En un hotel con muchas habitaciones que cruzan a "tiempo agotado" simultáneamente (p. ej.
al filo de la hora de checkout), esto puede generar decenas de peticiones simultáneas al recargar
el mapa.

**Corrección propuesta:** agrupar `corrections` por `estado` objetivo y hacer un `.update(...).in('id', idsDelGrupo)` por grupo (como máximo tantas peticiones como estados distintos, normalmente 1-3), o mejor, mover la reconciliación a un RPC `sync_room_states(hotel_id, corrections jsonb)`.

**Severidad:** MEDIUM (acotado en volumen típico — número de habitaciones que necesitan
reconciliación simultánea suele ser bajo — pero el patrón es incorrecto y escala mal).

### Hallazgo B-3 (MEDIUM) — Polling global de 500 ms corriendo indefinidamente sin mount/unmount, con consulta ineficiente por fila

> **Estado al 2026-09-30:** corregido y probado como M13. El modal de cuenta emite
> `mapaAccountModalRendered` con el `reservationId` que ya conoce; el complemento de fechas se
> monta y desmonta con el mapa, cancela resultados obsoletos y consulta directamente servicios y
> pagos por `hotel_id` + `reserva_id`. Se eliminaron el `setInterval` de 500 ms, el
> `MutationObserver` global, la búsqueda del modal por DOM/texto y las consultas intermedias a
> `habitaciones` y `reservas`. El asset dejó de cargarse globalmente desde `app/index.html`.

`js/mapa-fechas-abonos-inline.js`:

- Líneas 239-260 (`startReliableWatcher`): al cargar el script se arma un `setInterval(...,
  500)` (`POLL_MS = 500`, línea 7) **más** un `MutationObserver` sobre `document.body` con
  `subtree: true`, ambos sin ningún `unmount()`/`clearInterval` en el resto del archivo. No es un
  módulo con ciclo de vida `mount()/unmount()` como los demás — se auto-inicia una sola vez al
  cargar la página (líneas 255-261) y permanece activo durante toda la sesión del usuario,
  independientemente de qué módulo esté realmente activo.
- `resolveRoom` (líneas 142-151): para localizar la habitación por nombre, trae **todas** las
  filas de `habitaciones` del hotel (`select('id, nombre').eq('hotel_id', hotelId)`, sin filtrar
  por nombre) y filtra en JavaScript (`.find(...)`) — en vez de `.eq('nombre', roomName)` o
  `.ilike('nombre', roomName)` en la propia consulta.

En la práctica el impacto está parcialmente mitigado: `patchVisibleAccountModal` solo dispara
consultas a Supabase cuando hay un modal de cuenta visible en el DOM (`getVisibleAccountModal`,
líneas 40-47) y además hay un throttle de 1.2 s por modal (`RETRY_MS`, línea 6, línea 209). Aun
así, el `setInterval` de 500 ms hace `querySelectorAll` sobre el DOM completo de forma perpetua
incluso cuando no hay ningún modal ni el usuario está en el módulo de reservas/mapa, y el
`MutationObserver` sobre `document.body` reacciona a cualquier mutación del DOM de toda la SPA.

**Corrección propuesta:** (a) filtrar la habitación en la propia consulta SQL en vez de traer
todas y filtrar en cliente; (b) atar el ciclo de vida de este watcher al `mount()/unmount()` del
módulo de mapa/reservas en lugar de dejarlo corriendo para toda la vida de la pestaña, o al menos
pausar el `setInterval` cuando `document.hidden` es `true` (patrón que sí usan `notificaciones.js`
línea 309 y otros pollers del proyecto).

**Severidad:** MEDIUM (overhead de CPU/DOM constante y de bajo impacto individual, pero es un
patrón que contrasta con el resto del código, que sí limpia sus timers).

### Hallazgo B-4 (LOW) — Timers/listeners: en general bien gestionados

Se revisaron los 8 archivos del proyecto que usan `setInterval` (`js/sentry-browser.js`,
`js/modules/mantenimiento/mantenimiento-analytics-ui.js`, `js/mapa-fechas-abonos-inline.js`,
`js/user-active-session-guard.js`, `js/modules/pagos-bancarios/pagos-bancarios.js`,
`js/modules/notificaciones/notificaciones.js`, `js/modules/mapa-habitaciones/cronometro-habitacion.js`,
`js/modules/cronometros/cronometros.js`). Con la única excepción de B-3, todos:

- Guardan el `intervalId` en una variable/mapa a nivel de módulo.
- Lo limpian explícitamente antes de crear uno nuevo (evita duplicados en remount) — ver
  `js/modules/cronometros/cronometros.js:46,61,92`, `js/modules/mapa-habitaciones/cronometro-habitacion.js:21,33,105,139`.
- `js/modules/notificaciones/notificaciones.js:198,319` limpia el poll timer tanto al re-inicializar
  la campanita como en `desmontarCampanitaGlobal()`, y además pausa el refresh cuando
  `document.hidden` (línea 309) — buen patrón, candidato a replicar en B-3.

**Severidad:** informativo / sin acción — se documenta para mostrar que el patrón correcto ya
existe en el proyecto y solo falta aplicarlo de forma consistente.

### Lo que está bien optimizado (Parte B)

- **`js/modules/mapa-habitaciones/mapa-habitaciones.js:336-393`** (`fetchRoomsMapData`): cero N+1.
  Trae `habitaciones` y `reservas` en paralelo con `Promise.all`, filtra por `hotel_id` +
  `.in('estado', estadosMapa)`, y luego trae el historial de artículos prestados con **una sola**
  consulta `.in('reserva_id', reservaIds)` para todas las reservas relevantes, en vez de una
  consulta por reserva. Es el ejemplo a seguir para el resto del código.
- **`js/modules/reportes/reportes.js:322-328`**: al resolver nombres de métodos de pago para el
  listado de reservas, usa `.in('id', metodoPagoIds)` con IDs deduplicados
  (`[...new Set(...)]`) en lugar de una consulta por reserva — patrón correcto de "agrupar antes
  de consultar".
- **`fetchAllWithPagination`** (`reportes.js:195-224`) en sí es una implementación correcta y
  seguro (con cota de 50 000 filas para evitar loops infinitos); el problema no es la función sino
  que falta aplicarla de forma consistente (ver B-1).
- **Limpieza de listeners en `mount()/unmount()`** de `caja.js` (patrón `moduleListeners` array)
  y `pagos-bancarios.js` (patrón `addListener`/`cleanupListeners`) y de `mapa-habitaciones.js`
  (`attachRefreshListener` remueve el listener previo antes de añadir uno nuevo, líneas 214-239,
  y `unmount()` línea 471-473 lo remueve también) — sin duplicación de listeners detectada en
  estos tres módulos centrales.

---

## Resumen de severidades

| ID | Hallazgo | Severidad |
|----|----------|-----------|
| A-2 | Validación de cruce de reservas ignora fallos del RPC y deja crear la reserva igual | HIGH |
| B-1 | Reportes (KPIs, ocupación, cierres de caja, comparativo gerencial) sin paginar, truncan a 1000 filas sin error | HIGH |
| A-1 | Módulos de caja/reservas/pagos-bancarios casi no reportan a Sentry; dependen de `console.error` que el propio SDK ignora | HIGH |
| A-3 | Truncamiento de reportes es indetectable para el usuario (relacionado con B-1) | MEDIUM-HIGH |
| B-2 | N+1 al reconciliar estados de habitación en el mapa (`syncOperationalRoomStates`) | MEDIUM |
| B-3 | Polling global de 500 ms sin ciclo de vida + consulta ineficiente de habitación por nombre | MEDIUM |
| A-4 | `unmount()` de reservas.js inconsistente con el patrón `moduleListeners` de otros módulos | LOW |
| B-4 | Timers en general bien gestionados (informativo) | — |
