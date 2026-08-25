# Staging Fase 1

Fecha: 2026-08-09. Estado: **BLOQUEADO ANTES DE CREACIÓN**.

## Identidad y seguridad

- Producción confirmada por `get_project_url`: `https://iikpqpdoslyduecibaij.supabase.co`.
- El MCP productivo permaneció `read_only=true`; no se cambió su configuración.
- `list_branches` respondió `Project reference is missing when validating permissions`.
- `create_branch` requiere previamente un `confirm_cost_id`; no existe una operación de confirmación de coste disponible en el canal actual.
- Supabase CLI, Docker y `psql` no están instalados. El repositorio está enlazado localmente a producción (`supabase/.temp/project-ref`), por lo que no se usó ese enlace para escribir.

No se creó branch ni proyecto, no se incurrió en coste y no existe un `project_ref` staging que pueda confirmarse distinto de producción. En consecuencia no se aplicaron migraciones ni fixtures remotos.

## Mecanismo previsto

Preferencia pendiente: branch oficial `fase1-finanzas-seguridad`, sin datos productivos. Debe obtenerse confirmación explícita de coste y una herramienta capaz de devolver el nuevo `project_ref`. Antes de cualquier escritura se debe imprimir:

```text
STAGING CONFIRMADO
project_ref: <ref staging>
producción: iikpqpdoslyduecibaij
targets distintos: SÍ
```

Si los refs coinciden, el procedimiento termina inmediatamente.

## Preparación local realizada

- migraciones 01–09 preparadas; 10 retenida;
- configuración de flags por entorno con cierre irreversible mediante `fase1LegacyRevoked`;
- gate automático `npm run fase1:legacy-gate`;
- cancelación lógica/reversión preparada;
- restaurante ampliado para derivar descuentos e impuestos desde tablas del hotel.

Fixtures Hotel A/B y usuarios Auth siguen pendientes porque deben crearse exclusivamente en un Supabase aislado.
