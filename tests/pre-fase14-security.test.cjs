const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('safeLogger redacta tokens, sesiones, correos y UUID completos', () => {
  const calls = [];
  const context = {
    console: Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map((level) => [level, (...args) => calls.push(args)]))
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/safeLogger.js'), 'utf8'), context);
  context.console.log({
    access_token: 'eyJabcdefghij.eyJabcdefghij.abcdefghij',
    nested: { email: 'persona@example.com', hotel_id: 'a32ecc1f-9821-4448-8d36-8463bf542149' }
  });
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /eyJabcdefghij|persona@example\.com|a32ecc1f-9821-4448-8d36-8463bf542149/);
  assert.match(serialized, /REDACTED/);
});

test('no se registran clientes Supabase, sesiones, usuarios completos ni correos en el frontend', () => {
  const productionFiles = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.js')) productionFiles.push(absolute);
    }
  };
  visit(path.join(root, 'js'));
  productionFiles.push(path.join(root, 'script.js'));
  const source = productionFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  assert.doesNotMatch(source, /console\.(?:log|debug|info)\([^\n]*(?:supabaseInstance\s*\)|session\??\.|currentUser\.email|appUser\s*\?\s*appUser\.email)/i);
  assert.doesNotMatch(source, /console\.(?:log|debug|info)\([^\n]*(?:currentModuleUser|insertData|event\.detail)/i);
  assert.doesNotMatch(source, /DEBUG main\.js|DEBUG: supabaseInstance/);
});

test('ChatKit no se precarga globalmente y conserva carga bajo demanda', () => {
  const appHtml = fs.readFileSync(path.join(root, 'app/index.html'), 'utf8');
  const landingHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const support = fs.readFileSync(path.join(root, 'js/app-support-chat.js'), 'utf8');
  assert.doesNotMatch(appHtml, /cdn\.platform\.openai\.com/);
  assert.doesNotMatch(landingHtml, /preload[^>]+chatkit|<script[^>]+chatkit\/chatkit\.js/i);
  assert.match(support, /function ensureChatKitScript\(/);
  assert.doesNotMatch(support, /requestIdleCallback\(\(\) => warmUpChat/);
});

test('las CSP de entrada no permiten unsafe-eval', () => {
  const files = ['app/index.html', 'login.html', 'password-reset.html', 'solicitar-recuperacion.html'];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(source, /'unsafe-eval'/, file);
  }
});

test('authService expone un contrato estructurado y deduplica INITIAL_SESSION', () => {
  const source = fs.readFileSync(path.join(root, 'js/authService.js'), 'utf8');
  assert.match(source, /Object\.freeze\(\{ event, session, user: currentUser \}\)/);
  assert.match(source, /event === 'INITIAL_SESSION' && initialSessionResolved/);
  assert.doesNotMatch(source, /listener\(currentUser, session\)|callback\(user, session\)/);
});
