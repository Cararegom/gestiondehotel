import {
  OPEN_TASK_STATES,
  TASK_SELECT_COLUMNS,
  normalizeTaskRecord
} from './mantenimiento-domain.js';

export const MAINTENANCE_PLAN_SELECT_COLUMNS = [
  'id',
  'hotel_id',
  'clase',
  'titulo',
  'descripcion',
  'ubicacion',
  'categoria_mantenimiento',
  'prioridad',
  'habitacion_id',
  'asignada_a',
  'creada_por',
  'activo',
  'fecha_inicio',
  'hora_programada',
  'recurrencia_unidad',
  'recurrencia_intervalo',
  'fecha_fin',
  'anticipaciones_dias',
  'requiere_evidencia',
  'checklist',
  'proxima_fecha',
  'creado_en',
  'actualizado_en'
].join(', ');

function throwIfError(error) {
  if (error) throw error;
}

export async function loadMaintenanceReferenceData(supabase, hotelId) {
  const [habitacionesResult, usuariosResult] = await Promise.all([
    supabase
      .from('habitaciones')
      .select('id, nombre, estado')
      .eq('hotel_id', hotelId)
      .order('nombre'),
    supabase
      .from('usuarios')
      .select('id, nombre, correo, email, rol, activo')
      .eq('hotel_id', hotelId)
      .order('nombre')
  ]);

  throwIfError(habitacionesResult.error);
  throwIfError(usuariosResult.error);

  return {
    habitaciones: habitacionesResult.data || [],
    usuarios: usuariosResult.data || []
  };
}

export async function listMaintenanceTasks(supabase, hotelId, filters = {}) {
  let query = supabase
    .from('tareas_mantenimiento')
    .select(TASK_SELECT_COLUMNS)
    .eq('hotel_id', hotelId)
    .order('creado_en', { ascending: false });

  if (filters.estado) query = query.eq('estado', filters.estado);
  if (filters.tipo) query = query.eq('tipo', filters.tipo);
  if (filters.habitacionId) query = query.eq('habitacion_id', filters.habitacionId);

  const { data, error } = await query;
  throwIfError(error);
  return (data || []).map(normalizeTaskRecord);
}

export async function createMaintenanceTask(supabase, hotelId, payload) {
  const { data, error } = await supabase
    .from('tareas_mantenimiento')
    .insert([{ ...payload, hotel_id: hotelId }])
    .select(TASK_SELECT_COLUMNS)
    .single();

  throwIfError(error);
  return normalizeTaskRecord(data);
}

export async function updateMaintenanceTask(supabase, hotelId, taskId, payload) {
  const { data, error } = await supabase
    .from('tareas_mantenimiento')
    .update(payload)
    .eq('hotel_id', hotelId)
    .eq('id', taskId)
    .select(TASK_SELECT_COLUMNS)
    .single();

  throwIfError(error);
  return normalizeTaskRecord(data);
}

export async function deleteMaintenanceTask(supabase, hotelId, taskId) {
  const { error } = await supabase
    .from('tareas_mantenimiento')
    .delete()
    .eq('hotel_id', hotelId)
    .eq('id', taskId);

  throwIfError(error);
}

export async function transitionMaintenanceTask(
  supabase,
  taskId,
  nextState,
  { comment = null, assigneeId = null } = {}
) {
  const { data, error } = await supabase.rpc('mantenimiento_transicionar_tarea', {
    p_tarea_id: taskId,
    p_estado_nuevo: nextState,
    p_comentario: comment || null,
    p_asignada_a: assigneeId || null
  });

  throwIfError(error);
  return normalizeTaskRecord(data);
}

export async function addMaintenanceComment(supabase, taskId, comment) {
  const { data, error } = await supabase.rpc('mantenimiento_agregar_comentario', {
    p_tarea_id: taskId,
    p_comentario: String(comment || '').trim()
  });

  throwIfError(error);
  return data;
}

export async function listMaintenanceHistory(supabase, hotelId, taskId) {
  const { data, error } = await supabase
    .from('mantenimiento_historial')
    .select(`
      id,
      hotel_id,
      tarea_id,
      actor_id,
      evento,
      estado_anterior,
      estado_nuevo,
      comentario,
      metadata,
      creado_en,
      actor:usuarios!mantenimiento_historial_actor_id_fkey(id,nombre,correo,email)
    `)
    .eq('hotel_id', hotelId)
    .eq('tarea_id', taskId)
    .order('creado_en', { ascending: false });

  throwIfError(error);
  return data || [];
}

export async function getMaintenanceMetrics(supabase, days = 30) {
  const normalizedDays = Math.max(7, Math.min(Number(days) || 30, 365));
  const { data, error } = await supabase.rpc('mantenimiento_metricas', {
    p_dias: normalizedDays
  });

  throwIfError(error);
  return data || {
    periodo_dias: normalizedDays,
    resumen: {},
    reincidencias: [],
    categorias: [],
    responsables: [],
    preventivos: []
  };
}

export async function findOpenPreventiveTask(supabase, task, nextDate) {
  let query = supabase
    .from('tareas_mantenimiento')
    .select('id')
    .eq('hotel_id', task.hotel_id)
    .eq('titulo', task.titulo)
    .eq('tipo', task.tipo)
    .eq('frecuencia', task.frecuencia)
    .eq('fecha_programada', nextDate)
    .in('estado', OPEN_TASK_STATES)
    .limit(1);

  if (task.habitacion_id) {
    query = query.eq('habitacion_id', task.habitacion_id);
  } else {
    query = query.is('habitacion_id', null);
  }

  const { data, error } = await query;
  throwIfError(error);
  return data?.[0] || null;
}

export async function createNextPreventiveTask(supabase, payload) {
  const { data, error } = await supabase
    .from('tareas_mantenimiento')
    .insert([payload])
    .select(TASK_SELECT_COLUMNS)
    .single();

  throwIfError(error);
  return normalizeTaskRecord(data);
}

export async function listMaintenancePlans(supabase, hotelId) {
  const { data, error } = await supabase
    .from('mantenimiento_planes')
    .select(MAINTENANCE_PLAN_SELECT_COLUMNS)
    .eq('hotel_id', hotelId)
    .order('activo', { ascending: false })
    .order('fecha_inicio', { ascending: true })
    .order('titulo', { ascending: true });

  throwIfError(error);
  return data || [];
}

export async function createMaintenancePlan(supabase, hotelId, payload) {
  const { data, error } = await supabase
    .from('mantenimiento_planes')
    .insert([{ ...payload, hotel_id: hotelId }])
    .select(MAINTENANCE_PLAN_SELECT_COLUMNS)
    .single();

  throwIfError(error);
  return data;
}

export async function updateMaintenancePlan(supabase, hotelId, planId, payload) {
  const { data, error } = await supabase
    .from('mantenimiento_planes')
    .update(payload)
    .eq('hotel_id', hotelId)
    .eq('id', planId)
    .select(MAINTENANCE_PLAN_SELECT_COLUMNS)
    .single();

  throwIfError(error);
  return data;
}

export async function deleteMaintenancePlan(supabase, hotelId, planId) {
  const { error } = await supabase
    .from('mantenimiento_planes')
    .delete()
    .eq('hotel_id', hotelId)
    .eq('id', planId);

  throwIfError(error);
}

export async function canManageMaintenancePlans(supabase, hotelId, currentUser = null) {
  try {
    const { data, error } = await supabase.rpc('usuario_actual_es_admin_hotel', {
      p_hotel_id: hotelId
    });
    if (!error) return Boolean(data);
  } catch (error) {
    console.warn('No se pudo validar permiso de administracion para mantenimiento:', error);
  }

  return ['admin', 'superadmin'].includes(String(currentUser?.rol || '').toLowerCase());
}
