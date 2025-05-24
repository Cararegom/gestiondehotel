// js/modules/dashboard/dashboard.js
import { showAppFeedback, clearAppFeedback, formatDateTime, formatCurrency } from '../../uiUtils.js'; // Ajusta la ruta si es necesario

let chartRevenueInstance = null;
let chartOcupacionInstance = null;
let moduleDashboardListeners = [];

function updateCardContent(containerEl, cardId, value, isCurrency = false, isLoading = false) {
  const el = containerEl.querySelector(`#${cardId}`);
  if (!el) {
    console.warn(`Dashboard card element not found: #${cardId}`);
    return;
  }
  if (isLoading) {
    el.innerHTML = `<span class="placeholder-loading text-gray-400">Cargando...</span>`;
    el.classList.remove('text-red-500', 'text-green-600', 'text-blue-600');
    return;
  }
  if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) {
    el.textContent = 'Error'; // O 'N/A', '-', etc.
    el.classList.add('text-red-500');
    el.classList.remove('text-green-600', 'text-blue-600');
  } else {
    el.textContent = isCurrency ? formatCurrency(value) : String(value);
    el.classList.remove('text-red-500');
    if (typeof value === 'string' && value.includes('%')) {
        el.classList.add('text-blue-600');
    } else if (isCurrency && Number(String(value).replace(/[^0-9.-]+/g,"")) >= 0) { // Convertir a número antes de comparar
        el.classList.add('text-green-600');
    }
  }
}

async function fetchChartDataForDashboard(hotelId, supabaseInstance, numDays = 7) {
  const labels = [];
  const dailyRoomRevenueData = [];
  const dailyOcupacionData = []; // Sigue siendo mock

  const today = new Date();
  for (let i = numDays - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const dateString = date.toISOString().slice(0, 10);
    labels.push(dateString);
  }

  try {
    const revenuePromises = labels.map(day => {
      const startOfDay = `${day}T00:00:00.000Z`;
      const endOfDay = `${day}T23:59:59.999Z`;
      
      // CORRECCIÓN SUGERIDA:
      // Se añadió 'concepto.ilike.Estadía en%' (con acento) a la condición .or()
      // Verifica que estos conceptos coincidan con los que usas en tu tabla 'caja'
      const orClause = 'concepto.ilike.Alquiler de%,concepto.ilike.Extensión de%,concepto.ilike.Estadia en%,concepto.ilike.Estadía en%,concepto.ilike.Noche adicional%';
      // Si tienes otros conceptos para ingresos de habitación, añádelos aquí. Ejemplo:
      // const orClause = 'concepto.ilike.Alquiler de Habitación%,concepto.ilike.Estadía completa%,...';

      return supabaseInstance.from('caja')
        .select('monto')
        .eq('hotel_id', hotelId)
        .eq('tipo', 'ingreso')
        .gte('fecha_movimiento', startOfDay)
        .lte('fecha_movimiento', endOfDay)
        .or(orClause) // Usar la variable orClause
        .then(({ data, error }) => {
          if (error) {
            console.warn(`Error obteniendo ingresos de habitaciones para ${day} desde 'caja':`, error.message);
            return 0;
          }
          return data ? data.reduce((sum, entry) => sum + (entry.monto || 0), 0) : 0;
        });
    });
    const revenues = await Promise.all(revenuePromises);
    dailyRoomRevenueData.push(...revenues);

    labels.forEach(() => dailyOcupacionData.push(Math.floor(Math.random() * 71) + 20));

  } catch (e) {
    console.error("Error obteniendo datos para gráficos del dashboard:", e);
    if (dailyRoomRevenueData.length < numDays) dailyRoomRevenueData.push(...new Array(numDays - dailyRoomRevenueData.length).fill(0));
    if (dailyOcupacionData.length < numDays) dailyOcupacionData.push(...new Array(numDays - dailyOcupacionData.length).fill(0));
  }
  
  return { labels, dailyRevenueData: dailyRoomRevenueData, dailyOcupacionData };
}

async function renderDashboardCharts(containerEl, hotelId, supabaseInstance) {
  const chartErrorDivRev = containerEl.querySelector('#dashboard-charts-error-revenue');
  const chartErrorDivOcup = containerEl.querySelector('#dashboard-charts-error-ocupacion');

  if (!window.Chart) {
    console.error('Chart.js no está cargado.'); 
    if(chartErrorDivRev) showAppFeedback(chartErrorDivRev, 'Librería de gráficos no disponible.', 'error', true);
    if(chartErrorDivOcup) showAppFeedback(chartErrorDivOcup, 'Librería de gráficos no disponible.', 'error', true);
    return;
  }
  if(chartErrorDivRev) clearAppFeedback(chartErrorDivRev);
  if(chartErrorDivOcup) clearAppFeedback(chartErrorDivOcup);

  const chartData = await fetchChartDataForDashboard(hotelId, supabaseInstance);

  const revCtx = containerEl.querySelector('#chart-revenue')?.getContext('2d');
  if (revCtx) {
    if (chartRevenueInstance) chartRevenueInstance.destroy();
    chartRevenueInstance = new Chart(revCtx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: 'Ingresos por Habitaciones (Últimos 7 Días)',
          data: chartData.dailyRevenueData,
          borderColor: 'rgb(75, 192, 192)',
          backgroundColor: 'rgba(75, 192, 192, 0.2)',
          fill: true,
          tension: 0.3
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, ticks: { callback: val => formatCurrency(val) } } }
      }
    });
  }

  const ocuCtx = containerEl.querySelector('#chart-ocupacion')?.getContext('2d');
  if (ocuCtx) {
    if (chartOcupacionInstance) chartOcupacionInstance.destroy();
    chartOcupacionInstance = new Chart(ocuCtx, {
      type: 'bar',
      data: {
        labels: chartData.labels,
        datasets: [{
          label: '% Ocupación Estimada (Últimos 7 Días)',
          data: chartData.dailyOcupacionData,
          backgroundColor: 'rgba(54, 162, 235, 0.6)',
          borderColor: 'rgb(54, 162, 235)'
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100, ticks: { callback: val => `${val}%` } } }
      }
    });
  }
}

async function loadDashboardPageData(containerEl, hotelId, supabaseInstance) {
  const dashboardErrorMainDiv = containerEl.querySelector('#dashboard-main-error');
  if (dashboardErrorMainDiv) clearAppFeedback(dashboardErrorMainDiv);

  ['card-reservas-hoy', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda']
    .forEach(id => updateCardContent(containerEl, id, null, id === 'card-ingresos-hoy' || id === 'card-ventas-tienda', true));
  const listCheckoutsEl = containerEl.querySelector('#list-next-checkouts');
  if (listCheckoutsEl) listCheckoutsEl.innerHTML = '<li><span class="placeholder-loading text-gray-400">Cargando check-outs...</span></li>';

  try {
    const today = new Date();
    const inicioDiaUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0)).toISOString();
    const finDiaUTC = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 59, 59, 999)).toISOString();
    const inicioSiguientes7Dias = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1, 0, 0, 0, 0)).toISOString();
    const finSiguientes7Dias = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 7, 23, 59, 59, 999)).toISOString();

    // CORRECCIÓN SUGERIDA:
    // Se añadió 'concepto.ilike.Estadía en%' (con acento) a la condición .or()
    // Verifica que estos conceptos coincidan con los que usas en tu tabla 'caja'
    const orClauseIngresosHabitaciones = 'concepto.ilike.Alquiler de%,concepto.ilike.Extensión de%,concepto.ilike.Estadia en%,concepto.ilike.Estadía en%,concepto.ilike.Noche adicional%';
    // Si tienes otros conceptos para ingresos de habitación, añádelos aquí. Ejemplo:
    // const orClauseIngresosHabitaciones = 'concepto.ilike.Alquiler de Habitación%,concepto.ilike.Estadía completa%,...';


    const [
        reservasHoyResult, 
        ingresosHabitacionesHoyResult, 
        habitacionesTotalResult,
        habitacionesOcupadasResult, 
        ventasTiendaHoyResult, 
        proximosCheckoutsResult
    ] = await Promise.all([
        supabaseInstance.from('reservas').select('id', { count: 'exact', head: false }).eq('hotel_id', hotelId).lte('fecha_inicio', finDiaUTC).gte('fecha_fin', inicioDiaUTC).in('estado', ['activa', 'confirmada', 'check_in']),
        
        supabaseInstance.from('caja')
            .select('monto')
            .eq('hotel_id', hotelId)
            .eq('tipo', 'ingreso')
            .gte('fecha_movimiento', inicioDiaUTC)
            .lte('fecha_movimiento', finDiaUTC)
            .or(orClauseIngresosHabitaciones), // Usar la variable orClauseIngresosHabitaciones
        
        supabaseInstance.from('habitaciones').select('id', { count: 'exact', head: false }).eq('hotel_id', hotelId).eq('activo', true),
        
        supabaseInstance.from('habitaciones').select('id', { count: 'exact', head: false }).eq('hotel_id', hotelId).eq('estado', 'ocupada'),
        
        supabaseInstance.from('ventas_tienda').select('total_venta').eq('hotel_id', hotelId).gte('fecha', inicioDiaUTC).lte('fecha', finDiaUTC),
        
        supabaseInstance.from('reservas')
            .select('id, cliente_nombre, fecha_fin, habitaciones(nombre)') 
            .eq('hotel_id', hotelId)
            .gte('fecha_fin', inicioDiaUTC)
            .lte('fecha_fin', finSiguientes7Dias)
            .in('estado', ['activa', 'check_in', 'confirmada'])
            .order('fecha_fin', { ascending: true }).limit(5)
    ]);
    
    if (reservasHoyResult.error) console.error("Error fetching 'Reservas Activas Hoy':", reservasHoyResult.error);
    updateCardContent(containerEl, 'card-reservas-hoy', reservasHoyResult.error ? null : (reservasHoyResult.count || 0));
    
    if (ingresosHabitacionesHoyResult.error) console.error("Error fetching 'Ingresos Habitaciones Hoy':", ingresosHabitacionesHoyResult.error);
    const totalIngresosHabitacionesHoy = ingresosHabitacionesHoyResult.error ? null : (ingresosHabitacionesHoyResult.data?.reduce((sum, p) => sum + (p.monto || 0), 0) || 0);
    updateCardContent(containerEl, 'card-ingresos-hoy', totalIngresosHabitacionesHoy, true);
        
    if (habitacionesTotalResult.error) console.error("Error fetching 'Total Habitaciones':", habitacionesTotalResult.error);
    const totalHab = habitacionesTotalResult.error ? null : (habitacionesTotalResult.count || 0);
    
    if (habitacionesOcupadasResult.error) console.error("Error fetching 'Habitaciones Ocupadas':", habitacionesOcupadasResult.error);
    const ocupHab = habitacionesOcupadasResult.error ? null : (habitacionesOcupadasResult.count || 0);
    const ocupacionRate = (totalHab !== null && ocupHab !== null && totalHab > 0) ? Math.round((ocupHab / totalHab) * 100) : 0;
    updateCardContent(containerEl, 'card-ocupacion', (totalHab === null || ocupHab === null) ? null : `${ocupacionRate}% (${ocupHab}/${totalHab})`);
    
    if (ventasTiendaHoyResult.error) console.error("Error fetching 'Ventas Tienda Hoy':", ventasTiendaHoyResult.error);
    const totalVentasTienda = ventasTiendaHoyResult.error ? null : (ventasTiendaHoyResult.data?.reduce((sum, v) => sum + (v.total_venta || 0), 0) || 0);
    updateCardContent(containerEl, 'card-ventas-tienda', totalVentasTienda, true);

    if (listCheckoutsEl) {
      listCheckoutsEl.innerHTML = '';
      if (proximosCheckoutsResult.error) {
        console.error("Error fetching 'Próximos Checkouts':", proximosCheckoutsResult.error);
        listCheckoutsEl.innerHTML = '<li><span class="text-red-500">Error al cargar check-outs.</span></li>';
      } else if (!proximosCheckoutsResult.data || proximosCheckoutsResult.data.length === 0) {
        listCheckoutsEl.innerHTML = '<li>No hay check-outs próximos.</li>';
      } else {
        proximosCheckoutsResult.data.forEach(r => {
          const li = document.createElement('li');
          li.className = 'dashboard-checkout-item py-2 border-b border-gray-200 last:border-b-0';
          const nombreCliente = r.cliente_nombre || 'Cliente'; 
          li.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-medium text-gray-700">${nombreCliente}</span>
                <span class="text-xs text-gray-500">Hab: ${r.habitaciones?.nombre || 'N/A'}</span>
            </div>
            <div class="text-xs text-indigo-600">
                Sale: ${formatDateTime(r.fecha_fin, 'es-CO', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>`;
          listCheckoutsEl.appendChild(li);
        });
      }
    }
  } catch (err) {
    console.error("Error cargando datos del dashboard:", err);
    if (dashboardErrorMainDiv) showAppFeedback(dashboardErrorMainDiv, `Error al cargar datos: ${err.message || "Error desconocido."}`, 'error', true);
    ['card-reservas-hoy', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda']
        .forEach(id => updateCardContent(containerEl, id, null, id === 'card-ingresos-hoy' || id === 'card-ventas-tienda'));
    if (listCheckoutsEl) listCheckoutsEl.innerHTML = '<li><span class="text-red-500">Error al cargar datos.</span></li>';
  }
}

export async function mount(container, supabaseInstance, currentUser) {
  unmount(container);

  container.innerHTML = `
    <header class="main-header mb-6">
      <h1 class="text-2xl font-bold text-gray-800">Dashboard General</h1>
    </header>
    <div id="dashboard-main-error" class="feedback-message error-indicator mb-4" style="display:none;" role="alert"></div>

    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 dashboard-cards">
      <div class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Reservas Activas Hoy</h3>
        <p id="card-reservas-hoy" class="dashboard-metric text-3xl font-bold text-gray-800"><span class="placeholder-loading text-gray-400">Cargando...</span></p>
      </div>
      <div class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ingresos Habitaciones Hoy</h3>
        <p id="card-ingresos-hoy" class="dashboard-metric text-3xl font-bold text-gray-800"><span class="placeholder-loading text-gray-400">Cargando...</span></p>
      </div>
      <div class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ocupación Actual</h3>
        <p id="card-ocupacion" class="dashboard-metric text-3xl font-bold text-gray-800"><span class="placeholder-loading text-gray-400">Cargando...</span></p>
      </div>
      <div class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ventas Tienda Hoy</h3>
        <p id="card-ventas-tienda" class="dashboard-metric text-3xl font-bold text-gray-800"><span class="placeholder-loading text-gray-400">Cargando...</span></p>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 dashboard-charts">
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white">
          <div class="card-header mb-2 border-b pb-2"><h3 class="text-lg font-semibold text-gray-700">Ingresos Habitaciones (Últimos 7 Días)</h3></div>
          <div id="dashboard-charts-error-revenue" class="feedback-message error-indicator mb-2" style="display:none;" role="alert"></div>
          <div class="chart-container" style="height:300px; position: relative;">
              <canvas id="chart-revenue"></canvas>
          </div>
      </div>
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white">
          <div class="card-header mb-2 border-b pb-2"><h3 class="text-lg font-semibold text-gray-700">Ocupación (Últimos 7 Días) - Mock</h3></div>
          <div id="dashboard-charts-error-ocupacion" class="feedback-message error-indicator mb-2" style="display:none;" role="alert"></div>
          <div class="chart-container" style="height:300px; position: relative;">
              <canvas id="chart-ocupacion"></canvas>
          </div>
      </div>
    </section>

    <section class="dashboard-recent card p-4 rounded-lg shadow-md bg-white mb-6">
      <div class="card-header mb-3 border-b pb-2"><h2 class="text-lg font-semibold text-gray-700">Próximos Check-Out (Hoy y Siguientes 7 días)</h2></div>
      <ul id="list-next-checkouts" class="list-unstyled card-body space-y-2" style="padding-left: 0;">
        <li><span class="placeholder-loading text-gray-400">Cargando...</span></li>
      </ul>
    </section>
    
    <section class="card atajos-card p-4 rounded-lg shadow-md bg-white">
      <div class="card-header mb-3 border-b pb-2"><h3 class="text-lg font-semibold text-gray-700">Accesos Rápidos</h3></div>
      <div class="card-body atajos-buttons flex flex-wrap gap-3">
        <button class="button button-primary py-2 px-4 rounded-md flex items-center text-sm" data-navegar="#/reservas">
            <span class="mr-2">📅</span> Nueva Reserva
        </button>
        <button class="button button-accent py-2 px-4 rounded-md flex items-center text-sm" data-navegar="#/mapa-habitaciones">
            <span class="mr-2">🗺️</span> Mapa Habitaciones
        </button>
        <button class="button button-accent py-2 px-4 rounded-md flex items-center text-sm" data-navegar="#/caja">
            <span class="mr-2">💰</span> Ir a Caja
        </button>
        <button class="button button-outline py-2 px-4 rounded-md flex items-center text-sm" data-navegar="#/reportes">
            <span class="mr-2">📊</span> Ver Reportes
        </button>
      </div>
    </section>
  `;

  let hotelId = currentUser?.user_metadata?.hotel_id;
  const mainErrorDiv = container.querySelector('#dashboard-main-error');

  if (!hotelId && currentUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      hotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("Dashboard: Error fetching hotel_id from profile:", err);
      if (mainErrorDiv) showAppFeedback(mainErrorDiv, "No se pudo determinar el hotel del usuario. Verifique la configuración del perfil.", 'error', true);
      return; 
    }
  }

  if (!hotelId) {
    if (mainErrorDiv) showAppFeedback(mainErrorDiv, "Hotel ID no disponible. No se puede cargar el dashboard.", 'error', true);
    return;
  }

  if (!window.Chart) {
    const chartJsScript = document.createElement('script');
    chartJsScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    chartJsScript.async = true;
    chartJsScript.onload = () => {
      console.log('Chart.js loaded dynamically for dashboard.');
      renderDashboardCharts(container, hotelId, supabaseInstance);
    };
    chartJsScript.onerror = () => {
      console.error('Error loading Chart.js from CDN for dashboard.');
      const chartErrorRevDiv = container.querySelector('#dashboard-charts-error-revenue');
      const chartErrorOcuDiv = container.querySelector('#dashboard-charts-error-ocupacion');
      if (chartErrorRevDiv) showAppFeedback(chartErrorRevDiv, 'Error al cargar librería de gráficos (Ingresos).', 'error', true);
      if (chartErrorOcuDiv) showAppFeedback(chartErrorOcuDiv, 'Error al cargar librería de gráficos (Ocupación).', 'error', true);
    };
    document.head.appendChild(chartJsScript);
    moduleDashboardListeners.push({ element: chartJsScript, type: 'remove-on-unmount' });
  } else {
    renderDashboardCharts(container, hotelId, supabaseInstance);
  }

  await loadDashboardPageData(container, hotelId, supabaseInstance);

  const atajosContainer = container.querySelector('.atajos-card .atajos-buttons');
  if (atajosContainer) {
      const atajosHandler = (e) => {
          const targetButton = e.target.closest('button[data-navegar]');
          if (!targetButton) return;
          e.preventDefault();
          const destino = targetButton.dataset.navegar;
          if (destino) window.location.hash = destino;
      };
      atajosContainer.addEventListener('click', atajosHandler);
      moduleDashboardListeners.push({ element: atajosContainer, type: 'click', handler: atajosHandler });
  }
}

export function unmount(container) {
  if (chartRevenueInstance) {
    chartRevenueInstance.destroy();
    chartRevenueInstance = null;
  }
  if (chartOcupacionInstance) {
    chartOcupacionInstance.destroy();
    chartOcupacionInstance = null;
  }

  moduleDashboardListeners.forEach(({ element, type, handler }) => {
    if (type === 'remove-on-unmount' && element && element.parentNode) {
      // element.parentNode.removeChild(element); // Opcional
    } else if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleDashboardListeners = [];
}
