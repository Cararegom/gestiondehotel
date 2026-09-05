import {
  mount as baseMount,
  unmount as baseUnmount,
  showModalTarea as baseShowModalTarea
} from './mantenimiento-workflow-ui.js';
import { getMaintenanceMetrics } from './mantenimiento-repository.js';
import {
  mountMaintenanceCalendar,
  refreshMaintenanceCalendar,
  unmountMaintenanceCalendar
} from './mantenimiento-calendario-ui.js';

let activeContainer = null;
let activeSupabase = null;
let selectedDays = 30;
let refreshTimer = null;
let refreshInterval = null;
let refreshing = false;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDuration(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value < 0) return 'Sin datos';
  if (value < 60) return `${Math.round(value)} min`;
  const hours = Math.floor(value / 60);
  const remaining = Math.round(value % 60);
  if (hours < 24) return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'Sin datos';
  return `${Number(value).toFixed(1)}%`;
}

function ensureShell() {
  if (!activeContainer) return null;
  let shell = activeContainer.querySelector('#mant-f4-analytics');
  if (shell) return shell;

  shell = document.createElement('section');
  shell.id = 'mant-f4-analytics';
  shell.className = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
  shell.innerHTML = '<p class="text-sm text-slate-500">Cargando control de mantenimiento...</p>';

  const calendar = activeContainer.querySelector('#mant-calendar-shell');
  const summary = activeContainer.querySelector('#mant-resumen');
  if (calendar?.parentElement) {
    calendar.insertAdjacentElement('afterend', shell);
  } else if (summary?.parentElement) {
    summary.insertAdjacentElement('afterend', shell);
  } else {
    activeContainer.prepend(shell);
  }
  return shell;
}

function renderEmptyList(text) {
  return `<p class="rounded-xl bg-slate-50 p-3 text-sm text-slate-500">${escapeHtml(text)}</p>`;
}

function renderMetrics(metrics) {
  const shell = ensureShell();
  if (!shell) return;

  const summary = metrics?.resumen || {};
  const recurrences = Array.isArray(metrics?.reincidencias) ? metrics.reincidencias : [];
  const categories = Array.isArray(metrics?.categorias) ? metrics.categorias : [];
  const assignees = Array.isArray(metrics?.responsables) ? metrics.responsables : [];
  const preventive = Array.isArray(metrics?.preventivos) ? metrics.preventivos : [];

  shell.innerHTML = `
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-base font-black text-slate-900">Control de mantenimiento</h3>
          <span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700">Alertas automáticas</span>
        </div>
        <p class="mt-1 text-xs text-slate-500">SLA, reincidencias, carga del equipo y preventivos.</p>
      </div>
      <label class="flex items-center gap-2 text-xs font-bold text-slate-500">
        Periodo
        <select id="mant-f4-period" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700">
          <option value="30" ${selectedDays === 30 ? 'selected' : ''}>30 días</option>
          <option value="60" ${selectedDays === 60 ? 'selected' : ''}>60 días</option>
          <option value="90" ${selectedDays === 90 ? 'selected' : ''}>90 días</option>
        </select>
      </label>
    </div>

    <div class="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
      <div class="rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-slate-500">Abiertas</p>
        <p class="mt-1 text-2xl font-black text-slate-900">${Number(summary.abiertas || 0)}</p>
      </div>
      <div class="rounded-2xl border border-red-200 bg-red-50 p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-red-600">Vencidas</p>
        <p class="mt-1 text-2xl font-black text-red-700">${Number(summary.vencidas || 0)}</p>
      </div>
      <div class="rounded-2xl border border-amber-200 bg-amber-50 p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-amber-700">Sin asignar</p>
        <p class="mt-1 text-2xl font-black text-amber-800">${Number(summary.sin_asignar || 0)}</p>
      </div>
      <div class="rounded-2xl border border-green-200 bg-green-50 p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-green-700">Cerradas</p>
        <p class="mt-1 text-2xl font-black text-green-800">${Number(summary.cerradas_periodo || 0)}</p>
      </div>
      <div class="rounded-2xl border border-blue-200 bg-blue-50 p-3">
        <p class="text-[11px] font-bold uppercase tracking-wide text-blue-700">Cumple SLA</p>
        <p class="mt-1 text-xl font-black text-blue-800">${escapeHtml(formatPercent(summary.cumplimiento_sla_pct))}</p>
      </div>
    </div>

    <div class="mt-3 grid gap-2 sm:grid-cols-2">
      <div class="rounded-2xl border border-slate-200 p-3">
        <p class="text-xs font-bold text-slate-500">Tiempo promedio de resolución</p>
        <p class="mt-1 text-lg font-black text-slate-900">${escapeHtml(formatDuration(summary.tiempo_promedio_resolucion_min))}</p>
      </div>
      <div class="rounded-2xl border border-violet-200 bg-violet-50 p-3">
        <p class="text-xs font-bold text-violet-700">Preventivos en próximos 7 días</p>
        <p class="mt-1 text-lg font-black text-violet-900">${Number(summary.preventivos_7d || 0)}</p>
      </div>
    </div>

    <div class="mt-4 grid gap-3 xl:grid-cols-3">
      <div class="rounded-2xl border border-slate-200 p-3">
        <h4 class="text-sm font-black text-slate-900">Reincidencias</h4>
        <p class="mt-0.5 text-xs text-slate-500">Habitación y categoría repetidas en el periodo.</p>
        <div class="mt-3 space-y-2">
          ${recurrences.length ? recurrences.map((item) => `
            <div class="flex items-center justify-between gap-3 rounded-xl bg-red-50 p-3">
              <div class="min-w-0">
                <p class="truncate text-sm font-black text-red-900">${escapeHtml(item.habitacion_nombre || 'Habitación')}</p>
                <p class="truncate text-xs text-red-700">${escapeHtml(item.categoria || 'general')}</p>
              </div>
              <span class="rounded-full bg-white px-2.5 py-1 text-xs font-black text-red-700">${Number(item.reportes || 0)} reportes</span>
            </div>`).join('') : renderEmptyList('No hay reincidencias relevantes en este periodo.')}
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 p-3">
        <h4 class="text-sm font-black text-slate-900">Carga por responsable</h4>
        <p class="mt-0.5 text-xs text-slate-500">Tareas abiertas y vencidas por persona.</p>
        <div class="mt-3 space-y-2">
          ${assignees.length ? assignees.map((item) => `
            <div class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
              <p class="min-w-0 truncate text-sm font-bold text-slate-800">${escapeHtml(item.nombre || 'Sin nombre')}</p>
              <div class="flex shrink-0 items-center gap-2 text-xs font-black">
                <span class="rounded-full bg-blue-100 px-2 py-1 text-blue-700">${Number(item.abiertas || 0)} abiertas</span>
                ${Number(item.vencidas || 0) > 0 ? `<span class="rounded-full bg-red-100 px-2 py-1 text-red-700">${Number(item.vencidas || 0)} vencidas</span>` : ''}
              </div>
            </div>`).join('') : renderEmptyList('No hay tareas abiertas asignadas.')}
        </div>
      </div>

      <div class="rounded-2xl border border-slate-200 p-3">
        <h4 class="text-sm font-black text-slate-900">Preventivos próximos</h4>
        <p class="mt-0.5 text-xs text-slate-500">Programados para los próximos 7 días.</p>
        <div class="mt-3 space-y-2">
          ${preventive.length ? preventive.map((item) => `
            <div class="rounded-xl bg-violet-50 p-3">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-black text-violet-900">${escapeHtml(item.titulo || 'Preventivo')}</p>
                  <p class="mt-0.5 text-xs text-violet-700">${escapeHtml(item.habitacion_nombre || 'General')}</p>
                </div>
                <span class="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-black text-violet-700">${escapeHtml(item.fecha_programada || '-')}</span>
              </div>
            </div>`).join('') : renderEmptyList('No hay preventivos programados para los próximos 7 días.')}
        </div>
      </div>
    </div>

    <div class="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <p class="text-xs font-black uppercase tracking-wide text-slate-500">Categorías más reportadas</p>
      <div class="mt-2 flex flex-wrap gap-2">
        ${categories.length ? categories.map((item) => `<span class="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">${escapeHtml(item.categoria || 'general')} · ${Number(item.reportes || 0)}</span>`).join('') : '<span class="text-sm text-slate-500">Sin datos todavía.</span>'}
      </div>
    </div>`;

  shell.querySelector('#mant-f4-period')?.addEventListener('change', (event) => {
    selectedDays = Number(event.target.value) || 30;
    refreshMetrics(true);
  });
}

function renderError(error) {
  const shell = ensureShell();
  if (!shell) return;
  shell.innerHTML = `
    <div class="rounded-xl border border-red-200 bg-red-50 p-3">
      <p class="text-sm font-black text-red-800">No se pudo cargar el control de mantenimiento.</p>
      <p class="mt-1 text-xs text-red-700">${escapeHtml(error?.message || 'Error desconocido')}</p>
      <button type="button" id="mant-f4-retry" class="mt-3 rounded-xl bg-red-700 px-3 py-2 text-xs font-black text-white">Reintentar</button>
    </div>`;
  shell.querySelector('#mant-f4-retry')?.addEventListener('click', () => refreshMetrics(true));
}

async function refreshMetrics(showLoading = false) {
  if (!activeContainer || !activeSupabase || refreshing) return;
  refreshing = true;
  const shell = ensureShell();
  if (showLoading && shell) {
    shell.innerHTML = '<p class="text-sm font-semibold text-slate-500">Actualizando indicadores...</p>';
  }
  try {
    const metrics = await getMaintenanceMetrics(activeSupabase, selectedDays);
    renderMetrics(metrics);
  } catch (error) {
    console.error('Error cargando métricas de mantenimiento:', error);
    renderError(error);
  } finally {
    refreshing = false;
  }
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshMetrics(false);
    refreshMaintenanceCalendar(false).catch((error) => {
      console.warn('No se pudo refrescar el calendario de mantenimiento:', error);
    });
  }, 250);
}

export async function mount(container, supabase, currentUser, hotelId) {
  activeContainer = container;
  activeSupabase = supabase;
  await baseMount(container, supabase, currentUser, hotelId);
  await mountMaintenanceCalendar(container, supabase, currentUser, hotelId).catch((error) => {
    console.error('No se pudo montar el calendario de mantenimiento:', error);
  });
  document.addEventListener('maintenanceChanged', scheduleRefresh);
  await refreshMetrics(true);
  refreshInterval = setInterval(() => refreshMetrics(false), 60000);
}

export function unmount() {
  document.removeEventListener('maintenanceChanged', scheduleRefresh);
  clearTimeout(refreshTimer);
  clearInterval(refreshInterval);
  refreshTimer = null;
  refreshInterval = null;
  unmountMaintenanceCalendar();
  baseUnmount();
  activeContainer = null;
  activeSupabase = null;
  refreshing = false;
  selectedDays = 30;
}

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  return baseShowModalTarea(container, supabase, hotelId, currentUser, tarea);
}
