export const USD_PRICES = {
  lite: 25,
  pro: 38,
  max: 50
};

export const PROMO_BIENVENIDA_INICIO = new Date('2026-03-17T00:00:00-05:00');
export const PROMO_BIENVENIDA_MESES = 3;
export const PROMO_BIENVENIDA_DESCUENTO = 0.5;

export function alertaVencimientoHTML(diasRestantes, estado, enGracia) {
  if (enGracia) {
    return `<div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-800 p-3 mb-6 rounded">
      <b>Tu ciclo terminó.</b> El hotel sigue operativo por <b>${diasRestantes}</b> días de gracia. Renueva antes del bloqueo.
    </div>`;
  }
  if (estado === 'vencido') {
    return `<div class="bg-red-100 border-l-4 border-red-500 text-red-700 p-3 mb-6 rounded">
      <b>Tu suscripción está vencida y el período de gracia terminó.</b> Renueva para reactivar el acceso completo del hotel.
    </div>`;
  }
  if (diasRestantes <= 3 && estado !== 'trial') {
    return `<div class="bg-yellow-50 border-l-4 border-yellow-400 text-yellow-900 p-3 mb-6 rounded">
      <b>Tu suscripción vence pronto.</b> Quedan <b>${diasRestantes}</b> días para renovar o cambiar de plan.
    </div>`;
  }
  return '';
}

export function formatMoneda(valor, moneda = 'COP') {
  const amount = Number(valor || 0);
  if (moneda === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${amount.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
}

export function getPositiveSubscriptionPayments(pagos = []) {
  return (Array.isArray(pagos) ? pagos : []).filter((pago) => {
    const monto = Number(pago?.monto ?? 0);
    return Number.isFinite(monto) && monto > 0 && Boolean(pago?.plan);
  });
}

export function getPromoBienvenidaStatus(hotel, pagos = []) {
  if (hotel?.suscripcion_exenta === true) {
    return {
      aplica: false,
      elegiblePorFecha: false,
      vigentePorTiempo: false,
      pagosRegistrados: 0,
      pagosUsados: 0,
      mesesRestantes: 0,
      siguienteMesPromo: 0,
      porcentaje: Math.round(PROMO_BIENVENIDA_DESCUENTO * 100),
      aplicaEnPeriodo() { return false; }
    };
  }

  const trialStart = hotel?.trial_inicio ? new Date(hotel.trial_inicio) : null;
  const elegiblePorFecha = Boolean(
    trialStart &&
    !Number.isNaN(trialStart.getTime()) &&
    trialStart >= PROMO_BIENVENIDA_INICIO
  );
  const ahora = Date.now();
  const promoWindowEnd = trialStart ? new Date(trialStart) : null;
  if (promoWindowEnd) promoWindowEnd.setDate(promoWindowEnd.getDate() + 120);
  const vigentePorTiempo = Boolean(
    promoWindowEnd &&
    !Number.isNaN(promoWindowEnd.getTime()) &&
    ahora <= promoWindowEnd.getTime()
  );
  const pagosRegistrados = getPositiveSubscriptionPayments(pagos).length;
  const pagosUsados = Math.min(PROMO_BIENVENIDA_MESES, pagosRegistrados);
  const mesesRestantes = Math.max(0, PROMO_BIENVENIDA_MESES - pagosUsados);

  return {
    aplica: elegiblePorFecha && vigentePorTiempo && mesesRestantes > 0,
    elegiblePorFecha,
    vigentePorTiempo,
    pagosRegistrados,
    pagosUsados,
    mesesRestantes,
    siguienteMesPromo: pagosUsados + 1,
    porcentaje: Math.round(PROMO_BIENVENIDA_DESCUENTO * 100),
    aplicaEnPeriodo(periodo) {
      return this.aplica && periodo === 'mensual';
    }
  };
}

export function getBasePlanAmounts(plan, periodo = 'mensual') {
  const planKey = plan?.nombre?.trim().toLowerCase() || '';
  const baseCOP = periodo === 'anual'
    ? Number(plan?.precio_mensual || 0) * 10
    : Number(plan?.precio_mensual || 0);
  let baseUSD = USD_PRICES[planKey] || 0;
  if (periodo === 'anual') baseUSD *= 10;
  return { baseCOP, baseUSD };
}

export function applyPromoBienvenida({ baseCOP = 0, baseUSD = 0, periodo = 'mensual', promoStatus }) {
  const promoAplica = Boolean(promoStatus?.aplicaEnPeriodo?.(periodo));
  const factor = promoAplica ? (1 - PROMO_BIENVENIDA_DESCUENTO) : 1;
  const finalCOP = Number((baseCOP * factor).toFixed(2));
  const finalUSD = Number((baseUSD * factor).toFixed(2));
  return {
    promoAplica,
    baseCOP,
    baseUSD,
    finalCOP,
    finalUSD,
    ahorroCOP: Number((baseCOP - finalCOP).toFixed(2)),
    ahorroUSD: Number((baseUSD - finalUSD).toFixed(2))
  };
}

export function getPromoBienvenidaHTML(promoStatus, periodoActual) {
  if (!promoStatus?.aplica) return '';
  const mensajePeriodo = periodoActual === 'mensual'
    ? `Tu siguiente mensualidad se cobrará con <b>${promoStatus.porcentaje}% OFF</b>.`
    : `El ${promoStatus.porcentaje}% OFF aplica solo en pagos mensuales. Si eliges anual, se mantienen los 2 meses gratis del plan anual.`;

  return `
    <div class="mb-6 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-lime-50 p-4 shadow-sm">
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <div class="text-sm font-semibold uppercase tracking-wide text-amber-700">Promoción de bienvenida activa</div>
          <div class="mt-1 text-base font-semibold text-slate-800">Primer mes gratis + 3 meses al 50% para cuentas nuevas.</div>
          <div class="mt-1 text-sm text-slate-600">${mensajePeriodo}</div>
        </div>
        <div class="rounded-xl bg-white px-4 py-3 text-sm shadow-sm border border-amber-100">
          <div class="font-semibold text-slate-800">Te quedan ${promoStatus.mesesRestantes} de ${PROMO_BIENVENIDA_MESES} meses promocionales</div>
          <div class="text-slate-500">El siguiente sería tu mes promocional ${promoStatus.siguienteMesPromo}.</div>
        </div>
      </div>
    </div>`;
}
