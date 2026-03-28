// js/modules/dashboard/dashboard.js
import { showAppFeedback, clearAppFeedback, formatDateTime, formatCurrency } from '../../uiUtils.js';
import { escapeHtml } from '../../security.js';
import { getReservaToleranceStatus } from '../reservas/reservas-operacion.js';

let chartRevenueInstance = null;
let chartOcupacionInstance = null;
let moduleDashboardListeners = [];
let dashboardLastUpdatedAt = null;
let dashboardIsRefreshing = false;

// Declaraciones de variables a nivel de módulo
let currentContainerGlobal = null;
let currentSupabaseInstanceGlobal = null;
let currentHotelIdGlobal = null;
let isMounted = false; // Flag para controlar el estado de montaje

function formatDashboardTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return 'Sin sincronizar';
  return `Ultima actualizacion: ${date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
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
      helperText: type === 'check-in' ? 'Esta llegada ya deberia haberse atendido.' : 'Esta salida ya deberia haberse cerrado.'
    };
  }

  if (diffMinutes <= 120) {
    return {
      timeLabel: `${diffMinutes} min`,
      statusLabel: 'Prioridad alta',
      cardClass: 'border-amber-200 bg-amber-50/80',
      badgeClass: 'bg-amber-100 text-amber-700',
      helperText: type === 'check-in' ? 'Llega pronto. Conviene preparar la recepcion.' : 'Sale pronto. Conviene revisar saldo y habitacion.'
    };
  }

  return {
    timeLabel: formatDateTime(eventDate, undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
    statusLabel: 'En seguimiento',
    cardClass: 'border-slate-200 bg-white',
    badgeClass: 'bg-blue-50 text-blue-700',
    helperText: type === 'check-in' ? 'Movimiento programado para hoy.' : 'Salida programada dentro del dia.'
  };
}

function renderPriorityStrip(containerEl, kpis, checkins, checkouts) {
  if (!containerEl || !isMounted) return;

  const strip = containerEl.querySelector('#dashboard-priority-strip');
  if (!strip) return;

  const safeCheckins = Array.isArray(checkins) ? checkins : [];
  const safeCheckouts = Array.isArray(checkouts) ? checkouts : [];
  const upcomingCheckins = safeCheckins.filter((item) => {
    const diff = new Date(item.fecha_inicio).getTime() - Date.now();
    return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
  }).length;
  const upcomingCheckouts = safeCheckouts.filter((item) => {
    const diff = new Date(item.fecha_fin).getTime() - Date.now();
    return diff >= 0 && diff <= 2 * 60 * 60 * 1000;
  }).length;
  const overdueCheckouts = safeCheckouts.filter((item) => new Date(item.fecha_fin).getTime() < Date.now()).length;
  const ocupadasAhora = Number(kpis?.habitaciones_ocupadas_ahora || 0);
  const totalHabitaciones = Number(kpis?.habitaciones_activas_total || 0);
  const ocupacionActual = totalHabitaciones > 0 ? Math.round((ocupadasAhora / totalHabitaciones) * 100) : 0;

  const priorityCards = [
    {
      label: 'Llegadas proximas',
      value: upcomingCheckins,
      helper: upcomingCheckins > 0 ? 'En las proximas 2 horas' : 'Sin llegadas criticas ahora',
      accent: 'text-blue-700',
      bg: 'border-blue-200 bg-blue-50/80'
    },
    {
      label: 'Salidas proximas',
      value: upcomingCheckouts,
      helper: upcomingCheckouts > 0 ? 'Revisa saldo y checkout' : 'Sin salidas urgentes ahora',
      accent: 'text-indigo-700',
      bg: 'border-indigo-200 bg-indigo-50/80'
    },
    {
      label: 'Salidas vencidas',
      value: overdueCheckouts,
      helper: overdueCheckouts > 0 ? 'Necesitan atencion inmediata' : 'Todo al dia',
      accent: overdueCheckouts > 0 ? 'text-red-700' : 'text-emerald-700',
      bg: overdueCheckouts > 0 ? 'border-red-200 bg-red-50/80' : 'border-emerald-200 bg-emerald-50/80'
    },
    {
      label: 'Ocupacion actual',
      value: `${ocupacionActual}%`,
      helper: `${ocupadasAhora}/${totalHabitaciones} habitaciones ocupadas`,
      accent: 'text-slate-800',
      bg: 'border-slate-200 bg-white'
    }
  ];

  strip.innerHTML = priorityCards.map((card) => `
    <article class="rounded-2xl border p-4 shadow-sm ${card.bg}">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">${card.label}</p>
      <p class="mt-2 text-3xl font-black ${card.accent}">${card.value}</p>
      <p class="mt-2 text-sm text-slate-500">${card.helper}</p>
    </article>
  `).join('');
}

function getAlertAccentClasses(severity) {
  switch (severity) {
    case 'critical':
      return {
        border: 'border-red-200',
        bg: 'bg-red-50/90',
        pill: 'bg-red-100 text-red-700',
        icon: 'bg-red-100 text-red-700'
      };
    case 'warning':
      return {
        border: 'border-amber-200',
        bg: 'bg-amber-50/90',
        pill: 'bg-amber-100 text-amber-700',
        icon: 'bg-amber-100 text-amber-700'
      };
    case 'info':
      return {
        border: 'border-blue-200',
        bg: 'bg-blue-50/90',
        pill: 'bg-blue-100 text-blue-700',
        icon: 'bg-blue-100 text-blue-700'
      };
    default:
      return {
        border: 'border-slate-200',
        bg: 'bg-slate-50/90',
        pill: 'bg-slate-100 text-slate-700',
        icon: 'bg-slate-100 text-slate-700'
      };
  }
}

function renderOperationalAlerts(containerEl, alerts = []) {
  if (!containerEl || !isMounted) return;

  const board = containerEl.querySelector('#dashboard-alerts-board');
  if (!board) return;

  if (!alerts.length) {
    board.innerHTML = `
      <div class="rounded-[26px] border border-emerald-200 bg-emerald-50/80 p-5 shadow-sm">
        <div class="flex items-start gap-3">
          <span class="rounded-2xl bg-emerald-100 px-3 py-2 text-lg text-emerald-700">OK</span>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Operacion al dia</p>
            <h3 class="mt-2 text-lg font-bold text-slate-900">Sin alertas criticas por ahora</h3>
            <p class="mt-2 text-sm text-slate-600">No hay no-shows sugeridos, salidas vencidas ni tareas urgentes que esten frenando la operacion.</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  board.innerHTML = `
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
      ${alerts.map((alert) => {
        const accents = getAlertAccentClasses(alert.severity);
        const contextPills = (alert.context || []).map((item) => `
          <span class="rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${accents.pill}">
            ${escapeHtml(item)}
          </span>
        `).join('');

        return `
          <article class="rounded-[26px] border ${accents.border} ${accents.bg} p-5 shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-start gap-3">
                <span class="rounded-2xl px-3 py-2 text-lg font-bold ${accents.icon}">${escapeHtml(alert.icon || '!')}</span>
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">${escapeHtml(alert.category || 'Alerta')}</p>
                  <h3 class="mt-2 text-lg font-bold text-slate-900">${escapeHtml(alert.title || 'Seguimiento operativo')}</h3>
                </div>
              </div>
              ${alert.count != null ? `<span class="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-sm font-black text-slate-800">${escapeHtml(String(alert.count))}</span>` : ''}
            </div>
            <p class="mt-3 text-sm leading-6 text-slate-600">${escapeHtml(alert.message || '')}</p>
            ${contextPills ? `<div class="mt-4 flex flex-wrap gap-2">${contextPills}</div>` : ''}
            ${alert.route ? `
              <div class="mt-4">
                <button type="button" class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50" data-navegar="${escapeHtml(alert.route)}">
                  ${escapeHtml(alert.cta || 'Abrir modulo')}
                </button>
              </div>
            ` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
}

async function loadOperationalAlerts(hotelId, supabaseInstance) {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
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
    supabaseInstance
      .from('configuracion_hotel')
      .select('minutos_tolerancia_llegada, minutos_alerta_reserva, minutos_alerta_checkout')
      .eq('hotel_id', hotelId)
      .maybeSingle(),
    supabaseInstance
      .from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .in('estado', ['reservada', 'confirmada'])
      .lte('fecha_inicio', endOfToday),
    supabaseInstance
      .from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .lte('fecha_fin', endOfToday),
    supabaseInstance
      .from('tareas_mantenimiento')
      .select('id, titulo, estado, tipo, frecuencia, fecha_programada, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .in('estado', ['pendiente', 'en_progreso'])
      .order('fecha_programada', { ascending: true }),
    supabaseInstance
      .from('habitaciones')
      .select('id, nombre')
      .eq('hotel_id', hotelId)
      .eq('estado', 'limpieza'),
    supabaseInstance
      .from('lista_espera_reservas')
      .select('id, cliente_nombre, fecha_inicio, prioridad')
      .eq('hotel_id', hotelId)
      .eq('estado', 'pendiente')
      .order('fecha_inicio', { ascending: true })
      .limit(8),
    supabaseInstance
      .from('inspecciones_limpieza')
      .select('id, puntaje, creado_en, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .lte('puntaje', 3)
      .order('creado_en', { ascending: false })
      .limit(5)
  ]);

  const toleranceConfig = {
    minutos_tolerancia_llegada: Number(config?.minutos_tolerancia_llegada) || 60,
    minutos_alerta_reserva: Number(config?.minutos_alerta_reserva) || 120,
    minutos_alerta_checkout: Number(config?.minutos_alerta_checkout) || 30
  };

  const noShowSuggested = (reservasPendientes || []).filter((reserva) => {
    const status = getReservaToleranceStatus(reserva, toleranceConfig, now);
    return status.level === 'no_show_sugerido';
  });

  if (noShowSuggested.length > 0) {
    alerts.push({
      severity: 'critical',
      category: 'Reservas',
      icon: 'NS',
      title: 'Reservas con no-show sugerido',
      count: noShowSuggested.length,
      message: 'Estas reservas ya superaron la tolerancia definida para la llegada y conviene revisarlas antes de que sigan bloqueando habitacion.',
      context: noShowSuggested.slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Hab.'}`),
      route: '#/reservas',
      cta: 'Revisar reservas'
    });
  }

  const lateCheckouts = (reservasActivas || []).filter((reserva) => {
    const checkoutDate = reserva?.fecha_fin ? new Date(reserva.fecha_fin) : null;
    if (!(checkoutDate instanceof Date) || Number.isNaN(checkoutDate.getTime())) return false;
    const diffMinutes = Math.round((now.getTime() - checkoutDate.getTime()) / 60000);
    return diffMinutes > toleranceConfig.minutos_alerta_checkout;
  });

  if (lateCheckouts.length > 0) {
    alerts.push({
      severity: 'warning',
      category: 'Check-out',
      icon: 'CO',
      title: 'Salidas vencidas con seguimiento',
      count: lateCheckouts.length,
      message: 'Hay habitaciones que ya superaron la tolerancia del checkout y necesitan cierre, extension o verificacion de saldo.',
      context: lateCheckouts.slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Hab.'}`),
      route: '#/mapa-habitaciones',
      cta: 'Abrir mapa hotel'
    });
  }

  const preventivasAbiertas = (tareasAbiertas || []).filter((tarea) => String(tarea.frecuencia || 'unica') !== 'unica');
  if (preventivasAbiertas.length > 0) {
    alerts.push({
      severity: 'info',
      category: 'Mantenimiento',
      icon: 'MP',
      title: 'Preventivos abiertos por programar o cerrar',
      count: preventivasAbiertas.length,
      message: 'El plan preventivo ya tiene tareas abiertas. Conviene revisarlas para que no se queden sin ejecucion o seguimiento.',
      context: preventivasAbiertas.slice(0, 3).map((item) => `${item.titulo || 'Preventivo'} · ${item.habitaciones?.nombre || 'General'}`),
      route: '#/mantenimiento',
      cta: 'Ir a mantenimiento'
    });
  }

  if ((habitacionesLimpieza || []).length > 0) {
    alerts.push({
      severity: 'info',
      category: 'Limpieza',
      icon: 'L',
      title: 'Habitaciones pendientes de limpieza',
      count: habitacionesLimpieza.length,
      message: 'Estas habitaciones siguen en estado limpieza y conviene cerrarlas para que vuelvan a estar disponibles en operacion.',
      context: (habitacionesLimpieza || []).slice(0, 4).map((item) => item.nombre || 'Habitacion'),
      route: '#/limpieza',
      cta: 'Revisar limpieza'
    });
  }

  if ((waitlistPendiente || []).length > 0) {
    alerts.push({
      severity: 'warning',
      category: 'Lista de espera',
      icon: 'LE',
      title: 'Clientes esperando habitacion',
      count: waitlistPendiente.length,
      message: 'Hay clientes en lista de espera que ya pueden requerir seguimiento o una reasignacion inteligente desde reservas.',
      context: (waitlistPendiente || []).slice(0, 3).map((item) => `${item.cliente_nombre || 'Cliente'} · Prioridad ${item.prioridad || 1}`),
      route: '#/reservas',
      cta: 'Abrir reservas'
    });
  }

  if ((inspeccionesRecientes || []).length > 0) {
    alerts.push({
      severity: 'warning',
      category: 'Inspeccion',
      icon: 'IN',
      title: 'Limpiezas con observaciones recientes',
      count: inspeccionesRecientes.length,
      message: 'Las ultimas inspecciones registraron puntajes bajos. Conviene revisar observaciones y reforzar estandar de limpieza.',
      context: (inspeccionesRecientes || []).slice(0, 3).map((item) => `${item.habitaciones?.nombre || 'Habitacion'} · Puntaje ${item.puntaje}/5`),
      route: '#/limpieza',
      cta: 'Ver limpieza'
    });
  }

  return alerts
    .sort((a, b) => {
      const weight = { critical: 0, warning: 1, info: 2, neutral: 3 };
      return (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9);
    })
    .slice(0, 6);
}

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
    valueEl.innerHTML = `<span class="text-2xl text-gray-400 animate-pulse">Cargando...</span>`;
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

        let arrow = '= '; 
        let textColor = 'text-gray-500'; 
        if (change > 0) { arrow = '+ '; textColor = 'text-green-500'; }
        else if (change < 0) { arrow = '- '; textColor = 'text-red-500'; }
        
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
      listEl.innerHTML = `
        <li class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
          No hay ${type === 'check-in' ? 'llegadas programadas' : 'salidas programadas'} para hoy.
        </li>
      `;
      return;
  }

  items.forEach(item => {
      const li = document.createElement('li');
      li.className = 'rounded-2xl border p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md';
      const fecha = type === 'check-in' ? item.fecha_inicio : item.fecha_fin;
      const nombreHabitacion = item.habitacion_nombre || item.habitaciones_nombre || 'N/A';
      const clienteNombre = item.cliente_nombre || 'Cliente';
      const meta = getScheduleMeta(item, type);
      li.classList.add(...meta.cardClass.split(' '));
      li.innerHTML = `
          <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                      <span class="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}">${type === 'check-in' ? 'Check-in' : 'Check-out'}</span>
                      <span class="text-xs font-semibold text-slate-400">Hab. ${escapeHtml(String(nombreHabitacion))}</span>
                  </div>
                  <p class="mt-3 truncate text-base font-bold text-slate-800">${escapeHtml(String(clienteNombre))}</p>
                  <p class="mt-1 text-sm text-slate-500">${formatDateTime(fecha, undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
              <div class="text-right">
                  <p class="text-sm font-black text-slate-700">${meta.timeLabel}</p>
                  <p class="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">${meta.statusLabel}</p>
              </div>
          </div>
          <div class="mt-4 flex items-center justify-between gap-3">
              <p class="text-xs text-slate-500">${meta.helperText}</p>
              <button type="button" class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50" data-navegar="${type === 'check-in' ? '#/reservas' : '#/mapa-habitaciones'}">
                Ver
              </button>
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

  const labelIndexMap = new Map(labels.map((label, index) => [label, index]));
  const startOfRange = `${labels[0]}T00:00:00.000Z`;
  const endOfRange = `${labels[labels.length - 1]}T23:59:59.999Z`;

  try {
    const [
      { count: totalHabitacionesActivas, error: errTotalHab },
      { data: revenueRows, error: revenueError },
      { data: reservasRows, error: reservasError }
    ] = await Promise.all([
      supabaseInstance
        .from('habitaciones')
        .select('id', { count: 'exact', head: true })
        .eq('hotel_id', hotelId)
        .eq('activo', true),
      supabaseInstance
        .from('caja')
        .select('monto, creado_en')
        .eq('hotel_id', hotelId)
        .eq('tipo', 'ingreso')
        .gte('creado_en', startOfRange)
        .lte('creado_en', endOfRange)
        .is('venta_tienda_id', null),
      supabaseInstance
        .from('reservas')
        .select('fecha_inicio, fecha_fin')
        .eq('hotel_id', hotelId)
        .in('estado', ['activa', 'ocupada'])
        .lte('fecha_inicio', endOfRange)
        .gte('fecha_fin', startOfRange)
    ]);

    if (errTotalHab) console.error('[Dashboard] Error obteniendo total de habitaciones:', errTotalHab);

    if (revenueError) {
      console.warn('[Dashboard] Error obteniendo ingresos del rango del dashboard:', revenueError.message);
    } else {
      (revenueRows || []).forEach((entry) => {
        const dayKey = new Date(entry.creado_en).toISOString().slice(0, 10);
        const index = labelIndexMap.get(dayKey);
        if (typeof index === 'number') {
          dailyRevenueData[index] += Number(entry.monto) || 0;
        }
      });
    }

    if (reservasError) {
      console.warn('[Dashboard] Error obteniendo ocupacion del rango del dashboard:', reservasError.message);
    } else if (totalHabitacionesActivas != null && totalHabitacionesActivas > 0) {
      labels.forEach((day, index) => {
        const startOfDayMs = new Date(`${day}T00:00:00.000Z`).getTime();
        const endOfDayMs = new Date(`${day}T23:59:59.999Z`).getTime();
        const ocupacionCount = (reservasRows || []).reduce((sum, reserva) => {
          const reservaInicio = reserva?.fecha_inicio ? new Date(reserva.fecha_inicio).getTime() : null;
          const reservaFin = reserva?.fecha_fin ? new Date(reserva.fecha_fin).getTime() : null;
          if (reservaInicio === null || reservaFin === null) return sum;
          return (reservaInicio <= endOfDayMs && reservaFin >= startOfDayMs) ? sum + 1 : sum;
        }, 0);

        dailyOcupacionData[index] = ocupacionCount > 0 ? Math.round((ocupacionCount / totalHabitacionesActivas) * 100) : 0;
      });
    }
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

    renderPriorityStrip(containerEl, kpis, rpcData.checkins || [], rpcData.checkouts || []);
    const alerts = await loadOperationalAlerts(hotelId, supabaseInstance);
    renderOperationalAlerts(containerEl, alerts);
    renderChecklist(containerEl, 'list-next-checkins', rpcData.checkins || [], 'check-in');
    renderChecklist(containerEl, 'list-next-checkouts', rpcData.checkouts || [], 'check-out');
    return true;

  } catch (err) {
    console.error("[Dashboard] Error general en loadDashboardPageData:", err);
    if (isMounted && mainErrorDiv) showAppFeedback(mainErrorDiv, `Error al cargar datos principales: ${err.message}`, 'error');
    renderPriorityStrip(containerEl, {}, [], []);
    renderOperationalAlerts(containerEl, []);
    renderChecklist(containerEl, 'list-next-checkins', [], 'check-in');
    renderChecklist(containerEl, 'list-next-checkouts', [], 'check-out');
    ['card-reservas-activas', 'card-ingresos-hoy', 'card-ocupacion', 'card-ventas-tienda'].forEach(id => {
        if (isMounted && containerEl.querySelector(`#${id}`)) updateCardContent(containerEl, id, 0, 0, false, false, 'Error');
    });
    return false;
  }
  finally {
    console.log('[Dashboard] loadDashboardPageData finalizado.');
  }
}

async function refreshDashboardData(containerEl, hotelId, supabaseInstance) {
  if (!containerEl || !isMounted || dashboardIsRefreshing) return;

  dashboardIsRefreshing = true;
  updateRefreshControls(containerEl);

  try {
    const metricsLoaded = await loadDashboardPageData(containerEl, hotelId, supabaseInstance);

    if (!isMounted) return;

    if (window.Chart && containerEl.querySelector('#chart-revenue') && containerEl.querySelector('#chart-ocupacion')) {
      await renderCharts(containerEl, hotelId, supabaseInstance);
    }

    if (metricsLoaded) {
      dashboardLastUpdatedAt = new Date();
    }
  } finally {
    dashboardIsRefreshing = false;
    updateRefreshControls(containerEl);
  }
}

export async function mount(container, supabaseInstance, currentUser) {
  if (isMounted && currentContainerGlobal === container) {
    console.log('[Dashboard] Mount llamado pero ya está montado en este contenedor. Se intentará refrescar datos si es necesario.');
    if (currentHotelIdGlobal && currentSupabaseInstanceGlobal) {
      await refreshDashboardData(container, currentHotelIdGlobal, currentSupabaseInstanceGlobal);
    }
    return;
  }
  
  // Si hay un montaje previo en otro contenedor o si isMounted es false
  unmount(currentContainerGlobal); // Desmontar el anterior si existe y es diferente

  isMounted = true;
  currentContainerGlobal = container; 
  currentSupabaseInstanceGlobal = supabaseInstance; 
  dashboardLastUpdatedAt = null;
  dashboardIsRefreshing = false;
  
  console.log('[Dashboard] Iniciando mount en nuevo contenedor o por primera vez...');
  container.innerHTML = `
    <header class="main-header mb-6 overflow-hidden rounded-[28px] bg-gradient-to-br from-slate-900 via-blue-950 to-cyan-900 p-6 text-white shadow-xl">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200/80">Dashboard operativo</p>
          <h1 class="mb-2 text-3xl font-black tracking-tight text-white">Panel de Control</h1>
          <p class="max-w-2xl text-sm text-slate-200">Resumen de actividad, ingresos y ocupacion general para recepcion y administracion.</p>
        </div>
        <div class="flex flex-col items-start gap-2 lg:items-end">
          <span id="dashboard-last-updated" class="text-xs font-medium text-slate-300">Sin sincronizar</span>
          <button id="dashboard-refresh-btn" class="rounded-2xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur transition hover:bg-white/20">Actualizar</button>
        </div>
      </div>
      <div id="dashboard-main-error" class="feedback-message mt-4" role="alert" style="display:none;"></div>
    </header>
    <section id="dashboard-priority-strip" class="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-9 w-16 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-40 animate-pulse rounded bg-slate-100"></div></article>
      <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-9 w-16 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-40 animate-pulse rounded bg-slate-100"></div></article>
      <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-9 w-16 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-40 animate-pulse rounded bg-slate-100"></div></article>
      <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-9 w-16 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-40 animate-pulse rounded bg-slate-100"></div></article>
    </section>
    <section class="mb-6">
      <div class="mb-3 flex items-center justify-between gap-3">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Alertas automaticas</p>
          <h2 class="text-2xl font-black tracking-tight text-slate-900">Radar operativo</h2>
        </div>
        <button type="button" class="text-sm font-semibold text-blue-600 hover:text-blue-700" data-navegar="#/soporte">Ir a soporte</button>
      </div>
      <div id="dashboard-alerts-board" class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <article class="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-6 w-52 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-full animate-pulse rounded bg-slate-100"></div></article>
          <article class="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5 shadow-sm"><div class="h-3 w-28 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-6 w-52 animate-pulse rounded bg-slate-200"></div><div class="mt-3 h-3 w-full animate-pulse rounded bg-slate-100"></div></article>
        </div>
      </div>
    </section>
    <section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 mb-6 dashboard-cards">
      <article id="card-reservas-activas" class="dashboard-card group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg" data-navegar="#/reservas">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Reservas activas</p>
            <p class="dashboard-metric-value mt-3 text-4xl font-black tracking-tight text-slate-900">Cargando...</p>
            <p class="dashboard-metric-comparison mt-2 text-xs text-slate-400"></p>
          </div>
          <span class="rounded-2xl bg-blue-50 px-3 py-2 text-xl text-blue-600">R</span>
        </div>
        <p class="mt-4 text-sm text-slate-500">Controla el pulso actual de la operacion hotelera.</p>
      </article>
      <article id="card-ingresos-hoy" class="dashboard-card group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg" data-navegar="#/caja">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ingresos de hoy</p>
            <p class="dashboard-metric-value mt-3 text-4xl font-black tracking-tight text-slate-900">Cargando...</p>
            <p class="dashboard-metric-comparison mt-2 text-xs text-slate-400"></p>
          </div>
          <span class="rounded-2xl bg-emerald-50 px-3 py-2 text-xl text-emerald-600">$</span>
        </div>
        <p class="mt-4 text-sm text-slate-500">Vista rapida del ingreso de habitaciones del dia.</p>
      </article>
      <article id="card-ocupacion" class="dashboard-card group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg" data-navegar="#/mapa-habitaciones">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Ocupacion actual</p>
            <p class="dashboard-metric-value mt-3 text-4xl font-black tracking-tight text-slate-900">Cargando...</p>
            <p class="dashboard-metric-comparison mt-2 text-xs text-slate-400"></p>
          </div>
          <span class="rounded-2xl bg-indigo-50 px-3 py-2 text-xl text-indigo-600">%</span>
        </div>
        <p class="mt-4 text-sm text-slate-500">Salta directo al mapa para revisar habitaciones.</p>
      </article>
      <article id="card-ventas-tienda" class="dashboard-card group cursor-pointer overflow-hidden rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-lg" data-navegar="#/tienda">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Tienda hoy</p>
            <p class="dashboard-metric-value mt-3 text-4xl font-black tracking-tight text-slate-900">Cargando...</p>
            <p class="dashboard-metric-comparison mt-2 text-xs text-slate-400"></p>
          </div>
          <span class="rounded-2xl bg-amber-50 px-3 py-2 text-xl text-amber-600">T</span>
        </div>
        <p class="mt-4 text-sm text-slate-500">Mide rapido lo que esta sumando la venta adicional.</p>
      </article>
    </section>
    <section class="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_1fr] mb-6">
      <div class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Movimientos del dia</h3>
            <p class="text-sm text-slate-500">Check-ins y check-outs con prioridad visual.</p>
          </div>
          <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">Hoy</span>
        </div>
        <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <div class="mb-3 flex items-center justify-between">
              <h4 class="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Check-ins</h4>
              <button type="button" class="text-xs font-semibold text-blue-600 hover:text-blue-700" data-navegar="#/reservas">Ver reservas</button>
            </div>
            <ul id="list-next-checkins" class="space-y-3" style="padding-left: 0;"><li>Cargando...</li></ul>
          </div>
          <div>
            <div class="mb-3 flex items-center justify-between">
              <h4 class="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-700">Check-outs</h4>
              <button type="button" class="text-xs font-semibold text-indigo-600 hover:text-indigo-700" data-navegar="#/mapa-habitaciones">Ir al mapa</button>
            </div>
            <ul id="list-next-checkouts" class="space-y-3" style="padding-left: 0;"><li>Cargando...</li></ul>
          </div>
        </div>
      </div>
      <section class="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Accesos rapidos</h3>
            <p class="text-sm text-slate-500">Entra rapido a los modulos mas usados.</p>
          </div>
        </div>
        <div class="atajos-buttons grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-blue-200 hover:bg-blue-50" data-navegar="#/reservas">
            <span class="block text-sm font-bold text-slate-800">Nueva Reserva</span>
            <span class="mt-1 block text-xs text-slate-500">Registra o revisa reservas del dia</span>
          </button>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-indigo-200 hover:bg-indigo-50" data-navegar="#/mapa-habitaciones">
            <span class="block text-sm font-bold text-slate-800">Mapa Hotel</span>
            <span class="mt-1 block text-xs text-slate-500">Gestiona habitaciones y tiempos</span>
          </button>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-emerald-200 hover:bg-emerald-50" data-navegar="#/caja">
            <span class="block text-sm font-bold text-slate-800">Ir a Caja</span>
            <span class="mt-1 block text-xs text-slate-500">Revisa movimientos y pagos</span>
          </button>
          <button class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-amber-200 hover:bg-amber-50" data-navegar="#/tienda">
            <span class="block text-sm font-bold text-slate-800">Tienda</span>
            <span class="mt-1 block text-xs text-slate-500">Gestiona ventas adicionales del hotel</span>
          </button>
        </div>
      </section>
    </section>
    <section class="grid grid-cols-1 gap-6 xl:grid-cols-2 dashboard-charts">
      <div class="chart-card overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Ingresos Habitaciones</h3>
            <p class="text-sm text-slate-500">Comportamiento de los ultimos 7 dias.</p>
          </div>
          <span class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">7 dias</span>
        </div>
        <div class="chart-container" style="height:320px; position: relative;"><canvas id="chart-revenue"></canvas></div>
      </div>
      <div class="chart-card overflow-hidden rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div>
            <h3 class="text-lg font-bold text-slate-800">Ocupacion</h3>
            <p class="text-sm text-slate-500">Tendencia real de habitaciones ocupadas.</p>
          </div>
          <span class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">7 dias</span>
        </div>
        <div class="chart-container" style="height:320px; position: relative;"><canvas id="chart-ocupacion"></canvas></div>
      </div>
    </section>
  `;
  console.log('[Dashboard] HTML insertado en el contenedor.');
  updateRefreshControls(container);

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
      console.log('[Dashboard] Refrescando dashboard desde initializePage...');
      await refreshDashboardData(container, hotelId, supabaseInstance);
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

  const navigationHandler = (e) => {
      const targetButton = e.target.closest('[data-navegar]');
      if (targetButton && targetButton.dataset.navegar) {
          window.location.hash = targetButton.dataset.navegar;
      }
  };
  container.addEventListener('click', navigationHandler);
  moduleDashboardListeners.push({ element: container, type: 'click', handler: navigationHandler });

  const refreshButton = container.querySelector('#dashboard-refresh-btn');
  if (refreshButton) {
      const refreshHandler = () => {
          if (!dashboardIsRefreshing) {
              refreshDashboardData(container, hotelId, supabaseInstance);
          }
      };
      refreshButton.addEventListener('click', refreshHandler);
      moduleDashboardListeners.push({ element: refreshButton, type: 'click', handler: refreshHandler });
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
  dashboardIsRefreshing = false;
  dashboardLastUpdatedAt = null;
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
