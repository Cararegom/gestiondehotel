const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const migration = fs.readFileSync(
  'supabase/migrations/20260903033000_excluir_reversiones_de_reportes_y_cierres.sql',
  'utf8'
);

test('las reversiones existentes se excluyen retroactivamente de la caja operativa', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS afecta_reportes boolean NOT NULL DEFAULT true/i);
  assert.match(migration, /UPDATE public\.caja AS c[\s\S]*SET afecta_reportes = false/i);
  assert.match(migration, /cr\.original_movement_id = c\.id/i);
  assert.match(migration, /cr\.reversal_movement_id = c\.id/i);
});

test('las reversiones futuras marcan original y contramovimiento sin depender del concepto', () => {
  assert.match(migration, /CREATE TRIGGER trg_caja_marcar_par_revertido_fuera_reportes/i);
  assert.match(migration, /AFTER INSERT[\s\S]*ON public\.caja_reversiones/i);
  assert.match(migration, /id IN \(NEW\.original_movement_id, NEW\.reversal_movement_id\)/i);
  assert.doesNotMatch(migration, /concepto\s+(?:like|ilike)/i);
});

test('todas las lecturas autenticadas de caja reciben solo movimientos que afectan reportes', () => {
  assert.match(migration, /CREATE POLICY caja_solo_movimientos_operativos/i);
  assert.match(migration, /AS RESTRICTIVE/i);
  assert.match(migration, /FOR SELECT[\s\S]*TO authenticated[\s\S]*USING \(afecta_reportes\)/i);
});

test('las filas técnicas se excluyen incluso antes de insertar caja_reversiones', () => {
  assert.match(migration, /CREATE TRIGGER trg_caja_forzar_reversion_tecnica_fuera_reportes/i);
  assert.match(migration, /NEW\.original_movement_id IS NOT NULL[\s\S]*NEW\.afecta_reportes := false/i);
});
