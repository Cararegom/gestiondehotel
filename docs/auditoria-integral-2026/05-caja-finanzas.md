# Auditoría integral 2026 — Caja y Finanzas

Fecha de corte: 2026-09-07.
Alcance: flujo completo de caja (apertura → movimiento → ingreso → egreso → pago por transferencia →
reversión → anulación → cierre → conciliación → reportes → correo de cierre).

Metodología: lectura de código real (`js/modules/caja/*`, módulos que escriben en `caja` desde otros
dominios, Edge Function `send-cash-close-report`) y de las migraciones SQL versionadas en
`supabase/migrations/`, orientada primero con `graphify query`. No hay acceso en vivo a Supabase: todo
lo dicho sobre RPC/grants/RLS se basa en migraciones versionadas; si `supabase db push`/`migration up`
no se ejecutó en producción tal como está en el repo, el estado real puede diferir del aquí descrito.
Se partió de la auditoría previa en `docs/auditoria-financiera/` (01, 04, 12, 20-24) y
`docs/conciliacion-bancaria-v2/` (07) para no repetir trabajo, verificando qué sigue vigente en el
código actual.

## 1. Flujo real reconstruido

### 1.1 Apertura de turno
- UI: `js/modules/caja/caja-turnos.js` (`abrirTurnoFlow`) pide el monto inicial y llama al RPC
  `abrir_turno_con_apertura(p_hotel_id, p_usuario_id, p_monto_inicial, p_fecha_movimiento)`
  (`supabase/migrations/20260809105000_fase1_rpc_caja_inventario_seguras.sql:7-17`).
- El RPC es `SECURITY DEFINER`, valida `auth.uid()=p_usuario_id`, membresía activa del hotel, monto
  ≥ 0, y bloquea abrir un segundo turno si ya existe uno `abierto` para ese usuario/hotel. Crea el
  turno y el movimiento `apertura` en la misma transacción.

### 1.2 Movimiento manual (ingreso/egreso)
- UI: formulario "Registrar nuevo movimiento" en `caja.js` → RPC
  `registrar_movimiento_caja_atomico(p_hotel_id, p_usuario_id, p_turno_id, p_tipo, p_monto, p_concepto,
  p_metodo_pago_id, p_fecha_movimiento)`.
- El RPC exige turno abierto y propio cuando recibe `p_turno_id`; si el checkbox "fuera del turno"
  envía `turno_id=null`, la migración posterior `20260825150000_fix_caja_movimiento_fuera_turno.sql`
  omite esa validación y registra el movimiento sin asociarlo al arqueo actual. Conserva autenticación,
  membresía activa, identidad del actor, validación de método y trazabilidad `manual_cash`. Ver H-04.
- Valida método de pago activo y pertenece al hotel; inserta con `source='manual_cash'` y
  `business_date` calculado con la zona horaria (ver §3).

### 1.3 Ingreso por venta (tienda/restaurante/reserva)
- Reservas: `reservas-pagos.js` y la creación de reserva en `reservas.js` llaman al RPC
  `procesar_pago_reserva_atomico` (vía `js/services/fase1OperationService.js`). El RPC inserta
  `pagos_reserva` + `caja` (`tipo='ingreso'`, `pago_reserva_id` enlazado) + recalcula
  `reservas.monto_pagado = SUM(pagos_reserva.monto)` en una sola transacción, con `client_operation_id`
  idempotente y turno abierto propio obligatorio (`supabase/migrations/20260809102000_fase1_pago_reserva_atomico.sql`).
- Tienda: `pos.js:768` llama `procesar_venta_tienda_atomica`.
- Restaurante: `restaurante.js` llama `procesar_venta_restaurante_atomica` en los tres flujos activos
  (líneas 545, 1323, 1402).
- Terraza: RPC transaccional propio (ya documentado como fortaleza en la auditoría previa, no se
  reexploró a fondo por estar fuera del set de archivos indicados, pero su patrón es consistente con
  el resto de Fase 1).

### 1.4 Pago por transferencia / cambio de método
- El método de pago se define en el momento del RPC de venta/pago (`p_metodo_pago_id`), no hay un paso
  aparte de "marcar como transferencia" en el flujo normal.
- Corrección posterior de método: botón "Editar" en la tabla de movimientos → RPC
  `actualizar_metodo_pago_caja(p_movimiento_id, p_metodo_pago_id, p_motivo)`
  (`supabase/migrations/20260827052742_premerge_bank_feature_hardening.sql:31-157`, superponiéndose a
  versiones previas de 2 argumentos). Verifica rol (recepcionista/administrador/admin/superadmin/
  gerente), tenant, bloquea el cambio si el turno del movimiento ya está cerrado y el hotel tiene
  activo el feature `bank_reconciliation_v2`, exige motivo obligatorio si el cambio es de efectivo a
  banco, y sincroniza `account_movements` (ledger Fase 2) en la misma transacción, fallando si no logra
  sincronizarlo (`ledger_sincronizado` en la respuesta). El frontend revisa ese campo y muestra error si
  no es `true`.

### 1.5 Reversión (no hay DELETE)
- Botón "Revertir" (solo admin) → RPC `revertir_movimiento_caja(p_original_movement_id, p_reason,
  p_client_operation_id, p_approved_by)` (definición vigente en
  `supabase/migrations/20260825174000_hacer_reversion_caja_idempotente.sql`, reemplaza la versión de
  `20260809101000`). Inserta un movimiento contrario (`ingreso`↔`egreso`) con
  `original_movement_id`, registra la relación en `caja_reversiones` (UNIQUE por
  `original_movement_id` y por `client_operation_id`) y en `auditoria_operaciones`. Devuelve
  `{idempotent, already_reverted}` para que el frontend distinga "ya estaba revertido" de "se acaba de
  revertir", y el frontend efectivamente lee `reversalResult.already_reverted`.
- El movimiento original **nunca se borra ni se edita**; el saldo del turno se recalcula sumando todos
  los movimientos (original + reversión), que es matemáticamente equivalente a anularlo.

### 1.6 Anulación de reserva
- `cancelar_reserva_con_reversion(p_reserva_id, p_reason, p_client_operation_id)` revierte todos los
  movimientos de caja ligados a los pagos de esa reserva (mismo patrón de reversión, no DELETE) y marca
  la reserva `cancelada`, todo en una transacción con idempotencia por `client_operation_id`.

### 1.7 Cierre de turno
- `cerrarTurnoFlow` (`caja-turnos.js`) arma `metodosDePago` activos, movimientos del turno, y muestra el
  modal de arqueo ciego (`renderizarModalArqueo` en `caja-cierre.js`) donde el cajero declara el monto
  real por cada método. Con los valores declarados llama a
  `cerrar_turno_con_arqueo(p_turno_id, p_arqueos, p_client_operation_id, p_fecha_cierre, p_approved_by)`
  (`supabase/migrations/20260809106000_fase1_arqueo_turno_business_date.sql`).
- El RPC **recalcula el "esperado" por método desde `caja` en servidor** (no confía en un total enviado
  por el cliente), inserta una fila en `turno_arqueos` por método (`expected_amount`, `counted_amount`,
  `difference` generada, `note`, `counted_by`, `approved_by`), y solo entonces marca `turnos.estado =
  'cerrado'` con `balance_final = SUM(counted_amount)`. Es idempotente por `client_operation_id`.
- Tras el cierre exitoso se genera y envía por correo el reporte HTML (`generarHTMLReporteCierre`) vía
  Edge Function `send-cash-close-report`.

### 1.8 Correo de cierre
- `enviarReporteCierreCaja` invoca `supabase.functions.invoke('send-cash-close-report', {hotelId,
  subject, html, fallbackEmail})` con el cliente Supabase autenticado del navegador.
- La función (Deno) resuelve el correo destino desde `configuracion_hotel.correo_reportes` (o
  `fallbackEmail`) usando `service_role`, y reenvía `{to, from, subject, html}` a un webhook externo
  (`MAKE_CASH_CLOSE_WEBHOOK_URL`). Ver H-01: no valida que el llamante pertenezca al `hotelId` recibido.

### 1.9 Conciliación bancaria (piloto)
- Documentada en `docs/conciliacion-bancaria-v2/07-integracion-caja.md`: solo lectura sobre `caja`,
  vía triggers `fase2_project_caja_to_account_trg` (proyección a ledger) y `fase1_guard_caja_hotel_trg`
  (guarda de tenant). No se reprocesó a fondo por no ser el foco de esta pasada (dominio caja/finanzas,
  no el piloto bancario en sí), pero el diseño descrito (no escribe en `caja`, resuelve por claves
  persistidas y no por fecha/monto/concepto) es coherente con el resto del sistema.

## 2. Estado real de las correcciones de la auditoría financiera previa

| Hallazgo previo | Estado verificado en código actual | Evidencia |
| --- | --- | --- |
| C-03 Cobros/ventas no atómicos | **Corregido** en los 4 flujos principales (reserva, tienda, restaurante manual/turno) | RPCs `procesar_pago_reserva_atomico`, `procesar_venta_tienda_atomica`, `procesar_venta_restaurante_atomica` llamados desde el frontend; ver §1.3 |
| C-04 Borrado físico de movimientos de caja | **Corregido** para el flujo nuevo | `registrar_y_eliminar_mov_caja` fue `DROP FUNCTION` en `20260809109000_fase1_revocacion_legacy.sql:10-11`; `DELETE` sobre `caja` revocado a `anon,authenticated`; reversión reemplaza a borrado (§1.5) |
| C-05 RPC de borrado sin autorización | **Corregido por eliminación** | La función fue dropeada, no reescrita; ya no existe superficie que explotar |
| A-04 Arqueo no persistido | **Corregido** | Tabla `turno_arqueos` con `expected_amount/counted_amount/difference/note/counted_by/approved_by`, poblada por `cerrar_turno_con_arqueo` (§1.7) |
| A-03 RLS `FOR ALL` en `caja`/`pagos_reserva` que permite CRUD directo | **Corregido en el sentido de escritura**: `INSERT/UPDATE/DELETE` revocados a `authenticated` sobre `caja`, `pagos_reserva`, `detalle_ventas_tienda`, `ventas_restaurante_items`, etc. Solo `SELECT` queda otorgado; todas las escrituras pasan por RPC `SECURITY DEFINER` | `20260809109000_fase1_revocacion_legacy.sql:15-21` |
| A-09 Sin idempotencia en ventas/cobros | **Corregido** | Todas las RPC nuevas exigen `p_client_operation_id` y tienen índices/constraints únicos por `(hotel_id, source, client_operation_id)` o equivalentes |
| A-06 Fechas UTC / zona horaria | **Corregido después del corte mediante A6 + A12** | `reportes.js` usa rangos UTC semiabiertos calculados desde la zona IANA activa del hotel en todas las rutas auditadas; las agrupaciones diarias y períodos comparativos también siguen el calendario del hotel. Ver [16-estado-implementacion.md](16-estado-implementacion.md) |
| C-01/C-02 RLS permisiva / tablas sin RLS | **Corregido para las tablas relevantes a caja**: `log_caja_eliminados`, `bitacora`, `ventas_restaurante(_items)`, `platos`, `ingredientes`, `platos_recetas` tienen RLS habilitada con políticas por `hotel_id`/permiso desde `20260809100000_fase1_authz_rls_base.sql` | Confirmado en migración; no se revisó el resto de las 37 tablas fuera del dominio caja |
| M-02 Edición de método sin historial | **Corregido** | `actualizar_metodo_pago_caja` es RPC auditada (`auditoria_operaciones`, before/after, motivo obligatorio para efectivo→banco) reemplazando el `UPDATE` directo; el `GRANT UPDATE(metodo_pago_id)` que existió brevemente (`20260826000318`) fue revocado de nuevo en `20260827052742:141` |
| A-01 `caja` mezcla flujo de caja y resultado | **Sigue abierto, mitigado en paralelo**: Fase 2 (`financial_accounts`/`account_movements`) da un ledger shadow, pero `caja` sigue siendo la fuente operativa única para turnos/cierre | Diseño intencional documentado en `21-fase2-cuentas-ledger-shadow.md`: "no reemplaza caja" |
| A-05 Clasificación financiera por texto libre | **Corregido por M6** | `getMovementOriginKey` clasifica por referencias normalizadas (`reserva_id`, `pago_reserva_id`, `venta_*_id`) y códigos internos `source`; los movimientos sin vínculo quedan visibles en “Otros ingresos” sin alterar el total ni inflar Habitaciones |
| B-01 Dos tablas de log de caja (`log_caja_eliminados` / `caja_movimientos_eliminados`) | **Corregido en la UI por B3.** Ver H-06 | Caja retiró el panel basado en `log_caja_eliminados` y ahora consulta `caja_reversiones`, la fuente activa de anulaciones auditables |

## 3. Hallazgos nuevos (no cubiertos por la auditoría previa)

### H-01 — CRITICAL: `send-cash-close-report` no valida que el llamante pertenezca al hotel del reporte

> **Estado posterior al corte (2026-09-09):** corregido, probado y desplegado en Supabase staging. El handler ahora valida el JWT con Supabase Auth, exige membresía activa en el `hotelId` solicitado antes de crear el cliente `service_role` y ya no confía en `fallbackEmail` enviado por el navegador. La función está `ACTIVE` como versión 1 con `verify_jwt=true`; las solicitudes remotas sin JWT o con un token malformado devuelven HTTP 401. Faltan la aceptación funcional con usuarios reales de staging y la aprobación explícita para producción. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

- **Qué ocurre:** la Edge Function recibe `{hotelId, subject, html, fallbackEmail}` directamente del
  cliente y, usando `service_role`, resuelve `configuracion_hotel.correo_reportes` para ESE `hotelId` y
  reenvía `{to, from, subject, html}` al webhook de envío de correo. En ningún punto llama a
  `admin.auth.getUser(jwt)` ni compara el usuario autenticado contra `usuarios.hotel_id`.
- **Dónde:** `supabase/functions/send-cash-close-report/index.ts` (función completa, sin verificación de
  identidad más allá de `verify_jwt` a nivel de gateway, que solo exige *algún* JWT válido de *algún*
  usuario de la plataforma — no hay entrada `[functions.send-cash-close-report]` en `supabase/config.toml`
  que lo desactive, así que corre con el default `verify_jwt = true`, pero eso no basta).
- **Riesgo:** cualquier usuario autenticado de **cualquier** hotel del SaaS puede invocar esta función
  con el `hotelId` de otro hotel y un `subject`/`html` completamente arbitrarios (hasta 120 KB), logrando
  que el sistema envíe, desde el dominio/remitente legítimo de la plataforma
  (`no-reply@gestiondehotel.com` o el `correo_remitente` configurado de la víctima), un correo con
  apariencia de "Cierre de Caja" hacia el correo de reportes real de otro hotel. Es un vector de
  suplantación de reportes financieros (números de cierre falsos) y de phishing cross-tenant que abusa
  de la reputación del dominio del SaaS. Compárese con `bank-email-api`, cuyo propio comentario en
  `config.toml` dice explícitamente "son autorizados de nuevo contra `public.usuarios` dentro de la
  función" — ese segundo chequeo está ausente aquí.
- **Cómo se explota:** desde la sesión de un usuario legítimo (aunque sea el rol más bajo) de Hotel A,
  llamar `supabase.functions.invoke('send-cash-close-report', {body:{hotelId: '<uuid Hotel B>', subject:
  '...', html: '<contenido arbitrario>'}})`.
- **Corrección sugerida:** dentro de la función, tras crear el cliente admin, extraer el JWT de
  `Authorization`, resolver `auth.getUser()` y el `hotel_id` real del usuario en `public.usuarios`, y
  exigir que coincida con `hotelId` recibido (mismo patrón que ya usa `bank-email-api`).

### H-02 — HIGH: los reportes operativos de caja siguen usando cortes de día en UTC fijo, pese a que el backend ya calcula `business_date` correcto por hotel

> **Estado posterior al corte (2026-09-13): corregido y probado en preview.** Todas las rutas auditadas de `reportes.js` usan límites UTC derivados de la zona IANA activa del hotel y un final exclusivo. Las agrupaciones diarias, la ocupación y el comparativo gerencial siguen fechas de calendario del hotel, incluso en días de 23 o 25 horas por DST. La regresión `tests/a12-reportes-caja-timezone.test.cjs` cubre los límites y la ausencia de cortes UTC fijos. Evidencia completa en [16-estado-implementacion.md](16-estado-implementacion.md).

- **Qué ocurre:** `js/modules/reportes/reportes.js` construye los rangos de fecha para todas las
  consultas de ingresos/egresos con `` `${fechaInicioInput}T00:00:00.000Z` `` /
  `` `${fechaFinInput}T23:59:59.999Z` `` (líneas 297-298, 397-398/403-404, 491-492, 785-786, 952-953,
  1279-1280, 1398-1399, 1659-1660), es decir, corta el día calendario en el huso UTC, no en el huso del
  hotel.
- **Por qué es un hallazgo nuevo y no solo "A-06 repetido":** la auditoría previa señaló A-06 sobre
  este mismo archivo, pero desde entonces el backend agregó infraestructura específica para resolverlo
  bien: la columna `caja.business_date` (poblada por todas las RPC de caja, ver §1) y la función
  `public.hotel_business_date(hotel_id, timestamptz)` que usa `configuracion_hotel.zona_horaria`
  (`20260903050000_hotel_timezone_systemwide.sql`). Esa migración incluso reescribe dinámicamente
  otras funciones (`get_dashboard_metrics`, alertas de mantenimiento, notificaciones bancarias) para
  usar la zona horaria real del hotel — pero **no toca `reportes.js`**, que nunca llegó a usar
  `business_date` ni `hotel_business_date`. El hallazgo previo se consideró parte de un problema general
  de fechas; hoy es más preciso decirlo así: el arreglo de fondo existe en la base de datos pero no se
  propagó a la pantalla de reportes que de hecho es la más usada a diario ("Reportes operativos", pestaña
  por defecto de `#/reportes`).
- **Riesgo concreto:** para un hotel en `America/Bogota` (UTC-5), el rango `[fechaZ 00:00, fechaZ
  23:59]` en UTC corresponde a `[díaAnterior 19:00, día 18:59]` en hora local. Todo movimiento entre las
  19:00 y las 23:59 hora local del hotel se contabiliza en el reporte del **día siguiente**, y las
  primeras horas del día calendario correcto (00:00–05:00 local) en realidad ya se atribuyeron al
  reporte del día anterior. Esto afecta directamente los reportes de ingresos/egresos de caja, el reporte
  de habitaciones/tienda/restaurante por fecha, y cualquier comparación día-contra-día que use este
  módulo — que es distinto del cierre de turno (correcto, porque usa timestamps reales de
  apertura/cierre, no cortes de calendario).
- **Nota:** el módulo nuevo "Estado de resultados" (`finanzas-pnl.js`, Fase 5) sí referencia
  `business_date`, así que el problema es específicamente de `reportes.js`, no de todo el sistema de
  reportes.
- **Corrección sugerida:** hacer que `reportes.js` calcule los límites de fecha con la zona horaria real
  del hotel (o, mejor, que filtre por `caja.business_date` en vez de por rango de timestamp) en todos los
  puntos listados arriba.

### H-03 — MEDIUM: dinero en métodos de pago desactivados puede quedar fuera del arqueo de cierre

**Estado posterior al corte (2026-09-29): corregido por M5.** La migración `20260921130000_m5_cierre_metodos_inactivos.sql` redefine `cerrar_turno_con_arqueo` para derivar el conjunto obligatorio como la unión de métodos activos del hotel y métodos presentes en movimientos financieros del turno. El RPC rechaza arqueos incompletos, duplicados, métodos ajenos, métodos inactivos sin movimientos y movimientos financieros sin método; solo después persiste `turno_arqueos` y calcula `balance_final` desde los conteos completos. El frontend consulta el catálogo del hotel, incorpora únicamente los inactivos usados, los identifica en pantalla y transporta los valores por UUID. También confirma el RPC antes de enviar el reporte de cierre. La migración quedó aplicada y verificada exclusivamente en staging; producción continúa pendiente de aprobación.

- **Qué ocurre:** `mostrarResumenCorteDeCaja` obtiene `metodosDePago` con
  `.eq('activo', true)` y ese es el conjunto que se envía como `p_arqueos` a `cerrar_turno_con_arqueo`.
  El RPC calcula `expected_amount` por método iterando **solo** los métodos que vienen en `p_arqueos`; si
  un movimiento del turno quedó asociado a un `metodo_pago_id` que fue desactivado después de usarse (o
  que se desactivó a mitad de turno), ese dinero no aparece en ningún renglón del arqueo, no se persiste
  en `turno_arqueos`, y **no se suma a `balance_final`** (`v_total := v_total + v_counted`, solo sobre los
  métodos iterados).
- **Dónde:** `caja-cierre.js` (`mostrarResumenCorteDeCaja`, selección de métodos) +
  `cerrar_turno_con_arqueo` (`20260809106000_fase1_arqueo_turno_business_date.sql:40-47`).
- **Riesgo:** el turno se cierra "cuadrado" según el sistema, pero el dinero real de ese método
  desactivado nunca se pide, nunca se concilia y desaparece silenciosamente del balance oficial del
  turno — no es una pérdida de datos (el movimiento sigue en `caja`), pero sí una laguna en el control de
  arqueo/cierre, justo el punto que Fase 1 se propuso blindar.
- **Nota de alcance:** no se pudo confirmar contra datos en vivo si esto ha ocurrido en producción (no
  hay acceso a Supabase); es un hallazgo de diseño verificado en código, condicionado a que en algún
  momento se desactive un método de pago con movimientos históricos.
- **Corrección sugerida:** que el RPC de cierre calcule el conjunto de métodos a partir de los
  `metodo_pago_id` distintos presentes en `caja` para ese turno (unión con los activos), no solo de la
  lista que envía el cliente; o que el frontend incluya explícitamente métodos inactivos con movimientos
  pendientes de arqueo.

### H-04 — LOW/MEDIUM: el checkbox "Registrar fuera del turno/caja" no hace lo que la etiqueta promete

> **Estado posterior al corte (B2, verificado 2026-10-01): corregido antes de esta revisión y revalidado.** La auditoría citó la definición de `20260809105000`, pero la migración posterior `20260825150000_fix_caja_movimiento_fuera_turno.sql` ya condiciona la búsqueda del turno a `p_turno_id IS NOT NULL`. El frontend envía `NULL` únicamente al marcar la opción, la migración figura aplicada en Supabase staging y `tests/caja-fuera-turno.test.cjs` terminó en 2/2. La aceptación funcional en el hotel de prueba y la confirmación/despliegue de producción siguen pendientes.

- **Qué ocurría en la definición citada por el corte:** en `caja.js`, si el usuario marca "Registrar fuera del turno/caja", el frontend pone
  `turnoIdToSave = null` y lo envía como `p_turno_id: null` a `registrar_movimiento_caja_atomico`. El
  RPC hace `SELECT * INTO v_turno FROM public.turnos WHERE id = p_turno_id` y, con `p_turno_id = NULL`,
  la condición `id = NULL` nunca es verdadera (semántica SQL de `NULL`), así que `NOT FOUND` es
  verdadero y el RPC lanza `RAISE EXCEPTION 'Turno activo propio requerido'`. En la práctica, marcar esa
  casilla **rompe el guardado del movimiento** en vez de registrarlo "fuera de turno" como promete el
  texto de ayuda ("Usa esta opción solo cuando el movimiento no debe afectar el arqueo actual").
- **Dónde:** `js/modules/caja/caja.js` líneas 632-650 (armado de `newMovement.turno_id = null`) vs.
  `registrar_movimiento_caja_atomico` en `20260809105000_fase1_rpc_caja_inventario_seguras.sql:19-30`
  (exige turno abierto encontrado y propio, sin rama para `p_turno_id IS NULL`).
- **Riesgo:** funcional, no financiero directo — el usuario recibe un error y no logra registrar el
  movimiento "fuera de turno"; no hay riesgo de dinero fantasma porque el RPC falla limpio (no inserta
  nada), pero es una regresión de UX/funcionalidad de una opción visible en producción. Si en cambio el
  RPC en producción difiere del código local y sí acepta `p_turno_id NULL` (por ejemplo una versión
  anterior no versionada), sería lo opuesto: movimientos sin turno_id que jamás entran en ningún cierre
  ni arqueo — igual de indeseable. En cualquier caso hay una contradicción entre frontend y backend que
  vale la pena confirmar contra el esquema real desplegado.
- **Corrección sugerida:** decidir el comportamiento deseado (permitir explícitamente turno NULL en el
  RPC con una vía de auditoría clara, o quitar la opción del frontend) y alinear ambos lados.

### H-05 — MEDIUM: clasificación de ingresos por texto sigue asignando lo no reconocido a "Habitaciones", ahora también en el nuevo resumen operativo del cierre

> **Estado posterior al corte (M6, 2026-09-29):** corregido y probado. El cierre dejó de leer `caja.concepto` para clasificar ingresos y para contar habitaciones. Los cobros se agrupan por claves foráneas/códigos de origen; los ingresos sin vínculo se muestran como “Otros ingresos” y siguen incluidos en el arqueo. El resumen consulta `reservas` y `habitaciones` a partir de `reserva_id` o del `pago_reserva_id` histórico. La suite completa terminó en 688/688 y el preview de Vercel quedó `READY`. La aceptación funcional y producción siguen pendientes.

- **Qué ocurre:** además de lo ya señalado en A-05 (vigente sin cambios en `procesarMovimientosParaReporte`),
  la función más nueva `construirResumenOperativoCierre` (agregada para el resumen operativo del correo de
  cierre) también depende de coincidencias de texto (`/habitaci|alquiler|reserva|extensi/i`) para
  reconstruir cuántas habitaciones se alquilaron, y cae en 0 sin aviso si el concepto no matchea el
  patrón. Es el mismo patrón de fragilidad textual, ahora replicado en una pieza nueva del sistema en
  lugar de resuelto.
- **Dónde:** `caja-cierre.js` función `construirResumenOperativoCierre` y `extraerHabitacionDesdeConcepto`.
- **Riesgo:** el "resumen operativo del turno" que ahora se envía en el correo de cierre puede subestimar
  habitaciones alquiladas si el concepto del movimiento no sigue el patrón esperado (por ejemplo, un
  concepto que diga solo "Cliente: Juan Pérez" sin la palabra "habitación"/"alquiler"/"reserva"/"extensi").
- **Corrección sugerida:** que el resumen operativo use las tablas normalizadas (`reservas`,
  `servicios_x_reserva`) en vez de heurísticas de texto sobre `caja.concepto`, tal como ya lo hace para
  tienda/restaurante/terraza (`ventasTienda`, `ventasRestaurante`, `ventasTerraza` son arrays de datos
  reales, no texto).

### H-06 — LOW: panel "Ver eliminados" (admin) quedó como código muerto tras la corrección de C-04/C-05

> **Estado posterior al corte (B3, 2026-10-01): corregido y probado.** El botón ahora se llama «Ver reversiones» y consulta `caja_reversiones` con filtro explícito por `hotel_id`. El panel muestra fecha, responsable, aprobador, motivo y los identificadores del movimiento original y su contramovimiento; ya no consulta `log_caja_eliminados`. El bloque de Caja terminó en 12/12, la suite completa en 724/724 y el preview de Vercel quedó `READY`. La aceptación funcional y producción siguen pendientes.

- **Qué ocurría en el corte auditado:** `mostrarLogEliminados` (`caja-paneles.js`) seguía leyendo `log_caja_eliminados` y se
  ofrece como botón visible a los administradores, pero la única función que insertaba ahí
  (`registrar_y_eliminar_mov_caja`) fue eliminada (`DROP FUNCTION`) en Fase 1. Con el flujo nuevo, un
  movimiento anulado aparece como "Revertido" en la tabla de movimientos del turno (correcto), pero
  nunca como una fila nueva en este panel.
- **Riesgo:** bajo, es una cuestión de confianza/UX: un administrador que revisa este panel esperando
  ver el historial de "eliminaciones" verá siempre datos congelados en el pasado (anteriores a Fase 1) y
  podría concluir erróneamente que nadie ha anulado nada recientemente, cuando en realidad las
  reversiones sí ocurren, solo que se registran y muestran en otro lugar (`caja_reversiones` /
  columna "Revertido").
- **Corrección sugerida:** quitar el botón/panel o redirigirlo a listar `caja_reversiones` (que sí tiene
  RLS y sí se sigue llenando), evitando dos fuentes de verdad para "movimientos anulados".

## 4. Qué está bien diseñado (para no perder de vista en refactors futuros)

- **Todas las escrituras financieras nuevas pasan por RPC `SECURITY DEFINER`, con `INSERT/UPDATE/DELETE`
  directos revocados sobre `caja`, `pagos_reserva`, `detalle_ventas_tienda`, `ventas_restaurante_items`,
  etc.** (`20260809109000_fase1_revocacion_legacy.sql`). Esto cierra de raíz la clase de bugs "frontend
  hace 3 escrituras separadas y una falla a medias" que dominaba la auditoría previa.
- **Idempotencia consistente vía `client_operation_id`** en pagos de reserva, ventas, reversiones y
  cierre de turno, con índices únicos `(hotel_id, source, client_operation_id)` o equivalentes — un
  doble clic o un reintento de red no duplica dinero.
- **Reversión en vez de borrado, con anti-doble-reversión real**: `caja_reversiones` tiene
  `UNIQUE(hotel_id, original_movement_id)`, así que ni una condición de carrera ni un reintento con otro
  `client_operation_id` pueden crear dos reversos del mismo movimiento; el `SELECT ... FOR UPDATE` sobre
  el movimiento original cierra la ventana de carrera.
- **Arqueo de cierre calculado en servidor, no confiado al cliente**: `cerrar_turno_con_arqueo` recalcula
  `expected_amount` por método directamente desde `caja`, y el cliente solo aporta lo que el cajero contó
  físicamente (`counted_amount`) — un cliente comprometido no puede alterar el "esperado" para ocultar un
  faltante.
- **Auditoría uniforme** (`auditoria_operaciones`, before/after JSON, `reason`, `client_operation_id`)
  aplicada consistentemente a reversión, cambio de método de pago, ajuste de stock y cancelación de
  reserva.
- **La migración de zona horaria por hotel (`20260903050000`) es notablemente cuidadosa**: en vez de
  solo agregar una columna, reescribe dinámicamente (vía `pg_get_functiondef` + `replace`) cada función
  ya desplegada que dependía de la zona horaria fija, incluyendo las RPC de caja, con chequeos
  defensivos (`IF v_oid IS NOT NULL`) para no romper si alguna función no existe en cierto entorno.

## 5. Limitaciones de esta pasada

- No se auditó a fondo Terraza, gastos/cuentas por pagar (Fase 3), costeo (Fase 4) ni el piloto de
  conciliación bancaria completo: se revisó lo estrictamente necesario para entender su intersección con
  `caja` (deliberadamente fuera del set de archivos indicado para esta pasada).
- Todo lo afirmado sobre comportamiento en producción asume que las migraciones del repo son las
  desplegadas; `docs/auditoria-financiera/20-cierre-fase1.md` y las fases 2-5 afirman que sí, pero esta
  auditoría no tuvo forma de confirmarlo de forma independiente.
