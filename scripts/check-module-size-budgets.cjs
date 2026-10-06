const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const MODULE_SIZE_BUDGETS = Object.freeze([
  {
    file: 'js/modules/reservas/reservas.js',
    maxLines: 3289,
    reason: 'El orquestador de Reservas debe reducirse mediante extracciones, no volver a crecer.'
  }
]);

function countSourceLines(source) {
  const lines = String(source).split(/\r\n|\n|\r/);
  if (lines.at(-1) === '') lines.pop();
  return lines.length;
}

function checkModuleSizeBudgets(rootDir = resolve(__dirname, '..')) {
  return MODULE_SIZE_BUDGETS.map((budget) => {
    const lines = countSourceLines(readFileSync(resolve(rootDir, budget.file), 'utf8'));
    return { ...budget, lines, ok: lines <= budget.maxLines };
  });
}

if (require.main === module) {
  const results = checkModuleSizeBudgets();
  for (const result of results) {
    const marker = result.ok ? 'OK' : 'FAIL';
    console.log(`[${marker}] ${result.file}: ${result.lines}/${result.maxLines} lineas`);
    if (!result.ok) console.error(`  ${result.reason}`);
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1;
}

module.exports = { MODULE_SIZE_BUDGETS, checkModuleSizeBudgets, countSourceLines };
