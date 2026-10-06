import { body, dependencies, type Dependencies, endpoint, json, RequestError, rpcError } from "../_shared/user-management.ts";

export function createHandler(deps: Dependencies = dependencies) {
  return endpoint(async (req) => {
    const actor = await deps.authenticate(req);
    const input = await body(req, ["correo", "password", "nombre", "hotel_id", "roles", "activo"]);
    const { correo, password, nombre, roles } = input;
    const activo = input.activo ?? true;
    if (typeof correo !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) || correo.length > 254 ||
        typeof nombre !== "string" || nombre.trim().length < 3 || nombre.length > 200 ||
        typeof password !== "string" || password.length < 8 || password.length > 1024 || typeof activo !== "boolean") {
      throw new RequestError(400, "Datos inválidos.");
    }
    const { data: hotelId, error: authorizationError } = await actor.client.rpc("p0_autorizar_colaborador", {
      p_hotel_id: input.hotel_id ?? null, p_roles: roles ?? null,
    });
    rpcError(authorizationError);
    if (typeof hotelId !== "string") throw new RequestError(403, "Operación no autorizada.");
    // El cliente privilegiado solo se obtiene después de autenticar Y autorizar.
    const admin = deps.admin();
    const { data, error } = await admin.auth.admin.createUser({
      email: correo.trim(), password, email_confirm: true, ban_duration: "876000h",
      user_metadata: { nombre: nombre.trim() },
      app_metadata: { p0_created_by: actor.id, p0_hotel_id: hotelId },
    });
    if (error || !data.user?.id) throw new RequestError(400, "No se pudo crear el usuario con los datos indicados.");
    const userId = data.user.id;
    try {
      // Reautoriza dentro de la transacción; app_metadata solo lo escribe Auth Admin.
      const { error: profileError } = await actor.client.rpc("p0_finalizar_colaborador", {
        p_usuario_id: userId, p_hotel_id: hotelId, p_roles: roles,
        p_nombre: nombre.trim(), p_activo: activo,
      });
      rpcError(profileError);
      if (activo) {
        const { error: enableError } = await admin.auth.admin.updateUserById(userId, { ban_duration: "none" });
        if (enableError) throw new RequestError(500, "No se pudo habilitar el acceso.");
      }
    } catch (failure) {
      // configuracion_turnos is created by a profile trigger and has no cascading FK.
      // Attempt every compensation even if one transport request throws.
      let rollbackFailed = false;
      for (const cleanup of [
        () => admin.from("configuracion_turnos").delete().eq("usuario_id", userId).eq("hotel_id", hotelId),
        () => admin.auth.admin.deleteUser(userId),
        () => admin.from("usuarios").delete().eq("id", userId).eq("hotel_id", hotelId),
      ]) {
        try {
          const { error: cleanupError } = await cleanup();
          if (cleanupError) rollbackFailed = true;
        } catch { rollbackFailed = true; }
      }
      if (rollbackFailed) {
        console.error("[crear_colaborador] ROLLBACK_INCOMPLETE");
        throw new RequestError(500, "No se completó la creación. Se requiere revisión del administrador del sistema.");
      }
      throw failure;
    }
    return json({ message: "Usuario creado exitosamente", userId });
  });
}
if (import.meta.main) Deno.serve(createHandler());
