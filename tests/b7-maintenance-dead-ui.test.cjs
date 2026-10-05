const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const maintenanceDir = path.join(root, 'js/modules/mantenimiento');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('B7 retira la implementacion desktop que no tenia consumidores', () => {
  assert.equal(fs.existsSync(path.join(maintenanceDir, 'mantenimiento-ui.js')), false);

  const runtimeFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.name.endsWith('.js')) runtimeFiles.push(entryPath);
    }
  };
  visit(path.join(root, 'js'));

  const references = runtimeFiles.filter((filePath) => (
    fs.readFileSync(filePath, 'utf8').includes('mantenimiento-ui.js')
  ));
  assert.deepEqual(references, []);
});

test('B7 fija la cadena de montaje activa de mantenimiento', () => {
  assert.match(
    read('js/main.js'),
    /import\('\.\/modules\/mantenimiento\/mantenimiento\.js'\)/,
  );
  assert.match(
    read('js/modules/mantenimiento/mantenimiento.js'),
    /from '\.\/mantenimiento-analytics-ui\.js'/,
  );
  assert.match(
    read('js/modules/mantenimiento/mantenimiento-analytics-ui.js'),
    /from '\.\/mantenimiento-workflow-ui\.js'/,
  );
  assert.match(
    read('js/modules/mantenimiento/mantenimiento-workflow-ui.js'),
    /from '\.\/mantenimiento-mobile-ui\.js'/,
  );
});
