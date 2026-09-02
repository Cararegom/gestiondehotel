# Sentry

El frontend utiliza `@sentry/browser` 10.73.0. El build genera `js/sentry-browser.js`, servido desde el propio sitio e inicializado antes del código de la landing, login y aplicación. El service worker incluye este archivo para el uso sin conexión.

## Configuración del proyecto

`sentry.config.json` contiene el DSN público existente del proyecto `gestiondehotel`. Este identificador permite enviar eventos; no es el token administrativo. No contiene `SENTRY_AUTH_TOKEN` ni `SENTRY_ORG`.

```powershell
npm ci
npm run build
```

El build funciona sin secretos Sentry. Para volver a obtener el DSN desde Sentry usando las variables de Windows:

```powershell
./scripts/sentry.ps1 -Action configure
npm run build:sentry
```

Se capturan excepciones JavaScript no controladas y promesas rechazadas. Para errores ya capturados por la aplicación puede usarse `globalThis.HotelMonitoring?.captureException(error)`.

Los dominios `gestiondehotel.com` y `www.gestiondehotel.com` usan `prod`; localhost usa `development` y otros dominios usan `preview`. La versión enviada es `gestiondehotel@<revision>`. La configuración no incluye las funciones de Supabase.

No se activan Replay, trazas de rendimiento, logs ni sesiones automáticas. Se excluyen usuarios, cabeceras, cookies, cuerpos de peticiones, breadcrumbs y contextos adicionales. El filtro elimina consultas y fragmentos de URLs y redacta patrones de credenciales, correos e identificadores en los mensajes. Evita incluir nombres o datos de huéspedes en mensajes de error: ningún filtro de texto puede reconocer todos los datos personales.

Para desactivar la captura, cambia `enabled` a `false` en la configuración y recompila. También se respeta `globalThis.__HOTEL_APP_CONFIG__.sentry.enabled = false` si se establece antes de cargar el SDK.

## Plugin Sentry de Codex

El plugin instalado proporciona consultas de solo lectura mediante su script original `sentry_api.py`. Este repositorio añade un lanzador de Windows que carga las variables en memoria y toma el proyecto de `sentry.config.json`:

```powershell
npm run sentry:status
npm run sentry:verify
npm run sentry:issues
./scripts/sentry.ps1 -Action issues -Environment development -Limit 10
./scripts/sentry.ps1 -Action event -EventId <id-del-evento>
```

Las variables `SENTRY_AUTH_TOKEN` y `SENTRY_ORG` deben existir en el proceso, usuario o sistema de Windows. No hace falta escribirlas en `.env` ni configurar `SENTRY_PROJECT` globalmente. Si un proceso restringido no puede leer el perfil de usuario, debe usarse el contexto de Windows autorizado. El lanzador no modifica la configuración global de Codex, la instalación del plugin ni las variables persistentes.

El token necesita permisos de lectura del proyecto y eventos; obtener el DSN también requiere acceso a las claves públicas del proyecto. Los errores del lanzador omiten respuestas HTTP y credenciales.

Esto configura el plugin local instalado en Codex. Una conexión en ChatGPT web, si se utiliza por separado, necesita su propia autorización; no recibe las variables de Windows.

## Verificación manual de extremo a extremo

```powershell
npm run sentry:test
./scripts/sentry.ps1 -Action event -EventId <id-devuelto>
```

El primer comando envía un único error sintético mediante el SDK oficial al entorno `verification`. El segundo lo recupera mediante el plugin. Ni `npm test` ni el build envían este evento. No se envían datos del hotel.

No se suben sourcemaps: los módulos propios de la aplicación se sirven sin minificar y el bundle nuevo contiene principalmente el SDK. Esta configuración es local hasta que los cambios se confirmen, publiquen y desplieguen mediante el flujo habitual.

Referencias: [SDK JavaScript](https://docs.sentry.io/platforms/javascript/), [filtrado de eventos](https://docs.sentry.io/platforms/javascript/configuration/filtering/), [plugins de OpenAI](https://learn.chatgpt.com/docs/plugins).
