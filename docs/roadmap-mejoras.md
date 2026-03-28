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
- [ ] 16. Crear un verdadero Centro de Soporte dentro de la app.
- [ ] 17. Permitir adjuntar capturas o archivos en incidencias y mantenimiento.

## Prioridad 3: Operacion hotelera y control interno

- [ ] 18. Mejorar mucho el modulo de reportes con indicadores gerenciales y comparativos.
- [ ] 19. Agregar alertas operativas automaticas.
- [ ] 20. Crear mantenimiento preventivo real.
- [ ] 21. Mejorar limpieza con checklist e inspeccion por habitacion.
- [ ] 22. Crear un historial completo por habitacion.
- [ ] 23. Agregar gestion de no-show, tardanzas y politicas de tolerancia.
- [ ] 24. Anadir lista de espera y reasignacion inteligente de habitaciones.
- [ ] 25. Incorporar tarifas dinamicas y reglas de precio.
- [ ] 26. Agregar fuentes de reserva y embudo comercial.

## Prioridad 4: CRM, crecimiento y valor comercial

- [ ] 27. Construir un CRM mejorado para clientes frecuentes.
- [ ] 28. Crear campanas automaticas simples.
- [ ] 29. Anadir mas analitica de referidos y afiliados.
- [ ] 30. Mejorar el modulo de usuarios con auditoria y plantillas de permisos.
- [ ] 31. Agregar doble validacion para acciones destructivas.
- [ ] 32. Mejorar el POS de tienda y restaurante con mas resiliencia.
- [ ] 33. Integrar impresion termica mas nativa.

## Prioridad 5: Plataforma, experiencia y escalabilidad

- [ ] 34. Crear un verdadero modo offline o PWA.
- [ ] 35. Optimizar rendimiento general del frontend.
- [ ] 36. Agregar CI/CD basico.
- [ ] 37. Estandarizar componentes UI del sistema.
- [ ] 38. Mejorar accesibilidad y UX movil en todos los modulos.
- [ ] 39. Crear onboarding guiado para hoteles nuevos.
- [ ] 40. Agregar demo data o modo sandbox.
- [ ] 41. Crear una vista "hoy en operacion".

## Prioridad 6: Integraciones y crecimiento futuro

- [ ] 42. Anadir mas integraciones contables y fiscales.
- [ ] 43. Evaluar channel manager y OTAs como linea futura.
- [ ] 44. Unificar mejor el sistema de notificaciones internas.
- [ ] 45. Mejorar la landing y la analitica de conversion.
- [ ] 46. Guardar leads del chatbot comercial en base de datos.
- [ ] 47. Anadir panel de uso por hotel para pricing futuro.
- [ ] 48. Crear documentacion interna viva del producto.
- [ ] 49. Preparar el sistema para multi-propiedad o cadena hotelera.
- [ ] 50. Prepararlo para venta o inversion.

## Modulos que merecen revision especial

- [ ] Revisar a fondo `reservas`.
- [ ] Revisar a fondo `caja`.
- [ ] Revisar a fondo `reportes`.
- [ ] Revisar a fondo `restaurante`.
- [ ] Revisar a fondo `clientes`.
- [ ] Revisar a fondo `limpieza`.
- [ ] Revisar a fondo `habitaciones`.
- [ ] Revisar a fondo `mapa-habitaciones`.

## Orden recomendado de ejecucion

- [x] Fase 1: seguridad, backend, pagos, secretos, funciones faltantes y pruebas minimas.
- [ ] Fase 2: estabilidad operativa, soporte, reportes, mantenimiento preventivo y trazabilidad.
- [ ] Fase 3: crecimiento comercial, CRM, automatizaciones, integraciones grandes y escalabilidad.
