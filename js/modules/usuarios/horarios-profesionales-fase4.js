import './horarios-profesionales-fase3.js';
import { supabase } from '../../supabaseClient.js';

const ROOT_ID = 'horarios-profesionales-root';
const AUTO_ID = 'horarios-fase4-automatizacion';
const REQUESTS_ID = 'horarios-fase4-solicitudes';
const state = {
  data: null,
  loading: false,
  bootstrapped: false,
  enhanceQueued: false,
  refreshedAfterAuto: false,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function parseLocalDate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(parseLocalDate(value))
    .replace(/\./g, '');
}

function addDays(value, amount) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + amount);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

async function invokeOperations(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke('horario-operations', {
    body: { action, ...payload },
  });
  if (error) {
    let message = error.message || 'No se pudo completar la operación de horarios.';
    try {
      const context = error.context;
      if (context && typeof context.json === 'function') {
        const body = await context.json();
        message = body?.error || message;
      }
    } catch {
      // Conserva el mensaje original del SDK.
    }
    throw new Error(message);
  }
  if (!data?.ok) throw new Error(data?.error || 'La operación de horarios respondió con un error.');
  return data;
}

function feedback(message, kind = 'info') {
  const root = document.getElementById(ROOT_ID);
  const host = root?.querySelector('[data-role="feedback"]');
  if (!host) return;
  const classes = {
    info: 'border-blue-200 bg-blue-50 text-blue-800',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-red-200 bg-red-50 text-red-800',
  };
  host.className = `rounded-xl border px-4 py-3 text-sm ${classes[kind] || classes.info}`;
  host.textContent = message;
  host.hidden = false;
}

function autoRenderKey() {
  const config = state.data?.config || {};
  const auto = state.data?.autopreparado || {};
  return JSON.stringify([
    config.autopreparar_activo,
    config.autopreparar_periodo,
    config.autopreparar_dias_anticipacion,
    auto.created,
    auto.reason,
    auto.draft_id,
    auto.start,
    auto.end,
  ]);
}

function renderAutomation() {
  const host = document.getElementById(AUTO_ID);
  if (!host || !state.data) return;
  const key = autoRenderKey();
  if (host.dataset.renderKey === key) return;
  host.dataset.renderKey = key;
  const config = state.data.config || {};
  const auto = state.data.autopreparado || {};
  const autoMessage = auto.created
    ? `<div class="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800"><strong>✓ Borrador preparado automáticamente.</strong> ${escapeHtml(formatDate(auto.start))} – ${escapeHtml(formatDate(auto.end))}. Debe revisarse y publicarse manualmente.</div>`
    : auto.reason === 'already_exists'
      ? `<div class="mt-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">El próximo periodo ya tiene un ${escapeHtml(auto.estado || 'borrador')}; no se creó un duplicado.</div>`
      : auto.reason === 'engine_error'
        ? `<div class="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">No se pudo autopreparar: ${escapeHtml(auto.error || 'error del motor')}.</div>`
        : '';

  host.innerHTML = `
    <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div class="max-w-2xl">
        <div class="flex flex-wrap items-center gap-2">
          <h4 class="font-bold text-slate-900">4. Preparación automática</h4>
          <span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold uppercase text-violet-700">Opcional</span>
        </div>
        <p class="mt-1 text-xs text-slate-500">Dentro de la ventana elegida, al entrar a Horarios se prepara el siguiente periodo si todavía no existe. Nunca se publica automáticamente.</p>
      </div>
      <div class="grid gap-2 sm:grid-cols-[auto_130px_120px_auto] sm:items-end">
        <label class="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
          <input data-f4-auto-enabled type="checkbox" ${config.autopreparar_activo ? 'checked' : ''}> Activar
        </label>
        <label class="text-xs font-semibold text-slate-600">Periodo
          <select data-f4-auto-period class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
            <option value="semana" ${config.autopreparar_periodo !== 'mes' ? 'selected' : ''}>Semana</option>
            <option value="mes" ${config.autopreparar_periodo === 'mes' ? 'selected' : ''}>Mes</option>
          </select>
        </label>
        <label class="text-xs font-semibold text-slate-600">Anticipación
          <select data-f4-auto-days class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
            ${[1,2,3,4,5,7,10,14].map((days) => `<option value="${days}" ${Number(config.autopreparar_dias_anticipacion || 3) === days ? 'selected' : ''}>${days} día${days === 1 ? '' : 's'}</option>`).join('')}
          </select>
        </label>
        <button type="button" data-f4-action="save-automation" class="rounded-lg bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700">Guardar</button>
      </div>
    </div>
    ${autoMessage}`;
}

function requestTypeLabel(type) {
  return ({
    no_disponible: 'No disponible',
    descanso: 'Descanso',
    turno_fijo: 'Turno fijo',
    preferir_turno: 'Preferir turno',
    evitar_turno: 'Evitar turno',
  })[type] || type;
}

function requestRenderKey() {
  return JSON.stringify([
    state.data?.hoy,
    (state.data?.usuarios || []).map((item) => [item.id, item.nombre]),
    (state.data?.plantillas || []).map((item) => [item.id, item.nombre, item.hora_inicio, item.hora_fin]),
    (state.data?.solicitudes || []).map((item) => [item.id, item.usuario_id, item.fecha_inicio, item.fecha_fin, item.tipo, item.plantilla_turno_id, item.obligatorio, item.motivo]),
  ]);
}

function renderRequests() {
  const host = document.getElementById(REQUESTS_ID);
  if (!host || !state.data) return;
  const key = requestRenderKey();
  if (host.dataset.renderKey === key) return;
  host.dataset.renderKey = key;

  const users = state.data.usuarios || [];
  const templates = state.data.plantillas || [];
  const requests = state.data.solicitudes || [];
  const userById = new Map(users.map((item) => [item.id, item]));
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const today = state.data.hoy || new Date().toISOString().slice(0, 10);

  host.innerHTML = `
    <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h4 class="font-bold text-slate-900">5. Solicitudes y disponibilidad</h4>
        <p class="mt-1 text-xs text-slate-500">Registra descansos, indisponibilidades o preferencias antes de generar/reorganizar. Las reglas obligatorias pesan como restricciones duras.</p>
      </div>
      <span class="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">${requests.length} activa(s)</span>
    </div>

    <div class="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 lg:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1fr_1.2fr]">
      <label class="text-xs font-semibold text-slate-600">Recepcionista
        <select data-f4-request-user class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
          <option value="">Seleccionar…</option>
          ${users.map((user) => `<option value="${escapeHtml(user.id)}">${escapeHtml(user.nombre)}</option>`).join('')}
        </select>
      </label>
      <label class="text-xs font-semibold text-slate-600">Tipo
        <select data-f4-request-type class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
          <option value="descanso">Descanso</option>
          <option value="no_disponible">No disponible</option>
          <option value="turno_fijo">Turno fijo</option>
          <option value="preferir_turno">Preferir turno</option>
          <option value="evitar_turno">Evitar turno</option>
        </select>
      </label>
      <label class="text-xs font-semibold text-slate-600">Desde
        <input data-f4-request-start type="date" min="${escapeHtml(today)}" value="${escapeHtml(today)}" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
      </label>
      <label class="text-xs font-semibold text-slate-600">Hasta
        <input data-f4-request-end type="date" min="${escapeHtml(today)}" value="${escapeHtml(today)}" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
      </label>
      <label data-f4-template-wrap class="hidden text-xs font-semibold text-slate-600">Turno
        <select data-f4-request-template class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
          <option value="">Seleccionar…</option>
          ${templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.nombre)} · ${escapeHtml(String(template.hora_inicio).slice(0,5))}–${escapeHtml(String(template.hora_fin).slice(0,5))}</option>`).join('')}
        </select>
      </label>
      <label class="lg:col-span-2 xl:col-span-3 text-xs font-semibold text-slate-600">Motivo / nota
        <input data-f4-request-reason type="text" maxlength="240" placeholder="Ej. cita médica, descanso solicitado…" class="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm">
      </label>
      <label class="flex items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
        <input data-f4-request-required type="checkbox" checked> Obligatoria
      </label>
      <button type="button" data-f4-action="save-request" class="self-end rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-700">Agregar solicitud</button>
    </div>

    <div class="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
      ${requests.length ? requests.map((request) => {
        const user = userById.get(request.usuario_id);
        const template = request.plantilla_turno_id ? templateById.get(request.plantilla_turno_id) : null;
        return `<div class="rounded-xl border border-slate-200 bg-white p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="truncate text-sm font-bold text-slate-800">${escapeHtml(user?.nombre || 'Recepcionista')}</div>
              <div class="mt-1 text-xs font-semibold text-slate-600">${escapeHtml(requestTypeLabel(request.tipo))}${template ? ` · ${escapeHtml(template.nombre)}` : ''}</div>
            </div>
            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold ${request.obligatorio ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}">${request.obligatorio ? 'OBLIGATORIA' : 'PREFERENCIA'}</span>
          </div>
          <div class="mt-2 text-xs text-slate-500">${escapeHtml(formatDate(request.fecha_inicio))} – ${escapeHtml(formatDate(request.fecha_fin))}</div>
          ${request.motivo ? `<div class="mt-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">${escapeHtml(request.motivo)}</div>` : ''}
          <button type="button" data-f4-action="cancel-request" data-request-id="${escapeHtml(request.id)}" class="mt-3 text-xs font-bold text-red-600 hover:text-red-800">Retirar solicitud</button>
        </div>`;
      }).join('') : '<div class="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 md:col-span-2 xl:col-span-3">No hay solicitudes activas en el periodo próximo.</div>'}
    </div>`;
  syncRequestTemplateVisibility();
}

function syncRequestTemplateVisibility() {
  const root = document.getElementById(REQUESTS_ID);
  if (!root) return;
  const type = root.querySelector('[data-f4-request-type]')?.value;
  const needsTemplate = ['turno_fijo', 'preferir_turno', 'evitar_turno'].includes(type);
  const wrap = root.querySelector('[data-f4-template-wrap]');
  if (wrap) wrap.classList.toggle('hidden', !needsTemplate);
  if (!needsTemplate) {
    const select = root.querySelector('[data-f4-request-template]');
    if (select) select.value = '';
  }
}

function injectToolbarExports(root) {
  const toolbar = root.querySelector('[data-role="draft-toolbar"]');
  if (!toolbar || !toolbar.textContent.trim() || toolbar.querySelector('[data-f4-exports]')) return;
  const controls = toolbar.querySelector('.flex.flex-wrap.gap-2');
  if (!controls) return;
  const wrap = document.createElement('span');
  wrap.dataset.f4Exports = 'true';
  wrap.className = 'contents';
  wrap.innerHTML = `
    <button type="button" data-f4-action="print" class="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white">Imprimir</button>
    <button type="button" data-f4-action="csv" class="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white">Exportar CSV</button>`;
  controls.insertBefore(wrap, controls.firstChild);
}

function tableSnapshot() {
  const table = document.querySelector(`#${ROOT_ID} [data-role="calendar"] table`);
  if (!table) return null;
  const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
  const rows = [...table.querySelectorAll('tbody tr')].map((row) => {
    const cells = [...row.querySelectorAll('td')];
    return cells.map((cell, index) => {
      if (index === 0) return cell.textContent.trim();
      const select = cell.querySelector('select');
      if (select) return select.selectedOptions?.[0]?.textContent?.trim() || 'Descanso';
      return cell.textContent.trim().replace(/\s+/g, ' ');
    });
  });
  return { headers, rows };
}

function printSchedule() {
  const snapshot = tableSnapshot();
  if (!snapshot) return feedback('Abre un borrador o un horario publicado antes de imprimir.', 'warning');
  const title = document.querySelector(`#${ROOT_ID} [data-role="calendar"] h4`)?.textContent?.trim() || 'Horario de recepcionistas';
  const subtitle = document.querySelector(`#${ROOT_ID} [data-role="calendar"] p`)?.textContent?.trim() || '';
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=1200,height=800');
  if (!popup) return feedback('El navegador bloqueó la ventana de impresión.', 'warning');
  const tableHtml = `<table><thead><tr>${snapshot.headers.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${snapshot.rows.map((row) => `<tr>${row.map((cell, index) => `<${index === 0 ? 'th' : 'td'}>${escapeHtml(cell)}</${index === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</tbody></table>`;
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;padding:24px;color:#111}h1{font-size:20px;margin:0 0 6px}p{font-size:12px;color:#555;margin:0 0 18px}table{border-collapse:collapse;width:100%;font-size:10px}th,td{border:1px solid #bbb;padding:6px;text-align:center;vertical-align:middle}thead th{background:#eee}tbody th{text-align:left;background:#f7f7f7;white-space:nowrap}@media print{body{padding:0}@page{size:landscape;margin:8mm}}</style></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p>${tableHtml}<script>window.onload=()=>{window.print();}</script></body></html>`);
  popup.document.close();
}

function exportCsv() {
  const snapshot = tableSnapshot();
  if (!snapshot) return feedback('Abre un borrador o un horario publicado antes de exportar.', 'warning');
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = '\uFEFF' + [snapshot.headers, ...snapshot.rows].map((row) => row.map(quote).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `horario-recepcion-${state.data?.hoy || new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  feedback('Horario exportado a CSV.', 'success');
}

function ensureEnhancements() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  root.dataset.phase = '4';

  const phaseBadge = [...root.querySelectorAll('span')].find((item) => item.textContent.trim() === 'Horarios · Fase 3');
  if (phaseBadge) phaseBadge.textContent = 'Horarios · Fase 4';
  const safeBadge = [...root.querySelectorAll('span')].find((item) => item.textContent.trim() === 'Edición segura');
  if (safeBadge) safeBadge.textContent = 'Operación completa';

  const generator = root.querySelector('[data-role="generator-panel"]');
  if (generator && !document.getElementById(AUTO_ID)) {
    const panel = document.createElement('div');
    panel.id = AUTO_ID;
    panel.className = 'rounded-2xl border border-violet-200 bg-violet-50/50 p-4 sm:p-5';
    generator.insertAdjacentElement('afterend', panel);
  }

  const drafts = root.querySelector('[data-role="drafts"]');
  if (drafts && !document.getElementById(REQUESTS_ID)) {
    const panel = document.createElement('div');
    panel.id = REQUESTS_ID;
    panel.className = 'rounded-2xl border border-slate-200 bg-white p-4 sm:p-5';
    drafts.insertAdjacentElement('beforebegin', panel);
  }

  renderAutomation();
  renderRequests();
  injectToolbarExports(root);
}

function queueEnhance() {
  if (state.enhanceQueued) return;
  state.enhanceQueued = true;
  requestAnimationFrame(() => {
    state.enhanceQueued = false;
    ensureEnhancements();
  });
}

async function bootstrap({ silent = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  try {
    const data = await invokeOperations('bootstrap');
    state.data = data;
    state.bootstrapped = true;
    ensureEnhancements();
    if (data.autopreparado?.created && !state.refreshedAfterAuto) {
      state.refreshedAfterAuto = true;
      feedback('Se preparó automáticamente el próximo horario como borrador. Revísalo antes de publicar.', 'success');
      const refresh = document.querySelector(`#${ROOT_ID} button[data-action="refresh"]`);
      if (refresh) setTimeout(() => refresh.click(), 50);
    } else if (!silent && data.autopreparado?.reason === 'engine_error') {
      feedback(`La autopreparación no pudo completarse: ${data.autopreparado.error}`, 'warning');
    }
  } catch (error) {
    if (!silent) feedback(`No se pudieron cargar las funciones finales de horarios: ${error.message}`, 'error');
  } finally {
    state.loading = false;
  }
}

async function saveAutomation() {
  const host = document.getElementById(AUTO_ID);
  if (!host) return;
  try {
    const data = await invokeOperations('save_automation', {
      autopreparar_activo: host.querySelector('[data-f4-auto-enabled]')?.checked === true,
      autopreparar_periodo: host.querySelector('[data-f4-auto-period]')?.value || 'semana',
      autopreparar_dias_anticipacion: Number(host.querySelector('[data-f4-auto-days]')?.value || 3),
    });
    state.data = { ...state.data, config: data.config };
    renderAutomation();
    feedback('Configuración de preparación automática guardada.', 'success');
    await bootstrap({ silent: true });
  } catch (error) {
    feedback(`No se pudo guardar la automatización: ${error.message}`, 'error');
  }
}

async function saveRequest() {
  const host = document.getElementById(REQUESTS_ID);
  if (!host) return;
  const userId = host.querySelector('[data-f4-request-user]')?.value || '';
  const type = host.querySelector('[data-f4-request-type]')?.value || 'descanso';
  const start = host.querySelector('[data-f4-request-start]')?.value || '';
  const end = host.querySelector('[data-f4-request-end]')?.value || '';
  const templateId = host.querySelector('[data-f4-request-template]')?.value || null;
  if (!userId) return feedback('Selecciona la recepcionista de la solicitud.', 'warning');
  if (!start || !end || end < start) return feedback('Revisa las fechas de la solicitud.', 'warning');
  try {
    await invokeOperations('save_request', {
      usuario_id: userId,
      tipo: type,
      fecha_inicio: start,
      fecha_fin: end,
      plantilla_turno_id: ['turno_fijo', 'preferir_turno', 'evitar_turno'].includes(type) ? templateId : null,
      obligatorio: host.querySelector('[data-f4-request-required]')?.checked === true,
      motivo: host.querySelector('[data-f4-request-reason]')?.value || '',
    });
    feedback('Solicitud guardada. El generador y Reorganizar la tendrán en cuenta.', 'success');
    await bootstrap({ silent: true });
  } catch (error) {
    feedback(`No se pudo guardar la solicitud: ${error.message}`, 'error');
  }
}

async function cancelRequest(id) {
  if (!id) return;
  const confirmed = window.Swal
    ? (await window.Swal.fire({ title: 'Retirar solicitud', text: 'Dejará de aplicarse a futuras generaciones y reorganizaciones.', icon: 'warning', showCancelButton: true, confirmButtonText: 'Retirar', cancelButtonText: 'Cancelar' })).isConfirmed
    : window.confirm('¿Retirar esta solicitud?');
  if (!confirmed) return;
  try {
    await invokeOperations('cancel_request', { solicitud_id: id });
    feedback('Solicitud retirada.', 'success');
    await bootstrap({ silent: true });
  } catch (error) {
    feedback(`No se pudo retirar la solicitud: ${error.message}`, 'error');
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-f4-action]');
  if (!button) return;
  const action = button.dataset.f4Action;
  if (action === 'save-automation') return void saveAutomation();
  if (action === 'save-request') return void saveRequest();
  if (action === 'cancel-request') return void cancelRequest(button.dataset.requestId);
  if (action === 'print') return printSchedule();
  if (action === 'csv') return exportCsv();
}

function handleChange(event) {
  if (event.target.matches('[data-f4-request-type]')) syncRequestTemplateVisibility();
  if (event.target.matches('[data-f4-request-start]')) {
    const end = document.querySelector('[data-f4-request-end]');
    if (end && end.value < event.target.value) end.value = event.target.value;
  }
}

function install() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  ensureEnhancements();
  if (!root.dataset.fase4Listeners) {
    root.dataset.fase4Listeners = 'true';
    root.addEventListener('click', handleClick);
    root.addEventListener('change', handleChange);
  }
  if (!state.bootstrapped && !state.loading) void bootstrap();
}

const observer = new MutationObserver(() => {
  install();
  queueEnhance();
});
observer.observe(document.documentElement, { childList: true, subtree: true });

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', install, { once: true });
} else {
  install();
}
