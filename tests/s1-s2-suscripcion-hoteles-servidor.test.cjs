const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261103230000_blindar_suscripcion_hoteles.sql'),
  'utf8',
);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H1 = id(1);
const REFERIDOR = id(2);
const H3 = id(3);
const ADMIN = id(11);
const RECEPCION = id(12);
const SUPERADMIN = id(13);
const NUEVO = id(14);
const ADMIN_H3 = id(15);
const ROL_ADMIN = id(90);

// Reproduce la tabla hoteles, sus triggers y las politicas vigentes en produccion
// antes de la migracion (consultadas en solo lectura el 2026-11-03).
async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;

    create type public.plan_hotel_enum as enum ('lite', 'max', 'pro', 'prueba');
    create table public.roles(id uuid primary key, nombre text not null);
    create table public.usuarios(id uuid primary key, nombre text, hotel_id uuid, correo text, rol text default 'usuario', activo boolean default true);
    create table public.usuarios_roles(id uuid primary key default gen_random_uuid(), usuario_id uuid not null, rol_id uuid not null references public.roles(id), hotel_id uuid);
    alter table public.usuarios enable row level security;
    alter table public.usuarios_roles enable row level security;
    create policy usuarios_select on public.usuarios for select using (true);

    create table public.hoteles(
      id uuid primary key default gen_random_uuid(),
      nombre text not null unique,
      correo text unique,
      telefono text,
      direccion text,
      plan public.plan_hotel_enum default 'prueba',
      plan_id integer,
      activo boolean default true,
      estado_suscripcion text default 'trial',
      trial_inicio timestamptz default now(),
      trial_fin timestamptz default (now() + interval '14 days'),
      suscripcion_fin timestamptz,
      creado_por uuid,
      fecha_inicio_prueba date,
      fecha_vencimiento date,
      bloqueado boolean default false,
      referido_por uuid,
      gracia_hasta timestamptz,
      gracia_motivo text,
      gracia_actualizada_en timestamptz,
      suscripcion_inicio timestamptz,
      plan_pendiente text,
      plan_pendiente_id integer,
      plan_pendiente_desde timestamptz,
      suscripcion_exenta boolean not null default false,
      suscripcion_exenta_motivo text
    );
    alter table public.usuarios_roles add foreign key (hotel_id) references public.hoteles(id);

    create function public.actor_is_saas_superadmin() returns boolean
      language sql stable security definer set search_path = '' as $$
      select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.rol = 'superadmin')
    $$;
    create function public.usuario_actual_es_admin_hotel(p_hotel_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.usuarios u where u.id = auth.uid()
        and (u.hotel_id = p_hotel_id or u.rol = 'superadmin') and lower(u.rol) in ('admin', 'administrador', 'superadmin'))
    $$;
    create function public.fase1_actor_es_miembro_activo(p_hotel_id uuid) returns boolean
      language sql stable security definer set search_path = public as $$
      select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.hotel_id = p_hotel_id and u.activo)
    $$;
    grant execute on function public.actor_is_saas_superadmin() to authenticated;

    alter table public.hoteles enable row level security;
    create policy "hoteles_tenant_select" on public.hoteles for select to authenticated
      using (public.fase1_actor_es_miembro_activo(id) or public.actor_is_saas_superadmin());
    create policy "hoteles_onboarding_insert" on public.hoteles for insert to authenticated
      with check (creado_por = auth.uid() and not exists (select 1 from public.usuarios u where u.id = auth.uid()));
    create policy "hoteles_admin_update" on public.hoteles for update to authenticated
      using (public.usuario_actual_es_admin_hotel(id) or public.actor_is_saas_superadmin())
      with check (public.usuario_actual_es_admin_hotel(id) or public.actor_is_saas_superadmin());

    create function public.proteger_suscripcion_exenta_hotel() returns trigger language plpgsql
      security invoker set search_path = public as $$
    begin
      if coalesce(new.suscripcion_exenta, false) then new.estado_suscripcion := 'activo'; end if;
      return new;
    end;
    $$;
    create trigger trg_proteger_suscripcion_exenta_hotel before insert or update on public.hoteles
      for each row execute function public.proteger_suscripcion_exenta_hotel();

    -- Como saas_otorgar_dias_gracia: SECURITY DEFINER con su propio control de acceso.
    create function public.otorgar_gracia_definer(p_hotel_id uuid) returns void
      language sql security definer set search_path = public as $$
      update public.hoteles set gracia_hasta = now() + interval '5 days', gracia_motivo = 'soporte' where id = p_hotel_id
    $$;
    grant execute on function public.otorgar_gracia_definer(uuid) to authenticated;

    grant select, insert, update on public.hoteles to authenticated, service_role;
    grant select, insert on public.usuarios, public.usuarios_roles to authenticated, service_role;
    grant select on public.roles to authenticated, service_role;

    insert into public.roles values ('${ROL_ADMIN}', 'Administrador'), ('${id(91)}', 'Recepcionista');
    insert into auth.users values ('${NUEVO}', 'nuevo@example.com'), ('${ADMIN}', 'admin1@example.com');
    insert into public.hoteles(id, nombre, plan, estado_suscripcion, trial_fin, suscripcion_fin, creado_por)
      values ('${H1}', 'Hotel Uno', 'lite', 'vencido', now() - interval '60 days', now() - interval '3 days', '${ADMIN}'),
             ('${REFERIDOR}', 'Hotel Referidor', 'max', 'activo', null, now() + interval '10 days', null),
             ('${H3}', 'Hotel Tres', 'pro', 'activo', null, now() + interval '20 days', '${ADMIN_H3}');
    update public.hoteles set suscripcion_exenta = true, suscripcion_exenta_motivo = 'interno' where id = '${REFERIDOR}';
    insert into public.usuarios(id, nombre, hotel_id, rol) values
      ('${ADMIN}', 'Admin Uno', '${H1}', 'admin'), ('${RECEPCION}', 'Recepcion Uno', '${H1}', 'recepcionista'),
      ('${SUPERADMIN}', 'Super', null, 'superadmin'), ('${ADMIN_H3}', 'Admin Tres', '${H3}', 'admin');
  `);
  return db;
}

async function setActor(db, role, userId) {
  await db.query("select set_config('request.jwt.claims', $1, true)", [userId ? JSON.stringify({ sub: userId }) : '']);
  await db.exec(`set local role ${role}`);
}

// Ejecuta como el rol indicado y revierte al terminar.
async function as(db, role, userId, fn) {
  await db.exec('begin');
  try {
    await setActor(db, role, userId);
    return await fn();
  } finally {
    await db.exec('rollback');
  }
}

// Ejecuta como el rol indicado y confirma, para inspeccionar despues lo que quedo guardado.
async function commitAs(db, role, userId, sql, params = []) {
  await db.exec('begin');
  try {
    await setActor(db, role, userId);
    const result = await db.query(sql, params);
    await db.exec('commit');
    return { result, error: null };
  } catch (error) {
    await db.exec('rollback');
    return { result: null, error };
  }
}

const asAdmin = (db, fn) => as(db, 'authenticated', ADMIN, fn);

async function errorCode(db, sql) {
  await db.query('savepoint intento');
  try {
    await db.query(sql);
    await db.query('release savepoint intento');
    return null;
  } catch (error) {
    await db.query('rollback to savepoint intento');
    return error.code;
  }
}

const ATAQUES_ADMIN = {
  suscripcion_fin: "suscripcion_fin = '2099-12-31'",
  trial_fin: "trial_fin = '2099-12-31'",
  trial_inicio: 'trial_inicio = now()',
  suscripcion_inicio: 'suscripcion_inicio = now()',
  estado_suscripcion: "estado_suscripcion = 'activo'",
  plan: "plan = 'max'",
  plan_id: 'plan_id = 3',
  plan_pendiente: "plan_pendiente = 'max'",
  plan_pendiente_id: 'plan_pendiente_id = 3',
  plan_pendiente_desde: 'plan_pendiente_desde = now()',
  suscripcion_exenta: 'suscripcion_exenta = true',
  suscripcion_exenta_motivo: "suscripcion_exenta_motivo = 'yo'",
  gracia_hasta: "gracia_hasta = '2099-12-31'",
  gracia_motivo: "gracia_motivo = 'yo'",
  gracia_actualizada_en: 'gracia_actualizada_en = now()',
  referido_por: `referido_por = '${REFERIDOR}'`,
  fecha_inicio_prueba: 'fecha_inicio_prueba = current_date',
  fecha_vencimiento: "fecha_vencimiento = '2099-12-31'",
  bloqueado: 'bloqueado = true',
  activo: 'activo = false',
  creado_por: `creado_por = '${RECEPCION}'`,
};

const REGISTRO = 'select public.registrar_hotel_inicial($1, $2, $3) as hotel_id';

test('antes de la migracion: el admin extiende su plan y el alta directa falla o queda incompleta (reproduce S1, S2 y D4)', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const actualizado = await asAdmin(db, () =>
    db.query(`update public.hoteles set suscripcion_fin = '2099-12-31', suscripcion_exenta = true where id = '${H1}' returning estado_suscripcion`));
  assert.deepEqual(actualizado.rows, [{ estado_suscripcion: 'activo' }], 'reproduce S1: el admin cambia su vencimiento y se exime');

  // Lo que hacia script.js: insert(...).select('id') -> RETURNING choca con hoteles_tenant_select.
  const conReturning = await commitAs(db, 'authenticated', NUEVO,
    `insert into public.hoteles(nombre, plan, estado_suscripcion, trial_fin, suscripcion_fin, creado_por)
     values ('Hotel Nuevo', 'max', 'trial', now() + interval '30 days', now() + interval '30 days', '${NUEVO}') returning id`);
  assert.match(String(conReturning.error?.message), /row-level security/, 'reproduce: el registro actual falla al pedir el id');

  // Sin RETURNING, un cliente manipulado fija 2099 y deja un hotel sin administrador.
  const manipulado = await commitAs(db, 'authenticated', NUEVO,
    `insert into public.hoteles(nombre, plan, estado_suscripcion, trial_fin, suscripcion_fin, creado_por)
     values ('Hotel Nuevo', 'max', 'trial', '2099-12-31', '2099-12-31', '${NUEVO}')`);
  assert.equal(manipulado.error, null);
  const { rows } = await db.query(`select extract(year from suscripcion_fin)::int as anio,
    (select count(*)::int from public.usuarios u where u.hotel_id = h.id) as admins from public.hoteles h where nombre = 'Hotel Nuevo'`);
  assert.deepEqual(rows, [{ anio: 2099, admins: 0 }]);
});

test('S1: el admin del hotel no puede cambiar ninguna columna de suscripcion', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  for (const [columna, set] of Object.entries(ATAQUES_ADMIN)) {
    assert.ok(migration.includes(`'${columna}'`), `la migracion protege ${columna}`);
    const code = await asAdmin(db, () => errorCode(db, `update public.hoteles set ${set} where id = '${H1}'`));
    assert.equal(code, '42501', `debe rechazar el cambio de ${columna}`);
  }

  const { rows } = await db.query(`select plan, estado_suscripcion, suscripcion_exenta, gracia_hasta,
    suscripcion_fin < now() as fin_intacto from public.hoteles where id = '${H1}'`);
  assert.deepEqual(rows[0], { plan: 'lite', estado_suscripcion: 'vencido', suscripcion_exenta: false, gracia_hasta: null, fin_intacto: true });
});

test('S1: el admin sigue editando los datos normales del hotel, aunque reenvie la suscripcion sin cambios', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  const result = await asAdmin(db, () => db.query(`update public.hoteles
    set nombre = 'Hotel Uno Renovado', telefono = '3001234567', direccion = 'Calle 1', plan = plan, suscripcion_fin = suscripcion_fin
    where id = '${H1}' returning nombre, telefono, direccion`));
  assert.deepEqual(result.rows, [{ nombre: 'Hotel Uno Renovado', telefono: '3001234567', direccion: 'Calle 1' }]);
});

test('S1: un recepcionista y un admin de otro hotel no alteran la suscripcion ajena', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  const ajeno = await as(db, 'authenticated', ADMIN_H3, () =>
    db.query(`update public.hoteles set suscripcion_fin = '2099-12-31', nombre = 'robado' where id = '${H1}' returning id`));
  assert.equal(ajeno.rows.length, 0, 'RLS no le deja tocar la fila de otro hotel');

  const recepcion = await as(db, 'authenticated', RECEPCION, () =>
    db.query(`update public.hoteles set suscripcion_fin = '2099-12-31' where id = '${H1}' returning id`));
  assert.equal(recepcion.rows.length, 0, 'solo el admin actualiza el hotel');

  const { rows } = await db.query(`select nombre, suscripcion_fin < now() as fin_intacto from public.hoteles where id = '${H1}'`);
  assert.deepEqual(rows, [{ nombre: 'Hotel Uno', fin_intacto: true }]);
});

test('S1: renovacion por webhook (service_role), superadmin, RPC SECURITY DEFINER y cron siguen funcionando', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  const webhook = await as(db, 'service_role', null, () => db.query(`update public.hoteles
    set plan = 'pro', estado_suscripcion = 'activo', suscripcion_fin = now() + interval '30 days', referido_por = null
    where id = '${H1}' returning plan`));
  assert.deepEqual(webhook.rows, [{ plan: 'pro' }]);

  const superadmin = await as(db, 'authenticated', SUPERADMIN, () => db.query(`update public.hoteles
    set suscripcion_exenta = true, suscripcion_exenta_motivo = 'cortesia' where id = '${H1}' returning estado_suscripcion`));
  assert.deepEqual(superadmin.rows, [{ estado_suscripcion: 'activo' }]);

  const gracia = await asAdmin(db, async () => {
    await db.query(`select public.otorgar_gracia_definer('${H1}')`);
    return db.query(`select gracia_motivo from public.hoteles where id = '${H1}'`);
  });
  assert.deepEqual(gracia.rows, [{ gracia_motivo: 'soporte' }]);

  // Rol propietario, como sincronizar_estados_suscripcion desde pg_cron.
  const cron = await db.query(`update public.hoteles set estado_suscripcion = 'vencido' where id = '${H3}' returning id`);
  assert.equal(cron.rows.length, 1);
});

test('la migracion no recalcula suscripciones ni exenciones existentes y es idempotente', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const snapshot = () => db.query('select * from public.hoteles order by id').then((r) => r.rows);
  const before = await snapshot();
  await db.exec(migration);
  await db.exec(migration);
  assert.deepEqual(await snapshot(), before);

  const triggers = await db.query(`select tgname from pg_trigger where tgrelid = 'public.hoteles'::regclass and not tgisinternal order by tgname`);
  assert.deepEqual(triggers.rows.map((r) => r.tgname), ['trg_blindar_suscripcion_hotel', 'trg_proteger_suscripcion_exenta_hotel']);
  const policies = await db.query(`select policyname from pg_policies where tablename = 'hoteles' order by 1`);
  assert.deepEqual(policies.rows.map((r) => r.policyname), ['hoteles_admin_update', 'hoteles_tenant_select']);
});

test('S2: el alta normal crea hotel, admin y rol con el trial de 30 dias del servidor', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  const { result, error } = await commitAs(db, 'authenticated', NUEVO, REGISTRO, ['  Hotel Nuevo ', 'Ana Admin', REFERIDOR]);
  assert.equal(error, null);
  const hotelId = result.rows[0].hotel_id;

  const hotel = await db.query(`select nombre, correo, plan, plan_id, estado_suscripcion, suscripcion_exenta, gracia_hasta,
      creado_por, referido_por, abs(extract(epoch from (trial_inicio - now()))) < 5 as inicio_servidor,
      trial_fin - trial_inicio = interval '30 days' as dura_30_dias, suscripcion_fin = trial_fin as fin_igual_trial
    from public.hoteles where id = $1`, [hotelId]);
  assert.deepEqual(hotel.rows[0], {
    nombre: 'Hotel Nuevo', correo: 'nuevo@example.com', plan: 'max', plan_id: null, estado_suscripcion: 'trial',
    suscripcion_exenta: false, gracia_hasta: null, creado_por: NUEVO, referido_por: REFERIDOR,
    inicio_servidor: true, dura_30_dias: true, fin_igual_trial: true,
  });
  const perfil = await db.query('select nombre, hotel_id, correo, rol from public.usuarios where id = $1', [NUEVO]);
  assert.deepEqual(perfil.rows, [{ nombre: 'Ana Admin', hotel_id: hotelId, correo: 'nuevo@example.com', rol: 'admin' }]);
  const roles = await db.query('select rol_id, hotel_id from public.usuarios_roles where usuario_id = $1', [NUEVO]);
  assert.deepEqual(roles.rows, [{ rol_id: ROL_ADMIN, hotel_id: hotelId }]);

  // Ya es miembro: lee su hotel, y un segundo registro con la misma cuenta se rechaza.
  const visible = await as(db, 'authenticated', NUEVO, () => db.query('select estado_suscripcion from public.hoteles where id = $1', [hotelId]));
  assert.deepEqual(visible.rows, [{ estado_suscripcion: 'trial' }]);
  const segundo = await commitAs(db, 'authenticated', NUEVO, REGISTRO, ['Otro Hotel', 'Ana', null]);
  assert.match(String(segundo.error?.message), /ya pertenece a un hotel/);
});

test('S2: un registro manipulado no obtiene beneficios ni deja altas incompletas', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);
  const cuenta = () => db.query(`select (select count(*)::int from public.hoteles) as hoteles,
    (select count(*)::int from public.usuarios) as usuarios, (select count(*)::int from public.usuarios_roles) as roles`).then((r) => r.rows[0]);
  const inicial = await cuenta();

  // Insercion directa con fechas, plan y exencion falsos: ya no hay politica de INSERT.
  const directo = await commitAs(db, 'authenticated', NUEVO,
    `insert into public.hoteles(nombre, plan, estado_suscripcion, trial_fin, suscripcion_fin, suscripcion_exenta, creado_por)
     values ('Hotel Falso', 'pro', 'activo', '2099-12-31', '2099-12-31', true, '${NUEVO}')`);
  assert.equal(directo.error?.code, '42501');

  // Referido invalido o inexistente: el alta sigue, sin referido.
  for (const ref of ['no-es-uuid', id(999), "'; drop table public.hoteles; --"]) {
    const r = await as(db, 'authenticated', NUEVO, async () => {
      const { rows } = await db.query(REGISTRO, ['Hotel Ref', 'Ana', ref]);
      return db.query('select referido_por from public.hoteles where id = $1', [rows[0].hotel_id]);
    });
    assert.deepEqual(r.rows, [{ referido_por: null }], `referido ${ref}`);
  }

  // Sin sesion, colaborador existente, nombre duplicado o vacio: error y nada creado.
  assert.match(String((await commitAs(db, 'authenticated', null, REGISTRO, ['Hotel X', 'Ana', null])).error?.message), /iniciar sesion/);
  assert.equal((await commitAs(db, 'anon', null, REGISTRO, ['Hotel X', 'Ana', null])).error?.code, '42501');
  assert.match(String((await commitAs(db, 'authenticated', RECEPCION, REGISTRO, ['Hotel X', 'Ana', null])).error?.message), /ya pertenece/);
  assert.match(String((await commitAs(db, 'authenticated', NUEVO, REGISTRO, ['Hotel Uno', 'Ana', null])).error?.message), /hoteles_nombre_key/);
  assert.equal((await commitAs(db, 'authenticated', NUEVO, REGISTRO, ['  ', 'Ana', null])).error?.code, '22023');

  // Si falta el rol Administrador, se revierte tambien el hotel y el perfil.
  await db.exec(`delete from public.roles where id = '${ROL_ADMIN}'`);
  assert.equal((await commitAs(db, 'authenticated', NUEVO, REGISTRO, ['Hotel Sin Rol', 'Ana', null])).error?.code, 'P0002');
  assert.deepEqual(await cuenta(), inicial);
});

test('S2: altas desde service_role (soporte) conservan sus valores', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  const { rows } = await as(db, 'service_role', null, () => db.query(`insert into public.hoteles(nombre, plan, estado_suscripcion, suscripcion_fin)
    values ('Hotel Interno', 'pro', 'activo', '2030-01-01') returning plan, estado_suscripcion`));
  assert.deepEqual(rows, [{ plan: 'pro', estado_suscripcion: 'activo' }]);
});
