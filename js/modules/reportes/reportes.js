// js/modules/reportes/reportes.js
// Módulo de generación de reportes para el hotel

// --- Module-Scoped Variables ---
let moduleListeners = [];
let currentHotelId = null;
let currentModuleUser = null;
let currentChartInstances = {}; // Use an object to manage multiple chart instances
let supabaseClient = null; // Assigned in mount
let hotelConfigGlobal = null;
import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { formatCurrency, formatDateTime } from '../../uiUtils.js'; // Assuming these are available globally or adjust path

const REPORTES_POR_PLAN = {
  lite: [
    'listado_reservas',
    'ocupacion',
    'ingresos_por_habitaciones_periodo'
  ],
  pro: [
    'listado_reservas',
    'ocupacion',
    'ingresos_por_habitaciones_periodo',
    'movimientos_financieros_global',
    'detalle_ingresos_categoria',
    'detalle_egresos_categoria',
    'cierres_de_caja'
  ],
  max: [
    'listado_reservas',
    'ocupacion',
    'ingresos_por_habitaciones_periodo',
    'movimientos_financieros_global',
    'detalle_ingresos_categoria',
    'detalle_egresos_categoria',
    'cierres_de_caja',
    'kpis_avanzados_hotel'
  ]
};

// --- Utilities ---
// Use existing formatCurrency and formatDateTime from uiUtils if they match this signature
// If not, you can keep these local versions or adapt uiUtils.
const formatCurrencyLocal = (value, currency = 'COP') => {
  if (typeof value !== 'number' || isNaN(value)) {
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency }).format(0);
  }
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency }).format(value);
};

const formatDateLocal = (dateStr, options = { dateStyle: 'short', timeStyle: 'short' }) => {
  if (!dateStr) return 'N/A';
  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString('es-CO', options);
};


// --- UI Helper Functions ---
function showReportesFeedback(feedbackEl, message, typeClass = 'info-indicator', duration = 0) {
  if (!feedbackEl) return;
  feedbackEl.textContent = message;
  let bgColor = 'bg-blue-100 border-blue-300 text-blue-700';
  if (typeClass === 'success-indicator') bgColor = 'bg-green-100 border-green-300 text-green-700';
  if (typeClass === 'error-indicator') bgColor = 'bg-red-100 border-red-300 text-red-700';
  
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${bgColor} visible`;
  feedbackEl.style.display = 'block';
  if (typeClass === 'error-indicator') feedbackEl.setAttribute('tabindex', '-1');
  if (duration > 0) setTimeout(() => clearReportesFeedback(feedbackEl), duration);
}

function clearReportesFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3';
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

function showReportesLoading(loadingEl, generateButtonEl, show, message = 'Generando reporte...') {
  if (loadingEl) {
    loadingEl.textContent = message;
    loadingEl.style.display = show ? 'block' : 'none';
  }
  if (generateButtonEl) {
    generateButtonEl.disabled = show;
    generateButtonEl.classList.toggle('opacity-50', show);
    generateButtonEl.classList.toggle('cursor-not-allowed', show);
  }
 
}
function renderSelectorReportes(planActivo) {
  // Lista de todos los reportes (puedes agregar/quitar)
  const TODOS_LOS_REPORTES = [
    { key: 'listado_reservas', label: 'Listado de Reservas' },
    { key: 'ocupacion', label: 'Porcentaje de Ocupación' },
    { key: 'ingresos_por_habitaciones_periodo', label: 'Ingresos por Habitaciones (Caja)' },
    { key: 'movimientos_financieros_global', label: 'Resumen Financiero Global' },
    { key: 'detalle_ingresos_categoria', label: 'Detalle de Ingresos por Categoría' },
    { key: 'detalle_egresos_categoria', label: 'Detalle de Egresos por Categoría' },
    { key: 'cierres_de_caja', label: 'Historial de Cierres de Caja' },
    { key: 'kpis_avanzados_hotel', label: 'KPIs de Rendimiento del Hotel' }
  ];
  // Reportes permitidos por plan
  const tiposDisponibles = REPORTES_POR_PLAN[planActivo] || REPORTES_POR_PLAN['lite'];
  const select = document.getElementById('reporte-tipo-select');
  select.innerHTML = '<option value="">-- Elija un reporte --</option>';
  TODOS_LOS_REPORTES.forEach(r => {
    const permitido = tiposDisponibles.includes(r.key);
    select.innerHTML += `<option value="${r.key}" ${!permitido ? 'data-bloqueado="1"' : ''}>
  ${permitido ? '' : '🔒'} ${r.label}${!permitido ? ' (PRO/MAX)' : ''}
</option>`;
  });
}


// --- Report Generation Functions ---
function destroyChartInstance(chartId) {
    if (currentChartInstances[chartId]) {
        currentChartInstances[chartId].destroy();
        delete currentChartInstances[chartId];
    }
}

function limpiarAreaResultados(resultsContainerEl) {
  if (resultsContainerEl) {
    resultsContainerEl.innerHTML = '<p class="text-gray-500 text-center p-4">Seleccione un tipo de reporte y configure los filtros para ver los datos.</p>';
  }
  Object.keys(currentChartInstances).forEach(destroyChartInstance);
  currentChartInstances = {};
}

async function generarReporteListadoReservas(resultsContainerEl, fechaInicioInput, fechaFinInput) {
  // ... (Código sin cambios significativos, igual al proporcionado anteriormente)
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando listado de reservas...</p>';

  try {
    const fechaInicioQuery = `${fechaInicioInput}T00:00:00.000Z`;
    const fechaFinQuery = `${fechaFinInput}T23:59:59.999Z`;

    let query = supabaseClient
      .from('reservas')
      .select(`
        id, cliente_nombre, fecha_inicio, fecha_fin, estado, monto_total,
        habitaciones (nombre), metodo_pago_id, usuario_id 
      `)
      .eq('hotel_id', currentHotelId)
      .order('fecha_inicio', { ascending: false });

    if (fechaInicioInput) query = query.gte('fecha_inicio', fechaInicioQuery);
    if (fechaFinInput) query = query.lte('fecha_inicio', fechaFinQuery); 

    const { data: reservas, error } = await query;
    if (error) throw error;

    if (!reservas || reservas.length === 0) {
      resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron reservas para los criterios seleccionados.</p>';
      return;
    }

    const metodoPagoIds = [...new Set(reservas.map(r => r.metodo_pago_id).filter(id => id))];
    let metodosPagoMap = {};
    if (metodoPagoIds.length > 0) {
        const { data: metodosData, error: metodosError } = await supabaseClient
            .from('metodos_pago').select('id, nombre').in('id', metodoPagoIds);
        if (metodosError) console.warn("Error fetching metodos_pago:", metodosError);
        else metodosPagoMap = Object.fromEntries(metodosData.map(m => [m.id, m.nombre]));
    }

    let html = `
      <h4 class="text-lg font-semibold mb-3">Listado de Reservas (${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})})</h4>
      <div class="table-container overflow-x-auto shadow-md rounded-lg">
        <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Cliente</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Habitación</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Entrada</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Salida</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Estado</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Monto</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Pagado con</th>
            </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">`;

    reservas.forEach(r => {
      const estadoLower = String(r.estado).toLowerCase();
      let estadoClass = 'bg-yellow-100 text-yellow-800';
      if (['confirmada', 'activa'].includes(estadoLower)) estadoClass = 'bg-green-100 text-green-800';
      else if (estadoLower === 'cancelada') estadoClass = 'bg-red-100 text-red-800';
      else if (['check_in', 'checkin'].includes(estadoLower)) estadoClass = 'bg-blue-100 text-blue-800';
      else if (['check_out', 'checkout', 'completada', 'finalizada_auto'].includes(estadoLower)) estadoClass = 'bg-gray-200 text-gray-800';
      
      html += `
        <tr class="hover:bg-gray-50 transition-colors duration-150">
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${r.cliente_nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${r.habitaciones?.nombre || 'N/A'}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_inicio)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(r.fecha_fin)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm">
            <span class="badge estado-${estadoLower} px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${estadoClass}">
              ${r.estado || 'N/A'}
            </span>
          </td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-right font-medium">${formatCurrencyLocal(r.monto_total)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${metodosPagoMap[r.metodo_pago_id] || 'N/A'}</td>
        </tr>`;
    });
    html += '</tbody></table></div>';
    resultsContainerEl.innerHTML = html;
  } catch (err) {
    console.error('Error generating reservations list report:', err);
    resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar listado: ${err.message}</p>`;
  }
}

async function generarReporteIngresosPorPeriodo(resultsContainerEl, fechaInicioInput, fechaFinInput) {
  // ... (Código sin cambios significativos, igual al proporcionado anteriormente)
  if (!resultsContainerEl) return;
  resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando reporte de ingresos por habitaciones (Caja)...</p>';

  if (!window.Chart) {
    resultsContainerEl.innerHTML = '<p class="error-indicator text-center p-4 text-red-600">Librería de gráficos (Chart.js) no está cargada.</p>';
    return;
  }
  destroyChartInstance('reporte-ingresos-habitaciones-chart');
  try {
    const start = new Date(`${fechaInicioInput}T00:00:00.000Z`);
    const end = new Date(`${fechaFinInput}T23:59:59.999Z`);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
      throw new Error('Rango de fechas inválido.');
    }

    const labels = [];
    const dailyIncomeValues = [];
    
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const currentDateISO = d.toISOString().slice(0, 10);
      labels.push(currentDateISO);
      
      const dayStartUTC = `${currentDateISO}T00:00:00.000Z`;
      const dayEndUTC = `${currentDateISO}T23:59:59.999Z`;
      
      const { data: ingresosDelDia, error: fetchError } = await supabaseClient
        .from('caja')
        .select('monto')
        .eq('hotel_id', currentHotelId)
        .eq('tipo', 'ingreso')
        .gte('fecha_movimiento', dayStartUTC)
        .lte('fecha_movimiento', dayEndUTC)
        .or('concepto.ilike.Alquiler de%,concepto.ilike.Extensión de%,concepto.ilike.Estadia en%,concepto.ilike.Noche adicional%,reserva_id.not.is.null');

      if (fetchError) {
        console.warn(`Error fetching income for ${currentDateISO} from 'caja':`, fetchError.message);
        dailyIncomeValues.push(0); 
      } else {
        const totalDelDia = ingresosDelDia.reduce((sum, p) => sum + (p.monto || 0), 0);
        dailyIncomeValues.push(totalDelDia);
      }
    }

    resultsContainerEl.innerHTML = `
      <h4 class="text-lg font-semibold mb-3">Ingresos por Habitaciones (Caja) (${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})})</h4>
      <div class="chart-container bg-white p-4 rounded-lg shadow-xl border" style="height:350px; position: relative;">
        <canvas id="reporte-ingresos-habitaciones-chart"></canvas>
      </div>`;

    const ctx = resultsContainerEl.querySelector('#reporte-ingresos-habitaciones-chart').getContext('2d');
    currentChartInstances['reporte-ingresos-habitaciones-chart'] = new Chart(ctx, {
      type: 'bar', 
      data: { labels: labels, datasets: [{ label: 'Ingresos Diarios por Habitaciones (Caja)', data: dailyIncomeValues, backgroundColor: 'rgba(75, 192, 192, 0.7)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrencyLocal(value) }}, x: { title: { display: true, text: 'Fecha' } } }, plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label || ''}: ${formatCurrencyLocal(context.parsed.y)}`}}} }
    });
  } catch (err) {
    console.error('Error generating income report (caja):', err);
    resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar reporte de ingresos (caja): ${err.message}</p>`;
  }
}

// --- Helper for robust period key sorting ---
function robustPeriodSort(a, b) {
    const strA = String(a);
    const strB = String(b);

    const partsA = strA.split('-');
    const yearA = parseInt(partsA[0]);
    const periodTypeA = partsA.length > 1 ? partsA[1].charAt(0) : '';
    const periodNumA = partsA.length > 1 ? parseInt(partsA[1].substring(periodTypeA.match(/[A-Za-z]/) ? 1 : 0)) : 0;

    const partsB = strB.split('-');
    const yearB = parseInt(partsB[0]);
    const periodTypeB = partsB.length > 1 ? partsB[1].charAt(0) : '';
    const periodNumB = partsB.length > 1 ? parseInt(partsB[1].substring(periodTypeB.match(/[A-Za-z]/) ? 1 : 0)) : 0;
    
    if (yearA !== yearB) return yearA - yearB;
    if (partsA.length === 1 && partsB.length === 1) return 0; // Both annual
    if (partsA.length === 1) return -1; // Annual A comes before period B
    if (partsB.length === 1) return 1;  // Annual B comes after period A

    if (periodTypeA !== periodTypeB && periodTypeA.match(/[A-Za-z]/) && periodTypeB.match(/[A-Za-z]/)) {
        if (periodTypeA < periodTypeB) return -1; 
        if (periodTypeA > periodTypeB) return 1;
    }
    return periodNumA - periodNumB;
}


// --- Helper Functions for New Financial Reports ---
function categorizarMovimiento(movimiento, serviciosAdicionales = []) {
    const conceptoLower = String(movimiento.concepto || '').toLowerCase();
    if (movimiento.tipo === 'ingreso') {
        if (movimiento.venta_tienda_id) return 'Ingreso: Venta Tienda';
        if (movimiento.venta_restaurante_id) return 'Ingreso: Venta Restaurante';
        if (movimiento.reserva_id) return 'Ingreso: Habitación (Reserva)';
        
        for (const servicio of serviciosAdicionales) {
            if (conceptoLower.includes(String(servicio.nombre).toLowerCase())) {
                return `Ingreso: Serv. Adicional (${servicio.nombre})`;
            }
        }
        if (conceptoLower.includes('alquiler') || conceptoLower.includes('estadia') || conceptoLower.includes('noche adicional') || conceptoLower.includes('habitación')) {
             return 'Ingreso: Habitación (Concepto)';
        }
         if (conceptoLower.includes('apertura de caja')) return 'Ingreso: Apertura Caja'; // Categorize opening amount
        if (conceptoLower.includes('abono reserva') || conceptoLower.includes('pago reserva')) {
            return 'Ingreso: Habitación (Abono/Pago)';
        }
        return 'Ingreso: Otro';
    } else if (movimiento.tipo === 'egreso') {
        if (movimiento.compra_tienda_id) return 'Egreso: Compra Tienda';
        if (conceptoLower.includes('nomina') || conceptoLower.includes('salario')) return 'Egreso: Nómina/Salarios';
        if (conceptoLower.includes('servicio publico') || conceptoLower.includes('servicios publicos') || conceptoLower.includes('agua') || conceptoLower.includes('luz') || conceptoLower.includes('energía') || conceptoLower.includes('gas') || conceptoLower.includes('internet')) return 'Egreso: Servicios Públicos';
        if (conceptoLower.includes('mantenimiento') || conceptoLower.includes('reparacion') || conceptoLower.includes('arreglo')) return 'Egreso: Mantenimiento';
        if (conceptoLower.includes('proveedor')) return 'Egreso: Proveedores';
        if (conceptoLower.includes('impuesto')) return 'Egreso: Impuestos';
        return 'Egreso: Otro';
    }
    return 'Desconocido';
}

function agregarDatosPorPeriodo(movimientos, agrupacion) {
    const agregados = {};
    movimientos.forEach(mov => {
        const fecha = new Date(mov.fecha_movimiento);
        if (isNaN(fecha.getTime())) return;
        let clavePeriodo = '';
        const year = fecha.getFullYear(); const month = fecha.getMonth();
        switch (agrupacion) {
            case 'diario': clavePeriodo = fecha.toISOString().slice(0, 10); break;
            case 'mensual': clavePeriodo = `${year}-M${String(month + 1).padStart(2, '0')}`; break; // Prefix with M for sorting
            case 'bimestral': clavePeriodo = `${year}-B${Math.floor(month / 2) + 1}`; break;
            case 'trimestral': clavePeriodo = `${year}-T${Math.floor(month / 3) + 1}`; break;
            case 'semestral': clavePeriodo = `${year}-S${Math.floor(month / 6) + 1}`; break;
            case 'anual': clavePeriodo = String(year); break;
            default: clavePeriodo = fecha.toISOString().slice(0, 10);
        }
        agregados[clavePeriodo] = (agregados[clavePeriodo] || 0) + mov.monto;
    });
    const clavesOrdenadas = Object.keys(agregados).sort(robustPeriodSort);
    return { labels: clavesOrdenadas, data: clavesOrdenadas.map(clave => agregados[clave]) };
}

function renderTablaMovimientos(movimientos, tituloTabla) {
    // ... (Código sin cambios significativos, igual al proporcionado anteriormente)
    let tablaHtml = `
      <h5 class="text-md font-semibold mt-6 mb-2 text-gray-700">${tituloTabla}</h5>
      <div class="table-container overflow-x-auto shadow-md rounded-lg">
        <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
          <thead class="bg-gray-100">
            <tr>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Fecha</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Categoría</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Concepto</th>
              <th class="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Monto</th>
               <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Método Pago</th> </tr>
          </thead>
          <tbody class="bg-white divide-y divide-gray-200">`;

    if (movimientos.length === 0) {
        tablaHtml += `<tr><td colspan="5" class="px-4 py-4 text-sm text-gray-500 text-center">No hay movimientos para mostrar.</td></tr>`; // Adjusted colspan
    } else {
        movimientos.forEach(mov => {
            tablaHtml += `
                <tr class="hover:bg-gray-50 transition-colors duration-150">
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(mov.fecha_movimiento || mov.creado_en)}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-800 font-medium">${mov.categoria || mov.tipo}</td>
                    <td class="px-4 py-3 text-sm text-gray-600 break-words min-w-[200px] max-w-[400px]">${mov.concepto || 'N/A'}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-right font-semibold ${mov.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'}">${formatCurrencyLocal(mov.monto)}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${mov.metodos_pago?.nombre || 'N/A'}</td> </tr>`;
        });
    }
    tablaHtml += '</tbody></table></div>';
    return tablaHtml;
}

async function generarReporteFinancieroGlobal(resultsContainerEl, fechaInicioInput, fechaFinInput, agrupacion, tipoReporteEspecifico) {
    if (!resultsContainerEl) return;
    resultsContainerEl.innerHTML = `<p class="loading-indicator text-center p-4 text-gray-500">Generando reporte financiero detallado...</p>`;
    
    const chartRequired = ['movimientos_financieros_global', 'detalle_ingresos_categoria'].includes(tipoReporteEspecifico);
    if (chartRequired && !window.Chart) {
        resultsContainerEl.innerHTML = '<p class="error-indicator text-center p-4 text-red-600">Librería de gráficos (Chart.js) no está cargada.</p>';
        return;
    }
    destroyChartInstance('reporte-ingresos-egresos-chart');
    destroyChartInstance('reporte-ingresos-categoria-pie-chart');
    destroyChartInstance('reporte-egresos-categoria-pie-chart');
    
    try {
        const fechaInicioQuery = `${fechaInicioInput}T00:00:00.000Z`;
        const fechaFinQuery = `${fechaFinInput}T23:59:59.999Z`;

        // --- Adjusted to fetch metodos_pago needed for renderTablaMovimientos ---
        const { data: movimientos, error: errorMovimientos } = await supabaseClient
            .from('caja')
            .select(`
                id, fecha_movimiento, tipo, monto, concepto, reserva_id, 
                venta_tienda_id, venta_restaurante_id, compra_tienda_id,
                metodo_pago_id, metodos_pago(nombre), creado_en 
            `)
            .eq('hotel_id', currentHotelId)
            .gte('fecha_movimiento', fechaInicioQuery)
            .lte('fecha_movimiento', fechaFinQuery)
            .order('fecha_movimiento', { ascending: true });

        if (errorMovimientos) throw errorMovimientos;

        if (!movimientos || movimientos.length === 0) {
            resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron movimientos financieros.</p>'; return;
        }

        let serviciosAdicionales = [];
        const { data: serviciosData } = await supabaseClient.from('servicios_adicionales').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true);
        serviciosAdicionales = serviciosData || [];

        const movimientosCategorizados = movimientos.map(mov => ({...mov, categoria: categorizarMovimiento(mov, serviciosAdicionales)}));
        let html = '';
        const tituloBase = `(${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})}) - Agrupado: ${agrupacion.charAt(0).toUpperCase() + agrupacion.slice(1)}`;

        if (tipoReporteEspecifico === 'movimientos_financieros_global') {
            html += `<h4 class="text-xl font-semibold mb-4 text-gray-800">Resumen Financiero Global ${tituloBase}</h4>`;
            const ingresos = movimientosCategorizados.filter(m => m.tipo === 'ingreso');
            const egresos = movimientosCategorizados.filter(m => m.tipo === 'egreso');
            const totalIngresos = ingresos.reduce((sum, m) => sum + m.monto, 0);
            const totalEgresos = egresos.reduce((sum, m) => sum + m.monto, 0);
            const balance = totalIngresos - totalEgresos;

            html += `
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div class="bg-green-50 p-4 rounded-xl shadow-lg border border-green-200"><h5 class="text-md font-semibold text-green-700">Total Ingresos:</h5><p class="text-3xl font-bold text-green-600">${formatCurrencyLocal(totalIngresos)}</p></div>
                    <div class="bg-red-50 p-4 rounded-xl shadow-lg border border-red-200"><h5 class="text-md font-semibold text-red-700">Total Egresos:</h5><p class="text-3xl font-bold text-red-600">${formatCurrencyLocal(totalEgresos)}</p></div>
                    <div class="bg-blue-50 p-4 rounded-xl shadow-lg border border-blue-200"><h5 class="text-md font-semibold text-blue-700">Balance Neto:</h5><p class="text-3xl font-bold ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}">${formatCurrencyLocal(balance)}</p></div>
                </div>
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                    <div class="chart-container bg-white p-4 rounded-lg shadow-xl border" style="height:350px; position: relative;"><canvas id="reporte-ingresos-categoria-pie-chart"></canvas></div>
                    <div class="chart-container bg-white p-4 rounded-lg shadow-xl border" style="height:350px; position: relative;"><canvas id="reporte-egresos-categoria-pie-chart"></canvas></div>
                </div>
                <div class="chart-container bg-white p-4 rounded-lg shadow-xl mb-6 border" style="height:400px; position: relative;"><canvas id="reporte-ingresos-egresos-chart"></canvas></div>`;
            html += renderTablaMovimientos(movimientosCategorizados, 'Listado Detallado de Todos los Movimientos');
            resultsContainerEl.innerHTML = html;

            const ingresosAgrupados = agregarDatosPorPeriodo(ingresos, agrupacion);
            const egresosAgrupados = agregarDatosPorPeriodo(egresos, agrupacion);
            const todasLasEtiquetas = [...new Set([...ingresosAgrupados.labels, ...egresosAgrupados.labels])].sort(robustPeriodSort);
            const dataIngresosFinal = todasLasEtiquetas.map(label => ingresosAgrupados.labels.includes(label) ? ingresosAgrupados.data[ingresosAgrupados.labels.indexOf(label)] : 0);
            const dataEgresosFinal = todasLasEtiquetas.map(label => egresosAgrupados.labels.includes(label) ? egresosAgrupados.data[egresosAgrupados.labels.indexOf(label)] : 0);
            
            const ctxBar = resultsContainerEl.querySelector('#reporte-ingresos-egresos-chart')?.getContext('2d');
            if (ctxBar) currentChartInstances['reporte-ingresos-egresos-chart'] = new Chart(ctxBar, { type: 'bar', data: { labels: todasLasEtiquetas, datasets: [ { label: 'Ingresos', data: dataIngresosFinal, backgroundColor: 'rgba(75, 192, 192, 0.7)', borderColor: 'rgba(75, 192, 192, 1)', borderWidth: 1}, { label: 'Egresos', data: dataEgresosFinal, backgroundColor: 'rgba(255, 99, 132, 0.7)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1} ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrencyLocal(value) } }, x: { title: { display: true, text: `Período (${agrupacion})` } } }, plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${formatCurrencyLocal(ctx.parsed.y)}` } } } } });
            
            const ingresosPorCat = ingresos.reduce((acc, mov) => { acc[mov.categoria] = (acc[mov.categoria] || 0) + mov.monto; return acc; }, {});
            const catIngLabels = Object.keys(ingresosPorCat); const catIngData = Object.values(ingresosPorCat);
            const ctxPieIng = resultsContainerEl.querySelector('#reporte-ingresos-categoria-pie-chart')?.getContext('2d');
            if(ctxPieIng && catIngLabels.length > 0) currentChartInstances['reporte-ingresos-categoria-pie-chart'] = new Chart(ctxPieIng, {type: 'pie', data: {labels: catIngLabels, datasets:[{label:'Desglose Ingresos', data:catIngData, backgroundColor:['rgba(75,192,192,0.8)','rgba(255,159,64,0.8)','rgba(153,102,255,0.8)','rgba(255,205,86,0.8)','rgba(54,162,235,0.8)']}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right'}, title:{display:true, text:'Desglose de Ingresos'}, tooltip:{callbacks:{label:ctx => `${ctx.label}: ${formatCurrencyLocal(ctx.parsed)} (${((ctx.parsed/ctx.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)`}}}}});

            const egresosPorCat = egresos.reduce((acc, mov) => { acc[mov.categoria] = (acc[mov.categoria] || 0) + mov.monto; return acc; }, {});
            const catEgrLabels = Object.keys(egresosPorCat); const catEgrData = Object.values(egresosPorCat);
            const ctxPieEgr = resultsContainerEl.querySelector('#reporte-egresos-categoria-pie-chart')?.getContext('2d');
            if(ctxPieEgr && catEgrLabels.length > 0) currentChartInstances['reporte-egresos-categoria-pie-chart'] = new Chart(ctxPieEgr, {type: 'pie', data: {labels: catEgrLabels, datasets:[{label:'Desglose Egresos', data:catEgrData, backgroundColor:['rgba(255,99,132,0.8)','rgba(255,짜0,0,0.8)','rgba(100,100,255,0.8)','rgba(200,200,100,0.8)','rgba(100,200,200,0.8)']}]}, options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'right'}, title:{display:true, text:'Desglose de Egresos'}, tooltip:{callbacks:{label:ctx => `${ctx.label}: ${formatCurrencyLocal(ctx.parsed)} (${((ctx.parsed/ctx.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)`}}}}});

        } else if (tipoReporteEspecifico === 'detalle_ingresos_categoria') {
            html += `<h4 class="text-xl font-semibold mb-4 text-gray-800">Detalle de Ingresos por Categoría ${tituloBase}</h4>`;
            const ingresos = movimientosCategorizados.filter(m => m.tipo === 'ingreso');
            const ingresosPorCategoriaData = ingresos.reduce((acc, mov) => {
                const cat = mov.categoria;
                acc[cat] = (acc[cat] || 0) + mov.monto;
                return acc;
            }, {});
            const categoriasOrdenadas = Object.entries(ingresosPorCategoriaData).sort(([,a],[,b]) => b - a);

            html += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">`;
            categoriasOrdenadas.forEach(([categoria, total]) => {
                html += `<div class="p-4 bg-green-50 rounded-lg shadow border border-green-200"><h6 class="font-semibold text-green-700 truncate">${categoria}</h6><p class="text-xl font-bold text-green-600">${formatCurrencyLocal(total)}</p></div>`;
            });
            html += `</div>`;
            html += `<div class="chart-container bg-white p-4 rounded-lg shadow-xl mb-6 border" style="height:400px; max-width: 600px; margin-left: auto; margin-right: auto; position: relative;"><canvas id="reporte-ingresos-categoria-pie-chart"></canvas></div>`;
            html += renderTablaMovimientos(ingresos, 'Listado Detallado de Ingresos');
            resultsContainerEl.innerHTML = html;

            const ctxPie = resultsContainerEl.querySelector('#reporte-ingresos-categoria-pie-chart')?.getContext('2d');
            if (ctxPie && window.Chart && categoriasOrdenadas.length > 0) {
                 currentChartInstances['reporte-ingresos-categoria-pie-chart'] = new Chart(ctxPie, { type: 'pie', data: { labels: categoriasOrdenadas.map(c => c[0]), datasets: [{ label: 'Ingresos por Categoría', data: categoriasOrdenadas.map(c => c[1]), backgroundColor: ['rgba(75,192,192,0.8)','rgba(255,159,64,0.8)','rgba(153,102,255,0.8)','rgba(255,205,86,0.8)','rgba(54,162,235,0.8)','rgba(255,99,132,0.8)'], borderColor: 'rgba(255,255,255,0.7)', borderWidth: 1.5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, title:{display:true, text:'Desglose de Ingresos'}, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrencyLocal(ctx.parsed)} (${((ctx.parsed/ctx.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)` } } } } });
            }

        } else if (tipoReporteEspecifico === 'detalle_egresos_categoria') {
            html += `<h4 class="text-xl font-semibold mb-4 text-gray-800">Detalle de Egresos por Categoría ${tituloBase}</h4>`;
            const egresos = movimientosCategorizados.filter(m => m.tipo === 'egreso');
            const egresosPorCategoriaData = egresos.reduce((acc, mov) => {
                const cat = mov.categoria;
                acc[cat] = (acc[cat] || 0) + mov.monto;
                return acc;
            }, {});
            const categoriasEgresosOrdenadas = Object.entries(egresosPorCategoriaData).sort(([,a],[,b]) => b - a);

            html += `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">`;
            categoriasEgresosOrdenadas.forEach(([categoria, total]) => {
                html += `<div class="p-4 bg-red-50 rounded-lg shadow border border-red-200"><h6 class="font-semibold text-red-700 truncate">${categoria}</h6><p class="text-xl font-bold text-red-600">${formatCurrencyLocal(total)}</p></div>`;
            });
            html += `</div>`;
             html += `<div class="chart-container bg-white p-4 rounded-lg shadow-xl mb-6 border" style="height:400px; max-width: 600px; margin-left: auto; margin-right: auto; position: relative;"><canvas id="reporte-egresos-categoria-pie-chart"></canvas></div>`;
            html += renderTablaMovimientos(egresos, 'Listado Detallado de Egresos');
            resultsContainerEl.innerHTML = html;

            const ctxPieEgr = resultsContainerEl.querySelector('#reporte-egresos-categoria-pie-chart')?.getContext('2d');
             if (ctxPieEgr && window.Chart && categoriasEgresosOrdenadas.length > 0) {
                 currentChartInstances['reporte-egresos-categoria-pie-chart'] = new Chart(ctxPieEgr, { type: 'pie', data: { labels: categoriasEgresosOrdenadas.map(c => c[0]), datasets: [{ label: 'Egresos por Categoría', data: categoriasEgresosOrdenadas.map(c => c[1]), backgroundColor: ['rgba(255,99,132,0.8)','rgba(255,159,64,0.8)','rgba(255,205,86,0.8)','rgba(75,192,192,0.8)','rgba(54,162,235,0.8)','rgba(153,102,255,0.8)'], borderColor: 'rgba(255,255,255,0.7)', borderWidth: 1.5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' }, title:{display:true, text:'Desglose de Egresos'}, tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatCurrencyLocal(ctx.parsed)} (${((ctx.parsed/ctx.chart.getDatasetMeta(0).total)*100).toFixed(1)}%)` } } } } });
            }
        }
    } catch (err) {
        console.error('Error generating financial report:', err);
        resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar reporte financiero: ${err.message}</p>`;
    }
}

/**
 * Generates and renders an Occupancy Report.
 * @param {HTMLElement} resultsContainerEl - The container for the report results.
 * @param {string} fechaInicioInput - Start date in YYYY-MM-DD format.
 * @param {string} fechaFinInput - End date in YYYY-MM-DD format.
 */
async function generarReporteOcupacion(resultsContainerEl, fechaInicioInput, fechaFinInput) {
    if (!resultsContainerEl) return;
    resultsContainerEl.innerHTML = `<p class="loading-indicator text-center p-4 text-gray-500">Generando reporte de ocupación...</p>`;
    destroyChartInstance('reporte-ocupacion-chart'); 

    if (!window.Chart) {
        resultsContainerEl.innerHTML = '<p class="error-indicator text-center p-4 text-red-600">Librería de gráficos (Chart.js) no está cargada.</p>';
        return;
    }

    try {
        const { count: totalHabitacionesDisponibles, error: errHab } = await supabaseClient
            .from('habitaciones')
            .select('*', { count: 'exact', head: true }) 
            .eq('hotel_id', currentHotelId)
            .eq('activo', true);

        if (errHab) {
            console.error("Error fetching active rooms count:", errHab);
            throw new Error(`Error al obtener conteo de habitaciones: ${errHab.message}`);
        }
        
        console.log("Total Habitaciones Activas Contadas:", totalHabitacionesDisponibles);

        if (totalHabitacionesDisponibles === null || totalHabitacionesDisponibles === undefined) {
             resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se pudo determinar el número de habitaciones activas. Verifique la consola.</p>';
             console.error("totalHabitacionesDisponibles es null o undefined después de la consulta.");
             return;
        }
        if (totalHabitacionesDisponibles === 0) {
            resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No hay habitaciones activas configuradas para calcular la ocupación.</p>';
            return;
        }

        const fechaInicio = new Date(`${fechaInicioInput}T00:00:00.000Z`);
        const fechaFin = new Date(`${fechaFinInput}T23:59:59.999Z`);
        
        const estadosOcupadosValidos = ['confirmada', 'activa', 'check_in']; 

        const { data: todasLasReservas, error: errRes } = await supabaseClient
            .from('reservas')
            .select('id, habitacion_id, fecha_inicio, fecha_fin, estado')
            .eq('hotel_id', currentHotelId)
            .in('estado', estadosOcupadosValidos)
            .lte('fecha_inicio', fechaFin.toISOString()) 
            .gte('fecha_fin', fechaInicio.toISOString()); 
            
        if (errRes) {
            console.error('Supabase error fetching reservations for occupancy:', errRes);
            throw new Error(`Error al obtener reservas para ocupación: ${errRes.message}`);
        }

        const occupancyData = [];
        let totalNochesOcupadas = 0;
        let countDaysInPeriod = 0;

        for (let d = new Date(fechaInicio); d <= fechaFin; d.setDate(d.getDate() + 1)) {
            countDaysInPeriod++;
            const currentDateStr = d.toISOString().slice(0, 10);
            const inicioDia = new Date(currentDateStr + "T00:00:00.000Z");
            const finDia = new Date(currentDateStr + "T23:59:59.999Z");
            
            let habitacionesOcupadasHoy = new Set();

            (todasLasReservas || []).forEach(reserva => {
                const resInicio = new Date(reserva.fecha_inicio);
                const resFin = new Date(reserva.fecha_fin);
                if (resInicio <= finDia && resFin >= inicioDia) {
                    habitacionesOcupadasHoy.add(reserva.habitacion_id);
                }
            });
            
            const numOcupadas = habitacionesOcupadasHoy.size;
            const porcentajeOcupacion = totalHabitacionesDisponibles > 0 ? (numOcupadas / totalHabitacionesDisponibles) * 100 : 0;
            occupancyData.push({ date: currentDateStr, occupied: numOcupadas, percentage: porcentajeOcupacion });
            totalNochesOcupadas += numOcupadas;
        }
        
        const totalHabitacionesNochesDisponibles = totalHabitacionesDisponibles * countDaysInPeriod;
        const avgOccupancyPercentage = totalHabitacionesNochesDisponibles > 0 ? (totalNochesOcupadas / totalHabitacionesNochesDisponibles) * 100 : 0;

        let html = `
            <h4 class="text-xl font-semibold mb-2 text-gray-800">Reporte de Ocupación</h4>
            <p class="text-sm text-gray-600 mb-1">Período: ${formatDateLocal(fechaInicioInput, {dateStyle:'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle:'medium'})}</p>
            <p class="text-sm text-gray-600 mb-4">Total Habitaciones Activas: <strong>${totalHabitacionesDisponibles}</strong></p>
            
            <div class="bg-indigo-50 p-4 rounded-lg shadow-md border border-indigo-200 mb-6">
                <h5 class="text-md font-semibold text-indigo-700">Ocupación Promedio del Período:</h5>
                <p class="text-3xl font-bold text-indigo-600">${avgOccupancyPercentage.toFixed(2)}%</p>
            </div>

            <div class="chart-container bg-white p-4 rounded-lg shadow-xl border mb-6" style="height:350px; position: relative;">
                <canvas id="reporte-ocupacion-chart"></canvas>
            </div>
            <h5 class="text-md font-semibold mt-6 mb-2 text-gray-700">Detalle Diario de Ocupación</h5>
            <div class="table-container overflow-x-auto shadow-md rounded-lg">
                <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
                    <thead class="bg-gray-100">
                        <tr>
                            <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Fecha</th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Hab. Ocupadas</th>
                            <th class="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">% Ocupación</th>
                        </tr>
                    </thead>
                    <tbody class="bg-white divide-y divide-gray-200">`;

        if (occupancyData.length === 0) {
            html += `<tr><td colspan="3" class="px-4 py-4 text-center text-sm text-gray-500">No hay datos de ocupación para el período seleccionado.</td></tr>`;
        } else {
            occupancyData.forEach(item => {
                html += `
                    <tr class="hover:bg-gray-50">
                        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(item.date, {dateStyle:'medium', timeStyle:undefined})}</td>
                        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700 text-right">${item.occupied}</td>
                        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700 text-right font-medium">${item.percentage.toFixed(2)}%</td>
                    </tr>`;
            });
        }
        html += `</tbody></table></div>`;
        resultsContainerEl.innerHTML = html;

        if (occupancyData.length > 0) {
            const ctx = resultsContainerEl.querySelector('#reporte-ocupacion-chart').getContext('2d');
            currentChartInstances['reporte-ocupacion-chart'] = new Chart(ctx, { 
                type: 'line',
                data: {
                    labels: occupancyData.map(item => formatDateLocal(item.date, {month:'short', day:'numeric'})),
                    datasets: [{
                        label: '% Ocupación Diaria',
                        data: occupancyData.map(item => item.percentage),
                        borderColor: 'rgb(79, 70, 229)', 
                        backgroundColor: 'rgba(79, 70, 229, 0.1)',
                        tension: 0.1,
                        fill: true
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: { y: { beginAtZero: true, max: 100, ticks: { callback: value => `${value}%` } }, x: { title: {display: true, text: 'Fecha'} } },
                    plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: ctx => `Ocupación: ${ctx.parsed.y.toFixed(2)}%` } } }
                }
            });
        }

    } catch (err) {
        console.error('Error generating occupancy report:', err);
        resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar reporte de ocupación: ${err.message}</p>`;
    }
}


// --- NEW: Function to show shift closure details in a modal ---
async function mostrarDetalleCierreCajaModal(turnoId, feedbackElToUse) {
    const modalId = `modal-detalle-cierre-${turnoId}`;
    let existingModal = document.getElementById(modalId);
    if (existingModal) existingModal.remove(); // Eliminar modal anterior si existe

    const loadingModal = document.createElement('div');
    loadingModal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50";
    loadingModal.innerHTML = `<div class="bg-white p-10 rounded-lg shadow-xl text-center"><p class="text-lg font-medium text-gray-700">Cargando detalles del cierre...</p></div>`;
    document.body.appendChild(loadingModal);

    try {
        // 1. Fetch shift details (including user name)
        const { data: turnoData, error: turnoError } = await supabaseClient
        .from('turnos')
        .select('id, fecha_cierre, balance_final, fecha_apertura, usuarios(nombre, email)')
        .eq('id', turnoId)
        .eq('hotel_id', currentHotelId) // Asegurarse de que el turno pertenezca al hotel actual
        .single();

        if (turnoError) throw turnoError;
        if (!turnoData) throw new Error('No se encontró el turno especificado.');

        // 2. Fetch movements for this specific shift
        const { data: movimientos, error: movError } = await supabaseClient
            .from('caja')
            .select('*, usuarios(nombre), metodos_pago(nombre)') // Seleccionar todo de caja y nombres de usuario/método
            .eq('turno_id', turnoId)
            .order('creado_en', { ascending: true });

        if (movError) throw movError;

        // 3. Calculate totals from movements
        let totalIngresosCalc = 0;
        let totalEgresosCalc = 0;
        const ingresosPorMetodoDetalles = {};
        const egresosPorMetodoDetalles = {};
        let montoApertura = 0;

        (movimientos || []).forEach(mv => {
            const montoNum = Number(mv.monto);
            if (mv.tipo === 'ingreso' || mv.tipo === 'apertura') {
                totalIngresosCalc += montoNum;
                if (mv.tipo === 'apertura') {
                    montoApertura = montoNum; // Asignar el monto de apertura
                }
                const nombreMetodo = mv.metodos_pago?.nombre || (mv.tipo === 'apertura' ? 'Monto Inicial Registrado' : 'Otro Ingreso');
                ingresosPorMetodoDetalles[nombreMetodo] = (ingresosPorMetodoDetalles[nombreMetodo] || 0) + montoNum;
            } else if (mv.tipo === 'egreso') {
                totalEgresosCalc += montoNum;
                const nombreMetodo = mv.metodos_pago?.nombre || 'Otro Egreso';
                egresosPorMetodoDetalles[nombreMetodo] = (egresosPorMetodoDetalles[nombreMetodo] || 0) + montoNum;
            }
        });
        // El balanceCalculado aquí es la suma de todos los ingresos (incluida apertura) menos todos los egresos.
        // Es para verificar contra el balance_final guardado del turno.
        const balanceCalculadoConMovimientos = totalIngresosCalc - totalEgresosCalc;
        
        const usuarioNombre = turnoData.usuarios?.nombre || turnoData.usuarios?.email || 'Usuario Desconocido';
        const fechaCierreStr = formatDateLocal(turnoData.fecha_cierre, { dateStyle: 'full', timeStyle: 'short' });
        const fechaAperturaStr = formatDateLocal(turnoData.fecha_apertura, { dateStyle: 'full', timeStyle: 'short' });

        // 4. Render HTML for the modal
        let html = `
          <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-3xl mx-auto border border-slate-200 relative animate-fade-in-down">
            <div class="py-5 px-8 border-b rounded-t-2xl bg-gradient-to-r from-slate-100 to-gray-100 flex items-center justify-between">
              <div>
                <h2 class="text-2xl font-bold text-slate-800">Detalle de Cierre de Caja</h2>
                <p class="text-sm text-gray-600">Cerrado por: ${usuarioNombre} el ${fechaCierreStr}</p>
                <p class="text-sm text-gray-600">Turno abierto el: ${fechaAperturaStr}</p>
              </div>
              <button id="btn-close-detalle-modal-${turnoId}" class="text-gray-500 hover:text-red-600 transition-colors text-2xl">&times;</button>
            </div>
            <div class="p-6 md:p-8 space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
                <div>
                  <span class="block text-xs text-gray-500">Ingresos Totales (incl. apertura)</span>
                  <span class="text-2xl font-bold text-green-600">${formatCurrencyLocal(totalIngresosCalc)}</span>
                </div>
                <div>
                  <span class="block text-xs text-gray-500">Egresos Totales</span>
                  <span class="text-2xl font-bold text-red-600">${formatCurrencyLocal(totalEgresosCalc)}</span>
                </div>
                <div>
                  <span class="block text-xs text-gray-500">Balance Registrado del Turno</span>
                  <span class="text-2xl font-bold ${turnoData.balance_final < 0 ? 'text-red-600' : 'text-green-700'}">${formatCurrencyLocal(turnoData.balance_final)}</span>
                </div>
              </div>
              ${ montoApertura > 0 ? `<p class="text-sm text-center text-gray-500 italic">Monto de apertura registrado: ${formatCurrencyLocal(montoApertura)}</p>` : ''}
              ${ Math.abs(turnoData.balance_final - balanceCalculadoConMovimientos) > 0.01 ? `<p class="text-sm text-center text-orange-600 italic">Nota: El balance registrado (${formatCurrencyLocal(turnoData.balance_final)}) difiere del calculado con movimientos (${formatCurrencyLocal(balanceCalculadoConMovimientos)}). Puede haber movimientos editados/eliminados después del cierre.</p>` : '' }


              <div class="grid md:grid-cols-2 gap-4 mt-6">
                <div>
                  <span class="block font-semibold mb-2 text-green-700">Ingresos por Método de Pago</span>
                  <ul class="pl-4 space-y-1 text-sm">
                    ${Object.entries(ingresosPorMetodoDetalles).map(([metodo, total]) => `
                      <li class="flex items-center gap-2">
                        <span class="text-gray-700">${metodo}</span>
                        <span class="font-semibold text-green-700 ml-auto">${formatCurrencyLocal(total)}</span>
                      </li>
                    `).join('') || '<li class="text-gray-400 italic">Sin ingresos detallados por método.</li>'}
                  </ul>
                </div>
                <div>
                  <span class="block font-semibold mb-2 text-red-700">Egresos por Método de Pago</span>
                  <ul class="pl-4 space-y-1 text-sm">
                    ${Object.keys(egresosPorMetodoDetalles).length === 0 
                      ? '<li class="text-gray-400 italic">Sin egresos</li>' 
                      : Object.entries(egresosPorMetodoDetalles).map(([metodo, total]) => `
                        <li class="flex items-center gap-2">
                          <span class="text-gray-700">${metodo}</span>
                          <span class="font-semibold text-red-600 ml-auto">${formatCurrencyLocal(total)}</span>
                        </li>
                      `).join('')}
                  </ul>
                </div>
              </div>
              <div class="mt-6">
                <h5 class="text-md font-semibold mb-2 text-gray-700">Detalle de Movimientos del Turno</h5>
                  <div class="table-container overflow-x-auto shadow-sm rounded-lg border bg-gray-50 max-h-[300px] overflow-y-auto">
                    <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
                      <thead class="bg-gray-100 sticky top-0">
                        <tr>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Fecha</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Tipo</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Concepto</th>
                          <th class="px-3 py-2 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Monto</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Método Pago</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Usuario Mov.</th>
                        </tr>
                      </thead>
                      <tbody class="bg-white divide-y divide-gray-200">
                        ${(movimientos && movimientos.length > 0) ? movimientos.map(mv => `
                          <tr class="hover:bg-slate-50">
                            <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-500">${formatDateLocal(mv.creado_en)}</td>
                            <td class="px-3 py-2 whitespace-nowrap text-xs"><span class="badge ${mv.tipo === 'ingreso' || mv.tipo === 'apertura' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">${mv.tipo}</span></td>
                            <td class="px-3 py-2 text-xs text-gray-600 break-words min-w-[150px] max-w-[300px]">${mv.concepto || 'N/A'}</td>
                            <td class="px-3 py-2 whitespace-nowrap text-xs text-right font-semibold ${mv.tipo === 'ingreso' || mv.tipo === 'apertura' ? 'text-green-600' : 'text-red-600'}">${formatCurrencyLocal(mv.monto)}</td>
                            <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-500">${mv.metodos_pago?.nombre || (mv.tipo === 'apertura' ? 'N/A (Apertura)' : 'N/A')}</td>
                            <td class="px-3 py-2 whitespace-nowrap text-xs text-gray-500">${mv.usuarios?.nombre || 'Sistema'}</td>
                          </tr>
                        `).join('') : '<tr><td colspan="6" class="text-center p-4 text-sm text-gray-500">No hay movimientos en este turno.</td></tr>'}
                      </tbody>
                    </table>
                  </div>
              </div>
              <div class="flex justify-end gap-3 mt-6">
                <button id="btn-imprimir-detalle-cierre-${turnoId}" class="button button-primary py-2 px-4 text-sm">Imprimir Detalle</button>
                <button id="btn-cerrar-detalle-modal-action-${turnoId}" class="button button-neutral py-2 px-4 text-sm">Cerrar Vista</button>
              </div>
            </div>
          </div>
        `;
        
        loadingModal.remove();
        const detailModal = document.createElement('div');
        detailModal.id = modalId;
        detailModal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4 overflow-auto";
        detailModal.innerHTML = html;
        document.body.appendChild(detailModal);

        // Asignar listeners a los botones del modal de detalle
        const btnCloseX = detailModal.querySelector(`#btn-close-detalle-modal-${turnoId}`);
        if (btnCloseX) btnCloseX.onclick = () => detailModal.remove();

        const btnCerrarAccion = detailModal.querySelector(`#btn-cerrar-detalle-modal-action-${turnoId}`);
        if (btnCerrarAccion) btnCerrarAccion.onclick = () => detailModal.remove();
        
        // ... (dentro de mostrarDetalleCierreCajaModal, después de que `detailModal` se ha añadido al DOM) ...

        // BOTÓN DE IMPRESIÓN
        const btnImprimir = detailModal.querySelector(`#btn-imprimir-detalle-cierre-${turnoId}`);
        if (btnImprimir) {
            btnImprimir.onclick = () => {
                // Llamada a la función de impresión
                imprimirDetalleCierreCaja(
                    turnoData, 
                    movimientos, 
                    { totalIngresos: totalIngresosCalc, detalles: ingresosPorMetodoDetalles }, 
                    { totalEgresos: totalEgresosCalc, detalles: egresosPorMetodoDetalles }, 
                    montoApertura,
                    turnoData.balance_final // Usar el balance final registrado del turno para el ticket
                );
            };
        } else {
            console.warn(`Botón de impresión con ID #btn-imprimir-detalle-cierre-${turnoId} no encontrado en el modal.`);
        }
// ...

    } catch (err) {
        loadingModal.remove();
        console.error("Error al mostrar detalle de cierre de caja:", err);
        // Usar el feedbackEl del módulo de reportes si está disponible, o un alert de fallback
        if (feedbackElToUse) {
            showReportesFeedback(feedbackElToUse, `Error al cargar detalle: ${err.message}`, 'error-indicator', 5000);
        } else {
            alert(`Error al cargar detalle del cierre: ${err.message}`);
        }
    }
}


// --- NEW: Function to generate "Historial de Cierres de Caja" report ---
async function generarReporteCierresDeCaja(resultsContainerEl, fechaInicioInput, fechaFinInput) {
    if (!resultsContainerEl) return;
    resultsContainerEl.innerHTML = '<p class="loading-indicator text-center p-4 text-gray-500">Generando historial de cierres de caja...</p>';
    const feedbackEl = document.getElementById('reportes-feedback'); // General feedback element for the module

    try {
        const fechaInicioQuery = `${fechaInicioInput}T00:00:00.000Z`;
        const fechaFinQuery = `${fechaFinInput}T23:59:59.999Z`;

        const { data: cierres, error } = await supabaseClient
        .from('turnos')
        .select(`
            id,
            usuario_id,
            usuarios (nombre, email),
            fecha_cierre,
            balance_final,
            fecha_apertura 
        `) // MODIFICADO: created_at -> fecha_apertura
        .eq('hotel_id', currentHotelId)
        .eq('estado', 'cerrado')
        .gte('fecha_cierre', fechaInicioQuery)
        .lte('fecha_cierre', fechaFinQuery)
        .order('fecha_cierre', { ascending: false });

    if (error) throw error;

    if (!cierres || cierres.length === 0) {
        resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron cierres de caja para los criterios seleccionados.</p>';
        return;
    }

        let html = `
          <h4 class="text-lg font-semibold mb-3">Historial de Cierres de Caja (${formatDateLocal(fechaInicioInput, {dateStyle: 'medium'})} - ${formatDateLocal(fechaFinInput, {dateStyle: 'medium'})})</h4>
          <div class="table-container overflow-x-auto shadow-md rounded-lg">
            <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Usuario</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Fecha Apertura</th>
                  <th class="px-4 py-3 text-left text-xs font-medium text-gray-600 uppercase tracking-wider">Fecha Cierre</th>
                  <th class="px-4 py-3 text-right text-xs font-medium text-gray-600 uppercase tracking-wider">Balance Final</th>
                  <th class="px-4 py-3 text-center text-xs font-medium text-gray-600 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">`;

        cierres.forEach(cierre => {
            const userName = cierre.usuarios?.nombre || cierre.usuarios?.email || 'Usuario del Sistema'; // Punto y coma añadido aquí
            html += `
                <tr class="hover:bg-gray-50 transition-colors duration-150">
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${userName}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(cierre.fecha_apertura)}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${formatDateLocal(cierre.fecha_cierre)}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 text-right font-medium">${formatCurrencyLocal(cierre.balance_final)}</td>
                    <td class="px-4 py-3 whitespace-nowrap text-sm text-center">
                        <button class="button button-outline button-small view-cierre-details" data-turno-id="${cierre.id}">
                            Ver Detalle
                        </button>
                    </td>
                </tr>`;
        });

        html += `
              </tbody>
            </table>
          </div>`;
        
        resultsContainerEl.innerHTML = html;

        // Add event listeners for "Ver Detalle" buttons
        resultsContainerEl.querySelectorAll('.view-cierre-details').forEach(button => {
            const turnoId = button.dataset.turnoId;
            const buttonClickHandler = () => mostrarDetalleCierreCajaModal(turnoId, feedbackEl); // Asumiendo que feedbackEl está definido
            button.addEventListener('click', buttonClickHandler);
            moduleListeners.push({ element: button, type: 'click', handler: buttonClickHandler });
        });

    } catch (err) {
        console.error('Error generating shift closures report:', err);
        resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar historial de cierres: ${err.message}</p>`;
        if (feedbackEl) showReportesFeedback(feedbackEl, `Error: ${err.message}`, 'error-indicator', 5000);
    }
}



// REEMPLAZA TU FUNCIÓN CON ESTA VERSIÓN FINAL Y COMPLETA
// =================================================================================
// ▼▼▼ REEMPLAZA TU FUNCIÓN generarReporteKPIsAvanzados CON ESTE BLOQUE COMPLETO ▼▼▼
// =================================================================================

/**
 * Función principal que orquesta la generación del reporte de KPIs.
 * Llama a funciones auxiliares para buscar datos, calcular KPIs y renderizar el HTML.
 */
async function generarReporteKPIsAvanzados(resultsContainerEl, fechaInicioInput, fechaFinInput) {
    if (!resultsContainerEl) return;
    resultsContainerEl.innerHTML = `<p class="loading-indicator text-center p-4 text-gray-500">Calculando KPIs avanzados, esto puede tomar un momento...</p>`;

    try {
        // 1. Obtener todos los datos necesarios en un solo lugar.
        const data = await fetchKPIData(fechaInicioInput, fechaFinInput);

        if (!data.reservas || data.reservas.length === 0) {
            resultsContainerEl.innerHTML = '<p class="text-center text-gray-500 p-4">No se encontraron reservas en el período para calcular KPIs.</p>';
            return;
        }

        // 2. Calcular todas las métricas a partir de los datos obtenidos.
        const kpis = calculateKPIs(data, fechaInicioInput, fechaFinInput);
        
        // 3. Renderizar el HTML final con los KPIs calculados.
        resultsContainerEl.innerHTML = renderKPIsHTML(kpis, fechaInicioInput, fechaFinInput);

    } catch (err) {
        console.error('Error generando el reporte de KPIs avanzados:', err);
        resultsContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error al generar KPIs: ${err.message}</p>`;
    }
}

/**
 * @returns {Promise<object>} Un objeto con todos los datos requeridos.
 */
async function fetchKPIData(fechaInicio, fechaFin) {
    const fechaInicioQuery = `${fechaInicio}T00:00:00.000Z`;
    const fechaFinQuery = `${fechaFin}T23:59:59.999Z`;

    const [
        reservasResult, 
        ingresosResult, 
        habitacionesResult, 
        ventasTiendaResult, 
        serviciosResult
    ] = await Promise.all([
        supabaseClient.from('reservas').select(`id, fecha_inicio, fecha_fin, monto_total, estado, cliente_id, clientes (nombre), habitaciones (nombre)`)
            .eq('hotel_id', currentHotelId).gte('fecha_inicio', fechaInicioQuery).lte('fecha_inicio', fechaFinQuery),
        supabaseClient.from('caja').select('fecha_movimiento, monto').eq('hotel_id', currentHotelId).eq('tipo', 'ingreso')
            .gte('fecha_movimiento', fechaInicioQuery).lte('fecha_movimiento', fechaFinQuery),
        supabaseClient.from('habitaciones').select('*', { count: 'exact', head: true }).eq('hotel_id', currentHotelId).eq('activo', true),
        supabaseClient.from('detalle_ventas_tienda').select(`cantidad, subtotal, producto:productos_tienda!detalle_ventas_tienda_producto_id_fkey(nombre)`)
            .eq('hotel_id', currentHotelId).gte('creado_en', fechaInicioQuery).lte('creado_en', fechaFinQuery),
        
        // ▼▼▼ CORRECCIÓN AQUÍ: Se añade "descripcion_manual" a la consulta ▼▼▼
        supabaseClient.from('servicios_x_reserva').select(`cantidad, precio_cobrado, descripcion_manual, servicio:servicios_adicionales(nombre)`)
            .eq('hotel_id', currentHotelId).gte('creado_en', fechaInicioQuery).lte('creado_en', fechaFinQuery)
        // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
    ]);

    const results = {
        reservas: reservasResult,
        ingresos: ingresosResult,
        habitaciones: habitacionesResult,
        ventasTienda: ventasTiendaResult,
        servicios: serviciosResult
    };

    for (const key in results) {
        if (results[key].error) {
            console.error(`Error fetching ${key}:`, results[key].error);
            throw new Error(`No se pudieron obtener los datos de ${key}.`);
        }
    }

    return {
        reservas: results.reservas.data,
        movimientosIngreso: results.ingresos.data,
        totalHabitaciones: results.habitaciones.count,
        detallesVentasTienda: results.ventasTienda.data,
        serviciosVendidos: results.servicios.data
    };
}


/**
 * Calcula todas las métricas KPI a partir de los datos brutos.
 * @param {object} data - El objeto con los datos de fetchKPIData.
 * @returns {object} Un objeto con todos los KPIs calculados.
 */
function calculateKPIs(data, fechaInicio, fechaFin) {
    const { reservas, movimientosIngreso, totalHabitaciones, detallesVentasTienda, serviciosVendidos } = data;

    // Hotelería (sin cambios)
    const reservasValidas = reservas.filter(r => r.estado !== 'cancelada' && r.estado !== 'no_show');
    const totalNoches = reservasValidas.reduce((sum, r) => sum + (new Date(r.fecha_fin) - new Date(r.fecha_inicio)) / (1000 * 60 * 60 * 24), 0);
    const totalIngresosHabitaciones = reservasValidas.reduce((sum, r) => sum + Number(r.monto_total || 0), 0);
    const diasEnPeriodo = (new Date(fechaFin) - new Date(fechaInicio)) / (1000 * 60 * 60 * 24) + 1;
    const totalNochesDisponibles = totalHabitaciones * diasEnPeriodo;
    
    // Mejor Cliente (sin cambios)
    const ingresosPorCliente = reservasValidas.reduce((acc, r) => {
        if (r.cliente_id && r.monto_total > 0) {
            acc[r.clientes?.nombre || 'Cliente Anónimo'] = (acc[r.clientes?.nombre || 'Cliente Anónimo'] || 0) + Number(r.monto_total);
        }
        return acc;
    }, {});
    const [mejorClienteNombre, mejorClienteIngresos] = Object.entries(ingresosPorCliente).sort(([,a],[,b]) => b-a)[0] || ["N/A", 0];

    // Días de mayor y menor movimiento (sin cambios)
    const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const demandaPorDia = new Array(7).fill(0);
    reservasValidas.forEach(r => { demandaPorDia[new Date(r.fecha_inicio).getUTCDay()]++; });
    const maxDemanda = Math.max(...demandaPorDia);
    const ingresosPorDiaSemana = new Array(7).fill(0);
    const conteoDeDiasEnRango = new Array(7).fill(0);
    for (let d = new Date(fechaInicio); d <= new Date(fechaFin); d.setDate(d.getDate() + 1)) {
        conteoDeDiasEnRango[d.getUTCDay()]++;
    }
    movimientosIngreso.forEach(mov => { ingresosPorDiaSemana[new Date(mov.fecha_movimiento).getUTCDay()] += Number(mov.monto); });
    let minPromedio = Infinity;
    let diaMenosMovido = "N/A";
    ingresosPorDiaSemana.forEach((total, i) => {
        if (conteoDeDiasEnRango[i] > 0) {
            const promedio = total / conteoDeDiasEnRango[i];
            if (promedio < minPromedio) {
                minPromedio = promedio;
                diaMenosMovido = diasSemana[i];
            }
        }
    });

    // Puntos de Venta (sin cambios)
    const ventasTiendaAgregado = (detallesVentasTienda || []).reduce((acc, item) => {
        const nombre = item.producto?.nombre || 'Producto Desconocido';
        if (!acc[nombre]) {
            acc[nombre] = { cantidad: 0, ingresos: 0 };
        }
        acc[nombre].cantidad += item.cantidad;
        acc[nombre].ingresos += Number(item.subtotal || 0);
        return acc;
    }, {});
    const topProductoCantidad = Object.entries(ventasTiendaAgregado).sort(([, a], [, b]) => b.cantidad - a.cantidad)[0] || ["N/A", { cantidad: 0 }];
    const topProductoIngresos = Object.entries(ventasTiendaAgregado).sort(([, a], [, b]) => b.ingresos - a.ingresos)[0] || ["N/A", { ingresos: 0 }];

    // ▼▼▼ CORRECCIÓN AQUÍ: Lógica mejorada para calcular KPIs de servicios ▼▼▼
    const totalIngresosServicios = (serviciosVendidos || []).reduce((sum, s) => sum + Number(s.precio_cobrado || 0), 0);
    const conteoServicios = (serviciosVendidos || []).reduce((acc, item) => {
        let nombreServicio;
        
        // Prioridad 1: Usar el nombre del servicio si está vinculado
        if (item.servicio && item.servicio.nombre) {
            nombreServicio = item.servicio.nombre;
        } 
        // Prioridad 2: Usar la descripción manual, pero ignorando los descuentos
        else if (item.descripcion_manual) {
            if (item.descripcion_manual.toLowerCase().includes('descuento')) {
                return acc; // No contamos los descuentos como un "servicio" para este KPI
            }
            nombreServicio = item.descripcion_manual;
        } 
        // Si no es ninguno de los anteriores, no lo contamos.
        else {
            return acc;
        }

        acc[nombreServicio] = (acc[nombreServicio] || 0) + item.cantidad;
        return acc;
    }, {});
    const servicioTop = Object.entries(conteoServicios).sort(([, a], [, b]) => b - a)[0] || ["N/A", 0];
    // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲

    return {
        revpar: totalNochesDisponibles > 0 ? totalIngresosHabitaciones / totalNochesDisponibles : 0,
        adr: totalNoches > 0 ? totalIngresosHabitaciones / totalNoches : 0,
        duracionPromedio: reservasValidas.length > 0 ? totalNoches / reservasValidas.length : 0,
        totalNochesVendidas: totalNoches,
        estanciasTotales: reservasValidas.length,
        tasaCancelacion: reservas.length > 0 ? (reservas.filter(r => ['cancelada', 'no_show'].includes(r.estado)).length / reservas.length) * 100 : 0,
        reservasCanceladas: reservas.filter(r => ['cancelada', 'no_show'].includes(r.estado)).length,
        reservasTotales: reservas.length,
        diasTop: diasSemana.filter((_, i) => demandaPorDia[i] === maxDemanda).join(', ') || "N/A",
        diaMenosMovido,
        mejorClienteNombre,
        mejorClienteIngresos,
        productoTiendaTopNombre: topProductoCantidad[0],
        productoTiendaTopCantidad: topProductoCantidad[1].cantidad,
        productoTiendaTopIngresosNombre: topProductoIngresos[0],
        productoTiendaTopIngresosMonto: topProductoIngresos[1].ingresos,
        servicioTopNombre: servicioTop[0],
        servicioTopCantidad: servicioTop[1],
        totalIngresosServicios,
        platoRestauranteTop: "N/A",
        platoRestauranteTopCantidad: 0
    };
}



/**
 * Genera el string HTML para el dashboard de KPIs.
 * @param {object} kpis - El objeto con todos los KPIs calculados.
 * @returns {string} El HTML final para ser renderizado.
 */
function renderKPIsHTML(kpis, fechaInicio, fechaFin) {
    const crearKpiCard = (titulo, valor, subtitulo = '', colorClase = 'text-gray-800', tooltipTexto = '') => {
        const tooltipHTML = tooltipTexto ? `<div class="kpi-tooltip-container"><span class="kpi-info-icon">i</span><div class="kpi-tooltip-content">${tooltipTexto}</div></div>` : '';
        return `<div class="kpi-card bg-white p-5 rounded-xl shadow-lg border border-gray-200 text-center relative">${tooltipHTML}<h5 class="font-semibold text-gray-600 mb-2">${titulo}</h5><p class="text-4xl font-bold ${colorClase}">${valor}</p>${subtitulo ? `<p class="text-sm text-gray-500 mt-1">${subtitulo}</p>` : ''}</div>`;
    };

    return `
        <style>.kpi-tooltip-container{position:absolute;top:12px;right:12px}.kpi-info-icon{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background-color:#cbd5e1;color:white;font-weight:bold;font-style:italic;font-family:serif;cursor:help;user-select:none;font-size:14px;line-height:20px}.kpi-tooltip-content{visibility:hidden;width:220px;background-color:#2d3748;color:#fff;text-align:center;border-radius:6px;padding:10px;font-size:12px;position:absolute;z-index:10;bottom:140%;left:50%;margin-left:-110px;opacity:0;transition:opacity .3s;pointer-events:none}.kpi-tooltip-content::after{content:"";position:absolute;top:100%;left:50%;margin-left:-5px;border-width:5px;border-style:solid;border-color:#2d3748 transparent transparent transparent}.kpi-tooltip-container:hover .kpi-tooltip-content{visibility:visible;opacity:1}</style>
        
        <h4 class="text-xl font-semibold mb-4 text-gray-800">KPIs de Rendimiento del Hotel</h4>
        <p class="text-sm text-gray-600 mb-6">Período analizado: ${formatDateLocal(fechaInicio, {dateStyle:'medium'})} - ${formatDateLocal(fechaFin, {dateStyle:'medium'})}</p>
        
        <h5 class="text-lg font-bold mb-3 text-indigo-700">Métricas de Rentabilidad y Ocupación</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            ${crearKpiCard('RevPAR', formatCurrencyLocal(kpis.revpar), 'Ingreso por Hab. Disponible', 'text-teal-600', 'El KPI más importante. Mide el ingreso generado por cada habitación disponible, ocupada o no.')}
            ${crearKpiCard('ADR', formatCurrencyLocal(kpis.adr), 'Tarifa Diaria Promedio', 'text-cyan-600', 'Precio promedio pagado por cada habitación ocupada.')}
            ${crearKpiCard('Duración Promedio', `${kpis.duracionPromedio.toFixed(1)} <span class="text-2xl">noches</span>`, '', 'text-indigo-600', 'Número promedio de noches que los huéspedes se quedan por reserva.')}
            ${crearKpiCard('Noches Vendidas', `${Math.round(kpis.totalNochesVendidas)}`, `En ${kpis.estanciasTotales} estancias`, 'text-blue-600', 'Suma total de todas las noches de todas las estancias válidas.')}
        </div>

        <h5 class="text-lg font-bold mb-3 text-indigo-700">Métricas de Demanda y Clientes</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
             ${crearKpiCard('Mejor Cliente', kpis.mejorClienteNombre, formatCurrencyLocal(kpis.mejorClienteIngresos), 'text-amber-500', 'El cliente que ha generado más ingresos a través de reservas en el período seleccionado.')}
            ${crearKpiCard('Día de Mayor Demanda', kpis.diasTop, 'Basado en día de check-in', 'text-purple-600', 'El día de la semana en que se inician más reservas.')}
            ${crearKpiCard('Día de Menor Ingreso', kpis.diaMenosMovido, 'Ideal para lanzar promociones', 'text-orange-500', 'El día de la semana que, en promedio, genera menos ingresos totales. Una oportunidad para ofertas.')}
            ${crearKpiCard('Tasa de Cancelación', `${kpis.tasaCancelacion.toFixed(1)}%`, `(${kpis.reservasCanceladas} de ${kpis.reservasTotales} reservas)`, 'text-red-500', 'Porcentaje de reservas que fueron canceladas o marcadas como no presentadas.')}
        </div>

        <h5 class="text-lg font-bold mb-3 text-indigo-700">Rendimiento de Puntos de Venta</h5>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            ${crearKpiCard('Top Producto (Cantidad)', kpis.productoTiendaTopNombre, `(${kpis.productoTiendaTopCantidad} unid.)`, 'text-sky-600', 'El artículo de la tienda con más unidades vendidas.')}
            ${crearKpiCard('Top Producto (Ingresos)', kpis.productoTiendaTopIngresosNombre, formatCurrencyLocal(kpis.productoTiendaTopIngresosMonto), 'text-green-600', 'El artículo de la tienda que generó más ingresos.')}
            ${crearKpiCard('Top Servicio Adicional', kpis.servicioTopNombre, `(${kpis.servicioTopCantidad} contrataciones)`, 'text-pink-600', 'El servicio adicional que ha sido vendido más veces.')}
            ${crearKpiCard('Ingresos por Servicios', formatCurrencyLocal(kpis.totalIngresosServicios), 'Total facturado en servicios extra', 'text-fuchsia-600', 'Suma de todos los ingresos generados por la venta de servicios adicionales.')}
        </div>
    `;
}

// =================================================================================
// ▲▲▲ FIN DEL BLOQUE PARA REEMPLAZAR ▲▲▲
// =================================================================================


// --- Función de impresión específica para el detalle del cierre de caja ---
async function imprimirDetalleCierreCaja(turnoData, movimientos, ingresosPorMetodo, egresosPorMetodo, montoApertura, balanceCalculado) {
    const hotelConfig = hotelConfigGlobal || {}; // Usar config global si está disponible
    const usuarioNombre = turnoData.usuarios?.nombre || turnoData.usuarios?.email || 'Usuario Desconocido';
    const fechaCierreStr = formatDateLocal(turnoData.fecha_cierre, { dateStyle: 'full', timeStyle: 'short' });
    const fechaAperturaStr = formatDateLocal(turnoData.fecha_apertura, { dateStyle: 'full', timeStyle: 'short' });

    // Estilos para la impresión (puedes ajustarlos según el tamaño de papel de tu POS)
    let estiloTicket = `
        body { 
            font-family: 'Arial', sans-serif; 
            margin: 0; 
            padding: 10px; 
            font-size: 10pt; /* Tamaño base para POS de 80mm, reduce para 58mm */
            color: #000; /* Texto negro para mejor legibilidad en impresión térmica */
            background-color: #fff; /* Fondo blanco */
        }
        .ticket-container { 
            width: 100%; 
            /* Para impresoras POS, el ancho se controla por el driver, pero podemos limitar para preview */
            /* max-width: 72mm; /* Para POS de 80mm (aprox) */
            /* max-width: 50mm; /* Para POS de 58mm (aprox) */
            max-width: 280px; /* Un ancho común para preview de POS */
            margin: auto; 
        }
        h3, h4, h5 { 
            margin: 8px 0 4px 0; 
            font-weight: bold;
        }
        h3 { 
            font-size: 1.2em; 
            text-align: center; 
            margin-bottom: 8px; 
        }
        h4 {
            font-size: 1.05em;
            margin-top: 12px;
            border-bottom: 1px dashed #555;
            padding-bottom: 3px;
        }
        p { 
            margin: 2px 0; 
            font-size: 0.95em; /* Ligeramente más pequeño para POS */
        }
        table { 
            width: 100%; 
            border-collapse: collapse; 
            font-size: 0.9em; 
            margin-top: 8px; 
            margin-bottom: 8px;
        }
        th, td { 
            border: none; /* Sin bordes para un look más limpio de POS */
            padding: 2px 1px; /* Padding reducido */
            text-align: left; 
            vertical-align: top;
        }
        th { 
            /* background-color: #f0f0f0; */ /* Omitir fondo en th para POS */
            border-bottom: 1px solid #555; /* Línea separadora para encabezados de tabla */
        }
        .text-right { text-align: right; }
        .text-bold { font-weight: bold; }
        .total-line p { 
            border-top: 1px solid #000; 
            margin-top: 6px; 
            padding-top: 6px; 
            font-size: 1.1em; /* Resaltar total */
            font-weight: bold;
        }
        .logo-container { text-align: center; margin-bottom: 8px; }
        .logo-container img { max-width: 150px; max-height: 40px; object-fit: contain; }
        .header-info p, .footer-info p { 
            text-align: center; 
            font-size: 0.85em; 
            margin: 1px 0; 
        }
        hr.dashed { 
            border: none; 
            border-top: 1px dashed #555; 
            margin: 8px 0; 
        }
        .item-list p { display: flex; justify-content: space-between; }
        .item-list p span:last-child { font-weight: bold; }

        /* Estilos específicos para impresión (ocultar UI, etc.) */
        @media print {
            body { margin: 0; padding: 0; /* Resetear márgenes para impresión */ }
            .no-print { display: none !important; }
            @page { margin: 5mm; /* Márgenes de la página al imprimir */ }
        }
    `;

    let htmlTicket = `
        <div class="ticket-container">
            ${(hotelConfig.mostrar_logo !== false && hotelConfig.logo_url) ? `<div class="logo-container"><img src="${hotelConfig.logo_url}" alt="Logo"></div>` : ''}
            <div class="header-info">
                <p class="text-bold">${hotelConfig.nombre_hotel || 'Hotel'}</p>
                ${hotelConfig.direccion_fiscal ? `<p>${hotelConfig.direccion_fiscal}</p>` : ''}
                ${hotelConfig.nit_rut ? `<p>NIT/RUT: ${hotelConfig.nit_rut}</p>` : ''}
                ${hotelConfig.telefono_fiscal ? `<p>Tel: ${hotelConfig.telefono_fiscal}</p>` : ''}
            </div>
            <hr class="dashed">
            <h3>Detalle de Cierre de Caja</h3>
            <p><strong>Usuario:</strong> ${usuarioNombre}</p>
            <p><strong>Apertura Turno:</strong> ${fechaAperturaStr}</p>
            <p><strong>Cierre Turno:</strong> ${fechaCierreStr}</p>
            <p><strong>ID Turno:</strong> ${turnoData.id.slice(0, 12)}...</p>
            <hr class="dashed">
            
            <h4>Resumen del Turno:</h4>
            <div class="item-list">
                <p><span>Ingresos Totales (incl. apertura):</span> <span>${formatCurrencyLocal(ingresosPorMetodo.totalIngresos)}</span></p>
                ${montoApertura > 0 ? `<p><em><span>Monto de Apertura:</span> <span>${formatCurrencyLocal(montoApertura)}</span></em></p>` : ''}
                <p><span>Egresos Totales:</span> <span>${formatCurrencyLocal(egresosPorMetodo.totalEgresos)}</span></p>
            </div>
            <div class="total-line">
                 <p><span>Balance del Turno:</span> <span>${formatCurrencyLocal(balanceCalculado)}</span></p>
            </div>
            <hr class="dashed">
            
            <h4>Ingresos por Método de Pago:</h4>
            <div class="item-list">
            ${Object.keys(ingresosPorMetodo.detalles).length > 0 
                ? Object.entries(ingresosPorMetodo.detalles).map(([metodo, total]) => `<p><span>${metodo}:</span> <span>${formatCurrencyLocal(total)}</span></p>`).join('') 
                : '<p><em>Sin ingresos detallados.</em></p>'}
            </div>
            <hr class="dashed">

            <h4>Egresos por Método de Pago:</h4>
            <div class="item-list">
            ${Object.keys(egresosPorMetodo.detalles).length > 0 
                ? Object.entries(egresosPorMetodo.detalles).map(([metodo, total]) => `<p><span>${metodo}:</span> <span>${formatCurrencyLocal(total)}</span></p>`).join('') 
                : '<p><em>Sin egresos.</em></p>'}
            </div>
            <hr class="dashed">

            <h4>Detalle de Movimientos:</h4>
            <table>
                <thead>
                    <tr>
                        <th>Fecha</th>
                        <th>Concepto</th>
                        <th class="text-right">Monto</th>
                    </tr>
                </thead>
                <tbody>
                    ${(movimientos && movimientos.length > 0) ? movimientos.map(mv => `
                        <tr>
                            <td>${formatDateLocal(mv.creado_en, {day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</td>
                            <td>${mv.concepto || (mv.tipo === 'apertura' ? 'Monto Apertura' : 'N/A')} ${mv.metodos_pago?.nombre ? `(${mv.metodos_pago.nombre})` : ''}</td>
                            <td class="text-right ${mv.tipo === 'ingreso' || mv.tipo === 'apertura' ? '' : 'text-red-600'}">${formatCurrencyLocal(mv.monto)}</td>
                        </tr>`).join('') 
                        : '<tr><td colspan="3" style="text-align:center;">No hay movimientos.</td></tr>'
                    }
                </tbody>
            </table>
            ${hotelConfig.pie_ticket ? `<hr class="dashed"><div class="footer-info"><p>${hotelConfig.pie_ticket}</p></div>` : ''}
            <div class="footer-info" style="margin-top: 10px;"><p>Reporte generado: ${formatDateLocal(new Date(), {dateStyle:'medium', timeStyle:'short'})}</p></div>
        </div>
    `;

    const ventanaImpresion = window.open('', '_blank', 'width=320,height=600,scrollbars=yes,resizable=yes');
    if (ventanaImpresion) {
        ventanaImpresion.document.write(`<html><head><title>Detalle Cierre Caja - Turno ${turnoData.id.slice(0,8)}</title><style>${estiloTicket}</style></head><body>${htmlTicket}</body></html>`);
        ventanaImpresion.document.close();
        ventanaImpresion.focus();
        setTimeout(() => {
            ventanaImpresion.print();
            // ventanaImpresion.close(); // Descomentar si quieres que se cierre automáticamente después de imprimir
        }, 500); // Delay para asegurar que el contenido se cargue antes de imprimir
    } else {
        alert("No se pudo abrir la ventana de impresión. Revise la configuración de bloqueo de ventanas emergentes de su navegador.");
    }
}


function mostrarModalUpgrade(tipoReporte) {
  const reportesLabels = {
    'movimientos_financieros_global': 'Resumen Financiero Global',
    'detalle_ingresos_categoria': 'Detalle de Ingresos por Categoría',
    'detalle_egresos_categoria': 'Detalle de Egresos por Categoría',
    'cierres_de_caja': 'Historial de Cierres de Caja',
    'kpis_avanzados': 'KPIs y Gráficos Avanzados',
    // Puedes agregar más si quieres
  };
  Swal.fire({
    icon: 'info',
    title: '¡Disponible solo en planes superiores!',
    html: `
      <div style="text-align:left;">
        <b>El reporte <span style="color:#4f46e5;">${reportesLabels[tipoReporte] || tipoReporte}</span> es exclusivo de los planes <span style="color:#059669;">PRO</span> y <span style="color:#b45309;">MAX</span>.</b>
        <ul style="font-size:1em;margin:14px 0 6px 0;">
          <li style="margin-bottom:3px;">✅ Más métricas y KPIs clave</li>
          <li style="margin-bottom:3px;">✅ Comparativas avanzadas y exportaciones</li>
          <li style="margin-bottom:3px;">✅ ¡Desbloquea el verdadero potencial de tu hotel!</li>
        </ul>
        <div class="d-flex justify-content-center mt-4">
         <button id="btn-mejorar-plan" class="btn btn-success btn-lg px-5 py-2 mt-3">
  <i class="bi bi-stars me-2"></i> ¡Mejorar mi plan!
</button>

        </div>
      </div>
    `,
    showConfirmButton: true,
    confirmButtonText: 'Cerrar'
  });

  // Activa navegación interna al módulo Mi cuenta
  setTimeout(() => {
    const btn = document.getElementById('btn-mejorar-plan');
    if (btn) {
      btn.onclick = () => {
        // Navega al módulo Mi Cuenta con router interno
        window.location.hash = '#/micuenta';
        Swal.close();
      };
    }
  }, 50);
}


// --- Mount / Unmount ---
// --- COPIA Y PEGA ESTA FUNCIÓN "mount" COMPLETA REEMPLAZANDO LA ANTERIOR ---

export async function mount(container, sbInstance, user) {
  unmount(container); 
  supabaseClient = sbInstance; 
  currentModuleUser = user;
  
  container.innerHTML = `
    <div class="card reportes-module shadow-lg rounded-lg bg-gray-50/50">
      <div class="card-header bg-gradient-to-r from-indigo-600 to-purple-600 p-4 border-b border-gray-200 rounded-t-lg">
        <h2 class="text-2xl font-semibold text-white">Generador de Reportes Avanzado</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="reportes-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height:24px;display:none;"></div>
        <div class="reportes-controles mb-6 p-4 border border-gray-200 rounded-lg bg-white shadow-md">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
            <div class="form-group md:col-span-2 lg:col-span-1">
              <label for="reporte-tipo-select" class="block text-sm font-medium text-gray-700 mb-1">Tipo de Reporte:</label>
              <select id="reporte-tipo-select" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2 px-3">
                <option value="">-- Elija un reporte --</option>
                <option value="listado_reservas">Listado de Reservas</option>
                <option value="ocupacion">Porcentaje de Ocupación</option>
                <option value="ingresos_por_habitaciones_periodo">Ingresos por Habitaciones (Caja)</option>
                <option value="movimientos_financieros_global">Resumen Financiero Global</option>
                <option value="detalle_ingresos_categoria">Detalle de Ingresos por Categoría</option>
                <option value="detalle_egresos_categoria">Detalle de Egresos por Categoría</option>
                <option value="cierres_de_caja">Historial de Cierres de Caja</option> </select>
            </div>
            <div class="form-group lg:col-span-1"><label for="reporte-fecha-inicio" class="block text-sm font-medium text-gray-700 mb-1">Desde:</label><input type="date" id="reporte-fecha-inicio" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2 px-3"></div>
            <div class="form-group lg:col-span-1"><label for="reporte-fecha-fin" class="block text-sm font-medium text-gray-700 mb-1">Hasta:</label><input type="date" id="reporte-fecha-fin" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2 px-3"></div>
            <div class="form-group lg:col-span-1">
              <label for="reporte-agrupacion-periodo" class="block text-sm font-medium text-gray-700 mb-1">Agrupar por:</label>
              <select id="reporte-agrupacion-periodo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm py-2 px-3">
                <option value="diario">Diario</option><option value="mensual" selected>Mensual</option><option value="bimestral">Bimestral</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option>
              </select>
            </div>
            <div class="form-group lg:col-span-1 self-end"><button id="btn-generar-reporte" class="button button-primary w-full py-2.5 px-4 rounded-md text-sm font-medium hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition ease-in-out duration-150">Generar Reporte</button></div>
          </div>
        </div>
        <div id="reportes-loading" class="loading-indicator text-center py-4 text-indigo-600 font-medium" style="display:none;"></div>
        <div id="reporte-resultado-container" class="mt-4 min-h-[200px] bg-white p-1 md:p-4 rounded-lg shadow-lg border border-gray-200">
          <p class="text-gray-500 text-center p-4">Seleccione un tipo de reporte y configure los filtros para ver los datos.</p>
        </div>
      </div>
    </div>`;

  const tipoSelectEl = container.querySelector('#reporte-tipo-select');
  const fechaInicioEl = container.querySelector('#reporte-fecha-inicio');
  const fechaFinEl = container.querySelector('#reporte-fecha-fin');
  const agrupacionPeriodoEl = container.querySelector('#reporte-agrupacion-periodo');
  const btnGenerarEl = container.querySelector('#btn-generar-reporte');
  const feedbackEl = container.querySelector('#reportes-feedback');
  const loadingEl = container.querySelector('#reportes-loading');
  const resultadoContainerEl = container.querySelector('#reporte-resultado-container');

  const today = new Date(); 
  const thirtyDaysAgo = new Date(); 
  thirtyDaysAgo.setDate(today.getDate() - 30);
  fechaInicioEl.value = thirtyDaysAgo.toISOString().split('T')[0];
  fechaFinEl.value = today.toISOString().split('T')[0];

  let planActivo = 'lite'; // Valor por defecto

  try {
    // 1. OBTENER EL HOTEL ID DEL USUARIO
    let hotelIdTemporal = user?.user_metadata?.hotel_id;
    if (!hotelIdTemporal && user?.id) {
        const { data: perfil, error: perfilError } = await supabaseClient
            .from('usuarios')
            .select('hotel_id')
            .eq('id', user.id)
            .single();
        if (perfilError) throw new Error(`No se pudo obtener el perfil del usuario: ${perfilError.message}`);
        hotelIdTemporal = perfil.hotel_id;
    }

    if (!hotelIdTemporal) {
        throw new Error('Error crítico: Hotel no identificado para el usuario.');
    }
    currentHotelId = hotelIdTemporal;

    // 2. OBTENER EL PLAN DESDE LA TABLA 'hoteles' USANDO EL HOTEL ID
    const { data: hotelData, error: hotelError } = await supabaseClient
        .from('hoteles')
        .select('plan')
        .eq('id', currentHotelId)
        .single();
    
    if (hotelError) throw new Error(`No se pudo obtener la información del plan del hotel: ${hotelError.message}`);
    
    // 3. ESTABLECER EL PLAN ACTIVO
    planActivo = (hotelData?.plan || 'lite').toLowerCase();
    console.log(`Plan del hotel ${currentHotelId} es: ${planActivo}`);

  } catch (err) {
      console.error("Error al inicializar el módulo de reportes:", err);
      showReportesFeedback(feedbackEl, err.message, 'error-indicator', 0);
      if (btnGenerarEl) btnGenerarEl.disabled = true;
      [tipoSelectEl, fechaInicioEl, fechaFinEl, agrupacionPeriodoEl].forEach(el => { if(el) el.disabled = true; });
      return;
  }

  // --- El resto del código continúa usando el 'planActivo' correcto ---
  
  renderSelectorReportes(planActivo);
  
  tipoSelectEl.addEventListener('change', function() {
    const reporteSeleccionado = this.value;
    const tiposDisponibles = REPORTES_POR_PLAN[planActivo] || REPORTES_POR_PLAN['lite'];
    if (!tiposDisponibles.includes(reporteSeleccionado) && reporteSeleccionado !== "") {
      mostrarModalUpgrade(reporteSeleccionado);
      this.value = "";
      return;
    }
  });

  if (!window.Chart) {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    script.async = true;
    script.onload = () => console.log('Chart.js loaded for reports.');
    script.onerror = () => { console.error('Failed to load Chart.js'); showReportesFeedback(feedbackEl, 'Error al cargar librería de gráficos.', 'error-indicator', 5000);};
    document.head.appendChild(script);
    moduleListeners.push({ element: script, type: 'remove-on-unmount' });
  }

  const handleTipoReporteChange = () => {
      const tipoReporte = tipoSelectEl.value;
      const reportsRequiringAgrupacion = ['movimientos_financieros_global', 'detalle_ingresos_categoria', 'detalle_egresos_categoria'];
      const isAgrupacionRelevant = reportsRequiringAgrupacion.includes(tipoReporte);
      agrupacionPeriodoEl.disabled = !isAgrupacionRelevant;
      agrupacionPeriodoEl.parentElement.style.display = isAgrupacionRelevant ? 'block' : 'none';
  };
  tipoSelectEl.addEventListener('change', handleTipoReporteChange);
  moduleListeners.push({ element: tipoSelectEl, type: 'change', handler: handleTipoReporteChange });
  handleTipoReporteChange();

  const handleGenerateClick = async () => {
    const tipoReporte = tipoSelectEl.value;
    const fechaInicio = fechaInicioEl.value;
    const fechaFin = fechaFinEl.value;
    const agrupacion = agrupacionPeriodoEl.value;

    if (!tipoReporte) { showReportesFeedback(feedbackEl, 'Seleccione un tipo de reporte.', 'error-indicator', 3000); return; }
    if (!fechaInicio || !fechaFin) { showReportesFeedback(feedbackEl, 'Seleccione un rango de fechas.', 'error-indicator', 3000); return; }
    if (new Date(fechaInicio) > new Date(fechaFin)) { showReportesFeedback(feedbackEl, 'Fecha "Desde" no puede ser posterior a "Hasta".', 'error-indicator', 3000); return; }
    
    const reportsRequiringAgrupacion = ['movimientos_financieros_global', 'detalle_ingresos_categoria', 'detalle_egresos_categoria'];
    if (reportsRequiringAgrupacion.includes(tipoReporte) && !agrupacion) {
        showReportesFeedback(feedbackEl, 'Seleccione un período de agrupación.', 'error-indicator', 3000); return;
    }
    
    showReportesLoading(loadingEl, btnGenerarEl, true, 'Generando reporte, un momento...');
    clearReportesFeedback(feedbackEl);
    limpiarAreaResultados(resultadoContainerEl); 

    try {
      if (tipoReporte === 'listado_reservas') await generarReporteListadoReservas(resultadoContainerEl, fechaInicio, fechaFin);
      else if (tipoReporte === 'ocupacion') await generarReporteOcupacion(resultadoContainerEl, fechaInicio, fechaFin);
      else if (tipoReporte === 'ingresos_por_habitaciones_periodo') await generarReporteIngresosPorPeriodo(resultadoContainerEl, fechaInicio, fechaFin);
      else if (tipoReporte === 'cierres_de_caja') await generarReporteCierresDeCaja(resultadoContainerEl, fechaInicio, fechaFin);
      else if (tipoReporte === 'kpis_avanzados_hotel') await generarReporteKPIsAvanzados(resultadoContainerEl, fechaInicio, fechaFin);
      else if (reportsRequiringAgrupacion.includes(tipoReporte)) await generarReporteFinancieroGlobal(resultadoContainerEl, fechaInicio, fechaFin, agrupacion, tipoReporte);
      else {
        showReportesFeedback(feedbackEl, 'Tipo de reporte no implementado.', 'info-indicator', 3000);
        resultadoContainerEl.innerHTML = `<p class="text-gray-500 text-center p-4">El tipo de reporte '${tipoReporte}' no está disponible.</p>`;
      }
      await registrarEnBitacora(supabaseClient, currentHotelId, currentModuleUser.id, 'Reportes', `Generación reporte: ${tipoReporte}`, { fechaInicio, fechaFin, agrupacion: agrupacionPeriodoEl.disabled ? 'N/A' : agrupacion });
    } catch (err) {
        console.error("Error in handleGenerateClick:", err);
        showReportesFeedback(feedbackEl, `Error al generar reporte: ${err.message}`, 'error-indicator', 0);
        resultadoContainerEl.innerHTML = `<p class="error-indicator text-center p-4 text-red-600 bg-red-50 rounded-md">Error inesperado. Revise consola.</p>`;
        await registrarEnBitacora(supabaseClient, currentHotelId, currentModuleUser.id, 'Reportes', `Error reporte: ${tipoReporte}`, { error: err.message, fechaInicio, fechaFin, agrupacion: agrupacionPeriodoEl.disabled ? 'N/A' : agrupacion });
    } finally {
        showReportesLoading(loadingEl, btnGenerarEl, false);
    }
  };
  
  btnGenerarEl.addEventListener('click', handleGenerateClick);
  moduleListeners.push({ element: btnGenerarEl, type: 'click', handler: handleGenerateClick });
}
export function unmount(container) {
  Object.keys(currentChartInstances).forEach(destroyChartInstance);
  currentChartInstances = {};

  moduleListeners.forEach(({ element, type, handler }) => {
    if (type === 'remove-on-unmount' && element && element.parentNode) {
        // For scripts specifically
        // element.parentNode.removeChild(element); // Be cautious with this, ensure it's what you want.
    } else if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentHotelId = null; currentModuleUser = null; supabaseClient = null; 

  // Remove any dynamically created modals that might persist
  const modals = document.querySelectorAll('div[id^="modal-detalle-cierre-"]');
  modals.forEach(modal => modal.remove());

  if (container) { // Check if container exists before trying to query its children
      const feedbackEl = container.querySelector('#reportes-feedback');
      if (feedbackEl) clearReportesFeedback(feedbackEl);
      const resultadoContainerEl = container.querySelector('#reporte-resultado-container');
      if(resultadoContainerEl) resultadoContainerEl.innerHTML = '<p class="text-gray-500 text-center p-4">Módulo de reportes desmontado.</p>';
  }
}