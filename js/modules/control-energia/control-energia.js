import { escapeHtml } from '../../security.js';

let scanner = null;
let activeToken = null;
let root = null;
let db = null;
let hotelId = null;
let capabilities = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const friendlyError = (error) => {
  const value = String(error?.message || error || '');
  if (value.includes('QR_INVALIDO')) return 'El QR es inválido, antiguo o pertenece a otro hotel.';
  if (value.includes('SIN_CONTROL_PENDIENTE')) return 'Esta habitación no tiene un control de energía pendiente.';
  if (value.includes('NO_AUTORIZADO')) return 'Tu usuario no tiene permiso para realizar esta acción.';
  if (value.includes('MOTIVO_REQUERIDO')) return 'Debes escribir un motivo de cancelación de al menos 3 caracteres.';
  return 'No fue posible completar la operación. Revisa tu conexión e inténtalo de nuevo.';
};
const formatDate = (value) => value
  ? new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })
  : '—';

function loadScript(src, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function stopScanner() {
  if (!scanner) return;
  try { await scanner.stop(); } catch {}
  try { scanner.clear(); } catch {}
  scanner = null;
}

async function readCapabilities() {
  const { data, error } = await db.rpc('energy_capabilities');
  if (error) throw error;
  return data || { can_control: false, can_admin: false, enabled: false };
}

async function readConfig() {
  const { data, error } = await db.from('configuracion_hotel')
    .select('energy_control_enabled,energy_check_timeout_minutes,energy_email_notifications_enabled,energy_alert_emails')
    .eq('hotel_id', hotelId)
    .single();
  if (error) throw error;
  return data;
}

function feedback(message, tone = 'error') {
  const el = root?.querySelector('#energy-feedback');
  if (!el) return;
  const toneClass = tone === 'success'
    ? 'bg-emerald-100 text-emerald-900'
    : tone === 'info'
      ? 'bg-blue-100 text-blue-900'
      : 'bg-red-100 text-red-900';
  el.className = `rounded-xl p-4 ${toneClass}`;
  el.textContent = message;
}

function tokenFromValue(value) {
  const raw = String(value || '').trim();
  if (UUID_RE.test(raw)) return raw;
  try {
    const url = new URL(raw, location.origin);
    const direct = url.searchParams.get('token');
    if (direct && UUID_RE.test(direct)) return direct;
    const hash = String(url.hash || '');
    const queryIndex = hash.indexOf('?');
    if (queryIndex >= 0) {
      const fromHash = new URLSearchParams(hash.slice(queryIndex + 1)).get('token');
      if (fromHash && UUID_RE.test(fromHash)) return fromHash;
    }
  } catch {}
  return '';
}

function tokenFromCurrentHash() {
  const hash = String(location.hash || '');
  const queryIndex = hash.indexOf('?');
  if (queryIndex < 0) return '';
  const token = new URLSearchParams(hash.slice(queryIndex + 1)).get('token') || '';
  return UUID_RE.test(token) ? token : '';
}

function clearTokenFromAddressBar() {
  const cleanHash = String(location.hash || '#/control-energia').split('?')[0] || '#/control-energia';
  try {
    history.replaceState(history.state, '', `${location.pathname}${location.search}${cleanHash}`);
  } catch {}
}

function renderShell(config) {
  const disabledNotice = !config.energy_control_enabled && capabilities?.can_admin
    ? `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <b>Modo preparación.</b> El Control de Energía está apagado. Puedes generar e imprimir los QR sin bloquear habitaciones. Cuando estén instalados, actívalo desde <a class="font-bold underline" href="#/configuracion">Configuración</a>.
      </div>`
    : '';

  root.innerHTML = `
    <section class="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
      <header class="rounded-3xl bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white shadow-lg">
        <p class="text-sm font-semibold uppercase tracking-widest">Operación hotelera</p>
        <h1 class="mt-1 text-3xl font-black">⚡ Control de Energía</h1>
        <p class="mt-2 text-amber-50">Verifica físicamente la habitación antes de dejarla disponible.</p>
      </header>
      ${disabledNotice}
      <div id="energy-feedback" class="hidden rounded-xl p-4" role="status" aria-live="polite"></div>
      <nav class="flex flex-wrap gap-2">
        ${config.energy_control_enabled && capabilities?.can_control ? '<button data-tab="scan" class="energy-tab rounded-xl bg-orange-600 px-5 py-3 font-bold text-white">📷 Escanear</button>' : ''}
        ${capabilities?.can_admin ? '<button data-tab="history" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">Historial</button><button data-tab="settings" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">Configuración y QR</button>' : ''}
      </nav>
      <div id="energy-view"></div>
    </section>`;

  root.querySelectorAll('.energy-tab').forEach((button) => {
    button.addEventListener('click', () => openTab(button.dataset.tab, config));
  });
}

async function openTab(tab, config) {
  await stopScanner();
  activeToken = null;
  root.querySelectorAll('.energy-tab').forEach((button) => {
    const selected = button.dataset.tab === tab;
    button.classList.toggle('bg-orange-600', selected);
    button.classList.toggle('text-white', selected);
    button.classList.toggle('bg-slate-200', !selected);
  });
  if (tab === 'scan') await renderScanner();
  if (tab === 'history') await renderHistory();
  if (tab === 'settings') await renderSettings(config);
}

async function processToken(token) {
  const view = root.querySelector('#energy-view');
  if (!token || activeToken) return;
  activeToken = token;
  await stopScanner();

  const { data, error } = await db.rpc('energy_scan', { p_token: token });
  if (error) {
    feedback(friendlyError(error));
    activeToken = null;
    view.innerHTML = '<div class="rounded-2xl bg-white p-6 text-center shadow"><button id="energy-retry" class="rounded-xl bg-orange-600 px-5 py-3 font-bold text-white">Volver a escanear</button></div>';
    view.querySelector('#energy-retry')?.addEventListener('click', () => renderScanner());
    return;
  }

  clearTokenFromAddressBar();
  view.innerHTML = `<div class="mx-auto max-w-lg rounded-2xl bg-white p-6 shadow-xl">
    <h2 class="text-3xl font-black text-slate-900">Habitación ${escapeHtml(data.room_name)}</h2>
    <p class="mt-2 text-sm text-slate-500">Control generado: ${formatDate(data.created_at)}</p>
    <p class="mt-5 font-semibold">Antes de confirmar, verifica físicamente:</p>
    <ul class="my-4 space-y-3 text-lg">
      <li>✓ Aire acondicionado apagado</li>
      <li>✓ Televisor apagado</li>
      <li>✓ Luces apagadas</li>
    </ul>
    <button id="energy-confirm" class="w-full rounded-2xl bg-emerald-600 px-5 py-4 text-lg font-black text-white">✅ Confirmar Control de Energía</button>
    <button id="energy-cancel-scan" class="mt-3 w-full rounded-2xl bg-slate-200 px-5 py-3 font-bold text-slate-800">Cancelar y volver</button>
  </div>`;

  view.querySelector('#energy-cancel-scan')?.addEventListener('click', () => {
    activeToken = null;
    renderScanner();
  });

  view.querySelector('#energy-confirm')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Confirmando…';
    const result = await db.rpc('energy_confirm', { p_token: activeToken });
    if (result.error) {
      feedback(friendlyError(result.error));
      button.disabled = false;
      button.textContent = '✅ Confirmar Control de Energía';
      return;
    }
    const roomName = result.data?.room_name || data.room_name;
    feedback(`Control completado para la habitación ${roomName}.`, 'success');
    activeToken = null;
    view.innerHTML = '<div class="rounded-2xl bg-emerald-50 p-8 text-center text-xl font-bold text-emerald-800">✅ Energía revisada y registrada. La habitación ya puede continuar su flujo operativo.</div>';
  });
}

async function renderScanner() {
  const view = root.querySelector('#energy-view');
  if (!capabilities?.enabled || !capabilities?.can_control) {
    view.innerHTML = '<div class="rounded-2xl bg-amber-50 p-6 text-amber-900">El escáner estará disponible cuando el Control de Energía esté activado para este hotel.</div>';
    return;
  }

  view.innerHTML = `<div class="rounded-2xl bg-white p-5 shadow">
    <div id="energy-reader" class="mx-auto max-w-lg"></div>
    <p class="mt-4 text-center text-sm text-slate-600">Permite el acceso a la cámara y apunta al QR instalado dentro de la habitación.</p>
  </div>`;

  try {
    await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js', 'Html5Qrcode');
    scanner = new window.Html5Qrcode('energy-reader');
    await scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (decoded) => {
        const token = tokenFromValue(decoded);
        if (!token) return;
        await processToken(token);
      }
    );
  } catch {
    feedback('No fue posible abrir la cámara. Verifica el permiso, usa HTTPS y confirma que haya una cámara disponible.');
  }
}

async function renderHistory() {
  const view = root.querySelector('#energy-view');
  if (!capabilities?.can_admin) return;
  const { data, error } = await db.from('room_energy_checks')
    .select('id,room_id,status,created_at,due_at,completed_at,completed_by_role,cancellation_reason,admin_alert_status,habitaciones(nombre),usuarios!room_energy_checks_completed_by_user_id_fkey(nombre)')
    .eq('hotel_id', hotelId)
    .order('created_at', { ascending: false })
    .limit(250);

  if (error) { feedback(friendlyError(error)); return; }
  view.innerHTML = `<div class="overflow-x-auto rounded-2xl bg-white shadow"><table class="min-w-full text-sm">
    <thead class="bg-slate-100"><tr><th class="p-3 text-left">Habitación</th><th class="p-3">Generado</th><th class="p-3">Revisado</th><th class="p-3">Tiempo</th><th class="p-3">Usuario / rol</th><th class="p-3">Estado</th><th class="p-3">Alerta</th><th class="p-3">Acción</th></tr></thead>
    <tbody>${(data || []).map((row) => {
      const end = row.completed_at ? new Date(row.completed_at) : new Date();
      const minutes = Math.max(0, Math.round((end - new Date(row.created_at)) / 60000));
      return `<tr class="border-t">
        <td class="p-3 font-bold">${escapeHtml(row.habitaciones?.nombre || '—')}</td>
        <td class="p-3">${formatDate(row.created_at)}</td>
        <td class="p-3">${formatDate(row.completed_at)}</td>
        <td class="p-3">${minutes} min</td>
        <td class="p-3">${escapeHtml(row.usuarios?.nombre || '—')} / ${escapeHtml(row.completed_by_role || '—')}</td>
        <td class="p-3 font-bold">${escapeHtml(row.status)}</td>
        <td class="p-3">${escapeHtml(row.admin_alert_status || '—')}</td>
        <td class="p-3">${['pending', 'overdue'].includes(row.status) ? `<button data-cancel="${row.id}" class="text-red-700 underline">Cancelar</button>` : '—'}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;

  view.querySelectorAll('[data-cancel]').forEach((button) => button.addEventListener('click', async () => {
    const reason = window.prompt('Motivo obligatorio de cancelación:');
    if (reason === null) return;
    const { error: cancelError } = await db.rpc('energy_cancel', {
      p_check_id: button.dataset.cancel,
      p_reason: String(reason || '').trim()
    });
    if (cancelError) feedback(friendlyError(cancelError));
    else {
      feedback('Control cancelado correctamente.', 'success');
      await renderHistory();
    }
  }));
}

function qrText(token) {
  return `${location.origin}${location.pathname}#/control-energia?token=${encodeURIComponent(token)}`;
}

async function renderSettings(config) {
  const view = root.querySelector('#energy-view');
  if (!capabilities?.can_admin) return;

  const { data: rooms, error } = await db.rpc('energy_list_qr_tokens');
  if (error) { feedback(friendlyError(error)); return; }

  const prepared = (rooms || []).filter((room) => room.token).length;
  view.innerHTML = `
    <div class="mb-5 rounded-2xl ${config.energy_control_enabled ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'} p-4">
      <b>${config.energy_control_enabled ? 'Control activado.' : 'Control desactivado / preparación.'}</b>
      ${prepared} de ${(rooms || []).length} habitaciones activas tienen QR preparado.
      ${config.energy_control_enabled ? 'Solo las habitaciones con QR preparado generan un control obligatorio al entrar a limpieza.' : 'Puedes preparar e imprimir todos los QR antes de activar el sistema.'}
    </div>
    <form id="energy-settings" class="mb-5 grid gap-4 rounded-2xl bg-white p-5 shadow md:grid-cols-3">
      <label class="font-semibold">Tiempo máximo (min)<input name="timeout" type="number" min="1" max="1440" value="${Number(config.energy_check_timeout_minutes || 10)}" class="mt-1 w-full rounded border p-2"></label>
      <label class="font-semibold">Alertas por correo<select name="emails_on" class="mt-1 w-full rounded border p-2"><option value="true" ${config.energy_email_notifications_enabled ? 'selected' : ''}>Activadas</option><option value="false" ${!config.energy_email_notifications_enabled ? 'selected' : ''}>Desactivadas</option></select></label>
      <label class="font-semibold">Correos adicionales<input name="emails" value="${escapeHtml(config.energy_alert_emails || '')}" class="mt-1 w-full rounded border p-2" placeholder="admin@hotel.com"></label>
      <button class="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white md:col-span-3">Guardar configuración</button>
    </form>
    <div class="mb-5 flex flex-wrap gap-2">
      <button id="energy-generate-all" class="rounded-xl bg-orange-600 px-4 py-3 font-bold text-white">Generar QR faltantes</button>
      <button id="energy-print-all" class="rounded-xl bg-slate-700 px-4 py-3 font-bold text-white">Imprimir todos los QR</button>
    </div>
    <div class="grid gap-4 md:grid-cols-2">${(rooms || []).map((room) => `<article class="rounded-2xl bg-white p-5 shadow" data-room-card="${room.room_id}">
      <h3 class="text-xl font-black">Habitación ${escapeHtml(room.room_name)}</h3>
      <p class="my-2 text-sm">${room.token ? `QR generado ${formatDate(room.generated_at)}` : 'Sin QR'}</p>
      <div id="qr-${room.room_id}" class="my-3"></div>
      <button data-generate="${room.room_id}" class="rounded-lg bg-orange-600 px-4 py-2 font-bold text-white">${room.token ? 'Regenerar QR' : 'Generar QR'}</button>
      ${room.token ? `<button data-print="${room.room_id}" class="rounded-lg bg-slate-700 px-4 py-2 font-bold text-white">Imprimir</button>` : ''}
    </article>`).join('')}</div>`;

  const renderQr = async (room) => {
    if (!room.token) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
    const holder = view.querySelector(`#qr-${room.room_id}`);
    if (!holder) return;
    holder.innerHTML = '';
    new window.QRCode(holder, { text: qrText(room.token), width: 180, height: 180 });
  };
  for (const room of rooms || []) await renderQr(room);

  view.querySelector('#energy-settings')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = {
      energy_check_timeout_minutes: Number(form.get('timeout')),
      energy_email_notifications_enabled: form.get('emails_on') === 'true',
      energy_alert_emails: String(form.get('emails') || '').trim() || null
    };
    const { error: updateError } = await db.from('configuracion_hotel')
      .update(next)
      .eq('hotel_id', hotelId);
    if (updateError) feedback(friendlyError(updateError));
    else {
      Object.assign(config, next);
      feedback('Configuración guardada.', 'success');
    }
  });

  view.querySelectorAll('[data-generate]').forEach((button) => button.addEventListener('click', async () => {
    const current = (rooms || []).find((room) => room.room_id === button.dataset.generate);
    const prompt = current?.token
      ? 'El QR anterior dejará de funcionar inmediatamente. ¿Regenerar?'
      : 'Se generará un QR privado para esta habitación. ¿Continuar?';
    if (!window.confirm(prompt)) return;
    button.disabled = true;
    const { error: qrError } = await db.rpc('energy_regenerate_qr', { p_room_id: button.dataset.generate });
    if (qrError) {
      feedback(friendlyError(qrError));
      button.disabled = false;
    } else {
      feedback('QR generado correctamente.', 'success');
      await renderSettings(config);
    }
  }));

  const printCard = (card) => {
    const copy = card.cloneNode(true);
    copy.querySelectorAll('button').forEach((button) => button.remove());
    const win = window.open('', '_blank');
    if (!win) { feedback('El navegador bloqueó la ventana de impresión.'); return; }
    win.document.write(`<title>Control de Energía</title><style>body{font-family:Arial;text-align:center;padding:40px}img{margin:auto}h1{font-size:24px}li{text-align:left;max-width:360px;margin:12px auto}</style><h1>CONTROL DE ENERGÍA</h1>${copy.innerHTML}<ul><li>Aire acondicionado apagado</li><li>Televisor apagado</li><li>Luces apagadas</li></ul><b>Escanea este código dentro de la habitación para registrar la revisión.</b>`);
    win.document.close();
    win.print();
  };

  view.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => {
    const card = button.closest('[data-room-card]');
    if (card) printCard(card);
  }));

  view.querySelector('#energy-generate-all')?.addEventListener('click', async () => {
    const missing = (rooms || []).filter((room) => !room.token);
    if (!missing.length) { feedback('Todas las habitaciones activas ya tienen QR.', 'info'); return; }
    if (!window.confirm(`Se generarán ${missing.length} QR. Después debes imprimirlos e instalarlos dentro de las habitaciones. ¿Continuar?`)) return;
    for (const room of missing) {
      const result = await db.rpc('energy_regenerate_qr', { p_room_id: room.room_id });
      if (result.error) { feedback(friendlyError(result.error)); return; }
    }
    feedback(`${missing.length} QR generados.`, 'success');
    await renderSettings(config);
  }));

  view.querySelector('#energy-print-all')?.addEventListener('click', () => {
    const cards = [...view.querySelectorAll('[data-room-card]')]
      .filter((card) => card.querySelector('img'))
      .map((card) => {
        const copy = card.cloneNode(true);
        copy.querySelectorAll('button').forEach((button) => button.remove());
        return `<section>${copy.innerHTML}<ul><li>Aire acondicionado apagado</li><li>Televisor apagado</li><li>Luces apagadas</li></ul><b>Escanea este código dentro de la habitación para registrar la revisión.</b></section>`;
      }).join('');
    if (!cards) { feedback('Primero genera al menos un QR.'); return; }
    const win = window.open('', '_blank');
    if (!win) { feedback('El navegador bloqueó la ventana de impresión.'); return; }
    win.document.write(`<title>QR Control de Energía</title><style>body{font-family:Arial;text-align:center}section{page-break-after:always;padding:35px}img{margin:auto}li{text-align:left;max-width:360px;margin:10px auto}</style>${cards}`);
    win.document.close();
    win.print();
  });
}

export async function mount(container, supabase, _user, currentHotelId) {
  root = container;
  db = supabase;
  hotelId = currentHotelId;
  try {
    capabilities = await readCapabilities();
    if (String(capabilities?.hotel_id || '') !== String(hotelId || '')) throw new Error('NO_AUTORIZADO');
    if (!capabilities?.can_control && !capabilities?.can_admin) throw new Error('NO_AUTORIZADO');
    const config = await readConfig();
    capabilities.enabled = config.energy_control_enabled === true;
    renderShell(config);

    const deepLinkToken = tokenFromCurrentHash();
    if (deepLinkToken && config.energy_control_enabled && capabilities.can_control) {
      await processToken(deepLinkToken);
      return;
    }

    if (config.energy_control_enabled && capabilities.can_control) await openTab('scan', config);
    else if (capabilities.can_admin) await openTab('settings', config);
  } catch (error) {
    const unauthorized = String(error?.message || error).includes('NO_AUTORIZADO');
    root.innerHTML = `<p class="m-6 rounded p-4 ${unauthorized ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}">${unauthorized ? 'No tienes permiso para usar Control de Energía.' : 'No fue posible cargar Control de Energía.'}</p>`;
  }
}

export async function unmount() {
  await stopScanner();
  activeToken = null;
  root = null;
  db = null;
  hotelId = null;
  capabilities = null;
}
