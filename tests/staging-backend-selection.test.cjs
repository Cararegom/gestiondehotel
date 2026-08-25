const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('js/supabaseClient.js', 'utf8');

test('staging usa proyecto y sesion separados sin cambiar el backend por defecto', () => {
  assert.match(source, /vyzscuzgjdhrhzctmsuv\.supabase\.co/);
  assert.match(source, /gestionhotel\.backend/);
  assert.match(source, /gestionhotel\.auth\.\$\{activeBackend\}/);
  assert.match(source, /: 'production';/);
});
