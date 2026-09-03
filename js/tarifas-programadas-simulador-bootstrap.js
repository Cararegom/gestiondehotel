import { supabase } from './supabaseClient.js';
import { formatCurrency } from './uiUtils.js';
import { calcularEstanciaNochesProgramada } from './services/tarifasProgramadasService.js';
import { detectarConflictosTarifaProgramada } from './services/tarifasProgramadasConflictosService.js';
import { getDateKeyInTimeZone, getRuntimeHotelTimeZone } from './services/hotelTimeZoneService.js';

let mountedSection = null;
let hotelId = null;
let rooms = [];
let tariffs = [];
let refreshTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function nullableNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

async function resolveHotelId() {
  if (hotelId) return hotelId;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user?.id) throw userError || new Error('Usuario no identificado.');

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('hotel_id')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (profileError || !profile?.hotel_id) throw profileError || new Error('Hotel no identificado.');
  hotelId = profile.hotel_id;
  return hotelId;
}

async function loadPricingData() {
  const currentHotelId = await resolveHotelId();
  const [roomsResult, tariffsResult] = await Promise.all([
    supabase
      .from('habitaciones')
      .select('id,nombre,precio,precio_1_persona,precio_2_personas,precio_huesped_adicional,capacidad_base')
      .eq('hotel_id', currentHotelId)
      .eq('activo', true)
      .order('nombre'),
    supabase
      .from('tarifas_programadas_habitacion')
      .select('*')
      .eq('hotel_id', currentHotelId)
      .eq('modalidad', 'noche')
      .order('prioridad', { ascending: false })
  ]);

  if (roomsResult.error) throw roomsResult.error;
  if (tariffsResult.error) throw tariffsResult.error;
  rooms = roomsResult.data || [];
  tariffs = tariffsResult.data || [];
}

function selectedRoomScopeIds(form) {
  if (!form) return [];
  return [...form.querySelectorAll('[name="habitaciones_scope"]:checked')].map((input) => String(input.value));
}

function buildDraftTariff(form) {
  if (!form) return null;
  const scopeMode = String(form.elements.aplicacion_habitaciones?.value || 'todas');
  const scopeRooms = selectedRoomScopeIds(form);
  const days = [...form.querySelectorAll('[name="dias_semana"]:checked')].map((input) => Number(input.value));

  const draft = {
    id: String(form.elements.tarifa_id?.value || ''),
    nombre: String(form.elements.nombre?.value || '').trim() || 'Borrador sin guardar',
    modalidad: 'noche',
    habitacion_id: null,
    habitaciones_aplicables: scopeMode === 'seleccionadas' ? scopeRooms : [],
    habitaciones_excluidas: scopeMode === 'excepto' ? scopeRooms : [],
    dias_semana: days,
    fecha_inicio: form.elements.fecha_inicio?.value || null,
    fecha_fin: form.elements.fecha_fin?.value || null,
    precio_final: nullableNumber(form.elements.precio_final?.value),
    precio_1_persona: nullableNumber(form.elements.precio_1_persona?.value),
    precio_2_personas: nullableNumber(form.elements.precio_2_personas?.value),
    precio_huesped_adicional: nullableNumber(form.elements.precio_huesped_adicional?.value),
    prioridad: Number(form.elements.prioridad?.value) || 0,
    activo: form.elements.activo ? form.elements.activo.checked : true
  };

  const hasPrice = [draft.precio_final, draft.precio_1_persona, draft.precio_2_personas].some((value) => value !== null);
  if (!hasPrice || draft.activo === false) return null;
  if (scopeMode !== 'todas' && scopeRooms.length === 0) return null;
  if (draft.fecha_inicio && draft.fecha_fin && draft.fecha_fin < draft.fecha_inicio) return null;
  return draft;
}

function previewTariffs(section) {
  const form = section.querySelector('#tarifa-programada-form');
  const draft = buildDraftTariff(form);
  if (!draft) return tariffs.filter((item) => item.activo !== false);

  const editingId = String(draft.id || '');
  const saved = tariffs.filter((item) => item.activo !== false && (!editingId || String(item.id) !== editingId));
  return [...saved, draft];
}

function renderConflictPreview(section) {
  const container = section.querySelector('#tarifas-conflict-preview');
  if (!container) return;
  const form = section.querySelector('#tarifa-programada-form');
  const draft = buildDraftTariff(form);
  if (!draft) {
    container.className = 'hidden';
    container.innerHTML = '';
    return;
  }

  const conflicts = detectarConflictosTarifaProgramada(
    draft,
    tariffs,
    rooms.map((room) => room.id)
  );
  if (!conflicts.length) {
    container.className = 'rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800';
    container.innerHTML = '<strong>Sin conflictos.</strong> No hay otra tarifa activa que coincida con el mismo alcance, fechas y días.';
    return;
  }

  const ambiguous = conflicts.filter((item) => item.ambigua);
  const names = conflicts.slice(0, 3).map((item) => escapeHtml(item.tarifa?.nombre || 'Tarifa existente')).join(', ');
  const more = conflicts.length > 3 ? ` y ${conflicts.length - 3} más` : '';
  if (ambiguous.length) {
    container.className = 'rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800';
    container.innerHTML = `<strong>Conflicto de precedencia.</strong> Coincide con ${names}${more}. Al menos una regla tiene la misma prioridad y especificidad; ajusta la prioridad, los días, las fechas o las habitaciones antes de guardar.`;
    return;
  }

  container.className = 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800';
  container.innerHTML = `<strong>Superposición controlada.</strong> Coincide con ${names}${more}, pero la prioridad/especificidad define cuál gana. Puedes usar el simulador para confirmar el resultado.`;
}

function blockAmbiguousSubmit(event, section) {
  const form = section.querySelector('#tarifa-programada-form');
  const draft = buildDraftTariff(form);
  if (!draft) return;
  const conflicts = detectarConflictosTarifaProgramada(draft, tariffs, rooms.map((room) => room.id));
  if (!conflicts.some((item) => item.ambigua)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  renderConflictPreview(section);
  const preview = section.querySelector('#tarifas-conflict-preview');
  preview?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderRoomOptions(select) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = rooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.nombre)}</option>`).join('');
  if (rooms.some((room) => String(room.id) === current)) select.value = current;
}

function renderSimulation(section) {
  const roomSelect = section.querySelector('#tarifa-sim-room');
  const dateInput = section.querySelector('#tarifa-sim-date');
  const guestsInput = section.querySelector('#tarifa-sim-guests');
  const nightsInput = section.querySelector('#tarifa-sim-nights');
  const result = section.querySelector('#tarifa-sim-result');
  if (!roomSelect || !dateInput || !guestsInput || !nightsInput || !result) return;

  const room = rooms.find((item) => String(item.id) === String(roomSelect.value));
  const date = dateInput.value;
  if (!room || !date) {
    result.className = 'rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700';
    result.textContent = 'Selecciona una habitación y una fecha para simular.';
    return;
  }

  const guests = Math.max(1, Number(guestsInput.value) || 1);
  const nights = Math.max(1, Math.min(31, Number(nightsInput.value) || 1));
  const calculation = calcularEstanciaNochesProgramada({
    room,
    huespedes: guests,
    fechaEntrada: date,
    cantidadNoches: nights,
    tarifas: previewTariffs(section),
    timeZone: getRuntimeHotelTimeZone()
  });

  const lines = calculation.desglose.map((item) => {
    const tariffName = item.tarifaAplicada?.nombre || 'Tarifa base de la habitación';
    const extra = item.montoHuespedesAdicionales > 0 ? ` + adicionales ${formatCurrency(item.montoHuespedesAdicionales)}` : '';
    return `<div class="flex flex-col gap-1 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-center sm:justify-between"><div><strong>${escapeHtml(item.fecha)}</strong><div class="text-xs text-slate-500">${escapeHtml(tariffName)}</div></div><div class="font-semibold text-slate-800">${formatCurrency(item.precioHospedaje)}${escapeHtml(extra)}</div></div>`;
  }).join('');

  result.className = 'rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm';
  result.innerHTML = `
    <div class="flex flex-wrap items-end justify-between gap-3 border-b border-indigo-100 pb-3">
      <div><p class="text-xs font-bold uppercase tracking-wider text-indigo-500">Resultado</p><p class="text-sm text-slate-600">${nights} noche${nights === 1 ? '' : 's'} · ${guests} huésped${guests === 1 ? '' : 'es'}</p></div>
      <div class="text-right"><p class="text-xs text-slate-500">Total hospedaje</p><p class="text-2xl font-extrabold text-indigo-700">${formatCurrency(calculation.total)}</p></div>
    </div>
    <div class="mt-2">${lines}</div>`;
}

function insertEnhancerUI(section) {
  if (section.querySelector('#tarifas-simulador-panel')) return;
  const form = section.querySelector('#tarifa-programada-form');
  const listHeading = [...section.querySelectorAll('h3')].find((node) => String(node.textContent || '').trim() === 'Tarifas configuradas');
  const anchor = listHeading?.parentElement || form?.nextElementSibling || null;

  const panel = document.createElement('div');
  panel.id = 'tarifas-simulador-panel';
  panel.className = 'space-y-4';
  panel.innerHTML = `
    <div id="tarifas-conflict-preview" class="hidden"></div>
    <div class="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-5">
      <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.18em] text-indigo-500">Simulador</p>
          <h3 class="text-lg font-bold text-slate-900">Comprueba el precio antes de guardar</h3>
          <p class="text-sm text-slate-600">La simulación incluye las tarifas activas y, si estás editando una nueva regla, también el borrador aún no guardado.</p>
        </div>
      </div>
      <div class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
        <div><label class="form-label text-sm">Habitación</label><select id="tarifa-sim-room" class="form-control"></select></div>
        <div><label class="form-label text-sm">Fecha de entrada</label><input id="tarifa-sim-date" class="form-control" type="date"></div>
        <div><label class="form-label text-sm">Huéspedes</label><input id="tarifa-sim-guests" class="form-control" type="number" min="1" max="20" value="2"></div>
        <div><label class="form-label text-sm">Noches</label><input id="tarifa-sim-nights" class="form-control" type="number" min="1" max="31" value="1"></div>
      </div>
      <div class="mt-3 flex justify-end"><button id="tarifa-sim-run" type="button" class="button button-primary">Simular precio</button></div>
      <div id="tarifa-sim-result" class="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-4 text-sm text-slate-500">Selecciona los datos y pulsa “Simular precio”.</div>
    </div>`;

  if (anchor) anchor.before(panel);
  else section.appendChild(panel);

  const dateInput = panel.querySelector('#tarifa-sim-date');
  if (dateInput && !dateInput.value) {
    dateInput.value = getDateKeyInTimeZone(new Date(), getRuntimeHotelTimeZone());
  }
  renderRoomOptions(panel.querySelector('#tarifa-sim-room'));
  panel.querySelector('#tarifa-sim-run')?.addEventListener('click', () => renderSimulation(section));

  if (form) {
    form.addEventListener('submit', (event) => blockAmbiguousSubmit(event, section), true);
    form.addEventListener('input', () => renderConflictPreview(section));
    form.addEventListener('change', () => renderConflictPreview(section));
    renderConflictPreview(section);
  }

  section.addEventListener('click', (event) => {
    if (!event.target.closest('[data-action]')) return;
    window.setTimeout(() => scheduleRefresh(section), 700);
  });
}

async function refresh(section) {
  try {
    await loadPricingData();
    const select = section.querySelector('#tarifa-sim-room');
    renderRoomOptions(select);
    renderConflictPreview(section);
  } catch (error) {
    console.warn('[TarifasSimulador] No se pudieron actualizar los datos:', error);
  }
}

function scheduleRefresh(section) {
  if (refreshTimer) window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => refresh(section), 120);
}

async function mount() {
  const section = document.getElementById('habitaciones-tarifas-programadas');
  if (!section) return;
  if (mountedSection === section && section.querySelector('#tarifas-simulador-panel')) return;

  mountedSection = section;
  try {
    await loadPricingData();
    insertEnhancerUI(section);
  } catch (error) {
    console.warn('[TarifasSimulador] No se pudo montar:', error);
  }
}

const observer = new MutationObserver(() => {
  mount().catch(() => {});
});
observer.observe(document.documentElement, { childList: true, subtree: true });

document.addEventListener('datosActualizados', (event) => {
  if (event?.detail?.origen !== 'tarifas_programadas') return;
  const section = document.getElementById('habitaciones-tarifas-programadas');
  if (section) scheduleRefresh(section);
});

mount().catch(() => {});
