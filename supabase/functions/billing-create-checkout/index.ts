import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('PROJECT_URL');
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE_KEY') ??
  Deno.env.get('SERVICE_ROLE');
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get('MERCADOPAGO_ACCESS_TOKEN');
const MERCADOPAGO_WEBHOOK_URL =
  Deno.env.get('MERCADOPAGO_WEBHOOK_URL') ??
  'https://iikpqpdoslyduecibaij.supabase.co/functions/v1/mercadopagoWebhook';
const WOMPI_PUBLIC_KEY = Deno.env.get('WOMPI_PUBLIC_KEY');

const ALLOWED_ORIGINS = new Set([
  'https://gestiondehotel.com',
  'https://www.gestiondehotel.com',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
]);

const USD_PRICES: Record<string, number> = {
  lite: 25,
  pro: 38,
  max: 50
};

const PROMO_BIENVENIDA_INICIO = new Date('2026-03-17T00:00:00-05:00');
const PROMO_BIENVENIDA_MESES = 3;
const PROMO_BIENVENIDA_DESCUENTO = 0.5;

function buildCorsHeaders(origin: string | null) {
  const allowOrigin = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://gestiondehotel.com';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'content-type, authorization, x-client-info, apikey',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...buildCorsHeaders(origin),
      'Content-Type': 'application/json'
    }
  });
}

function sanitizeString(value: unknown, maxLength = 140) {
  if (typeof value === 'string') {
    return value.trim().slice(0, maxLength);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value).trim().slice(0, maxLength);
  }

  if (typeof value === 'bigint') {
    return value.toString().trim().slice(0, maxLength);
  }

  return '';
}

function normalizePeriod(value: unknown) {
  return value === 'anual' ? 'anual' : 'mensual';
}

function normalizeCurrency(value: unknown) {
  return value === 'USD' ? 'USD' : 'COP';
}

function normalizePaymentType(value: unknown) {
  const type = sanitizeString(value, 40);
  return ['renew', 'upgrade', 'renew-downgrade'].includes(type) ? type : '';
}

function paymentTypeToReferenceCode(paymentType: string) {
  if (paymentType === 'renew-downgrade') return 'rd';
  if (paymentType === 'upgrade') return 'u';
  return 'r';
}

function billingPeriodToReferenceCode(period: string) {
  return period === 'anual' ? 'a' : 'm';
}

function buildCheckoutReference({
  paymentType,
  billingPeriod,
  hotelId,
  planId
}: {
  paymentType: string;
  billingPeriod: string;
  hotelId: string;
  planId: string;
}) {
  return `gh2-${paymentTypeToReferenceCode(paymentType)}-${billingPeriodToReferenceCode(billingPeriod)}-${hotelId}-${planId}-${Date.now()}`;
}

function getPositiveSubscriptionPayments(pagos: Array<Record<string, unknown>> = []) {
  return pagos.filter((pago) => {
    const monto = Number(pago?.monto ?? 0);
    return Number.isFinite(monto) && monto > 0 && Boolean(pago?.plan);
  });
}

function getPromoBienvenidaStatus(hotel: Record<string, unknown>, pagos: Array<Record<string, unknown>> = []) {
  const trialStart = hotel?.trial_inicio ? new Date(String(hotel.trial_inicio)) : null;
  const elegiblePorFecha = Boolean(
    trialStart &&
    !Number.isNaN(trialStart.getTime()) &&
    trialStart >= PROMO_BIENVENIDA_INICIO
  );

  const ahora = Date.now();
  const promoWindowEnd = trialStart ? new Date(trialStart) : null;
  if (promoWindowEnd) {
    promoWindowEnd.setDate(promoWindowEnd.getDate() + 120);
  }

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
    mesesRestantes,
    siguienteMesPromo: pagosUsados + 1,
    porcentaje: Math.round(PROMO_BIENVENIDA_DESCUENTO * 100),
    aplicaEnPeriodo(periodo: string) {
      return this.aplica && periodo === 'mensual';
    }
  };
}

function resolvePlanUsd(plan: Record<string, unknown>) {
  const planKey = String(plan?.nombre ?? '').trim().toLowerCase();
  return USD_PRICES[planKey] ?? 0;
}

function getBasePlanAmounts(plan: Record<string, unknown>, periodo = 'mensual') {
  const baseCOP = periodo === 'anual'
    ? Number(plan?.precio_mensual ?? 0) * 10
    : Number(plan?.precio_mensual ?? 0);
  let baseUSD = resolvePlanUsd(plan);
  if (periodo === 'anual') {
    baseUSD *= 10;
  }
  return { baseCOP, baseUSD };
}

function applyPromoBienvenida({
  baseCOP = 0,
  baseUSD = 0,
  periodo = 'mensual',
  promoStatus
}: {
  baseCOP?: number;
  baseUSD?: number;
  periodo?: string;
  promoStatus: ReturnType<typeof getPromoBienvenidaStatus>;
}) {
  const promoAplica = Boolean(promoStatus?.aplicaEnPeriodo?.(periodo));
  const factor = promoAplica ? (1 - PROMO_BIENVENIDA_DESCUENTO) : 1;
  const finalCOP = Number((baseCOP * factor).toFixed(2));
  const finalUSD = Number((baseUSD * factor).toFixed(2));
  return {
    promoAplica,
    finalCOP,
    finalUSD,
    ahorroCOP: Number((baseCOP - finalCOP).toFixed(2)),
    ahorroUSD: Number((baseUSD - finalUSD).toFixed(2))
  };
}

function buildSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Supabase admin credentials are not configured.');
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function createMercadoPagoCheckout({
  amountUSD,
  planName,
  planId,
  paymentType,
  billingPeriod,
  hotelId,
  userEmail,
  currentUrl
}: {
  amountUSD: number;
  planName: string;
  planId: string;
  paymentType: string;
  billingPeriod: string;
  hotelId: string;
  userEmail: string;
  currentUrl: string;
}) {
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN is not configured.');
  }

  const unitPrice = Number.parseFloat(amountUSD.toFixed(2));
  const externalReference = buildCheckoutReference({
    paymentType,
    billingPeriod,
    hotelId,
    planId
  });

  const response = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [
        {
          title: `Suscripcion ${planName} (${paymentType}) - Gestion de Hotel`,
          quantity: 1,
          currency_id: 'USD',
          unit_price: unitPrice
        }
      ],
      payer: {
        email: userEmail
      },
      external_reference: externalReference,
      metadata: {
        hotel_id: hotelId,
        plan_id: planId,
        payment_type: paymentType,
        billing_period: billingPeriod
      },
      notification_url: MERCADOPAGO_WEBHOOK_URL,
      back_urls: {
        success: currentUrl,
        pending: currentUrl,
        failure: currentUrl
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.init_point) {
    console.error('Error creando preferencia autoritativa de Mercado Pago:', data);
    throw new Error(typeof data?.message === 'string' ? data.message : 'Mercado Pago no devolvio init_point.');
  }

  return {
    provider: 'mercadopago',
    checkoutUrl: data.init_point as string,
    externalReference
  };
}

function createWompiCheckout({
  amountCOP,
  planId,
  paymentType,
  billingPeriod,
  hotelId,
  userEmail
}: {
  amountCOP: number;
  planId: string;
  paymentType: string;
  billingPeriod: string;
  hotelId: string;
  userEmail: string;
}) {
  if (!WOMPI_PUBLIC_KEY) {
    throw new Error('WOMPI_PUBLIC_KEY is not configured.');
  }

  const reference = buildCheckoutReference({
    paymentType,
    billingPeriod,
    hotelId,
    planId
  });
  const amountInCents = Math.round(amountCOP * 100);
  const checkoutUrl =
    `https://checkout.wompi.co/p/?public-key=${encodeURIComponent(WOMPI_PUBLIC_KEY)}` +
    `&currency=COP&amount-in-cents=${amountInCents}` +
    `&reference=${encodeURIComponent(reference)}` +
    `&customer-email=${encodeURIComponent(userEmail)}`;

  return {
    provider: 'wompi',
    checkoutUrl,
    externalReference: reference
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: buildCorsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405, origin);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse({ error: 'Origin not allowed.' }, 403, origin);
  }

  try {
    const payload = await req.json().catch(() => ({}));
    const hotelId = sanitizeString(payload?.hotelId, 80);
    const planId = sanitizeString(payload?.planId, 80);
    const paymentType = normalizePaymentType(payload?.paymentType);
    const billingPeriod = normalizePeriod(payload?.billingPeriod);
    const currency = normalizeCurrency(payload?.currency);
    const userEmail = sanitizeString(payload?.userEmail, 120) || 'noemail@example.com';
    const currentUrl = sanitizeString(payload?.currentUrl, 500) || 'https://gestiondehotel.com/';

    if (!hotelId || !planId || !paymentType) {
      return jsonResponse({ error: 'Invalid payload.' }, 400, origin);
    }

    const supabaseAdmin = buildSupabaseAdmin();

    const [{ data: hotel, error: hotelError }, { data: plans, error: plansError }, { data: pagos, error: pagosError }] =
      await Promise.all([
        supabaseAdmin
          .from('hoteles')
          .select('id, nombre, plan, plan_id, estado_suscripcion, trial_inicio, trial_fin, suscripcion_fin, creado_en')
          .eq('id', hotelId)
          .maybeSingle(),
        supabaseAdmin.from('planes').select('*'),
        supabaseAdmin.from('pagos').select('monto, plan').eq('hotel_id', hotelId)
      ]);

    if (hotelError) {
      console.error('Error cargando hotel en billing-create-checkout:', hotelError);
      return jsonResponse(
        { error: 'No se pudo cargar el hotel.', detail: hotelError.message },
        500,
        origin
      );
    }

    if (!hotel) {
      return jsonResponse({ error: 'Hotel not found.' }, 404, origin);
    }

    if (plansError || !Array.isArray(plans)) {
      console.error('Error cargando planes para billing-create-checkout:', plansError);
      return jsonResponse({ error: 'No se pudieron cargar los planes.' }, 500, origin);
    }

    if (pagosError) {
      console.error('Error cargando pagos para billing-create-checkout:', pagosError);
      return jsonResponse({ error: 'No se pudieron cargar los pagos del hotel.' }, 500, origin);
    }

    const currentPlan = plans.find((plan) =>
      String(plan.id) === String(hotel.plan_id ?? '') ||
      String(plan.nombre ?? '').trim().toLowerCase() === String(hotel.plan ?? '').trim().toLowerCase()
    );

    const selectedPlan = plans.find((plan) => String(plan.id) === planId) ?? (
      paymentType === 'renew' ? currentPlan : null
    );

    if (!selectedPlan) {
      return jsonResponse({ error: 'Selected plan not found.' }, 404, origin);
    }

    const promoStatus = getPromoBienvenidaStatus(hotel, Array.isArray(pagos) ? pagos : []);

    let finalCOP = 0;
    let finalUSD = 0;
    let promoApplied = false;
    let savingsCOP = 0;
    let savingsUSD = 0;

    if (paymentType === 'upgrade') {
      const fechaFinCiclo = new Date(String(hotel.suscripcion_fin ?? hotel.trial_fin ?? ''));
      let fechaInicioCiclo = new Date(String(hotel.trial_inicio ?? hotel.creado_en ?? ''));

      const rangoDiasActual = Number.isFinite(fechaFinCiclo.getTime()) && Number.isFinite(fechaInicioCiclo.getTime())
        ? Math.ceil((fechaFinCiclo.getTime() - fechaInicioCiclo.getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      if (!Number.isFinite(fechaInicioCiclo.getTime()) || rangoDiasActual <= 0 || rangoDiasActual > 45) {
        fechaInicioCiclo = new Date(fechaFinCiclo);
        fechaInicioCiclo.setDate(fechaInicioCiclo.getDate() - 30);
      }

      const diasCicloTotal = Math.ceil((fechaFinCiclo.getTime() - fechaInicioCiclo.getTime()) / (1000 * 60 * 60 * 24));
      const diasCicloSeguro = Math.max(1, Number.isFinite(diasCicloTotal) ? diasCicloTotal : 1);
      const diasRestantesSeguro = Math.max(
        0,
        Math.ceil((fechaFinCiclo.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      );

      const costoDiarioActualCOP = Number(currentPlan?.precio_mensual ?? 0) / diasCicloSeguro;
      const costoDiarioNuevoCOP = Number(selectedPlan?.precio_mensual ?? 0) / diasCicloSeguro;
      const creditoNoUsadoCOP = costoDiarioActualCOP * diasRestantesSeguro;
      const costoNuevoRestanteCOP = costoDiarioNuevoCOP * diasRestantesSeguro;

      const precioActualUSD = resolvePlanUsd(currentPlan);
      const precioNuevoUSD = resolvePlanUsd(selectedPlan);
      const costoDiarioActualUSD = precioActualUSD / diasCicloSeguro;
      const costoDiarioNuevoUSD = precioNuevoUSD / diasCicloSeguro;
      const creditoNoUsadoUSD = costoDiarioActualUSD * diasRestantesSeguro;
      const costoNuevoRestanteUSD = costoDiarioNuevoUSD * diasRestantesSeguro;

      finalCOP = Number(Math.max(0, costoNuevoRestanteCOP - creditoNoUsadoCOP).toFixed(2));
      finalUSD = Number(Math.max(0, costoNuevoRestanteUSD - creditoNoUsadoUSD).toFixed(2));
    } else {
      const baseAmounts = getBasePlanAmounts(selectedPlan, billingPeriod);
      const promo = applyPromoBienvenida({
        ...baseAmounts,
        periodo: billingPeriod,
        promoStatus
      });

      finalCOP = promo.finalCOP;
      finalUSD = promo.finalUSD;
      promoApplied = promo.promoAplica;
      savingsCOP = promo.ahorroCOP;
      savingsUSD = promo.ahorroUSD;
    }

    if ((currency === 'USD' && finalUSD <= 0) || (currency === 'COP' && finalCOP <= 0)) {
      const detail = paymentType === 'renew'
        ? 'El plan actual no tiene un valor de renovacion valido. Verifica el plan del hotel o elige un plan pago.'
        : 'El monto calculado no es valido para iniciar el pago.';
      return jsonResponse({ error: detail }, 400, origin);
    }

    const checkout = currency === 'USD'
      ? await createMercadoPagoCheckout({
          amountUSD: finalUSD,
          planName: String(selectedPlan.nombre ?? 'Plan'),
          planId,
          paymentType,
          billingPeriod,
          hotelId,
          userEmail,
          currentUrl
        })
      : createWompiCheckout({
          amountCOP: finalCOP,
          planId,
          paymentType,
          billingPeriod,
          hotelId,
          userEmail
        });

    const issuedAt = new Date().toISOString();

    return jsonResponse(
      {
        ok: true,
        provider: checkout.provider,
        provider_display_name: checkout.provider === 'mercadopago' ? 'Mercado Pago' : 'Wompi',
        checkout_url: checkout.checkoutUrl,
        external_reference: checkout.externalReference,
        checkout_reference: checkout.externalReference,
        issued_at: issuedAt,
        customer_email: userEmail,
        quote: {
          plan_name: selectedPlan.nombre,
          current_plan_name: currentPlan?.nombre ?? null,
          payment_type: paymentType,
          billing_period: billingPeriod,
          currency,
          amount_cop: finalCOP,
          amount_usd: finalUSD,
          promo_applied: promoApplied,
          savings_cop: savingsCOP,
          savings_usd: savingsUSD,
          promo_remaining_months: promoStatus.mesesRestantes,
          promo_month_number: promoStatus.siguienteMesPromo
        }
      },
      200,
      origin
    );
  } catch (error) {
    console.error('Error inesperado en billing-create-checkout:', error);
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unexpected error.' }, 500, origin);
  }
});
