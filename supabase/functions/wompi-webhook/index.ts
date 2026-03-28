import { serve } from "https://deno.land/std@0.132.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// --- Helpers para criptografía (sin cambios) ---
function str2ab(str: string): ArrayBuffer {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function ab2hex(ab: ArrayBuffer): string {
  return Array.from(new Uint8Array(ab))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// --- Función principal del Webhook ---
serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Solo se permiten solicitudes POST" }), {
      status: 405, headers: { "Content-Type": "application/json" },
    });
  }

  const WOMPI_EVENT_SECRET = Deno.env.get("WOMPI_EVENT_SECRET_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload;
  try {
    payload = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Payload inválido" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Validación de firma (sin cambios)
  try {
    const wompiSignature = payload.signature;
    const receivedChecksum = wompiSignature.checksum;
    
    const concatenatedValues = wompiSignature.properties.reduce((acc: string, prop: string) => {
        const propPath = prop.split('.');
        const value = propPath.reduce((o, key) => o ? o[key] : undefined, payload.data);
        return acc + value;
    }, "");

    const stringToHash = `${concatenatedValues}${payload.timestamp}${WOMPI_EVENT_SECRET}`;
    const hashBuffer = await crypto.subtle.digest("SHA-256", str2ab(stringToHash));
    const calculatedChecksum = ab2hex(hashBuffer);

    if (calculatedChecksum.toLowerCase() !== receivedChecksum.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Firma inválida" }), {
        status: 403, headers: { "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: "No se pudo validar la firma" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  
  const transaction = payload?.data?.transaction;
  if (transaction?.status !== "APPROVED") {
    return new Response(JSON.stringify({ message: "Pago no aprobado" }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }
  
  const reference = transaction?.reference || "";
  
  // --- LÓGICA DE PLAN DINÁMICO ---
  // Expresión regular mejorada para capturar hotel_id y plan_id
  const match = reference.match(/^[a-z]+-([a-f0-9-]{36})-(\d+)-/i);
  
  if (!match) {
    console.error("Referencia con formato inválido:", reference);
    return new Response(JSON.stringify({ error: "Referencia inválida" }), { status: 200 });
  }
  
  const hotel_id = match[1];
  const plan_id = parseInt(match[2]);

  // Consultar el nombre del plan usando el plan_id
  const { data: planData, error: errPlan } = await supabase
    .from('planes')
    .select('nombre')
    .eq('id', plan_id)
    .single();

  if (errPlan || !planData) {
    console.error(`Plan con ID ${plan_id} no encontrado:`, errPlan);
    return new Response(JSON.stringify({ error: "Plan no encontrado" }), { status: 404 });
  }
  const plan_nombre = planData.nombre;

  const now = new Date();
  const suscripcion_fin = new Date(now);
  suscripcion_fin.setMonth(suscripcion_fin.getMonth() + 1);

  // 1. Actualizar la suscripción del hotel que pagó con el plan correcto
  const { error: errUpdate } = await supabase.from("hoteles").update({
    estado_suscripcion: "activo",
    trial_fin: null,
    suscripcion_fin: suscripcion_fin.toISOString(),
    plan: plan_nombre, // Usamos el nombre del plan dinámico
    actualizado_en: now.toISOString(),
  }).eq("id", hotel_id);

  if (errUpdate) {
    console.error(`Error al actualizar hotel ${hotel_id}:`, errUpdate);
    return new Response(JSON.stringify({ error: "Error de DB al actualizar hotel" }), { status: 500 });
  }

  // 2. Registrar el pago con el plan correcto
  await supabase.from('pagos').insert({
      hotel_id: hotel_id,
      plan: plan_nombre, // Usamos el nombre del plan dinámico
      monto: transaction.amount_in_cents / 100,
      metodo_pago: transaction.payment_method_type,
  });

  // --- LÓGICA DE REFERIDOS CORREGIDA ---
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
      
      const fechaActualVencimiento = hotelReferidor.suscripcion_fin ? new Date(hotelReferidor.suscripcion_fin) : new Date();
      const hoy = new Date();
      const nuevaBase = fechaActualVencimiento < hoy ? hoy : fechaActualVencimiento;
      nuevaBase.setDate(nuevaBase.getDate() + 30);
      
      // -- CORRECCIÓN: Actualizamos también el estado del referidor a 'activo' --
      await supabase
        .from("hoteles")
        .update({ 
            suscripcion_fin: nuevaBase.toISOString(),
            estado_suscripcion: 'activo' 
        })
        .eq("id", referidor_id);

      await supabase
        .from("hoteles")
        .update({ referido_por: null })
        .eq("id", hotel_id);
      
      console.log(`Bonificación por referido aplicada a ${referidor_id}. Estado actualizado a activo.`);
    }
  } catch (refError) {
    console.error("Error en la lógica de referidos:", refError);
  }

  return new Response(JSON.stringify({ message: "✅ Proceso completado: Suscripción activada, pago registrado y referido procesado." }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});