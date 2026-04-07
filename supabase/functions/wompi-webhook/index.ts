import { serve } from "https://deno.land/std@0.132.0/http/server.ts";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

type BillingContext = {
  hotelId: string;
  planId: number;
  paymentType: "renew" | "upgrade" | "renew-downgrade";
  billingPeriod: "mensual" | "anual";
  reference: string;
};

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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date: Date, months: number) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function getDurationMonths(period: string) {
  return period === "anual" ? 12 : 1;
}

function getLatestAccessDate(hotel: Record<string, unknown>) {
  const now = new Date();
  return [hotel?.suscripcion_fin, hotel?.trial_fin, hotel?.gracia_hasta]
    .map(parseDate)
    .filter((date): date is Date => Boolean(date))
    .reduce((latest, current) => (current > latest ? current : latest), now);
}

function getCurrentCycleEnd(hotel: Record<string, unknown>) {
  const now = new Date();
  const futureDates = [hotel?.suscripcion_fin, hotel?.trial_fin, hotel?.gracia_hasta]
    .map(parseDate)
    .filter((date): date is Date => Boolean(date && date >= now));
  if (!futureDates.length) {
    return now;
  }
  return futureDates.reduce((latest, current) => (current > latest ? current : latest), now);
}

function parsePaymentTypeCode(code: string) {
  if (code === "rd") return "renew-downgrade";
  if (code === "u") return "upgrade";
  return "renew";
}

function parseBillingPeriodCode(code: string) {
  return code === "a" ? "anual" : "mensual";
}

function parseBillingReference(reference: string): BillingContext | null {
  const modernMatch = reference.match(/^gh2-(r|u|rd)-(m|a)-([a-f0-9-]{36})-(\d+)-(\d+)$/i);
  if (modernMatch) {
    return {
      hotelId: modernMatch[3],
      planId: Number.parseInt(modernMatch[4], 10),
      paymentType: parsePaymentTypeCode(modernMatch[1]) as BillingContext["paymentType"],
      billingPeriod: parseBillingPeriodCode(modernMatch[2]) as BillingContext["billingPeriod"],
      reference
    };
  }

  const legacyMatch = reference.match(/^(renew|upgrade|renew-downgrade)-([a-f0-9-]{36})-(\d+)-/i);
  if (legacyMatch) {
    return {
      hotelId: legacyMatch[2],
      planId: Number.parseInt(legacyMatch[3], 10),
      paymentType: legacyMatch[1].toLowerCase() as BillingContext["paymentType"],
      billingPeriod: "mensual",
      reference
    };
  }

  return null;
}

async function applySubscriptionPayment({
  supabase,
  context,
  amount,
  metodoPago
}: {
  supabase: ReturnType<typeof createClient>;
  context: BillingContext;
  amount: number;
  metodoPago: string;
}) {
  const { data: existingPayment } = await supabase
    .from("pagos")
    .select("id")
    .eq("checkout_reference", context.reference)
    .maybeSingle();

  if (existingPayment?.id) {
    return { ok: true, duplicated: true, message: "Pago ya procesado anteriormente." };
  }

  const [{ data: hotel, error: hotelError }, { data: selectedPlan, error: planError }] = await Promise.all([
    supabase
      .from("hoteles")
      .select("id, plan, plan_id, trial_inicio, trial_fin, suscripcion_inicio, suscripcion_fin, estado_suscripcion, gracia_hasta, plan_pendiente, plan_pendiente_id, plan_pendiente_desde, referido_por")
      .eq("id", context.hotelId)
      .maybeSingle(),
    supabase.from("planes").select("id, nombre").eq("id", context.planId).maybeSingle()
  ]);

  if (hotelError) {
    console.error("Error cargando hotel en webhook Wompi:", hotelError);
    return { ok: false, status: 500, error: "No se pudo cargar el hotel." };
  }

  if (!hotel) {
    return { ok: false, status: 404, error: "Hotel no encontrado." };
  }

  if (planError) {
    console.error("Error cargando plan en webhook Wompi:", planError);
    return { ok: false, status: 500, error: "No se pudo cargar el plan." };
  }

  if (!selectedPlan) {
    return { ok: false, status: 404, error: "Plan no encontrado." };
  }

  const now = new Date();
  const previousPlanName = String(hotel.plan ?? "").trim().toLowerCase();
  const previousPlanId = hotel.plan_id != null ? Number(hotel.plan_id) : null;
  const cycleBase = getLatestAccessDate(hotel);
  const currentCycleEnd = getCurrentCycleEnd(hotel);
  const durationMonths = getDurationMonths(context.billingPeriod);
  const extendsImmediately = currentCycleEnd <= now;

  const hotelUpdate: Record<string, unknown> = {
    estado_suscripcion: "activo",
    actualizado_en: now.toISOString(),
    trial_fin: null,
    gracia_hasta: null,
    gracia_motivo: null
  };

  if (!hotel.suscripcion_inicio) {
    hotelUpdate.suscripcion_inicio = hotel.trial_inicio || now.toISOString();
  }

  if (context.paymentType === "upgrade") {
    hotelUpdate.plan = selectedPlan.nombre;
    hotelUpdate.plan_id = selectedPlan.id;
    hotelUpdate.plan_pendiente = null;
    hotelUpdate.plan_pendiente_id = null;
    hotelUpdate.plan_pendiente_desde = null;
    hotelUpdate.suscripcion_fin = currentCycleEnd.toISOString();
  } else if (context.paymentType === "renew-downgrade" && !extendsImmediately && previousPlanName) {
    hotelUpdate.plan = previousPlanName;
    hotelUpdate.plan_id = previousPlanId;
    hotelUpdate.plan_pendiente = selectedPlan.nombre;
    hotelUpdate.plan_pendiente_id = selectedPlan.id;
    hotelUpdate.plan_pendiente_desde = currentCycleEnd.toISOString();
    hotelUpdate.suscripcion_fin = addMonths(cycleBase, durationMonths).toISOString();
  } else {
    hotelUpdate.plan = selectedPlan.nombre;
    hotelUpdate.plan_id = selectedPlan.id;
    hotelUpdate.plan_pendiente = null;
    hotelUpdate.plan_pendiente_id = null;
    hotelUpdate.plan_pendiente_desde = null;
    hotelUpdate.suscripcion_fin = addMonths(cycleBase, durationMonths).toISOString();
  }

  const { error: updateError } = await supabase
    .from("hoteles")
    .update(hotelUpdate)
    .eq("id", context.hotelId);

  if (updateError) {
    console.error("Error actualizando suscripcion desde Wompi:", updateError);
    return { ok: false, status: 500, error: "Error actualizando la suscripcion del hotel." };
  }

  const pagoPayload = {
    hotel_id: context.hotelId,
    plan: selectedPlan.nombre,
    monto: amount,
    metodo_pago: metodoPago,
    checkout_reference: context.reference,
    provider: "wompi",
    payment_type: context.paymentType,
    billing_period: context.billingPeriod,
    moneda: "COP"
  };

  const { error: pagoError } = await supabase.from("pagos").insert(pagoPayload);
  if (pagoError) {
    console.error("Error registrando pago Wompi:", pagoError);
    return { ok: false, status: 500, error: "Error registrando el pago del hotel." };
  }

  if (context.paymentType === "upgrade" || context.paymentType === "renew-downgrade") {
    await supabase.from("cambios_plan").insert({
      hotel_id: context.hotelId,
      plan_anterior: previousPlanName || null,
      plan_nuevo: selectedPlan.nombre,
      usuario_nombre: context.paymentType === "renew-downgrade" ? "Pago SaaS (programado)" : "Pago SaaS"
    });
  }

  try {
    if (hotel.referido_por) {
      const { data: hotelReferidor } = await supabase
        .from("hoteles")
        .select("suscripcion_fin")
        .eq("id", hotel.referido_por)
        .maybeSingle();

      const fechaActualVencimiento = hotelReferidor?.suscripcion_fin
        ? new Date(hotelReferidor.suscripcion_fin)
        : new Date();
      const hoy = new Date();
      const nuevaBase = fechaActualVencimiento < hoy ? hoy : fechaActualVencimiento;
      nuevaBase.setDate(nuevaBase.getDate() + 30);

      await supabase
        .from("hoteles")
        .update({
          suscripcion_fin: nuevaBase.toISOString(),
          estado_suscripcion: "activo"
        })
        .eq("id", hotel.referido_por);

      await supabase
        .from("hoteles")
        .update({ referido_por: null })
        .eq("id", context.hotelId);
    }
  } catch (refError) {
    console.error("Error aplicando referido desde Wompi:", refError);
  }

  return {
    ok: true,
    duplicated: false,
    message: "Suscripcion actualizada correctamente.",
    context
  };
}

serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Solo se permiten solicitudes POST" }, 405);
  }

  const WOMPI_EVENT_SECRET = Deno.env.get("WOMPI_EVENT_SECRET_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Payload invalido" }, 400);
  }

  try {
    const wompiSignature = payload.signature;
    const receivedChecksum = wompiSignature.checksum;

    const concatenatedValues = wompiSignature.properties.reduce((acc: string, prop: string) => {
      const propPath = prop.split(".");
      const value = propPath.reduce((o, key) => (o ? o[key] : undefined), payload.data);
      return acc + value;
    }, "");

    const stringToHash = `${concatenatedValues}${payload.timestamp}${WOMPI_EVENT_SECRET}`;
    const hashBuffer = await crypto.subtle.digest("SHA-256", str2ab(stringToHash));
    const calculatedChecksum = ab2hex(hashBuffer);

    if (calculatedChecksum.toLowerCase() !== receivedChecksum.toLowerCase()) {
      return json({ error: "Firma invalida" }, 403);
    }
  } catch {
    return json({ error: "No se pudo validar la firma" }, 400);
  }

  const transaction = payload?.data?.transaction;
  if (transaction?.status !== "APPROVED") {
    return json({ message: "Pago no aprobado" }, 200);
  }

  const reference = String(transaction?.reference || "");
  const context = parseBillingReference(reference);
  if (!context) {
    console.error("Referencia Wompi con formato invalido:", reference);
    return json({ error: "Referencia invalida" }, 200);
  }

  const result = await applySubscriptionPayment({
    supabase,
    context,
    amount: Number(transaction.amount_in_cents || 0) / 100,
    metodoPago: String(transaction.payment_method_type || "wompi")
  });

  if (!result.ok) {
    return json({ error: result.error }, result.status || 500);
  }

  return json({
    message: result.duplicated ? "Pago ya procesado." : "Suscripcion activada y pago registrado.",
    context: result.context
  });
});
