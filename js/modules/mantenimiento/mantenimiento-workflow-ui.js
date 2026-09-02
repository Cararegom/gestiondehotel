import {
  mount as baseMount,
  unmount as baseUnmount,
  showModalTarea as baseShowModalTarea
} from './mantenimiento-mobile-ui.js';
import {
  TASK_STATES,
  calculateNextScheduledDate,
  createRequestId,
  getSlaMeta,
  getStatusMeta,
  getWorkflowAction,
  isOpenTaskState,
  normalizeTaskFrequency,
  normalizeTaskState
} from './mantenimiento-domain.js';
import {
  addMaintenanceComment,
  createNextPreventiveTask,
  findOpenPreventiveTask,
  listMaintenanceHistory,
  transitionMaintenanceTask
} from './mantenimiento-repository.js';

let activeContainer = null;
let activeSupabase = null;
let activeUser = null;
let activeHotelId = null;
let observer = null;
let enhanceTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getTask(taskId) {
  const cache = activeContainer?.__mantCache;
  const all = activeContainer?.__mantAllTasks || [];
  return cache?.tareas?.find((task) => String(task.id) === String(taskId))
    || all.find((task) => String(task.id) === String(taskId))
    || null;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

function getHistoryActorLabel(item) {
  const actor = Array.isArray(item?.actor) ? item.actor[0] : item?.actor;
  return actor?.nombre || actor?.correo || actor?.email || 'Sistema';
}

function getHistoryTitle(item) {
  if (item.evento === 'creada') return 'Reporte creado';
  if (item.evento === 'asignacion') return 'Responsable actualizado';
  if (item.evento === 'actualizacion') return 'Datos de la tarea actualizados';
  if (item.evento === 'comentario') return 'Comentario';
  if (item.evento === 'estado') {
    return `${getStatusMeta(item.estado_anterior).text} → ${getStatusMeta(item.estado_nuevo).text}`;
  }
  return item.evento || 'Actividad';
}

async function ensureNextPreventive(task) {
  const frecuencia = normalizeTaskFrequency(task?.frecuencia);
  if (!['diaria', 'semanal', 'mensual'].includes(frecuencia)) return null;
  if (normalizeTaskState(task?.estado) !== TASK_STATES.cerrado) return null;

  const nextDate = calculateNextScheduledDate(task);
  if (!nextDate) return null;
  const existing = await findOpenPreventiveTask(activeSupabase, task, nextDate);
  if (existing) return existing;

  return createNextPreventiveTask(activeSupabase, {
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
    creada_por: task.realizada_por || task.creada_por || task.asignada_a || activeUser?.id || null,
    asignada_a: task.asignada_a || null,
    realizada_por: null,
    habitacion_id: task.habitacion_id || null,
    prioridad: Number(task.prioridad) || 0,
    adjuntos: [],
    solicitud_id: createRequestId()
  });
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => enhanceMaintenanceUi(), 30);
}

function renderWorkflowSummary() {
  const target = activeContainer?.querySelector('#mant-resumen');
  const tasks = activeContainer?.__mantAllTasks || [];
  if (!target) return;

  const open = tasks.filter((task) => isOpenTaskState(task.estado));
  const pending = open.filter((task) => normalizeTaskState(task.estado) === TASK_STATES.pendiente).length;
  const working = open.filter((task) => [TASK_STATES.enRevision, TASK_STATES.asignado, TASK_STATES.enProceso].includes(normalizeTaskState(task.estado))).length;
  const resolved = open.filter((task) => normalizeTaskState(task.estado) === TASK_STATES.resuelto).length;
  const overdue = open.filter((task) => getSlaMeta(task).overdue).length;
  const signature = `${tasks.length}|${pending}|${working}|${resolved}|${overdue}`;

  if (target.dataset.f3SummarySignature === signature && target.querySelector('[data-f3-summary]')) return;
  target.dataset.f3SummarySignature = signature;

  target.innerHTML = `
    <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <button type="button" data-f3-summary="abiertas" class="rounded-2xl border border-orange-200 bg-orange-50 p-3 text-left">
        <p class="text-[11px] font-bold uppercase tracking-wide text-orange-700">Pendientes</p>
        <p class="mt-1 text-2xl font-black text-orange-800">${pending}</p>
      </button>
      <button type="button" data-f3-summary="abiertas" class="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-left">
        <p class="text-[11px] font-bold uppercase tracking-wide text-blue-700">En atención</p>
        <p class="mt-1 text-2xl font-black text-blue-800">${working}</p>
      </button>
      <button type="button" data-f3-summary="abiertas" class="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-left">
        <p class="text-[11px] font-bold uppercase tracking-wide text-emerald-700">Por cerrar</p>
        <p class="mt-1 text-2xl font-black text-emerald-800">${resolved}</p>
      </button>
      <button type="button" data-f3-summary="abiertas" class="rounded-2xl border border-red-200 bg-red-50 p-3 text-left">
        <p class="text-[11px] font-bold uppercase tracking-wide text-red-700">SLA vencido</p>
        <p class="mt-1 text-2xl font-black text-red-800">${overdue}</p>
      </button>
    </div>`;

  target.querySelectorAll('[data-f3-summary]').forEach((button) => {
    button.addEventListener('click', () => {
      activeContainer.querySelector(`[data-quick-view="${button.dataset.f3Summary}"]`)?.click();
    });
  });
}

function addSlaToCard(card, task) {
  if (!card || card.querySelector('[data-f3-sla]')) return;
  const sla = getSlaMeta(task);
  if (!sla.text) return;
  // No incluir clases Tailwind con decimales (p. ej. gap-1.5) en querySelector:
  // el punto tiene semántica CSS y puede convertir el selector en inválido.
  const statusRow = card.querySelector('.mb-2.flex.flex-wrap.items-center');
  if (!statusRow) return;
  const span = document.createElement('span');
  span.dataset.f3Sla = '1';
  span.className = `rounded-full px-2.5 py-1 text-[11px] font-bold ${sla.classes}`;
  span.textContent = sla.text;
  statusRow.appendChild(span);
}

function ensureWorkflowButton(task, scope = activeContainer) {
  const action = getWorkflowAction(task, activeUser?.id);
  const taskButtons = scope?.querySelectorAll?.(`[data-task-id="${task.id}"]`) || [];
  taskButtons.forEach((button) => {
    if (button.dataset.taskAction === 'edit') {
      button.textContent = 'Ver / historial';
      return;
    }
    if (button.dataset.taskAction === 'start' || button.dataset.taskAction === 'complete') {
      if (!action) {
        button.remove();
        return;
      }
      button.dataset.taskAction = 'workflow';
      button.textContent = action.label;
      button.className = 'min-h-[44px] flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-blue-700';
    }
  });

  if (!action) return;
  const editButtons = scope?.querySelectorAll?.(`[data-task-action="edit"][data-task-id="${task.id}"]`) || [];
  editButtons.forEach((editButton) => {
    const parent = editButton.parentElement;
    if (!parent || parent.querySelector(`[data-f3-action="${task.id}"]`)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.taskAction = 'workflow';
    button.dataset.taskId = task.id;
    button.dataset.f3Action = task.id;
    button.className = 'min-h-[44px] flex-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-bold text-white transition hover:bg-blue-700';
    button.textContent = action.label;
    parent.insertBefore(button, editButton);
  });
}

function enhanceFilters() {
  const select = activeContainer?.querySelector('#filtro-estado');
  if (!select || select.dataset.f3Ready) return;
  select.dataset.f3Ready = '1';
  const current = select.value;
  select.innerHTML = `
    <option value="">Todos los estados</option>
    <option value="pendiente">Pendiente</option>
    <option value="en_revision">En revisión</option>
    <option value="asignado">Asignado</option>
    <option value="en_proceso">En proceso</option>
    <option value="resuelto">Resuelto</option>
    <option value="cerrado">Cerrado</option>
    <option value="cancelado">Cancelado</option>`;
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function enhanceCardsAndRows() {
  const tasks = activeContainer?.__mantCache?.tareas || [];
  tasks.forEach((task) => {
    const card = activeContainer.querySelector(`[data-task-card="${task.id}"]`);
    addSlaToCard(card, task);
    ensureWorkflowButton(task, activeContainer);
  });
}

async function renderHistory(task) {
  const target = activeContainer?.querySelector('#mant-f3-history-list');
  if (!target || !task?.id) return;
  target.innerHTML = '<p class="text-sm text-slate-400">Cargando historial...</p>';
  try {
    const history = await listMaintenanceHistory(activeSupabase, activeHotelId, task.id);
    if (!history.length) {
      target.innerHTML = '<p class="text-sm text-slate-400">Todavía no hay movimientos registrados para esta tarea.</p>';
      return;
    }
    target.innerHTML = history.map((item) => `
      <div class="relative border-l-2 border-slate-200 pb-4 pl-4 last:pb-0">
        <span class="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-slate-400"></span>
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-black text-slate-800">${escapeHtml(getHistoryTitle(item))}</p>
          <span class="text-[11px] text-slate-400">${escapeHtml(formatDateTime(item.creado_en))}</span>
        </div>
        <p class="mt-0.5 text-xs font-semibold text-slate-500">${escapeHtml(getHistoryActorLabel(item))}</p>
        ${item.comentario ? `<p class="mt-2 rounded-xl bg-slate-50 p-2 text-sm text-slate-700">${escapeHtml(item.comentario)}</p>` : ''}
      </div>`).join('');
  } catch (error) {
    console.error('Error cargando historial de mantenimiento:', error);
    target.innerHTML = '<p class="text-sm font-semibold text-red-600">No fue posible cargar el historial.</p>';
  }
}

function renderModalWorkflowSection(task) {
  const form = activeContainer?.querySelector('#mant-full-form');
  if (!form || form.querySelector('#mant-f3-workflow')) return;

  const stateSelect = form.querySelector('[name="estado"]');
  if (stateSelect) {
    const currentState = normalizeTaskState(task?.estado || TASK_STATES.pendiente);
    stateSelect.innerHTML = `
      <option value="${currentState}">${escapeHtml(getStatusMeta(currentState).text)}</option>`;
    stateSelect.value = currentState;
    stateSelect.disabled = true;
    stateSelect.classList.add('bg-slate-100', 'text-slate-500');
    const hidden = document.createElement('input');
    hidden.type = 'hidden';
    hidden.name = 'estado';
    hidden.value = currentState;
    stateSelect.insertAdjacentElement('afterend', hidden);
  }

  const errorTarget = form.querySelector('#mant-full-error');
  const section = document.createElement('section');
  section.id = 'mant-f3-workflow';
  section.className = 'rounded-2xl border border-slate-200 bg-white p-4';

  const sla = getSlaMeta(task || {});
  const action = task?.id ? getWorkflowAction(task, activeUser?.id) : null;
  const taskState = normalizeTaskState(task?.estado);
  const canAssign = task?.id && [TASK_STATES.enRevision, TASK_STATES.asignado].includes(taskState);
  const canCancel = task?.id && [TASK_STATES.pendiente, TASK_STATES.enRevision, TASK_STATES.asignado, TASK_STATES.enProceso].includes(taskState);

  section.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <p class="text-sm font-black text-slate-900">Flujo y trazabilidad</p>
        <p class="mt-0.5 text-xs text-slate-500">Los cambios de estado quedan registrados con usuario y hora.</p>
      </div>
      ${sla.text ? `<span class="rounded-full px-2.5 py-1 text-[11px] font-bold ${sla.classes}">${escapeHtml(sla.text)}</span>` : ''}
    </div>
    ${task?.id ? `
      <div class="mt-3 flex flex-wrap gap-2">
        ${action ? `<button type="button" id="mant-f3-modal-action" class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-black text-white">${escapeHtml(action.label)}</button>` : ''}
        ${canAssign ? '<button type="button" id="mant-f3-assign" class="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-700">Asignar responsable</button>' : ''}
        ${canCancel ? '<button type="button" id="mant-f3-cancel" class="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-black text-red-700">Cancelar tarea</button>' : ''}
        ${taskState === TASK_STATES.cerrado ? '<button type="button" id="mant-f3-reopen" class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-black text-amber-800">Reabrir</button>' : ''}
      </div>
      <div class="mt-4 border-t border-slate-100 pt-4">
        <form id="mant-f3-comment-form" class="flex gap-2">
          <input id="mant-f3-comment" class="form-control min-h-[44px] flex-1 rounded-xl" maxlength="1000" placeholder="Agregar comentario o novedad...">
          <button class="rounded-xl bg-slate-900 px-4 text-sm font-black text-white">Agregar</button>
        </form>
        <div id="mant-f3-history-list" class="mt-4"></div>
      </div>` : '<p class="mt-3 text-xs text-slate-500">El historial comenzará cuando se cree la tarea.</p>'}`;

  if (errorTarget) form.insertBefore(section, errorTarget);
  else form.appendChild(section);

  if (!task?.id) return;

  section.querySelector('#mant-f3-modal-action')?.addEventListener('click', async () => {
    await runWorkflowAction(task, action);
    activeContainer.querySelector('#mant-full-close')?.click();
  });

  section.querySelector('#mant-f3-reopen')?.addEventListener('click', async () => {
    const updated = await transitionMaintenanceTask(activeSupabase, task.id, TASK_STATES.enProceso, {
      comment: 'Tarea reabierta para nueva intervención.',
      assigneeId: task.asignada_a || activeUser?.id || null
    });
    document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: updated.id, action: 'reopened' } }));
    activeContainer.querySelector('#mant-full-close')?.click();
  });

  section.querySelector('#mant-f3-cancel')?.addEventListener('click', async () => {
    const reason = window.prompt('Motivo de cancelación:');
    if (reason === null) return;
    if (!String(reason).trim()) {
      alert('Escribe el motivo de la cancelación.');
      return;
    }
    const updated = await transitionMaintenanceTask(activeSupabase, task.id, TASK_STATES.cancelado, {
      comment: String(reason).trim()
    });
    document.dispatchEvent(new CustomEvent('maintenanceChanged', { detail: { taskId: updated.id, action: 'cancelado' } }));
    activeContainer.querySelector('#mant-full-close')?.click();
  });

  section.querySelector('#mant-f3-assign')?.addEventListener('click', async () => {
    const assigneeId = form.querySelector('[name="asignada_a"]')?.value || '';
    if (!assigneeId) {
      alert('Selecciona primero un responsable.');
      return;
    }
    await transitionMaintenanceTask(activeSupabase, task.id, TASK_STATES.asignado, {
      comment: 'Responsable asignado.',
      assigneeId
    });
    activeContainer.querySelector('#mant-full-close')?.click();
  });

  section.querySelector('#mant-f3-comment-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = section.querySelector('#mant-f3-comment');
    const comment = String(input?.value || '').trim();
    if (!comment) return;
    const button = event.submitter;
    if (button) button.disabled = true;
    try {
      await addMaintenanceComment(activeSupabase, task.id, comment);
      input.value = '';
      await renderHistory(task);
    } catch (error) {
      alert(error?.message || 'No se pudo agregar el comentario.');
    } finally {
      if (button) button.disabled = false;
    }
  });

  renderHistory(task);
}

async function runWorkflowAction(task, forcedAction = null) {
  const action = forcedAction || getWorkflowAction(task, activeUser?.id);
  if (!action) return null;

  let comment = action.comment || null;
  if (action.nextState === TASK_STATES.cerrado) {
    const closeComment = window.prompt('Comentario de cierre (opcional):', 'Trabajo verificado y cerrado.');
    if (closeComment === null) return null;
    comment = closeComment || action.comment;
  }

  const updated = await transitionMaintenanceTask(activeSupabase, task.id, action.nextState, {
    comment,
    assigneeId: action.claim ? activeUser?.id || null : null
  });

  if (normalizeTaskState(updated.estado) === TASK_STATES.cerrado) {
    await ensureNextPreventive(updated).catch((error) => console.warn('No se pudo programar el siguiente preventivo:', error));
  }

  document.dispatchEvent(new CustomEvent('maintenanceChanged', {
    detail: { taskId: updated.id, action: action.nextState, source: 'fase3-workflow' }
  }));
  return updated;
}

async function interceptTaskClick(event) {
  const button = event.target.closest?.('[data-task-action], #btn-nueva-tarea, #btn-nueva-tarea-mobile');
  if (!button || !activeContainer?.contains(button)) return;

  if (button.id === 'btn-nueva-tarea' || button.id === 'btn-nueva-tarea-mobile') {
    event.preventDefault();
    event.stopImmediatePropagation();
    await showModalTarea(activeContainer, activeSupabase, activeHotelId, activeUser, null);
    return;
  }

  const taskId = button.dataset.taskId;
  const task = getTask(taskId);
  if (!task) return;

  if (button.dataset.taskAction === 'edit') {
    event.preventDefault();
    event.stopImmediatePropagation();
    await showModalTarea(activeContainer, activeSupabase, activeHotelId, activeUser, task);
    return;
  }

  if (['workflow', 'start', 'complete'].includes(button.dataset.taskAction)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Guardando...';
    try {
      await runWorkflowAction(task);
    } catch (error) {
      console.error('Error cambiando estado de mantenimiento:', error);
      alert(error?.message || 'No se pudo cambiar el estado de la tarea.');
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  }
}

function enhanceMaintenanceUi() {
  if (!activeContainer) return;
  enhanceFilters();
  renderWorkflowSummary();
  enhanceCardsAndRows();
}

export async function mount(container, supabase, currentUser, hotelId) {
  activeContainer = container;
  activeSupabase = supabase;
  activeUser = currentUser;
  activeHotelId = hotelId;

  await baseMount(container, supabase, currentUser, hotelId);
  container.addEventListener('click', interceptTaskClick, true);
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(container, { childList: true, subtree: true });
  enhanceMaintenanceUi();
}

export function unmount() {
  if (activeContainer) activeContainer.removeEventListener('click', interceptTaskClick, true);
  observer?.disconnect();
  observer = null;
  clearTimeout(enhanceTimer);
  baseUnmount();
  activeContainer = null;
  activeSupabase = null;
  activeUser = null;
  activeHotelId = null;
}

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  const result = await baseShowModalTarea(container, supabase, hotelId, currentUser, tarea);
  const normalizedTask = tarea?.id ? { ...tarea, estado: normalizeTaskState(tarea.estado) } : null;
  setTimeout(() => renderModalWorkflowSection(normalizedTask), 0);
  return result;
}
