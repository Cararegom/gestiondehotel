import { escapeHtml } from '../security.js';
import { selectEnergyReceptionWarnings } from './energyReceptionWarningRules.mjs';

const POLL_MS = 20000;
const SETTINGS_REFRESH_MS = 60000;
const REMIND_MS = 120000;
const MODAL_ID = 'energy-reception-warning-modal';
const STYLE_ID = 'energy-reception-warning-style';

let client = null;
let currentHotelId = null;
let currentUserId = null;
let timer = null;
let settings = null;
let settingsLoadedAt = 0;
let polling = false;
let generation = 0;
let modalCheckKey = '';
let previousFocus = null;
const remindAfter = new Map();

function isReceptionist(role) {
  return String(role || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') === 'recepcionista';
}

function onEnergyRoute() {
  return String(window.location.hash || '').split('?')[0] === '#/control-energia';
}

function closeModal() {
  document.getElementById(MODAL_ID)?.remove();
  modalCheckKey = '';
  if (previousFocus?.isConnected && typeof previousFocus.focus === 'function') {
    previousFocus.focus();
  }
  previousFocus = null;
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = [
    '#energy-reception-warning-modal{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(15,23,42,.72);backdrop-filter:blur(5px)}',
    '#energy-reception-warning-modal .erw-card{width:min(100%,520px);max-height:90vh;overflow:auto;background:#fff;border-radius:26px;box-shadow:0 25px 90px rgba(0,0,0,.35);font-family:inherit}',
    '#energy-reception-warning-modal .erw-head{padding:27px 28px 23px;background:linear-gradient(130deg,#fff7ed,#ffedd5);border-bottom:1px solid #fed7aa}',
    '#energy-reception-warning-modal .erw-icon{display:inline-flex;align-items:center;justify-content:center;width:54px;height:54px;background:#fff;border-radius:18px;font-size:29px;box-shadow:0 5px 16px rgba(154,52,18,.12)}',
    '#energy-reception-warning-modal .erw-label{display:block;margin:16px 0 6px;color:#9a3412;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}',
    '#energy-reception-warning-modal h2{margin:0;color:#172033;font-size:24px;line-height:1.3;font-weight:800}',
    '#energy-reception-warning-modal .erw-body{padding:23px 28px 27px;color:#334155;font-size:15px;line-height:1.55}',
    '#energy-reception-warning-modal .erw-list{list-style:none;margin:16px 0;padding:0;display:grid;gap:9px;max-height:190px;overflow:auto}',
    '#energy-reception-warning-modal .erw-room{padding:11px 13px;border-radius:12px;border:1px solid #fed7aa;background:#fffaf4;font-weight:750;color:#9a3412;display:flex;justify-content:space-between;gap:10px}',
    '#energy-reception-warning-modal .erw-note{font-size:13px;color:#64748b;margin:13px 0 0}',
    '#energy-reception-warning-modal .erw-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:23px}',
    '#energy-reception-warning-modal button{padding:13px 11px;border-radius:13px;font-weight:800;cursor:pointer;border:1px solid #cbd5e1;min-height:48px}',
    '#energy-reception-warning-modal .erw-later{background:#fff;color:#334155}',
    '#energy-reception-warning-modal .erw-go{background:#ea580c;border-color:#ea580c;color:#fff}',
    '#energy-reception-warning-modal button:focus-visible{outline:3px solid #0ea5e9;outline-offset:3px}',
    '@media(max-width:460px){#energy-reception-warning-modal .erw-head{padding:22px}#energy-reception-warning-modal .erw-body{padding:20px 22px}#energy-reception-warning-modal .erw-actions{grid-template-columns:1fr}}'
  ].join('\n');
  document.head.appendChild(style);
}

function snooze(checks) {
  const until = Date.now() + REMIND_MS;
  checks.forEach((check) => remindAfter.set(check.id, until));
}

function showModal(checks, minutes) {
  const key = checks.map((check) => check.id).join('|');
  if (document.getElementById(MODAL_ID) && key === modalCheckKey) return;
  closeModal();
  ensureStyles();
  const overlay = document.createElement('div');
  overlay.id = MODAL_ID;
  const count = checks.length;
  const rooms = checks.slice(0, 6).map((check) => {
    const name = String(check.habitaciones?.nombre || 'Habitación sin número');
    const since = Math.max(0, Math.floor((Date.now() - Date.parse(check.created_at)) / 60000));
    return '<li class="erw-room"><span>' + escapeHtml(name) +
      '</span><span>' + since + ' min</span></li>';
  }).join('');
  previousFocus = document.activeElement;
  overlay.innerHTML = [
    '<section class="erw-card" role="alertdialog" aria-modal="true" aria-labelledby="erw-title" aria-describedby="erw-description">',
    '<header class="erw-head"><span class="erw-icon" aria-hidden="true">⚡</span>',
    '<span class="erw-label">Advertencia a recepción</span>',
    '<h2 id="erw-title">Control de energía pendiente</h2></header>',
    '<div class="erw-body"><p id="erw-description">Han pasado al menos <strong>' + minutes +
      ' minutos</strong> y ' + (count === 1 ? 'hay una habitación' : 'hay ' + count + ' habitaciones') +
      ' sin verificar. Realiza el control de energía cuanto antes.</p>',
    '<ul class="erw-list">' + rooms + (count > 6 ? '<li>Y ' + (count - 6) + ' más…</li>' : '') + '</ul>',
    '<p class="erw-note">Escanea el QR desde el celular dentro de la habitación. Este aviso se repetirá mientras existan controles pendientes.</p>',
    '<div class="erw-actions"><button type="button" class="erw-later">Recordar en 2 minutos</button>',
    '<button type="button" class="erw-go">Ir a Control de Energía</button></div></div></section>'
  ].join('');
  document.body.appendChild(overlay);
  modalCheckKey = key;
  overlay.querySelector('.erw-later')?.addEventListener('click', () => {
    snooze(checks);
    closeModal();
  });
  overlay.querySelector('.erw-go')?.addEventListener('click', () => {
    snooze(checks);
    closeModal();
    window.location.hash = '#/control-energia';
  });
  overlay.querySelector('.erw-go')?.focus();
}

async function poll() {
  if (polling || !client || !currentHotelId || document.hidden) return;
  if (onEnergyRoute()) {
    closeModal();
    return;
  }
  polling = true;
  const token = generation;
  const db = client;
  const hotelId = currentHotelId;
  try {
    if (!settings || Date.now() - settingsLoadedAt >= SETTINGS_REFRESH_MS) {
      const { data, error } = await db.from('configuracion_hotel')
        .select('energy_control_enabled,energy_reception_warning_enabled,energy_reception_warning_minutes')
        .eq('hotel_id', hotelId).maybeSingle();
      if (error) throw error;
      if (token !== generation) return;
      settings = data;
      settingsLoadedAt = Date.now();
    }
    if (!settings?.energy_control_enabled || !settings?.energy_reception_warning_enabled) {
      closeModal();
      return;
    }
    const minutes = Number(settings.energy_reception_warning_minutes || 5);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return;
    const cutoff = new Date(Date.now() - minutes * 60000).toISOString();
    const { data, error } = await db.from('room_energy_checks')
      .select('id,room_id,status,created_at,habitaciones(nombre)')
      .eq('hotel_id', hotelId)
      .in('status', ['pending', 'overdue'])
      .lte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(100);
    if (error) throw error;
    if (token !== generation || onEnergyRoute()) {
      closeModal();
      return;
    }
    const overdue = selectEnergyReceptionWarnings(data, minutes);
    const visibleIds = new Set(overdue.map((item) => item.id));
    for (const id of remindAfter.keys()) {
      if (!visibleIds.has(id)) remindAfter.delete(id);
    }
    const toNotify = overdue.filter((item) => (remindAfter.get(item.id) || 0) <= Date.now());
    if (toNotify.length) showModal(toNotify, minutes);
    else closeModal();
  } catch (error) {
    // Si falla la conexión no mostramos un aviso basado en datos potencialmente obsoletos.
    console.warn('[energy-reception-warning] No se pudo consultar el estado actual:', error?.message || error);
    closeModal();
  } finally {
    polling = false;
  }
}

function onVisibilityChange() {
  if (!document.hidden) void poll();
}

function onRouteChange() {
  if (onEnergyRoute()) closeModal();
  else void poll();
}

export function stopEnergyReceptionWarning() {
  generation += 1;
  if (timer !== null) window.clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('hashchange', onRouteChange);
  closeModal();
  client = null;
  currentHotelId = null;
  currentUserId = null;
  settings = null;
  settingsLoadedAt = 0;
  remindAfter.clear();
}

export function startEnergyReceptionWarning({ supabase, hotelId, userId, role } = {}) {
  stopEnergyReceptionWarning();
  if (!supabase || !hotelId || !userId || !isReceptionist(role)) return;
  client = supabase;
  currentHotelId = String(hotelId);
  currentUserId = String(userId);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('hashchange', onRouteChange);
  timer = window.setInterval(() => void poll(), POLL_MS);
  void poll();
}
