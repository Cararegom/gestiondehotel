const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('primary reservation, store, restaurant, reversal and close callers use Fase 1 RPCs', () => {
  assert.match(read('js/modules/reservas/reservas-pagos.js'), /rpc\('procesar_pago_reserva_atomico'/);
  assert.match(read('js/modules/tienda/pos.js'), /rpc\('procesar_venta_tienda_atomica'/);
  assert.match(read('js/modules/restaurante/restaurante.js'), /rpc\('procesar_venta_restaurante_atomica'/);
  assert.match(read('js/modules/caja/caja-movimientos.js'), /rpc\('revertir_movimiento_caja'/);
  assert.match(read('js/modules/caja/caja-turnos.js'), /rpc\('cerrar_turno_con_arqueo'/);
});

test('active frontend no longer calls destructive cash delete or generic stock increment RPC', () => {
  const jsRoot = path.join(root, 'js');
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.js') && files.push(path.join(dir, e.name)));
  walk(jsRoot);
  const source = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.doesNotMatch(source, /rpc\(['"]registrar_y_eliminar_mov_caja/);
  assert.doesNotMatch(source, /rpc\(['"]increment['"]/);
  assert.doesNotMatch(source, /38373fa5-b953-4aa9-b4e9-25b9739be5f2/);
});

test('operation IDs survive failed retries until explicit completion', () => {
  const service = read('js/services/fase1OperationService.js');
  assert.match(service, /sessionStorage/);
  assert.match(service, /getStableOperationId/);
  assert.match(service, /completeStableOperation/);
});

test('payment service normalizes the pago_id returned by the database RPC', () => {
  const service = read('js/services/fase1OperationService.js');
  assert.match(service, /data\?\.pago_reserva_id\s*\|\|\s*data\?\.pago_id/);
  assert.match(service, /pago_reserva_id:\s*pagoReservaId/);
});

test('reservation checkout liquidates linked consumption through an authorized RPC', () => {
  const checkout = read('js/modules/mapa-habitaciones/modales-gestion.js');
  const sql = read('supabase/migrations/20260825173000_liquidar_consumos_reserva_atomico.sql');
  assert.match(checkout, /rpc\('liquidar_consumos_reserva_atomico'/);
  assert.doesNotMatch(checkout, /from\('ventas_tienda'\)\s*\.update\(\{ estado_pago: 'pagado'/);
  assert.doesNotMatch(checkout, /from\('ventas_restaurante'\)\s*\.update\(\{ estado_pago: 'pagado'/);
  assert.match(sql, /fase1_actor_es_miembro_activo/);
  assert.match(sql, /usuario_id=auth\.uid\(\)/);
  assert.match(sql, /UPDATE public\.ventas_tienda/);
  assert.match(sql, /UPDATE public\.ventas_restaurante/);
});

test('cash reversal is idempotent by original movement and hides repeated action', () => {
  const cashUi = read('js/modules/caja/caja-movimientos.js');
  const sql = read('supabase/migrations/20260825174000_hacer_reversion_caja_idempotente.sql');
  assert.match(sql, /original_movement_id=v_original\.id/);
  assert.match(sql, /'already_reverted',true/);
  assert.doesNotMatch(sql, /El movimiento ya fue revertido/);
  assert.match(cashUi, /from\('caja_reversiones'\)/);
  assert.match(cashUi, /!isReversal && !isReverted/);
  assert.match(cashUi, /ya estaba revertido/);
});

test('Bogota business dates cover evening and midnight boundaries', () => {
  const bogotaDate = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  assert.equal(bogotaDate('2026-08-09T23:30:00-05:00'), '2026-08-09');
  assert.equal(bogotaDate('2026-08-09T19:30:00-05:00'), '2026-08-09');
  assert.equal(bogotaDate('2026-08-09T18:30:00-05:00'), '2026-08-09');
  assert.equal(bogotaDate('2026-08-10T00:30:00-05:00'), '2026-08-10');
});
