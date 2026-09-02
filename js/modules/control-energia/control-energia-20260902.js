import { escapeHtml } from '../../security.js';

let scanner = null;
let activeToken = null;
let root = null;
let db = null;
let hotelId = null;
let capabilities = null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENERGY_QR_PRINT_SIZE_IN = 1.5;
const ENERGY_QR_PRINT_PER_PAGE = 20;

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
  return data || { can_control: false, can_admin: false, can_print_qr: false, enabled: false };
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
  const canPrepareQr = capabilities?.can_admin || capabilities?.can_print_qr;
  const preparationDetail = capabilities?.can_admin
    ? 'Puedes generar, imprimir y organizar los QR sin bloquear habitaciones. Cuando estén instalados, actívalo desde Configuración.'
    : 'Puedes imprimir los QR ya preparados por el administrador. Mientras el sistema esté apagado no se generan controles ni se bloquean habitaciones.';
  const disabledNotice = !config.energy_control_enabled && canPrepareQr
    ? `<div class="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
        <b>Modo preparación.</b> ${preparationDetail}
        ${capabilities?.can_admin ? '<a class="ml-1 font-bold underline" href="#/configuracion">Ir a Configuración</a>.' : ''}
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
        ${capabilities?.can_admin ? '<button data-tab="history" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">Historial</button>' : ''}
        ${canPrepareQr ? `<button data-tab="settings" class="energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold">${capabilities?.can_admin ? 'Configuración y QR' : 'QR e impresión'}</button>` : ''}
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

function printableRoomLabel(value) {
  const raw = String(value || '').trim();
  const number = raw
    .replace(/^habitaci[oó]n\s*/i, '')
    .replace(/^hab\.?\s*/i, '')
    .trim();
  return `Hab. ${number || raw || '—'}`;
}

function qrImageSource(card) {
  const image = card?.querySelector('img');
  if (image?.src?.startsWith('data:image/')) return image.src;
  const canvas = card?.querySelector('canvas');
  try {
    return canvas?.toDataURL('image/png') || '';
  } catch {
    return '';
  }
}

function openEnergyQrPrintWindow(items) {
  const printable = (items || []).filter((item) => item?.imageSrc && item?.label);
  if (!printable.length) return { ok: false, reason: 'empty', count: 0 };

  const win = window.open('', '_blank');
  if (!win) return { ok: false, reason: 'popup', count: 0 };

  const pages = [];
  for (let index = 0; index < printable.length; index += ENERGY_QR_PRINT_PER_PAGE) {
    const pageItems = printable.slice(index, index + ENERGY_QR_PRINT_PER_PAGE);
    pages.push(`<main class="sheet">${pageItems.map((item) => `
      <section class="qr-cut-card">
        <div class="qr-safe-zone"><img class="qr-image" src="${escapeHtml(item.imageSrc)}" alt=""></div>
        <div class="room-label">${escapeHtml(item.label)}</div>
      </section>`).join('')}</main>`);
  }

  win.document.write(`<!doctype html>
    <html lang="es"><head><meta charset="utf-8"><title>QR Control de Energía</title>
    <style>
      @page { size: Letter portrait; margin: 0.25in; }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; background: #fff; font-family: Arial, sans-serif; }
      .sheet {
        width: 8in;
        height: 10.5in;
        display: grid;
        grid-template-columns: repeat(4, 2in);
        grid-template-rows: repeat(5, 2.05in);
        align-content: start;
        page-break-after: always;
        break-after: page;
      }
      .sheet:last-child { page-break-after: auto; break-after: auto; }
      .qr-cut-card {
        width: 2in;
        height: 2.05in;
        border: 0.5pt dashed #aaa;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: flex-start;
        padding: 0.10in 0.10in 0.06in;
        overflow: hidden;
      }
      .qr-safe-zone {
        width: ${ENERGY_QR_PRINT_SIZE_IN}in;
        height: ${ENERGY_QR_PRINT_SIZE_IN}in;
        padding: 0.06in;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #fff;
      }
      .qr-image {
        width: ${ENERGY_QR_PRINT_SIZE_IN - 0.12}in;
        height: ${ENERGY_QR_PRINT_SIZE_IN - 0.12}in;
        display: block;
        object-fit: contain;
        image-rendering: pixelated;
      }
      .room-label {
        margin-top: 0.05in;
        font-size: 9pt;
        line-height: 1.05;
        font-weight: 700;
        color: #111;
        white-space: nowrap;
      }
    </style></head><body>${pages.join('')}</body></html>`);
  win.document.close();

  const triggerPrint = () => window.setTimeout(() => {
    try { win.focus(); } catch {}
    win.print();
  }, 180);

  if (win.document.readyState === 'complete') triggerPrint();
  else win.addEventListener('load', triggerPrint, { once: true });

  return { ok: true, count: printable.length };
}

async function renderSettings(config) {
  const view = root.querySelector('#energy-view');
  if (!capabilities?.can_admin && !capabilities?.can_print_qr) return;

  const { data: rooms, error } = await db.rpc('energy_list_qr_tokens');
  if (error) { feedback(friendlyError(error)); return; }

  const roomList = rooms || [];
  const prepared = roomList.filter((room) => room.token).length;
  const adminSettings = capabilities?.can_admin
    ? `<form id="energy-settings" class="mb-5 grid gap-4 rounded-2xl bg-white p-5 shadow md:grid-cols-3">
        <label class="font-semibold">Tiempo máximo (min)<input name="timeout" type="number" min="1" max="1440" value="${Number(config.energy_check_timeout_minutes || 10)}" class="mt-1 w-full rounded border p-2"></label>
        <label class="font-semibold">Alertas por correo<select name="emails_on" class="mt-1 w-full rounded border p-2"><option value="true" ${config.energy_email_notifications_enabled ? 'selected' : ''}>Activadas</option><option value="false" ${!config.energy_email_notifications_enabled ? 'selected' : ''}>Desactivadas</option></select></label>
        <label class="font-semibold">Correos adicionales<input name="emails" value="${escapeHtml(config.energy_alert_emails || '')}" class="mt-1 w-full rounded border p-2" placeholder="admin@hotel.com"></label>
        <button class="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white md:col-span-3">Guardar configuración</button>
      </form>`
    : `<div class="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
        <b>Acceso de recepción:</b> puedes imprimir los QR ya generados. Crear o regenerar códigos y cambiar la configuración sigue siendo exclusivo del administrador.
      </div>`;
  const generateAllButton = capabilities?.can_admin
    ? '<button id="energy-generate-all" class="rounded-xl bg-orange-600 px-4 py-3 font-bold text-white">Generar QR faltantes</button>'
    : '';

  view.innerHTML = `
    <div class="mb-5 rounded-2xl ${config.energy_control_enabled ? 'bg-emerald-50 text-emerald-950' : 'bg-amber-50 text-amber-950'} p-4">
      <b>${config.energy_control_enabled ? 'Control activado.' : 'Control desactivado / preparación.'}</b>
      ${prepared} de ${roomList.length} habitaciones activas tienen QR preparado.
      ${config.energy_control_enabled
        ? 'Solo las habitaciones con QR preparado generan un control obligatorio al entrar a limpieza.'
        : capabilities?.can_admin
          ? 'Puedes preparar e imprimir todos los QR antes de activar el sistema.'
          : 'Puedes imprimir los QR ya preparados sin activar el sistema.'}
    </div>
    ${adminSettings}
    <div class="mb-5 rounded-2xl bg-white p-5 shadow">
      <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 class="text-lg font-black text-slate-900">Impresión de QR</h2>
          <p class="text-sm text-slate-600">Cada bloque QR mide 1.5 × 1.5 pulgadas, con el número de habitación debajo. Se acomodan hasta 20 por hoja carta (4 × 5) para recortar.</p>
        </div>
        <span id="energy-selection-count" class="text-sm font-bold text-slate-600">0 seleccionadas</span>
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        ${generateAllButton}
        <button id="energy-select-all" type="button" class="rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-800">Seleccionar todas con QR</button>
        <button id="energy-clear-selection" type="button" class="rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-800">Limpiar selección</button>
        <button id="energy-print-selected" type="button" disabled class="rounded-xl bg-slate-700 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Imprimir seleccionadas (0)</button>
        <button id="energy-print-all" type="button" class="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">Imprimir todos los QR</button>
      </div>
    </div>
    <div class="grid gap-4 md:grid-cols-2">${roomList.map((room) => `<article class="rounded-2xl bg-white p-5 shadow" data-room-card="${room.room_id}">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h3 class="text-xl font-black">Habitación ${escapeHtml(room.room_name)}</h3>
          <p class="my-2 text-sm">${room.token ? `QR generado ${formatDate(room.generated_at)}` : 'Sin QR'}</p>
        </div>
        <label class="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" data-select-room="${room.room_id}" ${room.token ? '' : 'disabled'} class="h-5 w-5 rounded border-slate-300">
          Seleccionar
        </label>
      </div>
      <div id="qr-${room.room_id}" class="my-3"></div>
      <div class="flex flex-wrap gap-2">
        ${capabilities?.can_admin ? `<button data-generate="${room.room_id}" class="rounded-lg bg-orange-600 px-4 py-2 font-bold text-white">${room.token ? 'Regenerar QR' : 'Generar QR'}</button>` : ''}
        ${room.token ? `<button data-print="${room.room_id}" class="rounded-lg bg-slate-700 px-4 py-2 font-bold text-white">Imprimir este QR</button>` : ''}
      </div>
    </article>`).join('')}</div>`;

  const renderQr = async (room) => {
    if (!room.token) return;
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', 'QRCode');
    const holder = view.querySelector(`#qr-${room.room_id}`);
    if (!holder) return;
    holder.innerHTML = '';
    new window.QRCode(holder, { text: qrText(room.token), width: 256, height: 256 });
    holder.querySelectorAll('canvas, img').forEach((element) => {
      element.style.width = '180px';
      element.style.height = '180px';
      element.style.maxWidth = '100%';
    });
  };
  for (const room of roomList) await renderQr(room);

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
    const current = roomList.find((room) => room.room_id === button.dataset.generate);
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

  const selectedRoomIds = new Set();
  const updateSelectionUi = () => {
    const count = selectedRoomIds.size;
    const countLabel = view.querySelector('#energy-selection-count');
    const printSelected = view.querySelector('#energy-print-selected');
    if (countLabel) countLabel.textContent = `${count} seleccionada${count === 1 ? '' : 's'}`;
    if (printSelected) {
      printSelected.disabled = count === 0;
      printSelected.textContent = `Imprimir seleccionadas (${count})`;
    }
  };

  view.querySelectorAll('[data-select-room]').forEach((checkbox) => checkbox.addEventListener('change', () => {
    const id = checkbox.dataset.selectRoom;
    if (!id) return;
    if (checkbox.checked) selectedRoomIds.add(id);
    else selectedRoomIds.delete(id);
    updateSelectionUi();
  }));

  view.querySelector('#energy-select-all')?.addEventListener('click', () => {
    selectedRoomIds.clear();
    view.querySelectorAll('[data-select-room]').forEach((checkbox) => {
      if (checkbox.disabled) return;
      checkbox.checked = true;
      selectedRoomIds.add(checkbox.dataset.selectRoom);
    });
    updateSelectionUi();
  });

  view.querySelector('#energy-clear-selection')?.addEventListener('click', () => {
    selectedRoomIds.clear();
    view.querySelectorAll('[data-select-room]').forEach((checkbox) => { checkbox.checked = false; });
    updateSelectionUi();
  });

  const printRoomIds = (roomIds) => {
    const wanted = new Set(roomIds || []);
    const items = roomList
      .filter((room) => room.token && wanted.has(room.room_id))
      .map((room) => {
        const card = view.querySelector(`[data-room-card="${room.room_id}"]`);
        return {
          label: printableRoomLabel(room.room_name),
          imageSrc: qrImageSource(card)
        };
      })
      .filter((item) => item.imageSrc);

    if (!items.length) {
      feedback('No hay QR listos para imprimir en esa selección.');
      return;
    }

    const result = openEnergyQrPrintWindow(items);
    if (!result.ok) {
      feedback(result.reason === 'popup'
        ? 'El navegador bloqueó la ventana de impresión. Permite ventanas emergentes e inténtalo de nuevo.'
        : 'No fue posible preparar los QR para imprimir.');
      return;
    }
    feedback(`Vista de impresión preparada con ${result.count} QR.`, 'success');
  };

  view.querySelectorAll('[data-print]').forEach((button) => button.addEventListener('click', () => {
    printRoomIds([button.dataset.print]);
  }));

  view.querySelector('#energy-print-selected')?.addEventListener('click', () => {
    printRoomIds([...selectedRoomIds]);
  });

  view.querySelector('#energy-generate-all')?.addEventListener('click', async () => {
    const missing = roomList.filter((room) => !room.token);
    if (!missing.length) { feedback('Todas las habitaciones activas ya tienen QR.', 'info'); return; }
    if (!window.confirm(`Se generarán ${missing.length} QR. Después debes imprimirlos e instalarlos dentro de las habitaciones. ¿Continuar?`)) return;
    for (const room of missing) {
      const result = await db.rpc('energy_regenerate_qr', { p_room_id: room.room_id });
      if (result.error) { feedback(friendlyError(result.error)); return; }
    }
    feedback(`${missing.length} QR generados.`, 'success');
    await renderSettings(config);
  });

  view.querySelector('#energy-print-all')?.addEventListener('click', () => {
    const ready = roomList.filter((room) => room.token);
    const missingCount = roomList.length - ready.length;
    if (missingCount > 0) {
      const instruction = capabilities?.can_admin
        ? 'Usa “Generar QR faltantes” antes de imprimir todas las habitaciones.'
        : 'Pide al administrador que genere los QR faltantes y vuelve a intentarlo.';
      feedback(`Faltan ${missingCount} QR por generar. ${instruction}`, 'info');
      return;
    }
    printRoomIds(ready.map((room) => room.room_id));
  });

  updateSelectionUi();
}

export async function mount(container, supabase, _user, currentHotelId) {
  root = container;
  db = supabase;
  hotelId = currentHotelId;
  try {
    capabilities = await readCapabilities();
    if (String(capabilities?.hotel_id || '') !== String(hotelId || '')) throw new Error('NO_AUTORIZADO');
    if (!capabilities?.can_control && !capabilities?.can_admin && !capabilities?.can_print_qr) throw new Error('NO_AUTORIZADO');
    const config = await readConfig();
    capabilities.enabled = config.energy_control_enabled === true;
    renderShell(config);

    const deepLinkToken = tokenFromCurrentHash();
    if (deepLinkToken && config.energy_control_enabled && capabilities.can_control) {
      await processToken(deepLinkToken);
      return;
    }

    if (config.energy_control_enabled && capabilities.can_control) await openTab('scan', config);
    else if (capabilities.can_admin || capabilities.can_print_qr) await openTab('settings', config);
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
