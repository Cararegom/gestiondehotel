// js/modules/reportes/reportes.js
// Módulo de generación de reportes para el hotel

// --- Module-Scoped Variables ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentChartInstance = null;
let supabaseClient = null; // Assigned in mount
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// --- Utilities ---
/**
 * Formats a number as currency.
 * @param {number} value - The number to format.
 * @param {string} [currency='COP'] - The currency code.
 * @returns {string} Formatted currency string.
 */
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency }).format(value);
};

/**
 * Formats a date string to a locale-specific string.
 * @param {string} dateStr - The date string to format.
 * @param {object} [options] - Options for toLocaleString.
 * @returns {string} Formatted date string, 'N/A', or 'Fecha Inválida'.
 */
const formatDateLocal = (dateStr, options = { dateStyle: 'short', timeStyle: 'short' }) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString('es-CO', options);
};

// --- UI Helper Functions ---
/**
 * Shows a feedback message in the reports module.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 * @param {string} message - The message to show.
 * @param {'info-indicator' | 'success-indicator' | 'error-indicator'} [typeClass='info-indicator'] - CSS class for feedback type.
 * @param {number} [duration=0] - Duration in ms to show the message. 0 for indefinite.
 */
function showReportesFeedback(feedbackEl, message, typeClass = 'info-indicator', duration = 0) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  let bgColor = 'bg-blue-100 border-blue-300 text-blue-700'; // info
  if (typeClass === 'success-indicator') bgColor = 'bg-green-100 border-green-300 text-green-700';
  if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
  
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
  feedbackEl.style.display = 'block';

  if (typeClass === 'error-indicator') {
    feedbackEl.setAttribute('tabindex', '-1');
    // feedbackEl.focus(); // Focusing might be too aggressive, consider if needed
  }

  if (duration > 0) {
    setTimeout(() => clearReportesFeedback(feedbackEl), duration);
  }
}

/**
 * Clears the feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 */
function clearReportesFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3'; // Reset classes
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

/**
 * Shows or hides a loading indicator and disables/enables the generate button.
 * @param {HTMLElement} loadingEl - The loading indicator element.
 * @param {HTMLButtonElement} generateButtonEl - The button to generate reports.
 * @param {boolean} show - True to show loading, false to hide.
 * @param {string} [message='Generando reporte...'] - Loading message.
 */
function showReportesLoading(loadingEl, generateButtonEl, show, message = 'Generando reporte...') {
  if (loadingEl) {
    loadingEl.textContent = message;
    loadingEl.style.display = show ? 'block' : 'none';
  }
  if (generateButtonEl) {
    generateButtonEl.disabled = show;
    if(show) {
        generateButtonEl.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        generateButtonEl.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

// --- Report Generation Functions ---
/**
 * Clears the report results area and destroys any existing chart.
 * @param {HTMLElement} resultsContainerEl - The container for report results.
 */
function limpiarAreaResultados(resultsContainerEl) {
  if (resultsContainerEl) {
    resultsContainerEl.innerHTML = '<p class="text-gray-500 text-center p-4">Seleccione un tipo de reporte y configure los filtros para ver los datos.</p>';
  }
  if (currentChartInstance) {
    currentChartInstance.destroy();
    currentChartInstance = null;
  }
}

/**
 * Generates and renders a list of reservations.
 * @param {HTMLElement} resultsContainerEl - The container for the report results.
 * @param {string} fechaInicioInput - Start date in YYYY-MM-DD format from input.
 * @param {string} fechaFinInput - End date in YYYY-MM-DD format from input.
 */
async function generarReporteListadoReservas(resultsContainerEl, fechaInicioInput, fechaFinInput) {
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando listado de reservas...</p>';

  try {
    // Convert input dates to full ISO strings for Supabase query
    const fechaInicioQuery = `${fechaInicioInput}T00:00:00.000Z`;
    const fechaFinQuery = `${fechaFinInput}T23:59:59.999Z`;

    let query = supabaseClient
      .from('reservas')
      .select(`
        id, 
        cliente_nombre, 
        fecha_inicio, 
        fecha_fin, 
        estado, 
        monto_total,
        habitaciones (nombre), 
        metodo_pago_id, 
        usuario_id 
      `) // Assuming 'estado' is the correct field, not 'estado_reserva'
         // Assuming 'metodo_pago_id' and 'usuario_id' are direct FKs. If they are tables, adjust select.
      .eq('hotel_id', currentHotelId)
      .order('fecha_inicio', { ascending: false }); // Changed to 'fecha_inicio'

    // Filter by date range. This typically filters reservations *created* or *starting* in the range.
    // If you want reservations *active* during the range, the logic is more complex.
    // For now, filtering by fecha_inicio within the range.
    if (fechaInicioInput) query = query.gte('fecha_inicio', fechaInicioQuery);
    if (fechaFinInput) query = query.lte('fecha_inicio', fechaFinQuery); 

    const { data: reservas, error } = await query;
    if (error) throw error;

    if (!reservas || reservas.length === 0) {
      resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron reservas para los criterios seleccionados.</p>';
      return;
    }

    // Fetch related data if IDs are present (example for metodos_pago, adapt for usuarios)
    // This is N+1, consider optimizing with a view or RPC for many records.
    const metodoPagoIds = [...new Set(reservas.map(r => r.metodo_pago_id).filter(id => id))];
    let metodosPagoMap = {};
    if (metodoPagoIds.length > 0) {
        const { data: metodosData, error: metodosError } = await supabaseClient
            .from('metodos_pago') // Assuming your table is 'metodos_pago'
            .select('id, nombre')
            .in('id', metodoPagoIds);
        if (metodosError) console.warn("Error fetching metodos_pago:", metodosError);
        else metodosPagoMap = Object.fromEntries(metodosData.map(m => [m.id, m.nombre]));
    }
    // Similar logic for usuarios if needed.

    let html = `
      <h4 class="text-lg font-semibold mb-3">Listado de Reservas (${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})})</h4>
      <div class="table-container overflow-x-auto">
        <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Habitación</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entrada</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Salida</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pagado con</th>
              </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">`;

    reservas.forEach(r => {
      const estadoLower = String(r.estado).toLowerCase();
      let estadoClass = 'bg-yellow-100 text-yellow-800'; // Default
      if (estadoLower === 'confirmada' || estadoLower === 'activa') estadoClass = 'bg-green-100 text-green-800';
      else if (estadoLower === 'cancelada') estadoClass = 'bg-red-100 text-red-800';
      else if (estadoLower === 'check_in' || estadoLower === 'checkin') estadoClass = 'bg-blue-100 text-blue-800';
      else if (estadoLower === 'check_out' || estadoLower === 'checkout' || estadoLower === 'completada' || estadoLower === 'finalizada_auto') estadoClass = 'bg-gray-100 text-gray-800';
      
      html += `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${r.cliente_nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${r.habitaciones?.nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_inicio)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_fin)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm">
            <span class="badge estado-${estadoLower} px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${estadoClass}">
              ${r.estado || 'N/A'}
            </span>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-right">${formatCurrencyLocal(r.monto_total)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${metodosPagoMap[r.metodo_pago_id] || 'N/A'}</td>
          </tr>`;
    });

    html += '</tbody></table></div>';
    resultsContainerEl.innerHTML = html;
  } catch (err) {
    console.error('Error generating reservations list report:', err);
    resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600">Error al generar listado: ${err.message}</p>`;
  }
}

/**
 * Generates and renders an income report by period with a chart.
 * @param {HTMLElement} resultsContainerEl - The container for the report results.
 * @param {string} fechaInicioInput - Start date in YYYY-MM-DD format from input.
 * @param {string} fechaFinInput - End date in YYYY-MM-DD format from input.
 */
async function generarReporteIngresosPorPeriodo(resultsContainerEl, fechaInicioInput, fechaFinInput) {
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando reporte de ingresos...</p>';

  if (!window.Chart) {
    resultsContainerEl.innerHTML = '<p class="error-indicator text-center p-4 text-red-600">Librería de gráficos (Chart.js) no está cargada. Por favor, refresque la página.</p>';
    return;
  }

  try {
    const start = new Date(`${fechaInicioInput}T00:00:00.000Z`);
    const end = new Date(`${fechaFinInput}T23:59:59.999Z`); // Ensure end of day
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new Error('Rango de fechas inválido. Asegúrese de que la fecha de inicio no sea posterior a la fecha de fin.');
    }

    const labels = [];
    const dailyIncomeValues = [];
    
    // Iterate day by day within the selected range (inclusive)
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const currentDateISO = d.toISOString().slice(0, 10); // YYYY-MM-DD format
      labels.push(currentDateISO);
      
      const dayStartUTC = `${currentDateISO}T00:00:00.000Z`;
      const dayEndUTC = `${currentDateISO}T23:59:59.999Z`;
      
      const { data: ingresosDelDia, error: fetchError } = await supabaseClient
        .from('caja') // <--- CAMBIO DE TABLA a 'caja'
        .select('monto')
        .eq('hotel_id', currentHotelId)
        .eq('tipo', 'ingreso') // <--- FILTRO por tipo de movimiento
        .gte('fecha_movimiento', dayStartUTC) // <--- CAMBIO COLUMNA de fecha a 'fecha_movimiento'
        .lte('fecha_movimiento', dayEndUTC)   // <--- CAMBIO COLUMNA de fecha
        // IMPORTANTE: Ajusta los 'ilike' según tus conceptos para ingresos de habitaciones
        .or('concepto.ilike.Alquiler de%,concepto.ilike.Extensión de%,concepto.ilike.Estadia en%,concepto.ilike.Noche adicional%');

      if (fetchError) {
        console.warn(`Error fetching income for ${currentDateISO} from 'caja':`, fetchError.message);
        dailyIncomeValues.push(0); 
      } else {
        const totalDelDia = ingresosDelDia.reduce((sum, p) => sum + (p.monto || 0), 0);
        dailyIncomeValues.push(totalDelDia);
      }
    }

    resultsContainerEl.innerHTML = `
      <h4 class="text-lg font-semibold mb-3">Ingresos por Habitaciones (${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})})</h4>
      <div class="chart-container bg-white p-4 rounded-lg shadow" style="height:350px; position: relative;">
        <canvas id="reporte-ingresos-chart"></canvas>
      </div>`;

    const ctx = resultsContainerEl.querySelector('#reporte-ingresos-chart').getContext('2d');
    if (currentChartInstance) {
      currentChartInstance.destroy();
    }
    currentChartInstance = new Chart(ctx, {
      type: 'bar', 
      data: {
        labels: labels,
        datasets: [{
          label: 'Ingresos Diarios por Habitaciones',
          data: dailyIncomeValues,
          backgroundColor: 'rgba(75, 192, 192, 0.6)', 
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            beginAtZero: true,
            ticks: { callback: value => formatCurrencyLocal(value) }
          },
          x: { title: { display: true, text: 'Fecha' } }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: context => `${context.dataset.label || ''}: ${formatCurrencyLocal(context.parsed.y)}`
            }
          }
        }
      }
    });
  } catch (err) {
    console.error('Error generating income report:', err);
    resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600">Error al generar reporte de ingresos: ${err.message}</p>`;
  }
}

// --- Mount / Unmount ---
/**
 * Mounts the reports module.
 * @param {HTMLElement} container - The main container for the module.
 * @param {object} sbInstance - The Supabase client instance.
 * @param {object} user - The current authenticated user.
 */
export async function mount(container, sbInstance, user) {
  unmount(container); 

  supabaseClient = sbInstance;
  currentModuleUser = user;
  
  container.innerHTML = `
    <div class="card reportes-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Generador de Reportes</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="reportes-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px; display:none;"></div>
        <div class="reportes-controles mb-6 p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div class="form-group md:col-span-1">
              <label for="reporte-tipo-select" class="block text-sm font-medium text-gray-700">Tipo de Reporte:</label>
              <select id="reporte-tipo-select" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                <option value="">-- Elija un reporte --</option>
                <option value="listado_reservas">Listado de Reservas</option>
                <option value="ingresos_por_periodo">Ingresos por Habitaciones</option>
                </select>
            </div>
            <div class="form-group md:col-span-1">
              <label for="reporte-fecha-inicio" class="block text-sm font-medium text-gray-700">Desde:</label>
              <input type="date" id="reporte-fecha-inicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
            </div>
            <div class="form-group md:col-span-1">
              <label for="reporte-fecha-fin" class="block text-sm font-medium text-gray-700">Hasta:</label>
              <input type="date" id="reporte-fecha-fin" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
            </div>
            <div class="form-group md:col-span-1">
              <button id="btn-generar-reporte" class="button button-primary w-full py-2 px-4 rounded-md text-sm">Generar Reporte</button>
            </div>
          </div>
        </div>
        <div id="reportes-loading" class="loading-indicator text-center py-4 text-gray-500" style="display:none;"></div>
        <div id="reporte-resultado-container" class="mt-4 min-h-[200px] bg-white p-1 rounded-lg shadow">
          <p class="text-gray-500 text-center p-4">Seleccione un tipo de reporte y configure los filtros para ver los datos.</p>
        </div>
      </div>
    </div>`;

  const tipoSelectEl = container.querySelector('#reporte-tipo-select');
  const fechaInicioEl = container.querySelector('#reporte-fecha-inicio');
  const fechaFinEl = container.querySelector('#reporte-fecha-fin');
  const btnGenerarEl = container.querySelector('#btn-generar-reporte');
  const feedbackEl = container.querySelector('#reportes-feedback');
  const loadingEl = container.querySelector('#reportes-loading');
  const resultadoContainerEl = container.querySelector('#reporte-resultado-container');

  // Determine hotelId
  currentHotelId = user?.user_metadata?.hotel_id;
  if (!currentHotelId && user?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseClient.from('usuarios').select('hotel_id').eq('id', user.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError; // PGRST116: 0 rows, no error
      currentHotelId = perfil?.hotel_id;
    } catch(err) {
        console.error("Reports: Error fetching hotel_id from profile:", err);
        // Non-critical for now, but report generation will fail if currentHotelId remains null
    }
  }

  if (!currentHotelId) {
    showReportesFeedback(feedbackEl, 'Error crítico: Hotel no identificado. No se pueden generar reportes.', 'error-indicator', 0);
    if (btnGenerarEl) btnGenerarEl.disabled = true;
    if (tipoSelectEl) tipoSelectEl.disabled = true;
    if (fechaInicioEl) fechaInicioEl.disabled = true;
    if (fechaFinEl) fechaFinEl.disabled = true;
    return;
  }

  // Dynamically load Chart.js if not already present
  if (!window.Chart) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    script.async = true;
    script.onload = () => console.log('Chart.js loaded for reports.');
    script.onerror = () => {
        console.error('Failed to load Chart.js from CDN.');
        showReportesFeedback(feedbackEl, 'Error al cargar la librería de gráficos. Algunos reportes podrían no funcionar.', 'error-indicator', 0);
    };
    document.head.appendChild(script);
    moduleListeners.push({ element: script, type: 'remove-on-unmount' }); // Track script for potential removal
  }

  const handleGenerateClick = async () => {
    const tipoReporte = tipoSelectEl.value;
    const fechaInicio = fechaInicioEl.value; // YYYY-MM-DD
    const fechaFin = fechaFinEl.value;     // YYYY-MM-DD

    if (!tipoReporte) {
      showReportesFeedback(feedbackEl, 'Por favor, seleccione un tipo de reporte.', 'error-indicator', 3000);
      return;
    }
    if (!fechaInicio || !fechaFin) {
      showReportesFeedback(feedbackEl, 'Por favor, seleccione un rango de fechas (Desde y Hasta).', 'error-indicator', 3000);
      return;
    }
    if (new Date(fechaInicio) > new Date(fechaFin)) {
      showReportesFeedback(feedbackEl, 'La fecha "Desde" no puede ser posterior a la fecha "Hasta".', 'error-indicator', 3000);
      return;
    }

    showReportesLoading(loadingEl, btnGenerarEl, true, 'Generando reporte, por favor espere...');
    clearReportesFeedback(feedbackEl);
    limpiarAreaResultados(resultadoContainerEl); 

    try {
      if (tipoReporte === 'listado_reservas') {
        await generarReporteListadoReservas(resultadoContainerEl, fechaInicio, fechaFin);
      } else if (tipoReporte === 'ingresos_por_periodo') {
        await generarReporteIngresosPorPeriodo(resultadoContainerEl, fechaInicio, fechaFin);
      } else {
        showReportesFeedback(feedbackEl, 'Tipo de reporte no implementado.', 'info-indicator', 3000);
        resultadoContainerEl.innerHTML = `<p class="text-gray-500 text-center p-4">El tipo de reporte '${tipoReporte}' aún no está disponible.</p>`;
      }
    } catch (err) {
        console.error("Unexpected error in handleGenerateClick:", err);
        showReportesFeedback(feedbackEl, `Error inesperado al generar el reporte: ${err.message}`, 'error-indicator', 0);
        resultadoContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600">Ocurrió un error inesperado. Revise la consola.</p>`;
    } finally {
        showReportesLoading(loadingEl, btnGenerarEl, false);
    }
  };

  btnGenerarEl.addEventListener('click', handleGenerateClick);
  moduleListeners.push({ element: btnGenerarEl, type: 'click', handler: handleGenerateClick });
}

/**
 * Unmounts the reports module, cleaning up listeners and state.
 * @param {HTMLElement} container - The main container of the module (optional, for targeted cleanup).
 */
export function unmount(container) {
  if (currentChartInstance) {
    currentChartInstance.destroy();
    currentChartInstance = null;
  }
  moduleListeners.forEach(({ element, type, handler }) => {
    if (type === 'remove-on-unmount' && element && element.parentNode) {
        // element.parentNode.removeChild(element); // Optional: remove dynamically added scripts
    } else if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  currentModuleUser = null;
  supabaseClient = null; 

  if (container) {
      const feedbackEl = container.querySelector('#reportes-feedback');
      if (feedbackEl) clearReportesFeedback(feedbackEl);
      const resultadoContainerEl = container.querySelector('#reporte-resultado-container');
      if(resultadoContainerEl) resultadoContainerEl.innerHTML = '<p class="text-gray-500 text-center p-4">Módulo de reportes desmontado.</p>';
  }
  // console.log('Reportes module unmounted.');
}
