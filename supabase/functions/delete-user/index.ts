import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { buildUserManagementCorsHeaders } from "../_shared/user-management-cors.ts";

Deno.serve(async (req: Request) => {
  const corsHeaders = buildUserManagementCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  return new Response(JSON.stringify({
    error: "La eliminación directa de usuarios fue deshabilitada por seguridad. Usa el flujo Retirar empleado / Archivados.",
    code: "DIRECT_USER_DELETE_DISABLED",
  }), {
    status: 410,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
