// Fachada del Mapa Hotel.
// Recepción conserva el mapa operativo completo; Mantenimiento / Conserje usa
// una vista mínima y de solo lectura que no carga datos privados de huéspedes.

let activeModule = null;

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function isMaintenanceConciergeUser(user) {
  const role = normalizeRole(user?.role || user?.rol);
  return window.__maintenanceConciergeMode === true
    || role === 'mantenimiento'
    || role.includes('mantenimiento')
    || role.includes('conserje');
}

async function resolveModule(user) {
  if (isMaintenanceConciergeUser(user)) {
    return import('./mapa-habitaciones-readonly.js');
  }
  return import('./mapa-habitaciones-operativo.js');
}

export async function mount(container, supabase, currentUser, hotelId, planDetails) {
  activeModule = await resolveModule(currentUser);
  return activeModule.mount(container, supabase, currentUser, hotelId, planDetails);
}

export async function renderRooms(...args) {
  const operational = await import('./mapa-habitaciones-operativo.js');
  return operational.renderRooms(...args);
}

export function unmount(container) {
  const result = activeModule?.unmount?.(container);
  activeModule = null;
  return result;
}
