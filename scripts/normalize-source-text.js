const fs = require('fs');
const path = require('path');

const replacements = [
  ['\u00C2\u00A1', '¡'],
  ['\u00C2\u00BF', '¿'],
  ['\u00C2\u00B0', '°'],
  ['\u00C2\u00B7', '·'],
  ['\u00C3\u00A1', 'á'],
  ['\u00C3\u00A9', 'é'],
  ['\u00C3\u00AD', 'í'],
  ['\u00C3\u00B3', 'ó'],
  ['\u00C3\u00BA', 'ú'],
  ['\u00C3\u0081', 'Á'],
  ['\u00C3\u0089', 'É'],
  ['\u00C3\u008D', 'Í'],
  ['\u00C3\u0093', 'Ó'],
  ['\u00C3\u009A', 'Ú'],
  ['\u00C3\u00B1', 'ñ'],
  ['\u00C3\u0091', 'Ñ'],
  ['\u00C3\u00BC', 'ü'],
  ['\u00C3\u009C', 'Ü'],
  ['\u00F0\u0178\u2018\u00A4', '👤'],
  ['\u00F0\u0178\u201D\u2019', '🔒'],
  ['\u00F0\u0178\u201C\u00A6', '📦'],
  ['\u00F0\u0178\u201D\u008D', '🔍'],
  ['\u00E2\u0153\u201D\u00EF\u00B8\u008F', '✔️'],
  ['\u00E2\u008F\u00B3', '⏳'],
  ['\u00E2\u009D\u0152', '❌'],
  ['\u00E2\u009A\u00A0\u00EF\u00B8\u008F', '⚠️'],
  ['\u00E2\u0080\u00A2', '•']
];

function normalizeContent(content) {
  return replacements.reduce((output, [from, to]) => output.split(from).join(to), content);
}

const files = process.argv.slice(2);

if (!files.length) {
  console.error('Usage: node scripts/normalize-source-text.js <file> [file...]');
  process.exit(1);
}

for (const relativeFile of files) {
  const target = path.resolve(process.cwd(), relativeFile);
  const original = fs.readFileSync(target, 'utf8');
  const normalized = normalizeContent(original);
  if (normalized !== original) {
    fs.writeFileSync(target, normalized, 'utf8');
    console.log(`normalized: ${relativeFile}`);
  } else {
    console.log(`unchanged: ${relativeFile}`);
  }
}
