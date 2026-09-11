import * as baseEnergyModule from './control-energia-20260902.js?v=2';

let currentMount = null;

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

function formatDuration(seconds) {
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

function formatDate(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

function rankingShell() {
  return `
    <section class="mx-auto max-w-6xl space-y-5 p-4 md:p-7">
      <header class="rounded-3xl bg-gradient-to-r from-amber-500 to-orange-600 p-6 text-white shadow-lg">
        <p class="text-sm font-semibold uppercase tracking-widest">Control de Energía · Privado</p>
        <div class="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 class="text-3xl font-black">🏆 Top de desempeño</h1>
          <button id="energy-ranking-back" class="rounded-xl bg-white/20 px-4 py-2 font-bold text-white hover:bg-white/30">← Volver</button>
        </div>
        <p class="mt-2 text-amber-50">Ranking administrativo según controles completados y rapidez de verificación.</p>
      </header>

      <div class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <b>Solo administración.</b> Este ranking no se muestra a recepción, camareras ni mantenimiento.
      </div>

      <div class="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow">
        <label for="energy-ranking-period" class="font-bold text-slate-700">Periodo</label>
        <select id="energy-ranking-period" class="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800">
          <option value="7">Últimos 7 días</option>
          <option value="30" selected>Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="0">Todo el historial</option>
        </select>
        <span class="text-sm text-slate-500">El orden prioriza quién más controles ha realizado; en empate gana quien tenga menor tiempo promedio.</span>
      </div>

      <div id="energy-ranking-content" class="space-y-5">
        <div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Cargando ranking…</div>
      </div>
    </section>`;
}

async function fetchRanking(supabase, days) {
  const { data, error } = await supabase.rpc('energy_admin_performance_ranking', { p_days: Number(days) });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function renderRankingContent(container, rows) {
  const target = container.querySelector('#energy-ranking-content');
  if (!target) return;

  if (!rows.length) {
    target.innerHTML = '<div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Todavía no hay controles completados en este periodo.</div>';
    return;
  }

  const fastest = [...rows].sort((a, b) => Number(a.avg_seconds || Infinity) - Number(b.avg_seconds || Infinity))[0];
  const leader = rows[0];
  const total = rows.reduce((sum, row) => sum + Number(row.total_checks || 0), 0);

  target.innerHTML = `
    <div class="grid gap-4 md:grid-cols-3">
      <div class="rounded-2xl bg-white p-5 shadow">
        <p class="text-xs font-bold uppercase tracking-wider text-slate-500">🥇 Líder del periodo</p>
        <p class="mt-2 text-2xl font-black text-slate-900">${escapeHtml(leader.nombre)}</p>
        <p class="mt-1 text-sm text-slate-600">${Number(leader.total_checks || 0)} controles completados</p>
      </div>
      <div class="rounded-2xl bg-white p-5 shadow">
        <p class="text-xs font-bold uppercase tracking-wider text-slate-500">⚡ Más rápida</p>
        <p class="mt-2 text-2xl font-black text-slate-900">${escapeHtml(fastest?.nombre || '—')}</p>
        <p class="mt-1 text-sm text-slate-600">Promedio ${formatDuration(fastest?.avg_seconds)}</p>
      </div>
      <div class="rounded-2xl bg-white p-5 shadow">
        <p class="text-xs font-bold uppercase tracking-wider text-slate-500">✅ Verificaciones realizadas</p>
        <p class="mt-2 text-2xl font-black text-slate-900">${total}</p>
        <p class="mt-1 text-sm text-slate-600">Total del equipo en el periodo</p>
      </div>
    </div>

    <div class="overflow-x-auto rounded-2xl bg-white shadow">
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
                <td class="p-3 text-center font-bold">${formatDuration(row.avg_seconds)} ${isFastest ? '<span class="ml-1 rounded-full bg-emerald-100 px-2 py-1 text-xs text-emerald-800">Más rápida</span>' : ''}</td>
                <td class="p-3 text-center">${formatDuration(row.fastest_seconds)}</td>
                <td class="p-3 text-center"><span class="rounded-full bg-blue-50 px-2 py-1 font-bold text-blue-800">${Number(row.on_time_pct || 0).toFixed(1)}%</span></td>
                <td class="p-3 text-slate-600">${formatDate(row.last_completed_at)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderRanking(container, supabase) {
  container.innerHTML = rankingShell();

  const load = async () => {
    const period = container.querySelector('#energy-ranking-period')?.value || '30';
    const content = container.querySelector('#energy-ranking-content');
    if (content) content.innerHTML = '<div class="rounded-2xl bg-white p-8 text-center text-slate-500 shadow">Cargando ranking…</div>';
    try {
      const rows = await fetchRanking(supabase, period);
      renderRankingContent(container, rows);
    } catch (error) {
      const unauthorized = String(error?.message || error).includes('NO_AUTORIZADO');
      if (content) content.innerHTML = `<div class="rounded-2xl p-6 ${unauthorized ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}">${unauthorized ? 'No tienes permiso para ver este ranking.' : 'No fue posible cargar el ranking de desempeño.'}</div>`;
    }
  };

  container.querySelector('#energy-ranking-period')?.addEventListener('change', load);
  container.querySelector('#energy-ranking-back')?.addEventListener('click', async () => {
    if (!currentMount) return;
    const { container: target, supabase: db, user, hotelId } = currentMount;
    await mount(target, db, user, hotelId);
  });

  await load();
}

async function installRankingButton(container, supabase) {
  const { data: capabilities, error } = await supabase.rpc('energy_capabilities');
  if (error || !capabilities?.can_admin) return;

  const nav = container.querySelector('nav');
  if (!nav || nav.querySelector('[data-energy-ranking]')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.energyRanking = 'true';
  button.className = 'rounded-xl bg-slate-200 px-5 py-3 font-bold text-slate-900';
  button.textContent = '🏆 Top desempeño';
  button.addEventListener('click', async () => {
    await baseEnergyModule.unmount();
    await renderRanking(container, supabase);
  });
  nav.appendChild(button);
}

export async function mount(container, supabase, user, currentHotelId) {
  currentMount = { container, supabase, user, hotelId: currentHotelId };
  await baseEnergyModule.mount(container, supabase, user, currentHotelId);
  await installRankingButton(container, supabase);
}

export async function unmount() {
  currentMount = null;
  await baseEnergyModule.unmount();
}
