const test = require('node:test');
const assert = require('node:assert/strict');
const { resolve } = require('node:path');
const {
  MODULE_SIZE_BUDGETS,
  checkModuleSizeBudgets,
  countSourceLines
} = require('../scripts/check-module-size-budgets.cjs');

test('M16 mide lineas de forma estable en LF y CRLF', () => {
  assert.equal(countSourceLines('uno\ndos\n'), 2);
  assert.equal(countSourceLines('uno\r\ndos\r\n'), 2);
  assert.equal(countSourceLines('uno\rdos'), 2);
});

test('M16 impide que reservas.js supere la linea base auditada', () => {
  const results = checkModuleSizeBudgets(resolve(__dirname, '..'));
  const reservas = results.find((result) => result.file === 'js/modules/reservas/reservas.js');

  assert.ok(reservas);
  assert.equal(reservas.maxLines, 3289);
  assert.equal(reservas.lines, 3289);
  assert.equal(reservas.ok, true);
  assert.equal(MODULE_SIZE_BUDGETS.length, 1);
});
