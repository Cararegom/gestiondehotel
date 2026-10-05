 # 14 — Plan de Mejoras

**Este documento NO implementa nada.** Es la propuesta de corrección para cada hallazgo de [13-riesgos-priorizados.md](13-riesgos-priorizados.md), con esfuerzo estimado y riesgo de no corregir. La secuencia temporal está en [15-roadmap-tecnico.md](15-roadmap-tecnico.md).

Esfuerzo: **S** (horas), **M** (1-3 días), **L** (más de 3 días / requiere diseño previo).

## CRÍTICO

### C1 + C2 — Edge Functions sin autenticación (`crear_colaborador`, `actualizar_permisos_usuario`)
**Corrección propuesta:** replicar el patrón ya correcto de `manage-user-lifecycle/index.ts` — validar el JWT del `Authorization` header, resolver el rol y `hotel_id` reales del actor desde `auth.uid()`, y rechazar si el `hotel_id`/rol del body no coincide con lo que el actor puede administrar. Mientras se implementa el fix definitivo, considerar desactivar temporalmente la función o restringirla con un secreto compartido adicional si el flujo de negocio lo permite.
**Esfuerzo:** M (requiere pruebas de regresión sobre el flujo de alta de colaboradores y cambio de permisos, usado en producción).
**Riesgo de no corregir:** compromiso total de cualquier hotel del SaaS por un actor externo sin credenciales.

### C3 — `send-cash-close-report` sin validar hotel del llamante
**Corrección propuesta:** añadir la misma verificación que ya existe en `bank-email-api` (confirmar que `auth.uid()` pertenece a `hotelId` vía `public.usuarios` antes de resolver destinatarios y enviar).
**Esfuerzo:** S.
**Riesgo de no corregir:** un usuario de un hotel puede hacer que la plataforma envíe correos falsificados con apariencia oficial a otro hotel.

### C4 — `liquidar_consumos_reserva_atomico` sin validar monto
**Estado posterior al corte:** corregido, probado y aplicado en Supabase staging. La implementación recalcula la cuenta completa en servidor y rechaza la liquidación si los pagos acumulados no cubren la deuda cobrable. Ver [16-estado-implementacion.md](16-estado-implementacion.md).
**Corrección propuesta:** la RPC debe recibir y verificar el monto pagado contra la deuda real de consumos antes de marcar como `pagado`, o restringir su invocación exclusivamente al flujo interno de "Pagar todo" (revocando el permiso de ejecución directa a `authenticated` y exponiendo solo una función wrapper que sí valida).
**Esfuerzo:** M.
**Riesgo de no corregir:** pérdida de ingresos por consumos de reserva, difícil de detectar sin auditoría específica.

### C5 — Pedidos web huérfanos (tienda)
**Estado posterior al corte:** corregido, probado y aplicado en Supabase staging. La entrega falla antes de modificar datos si no encuentra una reserva operativa; el flujo conserva los precios confirmados del pedido y registra venta, detalle, stock, movimiento y auditoría en una sola transacción idempotente. Ver [16-estado-implementacion.md](16-estado-implementacion.md).
**Corrección propuesta:** unificar `actualizar_estado_pedido_web_tienda` para usar la misma lista de "estados de reserva activa" que `modales-gestion.js`, y bloquear la entrega/descuento de stock si no hay una reserva activa asociada (o registrar explícitamente el pedido como "venta directa sin reserva" con su propio cobro, en vez de dejarlo huérfano).
**Esfuerzo:** M-L (toca dos superficies: RPC SQL y flujo de UI de pedidos web).
**Riesgo de no corregir:** pérdida de inventario y de ingresos en cada pedido web sin reserva activa detectada.

### C6 — Fix perdido en `control-energia.js`/`control-energia-20260902.js`
**Estado posterior al corte:** corregido y probado en preview. La aplicación carga directamente la implementación canónica con el fix `55eb53f`; el snapshot fechado ya no duplica lógica y funciona únicamente como puente para clientes cacheados. El import map fue retirado y el service worker se versionó y precarga el asset efectivo. Ver [16-estado-implementacion.md](16-estado-implementacion.md).
**Corrección propuesta:** aplicar el fix del commit `55eb53f` (bloqueo del escáner QR) también a `control-energia-20260902.js`, que es el archivo realmente servido por el import map. A mediano plazo, eliminar la duplicación de archivos y quedarse con uno solo con versionado por query string real, o mover a un pipeline de build que garantice que ambos archivos no puedan divergir.
**Esfuerzo:** S (aplicar el fix) + M (unificar los archivos para prevenir recurrencia).
**Riesgo de no corregir:** el bug de bloqueo de cámara sigue afectando a usuarios reales hoy, pese a que el equipo cree que ya está resuelto.

### C7 — Filtro de fechas UTC en `clientes.js`
**Estado posterior al corte:** corregido y probado en preview. `getClientes()` construye explícitamente el intervalo UTC desde la zona horaria activa del hotel, con límite final exclusivo y sin aritmética basada en `new Date('YYYY-MM-DD')`. Ver [16-estado-implementacion.md](16-estado-implementacion.md).
**Corrección propuesta:** extender el proxy `createHotelTimeZoneAwareSupabaseClient` para interceptar también `.lt()`/`.gt()` con el mismo patrón de detección, o reescribir `getClientes` para construir los límites de fecha explícitamente con `hotelTimeZoneService.js` en vez de depender del proxy implícito.
**Esfuerzo:** S-M.
**Riesgo de no corregir:** listados y exportes de clientes con datos incorrectos en cada consulta con rango de fechas, para todos los hoteles fuera de UTC.

## ALTO

### A1 — `js/uiUtils.js` mezcla utilidades con lógica de negocio
**Corrección propuesta:** extraer `notificarAlegraViaZapier()`, `registrarUsoDescuento()`, `showConsumosYFacturarModal()` y similares a servicios dedicados (`alegraService.js`, `descuentosService.js` ya existe — consolidar ahí), dejando `uiUtils.js` con solo utilidades puras (`escapeHtml`, `formatCurrency`, `showError`, etc.).
**Esfuerzo:** L (69 conexiones a verificar una por una).
**Riesgo de no corregir:** cualquier cambio en una utilidad pura arriesga romper lógica de negocio no relacionada, y viceversa.

### A2 — `reservas.js` sobre-concentrado
**Corrección propuesta:** completar la extracción ya iniciada (`reservas-calculos.js`, `reservas-estado.js`, `reservas-pagos.js`, etc.) siguiendo el patrón de `mantenimiento` (domain/repository/UI), con un plan de migración incremental módulo por módulo y tests de regresión antes de cada extracción.
**Esfuerzo:** L (proyecto de varias semanas, no una tarea puntual).
**Riesgo de no corregir:** el archivo de mayor tráfico diario sigue siendo el más frágil de modificar con seguridad.

### A3 — Familia `alegra-*` solo valida `Origin`
**Estado posterior al corte (2026-09-11):** implementado, probado y desplegado en Supabase staging para las tres funciones auditadas y `alegra-zapier-notify`, que repetía el mismo patrón. Todas exigen JWT y pertenencia activa al hotel; las acciones de configuración/prueba requieren además administrador. `service_role` se crea después de autorizar y `verify_jwt=true` quedó explícito. Aceptación funcional y producción pendientes.
**Corrección propuesta:** añadir la misma validación de JWT + hotel_id que las demás Edge Functions correctas.
**Esfuerzo:** S.

### A4 + A5 — XSS en `clientes.js` y `usuarios.js`
**Estado posterior al corte (2026-09-11):** implementado y probado. Ambos módulos importan `escapeHtml`/`escapeAttribute` desde `js/security.js`; se protegieron los puntos auditados y las superficies equivalentes que reutilizan datos persistidos. El preview de Vercel fue verificado y producción sigue pendiente de aprobación.
**Corrección propuesta:** aplicar `escapeHtml`/`escapeAttribute` de `js/security.js` en los puntos exactos señalados en [07 §3](07-seguridad-rls.md) y reutilizar directamente esos helpers centrales en ambos módulos.
**Esfuerzo:** S por archivo.
**Riesgo de no corregir:** XSS almacenado en dos de los módulos de mayor privilegio.

### A6 + A7 — Timezone en reportes y checkout de reservas
**Estado posterior al corte (2026-09-12):** A6 y A7 están implementados, probados y verificados en preview. Reportes usa un servicio dedicado para rangos y métricas; Reservas y el alquiler directo del Mapa usan `hotelTimeZoneService.js` para interpretar entradas y calcular checkout en la zona operativa.
**Corrección propuesta:** reemplazar `getUTCDay()`/`getUTCDate()` por el equivalente de `hotelTimeZoneService.js`; importar el servicio en `reservas-calculos.js` y usarlo para `calculateNearestCheckoutDate`.
**Esfuerzo:** M por archivo (requiere revisar todos los puntos de uso de fechas en `reportes.js`).

### A8 — Asimetría de lock en pagos bancarios (reservas vs ventas)
**Estado posterior al corte (2026-09-12):** implementado, probado y aplicado en Supabase staging. La protección vive en un trigger transaccional sobre `bank_payment_allocations`, adquiere un advisory lock por hotel/reserva y recalcula la capacidad antes de cada escritura. El wrapper de Recepción conserva la validación exacta de Caja mediante un contexto limitado a esa transacción. Producción sigue pendiente de aprobación.
**Corrección propuesta:** replicar `pg_advisory_xact_lock` en la ruta de asignación manual a reservas.
**Esfuerzo:** S-M.

### A9 — Falta de Sentry en módulos críticos
**Estado posterior al corte (2026-09-12):** implementado y probado para `reservas/*` y `caja/*`. Un reporter central usa `HotelMonitoring.captureException`/`HotelTelemetry` con códigos estables de operación, sin copiar mensajes ni datos del error original, y nunca interrumpe el flujo si Sentry falla. El build, la conexión de solo lectura a Sentry y los assets del preview de Vercel se verificaron. Producción no fue modificada.
**Corrección propuesta:** reemplazar `console.error` por `HotelMonitoring.captureException` en `reservas/*.js` y `caja/*.js`, generalizando el patrón `reportError()` ya existente en `control-energia.js`.
**Esfuerzo:** M (muchos puntos, pero mecánico).

### A10 — Fallo silencioso en validación de cruce de reservas
**Estado posterior al corte (2026-09-12):** implementado, probado y verificado en preview. La ruta activa y la implementación legada usan una validación compartida que solo continúa ante `{ data: boolean, error: null }`; un conflicto real bloquea con su mensaje operativo y cualquier fallo técnico bloquea con un mensaje seguro y se reporta a Sentry. Producción no fue modificada.
**Corrección propuesta:** si el RPC de validación falla, bloquear la creación de la reserva (fail-closed) en vez de continuar como si no hubiera conflicto; reportar el error a Sentry.
**Esfuerzo:** S.
**Riesgo de no corregir:** doble reserva de habitación silenciosa cuando hay problemas de red/timeout.

### A11 — Reportes sin paginación
**Estado posterior al corte (2026-09-13):** implementado, probado y verificado en preview. Un servicio compartido recorre páginas de 1.000 filas sin el corte silencioso anterior y se usa en 20 consultas de reservas, caja, tienda, servicios, lista de espera, tarifas, inspecciones y mantenimiento. Cada consulta tiene orden estable y un fallo intermedio invalida el resultado completo. Producción no fue modificada.
**Corrección propuesta:** aplicar `fetchAllWithPagination` (ya existe y se usa en 3 de 9 reportes) a `fetchKPIData`, `generarReporteOcupacion`, `generarReporteCierresDeCaja`, `generarReporteComparativoGerencial`.
**Esfuerzo:** M.
**Riesgo de no corregir:** cifras de negocio incorrectas sin ningún error visible, para hoteles con volumen medio-alto.

### A12 — Reportes de caja con corte UTC
**Estado posterior al corte (2026-09-13):** implementado, probado y verificado en preview. Todas las rutas auditadas de `reportes.js` construyen intervalos UTC semiabiertos desde la zona horaria activa del hotel; los gráficos diarios, la ocupación y el período anterior del comparativo gerencial usan días calendario del hotel y soportan DST. Producción no fue modificada.
**Corrección propuesta:** mismo enfoque que A6, aplicado a `reportes.js` en el contexto de caja.
**Esfuerzo:** M.

### A13 + A14 — Reserva/ocupación no atómica, errores no revisados
**Estado posterior al corte (2026-09-16):** implementado, probado y aplicado en Supabase staging. Cuatro RPC endurecidas cubren creación inmediata, check-in, checkout y reparación de habitación huérfana; usan `FOR UPDATE`, advisory locks, idempotencia, auditoría y aislamiento por hotel. Los dos índices únicos parciales impiden más de un cronómetro activo por habitación o reserva. El frontend dejó de encadenar escrituras críticas y solo muestra éxito después de recibir el commit. Producción sigue pendiente de aprobación.
**Corrección propuesta:** envolver crear-reserva + ocupar-habitación + crear-cronómetro en una única RPC transaccional con `FOR UPDATE` sobre la habitación; revisar el campo `error` de cada escritura en check-in/checkout y mostrar feedback real al usuario en vez de asumir éxito.
**Esfuerzo:** L (cambio de flujo, requiere diseño de la RPC transaccional).

### A15 + A16 — Tienda: dos implementaciones de venta, ajuste de stock no atómico
**Corrección propuesta:** migrar `actualizar_estado_pedido_web_tienda` a usar la misma RPC atómica (`procesar_venta_tienda_atomica`) que el resto del sistema; envolver `inventario.js:saveMovimiento` en una RPC con `FOR UPDATE`.
**Esfuerzo:** M-L.

### A17 — Dos motores de recurrencia en mantenimiento
**Corrección propuesta:** migrar el flujo legado (`tareas_mantenimiento.frecuencia`) al nuevo motor (`mantenimiento_planes`), o al menos hacer que el legado use `hotel_business_date()` en vez de `new Date()` local mientras coexisten.
**Esfuerzo:** L (requiere decisión de producto sobre si vale la pena mantener ambos).

### A18 — Documentación de roadmap sobrevende progreso
**Estado posterior al corte (2026-09-15):** corregido y verificado. El ítem 49 volvió a `[ ]`, documenta el andamiaje existente sin presentarlo como producto terminado y enumera la gestión, acceso, permisos y reportes consolidados pendientes. El plan multi-propiedad marca sus fases abiertas y define un criterio de finalización.
**Corrección propuesta:** corregir `docs/roadmap-mejoras.md` ítem 49 para reflejar el estado real (no completado), alineándolo con `docs/investment-readiness.md`, que sí lo reporta correctamente.
**Esfuerzo:** S (es un cambio de documentación, no de código).

## MEDIO y BAJO

Ver el detalle de corrección propuesta en cada documento de dominio (columna "Doc" de [13-riesgos-priorizados.md](13-riesgos-priorizados.md)). Todos son de esfuerzo S-M y no bloquean ninguna operación crítica; se priorizan en la Fase 3 del roadmap.

## Principio general para toda corrección

Ningún hallazgo de esta lista debe corregirse sin:
1. Un test de regresión que reproduzca el escenario del hallazgo antes del fix.
2. Verificación de que las RPCs financieras ya correctas (ver [01 §3](01-resumen-ejecutivo.md#3-los-10-puntos-arquitectónicos-mejor-resueltos)) no se ven afectadas.
3. Para los hallazgos de Seguridad/RLS: prueba explícita de que el fix no rompe el flujo legítimo (alta de colaboradores, cambio de permisos) antes de desplegar.
