// supabase/functions/delete-user/index.ts
// VERSIÓN AUTOCONTENIDA PARA EL EDITOR WEB DE SUPABASE

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ----- INICIO DE LA CORRECCIÓN -----
// Hemos movido el contenido de 'cors.ts' directamente aquí
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
// ----- FIN DE LA CORRECCIÓN -----

serve(async (req) => {
  // Manejar la solicitud pre-vuelo OPTIONS para CORS, es un estándar de seguridad.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Crear un cliente de Supabase con permisos de administrador.
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Obtener el ID del usuario a eliminar del cuerpo de la solicitud.
    const { user_id } = await req.json()

    if (!user_id) {
      throw new Error("Se requiere el ID del usuario (user_id) para la eliminación.")
    }

    // Usar el cliente de admin para eliminar el usuario del sistema de autenticación.
    const { data, error } = await supabaseAdmin.auth.admin.deleteUser(user_id)

    if (error) {
      throw error
    }
    
    return new Response(JSON.stringify({ message: `Usuario ${user_id} eliminado con éxito.` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    })
  }
})