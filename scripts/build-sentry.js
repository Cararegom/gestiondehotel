const { build } = require('esbuild');
const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');
const config = require('../sentry.config.json');

const root = resolve(__dirname, '..');
const dsn = new URL(config.dsn);
if (dsn.protocol !== 'https:' || !dsn.username || dsn.password || !/^\/[0-9]+$/.test(dsn.pathname)) {
  throw new Error('La configuracion Sentry necesita un DSN publico HTTPS valido.');
}
let revision = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA;
if (!revision) {
  try { revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { revision = 'local'; }
}
// Only this public DSN and the revision enter the bundle. No environment dump
// or Sentry auth token is read, embedded, or required by a production build.
build({
  absWorkingDir: root,
  entryPoints: ['js/monitoring/sentry-entry.mjs'],
  outfile: 'js/sentry-browser.js',
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  legalComments: 'eof',
  define: { __SENTRY_RELEASE__: JSON.stringify(`gestiondehotel@${revision}`) },
}).then(() => console.log('SDK Sentry compilado localmente.')).catch(() => {
  console.error('No se pudo compilar el SDK Sentry.');
  process.exitCode = 1;
});
