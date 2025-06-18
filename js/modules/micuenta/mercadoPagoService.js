// modules/micuenta/mercadoPagoService.js

const MERCADOPAGO_TOKEN = "Bearer APP_USR-756621933957452-061812-c43dd907d4026b416ae63608c2965003-298434731";

export async function abrirMercadoPagoCheckout(plan, tipo, montoPagarUSD, hotelId, userEmail) {
  const reference = `mp-${tipo}-${hotelId}-${plan.id}-${Date.now()}`;
  const montoFixed = Number(parseFloat(montoPagarUSD || 0).toFixed(2));

  if (montoFixed <= 0) {
      console.warn("Se ha bloqueado un intento de pago por $0 a Mercado Pago.");
      if(typeof Swal !== 'undefined') {
          Swal.fire('Monto Inválido', 'El monto a pagar es $0.00, por lo que no se requiere procesar un pago.', 'info');
      } else {
          alert('El monto a pagar es $0.00, por lo que no se requiere procesar un pago.');
      }
      return;
  }

  try {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      'event': tipo === 'upgrade' ? 'cambio_plan_mp' : 'renovacion_plan_mp',
      'currency': 'USD',
      'value': montoFixed,
      'plan': plan.nombre,
      'hotel_id': hotelId,
    });
  } catch (e) {
    console.error("Error enviando evento a Google Analytics:", e);
  }

  if (typeof Swal === 'undefined') {
    alert('Ocurrió un error al cargar componentes de la página. Por favor, refresca.');
    return;
  }
  
// En mercadoPagoService.js

// ...

  const result = await Swal.fire({
    icon: 'info',
    title: 'Serás redirigido a Mercado Pago',
    // --- INICIO DE LA MODIFICACIÓN ---
    html: `
      <div style="text-align: left; padding: 0 1rem;">
          Estás a punto de ir a nuestra pasarela de pago segura.
          <div style="margin-top: 1rem; padding: 0.8rem; background-color: #f0f5ff; border: 1px solid #adc6ff; border-radius: 8px; font-size: 0.9em; color: #2d3748;">
              <b>Nota sobre la moneda:</b> Para procesar tu pago de forma segura a través de Mercado Pago Colombia, el monto final se mostrará en Pesos Colombianos (COP).</strong>.
              <br><br>
              No te preocupes, el valor es el equivalente exacto a tu total en dólares.

          </div>
          <div style="margin-top: 1rem; font-weight: 600;">
              Valor de referencia: <b>$${montoFixed.toFixed(2)} USD</b>
          </div>
      </div>
    `,
    // --- FIN DE LA MODIFICACIÓN ---
    confirmButtonText: 'Entendido, continuar al pago',
    cancelButtonText: 'Cancelar',
    showCancelButton: true,
    confirmButtonColor: '#1d4ed8', // Tono azul para consistencia
    cancelButtonColor: '#64748b'
  });

// ...
  if (!result.isConfirmed) {
    return;
  }

  try {
    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": MERCADOPAGO_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [{
          title: `Suscripción ${plan.nombre} (${tipo}) - Gestión de Hotel`,
          quantity: 1,
          currency_id: "USD",
          unit_price: montoFixed
        }],
        payer: {
          email: userEmail || "noemail@example.com"
        },
        external_reference: reference,
        notification_url: "https://iikpqpdoslyduecibaij.supabase.co/functions/v1/mercadopagoWebhook",
        back_urls: {
          success: window.location.href,
          pending: window.location.href,
          failure: window.location.href
        }
        // SE HA ELIMINADO LA SIGUIENTE LÍNEA PARA SOLUCIONAR EL ERROR:
        // auto_return: "approved" 
      })
    });

    const data = await response.json();

    if (response.ok && data.init_point) {
      window.open(data.init_point, "_blank");
    } else {
      console.error("❌ Error creando preferencia de pago en Mercado Pago:", JSON.stringify(data, null, 2));
      Swal.fire('Error', `Ocurrió un error al iniciar el pago con Mercado Pago. (Detalle: ${data.message || 'Error desconocido'})`, 'error');
    }
  } catch (error) {
    console.error("❌ Error en la conexión con Mercado Pago:", error);
    Swal.fire('Error', 'No se pudo conectar con Mercado Pago. Revisa tu conexión a internet.', 'error');
  }
}