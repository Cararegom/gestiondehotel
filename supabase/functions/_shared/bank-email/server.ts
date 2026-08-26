import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.111.0';
import { HttpError } from './http.ts';

export interface BankEmailUserProfile {
  id: string;
  hotel_id: string | null;
  rol: string | null;
  activo: boolean | null;
}

export interface AuthenticatedRequestContext {
  user: User;
  profile: BankEmailUserProfile;
  accessToken: string;
}

function requiredEnvironmentValue(name: string): string {
  const value = Deno.env.get(name) || '';
  if (!value) {
    throw Object.assign(new Error(`${name} no esta configurada.`), {
      code: `missing_${name.toLowerCase()}`
    });
  }
  return value;
}

export function buildAdminClient(): SupabaseClient {
  return createClient(
    requiredEnvironmentValue('SUPABASE_URL'),
    requiredEnvironmentValue('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'gestiondehotel-bank-email-server' } }
    }
  );
}

export function buildUserClient(accessToken: string): SupabaseClient {
  return createClient(
    requiredEnvironmentValue('SUPABASE_URL'),
    requiredEnvironmentValue('SUPABASE_ANON_KEY'),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Client-Info': 'gestiondehotel-bank-email-user'
        }
      }
    }
  );
}

export function readBearerToken(req: Request): string {
  const authorization = req.headers.get('authorization') || '';
  const match = /^Bearer\s+([^\s]+)$/iu.exec(authorization);
  if (!match?.[1]) {
    throw new HttpError(401, 'missing_authorization', 'Se requiere una sesion valida.');
  }
  return match[1];
}

export async function requireAuthenticatedProfile(
  req: Request,
  admin = buildAdminClient()
): Promise<AuthenticatedRequestContext> {
  const accessToken = readBearerToken(req);
  const { data: userResult, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userResult.user) {
    throw new HttpError(401, 'invalid_session', 'La sesion no es valida o expiro.');
  }

  const { data: profile, error: profileError } = await admin
    .from('usuarios')
    .select('id, hotel_id, rol, activo')
    .eq('id', userResult.user.id)
    .maybeSingle();

  if (profileError) {
    throw Object.assign(new Error('No se pudo consultar el perfil del usuario.'), {
      code: 'profile_lookup_failed'
    });
  }
  if (!profile || profile.activo !== true) {
    throw new HttpError(403, 'inactive_or_missing_profile', 'El perfil no esta habilitado.');
  }

  return {
    user: userResult.user,
    profile: profile as BankEmailUserProfile,
    accessToken
  };
}

export async function isHotelCreator(
  admin: SupabaseClient,
  hotelId: string,
  userId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from('hoteles')
    .select('creado_por')
    .eq('id', hotelId)
    .maybeSingle();
  if (error) {
    throw Object.assign(new Error('No se pudo validar al administrador del hotel.'), {
      code: 'hotel_creator_lookup_failed'
    });
  }
  return data?.creado_por === userId;
}

export async function isPilotAdministrator(
  admin: SupabaseClient,
  context: AuthenticatedRequestContext,
  pilotHotelId: string
): Promise<boolean> {
  if (context.profile.hotel_id !== pilotHotelId) return false;
  const role = String(context.profile.rol || '').trim().toLowerCase();
  if (role === 'admin' || role === 'superadmin' || role === 'administrador') return true;
  const { data: assignments, error: assignmentsError } = await admin
    .from('usuarios_roles')
    .select('roles(nombre)')
    .eq('usuario_id', context.user.id);
  if (assignmentsError) {
    throw Object.assign(new Error('No se pudieron validar los permisos administrativos.'), {
      code: 'administrator_role_lookup_failed'
    });
  }
  const assignedAdministrator = (assignments || []).some((assignment) => {
    const assignedRole = Array.isArray(assignment.roles) ? assignment.roles[0] : assignment.roles;
    return ['admin', 'administrador', 'superadmin'].includes(String(assignedRole?.nombre || '').trim().toLowerCase());
  });
  if (assignedAdministrator) return true;
  return await isHotelCreator(admin, pilotHotelId, context.user.id);
}

export async function isPilotOperationalUser(
  admin: SupabaseClient,
  context: AuthenticatedRequestContext,
  pilotHotelId: string
): Promise<boolean> {
  if (context.profile.hotel_id !== pilotHotelId) return false;
  const directRole = String(context.profile.rol || '').trim().toLowerCase();
  if (['admin', 'administrador', 'recepcionista'].includes(directRole)) return true;
  const { data, error } = await admin
    .from('usuarios_roles')
    .select('roles(nombre)')
    .eq('usuario_id', context.user.id);
  if (error) {
    throw Object.assign(new Error('No se pudieron validar los permisos operativos.'), {
      code: 'operational_role_lookup_failed'
    });
  }
  return (data || []).some((assignment) => {
    const role = Array.isArray(assignment.roles) ? assignment.roles[0] : assignment.roles;
    return ['admin', 'administrador', 'recepcionista'].includes(String(role?.nombre || '').trim().toLowerCase());
  });
}

export function assertSamePilotHotel(
  context: AuthenticatedRequestContext,
  pilotHotelId: string
): void {
  if (!context.profile.hotel_id || context.profile.hotel_id !== pilotHotelId) {
    throw new HttpError(403, 'pilot_hotel_only', 'Esta funcion no esta habilitada para este hotel.');
  }
}

export async function requirePilotAdministrator(
  admin: SupabaseClient,
  context: AuthenticatedRequestContext,
  pilotHotelId: string
): Promise<void> {
  assertSamePilotHotel(context, pilotHotelId);
  if (!(await isPilotAdministrator(admin, context, pilotHotelId))) {
    throw new HttpError(403, 'administrator_required', 'Esta accion requiere un administrador del hotel piloto.');
  }
}
