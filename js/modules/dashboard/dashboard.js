// js/modules/dashboard/dashboard.js
import { showAppFeedback, clearAppFeedback, formatDateTime, formatCurrency } from '../../uiUtils.js';

let chartRevenueInstance = null;
let chartOcupacionInstance = null;
let moduleDashboardListeners = [];

// Declaraciones de variables a nivel de módulo
let currentContainerGlobal = null;
let currentSupabaseInstanceGlobal = null;
let currentHotelIdGlobal = null;
let isMounted = false; // Flag para controlar el estado de montaje

function updateCardContent(containerEl, cardId, value, comparisonValue = null, isCurrency = false, isLoading = false, customText = null) {
  if (!containerEl || !isMounted) return; 
  const cardDiv = containerEl.querySelector(`#${cardId}`);
  if (!cardDiv) {
    // console.warn(`[Dashboard] Contenedor de tarjeta no encontrado (o módulo desmontado): #${cardId}`);
    return;
  }
  const valueEl = cardDiv.querySelector('.dashboard-metric-value');
  const comparisonEl = cardDiv.querySelector('.dashboard-metric-comparison');

  if (!valueEl || !comparisonEl) {
    // console.warn(`[Dashboard] Elementos internos de tarjeta no encontrados para: #${cardId}`);
    return;
  }

  valueEl.classList.remove('text-red-500', 'text-green-600', 'text-blue-600', 'text-gray-800'); 

  if (isLoading) {
    valueEl.innerHTML = `<span class="text-2xl text-gray-400">Cargando...</span>`;
    comparisonEl.textContent = ''; 
    comparisonEl.className = 'dashboard-metric-comparison text-xs text-gray-400 mt-1';
    return;
  }

  const displayValue = (typeof value === 'number' && !isNaN(value)) ? value : (isCurrency || !customText ? 0 : value);

  if (value === null || typeof value === 'undefined' || (typeof value === 'number' && isNaN(value))) {
    valueEl.textContent = customText ? customText : (isCurrency ? formatCurrency(0) : '0');
    valueEl.classList.add(isCurrency ? 'text-green-600' : (customText && customText.includes('%') ? 'text-blue-600' : 'text-gray-800'));
    comparisonEl.textContent = 'Datos no disponibles';
    comparisonEl.className = 'dashboard-metric-comparison text-xs text-orange-400 mt-1';
  } else {
    valueEl.textContent = customText ? customText : (isCurrency ? formatCurrency(displayValue) : String(displayValue));
    
    if (isCurrency) valueEl.classList.add('text-green-600');
    else if (customText && customText.includes('%')) valueEl.classList.add('text-blue-600');
    else valueEl.classList.add('text-gray-800');

    if (comparisonValue !== null && typeof comparisonValue !== 'undefined' && typeof displayValue === 'number') {
        const compValueNum = Number(comparisonValue) || 0;
        const change = displayValue - compValueNum;
        let percentageChange = 0;
        if (compValueNum !== 0) {
            percentageChange = (change / compValueNum) * 100;
        } else if (displayValue > 0) {
            percentageChange = 100; 
        }

        let arrow = '― '; 
        let textColor = 'text-gray-500'; 
        if (change > 0) { arrow = '▲ '; textColor = 'text-green-500'; }
        else if (change < 0) { arrow = '▼ '; textColor = 'text-red-500'; }
        
        comparisonEl.textContent = `${arrow}${Math.abs(percentageChange).toFixed(0)}% vs ayer`;
        comparisonEl.className = `dashboard-metric-comparison text-xs ${textColor} mt-1`;
    } else {
        comparisonEl.textContent = isCurrency ? 'Hoy' : 'Actual'; 
        comparisonEl.className = 'dashboard-metric-comparison text-xs text-gray-400 mt-1';
    }
  }
}

function renderChecklist(containerEl, listId, items, type) {
  if (!containerEl || !isMounted) return;
  const listEl = containerEl.querySelector(`#${listId}`);
  if (!listEl) {
      console.warn(`[Dashboard] Lista no encontrada para checklist (o desmontado): #${listId}`);
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
      const nombreHabitacion = item.habitacion_nombre || item.habitaciones_nombre || 'N/A'; 
      li.innerHTML = `
          <div class="flex justify-between items-center">
              <span class="font-medium text-gray-700 text-sm">${item.cliente_nombre || 'Cliente'}</span>
              <span class="text-xs text-gray-500">Hab: ${nombreHabitacion}</span>
          </div>
          <div class="text-xs ${type === 'check-in' ? 'text-blue-600' : 'text-indigo-600'}">
              ${type === 'check-in' ? 'Llega' : 'Sale'}: ${formatDateTime(fecha, undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}
          </div>`;
      listEl.appendChild(li);
  });
}

async function fetchChartData(hotelId, supabaseInstance, numDays = 7) {
  console.log('[Dashboard] Iniciando fetchChartData...');
  const validNumDays = (typeof numDays === 'number' && numDays > 0) ? numDays : 7;
  const labels = [];
  let dailyRevenueData = Array(validNumDays).fill(0); 
  let dailyOcupacionData = Array(validNumDays).fill(0);
  const today = new Date();
  today.setHours(0, 0, 0, 0); 

  for (let i = 0; i < validNumDays; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - (validNumDays - 1 - i));
    labels.push(date.toISOString().slice(0, 10));
  }

  try {
    const { count: totalHabitacionesActivas, error: errTotalHab } = await supabaseInstance
      .from('habitaciones')
      .select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId)
      .eq('activo', true);
    if (errTotalHab) console.error('[Dashboard] Error obteniendo total de habitaciones:', errTotalHab);

    const promises = labels.map(async (day, index) => {
      const startOfDay = `${day}T00:00:00.000Z`;
      const endOfDay = `${day}T23:59:59.999Z`;

      try {
        const { data: revenueData, error: revenueError } = await supabaseInstance.from('caja')
          .select('monto')
          .eq('hotel_id', hotelId)
          .eq('tipo', 'ingreso')
          .gte('creado_en', startOfDay)
          .lte('creado_en', endOfDay)
          .is('venta_tienda_id', null); 
        if (revenueError) throw revenueError;
        dailyRevenueData[index] = (revenueData || []).reduce((sum, entry) => sum + (Number(entry.monto) || 0), 0);
      } catch (revErr) {
          console.warn(`[Dashboard] Error obteniendo ingresos de habitaciones para ${day}:`, revErr.message);
          dailyRevenueData[index] = 0;
      }

      try {
        if (totalHabitacionesActivas != null && totalHabitacionesActivas > 0) {
          const { count: ocupacionCount, error: ocupacionError } = await supabaseInstance.from('reservas')
            .select('id', { count: 'exact', head: true })
            .eq('hotel_id', hotelId)
            .lte('fecha_inicio', endOfDay)
            .gte('fecha_fin', startOfDay)
            .in('estado', ['activa', 'ocupada']);
          if (ocupacionError) throw ocupacionError;
          dailyOcupacionData[index] = ocupacionCount > 0 ? Math.round((ocupacionCount / totalHabitacionesActivas) * 100) : 0;
        } else { dailyOcupacionData[index] = 0; }
      } catch (ocupErr) {
          console.warn(`[Dashboard] Error obteniendo ocupación para ${day}:`, ocupErr.message);
          dailyOcupacionData[index] = 0;
      }
    });
    await Promise.all(promises);
  } catch (e) {
    console.error("[Dashboard] Error GENERAL en fetchChartData:", e);
  }
  console.log('[Dashboard] Datos finales para gráficos:', { labels, dailyRevenueData, dailyOcupacionData });
  return { labels, dailyRevenueData, dailyOcupacionData };
}

async function renderCharts(containerEl, hotelId, supabaseInstance) {
  console.log('[Dashboard] Iniciando renderCharts...');
  if (!containerEl || !isMounted) {
      console.warn("[Dashboard] renderCharts abortado: módulo no montado o contenedor no existe.");
      return;
  }

  if (!window.Chart) {
    console.error('[Dashboard] Chart.js no está cargado.');
    const revChartParent = containerEl.querySelector('#chart-revenue')?.parentElement;
    if (revChartParent) revChartParent.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico no disponible (Chart.js ausente).</p>';
    const ocuChartParent = containerEl.querySelector('#chart-ocupacion')?.parentElement;
    if (ocuChartParent) ocuChartParent.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Gráfico no disponible (Chart.js ausente).</p>';
    return;
  }
   console.log('[Dashboard] Chart.js SÍ está cargado.');

  const revContainer = containerEl.querySelector('.chart-container canvas#chart-revenue')?.parentElement;
  const ocuContainer = containerEl.querySelector('.chart-container canvas#chart-ocupacion')?.parentElement;

  if (revContainer) revContainer.innerHTML = '<div class="flex justify-center items-center h-full"><p class="text-sm text-gray-500 p-4">Cargando datos del gráfico de ingresos...</p></div>';
  if (ocuContainer) ocuContainer.innerHTML = '<div class="flex justify-center items-center h-full"><p class="text-sm text-gray-500 p-4">Cargando datos del gráfico de ocupación...</p></div>';
  
  const chartData = await fetchChartData(hotelId, supabaseInstance);
  console.log('[Dashboard] DATOS RECIBIDOS PARA RENDERIZAR GRÁFICOS:', JSON.stringify(chartData, null, 2));

  if (!isMounted) { console.warn("[Dashboard] renderCharts: Desmontado después de fetchChartData."); return; }


  if (chartRevenueInstance) chartRevenueInstance.destroy();
  if (revContainer) {
    revContainer.innerHTML = '<canvas id="chart-revenue"></canvas>'; 
    const revCtx = revContainer.querySelector('#chart-revenue')?.getContext('2d');
    if (revCtx) {
        chartRevenueInstance = new Chart(revCtx, {
          type: 'line', data: { labels: chartData.labels, datasets: [{ label: 'Ingresos Habitaciones', data: chartData.dailyRevenueData, borderColor: 'rgb(75, 192, 192)', tension: 0.1, fill:true, backgroundColor: 'rgba(75, 192, 192, 0.2)', pointRadius: 3, pointHoverRadius: 5 }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: val => formatCurrency(val) } } }, plugins: { tooltip: { callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) { label += ': '; } if (context.parsed.y !== null) { label += formatCurrency(context.parsed.y); } return label; } } } } }
        });
        console.log('[Dashboard] Gráfico de Ingresos renderizado.');
    } else {  
        console.warn('[Dashboard] No se pudo obtener contexto 2D para #chart-revenue.');
        if(revContainer) revContainer.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Error al mostrar gráfico de ingresos.</p>';
    }
  } else {
    console.warn('[Dashboard] Contenedor para #chart-revenue no encontrado.');
  }

  if (!isMounted) { console.warn("[Dashboard] renderCharts: Desmontado antes de gráfico de ocupación."); return; }

  if (chartOcupacionInstance) chartOcupacionInstance.destroy();
  if (ocuContainer) {
    ocuContainer.innerHTML = '<canvas id="chart-ocupacion"></canvas>';
    const ocuCtx = ocuContainer.querySelector('#chart-ocupacion')?.getContext('2d');
    if (ocuCtx) {
        chartOcupacionInstance = new Chart(ocuCtx, {
          type: 'bar', data: { labels: chartData.labels, datasets: [{ label: '% Ocupación Real', data: chartData.dailyOcupacionData, backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] },
          options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: val => `${val}%` } } }, plugins: { tooltip: { callbacks: { label: function(context) { let label = context.dataset.label || ''; if (label) { label += ': '; } if (context.parsed.y !== null) { label += context.parsed.y + '%'; } return label; } } } } }
        });
        console.log('[Dashboard] Gráfico de Ocupación renderizado.');
    } else { 
        console.warn('[Dashboard] No se pudo obtener contexto 2D para #chart-ocupacion.');
        if(ocuContainer) ocuContainer.innerHTML = '<p class="text-sm text-center text-gray-500 p-4">Error al mostrar gráfico de ocupación.</p>';
    }
  } else {
    console.warn('[Dashboard] Contenedor para #chart-ocupacion no encontrado.');
  }
  console.log('[Dashboard] renderCharts finalizado.');
}

async function loadDashboardPageData(containerEl, hotelId, supabaseInstance) {
  console.log('[Dashboard] Iniciando loadDashboardPageData...');
  if (!isMounted || !containerEl.querySelector('#dashboard-main-error')) {
      console.warn("[Dashboard] loadDashboardPageData abortado: módulo desmontado o contenedor no existe.");
      return;
  }
  const mainErrorDiv = containerEl.querySelector('#dashboard-main-error');
  if (mainErrorDiv) clearAppFeedback(mainErrorDiv);

  ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda'].forEach(id => {
      if (isMounted && containerEl.querySelector(`#${id}`)) updateCardContent(containerEl, id, null, null, false, true);
  });

  try {
    const { data: rpcData, error: rpcError } = await supabaseInstance.rpc('get_dashboard_metrics', { p_hotel_id: hotelId });

    if (!isMounted) return; 

    if (rpcError) {
      console.error('[Dashboard] Error llamando RPC get_dashboard_metrics:', rpcError);
      throw rpcError;
    }
    if (!rpcData || typeof rpcData.kpis === 'undefined') {
        console.error('[Dashboard] RPC get_dashboard_metrics no devolvió datos o kpis válidos:', rpcData);
        throw new Error('Respuesta inesperada o incompleta del servidor para métricas del dashboard.');
    }

    console.log('[Dashboard] Datos recibidos de RPC:', JSON.stringify(rpcData, null, 2));
    const kpis = rpcData.kpis;

    updateCardContent(containerEl, 'card-reservas-activas', kpis.reservas_activas_hoy ?? 0, kpis.reservas_activas_ayer ?? 0);
    updateCardContent(containerEl, 'card-ingresos-hoy', kpis.ingresos_habitaciones_hoy ?? 0, kpis.ingresos_habitaciones_ayer ?? 0, true);
    updateCardContent(containerEl, 'card-ventas-tienda', kpis.ingresos_tienda_hoy ?? 0, kpis.ingresos_tienda_ayer ?? 0, true);

    const habitacionesOcupadas = kpis.habitaciones_ocupadas_ahora ?? 0;
    const totalHabitaciones = kpis.habitaciones_activas_total ?? 0;
    const ocupacionRate = totalHabitaciones > 0 ? Math.round((habitacionesOcupadas / totalHabitaciones) * 100) : 0;
    const ocupacionText = `${ocupacionRate}% (${habitacionesOcupadas}/${totalHabitaciones})`;
    updateCardContent(containerEl, 'card-ocupacion', ocupacionRate, null, false, false, ocupacionText);

    renderChecklist(containerEl, 'list-next-checkins', rpcData.checkins || [], 'check-in');
    renderChecklist(containerEl, 'list-next-checkouts', rpcData.checkouts || [], 'check-out');

  } catch (err) {
    console.error("[Dashboard] Error general en loadDashboardPageData:", err);
    if (isMounted && mainErrorDiv) showAppFeedback(mainErrorDiv, `Error al cargar datos principales: ${err.message}`, 'error');
    ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda'].forEach(id => {
        if (isMounted && containerEl.querySelector(`#${id}`)) updateCardContent(containerEl, id, 0, 0, false, false, 'Error');
    });
  }
  console.log('[Dashboard] loadDashboardPageData finalizado.');
}

export async function mount(container, supabaseInstance, currentUser) {
  if (isMounted && currentContainerGlobal === container) {
    console.log('[Dashboard] Mount llamado pero ya está montado en este contenedor. Se intentará refrescar datos si es necesario.');
    // Opcional: Forzar refresco si la lógica del router no lo previene bien.
    // await loadDashboardPageData(container, currentHotelIdGlobal, supabaseInstance);
    // await renderCharts(container, currentHotelIdGlobal, supabaseInstance);
    return;
  }
  
  // Si hay un montaje previo en otro contenedor o si isMounted es false
  unmount(currentContainerGlobal); // Desmontar el anterior si existe y es diferente

  isMounted = true;
  currentContainerGlobal = container; 
  currentSupabaseInstanceGlobal = supabaseInstance; 
  
  console.log('[Dashboard] Iniciando mount en nuevo contenedor o por primera vez...');
  container.innerHTML = `
    <header class="main-header mb-6">
      <h1 class="text-2xl font-bold text-gray-800 mb-2">Panel de Control</h1>
      <p class="text-gray-500 text-sm mb-3">Resumen de actividad, ingresos y ocupación general.</p>
      <div id="dashboard-main-error" class="feedback-message mb-2" role="alert" style="display:none;"></div>
    </header>
    <section class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6 dashboard-cards">
      <div id="card-reservas-activas" class="card dashboard-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-sm font-medium text-gray-500 mb-1">Reservas Activas Hoy</h3><p class="dashboard-metric-value text-3xl font-bold">Cargando...</p><p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p></div>
      <div id="card-ingresos-hoy" class="card dashboard-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-sm font-medium text-gray-500 mb-1">Ingresos Habitaciones Hoy</h3><p class="dashboard-metric-value text-3xl font-bold">Cargando...</p><p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p></div>
      <div id="card-ocupacion" class="card dashboard-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-sm font-medium text-gray-500 mb-1">Ocupación Actual</h3><p class="dashboard-metric-value text-3xl font-bold">Cargando...</p><p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p></div>
      <div id="card-ventas-tienda" class="card dashboard-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-sm font-medium text-gray-500 mb-1">Ventas Tienda Hoy</h3><p class="dashboard-metric-value text-3xl font-bold">Cargando...</p><p class="dashboard-metric-comparison text-xs text-gray-400 mt-1"></p></div>
    </section>
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="card p-4 rounded-lg shadow-md bg-white"><h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Próximos Check-Ins (Hoy)</h3><ul id="list-next-checkins" class="space-y-2" style="padding-left: 0;"><li>Cargando...</li></ul></div>
      <div class="card p-4 rounded-lg shadow-md bg-white"><h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Próximos Check-Outs (Hoy)</h3><ul id="list-next-checkouts" class="space-y-2" style="padding-left: 0;"><li>Cargando...</li></ul></div>
    </section>
    <section class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 dashboard-charts">
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Ingresos Habitaciones (Últimos 7 Días)</h3><div class="chart-container" style="height:300px; position: relative;"><canvas id="chart-revenue"></canvas></div></div>
      <div class="card chart-card p-4 rounded-lg shadow-md bg-white"><h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-2">Ocupación (Últimos 7 Días)</h3><div class="chart-container" style="height:300px; position: relative;"><canvas id="chart-ocupacion"></canvas></div></div>
    </section>
    <section class="card atajos-card p-4 rounded-lg shadow-md bg-white">
      <h3 class="text-lg font-semibold text-gray-700 border-b pb-2 mb-3">Accesos Rápidos</h3>
      <div class="atajos-buttons flex flex-wrap gap-3">
        <button class="button button-primary py-2 px-4 rounded-md text-sm" data-navegar="#/reservas">Nueva Reserva</button>
        <button class="button button-accent py-2 px-4 rounded-md text-sm" data-navegar="#/mapa-habitaciones">Mapa Hotel</button>
        <button class="button button-success py-2 px-4 rounded-md text-sm" data-navegar="#/caja">Ir a Caja</button>
      </div>
    </section>
  `;
  console.log('[Dashboard] HTML insertado en el contenedor.');

  // Esperar un breve momento para que el DOM se actualice completamente
  await new Promise(resolve => setTimeout(resolve, 50)); // Reducido a 50ms
  console.log('[Dashboard] DOM debería estar listo después del retraso inicial.');

  let hotelId = currentUser?.user_metadata?.hotel_id || currentUser?.app_metadata?.hotel_id;
  const mainErrorDiv = container.querySelector('#dashboard-main-error');

  if (!hotelId && currentUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await supabaseInstance
        .from('usuarios')
        .select('hotel_id')
        .eq('id', currentUser.id)
        .single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      hotelId = perfil?.hotel_id;
    } catch (err) {
      console.error("[Dashboard] Error obteniendo hotel_id del perfil:", err);
      if (mainErrorDiv) showAppFeedback(mainErrorDiv, "No se pudo determinar el hotel del usuario.", 'error');
      isMounted = false; 
      return; 
    }
  }

  if (!hotelId) {
    if (mainErrorDiv) showAppFeedback(mainErrorDiv, "Hotel ID no disponible. No se pueden cargar datos del dashboard.", 'error');
    isMounted = false; 
    return;
  }
  currentHotelIdGlobal = hotelId;
  
  const initializePage = async () => {
      if (!isMounted) return; 
      console.log('[Dashboard] Llamando a loadDashboardPageData desde initializePage...');
      await loadDashboardPageData(container, hotelId, supabaseInstance);
      
      if (!isMounted) return; 
      if (window.Chart && container.querySelector('#chart-revenue') && container.querySelector('#chart-ocupacion')) {
          console.log('[Dashboard] Llamando a renderCharts desde initializePage (Chart.js y canvas presentes).');
          renderCharts(container, hotelId, supabaseInstance);
      } else {
          console.warn('[Dashboard] Chart.js o canvas no disponibles al intentar renderizar gráficos post-inicialización.');
          // La lógica de carga de Chart.js ya se habrá ejecutado si fue necesario.
          // Si aún no está, es un problema de carga del script.
      }
  };

  // Lógica de carga de Chart.js
  if (typeof window.Chart === 'undefined') {
      const existingScript = document.querySelector('script[src*="chart.js"], script[src*="chart.min.js"]');
      if (existingScript && existingScript.hasAttribute('_chartJsLoading')) {
          console.log('[Dashboard] Chart.js ya está en proceso de carga (detectado por flag)...');
          const loadHandler = () => { if(isMounted) initializePage(); existingScript.removeEventListener('load', loadHandler); existingScript.removeAttribute('_chartJsLoading'); };
          const errorHandler = () => { console.error('[Dashboard] Error cargando el script de Chart.js existente.'); if(isMounted) initializePage(); existingScript.removeEventListener('error', errorHandler); existingScript.removeAttribute('_chartJsLoading');};
          existingScript.addEventListener('load', loadHandler); 
          existingScript.addEventListener('error', errorHandler);
      } else if (existingScript && window.Chart) {
          console.log('[Dashboard] Chart.js ya fue cargado por un script tag preexistente en HTML.');
          initializePage();
      } else if (!existingScript) {
          console.log('[Dashboard] Chart.js no encontrado, cargando dinámicamente...');
          loadChartJsAndInitialize(initializePage);
      } else { 
          console.log('[Dashboard] Script de Chart.js existe pero window.Chart no definido. Reintentando después de un momento.');
          setTimeout(() => { 
              if (!isMounted) return;
              if(window.Chart) {
                console.log('[Dashboard] Chart.js disponible después de reintento.');
                initializePage();
              } else {
                console.error('[Dashboard] Chart.js no cargó después de reintento. Gráficos podrían no funcionar.');
                initializePage(); 
              }
          }, 1000);
      }
  } else {
      console.log('[Dashboard] Chart.js ya estaba presente globalmente.');
      initializePage();
  }

  const atajosContainer = container.querySelector('.atajos-card .atajos-buttons');
  if (atajosContainer) {
      const atajosHandler = (e) => {
          const targetButton = e.target.closest('button[data-navegar]');
          if (targetButton && targetButton.dataset.navegar) {
              window.location.hash = targetButton.dataset.navegar;
          }
      };
      atajosContainer.addEventListener('click', atajosHandler);
      moduleDashboardListeners.push({ element: atajosContainer, type: 'click', handler: atajosHandler });
  }
  console.log('[Dashboard] Mount finalizado.');
}

function loadChartJsAndInitialize(callback) {
    if (document.querySelector('script[src*="chart.js"], script[src*="chart.min.js"]')) {
        console.log("[Dashboard] Carga dinámica de Chart.js omitida: ya existe un tag de script.");
        // Asumir que el script existente se cargará. El callback se llamará desde mount.
        // Si no se carga, los gráficos no aparecerán.
        // Podríamos reintentar llamar a callback después de un timeout como en mount.
        setTimeout(() => {
            if (window.Chart && isMounted) callback();
            else if (isMounted) {
                console.error("[Dashboard] Chart.js del script existente no cargó, el callback de inicialización no se ejecutará desde aquí.");
            }
        },1500);
        return;
    }
    const chartJsScript = document.createElement('script');
    chartJsScript.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    chartJsScript.setAttribute('_chartJsLoading', 'true'); 
    chartJsScript.onload = () => {
        console.log('[Dashboard] Chart.js cargado dinámicamente.');
        chartJsScript.removeAttribute('_chartJsLoading');
        if (isMounted) callback(); 
    };
    chartJsScript.onerror = () => {
        console.error('[Dashboard] Error cargando Chart.js desde CDN.');
        chartJsScript.removeAttribute('_chartJsLoading');
        if (isMounted) callback(); 
    };
    document.head.appendChild(chartJsScript);
}

export function unmount(containerContext) { 
  console.log(`[Dashboard] Iniciando unmount para el contenedor: ${containerContext === currentContainerGlobal ? 'actual.' : 'anterior o diferente.'}`);
  isMounted = false; 
  if (chartRevenueInstance) {
      chartRevenueInstance.destroy();
      chartRevenueInstance = null;
      console.log('[Dashboard] Instancia de gráfico de ingresos destruida.');
  }
  if (chartOcupacionInstance) {
      chartOcupacionInstance.destroy();
      chartOcupacionInstance = null;
      console.log('[Dashboard] Instancia de gráfico de ocupación destruida.');
  }

  moduleDashboardListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleDashboardListeners = [];
  
  if (containerContext && currentContainerGlobal === containerContext) { // Solo limpiar si es el contenedor que este módulo gestionó
      containerContext.innerHTML = '';
      console.log('[Dashboard] Contenido del contenedor del dashboard limpiado.');
  } else if (containerContext) {
      console.log('[Dashboard] Se intentó desmontar un contenedor diferente o el actual ya fue limpiado.');
  }
  
  // No resetear currentSupabaseInstanceGlobal aquí, podría ser necesitado por otro módulo si el router no lo pasa.
  // currentHotelIdGlobal se obtendrá de nuevo en mount.
  currentContainerGlobal = null; // Indicar que ya no hay un contenedor gestionado por este dashboard.
  
  console.log('[Dashboard] Listeners eliminados y estado de montaje reseteado, unmount finalizado.');
}