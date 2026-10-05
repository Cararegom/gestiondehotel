import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  buildUserManagementCorsHeaders,
  isAllowedUserManagementOrigin,
} from "./user-management-cors.ts";
export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildUserManagementCorsHeaders(origin), "Content-Type": "application/json" },
  });
}
export function rpcError(error: { code?: string } | null): void {
  if (!error) return;
  if (error.code === "42501") throw new RequestError(403, "Operación no autorizada.");
  if (error.code === "28000") throw new RequestError(401, "Inicia sesión nuevamente.");
  if (["22023", "22P02"].includes(error.code || "")) throw new RequestError(400, "Solicitud inválida.");
  throw new RequestError(500, "No se pudo completar la operación.");
}
export type Actor = { id: string; client: SupabaseClient };
export type Dependencies = {
  authenticate: (req: Request) => Promise<Actor>;
  admin: () => SupabaseClient;
};
function url(): string {
  const value = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPA_URL");
  if (!value) throw new RequestError(500, "Servicio no disponible.");
  return value;
}
export const dependencies: Dependencies = {
  async authenticate(req) {
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "")?.[1];
    if (!token) throw new RequestError(401, "Debes iniciar sesión.");
    const key = Deno.env.get("SUPABASE_ANON_KEY");
    if (!key) throw new RequestError(500, "Servicio no disponible.");
    const client = createClient(url(), key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // Validación en Auth; nunca usar decode local ni user_metadata como autoridad.
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user?.id || data.user.is_anonymous) throw new RequestError(401, "Sesión inválida.");
    return { id: data.user.id, client };
  },
  admin() {
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE");
    if (!key) throw new RequestError(500, "Servicio no disponible.");
    return createClient(url(), key, { auth: { persistSession: false, autoRefreshToken: false } });
  },
};
export function endpoint(action: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin");
    const corsHeaders = buildUserManagementCorsHeaders(origin);
    if (!isAllowedUserManagementOrigin(origin)) {
      return json({ error: "Origen no permitido." }, 403, origin);
    }
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);
    try {
      const response = await action(req);
      const headers = new Headers(response.headers);
      for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      // No devolver ni registrar excepciones de Auth/SQL ni cuerpos con contraseñas.
      if (error instanceof RequestError) return json({ error: error.message }, error.status, origin);
      if (error instanceof SyntaxError) return json({ error: "Solicitud inválida." }, 400, origin);
      return json({ error: "No se pudo completar la operación." }, 500, origin);
    }
  };
}
export async function body(req: Request, allowed: string[]): Promise<Record<string, unknown>> {
  const value = await req.json();
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new RequestError(400, "Solicitud inválida.");
  }
  return value;
}
