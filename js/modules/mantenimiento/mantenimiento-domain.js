export const TASK_TYPES = Object.freeze({
  bloqueante: 'bloqueante',
  programado: 'programado'
});

export const TASK_STATES = Object.freeze({
  pendiente: 'pendiente',
  enRevision: 'en_revision',
  asignado: 'asignado',
  enProceso: 'en_proceso',
  resuelto: 'resuelto',
  cerrado: 'cerrado',
  cancelado: 'cancelado'
});

export const OPEN_TASK_STATES = Object.freeze([
  TASK_STATES.pendiente,
  TASK_STATES.enRevision,
  TASK_STATES.asignado,
  TASK_STATES.enProceso,
  TASK_STATES.resuelto,
  'en_progreso'
]);

export const CLOSED_TASK_STATES = Object.freeze([
  TASK_STATES.cerrado,
  TASK_STATES.cancelado,
  'completada',
  'cancelada'
]);

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
  'solicitud_id',
  'revisada_en',
  'asignada_en',
  'iniciada_en',
  'resuelta_en',
  'cerrada_en',
  'cancelada_en',
  'sla_objetivo_minutos',
  'vencimiento_at',
  'ultimo_cambio_por'
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

export function normalizeTaskState(estado) {
  const value = String(estado || TASK_STATES.pendiente).trim().toLowerCase();
  if (value === 'en_progreso') return TASK_STATES.enProceso;
  if (value === 'completada') return TASK_STATES.cerrado;
  if (value === 'cancelada') return TASK_STATES.cancelado;
  return value;
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
    estado: normalizeTaskState(task.estado),
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
  return OPEN_TASK_STATES.map(normalizeTaskState).includes(normalizeTaskState(estado));
}

export function isClosedTaskState(estado) {
  return CLOSED_TASK_STATES.map(normalizeTaskState).includes(normalizeTaskState(estado));
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
  const normalized = normalizeTaskState(estado);
  const map = {
    pendiente: { text: 'Pendiente', classes: 'bg-orange-100 text-orange-700' },
    en_revision: { text: 'En revisión', classes: 'bg-cyan-100 text-cyan-800' },
    asignado: { text: 'Asignado', classes: 'bg-indigo-100 text-indigo-800' },
    en_proceso: { text: 'En proceso', classes: 'bg-blue-100 text-blue-700' },
    resuelto: { text: 'Resuelto', classes: 'bg-emerald-100 text-emerald-800' },
    cerrado: { text: 'Cerrado', classes: 'bg-green-100 text-green-700' },
    cancelado: { text: 'Cancelado', classes: 'bg-slate-200 text-slate-600' }
  };
  return map[normalized] || { text: normalized || '-', classes: 'bg-slate-100 text-slate-700' };
}

export function getTypeMeta(tipo, task = null) {
  return normalizeTaskType(tipo, task) === TASK_TYPES.programado
    ? { text: 'Pendiente programado', classes: 'bg-violet-100 text-violet-700' }
    : { text: 'Bloquea habitacion', classes: 'bg-red-100 text-red-700' };
}

export function getWorkflowAction(task, currentUserId = null) {
  const estado = normalizeTaskState(task?.estado);
  if (estado === TASK_STATES.pendiente) {
    return { nextState: TASK_STATES.enRevision, label: 'Revisar', comment: 'Reporte tomado para revisión.' };
  }
  if (estado === TASK_STATES.enRevision) {
    return {
      nextState: TASK_STATES.enProceso,
      label: task?.asignada_a ? 'Iniciar' : 'Tomar e iniciar',
      claim: !task?.asignada_a && Boolean(currentUserId),
      comment: 'Mantenimiento iniciado.'
    };
  }
  if (estado === TASK_STATES.asignado) {
    return { nextState: TASK_STATES.enProceso, label: 'Iniciar', comment: 'Mantenimiento iniciado.' };
  }
  if (estado === TASK_STATES.enProceso) {
    return { nextState: TASK_STATES.resuelto, label: 'Marcar resuelto', comment: 'Trabajo marcado como resuelto.' };
  }
  if (estado === TASK_STATES.resuelto) {
    return { nextState: TASK_STATES.cerrado, label: 'Cerrar', comment: 'Trabajo verificado y cerrado.' };
  }
  return null;
}

export function getSlaMeta(task, now = Date.now()) {
  if (!task?.vencimiento_at || !isOpenTaskState(task?.estado)) {
    return { text: '', overdue: false, remainingMinutes: null, classes: 'bg-slate-100 text-slate-600' };
  }

  const due = new Date(task.vencimiento_at).getTime();
  if (!Number.isFinite(due)) {
    return { text: '', overdue: false, remainingMinutes: null, classes: 'bg-slate-100 text-slate-600' };
  }

  const diffMinutes = Math.round((due - Number(now)) / 60000);
  const overdue = diffMinutes < 0;
  const abs = Math.abs(diffMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  const duration = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

  if (overdue) {
    return { text: `Vencida ${duration}`, overdue: true, remainingMinutes: diffMinutes, classes: 'bg-red-100 text-red-700' };
  }
  if (diffMinutes <= 60) {
    return { text: `Vence en ${duration}`, overdue: false, remainingMinutes: diffMinutes, classes: 'bg-amber-100 text-amber-800' };
  }
  return { text: `SLA ${duration}`, overdue: false, remainingMinutes: diffMinutes, classes: 'bg-slate-100 text-slate-700' };
}

function getTaskSortValue(task) {
  const fechaProgramada = task?.fecha_programada
    ? new Date(`${String(task.fecha_programada).slice(0, 10)}T00:00:00`).getTime()
    : Number.MAX_SAFE_INTEGER;
  const vencimiento = task?.vencimiento_at ? new Date(task.vencimiento_at).getTime() : Number.MAX_SAFE_INTEGER;
  const creadoEn = task?.creado_en ? new Date(task.creado_en).getTime() : 0;
  const openWeight = isOpenTaskState(task?.estado) ? 0 : 1;
  const typeWeight = isBlockingTask(task) ? 0 : 1;
  const priorityWeight = -Number(task?.prioridad || 0);
  return [openWeight, typeWeight, priorityWeight, vencimiento, fechaProgramada, -creadoEn];
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

  const completionDate = task?.fecha_completada || task?.cerrada_en;
  const baseDate = completionDate
    ? new Date(completionDate)
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
