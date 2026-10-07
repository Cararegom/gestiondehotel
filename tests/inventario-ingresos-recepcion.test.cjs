const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { asActor, database, ids, latestFunction, resetData } = require('./helpers/c5-database.cjs');

const receptionist = '20000000-0000-4000-8000-000000000001';
const inactiveReceptionist = '20000000-0000-4000-8000-000000000002';
const operationId = (value) => `20000000-0000-4000-8000-${String(value + 100).padStart(12, '0')}`;

async function setupPermissions(db) {
  await db.exec(`
    create table public.roles(id uuid primary key default gen_random_uuid(), nombre text not null);
    create table public.permisos(id uuid primary key default gen_random_uuid(), nombre text not null, descripcion text);
    create table public.roles_permisos(
      id uuid primary key default gen_random_uuid(),
      rol_id uuid references public.roles(id), permiso_id uuid references public.permisos(id)
    );
    create table public.usuarios_roles(
      id uuid primary key default gen_random_uuid(), usuario_id uuid references public.usuarios(id),
      rol_id uuid references public.roles(id), hotel_id uuid
    );
    create table public.usuarios_permisos(
      id uuid primary key default gen_random_uuid(), usuario_id uuid references public.usuarios(id),
      permiso_id uuid references public.permisos(id), permitido boolean
    );
    insert into public.roles(nombre) values ('Administrador'), ('Recepcionista'), ('Mesero/a'), ('Gerente');
    insert into public.permisos(nombre) values ('inventario.ajustar');
    insert into public.roles_permisos(rol_id, permiso_id)
      select r.id, p.id from public.roles r cross join public.permisos p where r.nombre = 'Administrador';
    insert into public.usuarios(id, hotel_id, activo, rol) values
      ('${receptionist}', '${ids.hotelA}', true, 'usuario'),
      ('${inactiveReceptionist}', '${ids.hotelA}', false, 'usuario');
    insert into public.usuarios_roles(usuario_id, rol_id, hotel_id)
      select u.id, r.id, u.hotel_id from public.usuarios u join public.roles r on
        r.nombre = case when u.id in ('${receptionist}', '${inactiveReceptionist}') then 'Recepcionista'
          when u.rol = 'admin' then 'Administrador' else 'Mesero/a' end;
  `);
  for (const name of ['fase1_actor_es_miembro_activo', 'usuario_actual_es_admin_hotel', 'fase1_actor_tiene_permiso']) {
    await db.exec(latestFunction(name).definition);
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '../supabase/migrations', latestFunction('ajustar_stock_tienda_seguro').migration),
    'utf8',
  );
  await db.exec(migration);
  return migration;
}

async function seedProducts(db) {
  await resetData(db);
  await db.exec(`
    insert into public.productos_tienda(id, hotel_id, nombre, stock_actual) values
      ('${ids.productA}', '${ids.hotelA}', 'Agua Brisa', 0),
      ('${ids.productB}', '${ids.hotelB}', 'Agua de otro hotel', 10);
  `);
}

async function adjust(db, { delta = 24, product = ids.productA, operation = operationId(1) } = {}) {
  const result = await db.query(
    'select public.ajustar_stock_tienda_seguro($1, $2, $3, $4) as result',
    [product, delta, 'Compra recibida', operation],
  );
  return result.rows[0].result;
}

async function stockState(db) {
  const result = await db.query(`
    select
      (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
      (select count(*)::int from public.movimientos_inventario) as movements,
      (select count(*)::int from public.auditoria_operaciones) as audits
  `);
  return result.rows[0];
}

test('Recepcion puede ingresar inventario sin permisos de salida ni acceso a otros hoteles', async (t) => {
  const { db } = await database();
  try {
    const migration = await setupPermissions(db);

    await t.test('el permiso de ingreso se asigna solo a recepcion y administracion y no se duplica', async () => {
      await db.exec(migration);
      const result = await db.query(`
        select r.nombre, p.nombre as permiso from public.roles_permisos rp
          join public.roles r on r.id = rp.rol_id join public.permisos p on p.id = rp.permiso_id
        order by r.nombre, p.nombre
      `);
      assert.deepEqual(result.rows, [
        { nombre: 'Administrador', permiso: 'inventario.ajustar' },
        { nombre: 'Administrador', permiso: 'inventario.ingresar' },
        { nombre: 'Recepcionista', permiso: 'inventario.ingresar' },
      ]);
    });

    await t.test('recepcion suma 24 unidades y el reintento conserva un solo movimiento y auditoria', async () => {
      await seedProducts(db);
      const first = await asActor(db, receptionist, (tx) => adjust(tx));
      const retry = await asActor(db, receptionist, (tx) => adjust(tx));
      assert.equal(first.stock_anterior, 0);
      assert.equal(first.stock_actual, 24);
      assert.equal(retry.idempotent, true);
      assert.equal(retry.movimiento_id, first.movimiento_id);
      assert.deepEqual(await stockState(db), { stock: 24, movements: 1, audits: 1 });
      const movement = await db.query('select tipo_movimiento, cantidad, usuario_id from public.movimientos_inventario');
      assert.deepEqual(movement.rows, [{ tipo_movimiento: 'INGRESO', cantidad: 24, usuario_id: receptionist }]);
      const audit = await db.query('select actor_id from public.auditoria_operaciones');
      assert.equal(audit.rows[0].actor_id, receptionist);
    });

    await t.test('recepcion no puede descontar stock ni reutilizar un ingreso para hacer una salida', async () => {
      await seedProducts(db);
      await asActor(db, receptionist, (tx) => adjust(tx));
      for (const operation of [operationId(1), operationId(2)]) {
        await assert.rejects(
          asActor(db, receptionist, (tx) => adjust(tx, { delta: -1, operation })),
          /A16_PRODUCTO_NO_AUTORIZADO/,
        );
      }
      assert.deepEqual(await stockState(db), { stock: 24, movements: 1, audits: 1 });
    });

    await t.test('rechaza usuarios inactivos, otros roles, productos de otro hotel y sesiones anonimas', async () => {
      await seedProducts(db);
      for (const actor of [inactiveReceptionist, ids.actorWithoutPermission]) {
        await assert.rejects(asActor(db, actor, (tx) => adjust(tx)), /A16_PRODUCTO_NO_AUTORIZADO/);
      }
      await assert.rejects(
        asActor(db, receptionist, (tx) => adjust(tx, { product: ids.productB })),
        /A16_PRODUCTO_NO_AUTORIZADO/,
      );
      await assert.rejects(asActor(db, null, (tx) => adjust(tx)), /A16_AJUSTE_INVALIDO/);
      await assert.rejects(asActor(db, null, (tx) => adjust(tx), 'anon'), /permission denied/i);
      assert.deepEqual(await stockState(db), { stock: 0, movements: 0, audits: 0 });
    });

    await t.test('una denegacion individual de ingreso prevalece sobre el rol', async () => {
      await seedProducts(db);
      await db.exec(`
        insert into public.usuarios_permisos(usuario_id, permiso_id, permitido)
          select '${receptionist}', id, false from public.permisos where nombre = 'inventario.ingresar';
      `);
      try {
        await assert.rejects(asActor(db, receptionist, (tx) => adjust(tx)), /A16_PRODUCTO_NO_AUTORIZADO/);
        assert.deepEqual(await stockState(db), { stock: 0, movements: 0, audits: 0 });
      } finally {
        await db.exec('delete from public.usuarios_permisos');
      }
    });

    await t.test('administracion conserva sus ajustes anteriores aunque no tenga el nuevo permiso', async () => {
      await seedProducts(db);
      await db.exec(`
        delete from public.roles_permisos rp using public.roles r, public.permisos p
          where rp.rol_id = r.id and rp.permiso_id = p.id
            and r.nombre = 'Administrador' and p.nombre = 'inventario.ingresar';
      `);
      const add = await asActor(db, ids.actorA, (tx) => adjust(tx));
      const remove = await asActor(db, ids.actorA, (tx) => adjust(tx, { delta: -4, operation: operationId(3) }));
      assert.equal(add.stock_actual, 24);
      assert.equal(remove.stock_actual, 20);
      assert.deepEqual(await stockState(db), { stock: 20, movements: 2, audits: 2 });
    });
  } finally {
    await db.close();
  }
});
