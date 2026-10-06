# Auditoría — Módulo de Mantenimiento

Fecha: 2026-09-07. Alcance: arquitectura de dominio/repositorio/UI y esquema SQL del módulo de
mantenimiento, evaluada frente a la evolución pedida (recurrencias complejas, vencimientos de
equipos, notificaciones, historial, evidencias, incidencias desde novedades por habitación).

Metodología: lectura de `docs/mantenimiento-fase4*.md`, orientación con `graphify query`, y lectura
directa de todo `js/modules/mantenimiento/*.js` y de las migraciones SQL relevantes en
`supabase/migrations/`. Cada hallazgo cita archivo y línea reales (EXTRACTED). Donde no pude
verificar contra datos en producción (no hay acceso MCP a Supabase), lo marco como INFERRED.

## 0. Corrección importante sobre el estado documentado

Los documentos `docs/mantenimiento-fase4*.md` describen el estado del módulo **hasta Fase 4**
(automatización de SLA/preventivos simples sobre `tareas_mantenimiento.frecuencia`, métricas vía
`mantenimiento_metricas()`). Sin embargo, el código y las migraciones muestran que **ya existe una
Fase 5 no documentada** (migraciones del 2026-09-05, commits recientes), que introduce:

- `mantenimiento_planes` (tabla): programaciones maestras separadas de las ejecuciones, con
  `clase` (`tarea`/`preventivo`/`vencimiento`), `recurrencia_unidad`/`recurrencia_intervalo`,
  `fecha_fin`, `anticipaciones_dias[]`, `requiere_evidencia`, `checklist`, `alcance`
  (`general`/`habitacion`/`todas_habitaciones`).
- `mantenimiento_generar_tareas_planes()` / `mantenimiento_emitir_alertas_planes()` /
  `mantenimiento_calendario_tick()`, orquestados por `pg_cron` cada 15 min
  (`supabase/migrations/20260905130000_mantenimiento_planes_automatizacion.sql`).
- `mantenimiento_tarea_habitaciones`: checklist por habitación para tareas de alcance
  "todas_habitaciones" (revisión general tipo "filtros de aires en todas las habitaciones").
- `mantenimiento_crear_incidencia_desde_habitacion()`: la feature del commit reciente
  "Mantenimiento: crear incidencias desde novedades por habitación".

**Recomendación operativa inmediata**: actualizar `docs/mantenimiento-fase4*.md` o añadir una
Fase 5 documentada; en su estado actual la documentación subestima significativamente lo que el
sistema ya sabe hacer, y quien lea solo esos documentos concluiría (incorrectamente) que faltan
recurrencias complejas y vencimientos — **ya existen**, en el subsistema de planes.

## 1. Nombres reales de archivos (verificado con Glob)

El prompt original mencionaba nombres aproximados. Los reales, en `js/modules/mantenimiento/`:

| Mencionado en el prompt | Archivo real | Rol |
|---|---|---|
| mantenimiento-domain.js | `mantenimiento-domain.js` (existe) | Enums, normalizadores, SLA, orden, tipo/estado |
| mantenimiento-calendario-domain.js | `mantenimiento-calendario-domain.js` (existe) | Motor de recurrencia de **planes** (JS, usado en UI de calendario) |
| mantenimiento-habitaciones-ui.js | `mantenimiento-habitaciones-ui.js` (existe) | Checklist por habitación para planes "todas_habitaciones" |
| mantenimiento-incidencias-ui.js | `mantenimiento-incidencias-ui.js` (existe) | Crear incidencia desde novedad de checklist (feature reciente) |
| mantenimiento-analytics-ui.js | `mantenimiento-analytics-ui.js` (existe) | Métricas + compone calendario + habitaciones-ui |
| mantenimiento-evidencias.js | `mantenimiento-evidencias.js` (existe) | Subida/URL firmada de evidencias en Storage |
| "mantenimiento-repository.js" | `mantenimiento-repository.js` (existe) | Acceso a Supabase (tareas y planes) |
| "mantenimiento-ui.js" | **Corregido en B7:** la versión desktop/anterior, confirmada como código muerto (728 líneas en el árbol corregido), fue retirada; `mantenimiento-mobile-ui.js` permanece en la cadena activa | Ver hallazgo M-1 |
| "mantenimiento-mobile-ui.js" | `mantenimiento-mobile-ui.js` (existe) | Render de tarjetas/tabla + modal CRUD base |
| (no mencionados) | `mantenimiento-workflow-ui.js`, `mantenimiento-preventivo.js`, `mantenimiento-quick-report.js`, `mantenimiento-calendario-ui.js`, `mantenimiento-calendario-google-ui.js`, `mantenimiento.js` | Ver mapa de composición abajo |

### Cadena de montaje real (verificada leyendo imports)

```
mantenimiento.js  (facade pública: mount/unmount/showModalTarea)
 └─ mantenimiento-analytics-ui.js   (métricas, período 30/60/90, arma el layout)
     ├─ mantenimiento-workflow-ui.js   (máquina de estados en UI, SLA, historial, comentarios)
     │   └─ mantenimiento-mobile-ui.js  (listado, tarjetas, modal CRUD base, filtros)
     ├─ mantenimiento-calendario-ui.js         (vista calendario mensual de planes)
     ├─ mantenimiento-calendario-google-ui.js  (vista tipo Google Calendar de planes)
     └─ mantenimiento-habitaciones-ui.js       (checklist por habitación de un plan)
 └─ mantenimiento-incidencias-ui.js  (montado aparte, engancha el botón "Cerrar" y crea incidencias)
```

Cada capa reexporta `mount`/`unmount` de la inferior y le añade comportamiento (patrón decorador).
Es una separación **conceptualmente correcta** (domain puro sin I/O, repository con todo el acceso
a Supabase, UI en capas). Ver más detalle de cómo se logra la composición en el hallazgo H-1.

**Estado posterior B7:** la búsqueda completa del runtime confirmó que `mantenimiento-ui.js` no
tenía imports ni carga directa desde el router. El archivo fue retirado y la cadena activa continúa
por `mantenimiento.js` → `mantenimiento-analytics-ui.js` → `mantenimiento-workflow-ui.js` →
`mantenimiento-mobile-ui.js`.

## 2. Qué está bien resuelto (para no perderlo de vista)

1. **Máquina de estados de tareas vive en la base de datos, no en el cliente.**
   `mantenimiento_transicionar_tarea()` (`supabase/migrations/20260905181000_mantenimiento_checklist_todas_habitaciones.sql:199-300`)
   valida explícitamente qué transiciones son legales (`pendiente→en_revision|en_proceso|cancelado`,
   etc.), exige responsable antes de pasar a `asignado`, exige evidencia si el plan la requiere antes
   de cerrar, y bloquea el cierre de una tarea de checklist "todas_habitaciones" si quedan
   habitaciones `pendiente`. El cliente (`mantenimiento-workflow-ui.js`) sólo ofrece botones acordes
   al estado (`getWorkflowAction()` en `mantenimiento-domain.js:170-193`), pero la autoridad real es
   el RPC. Esto es exactamente el patrón correcto para no depender de que la UI se comporte bien.

2. **El motor de recurrencia de planes es correcto, ancla-consistente y timezone-aware — tanto en
   SQL como en JS.**
   - SQL: `mantenimiento_plan_siguiente_fecha()` (`20260905130000_...sql:100-152`) calcula la
     siguiente fecha para día/semana/mes/año anclada a `fecha_inicio` (no a la fecha de cierre),
     con manejo correcto de fin de mes (día 31 de un plan mensual cae en el último día de meses
     cortos). El generador (`mantenimiento_generar_tareas_planes()`) usa
     `public.hotel_business_date(hotel_id, ahora)` — es decir, calcula "hoy" en la **zona horaria
     del hotel**, no la del servidor ni la del navegador.
   - JS: `mantenimiento-calendario-domain.js` reimplementa el mismo cálculo (para expandir
     ocurrencias en la vista de calendario) usando aritmética en **UTC puro** sobre componentes de
     fecha (`Date.UTC(...)`, `getUTCDate()`, etc.), evitando el bug clásico de "se corre un día"
     por DST/offset. Y para saber "qué día es hoy" en la UI, `mantenimiento-calendario-ui.js:54-68`
     usa `Intl.DateTimeFormat` con `window.hotelConfigGlobal.zona_horaria` — coherente con el lado
     SQL. Esto contrasta con el sistema legado de tareas sueltas (ver hallazgo H-1) y demuestra que
     el equipo ya sabe resolver el problema correctamente; falta generalizarlo.
   - `RECURRENCE_PRESETS` en `mantenimiento-calendario-domain.js:13-24` ya cubre diaria, semanal,
     quincenal (`interval:15` sobre `dia`), mensual, bimestral, trimestral, semestral, anual y
     personalizada — es decir, **todas las recurrencias pedidas en la tarea ya están soportadas**
     por este subsistema.

3. **Vencimientos de equipos ya modelados como primera clase.**
   `mantenimiento_planes.clase = 'vencimiento'` + `anticipaciones_dias integer[]` permite, por
   ejemplo, un plan "Recarga de extintores" con recurrencia anual y avisos a 30/15/7/1/0 días
   (`getDefaultReminderDays()` en `mantenimiento-calendario-domain.js:197-200` ya trae ese preset
   por defecto para la clase `vencimiento`). Las alertas de "vence hoy", "recordatorio" y "vencido"
   se emiten server-side vía cron cada 15 min (`mantenimiento_emitir_alertas_planes()`), con
   deduplicación por `(tarea_id, tipo_alerta, dias_antes, rol_destino)` en
   `mantenimiento_plan_alertas_emitidas` (tabla `deny-all` para clientes, correcta higiene RLS).

4. **Incidencias desde novedades por habitación (feature del último commit) tiene doble
   verificación, cliente y servidor, y no se puede saltar por UI.**
   `mantenimiento_exigir_incidencias_novedades()` (trigger `BEFORE UPDATE OF estado`,
   `20260905184500_...sql:147-180`) impide cerrar la tarea general si queda una fila `novedad` en
   `mantenimiento_tarea_habitaciones` sin `incidencia_tarea_id`. El cliente
   (`mantenimiento-incidencias-ui.js:215-225`) intenta interceptar el clic en "Cerrar" para dar el
   error antes del round-trip, pero si esa intercepción fallara (cambio de markup, otro punto de
   entrada), el trigger en BD igual lo impide. Es defensa en profundidad bien aplicada, igual que en
   el punto 1.

5. **Evidencias en bucket privado con URL firmada de 15 minutos**, no URLs públicas
   (`mantenimiento-evidencias.js:73-92`), con compatibilidad de lectura para adjuntos antiguos que
   sí guardaban URL pública. Límite de 12 MB y sanitización de nombre de archivo antes de subir.
   Correcto desde el punto de vista de exposición de datos.

## 3. Hallazgos con severidad

### H-1 (HIGH) — Dos motores de recurrencia coexisten; el legado es timezone-naive y sigue siendo
alcanzable desde la UI principal

> **Estado posterior al corte (2026-09-19): corregido por A17.** El modal de tareas ya no ofrece recurrencia; una tarea suelta se persiste como `unica` y una ejecución de plan como `personalizada`. Se retiraron `mantenimiento-preventivo.js`, `calculateNextScheduledDate()` y las llamadas de regeneración desde las tres rutas de UI. La migración `20260919120000_a17_mantenimiento_recurrencia_unificada.sql` convierte las recurrencias abiertas a planes, conserva intacto el historial cerrado y añade un trigger que impide reintroducir recurrencia fuera de `mantenimiento_planes`. `20260919121500_a17_mantenimiento_metricas_planes.sql` hace que el panel cuente preventivos por plan y fecha operativa del hotel. La cadena de planes y el cron cada 15 minutos quedaron aplicados y verificados en Supabase staging.

Hay **dos sistemas de recurrencia independientes y no unificados**:

- **Nuevo (planes)**: `mantenimiento_planes` + `mantenimiento-calendario-domain.js` +
  `mantenimiento_plan_siguiente_fecha()` (SQL). Timezone-aware, generado por cron, soporta
  quincenal/bimestral/trimestral/semestral/anual, vencimientos con múltiples anticipaciones.
- **Legado (frecuencia simple sobre la tarea)**: campo `tareas_mantenimiento.frecuencia`
  (`unica|diaria|semanal|mensual|personalizada`, `mantenimiento-domain.js:34-40`) +
  `calculateNextScheduledDate()` (`mantenimiento-domain.js:245-270`), que sólo soporta
  diaria/semanal/mensual (ni quincenal ni trimestral) y que **construye fechas con
  `new Date(...)` y `.setDate()/.setMonth()` en la hora local del navegador**, no la del hotel —
  a diferencia del sistema nuevo, que resuelve explícitamente `hotel_business_date`/
  `window.hotelConfigGlobal.zona_horaria`.

Este camino legado **sigue activo y es alcanzable hoy por cualquier usuario**: el modal principal
de creación/edición de tareas (`mantenimiento-mobile-ui.js:557`, campo "Frecuencia") todavía ofrece
`diaria/semanal/mensual/personalizada` como opción libre para tareas sueltas, sin pasar por un
plan. Al cerrar una de esas tareas, se dispara `ensureNextPreventiveTask()` desde
`mantenimiento-mobile-ui.js:616`, que:
- Sólo se ejecuta si algún navegador abre y guarda esa tarea (no hay barrido de servidor para este
  camino, a diferencia de `mantenimiento_calendario_tick()` que corre cada 15 min sin depender de
  que haya alguien conectado).
- Calcula la siguiente fecha con el reloj/zona del dispositivo del usuario que la cierra, lo cual
  puede desalinear el calendario operativo del hotel si quien cierra la tarea está en otra zona
  horaria (ej. un admin remoto) o simplemente porque el navegador tiene mal configurada la hora.

**Impacto en la evolución pedida**: si se sigue añadiendo funcionalidad de recurrencia sin migrar
o retirar explícitamente este camino legado, el sistema quedará con dos fuentes de verdad para
"cuándo toca la próxima tarea preventiva", una correcta y otra no, y el usuario no tiene manera de
saber cuál se está usando en un caso dado (depende de si la tarea nació de un plan o fue creada
suelta).

**Recomendación**: decidir explícitamente el camino a seguir — lo más simple es dejar de ofrecer el
selector de "Frecuencia" en el modal de tarea suelta para valores distintos de "única" (forzando el
uso de planes para todo lo recurrente), o migrar `calculateNextScheduledDate()` para que reciba y
use la zona horaria del hotel igual que el resto del sistema.

Archivos: `js/modules/mantenimiento/mantenimiento-domain.js:245-270`,
`js/modules/mantenimiento/mantenimiento-mobile-ui.js:557,616`,
`js/modules/mantenimiento/mantenimiento-preventivo.js:1-43`,
`js/modules/mantenimiento/mantenimiento-calendario-domain.js:13-101`,
`supabase/migrations/20260905130000_mantenimiento_planes_automatizacion.sql:64,100-152`.

### H-2 (MEDIUM→HIGH) — Lógica de "siguiente tarea preventiva" duplicada entre dos módulos de UI

> **Estado posterior al corte (2026-09-19): corregido por A17.** Las dos implementaciones cliente fueron eliminadas. El único generador de nuevas ocurrencias es `mantenimiento_generar_tareas_planes()` en el servidor; `mantenimiento-mobile-ui.js`, `mantenimiento-workflow-ui.js` y la UI anterior ya no crean la siguiente tarea al guardar o cerrar.

`ensureNextPreventiveTask()` existe en `mantenimiento-preventivo.js:13-43` (usado por
`mantenimiento-mobile-ui.js:616`, al guardar el formulario si el estado quedó cerrado), pero
`mantenimiento-workflow-ui.js:72-101` define **su propia copia casi idéntica** llamada
`ensureNextPreventive()` (nombre distinto, sin la `Task` final) en lugar de importar y reutilizar
la función de `mantenimiento-preventivo.js`, y la invoca desde `runWorkflowAction()` (línea 389)
cuando el flujo normal de botones cierra la tarea. Ambas copias:
- Comparten la misma condición (`frecuencia` en diaria/semanal/mensual + estado cerrado).
- Difieren levemente: la copia de `workflow-ui.js` añade `activeUser?.id` como fallback para
  `creada_por` que la original no tiene.

Esto es exactamente el tipo de duplicación que hace que una futura corrección (p. ej. arreglar el
problema de timezone del H-1) se aplique en un solo lugar y no en el otro sin que nadie lo note,
porque ambos caminos de cierre (guardar el modal directamente vs. usar el botón de flujo) son
formas normales y frecuentes de cerrar una tarea en la operación diaria.

**Recomendación**: eliminar la copia de `mantenimiento-workflow-ui.js` e importar
`ensureNextPreventiveTask` desde `mantenimiento-preventivo.js`, ajustando esa función para aceptar
un `fallbackUserId` opcional si se necesita el comportamiento de `activeUser?.id`.

Archivos: `js/modules/mantenimiento/mantenimiento-preventivo.js:13-43`,
`js/modules/mantenimiento/mantenimiento-workflow-ui.js:72-101,389`.

### H-3 (MEDIUM) — Composición de UI basada en `MutationObserver` + selección por texto/CSS, no en
un estado compartido

> **Estado al 2026-09-30 — Corregido y probado (M10).** Las superficies activas publican el evento
> `maintenanceUiRendered` mediante el contrato central `mantenimiento-ui-events.js`; workflow,
> checklist por habitaciones e incidencias consumen superficies tipadas y ya no observan todo el
> contenedor. Las filas de estado, transiciones de flujo y partes del calendario tienen `dataset`
> semántico generado por la capa propietaria. Los cuatro `MutationObserver`, los temporizadores de
> recomposición, el selector de clases Tailwind y la detección de cierre por texto fueron retirados.
> `tests/m10-mantenimiento-ui-composicion.test.cjs` cubre el contrato y evita su reintroducción.

Las capas de UI (`mantenimiento-workflow-ui.js`, `mantenimiento-incidencias-ui.js`) no se
comunican mediante llamadas a función o un store explícito, sino observando el DOM que la capa
inferior ya renderizó y "mejorándolo" después del hecho:
- `mantenimiento-workflow-ui.js` usa `new MutationObserver(scheduleEnhance)` sobre todo el
  contenedor, con un debounce de 30 ms, y localiza elementos por selectores CSS frágiles como
  `.mb-2.flex.flex-wrap.items-center` (línea 156, con un comentario propio advirtiendo que un
  punto en una clase Tailwind puede romper el selector — señal de que ya ha sido fuente de bugs).
- `mantenimiento-incidencias-ui.js:215-225` decide si el usuario está intentando "cerrar" una tarea
  **mirando el texto del botón** (`/cerr/i.test(button.textContent)`) en vez de un atributo de datos
  o un evento tipado. Si el texto del botón de cierre cambia (p. ej. i18n, copy nuevo), esta
  protección deja de dispararse silenciosamente — sin ningún test que lo detecte, ya que los tests
  existentes (`tests/mantenimiento-*.test.cjs`) parecen cubrir dominio/checklist/calendario pero no
  hay evidencia de un test de esta intercepción por texto.

**Impacto en la evolución pedida**: cada capa nueva (ya van cuatro: mobile → workflow → analytics →
incidencias, más calendario y habitaciones) añade su propio `MutationObserver` sobre el mismo
contenedor. Seguir apilando funcionalidad (p. ej. una quinta capa para "vencimientos de equipos" con
su propia UI de alertas) por este mismo mecanismo aumenta el riesgo de observers redundantes,
carreras de render (ya hay guards manuales tipo `enhancing`/`rerunRequested` en
`mantenimiento-incidencias-ui.js:169-208` para evitar reentradas) y acoplamiento a clases CSS de
Tailwind que no están pensadas como contrato estable.

**Recomendación**: si se añade una nueva superficie de UI para vencimientos/notificaciones, considerar
pasar a un modelo de eventos explícitos con `CustomEvent` tipados y `dataset` semántico (ya se usa
`data-task-action`, `data-room-review-id`, etc. en varias partes — extenderlo consistentemente en vez
de depender de texto visible o combinaciones de clases).

Archivos: `js/modules/mantenimiento/mantenimiento-workflow-ui.js:103-224`,
`js/modules/mantenimiento/mantenimiento-incidencias-ui.js:169-225`.

### M-1 (LOW→MEDIUM) — `mantenimiento-ui.js` (742 líneas) no está en la cadena de montaje activa

**Corregido y probado en B7.** La búsqueda dirigida en todo el runtime confirmó que el router carga
`mantenimiento.js`, cuya composición llega a `mantenimiento-mobile-ui.js`, y que ningún archivo
ejecutable importaba o solicitaba `mantenimiento-ui.js`. Se retiró la implementación obsoleta de 728
líneas y se añadieron contratos para impedir su reaparición o una referencia directa fuera de la
cadena canónica. El preview sirve la fachada activa con coincidencia SHA-256 exacta y responde 404
para la ruta eliminada.

### M-2 (LOW) — Estados de tarea: el modelo es sólido en servidor, pero el HTML legado del modal
base todavía ofrece un vocabulario de estados distinto

**Corregido y probado en B8.** El modal base normaliza el estado con `TASK_STATES`, muestra la etiqueta
canónica en un control de solo lectura y envía el valor mediante un campo oculto canónico. Las
transiciones continúan exclusivamente en la capa de workflow y su RPC. Se retiró de
`mantenimiento-workflow-ui.js` la reescritura del selector, que ya solo compensaba el HTML legado.
El guardado y las notificaciones reconocen `cerrado` después de normalizar, por lo que conservan los
metadatos de cierre sin depender de `completada`.

No es un estado "bloqueado" ambiguo en el sentido de la máquina de estados de la tarea: el bloqueo de
habitación no es un `estado` sino que se deriva de `tipo = 'bloqueante'` + estado abierto
(`mantenimiento_habitacion_tiene_bloqueo()`, `supabase/migrations/20260902043500_...sql:301-315`),
lo cual está bien separado conceptualmente (tipo de impacto operativo vs. estado del flujo de
trabajo) y evita el estado ambiguo que se pedía revisar.

### M-3 (LOW) — Timezone del calendario cae a un default hardcodeado de un país

**Corregido y probado en B9.** El calendario carga `zona_horaria` directamente desde
`configuracion_hotel` mediante `loadRequiredHotelTimeZone()` antes de calcular “hoy”, y usa
`getTodayInTimeZone(getRuntimeHotelTimeZone())`. Ya no consulta `window.hotelConfigGlobal`, no fija
Bogotá localmente y no cae al día UTC del navegador. Si la zona falta o no es IANA válida, muestra
un error dentro del calendario y deja disponible el resto del módulo de Mantenimiento.

## 4. Relación con el módulo de habitaciones (bloqueo/reservas)

Verificado en `supabase/migrations/20260902032500_mantenimiento_fase1_hardening.sql` y
`20260902033500_mantenimiento_fase1_estado_habitacion.sql`: existe un trigger
(`impedir_ocupar_habitacion_en_mantenimiento`, `BEFORE UPDATE OF estado ON habitaciones`) que
**impide** que otro flujo (por ejemplo, check-in de una reserva) cambie el estado de una habitación a
`ocupada`/`tiempo agotado` mientras exista una tarea `bloqueante` abierta — lanza
`HABITACION_BLOQUEADA_MANTENIMIENTO` en vez de permitirlo silenciosamente, y si el intento es hacia
otro estado, fuerza la habitación de vuelta a `mantenimiento`. Es la tarea de mantenimiento
bloqueante la fuente de verdad del estado operativo de la habitación, no al revés — diseño correcto
para evitar el caso real de negocio (reservar/ocupar una habitación que está fuera de servicio). No
audité en profundidad el módulo de reservas/mapa de habitaciones en sí (fuera de este alcance); esto
es lo que se ve desde el lado de mantenimiento.

## 5. Resumen de severidades

| ID | Severidad | Resumen |
|---|---|---|
| H-1 | HIGH — CORREGIDO A17 | La recurrencia quedó unificada en planes; el modal crea tareas únicas y el trigger de base de datos impide un segundo motor |
| H-2 | MEDIUM-HIGH — CORREGIDO A17 | Se eliminaron las dos implementaciones cliente; el generador server-side de planes es la única fuente de nuevas ocurrencias |
| H-3 | MEDIUM | Composición de UI vía `MutationObserver` + selectores CSS/texto frágiles; no escala limpiamente a más capas (vencimientos, notificaciones) |
| M-1 | LOW-MEDIUM — CORREGIDO B7 | El archivo obsoleto fue confirmado fuera de la cadena activa, retirado y cubierto por pruebas de composición |
| M-2 | LOW — CORREGIDO B8 | El modal base usa un estado canónico de solo lectura y el workflow conserva la autoridad sobre las transiciones |
| M-3 | LOW — CORREGIDO B9 | El calendario exige la zona IANA configurada, usa el servicio central y muestra un error visible si falta |
