# Checklist de despliegue Fase 4

1. CI de la rama en verde.
2. Confirmar en producción el conteo de tareas abiertas, vencidas, bloqueos y estancias activas.
3. Aplicar `mantenimiento_fase4_automatizacion`.
4. Aplicar `mantenimiento_fase4_metricas`.
5. Confirmar una sola tarea de cron activa.
6. Confirmar configuraciones por hotel y ausencia de avalancha de alertas históricas.
7. Verificar el RPC de métricas con un usuario real sin modificar datos.
8. Fusionar el frontend y esperar CI final de `main`.
