# Arquitectura actual — Gestión de Hotel

> Fuente: `graphify-out/graph.json` / `GRAPH_REPORT.md` (construido sobre commit `e1918456`), verificado
> abriendo el código real de cada archivo citado. El grafo no refleja el estado en vivo de Supabase
> (RLS/RPC en producción) — la fuente de verdad para eso son las migraciones en `supabase/migrations/`,
> no este documento.

## 1. Mapa de módulos y dominios funcionales

El frontend es JS vanilla con ES modules cargados dinámicamente desde un router central
(`js/main.js`). Cada dominio de negocio vive en `js/modules/<dominio>/`:

| Dominio | Archivo(s) principal(es) | Tamaño | Observación |
|---|---|---|---|
| Reservas | `js/modules/reservas/reservas.js` (+ `reservas-operacion.js`, `reservas-historial.js`, `reservas-calculos.js`, `reservas-data.js`, `reservas-pagos.js`) | 3291 líneas el archivo principal | Parcialmente descompuesto, pero `reservas.js` sigue siendo un God File (ver §3) |
| Caja / turnos | `js/modules/caja/caja.js`, `caja-movimientos.js`, `caja-cierre.js`, `caja-turnos.js`, `caja-paneles.js` | 778 + 550 + … | Ya dividido en 5 archivos por responsabilidad (turnos, movimientos, cierre, paneles) |
| Mapa de habitaciones | `js/modules/mapa-habitaciones/mapa-habitaciones.js`, `room-card.js`, `modales-alquiler.js`, `modales-gestion.js`, `datos.js`, `descuentos-helper.js`, `cronometro-habitacion.js` | 493 líneas el núcleo | Ciclo de import de 3 archivos confirmado (ver `03-mapa-dependencias.md`) |
| Tienda (POS + inventario) | `js/modules/tienda/{tienda,pos,inventario,historial-movimientos,pedidos-web,categorias,tienda-web}.js` | — | Buena separación por sub-función (POS, inventario, pedidos web, categorías) |
| Restaurante / Terraza | `js/modules/restaurante/restaurante.js`, `js/modules/terraza/terraza*.js` (config, cobros, inventario, lista-compras, reservas, utils) | — | Terraza está bien fragmentado en 7+ archivos por responsabilidad |
| Mantenimiento | `js/modules/mantenimiento/mantenimiento.js` (facade, 10 líneas) + `mantenimiento-{repository,ui,workflow-ui,analytics-ui,calendario-ui,mobile-ui,habitaciones-ui,incidencias-ui,calendario-domain}.js` | repository=300, ui=742, workflow-ui=478 | **Mejor ejemplo de arquitectura del repo** — ver §4 |
| Pagos bancarios (conciliación) | `js/modules/pagos-bancarios/pagos-bancarios.js` + `js/services/bankPaymentService.js` | 1127 líneas | Módulo grande, concentra UI + orquestación de conciliación bancaria |
| Usuarios / permisos | `js/modules/usuarios/usuarios.js` | — | — |
| Clientes / CRM | `js/modules/clientes/clientes.js` + `js/services/crmCommercialService.js` | — | Lógica de insights CRM ya extraída a servicio |
| Reportes / Dashboard | `js/modules/reportes/reportes.js`, `js/modules/dashboard/dashboard.js` | — | — |
| Control de energía | `js/modules/control-energia/control-energia.js`, `control-energia-20260902.js` | — | Dos versiones conviven (naming con fecha sugiere migración en curso) |
| Horarios profesionales | `js/modules/.../horarios-profesionales-fase3.js` + Edge Function "Motor de Horarios" | — | Lógica de negocio compleja compartida frontend/backend |
| Tarifas programadas | `js/services/tarifasProgramadasService.js`, `tarifasProgramadasConflictosService.js` | — | Servicio bien acotado, cohesión alta (0.29) |
| Soporte / Chat | `js/modules/soporte/soporte.js`, `js/app-support-chat.js` | — | — |
| Suscripción / Mi Cuenta | `js/modules/mi-cuenta` (no confirmado el path exacto) + Edge Functions de billing (Wompi/Mercado Pago) | — | — |

## 2. Servicios transversales (cross-cutting)

`js/services/` contiene 24 archivos, cada uno con una responsabilidad concreta:
`NotificationService.js`, `appUiKit.js`, `bankPaymentService.js`, `bitacoraservice.js`,
`crmCommercialService.js`, `demoSandboxService.js`, `destructiveConfirmationService.js`,
`evidenceUploadService.js`, `fase1FeatureFlags.js`, `fase1OperationService.js`,
`hotelOnboardingService.js`, `operationTodayService.js`, `permissionTemplateService.js`,
`posDraftService.js`, `pwaService.js`, `sensitiveAuditService.js`, `thermalPrintService.js`,
`turnoService.js`, `clienteIdentityGuard.js`, `descuentosService.js`,
`hotelTimeZoneService.js`, `monitoringService.js`, `notificationCenterService.js`,
`tarifasProgramadasConflictosService.js`, `tarifasProgramadasService.js`.

Además, en la raíz de `js/` viven los 3 utilitarios más conectados del grafo:

- **`js/security.js`** (215 líneas, degree 44) — `escapeHtml()`, `escapeAttribute()`, `sanitizeUrl()`,
  `normalizeLegacyText()`, `normalizeDomText()`, `installLegacyTextNormalizer()`. **Verificado: 100 %
  utilidades puras de escape/sanitización de texto/HTML, sin lógica de negocio.** Es el ejemplo correcto
  de utilitario transversal.
- **`js/uiUtils.js`** (924 líneas, degree 69) — mezcla utilidades de UI puras
  (`showError`, `showSuccess`, `showLoading`, `formatCurrency`, `formatDateTime`, `clearFeedback`) con
  **lógica de negocio crítica**: `showConsumosYFacturarModal()` (251 líneas — modal completo de consumo y
  facturación de habitación), `imprimirTicketHabitacion()` (195 líneas — generación de tickets/facturas),
  `notificarAlegraViaZapier()` (integración con facturación electrónica Alegra), `registrarUsoDescuento()`
  (contabilización de uso de descuentos). Ver severidad en §3.
- **`js/services/hotelTimeZoneService.js`** (354 líneas, degree 36) — utilidades puras de zona horaria
  (`getRuntimeHotelTimeZone`, `formatInTimeZone`, `getUtcRangeForHotelDates`, `zonedDateTimeToUtc`,
  `getDateKeyInTimeZone`). Consumido por 8+ módulos (dashboard, reportes, bitácora, tarifas programadas,
  mapa). Correctamente acotado: solo maneja tiempo/zona horaria, no mezcla otra lógica.
- **`js/supabaseClient.js`** — cliente único de Supabase, usado por prácticamente todo el frontend (no
  es un God Node individual en el reporte porque graphify no listó su nodo entre los top-10, pero es
  arquitectónicamente el punto de entrada obligatorio a la base de datos, coherente con la regla del
  proyecto "toda consulta pasa por Supabase JS client").
- **`js/main.js`** (1196 líneas, degree 96) — app shell: `router()`, `initializeApp()`,
  `renderNavigation()`, carga dinámica (`dynamic_import`) de los ~20 módulos de negocio, más lógica de
  sesión/plan: `resolveEffectiveHotelPlan()`, `calculateSubscriptionExpiredStatus()`,
  `canCurrentUserAccessBankPaymentPilot()`, `isModuleAllowedByPlan()`. Es razonable que sea un hub (es el
  orquestador central), pero ya está absorbiendo reglas de negocio de suscripción/planes que podrían vivir
  en un servicio dedicado (ver hallazgo MEDIUM en resumen).

## 3. God Files / God Objects

### God Nodes de función (del reporte, verificados)
1. `escapeHtml()` — 145 edges. Razonable: es la única función de escape HTML del sistema, usada en
   decenas de módulos para render seguro. Centralidad esperada de un utilitario de seguridad.
2. `formatCurrency()` — 70 edges. Razonable: formateo de moneda consistente (COP) en toda la UI.
3. `showError()` — 63 edges. Razonable: patrón de feedback de UI estandarizado.
4. `getMapaModuleDeps()` — 39 edges. Inyección de dependencias del módulo mapa-habitaciones
   (patrón de "dependency object" para submódulos) — razonable como punto de ensamblado.
5. `escapeAttribute()`, `formatDateTime()` — mismos utilitarios de seguridad/formato, razonable.

### God Files (por tamaño + acoplamiento, verificados abriendo el archivo)

| Archivo | Líneas | Degree en grafo | Severidad | Justificación |
|---|---|---|---|---|
| `js/modules/reservas/reservas.js` | 3291 | 169 (149 internas) | **HIGH** | El módulo de negocio más crítico y más grande del repo. 149 de sus 169 conexiones son *dentro del propio archivo* — señal de que concentra demasiadas responsabilidades (cálculo de fechas/montos, render de tabla, modales, waitlist, descuentos, historial) en un solo archivo, aunque parte de la lógica ya se extrajo a `reservas-operacion.js`, `reservas-historial.js`, `reservas-calculos.js`, `reservas-data.js`, `reservas-pagos.js`. La extracción quedó incompleta. |
| `js/uiUtils.js` | 924 | 69 | **HIGH** | Mezcla utilidades de UI genéricas con lógica de negocio de facturación/consumos/descuentos. Modificar `showConsumosYFacturarModal` o `imprimirTicketHabitacion` por un bug de facturación obliga a tocar el mismo archivo que usan 30+ módulos solo para `showError`/`formatCurrency`. Alto riesgo de regresión colateral. |
| `js/modules/pagos-bancarios/pagos-bancarios.js` | 1127 | 82 | MEDIUM | Grande pero cohesivo: todo el archivo trata de un solo dominio (conciliación bancaria). No mezcla utilidades transversales con negocio de otro módulo — su tamaño viene de la complejidad inherente del dominio (piloto Gmail/Bancolombia), no de mala separación de capas. |
| `js/main.js` | 1196 | 96 | MEDIUM | Concentra router + sesión + navegación + reglas de plan/suscripción. La centralidad como *orquestador* es esperable; el riesgo real es que la lógica de negocio de suscripción (`calculateSubscriptionExpiredStatus`, `resolveEffectiveHotelPlan`) vive aquí en vez de en un servicio, acoplando el arranque de la app a las reglas de facturación SaaS. |
| `supabase/functions/bank-email-api/index.ts` | 1106 | — | LOW-MEDIUM | Edge Function grande, pero delega correctamente en `_shared/bank-email/*` (server.ts, config.ts, gmail-message.ts, payment-service.ts, bankParsers/*). Es un entry-point HTTP con buena descomposición interna — el tamaño del archivo raíz no indica mal diseño per se. |
| `js/modules/caja/caja-movimientos.js` | 550 | 42 | LOW | Cohesión alta (community "caja-movimientos.js" con foco claro: cálculo de resúmenes de cierre, clasificación de métodos bancarios/efectivo). Tamaño razonable para su alcance. |

**Regla aplicada:** alta centralidad no es en sí un error. `security.js` y `hotelTimeZoneService.js`
tienen centralidad alta y están **bien diseñados** (utilidades puras, sin mezcla de capas). `uiUtils.js`
y, en menor medida, `reservas.js` tienen centralidad alta **y además mezclan capas** (utilidad genérica +
lógica de negocio / demasiadas responsabilidades en un archivo) — ahí es donde la centralidad se vuelve
peligrosa.

## 4. Qué está bien diseñado

1. **Patrón facade en `mantenimiento/`**: `js/modules/mantenimiento/mantenimiento.js` tiene solo 10
   líneas y expone un "contrato público estable: mount, unmount, showModalTarea" (comentario textual en
   el archivo), delegando en `mantenimiento-analytics-ui.js` y `mantenimiento-incidencias-ui.js`, que a su
   vez se apoyan en `mantenimiento-repository.js` (acceso a datos, 300 líneas), `mantenimiento-calendario-domain.js`
   (lógica pura de fechas/recurrencia, cohesión 0.29 — la más alta del reporte entre módulos de negocio) y
   varias UI especializadas (`-ui.js`, `-mobile-ui.js`, `-calendario-ui.js`, `-habitaciones-ui.js`,
   `-workflow-ui.js`). Es el único módulo de negocio grande del repo con separación limpia
   repositorio/dominio/UI y un punto de entrada deliberadamente pequeño. Debería usarse como plantilla
   para refactorizar `reservas.js`.
2. **`js/security.js`**: utilidad transversal mínima, sin dependencias de negocio, alta cohesión conceptual
   (todo gira en torno a escape/sanitización de texto). Ejemplo correcto de "compartir sin acoplar".
3. **`js/services/*`**: 24 servicios de una sola responsabilidad (`turnoService`, `descuentosService`,
   `bankPaymentService`, `hotelTimeZoneService`, `crmCommercialService`, etc.) en vez de meter todo en los
   módulos de UI — buena capa de dominio/servicios independiente de la capa de presentación.
2. **Tienda y Terraza**: ambos dominios están fragmentados por sub-responsabilidad (POS, inventario,
   pedidos web, categorías / configuración, cobros, inventario, lista de compras, reservas) en vez de un
   archivo monolítico — a diferencia de reservas.js.
3. **Edge Functions bancarias** (`supabase/functions/_shared/bank-email/`): buena capa compartida entre
   Edge Functions (`bank-email-api`, `gmail-webhook`, `gmail-watch-renew`, `gmail-oauth-callback`,
   `bank-payment-relation-api`) — `server.ts`, `config.ts`, `http.ts`, `gmail-api.ts`, `google-oauth.ts`,
   `payment-service.ts`, `bankParsers/{bancolombia,generic}.ts`, `pilot-hotel.ts` están separados por
   responsabilidad y reutilizados en vez de duplicados entre funciones.
4. **`js/main.js` como único orquestador de carga**: todos los módulos de negocio se cargan vía
   `dynamic_import` desde un router central, lo cual permite lazy-loading real y un único punto donde
   auditar permisos/roles antes de montar un módulo — consistente con la regla de RLS por `hotel_id` del
   proyecto (el gateo de acceso ocurre antes del `mount()`).

## 5. Nota sobre alcance del análisis

Este documento describe la arquitectura de **archivos y módulos JS/TS versionados**. No valida el estado
de RLS/roles en la base de datos en vivo (solo las migraciones SQL). Para ese análisis ver el documento de
seguridad correspondiente de la auditoría integral.
