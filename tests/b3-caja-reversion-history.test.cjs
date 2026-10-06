const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const panel = fs.readFileSync('js/modules/caja/caja-paneles.js', 'utf8');
const caja = fs.readFileSync('js/modules/caja/caja.js', 'utf8');
const schema = fs.readFileSync('supabase/migrations/20260809101000_fase1_auditoria_reversion.sql', 'utf8');
const reversal = fs.readFileSync('supabase/migrations/20260825174000_hacer_reversion_caja_idempotente.sql', 'utf8');

test('B3: Caja retira el panel y la consulta de eliminaciones legacy', () => {
  assert.doesNotMatch(panel, /log_caja_eliminados|mostrarLogEliminados|Movimientos Eliminados/);
  assert.doesNotMatch(caja, /btn-ver-eliminados|mostrarLogEliminados|Ver eliminados/);
});

test('B3: el panel administrativo consulta la fuente activa y filtra el hotel', () => {
  assert.match(panel, /from\('caja_reversiones'\)/);
  assert.match(panel, /\.eq\('hotel_id', hotelId\)/);
  assert.match(panel, /\.order\('created_at', \{ ascending: false \}\)/);
  assert.match(panel, /\.limit\(100\)/);
  assert.match(caja, /mostrarHistorialReversionesPanel\([\s\S]*hotelId: currentHotelId/);
});

test('B3: la vista identifica responsables, motivo y par original-contramovimiento', () => {
  for (const field of [
    'created_by_usuario',
    'approved_by_usuario',
    'reason',
    'original_movement_id',
    'reversal_movement_id',
  ]) assert.match(panel, new RegExp(field));
  assert.match(panel, /Historial de reversiones de caja/);
  assert.match(panel, /escapeHtml\(reversion\.reason/);
  assert.match(panel, /escapeAttribute\(reversion\.original_movement_id/);
  assert.match(panel, /escapeAttribute\(reversion\.reversal_movement_id/);
});

test('B3: caja_reversiones tiene RLS, permiso financiero y escritura atómica vigente', () => {
  assert.match(schema, /ALTER TABLE public\.caja_reversiones ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /fase1_actor_tiene_permiso\(hotel_id,'finanzas\.ver'\)/);
  assert.match(reversal, /INSERT INTO public\.caja_reversiones/);
  assert.match(reversal, /INSERT INTO public\.auditoria_operaciones/);
});
