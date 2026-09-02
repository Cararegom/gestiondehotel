import { supabase } from '../../supabaseClient.js';

const ROOT_ID = 'horarios-profesionales-root';
const LEGACY_CONFIG_ID = 'configuracion-global-turnos-container';
const LEGACY_SCHEDULE_ID = 'horario-turnos-semanal';

const state = {
  setup: null,
  draft: null,
  selectedUsers: new Set(),
  periodMode: 'week',
  busy: false,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeTime(value) {
  return String(value || '').slice(0, 5);
}

function localIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(value, amount) {
  const date = typeof value === 'string' ? parseLocalDate(value) : new Date(value);
  date.setDate(date.getDate() + amount);
  return localIso(date);
}

function enumerateDates(start, end) {
  if (!start || !end || end < start) return [];
  const result = [];
  for (let cursor = start; cursor <= end && result.length < 64; cursor = addDays(cursor, 1)) result.push(cursor);
  return result;
}

function currentWeekRange() {
  const now = new Date();
  const monday = new Date(now);
  monday.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()));
  return { start: localIso(monday), end: addDays(monday, 6) };
}

function currentMonthRange() {
  const now = new Date();
  return {
    start: localIso(new Date(now.getFullYear(), now.getMonth(), 1, 12)),
    end: localIso(new Date(now.getFullYear(), now.getMonth() + 1, 0, 12)),
  };
}

function formatDay(value) {
  return new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit', month: 'short' })
    .format(parseLocalDate(value)).replace(/\./g, '');
}

function formatRange(start, end) {
  const fmt = new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${fmt.format(parseLocalDate(start))} – ${fmt.format(parseLocalDate(end))}`;
}

async function invokeEngine(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('horario-engine', { body: { action, ...payload } });
  if (error) {
    let message = error.message || 'No se pudo conectar con el creador de horarios.';
    try {
      if (error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        message = body?.error || message;
      }
    } catch { /* conserva mensaje SDK */ }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || 'El creador de horarios respondió con un error.');
  return data;
}

function showFeedback(message, kind = 'info') {
  const el = document.querySelector(`#${ROOT_ID} [data-role="feedback"]`);
  if (!el) return;
  const classes = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  };
  el.className = `rounded-xl border px-4 py-3 text-sm ${classes[kind] || classes.info}`;
  el.textContent = message;
  el.hidden = false;
}

function clearFeedback() {
  const el = document.querySelector(`#${ROOT_ID} [data-role="feedback"]`);
  if (el) el.hidden = true;
}

function setBusy(busy, message = '') {
  state.busy = busy;
  document.querySelectorAll(`#${ROOT_ID} button, #${ROOT_ID} input, #${ROOT_ID} select`).forEach((el) => {
    el.disabled = busy;
  });
  const indicator = document.querySelector(`#${ROOT_ID} [data-role="busy"]`);
  if (indicator) {
    indicator.textContent = busy ? (message || 'Procesando…') : '';
    indicator.hidden = !busy;
  }
}

function currentDraftId() {
  return state.draft?.draft?.id || state.draft?.draft_id || null;
}

function currentDraftStatus() {
  return state.draft?.draft?.estado || 'borrador';
}

function templateById() {
  return new Map((state.draft?.plantillas || state.setup?.templates || []).map((item) => [item.id, item]));
}

function renderShell(root) {
  root.innerHTML = `
    <section class="mb-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-5 text-white sm:px-6">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide">Horarios · Fase 3</span>
              <span class="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">Edición segura</span>
            </div>
            <h3 class="text-xl font-bold sm:text-2xl">Creador profesional de horarios</h3>
            <p class="mt-1 max-w-3xl text-sm text-slate-300">Genera un borrador, corrige turnos, protege decisiones manuales, reorganiza lo restante y publica solo después de validar.</p>
          </div>
          <button type="button" data-action="refresh" class="w-fit rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20">Actualizar</button>
        </div>
      </div>
      <div class="space-y-6 p-4 sm:p-6">
        <div data-role="feedback" hidden></div>
        <div data-role="busy" hidden class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800"></div>
        <div class="grid gap-5 xl:grid-cols-[1.15fr_1fr]">
          <div data-role="config-panel" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"></div>
          <div data-role="team-panel" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"></div>
        </div>
        <div data-role="generator-panel" class="rounded-2xl border border-slate-200 p-4 sm:p-5"></div>
        <div data-role="draft-toolbar"></div>
        <div data-role="validation"></div>
        <div data-role="calendar"></div>
        <div data-role="drafts"></div>
      </div>
    </section>`;
}

function renderConfigPanel() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="config-panel"]`);
  if (!host || !state.setup) return;
  const config = state.setup.config;
  const templates = state.setup.templates || [];
  host.innerHTML = `
    <div class="mb-4 flex items-start justify-between gap-3">
      <div><h4 class="font-bold text-slate-900">1. Reglas y horas del hotel</h4><p class="mt-1 text-xs text-slate-500">Estas reglas alimentan la validación y el reorganizador.</p></div>
      <span class="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700">${Number(config.modalidad)} h</span>
    </div>
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <label class="text-xs font-semibold text-slate-600">Modalidad<select data-config="modalidad" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"><option value="12" ${Number(config.modalidad) === 12 ? 'selected' : ''}>12 horas</option><option value="8" ${Number(config.modalidad) === 8 ? 'selected' : ''}>8 horas</option></select></label>
      <label class="text-xs font-semibold text-slate-600">Descanso mínimo<input data-config="descanso_minimo_horas" type="number" min="6" max="24" step="0.5" value="${Number(config.descanso_minimo_horas)}" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"></label>
      <label class="text-xs font-semibold text-slate-600">Máx. consecutivos<input data-config="max_turnos_consecutivos" type="number" min="1" max="14" value="${Number(config.max_turnos_consecutivos)}" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"></label>
      <label class="text-xs font-semibold text-slate-600">Máx. noches<input data-config="max_noches_consecutivas" type="number" min="1" max="7" value="${Number(config.max_noches_consecutivas)}" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm"></label>
    </div>
    <div class="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-700">
      <label class="flex items-center gap-2"><input data-config="equilibrar_noches" type="checkbox" ${config.equilibrar_noches ? 'checked' : ''}> Equilibrar noches</label>
      <label class="flex items-center gap-2"><input data-config="equilibrar_fines_semana" type="checkbox" ${config.equilibrar_fines_semana ? 'checked' : ''}> Equilibrar fines de semana</label>
      <label class="flex items-center gap-2"><input data-config="permitir_turnos_extendidos" type="checkbox" ${config.permitir_turnos_extendidos ? 'checked' : ''}> Cobertura extendida</label>
    </div>
    <div class="mt-5 space-y-2">
      <div class="text-xs font-bold uppercase tracking-wide text-slate-500">Horas reales</div>
      ${templates.map((template) => `<div class="grid grid-cols-[minmax(100px,1fr)_92px_92px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2" data-template-id="${escapeHtml(template.id)}"><div class="min-w-0"><div class="truncate text-sm font-semibold text-slate-800">${escapeHtml(template.nombre)}</div><div class="text-[11px] text-slate-500">${template.es_extendido ? 'Extendido' : 'Normal'}${template.es_nocturno ? ' · nocturno' : ''}</div></div><input data-template-start type="time" value="${normalizeTime(template.hora_inicio)}" class="rounded-lg border border-slate-300 p-1.5 text-sm"><input data-template-end type="time" value="${normalizeTime(template.hora_fin)}" class="rounded-lg border border-slate-300 p-1.5 text-sm"></div>`).join('')}
    </div>
    <div class="mt-4 flex flex-wrap gap-2"><button type="button" data-action="save-config" class="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white">Guardar reglas</button><button type="button" data-action="save-templates" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700">Guardar horas</button></div>`;
}

function renderTeamPanel() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="team-panel"]`);
  if (!host || !state.setup) return;
  const users = state.setup.usuarios || [];
  if (!state.selectedUsers.size) users.forEach((user) => state.selectedUsers.add(user.id));
  host.innerHTML = `
    <div class="mb-4"><h4 class="font-bold text-slate-900">2. Equipo que participa</h4><p class="mt-1 text-xs text-slate-500">Solo usuarios activos con rol Recepcionista.</p></div>
    <div class="mb-3 flex items-center justify-between gap-2"><span class="text-xs font-semibold text-slate-500"><strong data-role="selected-count">${state.selectedUsers.size}</strong> seleccionadas</span><div class="flex gap-2 text-xs"><button type="button" data-action="select-all" class="font-semibold text-blue-700">Todas</button><button type="button" data-action="select-none" class="font-semibold text-slate-500">Ninguna</button></div></div>
    <div class="max-h-80 space-y-2 overflow-y-auto pr-1">${users.length ? users.map((user) => `<label class="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 hover:border-blue-300"><input data-user-checkbox type="checkbox" value="${escapeHtml(user.id)}" class="mt-1" ${state.selectedUsers.has(user.id) ? 'checked' : ''}><span class="min-w-0 flex-1"><span class="block truncate text-sm font-semibold text-slate-800">${escapeHtml(user.nombre)}</span><span class="mt-1 flex flex-wrap gap-1">${user.evitaNoche ? '<span class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">Evita noche</span>' : ''}${user.prefiereDia ? '<span class="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800">Prefiere día</span>' : ''}</span></span></label>`).join('') : '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">No hay recepcionistas activas.</div>'}</div>`;
}

function periodRange() {
  if (state.periodMode === 'month') return currentMonthRange();
  return currentWeekRange();
}

function renderGeneratorPanel() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="generator-panel"]`);
  if (!host) return;
  const range = periodRange();
  host.innerHTML = `
    <div class="mb-4"><h4 class="font-bold text-slate-900">3. Crear un borrador</h4><p class="mt-1 text-xs text-slate-500">Generar nunca modifica el horario publicado.</p></div>
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div class="flex-1"><div class="mb-3 flex flex-wrap gap-2">${[['week','Semana'],['month','Mes'],['custom','Personalizado']].map(([mode,label]) => `<button type="button" data-action="period" data-period="${mode}" class="rounded-lg px-3 py-2 text-sm font-semibold ${state.periodMode === mode ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white text-slate-700'}">${label}</button>`).join('')}</div><div class="grid gap-3 sm:grid-cols-2"><label class="text-xs font-semibold text-slate-600">Desde<input data-period-start type="date" value="${range.start}" class="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"></label><label class="text-xs font-semibold text-slate-600">Hasta<input data-period-end type="date" value="${range.end}" class="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm"></label></div></div>
      <button type="button" data-action="generate" class="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700">Generar borrador</button>
    </div>`;
}

function renderValidation(validation) {
  const host = document.querySelector(`#${ROOT_ID} [data-role="validation"]`);
  if (!host) return;
  if (!validation) { host.innerHTML = ''; return; }
  const conflicts = validation.conflictos || [];
  const warnings = validation.advertencias || [];
  const quality = Number(validation.calidad ?? 0);
  const klass = conflicts.length ? 'border-red-200 bg-red-50 text-red-800' : warnings.length ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-800';
  host.innerHTML = `<div class="rounded-2xl border ${klass} p-4 sm:p-5"><div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h4 class="font-bold">Validación del borrador</h4><p class="mt-1 text-sm">${conflicts.length} conflicto(s) · ${warnings.length} advertencia(s)</p></div><div><div class="text-xs font-semibold uppercase opacity-70">Calidad</div><div class="text-2xl font-black">${quality}/100</div></div></div>${conflicts.length || warnings.length ? `<div class="mt-3 grid gap-2 md:grid-cols-2">${[...conflicts, ...warnings].slice(0, 8).map((issue) => `<div class="rounded-lg bg-white/70 px-3 py-2 text-xs"><strong>${escapeHtml(issue.codigo || 'REVISAR')}</strong>${issue.fecha ? ` · ${escapeHtml(formatDay(issue.fecha))}` : ''}<br>${escapeHtml(issue.mensaje)}</div>`).join('')}</div>` : '<p class="mt-3 text-sm font-semibold">✓ Sin conflictos bloqueantes.</p>'}</div>`;
}

function renderDraftToolbar() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="draft-toolbar"]`);
  if (!host) return;
  const id = currentDraftId();
  if (!id) { host.innerHTML = ''; return; }
  const status = currentDraftStatus();
  const validation = state.draft?.validacion || {};
  const conflicts = validation.conflictos?.length || 0;
  const warnings = validation.advertencias?.length || 0;
  const editable = status === 'borrador';
  host.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-slate-950 p-4 text-white sm:p-5"><div class="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><div><div class="text-xs font-semibold uppercase tracking-wide text-slate-400">Borrador activo</div><div class="mt-1 text-sm font-bold">${escapeHtml(id.slice(0, 8))} · ${escapeHtml(String(status).toUpperCase())}</div><p class="mt-1 text-xs text-slate-400">${editable ? 'Las ediciones manuales quedan protegidas para que Reorganizar no las cambie.' : 'Este horario ya fue publicado y queda bloqueado para edición.'}</p></div><div class="flex flex-wrap gap-2"><button type="button" data-action="validate" class="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold">Validar</button>${editable ? `<button type="button" data-action="reorganize" class="rounded-lg border border-violet-300/30 bg-violet-400/15 px-3 py-2 text-sm font-semibold text-violet-100">Reorganizar libres</button><button type="button" data-action="publish" ${conflicts ? 'disabled' : ''} class="rounded-lg px-3 py-2 text-sm font-bold ${conflicts ? 'cursor-not-allowed bg-slate-700 text-slate-400' : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'}">Publicar${warnings ? ` · ${warnings} advert.` : ''}</button>` : ''}</div></div>${conflicts ? `<div class="mt-3 rounded-lg border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100">Publicación bloqueada hasta resolver ${conflicts} conflicto(s).</div>` : ''}</div>`;
}

function renderCalendar() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="calendar"]`);
  if (!host) return;
  const data = state.draft;
  if (!data?.asignaciones?.length) {
    host.innerHTML = '<div class="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center"><div class="text-3xl">🗓️</div><h4 class="mt-2 font-bold text-slate-800">Todavía no hay un borrador abierto</h4><p class="mt-1 text-sm text-slate-500">Genera o abre uno para editarlo.</p></div>';
    return;
  }
  const assignments = data.asignaciones;
  const templates = data.plantillas || state.setup?.templates || [];
  const users = data.usuarios || state.setup?.usuarios || [];
  const start = data.draft?.fecha_inicio || data.fecha_inicio || assignments[0]?.fecha;
  const end = data.draft?.fecha_fin || data.fecha_fin || assignments.at(-1)?.fecha;
  const dates = enumerateDates(start, end);
  const userIds = [...new Set(assignments.map((item) => item.usuario_id))];
  const visibleUsers = userIds.map((id) => users.find((item) => item.id === id)).filter(Boolean);
  const editable = currentDraftStatus() === 'borrador';

  host.innerHTML = `<div class="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div class="flex flex-col gap-2 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><h4 class="font-bold text-slate-900">Horario ${editable ? 'en edición' : 'publicado'}</h4><p class="mt-1 text-xs text-slate-500">${escapeHtml(formatRange(start, end))} · ${dates.length} día(s)</p></div><span class="w-fit rounded-full px-2.5 py-1 text-xs font-bold ${editable ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}">${editable ? 'BORRADOR EDITABLE' : 'PUBLICADO'}</span></div><div class="overflow-x-auto"><table class="min-w-max border-collapse text-xs"><thead><tr><th class="sticky left-0 z-20 min-w-[150px] border-b border-r border-slate-200 bg-slate-100 p-2 text-left text-slate-600">Recepcionista</th>${dates.map((date) => `<th class="min-w-[150px] border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold capitalize text-slate-600">${escapeHtml(formatDay(date))}</th>`).join('')}</tr></thead><tbody>${visibleUsers.map((user) => `<tr><td class="sticky left-0 z-10 border-b border-r border-slate-200 bg-white p-2 font-semibold text-slate-800">${escapeHtml(user.nombre)}</td>${dates.map((date) => {
    const row = assignments.find((item) => item.usuario_id === user.id && item.fecha === date);
    if (!row) return '<td class="border-b border-r border-slate-200 p-2 text-center text-slate-300">—</td>';
    const selected = row.plantilla_turno_id || '';
    const locked = row.bloqueado === true;
    const options = [`<option value="" ${selected ? '' : 'selected'}>Descanso</option>`, ...templates.map((template) => `<option value="${escapeHtml(template.id)}" ${selected === template.id ? 'selected' : ''}>${escapeHtml(template.nombre)} · ${normalizeTime(template.hora_inicio)}–${normalizeTime(template.hora_fin)}</option>`)].join('');
    return `<td class="border-b border-r border-slate-200 p-2 align-top"><div class="rounded-lg border ${locked ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'} p-2" data-assignment-id="${escapeHtml(row.id)}"><select data-assignment-shift ${editable ? '' : 'disabled'} class="w-full rounded-md border border-slate-300 bg-white p-1.5 text-xs">${options}</select><div class="mt-2 flex items-center justify-between gap-2"><span class="text-[10px] font-semibold ${locked ? 'text-blue-700' : 'text-slate-400'}">${locked ? '🔒 Protegido' : 'Libre para reorganizar'}</span>${editable ? `<button type="button" data-action="toggle-lock" data-assignment-id="${escapeHtml(row.id)}" class="rounded border border-slate-300 bg-white px-1.5 py-1 text-[10px] font-semibold text-slate-600">${locked ? 'Desbloquear' : 'Proteger'}</button>` : ''}</div></div></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div><div class="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">Cambiar un turno lo marca automáticamente como protegido. Reorganizar recalcula solo las casillas libres.</div></div>`;
}

function renderDrafts() {
  const host = document.querySelector(`#${ROOT_ID} [data-role="drafts"]`);
  if (!host || !state.setup) return;
  const drafts = state.setup.borradores || [];
  host.innerHTML = `<div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><div class="mb-3"><h4 class="font-bold text-slate-900">Borradores recientes</h4><p class="mt-1 text-xs text-slate-500">Abre una propuesta para continuarla o revisar una ya publicada.</p></div>${drafts.length ? `<div class="grid gap-2 md:grid-cols-2 xl:grid-cols-3">${drafts.map((draft) => `<button type="button" data-action="open-draft" data-draft-id="${escapeHtml(draft.id)}" class="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-blue-300"><div class="flex items-center justify-between gap-2"><span class="text-sm font-bold text-slate-800">${escapeHtml(formatRange(draft.fecha_inicio, draft.fecha_fin))}</span><span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${draft.estado === 'publicado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'}">${escapeHtml(String(draft.estado).toUpperCase())}</span></div><div class="mt-2 text-xs text-slate-500">${draft.modalidad} h · Calidad ${draft.calidad ?? '—'} · ${draft.validacion?.conflictos?.length || 0} conflicto(s)</div></button>`).join('')}</div>` : '<p class="text-sm text-slate-500">Aún no hay borradores.</p>'}</div>`;
}

function renderAll() {
  renderConfigPanel();
  renderTeamPanel();
  renderGeneratorPanel();
  renderDraftToolbar();
  renderValidation(state.draft?.validacion || null);
  renderCalendar();
  renderDrafts();
}

async function loadSetup({ silent = false } = {}) {
  try {
    if (!silent) setBusy(true, 'Cargando configuración y equipo…');
    const data = await invokeEngine('setup');
    state.setup = data;
    const validIds = new Set((data.usuarios || []).map((user) => user.id));
    state.selectedUsers = new Set([...state.selectedUsers].filter((id) => validIds.has(id)));
    if (!state.selectedUsers.size) (data.usuarios || []).forEach((user) => state.selectedUsers.add(user.id));
    renderAll();
    if (!silent) clearFeedback();
  } catch (error) {
    showFeedback(`No se pudo cargar el creador de horarios: ${error.message}`, 'error');
  } finally {
    if (!silent) setBusy(false);
  }
}

function readConfigForm() {
  const root = document.getElementById(ROOT_ID);
  return {
    modalidad: Number(root.querySelector('[data-config="modalidad"]')?.value || 12),
    descanso_minimo_horas: Number(root.querySelector('[data-config="descanso_minimo_horas"]')?.value || 11),
    max_turnos_consecutivos: Number(root.querySelector('[data-config="max_turnos_consecutivos"]')?.value || 6),
    max_noches_consecutivas: Number(root.querySelector('[data-config="max_noches_consecutivas"]')?.value || 3),
    descansos_minimos_semana: Number(state.setup?.config?.descansos_minimos_semana || 1),
    equilibrar_noches: root.querySelector('[data-config="equilibrar_noches"]')?.checked === true,
    equilibrar_fines_semana: root.querySelector('[data-config="equilibrar_fines_semana"]')?.checked === true,
    permitir_turnos_extendidos: root.querySelector('[data-config="permitir_turnos_extendidos"]')?.checked === true,
  };
}

async function saveConfig() {
  const previousMode = Number(state.setup?.config?.modalidad || 12);
  const payload = readConfigForm();
  try {
    setBusy(true, 'Guardando reglas…');
    const data = await invokeEngine('save_config', { ...payload, restablecer_plantillas: previousMode !== payload.modalidad });
    state.setup = { ...state.setup, config: data.config, templates: data.templates };
    renderAll();
    showFeedback('Reglas guardadas.', 'success');
  } catch (error) { showFeedback(`No se pudieron guardar las reglas: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function saveTemplates() {
  const plantillas = [...document.querySelectorAll(`#${ROOT_ID} [data-template-id]`)].map((row) => ({ id: row.dataset.templateId, hora_inicio: row.querySelector('[data-template-start]')?.value, hora_fin: row.querySelector('[data-template-end]')?.value }));
  try {
    setBusy(true, 'Guardando horas reales…');
    const data = await invokeEngine('save_templates', { plantillas });
    state.setup = { ...state.setup, config: data.config, templates: data.templates };
    renderAll();
    showFeedback('Horas actualizadas.', 'success');
  } catch (error) { showFeedback(`No se pudieron guardar las horas: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function generateDraft() {
  const root = document.getElementById(ROOT_ID);
  const start = root.querySelector('[data-period-start]')?.value;
  const end = root.querySelector('[data-period-end]')?.value;
  const dates = enumerateDates(start, end);
  if (!start || !end || end < start || !dates.length || dates.length > 63) return showFeedback('El rango debe cubrir entre 1 y 63 días.', 'warning');
  if (state.selectedUsers.size < 2) return showFeedback('Selecciona al menos 2 recepcionistas.', 'warning');
  try {
    setBusy(true, `Generando ${dates.length} día(s)…`);
    state.draft = await invokeEngine('generate', { fecha_inicio: start, fecha_fin: end, usuario_ids: [...state.selectedUsers] });
    await loadSetup({ silent: true });
    renderDraftToolbar(); renderValidation(state.draft.validacion); renderCalendar();
    showFeedback('Borrador generado. Puedes editarlo sin afectar el horario publicado.', state.draft.validacion?.conflictos?.length ? 'warning' : 'success');
  } catch (error) { showFeedback(`No se pudo generar el borrador: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function openDraft(draftId) {
  try {
    setBusy(true, 'Abriendo horario…');
    state.draft = await invokeEngine('get_draft', { draft_id: draftId });
    renderDraftToolbar(); renderValidation(state.draft.validacion); renderCalendar();
    showFeedback(currentDraftStatus() === 'publicado' ? 'Horario publicado abierto en modo de solo lectura.' : 'Borrador abierto para edición.', 'info');
  } catch (error) { showFeedback(`No se pudo abrir el borrador: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function validateCurrent() {
  const draftId = currentDraftId();
  if (!draftId) return;
  try {
    setBusy(true, 'Validando reglas…');
    state.draft = await invokeEngine('validate', { draft_id: draftId });
    renderDraftToolbar(); renderValidation(state.draft.validacion); renderCalendar();
    showFeedback(state.draft.validacion?.conflictos?.length ? 'La validación encontró conflictos que debes corregir.' : 'Validación terminada sin conflictos bloqueantes.', state.draft.validacion?.conflictos?.length ? 'warning' : 'success');
  } catch (error) { showFeedback(`No se pudo validar: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function updateAssignment(assignmentId, templateId, locked = true) {
  const draftId = currentDraftId();
  if (!draftId || currentDraftStatus() !== 'borrador') return;
  try {
    setBusy(true, 'Guardando ajuste manual…');
    const data = await invokeEngine('update_assignment', { draft_id: draftId, assignment_id: assignmentId, plantilla_turno_id: templateId || null, bloqueado: locked });
    state.draft = { ...state.draft, asignaciones: data.asignaciones, validacion: data.validacion };
    renderDraftToolbar(); renderValidation(data.validacion); renderCalendar();
    showFeedback(locked ? 'Cambio guardado y protegido para Reorganizar.' : 'Asignación desbloqueada; Reorganizar podrá modificarla.', 'success');
  } catch (error) { showFeedback(`No se pudo guardar el cambio: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function toggleLock(assignmentId) {
  const row = state.draft?.asignaciones?.find((item) => item.id === assignmentId);
  if (!row) return;
  await updateAssignment(assignmentId, row.plantilla_turno_id, !row.bloqueado);
}

async function reorganizeCurrent() {
  const draftId = currentDraftId();
  if (!draftId || currentDraftStatus() !== 'borrador') return;
  const locked = state.draft?.asignaciones?.filter((item) => item.bloqueado).length || 0;
  const accepted = window.Swal?.fire ? (await window.Swal.fire({ title: '¿Reorganizar turnos libres?', text: `${locked} asignación(es) protegida(s) se conservarán sin cambios.`, icon: 'question', showCancelButton: true, confirmButtonText: 'Sí, reorganizar', cancelButtonText: 'Cancelar' })).isConfirmed : window.confirm(`Se conservarán ${locked} asignación(es) protegida(s). ¿Reorganizar las demás?`);
  if (!accepted) return;
  try {
    setBusy(true, 'Reorganizando únicamente las casillas libres…');
    state.draft = await invokeEngine('reorganize', { draft_id: draftId });
    await loadSetup({ silent: true });
    renderDraftToolbar(); renderValidation(state.draft.validacion); renderCalendar();
    showFeedback('Horario reorganizado. Las asignaciones protegidas se conservaron.', state.draft.validacion?.conflictos?.length ? 'warning' : 'success');
  } catch (error) { showFeedback(`No se pudo reorganizar: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

async function publishCurrent() {
  const draftId = currentDraftId();
  if (!draftId || currentDraftStatus() !== 'borrador') return;
  const conflicts = state.draft?.validacion?.conflictos?.length || 0;
  const warnings = state.draft?.validacion?.advertencias?.length || 0;
  if (conflicts) return showFeedback(`No se puede publicar: quedan ${conflicts} conflicto(s).`, 'error');
  const accepted = window.Swal?.fire ? (await window.Swal.fire({ title: 'Publicar horario', html: `Este borrador reemplazará el horario publicado para este rango.<br><b>${warnings} advertencia(s)</b> permanecerán registradas en la validación.`, icon: warnings ? 'warning' : 'question', showCancelButton: true, confirmButtonText: 'Publicar horario', cancelButtonText: 'Cancelar', confirmButtonColor: '#059669' })).isConfirmed : window.confirm(`¿Publicar este horario? Tiene ${warnings} advertencia(s).`);
  if (!accepted) return;
  try {
    setBusy(true, 'Validando y publicando de forma atómica…');
    await invokeEngine('publish', { draft_id: draftId });
    state.draft = await invokeEngine('get_draft', { draft_id: draftId });
    await loadSetup({ silent: true });
    renderDraftToolbar(); renderValidation(state.draft.validacion); renderCalendar();
    showFeedback('Horario publicado correctamente. El borrador quedó bloqueado para edición.', 'success');
  } catch (error) { showFeedback(`No se pudo publicar: ${error.message}`, 'error'); }
  finally { setBusy(false); }
}

function updateSelectedUsers(root) {
  state.selectedUsers = new Set([...root.querySelectorAll('[data-user-checkbox]:checked')].map((input) => input.value));
  const count = root.querySelector('[data-role="selected-count"]');
  if (count) count.textContent = String(state.selectedUsers.size);
}

async function handleClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || state.busy) return;
  const action = button.dataset.action;
  if (action === 'refresh') return loadSetup();
  if (action === 'save-config') return saveConfig();
  if (action === 'save-templates') return saveTemplates();
  if (action === 'generate') return generateDraft();
  if (action === 'validate') return validateCurrent();
  if (action === 'reorganize') return reorganizeCurrent();
  if (action === 'publish') return publishCurrent();
  if (action === 'open-draft') return openDraft(button.dataset.draftId);
  if (action === 'toggle-lock') return toggleLock(button.dataset.assignmentId);
  if (action === 'period') { state.periodMode = button.dataset.period; renderGeneratorPanel(); return; }
  const root = document.getElementById(ROOT_ID);
  if (action === 'select-all') { root.querySelectorAll('[data-user-checkbox]').forEach((input) => { input.checked = true; }); updateSelectedUsers(root); }
  if (action === 'select-none') { root.querySelectorAll('[data-user-checkbox]').forEach((input) => { input.checked = false; }); updateSelectedUsers(root); }
}

async function handleChange(event) {
  const root = document.getElementById(ROOT_ID);
  if (!root || state.busy) return;
  if (event.target.matches('[data-user-checkbox]')) updateSelectedUsers(root);
  if (event.target.matches('[data-period-start], [data-period-end]')) state.periodMode = 'custom';
  if (event.target.matches('[data-assignment-shift]')) {
    const cell = event.target.closest('[data-assignment-id]');
    if (cell) await updateAssignment(cell.dataset.assignmentId, event.target.value || null, true);
  }
}

function hideLegacy() {
  const legacyConfig = document.getElementById(LEGACY_CONFIG_ID);
  const legacySchedule = document.getElementById(LEGACY_SCHEDULE_ID);
  if (legacyConfig) legacyConfig.style.display = 'none';
  if (legacySchedule) legacySchedule.style.display = 'none';
  return legacyConfig;
}

function install() {
  const anchor = hideLegacy();
  if (!anchor || document.getElementById(ROOT_ID)) return;
  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.dataset.phase = '3';
  anchor.parentNode.insertBefore(root, anchor);
  renderShell(root);
  renderGeneratorPanel();
  renderCalendar();
  root.addEventListener('click', handleClick);
  root.addEventListener('change', handleChange);
  loadSetup();
}

const observer = new MutationObserver(() => install());
observer.observe(document.documentElement, { childList: true, subtree: true });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
else install();
