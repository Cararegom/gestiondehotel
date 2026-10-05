const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const script = fs.readFileSync('scripts/vercel-staging-preflight.ps1', 'utf8');
const docs = fs.readFileSync('docs/deploy/vercel-staging-preflight.md', 'utf8');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

test('preflight de staging Vercel no despliega ni toca produccion', () => {
  assert.equal(pkg.scripts['vercel:staging:preflight'], 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/vercel-staging-preflight.ps1');
  assert.match(script, /vercel whoami/);
  assert.match(script, /cmd \/c/);
  assert.match(script, /PSNativeCommandUseErrorActionPreference/);
  assert.match(script, /npm run build/);
  assert.match(script, /project\.json/);
  assert.match(script, /repo\.json/);
  assert.doesNotMatch(script, /&\s+.*vercel\s+deploy/i);
  assert.doesNotMatch(script, /cmd \/c .*vercel\s+deploy/i);
  assert.doesNotMatch(script, /--prod/i);
  assert.match(docs, /No crea deployments/);
  assert.match(docs, /Producción requiere aprobación separada/);
  assert.match(docs, /gestiondehotel-l3nsj335u-cararegoms-projects\.vercel\.app/);
});
