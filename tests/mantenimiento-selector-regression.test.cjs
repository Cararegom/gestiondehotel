const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const workflow = fs.readFileSync('js/modules/mantenimiento/mantenimiento-workflow-ui.js', 'utf8');

test('mantenimiento no usa clases Tailwind decimales dentro de querySelector', () => {
  assert.doesNotMatch(workflow, /querySelector\([^\n]*gap-1(?:\\)?\.5/);
  assert.match(workflow, /querySelector\('\.mb-2\.flex\.flex-wrap\.items-center'\)/);
});
