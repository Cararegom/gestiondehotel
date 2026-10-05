# 01 — Resumen Ejecutivo

**Auditoría técnica integral — Gestión de Hotel (SaaS)**
Fecha: 2026-09-07 · Commit auditado: `e191845` (rama `integracion-posthog`)
Alcance: 100% del repositorio (frontend JS, 127 migraciones SQL, 33 Edge Functions, documentación histórica).

> **Estado operativo posterior al corte (2026-09-21):** C1–C7, A3–A18 y M1–M3 están implementados y verificados. Las correcciones remotas aplicables se validaron exclusivamente en staging o previews; A17 unificó la recurrencia de mantenimiento en `mantenimiento_planes`, M3 añadió revisión conservadora de posibles correos bancarios duplicados, y producción continúa pendiente de aprobación explícita. El detalle y la evidencia actual están en [16-estado-implementacion.md](16-estado-implementacion.md).

## Metodología

Esta auditoría se hizo en dos fases:

1. **Orientación con grafo de conocimiento (graphify).** Se construyó previamente un grafo de 6013 nodos / 12967 edges / 460 comunidades sobre todo el repositorio (código + documentación), con extracción estructural (AST) para código y semántica (LLM) para documentos. El grafo se usó para identificar God Files, ciclos de dependencia, comunidades funcionales y nodos puente antes de leer una sola línea de código.
2. **Verificación dirigida por dominio.** Diez subagentes especializados, cada uno con un dominio de negocio acotado (arquitectura, reservas/habitaciones, caja, pagos bancarios, seguridad/RLS, timezone, mantenimiento, tienda, performance/observabilidad, deuda técnica), usaron el grafo para localizar los archivos relevantes y luego **verificaron cada hallazgo abriendo el código y las migraciones SQL reales** — nunca se reportó una relación `INFERRED` del grafo como hecho sin confirmarla en el código.

**Limitación declarada en todos los documentos:** no hubo acceso MCP en vivo a la base de datos de producción ni a Sentry. Todo lo referente a Supabase se auditó contra las 127 migraciones SQL versionadas en `supabase/migrations/`, asumiendo que reflejan lo desplegado. Esto es una limitación real, no una excusa: se recomienda una verificación puntual contra producción de los hallazgos CRÍTICOS antes de descartarlos.

No se modificó código, no se hicieron commits/push, no se ejecutaron migraciones ni cambios en Supabase. Esta fase es 100% diagnóstica.

## 1. Estado general del sistema

Gestión de Hotel es un SaaS con **1 año de operación real** en 2 hoteles propios, con un núcleo financiero (caja, reservas, pagos bancarios) que muestra **madurez real**: la mayoría de las operaciones de dinero pasan por RPCs `SECURITY DEFINER` atómicas, con `FOR UPDATE`, idempotencia por `client_operation_id` y auditoría — patrones que NO son triviales y que el equipo aplicó consistentemente después de una auditoría financiera previa extensa (`docs/auditoria-financiera/`, 24 documentos) y una auditoría RLS previa (`docs/security/pre-fase14-*`) que sí se cerraron con evidencia verificable en el código actual.

Sin embargo, la auditoría encontró **7 hallazgos CRÍTICOS explotables o con pérdida financiera silenciosa real**, dos de ellos de gravedad máxima: dos Edge Functions permiten crear administradores y escalar privilegios **sin ninguna autenticación**, en cualquier hotel del SaaS. Esto contradice de forma directa la regla crítica #3 del proyecto (aislamiento por `hotel_id`) y es la prioridad número uno, por encima de cualquier otro hallazgo de esta auditoría.

El resto del sistema tiene una salud mixta pero manejable: deuda técnica real y localizada (dos motores de recurrencia en mantenimiento, dos implementaciones de venta en tienda, un fix de producción que quedó en un archivo muerto), gaps de timezone confirmados con evidencia de código (no hipotéticos), y un God File (`js/uiUtils.js`) que mezcla utilidades puras con lógica de negocio de forma peligrosa. Nada de esto es exótico para un producto de 1 año en producción real — es deuda acumulada normal, pero ya identificada con precisión archivo:línea.

## 2. Los 10 riesgos más importantes

| # | Riesgo | Dominio | Severidad | Evidencia |
|---|---|---|---|---|
| 1 | `crear_colaborador` (Edge Function) crea cuentas de Administrador sin validar auth — explotable por cualquier visitante anónimo | Seguridad/RLS | **CRITICAL** | [07](07-seguridad-rls.md#11-crear_colaborador--creación-de-cuentas-de-staff-sin-autenticación-critical) |
| 2 | `actualizar_permisos_usuario` (Edge Function) permite auto-escalación de privilegios cross-tenant sin auth | Seguridad/RLS | **CRITICAL** | [07](07-seguridad-rls.md#12-actualizar_permisos_usuario--escalación-de-privilegios-cross-tenant-sin-autenticación-critical) |
| 3 | `send-cash-close-report` no valida que el llamante pertenezca al hotel del reporte — permite enviar correos de "cierre de caja" falsos a otro hotel | Caja/Finanzas | **CRITICAL** | [05](05-caja-finanzas.md#h-01--critical) |
| 4 | `liquidar_consumos_reserva_atomico` puede marcar deuda de consumos como pagada sin verificar el monto — RPC invocable directamente | Reservas/Habitaciones | **CRITICAL** | [04](04-reservas-habitaciones.md#hallazgo-1-critical) |
| 5 | Pedidos web de tienda entregados sin reserva activa quedan huérfanos: stock descontado, cobro perdido para siempre | Tienda/Inventario | **CRITICAL** | [10](10-tienda-inventario.md#h1--critical) |
| 6 | Fix de producción real (bloqueo de cámara QR) se aplicó a `control-energia.js`, pero el import map sirve `control-energia-20260902.js` — el bug sigue vivo | Deuda Técnica | **CRITICAL** | [12](12-deuda-tecnica.md#2-implementación-paralela-viva) |
| 7 | Filtro de fechas en `clientes.js` usa `.lt()` con UTC "pelado" que el proxy de timezone global no intercepta — pierde/gana clientes por hasta 5 horas | Timezone | **CRITICAL** | [08](08-timezone-fechas.md#41-critical) |
| 8 | `reservas.js` (3291 líneas, cohesión interna 0.05 — la más baja del grafo) concentra excesiva lógica del dominio de mayor tráfico diario | Arquitectura | HIGH | [03](03-mapa-dependencias.md#23-jsmodulesreservasreservasjs) |
| 9 | `js/uiUtils.js` mezcla utilidades puras con lógica de negocio crítica (facturación Alegra, descuentos) usado por 39+ módulos de 15+ dominios | Arquitectura | HIGH | [03](03-mapa-dependencias.md#21-jsuiutilsjs) |
| 10 | **Corregido y probado mediante A9:** Reservas y Caja reportan sus fallos manejados con códigos estables y sin copiar datos del negocio a Sentry | Performance/Observabilidad | HIGH | [11](11-performance.md#hallazgo-a-1-high) |

Ver [13-riesgos-priorizados.md](13-riesgos-priorizados.md) para la matriz completa con los ~45 hallazgos de los 10 documentos de dominio.

## 3. Los 10 puntos arquitectónicos mejor resueltos

1. **RPCs financieras atómicas con idempotencia real.** `procesar_pago_reserva_atomico`, `cancelar_reserva_con_reversion`, `cambiar_habitacion_transaccion`, `registrar_movimiento_caja_atomico`, `procesar_venta_tienda_atomica` — todas usan `FOR UPDATE`, `client_operation_id` y validan tenant. Es el patrón a replicar, no a tocar.
2. **Cierre de caja recalcula el "esperado" en el servidor**, no confía en lo que envía el cliente — el arqueo de cierre está protegido contra manipulación del frontend.
3. **Concurrencia real en conciliación bancaria**: `FOR UPDATE SKIP LOCKED` en la cola Pub/Sub, `pg_advisory_xact_lock` en el matching de pagos del lado de ventas.
4. **`hotelTimeZoneService.js`** es un servicio centralizado de buena calidad, y el puente automático `createHotelTimeZoneAwareSupabaseClient` corrige silenciosamente el patrón legado de corte UTC en cualquier módulo que use el patrón estándar — una red de seguridad elegante ya en producción.
5. **Control de energía y bloqueo de habitación por mantenimiento resueltos con triggers de base de datos**, no solo en JS — los estados imposibles pedidos explícitamente en el alcance de esta auditoría ("habitación limpia con control de energía pendiente") están descartados con evidencia real de trigger.
6. **Módulo de mantenimiento**: la mejor separación de responsabilidades del repo (repository/domain/UI/mobile-ui), con una máquina de estados de tareas que vive en el servidor (`mantenimiento_transicionar_tarea()`), no en el cliente.
7. **Corrección proactiva de vulnerabilidades cross-tenant previas** (`actualizar_compra_y_detalles`, `cambiar_habitacion_transaccion`) — verificadas como efectivamente corregidas y sin regresión en ninguna de las ~50 migraciones posteriores.
8. **Costeo/CMV enganchado vía triggers sobre tablas de hechos**, no dentro de cada RPC de venta — resiliente a los distintos caminos de venta sin duplicar el cálculo.
9. **`js/security.js`** (`escapeHtml`/`escapeAttribute`/`sanitizeUrl`) estaba bien adoptado en los módulos de mayor tráfico (reservas, caja, mapa de habitaciones); A4/A5 extendieron esa cobertura a Clientes y Usuarios después del corte auditado.
10. **Convención `archive/legacy/`** sigue vigente al 100%: verificado que ninguno de los archivos ya archivados tiene consumidor activo hoy — la disciplina de limpieza del equipo funciona cuando se aplica.

## 4. Archivos de mayor riesgo al modificar

| Archivo | Por qué | Radio de impacto |
|---|---|---|
| `js/uiUtils.js` | 69 conexiones, mezcla utilidades UI con lógica de negocio (Alegra, descuentos) | ~39 módulos de 15+ dominios funcionales |
| `js/modules/reservas/reservas.js` | 3291 líneas, cohesión interna 0.05 (la más baja del grafo) | Reservas + Caja (dominio de mayor tráfico diario) |
| `js/main.js` | Orquestador central, mezcla router/bootstrap con reglas de negocio de suscripción | Acceso a todos los módulos simultáneamente |
| `js/services/hotelTimeZoneService.js` | 36 conexiones, pero bien acotado (bajo riesgo real pese a la centralidad) | Todo módulo que calcule fechas — pero el diseño es sólido |
| `js/security.js` | 44 conexiones, pero 100% utilidades puras verificadas | Todo el frontend — cambios aquí son de alto impacto pero bajo riesgo si se prueban bien |
| `js/supabaseClient.js` | El cliente único de Supabase — 19 importadores directos verificados | Todo módulo que lea/escriba datos |
| `supabase/functions/_shared/bank-email/*.ts` | SPOF de 5 Edge Functions bancarias (parsing/auth/config compartido) | Todo el piloto de conciliación bancaria |
| `js/modules/tienda/helpers.js` | 9 de 10 archivos del módulo tienda dependen de él; mezcla 4 responsabilidades | Todo el dominio de tienda |

Ver [03-mapa-dependencias.md](03-mapa-dependencias.md) para el radio de impacto completo, verificado con `graphify explain`.

## 5. Módulos que necesitan refactor

- **`js/modules/reservas/reservas.js`** — dividir siguiendo el patrón ya usado en mantenimiento (domain/repository/UI). Ya existe extracción parcial (`reservas-calculos.js`, `reservas-estado.js`, etc.) pero el archivo principal volvió a crecer después de un refactor previo que se dio por "completado" en `docs/revision-modulos-especial.md`.
- **`js/uiUtils.js`** — extraer la lógica de negocio (Alegra, descuentos, impresión de tickets) a servicios dedicados, dejando solo utilidades puras.
- **`js/modules/tienda/helpers.js`** — dividir en autorización/roles, lógica de turno de caja, CSS-in-JS y utilidades de DOM.
- **Módulo de mantenimiento** — no por mala calidad, sino por duplicación real: unificar los dos motores de recurrencia (nuevo `mantenimiento_planes` vs legado `tareas_mantenimiento.frecuencia`) antes de seguir construyendo sobre el legado.
- **`supabase/functions/actualizar_permisos_usuario` y `crear_colaborador`** — no es refactor, es una reescritura urgente con validación de autenticación (ver Sección 6).

## 6. Problemas críticos de Supabase/RLS

Los dos hallazgos #1 y #2 de la sección 2 son los más graves de toda la auditoría: **dos Edge Functions con `service_role` no validan el header `Authorization` en absoluto**, permitiendo a cualquier persona con la anon key pública (ya distribuida en el frontend) crear administradores o escalar sus propios permisos en cualquier hotel del sistema. Además:
- La familia `alegra-*` (facturación de terceros) solo verifica `Origin`, trivialmente evadible.
- Las correcciones cross-tenant de la auditoría pre-Fase 14 siguen vigentes y sin regresión — el problema no está en el núcleo RLS ya auditado, sino en Edge Functions construidas después que nunca pasaron por ese proceso de revisión.

Ver [07-seguridad-rls.md](07-seguridad-rls.md) para el detalle completo con escenarios de explotación y corrección propuesta.

## 7. Problemas financieros

- Pérdida de deuda de consumos por RPC sin validación de monto (reservas).
- Correo de cierre de caja enviable a hotel equivocado sin autorización.
- Pedidos web de tienda que descuentan stock sin cobrar (huérfanos).
- Asimetría de bloqueo de concurrencia entre ventas y reservas en conciliación bancaria manual, corregida después del corte mediante A8 y validada en Supabase staging.
- Dinero en métodos de pago desactivados puede quedar fuera del arqueo de cierre.

Ninguno de estos afecta las correcciones ya cerradas de la auditoría financiera previa (verificadas vigentes) — son hallazgos nuevos, en superficies que esa auditoría no cubrió.

## 8. Problemas de timezone

Confirmados con evidencia de código, no hipotéticos: filtro de clientes pierde/gana registros por hasta 5 horas (CRITICAL), reportes gerenciales agrupan "por día de la semana" con `getUTCDay()` (HIGH, sesga cifras de ocupación/ingresos), y el cálculo de checkout de reservas usa la zona horaria del navegador, no la del hotel (HIGH). El diseño centralizado (`hotelTimeZoneService.js` + proxy automático en `supabaseClient.js`) es correcto — el problema es que varios módulos, especialmente los más antiguos, todavía no lo usan.

## 9. Qué corregir primero

1. **Hoy, antes que nada:** desactivar o parchear `crear_colaborador` y `actualizar_permisos_usuario` (agregar validación de JWT + rol admin + hotel_id, siguiendo el patrón ya correcto de `manage-user-lifecycle`).
2. **Esta semana:** los 5 CRITICAL financieros restantes (`send-cash-close-report`, `liquidar_consumos_reserva_atomico`, pedidos web huérfanos, filtro de fechas de clientes, fix perdido de control-energia).
3. **Este mes:** completar aceptación/producción de los HIGH de seguridad frontend ya implementados y corregir los HIGH de timezone en reportes/reservas.

Ver [14-plan-de-mejoras.md](14-plan-de-mejoras.md) y [15-roadmap-tecnico.md](15-roadmap-tecnico.md) para el plan completo secuenciado.

## 10. Qué NO deberíamos tocar por ahora

- Las RPCs financieras atómicas ya correctas (punto 1 y 2 de la sección 3) — funcionan, están probadas por un año de producción real, y tocarlas sin necesidad introduce más riesgo que beneficio.
- `js/security.js` y `hotelTimeZoneService.js` — su diseño es correcto pese a su alta centralidad; el problema está en quién NO los usa, no en ellos.
- La convención `archive/legacy/` — sigue funcionando, no hay nada que limpiar ahí.
- El módulo de mantenimiento (domain/repository/UI) — es la plantilla a copiar, no a rehacer.
- `prueba-google-watch/` — proyecto de prueba correctamente aislado, sin consumidores del sistema real.
