import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function utcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  const date = utcDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDate(date);
}

function daysBetween(a: string, b: string) {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / 86_400_000);
}

function todayInTimeZone(timeZone = "America/Bogota") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function roleNames(profile: any) {
  return (profile?.usuarios_roles ?? [])
    .map((item: any) => item?.roles?.nombre)
    .filter(Boolean)
    .map(normalize);
}

function isAdmin(profile: any) {
  const direct = normalize(profile?.rol);
  const roles = roleNames(profile);
  return profile?.activo === true && (
    ["admin", "administrador", "superadmin"].includes(direct) ||
    roles.some((role: string) => ["admin", "administrador", "superadmin"].includes(role))
  );
}

function isSuperadmin(profile: any) {
  return normalize(profile?.rol) === "superadmin" || roleNames(profile).includes("superadmin");
}

async function getActor(req: Request, admin: SupabaseClient) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;

  const { data: profile, error: profileError } = await admin
    .from("usuarios")
    .select("id, hotel_id, activo, rol, usuarios_roles(roles(nombre))")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !isAdmin(profile)) return null;
  return { user: data.user, profile };
}

async function loadReceptionists(admin: SupabaseClient, hotelId: string) {
  const { data: role, error: roleError } = await admin
    .from("roles")
    .select("id")
    .ilike("nombre", "Recepcionista")
    .limit(1)
    .maybeSingle();
  if (roleError) throw roleError;
  if (!role) return [];

  const { data: links, error: linksError } = await admin
    .from("usuarios_roles")
    .select("usuario_id")
    .eq("hotel_id", hotelId)
    .eq("rol_id", role.id);
  if (linksError) throw linksError;

  const ids = [...new Set((links || []).map((item: any) => String(item.usuario_id)).filter(Boolean))];
  if (!ids.length) return [];

  const { data, error } = await admin
    .from("usuarios")
    .select("id, nombre")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .in("id", ids)
    .order("nombre");
  if (error) throw error;
  return data || [];
}

async function loadTemplates(admin: SupabaseClient, hotelId: string) {
  const { data, error } = await admin
    .from("horario_plantillas_turno")
    .select("id, codigo, nombre, hora_inicio, hora_fin, es_nocturno, es_extendido, grupo, orden")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .order("orden");
  if (error) throw error;
  return data || [];
}

async function loadRequests(admin: SupabaseClient, hotelId: string, today: string) {
  const { data, error } = await admin
    .from("horario_solicitudes")
    .select("id, usuario_id, fecha_inicio, fecha_fin, tipo, plantilla_turno_id, obligatorio, motivo, activo, creado_en")
    .eq("hotel_id", hotelId)
    .eq("activo", true)
    .gte("fecha_fin", addDays(today, -7))
    .lte("fecha_inicio", addDays(today, 120))
    .order("fecha_inicio")
    .order("creado_en");
  if (error) throw error;
  return data || [];
}

function nextTarget(today: string, period: string) {
  const date = utcDate(today);
  if (period === "mes") {
    const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, 12));
    const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 2, 0, 12));
    return { start: isoDate(start), end: isoDate(end) };
  }

  const day = date.getUTCDay();
  const untilMonday = day === 0 ? 1 : 8 - day;
  const start = addDays(today, untilMonday);
  return { start, end: addDays(start, 6) };
}

async function callEngine(req: Request, body: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const authorization = req.headers.get("Authorization") || "";
  if (!url || !authorization) throw new Error("No se pudo invocar el motor de horarios.");

  const response = await fetch(`${url}/functions/v1/horario-engine`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": authorization,
      ...(anon ? { apikey: anon } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false || payload?.error) {
    throw new Error(payload?.error || `horario-engine respondió ${response.status}.`);
  }
  return payload;
}

async function maybeAutoPrepare(
  req: Request,
  admin: SupabaseClient,
  hotelId: string,
  config: any,
  users: any[],
  today: string,
) {
  if (config?.autopreparar_activo !== true) return { created: false, reason: "disabled" };
  if (users.length < 2) return { created: false, reason: "insufficient_staff" };

  const period = config.autopreparar_periodo === "mes" ? "mes" : "semana";
  const anticipation = Math.min(14, Math.max(1, Number(config.autopreparar_dias_anticipacion || 3)));
  const target = nextTarget(today, period);
  if (daysBetween(today, target.start) > anticipation) {
    return { created: false, reason: "outside_window", ...target };
  }

  const { data: existing, error } = await admin
    .from("horario_borradores")
    .select("id, estado")
    .eq("hotel_id", hotelId)
    .eq("fecha_inicio", target.start)
    .eq("fecha_fin", target.end)
    .in("estado", ["borrador", "publicado"])
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return { created: false, reason: "already_exists", draft_id: existing.id, estado: existing.estado, ...target };

  try {
    const generated = await callEngine(req, {
      action: "generate",
      fecha_inicio: target.start,
      fecha_fin: target.end,
      usuario_ids: users.map((item) => item.id),
    });
    return {
      created: true,
      reason: "prepared",
      draft_id: generated.draft_id,
      validacion: generated.validacion,
      ...target,
    };
  } catch (error) {
    return {
      created: false,
      reason: "engine_error",
      error: error instanceof Error ? error.message : "No se pudo autopreparar el horario.",
      ...target,
    };
  }
}

async function assertReceptionist(admin: SupabaseClient, hotelId: string, userId: string) {
  const users = await loadReceptionists(admin, hotelId);
  if (!users.some((item: any) => item.id === userId)) {
    throw new Error("El usuario seleccionado no es una recepcionista activa del hotel.");
  }
}

async function saveRequest(admin: SupabaseClient, hotelId: string, actorId: string, body: any, today: string) {
  const userId = String(body?.usuario_id || "");
  const start = String(body?.fecha_inicio || "");
  const end = String(body?.fecha_fin || "");
  const type = String(body?.tipo || "");
  const templateId = body?.plantilla_turno_id ? String(body.plantilla_turno_id) : null;
  const allowed = new Set(["no_disponible", "descanso", "turno_fijo", "preferir_turno", "evitar_turno"]);

  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    throw new Error("Completa recepcionista y fechas válidas.");
  }
  if (!allowed.has(type)) throw new Error("Tipo de solicitud inválido.");
  if (end < start) throw new Error("La fecha final no puede ser anterior a la inicial.");
  if (daysBetween(start, end) > 31) throw new Error("Una solicitud no puede abarcar más de 32 días.");
  if (end < today) throw new Error("No se pueden crear solicitudes completamente vencidas.");
  await assertReceptionist(admin, hotelId, userId);

  const needsTemplate = ["turno_fijo", "preferir_turno", "evitar_turno"].includes(type);
  if (needsTemplate && !templateId) throw new Error("Selecciona el turno relacionado con la solicitud.");
  if (!needsTemplate && templateId) throw new Error("Este tipo de solicitud no requiere un turno específico.");

  if (templateId) {
    const { data: template, error } = await admin
      .from("horario_plantillas_turno")
      .select("id")
      .eq("id", templateId)
      .eq("hotel_id", hotelId)
      .eq("activo", true)
      .maybeSingle();
    if (error) throw error;
    if (!template) throw new Error("El turno seleccionado no pertenece al hotel.");
  }

  const { data, error } = await admin
    .from("horario_solicitudes")
    .insert({
      hotel_id: hotelId,
      usuario_id: userId,
      fecha_inicio: start,
      fecha_fin: end,
      tipo: type,
      plantilla_turno_id: templateId,
      obligatorio: body?.obligatorio !== false,
      motivo: String(body?.motivo || "").trim() || null,
      activo: true,
      creado_por: actorId,
      actualizado_en: new Date().toISOString(),
    })
    .select("id, usuario_id, fecha_inicio, fecha_fin, tipo, plantilla_turno_id, obligatorio, motivo, activo, creado_en")
    .single();
  if (error) throw error;
  return data;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  let secret = "";
  try {
    secret = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default || "";
  } catch {
    // fallback below
  }
  secret ||= Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !secret) return json({ error: "Configuración del servidor incompleta." }, 500);

  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const actor = await getActor(req, admin);
    if (!actor) return json({ error: "Solo un administrador activo puede gestionar horarios." }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "bootstrap");
    const requestedHotel = body?.hotel_id ? String(body.hotel_id) : "";
    const hotelId = isSuperadmin(actor.profile) && requestedHotel
      ? requestedHotel
      : String(actor.profile.hotel_id || "");
    if (!hotelId) return json({ error: "No se pudo resolver el hotel." }, 400);
    if (!isSuperadmin(actor.profile) && requestedHotel && requestedHotel !== hotelId) {
      return json({ error: "No puedes gestionar horarios de otro hotel." }, 403);
    }

    const { data: config, error: configError } = await admin
      .from("horario_configuracion")
      .select("*")
      .eq("hotel_id", hotelId)
      .maybeSingle();
    if (configError) throw configError;
    if (!config) return json({ error: "Primero abre el creador de horarios para inicializar su configuración." }, 409);

    const timeZone = String(config.zona_horaria || "America/Bogota");
    const today = todayInTimeZone(timeZone);

    if (action === "bootstrap") {
      const users = await loadReceptionists(admin, hotelId);
      const templates = await loadTemplates(admin, hotelId);
      const auto = await maybeAutoPrepare(req, admin, hotelId, config, users, today);
      const requests = await loadRequests(admin, hotelId, today);
      return json({ ok: true, config, usuarios: users, plantillas: templates, solicitudes: requests, autopreparado: auto, hoy: today });
    }

    if (action === "save_automation") {
      const period = body?.autopreparar_periodo === "mes" ? "mes" : "semana";
      const days = Math.min(14, Math.max(1, Number(body?.autopreparar_dias_anticipacion || 3)));
      const patch = {
        autopreparar_activo: body?.autopreparar_activo === true,
        autopreparar_periodo: period,
        autopreparar_dias_anticipacion: days,
        actualizado_en: new Date().toISOString(),
        actualizado_por: actor.user.id,
      };
      const { data, error } = await admin
        .from("horario_configuracion")
        .update(patch)
        .eq("hotel_id", hotelId)
        .select("*")
        .single();
      if (error) throw error;
      return json({ ok: true, config: data });
    }

    if (action === "save_request") {
      const saved = await saveRequest(admin, hotelId, actor.user.id, body, today);
      return json({ ok: true, solicitud: saved });
    }

    if (action === "cancel_request") {
      const requestId = String(body?.solicitud_id || "");
      if (!requestId) throw new Error("Solicitud inválida.");
      const { data, error } = await admin
        .from("horario_solicitudes")
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq("id", requestId)
        .eq("hotel_id", hotelId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return json({ error: "La solicitud no existe o ya fue retirada." }, 404);
      return json({ ok: true, solicitud_id: requestId });
    }

    return json({ error: "Acción no soportada." }, 400);
  } catch (error) {
    console.error("[horario-operations]", error);
    return json({ error: error instanceof Error ? error.message : "Error interno de horarios." }, 500);
  }
});
