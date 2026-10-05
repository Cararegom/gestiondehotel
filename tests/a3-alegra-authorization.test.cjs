const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('esbuild');

const FUNCTIONS = [
  'alegra-save-config',
  'alegra-test-connection',
  'alegra-crear-factura',
  'alegra-zapier-notify',
];
const ADMIN_FUNCTIONS = FUNCTIONS.slice(0, 3);
const HOTEL_ID = '00000000-0000-4000-8000-000000000001';
const compiled = new Map();

function validBody(name) {
  if (name === 'alegra-save-config') {
    return { hotelId: HOTEL_ID, usuario: 'billing@example.test', apiKey: 'secret-api-key' };
  }
  if (name === 'alegra-crear-factura') {
    return {
      hotelId: HOTEL_ID,
      facturaData: {
        cliente: { nombre: 'Cliente prueba', email: 'cliente@example.test' },
        items: [{ nombre: 'Hospedaje', precio: 10000, cantidad: 1 }],
      },
    };
  }
  if (name === 'alegra-zapier-notify') {
    return { hotelId: HOTEL_ID, datosVenta: { ventaId: 'venta-1', total: 10000 } };
  }
  return { hotelId: HOTEL_ID };
}

function request(name, body = validBody(name), token = 'valid-user-jwt', origin = 'https://gestiondehotel.com') {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new Request(`https://test.invalid/functions/v1/${name}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function compileFunction(name) {
  if (compiled.has(name)) return compiled.get(name);
  const result = await build({
    entryPoints: [path.resolve(__dirname, `../supabase/functions/${name}/index.ts`)],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['npm:*'],
    define: { 'import.meta.main': 'false' },
  });
  const source = result.outputFiles[0].text;
  compiled.set(name, source);
  return source;
}

async function harness(name, options = {}) {
  const calls = [];
  const userClient = {
    auth: {
      getUser: async (token) => {
        calls.push(['getUser', token]);
        if (options.invalidToken || token !== 'valid-user-jwt') {
          return { data: { user: null }, error: { message: 'sensitive-auth-error' } };
        }
        return {
          data: { user: { id: 'actor-id', is_anonymous: options.anonymous === true } },
          error: null,
        };
      },
    },
    rpc: async (rpcName, args) => {
      calls.push(['rpc', rpcName, args]);
      if (options.authorizationError) {
        return { data: null, error: { message: 'sensitive-database-error' } };
      }
      if (rpcName === 'fase1_actor_es_miembro_activo') {
        return { data: options.isMember !== false, error: null };
      }
      if (rpcName === 'usuario_actual_es_admin_hotel') {
        return { data: options.isAdmin !== false, error: null };
      }
      throw new Error(`RPC inesperada: ${rpcName}`);
    },
  };

  const admin = {
    from(table) {
      calls.push(['from', table]);
      const query = {
        select(columns) {
          calls.push(['select', table, columns]);
          return query;
        },
        eq(column, value) {
          calls.push(['eq', table, column, value]);
          return query;
        },
        async maybeSingle() {
          calls.push(['maybeSingle', table]);
          if (table === 'integraciones_hotel') {
            return {
              data: options.alegraConfig === undefined
                ? { facturador_usuario: 'billing@example.test', facturador_api_key: 'stored-secret-key' }
                : options.alegraConfig,
              error: options.databaseError ? { message: 'sensitive-database-error' } : null,
            };
          }
          if (table === 'hoteles') {
            return {
              data: { alegra_webhook_url: options.webhookUrl === undefined ? 'https://hooks.example.test/alegra' : options.webhookUrl },
              error: options.databaseError ? { message: 'sensitive-database-error' } : null,
            };
          }
          return { data: null, error: { message: 'unexpected-table' } };
        },
        async upsert(payload, config) {
          calls.push(['upsert', table, payload, config]);
          return { error: options.databaseError ? { message: 'sensitive-database-error' } : null };
        },
      };
      return query;
    },
  };

  const sdk = {
    createClient: (_url, key, config) => {
      calls.push(['client', key, config]);
      return key === 'test-anon-key' ? userClient : admin;
    },
  };
  const exported = { exports: {} };
  vm.runInNewContext(await compileFunction(name), {
    module: exported,
    exports: exported.exports,
    require: () => sdk,
    Request,
    Response,
    Headers,
    URL,
    Error,
    SyntaxError,
    btoa,
    console: { error: (...args) => calls.push(['log', ...args]) },
    fetch: async (url, init) => {
      calls.push(['fetch', url, init]);
      return new Response(options.externalBody || JSON.stringify({ ok: true }), {
        status: options.externalStatus || 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    Deno: {
      env: {
        get: (key) => ({
          SUPABASE_URL: 'https://test.invalid',
          SUPABASE_ANON_KEY: 'test-anon-key',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
        })[key],
      },
      serve() {},
    },
  });
  assert.equal(typeof exported.exports.createHandler, 'function');
  return { handler: exported.exports.createHandler(), calls };
}

function usedServiceRole(calls) {
  return calls.some((call) => call[0] === 'client' && call[1] === 'test-service-key');
}

function accessedProtectedResource(calls) {
  return calls.some((call) => call[0] === 'from' || call[0] === 'fetch');
}

for (const name of FUNCTIONS) {
  for (const [label, token, options] of [
    ['sin Authorization', null, {}],
    ['con JWT invalido', 'invalid-jwt', {}],
    ['con JWT expirado', 'valid-user-jwt', { invalidToken: true }],
    ['con sesion anonima', 'valid-user-jwt', { anonymous: true }],
  ]) {
    test(`A3 ${name}: ${label} devuelve 401 antes de service_role`, async () => {
      const { handler, calls } = await harness(name, options);
      const response = await handler(request(name, validBody(name), token));
      assert.equal(response.status, 401);
      assert.equal(usedServiceRole(calls), false);
      assert.equal(accessedProtectedResource(calls), false);
      assert.doesNotMatch(await response.text(), /sensitive|secret|test-service-key/i);
    });
  }

  test(`A3 ${name}: un actor de otro hotel recibe 403 sin acceso privilegiado`, async () => {
    const { handler, calls } = await harness(name, { isMember: false });
    const response = await handler(request(name));
    assert.equal(response.status, 403);
    assert.equal(usedServiceRole(calls), false);
    assert.equal(accessedProtectedResource(calls), false);
    const membership = calls.find((call) => call[0] === 'rpc' && call[1] === 'fase1_actor_es_miembro_activo');
    assert.equal(membership[2].p_hotel_id, HOTEL_ID);
  });

  test(`A3 ${name}: un fallo de autorizacion cierra el acceso y oculta detalles`, async () => {
    const { handler, calls } = await harness(name, { authorizationError: true });
    const response = await handler(request(name));
    assert.equal(response.status, 500);
    assert.equal(usedServiceRole(calls), false);
    assert.equal(accessedProtectedResource(calls), false);
    assert.doesNotMatch(await response.text(), /sensitive|database|secret/i);
  });
}

for (const name of ADMIN_FUNCTIONS) {
  test(`A3 ${name}: un miembro sin rol administrador recibe 403`, async () => {
    const { handler, calls } = await harness(name, { isAdmin: false });
    const response = await handler(request(name));
    assert.equal(response.status, 403);
    assert.equal(usedServiceRole(calls), false);
    assert.equal(accessedProtectedResource(calls), false);
    const order = calls.map((call) => call[1]);
    assert.ok(order.indexOf('fase1_actor_es_miembro_activo') < order.indexOf('usuario_actual_es_admin_hotel'));
  });
}

test('A3 alegra-save-config: autoriza antes de guardar y acota el upsert al hotel validado', async () => {
  const { handler, calls } = await harness('alegra-save-config');
  const response = await handler(request('alegra-save-config'));
  assert.equal(response.status, 200);
  const order = calls.map((call) => call[0]);
  assert.ok(order.indexOf('getUser') < order.indexOf('rpc'));
  assert.ok(order.lastIndexOf('rpc') < order.indexOf('client', order.indexOf('getUser') + 1));
  assert.ok(order.lastIndexOf('rpc') < order.indexOf('upsert'));
  const upsert = calls.find((call) => call[0] === 'upsert');
  assert.equal(upsert[1], 'integraciones_hotel');
  assert.equal(upsert[2].hotel_id, HOTEL_ID);
  assert.equal(upsert[2].facturador_api_key, 'secret-api-key');
});

for (const name of ['alegra-test-connection', 'alegra-crear-factura']) {
  test(`A3 ${name}: solo lee credenciales y llama a Alegra despues de autorizar`, async () => {
    const { handler, calls } = await harness(name);
    const response = await handler(request(name, validBody(name), 'valid-user-jwt', null));
    assert.equal(response.status, 200);
    const order = calls.map((call) => call[0]);
    assert.ok(order.lastIndexOf('rpc') < order.indexOf('from'));
    assert.ok(order.indexOf('from') < order.indexOf('fetch'));
    assert.ok(calls.some((call) => call[0] === 'eq' && call[2] === 'hotel_id' && call[3] === HOTEL_ID));
    assert.match(calls.find((call) => call[0] === 'fetch')[2].headers.Authorization, /^Basic /);
  });
}

test('A3 alegra-zapier-notify: miembro activo notifica solo el webhook de su hotel', async () => {
  const { handler, calls } = await harness('alegra-zapier-notify', { isAdmin: false });
  const response = await handler(request('alegra-zapier-notify'));
  assert.equal(response.status, 200);
  assert.equal(calls.some((call) => call[0] === 'rpc' && call[1] === 'usuario_actual_es_admin_hotel'), false);
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'hoteles' && call[2] === 'id' && call[3] === HOTEL_ID));
  const outgoing = calls.find((call) => call[0] === 'fetch');
  assert.equal(outgoing[1], 'https://hooks.example.test/alegra');
  assert.deepEqual(JSON.parse(outgoing[2].body), validBody('alegra-zapier-notify').datosVenta);
});

test('A3: respuestas de base de datos y proveedores no filtran secretos', async () => {
  for (const [name, options] of [
    ['alegra-save-config', { databaseError: true }],
    ['alegra-test-connection', { externalStatus: 401, externalBody: 'sensitive-provider-secret' }],
    ['alegra-crear-factura', { externalStatus: 401, externalBody: 'sensitive-provider-secret' }],
    ['alegra-zapier-notify', { externalStatus: 500, externalBody: 'sensitive-webhook-secret' }],
  ]) {
    const { handler, calls } = await harness(name, options);
    const response = await handler(request(name));
    assert.ok(response.status >= 200 && response.status < 600);
    assert.doesNotMatch(await response.text(), /sensitive|secret-api-key|stored-secret-key|webhook-secret/i);
    assert.equal(calls.some((call) => call[0] === 'log' && /sensitive|secret/i.test(JSON.stringify(call))), false);
  }
});

test('A3: valida UUID, campos permitidos, metodos y origen antes de autenticar', async () => {
  for (const name of FUNCTIONS) {
    for (const candidate of [
      request(name, { ...validBody(name), hotelId: 'not-a-uuid' }),
      request(name, { ...validBody(name), actor_id: 'forged' }),
      request(name, validBody(name), 'valid-user-jwt', 'https://attacker.invalid'),
    ]) {
      const { handler, calls } = await harness(name);
      const response = await handler(candidate);
      assert.ok([400, 403].includes(response.status));
      assert.equal(calls.some((call) => call[0] === 'getUser'), false);
      assert.equal(usedServiceRole(calls), false);
    }

    const { handler, calls } = await harness(name);
    const optionsResponse = await handler(new Request('https://test.invalid', { method: 'OPTIONS' }));
    assert.equal(optionsResponse.status, 200);
    const getResponse = await handler(new Request('https://test.invalid', { method: 'GET' }));
    assert.equal(getResponse.status, 405);
    assert.equal(calls.length, 0);
  }
});

test('A3: Supabase y CI incluyen las cuatro funciones con verify_jwt', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../supabase/config.toml'), 'utf8');
  const pkg = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8');
  const shared = fs.readFileSync(path.resolve(__dirname, '../supabase/functions/_shared/alegra-security.ts'), 'utf8');
  for (const name of FUNCTIONS) {
    assert.match(config, new RegExp(`\\[functions\\.${name}\\]\\s*\\r?\\nverify_jwt\\s*=\\s*true`));
    assert.match(pkg, new RegExp(`supabase/functions/${name}(?:/index\\.ts|[\"/])`));
  }
  assert.match(pkg, /supabase\/functions\/_shared\/alegra-security\.ts/);
  assert.match(shared, /auth\.getUser\(accessToken\)/);
  assert.match(shared, /fase1_actor_es_miembro_activo/);
  assert.match(shared, /usuario_actual_es_admin_hotel/);
});
