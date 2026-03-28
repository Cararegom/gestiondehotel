import {
  canUseNotificationCenter,
  fetchNotificationFeed,
  fetchNotificationHistory,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  resolveNotificationContext,
  subscribeToNotificationFeed
} from '../../services/notificationCenterService.js';

let bellSubscription = null;
let bellListeners = [];
let pageListeners = [];
let currentBellContext = null;
let currentBellContainer = null;

function addBellListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  bellListeners.push({ element, type, handler });
}

function addPageListener(element, type, handler) {
  if (!element) return;
  element.addEventListener(type, handler);
  pageListeners.push({ element, type, handler });
}

function cleanupBellListeners() {
  bellListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
  bellListeners = [];
}

function cleanupPageListeners() {
  pageListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
  pageListeners = [];
}

function formatNotificationDate(dateStr, options = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!dateStr) return 'N/A';
  const parsed = new Date(dateStr);
  return Number.isNaN(parsed.getTime()) ? 'Fecha invalida' : parsed.toLocaleString('es-CO', options);
}

function getNotificationToneClass(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('error')) return 'bg-red-100 text-red-800';
  if (normalized.includes('alert')) return 'bg-amber-100 text-amber-800';
  if (normalized.includes('limpieza')) return 'bg-emerald-100 text-emerald-800';
  return 'bg-blue-100 text-blue-800';
}

function renderDropdownList(listEl, badgeEl, notifications = []) {
  if (!listEl || !badgeEl) return;

  const unreadCount = notifications.filter((item) => !item.leida).length;
  badgeEl.textContent = unreadCount > 9 ? '9+' : String(unreadCount);
  badgeEl.style.display = unreadCount > 0 ? 'flex' : 'none';

  if (!notifications.length) {
    listEl.innerHTML = '<li class="px-4 py-3 text-sm text-gray-500 text-center">No tienes notificaciones.</li>';
    return;
  }

  listEl.innerHTML = notifications.map((notification) => `
    <li class="dropdown-item block cursor-pointer px-4 py-3 text-sm text-gray-700 hover:bg-gray-100 ${notification.leida ? '' : 'bg-indigo-50 font-medium'}" data-notificacion-id="${notification.id}">
      <div class="flex items-start gap-2">
        <span class="mt-1 inline-block h-2 w-2 rounded-full ${notification.leida ? 'bg-slate-300' : 'bg-indigo-500'}"></span>
        <div class="min-w-0 flex-1">
          <div class="leading-tight">${notification.mensaje || 'Notificacion'}</div>
          <div class="mt-1 text-xs text-gray-400">${formatNotificationDate(notification.creado_en)}</div>
        </div>
      </div>
    </li>
  `).join('');
}

async function refreshBellFeed(supabase, bellUi) {
  if (!currentBellContext) return;

  try {
    const notifications = await fetchNotificationFeed(supabase, currentBellContext, 7);
    renderDropdownList(bellUi.listEl, bellUi.badgeEl, notifications);
  } catch (error) {
    console.error('Error cargando notificaciones para campanita:', error);
    bellUi.listEl.innerHTML = '<li class="px-4 py-3 text-sm text-red-500 text-center">Error al cargar.</li>';
  }
}

export async function inicializarCampanitaGlobal(bellContainer, supabase, currentUser = null, providedHotelId = null) {
  currentBellContainer = bellContainer;
  cleanupBellListeners();

  if (bellSubscription) {
    await bellSubscription.unsubscribe().catch(() => {});
    bellSubscription = null;
  }

  const context = await resolveNotificationContext(supabase, currentUser, providedHotelId);
  if (!context?.user || !context?.hotelId) {
    bellContainer.innerHTML = '';
    currentBellContext = null;
    return;
  }

  const enabled = await canUseNotificationCenter(supabase, context.hotelId).catch((error) => {
    console.error('Campanita: error verificando plan.', error);
    return false;
  });

  if (!enabled) {
    bellContainer.innerHTML = '';
    currentBellContext = null;
    return;
  }

  currentBellContext = context;

  bellContainer.innerHTML = `
    <div id="notificaciones-icono-wrapper" class="relative inline-block text-left">
      <button id="notificaciones-toggle-btn" type="button" class="button-icon rounded-full p-2 hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2" aria-label="Notificaciones" aria-haspopup="true" aria-expanded="false">
        <svg class="h-6 w-6 text-gray-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
        <span id="notificaciones-badge-count" class="absolute right-0 top-0 flex h-4 w-4 translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-500 text-xs text-white" style="display:none;"></span>
      </button>
      <div id="notificaciones-dropdown-menu" class="dropdown-menu absolute right-0 z-50 mt-2 hidden w-80 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5">
        <div class="py-1">
          <div class="border-b border-gray-200 px-4 py-2 text-sm font-medium text-gray-700">Notificaciones recientes</div>
          <ul id="notificaciones-dropdown-list" class="max-h-80 overflow-y-auto"></ul>
          <div class="flex items-center justify-between border-t border-gray-200 px-4 py-2">
            <button id="btn-marcar-todas-leidas-campana" class="text-xs text-indigo-600 hover:text-indigo-800 focus:outline-none">Marcar todas como leidas</button>
            <a href="#/notificaciones" id="link-ver-todas-notificaciones" class="text-xs text-indigo-600 hover:text-indigo-800">Ver todas</a>
          </div>
        </div>
      </div>
    </div>
  `;

  const buttonEl = bellContainer.querySelector('#notificaciones-toggle-btn');
  const menuEl = bellContainer.querySelector('#notificaciones-dropdown-menu');
  const listEl = bellContainer.querySelector('#notificaciones-dropdown-list');
  const markAllEl = bellContainer.querySelector('#btn-marcar-todas-leidas-campana');
  const badgeEl = bellContainer.querySelector('#notificaciones-badge-count');
  const linkEl = bellContainer.querySelector('#link-ver-todas-notificaciones');
  const bellUi = { listEl, badgeEl };

  const toggleDropdown = (event) => {
    event?.stopPropagation?.();
    menuEl?.classList.toggle('hidden');
    buttonEl?.setAttribute('aria-expanded', String(!(menuEl?.classList.contains('hidden'))));
  };

  const closeDropdown = (event) => {
    if (!menuEl || menuEl.classList.contains('hidden')) return;
    if (event?.target && bellContainer.contains(event.target)) return;
    menuEl.classList.add('hidden');
    buttonEl?.setAttribute('aria-expanded', 'false');
  };

  const handleMarkAll = async () => {
    try {
      await markAllNotificationsAsRead(supabase);
      await refreshBellFeed(supabase, bellUi);
    } catch (error) {
      console.error('Error marcando notificaciones como leidas:', error);
    }
  };

  const handleNotificationClick = async (event) => {
    const item = event.target.closest('[data-notificacion-id]');
    if (!item) return;
    const notificationId = item.dataset.notificacionId;
    try {
      await markNotificationAsRead(supabase, notificationId, currentBellContext.hotelId);
      await refreshBellFeed(supabase, bellUi);
    } catch (error) {
      console.error('Error marcando notificacion como leida:', error);
    }
  };

  addBellListener(buttonEl, 'click', toggleDropdown);
  addBellListener(markAllEl, 'click', handleMarkAll);
  addBellListener(linkEl, 'click', () => {
    menuEl?.classList.add('hidden');
    buttonEl?.setAttribute('aria-expanded', 'false');
  });
  addBellListener(listEl, 'click', handleNotificationClick);
  addBellListener(document, 'click', closeDropdown);

  await refreshBellFeed(supabase, bellUi);

  bellSubscription = subscribeToNotificationFeed(supabase, context, () => {
    void refreshBellFeed(supabase, bellUi);
  });
}

export function desmontarCampanitaGlobal() {
  cleanupBellListeners();
  if (bellSubscription) {
    bellSubscription.unsubscribe().catch(() => {});
    bellSubscription = null;
  }
  if (currentBellContainer) {
    currentBellContainer.innerHTML = '';
  }
  currentBellContext = null;
  currentBellContainer = null;
}

function renderHistoryTable(pageContainer, notifications = []) {
  const unreadCount = notifications.filter((item) => !item.leida).length;
  const last24hCount = notifications.filter((item) => {
    const createdAt = item.creado_en ? new Date(item.creado_en).getTime() : 0;
    return createdAt >= Date.now() - (24 * 60 * 60 * 1000);
  }).length;

  pageContainer.innerHTML = `
    <div class="space-y-6">
      <section class="rounded-[28px] bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 p-6 text-white shadow-2xl">
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p class="text-xs uppercase tracking-[0.35em] text-blue-200">Notificaciones</p>
            <h1 class="mt-2 text-3xl font-black">Centro de notificaciones</h1>
            <p class="mt-2 max-w-3xl text-sm text-blue-100">Revisa alertas operativas, marca pendientes como leidos y mantente al dia con lo que pasa en tu hotel.</p>
          </div>
          <button id="notifications-mark-all-page" class="rounded-2xl bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20">
            Marcar todas como leidas
          </button>
        </div>
        <div class="mt-6 grid gap-4 md:grid-cols-3">
          <article class="rounded-2xl border border-blue-200 bg-white/10 p-4 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.22em] text-blue-100">Total</p>
            <p class="mt-2 text-3xl font-black">${notifications.length}</p>
          </article>
          <article class="rounded-2xl border border-amber-200 bg-white/10 p-4 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.22em] text-blue-100">Sin leer</p>
            <p class="mt-2 text-3xl font-black">${unreadCount}</p>
          </article>
          <article class="rounded-2xl border border-emerald-200 bg-white/10 p-4 backdrop-blur">
            <p class="text-xs uppercase tracking-[0.22em] text-blue-100">Ultimas 24h</p>
            <p class="mt-2 text-3xl font-black">${last24hCount}</p>
          </article>
        </div>
      </section>

      <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div class="overflow-x-auto">
          <table class="min-w-full divide-y divide-gray-200 text-sm">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fecha</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Mensaje</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Tipo</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Estado</th>
                <th class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Accion</th>
              </tr>
            </thead>
            <tbody id="historial-notificaciones-tbody" class="divide-y divide-gray-200 bg-white">
              ${notifications.length === 0
                ? '<tr><td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">No hay notificaciones en tu historial.</td></tr>'
                : notifications.map((notification) => `
                  <tr class="${notification.leida ? 'bg-white' : 'bg-indigo-50 font-medium'}">
                    <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500">${formatNotificationDate(notification.creado_en)}</td>
                    <td class="px-4 py-3 text-sm text-gray-900">${notification.mensaje || 'Notificacion'}</td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm">
                      <span class="inline-flex rounded-full px-2 py-1 text-xs font-semibold ${getNotificationToneClass(notification.tipo)}">${notification.tipo || 'General'}</span>
                    </td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm ${notification.leida ? 'text-gray-500' : 'text-indigo-600'}">${notification.leida ? 'Leida' : 'No leida'}</td>
                    <td class="whitespace-nowrap px-4 py-3 text-sm font-medium">
                      ${notification.leida
                        ? '<span class="text-xs text-slate-400">Sin acciones</span>'
                        : `<button class="marcar-leida-historial text-indigo-600 hover:text-indigo-900" data-id="${notification.id}">Marcar leida</button>`}
                    </td>
                  </tr>
                `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

export async function mount(pageContainer, supabase, currentUser) {
  cleanupPageListeners();

  if (!currentUser?.id) {
    pageContainer.innerHTML = '<p class="rounded bg-red-100 p-4 text-red-700">No se pudo cargar la pagina de notificaciones porque no hay un usuario valido.</p>';
    return;
  }

  pageContainer.innerHTML = `
    <div class="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
      Cargando historial de notificaciones...
    </div>
  `;

  try {
    const context = await resolveNotificationContext(supabase, currentUser);
    if (!context?.hotelId) {
      pageContainer.innerHTML = '<p class="rounded bg-red-100 p-4 text-red-700">No se encontro el hotel del usuario actual.</p>';
      return;
    }

    const notifications = await fetchNotificationHistory(supabase, context, 100);
    renderHistoryTable(pageContainer, notifications);

    const tbody = pageContainer.querySelector('#historial-notificaciones-tbody');
    const markAllButton = pageContainer.querySelector('#notifications-mark-all-page');

    addPageListener(markAllButton, 'click', async () => {
      await markAllNotificationsAsRead(supabase);
      await mount(pageContainer, supabase, currentUser);
    });

    addPageListener(tbody, 'click', async (event) => {
      const button = event.target.closest('.marcar-leida-historial');
      if (!button) return;
      await markNotificationAsRead(supabase, button.dataset.id, context.hotelId);
      await mount(pageContainer, supabase, currentUser);
    });
  } catch (error) {
    console.error('Error cargando el historial de notificaciones:', error);
    pageContainer.innerHTML = `<p class="rounded bg-red-100 p-4 text-red-700">Error al cargar el historial: ${error.message}</p>`;
  }
}

export function unmount() {
  cleanupPageListeners();
}
