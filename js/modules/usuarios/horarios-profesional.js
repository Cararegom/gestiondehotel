let root = null;
let supabase = null;
let user = null;
let hotelId = null;
let configHost = null;
let scheduleHost = null;
let periodMode = 'semana';
let anchorDate = new Date().toISOString().slice(0, 10);
let state = {
  config: null,
  turnos: [],
  trabajadores: [],
  solicitudes: [],
  horarios: [],
  horario: null,
  dias: [],
  asignaciones: [],
  validacion: { criticos: [], advertencias: [], metricas: {} },
  calidad: null,
};

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseDate(value) {
  const [y, m, d] = String(value).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value, amount) {
  const date = parseDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return iso(date);
}

function weekRange(value = anchorDate) {
  const date = parseDate(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  const start = iso(date);
  return { start, end: addDays(start, 6) };
}

function monthRange(value = anchorDate) {
  const date = parseDate(value);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
  return { start: iso(start), end: iso(end) };
}

function activeRange() {
  return periodMode === 'mes' ? monthRange() : weekRange();
}

function formatDate(value, options = { weekday: 'short', day: '2-digit' }) {
  return new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', ...options }).format(parseDate(value)).replace('.', '');
}

function formatTime(value) {
  return String(value || '').slice(0, 5);
}

async function invoke(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('schedule-generator-v2', {
    body: { action, hotel_id: hotelId, ...payload },
  });
  if (error) throw error;
  if (data?.error) {
    const err = new Error(data.error);
    err.code = data.code;
    err.validation = data.validacion;
    throw err;
  }
  return data;
}

function toast(message, type = 'info') {
  const host = scheduleHost?.querySelector('#horario-v2-feedback') || configHost?.querySelector('#horario-v2-config-feedback');
  if (!host) return;
  const classes = type === 'error'
    ? 'border-red-200 bg-red-50 text-red-800'
    : type === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-blue-200 bg-blue-50 text-blue-800';
  host.className = `mt-3 rounded-xl border p-3 text-sm font-semibold ${classes}`;
  host.textContent = message;
  host.hidden = false;
  window.setTimeout(() => { if (host.textContent === message) host.hidden = true; }, 5000);
}

function setBusy(button, busy, label = 'Procesando...') {
  if (!button) return;
  if (busy) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
  }
}

function renderConfiguration() {
  if (!configHost || !state.config) return;
  const operation = Number(state.config.tipo_operacion || 8);
  configHost.innerHTML = `
    <section class="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="text-lg font-black text-slate-900">⚙️ Reglas del creador de horarios</h3>
          <p class="mt-1 text-sm text-slate-600">Cada hotel define su operación. El motor calcula descansos usando las horas reales de los turnos.</p>
        </div>
        <span class="rounded-full bg-white px-3 py-1 text-xs font-black text-blue-700 shadow-sm">Motor v2 · Supabase</span>
      </div>

      <div class="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="text-sm font-bold text-slate-700">Operación
          <select id="hv2-operation" class="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5">
            <option value="8" ${operation === 8 ? 'selected' : ''}>3 turnos / operación 8h</option>
            <option value="12" ${operation === 12 ? 'selected' : ''}>2 turnos / operación 12h</option>
          </select>
        </label>
        <label class="text-sm font-bold text-slate-700">Descanso mínimo entre turnos
          <div class="mt-1 flex items-center gap-2"><input id="hv2-rest-hours" type="number" min="8" max="24" value="${Number(state.config.descanso_minimo_horas || 12)}" class="w-full rounded-xl border border-slate-200 bg-white p-2.5"><span class="text-xs text-slate-500">horas</span></div>
        </label>
        <label class="text-sm font-bold text-slate-700">Descansos mínimos / semana
          <input id="hv2-rest-days" type="number" min="1" max="6" value="${Number(state.config.dias_descanso_semana || 1)}" class="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5">
        </label>
        <label class="text-sm font-bold text-slate-700">Máximo noches consecutivas
          <input id="hv2-max-nights" type="number" min="1" max="7" value="${Number(state.config.max_noches_consecutivas || 2)}" class="mt-1 w-full rounded-xl border border-slate-200 bg-white p-2.5">
        </label>
      </div>

      <div class="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-slate-700">
        <label class="flex items-center gap-2"><input id="hv2-balance-nights" type="checkbox" ${state.config.balancear_noches !== false ? 'checked' : ''}> Equilibrar noches</label>
        <label class="flex items-center gap-2"><input id="hv2-balance-weekends" type="checkbox" ${state.config.balancear_fines_semana !== false ? 'checked' : ''}> Equilibrar fines de semana</label>
        <label id="hv2-relay-label" class="flex items-center gap-2 ${operation === 8 ? '' : 'hidden'}"><input id="hv2-relay" type="checkbox" ${state.config.permitir_relevo_extendido !== false ? 'checked' : ''}> Permitir relevo extendido 12h para cubrir descansos</label>
      </div>

      <div class="mt-5">
        <div class="flex items-center justify-between gap-3">
          <div><h4 class="font-black text-slate-800">Horas reales de los turnos</h4><p class="text-xs text-slate-500">Estas horas son las que usa la regla Noche → siguiente turno.</p></div>
        </div>
        <div id="hv2-shift-grid" class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          ${state.turnos.map((turno) => `
            <div class="rounded-xl border border-slate-200 bg-white p-3" data-shift-code="${esc(turno.codigo)}">
              <div class="flex items-center justify-between gap-2">
                <strong class="text-sm text-slate-900">${esc(turno.nombre)}</strong>
                <span class="rounded-full px-2 py-1 text-[10px] font-black ${turno.modo_cobertura === 'relevo' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'}">${turno.modo_cobertura === 'relevo' ? 'RELEVO' : 'NORMAL'}</span>
              </div>
              <div class="mt-2 grid grid-cols-2 gap-2">
                <label class="text-[11px] font-bold text-slate-500">Inicio<input data-shift-start type="time" value="${formatTime(turno.hora_inicio)}" class="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"></label>
                <label class="text-[11px] font-bold text-slate-500">Fin<input data-shift-end type="time" value="${formatTime(turno.hora_fin)}" class="mt-1 w-full rounded-lg border border-slate-200 p-2 text-sm"></label>
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div id="horario-v2-config-feedback" hidden></div>
      <button id="hv2-save-config" type="button" class="mt-4 rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-800">Guardar reglas</button>
    </section>`;

  const operationSelect = configHost.querySelector('#hv2-operation');
  operationSelect?.addEventListener('change', () => {
    configHost.querySelector('#hv2-relay-label')?.classList.toggle('hidden', Number(operationSelect.value) !== 8);
  });
  configHost.querySelector('#hv2-save-config')?.addEventListener('click', saveConfiguration);
}

async function saveConfiguration(event) {
  const button = event.currentTarget;
  setBusy(button, true, 'Guardando...');
  try {
    const previousOperation = Number(state.config.tipo_operacion);
    const operation = Number(configHost.querySelector('#hv2-operation').value);
    const payload = {
      config: {
        tipo_operacion: operation,
        descanso_minimo_horas: Number(configHost.querySelector('#hv2-rest-hours').value),
        dias_descanso_semana: Number(configHost.querySelector('#hv2-rest-days').value),
        max_noches_consecutivas: Number(configHost.querySelector('#hv2-max-nights').value),
        balancear_noches: configHost.querySelector('#hv2-balance-nights').checked,
        balancear_fines_semana: configHost.querySelector('#hv2-balance-weekends').checked,
        permitir_relevo_extendido: operation === 8 && configHost.querySelector('#hv2-relay')?.checked === true,
      },
    };
    if (previousOperation === operation) {
      payload.turnos = state.turnos.map((turno) => {
        const card = configHost.querySelector(`[data-shift-code="${CSS.escape(turno.codigo)}"]`);
        return {
          ...turno,
          hora_inicio: card?.querySelector('[data-shift-start]')?.value || formatTime(turno.hora_inicio),
          hora_fin: card?.querySelector('[data-shift-end]')?.value || formatTime(turno.hora_fin),
        };
      });
    }
    const result = await invoke('configure', payload);
    state.config = result.config;
    state.turnos = result.turnos || [];
    renderConfiguration();
    renderScheduleShell();
    toast('Reglas guardadas. El siguiente horario usará esta configuración.', 'success');
  } catch (error) {
    toast(`No se pudo guardar: ${error.message}`, 'error');
  } finally {
    setBusy(button, false);
  }
}

function workerChecks() {
  return state.trabajadores.map((worker) => `
    <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" data-hv2-worker value="${esc(worker.id)}" checked>
      <span>${esc(worker.nombre)}</span>
      ${worker.evita_turno_noche ? '<span title="Evita noche" class="text-xs">🌙🚫</span>' : ''}
      ${worker.prefiere_turno_dia ? '<span title="Prefiere día" class="text-xs">☀️</span>' : ''}
    </label>`).join('');
}

function recentScheduleOptions() {
  const drafts = state.horarios || [];
  if (!drafts.length) return '<option value="">Sin borradores recientes</option>';
  return '<option value="">Abrir borrador...</option>' + drafts.map((item) => `
    <option value="${esc(item.id)}">${item.estado === 'publicado' ? 'Publicado' : 'Borrador'} · ${esc(item.fecha_inicio)} → ${esc(item.fecha_fin)}${item.calidad != null ? ` · ${item.calidad}/100` : ''}</option>`).join('');
}

function renderScheduleShell() {
  if (!scheduleHost) return;
  const range = activeRange();
  scheduleHost.innerHTML = `
    <section class="mt-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div class="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-black text-slate-900">🗓️ Creador profesional de horarios</h3><span class="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-black text-emerald-700">Sin PC externa</span></div>
          <p class="mt-1 text-sm text-slate-500">Genera un borrador, corrige o bloquea celdas, reorganiza y publica solo cuando no existan conflictos críticos.</p>
        </div>
        <select id="hv2-open-schedule" class="max-w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">${recentScheduleOptions()}</select>
      </div>

      <div class="mt-4 grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
        <div class="flex rounded-xl bg-slate-100 p-1">
          <button data-period="semana" class="hv2-period rounded-lg px-4 py-2 text-sm font-black ${periodMode === 'semana' ? 'bg-white shadow text-blue-700' : 'text-slate-500'}">Semana</button>
          <button data-period="mes" class="hv2-period rounded-lg px-4 py-2 text-sm font-black ${periodMode === 'mes' ? 'bg-white shadow text-blue-700' : 'text-slate-500'}">Mes</button>
        </div>
        <label class="text-sm font-bold text-slate-700">${periodMode === 'mes' ? 'Mes a generar' : 'Selecciona un día de la semana'}
          ${periodMode === 'mes'
            ? `<input id="hv2-anchor-month" type="month" value="${anchorDate.slice(0,7)}" class="mt-1 w-full rounded-xl border border-slate-200 p-2.5">`
            : `<input id="hv2-anchor-date" type="date" value="${anchorDate}" class="mt-1 w-full rounded-xl border border-slate-200 p-2.5">`}
        </label>
        <div class="rounded-xl border border-blue-100 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-800">${formatDate(range.start, { day: '2-digit', month: 'short' })} → ${formatDate(range.end, { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <div class="mt-4">
        <p class="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Recepcionistas que participan</p>
        <div id="hv2-workers" class="flex flex-wrap gap-2">${workerChecks() || '<p class="text-sm text-red-700">No hay recepcionistas activas.</p>'}</div>
      </div>

      <details class="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
        <summary class="cursor-pointer text-sm font-black text-slate-800">📌 Solicitudes, permisos y preferencias</summary>
        <div class="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
          <select id="hv2-request-user" class="rounded-xl border border-slate-200 bg-white p-2.5 text-sm"><option value="">Recepcionista</option>${state.trabajadores.map((w) => `<option value="${esc(w.id)}">${esc(w.nombre)}</option>`).join('')}</select>
          <input id="hv2-request-date" type="date" value="${range.start}" class="rounded-xl border border-slate-200 bg-white p-2.5 text-sm">
          <select id="hv2-request-type" class="rounded-xl border border-slate-200 bg-white p-2.5 text-sm">
            <option value="descanso">Descanso solicitado</option><option value="no_disponible">No disponible</option><option value="prefiere_dia">Prefiere día</option><option value="prefiere_noche">Prefiere noche</option>
          </select>
          <label class="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold"><input id="hv2-request-required" type="checkbox"> Obligatoria</label>
          <button id="hv2-add-request" class="rounded-xl bg-slate-800 px-3 py-2.5 text-sm font-black text-white">Agregar</button>
        </div>
        <div id="hv2-request-list" class="mt-3 flex flex-wrap gap-2">${renderRequestChips(range)}</div>
      </details>

      <div class="mt-4 flex flex-wrap gap-2">
        <button id="hv2-generate" class="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-black text-white">✨ Generar borrador</button>
        <button id="hv2-reorganize" ${state.horario?.estado === 'borrador' ? '' : 'disabled'} class="rounded-xl border border-violet-300 bg-violet-50 px-4 py-2.5 text-sm font-black text-violet-800 disabled:opacity-40">🔄 Reorganizar</button>
        <button id="hv2-validate" ${state.horario ? '' : 'disabled'} class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-40">✓ Validar</button>
        <button id="hv2-publish" ${state.horario?.estado === 'borrador' ? '' : 'disabled'} class="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-black text-white disabled:opacity-40">Publicar horario</button>
        <button id="hv2-print" ${state.horario ? '' : 'disabled'} class="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-black text-slate-700 disabled:opacity-40">🖨️ Imprimir</button>
      </div>
      <div id="horario-v2-feedback" hidden></div>
      <div id="hv2-status" class="mt-4">${renderStatus()}</div>
      <div id="hv2-grid" class="mt-4">${renderGrid()}</div>
    </section>`;

  bindScheduleEvents();
}

function renderRequestChips(range) {
  const workers = new Map(state.trabajadores.map((w) => [w.id, w.nombre]));
  const rows = (state.solicitudes || []).filter((r) => r.fecha >= range.start && r.fecha <= range.end);
  if (!rows.length) return '<span class="text-xs text-slate-500">No hay solicitudes en este periodo.</span>';
  return rows.map((r) => `<span class="inline-flex items-center gap-2 rounded-full ${r.obligatoria ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'} px-3 py-1.5 text-xs font-bold">${esc(workers.get(r.usuario_id) || 'Recepcionista')} · ${esc(r.fecha.slice(5))} · ${esc(r.tipo.replaceAll('_',' '))}${r.obligatoria ? ' · obligatoria' : ''}<button data-delete-request="${esc(r.id)}" title="Quitar">×</button></span>`).join('');
}

function renderStatus() {
  if (!state.horario) return '<div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Todavía no hay un borrador abierto.</div>';
  const criticals = state.validacion?.criticos || [];
  const warnings = state.validacion?.advertencias || [];
  const quality = state.calidad ?? state.horario.calidad ?? 0;
  const published = state.horario.estado === 'publicado';
  return `
    <div class="grid gap-3 md:grid-cols-[180px_1fr]">
      <div class="rounded-2xl border ${criticals.length ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'} p-4 text-center">
        <p class="text-xs font-black uppercase tracking-wide ${criticals.length ? 'text-red-600' : 'text-emerald-600'}">Calidad</p><p class="mt-1 text-3xl font-black ${criticals.length ? 'text-red-800' : 'text-emerald-800'}">${Number(quality)}/100</p>
        <p class="mt-1 text-xs font-bold text-slate-600">${published ? 'PUBLICADO' : 'BORRADOR'}</p>
      </div>
      <div class="space-y-2">
        ${criticals.length ? `<div class="rounded-xl border border-red-200 bg-red-50 p-3"><p class="text-sm font-black text-red-800">⛔ ${criticals.length} conflicto(s) crítico(s)</p>${criticals.slice(0,6).map((c) => `<p class="mt-1 text-xs text-red-700">• ${esc(c.mensaje || c.codigo)}</p>`).join('')}</div>` : '<div class="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-black text-emerald-800">✅ Sin conflictos críticos. Puede publicarse.</div>'}
        ${warnings.length ? `<div class="rounded-xl border border-amber-200 bg-amber-50 p-3"><p class="text-sm font-black text-amber-800">⚠️ ${warnings.length} recomendación(es)</p>${warnings.slice(0,4).map((w) => `<p class="mt-1 text-xs text-amber-700">• ${esc(w.mensaje || w.codigo)}</p>`).join('')}</div>` : ''}
      </div>
    </div>`;
}

function shiftLabel(code) {
  if (!code) return 'Descanso';
  return state.turnos.find((turno) => turno.codigo === code)?.nombre || code;
}

function cellClass(code) {
  if (!code) return 'bg-emerald-50 text-emerald-800';
  const shift = state.turnos.find((turno) => turno.codigo === code);
  if (shift?.es_nocturno) return 'bg-indigo-50 text-indigo-900';
  if (shift?.es_extendido) return 'bg-violet-50 text-violet-900';
  return 'bg-blue-50 text-blue-900';
}

function renderGrid() {
  if (!state.horario || !state.dias?.length) return '';
  const published = state.horario.estado === 'publicado';
  const dayMap = new Map(state.dias.map((d) => [d.fecha, d]));
  const assignmentMap = new Map(state.asignaciones.map((a) => [`${a.fecha}|${a.usuario_id}`, a]));
  const dates = state.dias.map((d) => d.fecha);
  return `
    <div class="overflow-x-auto rounded-xl border border-slate-200">
      <table id="hv2-table" class="w-full min-w-[900px] border-collapse text-sm">
        <thead class="bg-slate-100"><tr><th class="sticky left-0 z-10 bg-slate-100 p-3 text-left">Recepcionista</th>${dates.map((date) => `<th class="min-w-[135px] p-2 text-center"><div class="font-black capitalize">${esc(formatDate(date))}</div><div class="mt-1 text-[10px] font-bold ${dayMap.get(date)?.modo_cobertura === 'relevo' ? 'text-violet-700' : 'text-slate-500'}">${dayMap.get(date)?.modo_cobertura === 'relevo' ? 'RELEVO 12H' : 'NORMAL'}</div></th>`).join('')}</tr></thead>
        <tbody class="divide-y divide-slate-200">
          ${state.trabajadores.filter((w) => state.asignaciones.some((a) => a.usuario_id === w.id)).map((worker) => `<tr><td class="sticky left-0 z-10 whitespace-nowrap bg-white p-3 font-black text-slate-800">${esc(worker.nombre)}</td>${dates.map((date) => {
            const row = assignmentMap.get(`${date}|${worker.id}`);
            const mode = dayMap.get(date)?.modo_cobertura || 'normal';
            const options = state.turnos.filter((t) => t.modo_cobertura === mode && t.activo !== false);
            return `<td class="p-1.5 align-top"><div class="rounded-xl ${cellClass(row?.turno_codigo)} p-1.5" data-cell="${esc(date)}|${esc(worker.id)}"><select data-assignment ${published ? 'disabled' : ''} class="w-full rounded-lg border-0 bg-transparent p-1.5 text-xs font-black focus:ring-2 focus:ring-blue-500"><option value="descanso" ${!row?.turno_codigo ? 'selected' : ''}>✔️ Descanso</option>${options.map((shift) => `<option value="${esc(shift.codigo)}" ${row?.turno_codigo === shift.codigo ? 'selected' : ''}>${esc(shift.nombre)}</option>`).join('')}</select><div class="mt-1 flex items-center justify-between"><span class="text-[9px] font-bold opacity-60">${row?.origen === 'auto' ? 'AUTO' : row?.origen === 'bloqueado' ? 'FIJO' : 'MANUAL'}</span>${published ? '' : `<button data-lock title="${row?.bloqueado ? 'Desbloquear' : 'Bloquear para que Reorganizar no cambie'}" class="rounded px-1.5 py-0.5 text-xs ${row?.bloqueado ? 'bg-slate-800 text-white' : 'bg-white/70'}">${row?.bloqueado ? '🔒' : '🔓'}</button>`}</div></div></td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${renderMetrics()}`;
}

function renderMetrics() {
  const people = state.validacion?.metricas?.personas || [];
  if (!people.length) return '';
  return `<div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">${people.map((p) => `<div class="rounded-xl border border-slate-200 bg-slate-50 p-3"><p class="truncate text-sm font-black text-slate-800">${esc(p.nombre)}</p><p class="mt-1 text-xs text-slate-500">${Number(p.horas || 0).toFixed(1)}h · ${Number(p.noches || 0)} noches · ${Number(p.descansos || 0)} descansos</p></div>`).join('')}</div>`;
}

function selectedWorkerIds() {
  return [...scheduleHost.querySelectorAll('[data-hv2-worker]:checked')].map((input) => input.value);
}

async function refreshBootstrap() {
  const range = activeRange();
  const result = await invoke('bootstrap', { fecha_inicio: range.start, fecha_fin: range.end });
  state.config = result.config;
  state.turnos = result.turnos || [];
  state.trabajadores = result.trabajadores || [];
  state.solicitudes = result.solicitudes || [];
  state.horarios = result.horarios || [];
}

async function generate(event) {
  const button = event.currentTarget;
  const range = activeRange();
  const workers = selectedWorkerIds();
  if (!workers.length) return toast('Selecciona al menos una recepcionista.', 'error');
  setBusy(button, true, 'Generando...');
  try {
    const result = await invoke('generate', { fecha_inicio: range.start, fecha_fin: range.end, periodo: periodMode, usuarios: workers });
    applyScheduleResult(result);
    await refreshBootstrap();
    renderScheduleShell();
    toast(result.validacion?.criticos?.length ? 'Borrador generado con conflictos por revisar.' : 'Borrador generado y validado.', result.validacion?.criticos?.length ? 'info' : 'success');
  } catch (error) {
    toast(`No se pudo generar: ${error.message}`, 'error');
  } finally { setBusy(button, false); }
}

function applyScheduleResult(result) {
  state.horario = result.horario || result.schedule || state.horario;
  state.dias = result.dias || state.dias;
  state.asignaciones = result.asignaciones || state.asignaciones;
  state.validacion = result.validacion || state.validacion;
  state.calidad = result.calidad ?? state.calidad;
  if (result.trabajadores) state.trabajadores = result.trabajadores;
  if (result.turnos) state.turnos = result.turnos;
}

async function loadSchedule(id) {
  if (!id) return;
  try {
    const result = await invoke('get', { horario_id: id });
    state.horario = result.horario;
    state.dias = result.dias || [];
    state.asignaciones = result.asignaciones || [];
    state.trabajadores = result.trabajadores || state.trabajadores;
    state.turnos = result.turnos || state.turnos;
    state.solicitudes = result.solicitudes || state.solicitudes;
    state.validacion = result.horario?.validacion || { criticos: [], advertencias: [], metricas: {} };
    state.calidad = result.horario?.calidad;
    periodMode = result.horario.periodo === 'mes' ? 'mes' : 'semana';
    anchorDate = result.horario.fecha_inicio;
    renderConfiguration();
    renderScheduleShell();
  } catch (error) { toast(`No se pudo abrir el horario: ${error.message}`, 'error'); }
}

async function reorganize(event) {
  if (!state.horario?.id) return;
  const button = event.currentTarget;
  setBusy(button, true, 'Reorganizando...');
  try {
    const result = await invoke('reorganize', { horario_id: state.horario.id });
    applyScheduleResult(result);
    renderScheduleShell();
    toast('Horario reorganizado. Los turnos con 🔒 se conservaron.', 'success');
  } catch (error) { toast(`No se pudo reorganizar: ${error.message}`, 'error'); }
  finally { setBusy(button, false); }
}

async function validate(event) {
  if (!state.horario?.id) return;
  const button = event.currentTarget;
  setBusy(button, true, 'Validando...');
  try {
    const result = await invoke('validate', { horario_id: state.horario.id });
    state.validacion = result.validacion;
    state.calidad = result.calidad;
    state.asignaciones = result.asignaciones || state.asignaciones;
    renderScheduleShell();
    toast(result.validacion?.criticos?.length ? 'Hay conflictos críticos por resolver.' : 'Horario válido para publicar.', result.validacion?.criticos?.length ? 'info' : 'success');
  } catch (error) { toast(`No se pudo validar: ${error.message}`, 'error'); }
  finally { setBusy(button, false); }
}

async function publish(event) {
  if (!state.horario?.id) return;
  const criticals = state.validacion?.criticos || [];
  if (criticals.length) return toast('Primero resuelve los conflictos críticos.', 'error');
  if (!window.confirm('¿Publicar este horario? Reemplazará la programación publicada del mismo hotel para este rango de fechas.')) return;
  const button = event.currentTarget;
  setBusy(button, true, 'Publicando...');
  try {
    const result = await invoke('publish', { horario_id: state.horario.id });
    state.horario = result.horario;
    state.validacion = result.validacion;
    state.calidad = result.calidad;
    await refreshBootstrap();
    renderScheduleShell();
    toast('Horario publicado. Ya quedó disponible en la programación operativa.', 'success');
  } catch (error) {
    if (error.validation) state.validacion = error.validation;
    toast(`No se pudo publicar: ${error.message}`, 'error');
  } finally { setBusy(button, false); }
}

async function changeAssignment(select) {
  const cell = select.closest('[data-cell]');
  const [fecha, usuarioId] = cell.dataset.cell.split('|');
  select.disabled = true;
  try {
    const result = await invoke('set_assignment', { horario_id: state.horario.id, fecha, usuario_id: usuarioId, turno_codigo: select.value });
    state.asignaciones = result.asignaciones || state.asignaciones;
    state.validacion = result.validacion || state.validacion;
    state.calidad = result.calidad ?? state.calidad;
    renderScheduleShell();
  } catch (error) {
    toast(error.message, 'error');
    const result = await invoke('get', { horario_id: state.horario.id });
    state.asignaciones = result.asignaciones || [];
    renderScheduleShell();
  }
}

async function toggleLock(button) {
  const cell = button.closest('[data-cell]');
  const [fecha, usuarioId] = cell.dataset.cell.split('|');
  const row = state.asignaciones.find((a) => a.fecha === fecha && a.usuario_id === usuarioId);
  if (!row) return;
  button.disabled = true;
  try {
    await invoke('toggle_lock', { horario_id: state.horario.id, fecha, usuario_id: usuarioId, bloqueado: !row.bloqueado });
    row.bloqueado = !row.bloqueado;
    row.origen = row.bloqueado ? 'bloqueado' : 'manual';
    renderScheduleShell();
  } catch (error) { toast(error.message, 'error'); button.disabled = false; }
}

async function addRequest(event) {
  const button = event.currentTarget;
  const worker = scheduleHost.querySelector('#hv2-request-user').value;
  const fecha = scheduleHost.querySelector('#hv2-request-date').value;
  const tipo = scheduleHost.querySelector('#hv2-request-type').value;
  if (!worker || !fecha) return toast('Selecciona recepcionista y fecha.', 'error');
  setBusy(button, true, 'Agregando...');
  try {
    await invoke('save_request', { usuario_id: worker, fecha, tipo, obligatoria: scheduleHost.querySelector('#hv2-request-required').checked });
    await refreshBootstrap();
    renderScheduleShell();
    toast('Solicitud agregada. Se aplicará al generar o reorganizar.', 'success');
  } catch (error) { toast(error.message, 'error'); }
  finally { setBusy(button, false); }
}

async function deleteRequest(id) {
  try {
    await invoke('delete_request', { solicitud_id: id });
    await refreshBootstrap();
    renderScheduleShell();
  } catch (error) { toast(error.message, 'error'); }
}

function printSchedule() {
  const table = scheduleHost.querySelector('#hv2-table');
  if (!table) return;
  const clone = table.cloneNode(true);
  clone.querySelectorAll('select').forEach((select) => {
    const text = select.options[select.selectedIndex]?.textContent || '';
    select.replaceWith(document.createTextNode(text));
  });
  clone.querySelectorAll('[data-lock]').forEach((button) => button.remove());
  const popup = window.open('', '_blank');
  if (!popup) return toast('El navegador bloqueó la ventana de impresión.', 'error');
  popup.document.write(`<html><head><title>Horario ${esc(state.horario.fecha_inicio)} - ${esc(state.horario.fecha_fin)}</title><style>body{font-family:Arial,sans-serif;padding:20px}h1{font-size:20px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #bbb;padding:6px;text-align:center}th{background:#f1f5f9}td:first-child,th:first-child{text-align:left;font-weight:bold}</style></head><body><h1>Horario de recepción · ${esc(state.horario.fecha_inicio)} → ${esc(state.horario.fecha_fin)}</h1>${clone.outerHTML}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

function bindScheduleEvents() {
  scheduleHost.querySelectorAll('.hv2-period').forEach((button) => button.addEventListener('click', async () => {
    periodMode = button.dataset.period;
    state.horario = null; state.dias = []; state.asignaciones = []; state.calidad = null;
    await refreshBootstrap();
    renderScheduleShell();
  }));
  scheduleHost.querySelector('#hv2-anchor-date')?.addEventListener('change', async (event) => { anchorDate = event.target.value; await refreshBootstrap(); renderScheduleShell(); });
  scheduleHost.querySelector('#hv2-anchor-month')?.addEventListener('change', async (event) => { anchorDate = `${event.target.value}-01`; await refreshBootstrap(); renderScheduleShell(); });
  scheduleHost.querySelector('#hv2-open-schedule')?.addEventListener('change', (event) => loadSchedule(event.target.value));
  scheduleHost.querySelector('#hv2-generate')?.addEventListener('click', generate);
  scheduleHost.querySelector('#hv2-reorganize')?.addEventListener('click', reorganize);
  scheduleHost.querySelector('#hv2-validate')?.addEventListener('click', validate);
  scheduleHost.querySelector('#hv2-publish')?.addEventListener('click', publish);
  scheduleHost.querySelector('#hv2-print')?.addEventListener('click', printSchedule);
  scheduleHost.querySelector('#hv2-add-request')?.addEventListener('click', addRequest);
  scheduleHost.querySelectorAll('[data-delete-request]').forEach((button) => button.addEventListener('click', () => deleteRequest(button.dataset.deleteRequest)));
  scheduleHost.querySelectorAll('[data-assignment]').forEach((select) => select.addEventListener('change', () => changeAssignment(select)));
  scheduleHost.querySelectorAll('[data-lock]').forEach((button) => button.addEventListener('click', () => toggleLock(button)));
}

export async function mountHorarioProfesional(container, sbInstance, currentUser, currentHotelId) {
  root = container;
  supabase = sbInstance;
  user = currentUser;
  hotelId = currentHotelId;
  configHost = container?.querySelector('#configuracion-global-turnos-container');
  scheduleHost = container?.querySelector('#horario-turnos-semanal');
  if (!configHost || !scheduleHost || !supabase || !hotelId) return;

  configHost.innerHTML = '<div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Cargando reglas del creador...</div>';
  scheduleHost.innerHTML = '<div class="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">Cargando creador de horarios...</div>';
  try {
    await refreshBootstrap();
    renderConfiguration();
    renderScheduleShell();
  } catch (error) {
    console.error('[Horarios v2]', error);
    scheduleHost.innerHTML = `<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>No se pudo cargar el creador de horarios.</strong><div class="mt-1">${esc(error.message)}</div></div>`;
  }
}

export function unmountHorarioProfesional() {
  root = null;
  supabase = null;
  user = null;
  hotelId = null;
  configHost = null;
  scheduleHost = null;
  state = { config: null, turnos: [], trabajadores: [], solicitudes: [], horarios: [], horario: null, dias: [], asignaciones: [], validacion: { criticos: [], advertencias: [], metricas: {} }, calidad: null };
}
