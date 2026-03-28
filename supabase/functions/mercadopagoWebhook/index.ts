import { serve } from "https://deno.land/std@0.132.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Solo se permiten solicitudes POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  );

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Payload inválido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 👁️ Validar tipo de notificación
  const topic = payload?.type || payload?.action || "";
  const data_id = payload?.data?.id || null;

  if (!data_id) {
    return new Response(JSON.stringify({ error: "No se recibió ID de pago" }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 🔄 Consultar el pago desde Mercado Pago
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${data_id}`, {
    headers: {
      Authorization: `Bearer ${Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")}`
    }
  });

  const pago = await response.json();

  if (!pago || pago.status !== "approved") {
    return new Response(JSON.stringify({ message: "Pago no aprobado aún o inválido" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }

  const reference = pago.external_reference || "";
  const metodo = pago.payment_method_id || "mercadopago";

  // 🧠 Reutilizamos tu lógica de Wompi
  const match = reference.match(/^[a-z]+-([a-f0-9-]{36})-(\d+)-/i);
  if (!match) {
    console.error("Referencia con formato inválido:", reference);
    return new Response(JSON.stringify({ error: "Referencia inválida" }), {
      status: 200
    });
  }

  const hotel_id = match[1];
  const plan_id = parseInt(match[2]);

  const { data: planData, error: errPlan } = await supabase
    .from("planes")
    .select("nombre")
    .eq("id", plan_id)
    .single();

  if (errPlan || !planData) {
    console.error(`Plan con ID ${plan_id} no encontrado:`, errPlan);
    return new Response(JSON.stringify({ error: "Plan no encontrado" }), {
      status: 404
    });
  }

  const plan_nombre = planData.nombre;
  const now = new Date();
  const suscripcion_fin = new Date(now);
  suscripcion_fin.setMonth(suscripcion_fin.getMonth() + 1);

  // 👉 Actualizar hotel
  const { error: errUpdate } = await supabase
    .from("hoteles")
    .update({
      estado_suscripcion: "activo",
      trial_fin: null,
      suscripcion_fin: suscripcion_fin.toISOString(),
      plan: plan_nombre,
      actualizado_en: now.toISOString()
    })
    .eq("id", hotel_id);

  if (errUpdate) {
    console.error(`Error al actualizar hotel ${hotel_id}:`, errUpdate);
    return new Response(JSON.stringify({ error: "Error al actualizar hotel" }), {
      status: 500
    });
  }

  // 👉 Registrar el pago
  await supabase.from("pagos").insert({
    hotel_id: hotel_id,
    plan: plan_nombre,
    monto: pago.transaction_amount,
    metodo_pago: metodo
  });

  // 👉 Procesar referidos si aplica
  try {
    const { data: hotelQuePago } = await supabase
      .from("hoteles")
      .select("referido_por")
      .eq("id", hotel_id)
      .single();

    if (hotelQuePago?.referido_por) {
      const referidor_id = hotelQuePago.referido_por;
      const { data: hotelReferidor } = await supabase
        .from("hoteles")
        .select("suscripcion_fin")
        .eq("id", referidor_id)
        .single();

      const fechaActualVencimiento = hotelReferidor?.suscripcion_fin
        ? new Date(hotelReferidor.suscripcion_fin)
        : new Date();

      const hoy = new Date();
      const nuevaBase = fechaActualVencimiento < hoy ? hoy : fechaActualVencimiento;
      nuevaBase.setDate(nuevaBase.getDate() + 30);

      await supabase.from("hoteles").update({
        suscripcion_fin: nuevaBase.toISOString(),
        estado_suscripcion: "activo"
      }).eq("id", referidor_id);

      await supabase.from("hoteles").update({ referido_por: null }).eq("id", hotel_id);

      console.log(`Bonificación de referido aplicada a hotel ${referidor_id}`);
    }
  } catch (refError) {
    console.error("Error en lógica de referidos (MercadoPago):", refError);
  }

  return new Response(
    JSON.stringify({
      message: "✅ Suscripción activada y pago registrado con Mercado Pago"
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
});
