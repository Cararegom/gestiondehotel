# Sentry en Windows

- El plugin Sentry instalado se consulta mediante `scripts/sentry.ps1`, que invoca su `sentry_api.py` original y carga las variables de proceso, usuario o sistema en memoria.
- Para verificar el acceso: `npm run sentry:verify`. Para consultar incidencias: `npm run sentry:issues`. El entorno predeterminado es `prod`; usa `./scripts/sentry.ps1 -Action issues -Environment development` para desarrollo.
- Si el entorno restringido no ve las variables del usuario de Windows, no concluyas que no existen. Comprueba los ámbitos de Windows con el acceso autorizado; las restricciones y aprobaciones habituales siguen aplicándose.
- Nunca imprimas los valores de `SENTRY_AUTH_TOKEN` ni `SENTRY_ORG`, ni los copies a archivos, argumentos, logs o bundles. Para informar de su presencia usa solamente `CONFIGURADA` o `NO CONFIGURADA`.
- `sentry.config.json` contiene solo el DSN público, el proyecto y la activación. El build no usa credenciales de la API.
- `npm run sentry:test` envía un evento sintético real a Sentry, separado en el entorno `verification`. Ejecútalo únicamente cuando se solicite comprobar la integración; nunca como parte de las pruebas normales.
