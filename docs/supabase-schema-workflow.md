# Supabase Schema Workflow

Este proyecto ya deja versionado el esquema propio de la aplicacion en `public` sin depender de Docker.

## Que se versiona aqui

- Tipos propios del schema `public`
- Tablas del schema `public`
- Constraints y foreign keys
- Indexes no generados automaticamente por PK o UNIQUE
- Funciones propias del schema `public`
- Policies y RLS
- Triggers del schema `public`
- Extensiones necesarias para el schema propio:
  - `citext`
  - `pgcrypto`
  - `uuid-ossp`

## Que no se versiona aqui

Las estructuras administradas por Supabase no se consideran parte del baseline propio del producto:

- `auth`
- `storage`
- `realtime`
- extensiones administradas por la plataforma

Esas se recrean por la propia plataforma al crear un proyecto Supabase nuevo.

## Snapshots locales

Los snapshots del esquema se guardan en:

- `supabase/snapshots/database-context.json`
- `supabase/snapshots/public-functions.json`
- `supabase/snapshots/public-standalone-composite-types.json`

## Como refrescar el snapshot remoto

Necesitas:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

Ejemplo:

```powershell
$env:SUPABASE_ACCESS_TOKEN="tu_personal_access_token"
$env:SUPABASE_PROJECT_REF="iikpqpdoslyduecibaij"
node scripts/fetch-supabase-schema-snapshot.js
```

## Como regenerar el baseline SQL

```powershell
node scripts/build-supabase-baseline.js
```

Por defecto genera:

- `supabase/migrations/20260326191500_baseline_public_schema.sql`

Si quieres otra ruta:

```powershell
node scripts/build-supabase-baseline.js supabase/migrations/20260327100000_nuevo_baseline.sql
```

## Flujo recomendado

1. Refrescar snapshot remoto.
2. Regenerar baseline SQL.
3. Revisar el diff del archivo en `supabase/migrations`.
4. Si el cambio es correcto, crear migraciones incrementales nuevas a partir de ahi.
