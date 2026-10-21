const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

test('el modal del mapa permite encontrar reservas confirmadas para check-in', () => {
  const source = fs.readFileSync(
    path.join(root, 'js/modules/mapa-habitaciones/modales-gestion.js'),
    'utf8'
  );

  const checkinQuery = source.match(
    /\.select\('id, cliente_nombre, telefono, cantidad_huespedes, fecha_inicio, fecha_fin'\)([\s\S]*?)\.maybeSingle\(\)/
  );

  assert.ok(checkinQuery, 'debe existir la consulta de la reserva pendiente de check-in');
  assert.match(checkinQuery[1], /\.eq\('hotel_id', hotelId\)/);
  assert.match(checkinQuery[1], /\.eq\('habitacion_id', room\.id\)/);
  assert.match(checkinQuery[1], /\.in\('estado', \['reservada', 'confirmada'\]\)/);
  assert.doesNotMatch(checkinQuery[1], /\.eq\('estado', 'reservada'\)/);
});
