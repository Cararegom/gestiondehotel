// js/modules/dashboard/dashboard.js
import { showAppFeedback, clearAppFeedback, formatDateTime, formatCurrency } from '../../uiUtils.js';

let chartRevenueInstance = null;
let chartOcupacionInstance = null;
let moduleDashboardListeners = [];
let realtimeChannel = null; 

function updateCardContent(containerEl, cardId, value, comparisonValue = null, isCurrency = false, isLoading = false, customText = null) {
  const cardDiv = containerEl.querySelector(`#${cardId}`);
  if (!cardDiv) {
    console.warn(`[Dashboard] Contenedor de tarjeta no encontrado: #${cardId}`);
    return;
  }
  const valueEl = cardDiv.querySelector('.dashboard-metric-value');
  const comparisonEl = cardDiv.querySelector('.dashboard-metric-comparison');

  if (!valueEl || !comparisonEl) {
    console.warn(`[Dashboard] Elementos internos de tarjeta no encontrados para: #${cardId}`);
    return;
  }

  valueEl.classList.remove('text-red-500', 'text-green-600', 'text-blue-600', 'text-gray-800'); 

  if (isLoading) {
    valueEl.innerHTML = `<span class="text-2xl text-gray-400">Cargando...</span>`;
    comparisonEl.textContent = ''; 
    comparisonEl.className = 'dashboard-metric-comparison text-xs text-gray-400 mt-1';
    return;
  }

  if (value === null || typeof value === 'undefined' || (typeof value === 'number' && isNaN(value))) {
    valueEl.textContent = 'Error';
    valueEl.classList.add('text-red-500');
    comparisonEl.textContent = 'Cálculo fallido';
    comparisonEl.className = 'dashboard-metric-comparison text-xs text-red-400 mt-1';
  } else {
    valueEl.textContent = customText ? customText : (isCurrency ? formatCurrency(value) : String(value));
    
    if (isCurrency) valueEl.classList.add('text-green-600');
    else if (customText && customText.includes('%')) valueEl.classList.add('text-blue-600');
    else valueEl.classList.add('text-gray-800');

    if (comparisonValue !== null && typeof comparisonValue !== 'undefined' && typeof value === 'number') {
        const change = value - comparisonValue;
        let percentageChange = 0;
        if (comparisonValue !== 0) {
            percentageChange = (change / comparisonValue) * 100;
        } else if (value > 0) {
            percentageChange = 100; 
        }

        if (change > 0) {
            comparisonEl.textContent = `▲ ${percentageChange.toFixed(0)}% vs ayer`;
            comparisonEl.className = 'dashboard-metric-comparison text-xs text-green-500 mt-1';
        } else if (change < 0) {
            comparisonEl.textContent = `▼ ${Math.abs(percentageChange).toFixed(0)}% vs ayer`;
            comparisonEl.className = 'dashboard-metric-comparison text-xs text-red-500 mt-1';
        } else {
            comparisonEl.textContent = `_ ${percentageChange.toFixed(0)}% vs ayer`;
            comparisonEl.className = 'dashboard-metric-comparison text-xs text-gray-500 mt-1';
        }
    } else {
        comparisonEl.textContent = isCurrency ? 'Hoy' : 'Actual'; 
        comparisonEl.className = 'dashboard-metric-comparison text-xs text-gray-400 mt-1';
    }
  }
}


function renderChecklist(containerEl, listId, items, type) {
    const listEl = containerEl.querySelector(`#${listId}`);
    if (!listEl) {
        console.warn(`[Dashboard] Lista no encontrada para checklist: #${listId}`);
        return;
    }

    listEl.innerHTML = ''; 
    if (!items || items.length === 0) {
        listEl.innerHTML = `<li class="text-gray-500 text-sm p-2">No hay ${type === 'check-in' ? 'llegadas programadas' : 'salidas programadas'} para hoy.</li>`;
        return;
    }

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'py-2 border-b border-gray-200 last:border-b-0';
        const fecha = type === 'check-in' ? item.fecha_inicio : item.fecha_fin;
        li.innerHTML = `
            <div class="flex justify-between items-center">
                <span class="font-medium text-gray-700 text-sm">${item.cliente_nombre || 'Cliente'}</span>
                <span class="text-xs text-gray-500">Hab: ${item.habitacion_nombre || 'N/A'}</span>
            </div>
            <div class="text-xs ${type === 'check-in' ? 'text-blue-600' : 'text-indigo-600'}">
                ${type === 'check-in' ? 'Llega' : 'Sale'}: ${formatDateTime(fecha, undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}
            </div>`;
        listEl.appendChild(li);
    });
}

async function fetchChartData(hotelId, supabaseInstance, numDays = 7) {
  console.log('[Dashboard] Iniciando fetchChartData (v.FINAL)...');
  const validNumDays = (typeof numDays === 'number' && numDays > 0) ? numDays : 7;
  
  const returnLabels = [];
  let returnRevenueData = Array(validNumDays).fill(0);
  let returnOcupacionData = Array(validNumDays).fill(0);

  const today = new Date();
  for (let i = validNumDays - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - i);
    const dateString = date.toISOString().slice(0, 10);
    returnLabels.push(dateString);
  }
  console.log('[Dashboard] Etiquetas para gráficos (v.FINAL):', returnLabels);

  try {
    console.log('[Dashboard] Obteniendo total de habitaciones activas para gráficos (v.FINAL)...');
    const { count: totalHabitacionesActivas, error: errTotalHab } = await supabaseInstance
      .from('habitaciones')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId)
      .eq('activo', true);

    if (errTotalHab) {
      console.error('[Dashboard] Error obteniendo total de habitaciones para gráficos (v.FINAL):', errTotalHab);
    } else {
      console.log('[Dashboard] Total de habitaciones activas para gráficos (v.FINAL):', totalHabitacionesActivas);
      
      const promises = returnLabels.map(async (day, index) => {
        const startOfDay = `${day}T00:00:00.000Z`;
        const endOfDay = `${day}T23:59:59.999Z`;
        const orClause = 'concepto.eq.Pago completo de reserva,concepto.eq.Abono de reserva';

        try {
          const { data: revenueData, error: revenueError } = await supabaseInstance.from('caja')
            .select('monto')
            .eq('hotel_id', hotelId).eq('tipo', 'ingreso')
            .gte('creado_en', startOfDay).lte('creado_en', endOfDay).or(orClause);
          if (revenueError) console.warn(`[Dashboard] Error obteniendo ingresos para ${day} (v.FINAL):`, revenueError.message);
          returnRevenueData[index] = revenueError ? 0 : (revenueData ? revenueData.reduce((sum, entry) => sum + (entry.monto || 0), 0) : 0);
        } catch (revErr) { console.error(`[Dashboard] Excepción en revenuePromise para ${day} (v.FINAL):`, revErr); returnRevenueData[index] = 0; }

        try {
          if (totalHabitacionesActivas > 0) {
            const { count: ocupacionCount, error: ocupacionError } = await supabaseInstance.from('reservas')
              .select('id', { count: 'exact', head: true })
              .eq('hotel_id', hotelId)
              .lte('fecha_inicio', endOfDay).gte('fecha_fin', startOfDay)
              .in('estado', ['activa', 'check_in', 'confirmada']);
            if (ocupacionError) console.warn(`[Dashboard] Error obteniendo ocupación para ${day} (v.FINAL):`, ocupacionError.message);
            returnOcupacionData[index] = ocupacionError ? 0 : Math.round((ocupacionCount / totalHabitacionesActivas) * 100);
          } else { returnOcupacionData[index] = 0; }
        } catch (ocupErr) { console.error(`[Dashboard] Excepción en ocupacionPromise para ${day} (v.FINAL):`, ocupErr); returnOcupacionData[index] = 0;}
      });
      await Promise.all(promises);
      console.log('[Dashboard] Todos los cálculos diarios para gráficos completados (v.FINAL).');
    }
  } catch (e) {
    console.error("[Dashboard] Error CRÍTICO GENERAL en fetchChartData (v.FINAL):", e);
  }
  
  console.log('[Dashboard] Datos finales para gráficos (v.FINAL):', { labels: returnLabels, dailyRevenueData: returnRevenueData, dailyOcupacionData: returnOcupacionData });
  return { labels: returnLabels, dailyRevenueData: returnRevenueData, dailyOcupacionData: returnOcupacionData };
}


async function renderCharts(containerEl, hotelId, supabaseInstance) {
  console.log('[Dashboard] Iniciando renderCharts...');
  
  await new Promise(resolve => setTimeout(resolve, 50)); // Pequeño delay adicional

  const revCtx = containerEl.querySelector('#chart-revenue')?.getContext('2d');
  const ocuCtx = containerEl.querySelector('#chart-ocupacion')?.getContext('2d');

  if (!window.Chart) {
    console.error('[Dashboard] Chart.js no está cargado. No se pueden renderizar gráficos.');
    if (revCtx && revCtx.canvas.parentElement) revCtx.canvas.parentElement.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico no disponible (Chart.js ausente).</p>';
    if (ocuCtx && ocuCtx.canvas.parentElement) ocuCtx.canvas.parentElement.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico no disponible (Chart.js ausente).</p>';
    return;
  }
  console.log('[Dashboard] Chart.js está cargado.');
  
  const chartData = await fetchChartData(hotelId, supabaseInstance);
  console.log('[Dashboard] DATOS PARA RENDERIZAR GRÁFICOS:', JSON.stringify(chartData, null, 2));

  if (chartRevenueInstance) chartRevenueInstance.destroy();
  if (revCtx) {
    chartRevenueInstance = new Chart(revCtx, {
      type: 'line', data: { labels: chartData.labels, datasets: [{ label: 'Ingresos Habitaciones', data: chartData.dailyRevenueData, borderColor: 'rgb(75, 192, 192)', tension: 0.1, fill:true, backgroundColor: 'rgba(75, 192, 192, 0.2)', pointRadius: 3, pointHoverRadius: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: val => formatCurrency(val) } } }, plugins: { tooltip: { callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) { label += ': '; } if (context.parsed.y !== null) { label += formatCurrency(context.parsed.y); } return label; } } } } }
    });
     console.log('[Dashboard] Gráfico de Ingresos renderizado/actualizado.');
  } else {
    console.warn('[Dashboard] Canvas para gráfico de ingresos no encontrado (#chart-revenue).');
  }

  if (chartOcupacionInstance) chartOcupacionInstance.destroy();
  if (ocuCtx) {
    chartOcupacionInstance = new Chart(ocuCtx, {
      type: 'bar', data: { labels: chartData.labels, datasets: [{ label: '% Ocupación Real', data: chartData.dailyOcupacionData, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: val => `${val}%` } } }, plugins: { tooltip: { callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) { label += ': '; } if (context.parsed.y !== null) { label += context.parsed.y + '%'; } return label; } } } } }
    });
    console.log('[Dashboard] Gráfico de Ocupación renderizado/actualizado.');
  } else {
    console.warn('[Dashboard] Canvas para gráfico de ocupación no encontrado (#chart-ocupacion).');
  }
  console.log('[Dashboard] renderCharts finalizado.');
}

async function loadDashboardPageData(containerEl, hotelId, supabaseInstance) {
  console.log('[Dashboard] Iniciando loadDashboardPageData...');
  const mainErrorDiv = containerEl.querySelector('#dashboard-main-error');
  if (mainErrorDiv) clearAppFeedback(mainErrorDiv);

  ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda'].forEach(id => updateCardContent(containerEl, id, null, null, false, true));

  try {
    const { data: rpcData, error: rpcError } = await supabaseInstance.rpc('get_dashboard_metrics', { p_hotel_id: hotelId });

    if (rpcError) {
      console.error('[Dashboard] Error llamando RPC get_dashboard_metrics:', rpcError);
      throw rpcError; 
    }
    if (!rpcData || !rpcData.kpis) {
        console.error('[Dashboard] RPC get_dashboard_metrics no devolvió datos o kpis válidos:', rpcData);
        throw new Error('Respuesta inesperada o incompleta del servidor para métricas del dashboard.');
    }
    
    console.log('[Dashboard] Datos recibidos de RPC:', JSON.stringify(rpcData, null, 2));
    const kpis = rpcData.kpis;

    // Validar que los datos esperados existan en kpis antes de usarlos
    updateCardContent(containerEl, 'card-reservas-activas', kpis.reservas_activas_hoy, kpis.reservas_activas_ayer);
    updateCardContent(containerEl, 'card-ingresos-hoy', kpis.ingresos_habitaciones_hoy, kpis.ingresos_habitaciones_ayer, true);
    updateCardContent(containerEl, 'card-ventas-tienda', kpis.ingresos_tienda_hoy, kpis.ingresos_tienda_ayer, true);
    
    const ocupacionRate = (kpis.habitaciones_activas_total && kpis.habitaciones_activas_total > 0 && typeof kpis.habitaciones_ocupadas_ahora === 'number') 
    ? Math.round((kpis.habitaciones_ocupadas_ahora / kpis.habitaciones_activas_total) * 100) 
    : 0;
const ocupacionText = `${ocupacionRate}% (${kpis.habitaciones_ocupadas_ahora || 0}/${kpis.habitaciones_activas_total || 0})`;
updateCardContent(containerEl, 'card-ocupacion', ocupacionRate, null, false, false, ocupacionText);


    renderChecklist(containerEl, 'list-next-checkins', rpcData.checkins, 'check-in');
    renderChecklist(containerEl, 'list-next-checkouts', rpcData.checkouts, 'check-out');

  } catch (err) {
    console.error("[Dashboard] Error general en loadDashboardPageData:", err);
    if (mainErrorDiv) showAppFeedback(mainErrorDiv, `Error al cargar datos principales: ${err.message}`, 'error');
    ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda'].forEach(id => updateCardContent(containerEl, id, null, null, false, false)); // Poner en estado de error
  }
  console.log('[Dashboard] loadDashboardPageData finalizado.');
}

export async function mount(container, supabaseInstance, currentUser) {
  unmount(container);
  console.log('[Dashboard] Iniciando mount...');

  container.innerHTML = `
    <header class="main-header mb-6">
      <h1 class="text-2xl font-bold text-gray-800">Dashboard General</h1>
    </header>
    <div id="dashboard-main-error" class="feedback-message mb-4" style="display:none;" role="alert"></div>

    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 dashboard-cards">
      <div id="card-reservas-activas" class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Reservas Activas Hoy</h3>
        <p class="dashboard-metric-value text-3xl font-bold">Cargando...</p>
        <p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p>
      </div>
      <div id="card-ingresos-hoy" class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ingresos Habitaciones Hoy</h3>
        <p class="dashboard-metric-value text-3xl font-bold">Cargando...</p>
        <p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p>
      </div>
      <div id="card-ocupacion" class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ocupación Actual</h3>
        <p class="dashboard-metric-value text-3xl font-bold">Cargando...</p>
        <p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p>
      </div>
      <div id="card-ventas-tienda" class="card dashboard-card p-4 rounded-lg shadow-md bg-white">
        <h3 class="text-sm font-medium text-gray-500 mb-1">Ventas Tienda Hoy</h3>
        <p class="dashboard-metric-value text-3xl font-bold">Cargando...</p>
        <p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p>
      </div>
    </section>

    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="card p-4 rounded-lg shadow-md bg-white">
          <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Próximos Check-Ins (Hoy)</h3>
          <ul id="list-next-checkins" class="space-y-2" style="padding-left: 0;"><li>Cargando...</li></ul>
      </div>
      <div class="card p-4 rounded-lg shadow-md bg-white">
          <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Próximos Check-Outs (Hoy)</h3>
          <ul id="list-next-checkouts" class="space-y-2" style="padding-left: 0;"><li>Cargando...</li></ul>
      </div>
    </section>
    
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 dashboard-charts">
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white">
          <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Ingresos Habitaciones (Últimos 7 Días)</h3>
          <div class="chart-container" style="height:300px; position: relative;"><canvas id="chart-revenue"></canvas></div>
      </div>
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white">
          <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Ocupación (Últimos 7 Días)</h3>
          <div class="chart-container" style="height:300px; position: relative;"><canvas id="chart-ocupacion"></canvas></div>
      </div>
    </section>
    
    <section class="card atajos-card p-4 rounded-lg shadow-md bg-white">
      <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-3">Accesos Rápidos</h3>
      <div class="atajos-buttons flex flex-wrap gap-3">
        <button class="button button-primary py-2 px-4 rounded-md text-sm" data-navegar="#/reservas">Nueva Reserva</button>
        <button class="button button-accent py-2 px-4 rounded-md text-sm" data-navegar="#/mapa-habitaciones">Mapa Hotel</button>
      </div>
    </section>
  `;
  console.log('[Dashboard] HTML insertado en el contenedor.');

  await new Promise(resolve => setTimeout(resolve, 50)); 
  console.log('[Dashboard] DOM debería estar listo después del micro-retraso.');

  let hotelId = currentUser?.user_metadata?.hotel_id;
  const mainErrorDiv = container.querySelector('#dashboard-main-error');

  if (!hotelId && currentUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      hotelId = perfil?.hotel_id;
    } catch (err) {
      if (mainErrorDiv) showAppFeedback(mainErrorDiv, "No se pudo determinar el hotel del usuario.", 'error');
      return; 
    }
  }

  if (!hotelId) {
    if (mainErrorDiv) showAppFeedback(mainErrorDiv, "Hotel ID no disponible.", 'error');
    return;
  }
  
  const initializePage = async () => {
      console.log('[Dashboard] Llamando a loadDashboardPageData desde initializePage...');
      await loadDashboardPageData(container, hotelId, supabaseInstance);
      
      if (window.Chart) {
          console.log('[Dashboard] Llamando a renderCharts desde initializePage...');
          renderCharts(container, hotelId, supabaseInstance);
      } else {
          console.warn('[Dashboard] Chart.js no disponible al llamar a initializePage. Los gráficos no se renderizarán.');
          const chartRevCanvas = container.querySelector('#chart-revenue');
          if (chartRevCanvas && chartRevCanvas.parentElement) chartRevCanvas.parentElement.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico de Ingresos no disponible (Error librería).</p>';
          const chartOcuCanvas = container.querySelector('#chart-ocupacion');
          if (chartOcuCanvas && chartOcuCanvas.parentElement) chartOcuCanvas.parentElement.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico de Ocupación no disponible (Error librería).</p>';
      }
  };

  if (!window.Chart && document.querySelector('script[src*="chart.min.js"]') === null) {
      console.log('[Dashboard] Chart.js no encontrado globalmente, intentando cargar dinámicamente...');
      const chartJsScript = document.createElement('script');
      chartJsScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
      // chartJsScript.async = false; // Se eliminó para carga asíncrona por defecto
      chartJsScript.onload = () => {
          console.log('[Dashboard] Chart.js cargado dinámicamente DESDE SCRIPT.');
          initializePage();
      };
      chartJsScript.onerror = () => {
          console.error('[Dashboard] Error cargando Chart.js desde CDN.');
          initializePage(); 
      };
      document.head.appendChild(chartJsScript);
  } else {
       console.log('[Dashboard] Chart.js ya estaba presente o el tag ya está en el DOM.');
      initializePage();
  }

  const atajosContainer = container.querySelector('.atajos-card .atajos-buttons');
  if (atajosContainer) {
      const atajosHandler = (e) => {
          const targetButton = e.target.closest('button[data-navegar]');
          if (targetButton) window.location.hash = targetButton.dataset.navegar;
      };
      atajosContainer.addEventListener('click', atajosHandler);
      moduleDashboardListeners.push({ element: atajosContainer, type: 'click', handler: atajosHandler });
  }
  console.log('[Dashboard] Mount finalizado.');
}

export function unmount(container) {
  console.log('[Dashboard] Iniciando unmount...');
  if (chartRevenueInstance) chartRevenueInstance.destroy();
  if (chartOcupacionInstance) chartOcupacionInstance.destroy();
  chartRevenueInstance = null; chartOcupacionInstance = null;
  
  if (realtimeChannel) {
    realtimeChannel.unsubscribe()
      .then(() => console.log('[Dashboard] Canal Realtime desuscrito.'))
      .catch(err => console.error('[Dashboard] Error al desuscribir canal Realtime:', err));
    // Idealmente también remover el canal si tu librería de Supabase lo permite así:
    // supabaseInstance.removeChannel(realtimeChannel); // Si usas Supabase JS v2+
    realtimeChannel = null;
  }

  moduleDashboardListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleDashboardListeners = [];
  console.log('[Dashboard] Listeners eliminados, unmount finalizado.');
}