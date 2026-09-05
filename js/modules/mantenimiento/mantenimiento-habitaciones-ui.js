import {
  listMaintenanceTaskRooms,
  updateMaintenanceTaskRoom
} from './mantenimiento-repository.js';

let activeContainer = null;
let activeSupabase = null;
let activeHotelId = null;
let observer = null;
let enhanceTimer = null;
let selectedPlanId = null;
let selectedTaskId = null;
let pendingPlanScope = null;
let currentTaskRows = [];
let currentTaskRowsId = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeChecklist(checklist = []) {
  if (!Array.isArray(checklist)) return [];
  return checklist.map((item, index) => {
    if (typeof item === 'string') {
      return { id: `item_${index + 1}`, texto: item, obligatorio: true, completado: false };
    }
    return {
      ...item,
      id: item?.id || `item_${index + 1}`,
      texto: item?.texto || '',
      obligatorio: item?.obligatorio !== false,
      completado: item?.completado === true
    };
  }).filter((item) => item.texto);
}

function getStatusMeta(status) {
  switch (status) {
    case 'revisada':
      return { label: 'Revisada', badge: 'bg-emerald-100 text-emerald-800', card: 'border-emerald-200 bg-emerald-50/40' };
    case 'novedad':
      return { label: 'Con novedad', badge: 'bg-red-100 text-red-800', card: 'border-red-200 bg-red-50/40' };
    case 'no_aplica':
      return { label: 'No aplica', badge: 'bg-slate-200 text-slate-700', card: 'border-slate-200 bg-slate-50' };
    default:
      return { label: 'Pendiente', badge: 'bg-amber-100 text-amber-800', card: 'border-amber-200 bg-white' };
  }
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => {
    enhancePlanForm().catch((error) => console.warn('No se pudo preparar alcance de mantenimiento:', error));
    enhanceTaskRoomChecklist().catch((error) => console.warn('No se pudo preparar checklist por habitaciones:', error));
    syncCloseGuard();
  }, 20);
}

function handleContainerClick(event) {
  const planTarget = event.target.closest?.('[data-plan-id]');
  if (planTarget?.dataset.planId) {
    selectedPlanId = planTarget.dataset.planId;
  } else if (event.target.closest?.('#mant-calendar-new, [data-calendar-date]')) {
    selectedPlanId = null;
  }

  const taskTarget = event.target.closest?.('[data-task-id]');
  if (taskTarget?.dataset.taskId) {
    selectedTaskId = taskTarget.dataset.taskId;
    currentTaskRowsId = null;
    currentTaskRows = [];
  } else if (event.target.closest?.('#btn-nueva-tarea, #btn-nueva-tarea-mobile')) {
    selectedTaskId = null;
    currentTaskRowsId = null;
    currentTaskRows = [];
  }
}

async function getSelectedPlan() {
  if (!selectedPlanId || !activeSupabase || !activeHotelId) return null;
  const { data, error } = await activeSupabase
    .from('mantenimiento_planes')
    .select('id, alcance, habitacion_id')
    .eq('hotel_id', activeHotelId)
    .eq('id', selectedPlanId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function showPlanFormError(form, message) {
  const target = form?.querySelector('#mant-plan-error');
  if (!target) return;
  target.textContent = message;
  target.classList.remove('hidden');
}

async function enhancePlanForm() {
  const form = activeContainer?.querySelector('#mant-plan-form');
  if (!form || form.dataset.roomScopeEnhanced === '1') return;
  form.dataset.roomScopeEnhanced = '1';

  const roomSelect = form.querySelector('select[name="habitacion_id"]');
  if (!roomSelect) return;

  const roomField = roomSelect.closest('div');
  if (!roomField?.parentElement) return;

  let plan = null;
  try {
    plan = await getSelectedPlan();
  } catch (error) {
    console.warn('No se pudo leer alcance actual del plan:', error);
  }

  const roomCount = Math.max(0, roomSelect.options.length - 1);
  const inferredScope = plan?.alcance
    || (plan?.habitacion_id || roomSelect.value ? 'habitacion' : 'general');

  const scopeField = document.createElement('div');
  scopeField.dataset.roomScopeField = '1';
  scopeField.innerHTML = `
    <label class="mb-1 block text-sm font-bold">Alcance</label>
    <select name="alcance_visual" class="form-control w-full rounded-xl">
      <option value="general">Área general</option>
      <option value="habitacion">Una habitación</option>
      <option value="todas_habitaciones">Todas las habitaciones</option>
    </select>
    <p data-room-scope-help class="mt-1 text-[11px] text-slate-500"></p>`;
  roomField.parentElement.insertBefore(scopeField, roomField);

  const scopeSelect = scopeField.querySelector('select[name="alcance_visual"]');
  const help = scopeField.querySelector('[data-room-scope-help]');
  scopeSelect.value = inferredScope;

  const syncScope = () => {
    const scope = scopeSelect.value;
    if (scope === 'habitacion') {
      roomSelect.disabled = false;
      roomField.classList.remove('opacity-60');
      if (help) help.textContent = 'Selecciona la habitación que recibirá esta tarea.';
    } else {
      roomSelect.value = '';
      roomSelect.disabled = true;
      roomField.classList.add('opacity-60');
      if (help) {
        help.textContent = scope === 'todas_habitaciones'
          ? `Se creará un control individual para las ${roomCount} habitaciones activas del hotel.`
          : 'La tarea pertenece a una zona o equipo general del hotel.';
      }
    }

    const checklistLabel = form.querySelector('textarea[name="checklist"]')?.previousElementSibling;
    if (checklistLabel) {
      checklistLabel.innerHTML = scope === 'todas_habitaciones'
        ? 'Checklist por habitación <span class="font-normal text-slate-400">(se repetirá en cada habitación)</span>'
        : 'Checklist <span class="font-normal text-slate-400">(una revisión por línea)</span>';
    }
  };

  scopeSelect.addEventListener('change', syncScope);
  roomSelect.addEventListener('change', () => {
    if (roomSelect.value && scopeSelect.value !== 'todas_habitaciones') {
      scopeSelect.value = 'habitacion';
      syncScope();
    }
  });
  syncScope();

  form.addEventListener('submit', (event) => {
    const scope = scopeSelect.value;
    if (scope === 'habitacion' && !roomSelect.value) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showPlanFormError(form, 'Selecciona la habitación para esta programación.');
      return;
    }
    if (scope === 'todas_habitaciones' && roomCount === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showPlanFormError(form, 'No hay habitaciones activas para crear el checklist general.');
      return;
    }

    pendingPlanScope = {
      alcance: scope,
      habitacionId: scope === 'habitacion' ? roomSelect.value : null
    };
  }, true);
}

async function syncSavedPlanScope(planId) {
  if (!planId || !pendingPlanScope || !activeSupabase || !activeHotelId) return;
  const pending = pendingPlanScope;
  pendingPlanScope = null;

  const { error } = await activeSupabase
    .from('mantenimiento_planes')
    .update({
      alcance: pending.alcance,
      habitacion_id: pending.alcance === 'habitacion' ? pending.habitacionId : null
    })
    .eq('hotel_id', activeHotelId)
    .eq('id', planId);

  if (error) {
    console.error('No se pudo guardar el alcance del plan:', error);
    alert('La programación se guardó, pero no fue posible guardar el alcance por habitaciones. Intenta editarla nuevamente.');
    return;
  }

  document.dispatchEvent(new CustomEvent('maintenanceChanged', {
    detail: { source: 'maintenance-room-scope-sync', planId }
  }));
}

function renderRoomChecklistSection(form, rows) {
  let section = form.querySelector('#mant-room-checklist-section');
  if (!section) {
    section = document.createElement('section');
    section.id = 'mant-room-checklist-section';
    section.className = 'rounded-2xl border border-indigo-200 bg-indigo-50/30 p-4';
    const workflow = form.querySelector('#mant-f3-workflow');
    const errorTarget = form.querySelector('#mant-full-error');
    if (workflow) form.insertBefore(section, workflow);
    else if (errorTarget) form.insertBefore(section, errorTarget);
    else form.appendChild(section);
  }

  const total = rows.length;
  const pending = rows.filter((item) => item.estado === 'pendiente').length;
  const reviewed = rows.filter((item) => item.estado === 'revisada').length;
  const issues = rows.filter((item) => item.estado === 'novedad').length;
  const na = rows.filter((item) => item.estado === 'no_aplica').length;
  const completed = total - pending;
  const pct = total ? Math.round((completed / total) * 100) : 0;

  section.innerHTML = `
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-base font-black text-slate-900">Checklist por habitaciones</p>
        <p class="mt-1 text-xs text-slate-500">Cada habitación debe quedar revisada, con novedad o marcada como no aplica.</p>
      </div>
      <span class="rounded-full ${pending ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'} px-3 py-1 text-xs font-black">${completed}/${total} listas</span>
    </div>

    <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-200"><div class="h-full rounded-full bg-emerald-500 transition-all" style="width:${pct}%"></div></div>
    <div class="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
      <span class="rounded-full bg-amber-100 px-2.5 py-1 text-amber-800">${pending} pendientes</span>
      <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">${reviewed} revisadas</span>
      ${issues ? `<span class="rounded-full bg-red-100 px-2.5 py-1 text-red-800">${issues} con novedad</span>` : ''}
      ${na ? `<span class="rounded-full bg-slate-200 px-2.5 py-1 text-slate-700">${na} no aplica</span>` : ''}
    </div>

    ${pending === 0
      ? '<p class="mt-3 rounded-xl bg-emerald-100 p-3 text-sm font-bold text-emerald-800">✓ Todas las habitaciones ya fueron revisadas. La tarea puede continuar al cierre.</p>'
      : `<p class="mt-3 rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-800">Faltan ${pending} habitación${pending === 1 ? '' : 'es'}. El sistema no permitirá cerrar la tarea mientras queden pendientes.</p>`}

    <div class="mt-4 space-y-3">
      ${rows.map((row) => {
        const meta = getStatusMeta(row.estado);
        const checklist = normalizeChecklist(row.checklist);
        return `
          <article data-room-review-id="${row.id}" class="rounded-2xl border p-3 ${meta.card}">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-sm font-black text-slate-800 shadow-sm">${escapeHtml(row.habitacion_nombre_snapshot)}</span>
                <div><p class="text-sm font-black text-slate-900">Habitación ${escapeHtml(row.habitacion_nombre_snapshot)}</p><span class="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-black ${meta.badge}">${meta.label}</span></div>
              </div>
              <select data-room-status class="form-control min-h-[40px] rounded-xl text-sm font-bold">
                <option value="pendiente" ${row.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                <option value="revisada" ${row.estado === 'revisada' ? 'selected' : ''}>Revisada</option>
                <option value="novedad" ${row.estado === 'novedad' ? 'selected' : ''}>Con novedad</option>
                <option value="no_aplica" ${row.estado === 'no_aplica' ? 'selected' : ''}>No aplica</option>
              </select>
            </div>

            ${checklist.length ? `<div class="mt-3 grid gap-2 sm:grid-cols-2">${checklist.map((item, index) => `
              <label class="flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
                <input type="checkbox" data-room-check-index="${index}" ${item.completado ? 'checked' : ''}>
                <span>${escapeHtml(item.texto)}${item.obligatorio ? ' <span class="text-red-500">*</span>' : ''}</span>
              </label>`).join('')}</div>` : '<p class="mt-3 text-xs text-slate-500">Esta programación no tiene puntos de checklist adicionales.</p>'}

            <label class="mt-3 block text-xs font-bold text-slate-600">Observación</label>
            <textarea data-room-observation class="form-control mt-1 min-h-[68px] w-full rounded-xl text-sm" placeholder="Ej. filtro muy sucio, aire no enfría, requiere repuesto...">${escapeHtml(row.observacion || '')}</textarea>
            <div data-room-error class="mt-2 hidden rounded-lg bg-red-100 px-3 py-2 text-xs font-bold text-red-700"></div>
            <div class="mt-3 flex justify-end"><button type="button" data-room-save class="rounded-xl bg-slate-900 px-4 py-2 text-sm font-black text-white">Guardar habitación</button></div>
          </article>`;
      }).join('')}
    </div>`;

  rows.forEach((row) => {
    const card = section.querySelector(`[data-room-review-id="${row.id}"]`);
    if (!card) return;
    const save = card.querySelector('[data-room-save]');
    save?.addEventListener('click', async () => {
      const status = card.querySelector('[data-room-status]')?.value || 'pendiente';
      const observation = String(card.querySelector('[data-room-observation]')?.value || '').trim();
      const baseChecklist = normalizeChecklist(row.checklist);
      const checklist = baseChecklist.map((item, index) => ({
        ...item,
        completado: card.querySelector(`[data-room-check-index="${index}"]`)?.checked === true
      }));
      const errorTarget = card.querySelector('[data-room-error]');

      if (status === 'revisada' && checklist.some((item) => item.obligatorio && !item.completado)) {
        if (errorTarget) {
          errorTarget.textContent = 'Completa todos los puntos obligatorios antes de marcar la habitación como revisada.';
          errorTarget.classList.remove('hidden');
        }
        return;
      }
      if (status === 'novedad' && !observation) {
        if (errorTarget) {
          errorTarget.textContent = 'Describe la novedad encontrada en esta habitación.';
          errorTarget.classList.remove('hidden');
        }
        return;
      }

      if (errorTarget) errorTarget.classList.add('hidden');
      if (save) { save.disabled = true; save.textContent = 'Guardando...'; }
      try {
        await updateMaintenanceTaskRoom(activeSupabase, row.id, {
          estado: status,
          checklist,
          observacion: observation || null
        });
        await refreshTaskRoomChecklist(row.tarea_id, true);
        document.dispatchEvent(new CustomEvent('maintenanceChanged', {
          detail: { source: 'maintenance-room-review', taskId: row.tarea_id, roomId: row.habitacion_id }
        }));
      } catch (error) {
        if (errorTarget) {
          errorTarget.textContent = error?.message || 'No se pudo guardar la revisión de la habitación.';
          errorTarget.classList.remove('hidden');
        }
        if (save) { save.disabled = false; save.textContent = 'Guardar habitación'; }
      }
    });
  });
}

async function refreshTaskRoomChecklist(taskId, force = false) {
  if (!taskId || !activeSupabase || !activeHotelId) return [];
  if (!force && currentTaskRowsId === taskId && currentTaskRows.length) return currentTaskRows;

  const rows = await listMaintenanceTaskRooms(activeSupabase, activeHotelId, taskId);
  currentTaskRows = rows;
  currentTaskRowsId = taskId;

  const form = activeContainer?.querySelector('#mant-full-form');
  if (form && rows.length) renderRoomChecklistSection(form, rows);
  syncCloseGuard();
  return rows;
}

async function enhanceTaskRoomChecklist() {
  const form = activeContainer?.querySelector('#mant-full-form');
  if (!form || !selectedTaskId) return;

  if (form.dataset.roomChecklistTaskId === String(selectedTaskId)) {
    syncCloseGuard();
    return;
  }
  form.dataset.roomChecklistTaskId = String(selectedTaskId);

  try {
    const rows = await refreshTaskRoomChecklist(selectedTaskId, true);
    if (!rows.length) {
      form.querySelector('#mant-room-checklist-section')?.remove();
    }
  } catch (error) {
    console.warn('No se pudo cargar revisión por habitaciones:', error);
  }
}

function syncCloseGuard() {
  const form = activeContainer?.querySelector('#mant-full-form');
  if (!form || !selectedTaskId || String(currentTaskRowsId) !== String(selectedTaskId) || !currentTaskRows.length) return;
  const pending = currentTaskRows.filter((item) => item.estado === 'pendiente').length;
  const button = form.querySelector('#mant-f3-modal-action');
  if (!button || !/cerr/i.test(String(button.textContent || ''))) return;

  if (pending > 0) {
    button.dataset.roomChecklistGuard = '1';
    button.disabled = true;
    button.title = `Faltan ${pending} habitaciones por revisar.`;
    button.classList.add('opacity-50', 'cursor-not-allowed');
  } else if (button.dataset.roomChecklistGuard === '1') {
    delete button.dataset.roomChecklistGuard;
    button.disabled = false;
    button.title = '';
    button.classList.remove('opacity-50', 'cursor-not-allowed');
  }
}

function handleMaintenanceChanged(event) {
  const detail = event?.detail || {};
  if (detail.source === 'maintenance-calendar-plan-save' && detail.planId && pendingPlanScope) {
    syncSavedPlanScope(detail.planId).catch((error) => console.error('Error sincronizando alcance:', error));
    return;
  }

  if (detail.taskId && selectedTaskId && String(detail.taskId) === String(selectedTaskId)
      && detail.source !== 'maintenance-room-review') {
    refreshTaskRoomChecklist(selectedTaskId, true).catch(() => {});
  }
}

export function mountMaintenanceRoomChecklists(container, supabase, currentUser, hotelId) {
  activeContainer = container;
  activeSupabase = supabase;
  activeHotelId = hotelId;
  selectedPlanId = null;
  selectedTaskId = null;
  pendingPlanScope = null;
  currentTaskRows = [];
  currentTaskRowsId = null;

  container.addEventListener('click', handleContainerClick, true);
  document.addEventListener('maintenanceChanged', handleMaintenanceChanged);

  observer?.disconnect();
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(container, { childList: true, subtree: true });
  scheduleEnhance();
}

export function unmountMaintenanceRoomChecklists() {
  if (activeContainer) activeContainer.removeEventListener('click', handleContainerClick, true);
  document.removeEventListener('maintenanceChanged', handleMaintenanceChanged);
  observer?.disconnect();
  observer = null;
  clearTimeout(enhanceTimer);
  enhanceTimer = null;
  activeContainer = null;
  activeSupabase = null;
  activeHotelId = null;
  selectedPlanId = null;
  selectedTaskId = null;
  pendingPlanScope = null;
  currentTaskRows = [];
  currentTaskRowsId = null;
}
