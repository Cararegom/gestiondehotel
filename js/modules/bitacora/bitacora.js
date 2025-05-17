// js/modules/bitacora/bitacora.js
import { supabase } from '../../supabaseClient.js'; // Asumiendo que supabaseClient.js está dos niveles arriba
import { // Asegúrate que estos nombres y la ruta sean correctos según tu uiUtils.js
  showAppFeedback,
  clearAppFeedback,
  formatDateTime, // Usaremos este para más detalle que formatDateShort
  formatDate // Por si solo quieres la fecha en algún punto
} from '../../utils/uiUtils.js'; // Asumiendo uiUtils.js en js/utils/

// --- Variables Globales del Módulo ---
let activeListeners = [];
let hotelIdGlobal = null;
let currentUserGlobal = null; // Para saber quién está viendo, no necesariamente para filtrar bitácora por usuario que "hizo" la acción
let currentPage = 1;
const ITEMS_PER_PAGE = 15; // Registros por página
let totalRecords = 0;

// Referencias a elementos del DOM que se usarán repetidamente
let tBodyEl, pagContainerEl, infoSpanEl, btnPrevEl, btnNextEl, feedbackEl, loadingEl;
let filterFormEl, filterFechaInicioEl, filterFechaFinEl, filterUsuarioEl, filterModuloEl;


/**
 * Formatea los detalles de la bitácora para visualización.
 * Si es un objeto JSON, lo formatea. Si es muy largo, lo trunca.
 * @param {any} detalles - Los datos de la columna 'detalles'.
 * @returns {string} HTML formateado para los detalles.
 */
function formatBitacoraDetalles(detalles) {
  if (detalles === null || detalles === undefined) return 'N/A';
  let detallesStr;
  if (typeof detalles === 'object') {
    try {
      detallesStr = JSON.stringify(detalles, null, 2);
    } catch (e) {
      detallesStr = String(detalles); // Fallback a string si no es JSON válido
    }
  } else {
    detallesStr = String(detalles);
  }

  if (detallesStr.length > 150) {
    // Usar un <details> para contenido expandible es una buena UX
    return `
      <details class="bitacora-detalles-expandibles">
        <summary>${detallesStr.slice(0, 100)}... (ver más)</summary>
        <pre>${detallesStr}</pre>
      </details>
    `;
  }
  return `<pre class="bitacora-detalles-pre">${detallesStr}</pre>`;
}


/**
 * Carga y renderiza las entradas de la bitácora con filtros y paginación.
 */
async function cargarYRenderizarBitacora(page = 1) {
  if (!tBodyEl || !hotelIdGlobal) {
    console.error("Bitácora: Elementos del DOM o hotelId no disponibles.");
    return;
  }

  showAppFeedback(loadingEl, 'Cargando registros de bitácora...', 'loading', true);
  if(feedbackEl) clearAppFeedback(feedbackEl); // Limpiar errores previos
  tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-1">Cargando...</td></tr>`;

  const fechaInicio = filterFechaInicioEl.value;
  const fechaFin    = filterFechaFinEl.value;
  const usuarioId   = filterUsuarioEl.value; // ID del usuario que realizó la acción
  const moduloFiltro= filterModuloEl.value.trim();

  try {
    let query = supabase
      .from('bitacora') // Nombre de tu tabla de bitácora
      .select(`
        creado_en, 
        modulo, 
        accion, 
        detalles, 
        usuario_id, 
        usuarios (nombre, email) 
      `, { count: 'exact' }) // `usuarios` es el nombre de tu tabla de perfiles
      .eq('hotel_id', hotelIdGlobal)
      .order('creado_en', { ascending: false }); // Más recientes primero

    if (fechaInicio) query = query.gte('creado_en', `${fechaInicio}T00:00:00.000Z`);
    if (fechaFin)    query = query.lte('creado_en', `${fechaFin}T23:59:59.999Z`);
    if (usuarioId)   query = query.eq('usuario_id', usuarioId); // Filtrar por quién hizo la acción
    if (moduloFiltro)query = query.ilike('modulo', `%${moduloFiltro}%`);

    // Paginación
    const from = (page - 1) * ITEMS_PER_PAGE;
    const to   = from + ITEMS_PER_PAGE - 1;
    query = query.range(from, to);

    const { data: registros, error, count } = await query;
    
    if (loadingEl) clearAppFeedback(loadingEl); // Ocultar carga después del fetch
    if (error) throw error;

    totalRecords = count || 0;
    currentPage = page;
    tBodyEl.innerHTML = ''; // Limpiar "cargando..." de la tabla

    if (!registros || registros.length === 0) {
      tBodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-1">No se encontraron registros con los filtros aplicados.</td></tr>`;
    } else {
      registros.forEach(b => {
        const tr = document.createElement('tr');
        // El usuario que realizó la acción, no necesariamente el que está viendo la bitácora
        const actorName = b.usuarios?.nombre || b.usuarios?.email || (b.usuario_id ? `ID: ${b.usuario_id.substring(0,8)}...` : 'Sistema');
        
        tr.innerHTML = `
          <td>${formatDateTime(b.creado_en)}</td>
          <td>${actorName}</td>
          <td>${b.modulo || 'N/A'}</td>
          <td>${b.accion || 'N/A'}</td>
          <td>${formatBitacoraDetalles(b.detalles)}</td>
        `;
        tBodyEl.appendChild(tr);
      });
    }

    // Actualizar UI de paginación
    const totalPages = Math.ceil(totalRecords / ITEMS_PER_PAGE) || 1;
    if (infoSpanEl) infoSpanEl.textContent = `Página ${currentPage} de ${totalPages} (Total: ${totalRecords} registros)`;
    if (btnPrevEl) btnPrevEl.disabled = currentPage <= 1;
    if (btnNextEl) btnNextEl.disabled = currentPage >= totalPages;
    if (pagContainerEl) pagContainerEl.style.display = totalRecords > 0 ? 'flex' : 'none'; // Mostrar paginación si hay registros

  } catch (err) {
    console.error('Error al cargar bitácora:', err);
    if (loadingEl) clearAppFeedback(loadingEl);
    if (feedbackEl) showAppFeedback(feedbackEl, `Error al cargar bitácora: ${err.message}`, 'error', true);
    if (tBodyEl) tBodyEl.innerHTML = `<tr><td colspan="5" class="text-danger text-center p-1">Error cargando datos.</td></tr>`;
    if (pagContainerEl) pagContainerEl.style.display = 'none';
  }
}

/**
 * Carga los usuarios del hotel para el selector de filtro.
 */
async function cargarUsuariosParaFiltro(selectEl) {
  if (!selectEl || !hotelIdGlobal) return;
  selectEl.innerHTML = '<option value="">Cargando usuarios...</option>';
  try {
    const { data: usuarios, error } = await supabase
      .from('usuarios') // Tu tabla de perfiles de usuario
      .select('id, nombre, email')
      .eq('hotel_id', hotelIdGlobal)
      .order('nombre');
    if (error) throw error;

    let htmlOptions = '<option value="">Todos los usuarios</option>';
    if (usuarios && usuarios.length > 0) {
      usuarios.forEach(u => {
        htmlOptions += `<option value="${u.id}">${u.nombre || u.email}</option>`;
      });
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
export async function mount(container, sbInstance, user) { // sbInstance es la instancia de supabase
  currentUserGlobal = user;
  // No reasignar la 'supabase' importada: supabase = sbInstance;
  // Usar 'sbInstance' directamente o la 'supabase' importada si son la misma.
  // Por consistencia con otros módulos, usaremos la 'supabase' importada.

  activeListeners = []; // Resetear listeners en cada mount
  
  hotelIdGlobal = user?.user_metadata?.hotel_id;
  if (!hotelIdGlobal && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabase.from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError) throw perfilError;
      hotelIdGlobal = perfil?.hotel_id;
    } catch (err) {
      console.error("Bitácora: Error obteniendo hotel_id del perfil:", err);
    }
  }

  // HTML del módulo Bitácora
  container.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h2>Bitácora de Actividad del Sistema</h2>
      </div>
      <div class="card-body">
        <div id="bitacora-feedback" class="feedback-message" style="display:none;" role="alert"></div>
        <div id="bitacora-loading" class="feedback-message loading-indicator" style="display:none;"></div>

        <form id="form-bitacora-filtros" class="form-inline mb-2">
          <div class="form-group">
            <label for="bitacora-fecha-inicio">Desde:</label>
            <input type="date" id="bitacora-fecha-inicio" class="form-control" />
          </div>
          <div class="form-group">
            <label for="bitacora-fecha-fin">Hasta:</label>
            <input type="date" id="bitacora-fecha-fin" class="form-control" />
          </div>
          <div class="form-group">
            <label for="bitacora-usuario">Usuario:</label>
            <select id="bitacora-usuario" class="form-control">
              <option value="">Todos</option>
            </select>
          </div>
          <div class="form-group">
            <label for="bitacora-modulo-filtro">Módulo:</label>
            <input type="text" id="bitacora-modulo-filtro" class="form-control" placeholder="Ej: Reservas, Caja" />
          </div>
          <button type="submit" id="bitacora-btn-aplicar-filtros" class="button button-primary">Filtrar</button>
          <button type="button" id="bitacora-btn-limpiar-filtros" class="button button-outline">Limpiar</button>
        </form>

        <div class="table-container mt-2">
          <table class="tabla-estilizada">
            <thead>
              <tr>
                <th>Fecha y Hora</th>
                <th>Usuario Actor</th>
                <th>Módulo</th>
                <th>Acción</th>
                <th>Detalles</th>
              </tr>
            </thead>
            <tbody id="tabla-bitacora-body">
              </tbody>
          </table>
        </div>

        <div id="bitacora-paginacion-container" class="paginacion-container mt-2" style="display:none;">
          <button id="btn-bitacora-prev" class="button button-outline">&laquo; Anterior</button>
          <span id="bitacora-pagina-info" class="mx-1">Página 1 de 1</span>
          <button id="btn-bitacora-next" class="button button-outline">Siguiente &raquo;</button>
        </div>
      </div>
    </div>
  `;

  // Asignar elementos del DOM a variables después de que el HTML exista
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
    showAppFeedback(feedbackEl, 'Error crítico: No se pudo identificar el hotel para cargar la bitácora.', 'error', true);
    return;
  }

  // Cargar usuarios para el filtro y luego la bitácora inicial
  await cargarUsuariosParaFiltro(filterUsuarioEl);
  await cargarYRenderizarBitacora(1); // Cargar página 1 inicialmente

  // --- Configurar Event Listeners ---
  const filtroSubmitHandler = (e) => {
    e.preventDefault();
    currentPage = 1; // Resetear a la primera página con nuevos filtros
    cargarYRenderizarBitacora(currentPage);
  };
  filterFormEl.addEventListener('submit', filtroSubmitHandler);
  activeListeners.push({ element: filterFormEl, type: 'submit', handler: filtroSubmitHandler });

  if (btnLimpiarFiltros) {
    const limpiarFiltrosHandler = () => {
        filterFormEl.reset(); // Limpiar campos del formulario
        currentPage = 1;
        cargarYRenderizarBitacora(currentPage); // Recargar con filtros limpios
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
}

/**
 * Desmonta el módulo, removiendo listeners para evitar fugas de memoria.
 */
export function unmount() {
  activeListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  activeListeners = []; // Limpiar el array de listeners

  // Resetear variables globales del módulo si es necesario
  hotelIdGlobal = null;
  currentUserGlobal = null;
  currentPage = 1;
  totalRecords = 0;
  
  // Resetear referencias a elementos del DOM
  tBodyEl = pagContainerEl = infoSpanEl = btnPrevEl = btnNextEl = feedbackEl = loadingEl = null;
  filterFormEl = filterFechaInicioEl = filterFechaFinEl = filterUsuarioEl = filterModuloEl = null;
  // console.log('Módulo Bitácora desmontado.');
}