# Seguridad de Secretos

Este documento deja claro que secretos ya no deben vivir en el repo y cuales deben configurarse fuera del codigo.

## Cambios aplicados

- Se retiro el token privado de Mercado Pago del frontend.
- La creacion de preferencias de Mercado Pago ahora debe pasar por la Edge Function `mercadopago-create-preference`.
- El checkout SaaS de `Mi Cuenta` ahora usa la Edge Function `billing-create-checkout`, que calcula el monto autoritativo en backend para Wompi y Mercado Pago.
- La configuracion de Alegra ahora se guarda con la Edge Function `alegra-save-config` y la notificacion a Zapier/Alegra pasa por `alegra-zapier-notify`.
- La capa real de `supabase/functions` ya quedo versionada en el repo; el inventario esta en `docs/backend-functions-inventory.md`.
- El correo del corte de caja ahora se envia con la Edge Function `send-cash-close-report`, en lugar de exponer el webhook en frontend.
- El script `scripts/watch.js` ya no contiene `client_secret` ni tokens embebidos; ahora lee variables de entorno.
- Se ampliaron reglas de `.gitignore` para evitar subir archivos locales con secretos.

## Secretos que deben existir fuera del repo

### Supabase Edge Functions

Configurar en Supabase:

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_URL` (opcional, si quieres sobrescribir el valor por defecto)
- `WOMPI_PUBLIC_KEY`
- `WOMPI_EVENT_SECRET_KEY`
- `MAKE_CASH_CLOSE_WEBHOOK_URL`
- `MAKE_DISCOUNT_EMAIL_WEBHOOK_URL` (opcional si quieres separar el flujo de descuentos del corte de caja)
- `OPENAI_API_KEY`
- `OPENAI_WORKFLOW_ID`
- `OPENAI_SUPPORT_WORKFLOW_ID`
- `API_BASE_URL`
- `SITE_URL`
- `MY_ENCRYPTION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`

Ejemplo:

```bash
npx supabase secrets set MERCADOPAGO_ACCESS_TOKEN=tu_token_privado
npx supabase secrets set MERCADOPAGO_WEBHOOK_URL=https://tu-proyecto.supabase.co/functions/v1/mercadopagoWebhook
npx supabase secrets set WOMPI_PUBLIC_KEY=tu_wompi_public_key
npx supabase secrets set WOMPI_EVENT_SECRET_KEY=tu_event_secret_wompi
npx supabase secrets set MAKE_CASH_CLOSE_WEBHOOK_URL=https://tu-webhook-de-make
npx supabase secrets set MAKE_DISCOUNT_EMAIL_WEBHOOK_URL=https://tu-webhook-de-make-para-descuentos
npx supabase secrets set OPENAI_API_KEY=tu_openai_key
npx supabase secrets set OPENAI_WORKFLOW_ID=tu_workflow_comercial
npx supabase secrets set OPENAI_SUPPORT_WORKFLOW_ID=tu_workflow_soporte
npx supabase secrets set API_BASE_URL=https://tu-proyecto.supabase.co
npx supabase secrets set SITE_URL=https://gestiondehotel.com
npx supabase secrets set MY_ENCRYPTION_SECRET=tu_clave_de_cifrado
npx supabase secrets set GOOGLE_CLIENT_ID=tu_google_client_id
npx supabase secrets set GOOGLE_CLIENT_SECRET=tu_google_client_secret
npx supabase secrets set OUTLOOK_CLIENT_ID=tu_outlook_client_id
npx supabase secrets set OUTLOOK_CLIENT_SECRET=tu_outlook_client_secret
```

Luego desplegar:

```bash
npx supabase functions deploy mercadopago-create-preference
npx supabase functions deploy billing-create-checkout
npx supabase functions deploy alegra-save-config
npx supabase functions deploy alegra-test-connection
npx supabase functions deploy alegra-crear-factura
npx supabase functions deploy alegra-zapier-notify
npx supabase functions deploy send-cash-close-report
npx supabase functions deploy send-discount-email
npx supabase functions deploy calendar-get-auth-url
npx supabase functions deploy calendar-get-status
npx supabase functions deploy calendar-create-event
npx supabase functions deploy calendar-list-events
npx supabase functions deploy calendar-delete-event
npx supabase functions deploy calendar-disconnect
npx supabase functions deploy outlook-calendar-events
npx supabase functions deploy calendar-sync-events
npx supabase functions deploy calendar-oauth-callback
npx supabase functions deploy calendar-webhook
npx supabase functions deploy calendar-register-watch
npx supabase functions deploy mercadopagoWebhook
npx supabase functions deploy wompi-webhook
npx supabase functions deploy update-overdue-rooms
npx supabase functions deploy actualizar_permisos_usuario
npx supabase functions deploy delete-user
npx supabase functions deploy chatkit-session
```

## Variables para `scripts/watch.js`

Este script ahora usa variables de entorno:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_ACCESS_TOKEN`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_CALENDAR_WEBHOOK_URL`

Ejemplo en PowerShell:

```powershell
$env:GOOGLE_CLIENT_ID="tu_client_id"
$env:GOOGLE_CLIENT_SECRET="tu_client_secret"
$env:GOOGLE_REDIRECT_URI="https://tu-proyecto.supabase.co/functions/v1/calendar-oauth-callback"
$env:GOOGLE_ACCESS_TOKEN="tu_access_token"
$env:GOOGLE_REFRESH_TOKEN="tu_refresh_token"
$env:GOOGLE_CALENDAR_WEBHOOK_URL="https://tu-proyecto.supabase.co/functions/v1/calendar-webhook"
node .\scripts\watch.js
```

## Credenciales que recomiendo rotar

Como estuvieron expuestas en el codigo o en el historial de trabajo, recomiendo rotar cuanto antes:

- token privado de Mercado Pago
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_ACCESS_TOKEN`
- `GOOGLE_REFRESH_TOKEN`

Tambien deberias rotar credenciales que se hayan compartido fuera del repo, aunque no esten ya en archivos versionados:

- `OPENAI_API_KEY`
- `Supabase Personal Access Token`

Si estos valores llegaron a subirse a un repositorio remoto o a compartirse fuera del equipo, la rotacion no es opcional. Quitar el valor del archivo actual no invalida una credencial ya expuesta.

## Notas importantes

- La `anon key` de Supabase no se trata igual que un secreto privado; puede vivir en frontend si las politicas de seguridad estan bien hechas.
- Claves publicas como `WOMPI_PUBLIC_KEY` no son equivalentes a tokens privados.
- Ningun token privado de pasarela de pago debe volver a vivir en `js/modules/...` del frontend.
