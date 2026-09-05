let activeContainer = null;
let activeSupabase = null;
let activeHotelId = null;
let observer = null;
let enhanceTimer = null;
let enhancing = false;
let rerunRequested = false;
let currentRows = [];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getIncidentTaskId(result) {
  if (Array.isArray(result)) return result[0]?.id || null;
  return result?.id || null;
}

function getVisibleReviewCards() {
  if (!activeContainer) return [];
  return [...activeContainer.querySelectorAll('[data-room-review-id]')];
}

function ensureIncidentSlot(card) {
  let slot = card.querySelector('[data-room-incident-slot]');
  if (slot) return slot;

  slot = document.createElement('div');
  slot.dataset.roomIncidentSlot = '1';
  slot.className = 'mt-3';
  const errorTarget = card.querySelector('[data-room-error]');
  if (errorTarget?.nextElementSibling) {
    card.insertBefore(slot, errorTarget.nextElementSibling);
  } else {
    card.appendChild(slot);
  }
  return slot;
}

function openIncidentTask(taskId) {
  if (!taskId || !activeContainer) return;
  document.dispatchEvent(new CustomEvent('maintenanceChanged', {
    detail: { source: 'maintenance-room-incident-open', incidentTaskId: taskId }
  }));

  activeContainer.querySelector('#mant-full-close')?.click();
  setTimeout(() => {
    const editButton = activeContainer?.querySelector(`[data-task-action="edit"][data-task-id="${taskId}"]`);
    if (editButton) {
      editButton.click();
      return;
    }
    alert('La incidencia está creada. Puedes verla en la lista de Mantenimiento de esta habitación.');
  }, 450);
}

function renderIncidentAction(card, row) {
  const slot = ensureIncidentSlot(card);
  const signature = `${row.estado}|${row.incidencia_tarea_id || ''}`;
  if (slot.dataset.signature === signature) return;
  slot.dataset.signature = signature;

  if (row.incidencia_tarea_id) {
    slot.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
        <div>
          <p class="text-xs font-black text-blue-900">✓ Incidencia vinculada</p>
          <p class="mt-0.5 text-[11px] text-blue-700">La novedad ya tiene una tarea específica de mantenimiento.</p>
        </div>
        <button type="button" data-room-incident-open class="rounded-xl border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-700">Ver tarea</button>
      </div>`;
    slot.querySelector('[data-room-incident-open]')?.addEventListener('click', () => {
      openIncidentTask(row.incidencia_tarea_id);
    });
    return;
  }

  if (row.estado !== 'novedad') {
    slot.innerHTML = '';
    return;
  }

  slot.innerHTML = `
    <div class="rounded-xl border border-red-200 bg-red-50 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-xs font-black text-red-900">Esta novedad necesita seguimiento</p>
          <p class="mt-0.5 text-[11px] text-red-700">Crea una tarea específica para que no se pierda después de cerrar la revisión general.</p>
        </div>
        <button type="button" data-room-incident-create class="rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white">Crear incidencia</button>
      </div>
      <div data-room-incident-error class="mt-2 hidden rounded-lg bg-white px-3 py-2 text-xs font-bold text-red-700"></div>
    </div>`;

  const button = slot.querySelector('[data-room-incident-create]');
  const errorTarget = slot.querySelector('[data-room-incident-error]');
  button?.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Creando...';
    if (errorTarget) errorTarget.classList.add('hidden');

    try {
      const { data, error } = await activeSupabase.rpc('mantenimiento_crear_incidencia_desde_habitacion', {
        p_item_id: row.id
      });
      if (error) throw error;
      const taskId = getIncidentTaskId(data);
      if (!taskId) throw new Error('La incidencia se creó sin devolver el identificador de la tarea.');

      row.incidencia_tarea_id = taskId;
      renderIncidentAction(card, row);
      document.dispatchEvent(new CustomEvent('maintenanceChanged', {
        detail: {
          source: 'maintenance-room-incident-create',
          taskId: row.tarea_id,
          incidentTaskId: taskId,
          roomId: row.habitacion_id
        }
      }));
      scheduleEnhance();
    } catch (error) {
      if (errorTarget) {
        errorTarget.textContent = error?.message || 'No se pudo crear la incidencia.';
        errorTarget.classList.remove('hidden');
      }
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = original;
      }
    }
  });
}

function renderIncidentSummary(rows) {
  const section = activeContainer?.querySelector('#mant-room-checklist-section');
  if (!section) return;

  let target = section.querySelector('[data-room-incident-summary]');
  if (!target) {
    target = document.createElement('div');
    target.dataset.roomIncidentSummary = '1';
    const list = section.querySelector('.mt-4.space-y-3');
    if (list) section.insertBefore(target, list);
    else section.appendChild(target);
  }

  const unresolved = rows.filter((row) => row.estado === 'novedad' && !row.incidencia_tarea_id).length;
  const linked = rows.filter((row) => row.incidencia_tarea_id).length;
  const signature = `${unresolved}|${linked}`;
  if (target.dataset.signature === signature) return;
  target.dataset.signature = signature;

  if (unresolved > 0) {
    target.innerHTML = `<p class="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800">⚠ ${unresolved} novedad${unresolved === 1 ? '' : 'es'} todavía sin incidencia. Crea la tarea de seguimiento antes de cerrar esta revisión general.</p>`;
  } else if (linked > 0) {
    target.innerHTML = `<p class="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-bold text-blue-800">✓ Todas las novedades tienen una incidencia de mantenimiento vinculada.</p>`;
  } else {
    target.innerHTML = '';
  }
}

async function enhanceIncidentActions() {
  if (!activeContainer || !activeSupabase || !activeHotelId) return;
  if (enhancing) {
    rerunRequested = true;
    return;
  }
  enhancing = true;

  try {
    const cards = getVisibleReviewCards();
    if (!cards.length) {
      currentRows = [];
      return;
    }

    const ids = cards.map((card) => card.dataset.roomReviewId).filter(Boolean);
    const { data, error } = await activeSupabase
      .from('mantenimiento_tarea_habitaciones')
      .select('id, hotel_id, tarea_id, habitacion_id, habitacion_nombre_snapshot, estado, observacion, incidencia_tarea_id')
      .eq('hotel_id', activeHotelId)
      .in('id', ids);
    if (error) throw error;

    currentRows = data || [];
    const byId = new Map(currentRows.map((row) => [String(row.id), row]));
    cards.forEach((card) => {
      const row = byId.get(String(card.dataset.roomReviewId));
      if (row) renderIncidentAction(card, row);
    });
    renderIncidentSummary(currentRows);
  } catch (error) {
    console.warn('No se pudieron preparar las incidencias del checklist:', error);
  } finally {
    enhancing = false;
    if (rerunRequested) {
      rerunRequested = false;
      scheduleEnhance();
    }
  }
}

function scheduleEnhance() {
  clearTimeout(enhanceTimer);
  enhanceTimer = setTimeout(() => enhanceIncidentActions(), 35);
}

function interceptCloseWithUnresolvedIncidents(event) {
  const button = event.target.closest?.('#mant-f3-modal-action');
  if (!button || !activeContainer?.contains(button) || !/cerr/i.test(String(button.textContent || ''))) return;

  const unresolved = currentRows.filter((row) => row.estado === 'novedad' && !row.incidencia_tarea_id);
  if (!unresolved.length) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  alert(`Hay ${unresolved.length} novedad${unresolved.length === 1 ? '' : 'es'} sin incidencia. Crea la tarea de seguimiento antes de cerrar la revisión general.`);
}

export function mountMaintenanceIncidentActions(container, supabase, currentUser, hotelId) {
  activeContainer = container;
  activeSupabase = supabase;
  activeHotelId = hotelId;
  currentRows = [];

  container.addEventListener('click', interceptCloseWithUnresolvedIncidents, true);
  observer?.disconnect();
  observer = new MutationObserver(scheduleEnhance);
  observer.observe(container, { childList: true, subtree: true });
  scheduleEnhance();
}

export function unmountMaintenanceIncidentActions() {
  if (activeContainer) activeContainer.removeEventListener('click', interceptCloseWithUnresolvedIncidents, true);
  observer?.disconnect();
  observer = null;
  clearTimeout(enhanceTimer);
  enhanceTimer = null;
  activeContainer = null;
  activeSupabase = null;
  activeHotelId = null;
  currentRows = [];
  enhancing = false;
  rerunRequested = false;
}
