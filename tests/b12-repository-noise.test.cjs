const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const faqDirectory = path.join(root, 'js', 'modules', 'faq');

test('B12: el árbol activo no conserva videos locales sin consumidores ni archivos RAR', () => {
  const localVideos = fs.readdirSync(faqDirectory)
    .filter((name) => name.toLowerCase().endsWith('.mp4'));
  const rootArchives = fs.readdirSync(root)
    .filter((name) => name.toLowerCase().endsWith('.rar'));

  assert.deepEqual(localVideos, []);
  assert.deepEqual(rootArchives, []);
});

test('B12: FAQ conserva tutoriales remotos y miniaturas locales', () => {
  const faqSource = fs.readFileSync(path.join(faqDirectory, 'faq.js'), 'utf8');

  assert.match(faqSource, /data-video-src="https:\/\/drive\.google\.com\//);
  assert.match(faqSource, /Tienda_thumbnail\.png/);
  assert.match(faqSource, /Restaurante_thumbnail\.png/);
  assert.doesNotMatch(faqSource, /data-video-src="[^"]+\.mp4/);
});

test('B12: Git y Vercel previenen la reincorporación de los artefactos retirados', () => {
  const gitIgnore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  const vercelIgnore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8');

  assert.match(gitIgnore, /^\*\.rar$/m);
  assert.match(gitIgnore, /^js\/modules\/faq\/\* - copia\.mp4$/m);
  assert.match(vercelIgnore, /^\*\.rar$/m);
  assert.match(vercelIgnore, /^js\/modules\/faq\/\*\.mp4$/m);
});
