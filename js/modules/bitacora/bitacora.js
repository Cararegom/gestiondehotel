// js/modules/bitacora/bitacora.js
import { supabase } from '../../supabaseClient.js'; // Se mantiene por si se usa en algún lugar, pero priorizaremos sbInstance
import {
  showAppFeedback,
  clearAppFeedback,
  formatDateTime,
  // formatDateShort // No se usa en este módulo actualmente
} from '../../uiUtils.js';

// --- Variables Globales del Módulo ---
let activeListeners = [];
let hotelIdGlobal = null;
let currentUserGlobal = null; // No parece usarse directamente, pero es bueno tenerlo si se necesita
let currentPage = 1;
const ITEMS_PER_PAGE = 15;
let totalRecords = 0;
let currentSupabaseInstance = null; // Para almacenar la instancia de Supabase pasada a mount

// Referencias a elementos del DOM
let tBodyEl, pagContainerEl, infoSpanEl, btnPrevEl, btnNextEl, feedbackEl, loadingEl;
let filterFormEl, filterFechaInicioEl, filterFechaFinEl, filterUsuarioEl, filterModuloEl;

/**
 * Formatea los detalles de la bitácora para visualización.
 */
function formatBitacoraDetalles(detalles) {
  if (detalles === null || detalles === undefined) return 'N/A';
  let detallesStr;
  if (typeof detalles === 'object') {
    try {
      // Usar un replacer para manejar tipos complejos o errores de serialización si fuera necesario
      // const replacer = (key, value) => typeof value === 'bigint' ? value.toString() : value;
      detallesStr = JSON.stringify(detalles, null, 2);
    } catch (e) {
      detallesStr = String(detalles); // Fallback
    }
  } else {
    detallesStr = String(detalles);
  }

  // Evitar que <pre> sea excesivamente largo y rompa el layout si no es expandible
  const maxLengthNonExpandable = 150; 
  if (detallesStr.length > maxLengthNonExpandable) {
    return `
      <details class="bitacora-detalles-expandibles">
        <summary class="cursor-pointer text-blue-600 hover:text-blue-800">${detallesStr.slice(0, 100)}... (ver más)</summary>
        <pre class="mt-2 p-2 bg-gray-50 border rounded-md overflow-x-auto">${detallesStr}</pre>
      </details>
    `;
  }
  return `<pre class="bitacora-detalles-pre overflow-x-auto">${detallesStr}</pre>`;
}

/**
 * Carga y renderiza las entradas de la bitácora con filtros y paginación.
 */
async function cargarYRenderizarBitacora(page = 1) {
  if (!tBodyEl || !hotelIdGlobal || !currentSupabaseInstance) {
    console.error("Bitácora: Elementos del DOM, hotelId o instancia de Supabase no disponibles.");
    if (feedbackEl) showAppFeedback(feedbackEl, 'Error de configuración interna para cargar bitácora.', 'error');
    return;
  }
  // Usar uiUtils para loading y feedback
  if (loadingEl) showAppFeedback(loadingEl, 'Cargando registros de bitácora...', 'info', false); // No auto-ocultar
  if (feedbackEl) clearAppFeedback(feedbackEl);
  tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-4">Cargando...</td></tr>`;

  const fechaInicio = filterFechaInicioEl.value;
  const fechaFin    = filterFechaFinEl.value;
  const usuarioId   = filterUsuarioEl.value;
  const moduloFiltro= filterModuloEl.value.trim();

  try {
    let query = currentSupabaseInstance // Usar la instancia pasada
      .from('bitacora')
      .select(`
        creado_en,
        modulo,
        accion,
        detalles,
        usuario_id,
        usuarios (nombre, correo) 
      `, { count: 'exact' }) // Asegurar que el JOIN con usuarios es correcto y tienes RLS configurado
      .eq('hotel_id', hotelIdGlobal)
      .order('creado_en', { ascending: false });

    if (fechaInicio) query = query.gte('creado_en', `${fechaInicio}T00:00:00.000Z`);
    if (fechaFin)    query = query.lte('creado_en', `${fechaFin}T23:59:59.999Z`);
    if (usuarioId)   query = query.eq('usuario_id', usuarioId);
    if (moduloFiltro)query = query.ilike('modulo', `%${moduloFiltro}%`);

    const from = (page - 1) * ITEMS_PER_PAGE;
    const to   = from + ITEMS_PER_PAGE - 1;
    query = query.range(from, to);

    const { data: registros, error, count } = await query;

    if (loadingEl) clearAppFeedback(loadingEl);
    if (error) throw error;

    totalRecords = count || 0;
    currentPage = page;
    tBodyEl.innerHTML = ''; // Limpiar "Cargando..."

    if (!registros || registros.length === 0) {
      tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-4">No se encontraron registros con los filtros aplicados.</td></tr>`;
    } else {
      registros.forEach(b => {
        // Si usuarios es null (porque el usuario_id no existe en la tabla usuarios o es un ID de sistema)
        const actorName = b.usuarios?.nombre || b.usuarios?.correo || (b.usuario_id ? `ID: ${b.usuario_id.substring(0, 8)}...` : 'Sistema');
        
        const tr = document.createElement('tr');
        tr.className = 'border-b hover:bg-gray-50'; // Estilo para las filas
        tr.innerHTML = `
          <td class="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">${formatDateTime(b.creado_en)}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${actorName}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${b.modulo || 'N/A'}</td>
          <td class="px-4 py-2 text-sm text-gray-700">${b.accion || 'N/A'}</td>
          <td class="px-4 py-2 text-sm text-gray-700 max-w-xs">${formatBitacoraDetalles(b.detalles)}</td>
        `;
        tBodyEl.appendChild(tr);
      });
    }

    const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE) || 1;
    if (infoSpanEl) infoSpanEl.textContent = `Página ${currentPage} de ${totalPages} (Total: ${totalRecords} registros)`;
    if (btnPrevEl) btnPrevEl.disabled = currentPage <= 1;
    if (btnNextEl) btnNextEl.disabled = currentPage >= totalPages;
    if (pagContainerEl) pagContainerEl.style.display = totalRecords > 0 ? 'flex' : 'none';

  } catch (err) {
    console.error('Error al cargar bitácora:', err);
    if (loadingEl) clearAppFeedback(loadingEl);
    if (feedbackEl) showAppFeedback(feedbackEl, `Error al cargar bitácora: ${err.message}`, 'error');
    if (tBodyEl) tBodyEl.innerHTML = `<tr><td colspan="5" class="text-red-500 text-center p-4">Error cargando datos. Intente de nuevo.</td></tr>`;
    if (pagContainerEl) pagContainerEl.style.display = 'none';
  }
}

/**
 * Carga los usuarios del hotel para el selector de filtro.
 */
async function cargarUsuariosParaFiltro(selectEl) {
  if (!selectEl || !hotelIdGlobal || !currentSupabaseInstance) {
      console.warn("Bitácora: No se puede cargar usuarios para filtro sin selectEl, hotelIdGlobal o instancia de Supabase.");
      return;
  }
  selectEl.innerHTML = '<option value="">Cargando usuarios...</option>';
  try {
    const { data: usuarios, error } = await currentSupabaseInstance // Usar la instancia pasada
      .from('usuarios')
      .select('id, nombre, correo')
      .eq('hotel_id', hotelIdGlobal)
      .order('nombre'); // Ordenar por nombre es buena práctica
    if (error) throw error;
    
    let htmlOptions = '<option value="">Todos los usuarios</option>';
    if (usuarios && usuarios.length > 0) {
      usuarios.forEach(u => {
        // Mostrar nombre, y si no hay nombre, mostrar correo.
        const displayText = u.nombre || u.correo || u.id; 
        htmlOptions += `<option value="${u.id}">${displayText}</option>`;
      });
    } else {
        htmlOptions += '<option value="" disabled>No hay usuarios para filtrar</option>';
    }
    selectEl.innerHTML = htmlOptions;
  } catch (e) {
    console.error('Error cargando usuarios para filtro de bitácora:', e);
    selectEl.innerHTML = '<option value="">Error al cargar</option>';
  }
}

/**
 * Monta el módulo de bitácora.
 */
export async function mount(container, sbInstance, user, hotelId) { // Recibe hotelId directamente
  console.log("Montando módulo de Bitácora...");
  currentUserGlobal = user;
  currentSupabaseInstance = sbInstance; // Almacenar la instancia de Supabase
  activeListeners = [];
  
  hotelIdGlobal = hotelId; // Usar el hotelId pasado desde main.js

  // Si hotelIdGlobal no se pasa, intentar obtenerlo (fallback, pero idealmente main.js ya lo tiene)
  if (!hotelIdGlobal && user?.id && sbInstance) {
    console.warn("Bitácora: hotelId no fue proporcionado, intentando obtener del perfil.");
    try {
      const { data: perfil, error: perfilError } = await sbInstance.from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError; // PGRST116: No rows found
      hotelIdGlobal = perfil?.hotel_id;
    } catch (err) {
      console.error("Bitácora: Error obteniendo hotel_id del perfil:", err);
    }
  }

  container.innerHTML = `
    <div class="p-4 sm:p-6 md:p-8">
      <div class="bg-white shadow-md rounded-lg">
        <div class="px-6 py-4 border-b border-gray-200">
          <h2 class="text-xl font-semibold text-gray-700">Bitácora de Actividad del Sistema</h2>
        </div>
        <div class="p-6">
          <div id="bitacora-feedback" class="mb-4" style="display:none;" role="alert"></div>
          <div id="bitacora-loading" class="mb-4" style="display:none;"></div>
          
          <form id="form-bitacora-filtros" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6 items-end">
            <div class="form-group">
              <label for="bitacora-fecha-inicio" class="block text-sm font-medium text-gray-700 mb-1">Desde:</label>
              <input type="date" id="bitacora-fecha-inicio" class="form-control w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div class="form-group">
              <label for="bitacora-fecha-fin" class="block text-sm font-medium text-gray-700 mb-1">Hasta:</label>
              <input type="date" id="bitacora-fecha-fin" class="form-control w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div class="form-group">
              <label for="bitacora-usuario" class="block text-sm font-medium text-gray-700 mb-1">Usuario:</label>
              <select id="bitacora-usuario" class="form-control w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500">
                <option value="">Todos</option>
              </select>
            </div>
            <div class="form-group">
              <label for="bitacora-modulo-filtro" class="block text-sm font-medium text-gray-700 mb-1">Módulo:</label>
              <input type="text" id="bitacora-modulo-filtro" class="form-control w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500" placeholder="Ej: Reservas" />
            </div>
            <div class="form-group flex space-x-2">
              <button type="submit" id="bitacora-btn-aplicar-filtros" class="button button-primary py-2 px-4 w-full sm:w-auto">Filtrar</button>
              <button type="button" id="bitacora-btn-limpiar-filtros" class="button button-outline py-2 px-4 w-full sm:w-auto">Limpiar</button>
            </div>
          </form>
          
          <div class="overflow-x-auto rounded-lg border border-gray-200">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fecha y Hora</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuario Actor</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Módulo</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acción</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Detalles</th>
                </tr>
              </thead>
              <tbody id="tabla-bitacora-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
          </div>
          
          <div id="bitacora-paginacion-container" class="flex items-center justify-between mt-4 py-3" style="display:none;">
            <button id="btn-bitacora-prev" class="button button-outline py-2 px-4 text-sm">&laquo; Anterior</button>
            <span id="bitacora-pagina-info" class="text-sm text-gray-700 mx-2">Página 1 de 1</span>
            <button id="btn-bitacora-next" class="button button-outline py-2 px-4 text-sm">Siguiente &raquo;</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Cachear referencias al DOM
  tBodyEl = container.querySelector('#tabla-bitacora-body');
  pagContainerEl = container.querySelector('#bitacora-paginacion-container');
  infoSpanEl = container.querySelector('#bitacora-pagina-info');
  btnPrevEl = container.querySelector('#btn-bitacora-prev');
  btnNextEl = container.querySelector('#btn-bitacora-next');
  feedbackEl = container.querySelector('#bitacora-feedback');
  loadingEl = container.querySelector('#bitacora-loading');
  
  filterFormEl = container.querySelector('#form-bitacora-filtros');
  filterFechaInicioEl = container.querySelector('#bitacora-fecha-inicio');
  filterFechaFinEl = container.querySelector('#bitacora-fecha-fin');
  filterUsuarioEl = container.querySelector('#bitacora-usuario');
  filterModuloEl = container.querySelector('#bitacora-modulo-filtro');
  const btnLimpiarFiltros = container.querySelector('#bitacora-btn-limpiar-filtros');

  if (!hotelIdGlobal) {
    if (feedbackEl) showAppFeedback(feedbackEl, 'Error crítico: No se pudo identificar el hotel para cargar la bitácora.', 'error');
    return;
  }

  await cargarUsuariosParaFiltro(filterUsuarioEl);
  await cargarYRenderizarBitacora(1);

  const filtroSubmitHandler = (e) => {
    e.preventDefault();
    currentPage = 1; // Resetear a la primera página con nuevos filtros
    cargarYRenderizarBitacora(currentPage);
  };
  filterFormEl.addEventListener('submit', filtroSubmitHandler);
  activeListeners.push({ element: filterFormEl, type: 'submit', handler: filtroSubmitHandler });

  if (btnLimpiarFiltros) {
    const limpiarFiltrosHandler = () => {
        filterFormEl.reset(); // Limpia los campos del formulario
        currentPage = 1;
        cargarYRenderizarBitacora(currentPage);
    };
    btnLimpiarFiltros.addEventListener('click', limpiarFiltrosHandler);
    activeListeners.push({ element: btnLimpiarFiltros, type: 'click', handler: limpiarFiltrosHandler });
  }

  if (btnPrevEl) {
    const prevPageHandler = () => {
        if (currentPage > 1) {
            cargarYRenderizarBitacora(currentPage - 1);
        }
    };
    btnPrevEl.addEventListener('click', prevPageHandler);
    activeListeners.push({ element: btnPrevEl, type: 'click', handler: prevPageHandler });
  }

  if (btnNextEl) {
    const nextPageHandler = () => {
        const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE);
        if (currentPage < totalPages) {
            cargarYRenderizarBitacora(currentPage + 1);
        }
    };
    btnNextEl.addEventListener('click', nextPageHandler);
    activeListeners.push({ element: btnNextEl, type: 'click', handler: nextPageHandler });
  }
  console.log("Módulo de Bitácora montado y listeners añadidos.");
}

/**
 * Desmonta el módulo, removiendo listeners para evitar fugas de memoria.
 */
export function unmount() {
  console.log("Desmontando módulo de Bitácora...");
  activeListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  activeListeners = [];
  
  // Resetear variables globales específicas del módulo si es necesario
  hotelIdGlobal = null;
  currentUserGlobal = null;
  currentSupabaseInstance = null;
  currentPage = 1;
  totalRecords = 0;

  // Resetear referencias al DOM
  tBodyEl = pagContainerEl = infoSpanEl = btnPrevEl = btnNextEl = feedbackEl = loadingEl = null;
  filterFormEl = filterFechaInicioEl = filterFechaFinEl = filterUsuarioEl = filterModuloEl = null;
  console.log("Módulo de Bitácora desmontado y listeners eliminados.");
}