// Servidor de verificacion local: expone solo la pagina sintetica y su bundle.
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const files = {
  '/': ['tests/fixtures/sentry-check.html', 'text/html; charset=utf-8'],
  '/js/sentry-browser.js': ['js/sentry-browser.js', 'text/javascript; charset=utf-8'],
};
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  if (path === '/operation') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{"synthetic":true}');
    return;
  }
  const file = files[path];
  if (!file) { response.writeHead(404); response.end(); return; }
  try {
    const content = await readFile(resolve(__dirname, '..', file[0]));
    response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(500); response.end('Ejecutar npm run build:sentry primero.');
  }
});
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/`));
