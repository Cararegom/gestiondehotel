const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { database, asActor, callLiquidation, ids, latestFunction } = require('./helpers/c4-database.cjs');

async function insertReservation(db, {
  roomTotal = 100,
  paidTotal = 0,
  reservationId = ids.reservationA,
  hotelId = ids.hotelA,
} = {}) {
  await db.query(
    'insert into public.reservas(id, hotel_id, monto_total, monto_pagado) values ($1, $2, $3, $4)',
    [reservationId, hotelId, roomTotal, paidTotal],
  );
}

async function insertPayment(db, {
  id = ids.payment,
  reservationId = ids.reservationA,
  hotelId = ids.hotelA,
  actorId = ids.actorA,
  amount = 1,
  operationId = '10000000-0000-4000-8000-000000000001',
} = {}) {
  await db.query(
    `insert into public.pagos_reserva
      (id, hotel_id, reserva_id, monto, usuario_id, source, client_operation_id)
     values ($1, $2, $3, $4, $5, 'reservation_payment', $6)`,
    [id, hotelId, reservationId, amount, actorId, operationId],
  );
}

async function pendingStates(db) {
  const result = await db.query(`
    select 'service' as source, estado_pago, pago_reserva_id from public.servicios_x_reserva
    union all
    select 'store', estado_pago, pago_reserva_id from public.ventas_tienda
    union all
    select 'restaurant', estado_pago, pago_reserva_id from public.ventas_restaurante
    order by source
  `);
  return result.rows;
}

test('C4: un abono mínimo no puede liquidar consumos de mayor valor', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 100 });
    await insertPayment(db, { amount: 1 });
    await db.query(
      `insert into public.servicios_x_reserva
        (id, hotel_id, reserva_id, precio_cobrado, estado_pago)
       values ($1, $2, $3, 250, 'pendiente')`,
      [ids.service, ids.hotelA, ids.reservationA],
    );

    await assert.rejects(
      asActor(db, ids.actorA, (tx) => callLiquidation(tx)),
      /C4_PAGO_INSUFICIENTE.*deuda real/i,
    );
    const states = await db.query('select estado_pago, pago_reserva_id from public.servicios_x_reserva');
    assert.deepEqual(states.rows, [{ estado_pago: 'pendiente', pago_reserva_id: null }]);
  } finally {
    await db.close();
  }
});

test('C4: el pago acumulado que salda la cuenta permite liquidar aunque el último pago sea menor que los consumos', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 100, paidTotal: 150 });
    await insertPayment(db, {
      id: ids.priorPayment,
      amount: 140,
      operationId: '10000000-0000-4000-8000-000000000002',
    });
    await insertPayment(db, { amount: 10 });
    await db.query(
      `insert into public.servicios_x_reserva
        (id, hotel_id, reserva_id, precio_cobrado, estado_pago)
       values ($1, $2, $3, 50, 'pendiente')`,
      [ids.service, ids.hotelA, ids.reservationA],
    );

    await asActor(db, ids.actorA, async (tx) => {
      const result = await callLiquidation(tx);
      assert.equal(Number(result.total_cargos), 150);
      assert.equal(Number(result.total_pagos), 150);
      assert.equal(result.servicios, 1);
      assert.equal(result.idempotent, false);
    });
  } finally {
    await db.close();
  }
});

test('C4: tienda, restaurante y servicios quedan vinculados al pago validado', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 100, paidTotal: 200 });
    await insertPayment(db, { amount: 200 });
    await db.query(
      `insert into public.servicios_x_reserva values ($1, $2, $3, 25, 'pendiente', null)`,
      [ids.service, ids.hotelA, ids.reservationA],
    );
    await db.query(
      `insert into public.ventas_tienda
        (id, hotel_id, reserva_id, total_venta, estado_pago, pago_reserva_id)
       values ($1, $2, $3, 40, 'pendiente', null)`,
      [ids.storeSale, ids.hotelA, ids.reservationA],
    );
    await db.query(
      `insert into public.ventas_restaurante values ($1, $2, $3, 35, 35, 'pendiente', null)`,
      [ids.restaurantSale, ids.hotelA, ids.reservationA],
    );

    await asActor(db, ids.actorA, async (tx) => {
      const result = await callLiquidation(tx);
      assert.deepEqual(
        { servicios: result.servicios, tienda: result.ventas_tienda, restaurante: result.ventas_restaurante },
        { servicios: 1, tienda: 1, restaurante: 1 },
      );
      const states = await pendingStates(tx);
      assert.ok(states.every((row) => row.estado_pago === 'pagado'));
      assert.ok(states.every((row) => row.pago_reserva_id === ids.payment));
      const audit = await tx.query(
        `select after_data from public.auditoria_operaciones
         where accion = 'reserva.consumos_liquidar'`,
      );
      assert.equal(audit.rows.length, 1);
      assert.equal(Number(audit.rows[0].after_data.total_cargos), 200);
      assert.equal(Number(audit.rows[0].after_data.total_pagos), 200);
      assert.equal(Number(audit.rows[0].after_data.saldo_pendiente), 0);
    });
  } finally {
    await db.close();
  }
});

test('C4: un pago ya consumido no puede reutilizarse para cargos posteriores', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 100, paidTotal: 150 });
    await insertPayment(db, { amount: 150 });
    await db.query(
      `insert into public.servicios_x_reserva values ($1, $2, $3, 50, 'pendiente', null)`,
      [ids.service, ids.hotelA, ids.reservationA],
    );

    await asActor(db, ids.actorA, (tx) => callLiquidation(tx));
    const retry = await asActor(db, ids.actorA, (tx) => callLiquidation(tx));
    assert.equal(retry.idempotent, true);
    assert.equal(retry.servicios, 0);
    await db.query(
      `insert into public.servicios_x_reserva values ($1, $2, $3, 20, 'pendiente', null)`,
      [ids.laterService, ids.hotelA, ids.reservationA],
    );
    await assert.rejects(
      asActor(db, ids.actorA, (tx) => callLiquidation(tx)),
      /C4_PAGO_INSUFICIENTE/i,
    );
    const later = await db.query(
      'select estado_pago, pago_reserva_id from public.servicios_x_reserva where id = $1',
      [ids.laterService],
    );
    assert.deepEqual(later.rows, [{ estado_pago: 'pendiente', pago_reserva_id: null }]);
  } finally {
    await db.close();
  }
});

test('C4: cobros directos de tienda no se cobran de nuevo en la cuenta de la reserva', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 100, paidTotal: 100 });
    await insertPayment(db, { amount: 100 });
    await db.query(
      `insert into public.ventas_tienda
        (id, hotel_id, reserva_id, total_venta, estado_pago, pago_reserva_id)
       values ($1, $2, $3, 40, 'pendiente', null)`,
      [ids.storeSale, ids.hotelA, ids.reservationA],
    );
    await db.query(
      `insert into public.caja(id, hotel_id, tipo, monto, venta_tienda_id)
       values ($1, $2, 'ingreso', 40, $3)`,
      [ids.cash, ids.hotelA, ids.storeSale],
    );

    await asActor(db, ids.actorA, async (tx) => {
      const result = await callLiquidation(tx);
      assert.equal(Number(result.deuda_cobrable), 100);
      assert.equal(Number(result.pago_externo_tienda), 40);
      assert.equal(result.ventas_tienda, 1);
    });
  } finally {
    await db.close();
  }
});

test('C4: actor y pago de otro hotel son rechazados sin cambiar consumos', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 0 });
    await insertPayment(db, { amount: 100 });
    await insertPayment(db, {
      id: ids.foreignPayment,
      reservationId: ids.reservationB,
      hotelId: ids.hotelB,
      actorId: ids.actorB,
      amount: 100,
      operationId: '10000000-0000-4000-8000-000000000003',
    });
    await db.query(
      `insert into public.servicios_x_reserva values ($1, $2, $3, 50, 'pendiente', null)`,
      [ids.service, ids.hotelA, ids.reservationA],
    );

    await assert.rejects(
      asActor(db, ids.actorB, (tx) => callLiquidation(tx)),
      /Reserva fuera del hotel autorizado/i,
    );
    await assert.rejects(
      asActor(db, ids.actorA, (tx) => callLiquidation(tx, ids.reservationA, ids.foreignPayment)),
      /pago no corresponde a esta reserva o usuario/i,
    );
    const states = await db.query('select estado_pago from public.servicios_x_reserva');
    assert.deepEqual(states.rows, [{ estado_pago: 'pendiente' }]);
  } finally {
    await db.close();
  }
});

test('C4: una llamada sin usuario autenticado se rechaza', async () => {
  const { db } = await database();
  try {
    await insertReservation(db, { roomTotal: 0 });
    await insertPayment(db, { amount: 100 });
    await assert.rejects(
      asActor(db, null, (tx) => callLiquidation(tx)),
      /Autenticacion, reserva y pago son obligatorios/i,
    );
  } finally {
    await db.close();
  }
});

test('C4: la migración conserva el límite de confianza y bloquea exactamente las filas validadas', () => {
  const rpc = latestFunction('liquidar_consumos_reserva_atomico');
  const source = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', rpc.migration), 'utf8');
  assert.match(rpc.migration, /_c4_liquidar_consumos_monto_seguro\.sql$/);
  assert.match(source, /SECURITY DEFINER[\s\S]*SET search_path\s*=\s*pg_catalog,\s*public/i);
  assert.match(source, /C4_PAGO_INSUFICIENTE/);
  assert.match(source, /FOR UPDATE/gi);
  assert.match(source, /id\s*=\s*ANY\s*\(v_servicios_pendientes\)/i);
  assert.match(source, /id\s*=\s*ANY\s*\(v_tienda_pendientes\)/i);
  assert.match(source, /id\s*=\s*ANY\s*\(v_restaurante_pendientes\)/i);
  assert.match(source, /ADD COLUMN IF NOT EXISTS pago_reserva_id uuid/i);
  assert.match(source, /pagos_reserva_hotel_reserva_id_idx/i);
  assert.match(source, /servicios_reserva_hotel_reserva_id_idx/i);
  assert.match(source, /caja_hotel_venta_tienda_id_idx/i);
  assert.match(source, /caja_hotel_venta_restaurante_id_idx/i);
  assert.match(source, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC,\s*anon/i);
  assert.match(source, /GRANT EXECUTE ON FUNCTION[\s\S]*TO authenticated,\s*service_role/i);
});
