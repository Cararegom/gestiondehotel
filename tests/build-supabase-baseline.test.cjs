const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('build-supabase-baseline genera un baseline reutilizable', () => {
  const rootDir = path.resolve(__dirname, '..');
  const outputDir = path.join(rootDir, 'tests', 'tmp');
  const outputFile = path.join(outputDir, 'generated-baseline.sql');

  fs.mkdirSync(outputDir, { recursive: true });

  execFileSync(process.execPath, [
    path.join(rootDir, 'scripts', 'build-supabase-baseline.js'),
    outputFile
  ], {
    cwd: rootDir,
    stdio: 'pipe'
  });

  assert.equal(fs.existsSync(outputFile), true, 'El baseline temporal debe existir');
  const sql = fs.readFileSync(outputFile, 'utf8');
  assert.match(sql, /CREATE TABLE\s+"public"\."hoteles"/i);
  assert.match(sql, /CREATE TABLE\s+"public"\."usuarios"/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.cambiar_habitacion_transaccion/i);

  fs.rmSync(outputFile, { force: true });
});
