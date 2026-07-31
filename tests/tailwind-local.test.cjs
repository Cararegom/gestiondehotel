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
  assert.match(css, /\.bg-opacity-75\{/);
  assert.match(css, /\.text-gray-500\{/);
  assert.match(css, /\.space-y-6>/);
});
