const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function loadSharedModule() {
  const result = await build({
    entryPoints: [path.join(root, 'supabase/functions/_shared/user-management.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    external: ['npm:*'],
  });
  const module = { exports: {} };
  vm.runInNewContext(result.outputFiles[0].text, {
    module,
    exports: module.exports,
    require: () => ({ createClient: () => { throw new Error('unexpected client'); } }),
    Request,
    Response,
    Headers,
    Error,
    SyntaxError,
    Deno: { env: { get: () => null } },
  });
  return module.exports;
}

test('B1: las cuatro funciones de usuarios eliminan el comodín CORS', () => {
  const files = [
    'supabase/functions/_shared/user-management.ts',
    'supabase/functions/manage-user-lifecycle/index.ts',
    'supabase/functions/delete-user/index.ts',
    'supabase/functions/_shared/user-management-cors.ts',
  ];
  for (const file of files) {
    assert.doesNotMatch(source(file), /Access-Control-Allow-Origin["']?\s*:\s*["']\*["']/);
  }
  assert.match(source('supabase/functions/crear_colaborador/index.ts'), /_shared\/user-management\.ts/);
  assert.match(source('supabase/functions/actualizar_permisos_usuario/index.ts'), /_shared\/user-management\.ts/);
  assert.match(source('supabase/functions/manage-user-lifecycle/index.ts'), /user-management-cors\.ts/);
  assert.match(source('supabase/functions/delete-user/index.ts'), /user-management-cors\.ts/);
});

test('B1: el preflight refleja solo orígenes permitidos y declara Vary', async () => {
  const { endpoint } = await loadSharedModule();
  let calls = 0;
  const handler = endpoint(async () => {
    calls += 1;
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  });

  for (const origin of [
    'https://gestiondehotel.com',
    'https://www.gestiondehotel.com',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
  ]) {
    const response = await handler(new Request('https://test.invalid', {
      method: 'OPTIONS',
      headers: { Origin: origin },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(response.headers.get('Vary'), 'Origin');
  }
  assert.equal(calls, 0);
});

test('B1: un origen web ajeno recibe 403 antes de ejecutar la acción', async () => {
  const { endpoint } = await loadSharedModule();
  let calls = 0;
  const handler = endpoint(async () => {
    calls += 1;
    return new Response('{}');
  });
  const response = await handler(new Request('https://test.invalid', {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  }));
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
  assert.notEqual(response.headers.get('Access-Control-Allow-Origin'), 'https://evil.example');
});

test('B1: respuestas normales conservan el origen permitido y clientes sin Origin siguen admitidos', async () => {
  const { endpoint } = await loadSharedModule();
  const handler = endpoint(async () => new Response('{"ok":true}', {
    headers: { 'Content-Type': 'application/json' },
  }));

  const browser = await handler(new Request('https://test.invalid', {
    method: 'POST',
    headers: { Origin: 'https://www.gestiondehotel.com' },
  }));
  assert.equal(browser.status, 200);
  assert.equal(browser.headers.get('Access-Control-Allow-Origin'), 'https://www.gestiondehotel.com');

  const server = await handler(new Request('https://test.invalid', { method: 'POST' }));
  assert.equal(server.status, 200);
  assert.equal(server.headers.get('Access-Control-Allow-Origin'), 'https://gestiondehotel.com');
});

test('B1: lifecycle bloquea el origen antes de crear el cliente privilegiado', () => {
  const lifecycle = source('supabase/functions/manage-user-lifecycle/index.ts');
  const originGuard = lifecycle.indexOf('isAllowedUserManagementOrigin(origin)');
  const privilegedClient = lifecycle.indexOf('const admin = createClient');
  assert.ok(originGuard > -1 && privilegedClient > -1 && originGuard < privilegedClient);
});
