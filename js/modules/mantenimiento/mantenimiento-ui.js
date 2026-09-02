import { showLoading, showError } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import {
  TASK_TYPES,
  createRequestId,
  getPriorityMeta,
  getStatusMeta,
  getTaskFrequencyLabel,
  getTypeMeta,
  isBlockingTask,
  isClosedTaskState,
  isOccupiedMaintenanceConflict,
  isOpenTaskState,
  normalizeTaskFrequency,
  normalizeTaskRecord,
  normalizeTaskType,
  sortTasks
} from './mantenimiento-domain.js';
import {
  createMaintenanceTask,
  deleteMaintenanceTask,
  listMaintenanceTasks,
  loadMaintenanceReferenceData,
  updateMaintenanceTask
} from './mantenimiento-repository.js';
import { ensureNextPreventiveTask } from './mantenimiento-preventivo.js';
import {
  deleteMaintenanceEvidence,
  getMaintenanceEvidenceAcceptString,
  hydrateMaintenanceEvidenceUrls,
  uploadMaintenanceEvidence
} from './mantenimiento-evidencias.js';

let mantenimientoSubscription = null;
let supabaseInstance = null;
let mountedContainer = null;
let mountedHotelId = null;
let mountedUser = null;
let refreshInFlight = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderMeta(meta, colored = true) {
  if (!colored) return meta.text;
  return `<span class="rounded-full px-2 py-1 text-xs font-semibold ${meta.classes}">${escapeHtml(meta.text)}</span>`;
}

function renderPriority(priority, colored = true) {
  return renderMeta(getPriorityMeta(priority), colored);
}

function renderStatus(status, colored = true) {
  return renderMeta(getStatusMeta(status), colored);
}

function renderType(task, colored = true) {
  return renderMeta(getTypeMeta(task?.tipo, task), colored);
}

function formatDate(value, fallback = 'Sin fecha') {
  if (!value) return fallback;
  const date = new Date(String(value).length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('es-CO');
}

function isOverdue(task) {
  if (!isOpenTaskState(task?.estado) || !task?.fecha_programada) return false;
  const endOfDay = new Date(`${String(task.fecha_programada).slice(0, 10)}T23:59:59`);
  return !Number.isNaN(endOfDay.getTime()) && endOfDay.getTime() < Date.now();
}

function getTaskTypeHelpHtml(tipo) {
  return normalizeTaskType(tipo) === TASK_TYPES.programado
    ? 'La habitación puede seguir operativa. Úsalo para trabajos que pueden esperar o hacerse después del checkout.'
    : 'La habitación queda fuera de servicio. El sistema impedirá ocuparla mientras exista un mantenimiento bloqueante abierto.';
}

function closeModal(target) {
  if (target) target.innerHTML = '';
}

async function hydrateTaskAttachments(supabase, tasks) {
  return Promise.all((tasks || []).map(async (task) => ({
    ...task,
    adjuntos: await hydrateMaintenanceEvidenceUrls(supabase, task.adjuntos || [])
  })));
}

function renderAttachmentLinks(attachments = []) {
  if (!attachments.length) return '<span class="text-xs text-slate-400">Sin evidencias</span>';

  return attachments.map((attachment, index) => {
    const url = attachment.display_url || attachment.url || '';
    if (!url) return `<span class="text-xs text-slate-400">${escapeHtml(attachment.name || `Archivo ${index + 1}`)}</span>`;
    return `
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"
         class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50">
        ${attachment.kind === 'image' ? '📷' : '📎'} ${escapeHtml(attachment.name || `Archivo ${index + 1}`)}
      </a>
    `;
  }).join('');
}

function updateRoomFilter(container, rooms) {
  const select = container.querySelector('#filtro-habitacion');
  if (!select) return;
  const current = select.value || '';
  select.innerHTML = '<option value="">Todas las habitaciones</option>' + (rooms || [])
    .map((room) => `<option value="${room.id}">${escapeHtml(room.nombre)}</option>`)
    .join('');
  select.value = current;
}

function renderSummary(container, tasks) {
  const target = container.querySelector('#mant-resumen');
  if (!target) return;

  const openTasks = (tasks || []).filter((task) => isOpenTaskState(task.estado));
  const blockers = openTasks.filter(isBlockingTask);
  const programmed = openTasks.filter((task) => !isBlockingTask(task));
  const overdue = openTasks.filter(isOverdue);
  const inProgress = openTasks.filter((task) => task.estado === 'en_progreso');

  target.innerHTML = `
    <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div class="rounded-2xl border border-red-200 bg-red-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-red-600">Habitaciones bloqueadas</p>
        <p class="mt-2 text-3xl font-bold text-red-700">${blockers.length}</p>
        <p class="mt-1 text-xs text-red-600">Mantenimientos bloqueantes abiertos.</p>
      </div>
      <div class="rounded-2xl border border-blue-200 bg-blue-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">En progreso</p>
        <p class="mt-2 text-3xl font-bold text-blue-700">${inProgress.length}</p>
        <p class="mt-1 text-xs text-blue-600">Trabajos que ya están siendo atendidos.</p>
      </div>
      <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Vencidos</p>
        <p class="mt-2 text-3xl font-bold text-amber-800">${overdue.length}</p>
        <p class="mt-1 text-xs text-amber-700">Pendientes después de su fecha programada.</p>
      </div>
      <div class="rounded-2xl border border-violet-200 bg-violet-50 p-4">
        <p class="text-xs font-semibold uppercase tracking-[0.16em] text-violet-600">Programados</p>
        <p class="mt-2 text-3xl font-bold text-violet-700">${programmed.length}</p>
        <p class="mt-1 text-xs text-violet-600">No sacan habitaciones de servicio.</p>
      </div>
    </div>
  `;
}

function renderTaskList(container, tasks, rooms, users) {
  const list = container.querySelector('#mant-list');
  if (!list) return;

  const roomMap = new Map((rooms || []).map((room) => [room.id, room]));
  const userMap = new Map((users || []).map((user) => [user.id, user.nombre || user.correo || user.id]));
  const sorted = sortTasks(tasks);

  container.__mantCache = { tareas: sorted, rooms, users, roomMap, userMap };

  if (!sorted.length) {
    list.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p class="text-lg font-semibold text-slate-700">No hay tareas con estos filtros.</p>
        <p class="mt-1 text-sm text-slate-500">Puedes crear un mantenimiento nuevo o cambiar los filtros.</p>
      </div>`;
    return;
  }

  list.innerHTML = `
    <div class="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            <th class="px-3 py-3">Encargado</th>
            <th class="px-3 py-3">Impacto</th>
            <th class="px-3 py-3">Tarea</th>
            <th class="px-3 py-3">Habitación</th>
            <th class="px-3 py-3 text-center">Prioridad</th>
            <th class="px-3 py-3">Estado</th>
            <th class="px-3 py-3">Fecha</th>
            <th class="px-3 py-3">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${sorted.map((task) => {
            const room = task.habitacion_id ? roomMap.get(task.habitacion_id) : null;
            const overdue = isOverdue(task);
            return `
              <tr class="align-top transition hover:bg-slate-50 ${overdue ? 'bg-amber-50/40' : ''}">
                <td class="px-3 py-3 font-semibold text-slate-700">${escapeHtml(userMap.get(task.asignada_a) || 'No asignado')}</td>
                <td class="px-3 py-3">${renderType(task, true)}</td>
                <td class="max-w-md px-3 py-3">
                  <p class="font-semibold text-slate-800">${escapeHtml(task.titulo || '-')}</p>
                  <p class="mt-1 text-xs text-slate-500">${escapeHtml(task.descripcion || 'Sin descripción')}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    <span class="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">${escapeHtml(getTaskFrequencyLabel(task.frecuencia))}</span>
                    ${overdue ? '<span class="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">Vencida</span>' : ''}
                    ${renderAttachmentLinks(task.adjuntos || [])}
                  </div>
                </td>
                <td class="px-3 py-3">
                  <p class="font-medium text-slate-700">${escapeHtml(room?.nombre || 'General')}</p>
                  ${room ? `<p class="mt-1 text-[11px] text-slate-400">Estado: ${escapeHtml(room.estado || '-')}</p>` : ''}
                </td>
                <td class="px-3 py-3 text-center">${renderPriority(task.prioridad, true)}</td>
                <td class="px-3 py-3">${renderStatus(task.estado, true)}</td>
                <td class="px-3 py-3 text-slate-600">${escapeHtml(formatDate(task.fecha_programada))}</td>
                <td class="px-3 py-3">
                  <select class="accion-select form-control min-w-[150px] rounded-lg" data-id="${task.id}">
                    <option value="">Seleccionar</option>
                    <option value="editar">Editar</option>
                    <option value="estado">Cambiar estado</option>
                    <option value="eliminar">Eliminar</option>
                  </select>
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  list.querySelectorAll('.accion-select').forEach((select) => {
    select.addEventListener('change', async function onAction() {
      const task = sorted.find((item) => String(item.id) === String(this.dataset.id));
      const action = this.value;
      this.value = '';
      if (!task || !action) return;

      try {
        if (action === 'editar') {
          await showModalTarea(container, supabaseInstance, mountedHotelId, mountedUser, task);
          return;
        }
        if (action === 'estado') {
          await changeTaskState(task);
          return;
        }
        if (action === 'eliminar') {
          await removeTask(task);
        }
      } catch (error) {
        console.error('Error ejecutando acción de mantenimiento:', error);
        alert(error?.message || 'No se pudo completar la acción.');
      }
    });
  });
}

async function refreshMaintenance(container = mountedContainer, supabase = supabaseInstance, hotelId = mountedHotelId) {
  if (!container || !supabase || !hotelId) return;
  if (refreshInFlight) return refreshInFlight;

  const list = container.querySelector('#mant-list');
  if (list) showLoading(list);

  refreshInFlight = (async () => {
    try {
      const filters = {
        estado: container.querySelector('#filtro-estado')?.value || '',
        tipo: container.querySelector('#filtro-tipo')?.value || '',
        habitacionId: container.querySelector('#filtro-habitacion')?.value || ''
      };

      const [referenceData, rawTasks] = await Promise.all([
        loadMaintenanceReferenceData(supabase, hotelId),
        listMaintenanceTasks(supabase, hotelId, filters)
      ]);

      const tasks = await hydrateTaskAttachments(supabase, rawTasks);
      updateRoomFilter(container, referenceData.habitaciones);
      renderSummary(container, tasks);
      renderTaskList(container, tasks, referenceData.habitaciones, referenceData.usuarios);
    } catch (error) {
      console.error('Error cargando mantenimiento:', error);
      if (list) showError(list, 'No fue posible cargar el módulo de mantenimiento.');
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function mount(container, supabase, currentUser, hotelId) {
  mountedContainer = container;
  supabaseInstance = supabase;
  mountedHotelId = hotelId;
  mountedUser = currentUser;

  container.innerHTML = `
    <div class="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="flex items-center gap-2 text-2xl font-bold text-slate-800"><span>🛠️</span><span>Mantenimiento</span></h2>
        <p class="mt-1 text-sm text-slate-500">Controla trabajos pendientes sin perder de vista las habitaciones fuera de servicio.</p>
      </div>
      <button id="btn-nueva-tarea" class="button button-success">+ Nueva tarea</button>
    </div>

    <div class="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <select id="filtro-estado" class="form-control w-auto rounded-lg">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_progreso">En progreso</option>
        <option value="completada">Completada</option>
        <option value="cancelada">Cancelada</option>
      </select>
      <select id="filtro-tipo" class="form-control w-auto rounded-lg">
        <option value="">Todos los impactos</option>
        <option value="bloqueante">Bloquea habitación</option>
        <option value="programado">No bloquea</option>
      </select>
      <select id="filtro-habitacion" class="form-control min-w-[210px] rounded-lg">
        <option value="">Todas las habitaciones</option>
      </select>
      <button id="btn-filtrar" class="button button-primary">Filtrar</button>
      <button id="btn-imprimir-pendientes" class="button button-secondary">Imprimir pendientes</button>
    </div>

    <div id="mant-resumen" class="mb-4"></div>
    <div id="mant-list"></div>
    <div id="mant-modal"></div>
  `;

  container.querySelector('#btn-filtrar')?.addEventListener('click', () => refreshMaintenance());
  container.querySelector('#btn-nueva-tarea')?.addEventListener('click', () => showModalTarea(container, supabase, hotelId, currentUser, null));
  container.querySelector('#btn-imprimir-pendientes')?.addEventListener('click', () => printPendingTasks(container));

  await refreshMaintenance();

  if (mantenimientoSubscription) {
    await supabase.removeChannel(mantenimientoSubscription).catch(() => {});
  }

  mantenimientoSubscription = supabase
    .channel(`mantenimiento:${hotelId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'tareas_mantenimiento',
      filter: `hotel_id=eq.${hotelId}`
    }, () => refreshMaintenance())
    .subscribe();
}

export function unmount() {
  if (mantenimientoSubscription && supabaseInstance) {
    supabaseInstance.removeChannel(mantenimientoSubscription).catch((error) => {
      console.warn('No se pudo cerrar el canal de mantenimiento:', error);
    });
  }
  mantenimientoSubscription = null;
  supabaseInstance = null;
  mountedContainer = null;
  mountedHotelId = null;
  mountedUser = null;
  refreshInFlight = null;
}

function renderExistingAttachments(attachments) {
  if (!attachments.length) return '<p class="text-xs text-slate-500">Sin evidencias guardadas.</p>';
  return attachments.map((attachment, index) => `
    <div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2" data-attachment-index="${index}">
      <div class="min-w-0">
        <p class="truncate text-sm font-medium text-slate-700">${escapeHtml(attachment.name || `Archivo ${index + 1}`)}</p>
        ${attachment.display_url || attachment.url ? `<a class="text-xs font-semibold text-blue-600" target="_blank" rel="noopener noreferrer" href="${escapeHtml(attachment.display_url || attachment.url)}">Ver archivo</a>` : ''}
      </div>
      <button type="button" class="remove-existing-attachment rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-semibold text-red-600" data-index="${index}">Quitar</button>
    </div>`).join('');
}

function renderSelectedFiles(files) {
  if (!files.length) return '<p class="text-xs text-slate-500">Puedes adjuntar fotos, PDF o documentos de apoyo.</p>';
  return files.map((file) => `<div class="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB</div>`).join('');
}

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  if (!container || !supabase || !hotelId) return;
  let modalTarget = container.querySelector?.('#mant-modal');
  if (!modalTarget) modalTarget = container;

  const normalizedTask = tarea ? normalizeTaskRecord(tarea) : null;
  const { habitaciones, usuarios } = await loadMaintenanceReferenceData(supabase, hotelId);
  const requestId = normalizedTask?.solicitud_id || createRequestId();
  const isEditing = Boolean(normalizedTask?.id);
  const initialType = normalizeTaskType(normalizedTask?.tipo, normalizedTask);
  let persistedAttachments = await hydrateMaintenanceEvidenceUrls(supabase, normalizedTask?.adjuntos || []);
  let removedAttachments = [];
  let selectedFiles = [];

  modalTarget.innerHTML = `
    <div class="fixed inset-0 z-[250] overflow-y-auto bg-black/50 p-4">
      <div class="mx-auto flex min-h-full max-w-2xl items-start justify-center">
        <div class="relative my-3 w-full overflow-hidden rounded-2xl bg-white shadow-2xl">
          <button type="button" id="close-modal-mant" class="absolute right-4 top-3 z-10 text-3xl leading-none text-slate-400 hover:text-red-600">&times;</button>
          <div class="max-h-[calc(100vh-2rem)] overflow-y-auto p-6">
            <h3 class="mb-1 pr-10 text-2xl font-bold text-slate-800">${isEditing ? 'Editar mantenimiento' : 'Nueva tarea de mantenimiento'}</h3>
            <p class="mb-5 text-sm text-slate-500">Registra quién la atenderá y si la habitación puede seguir operando.</p>

            <form id="mant-form">
              <input type="hidden" name="solicitud_id" value="${escapeHtml(requestId)}">

              <div class="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <label class="mb-1 block text-sm font-semibold text-slate-700">Impacto operativo</label>
                <select name="tipo" id="mant-tipo" class="form-control w-full rounded-lg" required>
                  <option value="programado" ${initialType === TASK_TYPES.programado ? 'selected' : ''}>Puede seguir alquilándose</option>
                  <option value="bloqueante" ${initialType === TASK_TYPES.bloqueante ? 'selected' : ''}>Bloquear habitación</option>
                </select>
                <p id="mant-tipo-help" class="mt-2 text-xs text-slate-500">${escapeHtml(getTaskTypeHelpHtml(initialType))}</p>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label class="mb-1 block text-sm font-semibold">Habitación / ubicación</label>
                  <select name="habitacion_id" class="form-control w-full rounded-lg">
                    <option value="">General / área común</option>
                    ${habitaciones.map((room) => `<option value="${room.id}" ${String(normalizedTask?.habitacion_id || '') === String(room.id) ? 'selected' : ''}>${escapeHtml(room.nombre)} · ${escapeHtml(room.estado || '-')}</option>`).join('')}
                  </select>
                </div>
                <div>
                  <label class="mb-1 block text-sm font-semibold">Encargado <span class="text-red-500">*</span></label>
                  <select name="asignada_a" class="form-control w-full rounded-lg" required>
                    <option value="">Seleccione un usuario</option>
                    ${usuarios.map((user) => `<option value="${user.id}" ${String(normalizedTask?.asignada_a || '') === String(user.id) ? 'selected' : ''}>${escapeHtml(user.nombre || user.correo)}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div class="mb-4">
                <label class="mb-1 block text-sm font-semibold">Título <span class="text-red-500">*</span></label>
                <input name="titulo" class="form-control w-full rounded-lg" maxlength="180" required value="${escapeHtml(normalizedTask?.titulo || '')}" placeholder="Ej. Aire acondicionado no enfría">
              </div>

              <div class="mb-4">
                <label class="mb-1 block text-sm font-semibold">Descripción</label>
                <textarea name="descripcion" class="form-control min-h-[100px] w-full rounded-lg" placeholder="Describe qué ocurre y cualquier detalle útil.">${escapeHtml(normalizedTask?.descripcion || '')}</textarea>
              </div>

              <div class="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label class="mb-1 block text-sm font-semibold">Prioridad</label>
                  <select name="prioridad" class="form-control w-full rounded-lg">
                    <option value="0" ${Number(normalizedTask?.prioridad) === 0 ? 'selected' : ''}>Baja</option>
                    <option value="1" ${Number(normalizedTask?.prioridad ?? 1) === 1 ? 'selected' : ''}>Media</option>
                    <option value="2" ${Number(normalizedTask?.prioridad) === 2 ? 'selected' : ''}>Alta</option>
                    <option value="3" ${Number(normalizedTask?.prioridad) === 3 ? 'selected' : ''}>Urgente</option>
                  </select>
                </div>
                <div>
                  <label class="mb-1 block text-sm font-semibold">Estado</label>
                  <select name="estado" class="form-control w-full rounded-lg">
                    <option value="pendiente" ${(!normalizedTask || normalizedTask?.estado === 'pendiente') ? 'selected' : ''}>Pendiente</option>
                    <option value="en_progreso" ${normalizedTask?.estado === 'en_progreso' ? 'selected' : ''}>En progreso</option>
                    <option value="completada" ${normalizedTask?.estado === 'completada' ? 'selected' : ''}>Completada</option>
                    <option value="cancelada" ${normalizedTask?.estado === 'cancelada' ? 'selected' : ''}>Cancelada</option>
                  </select>
                </div>
                <div>
                  <label class="mb-1 block text-sm font-semibold">Fecha programada</label>
                  <input name="fecha_programada" type="date" class="form-control w-full rounded-lg" value="${escapeHtml(String(normalizedTask?.fecha_programada || '').slice(0, 10))}">
                </div>
                <div>
                  <label class="mb-1 block text-sm font-semibold">Frecuencia</label>
                  <select name="frecuencia" class="form-control w-full rounded-lg">
                    ${['unica', 'diaria', 'semanal', 'mensual', 'personalizada'].map((freq) => `<option value="${freq}" ${normalizeTaskFrequency(normalizedTask?.frecuencia) === freq ? 'selected' : ''}>${escapeHtml(getTaskFrequencyLabel(freq))}</option>`).join('')}
                  </select>
                </div>
              </div>

              <div class="mb-5 rounded-xl border border-slate-200 p-4">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p class="text-sm font-semibold text-slate-800">Evidencias</p>
                    <p class="text-xs text-slate-500">Las nuevas evidencias se guardan de forma privada y se abren con enlaces temporales.</p>
                  </div>
                </div>
                <div id="mant-existing-files" class="mb-3 space-y-2">${renderExistingAttachments(persistedAttachments)}</div>
                <input id="mant-files" type="file" multiple accept="${escapeHtml(getMaintenanceEvidenceAcceptString())}" class="form-control w-full rounded-lg">
                <div id="mant-selected-files" class="mt-2 space-y-1">${renderSelectedFiles([])}</div>
              </div>

              <div id="mant-form-error" class="mb-4 hidden rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700"></div>

              <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" id="cancel-modal-mant" class="button button-secondary">Cancelar</button>
                <button type="submit" id="mant-submit" class="button button-success">${isEditing ? 'Actualizar tarea' : 'Crear tarea'}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  const form = modalTarget.querySelector('#mant-form');
  const typeSelect = modalTarget.querySelector('#mant-tipo');
  const typeHelp = modalTarget.querySelector('#mant-tipo-help');
  const fileInput = modalTarget.querySelector('#mant-files');
  const selectedFilesTarget = modalTarget.querySelector('#mant-selected-files');
  const existingFilesTarget = modalTarget.querySelector('#mant-existing-files');
  const errorTarget = modalTarget.querySelector('#mant-form-error');

  const renderExisting = () => {
    if (!existingFilesTarget) return;
    existingFilesTarget.innerHTML = renderExistingAttachments(persistedAttachments);
    existingFilesTarget.querySelectorAll('.remove-existing-attachment').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.dataset.index);
        const [removed] = persistedAttachments.splice(index, 1);
        if (removed) removedAttachments.push(removed);
        renderExisting();
      });
    });
  };
  renderExisting();

  modalTarget.querySelector('#close-modal-mant')?.addEventListener('click', () => closeModal(modalTarget));
  modalTarget.querySelector('#cancel-modal-mant')?.addEventListener('click', () => closeModal(modalTarget));
  typeSelect?.addEventListener('change', () => {
    if (typeHelp) typeHelp.textContent = getTaskTypeHelpHtml(typeSelect.value);
  });
  fileInput?.addEventListener('change', () => {
    selectedFiles = Array.from(fileInput.files || []);
    if (selectedFilesTarget) selectedFilesTarget.innerHTML = renderSelectedFiles(selectedFiles);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = modalTarget.querySelector('#mant-submit');
    if (submitButton?.disabled) return;

    const formData = Object.fromEntries(new FormData(form));
    if (!String(formData.titulo || '').trim() || !formData.asignada_a) {
      if (errorTarget) {
        errorTarget.textContent = 'Título y encargado son obligatorios.';
        errorTarget.classList.remove('hidden');
      }
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Guardando...';
    }
    if (errorTarget) errorTarget.classList.add('hidden');

    let newlyUploaded = [];
    try {
      newlyUploaded = await uploadMaintenanceEvidence({
        supabase,
        hotelId,
        userId: currentUser?.id,
        files: selectedFiles,
        taskRequestId: requestId
      });

      const nowIso = new Date().toISOString();
      const completed = formData.estado === 'completada';
      const payload = {
        titulo: String(formData.titulo || '').trim(),
        descripcion: String(formData.descripcion || '').trim() || null,
        prioridad: Number(formData.prioridad || 0),
        estado: formData.estado || 'pendiente',
        tipo: normalizeTaskType(formData.tipo),
        categoria_mantenimiento: normalizedTask?.categoria_mantenimiento || 'general',
        fecha_programada: formData.fecha_programada || null,
        frecuencia: normalizeTaskFrequency(formData.frecuencia),
        asignada_a: formData.asignada_a,
        habitacion_id: formData.habitacion_id || null,
        adjuntos: [...persistedAttachments, ...newlyUploaded].map(({ display_url, ...attachment }) => attachment),
        fecha_completada: completed ? (normalizedTask?.fecha_completada || nowIso) : null,
        realizada_por: completed ? (currentUser?.id || normalizedTask?.realizada_por || null) : null,
        ultima_realizacion: completed ? nowIso : (normalizedTask?.ultima_realizacion || null)
      };

      let savedTask;
      if (isEditing) {
        savedTask = await updateMaintenanceTask(supabase, hotelId, normalizedTask.id, payload);
      } else {
        savedTask = await createMaintenanceTask(supabase, hotelId, {
          ...payload,
          creada_por: currentUser?.id || null,
          solicitud_id: requestId
        });
      }

      await ensureNextPreventiveTask({ supabase, task: savedTask }).catch((error) => {
        console.warn('No se pudo generar el siguiente preventivo:', error);
      });

      await Promise.allSettled(removedAttachments.map((attachment) => deleteMaintenanceEvidence(supabase, attachment)));
      await notifyTaskChange({ supabase, hotelId, currentUser, rooms: habitaciones, task: savedTask, isEdit: isEditing });

      closeModal(modalTarget);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: savedTask.id } }));
      if (container.querySelector?.('#mant-list')) await refreshMaintenance(container, supabase, hotelId);
    } catch (error) {
      await Promise.allSettled(newlyUploaded.map((attachment) => deleteMaintenanceEvidence(supabase, attachment)));
      console.error('Error guardando mantenimiento:', error);
      const message = isOccupiedMaintenanceConflict(error)
        ? 'La habitación está ocupada. No se puede bloquear una estancia activa. Selecciona “Puede seguir alquilándose” y programa el trabajo para después del checkout.'
        : (error?.message || 'No se pudo guardar la tarea de mantenimiento.');
      if (errorTarget) {
        errorTarget.textContent = message;
        errorTarget.classList.remove('hidden');
      } else {
        alert(message);
      }
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = isEditing ? 'Actualizar tarea' : 'Crear tarea';
      }
    }
  });
}

async function notifyTaskChange({ supabase, hotelId, currentUser, rooms, task, isEdit }) {
  try {
    const roomName = (rooms || []).find((room) => String(room.id) === String(task.habitacion_id))?.nombre || 'área general';
    const completed = task.estado === 'completada';
    const role = completed ? 'recepcionista' : 'mantenimiento';
    const action = completed ? 'fue completada' : (isEdit ? 'fue actualizada' : 'fue creada');
    const impact = isBlockingTask(task) ? 'bloqueante' : 'programada';
    await crearNotificacion(supabase, {
      hotelId,
      rolDestino: role,
      tipo: completed ? 'cambio_estado_mantenimiento' : 'mantenimiento',
      mensaje: `La tarea ${impact} “${task.titulo}” de ${roomName} ${action}.`,
      entidadTipo: 'tareas_mantenimiento',
      entidadId: task.id,
      generadaPorUsuarioId: currentUser?.id || null
    });
  } catch (error) {
    console.warn('No se pudo crear la notificación de mantenimiento:', error);
  }
}

function chooseState(currentState) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <h3 class="mb-4 text-lg font-bold text-slate-800">Cambiar estado</h3>
        <select id="maintenance-state-choice" class="form-control mb-4 w-full rounded-lg">
          <option value="pendiente" ${currentState === 'pendiente' ? 'selected' : ''}>Pendiente</option>
          <option value="en_progreso" ${currentState === 'en_progreso' ? 'selected' : ''}>En progreso</option>
          <option value="completada" ${currentState === 'completada' ? 'selected' : ''}>Completada</option>
          <option value="cancelada" ${currentState === 'cancelada' ? 'selected' : ''}>Cancelada</option>
        </select>
        <div class="flex gap-2">
          <button id="maintenance-state-cancel" class="button button-secondary flex-1">Cancelar</button>
          <button id="maintenance-state-ok" class="button button-success flex-1">Guardar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };
    overlay.querySelector('#maintenance-state-cancel')?.addEventListener('click', () => cleanup(null));
    overlay.querySelector('#maintenance-state-ok')?.addEventListener('click', () => cleanup(overlay.querySelector('#maintenance-state-choice')?.value || null));
  });
}

async function changeTaskState(task) {
  const nextState = await chooseState(task.estado);
  if (!nextState || nextState === task.estado) return;

  const nowIso = new Date().toISOString();
  const completed = nextState === 'completada';
  const updated = await updateMaintenanceTask(supabaseInstance, mountedHotelId, task.id, {
    estado: nextState,
    fecha_completada: completed ? nowIso : null,
    realizada_por: completed ? (mountedUser?.id || null) : null,
    ultima_realizacion: completed ? nowIso : task.ultima_realizacion || null
  });

  await ensureNextPreventiveTask({ supabase: supabaseInstance, task: updated }).catch((error) => {
    console.warn('No se pudo generar el siguiente preventivo:', error);
  });

  const cache = mountedContainer?.__mantCache;
  await notifyTaskChange({
    supabase: supabaseInstance,
    hotelId: mountedHotelId,
    currentUser: mountedUser,
    rooms: cache?.rooms || [],
    task: updated,
    isEdit: true
  });
  await refreshMaintenance();
}

async function removeTask(task) {
  const confirmed = window.confirm(`¿Eliminar la tarea “${task.titulo}”? Esta acción no se puede deshacer.`);
  if (!confirmed) return;
  await deleteMaintenanceTask(supabaseInstance, mountedHotelId, task.id);
  await refreshMaintenance();
}

function printPendingTasks(container) {
  const cache = container.__mantCache || {};
  const tasks = (cache.tareas || []).filter((task) => isOpenTaskState(task.estado));
  if (!tasks.length) {
    alert('No hay tareas pendientes para imprimir.');
    return;
  }

  const rows = tasks.map((task) => `
    <tr>
      <td>${escapeHtml(task.titulo)}</td>
      <td>${escapeHtml(cache.roomMap?.get(task.habitacion_id)?.nombre || 'General')}</td>
      <td>${escapeHtml(renderType(task, false))}</td>
      <td>${escapeHtml(renderPriority(task.prioridad, false))}</td>
      <td>${escapeHtml(renderStatus(task.estado, false))}</td>
      <td>${escapeHtml(cache.userMap?.get(task.asignada_a) || 'No asignado')}</td>
      <td>${escapeHtml(formatDate(task.fecha_programada))}</td>
    </tr>`).join('');

  const printWindow = window.open('', '_blank', 'width=1000,height=700');
  if (!printWindow) {
    alert('El navegador bloqueó la ventana de impresión.');
    return;
  }

  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pendientes de mantenimiento</title><style>
    body{font-family:Arial,sans-serif;padding:24px;color:#1f2937}h1{font-size:22px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;font-size:12px}th{background:#f3f4f6}.meta{margin-top:12px;font-size:11px;color:#6b7280}
  </style></head><body><h1>Pendientes de mantenimiento</h1><table><thead><tr><th>Tarea</th><th>Habitación</th><th>Impacto</th><th>Prioridad</th><th>Estado</th><th>Encargado</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table><div class="meta">Generado el ${escapeHtml(new Date().toLocaleString('es-CO'))}</div></body></html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
