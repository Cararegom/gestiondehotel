const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('las transiciones de habitaciones notifican el usuario responsable', () => {
  const service = fs.readFileSync(
    path.join(root, 'js/services/NotificationService.js'),
    'utf8'
  );
  const mapa = fs.readFileSync(
    path.join(root, 'js/modules/mapa-habitaciones/modales-gestion.js'),
    'utf8'
  );
  const limpieza = fs.readFileSync(
    path.join(root, 'js/modules/limpieza/limpieza.js'),
    'utf8'
  );

  assert.match(service, /La liberó: \$\{nombreActor\}/);
  assert.match(service, /La sacó de limpieza: \$\{nombreActor\}/);
  assert.equal(
    (mapa.match(/await notificarHabitacionLiberada\(/g) || []).length,
    2,
    'deben notificarse tanto la liberación normal como la forzada'
  );
  assert.match(limpieza, /await notificarHabitacionFueraDeLimpieza\(/);
});
