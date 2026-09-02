import { clearTodosLosCronometros, startCronometro } from './cronometro-habitacion.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

let root = null;
let db = null;
let pollTimer = null;
let visibilityHandler = null;
let rendering = false;

const STATE_META = Object.freeze({
  libre: { label: 'LIBRE', border: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-800', note: 'Disponible para revisión' },
  disponible: { label: 'LIBRE', border: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-800', note: 'Disponible para revisión' },
  ocupada: { label: 'OCUPADA', border: 'border-amber-400', badge: 'bg-amber-100 text-amber-800', note: 'No ingresar · habitación ocupada' },
  reservada: { label: 'RESERVADA', border: 'border-indigo-400', badge: 'bg-indigo-100 text-indigo-800', note: 'No ingresar · habitación reservada' },
  limpieza: { label: 'LIMPIEZA', border: 'border-cyan-400', badge: 'bg-cyan-100 text-cyan-800', note: 'En proceso de limpieza' },
  mantenimiento: { label: 'MANTENIMIENTO', border: 'border-red-400', badge: 'bg-red-100 text-red-800', note: 'Fuera de servicio' },
  'tiempo agotado': { label: 'TIEMPO AGOTADO', border: 'border-red-600', badge: 'bg-red-100 text-red-800', note: 'Esperar liberación antes de ingresar' }
});

function normalizeState(value) {
  const state = String(value || 'libre').trim().toLowerCase();
  return state === 'disponible' ? 'libre' : state;
}

function getStateMeta(state) {
  return STATE_META[normalizeState(state)] || {
    label: String(state || 'OTRO').toUpperCase(),
    border: 'border-slate-300',
    badge: 'bg-slate-100 text-slate-700',
    note: 'Estado operativo'
  };
}

function floorKey(room) {
  const raw = room?.piso;
  return raw === null || raw === undefined || String(raw).trim() === ''
    ? 'Sin piso'
    : `Piso ${String(raw).trim()}`;
}

function buildRoomCard(room) {
  const state = normalizeState(room.estado);
  const meta = getStateMeta(state);
  const card = document.createElement('article');
  card.className = `room-card rounded-2xl border-2 ${meta.border} bg-white p-4 shadow-sm cursor-default select-none`;
  card.dataset.roomId = room.id;
  card.setAttribute('aria-label', `Habitación ${room.nombre}, ${meta.label}, solo lectura`);
  card.setAttribute('aria-disabled', 'true');

  card.innerHTML = `
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">Habitación</p>
        <h3 class="mt-1 text-2xl font-black text-slate-900">${escapeHtml(room.nombre || '—')}</h3>
      </div>
      <span class="badge rounded-full px-2.5 py-1 text-[10px] font-black ${meta.badge}">${escapeHtml(meta.label)}</span>
    </div>
    <p class="mt-3 text-sm font-semibold ${state === 'ocupada' || state === 'tiempo agotado' ? 'text-amber-800' : 'text-slate-600'}">${escapeHtml(meta.note)}</p>
    <div class="mt-4 border-t border-slate-100 pt-3">
      <p class="mb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">${state === 'ocupada' || state === 'tiempo agotado' ? 'Tiempo de estadía' : 'Estado de habitación'}</p>
      <div id="cronometro-${escapeAttribute(room.id)}" class="cronometro-display min-h-[28px] font-mono text-base font-bold text-slate-700">
        ${state === 'ocupada' || state === 'tiempo agotado' ? '<span class="text-sm text-slate-400">Cargando reloj…</span>' : `<span class="text-sm font-semibold text-slate-500">${escapeHtml(meta.label)}</span>`}
      </div>
    </div>`;

  return card;
}

function startRoomTimer(room, listEl) {
  const state = normalizeState(room.estado);
  if (!['ocupada', 'tiempo agotado'].includes(state) || !room.reserva) return;

  startCronometro({
    id: room.id,
    nombre: room.nombre,
    estado: state,
    reservas: [room.reserva]
  }, room.reserva, listEl, null);
}

function renderControls(rooms) {
  const controls = root.querySelector('#readonly-map-controls');
  if (!controls) return () => rooms;

  const floors = [...new Set(rooms.map(floorKey))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true }));
  const states = [...new Set(rooms.map((room) => normalizeState(room.estado)))].sort();

  controls.innerHTML = `
    <div class="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2">
      <label class="text-xs font-bold uppercase tracking-wide text-slate-500">Piso
        <select id="readonly-floor" class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <option value="">Todos</option>
          ${floors.map((floor) => `<option value="${escapeAttribute(floor)}">${escapeHtml(floor)}</option>`).join('')}
        </select>
      </label>
      <label class="text-xs font-bold uppercase tracking-wide text-slate-500">Estado
        <select id="readonly-state" class="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
          <option value="">Todos</option>
          ${states.map((state) => `<option value="${escapeAttribute(state)}">${escapeHtml(getStateMeta(state).label)}</option>`).join('')}
        </select>
      </label>
    </div>`;

  return () => {
    const selectedFloor = controls.querySelector('#readonly-floor')?.value || '';
    const selectedState = controls.querySelector('#readonly-state')?.value || '';
    return rooms.filter((room) => (
      (!selectedFloor || floorKey(room) === selectedFloor)
      && (!selectedState || normalizeState(room.estado) === selectedState)
    ));
  };
}

function renderRooms(rooms) {
  const list = root.querySelector('#readonly-room-list');
  if (!list) return;

  clearTodosLosCronometros();
  const getFiltered = renderControls(rooms);

  const paint = () => {
    clearTodosLosCronometros();
    list.innerHTML = '';
    const filtered = getFiltered();
    const count = root.querySelector('#readonly-map-count');
    if (count) count.textContent = `${filtered.length} de ${rooms.length} habitaciones`;

    if (!filtered.length) {
      list.innerHTML = '<div class="col-span-full rounded-2xl bg-slate-50 p-8 text-center text-slate-500">No hay habitaciones con esos filtros.</div>';
      return;
    }

    filtered.forEach((room) => {
      const card = buildRoomCard(room);
      list.appendChild(card);
      startRoomTimer(room, list);
    });
  };

  root.querySelector('#readonly-floor')?.addEventListener('change', paint);
  root.querySelector('#readonly-state')?.addEventListener('change', paint);
  paint();
}

async function loadRooms() {
  if (!root || !db || rendering) return;
  rendering = true;
  const list = root.querySelector('#readonly-room-list');
  if (list && !list.children.length) {
    list.innerHTML = '<div class="col-span-full p-8 text-center text-slate-500">Cargando habitaciones…</div>';
  }

  try {
    const { data, error } = await db.rpc('mapa_mantenimiento_conserje');
    if (error) throw error;
    renderRooms(Array.isArray(data) ? data : []);
  } catch (error) {
    console.error('[Mapa solo lectura] Error:', error);
    if (list) {
      list.innerHTML = '<div class="col-span-full rounded-2xl border border-red-200 bg-red-50 p-5 text-center font-semibold text-red-700">No fue posible cargar el mapa operativo.</div>';
    }
  } finally {
    rendering = false;
  }
}

export async function mount(container, supabase) {
  root = container;
  db = supabase;

  root.innerHTML = `
    <section class="mx-auto max-w-7xl space-y-4 px-1 py-2 sm:px-2">
      <header class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs font-black uppercase tracking-[0.2em] text-blue-600">Mantenimiento / Conserje</p>
            <h1 class="mt-1 text-2xl font-black text-slate-900">Mapa de habitaciones</h1>
            <p class="mt-1 text-sm text-slate-500">Vista operativa de solo lectura. No muestra huéspedes, pagos ni acciones de recepción.</p>
          </div>
          <div class="rounded-full bg-slate-100 px-3 py-2 text-xs font-black text-slate-600">🔒 SOLO LECTURA</div>
        </div>
      </header>
      <div class="flex items-center justify-between px-1">
        <p id="readonly-map-count" class="text-sm font-bold text-slate-500">— habitaciones</p>
        <button id="readonly-refresh" type="button" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">Actualizar</button>
      </div>
      <div id="readonly-map-controls"></div>
      <div id="readonly-room-list" class="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"></div>
    </section>`;

  root.querySelector('#readonly-refresh')?.addEventListener('click', () => loadRooms());
  await loadRooms();

  pollTimer = window.setInterval(() => loadRooms(), 30000);
  visibilityHandler = () => {
    if (document.visibilityState === 'visible') loadRooms();
  };
  document.addEventListener('visibilitychange', visibilityHandler);
}

export function unmount(container) {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = null;
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = null;
  clearTodosLosCronometros();
  if (container) container.innerHTML = '';
  root = null;
  db = null;
  rendering = false;
}
