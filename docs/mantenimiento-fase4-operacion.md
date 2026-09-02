# Operación de alertas de mantenimiento

El barrido automático se ejecuta cada 5 minutos. Las alertas se deduplican por tarea y tipo, por lo que un mismo evento no genera notificaciones repetidas.

Para hoteles existentes, `activado_en` se fija al momento de desplegar la fase. De esta forma, los SLA históricos calculados retrospectivamente en Fase 3 aparecen en el tablero, pero no generan notificaciones antiguas de golpe.

Los hoteles creados después se registran automáticamente en la primera ejecución del barrido con su propia fecha de activación.

Las ventanas predeterminadas son:

- SLA próximo a vencer: 30 minutos.
- Preventivo próximo: 24 horas.
- Reincidencia: 3 reportes de la misma categoría en la misma habitación dentro de 30 días.

La configuración queda preparada para ser administrada por usuarios admin/superadmin sin exponer la tabla interna de deduplicación.
