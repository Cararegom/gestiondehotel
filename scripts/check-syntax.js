const { spawnSync } = require('node:child_process');
const { readdirSync, statSync } = require('node:fs');
const { join, extname } = require('node:path');

const ROOT = process.cwd();
const TARGET_DIRS = ['js', 'scripts', 'tests'];
const VALID_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function walk(dirPath, results = []) {
  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'archive' || entry.name === 'node_modules') continue;
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, results);
      continue;
    }
    if (VALID_EXTENSIONS.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = TARGET_DIRS
  .map((dir) => join(ROOT, dir))
  .filter((dir) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  })
  .flatMap((dir) => walk(dir));

if (!files.length) {
  console.log('No se encontraron archivos para validar.');
  process.exit(0);
}

const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'pipe', encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push({ file, stderr: result.stderr || result.stdout || 'Error de sintaxis' });
  }
}

if (failures.length) {
  console.error('Se encontraron errores de sintaxis:\n');
  failures.forEach((failure) => {
    console.error(`- ${failure.file}`);
    console.error(failure.stderr.trim());
    console.error('');
  });
  process.exit(1);
}

console.log(`Sintaxis validada en ${files.length} archivos.`);
