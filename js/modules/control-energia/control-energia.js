import { escapeHtml } from '../../security.js';

let scanner = null;
let activeToken = null;
let root = null;
let db = null;
let hotelId = null;
let actor = null;

const roleKey = (value) => String(value || '').trim().toLowerCase();
const isAdmin = () => ['admin', 'administrador'].includes(roleKey(actor?.role));
const friendlyError = (error) => {
  const value = String(error?.message || error || '');
  if (value.includes('QR_INVALIDO')) return 'El QR es inválido, antiguo o pertenece a otro hotel.';
  if (value.includes('SIN_CONTROL_PENDIENTE')) return 'Esta habitación no tiene un control de energía pendiente.';
  if (value.includes('NO_AUTORIZADO')) return 'Tu usuario no tiene permiso para realizar esta acción.';
  return 'No fue posible completar la operación. Revisa tu conexión e inténtalo de nuevo.';
};
const formatDate = (value) => value ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src; script.async = true; script.onload = resolve; script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function readConfig() {
  const { data, error } = await db.from('configuracion_hotel')
    .select('energy_control_enabled,energy_check_timeout_minutes,energy_email_notifications_enabled,energy_alert_emails')
    .eq('hotel_id', hotelId).single();
  if (error) throw error;
  return data;
}

function renderShell(config) {
  root.innerHTML = `
    <section class="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
      <header class="rounded-3xl bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white shadow-lg">
        <p class="text-sm font-semibold uppercase tracking-widest">Operación hotelera</p>
        <h1 class="mt-1 text-3xl font-black">⚡ Control de Energía</h1>
        <p class="mt-2 text-amber-50">Escanea el código ubicado dentro de la habitación y confirma la revisión.</p>
      </header>
      <div id="energy-feedback" class="hidden rounded-xl p-4" role="status"></div>
      <nav class="flex flex-wrap gap-2">
        <button data-tab="scan" class="energy-tab rounded-xl bg-orange-600 px-5 py-3 font-bold text-white">📷 Escanear</button>
        ${isAdmin() ? '<button data-tab="history" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">Historial</button><button data-tab="settings" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">Configuración y QR</button>' : ''}
      </nav>
      <div id="energy-view"></div>
    </section>`;
  root.querySelectorAll('.energy-tab').forEach((button) => button.addEventListener('click', () => openTab(button.dataset.tab, config)));
  openTab('scan', config);
}

function feedback(message, tone = 'error') {
  const el = root.querySelector('#energy-feedback');
  el.className = `rounded-xl p-4 ${tone === 'success' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'}`;
  el.textContent = message;
}

async function openTab(tab, config) {
  if (scanner) { try { await scanner.stop(); } catch {} scanner.clear(); scanner = null; }
  activeToken = null;
  root.querySelectorAll('.energy-tab').forEach((b) => b.classList.toggle('bg-orange-600', b.dataset.tab === tab));
  if (tab === 'scan') renderScanner();
  if (tab === 'history') await renderHistory();
  if (tab === 'settings') await renderSettings(config);
}

function tokenFromDecoded(value) {
  try { return new URL(value, location.origin).searchParams.get('token') || ''; } catch { return ''; }
}

async function renderScanner() {
  const view = root.querySelector('#energy-view');
  view.innerHTML = `<div class="rounded-2xl bg-white p-5 shadow"><div id="energy-reader" class="mx-auto max-w-lg"></div><p class="mt-4 text-center text-sm text-slate-600">Permite el acceso a la cámara y apunta al QR de la habitación.</p></div>`;
  try {
    await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js', 'Html5Qrcode');
    scanner = new window.Html5Qrcode('energy-reader');
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, async (decoded) => {
      const token = tokenFromDecoded(decoded);
      if (!token || activeToken) return;
      activeToken = token;
      await scanner.stop();
      const { data, error } = await db.rpc('energy_scan', { p_token: token });
      if (error) { feedback(friendlyError(error)); activeToken = null; return; }
      view.innerHTML = `<div class="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 class="text-3xl font-black text-slate-900">Habitación ${escapeHtml(data.room_name)}</h2>
        <p class="mt-5 font-semibold">Antes de confirmar, verifica:</p>
        <ul class="my-4 space-y-3 text-lg"><li>✓ Aire acondicionado apagado</li><li>✓ Televisor apagado</li><li>✓ Luces apagadas</li></ul>
        <button id="energy-confirm" class="w-full rounded-2xl bg-emerald-600 px-5 py-4 text-lg font-black text-white">✅ Confirmar Control de Energía</button></div>`;
      view.querySelector('#energy-confirm').addEventListener('click', async (event) => {
        event.currentTarget.disabled = true;
        const result = await db.rpc('energy_confirm', { p_token: activeToken });
        if (result.error) { feedback(friendlyError(result.error)); event.currentTarget.disabled = false; return; }
        feedback(`Control completado para la habitación ${result.data.room_name}.`, 'success');
        view.innerHTML = '<div class="rounded-2xl bg-emerald-50 p-8 text-center text-xl font-bold text-emerald-800">✅ Energía revisada y registrada.</div>';
      });
    });
  } catch (error) {
    feedback('No fue posible abrir la cámara. Verifica el permiso, usa HTTPS y confirma que haya una cámara disponible.');
  }
}

async function renderHistory() {
  const view = root.querySelector('#energy-view');
  const { data, error } = await db.from('room_energy_checks').select('id,room_id,status,created_at,due_at,completed_at,completed_by_role,cancellation_reason,habitaciones(nombre),usuarios!room_energy_checks_completed_by_user_id_fkey(nombre)').eq('hotel_id', hotelId).order('created_at', { ascending: false }).limit(250);
  if (error) { feedback(friendlyError(error)); return; }
  view.innerHTML = `<div class="overflow-x-auto rounded-2xl bg-white shadow"><table class="min-w-full text-sm"><thead class="bg-slate-100"><tr><th class="p-3 text-left">Habitación</th><th class="p-3">Generado</th><th class="p-3">Revisado</th><th class="p-3">Tiempo</th><th class="p-3">Usuario / rol</th><th class="p-3">Estado</th><th class="p-3">Acción</th></tr></thead><tbody>${(data || []).map((row) => {
    const end = row.completed_at ? new Date(row.completed_at) : new Date();
    const minutes = Math.max(0, Math.round((end - new Date(row.created_at)) / 60000));
    return `<tr class="border-t"><td class="p-3 font-bold">${escapeHtml(row.habitaciones?.nombre || '—')}</td><td class="p-3">${formatDate(row.created_at)}</td><td class="p-3">${formatDate(row.completed_at)}</td><td class="p-3">${minutes} min</td><td class="p-3">${escapeHtml(row.usuarios?.nombre || '—')} / ${escapeHtml(row.completed_by_role || '—')}</td><td class="p-3 font-bold">${escapeHtml(row.status)}</td><td class="p-3">${['pending','overdue'].includes(row.status) ? `<button data-cancel="${row.id}" class="text-red-700 underline">Cancelar</button>` : '—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
  view.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = window.prompt('Motivo obligatorio de cancelación:');
    if (!reason) return;
    const { error: cancelError } = await db.rpc('energy_cancel', { p_check_id: button.dataset.cancel, p_reason: reason });
    if (cancelError) feedback(friendlyError(cancelError)); else await renderHistory();
  }));
}

async function renderSettings(config) {
  const view = root.querySelector('#energy-view');
  const { data: rooms, error } = await db.from('habitaciones').select('id,nombre,energy_qr_token,energy_qr_created_at').eq('hotel_id', hotelId).eq('activo', true).order('nombre');
  if (error) { feedback(friendlyError(error)); return; }
  view.innerHTML = `<form id="energy-settings" class="mb-5 grid gap-4 rounded-2xl bg-white p-5 shadow md:grid-cols-3">
    <label class="font-semibold">Tiempo máximo (min)<input name="timeout" type="number" min="1" max="1440" value="${config.energy_check_timeout_minutes}" class="mt-1 w-full rounded border p-2"></label>
    <label class="font-semibold">Alertas por correo<select name="emails_on" class="mt-1 w-full rounded border p-2"><option value="true" ${config.energy_email_notifications_enabled ? 'selected':''}>Activadas</option><option value="false" ${!config.energy_email_notifications_enabled ? 'selected':''}>Desactivadas</option></select></label>
    <label class="font-semibold">Correos adicionales<input name="emails" value="${escapeHtml(config.energy_alert_emails || '')}" class="mt-1 w-full rounded border p-2" placeholder="admin@hotel.com"></label>
    <button class="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white md:col-span-3">Guardar configuración</button></form>
    <div class="mb-5 flex flex-wrap gap-2"><button id="energy-generate-all" class="rounded-xl bg-orange-600 px-4 py-3 font-bold text-white">Generar QR faltantes</button><button id="energy-print-all" class="rounded-xl bg-slate-700 px-4 py-3 font-bold text-white">Imprimir todos los QR</button></div>
    <div class="grid gap-4 md:grid-cols-2">${rooms.map((room) => `<article class="rounded-2xl bg-white p-5 shadow"><h3 class="text-xl font-black">Habitación ${escapeHtml(room.nombre)}</h3><p class="my-2 text-sm">${room.energy_qr_token ? 'QR generado' : 'Sin QR'}</p><div id="qr-${room.id}" class="my-3"></div><button data-generate="${room.id}" class="rounded-lg bg-orange-600 px-4 py-2 font-bold text-white">${room.energy_qr_token ? 'Regenerar QR' : 'Generar QR'}</button> ${room.energy_qr_token ? `<button data-print="${room.id}" data-name="${escapeHtml(room.nombre)}" class="rounded-lg bg-slate-700 px-4 py-2 font-bold text-white">Imprimir</button>` : ''}</article>`).join('')}</div>`;
  const renderQr = async (room, token = room.energy_qr_token) => {
    if (!token) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
    const holder = view.querySelector(`#qr-${room.id}`); holder.innerHTML = '';
    new window.QRCode(holder, { text: `${location.origin}${location.pathname}#/control-energia?token=${token}`, width: 180, height: 180 });
  };
  for (const room of rooms) await renderQr(room);
  view.querySelector('#energy-settings').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const { error: updateError } = await db.from('configuracion_hotel').update({ energy_check_timeout_minutes: Number(form.get('timeout')), energy_email_notifications_enabled: form.get('emails_on') === 'true', energy_alert_emails: String(form.get('emails') || '').trim() || null }).eq('hotel_id', hotelId);
    feedback(updateError ? friendlyError(updateError) : 'Configuración guardada.', updateError ? 'error' : 'success');
  });
  view.querySelectorAll('[data-generate]').forEach((button) => button.addEventListener('click', async () => {
    if (!confirm('El QR anterior dejará de funcionar. ¿Continuar?')) return;
    const { data: token, error: qrError } = await db.rpc('energy_regenerate_qr', { p_room_id: button.dataset.generate });
    if (qrError) feedback(friendlyError(qrError)); else await renderSettings(config);
  }));
  view.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => {
    const card = button.closest('article').cloneNode(true); card.querySelectorAll('button').forEach((b) => b.remove());
    const win = window.open('', '_blank'); win.document.write(`<title>Control de Energía</title><style>body{font-family:Arial;text-align:center;padding:40px}img{margin:auto}h1{font-size:24px}li{text-align:left;max-width:360px;margin:12px auto}</style><h1>CONTROL DE ENERGÍA</h1>${card.innerHTML}<ul><li>Aire acondicionado apagado</li><li>Televisor apagado</li><li>Luces apagadas</li></ul><b>Escanea este código para registrar la revisión.</b>`); win.document.close(); win.print();
  }));
  view.querySelector('#energy-generate-all').addEventListener('click', async () => {
    const missing = rooms.filter((room) => !room.energy_qr_token);
    for (const room of missing) {
      const result = await db.rpc('energy_regenerate_qr', { p_room_id: room.id });
      if (result.error) { feedback(friendlyError(result.error)); return; }
    }
    feedback(`${missing.length} QR generados.`, 'success'); await renderSettings(config);
  });
  view.querySelector('#energy-print-all').addEventListener('click', () => {
    const cards = [...view.querySelectorAll('article')].filter((card) => card.querySelector('img')).map((card) => {
      const copy = card.cloneNode(true); copy.querySelectorAll('button').forEach((button) => button.remove()); return `<section>${copy.innerHTML}<ul><li>Aire acondicionado apagado</li><li>Televisor apagado</li><li>Luces apagadas</li></ul><b>Escanea este código para registrar la revisión.</b></section>`;
    }).join('');
    const win = window.open('', '_blank'); win.document.write(`<title>QR Control de Energía</title><style>body{font-family:Arial;text-align:center}section{page-break-after:always;padding:35px}img{margin:auto}li{text-align:left;max-width:360px;margin:10px auto}</style><h1>CONTROL DE ENERGÍA</h1>${cards}`); win.document.close(); win.print();
  });
}

export async function mount(container, supabase, user, currentHotelId) {
  root = container; db = supabase; actor = user; hotelId = currentHotelId;
  if (!['admin','administrador','recepcionista','camarera','mantenimiento'].includes(roleKey(user?.role))) {
    root.innerHTML = '<p class="m-6 rounded bg-red-100 p-4 text-red-800">No tienes permiso para usar Control de Energía.</p>'; return;
  }
  try { const config = await readConfig(); if (!config.energy_control_enabled) throw new Error('DISABLED'); renderShell(config); }
  catch { root.innerHTML = '<p class="m-6 rounded bg-amber-100 p-4 text-amber-900">Control de Energía no está habilitado para este hotel.</p>'; }
}

export async function unmount() {
  if (scanner) { try { await scanner.stop(); } catch {} try { scanner.clear(); } catch {} }
  scanner = null; activeToken = null; root = null;
}
