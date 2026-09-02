export const TASK_TYPES = Object.freeze({
  bloqueante: 'bloqueante',
  programado: 'programado'
});

export const OPEN_TASK_STATES = Object.freeze(['pendiente', 'en_progreso']);
export const CLOSED_TASK_STATES = Object.freeze(['completada', 'cancelada']);
export const LEGACY_PROGRAMMED_MARKER = '[PROGRAMADO]';

export const TASK_FREQUENCY_LABELS = Object.freeze({
  unica: 'Unica',
  diaria: 'Diaria',
  semanal: 'Semanal',
  mensual: 'Mensual',
  personalizada: 'Personalizada'
});

export const TASK_SELECT_COLUMNS = [
  'id',
  'hotel_id',
  'habitacion_id',
  'titulo',
  'descripcion',
  'prioridad',
  'estado',
  'tipo',
  'categoria_mantenimiento',
  'fecha_programada',
  'fecha_completada',
  'asignada_a',
  'creada_por',
  'realizada_por',
  'creado_en',
  'actualizado_en',
  'adjuntos',
  'frecuencia',
  'ultima_realizacion',
  'solicitud_id'
].join(', ');

export function stripLegacyProgrammedMarker(value) {
  return String(value ?? '')
    .replaceAll(LEGACY_PROGRAMMED_MARKER, '')
    .replace(/^\s*\n?/, '')
    .trim();
}

export function normalizeTaskType(tipo, task = null) {
  if (tipo === TASK_TYPES.programado || tipo === TASK_TYPES.bloqueante) return tipo;

  const legacyText = `${task?.titulo || ''}\n${task?.descripcion || ''}`;
  if (legacyText.includes(LEGACY_PROGRAMMED_MARKER)) return TASK_TYPES.programado;

  return TASK_TYPES.bloqueante;
}

export function normalizeTaskFrequency(frecuencia) {
  const normalized = String(frecuencia || 'unica');
  return Object.prototype.hasOwnProperty.call(TASK_FREQUENCY_LABELS, normalized)
    ? normalized
    : 'unica';
}

export function normalizeTaskRecord(task) {
  if (!task) return task;

  return {
    ...task,
    tipo: normalizeTaskType(task.tipo, task),
    frecuencia: normalizeTaskFrequency(task.frecuencia),
    titulo: stripLegacyProgrammedMarker(task.titulo),
    descripcion: stripLegacyProgrammedMarker(task.descripcion),
    adjuntos: Array.isArray(task.adjuntos) ? task.adjuntos.filter(Boolean) : []
  };
}

export function isBlockingTask(taskOrType) {
  if (typeof taskOrType === 'object' && taskOrType !== null) {
    return normalizeTaskType(taskOrType.tipo, taskOrType) === TASK_TYPES.bloqueante;
  }
  return normalizeTaskType(taskOrType) === TASK_TYPES.bloqueante;
}

export function isOpenTaskState(estado) {
  return OPEN_TASK_STATES.includes(estado);
}

export function isClosedTaskState(estado) {
  return CLOSED_TASK_STATES.includes(estado);
}

export function getTaskFrequencyLabel(frecuencia) {
  return TASK_FREQUENCY_LABELS[normalizeTaskFrequency(frecuencia)] || 'Unica';
}

export function getPriorityMeta(prioridad) {
  const map = {
    0: { text: 'Baja', classes: 'bg-green-100 text-green-800' },
    1: { text: 'Media', classes: 'bg-yellow-100 text-yellow-800' },
    2: { text: 'Alta', classes: 'bg-orange-100 text-orange-800' },
    3: { text: 'Urgente', classes: 'bg-red-100 text-red-800' }
  };
  return map[Number(prioridad)] || { text: '-', classes: 'bg-slate-100 text-slate-700' };
}

export function getStatusMeta(estado) {
  const map = {
    pendiente: { text: 'Pendiente', classes: 'bg-orange-100 text-orange-700' },
    en_progreso: { text: 'En progreso', classes: 'bg-blue-100 text-blue-700' },
    completada: { text: 'Completada', classes: 'bg-green-100 text-green-700' },
    cancelada: { text: 'Cancelada', classes: 'bg-slate-200 text-slate-600' }
  };
  return map[estado] || { text: estado || '-', classes: 'bg-slate-100 text-slate-700' };
}

export function getTypeMeta(tipo, task = null) {
  return normalizeTaskType(tipo, task) === TASK_TYPES.programado
    ? { text: 'Pendiente programado', classes: 'bg-violet-100 text-violet-700' }
    : { text: 'Bloquea habitacion', classes: 'bg-red-100 text-red-700' };
}

function getTaskSortValue(task) {
  const fechaProgramada = task?.fecha_programada
    ? new Date(`${String(task.fecha_programada).slice(0, 10)}T00:00:00`).getTime()
    : Number.MAX_SAFE_INTEGER;
  const creadoEn = task?.creado_en ? new Date(task.creado_en).getTime() : 0;
  const openWeight = isOpenTaskState(task?.estado) ? 0 : 1;
  const typeWeight = isBlockingTask(task) ? 0 : 1;
  const priorityWeight = -Number(task?.prioridad || 0);
  return [openWeight, typeWeight, priorityWeight, fechaProgramada, -creadoEn];
}

export function sortTasks(tasks) {
  return [...(tasks || [])].sort((a, b) => {
    const aSort = getTaskSortValue(a);
    const bSort = getTaskSortValue(b);
    for (let index = 0; index < aSort.length; index += 1) {
      if (aSort[index] < bSort[index]) return -1;
      if (aSort[index] > bSort[index]) return 1;
    }
    return 0;
  });
}

export function calculateNextScheduledDate(task) {
  const frecuencia = normalizeTaskFrequency(task?.frecuencia);
  if (!['diaria', 'semanal', 'mensual'].includes(frecuencia)) return null;

  const baseDate = task?.fecha_completada
    ? new Date(task.fecha_completada)
    : (task?.fecha_programada ? new Date(`${String(task.fecha_programada).slice(0, 10)}T12:00:00`) : new Date());

  if (Number.isNaN(baseDate.getTime())) return null;

  const nextDate = new Date(baseDate);
  if (frecuencia === 'diaria') nextDate.setDate(nextDate.getDate() + 1);
  if (frecuencia === 'semanal') nextDate.setDate(nextDate.getDate() + 7);
  if (frecuencia === 'mensual') nextDate.setMonth(nextDate.getMonth() + 1);

  return nextDate.toISOString().slice(0, 10);
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3 | 0x8);
    return value.toString(16);
  });
}

export function isOccupiedMaintenanceConflict(error) {
  const details = [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();
  return details.includes('MANTENIMIENTO_HABITACION_OCUPADA');
}
