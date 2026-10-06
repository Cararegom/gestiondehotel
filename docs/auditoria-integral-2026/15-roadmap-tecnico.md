# 15 — Roadmap Técnico

Secuenciación temporal del [14-plan-de-mejoras.md](14-plan-de-mejoras.md). Cada fase asume que la anterior está cerrada y verificada antes de avanzar — no en paralelo, salvo que se indique.

> Estado operativo posterior al corte: consultar [16-estado-implementacion.md](16-estado-implementacion.md). C1–C7, A3–A18, M1–M17 y B1–B12 están corregidos y verificados (M9 quedó absorbido por A17 y M11 por A11). El cierre técnico de producción se completó el 2026-10-05 en Supabase y Vercel. La aceptación manual con datos reales del hotel sigue pendiente donde aplica.

## Fase 0 — Emergencia de seguridad (hoy, antes de cualquier otra cosa)

- **C1** — `crear_colaborador` sin autenticación
- **C2** — `actualizar_permisos_usuario` sin autenticación

Estos dos hallazgos permiten comprometer cualquier hotel del SaaS sin credenciales. No requieren coordinación con otros dominios ni tocan datos financieros históricos — son parches acotados a dos Edge Functions. Deben resolverse o al menos mitigarse (ej. deshabilitar temporalmente el endpoint si el flujo de alta de colaboradores no es de uso diario) antes de continuar con cualquier otra fase.

## Fase 1 — Crítico financiero (esta semana)

- **C3** — `send-cash-close-report` sin validar hotel
- **C4** — `liquidar_consumos_reserva_atomico` sin validar monto
- **C5** — Pedidos web huérfanos en tienda
- **C6** — Fix perdido de `control-energia.js` (aplicar el fix ya existente al archivo correcto — es la corrección más barata de toda la lista)
- **C7** — Filtro de fechas UTC en `clientes.js`

Estos cinco son independientes entre sí y pueden abordarse en paralelo por distintas personas si hay más de un desarrollador disponible. Ninguno requiere rediseño de arquitectura — son correcciones acotadas con esfuerzo S-M.

## Fase 2 — Estabilización (próximas 2-4 semanas)

Hallazgos ALTO que afectan seguridad frontend, timezone en superficies de negocio, y fallos silenciosos:

- **A3** — Alegra origin-only: corregido y verificado técnicamente en Supabase staging; aceptación funcional y producción pendientes
- **A4, A5** — XSS almacenado corregido, probado y verificado en preview; aceptación funcional y producción pendientes
- **A6** — Timezone en reportes gerenciales corregido, probado y verificado en preview; aceptación funcional y producción pendientes
- **A7** — Timezone en checkout de reservas corregido, probado y verificado en preview; aceptación funcional y producción pendientes
- **A12** — Timezone en reportes de caja corregido, probado y verificado en preview; aceptación funcional y producción pendientes
- **A8** — Asimetría de lock en pagos bancarios corregida, probada y verificada en Supabase staging; aceptación funcional y producción pendientes
- **A9** — Instrumentación de Sentry en `reservas/*` y `caja/*` corregida, probada y verificada en preview; aceptación funcional y producción pendientes
- **A10** — Fail-closed en validación de cruce de reservas corregido, probado y verificado en preview; aceptación funcional y producción pendientes
- **A11** — Paginación de reportes corregida, probada y verificada en preview; aceptación funcional y producción pendientes
- **A18** — Documentación de roadmap corregida y alineada con el estado real de multi-propiedad

Al cierre de esta fase, los dominios de mayor sensibilidad financiera y de seguridad (caja, reservas, timezone, seguridad) deberían quedar sin hallazgos CRÍTICO ni ALTO pendientes.

## Fase 3 — Deuda técnica y consolidación (próximo trimestre)

Hallazgos que no representan riesgo inmediato pero degradan mantenibilidad:

- **A13, A14** — Corregidos y probados: creación, check-in, checkout y cronómetro son transaccionales; Supabase staging verificado, aceptación funcional y producción pendientes
- **A15, A16** — Corregidos y probados: POS/pedidos web comparten núcleo transaccional y el ajuste manual usa una RPC con bloqueo; Supabase staging y preview verificados, aceptación funcional y producción pendientes
- **A17** — Corregido y probado: `mantenimiento_planes` es el único motor de recurrencia, las tareas abiertas legacy se migran sin borrar historial y Supabase staging quedó verificado; aceptación funcional y producción pendientes
- **M1** — Corregido y probado: las reglas de suscripción/plan se extrajeron del router a un servicio compartido con Mi Cuenta; preview verificado y producción pendiente
- **M2** — Corregido y probado: los cinco consumidores del núcleo bancario tienen un contrato de despliegue verificable y controles obligatorios de compilación, lint y regresión en CI
- **M3** — Corregido y probado: posibles notificaciones bancarias duplicadas se serializan y pasan a revisión manual sin eliminar eventos ni elegir automáticamente entre pagos legítimos
- **M4** — Corregido: documentación de conciliación actualizada con la API de recepción, `caja_id`, RPC vigentes, checkout y estado real de las Fases 1–25
- **M5** — Corregido y probado: el cierre incluye métodos activos y usados, persiste conteos por UUID, falla cerrado ante un arqueo incompleto y quedó verificado en Supabase staging y preview
- **M6** — Corregido y probado: Caja usa referencias normalizadas y `source`, conserva ingresos no vinculados en “Otros ingresos” y cuenta habitaciones desde `reservas`/`habitaciones`; preview verificado
- **M7** — Corregido y probado: Reservas comparte estados operativos entre listado, filtros, KPIs, acciones y detección de cruces; Supabase staging y preview verificados
- **M8** — Resuelto por C5 y consolidado por A15: la entrega web registra cada salida en `movimientos_inventario` dentro del mismo núcleo transaccional de ventas; staging y pruebas verificados
- **M10** — Corregido y probado: la composición activa de Mantenimiento usa eventos explícitos y atributos semánticos; se retiraron los observers globales y los selectores por texto/clases; preview verificado
- **M11** — Resuelto por A11 y revalidado: Ocupación, KPIs y las demás fuentes voluminosas usan el servicio paginado, orden estable y descarte de resultados parciales; preview verificado
- **M12** — Corregido y probado: la reconciliación del mapa agrupa habitaciones por estado operativo, reduce N peticiones a un máximo de dos y conserva pendientes los fallos parciales
- **M13** — Corregido y probado: las fechas de pagos reaccionan al evento explícito del modal, tienen mount/unmount y consultan la reserva conocida sin polling ni búsquedas intermedias
- **M14** — Corregido y probado: el rango inicial de Reportes usa la fecha operativa del hotel en ambas superficies y ya no deriva fechas de calendario mediante UTC
- **M15** — Corregido y probado: la conciliación distingue la zona fuente del banco de la zona operativa del hotel y elimina offsets manuales
- **M16** — Corregido como control de deuda y probado: el estado documental refleja 3289 líneas y CI impide que `reservas.js` vuelva a crecer
- **M17** — Corregido y probado: las extensiones del shell tienen inventario versionado y contratos cruzados con sus módulos base
- Hallazgos **MEDIO** pendientes de [13-riesgos-priorizados.md](13-riesgos-priorizados.md): ninguno (M9 quedó absorbido por A17)
- **B1** — Corregido, probado y verificado en staging: las funciones de gestión de usuarios ya no publican CORS `*` y rechazan orígenes web ajenos
- **B2** — Corregido antes del corte y revalidado: la migración que admite movimientos manuales sin turno está aplicada en staging y coincide con el contrato del frontend
- **B3** — Corregido y probado: el panel administrativo usa `caja_reversiones` y dejó de presentar como vigente el log congelado de eliminaciones
- **B4** — Corregido y probado: Reservas distingue estados canónicos de valores heredados; el guard de base de datos impide nuevas escrituras legacy sin borrar historial y staging/preview quedaron verificados
- **B5** — Corregido y probado: la función obsoleta `descontar_stock_por_venta` se retiró con una migración acotada y staging confirmó su ausencia
- **B6** — Corregido y probado: el POS filtra categorías por `hotel_id` en el cliente y conserva RLS como defensa adicional; preview verificado
- **B7** — Corregido y probado: la implementación desktop obsoleta de Mantenimiento fue confirmada fuera de la cadena activa, retirada y verificada en preview
- **B8** — Corregido y probado: el modal base de Mantenimiento usa el vocabulario canónico y el workflow dejó de neutralizar un selector legado
- **B9** — Corregido y probado: el calendario exige la zona horaria configurada del hotel, usa el servicio central y muestra un error visible si falta
- **B10** — Corregido y probado: la fecha impresa del corte de Caja usa la zona operativa central del hotel
- **B11** — Corregido y probado: se retiraron los helpers de deduplicación en memoria sin consumidores, conservando la huella activa y la idempotencia persistente
- **B12** — Corregido y probado: se retiraron los tres MP4 locales sin consumidores y el respaldo RAR versionado; Git y Vercel previenen su reaparición
- Hallazgos **BAJO** pendientes: ninguno
- Limpieza de código muerto confirmado con evidencia (B3, B5, B7, B11) — completada y protegida por pruebas

## Fase 4 — Refactor arquitectónico mayor (a evaluar, no comprometido a fecha)

Estos dos requieren un proyecto dedicado, no una tarea de sprint:

- **A1** — Dividir `js/uiUtils.js` (69 conexiones)
- **A2** — Dividir `js/modules/reservas/reservas.js` (3291 líneas) siguiendo el patrón de `mantenimiento`

Recomendación: no iniciar la Fase 4 hasta que las Fases 0-2 estén cerradas y verificadas en producción durante al menos un ciclo de facturación completo, dado que ambos archivos tocan el núcleo de ingresos del sistema.

## Explícitamente fuera de este roadmap (no tocar)

- Las RPCs financieras atómicas ya correctas.
- `js/security.js` y `hotelTimeZoneService.js` en sí mismos (el trabajo está en quién los usa, no en ellos).
- La convención `archive/legacy/`.
- El módulo de mantenimiento como plantilla arquitectónica (sí se toca su duplicación de recurrencia en Fase 3, pero no su separación domain/repository/UI).
- `prueba-google-watch/`.

## Nota sobre paralelismo entre fases

Las Fases 0 y 1 son bloqueantes y secuenciales por diseño (seguridad antes que todo). A partir de la Fase 2, los hallazgos son en su mayoría independientes por dominio y pueden distribuirse entre desarrolladores en paralelo — la matriz de [13-riesgos-priorizados.md](13-riesgos-priorizados.md) indica el dominio de cada uno para facilitar esa asignación.

Este roadmap no reemplaza la necesidad de re-auditar contra Supabase en vivo (producción/staging) antes de dar por cerrado cualquier hallazgo CRÍTICO — toda esta auditoría se hizo sobre código y migraciones versionadas, sin acceso MCP en vivo a la base de datos.
