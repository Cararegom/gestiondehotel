import { getPromoBienvenidaStatus } from './pricing.js';

const DIAS_GRACIA = 2;

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveEffectiveHotelPlan(hotel) {
  const pendingStart = hotel?.plan_pendiente_desde ? new Date(hotel.plan_pendiente_desde) : null;
  const pendingDue = Boolean(
    hotel?.plan_pendiente &&
    pendingStart &&
    !Number.isNaN(pendingStart.getTime()) &&
    pendingStart <= new Date()
  );

  if (!pendingDue) {
    return hotel;
  }

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
  const conversionRate = total > 0 ? (activos / total) * 100 : 0;

  return {
    total,
    activos,
    trial,
    pendientes,
    recompensasOtorgadas,
    conversionRate
  };
}

function calcularEstadoDeVencimiento(hotel) {
  const fechaFin = new Date(hotel?.suscripcion_fin || hotel?.trial_fin || Date.now());
  const hoy = new Date();
  let diasRestantes = Math.ceil((fechaFin - hoy) / (1000 * 60 * 60 * 24));
  let enGracia = false;

  const fechaFinMasGracia = new Date(fechaFin);
  fechaFinMasGracia.setDate(fechaFinMasGracia.getDate() + DIAS_GRACIA);
  const graciaManualHasta = hotel?.gracia_hasta ? new Date(hotel.gracia_hasta) : null;
  const fechaLimiteGracia = graciaManualHasta && !Number.isNaN(graciaManualHasta.getTime()) && graciaManualHasta > fechaFinMasGracia
    ? graciaManualHasta
    : fechaFinMasGracia;

  if (hotel?.estado_suscripcion === 'vencido' && hoy <= fechaLimiteGracia) {
    enGracia = true;
    diasRestantes = Math.ceil((fechaLimiteGracia - hoy) / (1000 * 60 * 60 * 24));
  }

  return {
    fechaFin,
    diasRestantes: Math.max(0, diasRestantes),
    enGracia
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
  const hotel = resolveEffectiveHotelPlan(hotelResult.data);
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
  const { fechaFin, diasRestantes, enGracia } = calcularEstadoDeVencimiento(hotel);
  const esSuperAdmin = (
    userProfile?.rol === 'admin' ||
    userProfile?.rol === 'superadmin' ||
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
    fechaFin,
    diasRestantes,
    enGracia,
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
