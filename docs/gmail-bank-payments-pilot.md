# Piloto de pagos bancarios por Gmail

Guía operativa para configurar, desplegar, probar, activar, observar y desactivar la integración existente de Gestión de Hotel. Todos los identificadores y credenciales de este documento son placeholders. No copies secretos reales al repositorio, a tickets, capturas, chats ni logs.

## 0. Estado del despliegue del 4 de agosto de 2026

La base técnica del proyecto Supabase enlazado quedó instalada y verificada:

- la migración `20260803120000_bank_email_payments_pilot.sql` está aplicada;
- la búsqueda normalizada devuelve exactamente un hotel llamado `Hotel Marena San Isidro`, sin fijar su UUID;
- `bank-email-api`, `gmail-oauth-callback`, `gmail-webhook` y `gmail-watch-renew` están activas con las banderas JWT correctas;
- el cifrado de tokens, CORS explícito, redirect OAuth, audience OIDC y límites de montos están configurados en Supabase Secrets;
- `pg_cron`, `pg_net` y Vault están habilitados, y la renovación diaria corre a las 08:15 UTC (03:15 de Colombia);
- el kill switch está en `true` para permitir la interfaz y el simulador del hotel piloto;
- el smoke remoto obtuvo CORS 200, rechazo 401 sin credenciales y cron autenticado 200 con `gmail_not_connected`.

Google Cloud también quedó preparado en el proyecto `notificaciones-banco-hotel-ok`: Gmail API, Pub/Sub, IAM e IAM Credentials están habilitadas; existe el tema `gmail-bank-payments`; Gmail tiene permiso de publicación; y la suscripción push OIDC `gmail-bank-payments-push` está activa hacia el webhook con la cuenta `gmail-bank-push`.

El cliente OAuth dedicado de Gmail ya fue rotado; `GMAIL_OAUTH_CLIENT_ID` y `GMAIL_OAUTH_CLIENT_SECRET` están cargados en Supabase y Google reconoce la nueva pareja de credenciales. La ingestión real solo queda pendiente de deshabilitar el secreto anterior, crear la etiqueta/filtro, conectar la cuenta Gmail dedicada y aprobar reglas reales en `BANK_EMAIL_RULES_JSON`. Las credenciales `GOOGLE_*` existentes de Calendar permanecen aisladas.

## 1. Alcance y condiciones de seguridad

La integración está diseñada para un único hotel piloto resuelto en Supabase por nombre normalizado. No hay un UUID de hotel fijado en el código. La resolución se detiene si no encuentra exactamente una coincidencia o si el nombre es ambiguo.

Antes de continuar:

- Sustituye cada valor entre `<...>` en tu entorno privado.
- Mantén `BANK_EMAIL_INTEGRATION_ENABLED=false` durante toda la preparación.
- Confirma que el nombre configurado identifica exactamente un hotel.
- Usa una cuenta Gmail dedicada a notificaciones de pago, no un buzón personal multipropósito.
- No configures remitentes basándote en el nombre visible. Verifica direcciones, dominios, `Return-Path`, SPF, DKIM y DMARC con mensajes legítimos obtenidos por un canal autorizado.
- No ejecutes migraciones destructivas ni copies el `service_role` al navegador.

Placeholders usados en esta guía:

| Placeholder | Significado |
|---|---|
| `<SUPABASE_PROJECT_REF>` | Referencia pública del proyecto Supabase |
| `<APP_BASE_URL>` | URL HTTPS pública de la aplicación, sin ruta final |
| `<PILOT_HOTEL_NAME>` | Nombre exacto del hotel piloto en `hoteles.nombre` |
| `PAGOS HOTEL MARENA` | Etiqueta Gmail obligatoria y exacta para este flujo |
| `<GCP_PROJECT_ID>` | Proyecto de Google Cloud que posee OAuth, Gmail API y Pub/Sub |
| `<GCP_PROJECT_NUMBER>` | Número del mismo proyecto Google Cloud |
| `<PUBSUB_TOPIC_ID>` | Nombre corto del tema Pub/Sub |
| `<PUBSUB_SUBSCRIPTION_ID>` | Nombre corto de la suscripción push |
| `<PUBSUB_PUSH_SA_NAME>` | Nombre corto de la cuenta de servicio que firma el OIDC push |
| `<OAUTH_CLIENT_ID>` / `<OAUTH_CLIENT_SECRET>` | Credenciales OAuth de tipo aplicación web |
| `<TOKEN_ENCRYPTION_KEY>` | Clave aleatoria exclusiva para cifrar tokens |
| `<CRON_SECRET>` | Secreto aleatorio exclusivo para el cron |

## 2. Arquitectura implementada

```text
Administrador autorizado
        |
        | JWT de Supabase
        v
bank-email-api ---------------> OAuth de Google
        |                            |
        |                            v
        |                    gmail-oauth-callback
        |                            |
        |                    tokens cifrados + users.watch
        v                            |
Interfaz Pagos bancarios             v
                                Tema Pub/Sub
                                      |
                                 push OIDC JWT
                                      v
                                gmail-webhook
                                      |
                              inbox idempotente
                                      |
                          Gmail history.list/messages.get
                                      |
                       parser + validación + deduplicación
                                      |
             bank_payment_events / matching / notificaciones

gmail-watch-renew (cron diario) ---> renueva users.watch y drena reintentos
```

### Edge Functions

| Función | Autenticación | Responsabilidad |
|---|---|---|
| `bank-email-api` | JWT de Supabase y autorización interna | Estado del piloto, lista/detalle, simulación, acciones manuales y administración Gmail |
| `gmail-oauth-callback` | Sin JWT del gateway; estado OAuth de un solo uso | Intercambia el código, cifra tokens, registra la cuenta y crea Gmail Watch |
| `gmail-webhook` | Sin JWT del gateway; OIDC de Pub/Sub validado en código | Valida `aud`, emisor, firma, correo y `email_verified`; encola y procesa cambios Gmail |
| `gmail-watch-renew` | Sin JWT del gateway; `CRON_SECRET` validado en código | Drena reintentos y renueva Watch cuando vence en menos de 48 horas |

`supabase/config.toml` ya conserva `verify_jwt=true` para `bank-email-api` y `verify_jwt=false` para los tres endpoints externos. No conviertas `bank-email-api` en una función pública.

### Persistencia

Las migraciones versionadas crean o amplían las estructuras para:

- conexión Gmail y tokens cifrados;
- estados OAuth de corta duración y un solo uso;
- inbox Pub/Sub idempotente y reintentable;
- eventos bancarios, pagos esperados y relación segura;
- auditoría mínima;
- notificaciones del hotel;
- RLS y RPC de revisión/matching con comprobación del hotel piloto.

El cuerpo íntegro del correo no se persiste. Se guardan campos normalizados, metadatos mínimos y un hash SHA-256 del contenido. Las referencias se muestran parcialmente.

## 3. Variables de entorno

Crea un archivo privado, por ejemplo `<RUTA_ENV_PRIVADA>`, fuera del control de versiones:

```dotenv
# Kill switch: mantener false hasta la activación final.
BANK_EMAIL_INTEGRATION_ENABLED=false
BANK_EMAIL_PILOT_HOTEL_NAME="<PILOT_HOTEL_NAME>"

# OAuth web-server exclusivo de Gmail. No reemplaza el cliente de Calendar.
GMAIL_OAUTH_CLIENT_ID="<OAUTH_CLIENT_ID>"
GMAIL_OAUTH_CLIENT_SECRET="<OAUTH_CLIENT_SECRET>"
GMAIL_OAUTH_REDIRECT_URI="https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-oauth-callback"

# Gmail Watch y Pub/Sub.
GOOGLE_PUBSUB_TOPIC="projects/<GCP_PROJECT_ID>/topics/<PUBSUB_TOPIC_ID>"
GOOGLE_PUBSUB_VERIFICATION_AUDIENCE="https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-webhook"
GOOGLE_SERVICE_ACCOUNT_EMAIL="<PUBSUB_PUSH_SA_NAME>@<GCP_PROJECT_ID>.iam.gserviceaccount.com"
GMAIL_PAYMENT_LABEL="PAGOS HOTEL MARENA"

# Generar valores distintos, aleatorios y de alta entropía.
BANK_TOKEN_ENCRYPTION_KEY="<TOKEN_ENCRYPTION_KEY_DE_32_O_MAS_CARACTERES>"
CRON_SECRET="<CRON_SECRET_DE_32_O_MAS_CARACTERES>"

# Límites y matching.
BANK_EMAIL_MIN_AMOUNT_COP=1000
BANK_EMAIL_MAX_AMOUNT_COP=50000000
BANK_EMAIL_MATCH_WINDOW_MINUTES=30
BANK_EMAIL_RULES_JSON='<JSON_COMPACTO_DE_REGLAS_VALIDADO>'

# Orígenes exactos separados por coma; no usar * en producción.
BANK_EMAIL_ALLOWED_ORIGINS="<APP_BASE_URL>,<OTRO_ORIGEN_HTTPS_AUTORIZADO>"
SITE_URL="<APP_BASE_URL>/"
```

Consideraciones:

- Supabase aporta `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` a las Edge Functions. No los dupliques salvo que la plataforma lo requiera y nunca expongas `SUPABASE_SERVICE_ROLE_KEY` al frontend.
- `BANK_EMAIL_INTEGRATION_ENABLED` solo habilita con el texto estricto `true`.
- `BANK_TOKEN_ENCRYPTION_KEY` y `CRON_SECRET` deben ser diferentes.
- Cambiar `BANK_TOKEN_ENCRYPTION_KEY` sin recifrar o reconectar invalida los tokens almacenados. Planifica la rotación.
- `GOOGLE_PUBSUB_VERIFICATION_AUDIENCE` debe coincidir exactamente, incluyendo esquema y ruta, con el audience configurado en la suscripción.
- `SITE_URL` es el origen al que vuelve el callback como `app/index.html#/integraciones?...`.
- Los secretos de producción se administran con Supabase Secrets; el archivo local nunca se sube. Consulta [Environment Variables de Supabase](https://supabase.com/docs/guides/functions/secrets).

Carga los secretos:

```bash
supabase login
supabase link --project-ref <SUPABASE_PROJECT_REF>
supabase secrets set --env-file <RUTA_ENV_PRIVADA>
supabase secrets list
```

`supabase secrets list` debe mostrar nombres, pero no uses comandos que impriman valores. Supabase indica que los secretos actualizados quedan disponibles sin redesplegar las funciones.

## 4. `BANK_EMAIL_RULES_JSON`

Las reglas son una frontera de seguridad. Cada regla puede limitar remitentes, `Return-Path`, dominios de autenticación, términos y expresiones de extracción. Las expresiones son patrones de JavaScript sin delimitadores `/.../`; los extractores de monto, referencia y pagador esperan el valor en el primer grupo de captura.

Ejemplo con direcciones y dominios ficticios reservados `.test`:

```json
[
  {
    "id": "bancolombia",
    "bankName": "Bancolombia - configuracion de prueba",
    "senderName": "Banco de prueba",
    "allowedFromAddresses": [
      "avisos@banco-ejemplo.test"
    ],
    "allowedFromDomains": [
      "banco-ejemplo.test"
    ],
    "allowedReturnPathAddresses": [
      "rebotes@mailer.banco-ejemplo.test"
    ],
    "allowedReturnPathDomains": [
      "mailer.banco-ejemplo.test"
    ],
    "allowedAuthenticationDomains": [
      "banco-ejemplo.test"
    ],
    "requireSpf": true,
    "requireDkim": true,
    "requireDmarc": true,
    "expectedSubjectTerms": [
      "transferencia recibida"
    ],
    "expectedBodyTerms": [
      "recibiste una transferencia"
    ],
    "successExpressions": [
      "\\b(?:transferencia|pago)\\s+(?:recibida|recibido|exitosa|exitoso)\\b"
    ],
    "amountExpressions": [
      "(?:COP|\\$)\\s*([0-9][0-9.,]*)"
    ],
    "referenceExpressions": [
      "referencia\\s*[:#-]?\\s*([A-Za-z0-9._-]{4,80})"
    ],
    "payerNameExpressions": [
      "(?:remitente|pagador)\\s*[:#-]?\\s*([^\\n,;]{2,120})"
    ],
    "parserVersion": "pilot-test-1"
  },
  {
    "id": "generic",
    "bankName": "Banco Generico de Prueba",
    "allowedFromAddresses": [
      "notificaciones@otro-banco.test"
    ],
    "allowedFromDomains": [
      "otro-banco.test"
    ],
    "allowedAuthenticationDomains": [
      "otro-banco.test"
    ],
    "requireSpf": true,
    "requireDkim": true,
    "requireDmarc": true,
    "successExpressions": [
      "\\b(?:abono|transferencia)\\s+(?:recibido|recibida)\\b"
    ],
    "parserVersion": "generic-test-1"
  }
]
```

Este JSON es demostrativo y no autoriza ningún banco real. Antes de producción:

1. Obtén varios correos legítimos por un canal aprobado.
2. Compara `From`, `Return-Path`, `Authentication-Results`, dominios SPF/DKIM/DMARC y variaciones reales de asunto/cuerpo.
3. Sustituye los remitentes ficticios por allowlists exactas revisadas por dos personas.
4. Mantén SPF, DKIM y DMARC requeridos salvo una excepción documentada y temporal.
5. Prueba recibidos, enviados, fallidos, reversados, montos múltiples y mensajes sin monto.
6. Versiona el cambio operativo, no el secreto con los valores reales.

Notas de comportamiento:

- El registro admite hasta 30 reglas; JSON inválido se trata como lista vacía.
- Una regla necesita al menos `id` y `bankName` para ser cargada.
- Expresiones inválidas o de más de 300 caracteres se ignoran.
- El parser `generic` nunca confirma automáticamente: deja un caso válido en revisión manual.
- Una allowlist ausente no vuelve confiable al remitente; degrada a revisión.
- Un `From`/`Return-Path` no autorizado o un fallo explícito de autenticación rechaza el mensaje.
- Cambiar reglas no reprocesa automáticamente eventos históricos.

Convierte el JSON validado a una sola línea antes de colocarlo en el archivo de secretos. No lo construyas directamente en la consola de producción sin validarlo primero.

## 5. Despliegue de Supabase

### 5.1 Preflight

1. Haz respaldo y revisa las migraciones pendientes.
2. Confirma que el nombre normalizado del hotel piloto produce exactamente una fila. No copies ni configures su UUID.
3. Ejecuta pruebas y sintaxis:

```bash
npm run check:syntax
npm test
```

4. Mantén el kill switch en `false`.

### 5.2 Base de datos

Con el proyecto correcto enlazado:

```bash
supabase db push --linked
```

Revisa después que las tablas, índices únicos, RLS, RPC y funciones de claim/matching estén presentes. No desactives RLS ni concedas escritura directa al cliente para facilitar pruebas.

### 5.3 Edge Functions

Despliega explícitamente:

```bash
supabase functions deploy bank-email-api --project-ref <SUPABASE_PROJECT_REF>
supabase functions deploy gmail-oauth-callback --project-ref <SUPABASE_PROJECT_REF> --no-verify-jwt
supabase functions deploy gmail-webhook --project-ref <SUPABASE_PROJECT_REF> --no-verify-jwt
supabase functions deploy gmail-watch-renew --project-ref <SUPABASE_PROJECT_REF> --no-verify-jwt
```

La opción `--no-verify-jwt` no significa que webhook, callback o cron queden sin seguridad: cada uno valida en código su credencial específica. La guía oficial de despliegue está en [Deploy to Production](https://supabase.com/docs/guides/functions/deploy).

Verifica en el Dashboard:

- `bank-email-api`: JWT requerido.
- `gmail-oauth-callback`, `gmail-webhook`, `gmail-watch-renew`: gateway JWT desactivado.
- Secrets presentes.
- No hay secretos ni cuerpos de correo en logs.

## 6. Google Cloud y OAuth

Google mantiene la guía oficial para OAuth web-server en [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server).

### 6.1 Proyecto y APIs

En un único proyecto `<GCP_PROJECT_ID>`:

```bash
gcloud config set project <GCP_PROJECT_ID>
gcloud services enable gmail.googleapis.com pubsub.googleapis.com iamcredentials.googleapis.com
```

El proyecto que aparece en `GOOGLE_PUBSUB_TOPIC` debe ser el mismo proyecto Google que ejecuta `users.watch`. Gmail exige esa coincidencia en [users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch).

### 6.2 Pantalla de consentimiento

1. Configura la marca, dominio autorizado, política de privacidad y contacto de soporte.
2. Mientras esté en pruebas, limita la aplicación a usuarios de prueba expresamente autorizados.
3. Solicita únicamente `https://www.googleapis.com/auth/gmail.readonly`.
4. Declara con precisión que se leen mensajes etiquetados para detectar pagos y que no se usa la información con fines publicitarios.
5. No publiques el piloto externamente antes de completar los requisitos de verificación aplicables.

### 6.3 Cliente OAuth

Crea credenciales de tipo **Web application** y registra exactamente:

```text
https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-oauth-callback
```

El mismo valor debe ir en `GMAIL_OAUTH_REDIRECT_URI`. No agregues comodines, HTTP ni redirects alternativos que no se utilicen.

Usa `GMAIL_OAUTH_CLIENT_ID` y `GMAIL_OAUTH_CLIENT_SECRET` para mantener este cliente separado de `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET`, que pueden estar emitiendo tokens para Google Calendar. La implementaciÃ³n conserva los nombres `GOOGLE_*` solo como compatibilidad con despliegues anteriores.

La implementación pide acceso offline y consentimiento para obtener un refresh token; el backend cifra access y refresh tokens con AES-GCM antes de persistirlos. Si Google no entrega refresh token, revoca el consentimiento anterior, desconecta la integración y repite la autorización de forma controlada.

## 7. Pub/Sub con OIDC

### 7.1 Tema y permiso de publicación de Gmail

Crea el tema:

```bash
gcloud pubsub topics create <PUBSUB_TOPIC_ID> --project <GCP_PROJECT_ID>
```

Concede **solo** `roles/pubsub.publisher` sobre ese tema a la identidad oficial de Gmail:

```bash
gcloud pubsub topics add-iam-policy-binding \
  projects/<GCP_PROJECT_ID>/topics/<PUBSUB_TOPIC_ID> \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

`gmail-api-push@system.gserviceaccount.com` es la identidad global oficial que Gmail usa para publicar. No es una dirección del hotel ni una credencial del proyecto. Si una política de organización bloquea esa identidad oficial, crea una excepción aprobada; consulta [Configure push notifications in Gmail API](https://developers.google.com/workspace/gmail/api/guides/push).

### 7.2 Identidad para el push autenticado

Crea una cuenta dedicada:

```bash
gcloud iam service-accounts create <PUBSUB_PUSH_SA_NAME> \
  --project <GCP_PROJECT_ID> \
  --display-name="<DISPLAY_NAME_NO_SENSIBLE>"
```

La identidad resultante debe coincidir exactamente con `GOOGLE_SERVICE_ACCOUNT_EMAIL`.

El agente de servicio de Pub/Sub necesita generar el token OIDC. Aplica el permiso con el menor alcance permitido por tu organización:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  <PUBSUB_PUSH_SA_NAME>@<GCP_PROJECT_ID>.iam.gserviceaccount.com \
  --project <GCP_PROJECT_ID> \
  --member="serviceAccount:service-<GCP_PROJECT_NUMBER>@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Quien crea o actualiza la suscripción también necesita `iam.serviceAccounts.actAs` sobre la cuenta push; `roles/iam.serviceAccountUser` lo incluye. No concedas ese rol a usuarios que no administren la integración.

### 7.3 Suscripción push

```bash
gcloud pubsub subscriptions create <PUBSUB_SUBSCRIPTION_ID> \
  --project <GCP_PROJECT_ID> \
  --topic projects/<GCP_PROJECT_ID>/topics/<PUBSUB_TOPIC_ID> \
  --push-endpoint "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-webhook" \
  --push-auth-service-account "<PUBSUB_PUSH_SA_NAME>@<GCP_PROJECT_ID>.iam.gserviceaccount.com" \
  --push-auth-token-audience "https://<SUPABASE_PROJECT_REF>.supabase.co/functions/v1/gmail-webhook"
```

No habilites payload sin wrapper: `gmail-webhook` espera el envelope estándar `message.data`, `messageId` y `subscription`. No añadas secretos en query strings.

La función verifica criptográficamente el JWT, issuer de Google, algoritmo RS256, `aud`, correo exacto y `email_verified`. Google explica la configuración y validación en [Authentication for push subscriptions](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions).

Prueba de seguridad mínima:

- POST sin `Authorization`: debe devolver 401 cuando el kill switch está activo.
- JWT con audience o correo distintos: debe devolver 401.
- Envelope inválido con OIDC válido: se reconoce sin almacenar datos bancarios.
- Respuesta 2xx: Pub/Sub la considera ACK; 4xx/5xx provocan diagnóstico o reintento según el caso.

## 8. Etiqueta y filtro de Gmail

Para las notificaciones del piloto asociadas a la llave `@hotelok`, el filtro de enrutamiento debe ser estrecho:

```text
De: alertasynotificaciones@an.notificacionesbancolombia.com
Contiene las palabras: "conectado a la llave @hotelok"
Acción: aplicar la etiqueta PAGOS HOTEL MARENA
```

Este filtro solo decide qué mensajes entran al flujo; no convierte al remitente en confiable. La aprobación automática continúa exigiendo `Return-Path`, SPF, DKIM y DMARC verificados mediante los encabezados originales. Créalo antes de la siguiente transferencia: aplicar la etiqueta manualmente después de recibir un correo no garantiza un evento `messageAdded` nuevo para Gmail Watch.

La etiqueta no se crea automáticamente.

1. En Gmail web, crea una etiqueta cuyo nombre sea exactamente `PAGOS HOTEL MARENA`.
2. Abre las opciones de búsqueda y construye un filtro con remitentes **verificados**, por ejemplo:

```text
from:(<REMITENTE_BANCARIO_VERIFICADO_1> OR <REMITENTE_BANCARIO_VERIFICADO_2>) subject:(<TERMINO_ESPERADO>)
```

3. Ejecuta primero la búsqueda y revisa que no incluya extractos, débitos, reversos, mensajes personales u otros bancos.
4. Crea el filtro y selecciona **Aplicar la etiqueta** `PAGOS HOTEL MARENA`.
5. No actives reenvío, eliminación automática ni una regla basada únicamente en un monto.
6. Para el primer despliegue, evita aplicar el filtro masivamente a conversaciones antiguas; reduce el riesgo de reprocesar mensajes previos durante una recuperación de historial.

La ayuda oficial está en [Crear y gestionar etiquetas](https://support.google.com/mail/answer/118708?hl=es) y [Crear reglas para filtrar correos](https://support.google.com/mail/answer/6579?hl=es).

La etiqueta reduce qué cambios generan push, pero no es una barrera de autenticidad. El parser sigue validando remitente y autenticación del mensaje.

## 9. Conexión y `users.watch`

Con la migración, funciones, secretos, etiqueta y Pub/Sub ya preparados, habilita el piloto justo antes de iniciar OAuth:

```bash
supabase secrets set BANK_EMAIL_INTEGRATION_ENABLED=true --project-ref <SUPABASE_PROJECT_REF>
```

1. Inicia sesión como administrador autorizado del hotel piloto.
2. Abre **Integraciones → Correo de pagos**. Otros hoteles y usuarios no administradores no deben ver la tarjeta.
3. Comprueba que aparezca **Procesamiento habilitado**.
4. Pulsa **Conectar Gmail** y autoriza la cuenta dedicada.
5. El callback debe volver a `#/integraciones` con resultado de éxito o `connected_watch_pending`.
6. Comprueba correo conectado, etiqueta configurada, estado Watch y expiración.
7. Si aparece `label_missing`, crea/corrige la etiqueta exacta y pulsa **Renovar Gmail Watch**.
8. Usa **Probar conexión** para validar perfil y token sin procesar correos.

La implementación registra Watch con la etiqueta en modo `INCLUDE`. Un `watch` exitoso devuelve `historyId` y expiración, y también suele generar una notificación inmediata. Gmail exige renovarlo al menos cada siete días y recomienda hacerlo diariamente; consulta [push notifications](https://developers.google.com/workspace/gmail/api/guides/push).

## 10. Cron diario en Supabase

`gmail-watch-renew`:

- responde 204 sin procesar cuando el kill switch está apagado;
- exige `x-cron-secret` o Bearer cuando está encendido;
- reclama hasta 50 reintentos pendientes;
- omite la renovación si Watch sigue activo por más de 48 horas;
- registra auditoría y alerta a administradores tras tres fallos consecutivos.

Supabase recomienda `pg_cron` + `pg_net` y Vault para invocar Edge Functions: [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

Habilita `pg_cron`, `pg_net` y Vault desde el Dashboard si aún no existen. Guarda URL y secreto una sola vez:

```sql
select vault.create_secret(
  'https://<SUPABASE_PROJECT_REF>.supabase.co',
  'bank_email_project_url'
);

select vault.create_secret(
  '<CRON_SECRET>',
  'bank_email_cron_secret'
);
```

Programa una ejecución diaria en UTC. Sustituye `<CRON_DAILY_UTC>` por una expresión cron válida aprobada:

```sql
select cron.schedule(
  'gmail-bank-watch-renew-daily',
  '<CRON_DAILY_UTC>',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'bank_email_project_url'
    ) || '/functions/v1/gmail-watch-renew',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'bank_email_cron_secret'
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

Comprueba el job sin revelar secretos:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'gmail-bank-watch-renew-daily';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid = (
  select jobid from cron.job where jobname = 'gmail-bank-watch-renew-daily'
)
order by start_time desc
limit 20;
```

No incrustes el secreto directamente en la definición visible del job. Para rotarlo, actualiza Supabase Secrets y Vault de forma coordinada, prueba una ejecución y revoca el valor anterior.

## 11. Simulador

El simulador aparece únicamente a administradores autorizados. Usa siempre remitentes y contenido ficticios.

Para probar una coincidencia única, primero usa el formulario **Registrar pago esperado** de la misma pantalla: selecciona una reserva activa, crea una intención por el mismo monto con método `llave` o `transferencia` y vigencia de 30 minutos. Después ejecuta la simulación sin guardar. Las simulaciones guardadas muestran la coincidencia como vista previa, pero deliberadamente no modifican el pago esperado real ni generan notificaciones.

Ejemplo seguro:

```text
Asunto: Transferencia de prueba recibida
From: avisos@banco-ejemplo.test
Return-Path: rebotes@mailer.banco-ejemplo.test
Authentication-Results: mx.google.com; spf=pass smtp.mailfrom=banco-ejemplo.test; dkim=pass header.d=banco-ejemplo.test; dmarc=pass header.from=banco-ejemplo.test
Contenido: Recibiste una transferencia por llave de $80.000. Referencia TEST-123456. Remitente: Persona Ficticia.
```

### Analizar sin guardar (`save=false`)

- Ejecuta parser, validación de remitente, extracción y preview de matching.
- No inserta `bank_payment_events`, no genera notificación y no escribe un evento bancario.
- Puede consultar pagos esperados para construir la vista previa.
- Es el modo obligatorio para la primera prueba de cada regla.

Verifica:

- monto entero COP;
- banco y referencia parcial;
- decisión `detected`, `manual_review` o `rejected`;
- razones de revisión;
- candidato esperado solo cuando la coincidencia es única.

### Guardar evento de prueba (`save=true`)

- Inserta un evento con `metadata.is_test=true` cuando el análisis tiene monto válido.
- Ejecuta deduplicación y auditoría, pero no modifica pagos esperados reales.
- No genera notificaciones: el trigger omite expresamente los eventos con `metadata.is_test=true`.
- Muestra la coincidencia que habría elegido como vista previa en `metadata.match_preview`, sin relacionarla.

Procedimiento seguro:

1. Prefiere staging.
2. Si debes probar en el piloto, usa una ventana de mantenimiento y un monto ficticio permitido que no coincida con pagos pendientes.
3. Confirma con una consulta previa que no haya candidatos por ese monto y ventana.
4. Guarda una sola vez.
5. Verifica el distintivo **Prueba**, la auditoría y la ausencia de relación inesperada.
6. Rechaza o cierra manualmente el evento de prueba según el procedimiento interno; no borres filas para ocultar la traza.

Casos mínimos:

| Caso | Resultado esperado |
|---|---|
| Recibido, remitente autorizado, autenticación válida, monto único | `detected` o `matched` |
| Dos pagos esperados del mismo monto/ventana | `manual_review` |
| Sin pago esperado | `detected` |
| Parser genérico válido | `manual_review` |
| Débito, enviado, reversado o fallido | `rejected` |
| `From`, `Return-Path` o dominio de autenticación no permitido | `rejected` |
| Mismo mensaje o fingerprint | No crea un segundo movimiento |

## 12. Activación gradual

Checklist antes de cambiar el kill switch:

- [ ] Migraciones aplicadas y RLS revisada.
- [ ] Pruebas y sintaxis en verde.
- [ ] Resolución del hotel devuelve exactamente una coincidencia.
- [ ] Tarjeta visible solo para administrador piloto.
- [ ] OAuth conectado a la cuenta dedicada.
- [ ] Etiqueta exacta y filtro estrecho creados.
- [ ] Watch activo y con expiración futura.
- [ ] Pub/Sub push autenticado; 401 sin OIDC.
- [ ] Cron diario creado y una ejecución manual exitosa.
- [ ] Reglas revisadas con mensajes legítimos y ejemplos adversariales.
- [ ] Simulación `save=false` correcta.
- [ ] Simulación `save=true` controlada y marcada como prueba, si fue autorizada.
- [ ] Alertas y responsable operativo definidos.

Activa sin redesplegar:

```bash
supabase secrets set BANK_EMAIL_INTEGRATION_ENABLED=true --project-ref <SUPABASE_PROJECT_REF>
```

Después:

1. Actualiza Integraciones y confirma **Procesamiento habilitado**.
2. Ejecuta un único caso real controlado, sin datos en capturas o tickets.
3. Verifica evento, relación, notificación, auditoría e idempotencia.
4. Observa Pub/Sub, Edge Functions y cola durante el periodo piloto.

## 13. Rollback y kill switch

Rollback inmediato:

```bash
supabase secrets set BANK_EMAIL_INTEGRATION_ENABLED=false --project-ref <SUPABASE_PROJECT_REF>
```

Efecto:

- `gmail-webhook` responde 204 y no encola/procesa;
- `gmail-watch-renew` responde 204 y no renueva ni drena cola;
- la interfaz marca el procesamiento como deshabilitado y bloquea la ruta operativa;
- credenciales, Watch existente y datos históricos permanecen.

Importante: mientras está apagado, los pushes se reconocen sin almacenar. Si Watch vence, deberá renovarse al reactivar. Un push posterior puede permitir recuperar historial desde el cursor, pero no se debe asumir recuperación ilimitada.

Apagado completo, si está autorizado:

1. Kill switch en `false`.
2. Desde Integraciones, **Desconectar** para detener Watch, revocar el token y eliminar credenciales cifradas locales.
3. Deshabilitar la suscripción Pub/Sub o retirar su push config.
4. Desactivar el cron, no eliminarlo sin guardar evidencia del cambio.
5. Conservar tablas y auditoría según retención; no hacer rollback destructivo de migraciones.

Para desactivar el cron sin borrarlo:

```sql
select cron.alter_job(
  (select jobid from cron.job where jobname = 'gmail-bank-watch-renew-daily'),
  active := false
);
```

Verifica la firma disponible de `cron.alter_job` en la versión instalada antes de ejecutar en producción. Si no está disponible, usa el Dashboard de Supabase Cron.

## 14. Seguridad y privacidad

- **Tenant:** todas las operaciones bancarias vuelven a comprobar el hotel piloto en servidor; el frontend no decide el tenant.
- **RLS:** usuarios solo leen filas de su hotel; mutaciones automáticas usan `service_role` dentro de Edge Functions.
- **OAuth:** estado aleatorio, almacenado como hash, expira y se consume una sola vez.
- **Tokens:** access/refresh tokens se cifran con AES-GCM y nunca se devuelven al navegador.
- **Pub/Sub:** el webhook valida firma OIDC de Google, issuer, audience, correo exacto y `email_verified`.
- **Remitentes:** allowlists más SPF/DKIM/DMARC; el nombre visible nunca basta.
- **Minimización:** no se almacena el cuerpo completo; sí campos necesarios, dominios/veredictos normalizados y hash.
- **Logs:** solo códigos seguros e identificadores internos mínimos. No registrar JWT, tokens, headers completos, cuerpos, referencias completas ni correos conectados.
- **CORS:** orígenes explícitos; nunca `*` con este flujo.
- **Separación de secretos:** cifrado y cron usan valores diferentes; Google Client Secret no se reutiliza.
- **Revisión humana:** parser genérico y ambigüedades no confirman automáticamente.
- **Desconexión:** elimina credenciales locales y procura revocar el refresh token; conserva auditoría.

Define además:

- política de retención para eventos, inbox, estados OAuth consumidos y auditoría;
- procedimiento de acceso excepcional y respuesta a incidentes;
- responsable de revisar `manual_review` y fallos Watch;
- procedimiento documentado de rotación de secretos y reconexión.

## 15. Observabilidad

### Supabase

Revisa Invocations y Logs por función desde el Dashboard; la guía oficial es [Edge Function Logging](https://supabase.com/docs/guides/functions/logging).

Señales:

- `gmail-webhook`: 401 indica OIDC/audience/correo incorrecto; 5xx indica fallo temporal.
- `bank-email-api`: 401/403 indica sesión, hotel o rol no autorizado.
- `gmail-watch-renew`: `watch_still_valid`, `gmail_not_connected`, renovación exitosa o error seguro.
- `bank-email-queue`: crecimiento de `failed`, reintentos o cursores conflictivos.
- auditoría: `payment_detected`, `auto_matched`, `duplicate_detected`, `parse_error`, acciones manuales, conexión/desconexión y renovación Watch.

Consultas operativas agregadas, sin mostrar contenido sensible:

```sql
select status, count(*) as total, max(updated_at) as ultimo_cambio
from bank_email_pubsub_inbox
group by status
order by status;

select status, count(*) as total, max(created_at) as ultimo_evento
from bank_payment_events
group by status
order by status;

select action, count(*) as total, max(created_at) as ultima_ocurrencia
from bank_payment_audit_log
group by action
order by ultima_ocurrencia desc;
```

No pegues resultados con correos, referencias, IDs o montos individuales en canales no autorizados.

### Google Cloud

En Pub/Sub/Cloud Monitoring observa:

- `subscription/push_request_count`, agrupado por response class;
- `subscription/push_request_latencies`;
- mensajes pendientes y edad del más antiguo;
- tasa de 4xx, 5xx y redelivery;
- dead-letter count si se configura un tema de mensajes muertos.

Google publica la guía en [Monitor Pub/Sub](https://docs.cloud.google.com/pubsub/docs/monitoring) y [Troubleshooting push subscriptions](https://docs.cloud.google.com/pubsub/docs/push-troubleshooting).

Alertas mínimas:

- cualquier 401 sostenido en webhook;
- 5xx o backlog durante varios intervalos;
- Watch distinto de `active`;
- expiración a menos de 48 horas;
- tres renovaciones fallidas;
- aumento de `parse_error`, `manual_review` o duplicados fuera del patrón esperado.

## 16. Limitaciones conocidas

1. **Scope restringido.** `gmail.readonly` permite leer mensajes y configuración del buzón y Google lo clasifica como restricted scope. La etiqueta limita notificaciones/procesamiento, no el permiso técnico concedido. Consulta [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
2. **Verificación y assessment.** Una aplicación externa en producción puede necesitar verificación de restricted scopes y, al acceder/almacenar/transmitir datos restringidos desde un servidor, una evaluación de seguridad periódica. El código no sustituye ese proceso. Consulta [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) y la [Google Workspace API User Data Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy).
3. **No existe un scope Gmail limitado a una etiqueta.** La reducción a `PAGOS HOTEL MARENA` ocurre en `users.watch` y en las consultas, no en OAuth.
4. **Entrega push no absoluta.** Gmail limita a una notificación por segundo por usuario y reconoce que pueden existir retrasos o pérdidas excepcionales. La idempotencia maneja redelivery, pero no reemplaza una reconciliación independiente.
5. **Historial finito.** Un `startHistoryId` antiguo puede devolver 404. La implementación recupera de forma conservadora hasta 500 mensajes etiquetados; si el buzón supera ese límite, falla cerrado y exige reconciliación manual en lugar de avanzar silenciosamente el cursor. No es una sincronización histórica ilimitada. Consulta [users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list).
6. **Watch expira.** Debe renovarse; si cron deja de ejecutarse o el kill switch permanece apagado, el flujo puede detenerse.
7. **Un buzón conectado.** El piloto gestiona una integración Google por hotel/proveedor.
8. **Parsers iniciales.** Existe parser especializado y fallback genérico. Nuevos formatos bancarios requieren reglas probadas o un parser adicional; el genérico siempre exige revisión manual.
9. **Headers variables.** La disponibilidad/formato de `Authentication-Results`, SPF, DKIM y DMARC depende del mensaje recibido; ausencia requerida conduce a revisión.
10. **Sin purga automática documentada.** Define retención antes de producción y crea una tarea separada, revisada y recuperable.
11. **Sin dead-letter topic obligatorio.** La cola interna reintenta; un dead-letter topic de Pub/Sub es una mejora operativa opcional.
12. **Simulación con guardado tiene efectos limitados.** Persiste y deduplica el evento de prueba, pero no hace matching real ni genera notificaciones porque queda marcada `metadata.is_test=true`.

## 17. Cierre operativo

La activación se considera correcta solo cuando:

- el hotel se resuelve de forma única sin UUID hardcodeado;
- ningún otro hotel ve menú, tarjeta, eventos o notificaciones;
- OIDC rechaza identidades/audiences incorrectos;
- Watch y cron están activos;
- la etiqueta y las reglas son estrechas y verificadas;
- el parser rechaza enviados, fallidos, reversos y remitentes no autorizados;
- las ambigüedades quedan en revisión;
- los duplicados no crean un segundo pago;
- logs y auditoría no contienen secretos ni cuerpo completo;
- existe responsable y procedimiento probado para kill switch, desconexión y respuesta a incidentes.

## 18. Referencias oficiales

- [Gmail: Configure push notifications](https://developers.google.com/workspace/gmail/api/guides/push)
- [Gmail: users.watch](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users/watch)
- [Gmail: users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)
- [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)
- [OAuth 2.0 web-server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Google Workspace API User Data Policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy)
- [Pub/Sub authenticated push](https://docs.cloud.google.com/pubsub/docs/authenticate-push-subscriptions)
- [Pub/Sub push troubleshooting](https://docs.cloud.google.com/pubsub/docs/push-troubleshooting)
- [Supabase Edge Function deploy](https://supabase.com/docs/guides/functions/deploy)
- [Supabase Edge Function secrets](https://supabase.com/docs/guides/functions/secrets)
- [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Edge Function logging](https://supabase.com/docs/guides/functions/logging)
- [Gmail Help: filtros](https://support.google.com/mail/answer/6579?hl=es)
- [Gmail Help: etiquetas](https://support.google.com/mail/answer/118708?hl=es)
