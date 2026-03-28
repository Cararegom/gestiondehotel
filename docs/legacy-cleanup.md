# Limpieza de deuda tecnica y archivos legacy

Este documento deja trazabilidad de la limpieza aplicada para reducir ruido dentro de modulos vivos sin perder historial tecnico.

## Objetivo

- sacar del runtime archivos de respaldo, pruebas manuales y utilidades de extraccion que ya no participan en la app
- mantenerlos disponibles para consulta tecnica o comparaciones puntuales
- hacer que carpetas activas como `js/modules/mapa-habitaciones` y `js/modules/caja` sean mas faciles de navegar

## Archivos archivados

Se movieron a `archive/legacy/` los siguientes archivos:

- `js/modules/caja/caja.backup-20260316-204706.js`
- `js/modules/reservas/reservas.backup-20260316-213103.js`
- `js/modules/tienda/tienda.backup-20260317-000459.js`
- `js/modules/mapa-habitaciones/mapa-habitaciones.github.js`
- `js/modules/mapa-habitaciones/mapa-habitaciones.old.js`
- `js/modules/mapa-habitaciones/extract.js`
- `js/modules/mapa-habitaciones/extract_modals.js`
- `js/modules/mapa-habitaciones/extracted-modal.js`
- `js/modules/mapa-habitaciones/fix_alquiler.js`
- `js/modules/mapa-habitaciones/remove_dups.js`
- `js/modules/mapa-habitaciones/replace-modal.js`
- `js/modules/mapa-habitaciones/diff.patch`

## Regla operativa

- `archive/legacy/` no forma parte del runtime de la app.
- si algun archivo archivado vuelve a necesitarse, se debe restaurar de forma explicita y documentada
- los modulos activos deben seguir importando solo archivos dentro de su carpeta viva o de servicios compartidos

## Siguiente criterio de limpieza

Antes de mover un archivo a `archive/legacy/`, verificar:

1. que no este importado por el runtime
2. que no lo use ningun script operativo vigente
3. que su valor sea historico, comparativo o de respaldo
