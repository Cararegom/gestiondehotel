const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const domainPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-domain.js');
const workflowUiPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-workflow-ui.js');
const repositoryPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-repository.js');
const preventivePath = path.join(root, 'js/modules/mantenimiento/mantenimiento-preventivo.js');
const enumMigrationPath = path.join(root, 'supabase/migrations/20260902043000_mantenimiento_fase3_estados.sql');
const workflowMigrationPath = path.join(root, 'supabase/migrations/20260902043500_mantenimiento_fase3_flujo_trazable.sql');

function loadDomain() {
  let source = fs.readFileSync(domainPath, 'utf8');
  source = source
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  source += `\nthis.__api = { TASK_STATES, OPEN_TASK_STATES, CLOSED_TASK_STATES, normalizeTaskState, isOpenTaskState, isClosedTaskState, getStatusMeta, getWorkflowAction, getSlaMeta };`;
  const context = { Date, Number, String, Object, Array, Math, globalThis: {} };
  vm.runInNewContext(source, context, { filename: domainPath });
  return context.__api;
}

test('Fase 3 agrega el ciclo profesional sin eliminar estados legacy del enum', () => {
  const migration = fs.readFileSync(enumMigrationPath, 'utf8');
  for (const state of ['en_revision', 'asignado', 'en_proceso', 'resuelto', 'cerrado', 'cancelado']) {
    assert.match(migration, new RegExp(`ADD VALUE IF NOT EXISTS '${state}'`));
  }
});

test('El dominio normaliza estados legacy hacia el flujo canonico', () => {
  const api = loadDomain();
  assert.equal(api.normalizeTaskState('en_progreso'), 'en_proceso');
  assert.equal(api.normalizeTaskState('completada'), 'cerrado');
  assert.equal(api.normalizeTaskState('cancelada'), 'cancelado');
  assert.equal(api.isOpenTaskState('resuelto'), true);
  assert.equal(api.isClosedTaskState('cerrado'), true);
});

test('El flujo de acciones avanza revision, proceso, resolucion y cierre', () => {
  const api = loadDomain();
  assert.equal(api.getWorkflowAction({ estado: 'pendiente' }, 'u1').nextState, 'en_revision');
  assert.equal(api.getWorkflowAction({ estado: 'en_revision', asignada_a: null }, 'u1').nextState, 'en_proceso');
  assert.equal(api.getWorkflowAction({ estado: 'asignado', asignada_a: 'u2' }, 'u1').nextState, 'en_proceso');
  assert.equal(api.getWorkflowAction({ estado: 'en_proceso' }, 'u1').nextState, 'resuelto');
  assert.equal(api.getWorkflowAction({ estado: 'resuelto' }, 'u1').nextState, 'cerrado');
  assert.equal(api.getWorkflowAction({ estado: 'cerrado' }, 'u1'), null);
});

test('El SLA identifica vencidos y proximos a vencer', () => {
  const api = loadDomain();
  const now = new Date('2026-09-02T12:00:00Z').getTime();
  const overdue = api.getSlaMeta({ estado: 'en_proceso', vencimiento_at: '2026-09-02T11:30:00Z' }, now);
  const soon = api.getSlaMeta({ estado: 'pendiente', vencimiento_at: '2026-09-02T12:30:00Z' }, now);
  assert.equal(overdue.overdue, true);
  assert.match(overdue.text, /Vencida/);
  assert.equal(soon.overdue, false);
  assert.match(soon.text, /Vence en/);
});

test('La migracion crea historial inmutable, SLA y RPC de transicion/comentario', () => {
  const migration = fs.readFileSync(workflowMigrationPath, 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.mantenimiento_historial/);
  assert.match(migration, /sla_objetivo_minutos/);
  assert.match(migration, /vencimiento_at/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mantenimiento_transicionar_tarea/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.mantenimiento_agregar_comentario/);
  assert.match(migration, /TRANSICION_MANTENIMIENTO_INVALIDA/);
  assert.match(migration, /Mantenimiento historial select hotel/);
  assert.doesNotMatch(migration, /FOR UPDATE TO authenticated[\s\S]*mantenimiento_historial/);
  assert.doesNotMatch(migration, /FOR DELETE TO authenticated[\s\S]*mantenimiento_historial/);
});

test('Los bloqueos de habitacion consideran todos los estados abiertos del nuevo flujo', () => {
  const migration = fs.readFileSync(workflowMigrationPath, 'utf8');
  assert.match(migration, /mantenimiento_estado_es_abierto\(tm\.estado::text\)/);
  assert.match(migration, /MANTENIMIENTO_HABITACION_OCUPADA/);
});

test('El repositorio usa RPC para transiciones y comentarios y consulta historial por hotel', () => {
  const repository = fs.readFileSync(repositoryPath, 'utf8');
  assert.match(repository, /rpc\('mantenimiento_transicionar_tarea'/);
  assert.match(repository, /rpc\('mantenimiento_agregar_comentario'/);
  assert.match(repository, /from\('mantenimiento_historial'\)/);
  assert.match(repository, /\.eq\('hotel_id', hotelId\)/);
});

test('La interfaz Fase 3 agrega SLA, historial y evita cambiar estado directo en el formulario', () => {
  const ui = fs.readFileSync(workflowUiPath, 'utf8');
  assert.match(ui, /getSlaMeta/);
  assert.match(ui, /mant-f3-history-list/);
  assert.match(ui, /addMaintenanceComment/);
  assert.match(ui, /transitionMaintenanceTask/);
  assert.match(ui, /stateSelect\.disabled = true/);
  assert.match(ui, /data-task-action = 'workflow'|dataset\.taskAction = 'workflow'/);
});

test('Los preventivos se regeneran al cierre canonico', () => {
  const preventive = fs.readFileSync(preventivePath, 'utf8');
  assert.match(preventive, /TASK_STATES\.cerrado/);
  assert.match(preventive, /normalizeTaskState/);
  assert.match(preventive, /createNextPreventiveTask/);
});
