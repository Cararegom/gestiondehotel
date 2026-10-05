const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const functionsRoot = path.join(root, 'supabase/functions');
const manifestPath = path.join(functionsRoot, 'bank-email-deploy-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const supabaseConfig = fs.readFileSync(path.join(root, 'supabase/config.toml'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const ciWorkflow = fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8');

const EXPECTED_FUNCTIONS = [
  'bank-email-api',
  'bank-payment-relation-api',
  'gmail-oauth-callback',
  'gmail-webhook',
  'gmail-watch-renew'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceFor(contract) {
  return read(contract.entrypoint);
}

function configuredVerifyJwt(functionName) {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `\\[functions\\.${escaped}\\]([\\s\\S]*?)(?=\\n\\[|$)`,
    'u'
  ).exec(supabaseConfig);
  assert.ok(match, `Falta la seccion explicita de ${functionName} en supabase/config.toml`);
  const verifyMatch = /verify_jwt\s*=\s*(true|false)/u.exec(match[1]);
  assert.ok(verifyMatch, `Falta verify_jwt para ${functionName}`);
  return verifyMatch[1] === 'true';
}

function importedSharedModules(source) {
  return new Set(
    [...source.matchAll(/from ['"]\.\.\/_shared\/bank-email\/([^'"]+)['"]/gu)]
      .map((match) => match[1])
  );
}

test('M2 manifiesta exactamente las cinco Edge Functions que consumen el nucleo bancario', () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.deepEqual(manifest.functions.map((item) => item.name), EXPECTED_FUNCTIONS);

  const actualConsumers = fs.readdirSync(functionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_shared')
    .map((entry) => path.join(functionsRoot, entry.name, 'index.ts'))
    .filter((entrypoint) => fs.existsSync(entrypoint))
    .filter((entrypoint) => fs.readFileSync(entrypoint, 'utf8').includes('_shared/bank-email/'))
    .map((entrypoint) => path.basename(path.dirname(entrypoint)))
    .sort();

  assert.deepEqual(actualConsumers, [...EXPECTED_FUNCTIONS].sort());
});

test('M2 fija entrypoint, metodos y modulos compartidos requeridos por funcion', () => {
  for (const contract of manifest.functions) {
    const absoluteEntrypoint = path.join(root, contract.entrypoint);
    assert.equal(fs.existsSync(absoluteEntrypoint), true, `No existe ${contract.entrypoint}`);

    const source = sourceFor(contract);
    assert.equal((source.match(/Deno\.serve\(/gu) || []).length, 1, `${contract.name} debe registrar un handler`);
    assert.ok(Array.isArray(contract.methods) && contract.methods.length > 0);
    assert.ok(Array.isArray(contract.requiredSharedModules) && contract.requiredSharedModules.length > 0);

    for (const method of contract.methods) {
      if (method === 'OPTIONS') assert.match(source, /req\.method === 'OPTIONS'/u, contract.name);
      else assert.match(source, new RegExp(`req\\.method !== '${method}'`, 'u'), contract.name);
    }

    const imports = importedSharedModules(source);
    for (const sharedModule of contract.requiredSharedModules) {
      assert.equal(imports.has(sharedModule), true, `${contract.name} debe importar ${sharedModule}`);
      assert.equal(
        fs.existsSync(path.join(functionsRoot, '_shared/bank-email', sharedModule)),
        true,
        `No existe el modulo compartido ${sharedModule}`
      );
    }
  }
});

test('M2 alinea verify_jwt y la autenticacion interna de cada endpoint', () => {
  const authPatterns = {
    'bank-email-api': [/requireAuthenticatedProfile\(req, admin\)/u, /assertSamePilotHotel/u],
    'bank-payment-relation-api': [/requireAuthenticatedProfile\(req, admin\)/u, /isPilotOperationalUser/u],
    'gmail-oauth-callback': [/hashOAuthState\(state\)/u, /\.is\('consumed_at', null\)/u, /oauth_state_replayed/u],
    'gmail-webhook': [/verifyPubSubOidc\(req\)/u, /pubsub_unauthorized/u],
    'gmail-watch-renew': [/cronAuthorized\(req\)/u, /constantTimeEqual/u, /x-cron-secret/u]
  };

  for (const contract of manifest.functions) {
    assert.equal(configuredVerifyJwt(contract.name), contract.verifyJwt, contract.name);
    const source = sourceFor(contract);
    for (const pattern of authPatterns[contract.name]) assert.match(source, pattern, contract.name);
  }
});

test('M2 conserva apagado seguro y errores publicos sin detalles internos', () => {
  const errorContracts = {
    'json-safe-code': [/safeErrorCode/u, /jsonResponse/u],
    'oauth-redirect-safe-code': [/safeErrorCode/u, /redirectResult/u],
    'empty-ack-or-safe-code': [/safeErrorCode/u, /emptyResponse/u]
  };

  for (const contract of manifest.functions) {
    const source = sourceFor(contract);
    assert.match(source, /readBankEmailConfig\(\)/u, contract.name);
    for (const pattern of errorContracts[contract.errorMode]) assert.match(source, pattern, contract.name);
    assert.doesNotMatch(source, /JSON\.stringify\(error\)|message:\s*error\.message/u, contract.name);
  }

  assert.match(sourceFor(manifest.functions[0]), /config\.enabled/u);
  assert.match(sourceFor(manifest.functions[1]), /isBankEmailProcessingEnabled\(config\)/u);
  for (const contract of manifest.functions.slice(2)) {
    assert.match(sourceFor(contract), /isBankEmailProcessingEnabled\(config\)/u, contract.name);
  }
});

test('M2 obliga a compilar y lintar los cinco consumidores cuando cambia _shared', () => {
  const typecheck = String(packageJson.scripts?.typecheck || '');
  const lint = String(packageJson.scripts?.lint || '');

  for (const contract of manifest.functions) {
    assert.match(typecheck, new RegExp(contract.entrypoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
    const functionDirectory = contract.entrypoint.replace(/\/index\.ts$/u, '');
    assert.match(lint, new RegExp(functionDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  }
  assert.match(lint, /supabase\/functions\/_shared\/bank-email/u);
  assert.match(ciWorkflow, /run:\s*npm run typecheck/u);
  assert.match(ciWorkflow, /run:\s*npm run lint/u);
  assert.match(ciWorkflow, /run:\s*npm test/u);
});
