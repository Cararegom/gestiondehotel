import {
  TASK_STATES,
  calculateNextScheduledDate,
  createRequestId,
  normalizeTaskFrequency,
  normalizeTaskState
} from './mantenimiento-domain.js';
import {
  createNextPreventiveTask,
  findOpenPreventiveTask
} from './mantenimiento-repository.js';

export async function ensureNextPreventiveTask({ supabase, task }) {
  const frecuencia = normalizeTaskFrequency(task?.frecuencia);
  if (!['diaria', 'semanal', 'mensual'].includes(frecuencia)) return null;
  if (normalizeTaskState(task?.estado) !== TASK_STATES.cerrado) return null;

  const nextDate = calculateNextScheduledDate(task);
  if (!nextDate) return null;

  const existing = await findOpenPreventiveTask(supabase, task, nextDate);
  if (existing) return existing;

  return createNextPreventiveTask(supabase, {
    hotel_id: task.hotel_id,
    titulo: task.titulo,
    descripcion: task.descripcion || null,
    estado: TASK_STATES.pendiente,
    tipo: task.tipo,
    categoria_mantenimiento: task.categoria_mantenimiento || 'general',
    frecuencia,
    fecha_programada: nextDate,
    fecha_completada: null,
    ultima_realizacion: task.fecha_completada || task.cerrada_en || new Date().toISOString(),
    creada_por: task.realizada_por || task.creada_por || task.asignada_a || null,
    asignada_a: task.asignada_a || null,
    realizada_por: null,
    habitacion_id: task.habitacion_id || null,
    prioridad: Number(task.prioridad) || 0,
    adjuntos: [],
    solicitud_id: createRequestId()
  });
}
