import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const webhook = Deno.env.get('MAKE_CASH_CLOSE_WEBHOOK_URL') ?? '';
const cronSecret = Deno.env.get('ENERGY_ALERT_CRON_SECRET') ?? '';

function emails(value: unknown) {
  return String(value || '').split(',').map((item) => item.trim().toLowerCase())
    .filter((item, index, all) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item) && all.indexOf(item) === index);
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) return new Response('Unauthorized', { status: 401 });
  if (!url || !key) return new Response('Server configuration missing', { status: 500 });
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const now = new Date().toISOString();
  const { data: checks, error } = await admin.from('room_energy_checks')
    .select('id,hotel_id,room_id,created_at,due_at,source_user_id,habitaciones(nombre),hoteles(nombre,correo),usuarios!room_energy_checks_source_user_id_fkey(nombre)')
    .in('status', ['pending','overdue']).lt('due_at', now).is('admin_alert_sent_at', null)
    ;
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const check of checks || []) {
    const { data: cfg } = await admin.from('configuracion_hotel')
      .select('energy_control_enabled,energy_email_notifications_enabled,energy_alert_emails,correo_reportes')
      .eq('hotel_id', check.hotel_id).maybeSingle();
    if (!cfg?.energy_control_enabled) continue;
    const room = Array.isArray(check.habitaciones) ? check.habitaciones[0] : check.habitaciones;
    const hotel = Array.isArray(check.hoteles) ? check.hoteles[0] : check.hoteles;
    const source = Array.isArray(check.usuarios) ? check.usuarios[0] : check.usuarios;
    const minutes = Math.max(1, Math.floor((Date.now() - new Date(check.created_at).getTime()) / 60000));
    await admin.from('room_energy_checks').update({ status: 'overdue', overdue_at: now }).eq('id', check.id).in('status', ['pending','overdue']);
    await admin.from('notificaciones').insert({ hotel_id: check.hotel_id, rol_destino: 'admin', tipo: 'sistema_alerta', entidad_tipo: 'energy_check', entidad_id: check.id, mensaje: `Habitación ${room?.nombre || ''} tiene pendiente el Control de Energía desde hace ${minutes} minutos.` });
    const recipients = emails([cfg?.energy_alert_emails, cfg?.correo_reportes, hotel?.correo].filter(Boolean).join(','));
    let alertStatus = 'email_disabled';
    if (cfg?.energy_email_notifications_enabled && recipients.length && webhook) {
      const response = await fetch(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        to: recipients.join(','), from: 'no-reply@gestiondehotel.com', subject: `⚡ Control de energía pendiente — Habitación ${room?.nombre || ''}`,
        html: `<h2>Control de energía pendiente</h2><p><b>Hotel:</b> ${hotel?.nombre || ''}</p><p><b>Habitación:</b> ${room?.nombre || ''}</p><p><b>Enviada a limpieza:</b> ${new Date(check.created_at).toLocaleString('es-CO')}</p><p><b>Tiempo transcurrido:</b> ${minutes} minutos</p><p><b>Movimiento realizado por:</b> ${source?.nombre || 'Sin identificar'}</p><p><b>Estado actual:</b> Sin revisión de energía</p>`
      }) });
      alertStatus = response.ok ? 'sent' : 'failed'; if (response.ok) sent += 1;
    }
    await admin.from('room_energy_checks').update({ admin_alert_sent_at: now, admin_alert_status: alertStatus }).eq('id', check.id).is('admin_alert_sent_at', null);
  }
  return Response.json({ processed: checks?.length || 0, sent });
});
