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

Se activan trazas de carga y navegación con muestreo del 10 %. No se activan Replay, logs ni sesiones automáticas. Se excluyen usuarios, cabeceras, cookies, cuerpos de peticiones, breadcrumbs y contextos adicionales; se conserva el contexto técnico de traza para correlacionar errores. El filtro elimina consultas y fragmentos de URLs y redacta patrones de credenciales, correos e identificadores en los mensajes. Evita incluir nombres o datos de huéspedes en mensajes de error: ningún filtro de texto puede reconocer todos los datos personales.

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


## Trazas de carga y navegación

El router mide el montaje de cada sección mediante `HotelTelemetry.startRoute`.
Los errores de inicio, desmontaje y `logMonitoringEvent` se remiten a Sentry.
`HotelMonitoring` conserva su API anterior y comparte la misma instancia.
Las páginas de recuperación, tienda y menú público también cargan el SDK.
La política de producción sigue usando `prod` y `sentry.config.json` como
configuración pública. Los previews y localhost están desactivados por defecto.
Para staging, definir antes del bundle:

```js
globalThis.__HOTEL_APP_CONFIG__ = {
  ...globalThis.__HOTEL_APP_CONFIG__,
  sentry: { enabled: true, environment: 'staging', tracesSampleRate: 1 },
};
```

El código de instrumentación está en `js/telemetry/sentry-client.js` y se incluye
mediante la entrada existente `js/monitoring/sentry-entry.mjs`. El mismo
`npm run build:sentry` regenera el bundle. No se instrumenta el backend ni se
añaden cabeceras de tracing a servicios externos.

Para verificar manualmente error y traza juntos, ejecutar en la consola:

```js
await HotelTelemetry.verifyConnection()
```

Se crea un evento sintético con `test_event=true`. `accepted: true` y los códigos
`eventHttpStatus: 200` y `traceHttpStatus: 200` confirman la aceptación por Sentry.
`flushed` por sí solo no confirma recepción. Esta prueba no se ejecuta automáticamente.
`HotelTelemetry.getStatus()` muestra activación, entorno, muestreo y la última
respuesta de una traza. Las incidencias antiguas no adquieren trazas retrospectivas.

Pruebas sin red: `node --test tests/sentry.test.cjs tests/sentry-telemetry.test.cjs`.
Prueba manual del bundle con datos sintéticos: `node scripts/serve-sentry-check.cjs`.
La página de esta prueba usa exclusivamente el entorno `verification`.
