// /supabase/functions/update-overdue-rooms/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.0.0";

serve(async (req) => {
  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` } } }
    );

    const nowISO = new Date().toISOString();

    // 1. Buscar todas las reservas 'activas' u 'ocupadas' cuyo tiempo ya terminó.
    const { data: overdueReservas, error: overdueError } = await supabaseClient
      .from("reservas")
      .select("habitacion_id")
      .in("estado", ["activa", "ocupada"])
      .lte("fecha_fin", nowISO);

    if (overdueError) throw overdueError;

    if (!overdueReservas || overdueReservas.length === 0) {
      return new Response(JSON.stringify({ message: "No overdue rooms to update." }), {
        headers: { "Content-Type": "application/json" },
        status: 200,
      });
    }

    // 2. Extraer los IDs de las habitaciones que necesitan actualización.
    const roomIdsToUpdate = overdueReservas.map(r => r.habitacion_id);

    // 3. Actualizar el estado de esas habitaciones a 'tiempo agotado' en un solo lote.
    const { error: updateError } = await supabaseClient
      .from("habitaciones")
      .update({ estado: "tiempo agotado" })
      .in("id", roomIdsToUpdate);

    if (updateError) throw updateError;
    
    console.log(`Successfully updated ${roomIdsToUpdate.length} rooms to 'tiempo agotado'.`);

    return new Response(JSON.stringify({ success: true, updated_rooms: roomIdsToUpdate.length }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
});