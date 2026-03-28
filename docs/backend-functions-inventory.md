# Inventario de Edge Functions

Este archivo resume la capa backend actualmente versionada en `supabase/functions`.

## Funciones que el frontend invoca

- `actualizar_permisos_usuario`
- `alegra-crear-factura`
- `alegra-save-config`
- `alegra-test-connection`
- `alegra-zapier-notify`
- `billing-create-checkout`
- `calendar-create-event`
- `calendar-delete-event`
- `calendar-disconnect`
- `calendar-get-auth-url`
- `calendar-get-status`
- `calendar-list-events`
- `delete-user`
- `outlook-calendar-events`
- `send-cash-close-report`
- `send-discount-email`
- `landing-save-lead`
- `landing-track-event`

## Otras funciones activas ya versionadas

- `calendar-oauth-callback`
- `calendar-register-watch`
- `calendar-sync-events`
- `calendar-webhook`
- `chatkit-session`
- `crear_colaborador`
- `mercadopago-create-preference`
- `mercadopagoWebhook`
- `registrar-pre-referido`
- `registro-reserva-externa`
- `update-overdue-rooms`
- `wompi-webhook`

## Variables de entorno detectadas

### Supabase

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PROJECT_URL`
- `SERVICE_ROLE_KEY`
- `SERVICE_ROLE`
- `SUPA_URL`
- `SUPABASE_ANON_KEY`

### OpenAI

- `OPENAI_API_KEY`
- `OPENAI_WORKFLOW_ID`
- `OPENAI_SUPPORT_WORKFLOW_ID`

### Pagos

- `MERCADOPAGO_ACCESS_TOKEN`
- `MERCADOPAGO_WEBHOOK_URL`
- `WOMPI_PUBLIC_KEY`
- `WOMPI_EVENT_SECRET_KEY`

### Calendarios e integraciones

- `API_BASE_URL`
- `SITE_URL`
- `MY_ENCRYPTION_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `OUTLOOK_CLIENT_ID`
- `OUTLOOK_CLIENT_SECRET`

### Correo y automatizaciones

- `MAKE_CASH_CLOSE_WEBHOOK_URL`
- `MAKE_DISCOUNT_EMAIL_WEBHOOK_URL`

## Estado

- Todas las funciones activas en Supabase ya tienen carpeta local en el repo.
- Todas las funciones invocadas desde `functions.invoke(...)` ya tienen implementación local versionada.
