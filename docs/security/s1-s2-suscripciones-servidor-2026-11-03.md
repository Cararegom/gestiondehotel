# S1/S2: suscripciones y trial decididos por el servidor (2026-11-03)

Entrega de los hallazgos S1 y S2 de `docs/auditoria-2026-11-03-84efc86/02-matriz-hallazgos.md`
(el informe que se pidió como `docs/auditoria-saas-movil-2026-11-03-84efc86/` está en esa ruta).
Incluye además la parte de D4 que afecta al alta (hotel sin administrador), porque el
registro tiene que quedar consistente.

**Estado: lista para revisión. No está fusionada en `main`, no está desplegada y la
migración no se ha aplicado en producción ni en staging.**

## Base de trabajo

| | |
|---|---|
| Rama | `claude/project-thread-v8s0xt`, creada desde `main` = `origin/main` = `9d2d1ef` |
| Commit auditado | `84efc86` (rama local `integrar-arreglos-20261103`, sin publicar). Solo toca caja, control de energía y tienda; **no** toca `script.js` ni migraciones, así que S1/S2 seguían presentes tal cual en `main`. Esta entrega no incluye ese commit. |
| Cambios pendientes del usuario | `docs/auditoria-2026-11-03-84efc86/` sin seguimiento: intacto y fuera del commit. |

## Problema

1. **S1.** La política `hoteles_admin_update` permite al admin del hotel actualizar la fila
   completa de `hoteles`. Con la *anon key* pública y su sesión podía hacer
   `update hoteles set suscripcion_fin = '2099-12-31', suscripcion_exenta = true` y quedar
   activo y exento para siempre. No había `REVOKE` por columna ni trigger que lo impidiera
   (confirmado en producción, solo lectura: `authenticated` tiene `UPDATE` de tabla, 0 privilegios
   por columna, y los únicos triggers de `hoteles` son timestamp, configuración, conciliación
   bancaria y `trg_proteger_suscripcion_exenta_hotel`).
2. **S2.** `script.js` calculaba `trial_inicio`, `trial_fin`, `suscripcion_fin`, `plan` y `estado_suscripcion`
   en el navegador y los insertaba directamente; la política `hoteles_onboarding_insert` solo
   exigía `creado_por = auth.uid()`. Un registro manipulado podía crear un hotel con vencimiento en 2099.
3. **Hallazgo nuevo: el registro está roto en producción desde el 27-08-2026.** El alta hacía
   `insert(...).select('id')`, es decir `INSERT ... RETURNING`. Desde la migración
   `20260827070843_pre_fase14_tenant_policy_cleanup` la fila devuelta debe pasar
   `hoteles_tenant_select`, y el usuario recién registrado todavía no es miembro del hotel, así que
   PostgreSQL rechaza la inserción ("new row violates row-level security policy"). La prueba lo
   reproduce. En producción (consultas agregadas, sin datos personales): el último hotel creado es del
   **21-08-2026**, y desde agosto hay **5 cuentas de Auth sin perfil** en `usuarios`
   (1 en agosto, 3 en septiembre, 1 en octubre), que son registros que se quedaron a medias.
4. **D4.** Las inserciones de `usuarios` y `usuarios_roles` no comprobaban errores; el registro
   podía mostrarse como exitoso dejando un hotel sin administrador (hay uno así, de junio).

## Comportamiento resultante

- **Un admin de hotel no puede cambiar** ninguna de estas columnas por la API:
  `plan`, `plan_id`, `plan_pendiente`, `plan_pendiente_id`, `plan_pendiente_desde`,
  `estado_suscripcion`, `trial_inicio`, `trial_fin`, `suscripcion_inicio`, `suscripcion_fin`,
  `suscripcion_exenta`, `suscripcion_exenta_motivo`, `gracia_hasta`, `gracia_motivo`,
  `gracia_actualizada_en`, `referido_por`, `fecha_inicio_prueba`, `fecha_vencimiento`, `bloqueado`,
  `activo`, `creado_por`. Recibe el error `42501`.
  Son todas las columnas de `hoteles` en producción que dan o quitan acceso, plan o beneficios
  (lista de columnas consultada el 2026-11-03).
- **Puede seguir editando** nombre, teléfono, dirección, ciudad, país, logo, horas de check-in/out,
  `alegra_webhook_url`, etc. Si el cliente reenvía la suscripción sin cambiarla, no falla.
- **Siguen funcionando:** webhooks de Wompi y Mercado Pago (`service_role`), bono de referido,
  superadmin SaaS (`actor_is_saas_superadmin()`, verificado en servidor contra `auth.users`/`usuarios`),
  `saas_otorgar_dias_gracia` (SECURITY DEFINER) y el cron `sincronizar_estados_suscripcion` (rol propietario).
- **Registro:** `script.js` llama a `signUp` (sin cambios) y después a la RPC
  `registrar_hotel_inicial(p_nombre_hotel, p_nombre_admin, p_referido_por)`. En una sola transacción:
  - exige sesión (`auth.uid()`) y que la cuenta no tenga ya perfil en `usuarios`;
  - toma el correo de `auth.users`, no del formulario;
  - crea el hotel con `plan = 'max'`, `estado_suscripcion = 'trial'`, `trial_inicio = now()`,
    `trial_fin = suscripcion_fin = now() + 30 días` (los mismos valores que antes, ahora con la hora del servidor);
  - guarda el referido solo si es el UUID de un hotel existente (el enlace de Mi cuenta usa `?ref=<hotel_id>`);
  - crea el perfil admin y el rol "Administrador" (buscado por nombre en `roles`, ya no un UUID fijo en el navegador).
  Si algo falla no queda nada creado, y el navegador muestra el error en vez del mensaje de éxito.
- **Inserción directa en `hoteles` desde el navegador:** ya no hay política de INSERT para
  `authenticated`, así que se rechaza. Si en el futuro alguien vuelve a abrirla, el trigger sigue
  sustituyendo plan, fechas y exención por el trial legítimo y anula `referido_por`.
- Los eventos `dataLayer` (`crear_cuenta`) y `trackLandingEvent('account_created_from_landing')` no cambian.
- **No se modifica ninguna fila existente**: suscripciones, pagos y exenciones actuales quedan igual
  (la prueba compara la tabla completa antes y después de la migración).

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20261103160000_blindar_suscripcion_hoteles.sql` | Nuevo. Trigger `trg_blindar_suscripcion_hotel` + función `blindar_suscripcion_hotel()` (SECURITY INVOKER), RPC `registrar_hotel_inicial` (SECURITY DEFINER, `search_path = ''`, solo `authenticated`), retira la política `hoteles_onboarding_insert`. Idempotente. |
| `script.js` | El alta usa la RPC y comprueba sus errores; quita el cálculo del trial y el `ADMIN_ROL_ID` del navegador; dos mensajes nuevos ("cuenta ya pertenece a un hotel" y "cuenta creada sin sesión"). |
| `tests/s1-s2-suscripcion-hoteles-servidor.test.cjs` | Nuevo. 10 pruebas PGlite con roles `authenticated`/`anon`/`service_role`, RLS activa y las políticas y triggers de producción. |

## Decisiones (documentación de Supabase consultada el 2026-11-03)

- **Trigger en lugar de privilegios por columna.** La guía
  [Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)
  desaconseja los privilegios por columna para la mayoría de proyectos: obligan a listar columnas
  (sin `select *`) y conviven con el privilegio de tabla. Un trigger no rompe ninguna consulta
  existente y cubre también las columnas que se agreguen a la lista.
- **El trigger es SECURITY INVOKER** para que `current_user` sea el rol de la petición
  (`authenticated`/`anon` vía PostgREST). Así las funciones SECURITY DEFINER y `service_role`
  quedan fuera sin depender de ningún campo editable por el usuario.
- **La RPC es SECURITY DEFINER en `public`** porque tiene que llamarse desde la Data API, igual que el
  resto de RPC del proyecto. Sigue las recomendaciones de
  [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security):
  `search_path = ''`, nombres calificados, `EXECUTE` revocado a `public`/`anon` y comprobación de identidad dentro.

## Impacto en otros módulos

- Ningún módulo del navegador actualiza `hoteles` directamente (búsqueda en `js/`, `*.html`, `script.js`);
  Mi cuenta y el panel SaaS usan Edge Functions o RPC. Las únicas escrituras sobre columnas protegidas son
  `wompi-webhook` y `mercadopagoWebhook` (`SUPABASE_SERVICE_ROLE_KEY`), `saas_otorgar_dias_gracia` y
  `sincronizar_estados_suscripcion`; las cuatro quedan permitidas y cubiertas por pruebas equivalentes.
- `billing-create-checkout` solo lee `hoteles`.
- Las políticas `usuarios_bootstrap_insert` y `usuarios_roles_admin_insert` se dejan como están; después de
  esta migración no tienen uso porque la RPC hace esas inserciones.
- Graphify: `graphify update .` ejecutado después de los cambios (el grafo está en `.gitignore`).

## Comandos ejecutados y resultados

| Comando | Resultado |
|---|---|
| `node --test tests/s1-s2-suscripcion-hoteles-servidor.test.cjs` | 10/10 pasan |
| `npm test` (suite completa) | 863 pruebas: 862 pasan, 1 falla. La que falla es `tests/rol-aseo.test.cjs` "main.js limita menu y rutas del rol aseo": ya fallaba antes de esta entrega y comprueba `js/main.js`, que esta rama no toca. |
| `npm run check:syntax` | Sintaxis validada en 331 archivos |
| `npm run check:module-budgets` | OK |
| `graphify update .` | Grafo reconstruido (7226 nodos) |
| `npx supabase db query --read-only --linked --project-ref iikpqpdoslyduecibaij ...` | Solo lectura en producción: políticas de `hoteles`/`usuarios`/`usuarios_roles`/`referidos`, triggers, privilegios, columnas, funciones que actualizan `hoteles`, el rol Administrador y conteos agregados de altas. No se mostró ningún dato de huéspedes ni secretos. |

## Pasos de aplicación (cuando se apruebe)

1. Revisar y fusionar la rama.
2. **Aplicar la migración antes de publicar el frontend.** Si `script.js` se publica antes, el registro
   llama a una RPC que no existe; hoy el registro ya falla, así que no empeora, pero conviene respetar el orden.
   Flujo del proyecto: aplicar en staging, probar, y luego en producción con
   `npx supabase db query --linked --project-ref iikpqpdoslyduecibaij -f supabase/migrations/20261103160000_blindar_suscripcion_hoteles.sql`
   y `npx supabase migration repair --status applied 20261103160000 --linked --project-ref iikpqpdoslyduecibaij`.
3. Publicar el frontend (Vercel).

## Recuperación

Para deshacer solo la base de datos (y volver al registro anterior, que en producción ya fallaba):

```sql
drop trigger if exists trg_blindar_suscripcion_hotel on public.hoteles;
drop function if exists public.blindar_suscripcion_hotel();
drop function if exists public.registrar_hotel_inicial(text, text, text);
create policy "hoteles_onboarding_insert" on public.hoteles for insert to authenticated
  with check (creado_por = auth.uid() and not exists (select 1 from public.usuarios u where u.id = auth.uid()));
```

Si se revierte la base de datos, hay que revertir también `script.js`. La migración no cambia datos, así que
no hace falta restaurar filas.

## Qué verificar después de desplegar

1. `select tgname from pg_trigger where tgrelid = 'public.hoteles'::regclass and not tgisinternal;` incluye `trg_blindar_suscripcion_hotel`.
2. `select policyname from pg_policies where tablename = 'hoteles';` ya no incluye `hoteles_onboarding_insert`.
3. Registro completo desde la landing con un correo de prueba: entra al dashboard; el hotel tiene
   `estado_suscripcion = 'trial'`, `plan = 'max'`, `trial_fin - trial_inicio = 30 días`; existe su fila en
   `usuarios` (rol admin) y en `usuarios_roles`. En GTM se ve `crear_cuenta`.
4. Registro con `?ref=<id de un hotel>`: el hotel nuevo guarda ese `referido_por`.
5. Con la sesión de un admin, en la consola:
   `await supabase.from('hoteles').update({ suscripcion_fin: '2099-12-31' }).eq('id', '<hotel>')` devuelve error 42501,
   y `update({ telefono: '...' })` funciona.
6. Un pago de prueba de Wompi o Mercado Pago sigue renovando el plan, y el panel SaaS sigue dando días de gracia.
7. El cron `sincronizar-estados-suscripcion-cada-hora` sigue ejecutándose sin errores.

## Pendiente y fuera de alcance

- **5 cuentas de Auth sin perfil desde agosto** (registros que fallaron por el punto 3). Esas personas no
  pueden reintentar, porque `signUp` responde "ya registrado". Se pueden recuperar contactándolas y llamando
  a la RPC con su sesión, o con un flujo "completar registro" en el login. Queda para decidir.
- `registrar-pre-referido` valida `ref` como id de `usuarios`, pero el enlace de Mi cuenta envía el id del
  **hotel**, así que la tabla `referidos` no registra esos pre-referidos (el bono por pago sí funciona porque usa
  `hoteles.referido_por`). Es un error previo y no se corrigió aquí.
- Siguientes entregas, sin tocar en esta: pagos S3/S4 (firma de integridad, monto y atomicidad del webhook),
  adjuntos D1 (bucket público), aplicación de planes y límites S5, menú por rol y preparación móvil.
