const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('generate-rls-audit produce un informe legible', () => {
  const rootDir = path.resolve(__dirname, '..');
  const outputPath = path.join(rootDir, 'docs', 'supabase-rls-audit.md');

  execFileSync(process.execPath, [
    path.join(rootDir, 'scripts', 'generate-rls-audit.js')
  ], {
    cwd: rootDir,
    stdio: 'pipe'
  });

  const markdown = fs.readFileSync(outputPath, 'utf8');
  assert.match(markdown, /# Auditoria RLS y Permisos/i);
  assert.match(markdown, /## Resumen/i);
  assert.match(markdown, /## Funciones SECURITY DEFINER/i);
  assert.match(markdown, /eventos_sistema/i);
});

