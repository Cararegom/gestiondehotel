const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  asActor,
  database,
  ids,
  latestFunction,
  resetData,
  seedOrder,
  seedReservation,
  updateOrder,
} = require('./helpers/c5-database.cjs');

async function counts(db) {
  const result = await db.query(`
    select
      (select count(*)::int from public.ventas_tienda) as sales,
      (select count(*)::int from public.detalle_ventas_tienda) as details,
      (select count(*)::int from public.movimientos_inventario) as movements,
      (select count(*)::int from public.auditoria_operaciones) as audits,
      (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
      (select estado from public.tienda_pedidos_web where id = '${ids.orderA}') as order_state
  `);
  return result.rows[0];
}

test('C5: entrega segura de pedidos web', async (t) => {
  const { db, migration } = await database();
  try {
    await t.test('rechaza la entrega sin reserva activa y no modifica venta ni inventario', async () => {
      await resetData(db);
      await seedOrder(db);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => updateOrder(tx)),
        /C5_RESERVA_ACTIVA_REQUERIDA/i,
      );
      assert.deepEqual(await counts(db), {
        sales: 0, details: 0, movements: 0, audits: 0, stock: 10, order_state: 'pendiente',
      });
    });

    for (const activeState of ['activa', 'ocupada', 'tiempo agotado']) {
      await t.test(`permite ${activeState} y enlaza la venta con la reserva`, async () => {
        await resetData(db);
        await seedOrder(db);
        await seedReservation(db, activeState);
        const result = await asActor(db, ids.actorA, (tx) => updateOrder(tx));
        assert.equal(result.success, true);
        assert.equal(result.idempotent, false);
        assert.equal(result.reserva_id, ids.reservationA);

        const sale = await db.query(`
          select v.reserva_id, v.total_venta, v.estado_pago, v.source, v.client_operation_id,
                 d.precio_unitario_venta, d.subtotal
          from public.ventas_tienda v
          join public.detalle_ventas_tienda d on d.venta_id = v.id
        `);
        assert.deepEqual(sale.rows, [{
          reserva_id: ids.reservationA,
          total_venta: '30.00',
          estado_pago: 'pendiente',
          source: 'store_web_order',
          client_operation_id: ids.orderA,
          precio_unitario_venta: '15.00',
          subtotal: '30.00',
        }]);
        const movement = await db.query(
          'select tipo_movimiento, cantidad, razon, stock_anterior, stock_nuevo, notas from public.movimientos_inventario',
        );
        assert.equal(movement.rows.length, 1);
        assert.deepEqual(
          { ...movement.rows[0], notas: movement.rows[0].notas.includes(ids.orderA) },
          {
            tipo_movimiento: 'SALIDA', cantidad: 2, razon: 'venta_tienda_pedido_web',
            stock_anterior: 10, stock_nuevo: 8, notas: true,
          },
        );
        assert.deepEqual(await counts(db), {
          sales: 1, details: 1, movements: 1, audits: 1, stock: 8, order_state: 'entregado',
        });
      });
    }

    await t.test('no trata check_in ni una reserva cerrada como estancia activa', async () => {
      for (const inactiveState of ['check_in', 'completada']) {
        await resetData(db);
        await seedOrder(db);
        await seedReservation(db, inactiveState);
        await assert.rejects(
          asActor(db, ids.actorA, (tx) => updateOrder(tx)),
          /C5_RESERVA_ACTIVA_REQUERIDA/i,
        );
        assert.equal((await counts(db)).stock, 10);
      }
    });

    await t.test('un reintento de entrega es idempotente y no descuenta dos veces', async () => {
      await resetData(db);
      await seedOrder(db);
      await seedReservation(db);
      const first = await asActor(db, ids.actorA, (tx) => updateOrder(tx));
      const retry = await asActor(db, ids.actorA, (tx) => updateOrder(tx));
      assert.equal(first.idempotent, false);
      assert.equal(retry.idempotent, true);
      assert.equal(retry.venta_tienda_id, first.venta_tienda_id);
      assert.deepEqual(await counts(db), {
        sales: 1, details: 1, movements: 1, audits: 1, stock: 8, order_state: 'entregado',
      });
    });

    await t.test('stock insuficiente revierte toda la entrega', async () => {
      await resetData(db);
      await seedOrder(db, { stock: 1 });
      await seedReservation(db);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => updateOrder(tx)),
        /C5_STOCK_INSUFICIENTE/i,
      );
      assert.deepEqual(await counts(db), {
        sales: 0, details: 0, movements: 0, audits: 0, stock: 1, order_state: 'pendiente',
      });
    });

    await t.test('rechaza actor de otro hotel, actor sin permiso y suplantacion de usuario', async () => {
      await resetData(db);
      await seedOrder(db);
      await seedReservation(db);
      await assert.rejects(
        asActor(db, ids.actorB, (tx) => updateOrder(tx, 'entregado', { userId: ids.actorB })),
        /C5_PEDIDO_NO_AUTORIZADO/i,
      );
      await assert.rejects(
        asActor(db, ids.actorWithoutPermission, (tx) => updateOrder(tx, 'entregado', { userId: ids.actorWithoutPermission })),
        /C5_SIN_PERMISO_TIENDA/i,
      );
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => updateOrder(tx, 'entregado', { userId: ids.actorB })),
        /C5_USUARIO_NO_COINCIDE/i,
      );
      assert.deepEqual(await counts(db), {
        sales: 0, details: 0, movements: 0, audits: 0, stock: 10, order_state: 'pendiente',
      });
    });

    await t.test('rechaza una llamada anonima y productos movidos a otro hotel', async () => {
      await resetData(db);
      await seedOrder(db);
      await seedReservation(db);
      await assert.rejects(
        asActor(db, null, (tx) => updateOrder(tx)),
        /C5_AUTENTICACION_REQUERIDA/i,
      );
      await db.query('update public.productos_tienda set hotel_id = $1 where id = $2', [ids.hotelB, ids.productA]);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => updateOrder(tx)),
        /C5_PRODUCTO_NO_AUTORIZADO/i,
      );
      assert.deepEqual(await counts(db), {
        sales: 0, details: 0, movements: 0, audits: 0, stock: 10, order_state: 'pendiente',
      });
    });

    await t.test('aceptar y preparar no crean venta ni descuentan stock', async () => {
      await resetData(db);
      await seedOrder(db);
      await asActor(db, ids.actorA, (tx) => updateOrder(tx, 'aceptado'));
      await asActor(db, ids.actorA, (tx) => updateOrder(tx, 'preparando'));
      assert.deepEqual(await counts(db), {
        sales: 0, details: 0, movements: 0, audits: 0, stock: 10, order_state: 'preparando',
      });
    });

    assert.match(migration, /_(?:c5_pedidos_web_entrega_segura|a15_a16_tienda_inventario_atomico)\.sql$/);
  } finally {
    await db.close();
  }
});

test('C5: contrato SQL, CMV y UI de entrega', () => {
  const rpc = latestFunction('actualizar_estado_pedido_web_tienda');
  const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', rpc.migration);
  const sql = fs.readFileSync(migrationPath, 'utf8');
  const c5Sql = fs.readFileSync(path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260910044500_c5_pedidos_web_entrega_segura.sql',
  ), 'utf8');
  const ui = fs.readFileSync(path.join(__dirname, '..', 'js/modules/tienda/pedidos-web.js'), 'utf8');
  assert.match(rpc.migration, /_a15_a16_tienda_inventario_atomico\.sql$/);
  assert.match(sql, /SECURITY DEFINER[\s\S]*SET search_path\s*=\s*pg_catalog,\s*public/i);
  assert.match(sql, /fase1_actor_tiene_permiso\([^)]*'tienda\.operar'\)/i);
  assert.match(sql, /estado(?:::text)?\s+IN\s*\('activa',\s*'ocupada',\s*'tiempo agotado'\)/i);
  assert.doesNotMatch(sql, /estado\s+IN\s*\([^)]*'check_in'/i);
  assert.match(sql, /tienda_crear_venta_atomica_core/i);
  assert.match(sql, /'congelado'[\s\S]*'store_web_order'/i);
  assert.match(sql, /ORDER BY p\.id[\s\S]*FOR UPDATE OF p/i);
  assert.match(sql, /razon[\s\S]*'venta_tienda_pedido_web'/i);
  assert.match(c5Sql, /coalesce\(NEW\.razon,\s*''\)[\s\S]*'venta_tienda_pedido_web'/i);
  assert.match(sql, /v_pedido\.id,[\s\S]*v_reserva_id,[\s\S]*v_pedido\.habitacion_id/i);
  assert.match(sql, /p_client_operation_id,[\s\S]*public\.fase1_business_date/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,\s*anon/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated/i);
  assert.match(ui, /Se verificara que la habitacion tenga una reserva activa/i);
});
