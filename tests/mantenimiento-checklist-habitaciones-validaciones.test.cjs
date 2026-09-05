const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('el backend exige alcance coherente y checklist completo por habitación', () => {
  const sql = fs.readFileSync('supabase/migrations/20260905181500_mantenimiento_checklist_habitaciones_validaciones.sql', 'utf8');
  assert.match(sql, /mantenimiento_planes_alcance_habitacion_check/);
  assert.match(sql, /alcance = 'habitacion' AND habitacion_id IS NOT NULL/);
  assert.match(sql, /CHECKLIST_HABITACION_INCOMPLETO/);
  assert.match(sql, /OBSERVACION_NOVEDAD_REQUERIDA/);
  assert.match(sql, /item->>'completado'/);
});
