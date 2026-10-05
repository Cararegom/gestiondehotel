const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clientesPath = path.join(root, 'js/modules/clientes/clientes.js');
const usuariosPath = path.join(root, 'js/modules/usuarios/usuarios.js');
const securityPath = path.join(root, 'js/security.js');
const clientesSource = fs.readFileSync(clientesPath, 'utf8');
const usuariosSource = fs.readFileSync(usuariosPath, 'utf8');

function loadEscapers() {
  const source = fs.readFileSync(securityPath, 'utf8')
    .split('export function sanitizeUrl')[0]
    .replace(/export\s+function\s+/g, 'function ');
  const context = {};
  vm.runInNewContext(`${source}\nthis.escapeHtml = escapeHtml; this.escapeAttribute = escapeAttribute;`, context);
  return context;
}

function extractFunction(source, name, endMarker, isAsync = false) {
  const start = source.indexOf(`${isAsync ? 'async ' : ''}function ${name}(`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${name} debe existir`);
  assert.notEqual(end, -1, `No se encontro el limite de ${name}`);
  return source.slice(start, end);
}

test('security.js neutraliza etiquetas y ruptura de atributos', () => {
  const { escapeHtml, escapeAttribute } = loadEscapers();
  const payload = ' Ana"  onmouseover="alert(1)\n<img src=x onerror=alert(2)> ';

  assert.equal(escapeHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(
    escapeAttribute(payload),
    'Ana&quot; onmouseover=&quot;alert(1) &lt;img src=x onerror=alert(2)&gt;'
  );
});

test('A4: la tabla de clientes renderiza datos persistidos como texto seguro', () => {
  const { escapeHtml, escapeAttribute } = loadEscapers();
  const functionSource = extractFunction(clientesSource, 'renderTablaClientes', '\nasync function filtrarTabla');
  const wrapper = { innerHTML: '', querySelectorAll: () => [] };
  const context = {
    escapeHtml,
    escapeAttribute,
    document: { getElementById: () => wrapper },
    getClienteInsight: () => ({
      badgeClass: 'bg-slate-100', label: 'Ocasional', visitsCount: 0,
      pendingActivities: 0, totalSpend: 0, lastVisitDate: null
    }),
    formatCurrency: () => '$0',
    formatInsightDate: () => 'Sin visitas',
    logDebug() {},
    logError() {}
  };
  vm.runInNewContext(`${functionSource}\nthis.renderTablaClientes = renderTablaClientes;`, context);

  const payload = 'Ana"><img src=x onerror=alert(1)>';
  context.renderTablaClientes([{
    id: 'id"><svg onload=alert(2)>', nombre: payload,
    documento: payload, telefono: payload, activo: true
  }]);

  assert.doesNotMatch(wrapper.innerHTML, /<(?:img|svg)\b/i);
  assert.match(wrapper.innerHTML, /Ana&quot;&gt;&lt;img/);
  assert.match(wrapper.innerHTML, /data-id="id&quot;&gt;&lt;svg/);
});

test('A5: la tabla de usuarios protege texto, roles y atributos data-*', async () => {
  const { escapeHtml, escapeAttribute } = loadEscapers();
  const functionSource = extractFunction(usuariosSource, 'cargarYRenderizarUsuarios', '\n// ----------- Funciones de formularios', true);
  const rows = [];
  const payload = 'Eva"><img src=x onerror=alert(1)>';
  const query = {
    select() { return this; },
    eq() { return this; },
    order: async () => ({
      data: [{
        id: 'id"><svg onload=alert(2)>', nombre: payload, correo: payload,
        activo: true, usuarios_roles: [{ roles: { nombre: payload } }]
      }],
      error: null
    })
  };
  const context = {
    escapeHtml,
    escapeAttribute,
    currentModuleUser: { id: 'current-user' },
    document: { createElement: () => ({ className: '', dataset: {}, innerHTML: '' }) }
  };
  vm.runInNewContext(`${functionSource}\nthis.cargarYRenderizarUsuarios = cargarYRenderizarUsuarios;`, context);
  await context.cargarYRenderizarUsuarios(
    { innerHTML: '', appendChild: row => rows.push(row) },
    { from: () => query },
    'hotel-a'
  );

  assert.equal(rows.length, 1);
  assert.doesNotMatch(rows[0].innerHTML, /<(?:img|svg)\b/i);
  assert.match(rows[0].innerHTML, /Eva&quot;&gt;&lt;img/);
  assert.match(rows[0].innerHTML, /data-id="id&quot;&gt;&lt;svg/);
});

test('A4 y A5 usan los helpers centrales en los sinks persistidos equivalentes', () => {
  assert.match(clientesSource, /import \{ escapeAttribute, escapeHtml \} from '\.\.\/\.\.\/security\.js';/);
  assert.match(clientesSource, /data-nombre="\$\{escapeAttribute\(c\.nombre\)\}"/);
  assert.match(clientesSource, /<textarea[^>]+name="notas">\$\{escapeHtml\(cliente\?\.notas \|\| ''\)\}<\/textarea>/);
  assert.match(clientesSource, /\$\{escapeHtml\(a\.descripcion \|\| ''\)\}/);

  assert.match(usuariosSource, /import \{ escapeAttribute, escapeHtml \} from '\.\.\/\.\.\/security\.js';/);
  assert.match(usuariosSource, /\$\{escapeHtml\(u\.nombre \|\| 'N\/A'\)\}/);
  assert.match(usuariosSource, /data-roles="\$\{escapeAttribute\(rolesNombres\)\}"/);
  assert.match(usuariosSource, /\$\{escapeHtml\(p\.descripcion \|\| ''\)\}/);
  assert.match(usuariosSource, /Error al cargar usuarios: \$\{escapeHtml\(err\.message\)\}/);
});
