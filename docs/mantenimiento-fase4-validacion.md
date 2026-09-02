# Validación Fase 4 en staging

- `pg_cron` instalado y job `mantenimiento-alertas-fase4` activo cada 5 minutos.
- El job existe una sola vez.
- `mantenimiento_emitir_alertas()` no tiene EXECUTE para `authenticated`; sí para `service_role`.
- `mantenimiento_metricas()` tiene EXECUTE para `authenticated` y resuelve el hotel desde la sesión.
- Prueba de idempotencia: SLA próximo = 1 notificación, repetición = 0; SLA vencido = 1, repetición = 0; preventivo próximo = 1, repetición = 0.
- La prueba dejó exactamente 3 alertas deduplicadas y 3 notificaciones.
- Prueba de métricas aislada por hotel: 2 abiertas, 1 vencida, 2 sin asignar y 1 preventivo próximo para el hotel temporal.
- Todos los datos temporales fueron eliminados y se confirmó 0 residuos.
- El advisor de seguridad no reporta hallazgos nuevos introducidos por las tablas de Fase 4 después de agregar una política deny-all a la tabla interna de deduplicación.
