import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js";

// 1. Define los encabezados CORS
// Para producción, es más seguro reemplazar '*' con la URL de tu sitio web
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  // 2. Maneja la solicitud "preflight" de OPTIONS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Variables de entorno
    const supabaseUrl = Deno.env.get("PROJECT_URL");
    const supabaseServiceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
        throw new Error("Missing Supabase environment variables.");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Recibe el body
    // Ojo: En tu frontend lo envías como `roles`, aquí lo esperas como `roles_ids`. Ajusté el código para que espere `roles`
    const { correo, password, nombre, hotel_id, roles } = await req.json();

    if (!correo || !password || !nombre || !hotel_id || !roles?.length) {
      return new Response(JSON.stringify({ error: "Datos incompletos." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    // 1. Crear usuario en Auth
    const { data: userData, error: authError } = await supabase.auth.admin.createUser({
      email: correo,
      password: password,
      email_confirm: true, // Se recomienda confirmar el email
      user_metadata: { nombre: nombre }
    });

    if (authError) {
      // Devolvemos el error específico de Supabase
      return new Response(JSON.stringify({ error: authError.message }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400
      });
    }

    const userId = userData.user.id;

    // 2. Crear perfil en la tabla 'usuarios'
    const { error: perfilError } = await supabase.from('usuarios').insert({
      id: userId,
      nombre,
      correo,
      hotel_id,
      activo: true
      // No es necesario 'creado_en', Supabase puede manejarlo automáticamente con un `default`
    });

    if (perfilError) {
      // Si esto falla, es buena idea eliminar el usuario de Auth para no dejar datos inconsistentes
      await supabase.auth.admin.deleteUser(userId);
      return new Response(JSON.stringify({ error: `Error creando perfil: ${perfilError.message}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }

    // 3. Asignar roles
    const rolesData = roles.map((rolId) => ({
      usuario_id: userId,
      rol_id: rolId,
      hotel_id: hotel_id
    }));

    const { error: rolesError } = await supabase.from('usuarios_roles').insert(rolesData);

    if (rolesError) {
      // Si esto falla, eliminamos el usuario y su perfil
      await supabase.auth.admin.deleteUser(userId);
      await supabase.from('usuarios').delete().eq('id', userId);
      return new Response(JSON.stringify({ error: `Error asignando roles: ${rolesError.message}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      });
    }

    // Si todo sale bien
    return new Response(JSON.stringify({ message: "Usuario creado exitosamente", userId: userId }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200
    });

  } catch (error) {
    // Captura cualquier otro error inesperado
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500
    });
  }
});