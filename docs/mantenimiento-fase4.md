# Mantenimiento · Fase 4/4

La cuarta fase cierra la evolución profesional del módulo de mantenimiento con automatización operativa y control gerencial.

## Automatización

- Barrido cada 5 minutos mediante Supabase Cron (`pg_cron`).
- Alertas de SLA próximo a vencer y SLA vencido.
- Avisos de mantenimiento preventivo próximo.
- Detección de reincidencias por habitación y categoría.
- Deduplicación por tarea + tipo de alerta.
- Las tareas históricas anteriores a la activación no generan una avalancha inicial de notificaciones.
- Las notificaciones reutilizan el centro de notificaciones existente y se dirigen al rol `mantenimiento`; los administradores las ven por el alcance hotelero del centro de notificaciones.

## Control gerencial

El módulo consulta `mantenimiento_metricas()` para mostrar:

- abiertas;
- vencidas;
- sin asignar;
- cerradas en el período;
- cumplimiento de SLA;
- tiempo promedio de resolución;
- preventivos de los próximos 7 días;
- reincidencias;
- categorías más reportadas;
- carga y vencimientos por responsable.

El período se puede alternar entre 30, 60 y 90 días.

## Seguridad

- El barrido automático solo puede ejecutarlo `service_role`/cron.
- El RPC de métricas resuelve el hotel desde el usuario autenticado y no acepta `hotel_id` arbitrario.
- La configuración de alertas es visible por miembros activos del hotel y modificable solo por administradores/superadmin.
- La tabla interna de deduplicación queda cerrada para clientes autenticados mediante RLS deny-all y revocación de privilegios.
