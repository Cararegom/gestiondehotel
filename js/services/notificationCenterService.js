import { getUserSession } from '../authService.js';

const NOTIFICATION_SELECT_COLUMNS = 'id, mensaje, tipo, leida, creado_en, entidad_tipo, entidad_id';
const NOTIFICATION_SELECT_COLUMNS_LEGACY = 'id, mensaje, tipo, leida, creado_en';

function normalizeRoleValue(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'administrador') return 'admin';
  if (['limpieza', 'camarero', 'camarera'].includes(role)) return 'camarera';
  if (role === 'recepcion') return 'recepcionista';
  return role || 'recepcionista';
}

function isAdministrativeRole(role) {
  return ['admin', 'superadmin'].includes(normalizeRoleValue(role));
}

export async function resolveNotificationContext(supabase, currentUser = null, providedHotelId = null) {
  const sessionPayload = currentUser ? { user: currentUser } : await getUserSession();
  const user = sessionPayload?.user;

  if (!user) {
    return null;
  }

  // El perfil de public.usuarios y sus roles asignados son la fuente autoritativa.
  // user_metadata puede ser modificado por el propio usuario y no debe decidir permisos.
  const { data: perfil, error: perfilError } = await supabase
    .from('usuarios')
    .select('hotel_id, rol, usuarios_roles(roles(nombre))')
    .eq('id', user.id)
    .maybeSingle();

  if (perfilError || !perfil) {
    if (perfilError) console.error('No se pudo resolver el perfil para notificaciones:', perfilError);
    return null;
  }

  const assignedRoles = (perfil.usuarios_roles || [])
    .map((item) => normalizeRoleValue(item?.roles?.nombre))
    .filter(Boolean);
  const role = assignedRoles.find((item) => ['superadmin', 'admin', 'recepcionista'].includes(item))
    || normalizeRoleValue(perfil.rol);
  const hotelId = providedHotelId || perfil.hotel_id || null;

  return {
    user,
    userId: user.id,
    role: normalizeRoleValue(role),
    hotelId
  };
}

export async function canUseNotificationCenter(supabase, hotelId) {
  if (!hotelId) return false;

  const { data, error } = await supabase
    .from('hoteles')
    .select('plan')
    .eq('id', hotelId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return String(data?.plan || '').toLowerCase() === 'max';
}

function buildNotificationMatchFilter(context) {
  if (isAdministrativeRole(context.role)) {
    // Los administradores conservan la vista de alertas globales por rol,
    // pero no deben recibir las copias personales creadas para otros usuarios.
    return `usuario_id.eq.${context.userId},usuario_id.is.null`;
  }

  return `usuario_id.eq.${context.userId},rol_destino.eq.${context.role}`;
}

function shouldRetryNotificationSelectCompatibility(error) {
  const details = [error?.message, error?.details, error?.hint, error?.code]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return /\bentidad_tipo\b|\bentidad_id\b|column|schema|pgrst/.test(details);
}

async function fetchNotificationsWithCompatibility(supabase, context, limit) {
  const buildQuery = (selectColumns) => {
    const query = supabase
      .from('notificaciones')
      .select(selectColumns)
      .eq('hotel_id', context.hotelId)
      .or(buildNotificationMatchFilter(context));

    return query
      .order('creado_en', { ascending: false })
      .limit(limit);
  };

  let { data, error } = await buildQuery(NOTIFICATION_SELECT_COLUMNS);

  if (error && shouldRetryNotificationSelectCompatibility(error)) {
    ({ data, error } = await buildQuery(NOTIFICATION_SELECT_COLUMNS_LEGACY));
  }

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchNotificationFeed(supabase, context, limit = 7) {
  return fetchNotificationsWithCompatibility(supabase, context, limit);
}

export async function fetchNotificationHistory(supabase, context, limit = 100) {
  return fetchNotificationsWithCompatibility(supabase, context, limit);
}

export async function markNotificationAsRead(supabase, notificationId, hotelId) {
  const { error } = await supabase
    .from('notificaciones')
    .update({ leida: true, actualizado_en: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('hotel_id', hotelId);

  if (error) {
    throw error;
  }
}

export async function markAllNotificationsAsRead(supabase, context) {
  const { error: rpcError } = await supabase.rpc('marcar_todas_mis_notificaciones_leidas');
  if (!rpcError) return;

  if (!context?.hotelId || !context?.userId || !context?.role) {
    throw rpcError;
  }

  console.warn('La RPC para marcar notificaciones falló; usando actualización compatible.', rpcError);
  const fallbackQuery = supabase
    .from('notificaciones')
    .update({ leida: true, actualizado_en: new Date().toISOString() })
    .eq('hotel_id', context.hotelId)
    .eq('leida', false)
    .or(buildNotificationMatchFilter(context));

  const { error: fallbackError } = await fallbackQuery;

  if (fallbackError) {
    throw fallbackError;
  }
}

export function subscribeToNotificationFeed(supabase, context, onChange) {
  const channelName = `notifications-h-${context.hotelId}-u-${context.userId}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `hotel_id=eq.${context.hotelId}`
      },
      (payload) => {
        const notification = payload?.new || null;
        if (notification?.usuario_id && notification.usuario_id !== context.userId) return;
        onChange?.(notification);
      }
    )
    .subscribe();

  return {
    channel,
    async unsubscribe() {
      if (channel) {
        await supabase.removeChannel(channel);
      }
    }
  };
}
