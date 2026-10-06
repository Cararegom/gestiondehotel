# 13 — Matriz de Riesgos Priorizados

Consolidado de los ~45 hallazgos individuales de los documentos 02-12. Cada fila cita el documento de origen para el detalle completo (archivo, línea, escenario, corrección propuesta).

> Esta matriz conserva los hallazgos del corte auditado. El avance posterior se registra en [16-estado-implementacion.md](16-estado-implementacion.md): C1–C7, A3–A18, M1–M17 y B1–B12 están corregidos y verificados. El cierre técnico de producción se completó el 2026-10-05 en Supabase y Vercel; la aceptación manual con datos reales del hotel sigue pendiente donde aplica.

**Criterios de clasificación:** impacto (financiero/seguridad/operativo), probabilidad de ocurrencia real, centralidad en el grafo de dependencias, cantidad de módulos afectados, sensibilidad financiera/seguridad, y dificultad de probar la corrección sin regresión.

## CRÍTICO

| # | Hallazgo | Dominio | Impacto | Probabilidad | Doc |
|---|---|---|---|---|---|
| C1 | `crear_colaborador` crea administradores sin validar autenticación — explotable por cualquier visitante anónimo con la anon key pública | Seguridad/RLS | Total (compromiso de cualquier hotel del SaaS) | Alta — requiere solo conocer el endpoint | [07 §1.1](07-seguridad-rls.md) |
| C2 | `actualizar_permisos_usuario` permite auto-escalación de privilegios cross-tenant sin autenticación | Seguridad/RLS | Total | Alta | [07 §1.2](07-seguridad-rls.md) |
| C3 | `send-cash-close-report` no valida que el llamante pertenezca al hotel del reporte — correo de cierre falsificable a otro hotel | Caja/Finanzas | Alto (reputacional + financiero) | Media — requiere ser usuario autenticado de cualquier hotel | [05 §H-01](05-caja-finanzas.md) |
| C4 | `liquidar_consumos_reserva_atomico` marca deuda como pagada sin verificar monto; invocable directamente | Reservas | Alto (pérdida de ingresos por consumos) | Media-Alta | [04 §1](04-reservas-habitaciones.md) |
| C5 | Pedidos web de tienda entregados sin reserva activa quedan huérfanos (stock descontado, cobro imposible) | Tienda/Inventario | Medio-Alto (pérdida de inventario + ingresos) | Media (depende de frecuencia de pedidos web sin reserva) | [10 §H1](10-tienda-inventario.md) |
| C6 | Fix de producción real (bloqueo cámara QR) aplicado a archivo muerto (`control-energia.js`); el archivo servido (`-20260902.js`) nunca lo recibió | Deuda Técnica / Control de Energía | Medio (bug de UX ya "cerrado" pero sigue vivo) | Alta — el bug ya existía y sigue existiendo hoy | [12 §2](12-deuda-tecnica.md) |
| C7 | Filtro de fechas en `clientes.js` usa `.lt()` con UTC "pelado", fuera del alcance del proxy de timezone global — pierde/gana clientes por hasta 5h | Timezone | Medio (datos de reportes/exportes de clientes incorrectos) | Alta — ocurre en cada consulta con rango de fechas | [08 §4.1](08-timezone-fechas.md) |

## ALTO

| # | Hallazgo | Dominio | Doc |
|---|---|---|---|
| A1 | `js/uiUtils.js` (924 líneas, 69 conexiones) mezcla utilidades UI con lógica de negocio crítica (Alegra, descuentos) — God File peligroso | Arquitectura | [03 §2.1](03-mapa-dependencias.md) |
| A2 | `reservas.js` (3291 líneas, cohesión interna 0.05) concentra excesiva responsabilidad del dominio de mayor tráfico diario | Arquitectura | [03 §2.3](03-mapa-dependencias.md) |
| A3 | **Corregido en código y Supabase staging:** la familia `alegra-*` valida JWT, membresía activa, hotel y alcance antes de usar `service_role`; producción pendiente | Seguridad | [07 §1.3](07-seguridad-rls.md) |
| A4 | **Corregido y probado:** Clientes escapa texto persistido y atributos `data-*` en tabla, selector, formularios, historial y CRM | Seguridad | [07 §3.1](07-seguridad-rls.md) |
| A5 | **Corregido y probado:** Usuarios usa los helpers centrales en la tabla principal y superficies equivalentes de roles, permisos y horarios | Seguridad | [07 §3.2](07-seguridad-rls.md) |
| A6 | **Corregido y probado:** Reportes agrupa fechas e indicadores semanales con la zona operativa del hotel y rangos UTC semiabiertos | Timezone | [08 §4.2](08-timezone-fechas.md) |
| A7 | **Corregido y probado:** llegada, checkout y extensiones por noche usan la zona del hotel en Reservas y Mapa | Timezone | [08 §4.3](08-timezone-fechas.md) |
| A8 | **Corregido y probado en Supabase staging:** las allocations de reserva se serializan por hotel/reserva y no pueden superar el saldo conciliable; el evento actual y los cobros respaldados por Caja no se descuentan dos veces | Pagos Bancarios | [06 §H3](06-pagos-bancarios.md) |
| A9 | **Corregido y probado:** `reservas/*` y `caja/*` reportan fallos manejados con códigos estables; el reporter no copia mensajes, payloads ni identificadores del error original a Sentry | Performance/Observabilidad | [11 §A-1](11-performance.md) |
| A10 | **Corregido y probado:** la validación exige una respuesta booleana del RPC; conflictos, errores técnicos y respuestas ambiguas bloquean el guardado y los fallos técnicos se reportan con un código estable | Performance/Observabilidad | [11 §A-2](11-performance.md) |
| A11 | **Corregido y probado:** las 20 lecturas voluminosas de Reportes recorren todas las páginas con orden estable y descartan cualquier conjunto parcial si una página falla o es inválida | Performance | [11 §B-1](11-performance.md) |
| A12 | **Corregido y probado:** los reportes operativos usan rangos UTC semiabiertos desde la zona del hotel; sus días, ocupación y períodos comparativos siguen el calendario operativo incluso con DST | Caja/Timezone | [05 §H-02](05-caja-finanzas.md) |
| A13 | **Corregido y probado en Supabase staging:** creación inmediata, ocupación, cronómetro, cliente y pagos iniciales confirman en una sola transacción con lock, idempotencia e índices únicos | Reservas | [04 §2](04-reservas-habitaciones.md) |
| A14 | **Corregido y probado en Supabase staging:** check-in, checkout y reparación huérfana usan transacciones completas y la UI solo confirma éxito después del commit | Reservas | [04 §3](04-reservas-habitaciones.md) |
| A15 | **Corregido y probado en Supabase staging:** POS y pedido web delegan en un núcleo privado común; conservan respectivamente precio de catálogo y precio congelado, con locks, idempotencia y auditoría compartidos | Tienda | [10 §H2](10-tienda-inventario.md) |
| A16 | **Corregido y probado en Supabase staging:** el ajuste manual usa una RPC con `FOR UPDATE` que confirma stock, movimiento y auditoría en una sola transacción idempotente | Tienda | [10 §H4](10-tienda-inventario.md) |
| A17 | **Corregido y probado en Supabase staging:** planes es el único motor de recurrencia; la UI crea tareas únicas, las recurrencias abiertas se migran y un trigger impide reintroducir el flujo legado | Mantenimiento | [09 §H-1](09-mantenimiento.md) |
| A18 | **Corregido:** el roadmap marca multi-propiedad como pendiente, describe la base técnica disponible y enumera las capacidades funcionales que todavía faltan | Deuda Técnica / Docs vs Código | [12](12-deuda-tecnica.md) |

## MEDIO

| # | Hallazgo | Dominio | Doc |
|---|---|---|---|
| M1 | **Corregido:** las reglas de plan, vencimiento, gracia, exención y decisión de acceso viven en `subscriptionAccessService.js`; router y Mi Cuenta comparten el mismo contrato probado | Arquitectura | [03 §2.4](03-mapa-dependencias.md) |
| M2 | **Corregido:** manifiesto y pruebas de contrato cubren los 5 consumidores de `_shared/bank-email/*.ts`, su autenticación, métodos, errores, `verify_jwt`, imports críticos y controles obligatorios de CI | Arquitectura | [03](03-mapa-dependencias.md) |
| M3 | **Corregido y probado en Supabase staging:** mensajes Gmail distintos solo se elevan a revisión manual si coinciden hotel, banco, monto, ventana corta y remitente o contenido; ambos pagos se conservan y se bloquea el auto-match | Pagos Bancarios | [06 §H1](06-pagos-bancarios.md) |
| M4 | **Corregido:** la documentación bancaria refleja la API limitada de recepción, el vínculo exacto por `caja_id`, los RPC vigentes, la integridad durante checkout y las Fases 1–25 implementadas | Pagos Bancarios / Docs | [06 §H2](06-pagos-bancarios.md) |
| M5 | **Corregido y probado en staging:** el arqueo exige la unión de métodos activos y usados, conserva métodos desactivados con movimientos, transporta conteos por UUID y calcula el balance solo tras validar el conjunto completo | Caja | [05 §H-03](05-caja-finanzas.md) |
| M6 | **Corregido y probado en preview:** Caja clasifica por relaciones normalizadas y `source`; lo no vinculado queda en “Otros ingresos”, y el resumen cuenta habitaciones desde reservas reales | Caja | [05 §H-05](05-caja-finanzas.md) |
| M7 | **Corregido y probado en staging/preview:** estados operativos centralizados; `ocupada` y `tiempo agotado` son visibles, permiten completar la estancia y bloquean solapamientos en cliente y PostgreSQL | Reservas | [04 §4](04-reservas-habitaciones.md) |
| M8 | **Resuelto por C5 y consolidado por A15:** cada pedido web entregado genera una salida `venta_tienda_pedido_web` por producto, con stock anterior/nuevo y referencias al pedido y la venta | Tienda | [10 §H3](10-tienda-inventario.md) |
| M9 | **Corregido con A17:** se eliminaron las dos copias cliente y el generador server-side de planes quedó como única fuente | Mantenimiento | [09 §H-2](09-mantenimiento.md) |
| M10 | **Corregido y probado en preview:** la UI activa usa `maintenanceUiRendered`, superficies tipadas y `dataset` semántico; se retiraron observers globales y detecciones por texto/clases CSS | Mantenimiento | [09 §H-3](09-mantenimiento.md) |
| M11 | **Resuelto por A11 y revalidado en preview:** Ocupación y las cuatro fuentes KPI consumen paginación completa, orden estable y fallo cerrado sin devolver acumulados parciales | Performance | [11 §A-3](11-performance.md) |
| M12 | **Corregido y probado:** la reconciliación agrupa por estado, limita las peticiones al número de estados operativos, conserva el filtro por hotel y solo confirma filas devueltas por Supabase | Performance | [11 §B-2](11-performance.md) |
| M13 | **Corregido y probado:** el modal emite su reserva, el complemento se monta/desmonta con el mapa y consulta servicios/pagos directamente; se retiraron polling, observer global y búsquedas intermedias | Performance | [11 §B-3](11-performance.md) |
| M14 | **Corregido y probado:** los dos puntos que inicializan el rango de Reportes comparten `getDefaultReportDateRange` y usan el día calendario de la zona operativa del hotel | Timezone | [08 §4.4](08-timezone-fechas.md) |
| M15 | **Corregido y probado:** la zona fuente es parte de la regla bancaria y los filtros usan la zona operativa del hotel; no quedan restas ni límites `-05:00` manuales | Timezone | [08 §4.6](08-timezone-fechas.md) |
| M16 | **Corregido como control de deuda:** documentación actualizada a 3289 líneas y presupuesto automático en CI que impide que `reservas.js` vuelva a crecer | Deuda Técnica | [12](12-deuda-tecnica.md) |
| M17 | **Corregido y probado:** inventario único/versionado y contratos cruzados entre diez extensiones directas, dos encadenadas y sus módulos base | Deuda Técnica | [12](12-deuda-tecnica.md) |

## BAJO

| # | Hallazgo | Dominio | Doc |
|---|---|---|---|
| B1 | **Corregido y probado:** las cuatro funciones de gestión de usuarios comparten allowlist, declaran `Vary: Origin` y bloquean orígenes web ajenos antes del handler; staging verificado | Seguridad | [07 §1.4](07-seguridad-rls.md) |
| B2 | **Corregido antes del corte y revalidado:** la migración posterior `20260825150000` admite explícitamente `p_turno_id NULL`, está aplicada en staging y coincide con el frontend probado | Caja | [05 §H-04](05-caja-finanzas.md) |
| B3 | **Corregido y probado:** «Ver reversiones» consulta `caja_reversiones` por hotel y muestra el par original/contramovimiento con su motivo y responsables | Caja | [05 §H-06](05-caja-finanzas.md) |
| B4 | **Corregido y probado:** estados canónicos y heredados están separados; el trigger de staging rechaza nuevas escrituras legacy y conserva lectura/bloqueo seguro de filas históricas | Reservas | [04 §5](04-reservas-habitaciones.md) |
| B5 | **Corregido y probado:** la función muerta `descontar_stock_por_venta` se retiró mediante una migración mínima, sin `CASCADE`, y staging confirmó que la firma dejó de existir | Tienda | [10 §H5](10-tienda-inventario.md) |
| B6 | **Corregido y probado:** la lectura de categorías del POS filtra explícitamente `hotel_id` y conserva RLS tenant-safe como segunda barrera | Tienda/Seguridad | [10 §H6](10-tienda-inventario.md) |
| B7 | **Corregido y probado:** `mantenimiento-ui.js` fue confirmado como código muerto, retirado, y la cadena canónica de montaje quedó protegida por pruebas | Mantenimiento | [09 §M-1](09-mantenimiento.md) |
| B8 | **Corregido y probado:** el modal base usa el estado canónico de solo lectura y dejó de depender de una neutralización posterior | Mantenimiento | [09 §M-2](09-mantenimiento.md) |
| B9 | **Corregido y probado:** el calendario exige la zona IANA del hotel, usa el servicio central y hace visible una configuración ausente o inválida | Mantenimiento | [09 §M-3](09-mantenimiento.md) |
| B10 | **Corregido y probado:** la fecha impresa en el corte usa la zona operativa central del hotel | Timezone | [08 §4.5](08-timezone-fechas.md) |
| B11 | **Corregido y probado:** se retiraron los helpers muertos de deduplicación en memoria y se preservó la huella secundaria usada por la idempotencia persistente | Pagos Bancarios | [06 §H5](06-pagos-bancarios.md) |
| B12 | **Corregido y probado:** se retiraron tres MP4 locales sin consumidores y el respaldo `.rar` que, contrario al diagnóstico original, sí estaba versionado; Git/Vercel bloquean su reaparición | Deuda Técnica | [12](12-deuda-tecnica.md) |

## Resumen por severidad

| Severidad | Cantidad |
|---|---|
| CRÍTICO | 7 |
| ALTO | 18 |
| MEDIO | 17 |
| BAJO | 12 |
| **Total** | **54** |

## Resumen por dominio (hallazgos CRÍTICO + ALTO)

| Dominio | CRÍTICO | ALTO |
|---|---|---|
| Seguridad/RLS | 2 | 3 |
| Caja/Finanzas | 1 | 1 |
| Reservas/Habitaciones | 1 | 2 |
| Tienda/Inventario | 1 | 2 |
| Timezone | 1 | 2 |
| Deuda Técnica | 1 | 1 |
| Arquitectura | 0 | 2 |
| Performance/Observabilidad | 0 | 3 |
| Pagos Bancarios | 0 | 1 |
| Mantenimiento | 0 | 1 |
