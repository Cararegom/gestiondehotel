const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(
  path.join(root, 'supabase/functions/bank-email-deploy-manifest.json'),
  'utf8'
));

const edgePaths = [
  'supabase/functions/bank-email-api/index.ts',
  'supabase/functions/gmail-oauth-callback/index.ts',
  'supabase/functions/gmail-webhook/index.ts',
  'supabase/functions/gmail-watch-renew/index.ts'
];

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Fase 21: logs Edge conservan solo codigos/acciones y no exponen secretos o cuerpo de correo', () => {
  const sources = [
    ...edgePaths.map(read),
    read('supabase/functions/_shared/bank-email/payment-service.ts')
  ].join('\n');

  const logStatements = [...sources.matchAll(/console\.(?:error|warn|log)\([^;]+\);/gs)]
    .map((match) => match[0]);
  assert.ok(logStatements.length >= 5, 'deben existir logs operativos estructurados');

  for (const statement of logStatements) {
    assert.doesNotMatch(statement, /textBody|htmlBody|email_subject|authorization|accessToken|refreshToken|raw_content|transaction_reference\b/i);
    assert.match(statement, /\{\s*(?:code|action)\s*:/i);
  }
});

test('Fase 22: manifiesto fija funciones, autenticacion y variables obligatorias', () => {
  assert.deepEqual(manifest.requiredEnvironment, [
    'BANK_EMAIL_INTEGRATION_ENABLED',
    'BANK_EMAIL_PILOT_HOTEL_ID',
    'BANK_EMAIL_PILOT_HOTEL_NAME'
  ]);
  assert.deepEqual(
    manifest.functions.map((item) => [item.name, item.verifyJwt, item.authentication]),
    [
      ['bank-email-api', true, 'supabase-jwt'],
      ['gmail-oauth-callback', false, 'oauth-state'],
      ['gmail-webhook', false, 'google-pubsub-oidc'],
      ['gmail-watch-renew', false, 'cron-secret']
    ]
  );
});

test('Fase 22: las cuatro Edge Functions usan el gate de configuracion/UUID sin confiar en el navegador', () => {
  const config = read('supabase/functions/_shared/bank-email/config.ts');
  const pilot = read('supabase/functions/_shared/bank-email/pilot-hotel.ts');
  const api = read(edgePaths[0]);
  const oauth = read(edgePaths[1]);
  const webhook = read(edgePaths[2]);
  const renew = read(edgePaths[3]);

  assert.match(config, /BANK_EMAIL_PILOT_HOTEL_ID/);
  assert.match(config, /UUID_PATTERN\.test\(config\.pilotHotelId/);
  assert.match(pilot, /\.eq\("id", configuredId\)/);
  assert.match(api, /assertBankEmailConfig\(config\)/);
  assert.match(oauth, /isBankEmailProcessingEnabled\(config\)/);
  assert.match(webhook, /isBankEmailProcessingEnabled\(config\)/);
  assert.match(renew, /isBankEmailProcessingEnabled\(config\)/);
});

test('Fase 24: checklist A-H permanece versionado y exige aislamiento de tenant', () => {
  const checklist = read('docs/conciliacion-bancaria-v2/11-checklist-produccion.md');
  for (const letter of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    assert.match(checklist, new RegExp(`- \\[ \\] ${letter}\\.`));
  }
  assert.match(checklist, /Otro hotel no ve ni puede inferir ninguna parte del piloto/i);
  assert.match(checklist, /Logs sin secretos ni cuerpo de email/i);
  assert.match(checklist, /Auditoría contiene actor, hotel, acción, motivo y before\/after mínimos/i);
});
