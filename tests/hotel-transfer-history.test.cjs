const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

const origin = '00000000-0000-4000-8000-000000000001';
const destination = '00000000-0000-4000-8000-000000000002';
const employee = '00000000-0000-4000-8000-000000000003';
const originStaff = '00000000-0000-4000-8000-000000000004';
const shift = '00000000-0000-4000-8000-000000000005';

test('hotel transfer preserves historical attribution and restricts shift access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema p0_private;
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated;
      create table public.hoteles (id uuid primary key);
      create table public.usuarios (
        id uuid primary key, hotel_id uuid, nombre text, correo text, email text, activo boolean
      );
      create table public.turnos (id uuid primary key, hotel_id uuid, usuario_id uuid, estado text);
      create table public.caja (hotel_id uuid, usuario_id uuid);
      create function public.fase1_actor_es_miembro_activo(hotel uuid)
      returns boolean language sql stable security definer as
        $$ select exists (
          select 1 from public.usuarios where id = auth.uid() and hotel_id = hotel and activo
        ) $$;
      create function public.actor_is_saas_superadmin() returns boolean language sql stable as
        $$ select false $$;
      alter table public.usuarios enable row level security;
      alter table public.turnos enable row level security;
      grant select on public.usuarios to authenticated;
      grant select, insert, update on public.turnos to authenticated;
      create policy usuarios_tenant on public.usuarios for select to authenticated
        using (id = auth.uid() or public.fase1_actor_es_miembro_activo(hotel_id));
      create policy turnos_tenant on public.turnos for select to authenticated
        using (public.fase1_actor_es_miembro_activo(hotel_id));
      create policy turnos_propios_select on public.turnos for select to authenticated
        using (usuario_id = auth.uid());
      create policy turnos_propios_update on public.turnos for update to authenticated
        using (usuario_id = auth.uid());
      create policy turnos_propios_insert on public.turnos for insert to authenticated
        with check (usuario_id = auth.uid());
      insert into public.hoteles values ('${origin}'), ('${destination}');
      insert into public.usuarios values
        ('${employee}', '${origin}', 'Recepcionista', 'staff@example.test', 'staff@example.test', true),
        ('${originStaff}', '${origin}', 'Personal de origen', null, null, true);
      insert into public.turnos values ('${shift}', '${origin}', '${employee}', 'cerrado');
    `);
    const migration = readFileSync(join(__dirname, '../supabase/migrations/20261103213652_hotel_transfer_history_and_shift_access.sql'), 'utf8');
    await db.exec(migration);
    await db.query('update public.usuarios set hotel_id = $1 where id = $2', [destination, employee]);

    await db.exec('set role authenticated');
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [originStaff]);
    const { rows: visible } = await db.query(`
      select t.estado, h.nombre, h.correo, h.email, h.trasladado
      from public.turnos t cross join lateral public.usuarios_historial(t) h where t.id = $1
    `, [shift]);
    assert.deepEqual(visible, [{
      estado: 'cerrado', nombre: 'Recepcionista', correo: null, email: null, trasladado: true
    }]);
    assert.equal((await db.query('select id from public.usuarios where id = $1', [employee])).rows.length, 0);

    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [employee]);
    assert.equal((await db.query('select id from public.turnos where id = $1', [shift])).rows.length, 0);
    assert.equal((await db.query("update public.turnos set estado = 'abierto' where id = $1 returning id", [shift])).rows.length, 0);
    await assert.rejects(
      db.query("insert into public.turnos values (gen_random_uuid(), $1, $2, 'abierto')", [origin, employee]),
      { code: '42501' }
    );
    const { rows: [opened] } = await db.query(
      "insert into public.turnos values (gen_random_uuid(), $1, $2, 'abierto') returning id", [destination, employee]
    );
    assert.equal((await db.query("update public.turnos set estado = 'cerrado' where id = $1 returning id", [opened.id])).rows.length, 1);
    assert.deepEqual((await db.query('select hotel_id, trasladado from public.usuarios_historial where id = $1', [employee])).rows,
      [{ hotel_id: destination, trasladado: false }]);
  } finally {
    await db.close();
  }
});
