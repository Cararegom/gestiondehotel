# Sentry en Windows

- El plugin Sentry instalado se consulta mediante `scripts/sentry.ps1`, que invoca su `sentry_api.py` original y carga las variables de proceso, usuario o sistema en memoria.
- Para verificar el acceso: `npm run sentry:verify`. Para consultar incidencias: `npm run sentry:issues`. El entorno predeterminado es `prod`; usa `./scripts/sentry.ps1 -Action issues -Environment development` para desarrollo.
- Si el entorno restringido no ve las variables del usuario de Windows, no concluyas que no existen. Comprueba los ámbitos de Windows con el acceso autorizado; las restricciones y aprobaciones habituales siguen aplicándose.
- Nunca imprimas los valores de `SENTRY_AUTH_TOKEN` ni `SENTRY_ORG`, ni los copies a archivos, argumentos, logs o bundles. Para informar de su presencia usa solamente `CONFIGURADA` o `NO CONFIGURADA`.
- `sentry.config.json` contiene solo el DSN público, el proyecto y la activación. El build no usa credenciales de la API.
- `npm run sentry:test` envía un evento sintético real a Sentry, separado en el entorno `verification`. Ejecútalo únicamente cuando se solicite comprobar la integración; nunca como parte de las pruebas normales.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
