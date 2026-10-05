const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const mobile = fs.readFileSync('js/modules/mantenimiento/mantenimiento-mobile-ui.js', 'utf8');
const workflow = fs.readFileSync('js/modules/mantenimiento/mantenimiento-workflow-ui.js', 'utf8');

test('B8 usa el estado canonico en el formulario base de mantenimiento', () => {
  assert.match(mobile, /const currentState = normalizeTaskState\(normalized\?\.estado \|\| TASK_STATES\.pendiente\)/);
  assert.match(mobile, /name="estado_display"[^>]*disabled[^>]*>[\s\S]*?getStatusMeta\(currentState\)\.text/);
  assert.match(mobile, /type="hidden" name="estado" value="\$\{escapeHtml\(currentState\)\}"/);
  assert.match(mobile, /const state = normalizeTaskState\(data\.estado \|\| TASK_STATES\.pendiente\)/);
  assert.match(mobile, /estado: state/);
});

test('B8 retira el vocabulario legado del selector y la neutralizacion duplicada', () => {
  const modalStateField = mobile.match(/<label class="mb-1 block text-sm font-bold">Estado<\/label>([\s\S]*?)<\/div><div><label class="mb-1 block text-sm font-bold">Fecha programada/);
  assert.ok(modalStateField, 'No se encontro el campo de estado del modal base');
  assert.doesNotMatch(modalStateField[1], /en_progreso|completada|cancelada/);
  assert.doesNotMatch(workflow, /stateSelect\.innerHTML|stateSelect\.disabled|insertAdjacentElement\('afterend', hidden\)/);
});

test('B8 conserva metadatos de cierre con el estado canonico', () => {
  assert.match(mobile, /const completed = state === TASK_STATES\.cerrado/);
  assert.match(mobile, /normalizeTaskState\(task\.estado\) === TASK_STATES\.cerrado/);
});
