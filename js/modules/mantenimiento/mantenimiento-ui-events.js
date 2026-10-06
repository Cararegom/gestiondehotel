export const MAINTENANCE_UI_RENDERED_EVENT = 'maintenanceUiRendered';

export const MAINTENANCE_UI_SURFACES = Object.freeze({
  taskList: 'task-list',
  taskModal: 'task-modal',
  planModal: 'plan-modal',
  calendar: 'calendar',
  roomChecklist: 'room-checklist'
});

export function emitMaintenanceUiRendered(container, surface, detail = {}) {
  if (!container?.dispatchEvent || !surface || typeof CustomEvent !== 'function') return false;
  return container.dispatchEvent(new CustomEvent(MAINTENANCE_UI_RENDERED_EVENT, {
    detail: { ...detail, surface }
  }));
}

export function isMaintenanceUiSurface(event, surface) {
  return event?.type === MAINTENANCE_UI_RENDERED_EVENT
    && event?.detail?.surface === surface;
}
