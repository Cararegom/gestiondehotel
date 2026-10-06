// Compila tailwind.css con Tailwind CSS v4 usando la API de @tailwindcss/node.
// Se evita @tailwindcss/cli porque arrastra @parcel/watcher -> micromatch -> braces,
// que tiene una vulnerabilidad alta sin version corregida. Mismo flujo que la CLI
// y el plugin de Vite: compile -> Scanner (sources) -> build -> optimize.
import fs from 'node:fs/promises';
import path from 'node:path';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

const root = process.cwd();
const input = path.resolve(root, 'css/tailwind-source.css');
const output = path.resolve(root, 'tailwind.css');
const minify = !process.argv.includes('--no-minify');

const css = await fs.readFile(input, 'utf8');
const compiler = await compile(css, {
  base: path.dirname(input),
  onDependency: () => {},
});

const rootSources = compiler.root === 'none'
  ? []
  : compiler.root === null
    ? [{ base: root, pattern: '**/*', negated: false }]
    : [{ ...compiler.root, negated: false }];

const scanner = new Scanner({ sources: [...rootSources, ...compiler.sources] });
const candidates = scanner.scan();
const built = compiler.build(candidates);
const { code } = optimize(built, { file: input, minify });

await fs.writeFile(output, code);
console.log(`tailwind.css generado: ${candidates.length} candidatos, ${(code.length / 1024).toFixed(1)} KB`);
