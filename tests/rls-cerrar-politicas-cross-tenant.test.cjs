const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20261006200000_rls_cerrar_politicas_cross_tenant.sql'),
  'utf8',
);

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const H1 = id(1);
const H2 = id(2);
const U1 = id(11);
const U2 = id(12);

// Reproduce las politicas vigentes en produccion antes de la migracion.
async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.usuarios(id uuid primary key, hotel_id uuid);
    create function public.get_my_hotel_id() returns uuid language sql stable security definer as $$
      select hotel_id from public.usuarios where id = auth.uid()
    $$;
    grant execute on function public.get_my_hotel_id() to authenticated;

    create table public.habitaciones(id uuid primary key, hotel_id uuid not null, nombre text, estado text);
    alter table public.habitaciones enable row level security;
    create policy "Permitir acceso a habitaciones del propio hotel" on public.habitaciones
      for all using (hotel_id = get_my_hotel_id());
    create policy "Permitir actualización a usuarios autenticados" on public.habitaciones
      for update using (auth.uid() is not null) with check (auth.uid() is not null);

    create table public.integraciones_hotel(hotel_id uuid primary key, facturador_api_key text, crm_token text);
    alter table public.integraciones_hotel enable row level security;
    create policy "Allow select for hotel integrations" on public.integraciones_hotel for select using (auth.uid() is not null);
    create policy "Allow insert for hotel integrations" on public.integraciones_hotel for insert with check (auth.uid() is not null);
    create policy "Allow update for hotel integrations" on public.integraciones_hotel for update with check (auth.uid() is not null);
    create policy "Select own hotel integrations only" on public.integraciones_hotel for select
      using (exists (select 1 from usuarios u where u.id = auth.uid() and u.hotel_id = integraciones_hotel.hotel_id));
    create policy "Insert own hotel integrations only" on public.integraciones_hotel for insert
      with check (exists (select 1 from usuarios u where u.id = auth.uid() and u.hotel_id = integraciones_hotel.hotel_id));
    create policy "Update own hotel integrations only" on public.integraciones_hotel for update
      using (exists (select 1 from usuarios u where u.id = auth.uid() and u.hotel_id = integraciones_hotel.hotel_id));
    create policy "Delete own hotel integrations only" on public.integraciones_hotel for delete
      using (exists (select 1 from usuarios u where u.id = auth.uid() and u.hotel_id = integraciones_hotel.hotel_id));

    grant select, insert, update, delete on public.habitaciones, public.integraciones_hotel, public.usuarios to authenticated;
    alter table public.usuarios enable row level security;
    create policy usuarios_self on public.usuarios for select using (true);

    insert into public.usuarios values ('${U1}', '${H1}'), ('${U2}', '${H2}');
    insert into public.habitaciones values ('${id(101)}', '${H1}', '101', 'libre'), ('${id(201)}', '${H2}', '201', 'libre');
    insert into public.integraciones_hotel values ('${H1}', 'secreto-h1', 'token-h1'), ('${H2}', 'secreto-h2', 'token-h2');
  `);
  return db;
}

async function asUser(db, userId, fn) {
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
    await db.exec('set local role authenticated');
    const result = await fn();
    await db.exec('rollback');
    return result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function crossTenantSnapshot(db) {
  return asUser(db, U1, async () => {
    const updatedForeignRoom = await db.query(`update public.habitaciones set estado = 'ocupada' where id = '${id(201)}' returning id`);
    const updatedOwnRoom = await db.query(`update public.habitaciones set estado = 'limpieza' where id = '${id(101)}' returning id`);
    const visibleKeys = await db.query('select hotel_id from public.integraciones_hotel order by hotel_id');
    const updatedForeignKey = await db.query(`update public.integraciones_hotel set facturador_api_key = 'robado' where hotel_id = '${H2}' returning hotel_id`);
    let insertedForeign = true;
    try {
      await db.query("savepoint s");
      await db.query(`insert into public.integraciones_hotel values ('${id(3)}', 'x', 'y')`);
    } catch {
      insertedForeign = false;
      await db.query('rollback to savepoint s');
    }
    const updatedOwnKey = await db.query(`update public.integraciones_hotel set crm_token = 'nuevo' where hotel_id = '${H1}' returning hotel_id`);
    // Un UPDATE sin WHERE no pasa por la politica de lectura: solo la de UPDATE decide.
    await db.query("update public.habitaciones set estado = 'masivo'");
    await db.exec('reset role');
    const foreignAfterMass = await db.query(`select estado from public.habitaciones where id = '${id(201)}'`);
    return {
      foreignRoom: updatedForeignRoom.rows.length,
      foreignRoomMassUpdate: foreignAfterMass.rows[0].estado === 'masivo',
      ownRoom: updatedOwnRoom.rows.length,
      visibleKeys: visibleKeys.rows.map((r) => r.hotel_id),
      foreignKeyUpdate: updatedForeignKey.rows.length,
      insertedForeign,
      ownKeyUpdate: updatedOwnKey.rows.length,
    };
  });
}

test('antes de la migracion: las politicas permisivas exponen otros hoteles', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  const before = await crossTenantSnapshot(db);
  assert.equal(before.foreignRoom, 0, 'con WHERE la politica de lectura ya filtra por hotel');
  assert.equal(before.foreignRoomMassUpdate, true, 'reproduce el bug: un UPDATE sin WHERE alcanza otros hoteles');
  assert.deepEqual(before.visibleKeys, [H1, H2], 'reproduce el bug: ve credenciales de otro hotel');
  assert.equal(before.insertedForeign, true);
});

test('despues de la migracion: cada usuario solo ve y modifica su hotel', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec(migration);

  assert.deepEqual(await crossTenantSnapshot(db), {
    foreignRoom: 0,
    foreignRoomMassUpdate: false,
    ownRoom: 1,
    visibleKeys: [H1],
    foreignKeyUpdate: 0,
    insertedForeign: false,
    ownKeyUpdate: 1,
  });

  const policies = await db.query("select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2");
  assert.deepEqual(policies.rows.map((r) => `${r.tablename}:${r.policyname}`), [
    'habitaciones:Permitir acceso a habitaciones del propio hotel',
    'integraciones_hotel:Delete own hotel integrations only',
    'integraciones_hotel:Insert own hotel integrations only',
    'integraciones_hotel:Select own hotel integrations only',
    'integraciones_hotel:Update own hotel integrations only',
    'usuarios:usuarios_self',
  ]);

  // Idempotente.
  await db.exec(migration);
});

test('la migracion aborta si habitaciones quedaria sin politica por hotel', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await db.exec('drop policy "Permitir acceso a habitaciones del propio hotel" on public.habitaciones');
  await assert.rejects(() => db.exec(migration), /RLS_SIN_POLITICA_HOTEL/);
});
