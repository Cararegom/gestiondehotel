import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsRoot = path.join(root, 'js');
const findings = [];
const rules = [
  ['increment_rpc', /\.rpc\(\s*['"]increment['"]/g],
  ['delete_cash_rpc', /\.rpc\(\s*['"]registrar_y_eliminar_mov_caja['"]/g],
  ['fixed_terrace_hotel', /38373fa5-b953-4aa9-b4e9-25b9739be5f2/g],
  ['direct_payment_insert', /\.from\(\s*['"]pagos_reserva['"]\s*\)\s*\.insert\s*\(/gs],
  ['direct_cash_delete', /\.from\(\s*['"]caja['"]\s*\)\s*\.delete\s*\(/gs],
  ['direct_payment_delete', /\.from\(\s*['"]pagos_reserva['"]\s*\)\s*\.delete\s*\(/gs],
  ['direct_restaurant_insert', /\.from\(\s*['"]ventas_restaurante(?:_items)?['"]\s*\)\s*\.insert\s*\(/gs]
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(target);
    else if (entry.isFile() && target.endsWith('.js')) inspect(target);
  }
}

function inspect(file) {
  const source = fs.readFileSync(file, 'utf8');
  for (const [rule, regex] of rules) {
    regex.lastIndex = 0;
    for (const match of source.matchAll(regex)) {
      const line = source.slice(0, match.index).split(/\r?\n/).length;
      findings.push({ rule, file: path.relative(root, file).replaceAll('\\', '/'), line });
    }
  }
}

walk(jsRoot);
const counts = Object.fromEntries(rules.map(([name]) => [name, findings.filter((x) => x.rule === name).length]));
const report = { generated_at: new Date().toISOString(), migration_10_allowed: findings.length === 0, counts, findings };
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exitCode = findings.length === 0 ? 0 : 2;
