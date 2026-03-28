import { formatDateTime } from '../uiUtils.js';
import { getReservaToleranceStatus } from '../modules/reservas/reservas-operacion.js';

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export async function loadOperationTodaySnapshot(supabase, hotelId) {
  const now = new Date();
  const start = startOfDay(now).toISOString();
  const end = endOfDay(now).toISOString();

  const [
    { data: config },
    { data: llegadas },
    { data: salidas },
    { data: habitaciones },
    { data: tareas },
    { count: turnosAbiertos }
  ] = await Promise.all([
    supabase.from('configuracion_hotel').select('minutos_tolerancia_llegada, minutos_alerta_checkout').eq('hotel_id', hotelId).maybeSingle(),
    supabase
      .from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .gte('fecha_inicio', start)
      .lte('fecha_inicio', end)
      .order('fecha_inicio', { ascending: true }),
    supabase
      .from('reservas')
      .select('id, cliente_nombre, fecha_inicio, fecha_fin, estado, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .gte('fecha_fin', start)
      .lte('fecha_fin', end)
      .order('fecha_fin', { ascending: true }),
    supabase.from('habitaciones').select('id, nombre, estado').eq('hotel_id', hotelId),
    supabase
      .from('tareas_mantenimiento')
      .select('id, titulo, estado, tipo, fecha_programada, habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .in('estado', ['pendiente', 'en_progreso'])
      .order('fecha_programada', { ascending: true }),
    supabase.from('turnos').select('*', { count: 'exact', head: true }).eq('hotel_id', hotelId).is('fecha_cierre', null)
  ]);

  const toleranceConfig = {
    minutos_tolerancia_llegada: Number(config?.minutos_tolerancia_llegada) || 60
  };

  const formattedArrivals = (llegadas || []).map((item) => ({
    ...item,
    schedule: formatDateTime(item.fecha_inicio, undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
    tolerance: getReservaToleranceStatus(item, toleranceConfig, now)
  }));

  const formattedDepartures = (salidas || []).map((item) => {
    const checkoutAt = item?.fecha_fin ? new Date(item.fecha_fin) : null;
    const minutesLate = checkoutAt ? Math.round((now.getTime() - checkoutAt.getTime()) / 60000) : null;
    return {
      ...item,
      schedule: formatDateTime(item.fecha_fin, undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
      isLate: Number.isFinite(minutesLate) && minutesLate > (Number(config?.minutos_alerta_checkout) || 30),
      lateMinutes: Math.max(0, minutesLate || 0)
    };
  });

  const rooms = habitaciones || [];
  const pendingCleaning = rooms.filter((room) => room.estado === 'limpieza');
  const occupied = rooms.filter((room) => ['ocupada', 'activa', 'tiempo_agotado', 'tiempo agotado'].includes(String(room.estado || '').toLowerCase()));

  const attentionList = [
    ...formattedArrivals
      .filter((item) => item.tolerance.level === 'no_show_sugerido')
      .map((item) => ({
        kind: 'Reserva',
        title: `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Habitación'}`,
        helper: 'La llegada ya superó la tolerancia configurada.',
        route: '#/reservas'
      })),
    ...formattedDepartures
      .filter((item) => item.isLate)
      .map((item) => ({
        kind: 'Checkout',
        title: `${item.cliente_nombre || 'Cliente'} · ${item.habitaciones?.nombre || 'Habitación'}`,
        helper: `Salida vencida hace ${item.lateMinutes} min.`,
        route: '#/mapa-habitaciones'
      })),
    ...pendingCleaning.slice(0, 5).map((room) => ({
      kind: 'Limpieza',
      title: room.nombre || 'Habitación',
      helper: 'Sigue pendiente de limpieza.',
      route: '#/limpieza'
    })),
    ...(tareas || []).slice(0, 5).map((task) => ({
      kind: 'Mantenimiento',
      title: task.titulo || 'Tarea abierta',
      helper: task.habitaciones?.nombre ? `Habitación ${task.habitaciones.nombre}` : 'Seguimiento general',
      route: '#/mantenimiento'
    }))
  ].slice(0, 8);

  return {
    metrics: {
      arrivalsToday: formattedArrivals.length,
      departuresToday: formattedDepartures.length,
      occupiedNow: occupied.length,
      cleaningNow: pendingCleaning.length,
      maintenanceOpen: (tareas || []).length,
      openShifts: Number(turnosAbiertos || 0)
    },
    arrivals: formattedArrivals,
    departures: formattedDepartures,
    attentionList
  };
}
