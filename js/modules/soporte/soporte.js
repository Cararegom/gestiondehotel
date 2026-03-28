import { escapeHtml } from '../../security.js';
import { openInternalSupportChat } from '../../app-support-chat.js';
import { formatDateTime, hideGlobalLoading, showAppFeedback, showGlobalLoading } from '../../uiUtils.js';
import { getEvidenceAcceptString, uploadEvidenceFiles } from '../../services/evidenceUploadService.js';

let currentContainerEl = null;
let currentSupabaseInstance = null;
let currentUser = null;
let currentHotelId = null;
let listeners = [];

function addListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  listeners.push({ element, type, handler });
}

function cleanupListeners() {
  listeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
  listeners = [];
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u200B/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function getIncidentPriority(detalles = {}) {
  return normalizeText(
    detalles.prioridad_sugerida ||
    detalles.prioridad ||
    detalles.prioridadSugerida ||
    'Sin definir'
  );
}

function getIncidentSummary(detalles = {}) {
  return normalizeText(
    detalles.resultado_real ||
    detalles.resultadoReal ||
    detalles.reporte_texto ||
    'Sin resumen disponible.'
  );
}

function getIncidentModule(detalles = {}) {
  return normalizeText(
    detalles.modulo_afectado ||
    detalles.modulo ||
    'Soporte interno'
  );
}

function getPriorityBadge(priority) {
  const normalized = normalizeText(priority).toLowerCase();
  if (normalized.includes('alta')) {
    return '<span class="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-rose-700">Alta</span>';
  }
  if (normalized.includes('media')) {
    return '<span class="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-amber-700">Media</span>';
  }
  if (normalized.includes('baja')) {
    return '<span class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-emerald-700">Baja</span>';
  }
  return '<span class="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">Sin definir</span>';
}

function getIncidentAttachments(detalles = {}) {
  return Array.isArray(detalles.adjuntos)
    ? detalles.adjuntos.filter((item) => item?.url)
    : [];
}

function renderIncidentAttachments(detalles = {}) {
  const attachments = getIncidentAttachments(detalles);
  if (!attachments.length) return '';

  return `
    <div class="mt-4 flex flex-wrap gap-2">
      ${attachments.map((attachment, index) => `
        <a
          href="${escapeHtml(attachment.url)}"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
        >
          ${attachment.kind === 'image' ? 'Captura' : 'Archivo'} ${index + 1}
        </a>
      `).join('')}
    </div>
  `;
}

function renderMetricCard(label, value, tone = 'slate') {
  const toneClasses = {
    slate: 'from-slate-50 to-slate-100 border-slate-200 text-slate-800',
    blue: 'from-blue-50 to-cyan-100 border-blue-200 text-blue-800',
    emerald: 'from-emerald-50 to-green-100 border-emerald-200 text-emerald-800',
    rose: 'from-rose-50 to-red-100 border-rose-200 text-rose-800'
  };

  return `
    <article class="rounded-2xl border bg-gradient-to-br ${toneClasses[tone] || toneClasses.slate} p-4 shadow-sm">
      <p class="text-xs uppercase tracking-[0.22em] opacity-70">${escapeHtml(label)}</p>
      <p class="mt-2 text-3xl font-black">${escapeHtml(String(value ?? 0))}</p>
    </article>
  `;
}

function renderRecentIncidents(incidents = []) {
  if (!incidents.length) {
    return `
      <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
        Aun no hay incidencias guardadas desde Valeria para este hotel.
      </div>
    `;
  }

  return `
    <div class="space-y-4">
      ${incidents.map((incident) => {
        const detalles = incident.detalles || {};
        const prioridad = getIncidentPriority(detalles);
        const modulo = getIncidentModule(detalles);
        const resumen = getIncidentSummary(detalles);
        return `
          <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p class="text-xs uppercase tracking-[0.22em] text-slate-400">${escapeHtml(modulo)}</p>
                <h3 class="mt-1 text-lg font-bold text-slate-900">${escapeHtml(normalizeText(detalles.pantalla_o_flujo || detalles.pantallaFlujo || 'Incidencia reportada'))}</h3>
                <p class="mt-2 text-sm text-slate-600">${escapeHtml(resumen)}</p>
              </div>
              ${getPriorityBadge(prioridad)}
            </div>
            <div class="mt-4 flex flex-wrap gap-2 text-xs text-slate-500">
              <span class="rounded-full bg-slate-100 px-3 py-1">${escapeHtml(formatDateTime(incident.creado_en))}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1">${escapeHtml(normalizeText(detalles.dispositivo_o_navegador || detalles.dispositivoNavegador || 'Dispositivo no informado'))}</span>
              <span class="rounded-full bg-slate-100 px-3 py-1">${escapeHtml(normalizeText(detalles.impacto_operativo || detalles.impactoOperativo || 'Sin impacto detallado'))}</span>
            </div>
            ${renderIncidentAttachments(detalles)}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function renderSelectedSupportFiles(files = []) {
  if (!files.length) {
    return '<p class="text-xs text-slate-500">Puedes adjuntar capturas, PDF o archivos de apoyo.</p>';
  }

  return `
    <div class="space-y-2">
      ${files.map((file) => `
        <div class="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <span class="truncate pr-3">${escapeHtml(file.name)}</span>
          <strong>${escapeHtml(`${(Number(file.size || 0) / 1024 / 1024).toFixed(2)} MB`)}</strong>
        </div>
      `).join('')}
    </div>
  `;
}

function bindSupportManualForm() {
  const form = currentContainerEl?.querySelector('#support-manual-incident-form');
  const filesInput = currentContainerEl?.querySelector('#support-manual-files');
  const filesPreview = currentContainerEl?.querySelector('#support-manual-files-preview');

  if (!form || !filesInput || !filesPreview) return;

  const refreshPreview = () => {
    filesPreview.innerHTML = renderSelectedSupportFiles(Array.from(filesInput.files || []));
  };

  addListener(filesInput, 'change', refreshPreview);
  refreshPreview();

  addListener(form, 'submit', async (event) => {
    event.preventDefault();
    await handleManualIncidentSubmit(form, filesInput);
  });
}

async function handleManualIncidentSubmit(form, filesInput) {
  if (!currentSupabaseInstance || !currentHotelId || !currentUser) return;

  const formData = new FormData(form);
  const payload = {
    modulo_afectado: normalizeText(formData.get('modulo_afectado')),
    pantalla_o_flujo: normalizeText(formData.get('pantalla_o_flujo')),
    accion_realizada: normalizeText(formData.get('accion_realizada')),
    resultado_esperado: normalizeText(formData.get('resultado_esperado')),
    resultado_real: normalizeText(formData.get('resultado_real')),
    impacto_operativo: normalizeText(formData.get('impacto_operativo')),
    prioridad_sugerida: normalizeText(formData.get('prioridad_sugerida')),
    dispositivo_o_navegador: navigator.userAgent || 'No informado'
  };

  if (!payload.modulo_afectado || !payload.resultado_real) {
    showAppFeedback('Completa al menos el modulo afectado y el resultado real de la incidencia.', 'warning');
    return;
  }

  showGlobalLoading('Guardando incidencia con evidencia...');
  try {
    const adjuntos = await uploadEvidenceFiles({
      supabase: currentSupabaseInstance,
      hotelId: currentHotelId,
      userId: currentUser.id,
      files: Array.from(filesInput.files || []),
      scope: 'incidencias'
    });

    const { error } = await currentSupabaseInstance
      .from('bitacora')
      .insert([{
        hotel_id: currentHotelId,
        usuario_id: currentUser.id,
        modulo: 'Soporte interno',
        accion: 'REPORTE_INCIDENCIA_MANUAL',
        detalles: {
          origen: 'centro_soporte_manual',
          capturado_automaticamente: false,
          ...payload,
          adjuntos
        },
        creado_en: new Date().toISOString()
      }]);

    if (error) throw error;

    showAppFeedback('Incidencia guardada correctamente con su evidencia.', 'success');
    form.reset();
    const preview = currentContainerEl?.querySelector('#support-manual-files-preview');
    if (preview) {
      preview.innerHTML = renderSelectedSupportFiles([]);
    }
    await loadSupportCenter();
  } catch (error) {
    console.error('[Soporte] Error guardando incidencia manual:', error);
    showAppFeedback(`No se pudo guardar la incidencia: ${error.message}`, 'error');
  } finally {
    hideGlobalLoading();
  }
}

function renderSupportCenter(payload) {
  const incidents = payload.incidents || [];
  const incidents7d = incidents.filter((incident) => {
    const createdAt = incident.creado_en ? new Date(incident.creado_en).getTime() : 0;
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    return createdAt >= sevenDaysAgo;
  });
  const highPriorityCount = incidents7d.filter((incident) =>
    getIncidentPriority(incident.detalles || {}).toLowerCase().includes('alta')
  ).length;
  const latestIncident = incidents[0];

  currentContainerEl.innerHTML = `
    <div class="space-y-6 p-4 md:p-8">
      <section class="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-2xl">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-blue-200">Soporte</p>
            <h1 class="mt-2 text-3xl font-black">Centro de Soporte</h1>
            <p class="mt-2 max-w-3xl text-sm text-blue-100">Un solo lugar para resolver dudas operativas, abrir el chat con Valeria y revisar las incidencias recientes del hotel.</p>
          </div>
          <div class="flex flex-wrap gap-3">
            <button id="support-center-open-chat" class="rounded-2xl bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-950 shadow hover:bg-emerald-300">Abrir chat con Valeria</button>
            <a href="#/bitacora?scope=soporte" class="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20">Ver incidencias</a>
            <a href="mailto:support@gestiondehotel.com?subject=Escalamiento%20de%20soporte%20hotel%20${encodeURIComponent(currentHotelId || '')}" class="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20">Escalar por correo</a>
          </div>
        </div>

        <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          ${renderMetricCard('Incidencias 7 dias', incidents7d.length, 'blue')}
          ${renderMetricCard('Alta prioridad', highPriorityCount, 'rose')}
          ${renderMetricCard('Reportes totales', incidents.length, 'emerald')}
          ${renderMetricCard('Ultimo reporte', latestIncident ? formatDateTime(latestIncident.creado_en) : 'Sin datos', 'slate')}
        </div>
      </section>

      <section class="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Ayuda inmediata</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Canales disponibles</h2>
          <div class="mt-4 grid gap-4 md:grid-cols-2">
            <button type="button" data-support-open-chat="true" class="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <p class="text-xs uppercase tracking-[0.22em] text-blue-500">Chat interno</p>
              <h3 class="mt-2 text-lg font-bold text-slate-900">Habla con Valeria</h3>
              <p class="mt-2 text-sm text-slate-600">Ideal para dudas operativas, rutas dentro del sistema o estructurar una falla antes de escalarla.</p>
            </button>
            <a href="#/bitacora?scope=soporte" class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <p class="text-xs uppercase tracking-[0.22em] text-emerald-600">Seguimiento</p>
              <h3 class="mt-2 text-lg font-bold text-slate-900">Bitacora de incidencias</h3>
              <p class="mt-2 text-sm text-slate-600">Revisa los casos que Valeria ya dejó registrados para este hotel y dales seguimiento operativo.</p>
            </a>
            <a href="#/faq" class="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <p class="text-xs uppercase tracking-[0.22em] text-amber-600">Autoayuda</p>
              <h3 class="mt-2 text-lg font-bold text-slate-900">Preguntas frecuentes</h3>
              <p class="mt-2 text-sm text-slate-600">Consulta respuestas rápidas para caja, reservas, reportes, integraciones y operación diaria.</p>
            </a>
            <a href="mailto:support@gestiondehotel.com?subject=Escalamiento%20de%20soporte%20hotel%20${encodeURIComponent(currentHotelId || '')}" class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
              <p class="text-xs uppercase tracking-[0.22em] text-slate-500">Escalamiento</p>
              <h3 class="mt-2 text-lg font-bold text-slate-900">Correo del equipo</h3>
              <p class="mt-2 text-sm text-slate-600">Usa este canal cuando el caso necesite revisión humana o involucre algo excepcional.</p>
            </a>
          </div>
        </article>

        <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Buenas practicas</p>
          <h2 class="mt-1 text-xl font-bold text-slate-900">Como reportar mejor una falla</h2>
          <ul class="mt-4 space-y-3 text-sm text-slate-600">
            <li class="rounded-xl bg-slate-50 px-4 py-3"><strong class="text-slate-800">Modulo y flujo:</strong> indica en qué pantalla estabas y qué estabas intentando hacer.</li>
            <li class="rounded-xl bg-slate-50 px-4 py-3"><strong class="text-slate-800">Resultado esperado:</strong> explica qué debía pasar normalmente.</li>
            <li class="rounded-xl bg-slate-50 px-4 py-3"><strong class="text-slate-800">Resultado real:</strong> cuenta qué ocurrió en realidad y si salió un mensaje de error.</li>
            <li class="rounded-xl bg-slate-50 px-4 py-3"><strong class="text-slate-800">Dispositivo:</strong> aclara si fue en computador, tablet o celular.</li>
            <li class="rounded-xl bg-slate-50 px-4 py-3"><strong class="text-slate-800">Impacto:</strong> di si bloquea cobros, caja, check-in, reservas o solo es visual.</li>
          </ul>
        </article>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Incidencia manual</p>
            <h2 class="mt-1 text-xl font-bold text-slate-900">Guardar incidencia con captura o archivo</h2>
            <p class="mt-2 max-w-2xl text-sm text-slate-600">Si ya tienes una captura de pantalla, un PDF o un archivo de apoyo, puedes registrar la incidencia directamente desde aqui sin depender del chat.</p>
          </div>
          <div class="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-700">
            Los adjuntos quedan visibles en incidencias y seguimiento.
          </div>
        </div>

        <form id="support-manual-incident-form" class="mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Modulo afectado *</label>
            <input name="modulo_afectado" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Ej: Caja, Reservas, Mapa Hotel">
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Pantalla o flujo</label>
            <input name="pantalla_o_flujo" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Ej: Cierre de caja / ver consumos">
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Accion realizada</label>
            <input name="accion_realizada" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Ej: Intentaba cerrar turno">
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Resultado esperado</label>
            <input name="resultado_esperado" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Ej: Debia generar el corte y enviar correo">
          </div>
          <div class="lg:col-span-2">
            <label class="mb-1 block text-sm font-semibold text-slate-700">Resultado real *</label>
            <textarea name="resultado_real" rows="4" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Describe el error, lo que ocurrio o el comportamiento anormal"></textarea>
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Impacto operativo</label>
            <input name="impacto_operativo" type="text" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white" placeholder="Ej: Bloquea cobros o check-in">
          </div>
          <div>
            <label class="mb-1 block text-sm font-semibold text-slate-700">Prioridad sugerida</label>
            <select name="prioridad_sugerida" class="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none focus:border-blue-300 focus:bg-white">
              <option value="Alta">Alta</option>
              <option value="Media" selected>Media</option>
              <option value="Baja">Baja</option>
            </select>
          </div>
          <div class="lg:col-span-2">
            <label class="mb-1 block text-sm font-semibold text-slate-700">Capturas o archivos</label>
            <input id="support-manual-files" type="file" multiple accept="${getEvidenceAcceptString()}" class="block w-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div id="support-manual-files-preview" class="mt-3"></div>
          </div>
          <div class="lg:col-span-2 flex justify-end">
            <button type="submit" class="rounded-2xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow hover:bg-blue-700">Guardar incidencia</button>
          </div>
        </form>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Incidencias recientes</p>
            <h2 class="mt-1 text-xl font-bold text-slate-900">Ultimos casos registrados</h2>
          </div>
          <a href="#/bitacora?scope=soporte" class="text-sm font-semibold text-blue-600 hover:text-blue-800">Abrir vista completa</a>
        </div>
        <div class="mt-4">${renderRecentIncidents(incidents)}</div>
      </section>
    </div>
  `;

  currentContainerEl.querySelectorAll('[data-support-open-chat="true"], #support-center-open-chat').forEach((button) => {
    addListener(button, 'click', async (event) => {
      event.preventDefault();
      await openInternalSupportChat();
    });
  });
}

async function loadSupportCenter() {
  if (!currentSupabaseInstance || !currentContainerEl || !currentHotelId) return;

  currentContainerEl.innerHTML = `
    <div class="p-8">
      <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
        Cargando centro de soporte...
      </div>
    </div>
  `;

  const { data: incidents, error } = await currentSupabaseInstance
    .from('bitacora')
    .select('id, creado_en, detalles, modulo, accion')
    .eq('hotel_id', currentHotelId)
    .in('accion', ['REPORTE_INCIDENCIA_CHAT', 'REPORTE_INCIDENCIA_MANUAL'])
    .order('creado_en', { ascending: false })
    .limit(12);

  if (error) {
    throw error;
  }

  renderSupportCenter({
    incidents: incidents || []
  });
  bindSupportManualForm();
}

export async function mount(container, sbInstance, user, hotelId) {
  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentUser = user;
  currentHotelId = hotelId;
  cleanupListeners();

  if (!currentUser) {
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          Debes iniciar sesion para acceder al centro de soporte.
        </div>
      </div>
    `;
    return;
  }

  showGlobalLoading('Cargando centro de soporte...');
  try {
    await loadSupportCenter();
  } catch (error) {
    console.error('[Soporte] Error cargando centro de soporte:', error);
    currentContainerEl.innerHTML = `
      <div class="p-8">
        <div class="rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center text-rose-700 shadow-sm">
          No se pudo cargar el centro de soporte: ${escapeHtml(error.message || 'Error desconocido')}
        </div>
      </div>
    `;
  } finally {
    hideGlobalLoading();
  }
}

export function unmount() {
  cleanupListeners();
  currentContainerEl = null;
  currentSupabaseInstance = null;
  currentUser = null;
  currentHotelId = null;
}
