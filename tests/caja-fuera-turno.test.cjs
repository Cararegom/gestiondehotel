const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/migrations/20260825150000_fix_caja_movimiento_fuera_turno.sql', 'utf8');
const ui = fs.readFileSync('js/modules/caja/caja.js', 'utf8');

test('Caja permite omitir turno solo cuando p_turno_id es NULL', () => {
  assert.match(sql, /IF p_turno_id IS NOT NULL THEN[\s\S]*Turno activo propio requerido/);
  assert.match(sql, /VALUES\(p_hotel_id,auth\.uid\(\),p_turno_id/);
  assert.match(sql, /fase1_actor_es_miembro_activo\(p_hotel_id\)/);
  assert.match(sql, /p_usuario_id IS DISTINCT FROM auth\.uid\(\)/);
});

test('La opcion fuera de turno envia NULL al RPC seguro', () => {
  assert.match(ui, /egreso_fuera_turno/);
  assert.match(ui, /turnoIdToSave = null/);
  assert.match(ui, /rpc\('registrar_movimiento_caja_atomico'/);
  assert.match(ui, /p_turno_id: newMovement\.turno_id/);
});
