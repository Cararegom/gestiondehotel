// js/main.js
import { supabase } from './supabaseClient.js';
import { getCurrentUser, requireAuth, handleLogout, onAuthStateChange } from './authService.js';
import { showAppFeedback, clearAppFeedback, showGlobalLoading, hideGlobalLoading } from './uiUtils.js';
import { APP_CONFIG } from './config.js';

import * as Dashboard from './modules/dashboard/dashboard.js';
import * as Reservas from './modules/reservas/reservas.js';
import * as Habitaciones from './modules/habitaciones/habitaciones.js';
import * as Caja from './modules/caja/caja.js';
import * as Servicios from './modules/servicios/servicios.js';
import * as Tienda from './modules/tienda/tienda.js';
import * as Restaurante from './modules/restaurante/restaurante.js';
import * as Usuarios from './modules/usuarios/usuarios.js';
import * as Configuracion from './modules/configuracion/configuracion.js';
import * as Reportes from './modules/reportes/reportes.js';
import * as Limpieza from './modules/limpieza/limpieza.js';
import * as Integraciones from './modules/integraciones/integraciones.js';
import * as MapaHabitaciones from './modules/mapa-habitaciones/mapa-habitaciones.js';
import * as NotificacionesPage from './modules/notificaciones/notificaciones.js';
import * as Mantenimiento from './modules/mantenimiento/mantenimiento.js';

// --- AQUI IMPORTAS EL MODULO DE BITACORA ---
import * as Bitacora from './modules/bitacora/bitacora.js';

import { inicializarCampanitaGlobal, desmontarCampanitaGlobal } from './modules/notificaciones/notificaciones.js';

let currentModuleUnmount = null;
let appContainer = null;
let mainNav = null;
let userInfoNav = null;
let notificacionesCampanitaContainer = null;
let campanitaInicializada = false;

const routes = {
  '/dashboard': Dashboard,
  '/reservas': Reservas,
  '/habitaciones': Habitaciones,
  '/mapa-habitaciones': MapaHabitaciones,
  '/caja': Caja,
  '/servicios': Servicios,
  '/tienda': Tienda,
  '/restaurante': Restaurante,
  '/usuarios': Usuarios,
  '/configuracion': Configuracion,
  '/reportes': Reportes,
  '/limpieza': Limpieza,
  '/integraciones': Integraciones,
  '/notificaciones': NotificacionesPage,
  '/mantenimiento': Mantenimiento,
  '/bitacora': Bitacora // <--- AGREGA LA RUTA PARA BITACORA
};

const navLinksConfig = [
    { path: '#/dashboard', text: 'Dashboard', icon: '📊' },
    { path: '#/reservas', text: 'Reservas', icon: '📅' },
    { path: '#/mapa-habitaciones', text: 'Mapa Hotel', icon: '🗺️' },
    { path: '#/habitaciones', text: 'Habitaciones', icon: '🚪' },
    { path: '#/caja', text: 'Caja', icon: '💰' },
    { path: '#/servicios', text: 'Servicios', icon: '🛎️' },
    { path: '#/tienda', text: 'Tienda', icon: '🛍️' },
    { path: '#/restaurante', text: 'Restaurante', icon: '🍽️' },
    { path: '#/limpieza', text: 'Limpieza', icon: '🧹' },
    { path: '#/reportes', text: 'Reportes', icon: '📈' },
    { path: '#/mantenimiento', text: 'Mantenimiento', icon: '🛠️' },
    // --- AGREGA LA OPCIÓN DE BITÁCORA AL MENÚ ---
    { path: '#/bitacora', text: 'Bitácora', icon: '📓' },
    { path: '#/usuarios', text: 'Usuarios', icon: '👥' },
    { path: '#/configuracion', text: 'Configuración', icon: '⚙️' },
    { path: '#/integraciones', text: 'Integraciones', icon: '🔗' },
    { path: '#/notificaciones', text: 'Ver Notificaciones', icon: '📜' },
];

function renderNavigation(user) {
    if (!mainNav) return;
    const dynamicLinks = mainNav.querySelectorAll('a.nav-link-dynamic');
    dynamicLinks.forEach(link => link.remove());
    if (user) {
        navLinksConfig.forEach(linkConfig => {
            const a = document.createElement('a');
            a.href = linkConfig.path;
            a.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';
            a.innerHTML = `<span class="mr-2 text-lg">${linkConfig.icon}</span> ${linkConfig.text}`;
            mainNav.appendChild(a);
        });
    }
}

function updateUserInfo(user) {
  if (!userInfoNav) return;
  if (user) {
    const userEmail = user.email;
    const userRol = user.app_metadata?.rol || 'Usuario';
    userInfoNav.innerHTML = `
      <div class="user-profile text-sm p-2 border-t border-gray-700 mt-auto">
        <span class="user-email block font-medium text-white truncate" title="${userEmail}">${userEmail}</span>
        <span class="user-role block text-xs text-gray-400">${userRol}</span>
      </div>
      <button id="logout-button" class="button button-danger w-full text-left p-2 hover:bg-red-700 rounded flex items-center text-sm mt-2">
        <span class="mr-2 text-lg">🚪</span> Cerrar Sesión
      </button>
    `;
    const logoutButton = userInfoNav.querySelector('#logout-button');
    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        showGlobalLoading("Cerrando sesión...");
        await handleLogout(supabase);
        hideGlobalLoading();
      });
    }
  } else {
    userInfoNav.innerHTML = '';
  }
}

async function router() {
  if (!appContainer) {
    appContainer = document.getElementById('app-container');
    if (!appContainer) {
        document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Falta #app-container.</p>";
        return;
    }
  }
  showGlobalLoading("Cargando vista...");
  const path = window.location.hash.slice(1) || '/dashboard';
  const baseRoute = path.split('?')[0];

  if (typeof currentModuleUnmount === 'function') {
    try {
      currentModuleUnmount(appContainer);
    } catch (e) {
      console.error("Error al desmontar el módulo anterior:", baseRoute, e);
    }
    currentModuleUnmount = null;
  }

  appContainer.innerHTML = '<div class="p-8 text-center text-gray-500">Cargando...</div>';

  const moduleToLoad = routes[baseRoute];
  const userForModule = getCurrentUser();

  if (!userForModule && baseRoute !== '/login' && baseRoute !== '/registro' && baseRoute !== '/password-reset') {
      hideGlobalLoading();
      if (!window.location.pathname.endsWith('/login.html')) {
         appContainer.innerHTML = '<p class="text-center p-8 text-gray-500">Acceso denegado. Redirigiendo...</p>';
      }
      return;
  }

  if (moduleToLoad) {
    if (typeof moduleToLoad.mount !== 'function') {
      if (typeof moduleToLoad.default === 'function') {
        await moduleToLoad.default(appContainer, supabase, userForModule);
        currentModuleUnmount = null;
      } else {
        appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error: El módulo para "${baseRoute}" no tiene función mount.</p>`;
      }
      hideGlobalLoading();
      return;
    }
    try {
      let hotelIdForModule = userForModule?.user_metadata?.hotel_id;
      if (!hotelIdForModule && userForModule?.id) {
          try {
              const { data: perfil } = await supabase.from('usuarios').select('hotel_id').eq('id', userForModule.id).single();
              hotelIdForModule = perfil?.hotel_id;
          } catch (err) {
              console.warn("No se pudo obtener hotelId para el módulo:", baseRoute, err);
          }
      }
      await moduleToLoad.mount(appContainer, supabase, userForModule, hotelIdForModule);
      currentModuleUnmount = moduleToLoad.unmount || null;
    } catch (error) {
      console.error(`Error al montar módulo para "${baseRoute}":`, error);
      if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error al cargar: ${error.message}</p>`;
    }
  } else {
    if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-8 text-center text-xl">404 - Página no encontrada (${baseRoute})</p>`;
  }
  hideGlobalLoading();
  updateActiveNavLink(baseRoute);
}

function updateActiveNavLink(currentPath) {
    if (!mainNav) return;
    mainNav.querySelectorAll('a.nav-link-dynamic').forEach(link => {
        const linkPath = new URL(link.href, window.location.origin).hash.slice(1).split('?')[0];
        if (linkPath === currentPath) {
            link.classList.add('active', 'bg-indigo-700', 'text-white');
            link.classList.remove('hover:bg-gray-700');
        } else {
            link.classList.remove('active', 'bg-indigo-700', 'text-white');
            link.classList.add('hover:bg-gray-700');
        }
    });
}

async function initializeApp() {
  appContainer = document.getElementById('app-container');
  mainNav = document.getElementById('main-nav');
  userInfoNav = document.getElementById('user-info-nav');
  notificacionesCampanitaContainer = document.getElementById('notificaciones-campanita-container');

  if (!appContainer || !mainNav) {
      console.error("initializeApp: Faltan elementos HTML esenciales (app-container o main-nav).");
      return;
  }
  
  showGlobalLoading("Inicializando aplicación...");

  onAuthStateChange(async (userObject, session) => {
    const appUser = getCurrentUser();
    updateUserInfo(appUser);
    renderNavigation(appUser);

    if (appUser) {
      if (notificacionesCampanitaContainer && !campanitaInicializada) {
        await inicializarCampanitaGlobal(notificacionesCampanitaContainer, supabase);
        campanitaInicializada = true;
      }
      
      if (window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/index.html#/dashboard';
      } else {
        if (window.location.hash === '' || window.location.hash === '#/' || window.location.hash === '#/login') {
            window.location.hash = '#/dashboard';
        } else {
            await router();
        }
      }
    } else {
      if (campanitaInicializada) {
        desmontarCampanitaGlobal(supabase);
        if (notificacionesCampanitaContainer) notificacionesCampanitaContainer.innerHTML = '';
        campanitaInicializada = false;
      }
      
      if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
      } else {
        if (appContainer) appContainer.innerHTML = '';
      }
    }
    hideGlobalLoading();
  });

  window.addEventListener('hashchange', router);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('app-container') || !document.getElementById('main-nav')) {
      console.error("Faltan elementos HTML esenciales (app-container o main-nav) en DOMContentLoaded. La aplicación no puede iniciarse.");
      return;
  }
  initializeApp().catch(error => {
    console.error("Error fatal durante la inicialización de la aplicación:", error);
    const appContainerError = document.getElementById('app-container');
    if (appContainerError) {
        appContainerError.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error crítico al iniciar la aplicación.</p>`;
    }
    hideGlobalLoading();
  });
});
