import { TASK_TYPES, normalizeTaskType } from './mantenimiento-domain.js';

export const QUICK_MAINTENANCE_CATEGORIES = Object.freeze([
  { id: 'climatizacion', label: 'Aire / clima', icon: '❄️', priority: 2 },
  { id: 'electricidad', label: 'Electricidad', icon: '⚡', priority: 2 },
  { id: 'plomeria', label: 'Agua / plomería', icon: '🚿', priority: 2 },
  { id: 'cerraduras', label: 'Puerta / cerradura', icon: '🔐', priority: 2 },
  { id: 'tv_wifi', label: 'TV / internet', icon: '📺', priority: 1 },
  { id: 'mobiliario', label: 'Muebles / cama', icon: '🛏️', priority: 1 },
  { id: 'banio', label: 'Baño', icon: '🚽', priority: 2 },
  { id: 'otro', label: 'Otro', icon: '🛠️', priority: 1 }
]);

const OCCUPIED_ROOM_STATES = new Set(['ocupada', 'activa', 'tiempo agotado']);

export function getQuickMaintenanceCategory(categoryId) {
  return QUICK_MAINTENANCE_CATEGORIES.find((item) => item.id === categoryId)
    || QUICK_MAINTENANCE_CATEGORIES[QUICK_MAINTENANCE_CATEGORIES.length - 1];
}

export function isRoomOccupiedForMaintenance(roomOrState) {
  const state = typeof roomOrState === 'object' ? roomOrState?.estado : roomOrState;
  return OCCUPIED_ROOM_STATES.has(String(state || '').trim().toLowerCase());
}

export function normalizeQuickImpact(requestedType, roomOrState) {
  const normalized = normalizeTaskType(requestedType);
  if (normalized === TASK_TYPES.bloqueante && isRoomOccupiedForMaintenance(roomOrState)) {
    return TASK_TYPES.programado;
  }
  return normalized;
}

export function resolveDefaultMaintenanceAssignee(users = [], currentUser = null) {
  const activeUsers = (users || []).filter((user) => user && user.activo !== false);
  const currentId = currentUser?.id ? String(currentUser.id) : '';
  const currentRole = String(currentUser?.rol || '').toLowerCase();

  if (currentId && currentRole === 'mantenimiento') {
    const currentInHotel = activeUsers.find((user) => String(user.id) === currentId);
    if (currentInHotel) return currentInHotel.id;
  }

  const maintenanceUsers = activeUsers.filter((user) => String(user.rol || '').toLowerCase() === 'mantenimiento');
  return maintenanceUsers.length === 1 ? maintenanceUsers[0].id : null;
}

export function sanitizeQuickTitle(value, categoryId, roomName = '') {
  const raw = String(value || '').replace(/\s+/g, ' ').trim();
  if (raw) return raw.slice(0, 180);

  const category = getQuickMaintenanceCategory(categoryId);
  const roomSuffix = roomName ? ` - ${String(roomName).trim()}` : '';
  return `${category.label}${roomSuffix}`.slice(0, 180);
}

export function buildQuickMaintenancePayload({
  title,
  description,
  categoryId = 'otro',
  requestedType = TASK_TYPES.programado,
  room = null,
  priority,
  assigneeId = null,
  attachments = [],
  requestId,
  currentUserId = null
} = {}) {
  const category = getQuickMaintenanceCategory(categoryId);
  const cleanTitle = sanitizeQuickTitle(title, category.id, room?.nombre || '');
  const cleanDescription = String(description || '').trim();
  const finalType = normalizeQuickImpact(requestedType, room);
  const numericPriority = Number.isFinite(Number(priority))
    ? Math.max(0, Math.min(3, Number(priority)))
    : category.priority;

  if (!cleanTitle) throw new Error('Describe brevemente el problema.');
  if (!requestId) throw new Error('No se pudo generar el identificador del reporte.');

  return {
    titulo: cleanTitle,
    descripcion: cleanDescription || null,
    prioridad: numericPriority,
    estado: 'pendiente',
    tipo: finalType,
    categoria_mantenimiento: category.id,
    fecha_programada: null,
    frecuencia: 'unica',
    asignada_a: assigneeId || null,
    habitacion_id: room?.id || null,
    adjuntos: Array.isArray(attachments) ? attachments : [],
    fecha_completada: null,
    realizada_por: null,
    ultima_realizacion: null,
    creada_por: currentUserId || null,
    solicitud_id: requestId
  };
}

export function mergeQuickFiles(...groups) {
  const seen = new Set();
  const merged = [];
  groups.flat().filter(Boolean).forEach((file) => {
    const key = `${file.name || ''}:${file.size || 0}:${file.lastModified || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(file);
  });
  return merged;
}
