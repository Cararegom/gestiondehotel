const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const servicePath = path.join(
  root,
  'js',
  'modules',
  'mapa-habitaciones',
  'operational-room-state-sync.js',
);
const mapSource = fs.readFileSync(
  path.join(root, 'js/modules/mapa-habitaciones/mapa-habitaciones.js'),
  'utf8',
);

async function loadService() {
  return import(`${pathToFileURL(servicePath).href}?m12=${Date.now()}-${Math.random()}`);
}

function createSupabaseMock(responsesByState) {
  const calls = [];

  return {
    calls,
    client: {
      from(table) {
        const call = { table, filters: [] };
        calls.push(call);

        const builder = {
          update(payload) {
            call.payload = payload;
            return builder;
          },
          eq(column, value) {
            call.filters.push({ operator: 'eq', column, value });
            return builder;
          },
          in(column, values) {
            call.filters.push({ operator: 'in', column, values: [...values] });
            return builder;
          },
          async select(columns) {
            call.select = columns;
            const response = responsesByState[call.payload.estado];
            if (response instanceof Error) throw response;
            return typeof response === 'function' ? response(call) : response;
          },
        };

        return builder;
      },
    },
  };
}

function room(id, estado, overrides = {}) {
  return {
    id,
    nombre: `Habitacion ${id}`,
    estado,
    estado_base: 'libre',
    needsOperationalResync: true,
    ...overrides,
  };
}

test('M12 agrupa las correcciones por estado y limita las peticiones al numero de estados', async () => {
  const { syncOperationalRoomStates } = await loadService();
  const rooms = [
    ...Array.from({ length: 25 }, (_, index) => room(`occupied-${index}`, 'ocupada')),
    ...Array.from({ length: 18 }, (_, index) => room(`expired-${index}`, 'tiempo agotado')),
    room('invalid', 'mantenimiento'),
    room('already-synced', 'ocupada', { estado_base: 'ocupada' }),
  ];
  const supabase = createSupabaseMock({
    ocupada: ({ filters }) => ({
      data: filters.find((filter) => filter.operator === 'in').values.map((id) => ({ id })),
      error: null,
    }),
    'tiempo agotado': ({ filters }) => ({
      data: filters.find((filter) => filter.operator === 'in').values.map((id) => ({ id })),
      error: null,
    }),
  });

  const summary = await syncOperationalRoomStates(rooms, supabase.client, 'hotel-1');

  assert.deepEqual(summary, { requested: 43, updated: 43, failed: 0, requests: 2 });
  assert.equal(supabase.calls.length, 2);
  assert.deepEqual(supabase.calls.map((call) => call.payload.estado).sort(), ['ocupada', 'tiempo agotado']);
  for (const call of supabase.calls) {
    assert.equal(call.table, 'habitaciones');
    assert.equal(call.select, 'id');
    assert.deepEqual(call.filters[0], { operator: 'eq', column: 'hotel_id', value: 'hotel-1' });
    assert.equal(call.filters[1].operator, 'in');
  }
  assert.equal(rooms.filter((item) => item.id !== 'invalid' && item.id !== 'already-synced')
    .every((item) => item.needsOperationalResync === false && item.estado_base === item.estado), true);
  assert.equal(rooms.find((item) => item.id === 'invalid').needsOperationalResync, true);
});

test('M12 conserva pendientes las filas no confirmadas y aisla el fallo de otro lote', async () => {
  const { syncOperationalRoomStates } = await loadService();
  const rooms = [
    room('occupied-ok', 'ocupada'),
    room('occupied-missing', 'ocupada'),
    room('expired-error', 'tiempo agotado'),
  ];
  const errors = [];
  const supabase = createSupabaseMock({
    ocupada: { data: [{ id: 'occupied-ok' }], error: null },
    'tiempo agotado': new Error('network failure'),
  });

  const summary = await syncOperationalRoomStates(rooms, supabase.client, 'hotel-2', {
    onError: (detail) => errors.push(detail),
  });

  assert.deepEqual(summary, { requested: 3, updated: 1, failed: 2, requests: 2 });
  assert.equal(rooms[0].needsOperationalResync, false);
  assert.equal(rooms[0].estado_base, 'ocupada');
  assert.equal(rooms[1].needsOperationalResync, true);
  assert.equal(rooms[1].estado_base, 'libre');
  assert.equal(rooms[2].needsOperationalResync, true);
  assert.deepEqual(errors.map((item) => item.reason).sort(), ['request_failed', 'rows_not_updated']);
});

test('M12 no abre peticiones si no hay correcciones validas', async () => {
  const { syncOperationalRoomStates } = await loadService();
  const supabase = createSupabaseMock({});

  const summary = await syncOperationalRoomStates([
    room('', 'ocupada'),
    room('room-1', 'libre'),
    room('room-2', 'ocupada', { needsOperationalResync: false }),
  ], supabase.client, 'hotel-3');

  assert.deepEqual(summary, { requested: 0, updated: 0, failed: 0, requests: 0 });
  assert.equal(supabase.calls.length, 0);
});

test('M12 integra el servicio batch en el render del mapa', () => {
  assert.match(mapSource, /import\s+\{\s*syncOperationalRoomStates\s*\}\s+from\s+'\.\/operational-room-state-sync\.js'/);
  assert.match(mapSource, /await syncOperationalRoomStates\(currentRooms, supabase, hotelId,/);
  assert.doesNotMatch(mapSource, /corrections\.map\([\s\S]{0,400}\.eq\('id',\s*room\.id\)/);
});
