# Auditoría — Pagos bancarios (conciliación vía Gmail)

Fecha de auditoría: 2026-09-07. Alcance: piloto exclusivo de Hotel Marena San Isidro. Metodología: lectura directa de Edge Functions (`supabase/functions/bank-email-api`, `gmail-webhook`, `gmail-watch-renew`, `gmail-oauth-callback`, `bank-payment-relation-api`, `_shared/bank-email/*`) y de las 18 migraciones SQL relacionadas con `bank_email_*` / `bank_payment_*` (agosto–septiembre 2026). No hay acceso MCP en vivo a Supabase ni a Gmail/Pub/Sub: todo lo referido a estado de watch/pubsub en producción es inferencia desde el código, no observación directa.

Este documento no repite la arquitectura ya descrita en `docs/conciliacion-bancaria-v2/` (00 a 25) ni en `docs/gmail-bank-payments-pilot.md`. Se enfoca en: (a) si el código actual coincide con lo documentado, (b) huecos/riesgos nuevos, (c) documentación desactualizada.

> **Estado posterior al corte (2026-09-12):** H3/A8 está corregido y probado. La migración `20260912120000_a8_bank_reservation_allocation_capacity.sql` serializa por reserva, recalcula el saldo en base de datos y conserva la ruta que relaciona un movimiento de Caja ya existente. Se aplicó y verificó exclusivamente en Supabase staging; producción sigue pendiente de aprobación.

## 1. Flujo real reconstruido

```
Correo bancario (Bancolombia)
  → Gmail (label PAGOS HOTEL MARENA, watch activo)
  → Pub/Sub push → supabase/functions/gmail-webhook/index.ts
      - Verifica OIDC del push (pubsub-oidc.ts)
      - upsert en bank_email_pubsub_inbox (onConflict pubsub_message_id, ignoreDuplicates) → deduplica el push
      - dispara processPendingPubSubInbox en background (EdgeRuntime.waitUntil) o inline si no hay waitUntil
  → queue.ts: claim_bank_email_pubsub_inbox (RPC, FOR UPDATE SKIP LOCKED) reclama filas pendientes/retry/failed
      - por cada mensaje nuevo (Gmail History API desde gmail_history_id): parseGmailMessage → isConfiguredBankSender
      - analyzeBankEmail (_shared/bank-email/payment-service.ts)
  → parseBankEmail (bankParsers/bancolombia.ts + generic.ts): valida SPF/DKIM/DMARC, idioma de la transacción,
    extrae monto, referencia (vacía para Bancolombia a propósito), remitente, fecha de la transacción
  → idempotencia: findExistingDuplicate por (hotel_id, gmail_message_id); respaldo real: UNIQUE (hotel_id, gmail_message_id)
    en bank_payment_events + captura de 23505
  → INSERT bank_payment_events (trigger AFTER INSERT audita y notifica)
  → match_bank_payment_event (RPC, pg_advisory_xact_lock + FOR UPDATE) intenta enlazar con expected_payments
      (creado antes por create_expected_bank_payment cuando recepción marca "pago por llave/transferencia")
  → estado: detected | matched | manual_review | rejected | duplicated
  → bank-email-api (action: list/detail/candidates/manual-action) — solo admin del piloto — o
    bank-payment-relation-api (action: relate) — recepción/admin — permiten:
      - relacionar contra reserva/venta (replace_bank_payment_allocations)
      - o vincular al movimiento exacto de Caja ya registrado (replace_bank_payment_allocations_from_caja,
        con bank_payment_allocations.caja_id UNIQUE) — mecanismo introducido el 2026-09-01 y documentado en M4
  → Caja: la conciliación nunca inserta ni modifica montos; solo enlaza. Estado bancario se muestra vía
    'cash-movement-statuses' (admin) y 'movement-statuses' (recepción)
  → Auditoría: bank_payment_audit_log registra cada transición (payment_detected, duplicate_detected,
    multiple_allocation_changed, relation_changed, cash_movement_linked, etc.)
```

Puntos de entrada externos sin JWT de Supabase (autenticación propia en código): `gmail-webhook` (OIDC de Pub/Sub), `gmail-oauth-callback` (state hash de un solo uso), `gmail-watch-renew` (cron interno, no revisado en detalle en esta pasada).

## 2. Estado real del código vs. lo documentado

| Documentado (docs/conciliacion-bancaria-v2) | Estado en código actual |
|---|---|
| 00-estado-actual: "Fase 2 aplicada... constraints incompatibles, orden de validación, suma exacta e índices corregidos" | **Confirmado.** `replace_bank_payment_allocations` (definición vigente en `20260826183106_fase6_...sql`) valida todos los destinos, incluida la capacidad de venta con `pg_advisory_xact_lock` por venta, ANTES del `DELETE`+`INSERT`, y usa un patrón de concurrencia optimista (compara `updated_at` tras un `FOR UPDATE`) para abortar si el evento cambió durante la validación. |
| 04-permisos-y-seguridad: "`bank_email_sale_is_reconcilable`... ejecución exclusiva de `service_role`" | **Confirmado** en `bank_email_sale_available_amount_cop` y en el uso dentro de `replace_bank_payment_allocations`. |
| 07-integracion-caja (Fase 9): el estado bancario de Caja se relacionaba mediante claves de la entidad operativa | **CORREGIDO EN M4 (2026-09-21).** El documento vigente describe `bank_payment_allocations.caja_id`, su unicidad, `replace_bank_payment_allocations_from_caja`, `bank_payment_has_valid_caja_link`, la API limitada de recepción y el respaldo legacy que falla de forma cerrada. |
| 11-checklist-produccion y plan por fases | **CORREGIDO EN M4 (2026-09-21).** El checklist refleja las Fases 1–25, las cinco Edge Functions, los prechecks de `caja_id`, la prueba operativa A–K y la separación entre validación técnica, aceptación del hotel de prueba y autorización de producción. |
| 00-estado-actual, hallazgo #5: "El saldo comprometido de reserva usa el monto completo del evento en una ruta; una transferencia dividida sobreacreditaría la reserva" | **Sigue sin resolver** en la ruta de asignación manual del administrador (ver hallazgo H3 abajo). Fase 6 sí cerró el equivalente para ventas (`bank_email_sale_available_amount_cop` + lock por venta), pero no se replicó para reservas en `replace_bank_payment_allocations`. |
| 25-recepcion-relacion-transferencias | **REVISADO Y ACTUALIZADO EN M4.** Coincide con `bank-payment-relation-api`: sesión y hotel piloto, estados relacionables, acciones reducidas, ventana de ±48 horas, selección de 1–20 movimientos, suma exacta, motivo obligatorio, datos sanitizados y persistencia del `caja_id` mediante RPC. |

## 3. Hallazgos

### H1 — MEDIUM: sin protección contra que el banco envíe dos correos reales para la misma transferencia
**Estado posterior al corte (2026-09-21): corregido por M3.** La migración `20260921120000_m3_bank_email_possible_duplicate_review.sql` conserva la identidad Gmail como idempotencia exacta y agrega una segunda señal conservadora para mensajes distintos. Un trigger serializa por hotel/banco/monto y solo marca el nuevo evento como `manual_review` cuando no existe referencia transaccional, está dentro de una ventana de 120 segundos y además coincide el remitente normalizado o el hash del contenido. Ambos eventos se conservan; el sistema nunca asigna `duplicated` ni elimina un pago por esta heurística. La Edge Function usa el estado devuelto por PostgreSQL y omite el auto-match, mientras la UI explica la alerta al administrador. Las pruebas cubren concurrencia por contrato, aislamiento por hotel, ventana, remitente, contenido, referencias reales, eventos de prueba y falsos positivos por monto/hora solamente.

La idempotencia real (constraint `bank_payment_events_message_key UNIQUE (hotel_id, gmail_message_id)` + `findExistingDuplicate`) protege bien contra **reprocesamiento del mismo mensaje de Gmail** (reintentos de Pub/Sub, reprocesos del backfill por History API, colisiones de inserción concurrente vía captura de `23505`). Pero para Bancolombia, `referenceExpressions: []` es deliberado (comentario en `payment-service.ts`: "los 4 dígitos después de 'cuenta' identifican la cuenta receptora, no la operación... Gmail message id es la clave idempotente mientras el banco no entregue una referencia única"). Esto implica que `transaction_reference` y por tanto `transaction_fingerprint` son `null` para Bancolombia, y los dos índices únicos secundarios (`bank_payment_events_fingerprint_uidx`, `bank_payment_events_bank_reference_uidx`) nunca aplican para este banco. Si Bancolombia emite dos correos distintos (mismo giro, dos `Message-Id` de Gmail) — escenario real y documentado en el sector bancario colombiano para notificaciones duplicadas — el sistema creará dos `bank_payment_events` separados, ambos "detected", sin ninguna señal automática de duplicado. El único control pasa a ser el ojo del administrador en la lista de eventos. Impacto acotado porque nada se acredita automáticamente sin acción humana (confirm/link), pero es un hueco real frente a "correos repetidos no detectados".
- Evidencia: `supabase/functions/_shared/bank-email/payment-service.ts:36-46` (comentario + `referenceExpressions: []`), `supabase/migrations/20260803120000_bank_email_payments_pilot.sql:304-317` (índices únicos condicionados a `transaction_reference IS NOT NULL`).
- Sugerencia: si Bancolombia no expone referencia, considerar fingerprint adicional por (monto, remitente, minuto exacto) con ventana muy angosta, o al menos superficie visual en la UI que agrupe eventos "sospechosamente similares" (mismo monto ± mismo remitente en una ventana corta) para revisión manual explícita.

### H2 — LOW/MEDIUM: documentación de Caja desactualizada — CORREGIDO EN M4

**Estado posterior al corte (2026-09-21): corregido.** Se actualizaron el estado histórico, modelo de datos, permisos, flujo de recepción, plan por fases, integración con Caja, pruebas, despliegue, checklist de producción, trazabilidad y documento de Fase 25. La documentación vigente incluye `caja_id`, `replace_bank_payment_allocations_from_caja`, `bank_payment_has_valid_caja_link`, la preservación durante checkout, el tratamiento fail-closed de relaciones legacy y la API de recepción con privilegios reducidos.

- Evidencia: `docs/conciliacion-bancaria-v2/00-estado-actual.md`, `02-plan-implementacion.md`, `03-modelo-datos.md`, `04-permisos-y-seguridad.md`, `05-flujo-recepcionista.md`, `07-integracion-caja.md`, `09-pruebas-y-validacion.md`, `10-plan-despliegue-piloto.md`, `11-checklist-produccion.md`, `13-trazabilidad-financiera.md` y `25-recepcion-relacion-transferencias.md`.

### H3 — HIGH: la asignación manual de un pago a una reserva no valida saldo disponible ni serializa reservas concurrentes (asimetría con el lado de ventas)
**Estado posterior al corte:** corregido por A8. Un trigger `BEFORE INSERT/UPDATE` adquiere `pg_advisory_xact_lock` con una clave estable hotel/reserva y comprueba el saldo con `bank_email_reservation_available_amount_cop`. El cálculo descuenta pagos reales, pagos esperados vigentes y allocations activas de otros eventos; excluye el evento que se está reintentando. Las allocations con `caja_id` no se descuentan dos veces porque su cobro ya vive en `pagos_reserva`, y solo omiten esta comprobación durante el RPC de Caja previamente validado. Las pruebas PostgreSQL demuestran que una reserva de 100 acepta 70 y rechaza un segundo evento de 40 sin alterar sus datos.

En `replace_bank_payment_allocations` (vigente, `20260826183106_fase6_prevenir_doble_conciliacion.sql:74-352`), la rama `v_type = 'sale'` sí ejecuta `pg_advisory_xact_lock` por venta y valida `bank_email_sale_available_amount_cop` (saldo real descontando otras allocations activas) antes de aceptar el destino. La rama `v_type = 'reservation'` (líneas 171-199) **solo** verifica que la reserva exista en el hotel y que no esté repetida *dentro de la misma distribución que se está guardando*; no hay lock por reserva, ni cálculo de saldo disponible (monto_total - pagado - otras allocations "matched/confirmed" de otros eventos), a diferencia de lo que sí hace `create_expected_bank_payment` (línea 1006-1039 del mismo archivo base) para el flujo de "pago esperado". Consecuencia: un administrador puede, por error o mala fe, confirmar dos transferencias bancarias distintas contra la misma reserva por montos que en conjunto excedan `monto_total`, sin que la base de datos lo impida — solo la validación de "suma exacta == amount_cop del evento" por evento individual, que no mira across-events. Esto es exactamente el hallazgo #5 que `docs/00-estado-actual.md` marcó como "bloqueante para Fase 2" el 2026-08-25; las migraciones posteriores (fase5, fase6, premerge, fase14, fase15, caja_link) cerraron el equivalente para ventas pero no para reservas.
- Evidencia: `supabase/migrations/20260826183106_fase6_prevenir_doble_conciliacion.sql:171-199` (sin validación de saldo) vs. `:200-224` (con `bank_email_sale_available_amount_cop` + lock).
- Mitigación existente pero no suficiente: la UI de candidatos (`getCandidates` en `bank-email-api/index.ts`) sí calcula y muestra `outstanding_amount_cop` por reserva, así que un admin atento vería el saldo — pero es una señal informativa, no una barrera del servidor.
- Recomendación: replicar en la rama `reservation` el mismo patrón que en `sale`: `pg_advisory_xact_lock(hotel:bank-reservation:<id>)` + una función `bank_reservation_available_amount_cop` análoga a la de ventas, antes de aceptar el monto.

### H4 — Ya corregido, documentar como referencia histórica: checkout podía revertir silenciosamente una conciliación bancaria ya vinculada a Caja
`bank_email_handle_reservation_update()` (definición original en `20260803120000_bank_email_payments_pilot.sql`) degradaba a `manual_review` **cualquier** `bank_payment_event` en estado `matched` cuya reserva pasara a un estado inactivo (`reservation_inactive`, p. ej. al hacer checkout), sin importar si ya existía un movimiento de Caja real y válido detrás de esa conciliación. Las migraciones `20260901190101_bank_reconciliation_preserve_caja_on_checkout.sql` y `20260901203000_bank_reconciliation_caja_integrity_repair.sql` corrigen esto: ahora un evento con un vínculo de Caja válido (`bank_payment_has_valid_caja_link`: allocations existen, suman exactamente el monto del evento, cada una apunta a un movimiento `ingreso` real, no reversión, cuenta bancaria activa, y coincide con la reserva/venta correspondiente) **no** se revierte solo porque la reserva terminó. La migración de reparación (`20260901203000...`) además re-promovió a `matched` los eventos que habían sido degradados indebidamente por este bug antes del fix, y marcó como `manual_review` (`legacy_caja_link_ambiguous`) los casos legacy ambiguos en vez de adivinar, lo cual es la postura correcta. Esto fue, en su momento, un bug real con impacto financiero (perder el estado "verificado" de un pago bancario legítimo al hacer checkout), ya remediado con datos reales reparados de forma conservadora.
- Evidencia: `supabase/migrations/20260901190101_bank_reconciliation_preserve_caja_on_checkout.sql`, `supabase/migrations/20260901203000_bank_reconciliation_caja_integrity_repair.sql:334-431` (backfill).
- Estado documental: reflejado en `docs/conciliacion-bancaria-v2/07-integracion-caja.md`, `13-trazabilidad-financiera.md` y `25-recepcion-relacion-transferencias.md` como parte de M4.

### H5 — LOW: código muerto que puede confundir sobre dónde vive la idempotencia real
**Corregido y probado en B11.** Se retiraron `gmailMessageDeduplicationKey` e
`isDuplicateGmailMessage`, cuyos únicos consumidores eran pruebas. `idempotency.ts` conserva
`transferFingerprint`, que sí importa `payment-service.ts` como huella secundaria. La idempotencia
principal continúa en almacenamiento persistente: búsqueda por `hotel_id + gmail_message_id`,
constraint `bank_payment_events_message_key` y unicidad de `pubsub_message_id`.

### H6 — Verificado como correcto (no es hallazgo, se registra por ser área de riesgo típica): timezone
`bogotaCalendarBucket` y `bogotaDateTimeToIso` asumen consistentemente que Colombia está en UTC-5 todo el año (correcto: Colombia no observa horario de verano) y convierten explícitamente sumando 5 horas al interpretar fechas del cuerpo del correo como hora local de Bogotá. El `transaction_date` (bucket calendario) y el fingerprint usan esta misma función, así que no hay una ruta que mezcle UTC crudo con hora Bogotá de forma inconsistente. `plausibleTransactionTime` además descarta candidatos de fecha fuera de una ventana razonable (14 días atrás / 1 día adelante respecto de `receivedAt`), evitando que un parseo erróneo de fecha en el cuerpo del correo dispare falsos matches contra `expected_payments`.

## 4. Lo que está bien diseñado (para no repetir trabajo ni erosionarlo sin querer)

1. **Concurrencia real, no solo declarada.** `claim_bank_email_pubsub_inbox` usa `FOR UPDATE SKIP LOCKED` (permite múltiples invocaciones simultáneas del webhook sin pisarse) y recupera automáticamente filas atascadas en `processing` tras 10 minutos (crash recovery). `match_bank_payment_event` y `replace_bank_payment_allocations` usan `pg_advisory_xact_lock` por hotel/venta más `FOR UPDATE` y una comprobación de concurrencia optimista contra `updated_at`. Esto es un diseño correcto de baja probabilidad de doble-crédito para el camino de ventas y de pagos esperados.
2. **Determinación de `hotel_id` que falla cerrado.** `getPilotHotel` en Edge Functions siempre exige `BANK_EMAIL_PILOT_HOTEL_ID` (UUID fijo en variable de entorno), lo valida contra el nombre configurado, y lanza si no hay coincidencia exacta. `resolve_bank_email_pilot_hotel` (lado SQL) exige exactamente un hotel con ese nombre exacto. No hay ninguna ruta donde el hotel se infiera de datos editables por el cliente (`user_metadata`, nombre mostrado en el navegador, etc.). Esto cierra bien el riesgo de "asignación al hotel equivocado".
3. **Anti-spoofing de remitente correcto y no ingenuo.** `parseAuthenticationResults` solo confía en el header `Authentication-Results` **más externo** y únicamente si su `authserv-id` es literalmente `mx.google.com` — es decir, ignora cualquier header de autenticación que el propio remitente del correo pudiera haber inyectado para simular un SPF/DKIM/DMARC "pass". Combinado con el allowlist de remitente/dominio/return-path de `validateBankSender`, esto es una defensa razonable contra correos bancarios falsificados.
4. **Reparación de datos hecha con criterio conservador.** La migración de reparación de integridad Caja↔conciliación (`20260901203000...`) solo repromueve automáticamente los casos inequívocos (backed 1:1 por un movimiento de Caja válido) y deja explícitamente en `manual_review` los casos ambiguos en vez de adivinar una relación. Es el patrón correcto para reparar datos financieros históricos.
5. **Vínculo de Caja con unicidad real.** `bank_payment_allocations.caja_id` con índice único parcial (`WHERE caja_id IS NOT NULL`) impide que dos transferencias distintas reclamen el mismo movimiento de Caja, tanto en el flujo de recepción (`bank-payment-relation-api`, con pre-chequeo + captura de `23505`) como en el de administración.
6. **Superficie de datos mínima hacia el cliente.** `clientSafeEvent` en `bank-email-api/index.ts` elimina explícitamente `transaction_reference`, `transaction_fingerprint`, `gmail_message_id`, `gmail_thread_id`, `raw_content_hash`, `email_subject` y `integration_id` de la respuesta, y solo expone una referencia enmascarada. La ruta de recepción (`operational-summary`) entrega solo conteos agregados de 7 días, sin montos ni referencias.

## 5. Limitaciones de esta auditoría

- No hay acceso en vivo a Supabase/Gmail: no se pudo confirmar el estado real de `watch_status`, `gmail_history_id` ni el volumen actual de la cola `bank_email_pubsub_inbox` en producción; todo lo dicho sobre esos mecanismos es análisis estático del código y las migraciones versionadas.
- No se revisó en profundidad `gmail-watch-renew/index.ts`, `gmail-oauth-callback/index.ts`, `token-crypto.ts`, `bankPaymentService.js` ni la UI completa de `js/modules/pagos-bancarios/pagos-bancarios.js` línea por línea; el foco se puso en el camino de datos crítico (idempotencia, concurrencia, asignación de hotel/cuenta, timezone) según lo solicitado.
- No se ejecutaron pruebas ni se corrieron migraciones; todos los hallazgos son de lectura de código/SQL.
