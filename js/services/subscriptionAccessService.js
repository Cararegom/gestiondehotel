export const SUBSCRIPTION_GRACE_DAYS = 2;

export const PLAN_EXEMPT_MODULES = Object.freeze([
  'micuenta',
  'faq',
  'bitacora',
  'ops-saas',
  'soporte',
  'onboarding',
  'sandbox',
  'operacion-hoy',
  'control-energia',
  'finanzas-cuentas',
  'gastos',
  'costeo'
]);

const DAY_IN_MS = 86400000;

function parseDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeModules(modules) {
  return Array.isArray(modules) ? modules : [];
}

export function createRestrictedPlanDetails(name, allowedModules = ['micuenta']) {
  return {
    nombre: name,
    funcionalidades: {
      limite_habitaciones: 0,
      modulos_permitidos: [...normalizeModules(allowedModules)]
    }
  };
}

export function buildSuperadminPlanDetails() {
  return createRestrictedPlanDetails(
    'Superadmin SaaS',
    ['ops-saas', 'bitacora', 'soporte', 'faq']
  );
}

export function resolveEffectiveHotelPlan(hotel, now = new Date()) {
  if (!hotel) return hotel;

  const pendingStart = parseDate(hotel.plan_pendiente_desde);
  const referenceDate = parseDate(now) || new Date();
  const pendingDue = Boolean(
    hotel.plan_pendiente &&
    pendingStart &&
    pendingStart <= referenceDate
  );

  if (!pendingDue) return hotel;

  return {
    ...hotel,
    plan: hotel.plan_pendiente,
    plan_id: hotel.plan_pendiente_id ?? hotel.plan_id
  };
}

export function calculateSubscriptionStatus(hotel, now = new Date()) {
  if (hotel?.suscripcion_exenta === true) {
    return {
      fechaFin: null,
      fechaLimiteGracia: null,
      diasRestantes: null,
      enGracia: false,
      fueraDeGracia: false,
      estadoEfectivo: 'interno'
    };
  }

  const persistedStatus = String(hotel?.estado_suscripcion || 'vencido').trim().toLowerCase();
  const fechaFin = parseDate(hotel?.suscripcion_fin || hotel?.trial_fin);
  const referenceDate = parseDate(now) || new Date();

  if (!fechaFin) {
    return {
      fechaFin: null,
      fechaLimiteGracia: null,
      diasRestantes: 0,
      enGracia: false,
      fueraDeGracia: false,
      estadoEfectivo: persistedStatus
    };
  }

  const fechaFinMasGracia = new Date(fechaFin);
  fechaFinMasGracia.setDate(fechaFinMasGracia.getDate() + SUBSCRIPTION_GRACE_DAYS);
  const graciaManualHasta = parseDate(hotel?.gracia_hasta);
  const fechaLimiteGracia = graciaManualHasta && graciaManualHasta > fechaFinMasGracia
    ? graciaManualHasta
    : fechaFinMasGracia;

  if (referenceDate <= fechaFin) {
    return {
      fechaFin,
      fechaLimiteGracia,
      diasRestantes: Math.max(0, Math.ceil((fechaFin - referenceDate) / DAY_IN_MS)),
      enGracia: false,
      fueraDeGracia: false,
      estadoEfectivo: persistedStatus === 'trial' ? 'trial' : 'activo'
    };
  }

  if (referenceDate <= fechaLimiteGracia) {
    return {
      fechaFin,
      fechaLimiteGracia,
      diasRestantes: Math.max(0, Math.ceil((fechaLimiteGracia - referenceDate) / DAY_IN_MS)),
      enGracia: true,
      fueraDeGracia: false,
      estadoEfectivo: 'vencido'
    };
  }

  return {
    fechaFin,
    fechaLimiteGracia,
    diasRestantes: 0,
    enGracia: false,
    fueraDeGracia: persistedStatus === 'vencido',
    estadoEfectivo: 'vencido'
  };
}

export function getAllowedPlanModules(planDetails) {
  return normalizeModules(planDetails?.funcionalidades?.modulos_permitidos);
}

export function isPlanExemptModule(moduleKey) {
  return PLAN_EXEMPT_MODULES.includes(moduleKey);
}

export function isModuleAccessibleForPlan(moduleKey, allowedModules = [], access = {}) {
  if (!moduleKey) return false;
  if (isPlanExemptModule(moduleKey)) return true;
  if (moduleKey === 'terraza') return access.canAccessTerraza === true;
  if (moduleKey === 'pagos-bancarios') return access.canAccessBankPayments === true;
  return normalizeModules(allowedModules).includes(moduleKey);
}

export function getExpiredSubscriptionRouteDecision({ fueraDeGracia, esAdmin, baseRoute }) {
  if (!fueraDeGracia) return 'allow';
  if (!esAdmin) return 'block-staff';
  return baseRoute === '/micuenta' ? 'allow' : 'redirect-micuenta';
}

export async function loadHotelSubscriptionContext(supabase, hotelId, { now = new Date() } = {}) {
  if (!hotelId) {
    return {
      hotel: null,
      planDetails: createRestrictedPlanDetails('Invitado'),
      subscriptionStatus: calculateSubscriptionStatus(null, now)
    };
  }

  const { data: hotelData, error: hotelError } = await supabase
    .from('hoteles')
    .select('id, nombre, plan, plan_id, plan_pendiente, plan_pendiente_id, plan_pendiente_desde, estado_suscripcion, suscripcion_fin, trial_fin, gracia_hasta, gracia_motivo, suscripcion_exenta, creado_por')
    .eq('id', hotelId)
    .single();

  if (hotelError) throw hotelError;
  if (!hotelData) throw new Error(`Hotel con ID ${hotelId} no encontrado.`);

  const hotel = resolveEffectiveHotelPlan(hotelData, now);
  const subscriptionStatus = calculateSubscriptionStatus(hotel, now);

  if (!hotel.plan) {
    return {
      hotel,
      planDetails: createRestrictedPlanDetails('SinPlanAsignado', ['dashboard', 'micuenta']),
      subscriptionStatus
    };
  }

  const { data: planData, error: planError } = await supabase
    .from('planes')
    .select('nombre, funcionalidades')
    .eq('nombre', hotel.plan)
    .single();

  if (planError) throw planError;
  if (!planData) {
    throw new Error(`Detalles del plan '${hotel.plan}' no encontrados en tabla 'planes'.`);
  }

  return {
    hotel,
    planDetails: planData,
    subscriptionStatus
  };
}
