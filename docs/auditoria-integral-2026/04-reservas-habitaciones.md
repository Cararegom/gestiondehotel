# Auditoría integral — Dominio: Reservas / Hospedaje / Habitaciones

Fecha: 2026-09-07
Alcance: flujo completo crear reserva → asignar habitación → check-in → cronómetro → consumos → pagos/abonos → deuda → cambio de habitación → finalizar estadía → caja → limpieza → control de energía → habitación libre de nuevo.

## Método y limitaciones

- Se usó `graphify query/explain` para orientarse, pero el subgrafo de este dominio es disperso (muchos nodos de documentación mezclados con código) y se truncó varias veces; la mayor parte de la verificación se hizo leyendo directamente el código fuente y las migraciones SQL versionadas, que son la fuente de verdad indicada.
- **No hay acceso vivo a Supabase.** Todo lo que sigue sobre esquema/RLS/RPC está confirmado contra `supabase/migrations/*.sql`. Cualquier afirmación sobre si una función Edge está realmente **programada** (cron) en producción está marcada explícitamente como no verificable desde el repo.
- Se distingue en cada hallazgo si la evidencia es una migración SQL, un archivo JS concreto (con ruta y línea), o una inferencia razonable a partir de ambos.

---

## 1. Flujo real reconstruido

### 1.1 Crear reserva + asignar habitación (check-in inmediato, flujo "mapa de habitaciones")

Archivo: `js/modules/mapa-habitaciones/modales-alquiler.js`, función `registrarReservaYMovimientosCaja()` (línea ~307), invocada desde `showAlquilarModal()`.

Secuencia real de escritura (NO es una transacción; son 4 llamadas Supabase independientes, secuenciales):

1. `INSERT clientes` (si no hay `cliente_id`).
2. `INSERT reservas` con `estado: 'ocupada'`, `monto_pagado: 0` (línea 368-401).
3. `UPDATE habitaciones SET estado = 'ocupada'` (línea 409-414). Si falla, se lanza `Error` — **pero la reserva del paso 2 ya quedó insertada** y no se revierte.
4. `INSERT cronometros` (línea 416-427). Si falla, se lanza `Error` — la reserva y la habitación ya quedaron actualizadas.
5. Si hay pagos, `procesarPagosReservaAtomicos()` → RPC `procesar_pago_reserva_atomico` (atómico, ver 1.4).

No hay ningún re-chequeo de que la habitación siga `libre` justo antes del `INSERT reservas` (no hay `SELECT ... FOR UPDATE` ni condición `WHERE estado='libre'` en el `UPDATE habitaciones`), y no existe ningún `UNIQUE`/`EXCLUDE` en BD que impida dos reservas activas simultáneas sobre la misma `habitacion_id` (confirmado por grep sobre las 27 migraciones: solo hay `UNIQUE(hotel_id, nombre)` en `habitaciones`, nada sobre solapamiento de reservas).

### 1.2 Check-in de una reserva futura (`reservada` → `activa`)

Archivo: `js/modules/mapa-habitaciones/modales-gestion.js`, botón `btn-checkin-reserva` (línea 771-807).

Secuencia: `UPDATE reservas` (estado `activa`) → `UPDATE habitaciones` (estado `ocupada`) → `INSERT cronometros`. **Ninguna de las tres llamadas comprueba el campo `error` de la respuesta de Supabase** (no hay `if (error) throw` en ninguna). Si la primera falla por RLS/red, el código sigue y de todas formas ocupa la habitación y muestra "Check-in realizado con éxito".

Ruta alternativa de formulario clásico: `js/modules/reservas/reservas-estado.js` → `handleReservaEstadoUpdate()` sí revisa errores del `UPDATE reservas`, pero el `UPDATE habitaciones` posterior solo se ejecuta "si me pasaron los parámetros" y si falla, el mensaje de éxito se muestra igual con un texto anexado ("...pero hubo un error actualizando la habitación"), sin revertir el cambio de estado de la reserva.

### 1.3 Cronómetro de estadía

Archivo: `js/modules/mapa-habitaciones/cronometro-habitacion.js`. El propio comentario del archivo dice **"100% CLIENT-SIDE"**: es solo un `setInterval` visual que calcula `fecha_fin - now()` en el navegador. No escribe nada a la base de datos, nunca. El paso de habitación a `tiempo agotado` en BD lo hace exclusivamente la Edge Function `supabase/functions/update-overdue-rooms/index.ts`, que:

- Busca `reservas` con `estado IN ('activa','ocupada')` y `fecha_fin <= now()`.
- Actualiza **solo `habitaciones.estado = 'tiempo agotado'`**. Nunca toca `reservas.estado`.

No se encontró en el repo ningún `pg_cron`, entrada en `supabase/config.toml`, GitHub Action, ni configuración que dispare esta función periódicamente — **no se puede verificar desde el repositorio si esta función corre en producción con algún cron externo**; si no corre, ninguna habitación pasa a `tiempo agotado` salvo que alguien la abra manualmente.

### 1.4 Pagos y abonos (bien diseñado)

RPC `procesar_pago_reserva_atomico` (`supabase/migrations/20260809102000_fase1_pago_reserva_atomico.sql`), invocada desde `reservas-pagos.js::mostrarModalAbonoReserva()` y desde `modales-alquiler.js`/`modales-gestion.js`. En una sola transacción de BD: bloquea la fila de la reserva (`FOR UPDATE`), valida turno abierto propio del actor, valida método de pago del hotel, inserta `pagos_reserva` + `caja`, recalcula `monto_pagado` desde la suma real de `pagos_reserva`, y escribe auditoría — todo con idempotencia por `client_operation_id` (índice único parcial). Correcto y sólido.

No valida, eso sí, que `p_monto` no exceda el saldo pendiente de la reserva (el control de "no pagar de más" es solo client-side en el modal de abono) — de bajo impacto porque solo generaría sobrepago, no pérdida de dinero.

### 1.5 Deuda pendiente / liquidación de consumos al cerrar cuenta

Dos mecanismos independientes conviven:

**(a) "Entregar/Liberar habitación"** (`modales-gestion.js`, botón `btn-entregar`, línea 989+): antes de liberar, calcula `saldoPendiente` con `calcularSaldoReserva()` y **bloquea** la liberación si `saldoPendiente > 50` (margen de redondeo). Solo si el saldo es ~0 permite continuar. Esto es una salvaguarda correcta contra "reserva finalizada con deuda perdida".

**(b) RPC `liquidar_consumos_reserva_atomico`** (`supabase/migrations/20260825173000_liquidar_consumos_reserva_atomico.sql`), invocada por `marcarPendientesComoPagados()` en el modal "Consumos" tras pulsar "Pagar todo". Esta función marca **todos** los `servicios_x_reserva`, `ventas_tienda` y `ventas_restaurante` de la reserva como `estado_pago = 'pagado'`, apuntándolos a un `pago_reserva_id` dado — **sin comprobar en ningún momento que el monto de ese pago cubra la suma real de los consumos pendientes**. La UI solo la llama tras el flujo "Pagar TODO el saldo" (con `cuentaActual.saldo` exacto), pero la función en sí, al ser un RPC `SECURITY DEFINER` otorgado a `authenticated`, es invocable directamente (consola del navegador / cliente Supabase) con cualquier `pago_reserva_id` propio y cualquier consumo pendiente, marcando deuda como pagada sin que el monto la cubra. Ver hallazgo CRÍTICO más abajo.

### 1.6 Cambio de habitación (bien diseñado)

RPC `cambiar_habitacion_transaccion` (versión endurecida en `supabase/migrations/20260827174036_pre_fase14_function_acl_and_cross_tenant_hardening.sql`, líneas 141-271), invocada desde `modales-gestion.js` (botón `btn-cambiar-habitacion`, línea 810+). Verifica identidad del actor, tenant, bloquea (`FOR UPDATE`) origen/destino/reserva, **exige que la habitación destino esté `libre`** y, si todo procede, en una sola transacción: mueve la reserva y el cronómetro a la nueva habitación, pone el origen en `limpieza`, pone el destino en el estado pedido, y registra auditoría + bitácora. Existía un overload anterior sin el chequeo de "destino libre" y sin aislamiento por tenant; fue **eliminado explícitamente** en la migración de endurecimiento (comentario: "El navegador ya no tiene consumidor para este overload inseguro").

### 1.7 Finalizar estadía / checkout → caja → limpieza

Mismo botón `btn-entregar` de 1.5(a), continuación desde línea 1149: si el saldo está en 0 y no hay artículos prestados pendientes, ejecuta en secuencia (**sin transacción, sin comprobar `error` en ninguna de las tres llamadas**):

1. `UPDATE reservas SET estado='finalizada', fecha_fin=now(), monto_pagado=totalDeTodosLosCargos`.
2. `UPDATE cronometros SET activo=false, fecha_fin=now()`.
3. `UPDATE habitaciones SET estado='limpieza'`.

Si el paso 1 falla (red, RLS, lo que sea), el código igual detiene el cronómetro y pone la habitación en `limpieza`, dejando la reserva en su estado anterior (`activa`/`ocupada`) — es decir, **habitación en ciclo de limpieza con una reserva que la BD todavía considera activa**.

El propio código documenta que esta inconsistencia ya ocurre en producción: en el mismo archivo, líneas 1009-1057, hay una rama completa titulada `CORRECCIÓN: MANEJO DE "ERROR DE DATOS" (Habitación ocupada sin reserva)` que ofrece al staff un botón para "forzar" el paso a limpieza cuando la habitación figura `ocupada` pero no se encuentra ninguna reserva activa asociada — es un parche manual para un estado que los propios desarrolladores saben que puede darse.

### 1.8 Limpieza → Control de energía → habitación libre (muy bien diseñado)

`supabase/migrations/20260824120000_energy_control_pilot.sql`: trigger `habitaciones_energy_check_trigger` (`BEFORE UPDATE OF estado`) que:
- Al entrar a `limpieza`, crea automáticamente un `room_energy_checks` pendiente (si el hotel tiene `energy_control_enabled`), con índice único parcial que impide dos checks abiertos por habitación.
- **Al intentar pasar de `limpieza` a `libre` con un check `pending`/`overdue` abierto, lanza `RAISE EXCEPTION ... 'CONTROL_ENERGIA_PENDIENTE'`** — a nivel de base de datos, no solo de UI, por lo que ningún camino de código (actual o futuro) puede saltárselo.
- `js/modules/limpieza/limpieza.js::confirmCleaningById()` (línea 145-171) captura ese mensaje específico y lo traduce a un texto amigable para el usuario.

Esto resuelve exactamente el caso "habitación limpia con control de energía pendiente" que pedía la tarea: **no puede ocurrir**, está bloqueado por trigger de BD.

### 1.9 Mantenimiento bloqueante (muy bien diseñado)

`supabase/migrations/20260902032500_mantenimiento_fase1_hardening.sql`: no permite crear una tarea de mantenimiento `bloqueante` sobre una habitación `ocupada`/`tiempo agotado` o con estancia activa; mantiene sincronizado `habitaciones.estado='mantenimiento'` mientras exista un bloqueo abierto (trigger `trg_sincronizar_tarea_mantenimiento_habitacion`); y dos triggers adicionales (`impedir_ocupar_habitacion_en_mantenimiento` sobre `habitaciones`, `impedir_activar_reserva_en_mantenimiento` sobre `reservas`) impiden, a nivel de BD, ocupar una habitación o activar una reserva mientras exista un mantenimiento bloqueante abierto — cualquiera sea el camino de código que lo intente.

---

## 2. Estados imposibles — hallazgos verificados

### HALLAZGO 1 (CRITICAL) — Deuda de consumos puede "desaparecer" sin verificación de monto

> **Estado posterior al corte (2026-09-09):** corregido, probado y aplicado en Supabase staging mediante `20260910033500_c4_liquidar_consumos_monto_seguro.sql`. La RPC ahora recalcula la deuda real en servidor, bloquea y actualiza únicamente las filas validadas, rechaza pagos acumulados insuficientes, conserva aislamiento por hotel y registra la liquidación. Producción y la aceptación funcional con el hotel de prueba siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`supabase/migrations/20260825173000_liquidar_consumos_reserva_atomico.sql`, función `liquidar_consumos_reserva_atomico(p_reserva_id, p_pago_reserva_id)`, otorgada a `authenticated`. Marca todos los consumos pendientes de la reserva como `pagado` sin comprobar `sum(consumos pendientes) <= v_pago.monto`. Solo exige que el pago exista, pertenezca a esa reserva y al `usuario_id = auth.uid()` que lo invoca. Un usuario autenticado (p. ej. un recepcionista) puede registrar un abono mínimo por `procesar_pago_reserva_atomico` y luego llamar directamente a este RPC (sin pasar por la UI de "Pagar todo") para marcar consumos de cualquier monto como pagados. Es exactamente el escenario "reserva finalizada con deuda perdida" que pedía la tarea, y es explotable en el trust boundary del backend, no solo un bug de UI.
Impacto: pérdida de ingresos por consumos (tienda, restaurante, servicios) sin registro de la deuda real.

### HALLAZGO 2 (HIGH) — Creación de reserva + ocupación de habitación no es atómica

> **Estado posterior al corte (2026-09-16):** corregido, probado y aplicado en Supabase staging mediante `20260915120000_a13_a14_reservation_lifecycle_atomic.sql`. El alquiler directo crea cliente, reserva, ocupación, cronómetro y pagos iniciales dentro de una sola transacción idempotente; bloquea la habitación con `FOR UPDATE` y dos índices únicos impiden cronómetros activos duplicados. Las pruebas cubren rollback e intentos concurrentes. Producción y la aceptación funcional con el hotel de prueba siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/mapa-habitaciones/modales-alquiler.js:397-427`. `INSERT reservas` (estado `ocupada`), `UPDATE habitaciones`, `INSERT cronometros` son 3 llamadas Supabase separadas. Si la 2ª o 3ª falla, queda una `reserva` con `estado='ocupada'` sin que la habitación reflejone ese estado (o sin cronómetro), y no hay rollback del `INSERT` anterior. Es el estado "reserva activa pero habitación disponible" pedido explícitamente en la tarea, confirmado por lectura directa del código (no es solo teórico: el `throw` posterior a la reserva ya insertada lo deja así).
Se agrava porque no hay `SELECT...FOR UPDATE` ni verificación de `estado='libre'` inmediatamente antes de insertar, ni constraint en BD que impida doble ocupación concurrente de la misma habitación — dos alquileres simultáneos del mismo cuarto (dos recepcionistas, doble clic) no están impedidos por ningún candado, solo por la suerte de que la UI normalmente filtra habitaciones libres.

### HALLAZGO 3 (HIGH) — Checkout/"Entregar habitación" y check-in de reserva futura no comprueban errores

> **Estado posterior al corte (2026-09-16):** corregido, probado y aplicado en Supabase staging con la misma migración. Check-in, checkout y la reparación de una habitación huérfana usan RPC transaccionales, tenant-safe e idempotentes; cada ruta confirma reserva, habitación y cronómetro juntas y la interfaz solo muestra éxito después del commit. Los avisos posteriores al commit se tratan por separado. Producción y la aceptación funcional con el hotel de prueba siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/mapa-habitaciones/modales-gestion.js:771-807` (check-in) y `:1149-1170` (checkout/"Entregar"). Ninguna de las llamadas `UPDATE reservas` / `UPDATE cronometros` / `UPDATE habitaciones` de estas dos rutas revisa el campo `error` de la respuesta de Supabase. Un fallo parcial deja exactamente los estados imposibles que pedía la tarea: "habitación finalizada [en limpieza] pero aún con reserva activa" o "habitación ocupada pero reserva no actualizada". El propio código (líneas 1009-1057 del mismo archivo) contiene un flujo de "reparación manual" para cuando la habitación queda `ocupada` sin ninguna reserva activa asociada — evidencia de que el equipo ya conoce y parchea este problema en producción en vez de resolverlo en origen.

### HALLAZGO 4 (MEDIUM) — El listado de "Reservas" no muestra reservas con estado `ocupada` / `tiempo agotado`

> **Estado posterior al corte (2026-09-30):** corregido, probado y aplicado en Supabase staging mediante `20260929120000_m7_reservas_estados_operativos.sql`. El listado, los filtros, los indicadores, las acciones de cobro/checkout, la lista de espera y los chequeos locales comparten el mismo conjunto de estados operativos. `validar_cruce_reserva` incluye `ocupada` y `tiempo agotado`, usa rangos `[)`, rechaza intervalos inválidos y conserva ejecución solo para `authenticated`/`service_role`. El preview quedó `READY`; producción y la aceptación funcional con el hotel de prueba siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

`js/modules/reservas/reservas.js:2286`, `renderReservas()`: `estadosVisibles = ['reservada','confirmada','activa','cancelada','completada','no_show','cancelada_mantenimiento','finalizada_auto']` — **no incluye `ocupada` ni `tiempo agotado`**, que sí son los estados con los que el mapa de habitaciones crea y deja las reservas (Hallazgo/flujo 1.1 y 1.3). Resultado: una reserva creada desde el mapa de habitaciones y actualmente ocupando un cuarto es invisible en el módulo "Reservas" (buscar cliente, editar datos, ver historial) hasta que cambie de estado. Mismo patrón en `reservas-calculos.js:244`, donde el chequeo anti-solape para bloquear una nueva reserva sobre la misma habitación solo mira `['reservada','confirmada','activa']`, **sin `ocupada` ni `tiempo agotado`** — o sea, el propio guardia de solapamiento del formulario de reservas puede no detectar que la habitación ya está físicamente ocupada por otra reserva creada desde el mapa.

### HALLAZGO 5 (LOW) — Enum `estado_reserva_enum` con valores muertos / nunca asignados por la aplicación

> **Estado posterior al corte (B4, 2026-10-01): corregido, probado y aplicado en Supabase staging.** La aplicación declara por separado los estados canónicos escribibles y los cuatro valores heredados. `check_in`, `check_out`, `facturada_pagada` y `tiempo agotado` permanecen visibles para interpretar filas históricas; `check_in` y `tiempo agotado` conservan el bloqueo de disponibilidad por representar una estancia abierta antigua. La migración `20261001120000_b4_reserva_estados_legacy_guard.sql` impide nuevas inserciones o transiciones hacia esos valores sin borrar ni inmovilizar registros existentes. Staging no contenía reservas y el trigger quedó activo; producción y la aceptación funcional siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

Confirmado por grep exhaustivo: `reservas.estado` **nunca** se asigna a `'tiempo agotado'`, `'check_in'`, `'check_out'`, ni `'facturada_pagada'` en ningún punto de la aplicación (JS ni RPC). Solo `habitaciones.estado` llega a `'tiempo agotado'` (vía la Edge Function de 1.3). Sin embargo, decenas de consultas (`.in('estado', [...])`) y algunos triggers de mantenimiento siguen filtrando/comprobando por esos valores en `reservas`, como si pudieran ocurrir. No genera corrupción de datos, pero es ruido/código muerto que dificulta razonar sobre la máquina de estados real y sugiere que distintas partes del código fueron escritas asumiendo una máquina de estados que no coincide con la implementada.

### Estados imposibles buscados y DESCARTADOS con evidencia

- **"Habitación limpia con control de energía pendiente"** → Descartado. Bloqueado por trigger de BD `habitaciones_energy_check_trigger` (ver 1.8), que impide `UPDATE` a `libre` mientras exista un `room_energy_checks` en `pending`/`overdue`. Nivel de base de datos, no bypasseable desde la app.
- **"Habitación bloqueada sin motivo"** → Descartado por inexistencia del camino, no por estar bien resuelto: el valor de enum `habitaciones.estado = 'bloqueada'` **nunca se asigna en ningún archivo del repositorio** (JS ni SQL). Es un valor de enum declarado pero muerto en la práctica actual; el "bloqueo" real de habitaciones por mantenimiento se implementa con `estado='mantenimiento'` + tabla `tareas_mantenimiento` (con motivo obligatorio, ver `mantenimiento_tarea_habitacion_unica` y validaciones en `20260902032500_mantenimiento_fase1_hardening.sql`), que sí siempre lleva descripción/motivo.
- **"Precio actual usado incorrectamente para una estadía histórica"** → Descartado. `reservas` persiste su propio snapshot de montos en el momento de creación (`monto_total`, `monto_estancia_base`, `monto_estancia_base_sin_impuestos`, `monto_impuestos_estancia`, etc., ver columnas en `20260326191500_baseline_public_schema.sql:217-261`). El checkout y la factura (`cargarCuentaDetallada()` en `modales-gestion.js`) leen `reserva.monto_total`, no `habitaciones.precio` vigente. El precio de la habitación (`room.precio_1_persona`/`precio_2_personas`/`precio_base_hora`) solo se lee al **crear** la reserva o al recalcular una estadía `tipo_duracion='abierta'` todavía en curso — comportamiento correcto, no afecta estadías ya cerradas.

---

## 3. Qué está bien resuelto en este dominio

1. **Separación clara entre "dinero" (siempre RPC atómico) y "estado operativo" (updates sueltos desde el cliente).** Todas las operaciones que mueven caja/pagos (`procesar_pago_reserva_atomico`, `cancelar_reserva_con_reversion`, `liquidar_consumos_reserva_atomico`) están en funciones `SECURITY DEFINER` con `FOR UPDATE`, idempotencia por `client_operation_id` y auditoría en `auditoria_operaciones`. El patrón es sólido; el problema del dominio no es la falta de RPCs sino que **no se extendió el mismo patrón a las transiciones de habitación/reserva/cronómetro** (Hallazgos 2 y 3), que quedaron como el "hermano pobre" no transaccional del mismo módulo.
2. **Control de energía y bloqueo por mantenimiento implementados con triggers de base de datos**, no solo validación en JS — por diseño no son bypasseables por un camino de código nuevo o con errores, incluso si la UI cambia. Es el nivel correcto para invariantes de negocio críticas.
3. **`cambiar_habitacion_transaccion` fue endurecida explícitamente**: el equipo detectó que un overload anterior no verificaba tenant ni que el destino estuviera libre, y lo eliminó (`DROP FUNCTION ... -- El navegador ya no tiene consumidor para este overload inseguro`), dejando solo la versión segura. Es exactamente el tipo de remediación proactiva que se espera.
4. **Guardia de saldo antes de liberar habitación** (`btn-entregar`, `saldoPendiente > 50` bloquea el checkout) y bloqueo por artículos prestados sin devolver — ambos previenen activamente que se "pierda" el rastro de una deuda o de inventario prestado en el camino normal de la UI.
5. **Snapshot de precios en la reserva** en vez de recalcular contra el precio vigente de la habitación — decisión de modelado correcta que evita que un cambio de tarifa reescriba retroactivamente el valor de estadías ya cobradas.

---

## 4. Resumen de severidad

| # | Hallazgo | Severidad |
|---|----------|-----------|
| 1 | `liquidar_consumos_reserva_atomico` no valida monto vs. deuda real | CRITICAL |
| 2 | Alta de reserva + ocupar habitación no atómico (reserva huérfana posible) | HIGH |
| 3 | Check-in y checkout no comprueban errores de Supabase (3 updates sueltos) | HIGH |
| 4 | `renderReservas()` y guardia anti-solape ignoran estados `ocupada`/`tiempo agotado` | MEDIUM |
| 5 | Valores de `estado_reserva_enum` nunca asignados por la app (código muerto) | LOW |
