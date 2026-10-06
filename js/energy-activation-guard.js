import { supabase } from './supabaseClient.js';

let validating = false;
let rankingInstallInFlight = false;
let rankingAccess = null;

async function showAlert(options) {
  if (window.Swal?.fire) return window.Swal.fire(options);
  const confirmed = window.confirm(options.text || options.title || '¿Continuar?');
  return { isConfirmed: confirmed };
}

async function validateEnergyActivation(toggle) {
  const { data, error } = await supabase.rpc('energy_list_qr_tokens');
  if (error) {
    await showAlert({
      icon: 'error',
      title: 'No se puede activar todavía',
      text: 'No fue posible verificar los QR del hotel. Entra a Control de Energía y vuelve a intentarlo.'
    });
    return false;
  }

  const rooms = data || [];
  const missing = rooms.filter((room) => !room.token);
  if (missing.length > 0) {
    await showAlert({
      icon: 'warning',
      title: 'Faltan QR por preparar',
      text: `Faltan ${missing.length} QR por generar. Entra a Control de Energía, genera los códigos faltantes, imprímelos e instálalos antes de activar la función.`
    });
    return false;
  }

  const confirmation = await showAlert({
    icon: 'warning',
    title: '¿Los QR ya están instalados?',
    text: `Se encontraron ${rooms.length} habitaciones activas con QR generado. Activa el Control de Energía únicamente si los códigos ya fueron impresos y pegados en sus habitaciones.`,
    showCancelButton: true,
    confirmButtonText: 'Sí, activar Control de Energía',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#059669'
  });

  return confirmation.isConfirmed === true;
}

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function formatRankingDuration(seconds) {
  const value = Math.max(0, Number(seconds || 0));
  if (!Number.isFinite(value)) return '—';
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const remaining = Math.round(value % 60);
  if (minutes < 60) return remaining ? `${minutes} min ${remaining} s` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins ? `${hours} h ${mins} min` : `${hours} h`;
}

function formatRankingDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function stopEnergyCameraPreview() {
  document.querySelectorAll('#energy-reader video').forEach((video) => {
    try {
      video.srcObject?.getTracks?.().forEach((track) => track.stop());
    } catch {}
  });
}

function setRankingTabSelected(button) {
  const nav = button?.closest('nav');
  nav?.querySelectorAll('.energy-tab').forEach((tab) => {
    const selected = tab === button;
    tab.classList.toggle('bg-orange-600', selected);
    tab.classList.toggle('text-white', selected);
    tab.classList.toggle('bg-slate-200', !selected);
  });
}

function rankingLayout() {
  return `
    <div class="space-y-5">
      <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
        <div class="font-black">🏆 Top privado de Control de Energía</div>
        <p class="mt-1 text-sm">Este ranking es exclusivo para el propietario del hotel. Se mide cuántas verificaciones hizo cada persona y cuánto tardó en promedio en completarlas.</p>
      </div>

      <div class="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow">
        <label for="energy-ranking-period" class="font-bold text-slate-700">Periodo</label>
        <select id="energy-ranking-period" class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800">
          <option value="7">Últimos 7 días</option>
          <option value="30" selected>Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="0">Todo el historial</option>
        </select>
        <span class="text-sm text-slate-500">El orden prioriza más controles; en empate gana el menor tiempo promedio.</span>
      </div>

      <div id="energy-ranking-content">
        <div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Cargando ranking…</div>
      </div>
    </div>`;
}

function renderRankingRows(view, rows) {
  const target = view.querySelector('#energy-ranking-content');
  if (!target) return;

  if (!rows.length) {
    target.innerHTML = '<div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Todavía no hay controles completados en este periodo.</div>';
    return;
  }

  const fastest = [...rows].sort((a, b) => Number(a.avg_seconds ?? Infinity) - Number(b.avg_seconds ?? Infinity))[0];
  const leader = rows[0];
  const totalChecks = rows.reduce((sum, row) => sum + Number(row.total_checks || 0), 0);

  target.innerHTML = `
    <div class="grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl bg-white p-5 shadow">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">🥇 Líder del periodo</div>
        <div class="mt-2 text-2xl font-black text-slate-900">${escapeHtml(leader.nombre)}</div>
        <div class="mt-1 text-sm text-slate-600">${Number(leader.total_checks || 0)} controles completados</div>
      </div>
      <div class="rounded-2xl bg-white p-5 shadow">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">⚡ Más rápida</div>
        <div class="mt-2 text-2xl font-black text-slate-900">${escapeHtml(fastest?.nombre || '—')}</div>
        <div class="mt-1 text-sm text-slate-600">Promedio ${formatRankingDuration(fastest?.avg_seconds)}</div>
      </div>
      <div class="rounded-2xl bg-white p-5 shadow">
        <div class="text-xs font-bold uppercase tracking-wider text-slate-500">✅ Verificaciones</div>
        <div class="mt-2 text-2xl font-black text-slate-900">${totalChecks}</div>
        <div class="mt-1 text-sm text-slate-600">Total del equipo en el periodo</div>
      </div>
    </div>

    <div class="mt-5 overflow-x-auto rounded-2xl bg-white shadow">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-100 text-slate-700">
          <tr>
            <th class="p-3 text-left">Top</th>
            <th class="p-3 text-left">Persona</th>
            <th class="p-3 text-center">Controles</th>
            <th class="p-3 text-center">Tiempo promedio</th>
            <th class="p-3 text-center">Mejor tiempo</th>
            <th class="p-3 text-center">A tiempo</th>
            <th class="p-3 text-left">Último control</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row, index) => {
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
            const isFastest = String(row.user_id) === String(fastest?.user_id);
            return `
              <tr class="border-t border-slate-100 ${index < 3 ? 'bg-amber-50/40' : ''}">
                <td class="p-3 text-lg font-black">${medal}</td>
                <td class="p-3">
                  <div class="font-black text-slate-900">${escapeHtml(row.nombre)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(row.rol || '—')}</div>
                </td>
                <td class="p-3 text-center text-lg font-black text-slate-900">${Number(row.total_checks || 0)}</td>
                <td class="p-3 text-center font-bold">${formatRankingDuration(row.avg_seconds)} ${isFastest ? '<span class="ml-1 rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Más rápida</span>' : ''}</td>
                <td class="p-3 text-center">${formatRankingDuration(row.fastest_seconds)}</td>
                <td class="p-3 text-center"><span class="rounded-full bg-blue-50 px-2 py-1 font-bold text-blue-800">${Number(row.on_time_pct || 0).toFixed(1)}%</span></td>
                <td class="p-3 text-slate-600">${formatRankingDate(row.last_completed_at)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function loadEnergyRanking(view) {
  const content = view.querySelector('#energy-ranking-content');
  const period = Number(view.querySelector('#energy-ranking-period')?.value || 30);
  if (content) content.innerHTML = '<div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Cargando ranking…</div>';

  const { data, error } = await supabase.rpc('energy_admin_performance_ranking', { p_days: period });
  if (error) {
    const unauthorized = String(error?.message || error).includes('NO_AUTORIZADO');
    if (content) content.innerHTML = `<div class="rounded-2xl p-6 ${unauthorized ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}">${unauthorized ? 'No tienes permiso para ver este ranking.' : 'No fue posible cargar el ranking de desempeño.'}</div>`;
    return;
  }

  renderRankingRows(view, Array.isArray(data) ? data : []);
}

async function openEnergyRanking(button) {
  stopEnergyCameraPreview();
  setRankingTabSelected(button);
  const section = button.closest('section');
  const view = section?.querySelector('#energy-view');
  if (!view) return;

  view.innerHTML = rankingLayout();
  view.querySelector('#energy-ranking-period')?.addEventListener('change', () => loadEnergyRanking(view));
  await loadEnergyRanking(view);
}

async function installEnergyRankingButton() {
  if (rankingInstallInFlight || rankingAccess === false || !String(location.hash || '').startsWith('#/control-energia')) return;
  const app = document.querySelector('#app-container');
  const nav = app?.querySelector('section nav');
  if (!app || !nav || nav.querySelector('[data-energy-ranking="true"]')) return;

  rankingInstallInFlight = true;
  try {
    if (rankingAccess !== true) {
      const { error } = await supabase.rpc('energy_admin_performance_ranking', { p_days: 30 });
      rankingAccess = !error;
    }
    if (!rankingAccess) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.energyRanking = 'true';
    button.dataset.tab = 'ranking';
    button.className = 'energy-tab rounded-xl bg-slate-200 px-5 py-3 font-bold text-slate-900';
    button.textContent = '🏆 Top desempeño';
    button.addEventListener('click', () => openEnergyRanking(button));
    nav.appendChild(button);
  } finally {
    rankingInstallInFlight = false;
  }
}

document.addEventListener('change', async (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement) || toggle.id !== 'energy_control_enabled') return;
  if (!toggle.checked) return;

  if (toggle.dataset.energyActivationConfirmed === 'true') {
    delete toggle.dataset.energyActivationConfirmed;
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  toggle.checked = false;

  if (validating) return;
  validating = true;
  toggle.disabled = true;

  try {
    const allowed = await validateEnergyActivation(toggle);
    if (!allowed) return;

    toggle.dataset.energyActivationConfirmed = 'true';
    toggle.checked = true;
    toggle.disabled = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    validating = false;
    if (toggle.dataset.energyActivationConfirmed !== 'true') toggle.disabled = false;
  }
}, true);

const rankingObserver = new MutationObserver(() => {
  void installEnergyRankingButton();
});

rankingObserver.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', () => void installEnergyRankingButton());
void installEnergyRankingButton();
