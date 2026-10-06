const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const read = (file) => fs.readFileSync(`js/modules/mantenimiento/${file}`, 'utf8');

const workflow = read('mantenimiento-workflow-ui.js');
const mobile = read('mantenimiento-mobile-ui.js');
const rooms = read('mantenimiento-habitaciones-ui.js');
const incidents = read('mantenimiento-incidencias-ui.js');
const calendar = read('mantenimiento-calendario-ui.js');
const googleCalendar = read('mantenimiento-calendario-google-ui.js');
const activeComposition = [workflow, rooms, incidents, googleCalendar].join('\n');

function loadEventContract() {
  let source = read('mantenimiento-ui-events.js')
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ');
  source += '\nthis.__api = { MAINTENANCE_UI_RENDERED_EVENT, MAINTENANCE_UI_SURFACES, emitMaintenanceUiRendered, isMaintenanceUiSurface };';

  class FakeCustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  }

  const context = { CustomEvent: FakeCustomEvent, Object };
  vm.runInNewContext(source, context);
  return context.__api;
}

test('M10 coordina las capas de mantenimiento con un evento y superficies tipadas', () => {
  const api = loadEventContract();
  let received = null;
  const container = {
    dispatchEvent(event) {
      received = event;
      return true;
    }
  };

  assert.equal(api.emitMaintenanceUiRendered(container, api.MAINTENANCE_UI_SURFACES.taskModal, { taskId: 'task-1' }), true);
  assert.equal(received.type, 'maintenanceUiRendered');
  assert.equal(received.detail.surface, 'task-modal');
  assert.equal(received.detail.taskId, 'task-1');
  assert.equal(api.isMaintenanceUiSurface(received, api.MAINTENANCE_UI_SURFACES.taskModal), true);
  assert.equal(api.isMaintenanceUiSurface(received, api.MAINTENANCE_UI_SURFACES.planModal), false);
});

test('M10 elimina observadores globales y temporizadores de recomposicion', () => {
  assert.doesNotMatch(activeComposition, /MutationObserver/);
  assert.doesNotMatch(activeComposition, /scheduleEnhance/);
  assert.doesNotMatch(activeComposition, /enhanceTimer/);
  assert.match(workflow, /MAINTENANCE_UI_SURFACES\.taskList/);
  assert.match(rooms, /MAINTENANCE_UI_SURFACES\.taskModal/);
  assert.match(rooms, /MAINTENANCE_UI_SURFACES\.planModal/);
  assert.match(incidents, /MAINTENANCE_UI_SURFACES\.roomChecklist/);
});

test('M10 identifica filas, transiciones y eventos del calendario por datos semanticos', () => {
  assert.match(mobile, /data-task-status-row/);
  assert.match(workflow, /data-maintenance-transition=/);
  assert.match(workflow, /querySelector\('\[data-task-status-row\]'\)/);
  assert.match(rooms, /dataset\.maintenanceTransition !== 'cerrado'/);
  assert.match(incidents, /dataset\.maintenanceTransition !== 'cerrado'/);
  assert.doesNotMatch(`${rooms}\n${incidents}`, /\/cerr\/i/);

  for (const attribute of [
    'data-google-calendar-viewport',
    'data-google-calendar-inner',
    'data-google-calendar-header',
    'data-google-calendar-grid',
    'data-google-calendar-day',
    'data-google-calendar-day-number',
    'data-google-calendar-events',
    'data-google-calendar-event',
    'data-google-calendar-more'
  ]) {
    assert.match(calendar, new RegExp(attribute));
  }
  assert.doesNotMatch(googleCalendar, /querySelector|getEventKind|startsWith\(|nth-child/);
});

test('M10 publica cada render despues de actualizar su superficie', () => {
  assert.match(mobile, /emitMaintenanceUiRendered\(container, MAINTENANCE_UI_SURFACES\.taskList/);
  assert.match(workflow, /emitMaintenanceUiRendered\(container, MAINTENANCE_UI_SURFACES\.taskModal/);
  assert.match(calendar, /emitMaintenanceUiRendered\(activeContainer, MAINTENANCE_UI_SURFACES\.calendar/);
  assert.match(calendar, /emitMaintenanceUiRendered\(activeContainer, MAINTENANCE_UI_SURFACES\.planModal/);
  assert.match(rooms, /emitMaintenanceUiRendered\(activeContainer, MAINTENANCE_UI_SURFACES\.roomChecklist/);
});
