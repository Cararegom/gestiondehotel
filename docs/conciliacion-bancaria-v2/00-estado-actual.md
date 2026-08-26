# Estado actual y auditoría de Fase 1

Fecha de corte: 2026-08-25. Código auditado: `origin/main` en `367549d48b1e9c5a887dbbf79b38a24a35d8063f`. Proyecto Supabase: `iikpqpdoslyduecibaij`. No se modificó esquema ni se desplegaron funciones durante esta fase.

## Alcance real

El piloto está limitado en servidor a Hotel Marena San Isidro. La autorización no debe depender del nombre mostrado por el navegador: `bank_email_user_has_pilot_access`, `bank_email_assert_pilot_row` y las Edge Functions resuelven y validan `hotel_id`. Ningún cambio posterior puede ampliar ese alcance implícitamente.

## Componentes inspeccionados

- Interfaz: `js/modules/pagos-bancarios/pagos-bancarios.js` y `js/services/bankPaymentService.js`.
- Operación: `js/modules/caja/`, `js/modules/reservas/`, `js/modules/tienda/`, `js/modules/restaurante/`, `js/modules/terraza/`, `js/modules/gastos/`, `js/modules/reportes/` y cierre de turno.
- Backend: `supabase/functions/bank-email-api/index.ts`, `supabase/functions/_shared/bank-email/`, `gmail-webhook`, `gmail-watch-renew` y `gmail-oauth-callback`.
- Base: `bank_payment_events`, `bank_payment_allocations`, `bank_payment_audit_log`, `expected_payments`, `caja`, `pagos_reserva`, ventas operativas, `metodos_pago`, `usuarios`, `hoteles`, cuentas/ledger, gastos y turnos.

## Estado desplegado

- Edge Functions: `bank-email-api` v16 (`verify_jwt=true`), `gmail-webhook` v14, `gmail-watch-renew` v9 y `gmail-oauth-callback` v8. Las tres entradas externas sin JWT aplican autenticación específica en código; debe conservarse y probarse.
- Datos al corte: 16 eventos bancarios, 0 allocations, 47 auditorías y 0 pagos esperados. No hay allocations existentes que convertir antes de endurecer el modelo.
- `bank_payment_allocations` tiene RLS habilitado y no concede acceso directo a `anon` ni `authenticated`; `replace_bank_payment_allocations` es invocable solo por `service_role`.

## Hallazgos bloqueantes para Fase 2

1. `bank_payment_events_sale_target_exclusive_check` impide que las columnas legacy contengan reserva y venta a la vez. El RPC actual intenta guardar ambas en una distribución mixta.
2. `bank_payment_audit_log_action_check` no admite `multiple_allocation_changed`, aunque el RPC la escribe. La transacción falla al auditar.
3. `replace_bank_payment_allocations` elimina y vuelve a insertar antes de terminar todas las validaciones. Una excepción revierte la transacción hoy, pero la implementación no cumple el orden explícito de validar todo antes de reemplazar.
4. El detalle de pago no devuelve allocations enriquecidas. Al reabrir, la interfaz restaura solo `matched_sale_id` y las columnas legacy.
5. El saldo comprometido de reserva usa el monto completo del evento en una ruta; una transferencia dividida sobreacreditaría la reserva.
6. Los candidatos excluyen tienda/restaurante pagados y terraza cerrada. Esto confunde “pagable” con “conciliable”.
7. No existe aún prevención financiera completa contra reutilizar una venta ya conciliada.
8. Caja no tiene estados persistidos de verificación bancaria y el cierre pide conciliación manual por método.

## Hallazgos de seguridad y deriva

- `bank_email_sale_is_payable` es `SECURITY DEFINER` y conserva `EXECUTE` para `anon`/`authenticated` por privilegio heredado. Aunque valida hotel, la superficie no es mínima y debe cerrarse en una migración nueva.
- Algunas funciones antiguas conservan `EXECUTE` público pese a validaciones internas de `service_role`. Deben auditarse una por una; no se hará una revocación global que rompa clientes.
- La deriva detectada quedó corregida en Git el 2026-08-25 sin reejecutar producción: se versionaron `terraza_transferencias_sin_duplicados`, `permitir_cambio_metodo_pago_caja` y `grant_update_metodo_pago_caja` a partir de las definiciones productivas. La comparación por nombre ya no muestra migraciones remotas ausentes localmente.
- `caja` proyecta al ledger mediante `fase2_project_caja_to_account_trg` solo `AFTER INSERT`. Un cambio posterior de `metodo_pago_id` necesita sincronización/auditoría explícita para no divergir.
- Los Advisors marcan `bank_payment_allocations` y `bank_payment_audit_log` como “RLS sin policy”. En este caso es deliberado: son tablas internas sin grants de cliente; su escritura es de servidor. También reportan problemas históricos fuera del piloto (por ejemplo RLS deshabilitado en `tiempos_estancia`, `turnos_programados` y `usuarios_roles`). No se corrigieron aquí porque una reparación global sin regresión excedería y pondría en riesgo este piloto.

## Lo que funciona y se conserva

- Ingesta idempotente de correo, enmascarado de referencias, notificación persistente y actualización en vivo.
- Separación inicial entre evento bancario y registro operativo: confirmar no crea otro ingreso en Caja.
- Interfaz de selección múltiple y etiquetas humanas ya existe, aunque no puede reconstruir allocations persistidas.
- Reportes restringe la conciliación completa al administrador del piloto.

## Avance posterior a la auditoría

La Fase 2 fue aplicada el 2026-08-25 mediante `fase2_endurecer_bank_payment_allocations` y `fase2_indices_bank_payment_allocations`. Los dos constraints incompatibles, el orden de validación/reemplazo, la suma exacta y los índices quedaron corregidos. El flujo operativo aún no se considera terminado: las fases 3 en adelante siguen pendientes.
