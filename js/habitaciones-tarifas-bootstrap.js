import { supabase } from './supabaseClient.js';
import { formatCurrency } from './uiUtils.js';

const WEEKDAYS = [
  { value: 1, label: 'Lun' },
  { value: 2, label: 'Mar' },
  { value: 3, label: 'Mié' },
  { value: 4, label: 'Jue' },
  { value: 5, label: 'Vie' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' }
];

let mountedForContainer = null;
let activeHotelId = null;
let activeUserId = null;
let rooms = [];
let tariffs = [];

async function getSessionContext() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) throw userError || new Error('Usuario no identificado.');
  const userId = userData.user.id;
  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('hotel_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile?.hotel_id) throw profileError || new Error('Hotel no identificado.');
  return { userId, hotelId: profile.hotel_id };
}

function renameMenuLabel() {
  const nav = document.getElementById('main-nav');
  if (!nav) return;
  nav.querySelectorAll('a, button').forEach((element) => {
    const text = String(element.textContent || '').trim();
    if (text === 'Habitaciones') {
      const textNode = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim() === 'Habitaciones');
      if (textNode) textNode.textContent = ' Habitaciones y tarifas';
      else element.textContent = 'Habitaciones y tarifas';
    }
  });
}

function getTariffSectionAnchor() {
  const roomList = document.getElementById('habitaciones-lista-container');
  if (!roomList) return null;
  return roomList.closest('section, .card, div')?.parentElement || roomList.parentElement;
}

function renderWeekdayChecks(selected = []) {
  const selectedSet = new Set((selected || []).map(Number));
  return WEEKDAYS.map((day) => `
    <label class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" name="dias_semana" value="${day.value}" ${selectedSet.has(day.value) ? 'checked' : ''}>
      <span>${day.label}</span>
    </label>
  `).join('');
}

function formatDays(days) {
  if (!Array.isArray(days) || days.length === 0) return 'Todos los días';
  const labels = new Map(WEEKDAYS.map((day) => [day.value, day.label]));
  return WEEKDAYS.filter((day) => days.map(Number).includes(day.value)).map((day) => labels.get(day.value)).join(', ');
}

function normalizeRoomIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function roomScopeMode(tariff) {
  if (tariff?.habitacion_id || normalizeRoomIds(tariff?.habitaciones_aplicables).length > 0) return 'seleccionadas';
  if (normalizeRoomIds(tariff?.habitaciones_excluidas).length > 0) return 'excepto';
  return 'todas';
}

function roomScopeIds(tariff) {
  if (tariff?.habitacion_id) return [String(tariff.habitacion_id)];
  if (roomScopeMode(tariff) === 'seleccionadas') return normalizeRoomIds(tariff?.habitaciones_aplicables);
  if (roomScopeMode(tariff) === 'excepto') return normalizeRoomIds(tariff?.habitaciones_excluidas);
  return [];
}

function roomScopeSummary(tariff, roomNames) {
  const mode = roomScopeMode(tariff);
  const ids = roomScopeIds(tariff);
  if (mode === 'todas') return 'Todas las habitaciones';

  const labels = ids.map((id) => roomNames.get(String(id)) || 'Habitación').filter(Boolean);
  const compact = labels.length <= 3 ? labels.join(', ') : `${labels.slice(0, 2).join(', ')} y ${labels.length - 2} más`;
  return mode === 'excepto' ? `Todas excepto: ${compact}` : `Solo: ${compact}`;
}

function renderRoomChecks(selected = []) {
  const selectedSet = new Set(normalizeRoomIds(selected));
  if (!rooms.length) {
    return '<p class="text-sm text-slate-500">No hay habitaciones activas para seleccionar.</p>';
  }
  return rooms.map((room) => `
    <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
      <input type="checkbox" name="habitaciones_scope" value="${room.id}" ${selectedSet.has(String(room.id)) ? 'checked' : ''}>
      <span>${room.nombre}</span>
    </label>
  `).join('');
}

function selectedRoomScopeIds(form) {
  return [...form.querySelectorAll('[name="habitaciones_scope"]:checked')].map((input) => String(input.value));
}

function updateRoomScopeUI(section) {
  const form = section.querySelector('#tarifa-programada-form');
  const container = section.querySelector('#tarifa-room-scope-container');
  const label = section.querySelector('#tarifa-room-scope-label');
  const hint = section.querySelector('#tarifa-room-scope-hint');
  if (!form || !container || !label || !hint) return;

  const mode = form.elements.aplicacion_habitaciones.value || 'todas';
  container.classList.toggle('hidden', mode === 'todas');
  if (mode === 'seleccionadas') {
    label.textContent = 'Habitaciones incluidas';
    hint.textContent = 'La tarifa solo se aplicará a las habitaciones marcadas.';
  } else if (mode === 'excepto') {
    label.textContent = 'Habitaciones excluidas';
    hint.textContent = 'La tarifa se aplicará a todas las habitaciones menos las marcadas.';
  }
}

function priceSummary(tariff) {
  if (tariff.precio_final !== null && tariff.precio_final !== undefined) {
    return `Precio final ${formatCurrency(Number(tariff.precio_final) || 0)}`;
  }
  const parts = [];
  if (tariff.precio_1_persona !== null && tariff.precio_1_persona !== undefined) parts.push(`1 persona ${formatCurrency(Number(tariff.precio_1_persona) || 0)}`);
  if (tariff.precio_2_personas !== null && tariff.precio_2_personas !== undefined) parts.push(`2 personas ${formatCurrency(Number(tariff.precio_2_personas) || 0)}`);
  if (tariff.precio_huesped_adicional !== null && tariff.precio_huesped_adicional !== undefined) parts.push(`Adicional ${formatCurrency(Number(tariff.precio_huesped_adicional) || 0)}`);
  return parts.join(' · ') || 'Sin precio';
}

function renderTariffList(section) {
  const list = section.querySelector('#tarifas-programadas-list');
  if (!list) return;

  if (!tariffs.length) {
    list.innerHTML = `
      <div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-5 py-6 text-sm text-slate-500">
        No hay tarifas programadas. El sistema seguirá usando exactamente los precios base configurados en cada habitación.
      </div>`;
    return;
  }

  const roomNames = new Map(rooms.map((room) => [String(room.id), room.nombre]));
  list.innerHTML = tariffs.map((tariff) => `
    <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-tariff-id="${tariff.id}">
      <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="text-lg font-bold text-slate-900">${tariff.nombre}</h4>
            <span class="rounded-full px-2.5 py-1 text-xs font-semibold ${tariff.activo ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}">${tariff.activo ? 'Activa' : 'Inactiva'}</span>
          </div>
          <p class="mt-1 text-sm text-slate-600">${roomScopeSummary(tariff, roomNames)} · ${formatDays(tariff.dias_semana)}</p>
          <p class="mt-1 font-semibold text-indigo-700">${priceSummary(tariff)}</p>
          <p class="mt-1 text-xs text-slate-500">${tariff.fecha_inicio || tariff.fecha_fin ? `Vigencia: ${tariff.fecha_inicio || 'sin inicio'} → ${tariff.fecha_fin || 'sin fin'}` : 'Vigencia permanente'} · Prioridad ${Number(tariff.prioridad) || 0}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="button button-outline button-small" data-action="edit" data-id="${tariff.id}">Editar</button>
          <button type="button" class="button button-small ${tariff.activo ? 'button-warning' : 'button-success'}" data-action="toggle" data-id="${tariff.id}">${tariff.activo ? 'Desactivar' : 'Activar'}</button>
          <button type="button" class="button button-danger button-small" data-action="delete" data-id="${tariff.id}">Eliminar</button>
        </div>
      </div>
    </article>
  `).join('');
}

function resetForm(section) {
  const form = section.querySelector('#tarifa-programada-form');
  if (!form) return;
  form.reset();
  form.elements.tarifa_id.value = '';
  form.elements.prioridad.value = '10';
  form.elements.activo.checked = true;
  form.elements.aplicacion_habitaciones.value = 'todas';
  form.querySelector('#tarifa-form-title').textContent = 'Nueva tarifa programada';
  form.querySelector('#tarifa-submit').textContent = 'Guardar tarifa';
  form.querySelector('#tarifa-cancel').classList.add('hidden');
  form.querySelectorAll('[name="dias_semana"], [name="habitaciones_scope"]').forEach((input) => { input.checked = false; });
  updateRoomScopeUI(section);
}

function fillForm(section, tariff) {
  const form = section.querySelector('#tarifa-programada-form');
  if (!form || !tariff) return;
  form.elements.tarifa_id.value = tariff.id;
  form.elements.nombre.value = tariff.nombre || '';
  form.elements.aplicacion_habitaciones.value = roomScopeMode(tariff);
  form.elements.fecha_inicio.value = tariff.fecha_inicio || '';
  form.elements.fecha_fin.value = tariff.fecha_fin || '';
  form.elements.precio_final.value = tariff.precio_final ?? '';
  form.elements.precio_1_persona.value = tariff.precio_1_persona ?? '';
  form.elements.precio_2_personas.value = tariff.precio_2_personas ?? '';
  form.elements.precio_huesped_adicional.value = tariff.precio_huesped_adicional ?? '';
  form.elements.prioridad.value = String(Number(tariff.prioridad) || 0);
  form.elements.activo.checked = tariff.activo !== false;

  const days = new Set((tariff.dias_semana || []).map(Number));
  form.querySelectorAll('[name="dias_semana"]').forEach((input) => { input.checked = days.has(Number(input.value)); });

  const selectedRooms = new Set(roomScopeIds(tariff));
  form.querySelectorAll('[name="habitaciones_scope"]').forEach((input) => { input.checked = selectedRooms.has(String(input.value)); });
  updateRoomScopeUI(section);

  form.querySelector('#tarifa-form-title').textContent = 'Editar tarifa programada';
  form.querySelector('#tarifa-submit').textContent = 'Actualizar tarifa';
  form.querySelector('#tarifa-cancel').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reloadData(section) {
  const form = section.querySelector('#tarifa-programada-form');
  const previousSelection = form ? selectedRoomScopeIds(form) : [];
  const [roomResult, tariffResult] = await Promise.all([
    supabase.from('habitaciones').select('id, nombre').eq('hotel_id', activeHotelId).eq('activo', true).order('nombre'),
    supabase.from('tarifas_programadas_habitacion').select('*').eq('hotel_id', activeHotelId).eq('modalidad', 'noche').order('prioridad', { ascending: false }).order('creado_en', { ascending: false })
  ]);
  if (roomResult.error) throw roomResult.error;
  if (tariffResult.error) throw tariffResult.error;
  rooms = roomResult.data || [];
  tariffs = tariffResult.data || [];

  const roomGrid = section.querySelector('#tarifa-room-scope-grid');
  if (roomGrid) roomGrid.innerHTML = renderRoomChecks(previousSelection);
  renderTariffList(section);
}

function showFeedback(section, message, type = 'success') {
  const feedback = section.querySelector('#tarifas-programadas-feedback');
  if (!feedback) return;
  feedback.textContent = message;
  feedback.className = `rounded-xl border px-4 py-3 text-sm ${type === 'error' ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`;
  feedback.classList.remove('hidden');
  window.setTimeout(() => feedback.classList.add('hidden'), 4500);
}

function nullableMoney(form, name) {
  const raw = String(form.elements[name]?.value || '').trim();
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function handleSubmit(event, section) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('#tarifa-submit');
  submit.disabled = true;

  try {
    const days = [...form.querySelectorAll('[name="dias_semana"]:checked')].map((input) => Number(input.value));
    const scopeMode = String(form.elements.aplicacion_habitaciones.value || 'todas');
    const scopeRooms = selectedRoomScopeIds(form);
    const payload = {
      hotel_id: activeHotelId,
      habitacion_id: null,
      habitaciones_aplicables: scopeMode === 'seleccionadas' ? scopeRooms : [],
      habitaciones_excluidas: scopeMode === 'excepto' ? scopeRooms : [],
      tiempo_estancia_id: null,
      nombre: String(form.elements.nombre.value || '').trim(),
      modalidad: 'noche',
      dias_semana: days,
      fecha_inicio: form.elements.fecha_inicio.value || null,
      fecha_fin: form.elements.fecha_fin.value || null,
      precio_final: nullableMoney(form, 'precio_final'),
      precio_1_persona: nullableMoney(form, 'precio_1_persona'),
      precio_2_personas: nullableMoney(form, 'precio_2_personas'),
      precio_huesped_adicional: nullableMoney(form, 'precio_huesped_adicional'),
      prioridad: Number(form.elements.prioridad.value) || 0,
      activo: form.elements.activo.checked,
      creada_por: activeUserId
    };

    if (!payload.nombre) throw new Error('Escribe un nombre para la tarifa.');
    if (scopeMode !== 'todas' && scopeRooms.length === 0) throw new Error('Selecciona al menos una habitación para este alcance.');
    if ([payload.precio_final, payload.precio_1_persona, payload.precio_2_personas].every((value) => value === null)) {
      throw new Error('Define un precio final o al menos un precio para 1 o 2 personas.');
    }
    if ([payload.precio_final, payload.precio_1_persona, payload.precio_2_personas, payload.precio_huesped_adicional].some((value) => value !== null && value < 0)) {
      throw new Error('Los precios no pueden ser negativos.');
    }
    if (payload.fecha_inicio && payload.fecha_fin && payload.fecha_fin < payload.fecha_inicio) {
      throw new Error('La fecha final no puede ser anterior a la inicial.');
    }

    const id = form.elements.tarifa_id.value;
    let result;
    if (id) {
      const updatePayload = { ...payload };
      delete updatePayload.creada_por;
      result = await supabase.from('tarifas_programadas_habitacion').update({ ...updatePayload, actualizado_en: new Date().toISOString() }).eq('id', id).eq('hotel_id', activeHotelId);
    } else {
      result = await supabase.from('tarifas_programadas_habitacion').insert(payload);
    }
    if (result.error) throw result.error;

    showFeedback(section, id ? 'Tarifa actualizada correctamente.' : 'Tarifa creada correctamente.');
    resetForm(section);
    await reloadData(section);
    document.dispatchEvent(new CustomEvent('datosActualizados', { detail: { origen: 'tarifas_programadas', accion: id ? 'update' : 'create' } }));
  } catch (error) {
    showFeedback(section, error.message || 'No se pudo guardar la tarifa.', 'error');
  } finally {
    submit.disabled = false;
  }
}

async function handleListAction(event, section) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const tariff = tariffs.find((item) => String(item.id) === String(button.dataset.id));
  if (!tariff) return;

  try {
    if (button.dataset.action === 'edit') {
      fillForm(section, tariff);
      return;
    }

    if (button.dataset.action === 'toggle') {
      const { error } = await supabase
        .from('tarifas_programadas_habitacion')
        .update({ activo: !tariff.activo, actualizado_en: new Date().toISOString() })
        .eq('id', tariff.id)
        .eq('hotel_id', activeHotelId);
      if (error) throw error;
      await reloadData(section);
      return;
    }

    if (button.dataset.action === 'delete') {
      const confirmed = window.confirm(`¿Eliminar la tarifa "${tariff.nombre}"?`);
      if (!confirmed) return;
      const { error } = await supabase
        .from('tarifas_programadas_habitacion')
        .delete()
        .eq('id', tariff.id)
        .eq('hotel_id', activeHotelId);
      if (error) throw error;
      resetForm(section);
      await reloadData(section);
      showFeedback(section, 'Tarifa eliminada correctamente.');
    }
  } catch (error) {
    showFeedback(section, error.message || 'No se pudo completar la acción.', 'error');
  }
}

async function mountTariffs() {
  renameMenuLabel();
  const roomList = document.getElementById('habitaciones-lista-container');
  if (!roomList || mountedForContainer === roomList) return;

  const existing = document.getElementById('habitaciones-tarifas-programadas');
  if (existing) existing.remove();

  try {
    const context = await getSessionContext();
    activeHotelId = context.hotelId;
    activeUserId = context.userId;
  } catch (error) {
    console.warn('[HabitacionesTarifas] No se pudo identificar el hotel:', error);
    return;
  }

  const section = document.createElement('section');
  section.id = 'habitaciones-tarifas-programadas';
  section.className = 'mt-10 space-y-6 rounded-[28px] border border-indigo-100 bg-gradient-to-b from-white to-indigo-50/40 p-5 md:p-7 shadow-sm';
  section.innerHTML = `
    <div>
      <p class="text-xs font-bold uppercase tracking-[0.2em] text-indigo-500">Tarifas programadas</p>
      <h2 class="mt-1 text-2xl font-extrabold text-slate-900">Precios por día y temporada</h2>
      <p class="mt-2 max-w-3xl text-sm text-slate-600">Los precios base de cada habitación no se modifican. Si una fecha no tiene tarifa programada, el sistema usa automáticamente el precio configurado arriba en Habitaciones.</p>
    </div>

    <div id="tarifas-programadas-feedback" class="hidden"></div>

    <form id="tarifa-programada-form" class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-5">
      <input type="hidden" name="tarifa_id">
      <div class="flex items-center justify-between gap-3">
        <h3 id="tarifa-form-title" class="text-lg font-bold text-slate-800">Nueva tarifa programada</h3>
        <label class="inline-flex items-center gap-2 text-sm font-semibold text-slate-600"><input type="checkbox" name="activo" checked> Activa</label>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="form-label">Nombre*</label><input class="form-control" name="nombre" required placeholder="Ej. Amanecida lunes a viernes"></div>
        <div>
          <label class="form-label">Aplicar a</label>
          <select class="form-control" name="aplicacion_habitaciones">
            <option value="todas">Todas las habitaciones</option>
            <option value="seleccionadas">Solo habitaciones seleccionadas</option>
            <option value="excepto">Todas excepto habitaciones seleccionadas</option>
          </select>
        </div>
      </div>

      <div id="tarifa-room-scope-container" class="hidden rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p id="tarifa-room-scope-label" class="text-sm font-bold text-slate-800">Habitaciones incluidas</p>
            <p id="tarifa-room-scope-hint" class="text-xs text-slate-500">La tarifa solo se aplicará a las habitaciones marcadas.</p>
          </div>
          <div class="flex gap-2">
            <button type="button" class="button button-outline button-small" data-room-scope-action="all">Marcar todas</button>
            <button type="button" class="button button-neutral button-small" data-room-scope-action="clear">Limpiar</button>
          </div>
        </div>
        <div id="tarifa-room-scope-grid" class="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"></div>
      </div>

      <div>
        <label class="form-label">Días de la semana</label>
        <div class="flex flex-wrap gap-2">${renderWeekdayChecks()}</div>
        <p class="mt-1 text-xs text-slate-500">Si no marcas ningún día, aplica todos los días dentro de la vigencia.</p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div><label class="form-label">Válida desde</label><input class="form-control" type="date" name="fecha_inicio"></div>
        <div><label class="form-label">Válida hasta</label><input class="form-control" type="date" name="fecha_fin"></div>
      </div>

      <fieldset class="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4">
        <legend class="px-2 text-sm font-bold text-indigo-800">Precio de hospedaje</legend>
        <p class="mb-3 text-xs text-slate-600">Usa “Precio final” si la tarifa vale lo mismo sin importar 1 o 2 personas. Si no, llena los precios por ocupación.</p>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div><label class="form-label text-sm">Precio final</label><input class="form-control" type="number" min="0" step="any" name="precio_final" placeholder="70000"></div>
          <div><label class="form-label text-sm">1 persona</label><input class="form-control" type="number" min="0" step="any" name="precio_1_persona"></div>
          <div><label class="form-label text-sm">2 personas</label><input class="form-control" type="number" min="0" step="any" name="precio_2_personas"></div>
          <div><label class="form-label text-sm">Huésped adicional</label><input class="form-control" type="number" min="0" step="any" name="precio_huesped_adicional"></div>
        </div>
      </fieldset>

      <div class="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4 items-end">
        <div><label class="form-label">Prioridad</label><input class="form-control" type="number" name="prioridad" value="10"><p class="mt-1 text-xs text-slate-500">Una cifra mayor gana si dos tarifas coinciden.</p></div>
        <div class="flex flex-wrap justify-end gap-2">
          <button id="tarifa-cancel" type="button" class="button button-neutral hidden">Cancelar edición</button>
          <button id="tarifa-submit" type="submit" class="button button-primary">Guardar tarifa</button>
        </div>
      </div>
    </form>

    <div>
      <h3 class="mb-3 text-lg font-bold text-slate-800">Tarifas configuradas</h3>
      <div id="tarifas-programadas-list" class="space-y-3"></div>
    </div>
  `;

  const anchor = getTariffSectionAnchor();
  (anchor || roomList.parentElement).appendChild(section);
  mountedForContainer = roomList;

  section.querySelector('#tarifa-programada-form').addEventListener('submit', (event) => handleSubmit(event, section));
  section.querySelector('#tarifa-cancel').addEventListener('click', () => resetForm(section));
  section.querySelector('#tarifas-programadas-list').addEventListener('click', (event) => handleListAction(event, section));
  section.querySelector('[name="aplicacion_habitaciones"]').addEventListener('change', () => updateRoomScopeUI(section));
  section.querySelectorAll('[data-room-scope-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const checked = button.dataset.roomScopeAction === 'all';
      section.querySelectorAll('[name="habitaciones_scope"]').forEach((input) => { input.checked = checked; });
    });
  });

  try {
    await reloadData(section);
    updateRoomScopeUI(section);
  } catch (error) {
    showFeedback(section, `No se pudieron cargar las tarifas: ${error.message}`, 'error');
  }
}

const observer = new MutationObserver(() => {
  renameMenuLabel();
  mountTariffs().catch((error) => console.warn('[HabitacionesTarifas] Error al montar:', error));
});

observer.observe(document.documentElement, { childList: true, subtree: true });
renameMenuLabel();
mountTariffs().catch(() => {});
