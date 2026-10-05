# Auditoría — Zona horaria y manejo de fechas

Metodología: exploración con `graphify explain`/`graphify query` sobre `graphify-out/graph.json`
para localizar importadores reales de `hotelTimeZoneService.js`, seguida de lectura directa y
`Grep` de cada archivo citado para verificar cada hallazgo línea por línea. Todo lo marcado
`[EXTRACTED]` fue confirmado abriendo el archivo real; no hay hallazgos `[INFERRED]` en este informe.

## 1. Fuente oficial del timezone del hotel

- **Columna:** `configuracion_hotel.zona_horaria` (texto, IANA, `NOT NULL`, default `'America/Bogota'`).
  Definida/asegurada en `supabase/migrations/20260903050000_hotel_timezone_systemwide.sql:1-20`.
- **Validación DB:** trigger `trg_validate_configuracion_hotel_time_zone` (mismo archivo, L47-72)
  rechaza cualquier valor que no exista en `pg_catalog.pg_timezone_names` — no se puede guardar un
  timezone inventado.
- **Función SQL central:** `public.hotel_time_zone(p_hotel_id uuid)` (L22-42) — único punto de
  lectura del timezone en Postgres, con fallback a `'America/Bogota'` si el hotel no tiene config.
- **Función SQL derivada:** `public.hotel_business_date(hotel_id, occurred_at)` (L74-84) convierte
  cualquier `timestamptz` al "día operativo" del hotel (`occurred_at AT TIME ZONE hotel_time_zone(...)`).
  Esta misma migración reescribe dinámicamente (vía `pg_get_functiondef` + `replace`) las funciones
  `abrir_turno_con_apertura`, `cerrar_turno_con_arqueo`, `procesar_pago_reserva_atomico`,
  `get_dashboard_metrics`, `bank_email_notify_payment_event`, `mantenimiento_emitir_alertas`,
  `mantenimiento_metricas`, `preparar_tarea_mantenimiento_fase3`, entre otras (L101-263), sustituyendo
  literales `'America/Bogota'` hardcodeados por `hotel_time_zone(hotel_id)`. También sincroniza
  `horario_configuracion.zona_horaria` con `configuracion_hotel.zona_horaria` vía trigger (L265-320).
- **Fuente en el cliente JS:** `js/services/hotelTimeZoneService.js` — módulo runtime (`getRuntimeHotelTimeZone`,
  `setRuntimeHotelTimeZone`) más utilidades puras de conversión (`zonedDateTimeToUtc`,
  `getUtcRangeForHotelDates`, `addCalendarDays`, `getDateKeyInTimeZone`, `getTodayInTimeZone`,
  `formatInTimeZone`, `adjustLegacyHotelDayBoundary`). Se carga vía `loadHotelTimeZone(supabase, hotelId)`
  leyendo `configuracion_hotel.zona_horaria`, y el módulo de Configuración (`js/modules/configuracion/configuracion.js:23-90`)
  es el único lugar donde el usuario la edita (con `detectBrowserTimeZone()` usado solo como sugerencia
  inicial, nunca como autoridad — comentario explícito en el propio servicio, L57-58).
- **Puente automático cliente↔servidor:** `js/supabaseClient.js:54-58` envuelve el cliente Supabase
  real con `createHotelTimeZoneAwareSupabaseClient(supabaseBase)` **antes de exportarlo**, y todos los
  módulos reciben esa instancia envuelta a través de `main.js:789`
  (`moduleDefinition.mount(appContainer, supabase, ...)`). Este proxy (L240-308 de
  `hotelTimeZoneService.js`) hace dos cosas automáticamente para **cualquier** módulo, la use o no
  explícitamente:
  1. Cada `.select()` sobre `configuracion_hotel` fuerza incluir `zona_horaria` y, al resolver la
     promesa, llama `setRuntimeHotelTimeZone(...)` — así el runtime "aprende" el timezone del hotel
     con solo consultar esa tabla.
  2. Cada `.gte(col, valor)` / `.lte(col, valor)` cuyo `valor` sea **exactamente**
     `YYYY-MM-DDT00:00:00.000Z` o `YYYY-MM-DDT23:59:59.999Z` se reescribe automáticamente al límite de
     día real del hotel vía `adjustLegacyHotelDayBoundary` → `getUtcRangeForHotelDates`.

## 2. Importadores reales de `hotelTimeZoneService.js` (evidencia graphify + grep, coinciden)

`graphify explain "hotelTimeZoneService.js"` reporta grado 36, de los cuales 11 son `imports_from`
verificados por `Grep "from\s+['\"].*hotelTimeZoneService"` (mismo conteo, ambas fuentes coinciden):

| Archivo | Uso |
|---|---|
| `js/supabaseClient.js:4` | Envuelve el cliente global (safety-net de gte/lte) |
| `js/modules/configuracion/configuracion.js:2` | UI para editar `zona_horaria` |
| `js/modules/dashboard/dashboard.js:5` | KPIs del dashboard |
| `js/modules/reportes/reportes-centro-core.js:2` | Núcleo del "centro de reportes" (NO el módulo `reportes.js` legacy, ver §3) |
| `js/modules/tienda/historial-movimientos.js:2` | Historial de inventario filtrable por período (commits recientes) |
| `js/modules/bitacora/bitacora.js:5` | Bitácora operativa |
| `js/services/tarifasProgramadasService.js:1` | Resolución de tarifas programadas por fecha/hora |
| `js/tarifas-programadas-simulador-bootstrap.js:5`, `js/mapa-tarifas-programadas-bootstrap.js:11` | Simulador y mapa de tarifas programadas |
| `js/mapa-consumos-pagos-enhancer.js:2`, `js/mapa-fechas-abonos-inline.js:1` | Mapa de habitaciones (fechas de abonos/consumos) |

**Hallazgo estructural:** con un codebase de ~150+ módulos, solo 11 archivos importan el servicio
directamente. La red de seguridad de `supabaseClient.js` (gte/lte de patrón exacto) cubre una parte
del resto, pero como se ve en §3/§4, no es universal: no cubre `.lt()`/`.gt()`, no cubre cadenas de
fecha "peladas" (`YYYY-MM-DD` sin el sufijo horario exacto), y no cubre ningún cálculo que ocurra
en JavaScript puro (agrupar por día de semana, calcular checkout, poner el valor por defecto de un
`<input type="date">`).

## 3. Tabla: módulos que SÍ respetan el timezone del hotel vs los que NO

| Módulo / dominio | Respeta zona horaria del hotel | Evidencia |
|---|---|---|
| `js/services/hotelTimeZoneService.js` | SÍ (es la fuente) | Diseño centralizado, ver §5 |
| `js/supabaseClient.js` (cliente global) | SÍ (parcial, ver §4) | L54-58 |
| `js/modules/tienda/historial-movimientos.js` | SÍ, completo | Usa `getRuntimeHotelTimeZone`, `getTodayInTimeZone`, `addCalendarDays`, `getUtcRangeForHotelDates`, `formatInTimeZone` en toda la lógica de período (L1-75, L106, L128) |
| `js/modules/reportes/reportes-centro-core.js` | SÍ (importa el servicio) | L2 |
| `js/services/tarifasProgramadasService.js` | SÍ | Recibe `timeZone` explícito desde `configHotel.zona_horaria` |
| `js/modules/reservas/reservas-calculos.js` (cálculo de tarifa) | SÍ, vía `timeZone: configHotel?.zona_horaria` pasado a `tarifasProgramadasService` | L108, L126 |
| DB: `hotel_business_date`, `get_dashboard_metrics`, `mantenimiento_emitir_alertas`, `mantenimiento_metricas`, `bank_email_notify_payment_event`, `horario_configuracion` | SÍ | `supabase/migrations/20260903050000_hotel_timezone_systemwide.sql` |
| **`js/modules/reportes/reportes.js`** (módulo de reportes "clásico", el que de hecho se monta — ver `REPORTES_POR_PLAN`) | **SÍ después de A6 + A12** — usa `reportesTimeZoneService.js`, construido sobre el servicio central | Todas las rutas auditadas consultan rangos UTC semiabiertos; ingresos, períodos financieros, ocupación y comparativos se agrupan según el calendario y la zona activa del hotel |
| **`js/modules/reservas/reservas-calculos.js`** (cálculo de fecha de checkout) | **SÍ después de A7** — interpreta llegada y checkout con la zona operativa | Usa `parseDateTimeInTimeZone` y `getNearestCheckoutDateInTimeZone` |
| **`js/modules/clientes/clientes.js`** (`getClientes`, filtro por rango de fechas) | **NO** | L451-458 |
| **`js/modules/caja/caja-cierre.js`** (fecha impresa en el corte de caja) | **NO** (cosmético) | L594 |
| `js/modules/restaurante/restaurante.js`, `js/modules/limpieza/limpieza.js`, `js/modules/tienda/compras.js`, `js/modules/descuentos/descuentos.js` | NO, pero uso limitado a valores por defecto de `<input type="date">`, no a queries | Ver grep §4 |
| `supabase/functions/_shared/bank-email/*` (parseo de fecha del email bancario) | Hardcodea `America/Bogota` (offset fijo `+5`) en vez de leer `hotel_time_zone()` | `bankParsers/generic.ts:104-122`, `idempotency.ts:8-13` — ver matiz en §6 |
| `js/modules/mantenimiento/*` (calendario/recurrencia en cliente) | No usa el servicio, pero tampoco hace aritmética de día-de-semana en UTC (no se encontró evidencia de bug) | Sin imports ni `getUTCDay` en `mantenimiento-calendario-domain.js` |
| `js/modules/usuarios/horarios-profesionales*.js` (turnos de personal) | No usa el servicio JS; la zona la fija el trigger SQL `horario_forzar_zona_hotel` | Sin importadores JS; corrección ocurre en `20260903050000_hotel_timezone_systemwide.sql:265-320` |

## 4. Casos concretos de bug UTC-vs-local (con escenario real)

### 4.1 CRITICAL — `clientes.js`: filtro de rango de fechas pierde/gana registros por hasta 5 horas

> **Estado posterior al corte (2026-09-11): corregido y probado en preview.** `getClientes()` convierte las fechas del formulario mediante `getUtcRangeForHotelDates()` y la zona operativa configurada del hotel. La consulta usa ahora límites ISO exactos `gte`/`lt`, admite filtros parciales y respeta días de 23 o 25 horas. La regresión `tests/c7-clientes-timezone.test.cjs` cubre Bogotá, horario de verano y rangos invertidos. Evidencia completa en [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/clientes/clientes.js:451-458`, función `getClientes()`:

```js
if (dateRange.inicio) {
  query = query.gte('fecha_creado', dateRange.inicio);      // "YYYY-MM-DD" crudo
}
if (dateRange.fin) {
  const endDatePlusOne = new Date(dateRange.fin);
  endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
  query = query.lt('fecha_creado', endDatePlusOne.toISOString().split('T')[0]); // .lt(), NO .lte()
}
```

- `fecha_creado` es `timestamptz`. `dateRange.inicio`/`fin` son fechas "YYYY-MM-DD" puras.
- El proxy de `hotelTimeZoneService` (`adjustLegacyHotelDayBoundary`) **solo intercepta `.gte()`/`.lte()`
  cuyo valor coincide exactamente con `T00:00:00.000Z`/`T23:59:59.999Z`**. Aquí el valor no lleva ese
  sufijo (es solo la fecha) y además se usa `.lt()`, que el proxy ni siquiera revisa
  (`hotelTimeZoneService.js:284`: `if (property === 'gte' || property === 'lte')`). **No hay corrección
  automática posible en este caso.**
- Postgres interpreta el string de fecha en UTC. Para un hotel en `America/Bogota` (UTC-5):
  - **Escenario real:** un administrador filtra "clientes registrados hasta el 31 de agosto" para un
    reporte de fin de mes. Un cliente que se registró el 31 de agosto a las 8:00pm hora de Bogotá
    (`2026-09-01T01:00:00Z` en UTC) queda **excluido**, porque el corte `.lt('fecha_creado', '2026-09-01')`
    en UTC ya pasó (1:00am UTC del 1-sep es posterior a la medianoche UTC usada como límite... en
    realidad el registro cae ANTES de `2026-09-01T00:00:00Z`+1día calculado, pero el borde real de
    "31 de agosto en Bogotá" termina a `2026-09-01T05:00:00Z`). El corte se hace 5 horas ANTES de lo
    que el hotel considera "fin del 31 de agosto", cortando toda la última tarde/noche de ese día.
  - Simétricamente, `gte('fecha_creado', dateRange.inicio)` arranca el rango 5 horas ANTES de la
    medianoche real de Bogotá, colando registros de la noche del día anterior.
- **Impacto:** exportes de clientes (usa esta misma función, `clientes.js:1585`, para nombrar el
  archivo Excel) y cualquier filtro de "clientes nuevos en el período X" dan resultados sistemáticamente
  desplazados varias horas — perdiendo registros reales del último día y/o arrastrando registros del
  día anterior. Esto es exactamente el patrón "1 de septiembre lee datos de 31 de agosto" que se pidió
  verificar, confirmado con evidencia de código, no hipotético.
- **Severidad: CRITICAL** (pérdida silenciosa de datos en reportes/exportes de clientes, sin error visible).

### 4.2 HIGH — `reportes.js`: agregaciones "por día de la semana" usan `getUTCDay()`/`getUTCDate()` sobre timestamps

> **Estado posterior al corte (2026-09-12): corregido, probado y verificado en preview.** `reportes.js` delega los rangos, la agrupación diaria y la clasificación semanal a `reportesTimeZoneService.js`, que usa la zona operativa central. Las consultas aplican intervalos UTC semiabiertos y la misma zona queda fijada durante todo el cálculo del KPI. La regresión `tests/a6-reportes-timezone.test.cjs` cubre medianoche de Bogotá, zona runtime y un día de 25 horas por DST. Evidencia completa en [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/reportes/reportes.js`:
- L430: `for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1))`
- L1474: `reservasValidas.forEach(r => { demandaPorDia[new Date(r.fecha_inicio).getUTCDay()]++; });`
- L1479: `conteoDeDiasEnRango[d.getUTCDay()]++;`
- L1481: `movimientosIngreso.forEach(mov => { ingresosPorDiaSemana[new Date(mov.fecha_movimiento).getUTCDay()] += Number(mov.monto); });`

- `fecha_inicio` y `fecha_movimiento` son `timestamptz` (instante real, no solo fecha). `getUTCDay()`
  calcula el día de la semana en UTC, no en la zona del hotel.
- **Escenario real:** una reserva que hace check-in un viernes a las 8:00pm hora de Bogotá
  (`sábado 1:00am UTC`) se contabiliza como **sábado** en el gráfico "demanda por día de la semana" y en
  "ingresos por día de la semana" — desplazando sistemáticamente hacia el día siguiente todo movimiento
  ocurrido entre las 7:00pm y medianoche hora local (Bogotá) o equivalente para cualquier zona detrás de
  UTC (toda Latinoamérica). Esto sesga permanentemente los reportes gerenciales de ocupación por día,
  justo el tipo de reporte (`kpis_avanzados_hotel`, `comparativo_gerencial_operacion`) que un dueño usaría
  para decidir tarifas dinámicas por día de semana.
- **Severidad: HIGH** (no pierde/gana registros como en 4.1, pero clasifica mal una fracción sistemática
  de ellos en todo reporte por día de semana; afecta decisiones de negocio, no solo visualización).

### 4.3 HIGH — `reservas-calculos.js`: fecha de checkout calculada con reloj/zona del navegador, no del hotel

> **Estado posterior al corte (2026-09-12): corregido, probado y verificado en preview.** El formulario interpreta `datetime-local` como hora de pared del hotel y calcula el checkout con `hotelTimeZoneService.js`. La edición, lista de espera, mínimo del formulario, alquiler directo y extensiones por noche usan la misma zona. También se rechazan horas locales inexistentes durante un salto DST. La regresión `tests/a7-reservas-checkout-timezone.test.cjs` cubre las rutas activas. Evidencia completa en [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/reservas/reservas-calculos.js:8-23`:

```js
function calculateNearestCheckoutDate(fechaEntrada, checkoutHoraConfig, cantidadNoches = 1) {
  const fechaSalida = new Date(fechaEntrada);
  const [hh, mm] = (checkoutHoraConfig || '12:00').split(':').map(Number);
  fechaSalida.setHours(hh || 0, mm || 0, 0, 0);   // setHours() usa la zona LOCAL del navegador
  ...
}
```

- Este archivo **no importa** `hotelTimeZoneService` en absoluto (solo importa `uiUtils`,
  `reservas-operacion`, `tarifasProgramadasService`). El monto de la tarifa sí recibe
  `timeZone: configHotel?.zona_horaria` (L108, L126 de este mismo archivo), pero la **fecha de
  check-out en sí** (`fecha_fin` que se guarda en la reserva) se calcula con `setHours()`/`setDate()`,
  que operan en la zona horaria del entorno de ejecución del navegador (o del sistema operativo del
  dispositivo), no en `configuracion_hotel.zona_horaria`.
- **Escenario real:** un hotel opera en `America/Bogota`, pero el recepcionista usa una tablet o
  navegador cuyo reloj/zona del sistema quedó mal configurado (o un administrador remoto entra desde
  otro país/zona horaria para revisar el sistema y crea/edita una reserva). La "hora de checkout"
  configurada como `12:00` se aplicaría a las 12:00 de la zona del dispositivo, no a las 12:00 de
  Bogotá — desplazando `fecha_fin` (y por lo tanto la detección de choques de reserva, el bloqueo de
  3 horas previo en `validateAndCalculateBooking` L239-262, y la facturación por noches) en la
  diferencia horaria entre el dispositivo y el hotel.
- **Severidad: HIGH** (toca disponibilidad de habitaciones y monto facturado; el radio de explotación
  depende de que el dispositivo tenga una zona distinta a la del hotel, lo cual en la práctica es el
  caso típico si el sistema se usa alguna vez desde fuera del hotel).

### 4.4 MEDIUM — `reportes.js`: valores por defecto del filtro de fecha usan `new Date().toISOString()`

> **Estado al 2026-09-30:** corregido y probado como M14. `getDefaultReportDateRange` calcula el
> día actual con la zona horaria operativa del hotel y resta días de calendario sin pasar por UTC.
> Tanto `reportes.js` como `reportes-centro-core.js` consumen el mismo helper; se eliminaron los
> defaults con `toISOString()`. Las pruebas cubren Bogotá cuando UTC ya está en el día siguiente,
> una zona adelantada, cruces de mes/año y una ventana configurable.

`js/modules/reportes/reportes.js:2203-2207`:

```js
const today = new Date();
const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(today.getDate() - 30);
fechaInicioEl.value = thirtyDaysAgo.toISOString().split('T')[0];
fechaFinEl.value = today.toISOString().split('T')[0];
```

- `.toISOString()` convierte a UTC. Para un hotel en Bogotá, cualquier hora entre las 7:00pm y las
  11:59pm local ya es "mañana" en UTC. **Escenario real:** un recepcionista abre el generador de
  reportes a las 9:00pm hora de Bogotá el 6 de septiembre; el campo "fecha fin" se auto-rellena con
  "2026-09-07" (mañana para el hotel), no con "2026-09-06" (hoy real del hotel). El usuario puede no
  notarlo y generar/interpretar el reporte con un rango corrido un día.
- **Severidad: MEDIUM** (es un valor por defecto editable, no una pérdida de datos directa, pero
  siembra confusión y, si el usuario no ajusta el campo, genera el mismo tipo de corte de reporte
  descrito en 4.1 al pasar por `generarReporteListadoReservas` con fechas ya corridas).

### 4.5 LOW — `caja-cierre.js`: fecha impresa en el corte de caja usa la hora del navegador

> **Estado posterior al corte: corregido y probado como B10.** La fecha del ticket se genera con
> `formatInTimeZone(new Date(), getRuntimeHotelTimeZone(), 'es-CO', ...)`. El navegador deja de
> decidir la zona impresa; el instante se presenta según la configuración operativa del hotel. No se
> modificaron montos, validaciones de turno ni agrupaciones financieras.

### 4.6 MEDIUM (con matiz) — Conciliación bancaria por email: offset de Bogotá hardcodeado

> **Estado al 2026-09-30:** corregido y probado como M15. La zona incluida en el texto del correo
> ahora es una propiedad IANA explícita de cada regla bancaria (`transactionTimeZone`); Bancolombia
> declara `America/Bogota` porque esa es la zona fuente del banco. El parser, `transaction_date` y la
> huella secundaria comparten ese contrato y ya no restan cinco horas manualmente. Por separado, los
> filtros de calendario de `bank-email-api` consultan `hoteles.zona_horaria` y convierten el rango a UTC
> con límites semiabiertos, incluso en zonas con DST. Así se conserva el comportamiento colombiano del
> piloto sin confundir la zona del banco con la zona operativa de un hotel futuro.

`supabase/functions/_shared/bank-email/bankParsers/generic.ts:104-122` (`bogotaDateTimeToIso`, offset
fijo `hour + 5`) y `idempotency.ts:8-13` (`bogotaCalendarBucket`, resta fija de 5 horas), usados para
parsear el texto libre del correo bancario y para construir `transaction_date`
(`payment-service.ts:322`).

- **Matiz importante:** esta función parsea el **texto literal** que un banco colombiano (Bancolombia,
  a juzgar por `bankParsers/bancolombia.ts` y el campo `amount_cop`) imprime en su correo de
  notificación, que siempre reporta la hora en horario de Colombia, sin importar en qué país esté el
  hotel que usa el sistema. Además, `payment-service.ts:331` restringe explícitamente esta función a
  `pilotHotel` (`if (payload.hotel_id !== pilotHotel.id) throw new Error('BANK_EMAIL_OUTSIDE_PILOT_HOTEL')`),
  es decir, hoy solo un hotel piloto (colombiano) la usa. En ese contexto, el offset fijo de Bogotá es
  **correcto por diseño**, no un bug — porque no está tratando de reflejar la zona horaria del hotel,
  sino la zona en la que el banco emisor reporta sus transacciones.
- **Riesgo real:** el propio archivo de migración `20260903050000_hotel_timezone_systemwide.sql:210-225`
  ya corrigió `bank_email_notify_payment_event` para leer `hotel_time_zone(v_event.hotel_id)` en vez de
  `'America/Bogota'` fijo — es decir, el equipo ya reconoció que la zona del hotel importa para las
  *notificaciones/alertas* derivadas de estos pagos, pero el **bucket de fecha de la transacción en sí**
  (`transaction_date`, usado para deduplicación y para mostrarle al staff "pagos de hoy") sigue anclado
  a Bogotá. Si el piloto se expande a un hotel en otra zona horaria (ej. México, UTC-6) que reciba pagos
  por el mismo mecanismo, un pago que el banco reporta a las 11:30pm hora de México (que el parser
  interpreta como si fuera hora de Bogotá) se le asignaría una fecha de transacción incorrecta.
- **Severidad: MEDIUM**, condicionada a que el alcance siga siendo "solo bancos colombianos para
  cualquier hotel" — si es así, el diseño es intencional y aceptable; si se planea usar con bancos
  de otros países, esto necesita generalizarse. Vale la pena documentar la intención explícitamente
  en el código (hoy no hay comentario que aclare "esto es la hora del BANCO, no la del HOTEL").

## 5. Qué está bien resuelto

1. **`hotelTimeZoneService.js` es un diseño centralizado sólido.** Separa correctamente fecha
   calendario (`YYYY-MM-DD`, sin zona) de instante (`timestamptz`), tiene aritmética de calendario
   correcta usando UTC internamente como "reloj neutro" (`addCalendarDays`, `getInclusiveCalendarDayCount`)
   en vez de `Date.setDate()` (que sufre problemas de horario de verano en otras latitudes), valida
   zonas IANA reales con `Intl.DateTimeFormat`, y expone primitivas claras y bien nombradas
   (`getUtcRangeForHotelDates`, `getDateKeyInTimeZone`, `formatInTimeZone`) que cualquier módulo nuevo
   puede adoptar sin reinventar conversión de zonas horarias a mano.
2. **El puente automático en `js/supabaseClient.js` (Proxy + `adjustLegacyHotelDayBoundary`) es una
   red de seguridad elegante para deuda técnica legacy.** Como *todos* los módulos reciben el mismo
   cliente envuelto vía `main.js:789`, cualquier código antiguo que construya límites de día como
   `${fecha}T00:00:00.000Z` / `${fecha}T23:59:59.999Z` y los pase a `.gte()`/`.lte()` obtiene
   automáticamente el corte de día correcto según el timezone real del hotel, sin que ese módulo sepa
   que el servicio existe. Es una forma poco común y bien pensada de migrar código legacy sin tocarlo.
3. **La capa SQL (`hotel_time_zone()`, `hotel_business_date()`, triggers de sincronización) demuestra
   que el soporte multi-país es real, no solo aspiracional.** La migración
   `20260903050000_hotel_timezone_systemwide.sql` reescribe en caliente (`pg_get_functiondef` +
   `replace`) más de una decena de funciones/vista que antes tenían `'America/Bogota'` fijo, y sincroniza
   la zona hacia `horario_configuracion` con triggers — esto es evidencia concreta de que el sistema fue
   diseñado (y refactorizado activamente, la migración es del 3 de septiembre de 2026) para soportar
   hoteles en distintos países, no solo Colombia.
4. **`historial-movimientos.js` (tienda) es el ejemplo a imitar.** Usa el servicio de punta a punta
   (`getRuntimeHotelTimeZone`, `getTodayInTimeZone`, `addCalendarDays`, `getUtcRangeForHotelDates`,
   `formatInTimeZone`) para resolver períodos ("hoy", "últimos 7 días", "mes anterior", rango
   personalizado) sin un solo `new Date().toISOString()` suelto. Es la plantilla correcta para migrar
   `reportes.js` y `clientes.js`.

## 6. Conclusión sobre soporte multi-timezone real

El sistema **sí soporta timezones distintos por hotel** de forma genuina a nivel de base de datos
(columna validada + función central + triggers de propagación) y en los módulos más recientes del
cliente JS. El riesgo no es arquitectónico sino de **adopción desigual**: de ~150 módulos, solo 11
importan `hotelTimeZoneService.js` directamente, y aunque el proxy de `supabaseClient.js` cubre el
patrón más común de corte de día legacy, dejan expuestos patrones que ese proxy no puede interceptar
(`.lt()`/`.gt()`, fechas "peladas" sin sufijo horario exacto, y toda la aritmética de fecha hecha en
JavaScript puro con `getUTCDay()`/`setHours()`/`toISOString()`). Los hallazgos de las secciones 4.1 a
4.4 son ejemplos verificados y no hipotéticos de ese patrón, concentrados en `reportes.js`,
`reservas-calculos.js` y `clientes.js` — los tres módulos de mayor uso operativo diario que aún no
adoptan el servicio central.
