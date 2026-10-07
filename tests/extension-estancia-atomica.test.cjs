const test = require('node:test');
const assert = require('node:assert/strict');
const { database, reset, asActor, extend, state, ids, id, migration } = require('./helpers/extension-database.cjs');

test('extension de estancia: cobro y operacion completa sin duplicados', async (t) => {
  const db = await database();
  const run = (options, actor=ids.actor) => asActor(db,actor,(tx)=>extend(tx,options));
  try {
    await t.test('el reintento devuelve los mismos IDs y conserva un pago, servicio y cronometro', async () => {
      await reset(db);
      const first = await run();
      const before = await state(db);
      const retry = await run({occurredAt:'2026-10-07T19:33:00Z'});
      assert.equal(retry.idempotent,true);
      assert.deepEqual(retry.pagos,first.pagos);
      assert.equal(retry.servicio_id,first.servicio_id);
      assert.deepEqual(await state(db),before);
      assert.deepEqual(before,{ payments:1,movements:1,revenue:'60000',services:1,timers:1,
        extensions:1,paid:'60000',checkout:'2026-10-08 17:00:00+00' });
      const clocks=await db.query('select fecha_fin::text as end from public.cronometros where activo');
      assert.equal(clocks.rows[0].end,before.checkout);
    });
    await t.test('rechaza un segundo UUID con la fecha anterior ya usada antes de cobrar', async () => {
      await reset(db);
      await run();
      const before=await state(db);
      await assert.rejects(run({operation:id(61)}),/EXTENSION_ESTANCIA_CAMBIO/);
      assert.deepEqual(await state(db),before);
    });
    await t.test('otra extension legitima del mismo importe se registra con la nueva fecha base', async () => {
      await reset(db);
      await run();
      await run({operation:id(61),previous:'2026-10-08T17:00:00Z',next:'2026-10-09T17:00:00Z'});
      const current=await state(db);
      assert.equal(current.revenue,'120000');
      assert.equal(current.services,2);
      assert.equal(current.checkout,'2026-10-09 17:00:00+00');
    });
    await t.test('un fallo tardio de cronometro revierte todos los cobros y el reintento puede completar', async () => {
      await reset(db);
      const before=await state(db);
      await db.exec(`create function public.test_timer_failure() returns trigger language plpgsql as $$
        begin raise exception 'timer unavailable'; end $$;
        create trigger test_timer_failure before update on public.cronometros
          for each row execute function public.test_timer_failure();`);
      await assert.rejects(run(),/timer unavailable/);
      assert.deepEqual(await state(db),before);
      await db.exec('drop trigger test_timer_failure on public.cronometros');
      await run();
      assert.equal((await state(db)).movements,1);
    });
    await t.test('el pago mixto se confirma entero y su reintento no repite ninguna parte', async () => {
      await reset(db);
      const options={payments:[{metodo_pago_id:ids.method,monto:20000},
        {metodo_pago_id:ids.secondMethod,monto:40000}]};
      const first=await run(options);
      const retry=await run(options);
      assert.deepEqual(first.pagos,retry.pagos);
      const current=await state(db);
      assert.equal(current.payments,2);
      assert.equal(current.movements,2);
      assert.equal(current.services,1);
      assert.equal(current.paid,'60000');
    });
    await t.test('metodo extranjero o inactivo, importes incompletos y turno cerrado no dejan cobros', async () => {
      await reset(db);
      const before=await state(db);
      for (const options of [
        {payments:[{metodo_pago_id:ids.method,monto:20000},{metodo_pago_id:ids.foreignMethod,monto:40000}]},
        {payments:[{metodo_pago_id:ids.method,monto:20000}]},
        {amount:-1,payments:[]}, {next:'2026-10-07T17:00:00Z'}
      ]) await assert.rejects(run(options));
      await db.exec(`update public.metodos_pago set activo=false where id='${ids.method}'`);
      await assert.rejects(run(),/Metodo de pago invalido/);
      await db.exec(`update public.metodos_pago set activo=true;
        update public.turnos set estado='cerrado',fecha_cierre=now()`);
      await assert.rejects(run(),/Turno activo propio/);
      assert.deepEqual(await state(db),before);
    });
    await t.test('anonimos, otro hotel, recepcionista inactiva y cambio de payload no pueden repetir una operacion', async () => {
      await reset(db);
      await assert.rejects(run({},null),/permission denied/);
      await assert.rejects(run({},ids.foreignActor),/A14_RESERVA_NO_AUTORIZADA/);
      await db.exec(`update public.usuarios set activo=false where id='${ids.actor}'`);
      await assert.rejects(run(),/A14_RESERVA_NO_AUTORIZADA/);
      await db.exec(`update public.usuarios set activo=true`);
      await run();
      const before=await state(db);
      await assert.rejects(run({},ids.secondActor),/EXTENSION_OPERACION_NO_AUTORIZADA/);
      await assert.rejects(run({amount:70000,payments:[{metodo_pago_id:ids.method,monto:70000}]}),/EXTENSION_OPERACION_NO_AUTORIZADA/);
      assert.deepEqual(await state(db),before);
    });
    await t.test('una extension sin cobro crea servicio y estancia pero ningun movimiento', async () => {
      await reset(db);
      await run({amount:0,payments:[],shift:null});
      const current=await state(db);
      assert.equal(current.payments,0);
      assert.equal(current.movements,0);
      assert.equal(current.services,1);
      assert.equal(current.checkout,'2026-10-08 17:00:00+00');
    });
    await t.test('los clientes antiguos deben recargar antes de cobrar una extension por pasos', async () => {
      await reset(db);
      await assert.rejects(asActor(db,ids.actor,(tx)=>tx.query(
        'select public.procesar_pago_reserva_atomico($1,$2,$3,$4,$5,$6,$7)',
        [ids.reservation,60000,ids.method,ids.shift,id(70),'2026-10-07T19:30:00Z',
          'Pago por extensión: 1 noche(s) adicional(es) - Cliente: Prueba']
      )),/Recarga la aplicacion/);
      assert.equal((await state(db)).movements,0);
    });
    await t.test('los abonos normales mantienen idempotencia y rechazan reutilizar el UUID para otro monto', async () => {
      await reset(db);
      const payment=(amount=60000)=>asActor(db,ids.actor,(tx)=>tx.query(
        'select public.procesar_pago_reserva_atomico($1,$2,$3,$4,$5,$6,$7) as result',
        [ids.reservation,amount,ids.method,ids.shift,id(71),'2026-10-07T19:30:00Z','Abono Reserva']
      ));
      const first=await payment();
      const retry=await payment();
      assert.equal(first.rows[0].result.pago_id,retry.rows[0].result.pago_id);
      assert.equal(retry.rows[0].result.monto_pagado,60000);
      await assert.rejects(payment(70000),/ya fue usada con otros datos/);
      assert.equal((await state(db)).movements,1);
    });
    await t.test('un pago de reserva no puede generar dos ingresos aunque se inserte caja otra vez', async () => {
      await reset(db);
      await run();
      await assert.rejects(db.exec(`insert into public.caja(hotel_id,pago_reserva_id,tipo,source,monto)
        select hotel_id,pago_reserva_id,tipo,source,monto from public.caja`),/duplicate key/);
      assert.equal((await state(db)).movements,1);
    });
    await t.test('la migracion se puede aplicar de nuevo sin cambiar los cobros existentes', async () => {
      const before=await state(db);
      await db.exec(migration);
      assert.deepEqual(await state(db),before);
    });
  } finally { await db.close(); }
});
