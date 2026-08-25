const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('legacy gate authorizes migration 10 after removing all direct financial callers', () => {
  const run = spawnSync(process.execPath, ['scripts/fase1-legacy-gate.mjs'], { encoding: 'utf8' });
  assert.equal(run.status, 0);
  const report = JSON.parse(run.stdout);
  assert.equal(report.migration_10_allowed, true);
  assert.deepEqual(report.findings, []);
  assert.ok(Object.values(report.counts).every((count) => count === 0));
});
