const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const ROOT = process.cwd();
const ENERGY_FILES = [
  'js/modules/control-energia/control-energia.js',
  'js/modules/control-energia/control-energia-20260902.js'
];

function checkAsEsm(relativePath) {
  const absolutePath = join(ROOT, relativePath);
  const source = readFileSync(absolutePath, 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module', '--check'], {
    input: source,
    encoding: 'utf8'
  });
  return {
    status: result.status,
    output: result.stderr || result.stdout || ''
  };
}

test('Control de Energía parsea como módulo ES real', () => {
  for (const file of ENERGY_FILES) {
    const result = checkAsEsm(file);
    assert.equal(result.status, 0, `${file} tiene error de sintaxis ESM:\n${result.output}`);
  }
});

test('asset publicado usa cache-bust posterior al hotfix', () => {
  const html = readFileSync(join(ROOT, 'app/index.html'), 'utf8');
  assert.match(html, /control-energia-20260902\.js\?v=2/);
});
