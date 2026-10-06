const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const mainSource = read('js/main.js');
const mapaSource = read('js/modules/mapa-habitaciones/mapa-habitaciones.js');
const roomCardSource = read('js/modules/mapa-habitaciones/room-card.js');
const saldoSource = read('js/mapa-saldo-enhancer.js');
const migration = read('supabase/migrations/20261006180000_rol_aseo_control_energia.sql');

test('reconoce los nombres de rol de aseo y no otros roles', async () => {
  const service = await import(pathToFileURL(path.join(root, 'js/services/aseoRoleService.js')).href);

  for (const name of ['Aseador', 'aseadora', 'Camarera', 'Camarero', 'Camarera de piso', 'Mucama', 'Limpieza', 'ASEO']) {
    assert.equal(service.isAseoRoleName(name), true, name);
  }
  for (const name of ['Administrador', 'Recepcionista', 'Mesero/a', 'Mantenimiento / Conserje', 'Gerente', '', null]) {
    assert.equal(service.isAseoRoleName(name), false, String(name));
  }

  assert.deepEqual([...service.ASEO_ALLOWED_MODULES].sort(), ['control-energia', 'limpieza', 'mapa-habitaciones']);
  assert.equal(service.isAseoModuleAllowed('caja'), false);
  assert.equal(service.isAseoModuleAllowed('reservas'), false);
  assert.equal(service.isAseoReadOnlyUser({ role: 'aseo' }), true);
  assert.equal(service.isAseoReadOnlyUser({ role: 'recepcionista' }), false);
});

test('main.js limita menu y rutas del rol aseo', () => {
  // El rol se resuelve despues de admin, mesero y recepcionista (el mas permisivo gana).
  const resolver = mainSource.slice(mainSource.indexOf('function resolveOperationalRole'), mainSource.indexOf('function isTerrazaEnabledForHotelId'));
  assert.ok(resolver.indexOf("=== 'recepcionista'") < resolver.indexOf('isAseoRoleName'));
  assert.match(resolver, /isAseoRoleName\(directRole\) \|\| assignedRoleNames\.some\(isAseoRoleName\)\) return ASEO_ROLE_KEY/);

  // Menu: solo modulos permitidos, energia solo si esta activa.
  const nav = mainSource.slice(mainSource.indexOf('if (isAseoRole(currentUserRole)) {\n    if (isSubscriptionFueraDeGracia) return;'));
  assert.match(nav, /if \(!isAseoModuleAllowed\(linkConfig\.moduleKey\)\) return;/);
  assert.match(nav, /if \(linkConfig\.energyOnly && !currentEnergyControlEnabled\) return;/);
  assert.ok(nav.indexOf('return;\n  }') < nav.indexOf('let esAdminNavegacion'), 'el rol aseo no cae en el menu general');

  // Router: cualquier otra ruta redirige a Limpieza.
  assert.match(mainSource, /isAseoRole\(currentUserRole\) && !isAseoModuleAllowed\(moduleKeyFromRoute\)\) \{\s*window\.location\.hash = ASEO_DEFAULT_HASH;/);
  assert.match(mainSource, /if \(isAseoRole\(currentUserRole\)\) return ASEO_DEFAULT_HASH;/);
  // No prepara QR de energia.
  const prepare = mainSource.slice(mainSource.indexOf('function canCurrentUserPrepareEnergy'), mainSource.indexOf('function roleNamesFromPerfil'));
  assert.doesNotMatch(prepare, /aseo/i);
});

test('mapa en modo lectura: sin turno, sin escrituras, sin modal y sin saldos', () => {
  assert.match(mapaSource, /const readOnly = isAseoReadOnlyUser\(currentUser\);\s*\/\/[^\n]*\n\s*if \(!readOnly\) \{\s*const hayTurno = await checkTurnoActivo/);
  assert.match(mapaSource, /if \(!isAseoReadOnlyUser\(currentUser\)\) \{\s*await syncOperationalRoomStates/);
  assert.match(mapaSource, /data-read-only="true"/);

  assert.match(roomCardSource, /if \(isAseoReadOnlyUser\(currentUser\)\) return readOnlyRoomCard\(room\);/);
  const readOnlyCard = roomCardSource.slice(roomCardSource.indexOf('export function readOnlyRoomCard'), roomCardSource.indexOf('function getBadgeBackgroundColor'));
  assert.doesNotMatch(readOnlyCard, /onclick|showHabitacionOpcionesModal|cliente_nombre|buildActiveGuestHtml|buildAlertChipsHtml/);
  assert.match(roomCardSource, /if \(!readOnly && \(room\.estado === 'ocupada'/);

  assert.match(saldoSource, /if \(grid\.dataset\.readOnly === 'true'\) return;/);
});

async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    create table public.hoteles(id uuid primary key, creado_por uuid);
    create table public.usuarios(id uuid primary key, hotel_id uuid, rol text, activo boolean default true);
    create table public.roles(id uuid primary key default gen_random_uuid(), nombre text unique not null, descripcion text);
    create table public.usuarios_roles(usuario_id uuid, rol_id uuid, hotel_id uuid);
    create function public.es_nombre_rol_mantenimiento_conserje(p_nombre text) returns boolean language sql immutable as $$
      select lower(trim(coalesce(p_nombre,''))) like '%mantenimiento%' or lower(trim(coalesce(p_nombre,''))) like '%conserje%'
    $$;
    insert into public.hoteles(id) values ('00000000-0000-4000-8000-000000000001');
    insert into public.roles(nombre, descripcion) values
      ('Aseador', 'Personal de limpieza'), ('Mesero/a', null), ('Recepcionista', null), ('Administrador', null);
  `);
  const users = {
    aseador: ['00000000-0000-4000-8000-000000000011', 'usuario', 'Aseador'],
    camareraLegacy: ['00000000-0000-4000-8000-000000000012', 'camarera', null],
    mesero: ['00000000-0000-4000-8000-000000000013', 'usuario', 'Mesero/a'],
    recepcion: ['00000000-0000-4000-8000-000000000014', 'usuario', 'Recepcionista'],
  };
  for (const [userId, rol, rolNombre] of Object.values(users)) {
    await db.query("insert into public.usuarios(id, hotel_id, rol) values ($1, '00000000-0000-4000-8000-000000000001', $2)", [userId, rol]);
    if (rolNombre) {
      await db.query(
        "insert into public.usuarios_roles(usuario_id, rol_id, hotel_id) select $1, id, '00000000-0000-4000-8000-000000000001' from public.roles where nombre = $2",
        [userId, rolNombre],
      );
    }
  }
  await db.exec(migration);
  return { db, users };
}

async function asUser(db, userId, sql) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId })]);
  const result = await db.query(sql);
  return result.rows[0];
}

test('energia: el aseador puede escanear y confirmar QR, pero no administrar', async (t) => {
  const { db, users } = await createDatabase();
  t.after(() => db.close());

  const check = (key) => asUser(db, users[key][0],
    'select public.energy_actor_allowed(false) as control, public.energy_actor_allowed(true) as admin, public.energy_actor_role_label() as label');

  assert.deepEqual(await check('aseador'), { control: true, admin: false, label: 'Aseador' });
  assert.deepEqual(await check('camareraLegacy'), { control: true, admin: false, label: 'camarera' });
  assert.deepEqual(await check('recepcion'), { control: true, admin: false, label: 'Recepcionista' });
  assert.equal((await check('mesero')).control, false, 'el mesero sigue sin acceso');

  const descripcion = await db.query("select descripcion from public.roles where nombre = 'Aseador'");
  assert.match(descripcion.rows[0].descripcion, /solo lectura, limpieza y control de energia/);
});
