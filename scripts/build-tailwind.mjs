// Compila tailwind.css con Tailwind CSS v4 usando la API de @tailwindcss/node.
// Se evita @tailwindcss/cli porque arrastra @parcel/watcher -> micromatch -> braces,
// que tiene una vulnerabilidad alta sin version corregida. Mismo flujo que la CLI
// y el plugin de Vite: compile -> Scanner (sources) -> build -> optimize.
//
// Ademas se quitan los @layer del resultado. Tailwind v4 emite todo dentro de
// capas y en la cascada CSS cualquier regla sin capa (style.css, estilos de
// modulos) gana siempre a una con capa. Con v3 todo era sin capa y, como
// tailwind.css se carga despues de style.css, a igual especificidad ganaba
// Tailwind (p. ej. .hidden frente a reglas de display de style.css). Aplanar las
// capas conserva el orden interno (theme < base < utilities) y restaura ese
// comportamiento.
import fs from 'node:fs/promises';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { transform } from 'lightningcss';

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
const { code: optimized } = optimize(built, { file: input, minify: false });

// Quita "@layer a, b;" y desenvuelve "@layer x { ... }" respetando cadenas,
// comentarios y llaves anidadas.
function flattenLayers(source) {
  let out = '';
  let i = 0;
  const closers = []; // por cada llave abierta: true si pertenece a un @layer desenvuelto
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop);
      i = stop;
      continue;
    }
    if (ch === '@' && source.startsWith('@layer', i) && !/[\w-]/.test(source[i + 6] || '')) {
      let j = i + 6;
      while (j < source.length && source[j] !== '{' && source[j] !== ';') j += 1;
      if (source[j] === ';') { i = j + 1; continue; }
      closers.push(true);
      i = j + 1;
      continue;
    }
    if (ch === '{') { closers.push(false); out += ch; i += 1; continue; }
    if (ch === '}') {
      const isLayer = closers.pop();
      if (!isLayer) out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  if (closers.length) throw new Error('llaves desbalanceadas al aplanar @layer');
  return out;
}

const { code } = transform({
  filename: 'tailwind.css',
  code: Buffer.from(flattenLayers(optimized)),
  minify,
});

const result = code.toString();
if (/@layer\b/.test(result)) throw new Error('tailwind.css todavia contiene @layer');
await fs.writeFile(output, result);
console.log(`tailwind.css generado: ${candidates.length} candidatos, ${(result.length / 1024).toFixed(1)} KB, sin @layer`);
