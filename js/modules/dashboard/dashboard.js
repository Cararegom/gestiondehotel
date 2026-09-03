// js/modules/dashboard/dashboard.js
import { showAppFeedback, clearAppFeedback, formatCurrency } from '../../uiUtils.js';
import { escapeHtml } from '../../security.js';
import { getReservaToleranceStatus } from '../reservas/reservas-operacion.js';
import {
  addCalendarDays,
  formatInTimeZone,
  getRuntimeHotelTimeZone,
  getTodayInTimeZone,
  getUtcRangeForHotelDates
} from '../../services/hotelTimeZoneService.js';

let chartRevenueInstance = null;
let chartOcupacionInstance = null;
let moduleDashboardListeners = [];
let dashboardLastUpdatedAt = null;
let dashboardIsRefreshing = false;
let currentContainerGlobal = null;
let currentSupabaseInstanceGlobal = null;
let currentHotelIdGlobal = null;
let isMounted = false;

function hotelTimeZone() {
  return getRuntimeHotelTimeZone();
}

function formatHotelDateTime(value, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  return formatInTimeZone(value, hotelTimeZone(), 'es-CO', options);
}

function formatDashboardTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Sin sincronizar';
  return `Ultima actualizacion: ${formatInTimeZone(date, hotelTimeZone(), 'es-CO', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })}`;
}

function updateRefreshControls(containerEl) {
  if (!containerEl || !isMounted) return;
  const refreshButton = containerEl.querySelector('#dashboard-refresh-btn');
  const statusLabel = containerEl.querySelector('#dashboard-last-updated');
  if (refreshButton) {
    refreshButton.disabled = dashboardIsRefreshing;
    refreshButton.textContent = dashboardIsRefreshing ? 'Actualizando...' : 'Actualizar';
    refreshButton.classList.toggle('opacity-70', dashboardIsRefreshing);
    refreshButton.classList.toggle('cursor-not-allowed', dashboardIsRefreshing);
  }
  if (statusLabel) {
    statusLabel.textContent = dashboardIsRefreshing
      ? 'Actualizando datos...'
      : formatDashboardTimestamp(dashboardLastUpdatedAt);
  }
}

function getScheduleMeta(item, type) {
  const fechaBase = type === 'check-in' ? item?.fecha_inicio : item?.fecha_fin;
  const eventDate = fechaBase ? new Date(fechaBase) : null;
  const diffMs = eventDate ? eventDate.getTime() - Date.now() : null;
  const diffMinutes = diffMs == null ? null : Math.round(diffMs / 60000);

  if (diffMinutes == null || Number.isNaN(diffMinutes)) {
    return {
      timeLabel: 'Sin hora',
      statusLabel: 'Sin programacion',
      cardClass: 'border-slate-200 bg-slate-50',
      badgeClass: 'bg-slate-100 text-slate-700',
      helperText: 'No hay hora registrada para este movimiento.'
    };
  }
  if (diffMinutes < 0) {
    return {
      timeLabel: `${Math.abs(diffMinutes)} min tarde`,
      statusLabel: type === 'check-in' ? 'Check-in vencido' : 'Checkout vencido',
      cardClass: 'border-red-200 bg-red-50/80',
      badgeClass: 'bg-red-100 text-red-700',
      helperText: type === 'check-in'
        ? 'Esta llegada ya deberia haberse atendido.'
        : 'Esta salida ya deberia haberse cerrado.'
    };
  }
  if (diffMinutes <= 120) {
    return {
      timeLabel: `${diffMinutes} min`,
      statusLabel: 'Prioridad alta',
      cardClass: 'border-amber-200 bg-amber-50/80',
      badgeClass: 'bg-amber-100 text-amber-700',
      helperText: type === 'check-in'
        ? 'Llega pronto. Conviene preparar la recepcion.'
        : 'Sale pronto. Conviene revisar saldo y habitacion.'
    };
  }
  return {
    timeLabel: formatHotelDateTime(eventDate, { hour: 'numeric', minute: '2-digit', hour12: true }),
    statusLabel: 'En seguimiento',
    cardClass: 'border-slate-200 bg-white',
    badgeClass: 'bg-blue-50 text-blue-700',
    helperText: type === 'check-in' ? 'Movimiento programado para hoy.' : 'Salida programada dentro del dia.'
  };
}

function updateCardContent(containerEl, cardId, value, comparisonValue = null, isCurrency = false, isLoading = false, customText = null) {
  if (!containerEl || !isMounted) return;
  const cardDiv = containerEl.querySelector(`#${cardId}`);
  const valueEl = cardDiv?.querySelector('.dashboard-metric-value');
  const comparisonEl = cardDiv?.querySelector('.dashboard-metric-comparison');
  if (!valueEl || !comparisonEl) return;

  if (isLoading) {
    valueEl.innerHTML = '<span class="text-2xl text-gray-400 animate-pulse">Cargando...</span>';
    comparisonEl.textContent = '';
    return;
  }

  const numericValue = Number(value || 0);
  valueEl.textContent = customText || (isCurrency ? formatCurrency(numericValue) : String(numericValue));

  if (comparisonValue == null || customText) {
    comparisonEl.textContent = customText ? 'Actual' : (isCurrency ? 'Hoy' : 'Actual');
    comparisonEl.className = 'dashboard-metric-comparison mt-2 text-xs text-slate-400';
    return;
  }

  const previous = Number(comparisonValue || 0);
  const change = numericValue - previous;
  const percent = previous !== 0 ? (change / previous) * 100 : (numericValue > 0 ? 100 : 0);
  comparisonEl.textContent = `${change > 0 ? '+ ' : change < 0 ? '- ' : '= '}${Math.abs(percent).toFixed(0)}% vs ayer`;
  comparisonEl.className = `dashboard-metric-comparison mt-2 text-xs ${change > 0 ? 'text-green-500' : change < 0 ? 'text-red-500' : 'text-slate-400'}`;
}

function renderPriorityStrip(containerEl, kpis, checkins, checkouts) {
  const strip = containerEl?.querySelector('#dashboard-priority-strip');
  if (!strip || !isMounted) return;
  const now = Date.now();
  const safeCheckins = Array.isArray(checkins) ? checkins : [];
  const safeCheckouts = Array.isArray(checkouts) ? checkouts : [];
  const upcomingCheckins = safeCheckins.filter((item) => {
    const diff = new Date(item.fecha_inicio).getTime() - now;
    return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
  }).length;
  const upcomingCheckouts = safeCheckouts.filter((item) => {
    const diff = new Date(item.fecha_fin).getTime() - now;
    return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
  }).length;
  const overdueCheckouts = safeCheckouts.filter((item) => new Date(item.fecha_fin).getTime() < now).length;
  const ocupadas = Number(kpis?.habitaciones_ocupadas_ahora || 0);
  const total = Number(kpis?.habitaciones_activas_total || 0);
  const ocupacion = total > 0 ? Math.round((ocupadas / total) * 100) : 0;

  const cards = [
    ['Llegadas proximas', upcomingCheckins, upcomingCheckins ? 'En las proximas 2 horas' : 'Sin llegadas criticas ahora'],
    ['Salidas proximas', upcomingCheckouts, upcomingCheckouts ? 'Revisa saldo y checkout' : 'Sin salidas urgentes ahora'],
    ['Salidas vencidas', overdueCheckouts, overdueCheckouts ? 'Necesitan atencion inmediata' : 'Todo al dia'],
    ['Ocupacion actual', `${ocupacion}%`, `${ocupadas}/${total} habitaciones ocupadas`]
  ];

  strip.innerHTML = cards.map(([label, value, helper]) => `
    <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">${escapeHtml(String(label))}</p>
      <p class="mt-2 text-3xl font-black text-slate-800">${escapeHtml(String(value))}</p>
      <p class="mt-2 text-sm text-slate-500">${escapeHtml(String(helper))}</p>
    </article>
  `).join('');
}

function renderOperationalAlerts(containerEl, alerts = []) {
  const board = containerEl?.querySelector('#dashboard-alerts-board');
  if (!board || !isMounted) return;
  if (!alerts.length) {
    board.innerHTML = '<div class="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><b>Operacion al dia.</b> Sin alertas criticas por ahora.</div>';
    return;
  }
  board.innerHTML = `<div class="grid grid-cols-1 gap-3 xl:grid-cols-2">${alerts.map((alert) => `
    <article class="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${escapeHtml(alert.category || 'Alerta')}</p>
          <h3 class="mt-1 font-bold text-slate-900">${escapeHtml(alert.title || 'Seguimiento operativo')}</h3>
        </div>
        ${alert.count != null ? `<span class="rounded-full bg-white px-3 py-1 text-sm font-black text-slate-800">${escapeHtml(String(alert.count))}</span>` : ''}
      </div>
      <p class="mt-2 text-sm text-slate-600">${escapeHtml(alert.message || '')}</p>
      ${(alert.context || []).length ? `<div class="mt-3 flex flex-wrap gap-2">${alert.context.map((item) => `<span class="rounded-full bg-white px-2 py-1 text-xs text-slate-600">${escapeHtml(item)}</span>`).join('')}</div>` : ''}
      ${alert.route ? `<button type="button" class="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700" data-navegar="${escapeHtml(alert.route)}">${escapeHtml(alert.cta || 'Abrir modulo')}</button>` : ''}
    </article>
  `).join('')}</div>`;
}

async function loadOperationalAlerts(hotelId, supabaseInstance) {
  const now = new Date();
  const zone = hotelTimeZone();
  const todayKey = getTodayInTimeZone(zone, now);
  const { endExclusiveIso } = getUtcRangeForHotelDates(todayKey, todayKey, zone);
  const alerts = [];

  const [
    { data: config },
    { data: reservasPendientes },
    { data: reservasActivas },
    { data: tareasAbiertas },
    { data: habitacionesLimpieza },
    { data: waitlistPendiente },
    { data: inspeccionesRecientes }
  ] = await Promise.all([
    supabaseInstance.from('configuracion_hotel')
      .select('minutos_tolerancia_llegada, minutos_alerta_reserva, minutos_alerta_checkout')
      .eq('hotel_id', hotelId).maybeSingle(),
    supabaseInstance.from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId).in('estado', ['reservada', 'confirmada']).lt('fecha_inicio', endExclusiveIso),
    supabaseInstance.from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId).in('estado', ['activa', 'ocupada', 'tiempo agotado']).lt('fecha_fin', endExclusiveIso),
    supabaseInstance.from('tareas_mantenimiento')
      .select('id, titulo, estado, tipo, frecuencia, fecha_programada, habitaciones(nombre)')
      .eq('hotel_id', hotelId).in('estado', ['pendiente', 'en_progreso']).order('fecha_programada', { ascending: true }),
    supabaseInstance.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).eq('estado', 'limpieza'),
    supabaseInstance.from('lista_espera_reservas')
      .select('id, cliente_nombre, fecha_inicio, prioridad').eq('hotel_id', hotelId).eq('estado', 'pendiente')
      .order('fecha_inicio', { ascending: true }).limit(8),
    supabaseInstance.from('inspecciones_limpieza')
      .select('id, puntaje, creado_en, habitaciones(nombre)').eq('hotel_id', hotelId).lte('puntaje', 3)
      .order('creado_en', { ascending: false }).limit(5)
  ]);

  const toleranceConfig = {
    minutos_tolerancia_llegada: Number(config?.minutos_tolerancia_llegada) || 60,
    minutos_alerta_reserva: Number(config?.minutos_alerta_reserva) || 120,
    minutos_alerta_checkout: Number(config?.minutos_alerta_checkout) || 30
  };

  const noShowSuggested = (reservasPendientes || []).filter((reserva) => (
    getReservaToleranceStatus(reserva, toleranceConfig, now).level === 'no_show_sugerido'
  ));
  if (noShowSuggested.length) alerts.push({
    category: 'Reservas', title: 'Reservas con no-show sugerido', count: noShowSuggested.length,
    message: 'Estas reservas ya superaron la tolerancia de llegada y conviene revisarlas.',
    context: noShowSuggested.slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Hab.'}`),
    route: '#/reservas', cta: 'Revisar reservas'
  });

  const lateCheckouts = (reservasActivas || []).filter((reserva) => {
    const checkout = reserva?.fecha_fin ? new Date(reserva.fecha_fin) : null;
    return checkout && !Number.isNaN(checkout.getTime())
      && Math.round((now.getTime() - checkout.getTime()) / 60000) > toleranceConfig.minutos_alerta_checkout;
  });
  if (lateCheckouts.length) alerts.push({
    category: 'Check-out', title: 'Salidas vencidas con seguimiento', count: lateCheckouts.length,
    message: 'Hay habitaciones que ya superaron la tolerancia del checkout.',
    context: lateCheckouts.slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Hab.'}`),
    route: '#/mapa-habitaciones', cta: 'Abrir mapa hotel'
  });

  const preventivas = (tareasAbiertas || []).filter((tarea) => String(tarea.frecuencia || 'unica') !== 'unica');
  if (preventivas.length) alerts.push({
    category: 'Mantenimiento', title: 'Preventivos abiertos por programar o cerrar', count: preventivas.length,
    message: 'El plan preventivo tiene tareas abiertas que requieren seguimiento.',
    context: preventivas.slice(0, 3).map((item) => `${item.titulo || 'Preventivo'} · ${item.habitaciones?.nombre || 'General'}`),
    route: '#/mantenimiento', cta: 'Ir a mantenimiento'
  });
  if ((habitacionesLimpieza || []).length) alerts.push({
    category: 'Limpieza', title: 'Habitaciones pendientes de limpieza', count: habitacionesLimpieza.length,
    message: 'Estas habitaciones siguen en limpieza y aún no vuelven a disponibilidad.',
    context: habitacionesLimpieza.slice(0, 4).map((item) => item.nombre || 'Habitacion'),
    route: '#/limpieza', cta: 'Revisar limpieza'
  });
  if ((waitlistPendiente || []).length) alerts.push({
    category: 'Lista de espera', title: 'Clientes esperando habitacion', count: waitlistPendiente.length,
    message: 'Hay clientes en lista de espera que requieren seguimiento.',
    context: waitlistPendiente.slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · Prioridad ${item.prioridad || 1}`),
    route: '#/reservas', cta: 'Abrir reservas'
  });
  if ((inspeccionesRecientes || []).length) alerts.push({
    category: 'Inspeccion', title: 'Limpiezas con observaciones recientes', count: inspeccionesRecientes.length,
    message: 'Las ultimas inspecciones registraron puntajes bajos.',
    context: inspeccionesRecientes.slice(0, 3).map((item) => `${item.habitaciones?.nombre || 'Habitacion'} · Puntaje ${item.puntaje}/5`),
    route: '#/limpieza', cta: 'Ver limpieza'
  });
  return alerts.slice(0, 6);
}

function renderChecklist(containerEl, listId, items, type) {
  const listEl = containerEl?.querySelector(`#${listId}`);
  if (!listEl || !isMounted) return;
  if (!items?.length) {
    listEl.innerHTML = `<li class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No hay ${type === 'check-in' ? 'llegadas programadas' : 'salidas programadas'} para hoy.</li>`;
    return;
  }
  listEl.innerHTML = items.map((item) => {
    const fecha = type === 'check-in' ? item.fecha_inicio : item.fecha_fin;
    const habitacion = item.habitacion_nombre || item.habitaciones_nombre || item.habitaciones?.nombre || 'N/A';
    const meta = getScheduleMeta(item, type);
    return `<li class="rounded-2xl border p-4 shadow-sm ${meta.cardClass}">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <span class="rounded-full px-2 py-1 text-[10px] font-bold uppercase ${meta.badgeClass}">${type === 'check-in' ? 'Check-in' : 'Check-out'}</span>
          <p class="mt-3 truncate font-bold text-slate-800">${escapeHtml(item.cliente_nombre || 'Cliente')}</p>
          <p class="mt-1 text-sm text-slate-500">Hab. ${escapeHtml(String(habitacion))} · ${escapeHtml(formatHotelDateTime(fecha))}</p>
        </div>
        <div class="text-right"><p class="text-sm font-black text-slate-700">${escapeHtml(meta.timeLabel)}</p><p class="mt-1 text-[11px] uppercase text-slate-400">${escapeHtml(meta.statusLabel)}</p></div>
      </div>
    </li>`;
  }).join('');
}

async function fetchChartData(hotelId, supabaseInstance, numDays = 7) {
  const validNumDays = Number.isFinite(numDays) && numDays > 0 ? Math.floor(numDays) : 7;
  const zone = hotelTimeZone();
  const todayKey = getTodayInTimeZone(zone);
  const labels = Array.from({ length: validNumDays }, (_, index) => (
    addCalendarDays(todayKey, index - (validNumDays - 1))
  ));
  const dailyRevenueData = Array(validNumDays).fill(0);
  const dailyOcupacionData = Array(validNumDays).fill(0);
  const labelIndexMap = new Map(labels.map((label, index) => [label, index]));
  const { startIso, endExclusiveIso } = getUtcRangeForHotelDates(labels[0], labels[labels.length - 1], zone);

  const [
    { count: totalHabitacionesActivas, error: errTotalHab },
    { data: revenueRows, error: revenueError },
    { data: reservasRows, error: reservasError }
  ] = await Promise.all([
    supabaseInstance.from('habitaciones').select('id', { count: 'exact', head: true })
      .eq('hotel_id', hotelId).eq('activo', true),
    supabaseInstance.from('caja').select('monto, business_date')
      .eq('hotel_id', hotelId).eq('tipo', 'ingreso')
      .gte('business_date', labels[0]).lte('business_date', labels[labels.length - 1])
      .is('venta_tienda_id', null),
    supabaseInstance.from('reservas').select('fecha_inicio, fecha_fin')
      .eq('hotel_id', hotelId).in('estado', ['activa', 'ocupada'])
      .lt('fecha_inicio', endExclusiveIso).gte('fecha_fin', startIso)
  ]);

  if (errTotalHab) console.error('[Dashboard] Error obteniendo total de habitaciones:', errTotalHab);
  if (revenueError) console.warn('[Dashboard] Error obteniendo ingresos:', revenueError.message);
  else (revenueRows || []).forEach((entry) => {
    const index = labelIndexMap.get(String(entry.business_date || ''));
    if (typeof index === 'number') dailyRevenueData[index] += Number(entry.monto) || 0;
  });

  if (reservasError) console.warn('[Dashboard] Error obteniendo ocupacion:', reservasError.message);
  else if (totalHabitacionesActivas > 0) labels.forEach((day, index) => {
    const range = getUtcRangeForHotelDates(day, day, zone);
    const startMs = Date.parse(range.startIso);
    const endMs = Date.parse(range.endExclusiveIso) - 1;
    const ocupacionCount = (reservasRows || []).reduce((sum, reserva) => {
      const inicio = reserva?.fecha_inicio ? Date.parse(reserva.fecha_inicio) : NaN;
      const fin = reserva?.fecha_fin ? Date.parse(reserva.fecha_fin) : NaN;
      return Number.isFinite(inicio) && Number.isFinite(fin) && inicio <= endMs && fin >= startMs ? sum + 1 : sum;
    }, 0);
    dailyOcupacionData[index] = Math.round((ocupacionCount / totalHabitacionesActivas) * 100);
  });

  return { labels, dailyRevenueData, dailyOcupacionData };
}

async function ensureChartJs() {
  if (window.Chart) return true;
  const existing = document.querySelector('script[src*="chart.js"], script[src*="chart.min.js"]');
  if (existing) {
    await new Promise((resolve) => {
      if (window.Chart) return resolve();
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 1500);
    });
    return Boolean(window.Chart);
  }
  await new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
  return Boolean(window.Chart);
}

async function renderCharts(containerEl, hotelId, supabaseInstance) {
  if (!isMounted || !containerEl) return;
  if (!(await ensureChartJs())) return;
  const chartData = await fetchChartData(hotelId, supabaseInstance);
  if (!isMounted) return;

  chartRevenueInstance?.destroy();
  chartOcupacionInstance?.destroy();
  const revenueCanvas = containerEl.querySelector('#chart-revenue');
  const occupancyCanvas = containerEl.querySelector('#chart-ocupacion');
  if (revenueCanvas) chartRevenueInstance = new window.Chart(revenueCanvas.getContext('2d'), {
    type: 'line',
    data: { labels: chartData.labels, datasets: [{ label: 'Ingresos Habitaciones', data: chartData.dailyRevenueData, tension: 0.1, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatCurrency(value) } } } }
  });
  if (occupancyCanvas) chartOcupacionInstance = new window.Chart(occupancyCanvas.getContext('2d'), {
    type: 'bar',
    data: { labels: chartData.labels, datasets: [{ label: '% Ocupacion Real', data: chartData.dailyOcupacionData }] },
    options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100, ticks: { callback: (value) => `${value}%` } } } }
  });
}

async function loadDashboardPageData(containerEl, hotelId, supabaseInstance) {
  const mainErrorDiv = containerEl?.querySelector('#dashboard-main-error');
  if (!isMounted || !mainErrorDiv) return false;
  clearAppFeedback(mainErrorDiv);
  ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda']
    .forEach((id) => updateCardContent(containerEl, id, null, null, false, true));

  try {
    const { data: rpcData, error: rpcError } = await supabaseInstance.rpc('get_dashboard_metrics', { p_hotel_id: hotelId });
    if (rpcError) throw rpcError;
    if (!rpcData?.kpis) throw new Error('Respuesta incompleta del servidor para el dashboard.');
    const kpis = rpcData.kpis;
    updateCardContent(containerEl, 'card-reservas-activas', kpis.reservas_activas_hoy ?? 0, kpis.reservas_activas_ayer ?? 0);
    updateCardContent(containerEl, 'card-ingresos-hoy', kpis.ingresos_habitaciones_hoy ?? 0, kpis.ingresos_habitaciones_ayer ?? 0, true);
    updateCardContent(containerEl, 'card-ventas-tienda', kpis.ingresos_tienda_hoy ?? 0, kpis.ingresos_tienda_ayer ?? 0, true);
    const ocupadas = Number(kpis.habitaciones_ocupadas_ahora || 0);
    const total = Number(kpis.habitaciones_activas_total || 0);
    const rate = total > 0 ? Math.round((ocupadas / total) * 100) : 0;
    updateCardContent(containerEl, 'card-ocupacion', rate, null, false, false, `${rate}% (${ocupadas}/${total})`);
    renderPriorityStrip(containerEl, kpis, rpcData.checkins || [], rpcData.checkouts || []);
    renderOperationalAlerts(containerEl, await loadOperationalAlerts(hotelId, supabaseInstance));
    renderChecklist(containerEl, 'list-next-checkins', rpcData.checkins || [], 'check-in');
    renderChecklist(containerEl, 'list-next-checkouts', rpcData.checkouts || [], 'check-out');
    return true;
  } catch (error) {
    showAppFeedback(mainErrorDiv, `Error al cargar datos principales: ${error.message}`, 'error');
    return false;
  }
}

async function refreshDashboardData(containerEl, hotelId, supabaseInstance) {
  if (!containerEl || !isMounted || dashboardIsRefreshing) return;
  dashboardIsRefreshing = true;
  updateRefreshControls(containerEl);
  try {
    const loaded = await loadDashboardPageData(containerEl, hotelId, supabaseInstance);
    if (isMounted) await renderCharts(containerEl, hotelId, supabaseInstance);
    if (loaded) dashboardLastUpdatedAt = new Date();
  } finally {
    dashboardIsRefreshing = false;
    updateRefreshControls(containerEl);
  }
}

function renderDashboardShell(container) {
  container.innerHTML = `
    <header class="main-header mb-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-900 p-6 text-white shadow-xl">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p class="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">Dashboard operativo</p><h1 class="text-3xl font-black">Panel de Control</h1><p class="mt-2 text-sm text-slate-200">Resumen del dia operativo según la zona horaria oficial del hotel.</p></div>
        <div class="flex flex-col items-start gap-2 lg:items-end"><span id="dashboard-last-updated" class="text-xs text-slate-300">Sin sincronizar</span><button id="dashboard-refresh-btn" class="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold">Actualizar</button></div>
      </div><div id="dashboard-main-error" class="feedback-message mt-4" role="alert" style="display:none;"></div>
    </header>
    <section id="dashboard-priority-strip" class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"></section>
    <section class="mb-6"><div class="mb-3"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Alertas automaticas</p><h2 class="text-2xl font-black text-slate-900">Radar operativo</h2></div><div id="dashboard-alerts-board" class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">Cargando...</div></section>
    <section class="dashboard-cards mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      ${[
        ['card-reservas-activas', 'Reservas activas', '#/reservas'],
        ['card-ingresos-hoy', 'Ingresos de hoy', '#/caja'],
        ['card-ocupacion', 'Ocupacion actual', '#/mapa-habitaciones'],
        ['card-ventas-tienda', 'Tienda hoy', '#/tienda']
      ].map(([id, label, route]) => `<article id="${id}" class="dashboard-card cursor-pointer rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" data-navegar="${route}"><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">${label}</p><p class="dashboard-metric-value mt-3 text-4xl font-black text-slate-900">Cargando...</p><p class="dashboard-metric-comparison mt-2 text-xs text-slate-400"></p></article>`).join('')}
    </section>
    <section class="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><h3 class="mb-4 text-lg font-bold text-slate-800">Check-ins de hoy</h3><ul id="list-next-checkins" class="space-y-3" style="padding-left:0"><li>Cargando...</li></ul></div>
      <div class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><h3 class="mb-4 text-lg font-bold text-slate-800">Check-outs de hoy</h3><ul id="list-next-checkouts" class="space-y-3" style="padding-left:0"><li>Cargando...</li></ul></div>
    </section>
    <section class="dashboard-charts grid grid-cols-1 gap-6 xl:grid-cols-2">
      <div class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><h3 class="mb-3 text-lg font-bold text-slate-800">Ingresos Habitaciones · 7 dias</h3><div style="height:320px"><canvas id="chart-revenue"></canvas></div></div>
      <div class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm"><h3 class="mb-3 text-lg font-bold text-slate-800">Ocupacion · 7 dias</h3><div style="height:320px"><canvas id="chart-ocupacion"></canvas></div></div>
    </section>`;
}

export async function mount(container, supabaseInstance, currentUser) {
  if (isMounted && currentContainerGlobal === container) {
    if (currentHotelIdGlobal && currentSupabaseInstanceGlobal) {
      await refreshDashboardData(container, currentHotelIdGlobal, currentSupabaseInstanceGlobal);
    }
    return;
  }
  unmount(currentContainerGlobal);
  isMounted = true;
  currentContainerGlobal = container;
  currentSupabaseInstanceGlobal = supabaseInstance;
  renderDashboardShell(container);

  let hotelId = currentUser?.user_metadata?.hotel_id || currentUser?.app_metadata?.hotel_id;
  if (!hotelId && currentUser?.id) {
    const { data: perfil, error } = await supabaseInstance.from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
    if (error && error.code !== 'PGRST116') {
      showAppFeedback(container.querySelector('#dashboard-main-error'), 'No se pudo determinar el hotel del usuario.', 'error');
      return;
    }
    hotelId = perfil?.hotel_id;
  }
  if (!hotelId) {
    showAppFeedback(container.querySelector('#dashboard-main-error'), 'Hotel ID no disponible.', 'error');
    return;
  }
  currentHotelIdGlobal = hotelId;

  const navigationHandler = (event) => {
    const target = event.target.closest('[data-navegar]');
    if (target?.dataset.navegar) window.location.hash = target.dataset.navegar;
  };
  container.addEventListener('click', navigationHandler);
  moduleDashboardListeners.push({ element: container, type: 'click', handler: navigationHandler });

  const refreshButton = container.querySelector('#dashboard-refresh-btn');
  const refreshHandler = () => refreshDashboardData(container, hotelId, supabaseInstance);
  refreshButton?.addEventListener('click', refreshHandler);
  if (refreshButton) moduleDashboardListeners.push({ element: refreshButton, type: 'click', handler: refreshHandler });

  await refreshDashboardData(container, hotelId, supabaseInstance);
}

export function unmount(containerContext) {
  isMounted = false;
  dashboardIsRefreshing = false;
  dashboardLastUpdatedAt = null;
  chartRevenueInstance?.destroy();
  chartOcupacionInstance?.destroy();
  chartRevenueInstance = null;
  chartOcupacionInstance = null;
  moduleDashboardListeners.forEach(({ element, type, handler }) => element?.removeEventListener?.(type, handler));
  moduleDashboardListeners = [];
  if (containerContext && containerContext === currentContainerGlobal) containerContext.innerHTML = '';
  currentContainerGlobal = null;
}
