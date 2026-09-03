import * as legacyConfig from './configuracion-core.js';
import {
  DEFAULT_HOTEL_TIME_ZONE,
  detectBrowserTimeZone,
  getSupportedTimeZones,
  normalizeTimeZone
} from '../../services/hotelTimeZoneService.js';

let timeZoneCleanup = null;

function renderTimeZoneOptions(selected) {
  const zones = getSupportedTimeZones();
  if (!zones.includes(selected)) zones.unshift(selected);
  return zones
    .map((zone) => `<option value="${zone}" ${zone === selected ? 'selected' : ''}>${zone}</option>`)
    .join('');
}

function updateRuntimeTimeZone(timeZone, hotelId) {
  if (typeof window === 'undefined') return;
  window.hotelConfigGlobal = {
    ...(window.hotelConfigGlobal || {}),
    zona_horaria: timeZone
  };
  window.dispatchEvent(new CustomEvent('hotel:timezone-changed', {
    detail: { hotelId, timeZone }
  }));
}

async function mountHotelTimeZoneSetting(container, supabase, hotelId) {
  const form = container?.querySelector('#config-form');
  if (!form || !supabase || !hotelId) return;

  const saveRow = form.querySelector('#btn-guardar-config')?.closest('div');
  if (!saveRow || form.querySelector('#zona_horaria')) return;

  let currentTimeZone = normalizeTimeZone(detectBrowserTimeZone(), DEFAULT_HOTEL_TIME_ZONE);
  try {
    const { data, error } = await supabase
      .from('configuracion_hotel')
      .select('zona_horaria')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (error) throw error;
    currentTimeZone = normalizeTimeZone(data?.zona_horaria, currentTimeZone);
  } catch (error) {
    console.warn('[Configuracion] No se pudo cargar la zona horaria del hotel.', error);
  }

  const fieldset = document.createElement('fieldset');
  fieldset.id = 'configuracion-zona-horaria';
  fieldset.className = 'border-2 border-sky-200 p-6 rounded-xl shadow-md bg-sky-50/30';
  fieldset.innerHTML = `
    <legend class="text-xl font-semibold text-sky-700 px-3 py-1 bg-white border-2 border-sky-200 rounded-lg shadow-sm">
      <span class="mr-2">🌎</span>Fecha, hora y zona horaria
    </legend>
    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 md:items-end">
      <div>
        <label for="zona_horaria" class="form-label">Zona horaria oficial del hotel</label>
        <select id="zona_horaria" name="zona_horaria" class="form-control">
          ${renderTimeZoneOptions(currentTimeZone)}
        </select>
        <p class="form-helper-text">Esta es la referencia única para fechas, horas, cierres de caja, reportes y cortes diarios del hotel. No depende de la zona horaria del computador del usuario.</p>
      </div>
      <div class="rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm text-slate-700">
        <p class="font-bold text-slate-900">Zona activa</p>
        <p id="zona-horaria-activa" class="mt-1 font-semibold text-sky-700">${currentTimeZone}</p>
        <p id="zona-horaria-feedback" class="mt-2 min-h-5 text-xs font-semibold text-slate-500">Los cambios se guardan automáticamente.</p>
      </div>
    </div>`;

  saveRow.before(fieldset);
  updateRuntimeTimeZone(currentTimeZone, hotelId);

  const select = fieldset.querySelector('#zona_horaria');
  const active = fieldset.querySelector('#zona-horaria-activa');
  const feedback = fieldset.querySelector('#zona-horaria-feedback');

  const onChange = async () => {
    const nextTimeZone = normalizeTimeZone(select.value, currentTimeZone);
    select.disabled = true;
    feedback.textContent = 'Guardando zona horaria…';
    feedback.className = 'mt-2 min-h-5 text-xs font-semibold text-blue-700';

    try {
      const { error } = await supabase
        .from('configuracion_hotel')
        .upsert({
          hotel_id: hotelId,
          zona_horaria: nextTimeZone,
          actualizado_en: new Date().toISOString()
        }, { onConflict: 'hotel_id' });
      if (error) throw error;

      currentTimeZone = nextTimeZone;
      active.textContent = currentTimeZone;
      feedback.textContent = 'Zona horaria guardada. Todo el sistema debe usar esta referencia.';
      feedback.className = 'mt-2 min-h-5 text-xs font-semibold text-emerald-700';
      updateRuntimeTimeZone(currentTimeZone, hotelId);
    } catch (error) {
      console.error('[Configuracion] No se pudo guardar la zona horaria.', error);
      select.value = currentTimeZone;
      feedback.textContent = `No se pudo guardar: ${String(error?.message || error)}`;
      feedback.className = 'mt-2 min-h-5 text-xs font-semibold text-red-700';
    } finally {
      select.disabled = false;
    }
  };

  select.addEventListener('change', onChange);
  timeZoneCleanup = () => select.removeEventListener('change', onChange);
}

export async function mount(container, supabase, user, hotelId, ...rest) {
  if (timeZoneCleanup) timeZoneCleanup();
  timeZoneCleanup = null;
  await legacyConfig.mount(container, supabase, user, hotelId, ...rest);
  await mountHotelTimeZoneSetting(container, supabase, hotelId);
}

export function unmount(container) {
  if (timeZoneCleanup) timeZoneCleanup();
  timeZoneCleanup = null;
  if (typeof legacyConfig.unmount === 'function') legacyConfig.unmount(container);
}
