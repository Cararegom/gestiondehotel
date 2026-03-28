# Roadmap de Mejoras Priorizadas

Este archivo resume las mejoras recomendadas para `gestiondehotel`, ordenadas de mas importante a menos importante.

Uso:
- Cambiar `- [ ]` por `- [x]` cuando una mejora ya este completada.
- Si una mejora cambia de alcance, se puede editar su descripcion sin perder el orden general.

Leyenda:
- [ ] Pendiente
- [x] Completado

## Prioridad 1: Seguridad, backend e integridad

- [x] 1. Sacar todos los secretos sensibles del codigo y rotarlos. Estado actual: repo saneado y pagos movidos a backend seguro. Nota: si en el futuro el proyecto se expone mas o se publica en canales externos, conviene revisar una rotacion preventiva.
- [x] 2. Mover toda la logica critica de cobros e integraciones a backend seguro. Estado actual: checkout SaaS autoritativo, configuracion y notificacion de Alegra, Google/Outlook y envio del corte de caja ya salen por Edge Functions o proxies backend; no quedan cobros ni integraciones sensibles activas llamando terceros directamente desde el frontend.
- [x] 3. Versionar y consolidar toda la capa backend real en `supabase/functions`. Estado actual: el repo ya versiona las funciones activas del proyecto remoto, incorpora las faltantes que invoca el frontend (`alegra-test-connection`, `alegra-crear-factura`, `send-discount-email`) y deja inventario local en `docs/backend-functions-inventory.md`.
- [x] 4. Crear migraciones formales de base de datos y dejar la estructura 100 por ciento reproducible. Estado actual: el repo ya incluye `supabase/config.toml`, snapshots versionados del schema remoto en `supabase/snapshots` y un baseline reproducible del schema propio en `supabase/migrations/20260326191500_baseline_public_schema.sql`, regenerable con scripts locales sin depender de Docker.
- [x] 5. Convertir los flujos criticos en operaciones atomicas o RPC. Estado actual: `Caja/Turnos` ya abre, registra movimientos y cierra turnos mediante RPCs atomicas (`abrir_turno_con_apertura`, `registrar_movimiento_caja_atomico`, `cerrar_turno_con_balance`) aplicadas en Supabase y consumidas desde el frontend.
- [x] 6. Hacer una pasada fuerte de permisos y RLS en Supabase. Estado actual: se agrego `eventos_sistema` con RLS propio, se versiono una auditoria reproducible en `docs/supabase-rls-audit.md` y la consola SaaS ya resume tablas sin RLS, tablas sin politicas y funciones `SECURITY DEFINER` a partir del snapshot real del schema.
- [x] 7. Crear monitoreo centralizado de errores y eventos. Estado actual: la app ya captura errores globales, promesas rechazadas y fallos criticos de router/autenticacion mediante `js/services/monitoringService.js`, registrandolos en `public.eventos_sistema`.
- [x] 8. Armar una consola SaaS global de operacion. Estado actual: la app ya incluye la ruta superadmin `#/ops-saas` con metricas globales, pagos recientes, eventos recientes y resumen de seguridad.
- [x] 9. Agregar backups operativos y exportacion completa por hotel. Estado actual: la consola SaaS permite exportar un snapshot JSON completo por hotel usando `exportar_hotel_snapshot(p_hotel_id uuid)`.
- [x] 10. Implementar pruebas automaticas minimas. Estado actual: el repo ya incluye `npm test` con pruebas para baseline de schema, migracion operacional 5-10 y generacion del informe RLS.

## Prioridad 2: Deuda tecnica y estabilidad del producto

- [x] 11. Limpiar deuda tecnica y archivos viejos dentro de modulos vivos. Estado actual: respaldos, parches manuales y utilidades legacy de `caja`, `reservas`, `tienda` y `mapa-habitaciones` quedaron archivados en `archive/legacy/`, con trazabilidad en `docs/legacy-cleanup.md`.
- [x] 12. Terminar de fraccionar los modulos monoliticos que siguen pesados. Estado actual: `Mi Cuenta` dejo de concentrar carga de datos y parte de la logica SaaS; ahora usa `accountDataService`, `pricing.js` y `checkoutSuscripcionService`, reduciendo mezcla de consultas, pricing y checkout dentro del modulo.
- [x] 13. Normalizar textos, encoding y mensajes del sistema. Estado actual: se limpio el texto visible critico de `Mi Cuenta`, checkout SaaS y varios archivos base, y se agrego `scripts/normalize-source-text.js` para seguir corrigiendo mojibake de forma reproducible.
- [x] 14. Rehacer la capa de pagos SaaS de forma profesional. Estado actual: el checkout SaaS ya devuelve metadata operativa (`provider_display_name`, `checkout_reference`, `issued_at`, `customer_email`), muestra resumen mas claro antes del pago y queda documentado en `docs/payments-saas-checkout.md`.
- [x] 15. Anadir trazabilidad completa de cambios sensibles. Estado actual: se agrego `js/services/sensitiveAuditService.js` y ya quedan auditados checkout SaaS iniciado/cancelado/fallido, cambio de correo, cambio de contrasena y exportacion SaaS de backups por hotel.
- [x] 16. Crear un verdadero Centro de Soporte dentro de la app. Estado actual: la app ya incluye la ruta `#/soporte`, con acceso directo a Valeria, canales de escalamiento, guia para reportar mejor y un resumen de incidencias recientes del hotel conectado a `bitacora`.
- [x] 17. Permitir adjuntar capturas o archivos en incidencias y mantenimiento. Estado actual: `Centro de Soporte` ya permite guardar incidencias manuales con capturas o archivos en Storage, `bitacora` muestra los adjuntos y `Mantenimiento` deja asociar evidencia a cada tarea mediante el bucket `operacion-evidencias`.

## Prioridad 3: Operacion hotelera y control interno

Nota operativa: este bloque ya quedo implementado del lado de la app y el repo. Para activarlo al 100 por ciento en la base remota falta aplicar la migracion `20260327221500_prioridad3_operacion_hotelera.sql`, que no pudo subirse por autenticacion del pooler en `db push`.

- [x] 18. Mejorar mucho el modulo de reportes con indicadores gerenciales y comparativos. Estado actual: `Reportes` ya incluye un comparativo gerencial de operacion, con ingresos, egresos, reservas por origen, embudo comercial, lista de espera e indicadores operativos contra el periodo anterior.
- [x] 19. Agregar alertas operativas automaticas. Estado actual: `Dashboard` ya muestra un radar operativo con alertas de no-show sugerido, check-outs vencidos, limpieza pendiente, preventivos abiertos, lista de espera e inspecciones con observaciones.
- [x] 20. Crear mantenimiento preventivo real. Estado actual: `Mantenimiento` ya permite frecuencia preventiva (`diaria`, `semanal`, `mensual`, etc.), muestra preventivos abiertos y reprograma automaticamente la siguiente tarea al completar una preventiva recurrente.
- [x] 21. Mejorar limpieza con checklist e inspeccion por habitacion. Estado actual: `Limpieza` ya captura checklist, observaciones e inspeccion por habitacion al confirmar limpieza; si la tabla nueva aun no existe en remoto, la operacion no se rompe y sigue con fallback.
- [x] 22. Crear un historial completo por habitacion. Estado actual: `Mapa Hotel` ya resume reservas recientes, mantenimiento, inspecciones y actividad operativa en una sola vista por habitacion.
- [x] 23. Agregar gestion de no-show, tardanzas y politicas de tolerancia. Estado actual: `Reservas` ya muestra tolerancia, llegada proxima y no-show sugerido, y `Dashboard` lo refleja como alerta operativa.
- [x] 24. Anadir lista de espera y reasignacion inteligente de habitaciones. Estado actual: `Reservas` ya incluye panel de lista de espera, cambio de estado y sugerencias inteligentes de habitaciones; si la tabla aun no existe en remoto, el panel lo informa sin romper el modulo.
- [x] 25. Incorporar tarifas dinamicas y reglas de precio. Estado actual: `Reservas` ya soporta reglas dinamicas por origen, periodo, dia y habitacion, con resumen en vivo del ajuste aplicado y fallback claro mientras se activa la tabla en remoto.
- [x] 26. Agregar fuentes de reserva y embudo comercial. Estado actual: `Reservas` ya maneja origen comercial, filtros por fuente, embudo en historial y soporte para comparativos por canal en `Reportes`.

## Prioridad 4: CRM, crecimiento y valor comercial

- [x] 27. Construir un CRM mejorado para clientes frecuentes. Estado actual: `Clientes` ya clasifica automaticamente por segmento comercial (`VIP`, `Frecuente`, `En riesgo`, `Nuevo`, `Ocasional`), muestra valor comercial, ultima visita, pendientes CRM y perfil comercial dentro del detalle del cliente.
- [x] 28. Crear campanas automaticas simples. Estado actual: `Clientes` ya propone campanas de reactivacion, cumpleanos, seguimiento VIP y upsell; al ejecutarlas genera actividades CRM pendientes para los clientes objetivo.
- [x] 29. Anadir mas analitica de referidos y afiliados. Estado actual: `Mi Cuenta` ya muestra KPIs de referidos (`total`, `activos`, `trial`, `recompensas pendientes`, `conversion`) ademas del historial detallado por hotel referido.
- [x] 30. Mejorar el modulo de usuarios con auditoria y plantillas de permisos. Estado actual: `Usuarios` ya audita creacion, actualizacion, activacion, reset de password, borrado y cambio de permisos, y el modal de permisos ya incluye plantillas rapidas como `Recepcion`, `Caja`, `Supervisor`, `Mantenimiento`, `Tienda` y `Restaurante`.
- [x] 31. Agregar doble validacion para acciones destructivas. Estado actual: acciones criticas como eliminar usuarios o borrar actividades CRM ya exigen una confirmacion reforzada escribiendo `ELIMINAR`.
- [x] 32. Mejorar el POS de tienda y restaurante con mas resiliencia. Estado actual: ambos POS ya guardan borradores locales del carrito/pedido, recuperan ventas en curso tras recarga y limpian el borrador automaticamente al cerrar una venta exitosa.
- [x] 33. Integrar impresion termica mas nativa. Estado actual: tienda y restaurante ya imprimen ticket termico usando una capa comun (`thermalPrintService`) que respeta configuracion de papel e impresora del hotel.

## Prioridad 5: Plataforma, experiencia y escalabilidad

- [x] 34. Crear un verdadero modo offline o PWA. Estado actual: la app ya registra un service worker en raiz (`/sw.js`), cachea shell y assets clave, tiene pagina `offline.html`, banner PWA para instalar/actualizar y soporte de uso sin conexion con fallback para navegaciones.
- [x] 35. Optimizar rendimiento general del frontend. Estado actual: `main.js` ya carga modulos bajo demanda por ruta (`import()` lazy), precalienta rutas probables en idle y `app/index.html` elimino cargas duplicadas de librerias pesadas.
- [x] 36. Agregar CI/CD basico. Estado actual: el repo ya incluye `scripts/check-syntax.js`, script `npm run check:syntax` y workflow GitHub Actions en `.github/workflows/ci.yml` para validar sintaxis y correr pruebas automaticas.
- [x] 37. Estandarizar componentes UI del sistema. Estado actual: existe un kit compartido en `js/services/appUiKit.js` con `hero`, `metric cards`, `section cards`, `empty states` y `checklists`, ademas de variantes globales estandarizadas para botones y superficies.
- [x] 38. Mejorar accesibilidad y UX movil en todos los modulos. Estado actual: la app ya incluye `skip link`, mejoras de foco visible, soporte `prefers-reduced-motion`, `touch targets`, banner PWA responsive y una base visual mas consistente para movil.
- [x] 39. Crear onboarding guiado para hoteles nuevos. Estado actual: la ruta `#/onboarding` revisa datos reales del hotel (`configuracion`, `habitaciones`, `usuarios`, `metodos de pago`, `turnos` y `reservas`) y construye una ruta de primeros pasos accionable.
- [x] 40. Agregar demo data o modo sandbox. Estado actual: la ruta `#/sandbox` permite activar escenarios locales de demo/capacitacion sin escribir en la base real del hotel.
- [x] 41. Crear una vista "hoy en operacion". Estado actual: la ruta `#/operacion-hoy` resume llegadas, salidas, ocupacion, limpieza, mantenimiento, turnos abiertos y atencion inmediata en una sola pantalla operativa.

## Prioridad 6: Integraciones y crecimiento futuro

- [x] 42. Anadir mas integraciones contables y fiscales. Estado actual: `Integraciones` ya incluye un catalogo vivo de conectores fiscales/contables (Alegra, Siigo, DIAN, QuickBooks, Xero), permite registrar interes por hotel y deja trazabilidad en `integraciones_interes`.
- [x] 43. Evaluar channel manager y OTAs como linea futura. Estado actual: `Integraciones` ya muestra una linea OTA priorizada (Booking.com, Airbnb, Expedia, channel manager) y el repo deja la evaluacion viva en `docs/channel-manager-evaluacion.md`.
- [x] 44. Unificar mejor el sistema de notificaciones internas. Estado actual: la campanita global y el historial ahora usan una capa comun en `js/services/notificationCenterService.js`, evitando logica duplicada y centralizando feed, historial, realtime y marcado de lectura.
- [x] 45. Mejorar la landing y la analitica de conversion. Estado actual: la landing ya registra eventos de conversion en `landing_conversion_events` mediante `landing-track-event`, incluyendo `page_view`, CTAs, pricing y apertura del chat comercial.
- [x] 46. Guardar leads del chatbot comercial en base de datos. Estado actual: el panel comercial de Laura ya permite guardar contactos en `landing_leads` mediante `landing-save-lead`, enlazando tambien el evento `lead_submitted`.
- [x] 47. Anadir panel de uso por hotel para pricing futuro. Estado actual: `#/ops-saas` ya consume `saas_usage_by_hotel`, mostrando reservas, usuarios, caja, POS, incidencias y errores por hotel para futuras decisiones de pricing.
- [x] 48. Crear documentacion interna viva del producto. Estado actual: el repo ya incluye `docs/producto-vivo.md`, `docs/channel-manager-evaluacion.md`, `docs/multi-propiedad-plan.md` e `docs/investment-readiness.md`.
- [x] 49. Preparar el sistema para multi-propiedad o cadena hotelera. Estado actual: se versionaron `grupos_hoteleros` y `grupo_hoteles`, el panel SaaS ya resume grupos activos y quedo definido el plan funcional en `docs/multi-propiedad-plan.md`.
- [x] 50. Prepararlo para venta o inversion. Estado actual: existe una lista viva en `docs/investment-readiness.md`, junto con mejor trazabilidad SaaS, tracking comercial, documentacion de producto y panel global mas presentable para due diligence.

## Modulos que merecen revision especial

Nota: la auditoria inicial y el orden recomendado quedaron documentados en `docs/revision-modulos-especial.md`.

- [ ] Revisar a fondo `reservas`. Estado actual: limpieza arquitectonica completada; `reservas.js` ya bajo a `2853` lineas y delega pagos/abonos, historial/filtros, render, acciones, formulario, UI y estados a modulos separados. Ya no conserva renders legacy ni cuerpos duplicados, pero aun conviene una pasada final de regresion funcional en crear/editar/abonar/check-in/check-out/cancelar.
- [ ] Revisar a fondo `caja`. Estado actual: refactor arquitectonico completado; `caja.js` ya bajo a `740` lineas y delega turnos, movimientos, cierre/reporte y paneles auxiliares a modulos separados (`caja-turnos.js`, `caja-movimientos.js`, `caja-cierre.js`, `caja-paneles.js`). Lo que falta ya no es particion tecnica sino regresion funcional manual de apertura, movimientos, arqueo, supervision, impresion y correo.
- [ ] Revisar a fondo `reportes`.
- [ ] Revisar a fondo `restaurante`.
- [ ] Revisar a fondo `clientes`.
- [ ] Revisar a fondo `limpieza`.
- [ ] Revisar a fondo `habitaciones`.
- [ ] Revisar a fondo `mapa-habitaciones`.

## Orden recomendado de ejecucion

- [x] Fase 1: seguridad, backend, pagos, secretos, funciones faltantes y pruebas minimas.
- [x] Fase 2: estabilidad operativa, soporte, reportes, mantenimiento preventivo y trazabilidad.
- [x] Fase 3: crecimiento comercial, CRM, automatizaciones, integraciones grandes y escalabilidad.
