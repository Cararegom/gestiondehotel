# Preflight de staging en Vercel

Este preflight existe para desbloquear la publicación de frontend staging sin tocar producción. No crea deployments y no ejecuta `--prod`.

## Uso

```powershell
npm run vercel:staging:preflight
```

Opciones directas del script:

```powershell
./scripts/vercel-staging-preflight.ps1 -SkipBuild
./scripts/vercel-staging-preflight.ps1 -SkipVercelAuth
```

## Qué valida

- Vínculo Vercel mediante `.vercel/project.json` o `.vercel/repo.json`.
- En `.vercel/repo.json`, exige un proyecto para `directory: "."` con `id` y `orgId`.
- `vercel.json` mantiene `buildCommand: npm run build` y `outputDirectory: .`.
- `npx vercel whoami` tiene sesión activa.
- `npm run build` pasa localmente, salvo que se use `-SkipBuild`.

## Estado actual observado

El repositorio quedó vinculado por Git con `.vercel/repo.json` al proyecto `gestiondehotel` del equipo `cararegoms-projects`. El preview creado fue:

```text
https://gestiondehotel-l3nsj335u-cararegoms-projects.vercel.app
```

El deployment inspeccionado quedó en estado `Ready`, target `preview`, id `dpl_GbFn5sVz3yWmAeKx9bNU4McSJq35`.

## Flujo seguro

```powershell
npm run vercel:staging:preflight
npx vercel deploy
```

El segundo comando crea un preview. Producción requiere aprobación separada y no debe usarse `--prod` dentro de este flujo.
