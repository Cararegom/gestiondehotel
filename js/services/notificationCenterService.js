import { getUserSession } from '../authService.js';

function normalizeRole(user) {
  return (
    user?.app_metadata?.rol ||
    user?.user_metadata?.rol ||
    'recepcionista'
  );
}

export async function resolveNotificationContext(supabase, currentUser = null, providedHotelId = null) {
  const sessionPayload = currentUser ? { user: currentUser } : await getUserSession();
  const user = sessionPayload?.user;

  if (!user) {
    return null;
  }

  let hotelId = providedHotelId || user.user_metadata?.hotel_id || user.app_metadata?.hotel_id || null;
  if (!hotelId) {
    const { data: perfil } = await supabase
      .from('usuarios')
      .select('hotel_id')
      .eq('id', user.id)
      .maybeSingle();
    hotelId = perfil?.hotel_id || null;
  }

  return {
    user,
    userId: user.id,
    role: normalizeRole(user),
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
  return `usuario_id.eq.${context.userId},rol_destino.eq.${context.role}`;
}

export async function fetchNotificationFeed(supabase, context, limit = 7) {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('id, mensaje, tipo, leida, creado_en, entidad_tipo, entidad_id')
    .eq('hotel_id', context.hotelId)
    .or(buildNotificationMatchFilter(context))
    .order('creado_en', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data || [];
}

export async function fetchNotificationHistory(supabase, context, limit = 100) {
  const { data, error } = await supabase
    .from('notificaciones')
    .select('id, mensaje, tipo, leida, creado_en, entidad_tipo, entidad_id')
    .eq('hotel_id', context.hotelId)
    .or(buildNotificationMatchFilter(context))
    .order('creado_en', { ascending: false })
    .limit(limit);

  if (error) {
    throw error;
  }

  return data || [];
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

export async function markAllNotificationsAsRead(supabase) {
  const { error } = await supabase.rpc('marcar_todas_mis_notificaciones_leidas');
  if (error) {
    throw error;
  }
}

export function subscribeToNotificationFeed(supabase, context, onChange) {
  const channelName = `notifications-h-${context.hotelId}-u-${context.userId}`;
  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notificaciones' },
      () => {
        onChange?.();
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
