# Supabase Migrations

Este directorio ya incluye un baseline versionado del schema propio de la aplicacion:

- `20260326191500_baseline_public_schema.sql`

Regla recomendada:

1. No editar manualmente el baseline salvo para regenerarlo completo.
2. Los cambios nuevos del modelo de datos deben entrar como migraciones incrementales nuevas.
3. Si necesitas reconstruir el baseline desde el proyecto remoto, usa:
   - `node scripts/fetch-supabase-schema-snapshot.js`
   - `node scripts/build-supabase-baseline.js`

Referencia completa:

- `docs/supabase-schema-workflow.md`
