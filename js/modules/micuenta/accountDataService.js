import { getPromoBienvenidaStatus } from './pricing.js';

const DIAS_GRACIA = 2;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function resolveEffectiveHotelPlan(hotel) {
  const pendingStart = parseDate(hotel?.plan_pendiente_desde);
  const pendingDue = Boolean(hotel?.plan_pendiente && pendingStart && pendingStart <= new Date());
  if (!pendingDue) return hotel;
  return {
    ...hotel,
    plan: hotel.plan_pendiente,
    plan_id: hotel.plan_pendiente_id ?? hotel.plan_id
  };
}

function buildReferidosAnalytics(referidos = []) {
  const total = referidos.length;
  const activos = referidos.filter((item) => item.estado === 'activo').length;
  const trial = referidos.filter((item) => item.estado === 'trial').length;
  const pendientes = referidos.filter((item) => !item.recompensa_otorgada).length;
  const recompensasOtorgadas = referidos.filter((item) => item.recompensa_otorgada).length;
  return {
    total,
    activos,
    trial,
    pendientes,
    recompensasOtorgadas,
    conversionRate: total > 0 ? (activos / total) * 100 : 0
  };
}

function calcularEstadoDeVencimiento(hotel) {
  if (hotel?.suscripcion_exenta === true) {
    return {
      fechaFin: null,
      diasRestantes: null,
      enGracia: false,
      estadoEfectivo: 'interno'
    };
  }

  const fechaFin = parseDate(hotel?.suscripcion_fin || hotel?.trial_fin);
  if (!fechaFin) {
    return {
      fechaFin: null,
      diasRestantes: 0,
      enGracia: false,
      estadoEfectivo: String(hotel?.estado_suscripcion || 'vencido').toLowerCase()
    };
  }

  const hoy = new Date();
  const fechaFinMasGracia = new Date(fechaFin);
  fechaFinMasGracia.setDate(fechaFinMasGracia.getDate() + DIAS_GRACIA);
  const graciaManualHasta = parseDate(hotel?.gracia_hasta);
  const fechaLimiteGracia = graciaManualHasta && graciaManualHasta > fechaFinMasGracia
    ? graciaManualHasta
    : fechaFinMasGracia;

  if (hoy <= fechaFin) {
    return {
      fechaFin,
      diasRestantes: Math.max(0, Math.ceil((fechaFin - hoy) / 86400000)),
      enGracia: false,
      estadoEfectivo: hotel?.estado_suscripcion === 'trial' ? 'trial' : 'activo'
    };
  }

  if (hoy <= fechaLimiteGracia) {
    return {
      fechaFin,
      diasRestantes: Math.max(0, Math.ceil((fechaLimiteGracia - hoy) / 86400000)),
      enGracia: true,
      estadoEfectivo: 'vencido'
    };
  }

  return {
    fechaFin,
    diasRestantes: 0,
    enGracia: false,
    estadoEfectivo: 'vencido'
  };
}

export async function loadMiCuentaData(supabase, user, hotelId) {
  const [
    userProfileResult,
    hotelResult,
    plansResult,
    pagosResult,
    cambiosPlanResult,
    referidosResult,
    conteoHabitacionesResult,
    conteoUsuariosResult
  ] = await Promise.all([
    supabase.from('usuarios').select('*').eq('id', user.id).single(),
    supabase.from('hoteles').select('*').eq('id', hotelId).single(),
    supabase.from('planes').select('*').order('precio_mensual', { ascending: true }),
    supabase.from('pagos').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false }),
    supabase.from('cambios_plan').select('*').eq('hotel_id', hotelId).order('fecha', { ascending: false }),
    supabase
      .from('referidos')
      .select('nombre_hotel_referido, fecha_registro, estado, recompensa_otorgada')
      .eq('referidor_id', hotelId)
      .order('fecha_registro', { ascending: false }),
    supabase.from('habitaciones').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId),
    supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('hotel_id', hotelId)
  ]);

  if (userProfileResult.error) throw userProfileResult.error;
  if (hotelResult.error) throw hotelResult.error;
  if (plansResult.error) throw plansResult.error;
  if (pagosResult.error) throw pagosResult.error;
  if (cambiosPlanResult.error) throw cambiosPlanResult.error;

  const userProfile = userProfileResult.data;
  const hotelConPlan = resolveEffectiveHotelPlan(hotelResult.data);
  const estado = calcularEstadoDeVencimiento(hotelConPlan);
  const hotel = {
    ...hotelConPlan,
    estado_suscripcion: estado.estadoEfectivo
  };
  const plans = safeArray(plansResult.data);
  const pagos = safeArray(pagosResult.data);
  const cambiosPlan = safeArray(cambiosPlanResult.data);
  const referidos = safeArray(referidosResult.data);
  const referidosAnalytics = buildReferidosAnalytics(referidos);

  const hotelPlanNombre = String(hotel?.plan ?? '').trim().toLowerCase();
  const hotelPlanId = hotel?.plan_id != null ? String(hotel.plan_id) : '';
  const planActivo = plans.find((plan) => {
    const planNombre = String(plan?.nombre ?? '').trim().toLowerCase();
    const planId = plan?.id != null ? String(plan.id) : '';
    return planNombre === hotelPlanNombre || (hotelPlanId && planId === hotelPlanId);
  });

  const promoBienvenida = getPromoBienvenidaStatus(hotel, pagos);
  const rolNormalizado = String(userProfile?.rol || '').trim().toLowerCase();
  const esSuperAdmin = (
    rolNormalizado === 'admin' ||
    rolNormalizado === 'administrador' ||
    rolNormalizado === 'superadmin' ||
    (hotel?.creado_por && userProfile?.id === hotel.creado_por)
  );

  return {
    userProfile,
    hotel,
    plans,
    pagos,
    cambiosPlan,
    referidos,
    referidosAnalytics,
    planActivo,
    promoBienvenida,
    fechaFin: estado.fechaFin,
    diasRestantes: estado.diasRestantes,
    enGracia: estado.enGracia,
    esSuperAdmin,
    conteoHabitaciones: conteoHabitacionesResult.count || 0,
    conteoUsuarios: conteoUsuariosResult.count || 0,
    countErrors: {
      habitaciones: conteoHabitacionesResult.error,
      usuarios: conteoUsuariosResult.error
    },
    referidosError: referidosResult.error || null
  };
}
