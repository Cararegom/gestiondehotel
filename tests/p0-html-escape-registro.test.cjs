const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const MALICIOUS = '<img src=x onerror="alert(1)">';

function installPrintStubs() {
  const written = [];
  const printWindow = {
    closed: false,
    document: {
      write: (html) => written.push(html),
      close: () => {}
    },
    focus: () => {},
    print: () => {},
    close: () => {}
  };
  global.window = {
    location: { origin: 'https://app.example.test' },
    open: () => printWindow,
    setTimeout: () => 0
  };
  return written;
}

function fakeSupabase(config) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: config, error: null })
  };
  return { from: () => query };
}

test('P0 tickets termicos muestran como texto los datos del hotel y del cliente', async () => {
  const written = installPrintStubs();
  const serviceUrl = pathToFileURL(path.join(root, 'js/services/thermalPrintService.js')).href;
  const { imprimirTicketOperacion } = await import(`${serviceUrl}?p0=${Date.now()}`);

  await imprimirTicketOperacion({
    supabase: fakeSupabase({
      nombre_hotel: `Hotel ${MALICIOUS}`,
      razon_social: MALICIOUS,
      encabezado_ticket_l1: MALICIOUS,
      pie_ticket: MALICIOUS,
      logo_url: 'javascript:alert(1)',
      mostrar_logo: true
    }),
    hotelId: 'hotel-a',
    documentLabel: 'Ticket POS Tienda',
    clientName: MALICIOUS,
    meta: [{ label: 'Habitación', value: MALICIOUS }],
    items: [{ nombre: MALICIOUS, cantidad: 1, total: 1000 }],
    payments: [{ label: MALICIOUS, amount: 1000 }],
    total: 1000,
    notes: MALICIOUS
  });

  assert.equal(written.length, 1);
  const html = written[0];
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /Ticket POS Tienda/);
  delete global.window;
});

test('P0 Hoy en operacion escapa nombres, habitaciones y textos de atencion', () => {
  const source = read('js/modules/operacion-hoy/operacion-hoy.js');
  assert.match(source, /import \{ escapeHtml \} from '..\/..\/security.js'/);
  assert.match(source, /escapeHtml\(item\.cliente_nombre \|\| item\.title \|\| 'Registro'\)/);
  assert.match(source, /escapeHtml\(item\.habitaciones\?\.nombre \|\| item\.helper \|\| 'Sin detalle adicional'\)/);
  assert.match(source, /escapeHtml\(item\.schedule\)/);
  assert.match(source, /item\.route\.startsWith\('#\/'\)/);
  assert.doesNotMatch(source, /\$\{item\.cliente_nombre/);
});

test('P0 el registro no declara exito si falla el perfil o el rol del administrador', () => {
  const source = read('script.js');
  assert.match(source, /const \{ error: perfilError \} = await supabase\.from\('usuarios'\)\.insert/);
  assert.match(source, /if \(perfilError\) \{[\s\S]*?throw perfilError;/);
  assert.match(source, /const \{ error: rolError \} = await supabase\.from\('usuarios_roles'\)\.insert/);
  assert.match(source, /if \(rolError\) \{[\s\S]*?throw rolError;/);
  assert.match(source, /if \(error\.registroIncompleto\)/);
  // El evento de marketing solo se envia despues de crear perfil y rol.
  assert.ok(source.indexOf('throw rolError') < source.indexOf("'event': 'crear_cuenta'"));
});
