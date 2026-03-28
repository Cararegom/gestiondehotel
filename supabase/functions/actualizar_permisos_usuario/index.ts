import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// --- Manejo CORS universal ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
const supabaseUrl =
  Deno.env.get("SUPABASE_URL") ??
  Deno.env.get("PROJECT_URL") ??
  Deno.env.get("SUPA_URL");
const supabaseServiceRoleKey =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE_KEY") ??
  Deno.env.get("SERVICE_ROLE");
// TEST TEMPORAL: para saber si los envs llegan bien
if (!supabaseUrl || !supabaseServiceRoleKey) {
  serve((_req)=>new Response(JSON.stringify({
      error: "Faltan credenciales de service role para Supabase en secrets.",
      got_url: !!supabaseUrl,
      got_key: !!supabaseServiceRoleKey
    }), {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      },
      status: 500
    }));
} else {
  // ----------- Tu función principal normal aquí -----------
  serve(async (req)=>{
    // --- Preflight CORS ---
    if (req.method === "OPTIONS") {
      return new Response("OK", {
        headers: corsHeaders
      });
    }
    try {
      // Leer body
      const { usuario_id, permisos } = await req.json();
      // Conexión a Supabase (service role)
      const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
      // 1. Obtener roles asignados al usuario
      const { data: rolesUsuario, error: rolesUsuarioError } = await supabase.from("usuarios_roles").select("rol_id").eq("usuario_id", usuario_id);
      if (rolesUsuarioError) throw rolesUsuarioError;
      const rolesIds = (rolesUsuario || []).map((r)=>r.rol_id);
      // 2. Obtener permisos predeterminados por rol
      const { data: permisosRol, error: permisosRolError } = await supabase.from("roles_permisos").select("permiso_id").in("rol_id", rolesIds);
      if (permisosRolError) throw permisosRolError;
      const permisosRolSet = new Set((permisosRol || []).map((p)=>p.permiso_id));
      // 3. Para cada permiso enviado, lo aplicamos en usuarios_permisos
      for (const permiso of permisos){
        if (permiso.checked && !permisosRolSet.has(permiso.permiso_id)) {
          // Si el check está activo y NO está en los del rol => excepción (permitido=true)
          await supabase.from("usuarios_permisos").upsert({
            usuario_id,
            permiso_id: permiso.permiso_id,
            permitido: true
          }, {
            onConflict: "usuario_id, permiso_id"
          });
        } else if (!permiso.checked && permisosRolSet.has(permiso.permiso_id)) {
          // Si el check está desactivado y SÍ está en el rol => excepción (permitido=false)
          await supabase.from("usuarios_permisos").upsert({
            usuario_id,
            permiso_id: permiso.permiso_id,
            permitido: false
          }, {
            onConflict: "usuario_id, permiso_id"
          });
        } else {
          // Si no hay excepción, eliminamos de usuarios_permisos para dejar solo lo que dice el rol
          await supabase.from("usuarios_permisos").delete().eq("usuario_id", usuario_id).eq("permiso_id", permiso.permiso_id);
        }
      }
      return new Response(JSON.stringify({
        success: true,
        message: "Permisos actualizados correctamente."
      }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        },
        status: 200
      });
    } catch (e) {
      return new Response(JSON.stringify({
        error: e.message
      }), {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders
        },
        status: 500
      });
    }
  });
}
