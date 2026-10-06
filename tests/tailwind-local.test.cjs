const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('login y aplicación cargan Tailwind desde el mismo dominio', () => {
  const login = fs.readFileSync(path.join(root, 'login.html'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'tailwind.css'), 'utf8');

  assert.doesNotMatch(login, /cdn\.tailwindcss\.com/);
  assert.doesNotMatch(app, /cdn\.tailwindcss\.com/);
  assert.match(login, /href="\/tailwind\.css"/);
  assert.match(app, /href="\.\.\/tailwind\.css"/);

  assert.ok(css.length > 50000, 'el CSS compilado no debe estar vacío');
  assert.match(css, /tailwindcss v4\./);
  assert.match(css, /\.bg-black\\\/75\{/);
  assert.match(css, /\.text-gray-500\{/);
  assert.match(css, /:where\(\.space-y-6>:not\(:last-child\)\)\{/);
});

test('Tailwind v4 conserva la apariencia de v3 y no usa utilidades eliminadas', () => {
  const source = fs.readFileSync(path.join(root, 'css/tailwind-source.css'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'tailwind.css'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

  // Paleta y valores por defecto de v3.
  assert.match(source, /--color-blue-600: #2563eb;/);
  assert.match(source, /border-color: var\(--color-gray-200, currentcolor\);/);
  assert.match(source, /cursor: pointer;/);
  assert.match(css, /--color-blue-600:#2563eb/);

  // Sin la CLI v3 ni @tailwindcss/cli (arrastran braces vulnerable).
  assert.equal(pkg.devDependencies.tailwindcss3, undefined);
  assert.equal(pkg.devDependencies['@tailwindcss/cli'], undefined);
  assert.equal(pkg.scripts['build:tailwind'], 'node scripts/build-tailwind.mjs');

  // Utilidades de v3 que no existen en v4 no deben quedar en el codigo.
  const files = ['login.html', 'app/index.html'];
  const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).forEach((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(js|html)$/.test(entry.name)) files.push(rel);
  });
  walk('js');
  const legacy = /(^|[\s"'`])(?:[a-z0-9-]+:)*(?:bg|text|border|ring|divide|placeholder)-opacity-\d+(?=[\s"'`]|$)/m;
  const offenders = files.filter((file) => legacy.test(fs.readFileSync(path.join(root, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
