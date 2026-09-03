import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL') ?? '';
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const webhook = Deno.env.get('MAKE_CASH_CLOSE_WEBHOOK_URL') ?? '';
const cronSecret = Deno.env.get('CRON_SECRET') ?? '';

interface EnergyAlertClaim {
  id: string;
  hotel_id: string;
  room_id: string;
  created_at: string;
  due_at: string;
  source_user_id: string | null;
  room_name: string | null;
  hotel_name: string | null;
  hotel_email: string | null;
  source_user_name: string | null;
  energy_email_notifications_enabled: boolean;
  energy_alert_emails: string | null;
  report_email: string | null;
  attempt: number;
}

function constantTimeEqual(left: string, right: string): boolean {
  const maxLength = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maxLength; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function cronAuthorized(request: Request): boolean {
  if (cronSecret.length < 24) return false;
  const explicit = request.headers.get('x-cron-secret') || '';
  const bearer = /^Bearer\s+([^\s]+)$/iu.exec(request.headers.get('authorization') || '')?.[1] || '';
  return constantTimeEqual(explicit || bearer, cronSecret);
}

function emails(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, all) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item) && all.indexOf(item) === index);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatHotelDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    timeZone,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(value));
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }
  if (!cronAuthorized(request)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!url || !key) {
    return Response.json({ error: 'server_configuration_missing' }, { status: 500 });
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc('energy_claim_overdue_alerts', { p_limit: 50 });
  if (error) {
    console.error('[process-energy-alerts] claim_failed', { code: error.code });
    return Response.json({ error: 'claim_failed' }, { status: 500 });
  }

  const claims = (data || []) as EnergyAlertClaim[];
  const timeZoneByHotel = new Map<string, string>();
  let notifications = 0;
  let emailsSent = 0;
  let retryableFailures = 0;
  let permanentFailures = 0;

  const resolveHotelTimeZone = async (hotelId: string): Promise<string> => {
    const cached = timeZoneByHotel.get(hotelId);
    if (cached) return cached;
    const { data: timeZone, error: timeZoneError } = await admin.rpc('hotel_time_zone', { p_hotel_id: hotelId });
    if (timeZoneError || !timeZone) {
      console.error('[process-energy-alerts] timezone_lookup_failed', { code: timeZoneError?.code });
      throw new Error('hotel_timezone_unavailable');
    }
    const resolved = String(timeZone);
    timeZoneByHotel.set(hotelId, resolved);
    return resolved;
  };

  const finish = async (
    claim: EnergyAlertClaim,
    status: string,
    completed: boolean
  ) => {
    const payload: Record<string, unknown> = {
      admin_alert_status: status,
      admin_alert_claimed_at: null
    };
    if (completed) payload.admin_alert_sent_at = new Date().toISOString();
    const { error: finishError } = await admin
      .from('room_energy_checks')
      .update(payload)
      .eq('id', claim.id)
      .eq('admin_alert_status', 'processing');
    if (finishError) console.error('[process-energy-alerts] finish_failed', { id: claim.id, code: finishError.code });
  };

  for (const claim of claims) {
    const minutes = Math.max(1, Math.floor((Date.now() - new Date(claim.created_at).getTime()) / 60000));
    const message = `Habitación ${claim.room_name || ''} tiene pendiente el Control de Energía desde hace ${minutes} minutos.`;

    const { data: inserted, error: notificationError } = await admin.rpc('energy_notify_recipients', {
      p_check_id: claim.id,
      p_audience: 'admin',
      p_type: 'sistema_alerta',
      p_message: message
    });

    if (notificationError) {
      const permanent = Number(claim.attempt || 0) >= 5;
      if (permanent) permanentFailures += 1;
      else retryableFailures += 1;
      await finish(claim, permanent ? 'failed_permanent' : 'failed', permanent);
      continue;
    }
    notifications += Number(inserted || 0);

    if (!claim.energy_email_notifications_enabled) {
      await finish(claim, 'email_disabled', true);
      continue;
    }

    const recipients = emails([
      claim.energy_alert_emails,
      claim.report_email,
      claim.hotel_email
    ].filter(Boolean).join(','));

    if (!recipients.length) {
      await finish(claim, 'no_recipients', true);
      continue;
    }

    if (!webhook) {
      const permanent = Number(claim.attempt || 0) >= 5;
      if (permanent) permanentFailures += 1;
      else retryableFailures += 1;
      await finish(claim, permanent ? 'failed_permanent' : 'webhook_missing', permanent);
      continue;
    }

    let hotelTimeZone: string;
    try {
      hotelTimeZone = await resolveHotelTimeZone(claim.hotel_id);
    } catch {
      const permanent = Number(claim.attempt || 0) >= 5;
      if (permanent) permanentFailures += 1;
      else retryableFailures += 1;
      await finish(claim, permanent ? 'failed_permanent' : 'timezone_failed', permanent);
      continue;
    }

    try {
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients.join(','),
          from: 'no-reply@gestiondehotel.com',
          subject: `⚡ Control de energía pendiente — Habitación ${claim.room_name || ''}`,
          html: `<h2>Control de energía pendiente</h2><p><b>Hotel:</b> ${escapeHtml(claim.hotel_name)}</p><p><b>Habitación:</b> ${escapeHtml(claim.room_name)}</p><p><b>Enviada a limpieza:</b> ${escapeHtml(formatHotelDate(claim.created_at, hotelTimeZone))}</p><p><b>Tiempo transcurrido:</b> ${minutes} minutos</p><p><b>Movimiento realizado por:</b> ${escapeHtml(claim.source_user_name || 'Sin identificar')}</p><p><b>Estado actual:</b> Sin revisión de energía</p>`
        })
      });

      if (response.ok) {
        emailsSent += 1;
        await finish(claim, 'sent', true);
      } else {
        const permanent = Number(claim.attempt || 0) >= 5;
        if (permanent) permanentFailures += 1;
        else retryableFailures += 1;
        await finish(claim, permanent ? 'failed_permanent' : 'failed', permanent);
      }
    } catch {
      const permanent = Number(claim.attempt || 0) >= 5;
      if (permanent) permanentFailures += 1;
      else retryableFailures += 1;
      await finish(claim, permanent ? 'failed_permanent' : 'failed', permanent);
    }
  }

  return Response.json({
    processed: claims.length,
    notifications,
    emailsSent,
    retryableFailures,
    permanentFailures
  });
});
