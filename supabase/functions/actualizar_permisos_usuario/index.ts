import { body, dependencies, type Dependencies, endpoint, json, rpcError } from "../_shared/user-management.ts";

export function createHandler(deps: Dependencies = dependencies) {
  return endpoint(async (req) => {
    const actor = await deps.authenticate(req);
    const input = await body(req, ["usuario_id", "hotel_id", "permisos"]);
    const { error } = await actor.client.rpc("p0_actualizar_permisos_usuario", {
      p_usuario_id: input.usuario_id ?? null,
      p_hotel_id: input.hotel_id ?? null,
      p_permisos: input.permisos ?? null,
    });
    rpcError(error);
    return json({ success: true, message: "Permisos actualizados correctamente." });
  });
}
if (import.meta.main) Deno.serve(createHandler());
