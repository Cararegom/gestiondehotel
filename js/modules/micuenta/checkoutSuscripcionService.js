import { supabase } from '../../supabaseClient.js';
import { registrarAccionSensible } from '../../services/sensitiveAuditService.js';

function pushCheckoutAnalytics({ provider, paymentType, amount, planName, hotelId, billingPeriod }) {
  try {
    window.dataLayer = window.dataLayer || [];
    const eventBase = paymentType === 'upgrade' ? 'cambio_plan' : 'renovacion_plan';
    const suffix = provider === 'mercadopago' ? 'mp' : 'wompi';
    window.dataLayer.push({
      event: `${eventBase}_${suffix}`,
      currency: provider === 'mercadopago' ? 'USD' : 'COP',
      value: amount,
      plan: planName,
      hotel_id: hotelId,
      periodo: billingPeriod
    });
  } catch (error) {
    console.error('Error enviando evento a Google Analytics:', error);
  }
}

function formatCurrency(value, currency = 'COP') {
  const amount = Number(value || 0);
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} USD`;
  }

  return `$${amount.toLocaleString('es-CO', {
    maximumFractionDigits: 0
  })} COP`;
}

function buildCheckoutSummary(data) {
  const quote = data?.quote || {};
  const issuedAt = data?.issued_at ? new Date(data.issued_at).toLocaleString('es-CO') : null;
  const referenceLine = data?.checkout_reference
    ? `<div style="margin-top: 0.75rem; font-size: 0.8em; color: #64748b;">Referencia interna: <b>${data.checkout_reference}</b>${issuedAt ? ` · Emitido: ${issuedAt}` : ''}</div>`
    : '';

  if (data.provider === 'mercadopago') {
    return {
      title: 'Serás redirigido a Mercado Pago',
      confirmButtonColor: '#1d4ed8',
      html: `
        <div style="text-align: left; padding: 0 1rem;">
          Estás a punto de ir a nuestra pasarela de pago segura.
          <div style="margin-top: 1rem; padding: 0.8rem; background-color: #f0f5ff; border: 1px solid #adc6ff; border-radius: 8px; font-size: 0.9em; color: #2d3748;">
            <b>Referencia comercial:</b> ${formatCurrency(quote.amount_usd, 'USD')}
            <br><br>
            En Mercado Pago puede verse una referencia visual en COP, pero el cobro internacional corresponde al valor en USD del plan.
          </div>
          ${quote.promo_applied ? `
            <div style="margin-top: 1rem; padding: 0.8rem; background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; font-size: 0.9em; color: #92400e;">
              <b>Promo aplicada:</b> ahorro de ${formatCurrency(quote.savings_usd, 'USD')} en este pago.
            </div>
          ` : ''}
          <div style="margin-top: 1rem; font-weight: 600;">
            Valor a pagar ahora: <b>${formatCurrency(quote.amount_usd, 'USD')}</b>
          </div>
          ${referenceLine}
        </div>
      `
    };
  }

  return {
    title: 'Serás redirigido a la pasarela de pago',
    confirmButtonColor: '#16a34a',
    html: `
      <div style="text-align: left; padding: 0 1rem;">
        <b>El pago será a nombre de<br>Grupo Empresarial Areiza Gomez</b><br>
        <span style="color: #64748b;">propietario del sistema hotelero Gestion de Hotel.</span>
        <br><br>
        Monto a pagar: <b>${formatCurrency(quote.amount_cop, 'COP')}</b>
        <br>
        <span style="font-size: 0.85em; color: #64748b;">Referencia en USD: ${formatCurrency(quote.amount_usd, 'USD')}</span>
        ${quote.promo_applied ? `
          <div style="margin-top: 1rem; padding: 0.8rem; background-color: #fffbeb; border: 1px solid #fcd34d; border-radius: 8px; font-size: 0.9em; color: #92400e;">
            <b>Promo aplicada:</b> ahorro de ${formatCurrency(quote.savings_cop, 'COP')} en este pago.
          </div>
        ` : ''}
        ${referenceLine}
      </div>
    `
  };
}

export async function abrirCheckoutSuscripcion({
  plan,
  paymentType,
  billingPeriod,
  currency,
  hotelId,
  userEmail,
  userId = null
}) {
  if (typeof Swal === 'undefined') {
    alert('Ocurrió un error al cargar componentes de la página. Por favor, recarga.');
    return;
  }

  const resolvedPlanId = plan?.id != null ? String(plan.id) : '';
  if (!hotelId || !resolvedPlanId || !paymentType) {
    throw new Error('No pudimos identificar el plan para procesar la renovacion.');
  }

  try {
    const { data, error } = await supabase.functions.invoke('billing-create-checkout', {
      body: {
        hotelId,
        planId: resolvedPlanId,
        paymentType,
        billingPeriod,
        currency,
        userEmail,
        currentUrl: window.location.href
      }
    });

    if (error) {
      throw new Error(error.message || 'No se pudo crear el checkout.');
    }

    if (!data?.checkout_url || !data?.provider) {
      throw new Error(data?.error || 'El backend no devolvió un enlace de pago válido.');
    }

    const quote = data.quote || {};
    const amount = data.provider === 'mercadopago' ? quote.amount_usd : quote.amount_cop;
    pushCheckoutAnalytics({
      provider: data.provider,
      paymentType,
      amount,
      planName: quote.plan_name || plan.nombre,
      hotelId,
      billingPeriod
    });

    const summary = buildCheckoutSummary(data);
    const result = await Swal.fire({
      icon: 'info',
      title: summary.title,
      html: summary.html,
      confirmButtonText: 'Entendido, continuar al pago',
      cancelButtonText: 'Cancelar',
      showCancelButton: true,
      confirmButtonColor: summary.confirmButtonColor,
      cancelButtonColor: '#64748b'
    });

    if (!result.isConfirmed) {
      await registrarAccionSensible({
        supabase,
        hotelId,
        usuarioId: userId,
        accion: 'CHECKOUT_SUSCRIPCION_CANCELADO',
        detalles: {
          provider: data.provider,
          payment_type: paymentType,
          billing_period: billingPeriod,
          currency,
          plan: quote.plan_name || plan.nombre,
          checkout_reference: data.checkout_reference,
          amount
        }
      });
      return;
    }

    await registrarAccionSensible({
      supabase,
      hotelId,
      usuarioId: userId,
      accion: 'CHECKOUT_SUSCRIPCION_INICIADO',
      detalles: {
        provider: data.provider,
        payment_type: paymentType,
        billing_period: billingPeriod,
        currency,
        plan: quote.plan_name || plan.nombre,
        checkout_reference: data.checkout_reference,
        amount,
        current_plan: quote.current_plan_name || null
      }
    });

    window.open(data.checkout_url, '_blank', 'noopener');
  } catch (error) {
    console.error('Error iniciando checkout de suscripción:', error);
    await registrarAccionSensible({
      supabase,
      hotelId,
      usuarioId: userId,
      accion: 'CHECKOUT_SUSCRIPCION_FALLIDO',
      detalles: {
        payment_type: paymentType,
        billing_period: billingPeriod,
        currency,
        plan: plan?.nombre || 'N/A',
        error: error.message || 'Error desconocido'
      }
    });
    Swal.fire(
      'Error',
      `Ocurrió un error al iniciar el pago. (${error.message || 'Error desconocido'})`,
      'error'
    );
  }
}
