const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const root = resolve(__dirname, '..');
const source = (file) => readFileSync(resolve(root, file), 'utf8');
const importFile = (file) => import(pathToFileURL(resolve(root, file)).href);
const plain = (value) => JSON.parse(JSON.stringify(value));
const ok = (data) => ({ data, error: null, status: 200 });
const networkFailure = (message = 'TypeError: Failed to fetch') => ({
  data: null, error: { code: '', message, details: 'private stack' }, status: 0
});
let reads;
let reporter;
let security;
let operation;

test.before(async () => {
  reads = await importFile('js/services/readQueryService.js');
  reporter = await importFile('js/services/handledErrorReporter.js');
  security = await importFile('js/security.js');
  operation = await importFile('js/modules/reservas/reservas-operacion.js');
});

function database(handler) {
  const calls = [];
  const client = {
    from(table) {
      const query = { table, filters: [], selected: null };
      const builder = {
        select(columns) { query.selected = columns; return builder; },
        eq(column, value) { query.filters.push(['eq', column, value]); return builder; },
        in(column, values) { query.filters.push(['in', column, [...values]]); return builder; },
        order(column, options) { query.order = [column, options]; return builder; },
        limit(limit) { query.limit = limit; return builder; },
        then(resolve, reject) {
          assert.ok(query.selected, 'cada consulta debe ser SELECT');
          calls.push(plain(query));
          return Promise.resolve().then(() => handler(query, calls)).then(resolve, reject);
        },
        insert() { assert.fail('no reintentar escrituras'); },
        update() { assert.fail('no reintentar escrituras'); },
        delete() { assert.fail('no reintentar escrituras'); }
      };
      return builder;
    },
    rpc() { assert.fail('el cargador no debe ejecutar RPC de escritura'); }
  };
  return { client, calls };
}

function monitor(t) {
  const previous = globalThis.HotelMonitoring;
  const captured = [];
  globalThis.HotelMonitoring = { captureException: (error, context) => captured.push({ error, context }) };
  t.after(() => {
    if (previous === undefined) delete globalThis.HotelMonitoring;
    else globalThis.HotelMonitoring = previous;
  });
  return captured;
}

function reservationView(client) {
  const file = source('js/modules/reservas/reservas.js');
  const start = file.indexOf('async function renderReservas() {');
  const end = file.indexOf('\nfunction renderReservasGrupo(', start);
  assert.ok(start > 0 && end > start);
  const list = { innerHTML: '', style: {} };
  const rendered = [];
  const errors = [];
  const state = {
    isModuleMounted: true, supabase: client, hotelId: 'hotel-a', reservaFiltros: { modoFecha: 'registro' }
  };
  const noop = () => {};
  const context = vm.createContext({
    state, ui: { reservasListEl: list }, console,
    ...reads, ...reporter,
    RESERVA_VISIBLE_STATES: operation.RESERVA_VISIBLE_STATES,
    showLoading: noop, clearFeedback: noop,
    showError: (_element, message) => errors.push(message),
    ensureReservasHistorialUsuarios: async () => {},
    poblarRecepcionistasFiltro: noop,
    cargarTurnosParaReservas: async () => [],
    enriquecerReservasConHistorial: (rows) => rows,
    updateReservasExperiencePanels: noop, poblarTurnosFiltro: noop,
    filtrarReservasHistorial: (rows) => rows,
    updateReservasHistorySummary: noop,
    hasActiveReservaFilters: () => false,
    renderReservasGrupo: noop, getDateMsSafe: noop, getReservaFilterDateISO: noop, getReservaRegistroISO: noop,
    buildReservasListHtml({ reservasEnriquecidas }) {
      rendered.push(plain(reservasEnriquecidas));
      return '<div>Reservas cargadas</div>';
    }
  });
  vm.runInContext(`${file.slice(start, end)}; globalThis.render = renderReservas;`, context);
  return { render: context.render, state, list, rendered, errors };
}

function cashView(client, bank = {}) {
  // Ejecutar el módulo real con dependencias de UI y banca aisladas; no sustituir
  // su carga, enriquecimiento, cálculo de totales ni render de filas.
  const file = source('js/modules/caja/caja-movimientos.js')
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*/gm, '')
    .replace(/^export\s+/gm, '');
  const errors = [];
  const context = vm.createContext({
    ...reads, ...reporter, ...security,
    formatCurrency: (amount) => String(amount),
    formatDateTime: (value) => String(value),
    showError: (_element, message) => errors.push(message),
    getBankPaymentPilotStatus: bank.pilotStatus || (async () => ({ eligible: false })),
    getBankPaymentCashStatuses: bank.cashStatuses || (async () => { assert.fail('piloto bancario desactivado'); })
  });
  vm.runInContext(`${file}; globalThis.cash = { loadAndRenderMovements, createInitialMovementTableState };`, context);
  const movementTableState = context.cash.createInitialMovementTableState();
  const summaryEls = Object.fromEntries(['apertura', 'ingresos', 'egresos', 'propinas', 'operativo', 'balance'].map((key) => [key, {}]));
  const tBodyEl = { innerHTML: '' };
  const render = () => context.cash.loadAndRenderMovements({
    supabase: client, hotelId: 'hotel-a', turnoId: 'turno-a',
    tBodyEl, summaryEls, movementTableState,
    currentContainerEl: { querySelector: () => ({}) }, isAdminUser: false
  });
  return { render, movementTableState, summaryEls, tBodyEl, errors };
}

const reservations = [
  { id: 'reserva-a', habitacion_id: 'habitacion-a', monto_total: 40000, estado: 'reservada' },
  { id: 'reserva-b', habitacion_id: 'habitacion-a', monto_total: 20000, estado: 'cancelada', cancelado_por_usuario_id: 'usuario-a' }
];
const reservationData = {
  reservas: reservations,
  habitaciones: [{ id: 'habitacion-a', nombre: '101', tipo: 'doble' }],
  usuarios: [{ id: 'usuario-a', nombre: 'Recepción' }],
  pagos_reserva: [{ reserva_id: 'reserva-a', monto: 20000 }, { reserva_id: 'reserva-a', monto: 10000 }]
};
const cashData = {
  caja: [
    { id: 'apertura', tipo: 'apertura', monto: 10000, creado_en: '2026-10-06T07:00:00Z' },
    { id: 'ingreso', tipo: 'ingreso', monto: 30000, creado_en: '2026-10-06T08:00:00Z', venta_tienda_id: 'venta-a' },
    { id: 'egreso', tipo: 'egreso', monto: 5000, creado_en: '2026-10-06T09:00:00Z', venta_restaurante_id: 'venta-b' }
  ],
  detalle_ventas_tienda: [{ venta_id: 'venta-a', cantidad: 2, producto: { nombre: 'Agua' } }],
  ventas_restaurante_items: [{ venta_id: 'venta-b', cantidad: 1, plato: { nombre: 'Desayuno' } }],
  caja_reversiones: [{ original_movement_id: 'ingreso' }]
};

test('una lectura sana se ejecuta una vez y conserva la respuesta', async () => {
  const expected = ok([{ id: 'fila-a' }]);
  let attempts = 0;
  const result = await reads.readQueryWithNetworkRetry(() => { attempts++; return expected; });
  assert.equal(attempts, 1);
  assert.equal(result, expected);
});

test('recupera el fallo de fetch nativo y limita una red caída a dos intentos', async () => {
  let attempts = 0;
  const recovered = await reads.readQueryWithNetworkRetry(() => {
    if (++attempts === 1) throw new TypeError('Failed to fetch');
    return ok([{ id: 'fila-a' }]);
  });
  assert.equal(attempts, 2);
  assert.equal(recovered.error, null);
  attempts = 0;
  const failed = await reads.readQueryWithNetworkRetry(() => { attempts++; return networkFailure('TypeError: Load failed'); });
  assert.equal(attempts, 2);
  assert.equal(failed.error.status, 0);
  assert.equal(failed.data, null);
});

test('no reintenta permisos, sesión, timeout SQL, joins, abort ni errores de programación', async () => {
  const failures = [
    { error: { code: '42501', message: 'permission denied' }, status: 403 },
    { error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    { error: { code: '57014', message: 'statement timeout' }, status: 500 },
    { error: { code: 'PGRST200', message: 'relationship missing' }, status: 400 },
    { error: { code: '', message: 'AbortError: operation aborted' }, status: 0 },
    { error: { code: '42501', message: 'Failed to fetch' }, status: 0 },
    { error: { code: '', message: 'Failed to fetch' }, status: 401 }
  ];
  for (const failure of failures) {
    let attempts = 0;
    const result = await reads.readQueryWithNetworkRetry(() => { attempts++; return { data: null, ...failure }; });
    assert.equal(attempts, 1, failure.error.message);
    assert.equal(result.error.code, failure.error.code);
    assert.equal(result.error.status, failure.status);
  }
  let attempts = 0;
  const error = new TypeError('Cannot read properties of null');
  const result = await reads.readQueryWithNetworkRetry(() => { attempts++; throw error; });
  assert.equal(attempts, 1);
  assert.equal(result.error, error);
  assert.equal(result.status, undefined);
});

test('en lotes reintenta solo el lote fallido sin duplicar filas ni omitir pagos', async () => {
  const ids = Array.from({ length: 205 }, (_, index) => `reserva-${index}`);
  let failed = false;
  const db = database((query) => {
    const batch = query.filters[0][2];
    if (batch[0] === 'reserva-100' && !failed) { failed = true; return networkFailure(); }
    return ok(batch.map((id) => ({ reserva_id: id, monto: 1000 })));
  });
  const rows = await reads.readRelatedRowsInBatches(db.client, 'pagos_reserva', 'reserva_id, monto', 'reserva_id', ids);
  assert.equal(rows.length, 205);
  assert.equal(new Set(rows.map((row) => row.reserva_id)).size, 205);
  assert.equal(rows.reduce((sum, row) => sum + row.monto, 0), 205000);
  assert.deepEqual(db.calls.map((call) => call.filters[0][2].length), [100, 100, 100, 5]);
  assert.deepEqual(await reads.readRelatedRowsInBatches(db.client, 'usuarios', 'id', 'id', []), []);
  assert.equal(db.calls.length, 4);
});

for (const table of ['reservas', 'habitaciones', 'pagos_reserva', 'usuarios']) {
  test(`Reservas recupera ${table}, conserva abonos, pendientes y relaciones`, async (t) => {
    const captured = monitor(t);
    const db = database((query, calls) => {
      if (query.table === table && calls.filter((call) => call.table === table).length === 1) return networkFailure();
      return ok(plain(reservationData[query.table]));
    });
    const view = reservationView(db.client);
    await view.render();
    assert.equal(db.calls.filter((call) => call.table === table).length, 2);
    assert.deepEqual(db.calls.filter((call) => call.table === 'reservas')[0].filters[0], ['eq', 'hotel_id', 'hotel-a']);
    assert.equal(view.rendered.length, 1);
    const [first, second] = view.rendered[0];
    assert.equal(first.abonado, 30000);
    assert.equal(first.pendiente, 10000);
    assert.equal(first.pagos_reserva.length, 2);
    assert.equal(first.habitaciones.nombre, '101');
    assert.equal(second.cancelador.nombre, 'Recepción');
    assert.deepEqual(view.errors, []);
    assert.equal(captured.length, 0);
  });
}

for (const table of ['caja', 'detalle_ventas_tienda', 'ventas_restaurante_items', 'caja_reversiones']) {
  test(`Caja recupera ${table}, conserva totales, conceptos y reversiones`, async (t) => {
    const captured = monitor(t);
    const db = database((query, calls) => {
      if (query.table === table && calls.filter((call) => call.table === table).length === 1) return networkFailure();
      return ok(plain(cashData[query.table]));
    });
    const view = cashView(db.client);
    await view.render();
    assert.equal(db.calls.filter((call) => call.table === table).length, 2);
    assert.deepEqual(db.calls.filter((call) => call.table === 'caja')[0].filters, [['eq', 'hotel_id', 'hotel-a'], ['eq', 'turno_id', 'turno-a']]);
    assert.equal(view.movementTableState.all.length, 3);
    assert.equal(view.summaryEls.ingresos.textContent, '30000');
    assert.equal(view.summaryEls.egresos.textContent, '5000');
    assert.equal(view.summaryEls.balance.textContent, '35000');
    assert.equal(view.movementTableState.all.find((row) => row.id === 'ingreso').reverted, true);
    assert.match(view.tBodyEl.innerHTML, /2 x Agua/);
    assert.match(view.tBodyEl.innerHTML, /1 x Desayuno/);
    assert.deepEqual(view.errors, []);
    assert.equal(captured.length, 0);
  });
}

test('un error definitivo sigue visible y Sentry conserva código y HTTP sin datos personales', async (t) => {
  const captured = monitor(t);
  const db = database(() => ({ data: null, status: 403, error: { code: '42501', message: 'private Ana Pérez guest@example.test', details: 'private-stack', hint: 'private-hint' } }));
  const reservationsView = reservationView(db.client);
  await reservationsView.render();
  const movementsView = cashView(db.client);
  await movementsView.render();
  assert.equal(db.calls.length, 2);
  assert.equal(reservationsView.rendered.length, 0);
  assert.equal(reservationsView.errors.length, 1);
  assert.equal(movementsView.errors.length, 1);
  assert.deepEqual(captured.map(({ error }) => error.message), [
    'reservas.reservation_list_load_failed [code=42501; status=403]',
    'caja.movements_load_failed [code=42501; status=403]'
  ]);
  assert.doesNotMatch(JSON.stringify(captured.map(({ error }) => ({ message: error.message, stack: error.stack }))), /private|Ana|guest@/);
});

test('si persiste la red en pagos, no muestra reservas con saldo inventado y reporta el fallo', async (t) => {
  const captured = monitor(t);
  const db = database((query) => query.table === 'pagos_reserva' ? networkFailure() : ok(plain(reservationData[query.table])));
  const view = reservationView(db.client);
  await view.render();
  assert.equal(db.calls.filter((call) => call.table === 'pagos_reserva').length, 2);
  assert.equal(view.rendered.length, 0);
  assert.equal(view.errors.length, 1);
  assert.equal(captured[0].error.message, 'reservas.reservation_relations_load_failed [status=0; kind=network]');
});

test('el diagnóstico rechaza campos libres y sobrevive al saneamiento de Sentry', async () => {
  const { sanitizeSentryEvent } = await importFile('js/monitoring/sentry-policy.mjs');
  const reported = reporter.reportHandledError('reservas', 'reservation_list_load_failed', {
    code: 'PGRST301', status: 401, message: 'private-user guest@example.test', details: 'private-stack'
  });
  const clean = sanitizeSentryEvent({ exception: { values: [{ type: reported.name, value: reported.message }] } });
  assert.equal(clean.exception.values[0].value, 'reservas.reservation_list_load_failed [code=PGRST301; status=401]');
  assert.doesNotMatch(JSON.stringify(clean), /private|guest@/);
  const untrusted = reporter.reportHandledError('caja', 'movements_load_failed', { code: 'ALANA', status: '401 private', message: 'private', name: 'private' });
  assert.equal(untrusted.message, 'caja.movements_load_failed');
});

test('un HTTP 503 de estados bancarios no bloquea Caja ni inventa una conciliación', async (t) => {
  const captured = monitor(t);
  let bankCalls = 0;
  const db = database((query) => ok(plain(cashData[query.table])));
  const view = cashView(db.client, {
    pilotStatus: async () => ({ eligible: true, canViewOperationalStatus: true }),
    cashStatuses: async () => {
      bankCalls++;
      throw Object.assign(new Error('private bank-service error'), { status: 503 });
    }
  });
  await view.render();
  assert.equal(bankCalls, 1, 'no repetir POST ni acciones bancarias');
  assert.equal(view.movementTableState.all.length, 3);
  assert.equal(view.summaryEls.balance.textContent, '35000');
  assert.equal(view.movementTableState.showBankStatus, true);
  assert.ok(view.movementTableState.all.every((row) => row.bank_status === 'unavailable'));
  assert.match(view.tBodyEl.innerHTML, /Verificación no disponible/);
  assert.match(view.tBodyEl.innerHTML, /2 x Agua/);
  assert.doesNotMatch(view.tBodyEl.innerHTML, /Confirmado por banco|No aplica/);
  assert.deepEqual(view.errors, []);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].error.message, 'caja.bank_cash_statuses_load_failed [status=503]');
  assert.doesNotMatch(captured[0].error.message, /private/);
});

test('el servicio bancario conserva HTTP 503 para el diagnóstico de la consulta opcional', async () => {
  const { getBankPaymentCashStatuses } = await importFile('js/services/bankPaymentService.js');
  const supabase = { functions: { invoke: async () => ({
    data: null,
    error: { message: 'non-2xx response', context: new Response('{"message":"Servicio no disponible"}', { status: 503 }) }
  }) } };
  await assert.rejects(
    getBankPaymentCashStatuses(supabase, '00000000-0000-4000-8000-000000000001', ['00000000-0000-4000-8000-000000000002']),
    (error) => error.status === 503 && error.message === 'Servicio no disponible'
  );
});

test('crear una reserva no se repite cuando la actualización del listado necesita reintento', async (t) => {
  monitor(t);
  const { submitReservaForm } = await importFile('js/modules/reservas/reservas-formulario.js');
  const previousDocument = globalThis.document;
  globalThis.document = { dispatchEvent() {} };
  t.after(() => { globalThis.document = previousDocument; });
  let created = 0;
  const db = database((query, calls) => {
    if (query.table === 'reservas' && calls.filter((call) => call.table === 'reservas').length === 1) return networkFailure();
    return ok(plain(reservationData[query.table]));
  });
  const view = reservationView(db.client);
  const noop = () => {};
  await submitReservaForm({
    event: { preventDefault() {} },
    ui: { form: { elements: { metodo_pago_id: { value: '' } } }, feedbackDiv: {}, submitButton: { textContent: 'Registrar' } },
    state: { isEditMode: false, configHotel: { cobro_al_checkin: false } },
    turnoService: {}, setFormLoadingState: noop, clearFeedback: noop,
    showError: (_element, message) => assert.fail(message), showSuccess: noop,
    validateAndCalculateBooking: async () => ({ datosPago: {} }),
    createBooking: async () => { created++; }, updateBooking: () => assert.fail('edición inesperada'),
    showPagoMixtoModal: noop, showReservaSuccessModal: noop,
    renderReservas: view.render, resetFormToCreateMode: noop,
    gatherFormData: () => ({ tipo_pago: 'parcial', monto_abono: '0' }), validateInitialInputs: noop
  });
  assert.equal(created, 1);
  assert.equal(db.calls.filter((call) => call.table === 'reservas').length, 2);
  assert.equal(view.rendered.length, 1);
});
