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
import {
  QUICK_MAINTENANCE_CATEGORIES,
  buildQuickMaintenancePayload,
  getQuickMaintenanceCategory,
  isRoomOccupiedForMaintenance,
  mergeQuickFiles,
  normalizeQuickImpact,
  resolveDefaultMaintenanceAssignee
} from './mantenimiento-quick-report.js';

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

function renderMeta(meta) {
  return `<span class="inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.classes}">${escapeHtml(meta.text)}</span>`;
}

function formatDate(value, fallback = 'Sin fecha') {
  if (!value) return fallback;
  const date = new Date(String(value).length <= 10 ? `${value}T12:00:00` : value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString('es-CO');
}

function formatDateTime(value, fallback = '') {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString('es-CO');
}

function isOverdue(task) {
  if (!isOpenTaskState(task?.estado) || !task?.fecha_programada) return false;
  const end = new Date(`${String(task.fecha_programada).slice(0, 10)}T23:59:59`);
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now();
}

function closeModal(target) {
  if (target) target.innerHTML = '';
}

function getUserLabel(user) {
  return user?.nombre || user?.correo || user?.email || 'Usuario';
}

async function hydrateTaskAttachments(supabase, tasks) {
  return Promise.all((tasks || []).map(async (task) => ({
    ...task,
    adjuntos: await hydrateMaintenanceEvidenceUrls(supabase, task.adjuntos || [])
  })));
}

function renderEvidencePills(attachments = []) {
  if (!attachments.length) return '';
  return attachments.slice(0, 3).map((attachment, index) => {
    const url = attachment.display_url || attachment.url || '';
    const label = attachment.kind === 'image' ? '📷 Foto' : '📎 Archivo';
    if (!url) return `<span class="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-500">${label}</span>`;
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-blue-700">${label} ${index + 1}</a>`;
  }).join('');
}

function applyQuickView(tasks, quickView) {
  if (quickView === 'bloquean') return tasks.filter((task) => isOpenTaskState(task.estado) && isBlockingTask(task));
  if (quickView === 'programadas') return tasks.filter((task) => isOpenTaskState(task.estado) && !isBlockingTask(task));
  if (quickView === 'mias') return tasks.filter((task) => isOpenTaskState(task.estado) && String(task.asignada_a || '') === String(mountedUser?.id || ''));
  if (quickView === 'todas') return tasks;
  return tasks.filter((task) => isOpenTaskState(task.estado));
}

function renderSummary(container, tasks) {
  const target = container.querySelector('#mant-resumen');
  if (!target) return;
  const open = tasks.filter((task) => isOpenTaskState(task.estado));
  const blockers = open.filter(isBlockingTask);
  const progress = open.filter((task) => task.estado === 'en_progreso');
  const overdue = open.filter(isOverdue);
  const mine = open.filter((task) => String(task.asignada_a || '') === String(mountedUser?.id || ''));

  target.innerHTML = `
    <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button type="button" data-summary-view="bloquean" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-left transition hover:border-red-300">
        <p class="text-[11px] font-bold uppercase tracking-wide text-red-600">Fuera de servicio</p>
        <p class="mt-1 text-2xl font-black text-red-700">${blockers.length}</p>
      </button>
      <button type="button" data-summary-view="abiertas" class="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left transition hover:border-blue-300">
        <p class="text-[11px] font-bold uppercase tracking-wide text-blue-600">En progreso</p>
        <p class="mt-1 text-2xl font-black text-blue-700">${progress.length}</p>
      </button>
      <button type="button" data-summary-view="abiertas" class="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-left transition hover:border-amber-300">
        <p class="text-[11px] font-bold uppercase tracking-wide text-amber-700">Vencidas</p>
        <p class="mt-1 text-2xl font-black text-amber-800">${overdue.length}</p>
      </button>
      <button type="button" data-summary-view="mias" class="rounded-2xl border border-violet-200 bg-violet-50 p-3 text-left transition hover:border-violet-300">
        <p class="text-[11px] font-bold uppercase tracking-wide text-violet-700">Asignadas a mí</p>
        <p class="mt-1 text-2xl font-black text-violet-800">${mine.length}</p>
      </button>
    </div>`;

  target.querySelectorAll('[data-summary-view]').forEach((button) => {
    button.addEventListener('click', () => setQuickView(button.dataset.summaryView || 'abiertas'));
  });
}

function taskPrimaryAction(task) {
  if (task.estado === 'pendiente') return { action: 'start', label: task.asignada_a ? 'Iniciar' : 'Tomar e iniciar', classes: 'bg-blue-600 text-white hover:bg-blue-700' };
  if (task.estado === 'en_progreso') return { action: 'complete', label: 'Completar', classes: 'bg-emerald-600 text-white hover:bg-emerald-700' };
  return null;
}

function renderMobileCard(task, roomMap, userMap) {
  const room = task.habitacion_id ? roomMap.get(task.habitacion_id) : null;
  const primary = taskPrimaryAction(task);
  const overdue = isOverdue(task);
  const category = getQuickMaintenanceCategory(task.categoria_mantenimiento || 'otro');
  return `
    <article class="rounded-2xl border ${isBlockingTask(task) && isOpenTaskState(task.estado) ? 'border-red-200 bg-red-50/30' : 'border-slate-200 bg-white'} p-4 shadow-sm" data-task-card="${task.id}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="mb-2 flex flex-wrap items-center gap-1.5">
            ${renderMeta(getStatusMeta(task.estado))}
            ${renderMeta(getTypeMeta(task.tipo, task))}
            ${overdue ? '<span class="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">Vencida</span>' : ''}
          </div>
          <h3 class="text-base font-extrabold leading-snug text-slate-900">${escapeHtml(task.titulo || '-')}</h3>
          <p class="mt-1 text-sm font-semibold text-slate-600">${escapeHtml(room?.nombre || 'Área general')} · ${escapeHtml(category.icon)} ${escapeHtml(category.label)}</p>
        </div>
        <div>${renderMeta(getPriorityMeta(task.prioridad))}</div>
      </div>
      ${task.descripcion ? `<p class="mt-3 line-clamp-2 text-sm text-slate-600">${escapeHtml(task.descripcion)}</p>` : ''}
      <div class="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        <div><span class="block text-[10px] font-bold uppercase text-slate-400">Responsable</span><span class="font-semibold">${escapeHtml(userMap.get(task.asignada_a) || 'Sin asignar')}</span></div>
        <div><span class="block text-[10px] font-bold uppercase text-slate-400">Programada</span><span class="font-semibold">${escapeHtml(formatDate(task.fecha_programada))}</span></div>
      </div>
      <div class="mt-3 flex flex-wrap gap-1.5">${renderEvidencePills(task.adjuntos || [])}</div>
      <div class="mt-4 flex gap-2">
        ${primary ? `<button type="button" data-task-action="${primary.action}" data-task-id="${task.id}" class="min-h-[44px] flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${primary.classes}">${primary.label}</button>` : ''}
        <button type="button" data-task-action="edit" data-task-id="${task.id}" class="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Ver / editar</button>
      </div>
    </article>`;
}

function renderDesktopTable(tasks, roomMap, userMap) {
  return `
    <div class="hidden overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm lg:block">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500">
          <tr><th class="px-3 py-3">Tarea</th><th class="px-3 py-3">Habitación</th><th class="px-3 py-3">Impacto</th><th class="px-3 py-3">Responsable</th><th class="px-3 py-3">Prioridad</th><th class="px-3 py-3">Estado</th><th class="px-3 py-3">Acciones</th></tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          ${tasks.map((task) => {
            const room = task.habitacion_id ? roomMap.get(task.habitacion_id) : null;
            const primary = taskPrimaryAction(task);
            return `<tr class="align-top hover:bg-slate-50">
              <td class="max-w-md px-3 py-3"><p class="font-bold text-slate-800">${escapeHtml(task.titulo)}</p><p class="mt-1 text-xs text-slate-500">${escapeHtml(task.descripcion || 'Sin descripción')}</p></td>
              <td class="px-3 py-3 font-semibold text-slate-700">${escapeHtml(room?.nombre || 'General')}</td>
              <td class="px-3 py-3">${renderMeta(getTypeMeta(task.tipo, task))}</td>
              <td class="px-3 py-3 text-slate-700">${escapeHtml(userMap.get(task.asignada_a) || 'Sin asignar')}</td>
              <td class="px-3 py-3">${renderMeta(getPriorityMeta(task.prioridad))}</td>
              <td class="px-3 py-3">${renderMeta(getStatusMeta(task.estado))}</td>
              <td class="px-3 py-3"><div class="flex min-w-[210px] gap-2">${primary ? `<button type="button" data-task-action="${primary.action}" data-task-id="${task.id}" class="rounded-lg px-3 py-2 text-xs font-bold ${primary.classes}">${primary.label}</button>` : ''}<button type="button" data-task-action="edit" data-task-id="${task.id}" class="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Editar</button></div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

function renderTaskList(container, tasks, rooms, users) {
  const list = container.querySelector('#mant-list');
  if (!list) return;
  const roomMap = new Map((rooms || []).map((room) => [room.id, room]));
  const userMap = new Map((users || []).map((user) => [user.id, getUserLabel(user)]));
  const sorted = sortTasks(tasks);
  container.__mantCache = { tareas: sorted, rooms, users, roomMap, userMap };

  if (!sorted.length) {
    list.innerHTML = `<div class="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center"><p class="text-lg font-bold text-slate-700">No hay tareas en esta vista.</p><p class="mt-1 text-sm text-slate-500">Reporta un problema o cambia los filtros.</p></div>`;
    return;
  }

  list.innerHTML = `<div class="grid gap-3 lg:hidden">${sorted.map((task) => renderMobileCard(task, roomMap, userMap)).join('')}</div>${renderDesktopTable(sorted, roomMap, userMap)}`;
  list.addEventListener('click', onTaskListAction, { once: true });
}

async function onTaskListAction(event) {
  const button = event.target.closest?.('[data-task-action]');
  if (!button) {
    mountedContainer?.querySelector('#mant-list')?.addEventListener('click', onTaskListAction, { once: true });
    return;
  }
  const cache = mountedContainer?.__mantCache;
  const task = cache?.tareas?.find((item) => String(item.id) === String(button.dataset.taskId));
  if (!task) return;
  button.disabled = true;
  try {
    if (button.dataset.taskAction === 'edit') await showFullTaskModal(mountedContainer, supabaseInstance, mountedHotelId, mountedUser, task);
    if (button.dataset.taskAction === 'start') await transitionTask(task, 'en_progreso', { claim: !task.asignada_a });
    if (button.dataset.taskAction === 'complete') {
      if (window.confirm(`¿Marcar “${task.titulo}” como completada?`)) await transitionTask(task, 'completada');
    }
  } catch (error) {
    console.error('Error ejecutando acción de mantenimiento:', error);
    alert(error?.message || 'No se pudo completar la acción.');
  } finally {
    if (button.isConnected) button.disabled = false;
    mountedContainer?.querySelector('#mant-list')?.addEventListener('click', onTaskListAction, { once: true });
  }
}

function setQuickView(view) {
  if (!mountedContainer) return;
  mountedContainer.dataset.maintenanceView = view || 'abiertas';
  mountedContainer.querySelectorAll('[data-quick-view]').forEach((button) => {
    const active = button.dataset.quickView === mountedContainer.dataset.maintenanceView;
    button.classList.toggle('bg-slate-900', active);
    button.classList.toggle('text-white', active);
    button.classList.toggle('bg-white', !active);
    button.classList.toggle('text-slate-600', !active);
  });
  refreshMaintenance();
}

function updateRoomFilter(container, rooms) {
  const select = container.querySelector('#filtro-habitacion');
  if (!select) return;
  const current = select.value || '';
  select.innerHTML = '<option value="">Todas las habitaciones</option>' + rooms.map((room) => `<option value="${room.id}">${escapeHtml(room.nombre)}</option>`).join('');
  select.value = current;
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
      const hydrated = await hydrateTaskAttachments(supabase, rawTasks);
      const quickView = container.dataset.maintenanceView || 'abiertas';
      updateRoomFilter(container, referenceData.habitaciones);
      renderSummary(container, hydrated);
      renderTaskList(container, applyQuickView(hydrated, quickView), referenceData.habitaciones, referenceData.usuarios);
      container.__mantAllTasks = hydrated;
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
  container.dataset.maintenanceView = 'abiertas';

  container.innerHTML = `
    <section class="pb-24 lg:pb-6">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 class="flex items-center gap-2 text-2xl font-black text-slate-900"><span>🛠️</span><span>Mantenimiento</span></h2><p class="mt-1 text-sm text-slate-500">Reporta, asigna y resuelve novedades desde el celular.</p></div>
        <div class="hidden gap-2 sm:flex"><button id="btn-nueva-tarea" class="button button-secondary">Tarea completa</button><button id="btn-reporte-rapido" class="button button-success">📷 Reportar problema</button></div>
      </div>

      <div class="mb-3 flex gap-2 overflow-x-auto pb-1">
        <button type="button" data-quick-view="abiertas" class="shrink-0 rounded-full bg-slate-900 px-4 py-2 text-sm font-bold text-white">Abiertas</button>
        <button type="button" data-quick-view="bloquean" class="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600">Fuera de servicio</button>
        <button type="button" data-quick-view="programadas" class="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600">Programadas</button>
        <button type="button" data-quick-view="mias" class="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600">Mis tareas</button>
        <button type="button" data-quick-view="todas" class="shrink-0 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600">Historial</button>
      </div>

      <details class="mb-4 rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary class="cursor-pointer list-none px-4 py-3 text-sm font-bold text-slate-700">⚙️ Más filtros y herramientas</summary>
        <div class="grid gap-2 border-t border-slate-100 p-3 sm:grid-cols-2 lg:grid-cols-4">
          <select id="filtro-estado" class="form-control w-full rounded-lg"><option value="">Todos los estados</option><option value="pendiente">Pendiente</option><option value="en_progreso">En progreso</option><option value="completada">Completada</option><option value="cancelada">Cancelada</option></select>
          <select id="filtro-tipo" class="form-control w-full rounded-lg"><option value="">Todos los impactos</option><option value="bloqueante">Bloquea habitación</option><option value="programado">No bloquea</option></select>
          <select id="filtro-habitacion" class="form-control w-full rounded-lg"><option value="">Todas las habitaciones</option></select>
          <div class="flex gap-2"><button id="btn-filtrar" class="button button-primary flex-1">Aplicar</button><button id="btn-imprimir-pendientes" class="button button-secondary flex-1">Imprimir</button></div>
        </div>
      </details>

      <div id="mant-resumen" class="mb-4"></div>
      <div id="mant-list"></div>
      <div id="mant-modal"></div>

      <div class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
        <div class="mx-auto flex max-w-lg gap-2"><button id="btn-nueva-tarea-mobile" class="min-h-[48px] flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700">Tarea completa</button><button id="btn-reporte-rapido-mobile" class="min-h-[48px] flex-[1.35] rounded-xl bg-emerald-600 px-3 text-sm font-black text-white">📷 Reportar problema</button></div>
      </div>
    </section>`;

  container.querySelectorAll('[data-quick-view]').forEach((button) => button.addEventListener('click', () => setQuickView(button.dataset.quickView)));
  container.querySelector('#btn-filtrar')?.addEventListener('click', () => refreshMaintenance());
  container.querySelector('#btn-imprimir-pendientes')?.addEventListener('click', () => printPendingTasks(container));
  const openQuick = () => showQuickReportModal(container, supabase, hotelId, currentUser, { origen_rapido: true, tipo: TASK_TYPES.programado });
  const openFull = () => showFullTaskModal(container, supabase, hotelId, currentUser, null);
  container.querySelector('#btn-reporte-rapido')?.addEventListener('click', openQuick);
  container.querySelector('#btn-reporte-rapido-mobile')?.addEventListener('click', openQuick);
  container.querySelector('#btn-nueva-tarea')?.addEventListener('click', openFull);
  container.querySelector('#btn-nueva-tarea-mobile')?.addEventListener('click', openFull);

  await refreshMaintenance();

  if (mantenimientoSubscription) await supabase.removeChannel(mantenimientoSubscription).catch(() => {});
  mantenimientoSubscription = supabase.channel(`mantenimiento:${hotelId}`).on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_mantenimiento', filter: `hotel_id=eq.${hotelId}` }, () => refreshMaintenance()).subscribe();
}

export function unmount() {
  if (mantenimientoSubscription && supabaseInstance) supabaseInstance.removeChannel(mantenimientoSubscription).catch(() => {});
  mantenimientoSubscription = null;
  supabaseInstance = null;
  mountedContainer = null;
  mountedHotelId = null;
  mountedUser = null;
  refreshInFlight = null;
}

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  const normalized = tarea ? normalizeTaskRecord(tarea) : null;
  if (!normalized?.id && (normalized?.origen_selector || normalized?.origen_rapido)) {
    return showQuickReportModal(container, supabase, hotelId, currentUser, normalized || {});
  }
  return showFullTaskModal(container, supabase, hotelId, currentUser, normalized);
}

function getModalTarget(container) {
  return container?.querySelector?.('#mant-modal') || container;
}

function renderSelectedFiles(files) {
  if (!files.length) return '<p class="text-xs text-slate-400">Sin archivos seleccionados.</p>';
  return files.map((file) => `<div class="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">${escapeHtml(file.name)} · ${Math.ceil((file.size || 0) / 1024)} KB</div>`).join('');
}

function renderExistingAttachments(attachments) {
  if (!attachments.length) return '<p class="text-xs text-slate-400">Sin evidencias guardadas.</p>';
  return attachments.map((attachment, index) => `<div class="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><div class="min-w-0"><p class="truncate text-sm font-semibold text-slate-700">${escapeHtml(attachment.name || `Archivo ${index + 1}`)}</p>${attachment.display_url || attachment.url ? `<a target="_blank" rel="noopener noreferrer" href="${escapeHtml(attachment.display_url || attachment.url)}" class="text-xs font-bold text-blue-600">Ver archivo</a>` : ''}</div><button type="button" data-remove-attachment="${index}" class="rounded-lg border border-red-200 bg-white px-2 py-1 text-xs font-bold text-red-600">Quitar</button></div>`).join('');
}

async function showQuickReportModal(container, supabase, hotelId, currentUser, seed = {}) {
  if (!container || !supabase || !hotelId) return;
  const target = getModalTarget(container);
  const { habitaciones, usuarios } = await loadMaintenanceReferenceData(supabase, hotelId);
  const seededRoom = habitaciones.find((room) => String(room.id) === String(seed.habitacion_id || '')) || null;
  const fromRoomMap = Boolean(seed.origen_selector && seededRoom);
  const defaultAssignee = resolveDefaultMaintenanceAssignee(usuarios, currentUser);
  const requestId = seed.solicitud_id || createRequestId();
  const genericSeedTitle = /^Mantenimiento Hab\./i.test(String(seed.titulo || '').trim()) ? '' : String(seed.titulo || '').trim();
  const initialType = normalizeQuickImpact(seed.tipo || TASK_TYPES.programado, seededRoom);
  let selectedFiles = [];

  target.innerHTML = `
    <div class="fixed inset-0 z-[260] flex items-end bg-black/55 sm:items-center sm:justify-center sm:p-4">
      <div class="max-h-[94vh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
        <div class="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
          <div><p class="text-xs font-bold uppercase tracking-[0.16em] text-emerald-600">Reporte rápido</p><h3 class="text-xl font-black text-slate-900">¿Qué necesita mantenimiento?</h3></div>
          <button type="button" id="mant-quick-close" class="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">&times;</button>
        </div>
        <form id="mant-quick-form" class="space-y-5 p-5 pb-8">
          <div>
            <label class="mb-2 block text-sm font-black text-slate-800">1. Ubicación</label>
            ${fromRoomMap ? `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p class="font-black text-slate-900">Habitación ${escapeHtml(seededRoom.nombre)}</p><p class="mt-1 text-xs text-slate-500">Estado actual: ${escapeHtml(seededRoom.estado || '-')}</p><input type="hidden" name="habitacion_id" value="${seededRoom.id}"></div>` : `<select name="habitacion_id" id="mant-quick-room" class="form-control min-h-[48px] w-full rounded-xl"><option value="">Área general / sin habitación</option>${habitaciones.map((room) => `<option value="${room.id}" ${String(seed.habitacion_id || '') === String(room.id) ? 'selected' : ''}>${escapeHtml(room.nombre)} · ${escapeHtml(room.estado || '-')}</option>`).join('')}</select>`}
          </div>

          <fieldset>
            <legend class="mb-2 text-sm font-black text-slate-800">2. ¿Puede seguir operando?</legend>
            <div class="grid grid-cols-2 gap-2">
              <label class="cursor-pointer"><input class="peer sr-only" type="radio" name="tipo" value="programado" ${initialType !== TASK_TYPES.bloqueante ? 'checked' : ''}><span class="flex min-h-[92px] flex-col justify-center rounded-2xl border-2 border-slate-200 bg-white p-3 text-center transition peer-checked:border-violet-500 peer-checked:bg-violet-50"><strong class="text-sm text-slate-900">✅ Sí, puede seguir</strong><span class="mt-1 text-[11px] text-slate-500">Queda anotado para atender después.</span></span></label>
              <label id="mant-quick-block-label" class="cursor-pointer"><input class="peer sr-only" type="radio" name="tipo" value="bloqueante" ${initialType === TASK_TYPES.bloqueante ? 'checked' : ''}><span class="flex min-h-[92px] flex-col justify-center rounded-2xl border-2 border-slate-200 bg-white p-3 text-center transition peer-checked:border-red-500 peer-checked:bg-red-50"><strong class="text-sm text-slate-900">⛔ Sacar de servicio</strong><span class="mt-1 text-[11px] text-slate-500">No podrá recibir una nueva estancia.</span></span></label>
            </div>
            <p id="mant-quick-impact-help" class="mt-2 text-xs font-semibold text-slate-500"></p>
          </fieldset>

          <fieldset>
            <legend class="mb-2 text-sm font-black text-slate-800">3. Tipo de problema</legend>
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">${QUICK_MAINTENANCE_CATEGORIES.map((category, index) => `<label class="cursor-pointer"><input class="peer sr-only" type="radio" name="categoria" value="${category.id}" ${index === QUICK_MAINTENANCE_CATEGORIES.length - 1 ? 'checked' : ''}><span class="flex min-h-[72px] flex-col items-center justify-center rounded-xl border border-slate-200 px-2 py-2 text-center transition peer-checked:border-blue-500 peer-checked:bg-blue-50"><span class="text-xl">${category.icon}</span><span class="mt-1 text-[11px] font-bold text-slate-700">${escapeHtml(category.label)}</span></span></label>`).join('')}</div>
          </fieldset>

          <div>
            <label class="mb-1 block text-sm font-black text-slate-800">4. Describe el problema <span class="text-red-500">*</span></label>
            <input name="titulo" maxlength="180" required class="form-control min-h-[48px] w-full rounded-xl text-base" value="${escapeHtml(genericSeedTitle)}" placeholder="Ej. El aire prende pero no enfría">
            <textarea name="descripcion" class="form-control mt-2 min-h-[76px] w-full rounded-xl" placeholder="Detalle adicional (opcional)">${escapeHtml(seed.descripcion || '')}</textarea>
          </div>

          <fieldset>
            <legend class="mb-2 text-sm font-black text-slate-800">5. Prioridad</legend>
            <div class="grid grid-cols-3 gap-2"><label><input class="peer sr-only" type="radio" name="prioridad" value="1" checked><span class="block cursor-pointer rounded-xl border border-slate-200 p-3 text-center text-sm font-bold peer-checked:border-yellow-500 peer-checked:bg-yellow-50">Media</span></label><label><input class="peer sr-only" type="radio" name="prioridad" value="2"><span class="block cursor-pointer rounded-xl border border-slate-200 p-3 text-center text-sm font-bold peer-checked:border-orange-500 peer-checked:bg-orange-50">Alta</span></label><label><input class="peer sr-only" type="radio" name="prioridad" value="3"><span class="block cursor-pointer rounded-xl border border-slate-200 p-3 text-center text-sm font-bold peer-checked:border-red-500 peer-checked:bg-red-50">Urgente</span></label></div>
          </fieldset>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <label class="mb-2 block text-sm font-black text-slate-800">Responsable <span class="font-normal text-slate-400">(opcional)</span></label>
            <select name="asignada_a" class="form-control w-full rounded-xl"><option value="">Sin asignar todavía</option>${usuarios.filter((user) => user.activo !== false).map((user) => `<option value="${user.id}" ${String(defaultAssignee || '') === String(user.id) ? 'selected' : ''}>${escapeHtml(getUserLabel(user))}${user.rol ? ` · ${escapeHtml(user.rol)}` : ''}</option>`).join('')}</select>
          </div>

          <div>
            <p class="mb-2 text-sm font-black text-slate-800">Evidencia <span class="font-normal text-slate-400">(opcional)</span></p>
            <div class="grid grid-cols-2 gap-2"><label for="mant-quick-camera" class="flex min-h-[52px] cursor-pointer items-center justify-center rounded-xl bg-slate-900 px-3 text-sm font-black text-white">📷 Tomar foto</label><label for="mant-quick-files" class="flex min-h-[52px] cursor-pointer items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-sm font-black text-slate-700">📎 Adjuntar</label></div>
            <input id="mant-quick-camera" class="sr-only" type="file" accept="image/*" capture="environment">
            <input id="mant-quick-files" class="sr-only" type="file" multiple accept="${escapeHtml(getMaintenanceEvidenceAcceptString())}">
            <div id="mant-quick-selected" class="mt-2 space-y-1">${renderSelectedFiles([])}</div>
          </div>

          <div id="mant-quick-error" class="hidden rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"></div>
          <button id="mant-quick-submit" type="submit" class="min-h-[52px] w-full rounded-xl bg-emerald-600 px-4 text-base font-black text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700">Guardar reporte</button>
        </form>
      </div>
    </div>`;

  const form = target.querySelector('#mant-quick-form');
  const roomSelect = target.querySelector('#mant-quick-room');
  const cameraInput = target.querySelector('#mant-quick-camera');
  const fileInput = target.querySelector('#mant-quick-files');
  const selectedTarget = target.querySelector('#mant-quick-selected');
  const helpTarget = target.querySelector('#mant-quick-impact-help');
  const errorTarget = target.querySelector('#mant-quick-error');

  const currentRoom = () => habitaciones.find((room) => String(room.id) === String(form?.elements?.habitacion_id?.value || '')) || null;
  const syncRoomImpact = () => {
    const room = currentRoom();
    const blocker = form?.querySelector('input[name="tipo"][value="bloqueante"]');
    const occupied = isRoomOccupiedForMaintenance(room);
    if (blocker) blocker.disabled = occupied;
    if (occupied && form?.elements?.tipo?.value === TASK_TYPES.bloqueante) form.querySelector('input[name="tipo"][value="programado"]').checked = true;
    const label = target.querySelector('#mant-quick-block-label');
    label?.classList.toggle('opacity-40', occupied);
    label?.classList.toggle('cursor-not-allowed', occupied);
    if (helpTarget) helpTarget.textContent = occupied ? 'Esta habitación tiene una estancia activa. El problema puede reportarse ahora, pero no se puede sacar de servicio hasta finalizar la estancia.' : 'Elige “Sacar de servicio” solo cuando la habitación realmente no deba venderse.';
  };

  target.querySelector('#mant-quick-close')?.addEventListener('click', () => closeModal(target));
  roomSelect?.addEventListener('change', syncRoomImpact);
  syncRoomImpact();
  const syncFiles = () => {
    selectedFiles = mergeQuickFiles(Array.from(cameraInput?.files || []), Array.from(fileInput?.files || []));
    if (selectedTarget) selectedTarget.innerHTML = renderSelectedFiles(selectedFiles);
  };
  cameraInput?.addEventListener('change', syncFiles);
  fileInput?.addEventListener('change', syncFiles);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = target.querySelector('#mant-quick-submit');
    if (submit?.disabled) return;
    const data = Object.fromEntries(new FormData(form));
    if (!String(data.titulo || '').trim()) {
      errorTarget.textContent = 'Describe brevemente el problema.';
      errorTarget.classList.remove('hidden');
      return;
    }
    if (submit) { submit.disabled = true; submit.textContent = 'Guardando...'; }
    errorTarget?.classList.add('hidden');
    let uploaded = [];
    try {
      uploaded = await uploadMaintenanceEvidence({ supabase, hotelId, userId: currentUser?.id, files: selectedFiles, taskRequestId: requestId });
      const room = currentRoom();
      const payload = buildQuickMaintenancePayload({
        title: data.titulo,
        description: data.descripcion,
        categoryId: data.categoria,
        requestedType: data.tipo,
        room,
        priority: data.prioridad,
        assigneeId: data.asignada_a,
        attachments: uploaded,
        requestId,
        currentUserId: currentUser?.id || null
      });
      const saved = await createMaintenanceTask(supabase, hotelId, payload);
      await notifyTaskChange({ supabase, hotelId, currentUser, rooms: habitaciones, task: saved, isEdit: false });
      closeModal(target);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: saved.id, source: 'quick-report' } }));
      if (container.querySelector?.('#mant-list')) await refreshMaintenance(container, supabase, hotelId);
    } catch (error) {
      await Promise.allSettled(uploaded.map((attachment) => deleteMaintenanceEvidence(supabase, attachment)));
      const message = isOccupiedMaintenanceConflict(error) ? 'La habitación sigue ocupada. El reporte se debe guardar como pendiente sin bloquearla.' : (error?.message || 'No se pudo guardar el reporte.');
      if (errorTarget) { errorTarget.textContent = message; errorTarget.classList.remove('hidden'); }
      if (submit) { submit.disabled = false; submit.textContent = 'Guardar reporte'; }
    }
  });
}

async function showFullTaskModal(container, supabase, hotelId, currentUser, task = null) {
  if (!container || !supabase || !hotelId) return;
  const target = getModalTarget(container);
  const normalized = task ? normalizeTaskRecord(task) : null;
  const { habitaciones, usuarios } = await loadMaintenanceReferenceData(supabase, hotelId);
  const requestId = normalized?.solicitud_id || createRequestId();
  const isEditing = Boolean(normalized?.id);
  let persisted = await hydrateMaintenanceEvidenceUrls(supabase, normalized?.adjuntos || []);
  let removed = [];
  let selectedFiles = [];

  target.innerHTML = `
    <div class="fixed inset-0 z-[260] overflow-y-auto bg-black/55 p-3 sm:p-5"><div class="mx-auto max-w-2xl"><div class="relative rounded-3xl bg-white shadow-2xl"><button type="button" id="mant-full-close" class="absolute right-4 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">&times;</button><form id="mant-full-form" class="space-y-4 p-5 sm:p-6">
      <div class="pr-12"><p class="text-xs font-bold uppercase tracking-[0.16em] text-blue-600">Gestión completa</p><h3 class="text-2xl font-black text-slate-900">${isEditing ? 'Editar mantenimiento' : 'Nueva tarea'}</h3></div>
      <div class="grid gap-3 sm:grid-cols-2"><div><label class="mb-1 block text-sm font-bold">Habitación / ubicación</label><select name="habitacion_id" class="form-control w-full rounded-xl"><option value="">Área general</option>${habitaciones.map((room) => `<option value="${room.id}" ${String(normalized?.habitacion_id || '') === String(room.id) ? 'selected' : ''}>${escapeHtml(room.nombre)} · ${escapeHtml(room.estado || '-')}</option>`).join('')}</select></div><div><label class="mb-1 block text-sm font-bold">Responsable</label><select name="asignada_a" class="form-control w-full rounded-xl"><option value="">Sin asignar</option>${usuarios.filter((user) => user.activo !== false).map((user) => `<option value="${user.id}" ${String(normalized?.asignada_a || '') === String(user.id) ? 'selected' : ''}>${escapeHtml(getUserLabel(user))}</option>`).join('')}</select></div></div>
      <div><label class="mb-1 block text-sm font-bold">Título <span class="text-red-500">*</span></label><input name="titulo" required maxlength="180" class="form-control w-full rounded-xl" value="${escapeHtml(normalized?.titulo || '')}" placeholder="Ej. Aire acondicionado no enfría"></div>
      <div><label class="mb-1 block text-sm font-bold">Descripción</label><textarea name="descripcion" class="form-control min-h-[90px] w-full rounded-xl">${escapeHtml(normalized?.descripcion || '')}</textarea></div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><div><label class="mb-1 block text-sm font-bold">Impacto</label><select name="tipo" class="form-control w-full rounded-xl"><option value="programado" ${normalizeTaskType(normalized?.tipo, normalized) === TASK_TYPES.programado ? 'selected' : ''}>Puede seguir operando</option><option value="bloqueante" ${normalizeTaskType(normalized?.tipo, normalized) === TASK_TYPES.bloqueante ? 'selected' : ''}>Sacar de servicio</option></select></div><div><label class="mb-1 block text-sm font-bold">Categoría</label><select name="categoria" class="form-control w-full rounded-xl">${QUICK_MAINTENANCE_CATEGORIES.map((category) => `<option value="${category.id}" ${String(normalized?.categoria_mantenimiento || 'otro') === category.id ? 'selected' : ''}>${category.icon} ${escapeHtml(category.label)}</option>`).join('')}</select></div><div><label class="mb-1 block text-sm font-bold">Prioridad</label><select name="prioridad" class="form-control w-full rounded-xl"><option value="0" ${Number(normalized?.prioridad) === 0 ? 'selected' : ''}>Baja</option><option value="1" ${Number(normalized?.prioridad ?? 1) === 1 ? 'selected' : ''}>Media</option><option value="2" ${Number(normalized?.prioridad) === 2 ? 'selected' : ''}>Alta</option><option value="3" ${Number(normalized?.prioridad) === 3 ? 'selected' : ''}>Urgente</option></select></div><div><label class="mb-1 block text-sm font-bold">Estado</label><select name="estado" class="form-control w-full rounded-xl"><option value="pendiente" ${!normalized || normalized.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option><option value="en_progreso" ${normalized?.estado === 'en_progreso' ? 'selected' : ''}>En progreso</option><option value="completada" ${normalized?.estado === 'completada' ? 'selected' : ''}>Completada</option><option value="cancelada" ${normalized?.estado === 'cancelada' ? 'selected' : ''}>Cancelada</option></select></div><div><label class="mb-1 block text-sm font-bold">Fecha programada</label><input name="fecha_programada" type="date" class="form-control w-full rounded-xl" value="${escapeHtml(String(normalized?.fecha_programada || '').slice(0, 10))}"></div><div><label class="mb-1 block text-sm font-bold">Frecuencia</label><select name="frecuencia" class="form-control w-full rounded-xl">${['unica','diaria','semanal','mensual','personalizada'].map((freq) => `<option value="${freq}" ${normalizeTaskFrequency(normalized?.frecuencia) === freq ? 'selected' : ''}>${escapeHtml(getTaskFrequencyLabel(freq))}</option>`).join('')}</select></div></div>
      <div class="rounded-2xl border border-slate-200 p-4"><p class="mb-2 text-sm font-black text-slate-800">Evidencias privadas</p><div id="mant-full-existing" class="mb-3 space-y-2">${renderExistingAttachments(persisted)}</div><div class="grid grid-cols-2 gap-2"><label for="mant-full-camera" class="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">📷 Tomar foto</label><label for="mant-full-files" class="flex min-h-[48px] cursor-pointer items-center justify-center rounded-xl border border-slate-300 text-sm font-bold text-slate-700">📎 Adjuntar</label></div><input id="mant-full-camera" class="sr-only" type="file" accept="image/*" capture="environment"><input id="mant-full-files" class="sr-only" type="file" multiple accept="${escapeHtml(getMaintenanceEvidenceAcceptString())}"><div id="mant-full-selected" class="mt-2 space-y-1">${renderSelectedFiles([])}</div></div>
      <div id="mant-full-error" class="hidden rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700"></div>
      <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between"><div>${isEditing ? '<button type="button" id="mant-full-delete" class="button button-danger">Eliminar</button>' : ''}</div><div class="flex gap-2"><button type="button" id="mant-full-cancel" class="button button-secondary">Cancelar</button><button type="submit" id="mant-full-submit" class="button button-success">${isEditing ? 'Guardar cambios' : 'Crear tarea'}</button></div></div>
    </form></div></div></div>`;

  const form = target.querySelector('#mant-full-form');
  const camera = target.querySelector('#mant-full-camera');
  const files = target.querySelector('#mant-full-files');
  const selectedTarget = target.querySelector('#mant-full-selected');
  const existingTarget = target.querySelector('#mant-full-existing');
  const errorTarget = target.querySelector('#mant-full-error');
  const renderExisting = () => {
    existingTarget.innerHTML = renderExistingAttachments(persisted);
    existingTarget.querySelectorAll('[data-remove-attachment]').forEach((button) => button.addEventListener('click', () => {
      const [item] = persisted.splice(Number(button.dataset.removeAttachment), 1);
      if (item) removed.push(item);
      renderExisting();
    }));
  };
  renderExisting();
  const syncFiles = () => { selectedFiles = mergeQuickFiles(Array.from(camera?.files || []), Array.from(files?.files || [])); selectedTarget.innerHTML = renderSelectedFiles(selectedFiles); };
  camera?.addEventListener('change', syncFiles);
  files?.addEventListener('change', syncFiles);
  target.querySelector('#mant-full-close')?.addEventListener('click', () => closeModal(target));
  target.querySelector('#mant-full-cancel')?.addEventListener('click', () => closeModal(target));
  target.querySelector('#mant-full-delete')?.addEventListener('click', async () => {
    if (!normalized?.id || !window.confirm(`¿Eliminar “${normalized.titulo}”?`)) return;
    await deleteMaintenanceTask(supabase, hotelId, normalized.id);
    closeModal(target);
    document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: normalized.id, action: 'deleted' } }));
    if (container.querySelector?.('#mant-list')) await refreshMaintenance(container, supabase, hotelId);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = target.querySelector('#mant-full-submit');
    if (submit?.disabled) return;
    const data = Object.fromEntries(new FormData(form));
    if (!String(data.titulo || '').trim()) return;
    if (submit) { submit.disabled = true; submit.textContent = 'Guardando...'; }
    let uploaded = [];
    try {
      uploaded = await uploadMaintenanceEvidence({ supabase, hotelId, userId: currentUser?.id, files: selectedFiles, taskRequestId: requestId });
      const now = new Date().toISOString();
      const completed = data.estado === 'completada';
      const room = habitaciones.find((item) => String(item.id) === String(data.habitacion_id || '')) || null;
      const payload = {
        titulo: String(data.titulo).trim(), descripcion: String(data.descripcion || '').trim() || null,
        prioridad: Number(data.prioridad || 0), estado: data.estado || 'pendiente',
        tipo: normalizeQuickImpact(data.tipo, room), categoria_mantenimiento: data.categoria || 'otro',
        fecha_programada: data.fecha_programada || null, frecuencia: normalizeTaskFrequency(data.frecuencia),
        asignada_a: data.asignada_a || null, habitacion_id: data.habitacion_id || null,
        adjuntos: [...persisted, ...uploaded].map(({ display_url, ...attachment }) => attachment),
        fecha_completada: completed ? (normalized?.fecha_completada || now) : null,
        realizada_por: completed ? (currentUser?.id || normalized?.realizada_por || null) : null,
        ultima_realizacion: completed ? now : (normalized?.ultima_realizacion || null)
      };
      const saved = isEditing ? await updateMaintenanceTask(supabase, hotelId, normalized.id, payload) : await createMaintenanceTask(supabase, hotelId, { ...payload, creada_por: currentUser?.id || null, solicitud_id: requestId });
      await ensureNextPreventiveTask({ supabase, task: saved }).catch(() => {});
      await Promise.allSettled(removed.map((attachment) => deleteMaintenanceEvidence(supabase, attachment)));
      await notifyTaskChange({ supabase, hotelId, currentUser, rooms: habitaciones, task: saved, isEdit: isEditing });
      closeModal(target);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: saved.id } }));
      if (container.querySelector?.('#mant-list')) await refreshMaintenance(container, supabase, hotelId);
    } catch (error) {
      await Promise.allSettled(uploaded.map((attachment) => deleteMaintenanceEvidence(supabase, attachment)));
      const message = isOccupiedMaintenanceConflict(error) ? 'La habitación tiene una estancia activa. Déjala operativa y programa el trabajo para después del checkout.' : (error?.message || 'No se pudo guardar la tarea.');
      if (errorTarget) { errorTarget.textContent = message; errorTarget.classList.remove('hidden'); }
      if (submit) { submit.disabled = false; submit.textContent = isEditing ? 'Guardar cambios' : 'Crear tarea'; }
    }
  });
}

async function transitionTask(task, nextState, { claim = false } = {}) {
  const now = new Date().toISOString();
  const completed = nextState === 'completada';
  const payload = {
    estado: nextState,
    fecha_completada: completed ? now : null,
    realizada_por: completed ? (mountedUser?.id || null) : null,
    ultima_realizacion: completed ? now : (task.ultima_realizacion || null)
  };
  if (claim && mountedUser?.id) payload.asignada_a = mountedUser.id;
  const updated = await updateMaintenanceTask(supabaseInstance, mountedHotelId, task.id, payload);
  await ensureNextPreventiveTask({ supabase: supabaseInstance, task: updated }).catch(() => {});
  const cache = mountedContainer?.__mantCache;
  await notifyTaskChange({ supabase: supabaseInstance, hotelId: mountedHotelId, currentUser: mountedUser, rooms: cache?.rooms || [], task: updated, isEdit: true });
  document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: updated.id, action: nextState } }));
  await refreshMaintenance();
}

async function notifyTaskChange({ supabase, hotelId, currentUser, rooms, task, isEdit }) {
  try {
    const roomName = rooms.find((room) => String(room.id) === String(task.habitacion_id))?.nombre || 'área general';
    const completed = task.estado === 'completada';
    const action = completed ? 'fue completada' : (isEdit ? 'fue actualizada' : 'fue reportada');
    await crearNotificacion(supabase, {
      hotelId,
      rolDestino: completed ? 'recepcionista' : 'mantenimiento',
      tipo: completed ? 'cambio_estado_mantenimiento' : 'mantenimiento',
      mensaje: `La tarea ${isBlockingTask(task) ? 'bloqueante' : 'programada'} “${task.titulo}” de ${roomName} ${action}.`,
      entidadTipo: 'tareas_mantenimiento', entidadId: task.id, generadaPorUsuarioId: currentUser?.id || null
    });
  } catch (error) {
    console.warn('No se pudo crear la notificación de mantenimiento:', error);
  }
}

function printPendingTasks(container) {
  const cache = container.__mantCache || {};
  const tasks = (container.__mantAllTasks || cache.tareas || []).filter((task) => isOpenTaskState(task.estado));
  if (!tasks.length) { alert('No hay tareas pendientes para imprimir.'); return; }
  const roomMap = new Map((cache.rooms || []).map((room) => [room.id, room.nombre]));
  const userMap = new Map((cache.users || []).map((user) => [user.id, getUserLabel(user)]));
  const rows = tasks.map((task) => `<tr><td>${escapeHtml(task.titulo)}</td><td>${escapeHtml(roomMap.get(task.habitacion_id) || 'General')}</td><td>${escapeHtml(getTypeMeta(task.tipo, task).text)}</td><td>${escapeHtml(getPriorityMeta(task.prioridad).text)}</td><td>${escapeHtml(getStatusMeta(task.estado).text)}</td><td>${escapeHtml(userMap.get(task.asignada_a) || 'Sin asignar')}</td><td>${escapeHtml(formatDate(task.fecha_programada))}</td></tr>`).join('');
  const win = window.open('', '_blank', 'width=1000,height=700');
  if (!win) { alert('El navegador bloqueó la ventana de impresión.'); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Mantenimiento pendiente</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#1f2937}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;font-size:12px}th{background:#f3f4f6}</style></head><body><h1>Mantenimiento pendiente</h1><p>Generado ${escapeHtml(formatDateTime(new Date().toISOString()))}</p><table><thead><tr><th>Tarea</th><th>Habitación</th><th>Impacto</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  win.document.close(); win.focus(); win.print();
}
