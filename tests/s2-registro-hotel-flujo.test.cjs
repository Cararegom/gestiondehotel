const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const loadService = () => import(`${pathToFileURL(path.join(root, 'js', 'services', 'registroHotelService.js')).href}?t=${Date.now()}`);
const scriptSource = fs.readFileSync(path.join(root, 'script.js'), 'utf8');
const loginSource = fs.readFileSync(path.join(root, 'login.html'), 'utf8');

const FORM = { email: 'nuevo@example.com', password: 'clave-segura-1', hotelName: 'Hotel Nuevo', adminName: 'Ana', referidoId: null };

// Simula supabase-js v2 con las respuestas reales de Auth para cada caso.
function fakeSupabase({ signUp, signIn, rpc = { data: 'hotel-1', error: null } }) {
  const calls = [];
  return {
    calls,
    auth: {
      async signUp(args) { calls.push(['signUp', args]); return signUp; },
      async signInWithPassword(args) { calls.push(['signIn', args]); return signIn; },
    },
    async rpc(name, args) { calls.push(['rpc', name, args]); return rpc; },
  };
}

const userConIdentidad = { id: 'u1', identities: [{ id: 'i1' }] };

test('Auth con confirmacion de correo: crea la cuenta, guarda los datos del hotel y no crea el hotel aun', async () => {
  const { registrarCuentaYHotel } = await loadService();
  const sb = fakeSupabase({ signUp: { data: { user: userConIdentidad, session: null }, error: null } });
  assert.deepEqual(await registrarCuentaYHotel(sb, { ...FORM, referidoId: 'ref-1' }), { cuentaExistente: false, hotelCreado: false });
  assert.deepEqual(sb.calls, [['signUp', {
    email: FORM.email,
    password: FORM.password,
    options: { data: { full_name: 'Ana', hotel_name: 'Hotel Nuevo', referido_id: 'ref-1' } },
  }]]);
});

test('Auth sin confirmacion: crea el hotel en la misma operacion', async () => {
  const { registrarCuentaYHotel } = await loadService();
  const sb = fakeSupabase({ signUp: { data: { user: userConIdentidad, session: { access_token: 't' } }, error: null } });
  assert.deepEqual(await registrarCuentaYHotel(sb, FORM), { cuentaExistente: false, hotelCreado: true });
  assert.deepEqual(sb.calls.at(-1), ['rpc', 'registrar_hotel_inicial', { p_nombre_hotel: 'Hotel Nuevo', p_nombre_admin: 'Ana', p_referido_por: null }]);
});

test('retoma el alta de una cuenta de Auth ya confirmada sin perfil', async () => {
  const { registrarCuentaYHotel } = await loadService();
  // Con confirmacion activa Supabase devuelve un usuario sin identidades para correos ya registrados.
  for (const signUp of [
    { data: { user: { id: 'u1', identities: [] }, session: null }, error: null },
    { data: { user: null, session: null }, error: { message: 'User already registered' } },
  ]) {
    const sb = fakeSupabase({ signUp, signIn: { data: { session: { access_token: 't' } }, error: null } });
    assert.deepEqual(await registrarCuentaYHotel(sb, FORM), { cuentaExistente: true, hotelCreado: true });
    assert.deepEqual(sb.calls.map((c) => c[0]), ['signUp', 'signIn', 'rpc']);
  }
});

test('cuenta existente: correo sin confirmar o contrasena distinta se informa como error', async () => {
  const { registrarCuentaYHotel } = await loadService();
  const existente = { data: { user: { id: 'u1', identities: [] }, session: null }, error: null };
  const sinConfirmar = fakeSupabase({ signUp: existente, signIn: { data: {}, error: { message: 'Email not confirmed' } } });
  await assert.rejects(registrarCuentaYHotel(sinConfirmar, FORM), { message: 'registro_confirmar_correo' });
  const otraClave = fakeSupabase({ signUp: existente, signIn: { data: {}, error: { message: 'Invalid login credentials' } } });
  await assert.rejects(registrarCuentaYHotel(otraClave, FORM), { message: 'User already registered' });
  assert.equal(otraClave.calls.some((c) => c[0] === 'rpc'), false);
});

test('un fallo del servidor al crear el hotel no se presenta como exito', async () => {
  const { registrarCuentaYHotel } = await loadService();
  const conSesion = { data: { user: userConIdentidad, session: { access_token: 't' } }, error: null };
  const falla = fakeSupabase({ signUp: conSesion, rpc: { data: null, error: { message: 'duplicate key value violates unique constraint "hoteles_nombre_key"' } } });
  await assert.rejects(registrarCuentaYHotel(falla, FORM), { message: /hoteles_nombre_key/ });
  const vacio = fakeSupabase({ signUp: conSesion, rpc: { data: null, error: null } });
  await assert.rejects(registrarCuentaYHotel(vacio, FORM), { message: 'registro_incompleto' });
  const authFalla = fakeSupabase({ signUp: { data: {}, error: { message: 'Password should be at least 6 characters' } } });
  await assert.rejects(registrarCuentaYHotel(authFalla, FORM), { message: /Password/ });
});

test('datosRegistroPendiente solo devuelve datos si el registro guardo el nombre del hotel', async () => {
  const { datosRegistroPendiente } = await loadService();
  assert.equal(datosRegistroPendiente({ user_metadata: { full_name: 'Ana' } }), null);
  assert.equal(datosRegistroPendiente(null), null);
  assert.deepEqual(datosRegistroPendiente({ user_metadata: { hotel_name: ' Hotel ', referido_id: 'r' } }, 'a@b.co'),
    { hotelName: 'Hotel', adminName: 'a@b.co', referidoId: 'r' });
});

test('script.js usa el flujo del servicio, conserva signUp y dataLayer y no calcula la suscripcion', () => {
  assert.match(scriptSource, /import \{ registrarCuentaYHotel \} from '\/js\/services\/registroHotelService\.js';/);
  assert.match(scriptSource, /await registrarCuentaYHotel\(supabase, \{/);
  assert.doesNotMatch(scriptSource, /from\('(hoteles|usuarios|usuarios_roles)'\)\.insert/);
  assert.doesNotMatch(scriptSource, /trial_fin|suscripcion_fin|estado_suscripcion/);
  assert.match(scriptSource, /'event': 'crear_cuenta'/);
  assert.match(scriptSource, /trackLandingEvent\('account_created_from_landing'/);
  assert.match(scriptSource, /registro_confirmar_correo/);
  const service = fs.readFileSync(path.join(root, 'js', 'services', 'registroHotelService.js'), 'utf8');
  assert.match(service, /supabase\.auth\.signUp\(/);
});

test('login.html termina el alta pendiente antes de entrar y no bloquea a quien no tiene perfil', () => {
  assert.match(loginSource, /import \{ completarRegistroHotel, datosRegistroPendiente \} from '\.\/js\/services\/registroHotelService\.js';/);
  assert.match(loginSource, /\.maybeSingle\(\);/);
  const sinPerfil = loginSource.indexOf('if (!perfilUsuario) {');
  assert.ok(sinPerfil > 0);
  assert.ok(loginSource.indexOf('await completarRegistroHotel(supabase, pendiente);', sinPerfil) > sinPerfil);
  assert.match(loginSource, /index\.html\?modal=registro/);
});
