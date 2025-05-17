// js/modules/reportes/reportes.js
// Módulo de generación de reportes para el hotel

// import { supabase } from '../../supabaseClient.js'; // Not used directly, supabaseClient is assigned from mount parameter

// --- Module-Scoped Variables ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentChartInstance = null;
let supabaseClient = null; // Assigned in mount

// --- Utilities ---
/**
 * Formats a number as currency.
 * @param {number} value - The number to format.
 * @param {string} [currency='COP'] - The currency code.
 * @returns {string} Formatted currency string.
 */
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    // Return a default formatted zero if value is invalid, to maintain string type for UI
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
  return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString('es-CO', options); // Assuming es-CO locale
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
  // Example Tailwind classes, adjust to your project's styling for these indicators
  let bgColor = 'bg-blue-100 border-blue-300 text-blue-700'; // info
  if (typeClass === 'success-indicator') bgColor = 'bg-green-100 border-green-300 text-green-700';
  if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
  
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
  feedbackEl.style.display = 'block';

  if (typeClass === 'error-indicator') {
    feedbackEl.setAttribute('tabindex', '-1');
    feedbackEl.focus();
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
 * @param {string} fechaInicio - Start date in YYYY-MM-DD format.
 * @param {string} fechaFin - End date in YYYY-MM-DD format.
 */
async function generarReporteListadoReservas(resultsContainerEl, fechaInicio, fechaFin) {
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando listado de reservas...</p>';

  try {
    let query = supabaseClient
      .from('reservas')
      .select(`
        id, cliente_nombre, fecha_check_in, fecha_check_out, estado_reserva, monto_total,
        habitaciones (nombre),
        metodos_pago (nombre),
        usuarios (nombre_completo, email) 
      `) // Adjusted field names to common Supabase conventions
      .eq('hotel_id', currentHotelId)
      .order('fecha_check_in', { ascending: false });

    if (fechaInicio) query = query.gte('fecha_check_in', `${fechaInicio}T00:00:00.000Z`);
    if (fechaFin) query = query.lte('fecha_check_in', `${fechaFin}T23:59:59.999Z`); // Use check_in for range, or adjust as needed

    const { data: reservas, error } = await query;
    if (error) throw error;

    if (!reservas || reservas.length === 0) {
      resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron reservas para los criterios seleccionados.</p>';
      return;
    }

    let html = `
      <h4 class="text-lg font-semibold mb-3">Listado de Reservas (${formatDateLocal(fechaInicio, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFin, {dateStyle: 'medium'})})</h4>
      <div class="table-container overflow-x-auto">
        <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-50">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Cliente</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Habitación</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check-in</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Check-out</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Monto</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pagado con</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Creada por</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">`;

    reservas.forEach(r => {
      html += `
        <tr class="hover:bg-gray-50">
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${r.cliente_nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${r.habitaciones?.nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_check_in)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_check_out)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm">
            <span class="badge estado-${r.estado_reserva || 'default'} px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
              r.estado_reserva === 'CONFIRMADA' ? 'bg-green-100 text-green-800' : 
              r.estado_reserva === 'CANCELADA' ? 'bg-red-100 text-red-800' : 
              r.estado_reserva === 'CHECK_IN' ? 'bg-blue-100 text-blue-800' :
              r.estado_reserva === 'CHECK_OUT' ? 'bg-gray-100 text-gray-800' :
              'bg-yellow-100 text-yellow-800'
            }">${r.estado_reserva || 'N/A'}</span>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatCurrencyLocal(r.monto_total)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${r.metodos_pago?.nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${r.usuarios?.nombre_completo || r.usuarios?.email || 'Sistema'}</td>
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
 * @param {string} fechaInicio - Start date in YYYY-MM-DD format.
 * @param {string} fechaFin - End date in YYYY-MM-DD format.
 */
async function generarReporteIngresosPorPeriodo(resultsContainerEl, fechaInicio, fechaFin) {
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando reporte de ingresos...</p>';

  if (!window.Chart) {
    resultsContainerEl.innerHTML = '<p class="error-indicator text-center p-4 text-red-600">Librería de gráficos (Chart.js) no está cargada. Por favor, refresque la página.</p>';
    return;
  }

  try {
    const start = new Date(`${fechaInicio}T00:00:00.000Z`);
    const end = new Date(`${fechaFin}T23:59:59.999Z`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new Error('Rango de fechas inválido. Asegúrese de que la fecha de inicio no sea posterior a la fecha de fin.');
    }

    const labels = [];
    const dailyIncomeValues = [];
    // Iterate day by day within the selected range
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const currentDateISO = d.toISOString().slice(0, 10); // YYYY-MM-DD format
      labels.push(currentDateISO);
      
      const dayStartUTC = `${currentDateISO}T00:00:00.000Z`;
      const dayEndUTC = `${currentDateISO}T23:59:59.999Z`;
      
      const { data: pagosDelDia, error: fetchError } = await supabaseClient
        .from('pagos_reserva') // Assuming this is your payments table
        .select('monto')
        .eq('hotel_id', currentHotelId)
        .gte('fecha_pago', dayStartUTC)
        .lte('fecha_pago', dayEndUTC);

      if (fetchError) {
        console.warn(`Error fetching payments for ${currentDateISO}:`, fetchError.message);
        dailyIncomeValues.push(0); // Add 0 for days with errors to maintain chart structure
      } else {
        const totalDelDia = pagosDelDia.reduce((sum, p) => sum + (p.monto || 0), 0);
        dailyIncomeValues.push(totalDelDia);
      }
    }

    resultsContainerEl.innerHTML = `
      <h4 class="text-lg font-semibold mb-3">Ingresos por Período (${formatDateLocal(fechaInicio, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFin, {dateStyle: 'medium'})})</h4>
      <div class="chart-container bg-white p-4 rounded-lg shadow" style="height:350px; position: relative;">
        <canvas id="reporte-ingresos-chart"></canvas>
      </div>`;

    const ctx = resultsContainerEl.querySelector('#reporte-ingresos-chart').getContext('2d');
    if (currentChartInstance) {
      currentChartInstance.destroy();
    }
    currentChartInstance = new Chart(ctx, {
      type: 'bar', // Or 'line'
      data: {
        labels: labels,
        datasets: [{
          label: 'Ingresos Diarios',
          data: dailyIncomeValues,
          backgroundColor: 'rgba(75, 192, 192, 0.6)', // Example color
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
            ticks: {
              callback: function(value) {
                return formatCurrencyLocal(value);
              }
            }
          },
          x: {
            title: { display: true, text: 'Fecha' }
          }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.y !== null) {
                  label += formatCurrencyLocal(context.parsed.y);
                }
                return label;
              }
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
 * @param {object} sbInstance - The Supabase client instance (renamed from sb).
 * @param {object} user - The current authenticated user.
 */
export async function mount(container, sbInstance, user) {
  unmount(container); // Clean up previous instance

  supabaseClient = sbInstance;
  currentModuleUser = user;
  
  container.innerHTML = `
    <div class="card reportes-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Generador de Reportes</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="reportes-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px;"></div>
        <div class="reportes-controles mb-6 p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div class="form-group md:col-span-1">
              <label for="reporte-tipo-select" class="block text-sm font-medium text-gray-700">Tipo de Reporte:</label>
              <select id="reporte-tipo-select" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm">
                <option value="">-- Elija un reporte --</option>
                <option value="listado_reservas">Listado de Reservas</option>
                <option value="ingresos_por_periodo">Ingresos por Período</option>
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
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch(err) {
        console.error("Reports: Error fetching hotel_id from profile:", err);
    }
  }

  if (!currentHotelId) {
    showReportesFeedback(feedbackEl, 'Error crítico: Hotel no identificado. No se pueden generar reportes.', 'error-indicator', 0);
    if (btnGenerarEl) btnGenerarEl.disabled = true;
    tipoSelectEl.disabled = true;
    fechaInicioEl.disabled = true;
    fechaFinEl.disabled = true;
    return;
  }

  // Dynamically load Chart.js if not already present
  if (!window.Chart) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js'; // Pin version
    script.async = true;
    script.onload = () => console.log('Chart.js loaded for reports.');
    script.onerror = () => {
        console.error('Failed to load Chart.js from CDN.');
        showReportesFeedback(feedbackEl, 'Error al cargar la librería de gráficos. Algunos reportes podrían no funcionar.', 'error-indicator', 0);
    };
    document.head.appendChild(script);
  }

  const handleGenerateClick = async () => {
    const tipoReporte = tipoSelectEl.value;
    const fechaInicio = fechaInicioEl.value;
    const fechaFin = fechaFinEl.value;

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
    limpiarAreaResultados(resultadoContainerEl); // Clear previous results and chart

    try {
      if (tipoReporte === 'listado_reservas') {
        await generarReporteListadoReservas(resultadoContainerEl, fechaInicio, fechaFin);
      } else if (tipoReporte === 'ingresos_por_periodo') {
        await generarReporteIngresosPorPeriodo(resultadoContainerEl, fechaInicio, fechaFin);
      } else {
        showReportesFeedback(feedbackEl, 'Tipo de reporte no implementado.', 'info-indicator', 3000);
      }
    } catch (err) {
        // Errors from report functions are typically handled within them and shown in resultsContainerEl
        // This catch is for unexpected errors in the handler itself.
        console.error("Unexpected error in handleGenerateClick:", err);
        showReportesFeedback(feedbackEl, `Error inesperado: ${err.message}`, 'error-indicator', 0);
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
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null;
  currentModuleUser = null;
  supabaseClient = null; // Important to clear the client instance reference

  // Optional: Clear feedback if it's within the container and needs explicit cleanup
  if (container) {
      const feedbackEl = container.querySelector('#reportes-feedback');
      if (feedbackEl) clearReportesFeedback(feedbackEl);
      const resultadoContainerEl = container.querySelector('#reporte-resultado-container');
      if(resultadoContainerEl) resultadoContainerEl.innerHTML = ''; // Clear results
  }
  console.log('Reportes module unmounted.');
}
