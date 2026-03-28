import { showLoading, showError } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { getEvidenceAcceptString, uploadEvidenceFiles } from '../../services/evidenceUploadService.js';

let mantenimientoSubscription = null;
let supabaseInstance = null;

const TASK_TYPES = {
  bloqueante: 'bloqueante',
  programado: 'programado'
};

const OPEN_TASK_STATES = ['pendiente', 'en_progreso'];
const CLOSED_TASK_STATES = ['completada', 'cancelada'];
const PROGRAMMED_TASK_MARKER = '[PROGRAMADO]';
const TASK_FREQUENCY_LABELS = {
  unica: 'Unica',
  diaria: 'Diaria',
  semanal: 'Semanal',
  mensual: 'Mensual',
  personalizada: 'Personalizada'
};

export async function mount(container, supabase, currentUser, hotelId) {
  supabaseInstance = supabase;

  container.innerHTML = `
    <h2 class="mb-6 flex items-center gap-2 text-2xl font-bold">
      <span>🛠️</span>
      <span>Mantenimiento</span>
    </h2>

    <div class="mb-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
      <p class="font-semibold text-slate-800">Organiza mantenimientos bloqueantes y pendientes sin sacar la habitacion de servicio.</p>
      <p class="mt-1">Las tareas <strong>programadas</strong> sirven para anotar trabajos por hacer sin cambiar el estado de la habitacion. Las tareas <strong>bloqueantes</strong> si pasan la habitacion a mantenimiento.</p>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2">
      <select id="filtro-estado" class="form-control w-auto rounded-lg">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_progreso">En progreso</option>
        <option value="completada">Completada</option>
        <option value="cancelada">Cancelada</option>
      </select>

      <select id="filtro-tipo" class="form-control w-auto rounded-lg">
        <option value="">Todos los tipos</option>
        <option value="${TASK_TYPES.bloqueante}">Bloquea habitacion</option>
        <option value="${TASK_TYPES.programado}">Pendiente programado</option>
      </select>

      <select id="filtro-habitacion" class="form-control min-w-[220px] rounded-lg">
        <option value="">Todas las habitaciones</option>
      </select>

      <button id="btn-filtrar" class="button button-primary">Filtrar</button>
      <button id="btn-imprimir-pendientes" class="button button-secondary">Imprimir pendientes</button>
      <button id="btn-imprimir-habitacion" class="button button-secondary">Imprimir habitacion</button>
      <button id="btn-nueva-tarea" class="button button-success ml-auto">+ Nueva tarea</button>
    </div>

    <div id="mant-resumen" class="mb-4"></div>
    <div id="mant-list" class="mt-4"></div>
    <div id="mant-modal"></div>
  `;

  container.querySelector('#btn-filtrar')?.addEventListener('click', () => {
    renderTareas(container, supabase, hotelId, currentUser);
  });

  container.querySelector('#btn-nueva-tarea')?.addEventListener('click', () => {
    showModalTarea(container, supabase, hotelId, currentUser, null);
  });

  container.querySelector('#btn-imprimir-pendientes')?.addEventListener('click', () => {
    imprimirPendientesDesdeVista(container, false);
  });

  container.querySelector('#btn-imprimir-habitacion')?.addEventListener('click', () => {
    imprimirPendientesDesdeVista(container, true);
  });

  await renderTareas(container, supabase, hotelId, currentUser);

  if (mantenimientoSubscription) {
    supabase.removeChannel(mantenimientoSubscription);
    mantenimientoSubscription = null;
  }

  mantenimientoSubscription = supabase.channel('public:tareas_mantenimiento')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_mantenimiento' }, () => {
      renderTareas(container, supabase, hotelId, currentUser);
    })
    .subscribe();
}

export function unmount() {
  if (mantenimientoSubscription && supabaseInstance) {
    supabaseInstance.removeChannel(mantenimientoSubscription).catch((error) => {
      console.error('Error al remover el canal de mantenimiento:', error);
    });
  }

  mantenimientoSubscription = null;
  supabaseInstance = null;
}

function normalizeTaskType(tipo) {
  return tipo === TASK_TYPES.programado ? TASK_TYPES.programado : TASK_TYPES.bloqueante;
}

function normalizeTaskFrequency(frecuencia) {
  const normalized = String(frecuencia || 'unica');
  return Object.prototype.hasOwnProperty.call(TASK_FREQUENCY_LABELS, normalized)
    ? normalized
    : 'unica';
}

function getTaskFrequencyLabel(frecuencia) {
  return TASK_FREQUENCY_LABELS[normalizeTaskFrequency(frecuencia)] || 'Unica';
}

function hasProgrammedTaskMarker(value) {
  return String(value ?? '').includes(PROGRAMMED_TASK_MARKER);
}

function stripProgrammedTaskMarker(value) {
  return String(value ?? '')
    .replace(PROGRAMMED_TASK_MARKER, '')
    .replace(/^\s*\n?/, '')
    .trim();
}

function addProgrammedTaskMarker(value) {
  const cleanValue = stripProgrammedTaskMarker(value);
  return cleanValue ? `${PROGRAMMED_TASK_MARKER}\n${cleanValue}` : PROGRAMMED_TASK_MARKER;
}

function normalizeTaskRecord(task) {
  if (!task) return task;

  const markerPresent = hasProgrammedTaskMarker(task.descripcion) || hasProgrammedTaskMarker(task.titulo);

  return {
    ...task,
    tipo: markerPresent ? TASK_TYPES.programado : normalizeTaskType(task.tipo),
    frecuencia: normalizeTaskFrequency(task.frecuencia),
    titulo: stripProgrammedTaskMarker(task.titulo),
    descripcion: stripProgrammedTaskMarker(task.descripcion),
    adjuntos: Array.isArray(task.adjuntos) ? task.adjuntos.filter(Boolean) : []
  };
}

function buildProgrammedCompatibilityPayload(payload) {
  return {
    ...payload,
    tipo: null,
    descripcion: addProgrammedTaskMarker(payload.descripcion)
  };
}

function shouldRetryProgrammedCompatibility(error, payload) {
  if (payload?.tipo !== TASK_TYPES.programado) return false;

  const details = [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return !details || /tipo|programado|enum|check|constraint|invalid|schema|column|pgrst/.test(details);
}

function isBlockingTaskType(tipo) {
  return normalizeTaskType(tipo) === TASK_TYPES.bloqueante;
}

function isOpenTaskState(estado) {
  return OPEN_TASK_STATES.includes(estado);
}

function isClosedTaskState(estado) {
  return CLOSED_TASK_STATES.includes(estado);
}

function renderPrioridad(prioridad, colored = false) {
  const map = {
    0: { text: 'Baja', classes: 'bg-green-100 text-green-800' },
    1: { text: 'Media', classes: 'bg-yellow-100 text-yellow-800' },
    2: { text: 'Alta', classes: 'bg-orange-100 text-orange-800' },
    3: { text: 'Urgente', classes: 'bg-red-100 text-red-800' }
  };

  const item = map[Number(prioridad)] || { text: '-', classes: '' };
  if (!colored) return item.text;
  return `<span class="rounded-full px-2 py-1 text-xs font-semibold ${item.classes}">${item.text}</span>`;
}

function renderEstado(estado, colored = false) {
  const map = {
    pendiente: { text: 'Pendiente', classes: 'bg-orange-100 text-orange-700' },
    en_progreso: { text: 'En progreso', classes: 'bg-blue-100 text-blue-700' },
    completada: { text: 'Completada', classes: 'bg-green-100 text-green-700' },
    cancelada: { text: 'Cancelada', classes: 'bg-slate-200 text-slate-600' }
  };

  const item = map[estado] || { text: estado || '-', classes: 'bg-slate-100 text-slate-700' };
  if (!colored) return item.text;
  return `<span class="rounded-full px-2 py-1 text-xs font-semibold ${item.classes}">${item.text}</span>`;
}

function renderTipo(tipo, colored = false) {
  const normalized = normalizeTaskType(tipo);
  const item = normalized === TASK_TYPES.programado
    ? { text: 'Pendiente programado', classes: 'bg-violet-100 text-violet-700' }
    : { text: 'Bloquea habitacion', classes: 'bg-red-100 text-red-700' };

  if (!colored) return item.text;
  return `<span class="rounded-full px-2 py-1 text-xs font-semibold ${item.classes}">${item.text}</span>`;
}

function getTaskSortValue(task) {
  const fechaProgramada = task?.fecha_programada ? new Date(task.fecha_programada).getTime() : Number.MAX_SAFE_INTEGER;
  const creadoEn = task?.creado_en ? new Date(task.creado_en).getTime() : 0;
  const openWeight = isOpenTaskState(task?.estado) ? 0 : 1;
  const typeWeight = isBlockingTaskType(task?.tipo) ? 0 : 1;
  return [openWeight, typeWeight, fechaProgramada, -creadoEn];
}

function sortTasks(tasks) {
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

function renderResumen(container, tareas) {
  const resumen = container.querySelector('#mant-resumen');
  if (!resumen) return;

  const openTasks = (tareas || []).filter((task) => isOpenTaskState(task.estado));
  const bloqueantes = openTasks.filter((task) => isBlockingTaskType(task.tipo));
  const programadas = openTasks.filter((task) => !isBlockingTaskType(task.tipo));
  const completadas = (tareas || []).filter((task) => task.estado === 'completada');
  const preventivas = openTasks.filter((task) => normalizeTaskFrequency(task.frecuencia) !== 'unica');
  const hoy = new Date();
  const preventivasVencidas = preventivas.filter((task) => {
    if (!task.fecha_programada) return false;
    const fechaProgramada = new Date(`${task.fecha_programada}T23:59:59`);
    return !Number.isNaN(fechaProgramada.getTime()) && fechaProgramada.getTime() < hoy.getTime();
  });

  resumen.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Bloqueantes abiertas</p>
        <p class="mt-2 text-3xl font-bold text-red-700">${bloqueantes.length}</p>
        <p class="mt-1 text-xs text-red-600">Estas si sacan habitaciones de servicio.</p>
      </div>
      <div class="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">Pendientes programados</p>
        <p class="mt-2 text-3xl font-bold text-violet-700">${programadas.length}</p>
        <p class="mt-1 text-xs text-violet-600">La habitacion puede seguir alquilandose.</p>
      </div>
      <div class="rounded-2xl border border-green-200 bg-green-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-green-600">Completadas</p>
        <p class="mt-2 text-3xl font-bold text-green-700">${completadas.length}</p>
        <p class="mt-1 text-xs text-green-600">Historial resuelto con seguimiento.</p>
      </div>
      <div class="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Preventivo real</p>
        <p class="mt-2 text-3xl font-bold text-blue-700">${preventivas.length}</p>
        <p class="mt-1 text-xs text-blue-600">${preventivasVencidas.length > 0 ? `${preventivasVencidas.length} vencida(s) por ejecutar.` : 'Sin preventivos vencidos.'}</p>
      </div>
    </div>
  `;
}

function updateHabitacionFilterOptions(container, habitaciones) {
  const select = container.querySelector('#filtro-habitacion');
  if (!select) return;

  const currentValue = select.value || '';
  const optionsHtml = (habitaciones || [])
    .map((habitacion) => `<option value="${habitacion.id}">${habitacion.nombre}</option>`)
    .join('');

  select.innerHTML = `<option value="">Todas las habitaciones</option>${optionsHtml}`;
  select.value = currentValue;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderAttachmentLinks(attachments = []) {
  if (!attachments.length) {
    return '<span class="text-xs text-slate-400">Sin adjuntos</span>';
  }

  return attachments.map((attachment, index) => `
    <a
      href="${escapeHtml(attachment.url || '#')}"
      target="_blank"
      rel="noopener noreferrer"
      class="inline-flex items-center rounded-full bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
    >
      ${attachment.kind === 'image' ? 'Captura' : 'Archivo'} ${index + 1}
    </a>
  `).join('');
}

function renderEditableAttachmentList(attachments = []) {
  if (!attachments.length) {
    return '<p class="text-xs text-slate-500">Sin adjuntos guardados.</p>';
  }

  return `
    <div class="space-y-2">
      ${attachments.map((attachment, index) => `
        <div class="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <a href="${escapeHtml(attachment.url || '#')}" target="_blank" rel="noopener noreferrer" class="truncate font-semibold text-blue-700 hover:text-blue-900">
            ${escapeHtml(attachment.name || `Adjunto ${index + 1}`)}
          </a>
          <button type="button" class="mant-remove-attachment rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700 hover:bg-rose-200" data-index="${index}">
            Quitar
          </button>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSelectedFilesPreview(files = []) {
  if (!files.length) {
    return '<p class="text-xs text-slate-500">Puedes adjuntar capturas, PDF o archivos de apoyo.</p>';
  }

  return `
    <div class="space-y-2">
      ${files.map((file) => `
        <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span class="truncate pr-3">${escapeHtml(file.name)}</span>
          <strong>${escapeHtml(`${(Number(file.size || 0) / 1024 / 1024).toFixed(2)} MB`)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

async function renderTareas(container, supabase, hotelId, currentUser) {
  const list = container.querySelector('#mant-list');
  if (!list) return;

  showLoading(list);

  const estadoFiltro = container.querySelector('#filtro-estado')?.value || '';
  const tipoFiltro = container.querySelector('#filtro-tipo')?.value || '';
  const habitacionFiltro = container.querySelector('#filtro-habitacion')?.value || '';

  const [habitacionesResult, usuariosResult] = await Promise.all([
    supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).order('nombre'),
    supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId).order('nombre')
  ]);

  const habitaciones = habitacionesResult.data || [];
  const usuarios = usuariosResult.data || [];
  const habMap = new Map(habitaciones.map((habitacion) => [habitacion.id, habitacion.nombre]));
  const userMap = new Map(usuarios.map((usuario) => [usuario.id, usuario.nombre || usuario.correo || usuario.id]));

  updateHabitacionFilterOptions(container, habitaciones);

  let query = supabase
    .from('tareas_mantenimiento')
    .select('id, habitacion_id, titulo, descripcion, prioridad, estado, tipo, fecha_programada, fecha_completada, asignada_a, creado_en, adjuntos, frecuencia, ultima_realizacion')
    .eq('hotel_id', hotelId);

  if (estadoFiltro) {
    query = query.eq('estado', estadoFiltro);
  }

  if (habitacionFiltro) {
    query = query.eq('habitacion_id', habitacionFiltro);
  }

  const { data: tareasRaw, error } = await query.order('creado_en', { ascending: false });

  if (error) {
    showError(list, `Error cargando tareas: ${error.message}`);
    return;
  }

  let tareas = (tareasRaw || []).map((task) => normalizeTaskRecord(task));
  if (tipoFiltro) {
    tareas = tareas.filter((task) => normalizeTaskType(task.tipo) === tipoFiltro);
  }

  const sortedTasks = sortTasks(tareas || []);
  container.__mantCache = {
    tareas: sortedTasks,
    habitaciones,
    habMap,
    userMap
  };

  renderResumen(container, sortedTasks);

  if (sortedTasks.length === 0) {
    list.innerHTML = `
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-slate-500">
        No hay tareas de mantenimiento que coincidan con los filtros.
      </div>
    `;
    return;
  }

  list.innerHTML = `
    <div class="overflow-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full table-auto border-collapse text-sm md:text-base">
        <thead class="border-b bg-slate-100">
          <tr>
            <th class="px-3 py-3 text-left">Encargado</th>
            <th class="px-3 py-3 text-left">Tipo</th>
            <th class="px-3 py-3 text-left">Titulo</th>
            <th class="px-3 py-3 text-left">Habitacion</th>
            <th class="px-3 py-3 text-center">Prioridad</th>
            <th class="px-3 py-3 text-center">Estado</th>
            <th class="px-3 py-3 text-left">Programada</th>
            <th class="px-3 py-3 text-left">Reporte</th>
            <th class="px-3 py-3 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-200">
          ${sortedTasks.map((task) => `
            <tr class="transition hover:bg-blue-50">
              <td class="px-3 py-2 font-semibold">${userMap.get(task.asignada_a) || 'No asignado'}</td>
              <td class="px-3 py-2">${renderTipo(task.tipo, true)}</td>
              <td class="px-3 py-2">
                <p class="font-medium text-slate-800">${task.titulo || '-'}</p>
                <p class="mt-1 text-xs text-slate-500">${task.descripcion ? escapeHtml(task.descripcion).slice(0, 90) : 'Sin descripcion'}</p>
                <div class="mt-2 flex flex-wrap gap-2">
                  <span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">Frecuencia: ${escapeHtml(getTaskFrequencyLabel(task.frecuencia))}</span>
                  ${renderAttachmentLinks(task.adjuntos || [])}
                </div>
              </td>
              <td class="px-3 py-2">${task.habitacion_id ? (habMap.get(task.habitacion_id) || 'N/A') : 'General'}</td>
              <td class="px-3 py-2 text-center">${renderPrioridad(task.prioridad, true)}</td>
              <td class="px-3 py-2 text-center">${renderEstado(task.estado, true)}</td>
              <td class="px-3 py-2">${task.fecha_programada ? new Date(task.fecha_programada).toLocaleDateString() : 'Sin fecha'}</td>
              <td class="px-3 py-2">
                <p>${task.creado_en ? new Date(task.creado_en).toLocaleString() : ''}</p>
                ${task.ultima_realizacion ? `<p class="mt-1 text-xs text-slate-500">Ultima: ${new Date(task.ultima_realizacion).toLocaleString()}</p>` : ''}
              </td>
              <td class="px-3 py-2 text-center">
                <select class="accion-select rounded-lg border bg-slate-50 px-2 py-1" data-id="${task.id}">
                  <option value="">Accion...</option>
                  <option value="editar">Editar</option>
                  <option value="estado">Cambiar estado</option>
                  <option value="eliminar">Eliminar</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  list.querySelectorAll('.accion-select').forEach((select) => {
    select.addEventListener('change', async function handleActionChange() {
      const tareaId = this.dataset.id;
      const tarea = sortedTasks.find((item) => String(item.id) === String(tareaId));
      if (!tarea) return;

      if (this.value === 'editar') {
        await showModalTarea(container, supabase, hotelId, currentUser, tarea);
      } else if (this.value === 'estado') {
        await cambiarEstadoTarea(container, supabase, hotelId, tarea, currentUser);
      } else if (this.value === 'eliminar') {
        await eliminarTarea(container, supabase, hotelId, tarea, currentUser);
      }

      this.value = '';
    });
  });
}

function getTaskTypeHelpHtml(tipo) {
  const normalized = normalizeTaskType(tipo);
  if (normalized === TASK_TYPES.programado) {
    return 'Dejar funcionando: la habitacion sigue operativa y la tarea queda anotada para hacerla despues.';
  }

  return 'Cerrar habitacion: al guardar la tarea como pendiente o en progreso, la habitacion pasa a mantenimiento.';
}

function calculateNextScheduledDate(task) {
  const frecuencia = normalizeTaskFrequency(task?.frecuencia);
  if (!['diaria', 'semanal', 'mensual'].includes(frecuencia)) return null;

  const baseDate = task?.fecha_completada
    ? new Date(task.fecha_completada)
    : task?.fecha_programada
      ? new Date(`${task.fecha_programada}T12:00:00`)
      : new Date();

  if (Number.isNaN(baseDate.getTime())) return null;

  const nextDate = new Date(baseDate);
  if (frecuencia === 'diaria') nextDate.setDate(nextDate.getDate() + 1);
  if (frecuencia === 'semanal') nextDate.setDate(nextDate.getDate() + 7);
  if (frecuencia === 'mensual') nextDate.setMonth(nextDate.getMonth() + 1);

  return nextDate.toISOString().slice(0, 10);
}

async function ensureNextPreventiveTask({ supabase, task }) {
  const frecuencia = normalizeTaskFrequency(task?.frecuencia);
  if (!['diaria', 'semanal', 'mensual'].includes(frecuencia)) return;
  if (task?.estado !== 'completada') return;

  const nextDate = calculateNextScheduledDate(task);
  if (!nextDate) return;

  let existingQuery = supabase
    .from('tareas_mantenimiento')
    .select('id')
    .eq('hotel_id', task.hotel_id)
    .eq('titulo', task.titulo)
    .in('estado', OPEN_TASK_STATES)
    .eq('frecuencia', frecuencia)
    .eq('fecha_programada', nextDate);

  existingQuery = task.habitacion_id
    ? existingQuery.eq('habitacion_id', task.habitacion_id)
    : existingQuery.is('habitacion_id', null);

  const { data: existingTask, error: existingError } = await existingQuery.maybeSingle();

  if (existingError && existingError.code !== 'PGRST116') {
    console.error('No se pudo verificar la siguiente tarea preventiva:', existingError);
    return;
  }

  if (existingTask?.id) return;

  const preventivePayload = {
    hotel_id: task.hotel_id,
    titulo: task.titulo,
    descripcion: task.descripcion || null,
    estado: 'pendiente',
    tipo: task.tipo === TASK_TYPES.programado ? null : task.tipo,
    frecuencia,
    fecha_programada: nextDate,
    fecha_completada: null,
    ultima_realizacion: task.fecha_completada || new Date().toISOString(),
    creada_por: task.creada_por || task.realizada_por || task.asignada_a || null,
    asignada_a: task.asignada_a || null,
    habitacion_id: task.habitacion_id || null,
    prioridad: Number(task.prioridad) || 0,
    adjuntos: []
  };

  const payloadToInsert = task.tipo === TASK_TYPES.programado
    ? buildProgrammedCompatibilityPayload(preventivePayload)
    : preventivePayload;

  const { error: insertError } = await supabase.from('tareas_mantenimiento').insert(payloadToInsert);
  if (insertError) {
    console.error('No se pudo programar la siguiente tarea preventiva:', insertError);
  }
}

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  let modalTargetContainer = container.querySelector('#mant-modal');
  if (!modalTargetContainer) {
    modalTargetContainer = container;
  }

  const normalizedTask = tarea ? normalizeTaskRecord(tarea) : null;

  const [habitacionesResult, usuariosResult] = await Promise.all([
    supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).order('nombre'),
    supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId).order('nombre')
  ]);

  const habitaciones = habitacionesResult.data || [];
  const usuarios = usuariosResult.data || [];
  const taskType = normalizeTaskType(normalizedTask?.tipo);
  const isEditing = Boolean(normalizedTask?.id);
  const openedFromSelector = Boolean(normalizedTask?.origen_selector) && !isEditing;
  const titleText = isEditing
    ? 'Editar tarea'
    : (openedFromSelector
      ? 'Anotar mantenimiento'
      : (taskType === TASK_TYPES.programado ? 'Nuevo pendiente de mantenimiento' : 'Nueva tarea de mantenimiento'));
  const taskTypeHelp = openedFromSelector
    ? 'Elige si deseas cerrar la habitacion para mantenimiento o dejarla funcionando mientras dejas anotado el trabajo pendiente.'
    : getTaskTypeHelpHtml(taskType);
  let persistedAttachments = Array.isArray(normalizedTask?.adjuntos) ? [...normalizedTask.adjuntos] : [];

  modalTargetContainer.innerHTML = `
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="relative w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl">
        <button id="close-modal-mant" class="absolute right-4 top-3 text-3xl text-slate-400 transition hover:text-red-600">&times;</button>
        <h3 class="mb-5 text-2xl font-bold text-slate-800">${titleText}</h3>
        <form id="mant-form">
          <div class="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            <p id="mant-task-type-help">${taskTypeHelp}</p>
          </div>

          <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label class="mb-1 block text-sm font-semibold">Encargado <span class="text-red-500">*</span></label>
              <select required name="asignada_a" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">Seleccione un usuario</option>
                ${(usuarios || []).map((usuario) => `
                  <option value="${usuario.id}" ${String(normalizedTask?.asignada_a || '') === String(usuario.id) ? 'selected' : ''}>
                    ${escapeHtml(usuario.nombre || usuario.correo)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Habitacion (opcional)</label>
              <select name="habitacion_id" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">General / Sin asignar</option>
                ${(habitaciones || []).map((habitacion) => `
                  <option value="${habitacion.id}" ${String(normalizedTask?.habitacion_id || '') === String(habitacion.id) ? 'selected' : ''}>
                    ${escapeHtml(habitacion.nombre)}
                  </option>
                `).join('')}
              </select>
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Tipo de tarea</label>
              <select name="tipo" id="mant-tipo-tarea" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="${TASK_TYPES.bloqueante}" ${taskType === TASK_TYPES.bloqueante ? 'selected' : ''}>Cerrar habitacion y enviar a mantenimiento</option>
                <option value="${TASK_TYPES.programado}" ${taskType === TASK_TYPES.programado ? 'selected' : ''}>Dejar funcionando y anotar pendiente</option>
              </select>
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Estado</label>
              <select name="estado" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="pendiente" ${!normalizedTask || normalizedTask?.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                <option value="en_progreso" ${normalizedTask?.estado === 'en_progreso' ? 'selected' : ''}>En progreso</option>
                <option value="completada" ${normalizedTask?.estado === 'completada' ? 'selected' : ''}>Completada</option>
                <option value="cancelada" ${normalizedTask?.estado === 'cancelada' ? 'selected' : ''}>Cancelada</option>
              </select>
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Prioridad</label>
              <select name="prioridad" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="0" ${Number(normalizedTask?.prioridad) === 0 ? 'selected' : ''}>Baja</option>
                <option value="1" ${Number(normalizedTask?.prioridad) === 1 ? 'selected' : ''}>Media</option>
                <option value="2" ${normalizedTask?.prioridad == null || Number(normalizedTask?.prioridad) === 2 ? 'selected' : ''}>Alta</option>
                <option value="3" ${Number(normalizedTask?.prioridad) === 3 ? 'selected' : ''}>Urgente</option>
              </select>
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Fecha programada</label>
              <input name="fecha_programada" type="date" class="form-control w-full rounded-lg border-gray-300 p-2" value="${normalizedTask?.fecha_programada?.split('T')[0] || ''}">
            </div>

            <div>
              <label class="mb-1 block text-sm font-semibold">Frecuencia preventiva</label>
              <select name="frecuencia" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="unica" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === 'unica' ? 'selected' : ''}>Unica</option>
                <option value="diaria" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === 'diaria' ? 'selected' : ''}>Diaria</option>
                <option value="semanal" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === 'semanal' ? 'selected' : ''}>Semanal</option>
                <option value="mensual" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === 'mensual' ? 'selected' : ''}>Mensual</option>
                <option value="personalizada" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === 'personalizada' ? 'selected' : ''}>Personalizada</option>
              </select>
            </div>

            <div class="md:col-span-2">
              <label class="mb-1 block text-sm font-semibold">Titulo <span class="text-red-500">*</span></label>
              <input type="text" name="titulo" class="form-control w-full rounded-lg border-gray-300 p-2" value="${escapeHtml(normalizedTask?.titulo || '')}" required>
            </div>
          </div>

          <div class="mb-5">
            <label class="mb-1 block text-sm font-semibold">Descripcion</label>
            <textarea name="descripcion" class="form-control min-h-[90px] w-full rounded-lg border-gray-300 p-2">${escapeHtml(normalizedTask?.descripcion || '')}</textarea>
          </div>

          <div class="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <div>
                <label class="block text-sm font-semibold text-slate-800">Adjuntar capturas o archivos</label>
                <p class="text-xs text-slate-500">Sirve para dejar evidencia del dano, repuestos, fotos del estado o instrucciones de trabajo.</p>
              </div>
              <span class="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-blue-700">Hasta 12 MB por archivo</span>
            </div>
            <div class="mt-4">
              <input id="mant-adjuntos" type="file" multiple accept="${getEvidenceAcceptString()}" class="block w-full rounded-xl border border-dashed border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
            </div>
            <div class="mt-4">
              <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Adjuntos guardados</p>
              <div id="mant-adjuntos-guardados">${renderEditableAttachmentList(persistedAttachments)}</div>
            </div>
            <div class="mt-4">
              <p class="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Nuevos archivos seleccionados</p>
              <div id="mant-adjuntos-nuevos">${renderSelectedFilesPreview([])}</div>
            </div>
          </div>

          <button type="submit" class="w-full rounded-lg bg-blue-600 py-3 text-lg font-bold text-white shadow-lg transition hover:bg-blue-700">
            ${isEditing ? 'Actualizar tarea' : 'Crear tarea'}
          </button>
        </form>
      </div>
    </div>
  `;

  const closeModal = () => {
    modalTargetContainer.innerHTML = '';
  };

  modalTargetContainer.querySelector('#close-modal-mant')?.addEventListener('click', closeModal);

  const typeSelect = modalTargetContainer.querySelector('#mant-tipo-tarea');
  const typeHelp = modalTargetContainer.querySelector('#mant-task-type-help');
  const attachmentsInput = modalTargetContainer.querySelector('#mant-adjuntos');
  const persistedAttachmentsContainer = modalTargetContainer.querySelector('#mant-adjuntos-guardados');
  const newAttachmentsContainer = modalTargetContainer.querySelector('#mant-adjuntos-nuevos');

  const rerenderPersistedAttachments = () => {
    if (!persistedAttachmentsContainer) return;
    persistedAttachmentsContainer.innerHTML = renderEditableAttachmentList(persistedAttachments);
    persistedAttachmentsContainer.querySelectorAll('.mant-remove-attachment').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        persistedAttachments = persistedAttachments.filter((_, currentIndex) => currentIndex !== index);
        rerenderPersistedAttachments();
      });
    });
  };

  attachmentsInput?.addEventListener('change', () => {
    if (newAttachmentsContainer) {
      newAttachmentsContainer.innerHTML = renderSelectedFilesPreview(Array.from(attachmentsInput.files || []));
    }
  });

  rerenderPersistedAttachments();
  typeSelect?.addEventListener('change', () => {
    if (typeHelp) {
      typeHelp.textContent = getTaskTypeHelpHtml(typeSelect.value);
    }
  });

  modalTargetContainer.querySelector('#mant-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = Object.fromEntries(new FormData(event.currentTarget));
    const previousTask = normalizedTask?.id
      ? {
          ...normalizedTask,
          tipo: normalizeTaskType(normalizedTask.tipo)
        }
      : null;

      const dataToSave = {
        ...formData,
        prioridad: Number(formData.prioridad),
        asignada_a: formData.asignada_a || null,
        habitacion_id: formData.habitacion_id || null,
        fecha_programada: formData.fecha_programada || null,
        tipo: normalizeTaskType(formData.tipo),
        frecuencia: normalizeTaskFrequency(formData.frecuencia),
        fecha_completada: formData.estado === 'completada' ? new Date().toISOString() : null,
        ultima_realizacion: formData.estado === 'completada'
          ? new Date().toISOString()
          : (normalizedTask?.ultima_realizacion || null),
        adjuntos: [...persistedAttachments]
      };

    if (!dataToSave.asignada_a || !String(dataToSave.titulo || '').trim()) {
      alert("Los campos 'Encargado' y 'Titulo' son obligatorios.");
      return;
    }

    try {
      const uploadedAttachments = await uploadEvidenceFiles({
        supabase,
        hotelId,
        userId: currentUser?.id,
        files: Array.from(attachmentsInput?.files || []),
        scope: 'mantenimiento'
      });

      if (uploadedAttachments.length) {
        dataToSave.adjuntos = [...dataToSave.adjuntos, ...uploadedAttachments];
      }

      const persistTask = async (payload) => {
        if (normalizedTask?.id) {
          const { data, error } = await supabase
            .from('tareas_mantenimiento')
            .update(payload)
            .eq('id', normalizedTask.id)
            .select()
            .single();

          if (error) throw error;
          return data;
        }

        const { data, error } = await supabase
          .from('tareas_mantenimiento')
          .insert([{ ...payload, hotel_id: hotelId, creada_por: currentUser?.id }])
          .select()
          .single();

        if (error) throw error;
        return data;
      };

      let tareaResult;

      try {
        tareaResult = await persistTask(dataToSave);
      } catch (error) {
        if (!shouldRetryProgrammedCompatibility(error, dataToSave)) {
          throw error;
        }

        console.warn('Reintentando tarea programada con compatibilidad legacy.', error);
        tareaResult = await persistTask(buildProgrammedCompatibilityPayload(dataToSave));
      }

      tareaResult = normalizeTaskRecord(tareaResult);

      await ensureNextPreventiveTask({
        supabase,
        task: {
          ...tareaResult,
          hotel_id: hotelId,
          creada_por: normalizedTask?.creada_por || currentUser?.id || null
        }
      });

      await syncTaskOperationalImpact({
        supabase,
        task: tareaResult,
        previousTask
      });

      await notifyTaskChange({
        supabase,
        hotelId,
        currentUser,
        habitaciones,
        task: tareaResult,
        isEdit: Boolean(normalizedTask?.id)
      });

      closeModal();

      if (document.querySelector('#mant-list')) {
        await renderTareas(container, supabase, hotelId, currentUser);
      }
    } catch (error) {
      const debugInfo = {
        message: error?.message || 'Error desconocido',
        details: error?.details || '',
        hint: error?.hint || '',
        code: error?.code || '',
        hotelId,
        currentUserId: currentUser?.id || null
      };
      console.error('Error al guardar la tarea:', debugInfo);
      const extraMessage = [debugInfo.details, debugInfo.hint].filter(Boolean).join(' | ');
      alert(`No se pudo guardar la tarea. ${debugInfo.message}${extraMessage ? `\n${extraMessage}` : ''}`);
    }
  });
}

async function notifyTaskChange({ supabase, hotelId, currentUser, habitaciones, task, isEdit }) {
  if (!task?.habitacion_id || isClosedTaskState(task.estado)) return;

  const habitacionNombre = habitaciones.find((habitacion) => habitacion.id === task.habitacion_id)?.nombre || 'Desconocida';
  const typeLabel = isBlockingTaskType(task.tipo)
    ? `La habitacion ${habitacionNombre} fue enviada a mantenimiento.`
    : `La habitacion ${habitacionNombre} tiene un pendiente de mantenimiento programado.`;

  const actionLabel = isEdit ? 'Actualizacion' : 'Nueva tarea';
  const message = `${actionLabel}: ${typeLabel} Tarea: "${task.titulo}".`;

  try {
    await crearNotificacion(supabase, {
      hotelId,
      rolDestino: 'recepcionista',
      tipo: 'mantenimiento',
      mensaje: message,
      entidadTipo: 'tareas_mantenimiento',
      entidadId: task.id,
      generadaPorUsuarioId: currentUser?.id || null
    });
  } catch (error) {
    console.error('Error creando notificacion de mantenimiento:', error);
  }
}

async function cancelActiveReservationForMaintenance(supabase, habitacionId) {
  const { data: reservaActiva } = await supabase
    .from('reservas')
    .select('id')
    .eq('habitacion_id', habitacionId)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .maybeSingle();

  if (!reservaActiva) return;

  await supabase.from('reservas').update({ estado: 'cancelada_mantenimiento' }).eq('id', reservaActiva.id);
  await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', reservaActiva.id);
}

async function syncBlockingStateForRoom(supabase, habitacionId) {
  if (!habitacionId) return;

  const { data, error } = await supabase
    .from('tareas_mantenimiento')
    .select('id, tipo, descripcion, titulo')
    .eq('habitacion_id', habitacionId)
    .in('estado', OPEN_TASK_STATES);

  if (error) throw error;

  const blockingTasks = (data || [])
    .map((task) => normalizeTaskRecord(task))
    .filter((task) => isBlockingTaskType(task.tipo));

  if (blockingTasks.length > 0) {
    await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', habitacionId);
    return;
  }

  const { data: habitacion } = await supabase
    .from('habitaciones')
    .select('estado')
    .eq('id', habitacionId)
    .maybeSingle();

  if (habitacion?.estado === 'mantenimiento') {
    await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', habitacionId);
  }
}

async function syncTaskOperationalImpact({ supabase, task, previousTask = null }) {
  const currentTask = {
    ...task,
    tipo: normalizeTaskType(task?.tipo)
  };

  const previousNormalizedTask = previousTask
    ? { ...previousTask, tipo: normalizeTaskType(previousTask.tipo) }
    : null;

  const currentBlockingOpen = Boolean(
    currentTask?.habitacion_id &&
    isBlockingTaskType(currentTask.tipo) &&
    isOpenTaskState(currentTask.estado)
  );

  const previousBlockingOpenSameRoom = Boolean(
    previousNormalizedTask?.habitacion_id &&
    previousNormalizedTask.habitacion_id === currentTask?.habitacion_id &&
    isBlockingTaskType(previousNormalizedTask.tipo) &&
    isOpenTaskState(previousNormalizedTask.estado)
  );

  if (currentBlockingOpen && !previousBlockingOpenSameRoom) {
    await cancelActiveReservationForMaintenance(supabase, currentTask.habitacion_id);
  }

  const roomIds = new Set(
    [currentTask?.habitacion_id, previousNormalizedTask?.habitacion_id].filter(Boolean)
  );

  for (const roomId of roomIds) {
    await syncBlockingStateForRoom(supabase, roomId);
  }
}

async function cambiarEstadoTarea(container, supabase, hotelId, tarea, currentUser) {
  const nuevoEstado = await mostrarPromptSelectEstado(tarea.estado);
  if (!nuevoEstado || nuevoEstado === tarea.estado) return;

  const updatedTask = {
    ...tarea,
    estado: nuevoEstado,
    fecha_completada: nuevoEstado === 'completada' ? new Date().toISOString() : null,
    ultima_realizacion: nuevoEstado === 'completada' ? new Date().toISOString() : (tarea.ultima_realizacion || null),
    tipo: normalizeTaskType(tarea.tipo)
  };

  const { error } = await supabase
    .from('tareas_mantenimiento')
    .update({
      estado: updatedTask.estado,
      fecha_completada: updatedTask.fecha_completada,
      ultima_realizacion: updatedTask.ultima_realizacion
    })
    .eq('id', tarea.id);

  if (error) {
    alert(`Error al actualizar la tarea: ${error.message}`);
    return;
  }

  try {
    await ensureNextPreventiveTask({
      supabase,
      task: {
        ...tarea,
        ...updatedTask,
        hotel_id: hotelId
      }
    });

    await syncTaskOperationalImpact({
      supabase,
      task: updatedTask,
      previousTask: tarea
    });

    let habitacionInfo = '';
    if (tarea.habitacion_id) {
      const { data: habitacion } = await supabase.from('habitaciones').select('nombre').eq('id', tarea.habitacion_id).maybeSingle();
      if (habitacion?.nombre) {
        habitacionInfo = ` (Hab. ${habitacion.nombre})`;
      }
    }

    await crearNotificacion(supabase, {
      hotelId,
      rolDestino: 'recepcionista',
      tipo: 'cambio_estado_mantenimiento',
      mensaje: `Tarea "${tarea.titulo}"${habitacionInfo} cambio a: ${nuevoEstado.replace('_', ' ')}.`,
      entidadTipo: 'tareas_mantenimiento',
      entidadId: tarea.id,
      generadaPorUsuarioId: currentUser?.id || null
    });
  } catch (notificationError) {
    console.error('Error al procesar el cambio de estado de la tarea:', notificationError);
  }

  await renderTareas(container, supabase, hotelId, currentUser);
}

async function eliminarTarea(container, supabase, hotelId, tarea, currentUser) {
  const confirmed = await mostrarConfirmacion(`Seguro que deseas eliminar la tarea "${tarea.titulo}"?`);
  if (!confirmed) return;

  const { error } = await supabase.from('tareas_mantenimiento').delete().eq('id', tarea.id);
  if (error) {
    alert(`No se pudo eliminar la tarea. Error: ${error.message}`);
    return;
  }

  try {
    await syncBlockingStateForRoom(supabase, tarea.habitacion_id);
  } catch (syncError) {
    console.error('Error ajustando el estado de la habitacion despues de eliminar la tarea:', syncError);
  }

  await renderTareas(container, supabase, hotelId, currentUser);
}

function getVisibleTaskCache(container) {
  return container.__mantCache || { tareas: [], habMap: new Map(), userMap: new Map(), habitaciones: [] };
}

function imprimirPendientesDesdeVista(container, selectedRoomOnly) {
  const { tareas, habMap, userMap } = getVisibleTaskCache(container);
  const roomSelect = container.querySelector('#filtro-habitacion');
  const roomId = roomSelect?.value || '';

  if (selectedRoomOnly && !roomId) {
    alert('Selecciona una habitacion antes de imprimir su lista.');
    return;
  }

  let pendingTasks = (tareas || []).filter((task) => isOpenTaskState(task.estado));
  if (selectedRoomOnly) {
    pendingTasks = pendingTasks.filter((task) => String(task.habitacion_id || '') === roomId);
  }

  if (pendingTasks.length === 0) {
    alert('No hay pendientes por imprimir con los filtros actuales.');
    return;
  }

  const roomName = selectedRoomOnly ? (habMap.get(roomId) || 'Habitacion seleccionada') : null;
  imprimirTareasPendientes(pendingTasks, habMap, userMap, roomName);
}

function imprimirTareasPendientes(tareas, habMap, userMap, roomName = null) {
  const title = roomName
    ? `Pendientes de mantenimiento - ${roomName}`
    : 'Pendientes de mantenimiento por hacer';

  const rowsHtml = tareas.map((task) => `
    <tr>
      <td>${escapeHtml(task.titulo || '-')}</td>
      <td>${escapeHtml(task.habitacion_id ? (habMap.get(task.habitacion_id) || 'N/A') : 'General')}</td>
      <td>${escapeHtml(renderTipo(task.tipo, false))}</td>
      <td>${escapeHtml(getTaskFrequencyLabel(task.frecuencia))}</td>
      <td>${escapeHtml(renderPrioridad(task.prioridad, false))}</td>
      <td>${escapeHtml(renderEstado(task.estado, false))}</td>
      <td>${escapeHtml(userMap.get(task.asignada_a) || 'No asignado')}</td>
      <td>${escapeHtml(task.fecha_programada ? new Date(task.fecha_programada).toLocaleDateString() : 'Sin fecha')}</td>
      <td>${escapeHtml(task.descripcion || '-')}</td>
    </tr>
  `).join('');

  const printWindow = window.open('', '_blank', 'width=1100,height=780');
  if (!printWindow) {
    alert('Tu navegador bloqueo la ventana de impresion.');
    return;
  }

  printWindow.document.write(`
    <html>
      <head>
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #0f172a; margin: 24px; }
          h1 { margin: 0 0 6px; font-size: 24px; }
          p { margin: 0 0 18px; color: #475569; }
          table { width: 100%; border-collapse: collapse; margin-top: 16px; }
          th, td { border: 1px solid #cbd5e1; padding: 10px; text-align: left; vertical-align: top; font-size: 13px; }
          th { background: #e2e8f0; }
          tr:nth-child(even) td { background: #f8fafc; }
          .meta { margin-top: 14px; font-size: 12px; color: #64748b; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>${roomName ? 'Lista de trabajos pendientes para la habitacion seleccionada.' : 'Lista consolidada de trabajos pendientes y en progreso.'}</p>
        <table>
          <thead>
            <tr>
              <th>Titulo</th>
              <th>Habitacion</th>
          <th>Tipo</th>
          <th>Frecuencia</th>
          <th>Prioridad</th>
              <th>Estado</th>
              <th>Encargado</th>
              <th>Fecha programada</th>
              <th>Descripcion</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <div class="meta">Generado el ${new Date().toLocaleString('es-CO')}</div>
        <script>window.onload = function(){ window.print(); window.focus(); };</script>
      </body>
    </html>
  `);

  printWindow.document.close();
}

function mostrarPromptSelectEstado(estadoActual) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4';
    modal.innerHTML = `
      <div class="w-full max-w-xs rounded-lg bg-white p-6 shadow-lg">
        <h3 class="mb-4 text-lg font-bold">Cambiar estado de la tarea</h3>
        <select id="select-estado-tarea" class="form-control mb-5 w-full">
          <option value="pendiente" ${estadoActual === 'pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="en_progreso" ${estadoActual === 'en_progreso' ? 'selected' : ''}>En progreso</option>
          <option value="completada" ${estadoActual === 'completada' ? 'selected' : ''}>Completada</option>
          <option value="cancelada" ${estadoActual === 'cancelada' ? 'selected' : ''}>Cancelada</option>
        </select>
        <div class="flex gap-3">
          <button id="btn-confirmar-estado" class="button button-success w-full">Aceptar</button>
          <button id="btn-cancelar-estado" class="button button-secondary w-full">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cleanup = (value) => {
      document.body.removeChild(modal);
      resolve(value);
    };

    modal.querySelector('#btn-confirmar-estado')?.addEventListener('click', () => {
      cleanup(modal.querySelector('#select-estado-tarea')?.value || null);
    });

    modal.querySelector('#btn-cancelar-estado')?.addEventListener('click', () => cleanup(null));
  });
}

function mostrarConfirmacion(message) {
  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
      <div class="w-full max-w-sm rounded-xl bg-white p-6 text-center shadow-2xl">
        <h3 class="mb-5 text-lg font-semibold text-slate-800">${escapeHtml(message)}</h3>
        <div class="flex justify-center gap-4">
          <button id="btn-confirmar-accion" class="button button-danger flex-1">Confirmar</button>
          <button id="btn-cancelar-accion" class="button button-secondary flex-1">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    const cleanup = (result) => {
      document.body.removeChild(modal);
      resolve(result);
    };

    modal.querySelector('#btn-confirmar-accion')?.addEventListener('click', () => cleanup(true));
    modal.querySelector('#btn-cancelar-accion')?.addEventListener('click', () => cleanup(false));
  });
}
