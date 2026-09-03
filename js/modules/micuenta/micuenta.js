// modules/micuenta/micuenta.js

import { abrirCheckoutSuscripcion } from './checkoutSuscripcionService.js';
import { loadMiCuentaData } from './accountDataService.js';
import {
  USD_PRICES,
  PROMO_BIENVENIDA_MESES,
  alertaVencimientoHTML,
  applyPromoBienvenida,
  formatMoneda,
  getBasePlanAmounts,
  getPromoBienvenidaHTML
} from './pricing.js';
import { registrarAccionSensible } from '../../services/sensitiveAuditService.js';

let snackbarTimeout = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showSnackbar(container, message, type = 'success') {
  let snackbar = container.querySelector('#micuenta-snackbar');
  if (!snackbar) {
    snackbar = document.createElement('div');
    snackbar.id = 'micuenta-snackbar';
    snackbar.className = 'fixed bottom-6 right-6 z-50 bg-white shadow-xl rounded-xl px-4 py-3 text-sm font-medium border transition-all';
    container.appendChild(snackbar);
  }
  snackbar.textContent = message;
  snackbar.classList.remove('bg-green-100', 'bg-red-100', 'border-green-500', 'border-red-500', 'text-green-700', 'text-red-700', 'opacity-0');
  if (type === 'error') {
    snackbar.classList.add('bg-red-100', 'border-red-500', 'text-red-700');
  } else {
    snackbar.classList.add('bg-green-100', 'border-green-500', 'text-green-700');
  }
  snackbar.style.opacity = '1';
  clearTimeout(snackbarTimeout);
  snackbarTimeout = setTimeout(() => { snackbar.style.opacity = '0'; }, 3300);
}

function parseDateSafe(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safePlanFeatures(plan) {
  return Array.isArray(plan?.funcionalidades?.descripcion_features)
    ? plan.funcionalidades.descripcion_features
    : [];
}

function normalizeLimit(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function getPlanLimits(plan) {
  return {
    habitaciones: normalizeLimit(plan?.funcionalidades?.limite_habitaciones),
    usuarios: normalizeLimit(plan?.funcionalidades?.limite_usuarios)
  };
}

function getUsageMeta(current, limit) {
  if (limit == null || limit <= 0) {
    return {
      percent: 0,
      width: 0,
      label: `${current} / Sin límite`,
      nearingLimit: false
    };
  }
  const percent = Math.max(0, Math.round((current / limit) * 100));
  return {
    percent,
    width: Math.min(100, percent),
    label: `${current} / ${limit}`,
    nearingLimit: percent >= 80
  };
}

function getBillingCycleSnapshot(hotel, diasRestantes) {
  const fechaFinCiclo = parseDateSafe(hotel?.suscripcion_fin || hotel?.trial_fin);
  if (!fechaFinCiclo) {
    return {
      fechaInicioCiclo: new Date(),
      fechaFinCiclo: null,
      diasCicloSeguro: 30,
      diasRestantesSeguro: Math.max(0, Number(diasRestantes || 0))
    };
  }

  let fechaInicioCiclo = parseDateSafe(hotel?.suscripcion_inicio || hotel?.trial_inicio || hotel?.creado_en);
  const rangoDiasActual = fechaInicioCiclo
    ? Math.ceil((fechaFinCiclo.getTime() - fechaInicioCiclo.getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  if (!fechaInicioCiclo || rangoDiasActual <= 0 || rangoDiasActual > 45) {
    fechaInicioCiclo = new Date(fechaFinCiclo);
    fechaInicioCiclo.setDate(fechaInicioCiclo.getDate() - 30);
  }

  const diasCicloTotal = Math.ceil((fechaFinCiclo.getTime() - fechaInicioCiclo.getTime()) / (1000 * 60 * 60 * 24));
  return {
    fechaInicioCiclo,
    fechaFinCiclo,
    diasCicloSeguro: Math.max(1, Number.isFinite(diasCicloTotal) ? diasCicloTotal : 30),
    diasRestantesSeguro: Math.max(0, Number(diasRestantes || 0))
  };
}

function buildPlanPendienteNotice(hotel) {
  const pendingPlan = String(hotel?.plan_pendiente || '').trim();
  const pendingStart = parseDateSafe(hotel?.plan_pendiente_desde);
  if (!pendingPlan || !pendingStart || pendingStart <= new Date()) return '';

  return `
    <div class="mt-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-900">
      <b>Cambio programado:</b> tu plan pasará a <b>${escapeHtml(pendingPlan)}</b> al finalizar el ciclo actual, el ${pendingStart.toLocaleDateString('es-CO')}.
    </div>
  `;
}

function getPlanPrice(plan, currency = 'COP', period = 'mensual') {
  const amounts = getBasePlanAmounts(plan, period);
  return currency === 'USD' ? amounts.baseUSD : amounts.baseCOP;
}

function getAnnualSavings(plan, currency = 'COP') {
  const monthly = getPlanPrice(plan, currency, 'mensual');
  const annual = getPlanPrice(plan, currency, 'anual');
  return Math.max(0, (monthly * 12) - annual);
}

function isPlanEligibleForUsage(plan, rooms, users) {
  const limits = getPlanLimits(plan);
  if (limits.habitaciones != null && rooms > limits.habitaciones) return false;
  if (limits.usuarios != null && users > limits.usuarios) return false;
  return true;
}

function findRecommendedUpgrade(plans, currentPlan, rooms, users) {
  if (!currentPlan || !Array.isArray(plans)) return null;
  const currentLimits = getPlanLimits(currentPlan);
  const roomUsage = getUsageMeta(rooms, currentLimits.habitaciones);
  const userUsage = getUsageMeta(users, currentLimits.usuarios);
  if (!roomUsage.nearingLimit && !userUsage.nearingLimit) return null;

  const currentPrice = Number(currentPlan.precio_mensual || 0);
  return plans
    .filter(plan => Number(plan.precio_mensual || 0) > currentPrice)
    .filter(plan => isPlanEligibleForUsage(plan, rooms, users))
    .sort((a, b) => Number(a.precio_mensual || 0) - Number(b.precio_mensual || 0))[0] || null;
}

function buildRecommendationReason(currentPlan, recommendedPlan, rooms, users) {
  if (!currentPlan || !recommendedPlan) return '';
  const limits = getPlanLimits(currentPlan);
  const reasons = [];
  const roomUsage = getUsageMeta(rooms, limits.habitaciones);
  const userUsage = getUsageMeta(users, limits.usuarios);
  if (roomUsage.nearingLimit && limits.habitaciones != null) {
    reasons.push(`ya usas ${rooms} de ${limits.habitaciones} habitaciones`);
  }
  if (userUsage.nearingLimit && limits.usuarios != null) {
    reasons.push(`ya usas ${users} de ${limits.usuarios} usuarios`);
  }
  return reasons.length
    ? `Te recomendamos ${recommendedPlan.nombre} porque ${reasons.join(' y ')}.`
    : `El plan ${recommendedPlan.nombre} te da más capacidad para seguir creciendo.`;
}

function buildRenewalMessage(diasRestantes, estado) {
  if (estado === 'vencido') {
    return {
      eyebrow: 'Renovación prioritaria',
      title: 'Mantén tu operación sin interrupciones',
      body: 'Renueva ahora para conservar el acceso completo del hotel.'
    };
  }
  if (diasRestantes <= 3) {
    return {
      eyebrow: 'Tu renovación está muy cerca',
      title: `Quedan ${diasRestantes} días de tu ciclo`,
      body: 'Puedes renovar desde ahora y dejar el próximo período asegurado.'
    };
  }
  if (diasRestantes <= 15) {
    return {
      eyebrow: 'Próxima renovación',
      title: `Tu plan vence en ${diasRestantes} días`,
      body: 'Renovar anticipadamente evita pendientes y mantiene la operación continua.'
    };
  }
  return {
    eyebrow: 'Suscripción al día',
    title: 'Tu hotel está cubierto',
    body: 'Revisa el uso de tu plan y mejora solo cuando tu operación realmente lo necesite.'
  };
}

function renderUsageCard({ icon, title, meta }) {
  const barClass = meta.nearingLimit ? 'bg-amber-500' : 'bg-blue-600';
  return `
    <div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-sm font-semibold text-slate-700"><span>${icon}</span>${escapeHtml(title)}</div>
        <div class="text-sm font-bold text-slate-900">${escapeHtml(meta.label)}</div>
      </div>
      ${meta.label.includes('Sin límite') ? `
        <div class="mt-3 text-xs text-slate-500">Tu plan no tiene un límite numérico configurado para este recurso.</div>
      ` : `
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
          <div class="h-full ${barClass} transition-all" style="width:${meta.width}%"></div>
        </div>
        <div class="mt-2 text-xs ${meta.nearingLimit ? 'font-semibold text-amber-700' : 'text-slate-500'}">${meta.percent}% utilizado${meta.nearingLimit ? ' · cerca del límite' : ''}</div>
      `}
    </div>
  `;
}

function paymentTypeLabel(value) {
  const type = String(value || '').toLowerCase();
  if (type === 'upgrade') return 'Mejora de plan';
  if (type === 'renew-downgrade') return 'Cambio próximo ciclo';
  if (type === 'renew') return 'Renovación';
  return 'Pago de suscripción';
}

export async function mount(container, supabase, user, hotelId) {
  container.innerHTML = `<div class="flex justify-center items-center min-h-[60vh] text-xl text-gray-500 animate-pulse">Cargando tu cuenta...</div>`;

  let dataContext;
  try {
    dataContext = await loadMiCuentaData(supabase, user, hotelId);
  } catch (error) {
    console.error('[Mi Cuenta] Error cargando informacion base:', error);
    container.innerHTML = `
      <div class="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div class="text-4xl">⚠️</div>
        <div class="text-xl font-semibold text-slate-800">No pudimos cargar la cuenta.</div>
        <div class="max-w-lg text-sm text-slate-500">Intenta recargar la página. Si el problema continúa, escribe a soporte.</div>
      </div>`;
    return;
  }

  const {
    userProfile,
    hotel,
    plans,
    pagos: pagosSafe,
    cambiosPlan: cambiosPlanSafe,
    referidos: referidosSafe,
    referidosAnalytics,
    planActivo,
    promoBienvenida,
    fechaFin,
    diasRestantes,
    enGracia,
    esSuperAdmin,
    conteoHabitaciones,
    conteoUsuarios,
    countErrors,
    referidosError
  } = dataContext;

  if (referidosError) console.warn('[Mi Cuenta] Error de referidos:', referidosError.message);
  if (countErrors?.habitaciones || countErrors?.usuarios) {
    console.error('Error obteniendo conteo de recursos:', countErrors.habitaciones, countErrors.usuarios);
  }

  if (!esSuperAdmin) {
    container.innerHTML = `<div class="flex flex-col justify-center items-center min-h-[60vh]"><span class="text-5xl mb-3">🔒</span><div class="text-2xl font-bold mb-2 text-red-600">Acceso restringido</div><div class="text-gray-500 text-lg text-center">Esta sección está reservada para el administrador responsable de la suscripción del hotel.</div></div>`;
    return;
  }

  const rooms = Number(conteoHabitaciones || 0);
  const users = Number(conteoUsuarios || 0);
  const limits = getPlanLimits(planActivo);
  const roomUsage = getUsageMeta(rooms, limits.habitaciones);
  const userUsage = getUsageMeta(users, limits.usuarios);
  const recommendedPlan = findRecommendedUpgrade(plans, planActivo, rooms, users);
  const recommendationReason = buildRecommendationReason(planActivo, recommendedPlan, rooms, users);
  const renewalMessage = buildRenewalMessage(diasRestantes, hotel.estado_suscripcion);
  const refLink = `https://gestiondehotel.com/index.html?ref=${encodeURIComponent(hotel.id)}`;
  let monedaActual = 'COP';
  let periodoActual = 'mensual';

  const safeUserName = escapeHtml(userProfile?.nombre || user.email || 'Administrador');
  const safeHotelName = escapeHtml(hotel?.nombre || 'Hotel');
  const safePlanName = escapeHtml(planActivo?.nombre || hotel?.plan || 'N/A');
  const safeStatus = escapeHtml(hotel?.estado_suscripcion || 'N/A');
  const safeEmail = escapeHtml(user.email || '');

  container.innerHTML = `
    <div class="max-w-6xl mx-auto py-6 md:py-8 px-3 md:px-5 relative">
      <div class="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-7">
        <div>
          <div class="text-xs font-bold uppercase tracking-wide text-blue-600">Cuenta y suscripción</div>
          <h2 class="mt-1 text-3xl font-bold text-slate-900">Haz que tu plan acompañe el crecimiento del hotel</h2>
          <p class="mt-2 text-sm text-slate-500">${safeHotelName} · Administrado por ${safeUserName}</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <label class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
            Moneda
            <select id="monedaSelector" class="ml-2 bg-transparent font-bold text-slate-900 outline-none">
              <option value="COP">COP</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label class="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
            Pago
            <select id="tipoPagoSelector" class="ml-2 bg-transparent font-bold text-slate-900 outline-none">
              <option value="mensual">Mensual</option>
              <option value="anual">Anual · 2 meses gratis</option>
            </select>
          </label>
        </div>
      </div>

      ${alertaVencimientoHTML(diasRestantes, hotel.estado_suscripcion, enGracia)}
      <div id="promo-bienvenida-banner">${getPromoBienvenidaHTML(promoBienvenida, periodoActual)}</div>

      <section class="rounded-3xl bg-slate-950 p-5 md:p-7 text-white shadow-xl mb-6">
        <div class="grid gap-6 lg:grid-cols-2 lg:items-center">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-full bg-white bg-opacity-10 px-3 py-1 text-xs font-semibold">Plan ${safePlanName}</span>
              <span class="rounded-full bg-emerald-900 px-3 py-1 text-xs font-semibold text-emerald-200">${safeStatus}</span>
            </div>
            <h3 class="mt-4 text-2xl md:text-3xl font-bold">${escapeHtml(renewalMessage.title)}</h3>
            <p class="mt-2 max-w-2xl text-sm text-slate-300">${escapeHtml(renewalMessage.body)}</p>
            <div class="mt-5 flex flex-wrap items-center gap-3 text-sm">
              <span class="rounded-xl bg-white bg-opacity-10 px-3 py-2"><b>Vence:</b> ${fechaFin ? fechaFin.toLocaleDateString('es-CO') : 'N/A'}</span>
              <span class="rounded-xl bg-white bg-opacity-10 px-3 py-2"><b>Restan:</b> ${diasRestantes} días</span>
            </div>
          </div>
          <div class="rounded-2xl bg-white p-4 text-slate-900">
            <div class="text-xs font-bold uppercase tracking-wide text-emerald-600">${escapeHtml(renewalMessage.eyebrow)}</div>
            <div id="renewal-price-preview" class="mt-2 text-sm text-slate-500">Calculando renovación...</div>
            <button id="btnRenovarPlan" class="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-base font-bold text-white shadow-lg transition hover:bg-emerald-700">
              Renovar ahora
            </button>
            <div id="annual-saving-preview" class="mt-3 text-xs text-slate-500"></div>
          </div>
        </div>
      </section>

      ${buildPlanPendienteNotice(hotel)}

      <section class="mb-6">
        <div class="mb-3 flex items-end justify-between gap-3">
          <div>
            <h3 class="text-xl font-bold text-slate-900">Uso actual de tu plan</h3>
            <p class="text-sm text-slate-500">Tu operación real es la que define si vale la pena mejorar.</p>
          </div>
        </div>
        <div class="grid gap-4 md:grid-cols-2">
          ${renderUsageCard({ icon: '🚪', title: 'Habitaciones', meta: roomUsage })}
          ${renderUsageCard({ icon: '👥', title: 'Usuarios', meta: userUsage })}
        </div>
      </section>

      ${recommendedPlan ? `
        <section class="mb-6 rounded-3xl border border-indigo-200 bg-indigo-50 p-5 md:p-6 shadow-sm">
          <div class="grid gap-5 md:grid-cols-2 md:items-center">
            <div>
              <div class="text-xs font-bold uppercase tracking-wide text-indigo-600">Recomendación basada en tu uso</div>
              <h3 class="mt-2 text-xl font-bold text-slate-900">Tu operación está acercándose a los límites de ${safePlanName}</h3>
              <p class="mt-2 text-sm text-slate-600">${escapeHtml(recommendationReason)}</p>
              <p class="mt-1 text-xs text-slate-500">No necesitas cambiar hoy si todavía tienes margen; esta recomendación aparece porque tu uso ya supera el 80% de al menos un límite configurado.</p>
            </div>
            <div class="md:text-right"><button class="btn-ir-plan-recomendado rounded-xl bg-indigo-600 px-5 py-3 font-bold text-white shadow transition hover:bg-indigo-700" data-plan-id="${escapeHtml(recommendedPlan.id)}">Ver ${escapeHtml(recommendedPlan.nombre)}</button></div>
          </div>
        </section>
      ` : `
        <section class="mb-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
          <b>Tu plan actual todavía tiene margen.</b> No te recomendamos subir de plan únicamente por venderte más: mejora cuando tu operación lo necesite o cuando otro plan tenga funciones que realmente vayas a usar.
        </section>
      `}

      <section class="bg-white shadow-sm border border-slate-200 rounded-3xl p-5 md:p-6 mb-8">
        <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div class="text-xs font-bold uppercase tracking-wide text-blue-600">Planes disponibles</div>
            <h3 class="mt-1 text-2xl font-bold text-slate-900">Compara antes de decidir</h3>
            <p class="mt-1 text-sm text-slate-500">El precio cambia con la moneda y el período seleccionados arriba.</p>
          </div>
          <div class="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">Anual = pagas 10 meses y recibes 12</div>
        </div>
        <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5" id="planes-list"></div>
      </section>

      <section class="grid grid-cols-1 xl:grid-cols-2 gap-5 mb-8">
        <div class="bg-white border border-slate-200 shadow-sm rounded-3xl p-5 md:p-6">
          <div class="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 class="text-lg font-bold text-slate-900">Historial de pagos</h3>
              <p class="text-xs text-slate-500">Consulta qué pagaste y para qué operación de suscripción.</p>
            </div>
          </div>
          <div class="overflow-auto">
            <table class="w-full min-w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">Fecha</th><th>Plan</th><th>Monto</th><th>Operación</th><th>Proveedor</th><th>Período</th></tr></thead>
              <tbody>
                ${pagosSafe.length === 0 ? `<tr><td colspan="6" class="text-slate-400 py-4 text-center">Sin pagos registrados</td></tr>` : pagosSafe.map(p => `<tr class="border-b border-slate-100"><td class="py-2">${p.fecha ? new Date(p.fecha).toLocaleDateString('es-CO') : '-'}</td><td>${escapeHtml(p.plan || '-')}</td><td class="font-semibold">${formatMoneda(p.monto, p.moneda)}</td><td>${escapeHtml(paymentTypeLabel(p.payment_type))}</td><td>${escapeHtml(p.provider || p.metodo_pago || '-')}</td><td>${escapeHtml(p.billing_period || '-')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="bg-white border border-slate-200 shadow-sm rounded-3xl p-5 md:p-6">
          <h3 class="text-lg font-bold text-slate-900 mb-1">Cambios de plan</h3>
          <p class="text-xs text-slate-500 mb-4">Trazabilidad de mejoras y cambios programados.</p>
          <div class="overflow-auto">
            <table class="w-full min-w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">Fecha</th><th>De</th><th>A</th><th>Origen</th></tr></thead>
              <tbody>
                ${cambiosPlanSafe.length === 0 ? `<tr><td colspan="4" class="text-slate-400 py-4 text-center">Sin cambios registrados</td></tr>` : cambiosPlanSafe.map(c => `<tr class="border-b border-slate-100"><td class="py-2">${c.fecha ? new Date(c.fecha).toLocaleDateString('es-CO') : '-'}</td><td>${escapeHtml(c.plan_anterior || '-')}</td><td>${escapeHtml(c.plan_nuevo || '-')}</td><td>${escapeHtml(c.usuario_nombre || '-')}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="bg-white border border-slate-200 shadow-sm rounded-3xl p-5 md:p-6 mb-8">
        <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div class="text-xs font-bold uppercase tracking-wide text-slate-500">Seguridad de la cuenta</div>
            <h3 class="mt-1 text-xl font-bold text-slate-900">Datos del administrador</h3>
            <p class="mt-1 text-sm text-slate-500">Correo actual: <b>${safeEmail}</b></p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button id="btnCambiarCorreo" class="rounded-xl border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-bold text-blue-700 hover:bg-blue-100">Cambiar correo</button>
            <button id="btnCambiarPass" class="rounded-xl border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100">Cambiar mi contraseña</button>
          </div>
        </div>
      </section>

      <details class="bg-white border border-slate-200 shadow-sm rounded-3xl p-5 md:p-6 mb-8">
        <summary class="cursor-pointer list-none">
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="text-xs font-bold uppercase tracking-wide text-indigo-600">Programa de referidos</div>
              <h3 class="mt-1 text-lg font-bold text-slate-900">Gana 30 días por cada hotel referido que pague</h3>
            </div>
            <span class="rounded-full bg-indigo-50 px-3 py-1 text-sm font-bold text-indigo-700">${referidosAnalytics.activos} activos</span>
          </div>
        </summary>
        <div class="mt-5">
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <div class="rounded-xl bg-slate-50 p-3"><div class="text-xs text-slate-500">Total</div><div class="text-xl font-bold">${referidosAnalytics.total}</div></div>
            <div class="rounded-xl bg-emerald-50 p-3"><div class="text-xs text-emerald-700">Activos</div><div class="text-xl font-bold text-emerald-800">${referidosAnalytics.activos}</div></div>
            <div class="rounded-xl bg-amber-50 p-3"><div class="text-xs text-amber-700">Trial</div><div class="text-xl font-bold text-amber-800">${referidosAnalytics.trial}</div></div>
            <div class="rounded-xl bg-rose-50 p-3"><div class="text-xs text-rose-700">Pendientes</div><div class="text-xl font-bold text-rose-800">${referidosAnalytics.pendientes}</div></div>
            <div class="rounded-xl bg-blue-50 p-3"><div class="text-xs text-blue-700">Conversión</div><div class="text-xl font-bold text-blue-800">${referidosAnalytics.conversionRate.toFixed(0)}%</div></div>
          </div>
          <div class="flex flex-col sm:flex-row gap-2 mb-4">
            <input type="text" class="form-control w-full" value="${escapeHtml(refLink)}" readonly id="refLinkInput">
            <button class="btn btn-accent" id="btnCopyRefLink">Copiar enlace</button>
          </div>
          <div class="overflow-auto">
            <table class="w-full min-w-full text-xs">
              <thead><tr class="text-left text-slate-500 border-b"><th class="py-2">Hotel referido</th><th>Estado</th><th>Registro</th><th>Recompensa</th></tr></thead>
              <tbody>
                ${referidosSafe.length === 0 ? `<tr><td colspan="4" class="text-slate-400 py-4 text-center">Aún no tienes hoteles referidos.</td></tr>` : referidosSafe.map(r => `<tr class="border-b border-slate-100"><td class="py-2">${escapeHtml(r.nombre_hotel_referido || '-')}</td><td>${escapeHtml(r.estado || '-')}</td><td>${r.fecha_registro ? new Date(r.fecha_registro).toLocaleDateString('es-CO') : '-'}</td><td>${r.recompensa_otorgada ? '✔️ Otorgada' : '⏳ Pendiente'}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <div class="flex flex-col items-center justify-center text-xs text-slate-400 pt-4 pb-2">Gestión de Hotel es un producto de Grupo Empresarial Areiza Gomez</div>
    </div>

    <div id="modalUpgrade" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden p-4">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-md w-full relative">
        <button id="closeUpgradeModal" class="absolute top-2 right-3 text-slate-400 hover:text-red-500 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-2 text-blue-700">Confirmar cambio de plan</h3>
        <div class="mb-2"><span id="modalPlanName"></span></div>
        <div class="mb-3 text-sm text-slate-500">Tu ciclo actual vence el <b>${fechaFin ? fechaFin.toLocaleDateString('es-CO') : ''}</b>. Quedan <b>${diasRestantes}</b> días.</div>
        <div id="prorrateoDetalle" class="mb-4 p-3 bg-blue-50 rounded-lg text-blue-900"></div>
        <button id="confirmUpgrade" class="w-full py-3 px-4 rounded-xl text-white bg-emerald-600 font-semibold shadow hover:bg-emerald-700"><span class="btn-text">Pagar y cambiar plan</span></button>
      </div>
    </div>

    <div id="modalCorreo" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden p-4">
      <div class="bg-white p-6 rounded-2xl shadow-xl max-w-sm w-full relative">
        <button id="closeCorreoModal" class="absolute top-2 right-3 text-slate-400 hover:text-red-500 text-2xl">&times;</button>
        <h3 class="font-bold text-lg mb-4 text-blue-700">Cambiar correo</h3>
        <form id="formCorreo">
          <label class="block text-sm mb-1">Correo actual</label>
          <input type="email" class="form-control mb-3" value="${safeEmail}" disabled>
          <label class="block text-sm mb-1">Nuevo correo</label>
          <input type="email" class="form-control mb-3" id="nuevoCorreo" required>
          <button class="btn btn-primary w-full mt-1" type="submit">Actualizar correo</button>
        </form>
      </div>
    </div>
  `;

  const monedaSelector = container.querySelector('#monedaSelector');
  const tipoPagoSelector = container.querySelector('#tipoPagoSelector');
  const planesList = container.querySelector('#planes-list');
  const promoBanner = container.querySelector('#promo-bienvenida-banner');
  const renewalPreview = container.querySelector('#renewal-price-preview');
  const annualSavingPreview = container.querySelector('#annual-saving-preview');

  async function iniciarProcesoDePago(plan, tipo) {
    await abrirCheckoutSuscripcion({
      plan,
      paymentType: tipo,
      billingPeriod: periodoActual,
      currency: monedaActual,
      hotelId: hotel.id,
      userEmail: user.email,
      userId: user.id
    });
  }

  function updateRenewalPreview() {
    if (!planActivo || !renewalPreview) return;
    const baseAmounts = getBasePlanAmounts(planActivo, periodoActual);
    const promo = applyPromoBienvenida({ ...baseAmounts, periodo: periodoActual, promoStatus: promoBienvenida });
    const amount = monedaActual === 'USD' ? promo.finalUSD : promo.finalCOP;
    renewalPreview.innerHTML = `Renueva ${periodoActual === 'anual' ? '12 meses' : '1 mes'} por <b class="text-xl text-slate-900">${formatMoneda(amount, monedaActual)}</b>`;
    if (annualSavingPreview) {
      const savings = getAnnualSavings(planActivo, monedaActual);
      annualSavingPreview.innerHTML = periodoActual === 'anual' && savings > 0
        ? `Ahorro anual frente a 12 mensualidades: <b class="text-emerald-700">${formatMoneda(savings, monedaActual)}</b>`
        : 'Puedes cambiar a pago anual arriba para ver el ahorro de 2 mensualidades.';
    }
  }

  function procesarCambioDePlan(planSeleccionado, tipo) {
    if (!planActivo || !planSeleccionado) return;
    const modal = container.querySelector('#modalUpgrade');
    if (!modal) return;

    if (tipo === 'upgrade') {
      const { diasCicloSeguro, diasRestantesSeguro } = getBillingCycleSnapshot(hotel, diasRestantes);
      const costoDiarioActualCOP = Number(planActivo.precio_mensual || 0) / diasCicloSeguro;
      const costoDiarioNuevoCOP = Number(planSeleccionado.precio_mensual || 0) / diasCicloSeguro;
      const creditoNoUsadoCOP = costoDiarioActualCOP * diasRestantesSeguro;
      const costoNuevoRestanteCOP = costoDiarioNuevoCOP * diasRestantesSeguro;
      const montoProrrateadoCOP = Math.max(0, costoNuevoRestanteCOP - creditoNoUsadoCOP);

      const precioActualUSD = USD_PRICES[String(planActivo.nombre || '').toLowerCase()] || 0;
      const precioNuevoUSD = USD_PRICES[String(planSeleccionado.nombre || '').toLowerCase()] || 0;
      const creditoNoUsadoUSD = (precioActualUSD / diasCicloSeguro) * diasRestantesSeguro;
      const costoNuevoRestanteUSD = (precioNuevoUSD / diasCicloSeguro) * diasRestantesSeguro;
      const montoProrrateadoUSD = Math.max(0, costoNuevoRestanteUSD - creditoNoUsadoUSD);
      const montoMostrar = monedaActual === 'USD' ? montoProrrateadoUSD : montoProrrateadoCOP;
      const creditoMostrar = monedaActual === 'USD' ? creditoNoUsadoUSD : creditoNoUsadoCOP;
      const costoRestanteMostrar = monedaActual === 'USD' ? costoNuevoRestanteUSD : costoNuevoRestanteCOP;

      modal.querySelector('#modalPlanName').innerHTML = `De <b>${escapeHtml(planActivo.nombre)}</b> a <b class="text-emerald-600">${escapeHtml(planSeleccionado.nombre)}</b>`;
      modal.querySelector('h3').textContent = 'Confirmar mejora de plan';
      modal.querySelector('#prorrateoDetalle').innerHTML = `
        <div class="space-y-2 text-sm">
          <div class="flex justify-between gap-3"><span>Costo del nuevo plan por ${diasRestantesSeguro} días</span><b>${formatMoneda(costoRestanteMostrar, monedaActual)}</b></div>
          <div class="flex justify-between gap-3 text-emerald-700"><span>Crédito del plan actual</span><b>- ${formatMoneda(creditoMostrar, monedaActual)}</b></div>
          <hr class="border-dashed">
          <div class="flex justify-between gap-3 text-base"><b>Total estimado hoy</b><b>${formatMoneda(montoMostrar, monedaActual)}</b></div>
          <div class="text-xs text-slate-500">El backend recalculará el valor definitivo antes de crear el checkout.</div>
        </div>`;

      const oldButton = modal.querySelector('#confirmUpgrade');
      const newButton = oldButton.cloneNode(true);
      newButton.querySelector('.btn-text').textContent = `Mejorar a ${planSeleccionado.nombre}`;
      oldButton.replaceWith(newButton);
      newButton.addEventListener('click', () => {
        void iniciarProcesoDePago(planSeleccionado, 'upgrade');
        modal.classList.add('hidden');
      });
    } else {
      const baseAmounts = getBasePlanAmounts(planSeleccionado, periodoActual);
      const promo = applyPromoBienvenida({ ...baseAmounts, periodo: periodoActual, promoStatus: promoBienvenida });
      const amount = monedaActual === 'USD' ? promo.finalUSD : promo.finalCOP;
      modal.querySelector('#modalPlanName').innerHTML = `De <b>${escapeHtml(planActivo.nombre)}</b> a <b class="text-orange-600">${escapeHtml(planSeleccionado.nombre)}</b>`;
      modal.querySelector('h3').textContent = 'Confirmar cambio para el próximo ciclo';
      modal.querySelector('#prorrateoDetalle').innerHTML = `
        <div class="space-y-3 text-sm text-slate-700">
          <p>Tu plan actual seguirá activo hasta ${fechaFin ? fechaFin.toLocaleDateString('es-CO') : 'el fin del ciclo'}.</p>
          <div class="flex justify-between gap-3 text-base"><b>Pago del próximo ciclo</b><b>${formatMoneda(amount, monedaActual)}</b></div>
          <div class="rounded-lg bg-blue-50 p-3 text-blue-800">Después se activará automáticamente <b>${escapeHtml(planSeleccionado.nombre)}</b>.</div>
        </div>`;
      const oldButton = modal.querySelector('#confirmUpgrade');
      const newButton = oldButton.cloneNode(true);
      newButton.querySelector('.btn-text').textContent = 'Pagar próximo ciclo';
      oldButton.replaceWith(newButton);
      newButton.addEventListener('click', () => {
        void iniciarProcesoDePago(planSeleccionado, 'renew-downgrade');
        modal.classList.add('hidden');
      });
    }
    modal.classList.remove('hidden');
  }

  function renderPlanes(conteoHabitacionesActual, conteoUsuariosActual) {
    if (!planesList) return;
    planesList.innerHTML = '';
    if (promoBanner) promoBanner.innerHTML = getPromoBienvenidaHTML(promoBienvenida, periodoActual);

    (plans || []).forEach(plan => {
      const baseAmounts = getBasePlanAmounts(plan, periodoActual);
      const promo = applyPromoBienvenida({ ...baseAmounts, periodo: periodoActual, promoStatus: promoBienvenida });
      const price = monedaActual === 'USD' ? promo.finalUSD : promo.finalCOP;
      const precioBase = monedaActual === 'USD' ? promo.baseUSD : promo.baseCOP;
      const ahorroPromo = monedaActual === 'USD' ? promo.ahorroUSD : promo.ahorroCOP;
      const esPlanActual = String(plan.id) === String(planActivo?.id);
      const esRecomendado = String(plan.id) === String(recommendedPlan?.id);
      const eligible = isPlanEligibleForUsage(plan, conteoHabitacionesActual, conteoUsuariosActual);
      const planLimits = getPlanLimits(plan);
      const tipoCambio = Number(plan.precio_mensual || 0) < Number(planActivo?.precio_mensual || 0) ? 'downgrade' : 'upgrade';
      const annualSaving = getAnnualSavings(plan, monedaActual);
      const safeName = escapeHtml(plan.nombre || 'Plan');
      const safeDescription = escapeHtml(plan.descripcion || '');
      const capacityRooms = planLimits.habitaciones == null ? 'Sin límite definido' : `${planLimits.habitaciones} habitaciones`;
      const capacityUsers = planLimits.usuarios == null ? 'Sin límite definido' : `${planLimits.usuarios} usuarios`;

      let actionHtml = '';
      if (esPlanActual) {
        actionHtml = `<button class="w-full mt-4 py-3 rounded-xl bg-blue-100 text-blue-700 font-bold cursor-not-allowed" disabled>Tu plan actual</button>`;
      } else if (!eligible) {
        actionHtml = `<button class="w-full mt-4 py-3 rounded-xl bg-slate-200 text-slate-500 font-bold cursor-not-allowed" disabled>No compatible con tu uso actual</button>`;
      } else {
        const label = tipoCambio === 'upgrade' ? `Mejorar a ${safeName}` : `Cambiar a ${safeName} próximo ciclo`;
        actionHtml = `<button class="btn-elegir-plan w-full mt-4 py-3 px-4 rounded-xl text-white ${tipoCambio === 'upgrade' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-700 hover:bg-slate-800'} font-bold transition" data-plan-id="${escapeHtml(plan.id)}" data-tipo-cambio="${tipoCambio}">${label}</button>`;
      }

      planesList.insertAdjacentHTML('beforeend', `
        <article id="plan-card-${escapeHtml(plan.id)}" class="relative rounded-2xl border p-5 flex flex-col justify-between ${esPlanActual ? 'border-blue-500 ring-2 ring-blue-100' : esRecomendado ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'}">
          ${esRecomendado ? '<div class="absolute -top-3 left-4 rounded-full bg-indigo-600 px-3 py-1 text-xs font-bold text-white shadow">Recomendado para tu operación</div>' : ''}
          <div>
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-xl font-bold text-slate-900">${safeName}</h4>
              ${esPlanActual ? '<span class="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">Actual</span>' : ''}
            </div>
            <p class="mt-2 text-sm text-slate-500">${safeDescription}</p>
            <div class="mt-4 text-3xl font-extrabold text-slate-900">${formatMoneda(price, monedaActual)} <span class="text-sm font-medium text-slate-400">/${periodoActual === 'anual' ? 'año' : 'mes'}</span></div>
            ${periodoActual === 'anual' && annualSaving > 0 ? `<div class="mt-2 text-xs font-semibold text-emerald-700">Ahorras ${formatMoneda(annualSaving, monedaActual)} frente a 12 mensualidades.</div>` : ''}
            ${promo.promoAplica ? `<div class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><b>Promo aplicada:</b> precio normal ${formatMoneda(precioBase, monedaActual)} · ahorras ${formatMoneda(ahorroPromo, monedaActual)}.</div>` : ''}
            <div class="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div class="rounded-lg bg-slate-50 p-2"><b>🚪 Capacidad</b><div class="mt-1 text-slate-500">${escapeHtml(capacityRooms)}</div></div>
              <div class="rounded-lg bg-slate-50 p-2"><b>👥 Equipo</b><div class="mt-1 text-slate-500">${escapeHtml(capacityUsers)}</div></div>
            </div>
            <ul class="mt-4 space-y-2 text-xs text-slate-600">${safePlanFeatures(plan).map(feature => `<li class="flex gap-2"><span class="text-emerald-600">✓</span><span>${escapeHtml(feature)}</span></li>`).join('')}</ul>
          </div>
          ${actionHtml}
        </article>`);
    });

    container.querySelectorAll('.btn-elegir-plan').forEach(btn => {
      btn.addEventListener('click', () => {
        const selected = plans.find(plan => String(plan.id) === String(btn.dataset.planId));
        if (selected) procesarCambioDePlan(selected, btn.dataset.tipoCambio);
      });
    });

    const btnRenew = container.querySelector('#btnRenovarPlan');
    if (btnRenew) {
      btnRenew.textContent = promoBienvenida.aplicaEnPeriodo(periodoActual)
        ? `Renovar con ${promoBienvenida.porcentaje}% OFF`
        : `Renovar ${periodoActual === 'anual' ? '12 meses' : 'ahora'}`;
    }
    updateRenewalPreview();
  }

  monedaSelector?.addEventListener('change', event => {
    monedaActual = event.target.value;
    renderPlanes(rooms, users);
  });
  tipoPagoSelector?.addEventListener('change', event => {
    periodoActual = event.target.value;
    renderPlanes(rooms, users);
  });

  renderPlanes(rooms, users);

  container.querySelector('.btn-ir-plan-recomendado')?.addEventListener('click', event => {
    const planId = event.currentTarget.dataset.planId;
    const target = container.querySelector(`[id="plan-card-${String(planId).replace(/"/g, '')}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  container.querySelector('#btnRenovarPlan')?.addEventListener('click', () => {
    if (planActivo) void iniciarProcesoDePago(planActivo, 'renew');
  });

  container.querySelector('#btnCopyRefLink')?.addEventListener('click', async () => {
    const input = container.querySelector('#refLinkInput');
    const value = input?.value || '';
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
      else {
        input.select();
        document.execCommand('copy');
      }
      showSnackbar(container, 'Enlace copiado.');
    } catch (error) {
      console.error('[Mi Cuenta] Error copiando enlace:', error);
      showSnackbar(container, 'No se pudo copiar el enlace.', 'error');
    }
  });

  container.querySelector('#closeUpgradeModal')?.addEventListener('click', () => container.querySelector('#modalUpgrade')?.classList.add('hidden'));
  container.querySelector('#btnCambiarCorreo')?.addEventListener('click', () => container.querySelector('#modalCorreo')?.classList.remove('hidden'));
  container.querySelector('#closeCorreoModal')?.addEventListener('click', () => container.querySelector('#modalCorreo')?.classList.add('hidden'));

  container.querySelector('#btnCambiarPass')?.addEventListener('click', async () => {
    const result = await Swal.fire({
      icon: 'question',
      title: 'Cambiar mi contraseña',
      text: `Te enviaremos un enlace seguro a ${user.email} para que definas una nueva contraseña.`,
      showCancelButton: true,
      confirmButtonText: 'Enviar enlace',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb'
    });
    if (!result.isConfirmed) return;

    const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
      redirectTo: 'https://www.gestiondehotel.com/password-reset.html'
    });
    if (error) {
      showSnackbar(container, `No se pudo enviar el enlace: ${error.message}`, 'error');
      return;
    }
    await registrarAccionSensible({
      supabase,
      hotelId: hotel.id,
      usuarioId: user.id,
      accion: 'SOLICITAR_RESET_PASSWORD_CUENTA',
      detalles: { ejecutado_por: userProfile?.nombre || user.email }
    });
    showSnackbar(container, 'Enlace de cambio de contraseña enviado a tu correo.');
  });

  container.querySelector('#formCorreo')?.addEventListener('submit', async event => {
    event.preventDefault();
    const nuevoCorreo = container.querySelector('#nuevoCorreo')?.value.trim();
    if (!nuevoCorreo) return;
    const { error } = await supabase.auth.updateUser({ email: nuevoCorreo });
    if (error) {
      showSnackbar(container, `Error: ${error.message}`, 'error');
      return;
    }
    await registrarAccionSensible({
      supabase,
      hotelId: hotel.id,
      usuarioId: user.id,
      accion: 'ACTUALIZAR_CORREO_CUENTA',
      detalles: { correo_nuevo: nuevoCorreo, ejecutado_por: userProfile?.nombre || user.email }
    });
    showSnackbar(container, 'Correo actualizado. Revisa tu nuevo correo para confirmar.');
    container.querySelector('#modalCorreo')?.classList.add('hidden');
  });
}

export function unmount(container) {
  container.innerHTML = '';
}
