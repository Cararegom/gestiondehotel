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
} = require('./helpers/c5-database.cjs');

const operationId = (value) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;

async function seedProduct(db, {
  productId = ids.productA,
  hotelId = ids.hotelA,
  stock = 10,
  catalogPrice = 18,
} = {}) {
  await db.query(
    `insert into public.productos_tienda
      (id, hotel_id, nombre, precio, precio_venta, stock_actual, activo)
     values ($1, $2, 'Agua', 10, $3, $4, true)`,
    [productId, hotelId, catalogPrice, stock],
  );
}

async function seedPos(db) {
  await seedProduct(db);
  await db.query(
    `insert into public.turnos(id, hotel_id, usuario_id, estado)
     values ($1, $2, $3, 'abierto')`,
    [ids.turnA, ids.hotelA, ids.actorA],
  );
  await db.query(
    `insert into public.metodos_pago(id, hotel_id, activo) values ($1, $2, true)`,
    [ids.paymentMethodA, ids.hotelA],
  );
}

async function sell(db, {
  quantity = 2,
  payment = 36,
  payments = null,
  operation = operationId(1),
} = {}) {
  const result = await db.query(
    `select public.procesar_venta_tienda_atomica(
      $1::jsonb, $2::jsonb, 'inmediato', $3, $4,
      null, null, null, null, '2026-09-18T15:00:00Z'
    ) as result`,
    [
      JSON.stringify([{ producto_id: ids.productA, cantidad: quantity, precio_unitario: 1 }]),
      JSON.stringify(payments || [{ metodo_pago_id: ids.paymentMethodA, monto: payment }]),
      ids.turnA,
      operation,
    ],
  );
  return result.rows[0].result;
}

async function adjust(db, {
  productId = ids.productA,
  delta,
  reason = 'Conteo fisico',
  operation,
} = {}) {
  const result = await db.query(
    'select public.ajustar_stock_tienda_seguro($1, $2, $3, $4) as result',
    [productId, delta, reason, operation],
  );
  return result.rows[0].result;
}

test('A15: POS y pedido web comparten un nucleo de venta atomico', async (t) => {
  const { db } = await database();
  try {
    await t.test('el POS ignora precios del cliente y confirma venta, stock, caja y auditoria juntos', async () => {
      await resetData(db);
      await seedPos(db);

      const first = await asActor(db, ids.actorA, (tx) => sell(tx));
      assert.equal(first.idempotent, false);
      assert.equal(first.total, 36);

      const state = await db.query(`
        select
          (select count(*)::int from public.ventas_tienda) as sales,
          (select count(*)::int from public.detalle_ventas_tienda) as details,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.caja) as cash_entries,
          (select count(*)::int from public.auditoria_operaciones) as audits,
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
          (select precio_unitario_venta from public.detalle_ventas_tienda limit 1) as detail_price,
          (select total_venta from public.ventas_tienda limit 1) as sale_total,
          (select source from public.ventas_tienda limit 1) as source
      `);
      assert.deepEqual(state.rows[0], {
        sales: 1,
        details: 1,
        movements: 1,
        cash_entries: 1,
        audits: 1,
        stock: 8,
        detail_price: '18',
        sale_total: '36.00',
        source: 'store_atomic',
      });

      const retry = await asActor(db, ids.actorA, (tx) => sell(tx));
      assert.equal(retry.idempotent, true);
      assert.equal(retry.venta_id, first.venta_id);
      const counts = await db.query(`
        select
          (select count(*)::int from public.ventas_tienda) as sales,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.caja) as cash_entries,
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock
      `);
      assert.deepEqual(counts.rows[0], { sales: 1, movements: 1, cash_entries: 1, stock: 8 });
    });

    await t.test('stock insuficiente y pagos inconsistentes revierten la venta completa', async () => {
      await resetData(db);
      await seedPos(db);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => sell(tx, { quantity: 11, payment: 198, operation: operationId(2) })),
        /A15_STOCK_INSUFICIENTE/i,
      );
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => sell(tx, { quantity: 2, payment: 1, operation: operationId(3) })),
        /A15_TOTAL_PAGOS_NO_COINCIDE/i,
      );
      const state = await db.query(`
        select
          (select count(*)::int from public.ventas_tienda) as sales,
          (select count(*)::int from public.detalle_ventas_tienda) as details,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.caja) as cash_entries,
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock
      `);
      assert.deepEqual(state.rows[0], { sales: 0, details: 0, movements: 0, cash_entries: 0, stock: 10 });
    });

    await t.test('consolida un metodo de pago repetido antes de escribir caja', async () => {
      await resetData(db);
      await seedPos(db);
      const result = await asActor(db, ids.actorA, (tx) => sell(tx, {
        operation: operationId(4),
        payments: [
          { metodo_pago_id: ids.paymentMethodA, monto: 10 },
          { metodo_pago_id: ids.paymentMethodA, monto: 26 },
        ],
      }));
      assert.equal(result.total, 36);
      const cash = await db.query('select metodo_pago_id, monto from public.caja');
      assert.deepEqual(cash.rows, [{ metodo_pago_id: ids.paymentMethodA, monto: '36.00' }]);
    });
  } finally {
    await db.close();
  }
});

test('A16: ajustes manuales de inventario son atomicos e idempotentes', async (t) => {
  const { db } = await database();
  try {
    await t.test('encadena ajustes sobre el stock confirmado y no repite una operacion', async () => {
      await resetData(db);
      await seedProduct(db);
      const add = await asActor(db, ids.actorA, (tx) => adjust(tx, {
        delta: 5,
        operation: operationId(10),
      }));
      const remove = await asActor(db, ids.actorA, (tx) => adjust(tx, {
        delta: -3,
        reason: 'Merma confirmada',
        operation: operationId(11),
      }));
      const retry = await asActor(db, ids.actorA, (tx) => adjust(tx, {
        delta: -3,
        reason: 'Merma confirmada',
        operation: operationId(11),
      }));

      assert.deepEqual(
        [add.stock_anterior, add.stock_actual, remove.stock_anterior, remove.stock_actual],
        [10, 15, 15, 12],
      );
      assert.equal(retry.idempotent, true);
      assert.equal(retry.movimiento_id, remove.movimiento_id);

      const state = await db.query(`
        select
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.auditoria_operaciones) as audits
      `);
      assert.deepEqual(state.rows[0], { stock: 12, movements: 2, audits: 2 });
      const trail = await db.query(`
        select tipo_movimiento, cantidad, stock_anterior, stock_nuevo
        from public.movimientos_inventario order by id
      `);
      assert.deepEqual(trail.rows, [
        { tipo_movimiento: 'INGRESO', cantidad: 5, stock_anterior: 10, stock_nuevo: 15 },
        { tipo_movimiento: 'SALIDA', cantidad: 3, stock_anterior: 15, stock_nuevo: 12 },
      ]);
    });

    await t.test('rechaza stock negativo y actores sin permiso sin efectos parciales', async () => {
      await resetData(db);
      await seedProduct(db);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => adjust(tx, { delta: -11, operation: operationId(12) })),
        /A16_STOCK_INSUFICIENTE/i,
      );
      await assert.rejects(
        asActor(db, ids.actorWithoutPermission, (tx) => adjust(tx, { delta: 1, operation: operationId(13) })),
        /A16_PRODUCTO_NO_AUTORIZADO/i,
      );
      const state = await db.query(`
        select
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.auditoria_operaciones) as audits
      `);
      assert.deepEqual(state.rows[0], { stock: 10, movements: 0, audits: 0 });
    });

    await t.test('un fallo al registrar el movimiento revierte tambien el stock', async () => {
      await resetData(db);
      await seedProduct(db);
      await db.exec(`
        create or replace function public.a16_test_fail_movement()
        returns trigger language plpgsql as $$
        begin
          if new.razon = 'Forzar rollback' then
            raise exception 'A16_TEST_MOVEMENT_FAILURE';
          end if;
          return new;
        end $$;
        create trigger a16_test_fail_movement
        before insert on public.movimientos_inventario
        for each row execute function public.a16_test_fail_movement();
      `);
      await assert.rejects(
        asActor(db, ids.actorA, (tx) => adjust(tx, {
          delta: 5,
          reason: 'Forzar rollback',
          operation: operationId(14),
        })),
        /A16_TEST_MOVEMENT_FAILURE/i,
      );
      const state = await db.query(`
        select
          (select stock_actual from public.productos_tienda where id = '${ids.productA}') as stock,
          (select count(*)::int from public.movimientos_inventario) as movements,
          (select count(*)::int from public.auditoria_operaciones) as audits
      `);
      assert.deepEqual(state.rows[0], { stock: 10, movements: 0, audits: 0 });
      await db.exec('drop trigger a16_test_fail_movement on public.movimientos_inventario');
    });
  } finally {
    await db.close();
  }
});

test('A15/A16: contratos SQL, privilegios y frontend', async () => {
  const { db } = await database();
  try {
    const privileges = await db.query(`
      select
        has_function_privilege(
          'authenticated',
          'public.tienda_crear_venta_atomica_core(uuid,uuid,jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,text,text,numeric,timestamptz)',
          'EXECUTE'
        ) as core_authenticated,
        has_function_privilege(
          'authenticated',
          'public.procesar_venta_tienda_atomica(jsonb,jsonb,text,uuid,uuid,uuid,uuid,text,uuid,timestamptz)',
          'EXECUTE'
        ) as pos_authenticated,
        has_function_privilege(
          'authenticated',
          'public.ajustar_stock_tienda_seguro(uuid,integer,text,uuid)',
          'EXECUTE'
        ) as adjust_authenticated
    `);
    assert.deepEqual(privileges.rows[0], {
      core_authenticated: false,
      pos_authenticated: true,
      adjust_authenticated: true,
    });
  } finally {
    await db.close();
  }

  const migration = latestFunction('procesar_venta_tienda_atomica');
  assert.match(migration.migration, /_a15_a16_tienda_inventario_atomico\.sql$/);
  const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', migration.migration), 'utf8');
  assert.match(sql, /ORDER BY p\.id\s+FOR UPDATE OF p/i);
  assert.match(sql, /'catalogo'[\s\S]*'store_atomic'/i);
  assert.match(sql, /'congelado'[\s\S]*'store_web_order'/i);
  assert.match(sql, /SELECT \* INTO v_producto[\s\S]*FOR UPDATE/i);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.tienda_crear_venta_atomica_core[\s\S]*authenticated/i);

  const inventory = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'modules', 'tienda', 'inventario.js'),
    'utf8',
  );
  const start = inventory.indexOf('async function saveMovimiento');
  const end = inventory.indexOf('\nfunction mostrarOpcionesHojaConteo', start);
  const saveMovement = inventory.slice(start, end);
  assert.match(saveMovement, /rpc\('ajustar_stock_tienda_seguro'/);
  assert.match(saveMovement, /getStableOperationId\(operationScope\)/);
  assert.match(saveMovement, /completeStableOperation\(operationScope\)/);
  assert.doesNotMatch(saveMovement, /\.from\(['"]movimientos_inventario['"]\)/);
  assert.doesNotMatch(saveMovement, /\.from\(['"]productos_tienda['"]\)[\s\S]*\.update\(/);
});
