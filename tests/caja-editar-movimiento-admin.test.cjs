const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20261006120000_caja_editar_movimiento_admin.sql'),
  'utf8',
);
const movimientosSource = fs.readFileSync(path.join(root, 'js/modules/caja/caja-movimientos.js'), 'utf8');

const id = (value) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const ids = {
  hotel: id(1),
  otherHotel: id(2),
  admin: id(10),
  recepcion: id(11),
  adminRoleUser: id(12),
  otherAdmin: id(13),
  rolAdmin: id(15),
  turno: id(20),
  turnoCerrado: id(21),
  cash: id(30),
  bank: id(31),
  inactive: id(32),
  foreignMethod: id(33),
  apertura: id(40),
  ingreso: id(41),
  egreso: id(42),
  reservaPago: id(43),
  conciliado: id(44),
  revertido: id(45),
  reversion: id(46),
  cerradoMov: id(47),
  legacySinLedger: id(48),
};

const hoursAgo = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
const OPEN_AT = hoursAgo(3);
const EDIT_AT = hoursAgo(1);
const BEFORE_OPEN = hoursAgo(4);

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
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated, service_role;

    create type public.tipo_movimiento_caja_enum as enum ('ajuste', 'apertura', 'cierre', 'egreso', 'ingreso');

    create table public.usuarios(id uuid primary key, hotel_id uuid not null, rol text, activo boolean default true);
    create table public.roles(id uuid primary key, nombre text not null);
    create table public.usuarios_roles(
      usuario_id uuid not null, rol_id uuid not null, hotel_id uuid not null, creado_en timestamptz default now()
    );
    create table public.financial_accounts(
      id uuid primary key default gen_random_uuid(), hotel_id uuid not null, name text not null, unique(hotel_id, name)
    );
    create table public.metodos_pago(
      id uuid primary key, hotel_id uuid not null, nombre text not null, activo boolean default true,
      financial_account_id uuid references public.financial_accounts(id)
    );
    create table public.turnos(
      id uuid primary key, hotel_id uuid not null, usuario_id uuid not null, estado text not null,
      fecha_apertura timestamptz not null, fecha_cierre timestamptz
    );
    create table public.caja(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      tipo public.tipo_movimiento_caja_enum not null,
      monto numeric not null check (monto > 0),
      concepto text not null,
      fecha_movimiento timestamptz default now(),
      metodo_pago_id uuid references public.metodos_pago(id),
      usuario_id uuid,
      reserva_id uuid,
      pago_reserva_id uuid,
      venta_tienda_id uuid,
      venta_restaurante_id uuid,
      venta_terraza_id uuid,
      reserva_terraza_id uuid,
      compra_tienda_id uuid,
      turno_id uuid references public.turnos(id),
      original_movement_id uuid references public.caja(id),
      source text,
      business_date date,
      creado_en timestamptz default now(),
      actualizado_en timestamptz default now()
    );
    create table public.caja_reversiones(
      id uuid primary key default gen_random_uuid(),
      original_movement_id uuid not null references public.caja(id),
      reversal_movement_id uuid not null references public.caja(id)
    );
    create table public.terraza_reservas(id uuid primary key default gen_random_uuid(), caja_anticipo_id uuid);
    create table public.expense_payments(id uuid primary key default gen_random_uuid(), caja_id uuid);
    create table public.bank_payment_allocations(id uuid primary key default gen_random_uuid(), caja_id uuid);
    create table public.account_movements(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null,
      account_id uuid not null references public.financial_accounts(id),
      direction text not null check (direction in ('in', 'out')),
      amount numeric not null check (amount > 0),
      occurred_at timestamptz not null,
      business_date date not null,
      description text not null,
      source text not null,
      caja_id uuid unique references public.caja(id),
      metodo_pago_id uuid
    );
    create table public.auditoria_operaciones(
      id uuid primary key default gen_random_uuid(),
      hotel_id uuid not null, actor_id uuid not null, accion text not null, entidad text not null,
      entity_id uuid, before_data jsonb, after_data jsonb, reason text, client_operation_id uuid
    );

    create function public.hotel_business_date(p_hotel_id uuid, p_instant timestamptz)
    returns date language sql stable as $$ select (p_instant at time zone 'America/Bogota')::date $$;

    create function public.fase2_ensure_method_account(p_method_id uuid, p_hotel_id uuid, p_actor uuid)
    returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
    declare v_method public.metodos_pago%rowtype; v_account uuid;
    begin
      select * into v_method from public.metodos_pago where id = p_method_id and hotel_id = p_hotel_id;
      if not found then raise exception 'Metodo de pago fuera del hotel'; end if;
      if v_method.financial_account_id is not null then return v_method.financial_account_id; end if;
      insert into public.financial_accounts(hotel_id, name) values (p_hotel_id, 'Cuenta ' || v_method.nombre)
      on conflict(hotel_id, name) do update set name = excluded.name returning id into v_account;
      update public.metodos_pago set financial_account_id = v_account where id = v_method.id;
      return v_account;
    end $$;

    insert into public.roles(id, nombre) values ('${ids.rolAdmin}', 'Administrador');
    insert into public.usuarios(id, hotel_id, rol) values
      ('${ids.admin}', '${ids.hotel}', 'admin'),
      ('${ids.recepcion}', '${ids.hotel}', 'recepcionista'),
      ('${ids.adminRoleUser}', '${ids.hotel}', 'recepcionista'),
      ('${ids.otherAdmin}', '${ids.otherHotel}', 'admin');
    insert into public.usuarios_roles(usuario_id, rol_id, hotel_id) values ('${ids.adminRoleUser}', '${ids.rolAdmin}', '${ids.hotel}');
    insert into public.metodos_pago(id, hotel_id, nombre, activo) values
      ('${ids.cash}', '${ids.hotel}', 'Efectivo', true),
      ('${ids.bank}', '${ids.hotel}', 'Bancolombia', true),
      ('${ids.inactive}', '${ids.hotel}', 'Antiguo', false),
      ('${ids.foreignMethod}', '${ids.otherHotel}', 'Efectivo', true);
    insert into public.turnos(id, hotel_id, usuario_id, estado, fecha_apertura, fecha_cierre) values
      ('${ids.turno}', '${ids.hotel}', '${ids.recepcion}', 'abierto', '${OPEN_AT}', null),
      ('${ids.turnoCerrado}', '${ids.hotel}', '${ids.recepcion}', 'cerrado', '${OPEN_AT}', now());
    insert into public.caja(id, hotel_id, turno_id, tipo, monto, concepto, metodo_pago_id, fecha_movimiento, source, pago_reserva_id, original_movement_id) values
      ('${ids.apertura}', '${ids.hotel}', '${ids.turno}', 'apertura', 120000, 'Apertura de caja', '${ids.cash}', '${OPEN_AT}', 'shift_open', null, null),
      ('${ids.ingreso}', '${ids.hotel}', '${ids.turno}', 'ingreso', 50000, 'Venta manual', '${ids.cash}', '${OPEN_AT}', 'manual_cash', null, null),
      ('${ids.egreso}', '${ids.hotel}', '${ids.turno}', 'egreso', 10000, 'Compra hielo', '${ids.cash}', '${OPEN_AT}', 'manual_cash', null, null),
      ('${ids.reservaPago}', '${ids.hotel}', '${ids.turno}', 'ingreso', 90000, 'Pago reserva', '${ids.bank}', '${OPEN_AT}', 'reservation_payment', '${id(99)}', null),
      ('${ids.conciliado}', '${ids.hotel}', '${ids.turno}', 'ingreso', 30000, 'Transferencia', '${ids.bank}', '${OPEN_AT}', 'manual_cash', null, null),
      ('${ids.revertido}', '${ids.hotel}', '${ids.turno}', 'ingreso', 5000, 'Error', '${ids.cash}', '${OPEN_AT}', 'manual_cash', null, null),
      ('${ids.reversion}', '${ids.hotel}', '${ids.turno}', 'egreso', 5000, 'Reversion: Error', '${ids.cash}', '${OPEN_AT}', 'caja_reversal', null, '${ids.revertido}'),
      ('${ids.cerradoMov}', '${ids.hotel}', '${ids.turnoCerrado}', 'ingreso', 7000, 'Turno viejo', '${ids.cash}', '${OPEN_AT}', 'manual_cash', null, null),
      ('${ids.legacySinLedger}', '${ids.hotel}', '${ids.turno}', 'ingreso', 4000, 'Legacy', '${ids.cash}', '${OPEN_AT}', 'manual_cash', null, null);
    insert into public.caja_reversiones(original_movement_id, reversal_movement_id) values ('${ids.revertido}', '${ids.reversion}');
    insert into public.bank_payment_allocations(caja_id) values ('${ids.conciliado}');
  `);
  // Asientos del ledger shadow para los movimientos con proyeccion.
  for (const movId of [ids.ingreso, ids.egreso, ids.reservaPago, ids.conciliado]) {
    await db.query(`
      insert into public.account_movements(hotel_id, account_id, direction, amount, occurred_at, business_date, description, source, caja_id, metodo_pago_id)
      select c.hotel_id, public.fase2_ensure_method_account(c.metodo_pago_id, c.hotel_id, null),
             case when c.tipo = 'ingreso' then 'in' else 'out' end, c.monto, c.fecha_movimiento,
             c.fecha_movimiento::date, c.concepto, 'caja_shadow', c.id, c.metodo_pago_id
        from public.caja c where c.id = $1
    `, [movId]);
  }
  await db.exec(migration);
  return db;
}

async function editar(db, actorId, overrides) {
  const params = {
    movimiento: ids.ingreso,
    tipo: 'ingreso',
    monto: 50000,
    concepto: 'Venta manual',
    metodo: ids.cash,
    fecha: OPEN_AT,
    motivo: 'Correccion de digitacion',
    ...overrides,
  };
  await db.exec('begin');
  try {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actorId })]);
    await db.exec('set local role authenticated');
    const result = await db.query(
      'select public.editar_movimiento_caja_admin($1, $2, $3, $4, $5, $6, $7) as result',
      [params.movimiento, params.tipo, params.monto, params.concepto, params.metodo, params.fecha, params.motivo],
    );
    await db.exec('commit');
    return result.rows[0].result;
  } catch (error) {
    await db.exec('rollback');
    throw error;
  }
}

async function cajaRow(db, movId) {
  const result = await db.query(
    'select tipo::text as tipo, monto, concepto, metodo_pago_id, fecha_movimiento, business_date from public.caja where id = $1',
    [movId],
  );
  const row = result.rows[0];
  return { ...row, monto: Number(row.monto) };
}

async function ledgerRow(db, movId) {
  const result = await db.query(
    `select m.direction, m.amount, m.description, m.metodo_pago_id, m.occurred_at, m.business_date, a.name as cuenta
       from public.account_movements m join public.financial_accounts a on a.id = m.account_id
      where m.caja_id = $1`,
    [movId],
  );
  return result.rows.map((row) => ({ ...row, amount: Number(row.amount) }));
}

test('el admin edita monto, tipo, concepto, metodo y fecha; el ledger queda sincronizado y auditado', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const result = await editar(db, ids.admin, {
    tipo: 'egreso',
    monto: 65000,
    concepto: '  Pago proveedor  ',
    metodo: ids.bank,
    fecha: EDIT_AT,
    motivo: 'Se registro como ingreso por error',
  });
  assert.equal(result.sin_cambios, false);
  assert.equal(result.ledger_sincronizado, true);

  const row = await cajaRow(db, ids.ingreso);
  assert.equal(row.tipo, 'egreso');
  assert.equal(row.monto, 65000);
  assert.equal(row.concepto, 'Pago proveedor');
  assert.equal(row.metodo_pago_id, ids.bank);
  assert.equal(new Date(row.fecha_movimiento).toISOString(), new Date(EDIT_AT).toISOString());

  const ledger = await ledgerRow(db, ids.ingreso);
  assert.equal(ledger.length, 1, 'no se duplica el asiento');
  assert.equal(ledger[0].direction, 'out');
  assert.equal(ledger[0].amount, 65000);
  assert.equal(ledger[0].description, 'Pago proveedor');
  assert.equal(ledger[0].metodo_pago_id, ids.bank);
  assert.equal(ledger[0].cuenta, 'Cuenta Bancolombia');

  const audit = await db.query(
    "select actor_id, reason, before_data->>'monto' as antes, after_data->>'monto' as despues from public.auditoria_operaciones where accion = 'caja.editar_movimiento_admin'",
  );
  assert.deepEqual(audit.rows, [{ actor_id: ids.admin, reason: 'Se registro como ingreso por error', antes: '50000', despues: '65000' }]);
});

test('el admin puede corregir el valor de la apertura sin cambiarle el tipo', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  await editar(db, ids.admin, { movimiento: ids.apertura, tipo: 'apertura', monto: 150000, concepto: 'Apertura de caja' });
  assert.equal((await cajaRow(db, ids.apertura)).monto, 150000);
  assert.deepEqual(await ledgerRow(db, ids.apertura), [], 'la apertura sigue fuera del ledger');

  await assert.rejects(
    () => editar(db, ids.admin, { movimiento: ids.apertura, tipo: 'ingreso', monto: 150000, concepto: 'Apertura de caja' }),
    /CAJA_EDICION_TIPO_INVALIDO/,
  );
});

test('rol administrador asignado por usuarios_roles tambien puede editar', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await editar(db, ids.adminRoleUser, { monto: 51000 });
  assert.equal((await cajaRow(db, ids.ingreso)).monto, 51000);
});

test('solo el admin puede editar y solo en su hotel', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());
  await assert.rejects(() => editar(db, ids.recepcion, { monto: 1 }), /CAJA_EDICION_SOLO_ADMIN/);
  await assert.rejects(() => editar(db, ids.otherAdmin, { monto: 1 }), /otro hotel/);
  assert.equal((await cajaRow(db, ids.ingreso)).monto, 50000);
});

test('rechaza turnos cerrados, reversiones, revertidos y datos invalidos sin cambiar nada', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const cases = [
    [{ movimiento: ids.cerradoMov, monto: 8000, concepto: 'Turno viejo' }, /CAJA_EDICION_TURNO_CERRADO/],
    [{ movimiento: ids.reversion, tipo: 'egreso', monto: 5000, concepto: 'Reversion: Error' }, /CAJA_EDICION_REVERSION/],
    [{ movimiento: ids.revertido, monto: 6000, concepto: 'Error' }, /CAJA_EDICION_REVERSION/],
    [{ monto: 0 }, /CAJA_EDICION_MONTO_INVALIDO/],
    [{ concepto: '   ' }, /CAJA_EDICION_CONCEPTO_INVALIDO/],
    [{ motivo: '  ' }, /CAJA_EDICION_MOTIVO_REQUERIDO/],
    [{ metodo: ids.inactive }, /CAJA_EDICION_METODO_INVALIDO/],
    [{ metodo: ids.foreignMethod }, /CAJA_EDICION_METODO_INVALIDO/],
    [{ fecha: BEFORE_OPEN }, /CAJA_EDICION_FECHA_INVALIDA/],
    [{ fecha: '2099-01-01T00:00:00Z' }, /CAJA_EDICION_FECHA_INVALIDA/],
    [{ tipo: 'ajuste' }, /CAJA_EDICION_TIPO_INVALIDO/],
  ];
  for (const [overrides, pattern] of cases) {
    await assert.rejects(() => editar(db, ids.admin, overrides), pattern);
  }
  assert.equal((await cajaRow(db, ids.ingreso)).monto, 50000);
  const audit = await db.query('select count(*)::int as n from public.auditoria_operaciones');
  assert.equal(audit.rows[0].n, 0);
});

test('movimientos ligados a reservas o conciliaciones no cambian monto ni tipo, pero si concepto y fecha', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const base = { movimiento: ids.reservaPago, tipo: 'ingreso', monto: 90000, concepto: 'Pago reserva', metodo: ids.bank };
  await assert.rejects(() => editar(db, ids.admin, { ...base, monto: 95000 }), /CAJA_EDICION_VINCULADO/);
  await assert.rejects(() => editar(db, ids.admin, { ...base, tipo: 'egreso' }), /CAJA_EDICION_VINCULADO/);
  await assert.rejects(
    () => editar(db, ids.admin, { movimiento: ids.conciliado, monto: 31000, concepto: 'Transferencia', metodo: ids.bank }),
    /CAJA_EDICION_VINCULADO/,
  );

  await editar(db, ids.admin, { ...base, concepto: 'Pago reserva hab 201', fecha: EDIT_AT });
  const row = await cajaRow(db, ids.reservaPago);
  assert.equal(row.monto, 90000);
  assert.equal(row.concepto, 'Pago reserva hab 201');
  assert.equal((await ledgerRow(db, ids.reservaPago))[0].description, 'Pago reserva hab 201');
});

test('sin cambios no audita; movimiento legado sin asiento no crea uno nuevo', async (t) => {
  const db = await createDatabase();
  t.after(() => db.close());

  const same = await editar(db, ids.admin, {});
  assert.equal(same.sin_cambios, true);

  const legacy = await editar(db, ids.admin, { movimiento: ids.legacySinLedger, monto: 4500, concepto: 'Legacy' });
  assert.equal(legacy.ledger_sincronizado, true);
  assert.deepEqual(await ledgerRow(db, ids.legacySinLedger), []);
  const audit = await db.query('select count(*)::int as n from public.auditoria_operaciones');
  assert.equal(audit.rows[0].n, 1);
});

test('frontend: admin ve editor completo, otros roles solo cambian metodo', async () => {
  const moduleUrl = `${pathToFileURL(path.join(root, 'js/modules/caja/caja-movimientos.js')).href}?edit=${Date.now()}`;
  const { canAdminEditMovement, isMovementLinkedToOtherModule } = await import(moduleUrl);

  assert.equal(canAdminEditMovement({ tipo: 'ingreso' }, true), true);
  assert.equal(canAdminEditMovement({ tipo: 'apertura' }, true), true);
  assert.equal(canAdminEditMovement({ tipo: 'ingreso' }, false), false);
  assert.equal(canAdminEditMovement({ tipo: 'egreso', source: 'caja_reversal' }, true), false);
  assert.equal(canAdminEditMovement({ tipo: 'ingreso', reverted: true }, true), false);
  assert.equal(isMovementLinkedToOtherModule({ pago_reserva_id: 'x' }), true);
  assert.equal(isMovementLinkedToOtherModule({ venta_tienda_id: 'x' }), true);
  assert.equal(isMovementLinkedToOtherModule({}), false);

  assert.match(movimientosSource, /rpc\('editar_movimiento_caja_admin'/);
  assert.match(movimientosSource, /adminEditButton && isAdminUser/);
  // El atajo de conciliacion bancaria sigue encontrando el boton por data-edit-metodo.
  assert.match(movimientosSource, /data-edit-movimiento-admin="\$\{movementIdAttr\}" data-edit-metodo="\$\{movementIdAttr\}"/);
  assert.match(movimientosSource, /pago_reserva_id,venta_tienda_id,venta_restaurante_id,venta_terraza_id,reserva_terraza_id,compra_tienda_id/);
});
