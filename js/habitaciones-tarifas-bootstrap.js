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
          <p class="mt-1 text-sm text-slate-600">${roomNames.get(String(tariff.habitacion_id)) || 'Todas las habitaciones'} · ${formatDays(tariff.dias_semana)}</p>
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
  form.querySelector('#tarifa-form-title').textContent = 'Nueva tarifa programada';
  form.querySelector('#tarifa-submit').textContent = 'Guardar tarifa';
  form.querySelector('#tarifa-cancel').classList.add('hidden');
  form.querySelectorAll('[name="dias_semana"]').forEach((input) => { input.checked = false; });
}

function fillForm(section, tariff) {
  const form = section.querySelector('#tarifa-programada-form');
  if (!form || !tariff) return;
  form.elements.tarifa_id.value = tariff.id;
  form.elements.nombre.value = tariff.nombre || '';
  form.elements.habitacion_id.value = tariff.habitacion_id || '';
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
  form.querySelector('#tarifa-form-title').textContent = 'Editar tarifa programada';
  form.querySelector('#tarifa-submit').textContent = 'Actualizar tarifa';
  form.querySelector('#tarifa-cancel').classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function reloadData(section) {
  const [roomResult, tariffResult] = await Promise.all([
    supabase.from('habitaciones').select('id, nombre').eq('hotel_id', activeHotelId).eq('activo', true).order('nombre'),
    supabase.from('tarifas_programadas_habitacion').select('*').eq('hotel_id', activeHotelId).eq('modalidad', 'noche').order('prioridad', { ascending: false }).order('creado_en', { ascending: false })
  ]);
  if (roomResult.error) throw roomResult.error;
  if (tariffResult.error) throw tariffResult.error;
  rooms = roomResult.data || [];
  tariffs = tariffResult.data || [];

  const roomSelect = section.querySelector('[name="habitacion_id"]');
  if (roomSelect) {
    const current = roomSelect.value;
    roomSelect.innerHTML = '<option value="">Todas las habitaciones</option>' + rooms.map((room) => `<option value="${room.id}">${room.nombre}</option>`).join('');
    roomSelect.value = current;
  }
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
    const payload = {
      hotel_id: activeHotelId,
      habitacion_id: form.elements.habitacion_id.value || null,
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
        <div><label class="form-label">Habitación</label><select class="form-control" name="habitacion_id"><option value="">Todas las habitaciones</option></select></div>
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

  try {
    await reloadData(section);
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
