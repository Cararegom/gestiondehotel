const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const snapshotPath = path.join(rootDir, 'supabase', 'snapshots', 'database-context.json');
const functionsPath = path.join(rootDir, 'supabase', 'snapshots', 'public-functions.json');
const outputPath = path.join(rootDir, 'docs', 'supabase-rls-audit.md');

main();

function main() {
  const context = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const functions = JSON.parse(fs.readFileSync(functionsPath, 'utf8'));
  const publicSchema = context.databases
    .find((database) => database.name === 'postgres')
    ?.schemas.find((schema) => schema.name === 'public');

  if (!publicSchema) {
    throw new Error('No se encontro el schema public en el snapshot.');
  }

  const tables = publicSchema.tables || [];
  const tablesWithoutRls = tables
    .filter((table) => !table.is_rls_enabled)
    .map((table) => table.name)
    .sort();
  const tablesWithRlsNoPolicies = tables
    .filter((table) => table.is_rls_enabled && (!table.policies || table.policies.length === 0))
    .map((table) => table.name)
    .sort();
  const policyCounts = tables
    .map((table) => ({
      name: table.name,
      rls: !!table.is_rls_enabled,
      policies: table.policies?.length || 0
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const securityDefinerFunctions = functions
    .filter((fn) => /SECURITY DEFINER/i.test(fn.definition || ''))
    .map((fn) => `${fn.proname}(${fn.args})`)
    .sort((a, b) => a.localeCompare(b, 'es'));

  const markdown = [
    '# Auditoria RLS y Permisos',
    '',
    `Generado: ${new Date().toISOString()}`,
    '',
    '## Resumen',
    '',
    `- Tablas analizadas en \`public\`: ${tables.length}`,
    `- Tablas sin RLS: ${tablesWithoutRls.length}`,
    `- Tablas con RLS pero sin politicas: ${tablesWithRlsNoPolicies.length}`,
    `- Funciones \`SECURITY DEFINER\`: ${securityDefinerFunctions.length}`,
    '',
    '## Tablas Sin RLS',
    '',
    tablesWithoutRls.length
      ? tablesWithoutRls.map((table) => `- ${table}`).join('\n')
      : '- Ninguna.',
    '',
    '## Tablas Con RLS Pero Sin Politicas',
    '',
    tablesWithRlsNoPolicies.length
      ? tablesWithRlsNoPolicies.map((table) => `- ${table}`).join('\n')
      : '- Ninguna.',
    '',
    '## Cobertura Por Tabla',
    '',
    '| Tabla | RLS | Politicas |',
    '| --- | --- | ---: |',
    ...policyCounts.map((item) => `| ${item.name} | ${item.rls ? 'Si' : 'No'} | ${item.policies} |`),
    '',
    '## Funciones SECURITY DEFINER',
    '',
    securityDefinerFunctions.length
      ? securityDefinerFunctions.map((signature) => `- ${signature}`).join('\n')
      : '- Ninguna.',
    '',
    '## Observaciones',
    '',
    '- Este reporte se genera a partir de los snapshots versionados en `supabase/snapshots`.',
    '- Las tablas sin RLS o con RLS sin politicas deben revisarse antes de exponer nuevos flujos sensibles.',
    '- La consola SaaS usa esta misma linea de auditoria para resumir cobertura de seguridad.'
  ].join('\n');

  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(JSON.stringify({
    outputPath,
    tables: tables.length,
    tablesWithoutRls: tablesWithoutRls.length,
    tablesWithRlsNoPolicies: tablesWithRlsNoPolicies.length,
    securityDefinerFunctions: securityDefinerFunctions.length
  }, null, 2));
}

