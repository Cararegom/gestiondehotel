const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('la migracion operacional 5-10 incluye las piezas clave', () => {
  const rootDir = path.resolve(__dirname, '..');
  const migrationPath = path.join(rootDir, 'supabase', 'migrations', '20260326202000_operational_hardening_5_10.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.eventos_sistema/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.abrir_turno_con_apertura/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.registrar_movimiento_caja_atomico/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.cerrar_turno_con_balance/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.saas_dashboard_snapshot/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.exportar_hotel_snapshot/i);
});

