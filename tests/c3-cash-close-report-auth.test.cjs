const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { build } = require('esbuild');

let compiled;

async function compileFunction() {
  if (compiled) return compiled;
  const result = await build({
    entryPoints: [path.resolve(__dirname, '../supabase/functions/send-cash-close-report/index.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['npm:*', 'https://*'],
    define: { 'import.meta.main': 'false' },
  });
  compiled = result.outputFiles[0].text;
  return compiled;
}

async function harness(options = {}) {
  const calls = [];
  const userClient = {
    auth: {
      getUser: async (token) => {
        calls.push(['getUser', token]);
        if (options.invalidToken || token !== 'valid-user-jwt') {
          return { data: { user: null }, error: { message: 'sensitive-auth-error' } };
        }
        return {
          data: {
            user: {
              id: 'actor-id',
              email: options.userEmail === undefined ? 'actor@example.test' : options.userEmail,
              is_anonymous: options.anonymous === true,
            },
          },
          error: null,
        };
      },
    },
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return {
        data: options.isMember !== false,
        error: options.membershipError || null,
      };
    },
  };
  const admin = {
    from: (table) => {
      calls.push(['from', table]);
      const query = {
        select(columns) {
          calls.push(['select', columns]);
          return query;
        },
        eq(column, value) {
          calls.push(['eq', column, value]);
          return query;
        },
        async maybeSingle() {
          calls.push(['maybeSingle']);
          return {
            data: options.config === undefined
              ? { correo_reportes: 'reports@example.test', correo_remitente: 'hotel@example.test' }
              : options.config,
            error: options.configError || null,
          };
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
  const source = await compileFunction();
  vm.runInNewContext(source, {
    module: exported,
    exports: exported.exports,
    require: () => sdk,
    Request,
    Response,
    Headers,
    Error,
    SyntaxError,
    URL,
    console: { error: (...args) => calls.push(['log', ...args]) },
    fetch: async (url, init) => {
      calls.push(['fetch', url, init]);
      return new Response(options.webhookBody || 'ok', { status: options.webhookStatus || 200 });
    },
    Deno: {
      env: {
        get: (key) => ({
          SUPABASE_URL: 'https://test.invalid',
          SUPABASE_ANON_KEY: 'test-anon-key',
          SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
          MAKE_CASH_CLOSE_WEBHOOK_URL: 'https://webhook.invalid/cash-close',
        })[key],
      },
      serve() {},
    },
  });
  assert.equal(typeof exported.exports.createHandler, 'function');
  return { handler: exported.exports.createHandler(), calls };
}

const validBody = {
  hotelId: '00000000-0000-4000-8000-000000000001',
  subject: 'Cierre de caja',
  html: '<p>Reporte</p>',
  fallbackEmail: 'attacker@example.test',
};

function request(body = validBody, token = 'valid-user-jwt', method = 'POST', origin = 'https://gestiondehotel.com') {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (origin) headers.Origin = origin;
  return new Request('https://test.invalid/functions/v1/send-cash-close-report', {
    method,
    headers,
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}

function usedServiceRole(calls) {
  return calls.some((call) => call[0] === 'client' && call[1] === 'test-service-key');
}

for (const [label, token, options] of [
  ['sin Authorization', null, {}],
  ['JWT inválido', 'invalid-jwt', {}],
  ['JWT expirado', 'valid-user-jwt', { invalidToken: true }],
  ['sesión anónima', 'valid-user-jwt', { anonymous: true }],
]) {
  test(`C3: ${label} devuelve 401 antes de service_role o webhook`, async () => {
    const { handler, calls } = await harness(options);
    const response = await handler(request(validBody, token));
    assert.equal(response.status, 401);
    assert.equal(usedServiceRole(calls), false);
    assert.equal(calls.some((call) => call[0] === 'fetch'), false);
    assert.doesNotMatch(await response.text(), /sensitive|test-service-key/i);
  });
}

test('C3: un usuario activo de otro hotel recibe 403 sin acceso privilegiado', async () => {
  const { handler, calls } = await harness({ isMember: false });
  const response = await handler(request());
  assert.equal(response.status, 403);
  const membershipCall = calls.find((call) => call[0] === 'rpc');
  assert.equal(membershipCall[1], 'fase1_actor_es_miembro_activo');
  assert.equal(membershipCall[2].p_hotel_id, validBody.hotelId);
  assert.equal(usedServiceRole(calls), false);
  assert.equal(calls.some((call) => call[0] === 'fetch'), false);
});

test('C3: un error al comprobar membresía falla cerrado y no filtra detalles', async () => {
  const { handler, calls } = await harness({ membershipError: { message: 'sensitive-database-error' } });
  const response = await handler(request());
  assert.equal(response.status, 500);
  assert.equal(usedServiceRole(calls), false);
  assert.equal(calls.some((call) => call[0] === 'fetch'), false);
  assert.doesNotMatch(await response.text(), /sensitive|database/i);
});

test('C3: miembro activo consulta su hotel y envía después de autorizar', async () => {
  const { handler, calls } = await harness();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: true });

  const order = calls.map((call) => call[0]);
  assert.ok(order.indexOf('getUser') < order.indexOf('rpc'));
  assert.ok(order.indexOf('rpc') < order.indexOf('from'));
  assert.ok(order.indexOf('from') < order.indexOf('fetch'));
  assert.ok(usedServiceRole(calls));
  assert.ok(calls.some((call) => call[0] === 'eq' && call[1] === 'hotel_id' && call[2] === validBody.hotelId));

  const webhook = calls.find((call) => call[0] === 'fetch');
  const payload = JSON.parse(webhook[2].body);
  assert.equal(payload.to, 'reports@example.test');
  assert.equal(payload.from, 'hotel@example.test');
});

test('C3: el fallback enviado por el navegador no puede redirigir el reporte', async () => {
  const { handler, calls } = await harness({ config: { correo_reportes: '', correo_remitente: '' } });
  const response = await handler(request());
  assert.equal(response.status, 200);
  const payload = JSON.parse(calls.find((call) => call[0] === 'fetch')[2].body);
  assert.equal(payload.to, 'actor@example.test');
  assert.notEqual(payload.to, validBody.fallbackEmail);
});

test('C3: sin destino confiable no llama al webhook', async () => {
  const { handler, calls } = await harness({
    userEmail: '',
    config: { correo_reportes: '', correo_remitente: '' },
  });
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { sent: false, reason: 'invalid_destination' });
  assert.equal(calls.some((call) => call[0] === 'fetch'), false);
});

test('C3: hotelId inválido y origen ajeno fallan antes de autenticar', async () => {
  for (const req of [
    request({ ...validBody, hotelId: 'not-a-uuid' }),
    request(validBody, 'valid-user-jwt', 'POST', 'https://attacker.invalid'),
  ]) {
    const { handler, calls } = await harness();
    const response = await handler(req);
    assert.ok([400, 403].includes(response.status));
    assert.equal(calls.some((call) => call[0] === 'getUser'), false);
    assert.equal(usedServiceRole(calls), false);
  }
});

test('C3: configuración y CI declaran la protección de la función', () => {
  const config = fs.readFileSync(path.resolve(__dirname, '../supabase/config.toml'), 'utf8');
  const pkg = fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8');
  const source = fs.readFileSync(path.resolve(__dirname, '../supabase/functions/send-cash-close-report/index.ts'), 'utf8');
  assert.match(config, /\[functions\.send-cash-close-report\]\s*\r?\nverify_jwt\s*=\s*true/);
  assert.match(pkg, /supabase\/functions\/send-cash-close-report\/index\.ts/);
  assert.match(pkg, /supabase\/functions\/send-cash-close-report(?:"|\/)/);
  assert.match(source, /npm:@supabase\/supabase-js@2\.111\.0/);
});
