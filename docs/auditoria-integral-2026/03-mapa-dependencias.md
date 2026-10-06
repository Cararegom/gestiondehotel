# Mapa de dependencias — Gestión de Hotel

> Evidencia obtenida con `graphify explain` / `graphify path` sobre `graphify-out/graph.json`
> (commit `e1918456`) y verificada abriendo los imports reales de cada archivo citado. Las listas de
> "importadores" citadas abajo son las relaciones `imports_from` EXTRACTED del grafo — no inferencias.

## 1. Ciclo de dependencia confirmado

**Ciclo de 3 archivos en `js/modules/mapa-habitaciones/`:**

```
modales-alquiler.js → room-card.js → modales-gestion.js → modales-alquiler.js
```

Verificado abriendo los tres archivos:

- `modales-alquiler.js:L6` → `import { updateClienteFields } from './room-card.js'`
- `room-card.js:L3` → `import { showHabitacionOpcionesModal } from './modales-gestion.js'`
- `modales-gestion.js:L1` → `import { imprimirFacturaPosAdaptable } from './modales-alquiler.js'`
- `modales-gestion.js:L19` → `import { showAlquilarModal, showExtenderTiempoModal } from './modales-alquiler.js'`

**Impacto:** los tres archivos no pueden cargarse ni entenderse de forma aislada — cualquier cambio en la
firma de `updateClienteFields`, `showHabitacionOpcionesModal`, `imprimirFacturaPosAdaptable`,
`showAlquilarModal` o `showExtenderTiempoModal` obliga a revisar los tres archivos. Con ES modules el
ciclo no rompe la carga (a diferencia de CommonJS), pero sí complica el testing unitario aislado y hace
más fácil introducir referencias circulares de estado (p. ej. un modal que reabre a otro que lo reabre).
Es el módulo más sensible a "cambios que rompen otro módulo" de todo el mapa de habitaciones porque el
propio dominio (alquiler/gestión de habitación) ya es circular por diseño (abrir un modal de gestión desde
la tarjeta, y desde el modal de gestión abrir el de alquiler, y desde el de alquiler volver a tocar la
tarjeta).

**Severidad: MEDIUM.** No es un bug funcional (no hay evidencia de loop infinito en runtime), pero es
deuda estructural en el dominio más operado del día a día (mapa de habitaciones = check-in/check-out).

## 2. Radio de impacto de los archivos más conectados

### 2.1 `js/uiUtils.js` (degree 69, 924 líneas) — CRÍTICO

Importadores directos confirmados (`imports_from` EXTRACTED, lista parcial de 20 + resto agrupado):

`reservas.js`, `main.js`, `pagos-bancarios.js`, `mantenimiento-mobile-ui.js`, `caja.js`,
`gestion-hotel.js`, `mantenimiento-ui.js`, `modales-gestion.js`, `tienda/inventario.js`, `clientes.js`,
`reportes.js`, `restaurante.js`, `ops-saas.js`, `pos.js`, `caja-movimientos.js`, `habitaciones.js`,
`habitaciones-tarifas-bootstrap.js`, `mapa-consumos-pagos-enhancer.js`, `mapa-saldo-enhancer.js`,
`bitacora.js`, `caja-cierre.js`, `caja-paneles.js`, `caja-turnos.js`, `dashboard.js`, `limpieza.js`,
`mapa-habitaciones/datos.js`, `mapa-habitaciones.js`, `reservas-calculos.js`, `reservas-data.js`,
`reservas-pagos.js`, `restaurante/inventario.js`, `sandbox.js`, `soporte.js`, `terraza-utils.js`,
`tienda/categorias.js` (+ ~4 archivos más) — **≈39 archivos** en 15+ dominios distintos.

**Si se modifica `uiUtils.js`, ¿qué puede romperse?** En la práctica, *todo el sistema*, porque
`showError`/`showSuccess`/`formatCurrency`/`formatDateTime` se usan como el estándar de feedback y
formato en casi cada módulo. Pero el riesgo real y específico es distinto del riesgo de un utilitario
puro: este archivo también contiene **lógica de facturación y consumo de habitación**
(`showConsumosYFacturarModal`, `imprimirTicketHabitacion`, `notificarAlegraViaZapier`,
`registrarUsoDescuento`). Un cambio hecho para arreglar el modal de facturación puede:
- Romper el build/parse del archivo para los 39 módulos que solo necesitan `showError`/`formatCurrency`.
- Generar una revisión de código innecesariamente amplia (el diff toca "el archivo que usa todo el
  sistema") para un cambio que en realidad es acotado al dominio de cobros en habitación.

**Severidad: HIGH.** Recomendación (no ejecutada en esta auditoría, solo diagnóstico): extraer
`showConsumosYFacturarModal`, `imprimirTicketHabitacion`, `notificarAlegraViaZapier`,
`registrarUsoDescuento` a un servicio de facturación/consumos (p. ej.
`js/services/roomBillingService.js`), dejando `uiUtils.js` como utilidades de presentación puras.

### 2.2 `js/security.js` (degree 44, 215 líneas) — BAJO RIESGO PESE A LA CENTRALIDAD

Importadores directos confirmados: `reservas.js`, `terraza.js`, `main.js`, `pagos-bancarios.js`,
`caja.js`, `modales-gestion.js`, `tienda/inventario.js`, `reportes.js`, `integraciones.js`,
`ops-saas.js`, `caja-movimientos.js`, `room-card.js`, `dashboard.js`, `notificaciones.js`,
`caja-cierre.js`, `caja-turnos.js`, `soporte.js`, `control-energia.js`,
`control-energia-20260902.js`, `costeo.js`, `finanzas-cuentas.js`, `gastos.js`,
`integrationCatalog.js`, `terraza-cobros.js`, `terraza-inventario.js`, `terraza-lista-compras.js`,
`terraza-reservas.js`, `historial-movimientos.js`, `pedidos-web.js`, `appUiKit.js`,
`thermalPrintService.js` — **≈34 archivos**.

**Si se modifica `security.js`, ¿qué puede romperse?** En teoría, el render seguro de cualquier módulo que
llama `escapeHtml`/`escapeAttribute`/`sanitizeUrl` — es decir, la superficie de XSS de casi toda la app.
Pero el archivo en sí **no mezcla lógica de negocio** (confirmado leyendo el archivo completo: solo
escape/sanitización de texto y un normalizador de texto legado). Esto reduce drásticamente el radio de
"romper algo distinto por accidente": un cambio aquí solo puede romper *cómo se escapa el HTML*, no
lógica de negocio de otro dominio. Es el ejemplo de un God Node cuya alta centralidad es **razonable, no
peligrosa**.

**Severidad si se rompe: HIGH** (todo el escapado de HTML del sistema depende de él — es superficie de
seguridad), **pero el riesgo de romperlo accidentalmente al tocar otra cosa es LOW** porque está bien
acotado.

### 2.3 `js/modules/reservas/reservas.js` (degree 169, 3291 líneas) — CRÍTICO

Importador externo confirmado: `main.js` (`dynamic_import`, carga perezosa vía router). El dato más
importante no es cuántos módulos lo importan (solo 1, `main.js`, como es de esperar del patrón de
router), sino que **149 de sus 169 conexiones son internas al propio archivo** — funciones que se llaman
entre sí dentro de `reservas.js` (`renderReservas()`, `mount()`, `handleFormSubmit()`,
`showClienteSelectorModal()`, `calculateFechasEstancia()`, `calculateMontos()`, etc.), y depende a su vez
de `clientes.js`, `security.js`, `uiUtils.js`, `fase1OperationService.js`, `reservas-operacion.js`,
`reservas-historial.js`, `turnoService.js`.

**Si se modifica `reservas.js`, ¿qué puede romperse?**
- **Directo:** el módulo de reservas completo (creación, edición, check-in/out, cálculo de montos,
  waitlist, historial) — es el dominio con más funciones en un solo archivo del repo.
- **Indirecto confirmado por imports salientes:** `clientes.js` (selector de cliente en el formulario de
  reserva), `fase1OperationService.js` (pagos atómicos de reserva — módulo compartido con caja),
  `turnoService.js` (validación de turno abierto — compartido con caja/POS/terraza).
- No hay evidencia en el grafo de que otros módulos importen funciones *desde* `reservas.js` (no aparece
  como dependencia saliente de otros módulos de negocio), lo que limita el radio de fallo hacia afuera,
  pero el tamaño y la baja cohesión interna (0.05, la más baja de todas las comunidades del reporte)
  significa que un cambio interno tiene alta probabilidad de romper *otra función del mismo archivo* por
  efectos colaterales de variables/estado compartido a nivel de módulo.

**Severidad: HIGH.** Justificación de prioridad: reservas es, junto con caja, el dominio de mayor impacto
financiero y operativo diario (regla del proyecto: "si un bug afecta datos de caja o habitaciones, máxima
prioridad"). Un archivo de 3291 líneas con cohesión 0.05 es el candidato #1 a introducir regresiones
silenciosas.

### 2.4 `js/main.js` (degree 96, 1196 líneas) — ORQUESTADOR, RIESGO ESTRUCTURAL MEDIO

**Estado posterior al corte (2026-09-21): corregido.** Las reglas de plan, vencimiento, gracia, exención, módulos y decisión de ruta se extrajeron a `js/services/subscriptionAccessService.js`. `main.js` conserva la orquestación del router y Mi Cuenta consume el mismo contrato. La regresión M1 cubre los estados que pueden permitir, redirigir o bloquear acceso; ver [16-estado-implementacion.md](16-estado-implementacion.md).

Depende de (imports estáticos + dynamic_import confirmados): `uiUtils.js`, `security.js`,
`app-support-chat.js`, `bankPaymentService.js`, `notificaciones.js`, y carga dinámica de **~20 módulos de
negocio**: `reservas.js`, `terraza.js`, `pagos-bancarios.js`, `caja.js`, `tienda.js`, `clientes.js`,
`restaurante.js`, `integraciones.js`, `ops-saas.js`, `habitaciones.js`, `mapa-habitaciones.js`,
`usuarios.js`, `dashboard.js`, `limpieza.js`, entre otros.

**Si se modifica `main.js`, ¿qué puede romperse?** Como es el único router de la SPA, un error aquí
(en `router()`, `initializeApp()` o en las reglas de `isModuleAllowedByPlan`/
`calculateSubscriptionExpiredStatus`) puede impedir el acceso a **todos** los módulos simultáneamente —
es el punto único de fallo más amplio del frontend (ver §3). No es "mal diseño" que exista un único
router; es el patrón esperado. El riesgo específico es que la lógica de negocio de suscripción/plan vive
mezclada con el bootstrap de sesión, así que un bug en el cálculo de vencimiento de plan puede bloquear
el router para *todos* los hoteles, no solo afectar la pantalla de facturación.

**Severidad: MEDIUM-HIGH** (alto impacto si falla, pero superficie de cambio más pequeña y menos
frecuente que `uiUtils.js` o `reservas.js`).

### 2.5 `js/services/hotelTimeZoneService.js` (degree 36, 354 líneas) — BAJO RIESGO

Importadores confirmados: `dashboard.js`, `mapa-consumos-pagos-enhancer.js`,
`tarifas-programadas-simulador-bootstrap.js`, `mapa-tarifas-programadas-bootstrap.js`,
`reportes-centro-core.js`, `supabaseClient.js` (!), `tarifasProgramadasService.js`,
`historial-movimientos.js`, `mapa-fechas-abonos-inline.js`, `bitacora.js`, `configuracion.js` — **≈16
archivos**.

Dato relevante verificado en el grafo: `js/supabaseClient.js:L4` importa `hotelTimeZoneService.js`
(`createHotelTimeZoneAwareSupabaseClient()`), es decir, el cliente central de Supabase depende del
servicio de zona horaria, no al revés. Esto es una dependencia inusual para un archivo de bootstrap de
infraestructura, pero está acotada a una sola función de conveniencia (envolver el cliente con
consciencia de zona horaria) y no introduce ciclo (no hay import de vuelta desde
`hotelTimeZoneService.js` a `supabaseClient.js`).

**Si se modifica `hotelTimeZoneService.js`, ¿qué puede romperse?** Cálculos de fecha/hora en reportes,
dashboard, bitácora, mapa de tarifas programadas y el propio cliente de Supabase. Como es lógica pura de
conversión de zona horaria (sin mezclar otra cosa), el radio de fallo es predecible: "algo con fechas se
ve mal", no "algo de negocio no relacionado se rompe". Coherente con la migración reciente
"20260903050000_hotel_timezone_systemwide" — es un servicio relativamente nuevo y centralizador, señal de
buena consolidación (antes probablemente cada módulo calculaba fechas por su cuenta).

**Severidad: LOW-MEDIUM.**

### 2.6 `js/modules/caja/caja-movimientos.js` (degree 42, 550 líneas) — RIESGO ACOTADO

Importadores confirmados: solo `caja.js` y `caja-cierre.js` (dentro del propio dominio de caja).
Dependencias salientes: `uiUtils.js`, `security.js`, `bankPaymentService.js`,
`fase1OperationService.js`, `caja-turnos.js`.

**Si se modifica `caja-movimientos.js`, ¿qué puede romperse?** Solo el propio módulo de caja (apertura,
cierre, reporte de cierre, clasificación de movimientos bancarios vs. efectivo) — no hay importadores
fuera de `js/modules/caja/`. Es un buen ejemplo de módulo con alta cohesión interna y bajo acoplamiento
externo: complejo por naturaleza (concilia efectivo + bancario en el cierre de turno, dominio financiero
sensible), pero no es un God File en el sentido de "muchos módulos no relacionados dependen de él".

**Severidad: MEDIUM** (alto impacto financiero si falla — regla de prioridad del proyecto sobre caja —
pero radio de propagación a otros dominios bajo).

### 2.7 `js/modules/pagos-bancarios/pagos-bancarios.js` (degree 82, 1127 líneas)

Importador externo: `main.js` (`dynamic_import`) y `reportes-centro-core.js` (`dynamic_import`).
Depende de `uiUtils.js`, `security.js`, `bankPaymentService.js`, `appUiKit.js`. El 76 % de sus conexiones
(62/82) son internas al archivo.

**Si se modifica:** afecta el flujo de conciliación bancaria (piloto Gmail/Bancolombia) y su vista dentro
del centro de reportes. Al ser consumido por `reportes-centro-core.js` además de `main.js`, un cambio de
contrato en sus exports rompe dos puntos de entrada, no solo uno.

**Severidad: MEDIUM.**

### 2.8 `supabase/functions/bank-email-api/index.ts` + `_shared/bank-email/*`

**Estado posterior al corte (2026-09-21): riesgo mitigado y M2 corregido.** El manifiesto de despliegue declara ahora los cinco consumidores del núcleo, incluido `bank-payment-relation-api`, con entrypoint, `verify_jwt`, autenticación, métodos, modo de error y módulos compartidos mínimos. Una prueba de contrato descubre consumidores no declarados, cruza cada función con `supabase/config.toml`, verifica sus guardas y obliga a que las cinco pasen typecheck, lint y la suite en CI. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`bank-email-api/index.ts` importa de `_shared/bank-email/`: `gmail-message.ts`, `server.ts`, `config.ts`,
`http.ts`, `payment-service.ts`, `pilot-hotel.ts`, `google-oauth.ts`, `gmail-api.ts`,
`candidate-ranking.ts`, `sale-reconciliation.ts`, `oauth-state.ts`.

Esa misma capa `_shared/bank-email/` es importada también por otras Edge Functions del piloto bancario:
`gmail-webhook`, `gmail-watch-renew`, `gmail-oauth-callback`, `bank-payment-relation-api` (confirmado por
las comunidades "Edge Functions Gmail Webhook/Watch", "Gmail - OAuth Callback y API", "Gmail - Parsing de
Mensajes" y "Edge Function bank-payment-relation-api" del reporte, todas construidas sobre los mismos
archivos `_shared/bank-email/*.ts`).

**Si se modifica `_shared/bank-email/server.ts`, `config.ts`, `types.ts` o `gmail-message.ts`, ¿qué puede
romperse?** Potencialmente las 5 Edge Functions del piloto bancario a la vez (bank-email-api,
gmail-webhook, gmail-watch-renew, gmail-oauth-callback, bank-payment-relation-api), ya que todas comparten
el mismo módulo de tipos/parseo/autenticación. Es una buena decisión de reutilización (evita duplicar
parsing de Gmail y auth en 5 archivos), pero convierte a `_shared/bank-email/` en un punto único de fallo
para todo el piloto de conciliación bancaria.

**Severidad: MEDIUM-HIGH** (el piloto bancario ya tiene su propio historial de fases de hardening de
seguridad — ver `docs/security/pre-fase14-*` — lo que sugiere que el equipo ya es consciente de la
sensibilidad de esta capa).

## 3. Puntos únicos de fallo (SPOF)

| Componente | Por qué es SPOF | Justificación de que sea aceptable o no |
|---|---|---|
| `js/supabaseClient.js` | ~20+ archivos lo importan directamente (`main.js`, `authService.js`, `usuarios.js`, todos los `*-bootstrap.js`, `checkoutSuscripcionService.js`, etc.) para obtener el cliente único de Supabase. | **Aceptable por diseño** — es exactamente lo que pide la regla del proyecto ("Toda consulta a la base de datos pasa por Supabase JS client"). Un SPOF intencional y correcto. |
| `js/main.js` (`router()` / `initializeApp()`) | Único punto de entrada que decide qué módulo montar; si falla, ningún módulo carga. | Aceptable como patrón SPA, pero mezclar reglas de suscripción/plan aquí (ver §2.4) amplía innecesariamente la superficie de lo que puede tumbar el router. |
| `js/uiUtils.js` | ~39 módulos dependen de él para feedback/formato **y** para lógica de facturación de habitación. | **No aceptable tal como está** — un SPOF de utilidades genéricas está bien; uno que también concentra lógica de facturación no debería serlo. |
| `_shared/bank-email/*.ts` (Edge Functions) | 5 Edge Functions del piloto bancario comparten el mismo código de parsing/auth/config. | Aceptable como reutilización de backend, con el costo de que un bug en `_shared` puede tumbar las 5 funciones del piloto a la vez — mitigarlo requeriría tests de contrato por función (el repo ya tiene `tests/bank-email-*.test.cjs`, lo cual reduce el riesgo real). |
| `js/security.js` | Toda la superficie de escape HTML del frontend. | Aceptable — archivo pequeño, sin lógica de negocio, bajo riesgo de romperse por cambios ajenos. |
| Ciclo `modales-alquiler.js ⇄ room-card.js ⇄ modales-gestion.js` | Los 3 archivos deben cargarse y razonarse como una sola unidad para el flujo de alquiler/gestión de habitación. | No es SPOF de disponibilidad, pero sí de **mantenibilidad**: no se puede modificar uno de los tres con confianza sin revisar los otros dos. |

## 4. Acoplamiento excesivo — resumen

- **`uiUtils.js`** está acoplado tanto a nivel de "todos lo importan" (69 conexiones) como a nivel de
  "mezcla capas" (utilidad + negocio). Es el hallazgo de acoplamiento más severo del repo.
- **`reservas.js`** tiene acoplamiento interno excesivo (149/169 conexiones internas, cohesión 0.05): no es
  que otros módulos dependan mal de él, es que sus propias funciones están todas entrelazadas en un solo
  archivo.
- **`pagos-bancarios.js`** tiene el mismo patrón que `reservas.js` en menor escala (62/82 conexiones
  internas) pero es aceptable porque el archivo completo pertenece a un solo dominio cohesivo.
- **`caja-movimientos.js`** y **`security.js`** son los contraejemplos correctos: alta centralidad sin
  mezclar dominios.
- El ciclo de `mapa-habitaciones` es el único acoplamiento circular confirmado en todo el grafo (0 ciclos
  adicionales reportados por graphify en 5389 nodos / 11031 edges).

## 5. Límites del análisis

- Estas cifras de "importadores" reflejan el grafo estático construido por graphify a partir del AST
  (96% EXTRACTED / 4% INFERRED según el reporte); no reflejan qué rutas se ejecutan realmente en
  producción ni la frecuencia de cambio de cada archivo (eso requeriría cruzar con `git log`).
- No se validó el estado en vivo de Supabase (RLS, funciones desplegadas) — el análisis de dependencias
  de backend se limita a lo que hay en `supabase/functions/` y `supabase/migrations/` versionados.
