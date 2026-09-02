const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const quickPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-quick-report.js');
const uiPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-mobile-ui.js');
const workflowPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-workflow-ui.js');
const facadePath = path.join(root, 'js/modules/mantenimiento/mantenimiento.js');
const repositoryPath = path.join(root, 'js/modules/mantenimiento/mantenimiento-repository.js');

function loadQuickDomain() {
  let source = fs.readFileSync(quickPath, 'utf8');
  source = source
    .replace(/import\s+\{[\s\S]*?\}\s+from '\.\/mantenimiento-domain\.js';\s*/, '')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  source += `\nthis.__api = { QUICK_MAINTENANCE_CATEGORIES, getQuickMaintenanceCategory, isRoomOccupiedForMaintenance, normalizeQuickImpact, resolveDefaultMaintenanceAssignee, sanitizeQuickTitle, buildQuickMaintenancePayload, mergeQuickFiles };`;

  const context = {
    TASK_TYPES: { bloqueante: 'bloqueante', programado: 'programado' },
    normalizeTaskType(value) {
      return value === 'programado' ? 'programado' : 'bloqueante';
    }
  };
  vm.runInNewContext(source, context, { filename: quickPath });
  return context.__api;
}

test('Fase 2 impide convertir una estancia activa en bloqueo desde el reporte rapido', () => {
  const api = loadQuickDomain();
  assert.equal(api.isRoomOccupiedForMaintenance({ estado: 'ocupada' }), true);
  assert.equal(api.normalizeQuickImpact('bloqueante', { estado: 'ocupada' }), 'programado');
  assert.equal(api.normalizeQuickImpact('bloqueante', { estado: 'libre' }), 'bloqueante');
});

test('Fase 2 asigna automaticamente solo cuando existe un responsable inequívoco', () => {
  const api = loadQuickDomain();
  const users = [
    { id: 'm1', rol: 'mantenimiento', activo: true },
    { id: 'r1', rol: 'recepcionista', activo: true }
  ];
  assert.equal(api.resolveDefaultMaintenanceAssignee(users, { id: 'r1', rol: 'recepcionista' }), 'm1');
  assert.equal(api.resolveDefaultMaintenanceAssignee(users, { id: 'm1', rol: 'mantenimiento' }), 'm1');
  assert.equal(api.resolveDefaultMaintenanceAssignee([...users, { id: 'm2', rol: 'mantenimiento', activo: true }], { id: 'r1', rol: 'recepcionista' }), null);
});

test('Fase 2 genera un reporte rapido auditable y permite dejarlo sin asignar', () => {
  const api = loadQuickDomain();
  const payload = api.buildQuickMaintenancePayload({
    title: 'Aire no enfría',
    description: 'Hace ruido',
    categoryId: 'climatizacion',
    requestedType: 'bloqueante',
    room: { id: 'h1', nombre: '101', estado: 'libre' },
    priority: 3,
    assigneeId: null,
    attachments: [{ path: 'hotel/task/foto.jpg' }],
    requestId: 'req-1',
    currentUserId: 'u1'
  });
  assert.equal(payload.titulo, 'Aire no enfría');
  assert.equal(payload.categoria_mantenimiento, 'climatizacion');
  assert.equal(payload.tipo, 'bloqueante');
  assert.equal(payload.asignada_a, null);
  assert.equal(payload.solicitud_id, 'req-1');
  assert.equal(payload.creada_por, 'u1');
  assert.equal(payload.estado, 'pendiente');
});

test('Fase 2 evita duplicar archivos seleccionados desde cámara y adjuntos', () => {
  const api = loadQuickDomain();
  const photo = { name: 'foto.jpg', size: 1200, lastModified: 10 };
  const merged = api.mergeQuickFiles([photo], [photo, { name: 'manual.pdf', size: 42, lastModified: 20 }]);
  assert.equal(merged.length, 2);
});

test('La fachada conserva la experiencia mobile-first bajo la capa de flujo', () => {
  const facade = fs.readFileSync(facadePath, 'utf8');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  assert.match(facade, /mantenimiento-workflow-ui\.js/);
  assert.match(workflow, /mantenimiento-mobile-ui\.js/);
  assert.match(facade, /mount, unmount, showModalTarea/);
});

test('La interfaz incluye captura con cámara, tarjetas móviles y reporte rápido', () => {
  const ui = fs.readFileSync(uiPath, 'utf8');
  assert.match(ui, /capture="environment"/);
  assert.match(ui, /data-task-card=/);
  assert.match(ui, /Tomar e iniciar/);
  assert.match(ui, /Completar/);
  assert.match(ui, /origen_selector/);
  assert.match(ui, /Sacar de servicio/);
  assert.match(ui, /Esta habitación tiene una estancia activa/);
});

test('Los datos de responsables incluyen rol y estado activo para autoasignacion segura', () => {
  const repository = fs.readFileSync(repositoryPath, 'utf8');
  assert.match(repository, /id, nombre, correo, email, rol, activo/);
});
