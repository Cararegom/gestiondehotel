# Plan de despliegue del piloto

## Preparación

1. Confirmar `main`, backup y ventana de bajo tráfico.
2. Resolver UUID del Hotel Marena en servidor y ejecutar prechecks tenant/integridad.
3. Confirmar que la comparación Git/Supabase no tenga migraciones productivas ausentes localmente.
4. Crear migraciones con CLI y revisar diff; nunca editar historia.
5. Ejecutar tests y advisors antes de aplicar.

## Despliegue incremental

Aplicar migración → verificar constraints/funciones/grants → desplegar Edge Function solo si cambió → smoke test admin Marena → recepción Marena → usuario de otro hotel → caso controlado `is_test` → revisar auditoría y logs. Cada fase tiene un checkpoint independiente.

## Kill switch y rollback

El gate por UUID desactiva menú, ingesta/acciones y estados. El rollback restaura la versión anterior del RPC/Edge Function mediante una migración compensatoria; no elimina eventos, allocations ni auditoría. Caja, reservas y ventas permanecen utilizables incluso con conciliación apagada.

## Observabilidad

Registrar códigos estables para correo recibido, duplicado, candidato, relación, confirmación, rechazo y error. No registrar tokens, correo completo ni cuentas sin máscara.

## Despliegues realizados

- Fase 2: `fase2_endurecer_bank_payment_allocations`, aplicada en Supabase como versión `20260826013742`.
- Índices de Fase 2: `fase2_indices_bank_payment_allocations`, aplicada como versión `20260826014049`.
- Edge Functions: sin cambios ni despliegues en Fase 2.
- Fase 3: `bank-email-api` v17 desplegada activa con `verify_jwt=true`; no requirió migraciones ni cambios en Caja/ledger.
- Fase 4: `bank-email-api` v18 desplegada activa con `verify_jwt=true`; cálculo de saldo de reserva basado en allocations, sin migración ni escrituras de datos.
- Fase 5: migración `20260826181130_fase5_ventas_bancarias_conciliables` aplicada y `bank-email-api` v19 activa con `verify_jwt=true`.
- Fase 6: migración `20260826183106_fase6_prevenir_doble_conciliacion` aplicada y `bank-email-api` v20 activa con `verify_jwt=true`.
- Fase 7: sin migración; `bank-email-api` v21 activa con `verify_jwt=true` y presentación administrativa actualizada.
- Fase 8: sin migración; `bank-email-api` v22 activa con `verify_jwt=true`, permisos administrativos endurecidos y resumen operativo sanitario.
- Fase 9: sin migración; `bank-email-api` v23 activa con `verify_jwt=true`, estados read-only en Caja y columna frontend exclusiva del piloto.
- Fase 10: migración `20260827015126_fase10_sincronizar_metodo_pago_caja_ledger` aplicada; RPC y frontend atómicos, UPDATE directo revocado y divergencias reparadas.
- Fase 14: migraciones `20260828023412_fase14_auditoria_acciones_conciliacion` y `20260828025943_fase14_fix_manual_audit_context` para actor, motivo y contexto de auditoría.
- Fase 15: migraciones `20260828024228_fase15_minimos_privilegios_conciliacion` y `20260828030602_fase15_fix_assigned_admin_allocations` para permisos mínimos y roles asignados.
- Fases 16–24: pruebas de comportamiento, aislamiento, observabilidad y checklist de release incorporados al repositorio y CI.
- Fase 25: migración `20260828063000_recepcion_relacion_pagos_bancarios` y Edge Function `bank-payment-relation-api` para el flujo limitado de recepción.
- Vínculo exacto con Caja: migraciones `20260901184238_bank_payment_allocation_caja_link`, `20260901185128_bank_payment_allocation_caja_legacy_backfill`, `20260901190101_bank_reconciliation_preserve_caja_on_checkout` y `20260901203000_bank_reconciliation_caja_integrity_repair`.
- Sincronización histórica adicional sin reejecución: `20260826171602_grant_authenticated_insert_movimientos_inventario.sql`.
- Sincronización histórica sin reejecución: `20260622090000_terraza_transferencias_sin_duplicados.sql`, `20260826000109_permitir_cambio_metodo_pago_caja.sql` y `20260826000318_grant_update_metodo_pago_caja.sql`.

## Staging posterior a la auditoría integral — 2026-09-21

La migración `20260921120000_m3_bank_email_possible_duplicate_review` se aplicó únicamente en Supabase staging. `bank-email-api`, `gmail-webhook` y `gmail-watch-renew` se desplegaron allí con sus opciones de autenticación esperadas. El entorno no tenía hotel piloto ni eventos bancarios, por lo que la prueba funcional con correos reales quedó aplazada.

Este registro de staging no autoriza ni implica un despliegue a producción. Producción requiere prechecks actuales, aceptación funcional y aprobación explícita.
