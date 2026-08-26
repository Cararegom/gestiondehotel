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
- Sincronización histórica adicional sin reejecución: `20260826171602_grant_authenticated_insert_movimientos_inventario.sql`.
- Sincronización histórica sin reejecución: `20260622090000_terraza_transferencias_sin_duplicados.sql`, `20260826000109_permitir_cambio_metodo_pago_caja.sql` y `20260826000318_grant_update_metodo_pago_caja.sql`.
