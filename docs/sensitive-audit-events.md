# Trazabilidad de acciones sensibles

Este documento resume las acciones sensibles que ahora quedan registradas en `bitacora` mediante `js/services/sensitiveAuditService.js`.

## Objetivo

- dejar rastro verificable de cambios sensibles dentro del SaaS
- facilitar soporte, auditoria interna y revisiones operativas
- no almacenar secretos ni datos altamente sensibles en texto plano

## Acciones auditadas

### Mi Cuenta

- `CHECKOUT_SUSCRIPCION_INICIADO`
- `CHECKOUT_SUSCRIPCION_CANCELADO`
- `CHECKOUT_SUSCRIPCION_FALLIDO`
- `ACTUALIZAR_CORREO_CUENTA`
- `ACTUALIZAR_PASSWORD_CUENTA`

### Operacion SaaS

- `EXPORTAR_BACKUP_HOTEL`

## Campos esperados en `detalles`

Cada registro sensible agrega:

- `sensible: true`
- datos operativos del evento
- referencias de checkout cuando existan
- correo enmascarado si aplica

## Regla de privacidad

- nunca guardar contrasenas
- no guardar correos completos si basta con una referencia enmascarada
- registrar longitud o metadatos de la accion cuando el valor original sea sensible
