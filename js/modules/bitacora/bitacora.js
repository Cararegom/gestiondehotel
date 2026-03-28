import {
  clearAppFeedback,
  formatDateTime,
  showAppFeedback
} from '../../uiUtils.js';

let activeListeners = [];
let hotelIdGlobal = null;
let currentUserGlobal = null;
let currentPage = 1;
const ITEMS_PER_PAGE = 15;
let totalRecords = 0;
let currentSupabaseInstance = null;
let currentScope = 'general';
let hotelNamesByIdCache = {};

let tBodyEl;
let pagContainerEl;
let infoSpanEl;
let btnPrevEl;
let btnNextEl;
let loadingEl;
let filterFormEl;
let filterFechaInicioEl;
let filterFechaFinEl;
let filterUsuarioEl;
let filterModuloEl;

function normalizeText(value) {
  return String(value || '').trim();
}

function setLoadingState(message = '') {
  if (!loadingEl) return;
  loadingEl.textContent = message;
  loadingEl.style.display = message ? 'block' : 'none';
}

function getIncidentActionsForScope() {
  return ['REPORTE_INCIDENCIA_CHAT', 'REPORTE_INCIDENCIA_MANUAL'];
}

function formatAttachmentLinks(detalles = {}) {
  const attachments = Array.isArray(detalles.adjuntos)
    ? detalles.adjuntos.filter((item) => item?.url)
    : [];

  if (!attachments.length) return '';

  return `
    <div class="mb-2 flex flex-wrap gap-2">
      ${attachments.map((attachment, index) => `
        <a
          href="${String(attachment.url).replace(/"/g, '&quot;')}"
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

function formatBitacoraDetalles(detalles) {
  if (detalles === null || detalles === undefined) return 'N/A';

  let detallesStr;
  let attachmentsHtml = '';

  if (typeof detalles === 'object') {
    attachmentsHtml = formatAttachmentLinks(detalles);
    try {
      detallesStr = JSON.stringify(detalles, null, 2);
    } catch (_) {
      detallesStr = String(detalles);
    }
  } else {
    detallesStr = String(detalles);
  }

  if (detallesStr.length > 150) {
    return `
      <details class="bitacora-detalles-expandibles">
        <summary class="cursor-pointer text-blue-600 hover:text-blue-800">${detallesStr.slice(0, 100)}... (ver mas)</summary>
        ${attachmentsHtml}
        <pre class="mt-2 rounded-md border bg-gray-50 p-2 overflow-x-auto">${detallesStr}</pre>
      </details>
    `;
  }

  return `${attachmentsHtml}<pre class="bitacora-detalles-pre overflow-x-auto">${detallesStr}</pre>`;
}

function getActorName(entry) {
  return entry.usuarios?.nombre
    || entry.usuarios?.correo
    || (entry.usuario_id ? `ID: ${String(entry.usuario_id).slice(0, 8)}...` : 'Sistema');
}

async function cargarYRenderizarBitacora(page = 1) {
  if (!tBodyEl || !currentSupabaseInstance || (!hotelIdGlobal && currentScope !== 'soporte-global')) {
    showAppFeedback('No se pudo preparar la bitacora para este hotel.', 'error');
    return;
  }

  setLoadingState('Cargando registros de bitacora...');
  tBodyEl.innerHTML = `<tr><td colspan="6" class="p-4 text-center">Cargando...</td></tr>`;

  const fechaInicio = filterFechaInicioEl?.value || '';
  const fechaFin = filterFechaFinEl?.value || '';
  const usuarioId = filterUsuarioEl?.value || '';
  const moduloFiltro = normalizeText(filterModuloEl?.value || '');

  try {
    let query = currentSupabaseInstance
      .from('bitacora')
      .select(`
        hotel_id,
        creado_en,
        modulo,
        accion,
        detalles,
        usuario_id,
        usuarios (nombre, correo)
      `, { count: 'exact' })
      .order('creado_en', { ascending: false });

    if (currentScope !== 'soporte-global') {
      query = query.eq('hotel_id', hotelIdGlobal);
    }

    if (currentScope === 'soporte' || currentScope === 'soporte-global') {
      query = query.in('accion', getIncidentActionsForScope());
    }

    if (fechaInicio) query = query.gte('creado_en', `${fechaInicio}T00:00:00.000Z`);
    if (fechaFin) query = query.lte('creado_en', `${fechaFin}T23:59:59.999Z`);
    if (usuarioId) query = query.eq('usuario_id', usuarioId);
    if (moduloFiltro) query = query.ilike('modulo', `%${moduloFiltro}%`);

    const from = (page - 1) * ITEMS_PER_PAGE;
    const to = from + ITEMS_PER_PAGE - 1;
    query = query.range(from, to);

    const { data: registros, error, count } = await query;
    if (error) throw error;

    totalRecords = count || 0;
    currentPage = page;
    tBodyEl.innerHTML = '';

    if (!registros?.length) {
      tBodyEl.innerHTML = `<tr><td colspan="6" class="p-4 text-center">No se encontraron registros con los filtros aplicados.</td></tr>`;
    } else {
      registros.forEach((entry) => {
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50';
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">${formatDateTime(entry.creado_en)}</td>
          ${currentScope === 'soporte-global' ? `<td class="px-4 py-2 text-sm text-gray-700">${hotelNamesByIdCache[entry.hotel_id] || entry.hotel_id || 'Sin hotel'}</td>` : ''}
          <td class="px-4 py-2 text-sm text-gray-700">${getActorName(entry)}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${entry.modulo || 'N/A'}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${entry.accion || 'N/A'}</td>
          <td class="max-w-xs px-4 py-2 text-sm text-gray-700">${formatBitacoraDetalles(entry.detalles)}</td>
        `;
        tBodyEl.appendChild(tr);
      });
    }

    const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE) || 1;
    if (infoSpanEl) infoSpanEl.textContent = `Pagina ${currentPage} de ${totalPages} (Total: ${totalRecords} registros)`;
    if (btnPrevEl) btnPrevEl.disabled = currentPage <= 1;
    if (btnNextEl) btnNextEl.disabled = currentPage >= totalPages;
    if (pagContainerEl) pagContainerEl.style.display = totalRecords > 0 ? 'flex' : 'none';
  } catch (error) {
    console.error('Error al cargar bitacora:', error);
    showAppFeedback(`Error al cargar bitacora: ${error.message}`, 'error');
    tBodyEl.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">Error cargando datos. Intenta de nuevo.</td></tr>`;
    if (pagContainerEl) pagContainerEl.style.display = 'none';
  } finally {
    setLoadingState('');
  }
}

async function cargarUsuariosParaFiltro(selectEl) {
  if (!selectEl || !currentSupabaseInstance || (currentScope !== 'soporte-global' && !hotelIdGlobal)) {
    return;
  }

  selectEl.innerHTML = '<option value="">Cargando usuarios...</option>';
  try {
    let query = currentSupabaseInstance
      .from('usuarios')
      .select('id, nombre, correo, hotel_id')
      .order('nombre');

    if (currentScope !== 'soporte-global') {
      query = query.eq('hotel_id', hotelIdGlobal);
    }

    const { data: usuarios, error } = await query;
    if (error) throw error;

    let html = '<option value="">Todos los usuarios</option>';
    (usuarios || []).forEach((usuario) => {
      const baseLabel = usuario.nombre || usuario.correo || usuario.id;
      const hotelSuffix = currentScope === 'soporte-global'
        ? ` · ${hotelNamesByIdCache[usuario.hotel_id] || usuario.hotel_id || 'Sin hotel'}`
        : '';
      html += `<option value="${usuario.id}">${baseLabel}${hotelSuffix}</option>`;
    });
    selectEl.innerHTML = html;
  } catch (error) {
    console.error('Error cargando usuarios para filtro de bitacora:', error);
    selectEl.innerHTML = '<option value="">Error al cargar</option>';
  }
}

async function cargarHotelesParaScopeGlobal() {
  if (!currentSupabaseInstance || currentScope !== 'soporte-global') {
    hotelNamesByIdCache = {};
    return;
  }

  try {
    const { data: hoteles, error } = await currentSupabaseInstance
      .from('hoteles')
      .select('id, nombre');

    if (error) throw error;

    hotelNamesByIdCache = Object.fromEntries(
      (hoteles || []).map((hotel) => [hotel.id, hotel.nombre || hotel.id])
    );
  } catch (error) {
    console.error('Bitacora: Error cargando hoteles para incidencias globales:', error);
    hotelNamesByIdCache = {};
  }
}

export async function mount(container, sbInstance, user, hotelId) {
  currentUserGlobal = user;
  currentSupabaseInstance = sbInstance;
  activeListeners = [];
  currentScope = new URLSearchParams((window.location.hash.split('?')[1] || '')).get('scope')?.toLowerCase() || 'general';
  hotelIdGlobal = hotelId;

  if (!hotelIdGlobal && user?.id && sbInstance && currentScope !== 'soporte-global') {
    try {
      const { data: perfil } = await sbInstance
        .from('usuarios')
        .select('hotel_id')
        .eq('id', user.id)
        .single();
      hotelIdGlobal = perfil?.hotel_id || null;
    } catch (error) {
      console.error('Bitacora: Error obteniendo hotel_id del perfil:', error);
    }
  }

  const isSupportScope = currentScope === 'soporte' || currentScope === 'soporte-global';
  const isGlobalSupportScope = currentScope === 'soporte-global';
  const headingTitle = isGlobalSupportScope
    ? 'Incidencias SaaS'
    : isSupportScope
      ? 'Incidencias de Soporte'
      : 'Bitacora de Actividad del Sistema';
  const headingDescription = isGlobalSupportScope
    ? 'Aqui veras, como encargado del SaaS, los reportes de fallas y danos registrados desde todos los hoteles.'
    : isSupportScope
      ? 'Aqui veras los reportes de fallas, danos y evidencias cargadas desde soporte.'
      : 'Consulta la actividad registrada del hotel y aplica filtros por fecha, usuario o modulo.';

  container.innerHTML = `
    <div class="p-4 sm:p-6 md:p-8">
      <div class="rounded-lg bg-white shadow-md">
        <div class="border-b border-gray-200 px-6 py-4">
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-xl font-semibold text-gray-700">${headingTitle}</h2>
              <p class="text-sm text-gray-500">${headingDescription}</p>
            </div>
            ${isSupportScope ? `<span class="inline-flex items-center rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-blue-700">${isGlobalSupportScope ? 'SaaS + soporte' : 'Hotel + soporte'}</span>` : ''}
          </div>
        </div>
        <div class="p-6">
          <div id="bitacora-loading" class="mb-4 hidden text-sm text-gray-500"></div>
          <form id="form-bitacora-filtros" class="mb-6 grid grid-cols-1 items-end gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            <div>
              <label for="bitacora-fecha-inicio" class="mb-1 block text-sm font-medium text-gray-700">Desde:</label>
              <input type="date" id="bitacora-fecha-inicio" class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
            </div>
            <div>
              <label for="bitacora-fecha-fin" class="mb-1 block text-sm font-medium text-gray-700">Hasta:</label>
              <input type="date" id="bitacora-fecha-fin" class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" />
            </div>
            <div>
              <label for="bitacora-usuario" class="mb-1 block text-sm font-medium text-gray-700">Usuario:</label>
              <select id="bitacora-usuario" class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500">
                <option value="">Todos</option>
              </select>
            </div>
            <div>
              <label for="bitacora-modulo-filtro" class="mb-1 block text-sm font-medium text-gray-700">Modulo:</label>
              <input type="text" id="bitacora-modulo-filtro" class="w-full rounded-md border border-gray-300 p-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500" placeholder="Ej: Reservas" />
            </div>
            <div class="flex space-x-2">
              <button type="submit" class="button button-primary w-full px-4 py-2 sm:w-auto">Filtrar</button>
              <button type="button" id="bitacora-btn-limpiar-filtros" class="button button-outline w-full px-4 py-2 sm:w-auto">Limpiar</button>
            </div>
          </form>

          <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fecha y hora</th>
                  ${isGlobalSupportScope ? '<th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Hotel</th>' : ''}
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Usuario actor</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Modulo</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Accion</th>
                  <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Detalles</th>
                </tr>
              </thead>
              <tbody id="tabla-bitacora-body" class="divide-y divide-gray-200 bg-white"></tbody>
            </table>
          </div>

          <div id="bitacora-paginacion-container" class="mt-4 flex items-center justify-between py-3" style="display:none;">
            <button id="btn-bitacora-prev" class="button button-outline px-4 py-2 text-sm">&laquo; Anterior</button>
            <span id="bitacora-pagina-info" class="mx-2 text-sm text-gray-700">Pagina 1 de 1</span>
            <button id="btn-bitacora-next" class="button button-outline px-4 py-2 text-sm">Siguiente &raquo;</button>
          </div>
        </div>
      </div>
    </div>
  `;

  tBodyEl = container.querySelector('#tabla-bitacora-body');
  pagContainerEl = container.querySelector('#bitacora-paginacion-container');
  infoSpanEl = container.querySelector('#bitacora-pagina-info');
  btnPrevEl = container.querySelector('#btn-bitacora-prev');
  btnNextEl = container.querySelector('#btn-bitacora-next');
  loadingEl = container.querySelector('#bitacora-loading');
  filterFormEl = container.querySelector('#form-bitacora-filtros');
  filterFechaInicioEl = container.querySelector('#bitacora-fecha-inicio');
  filterFechaFinEl = container.querySelector('#bitacora-fecha-fin');
  filterUsuarioEl = container.querySelector('#bitacora-usuario');
  filterModuloEl = container.querySelector('#bitacora-modulo-filtro');
  const btnLimpiarFiltros = container.querySelector('#bitacora-btn-limpiar-filtros');

  if (!hotelIdGlobal && currentScope !== 'soporte-global') {
    showAppFeedback('No se pudo identificar el hotel para cargar la bitacora.', 'error');
    return;
  }

  if (isGlobalSupportScope) {
    await cargarHotelesParaScopeGlobal();
  }

  if (isSupportScope && filterModuloEl) {
    filterModuloEl.value = 'Soporte interno';
  }

  await cargarUsuariosParaFiltro(filterUsuarioEl);
  await cargarYRenderizarBitacora(1);

  const filtroSubmitHandler = (event) => {
    event.preventDefault();
    currentPage = 1;
    void cargarYRenderizarBitacora(currentPage);
  };
  filterFormEl?.addEventListener('submit', filtroSubmitHandler);
  activeListeners.push({ element: filterFormEl, type: 'submit', handler: filtroSubmitHandler });

  const limpiarFiltrosHandler = () => {
    filterFormEl?.reset();
    if (isSupportScope && filterModuloEl) {
      filterModuloEl.value = 'Soporte interno';
    }
    currentPage = 1;
    void cargarYRenderizarBitacora(currentPage);
  };
  btnLimpiarFiltros?.addEventListener('click', limpiarFiltrosHandler);
  activeListeners.push({ element: btnLimpiarFiltros, type: 'click', handler: limpiarFiltrosHandler });

  const prevPageHandler = () => {
    if (currentPage > 1) {
      void cargarYRenderizarBitacora(currentPage - 1);
    }
  };
  btnPrevEl?.addEventListener('click', prevPageHandler);
  activeListeners.push({ element: btnPrevEl, type: 'click', handler: prevPageHandler });

  const nextPageHandler = () => {
    const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE);
    if (currentPage < totalPages) {
      void cargarYRenderizarBitacora(currentPage + 1);
    }
  };
  btnNextEl?.addEventListener('click', nextPageHandler);
  activeListeners.push({ element: btnNextEl, type: 'click', handler: nextPageHandler });
}

export function unmount() {
  activeListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener?.(type, handler);
  });
  activeListeners = [];
  hotelIdGlobal = null;
  currentUserGlobal = null;
  currentSupabaseInstance = null;
  currentPage = 1;
  totalRecords = 0;
  currentScope = 'general';
  hotelNamesByIdCache = {};
  tBodyEl = null;
  pagContainerEl = null;
  infoSpanEl = null;
  btnPrevEl = null;
  btnNextEl = null;
  loadingEl = null;
  filterFormEl = null;
  filterFechaInicioEl = null;
  filterFechaFinEl = null;
  filterUsuarioEl = null;
  filterModuloEl = null;
  clearAppFeedback();
}
