# Capa de pagos SaaS

Estado actual del flujo de checkout SaaS en `Gestion de Hotel`.

## Objetivo

- que el monto final no dependa del navegador
- dejar referencias internas claras para soporte y auditoria
- unificar checkout de COP y USD bajo una misma logica autoritativa

## Backend autoritativo

La funcion `supabase/functions/billing-create-checkout/index.ts` calcula:

- plan seleccionado
- plan actual
- tipo de pago (`renew`, `upgrade`, `renew-downgrade`)
- periodo (`mensual` o `anual`)
- moneda (`COP` o `USD`)
- promo de bienvenida
- ahorro aplicado

## Salida del backend

La funcion devuelve:

- `provider`
- `provider_display_name`
- `checkout_url`
- `external_reference`
- `checkout_reference`
- `issued_at`
- `customer_email`
- `quote`

## Frontend

`js/modules/micuenta/checkoutSuscripcionService.js`:

- muestra el resumen de pago antes de redirigir
- envia analitica comercial
- registra trazabilidad sensible en `bitacora`
- deja la referencia de checkout visible para soporte
