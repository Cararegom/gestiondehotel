Este directorio guarda archivos tecnicos archivados que ya no forman parte del runtime.

Reglas:

- no importar archivos desde `archive/legacy/` en codigo productivo
- usar este directorio solo para respaldo, comparaciones o recuperacion manual
- si un archivo vuelve al runtime, moverlo fuera de `archive/legacy/` y documentar el cambio
