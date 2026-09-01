const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const main = fs.readFileSync('js/main.js', 'utf8');
const moduleSource = fs.readFileSync('js/modules/control-energia/control-energia.js', 'utf8');
const guard = fs.readFileSync('js/energy-activation-guard.js', 'utf8');
const index = fs.readFileSync('app/index.html', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260901230000_energy_preparation_reception_print.sql', 'utf8');
const hardening = fs.readFileSync('supabase/migrations/20260901213000_energy_control_hardening.sql', 'utf8');

test('administrador y recepcion pueden abrir Control de Energia apagado para prepararlo', () => {
  assert.match(main, /text: 'Control de Energía'/);
  assert.match(main, /function canCurrentUserPrepareEnergy/);
  assert.match(main, /isRecepcionistaRole\(currentUserRole\)/);
  assert.match(main, /!currentEnergyControlEnabled && !canCurrentUserPrepareEnergy\(user\)/);
  assert.match(main, /!currentEnergyControlEnabled[\s\S]{0,160}!canCurrentUserPrepareEnergy\(userForModule\)/);
});

test('recepcion puede listar e imprimir QR pero no generarlos ni regenerarlos', () => {
  assert.match(migration, /energy_actor_can_print_qr/);
  assert.match(migration, /'admin', 'administrador', 'recepcionista'/);
  assert.match(migration, /if not public\.energy_actor_can_print_qr\(\) then/);
  assert.match(migration, /'can_print_qr', public\.energy_actor_can_print_qr\(\)/);
  assert.match(moduleSource, /capabilities\?\.can_print_qr/);
  assert.match(moduleSource, /Acceso de recepción:/);
  assert.match(moduleSource, /puedes imprimir los QR ya generados/);
  assert.match(moduleSource, /capabilities\?\.can_admin \? `<button data-generate=/);

  const regenerateBody = hardening.match(
    /create or replace function public\.energy_regenerate_qr\(p_room_id uuid\)[\s\S]*?\$function\$;/i
  )?.[0] || '';
  assert.ok(regenerateBody, 'energy_regenerate_qr debe existir');
  assert.match(regenerateBody, /energy_actor_allowed\(true\)/);
});

test('camarera y mantenimiento no obtienen permisos de impresion de secretos QR', () => {
  const printPermissionBody = migration.match(
    /create or replace function public\.energy_actor_can_print_qr\(\)[\s\S]*?\$function\$;/i
  )?.[0] || '';
  assert.ok(printPermissionBody, 'energy_actor_can_print_qr debe existir');
  assert.doesNotMatch(printPermissionBody, /camarera/);
  assert.doesNotMatch(printPermissionBody, /mantenimiento/);
});

test('activar energia exige QR generados y confirmacion de instalacion fisica', () => {
  assert.match(migration, /energy_require_qr_before_enable/);
  assert.match(migration, /ENERGY_QR_FALTANTES:/);
  assert.match(migration, /h\.activo = true/);
  assert.match(guard, /supabase\.rpc\('energy_list_qr_tokens'\)/);
  assert.match(guard, /Faltan QR por preparar/);
  assert.match(guard, /¿Los QR ya están instalados\?/);
  assert.match(guard, /Sí, activar Control de Energía/);
  assert.match(guard, /stopImmediatePropagation/);
  assert.match(index, /\/js\/energy-activation-guard\.js/);
});

test('modo preparacion no habilita escaneo ni controles por si solo', () => {
  assert.match(moduleSource, /config\.energy_control_enabled && capabilities\?\.can_control/);
  assert.match(moduleSource, /Control desactivado \/ preparación/);
  assert.match(moduleSource, /Mientras el sistema esté apagado no se generan controles ni se bloquean habitaciones/);
});
