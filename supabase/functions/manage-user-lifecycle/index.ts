import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function normalizeRole(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function roleNames(profile: any): string[] {
  return (profile?.usuarios_roles ?? [])
    .map((item: any) => item?.roles?.nombre)
    .filter(Boolean)
    .map(normalizeRole);
}

function isHotelAdmin(profile: any) {
  const direct = normalizeRole(profile?.rol);
  const assigned = roleNames(profile);
  return profile?.activo === true && (
    direct === "admin" ||
    direct === "administrador" ||
    direct === "superadmin" ||
    assigned.includes("admin") ||
    assigned.includes("administrador") ||
    assigned.includes("superadmin")
  );
}

async function getAuthenticatedActor(req: Request, client: any) {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !serviceKey) return json({ error: "Configuración del servidor incompleta." }, 500);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const actor = await getAuthenticatedActor(req, admin);
    if (!actor) return json({ error: "Sesión inválida." }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim().toLowerCase();
    const userId = String(body?.user_id || "").trim();
    if (!userId || !["archive", "reactivate", "delete"].includes(action)) {
      return json({ error: "Acción o usuario inválido." }, 400);
    }
    if (userId === actor.id) return json({ error: "No puedes retirar o eliminar tu propio usuario." }, 409);

    const [{ data: actorProfile, error: actorError }, { data: target, error: targetError }] = await Promise.all([
      admin
        .from("usuarios")
        .select("id, hotel_id, activo, rol, usuarios_roles(roles(nombre))")
        .eq("id", actor.id)
        .maybeSingle(),
      admin
        .from("usuarios")
        .select("id, hotel_id, activo, nombre, correo, email, archivado_en")
        .eq("id", userId)
        .maybeSingle(),
    ]);

    if (actorError) throw actorError;
    if (targetError) throw targetError;
    if (!actorProfile || !isHotelAdmin(actorProfile)) {
      return json({ error: "Solo un administrador activo puede gestionar el retiro de empleados." }, 403);
    }
    if (!target) return json({ error: "Usuario no encontrado." }, 404);

    const isSuperadmin = normalizeRole(actorProfile.rol) === "superadmin" || roleNames(actorProfile).includes("superadmin");
    if (!isSuperadmin && String(actorProfile.hotel_id || "") !== String(target.hotel_id || "")) {
      return json({ error: "No puedes gestionar usuarios de otro hotel." }, 403);
    }

    const { data: hotel } = await admin
      .from("hoteles")
      .select("creado_por")
      .eq("id", target.hotel_id)
      .maybeSingle();
    if (hotel?.creado_por && String(hotel.creado_por) === userId) {
      return json({ error: "El propietario principal del hotel no puede retirarse desde este módulo." }, 409);
    }

    if (action === "archive") {
      if (target.activo === false) return json({ ok: true, action, already: true });

      const { error: profileError } = await admin
        .from("usuarios")
        .update({ activo: false, archivado_en: new Date().toISOString(), archivado_por: actor.id })
        .eq("id", userId)
        .eq("hotel_id", target.hotel_id);
      if (profileError) throw profileError;

      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: "876000h",
      });
      if (authError) {
        await admin
          .from("usuarios")
          .update({ activo: true, archivado_en: null, archivado_por: null })
          .eq("id", userId);
        throw new Error(`No se pudo bloquear el acceso del usuario: ${authError.message}`);
      }

      return json({ ok: true, action, user_id: userId });
    }

    if (action === "reactivate") {
      if (target.activo === true) return json({ ok: true, action, already: true });

      const { error: authError } = await admin.auth.admin.updateUserById(userId, {
        ban_duration: "none",
      });
      if (authError) throw new Error(`No se pudo reactivar el acceso: ${authError.message}`);

      const { error: profileError } = await admin
        .from("usuarios")
        .update({ activo: true, archivado_en: null, archivado_por: null })
        .eq("id", userId)
        .eq("hotel_id", target.hotel_id);
      if (profileError) {
        await admin.auth.admin.updateUserById(userId, { ban_duration: "876000h" });
        throw profileError;
      }

      return json({ ok: true, action, user_id: userId });
    }

    if (target.activo !== false) {
      return json({ error: "Primero retira al empleado antes de intentar eliminarlo definitivamente." }, 409);
    }

    const { data: dependencyInfo, error: dependencyError } = await admin.rpc(
      "usuario_dependencias_operativas",
      { p_usuario_id: userId },
    );
    if (dependencyError) throw dependencyError;

    if (Number(dependencyInfo?.total || 0) > 0) {
      return json({
        error: "Este usuario tiene historial operativo y no puede eliminarse. Déjalo archivado para conservar la trazabilidad.",
        code: "USER_HAS_HISTORY",
        dependencies: dependencyInfo,
      }, 409);
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    if (authDeleteError && !/not found/i.test(authDeleteError.message || "")) {
      throw authDeleteError;
    }

    const { error: profileDeleteError } = await admin
      .from("usuarios")
      .delete()
      .eq("id", userId)
      .eq("hotel_id", target.hotel_id);
    if (profileDeleteError) throw profileDeleteError;

    return json({ ok: true, action, user_id: userId });
  } catch (error) {
    console.error("[manage-user-lifecycle]", error);
    return json({ error: error instanceof Error ? error.message : "Error interno." }, 500);
  }
});
