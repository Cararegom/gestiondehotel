// js/main.js
import { supabase } from './supabaseClient.js';
import { getCurrentUser, requireAuth, handleLogout, onAuthStateChange } from './authService.js';
import { showAppFeedback, clearAppFeedback, showGlobalLoading, hideGlobalLoading } from './uiUtils.js';
import { APP_CONFIG } from './config.js';

import * as Dashboard from './modules/dashboard/dashboard.js';
import * as Reservas from './modules/reservas/reservas.js';
import * as Habitaciones from './modules/habitaciones/habitaciones.js';
import * as Caja from './modules/caja/caja.js'; // Asumo que este es tu módulo de turnos
import * as Servicios from './modules/servicios/servicios.js';
import * as Tienda from './modules/tienda/tienda.js';
import *as Restaurante from './modules/restaurante/restaurante.js';
import * as Usuarios from './modules/usuarios/usuarios.js';
import * as Configuracion from './modules/configuracion/configuracion.js';
import * as Reportes from './modules/reportes/reportes.js';
import * as Limpieza from './modules/limpieza/limpieza.js';
import * as Integraciones from './modules/integraciones/integraciones.js';
import * as MapaHabitaciones from './modules/mapa-habitaciones/mapa-habitaciones.js';
import * as NotificacionesPage from './modules/notificaciones/notificaciones.js';
import * as Mantenimiento from './modules/mantenimiento/mantenimiento.js';
import * as Bitacora from './modules/bitacora/bitacora.js';

import { inicializarCampanitaGlobal, desmontarCampanitaGlobal } from './modules/notificaciones/notificaciones.js';

let currentModuleUnmount = null;
let appContainer = null;
let mainNav = null;
let userInfoNav = null;
let notificacionesCampanitaContainer = null;
let campanitaInicializada = false;
let currentPathLoaded = null; // NUEVO: Para rastrear la ruta actual

const routes = {
  '/dashboard': Dashboard,
  '/reservas': Reservas,
  '/habitaciones': Habitaciones,
  '/mapa-habitaciones': MapaHabitaciones,
  '/caja': Caja, // Este es tu módulo de turnos
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
  '/bitacora': Bitacora
};

const navLinksConfig = [
    { path: '#/dashboard', text: 'Dashboard', icon: '📊' },
    { path: '#/reservas', text: 'Reservas', icon: '📅' },
    { path: '#/mapa-habitaciones', text: 'Mapa Hotel', icon: '🗺️' },
    { path: '#/habitaciones', text: 'Habitaciones', icon: '🚪' },
    { path: '#/caja', text: 'Caja/Turnos', icon: '💰' }, // Nombre actualizado para claridad
    { path: '#/servicios', text: 'Servicios', icon: '🛎️' },
    { path: '#/tienda', text: 'Tienda', icon: '🛍️' },
    { path: '#/restaurante', text: 'Restaurante', icon: '🍽️' },
    { path: '#/limpieza', text: 'Limpieza', icon: '🧹' },
    { path: '#/reportes', text: 'Reportes', icon: '📈' },
    { path: '#/mantenimiento', text: 'Mantenimiento', icon: '🛠️' },
    { path: '#/bitacora', text: 'Bitácora', icon: '📓' },
    { path: '#/usuarios', text: 'Usuarios', icon: '👥' },
    { path: '#/configuracion', text: 'Configuración', icon: '⚙️' },
    { path: '#/integraciones', text: 'Integraciones', icon: '🔗' },
    { path: '#/notificaciones', text: 'Ver Notificaciones', icon: '📜' },
];

function renderNavigation(user) {
    if (!mainNav) return;
    // Limpiar solo los links dinámicos, no todo el innerHTML del nav
    const dynamicLinksContainer = mainNav.querySelector('#dynamic-nav-links'); // Asumir un contenedor
    if (!dynamicLinksContainer) {
        console.warn("Contenedor #dynamic-nav-links no encontrado en mainNav para renderNavigation");
        // Fallback: limpiar todo si no existe el contenedor específico (menos ideal)
        const existingDynamicLinks = mainNav.querySelectorAll('a.nav-link-dynamic');
        existingDynamicLinks.forEach(link => link.remove());
    } else {
        dynamicLinksContainer.innerHTML = ''; // Limpiar solo el contenedor de links dinámicos
    }

    if (user) {
        navLinksConfig.forEach(linkConfig => {
            const a = document.createElement('a');
            a.href = linkConfig.path;
            a.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';
            a.innerHTML = `<span class="mr-2 text-lg">${linkConfig.icon}</span> ${linkConfig.text}`;
            if (dynamicLinksContainer) {
                dynamicLinksContainer.appendChild(a);
            } else {
                mainNav.appendChild(a); // Fallback
            }
        });
    }
}

function updateUserInfo(user) {
  if (!userInfoNav) return;
  if (user) {
    const userEmail = user.email;
    // Obtener rol del perfil del usuario si está en user_metadata o app_metadata
    const userRol = user.app_metadata?.rol || user.user_metadata?.rol || 'Usuario'; 
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
      // Remover listener anterior para evitar duplicados si updateUserInfo se llama varias veces
      logoutButton.replaceWith(logoutButton.cloneNode(true)); 
      userInfoNav.querySelector('#logout-button').addEventListener('click', async () => {
        showGlobalLoading("Cerrando sesión...");
        await handleLogout(supabase);
        // onAuthStateChange se encargará de redirigir
        hideGlobalLoading();
      });
    }
  } else {
    userInfoNav.innerHTML = '';
  }
}

async function router() {
  if (!appContainer) {
    console.error("Router: appContainer no está definido.");
    document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Falta #app-container.</p>";
    return;
  }

  const path = window.location.hash.slice(1) || '/dashboard';
  const baseRoute = path.split('?')[0];

  // NUEVO: Evitar recargar el mismo módulo si la ruta no ha cambiado
  if (currentPathLoaded === baseRoute && appContainer.innerHTML !== '' && !appContainer.innerHTML.includes('Cargando...')) {
      console.log(`[Router] Ruta ${baseRoute} ya cargada. Omitiendo re-montaje.`);
      hideGlobalLoading(); // Asegurar que el loading se oculte si se omitió el montaje
      updateActiveNavLink(baseRoute); // Asegurar que el link activo se actualice
      return;
  }
  
  console.log(`[Router] Navegando a: ${baseRoute}. Módulo anterior: ${currentPathLoaded}`);
  showGlobalLoading(`Cargando ${baseRoute}...`);

  if (typeof currentModuleUnmount === 'function') {
    try {
      console.log(`[Router] Desmontando módulo para: ${currentPathLoaded}`);
      currentModuleUnmount(appContainer);
    } catch (e) {
      console.error("[Router] Error al desmontar el módulo anterior:", currentPathLoaded, e);
    }
  }
  currentModuleUnmount = null;
  appContainer.innerHTML = '<div class="p-8 text-center text-gray-500">Cargando vista...</div>'; // Mensaje de carga

  const moduleToLoad = routes[baseRoute];
  const userForModule = getCurrentUser();

  if (!userForModule && baseRoute !== '/login' && baseRoute !== '/registro' && baseRoute !== '/password-reset') {
      console.log("[Router] Usuario no autenticado. Redirigiendo a login.");
      hideGlobalLoading();
      // No limpiar appContainer aquí, onAuthStateChange lo hará o redirigirá
      // Si login.html es una página separada, la redirección en onAuthStateChange es suficiente.
      // Si es parte de la SPA, el router debería manejar una ruta #/login
      if (!window.location.pathname.endsWith('/login.html')) {
          window.location.href = '/login.html'; // Redirigir si no estamos en login.html
      }
      return;
  }

  if (moduleToLoad) {
    if (typeof moduleToLoad.mount !== 'function') {
      // Para módulos que podrían no tener un export 'mount' estándar (ej. funciones simples)
      // Esto es un fallback, idealmente todos los módulos de página tendrían mount/unmount
      if (typeof moduleToLoad.default === 'function') {
        console.warn(`[Router] Módulo para "${baseRoute}" no tiene función mount, usando default.`);
        await moduleToLoad.default(appContainer, supabase, userForModule);
        currentModuleUnmount = null; // No hay unmount definido
      } else {
        console.error(`[Router] El módulo para "${baseRoute}" no es una función ni tiene mount.`);
        appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error: Módulo para "${baseRoute}" inválido.</p>`;
      }
    } else {
      try {
        let hotelIdForModule = userForModule?.user_metadata?.hotel_id || userForModule?.app_metadata?.hotel_id; // Checar ambos metadatos
        if (!hotelIdForModule && userForModule?.id) {
            try {
                const { data: perfil } = await supabase.from('usuarios').select('hotel_id').eq('id', userForModule.id).single();
                hotelIdForModule = perfil?.hotel_id;
            } catch (err) {
                console.warn("[Router] No se pudo obtener hotelId del perfil para el módulo:", baseRoute, err);
            }
        }
        
        if (!hotelIdForModule && baseRoute !== '/dashboard') { // Asumiendo que dashboard puede funcionar sin hotelId o lo maneja internamente
            console.warn(`[Router] Hotel ID no disponible para el módulo ${baseRoute}. El módulo podría no funcionar correctamente.`);
            // Podrías mostrar un error o permitir que el módulo lo maneje
        }

        console.log(`[Router] Montando módulo para: ${baseRoute}`);
        await moduleToLoad.mount(appContainer, supabase, userForModule, hotelIdForModule);
        currentModuleUnmount = moduleToLoad.unmount || null;
        currentPathLoaded = baseRoute; // NUEVO: Marcar la ruta como cargada
      } catch (error) {
        console.error(`[Router] Error al montar módulo para "${baseRoute}":`, error);
        if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error al cargar módulo: ${error.message}</p>`;
        currentPathLoaded = null; // Resetear si falló el montaje
      }
    }
  } else {
    if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-8 text-center text-xl">404 - Página no encontrada (${baseRoute})</p>`;
    currentPathLoaded = null; // Resetear si la ruta no existe
  }
  hideGlobalLoading();
  updateActiveNavLink(baseRoute);
}

function updateActiveNavLink(currentPath) {
    if (!mainNav) return;
    const dynamicLinksContainer = mainNav.querySelector('#dynamic-nav-links') || mainNav;
    dynamicLinksContainer.querySelectorAll('a.nav-link-dynamic').forEach(link => {
        // Obtener la ruta base del href del link (ej. #/dashboard de http://.../#/dashboard?query=1)
        const linkHash = link.hash; // Esto da #/dashboard?query=1
        const linkBasePath = linkHash ? linkHash.slice(1).split('?')[0] : ''; // Esto da /dashboard

        if (linkBasePath === currentPath) {
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
  mainNav = document.getElementById('main-nav'); // Asegúrate que en tu HTML haya un div con id="dynamic-nav-links" dentro de mainNav
  userInfoNav = document.getElementById('user-info-nav');
  notificacionesCampanitaContainer = document.getElementById('notificaciones-campanita-container');

  if (!appContainer || !mainNav) {
      console.error("initializeApp: Faltan elementos HTML esenciales (app-container o main-nav).");
      document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Faltan elementos base de la aplicación.</p>";
      return;
  }
  if (!mainNav.querySelector('#dynamic-nav-links')) {
      console.warn("Contenedor #dynamic-nav-links no encontrado dentro de #main-nav. Los links de navegación podrían no renderizarse correctamente.");
      // Podrías crearlo dinámicamente si prefieres:
      // const dynamicLinksDiv = document.createElement('div');
      // dynamicLinksDiv.id = 'dynamic-nav-links';
      // mainNav.appendChild(dynamicLinksDiv); // O insertarlo en una posición específica
  }
  
  showGlobalLoading("Inicializando aplicación...");

  onAuthStateChange(async (event, session) => { // MODIFICADO: onAuthStateChange puede pasar event y session
    const appUser = getCurrentUser(); // Obtener el usuario actual
    console.log("[Auth] Estado cambiado:", event, "Usuario actual:", appUser ? appUser.email : "Ninguno");

    updateUserInfo(appUser);
    renderNavigation(appUser); // Renderizar navegación basada en si hay usuario

    if (appUser) {
      if (notificacionesCampanitaContainer && !campanitaInicializada) {
        // Solo inicializar campanita si hay un usuario y no ha sido inicializada.
        await inicializarCampanitaGlobal(notificacionesCampanitaContainer, supabase, appUser); // Pasar usuario a la campanita
        campanitaInicializada = true;
      }
      
      const currentHash = window.location.hash.slice(1) || '/dashboard';
      if (window.location.pathname.endsWith('/login.html')) {
        console.log("[Auth] Usuario autenticado en login.html, redirigiendo a #/dashboard.");
        window.location.href = `/index.html#/dashboard`; // Asumiendo que index.html es tu app principal
      } else if (currentPathLoaded !== currentHash || appContainer.innerHTML === '' || appContainer.innerHTML.includes('Cargando...')) {
        // Si estamos en la app principal, y la ruta actual no es la que ya está cargada, o si el appContainer está vacío.
        console.log(`[Auth] Usuario autenticado. Ruta actual: ${currentHash}. Cargando módulo...`);
        await router(); // El router decidirá si la ruta es válida y montará el módulo
      } else {
        console.log(`[Auth] Usuario autenticado. Ruta ${currentHash} ya cargada. No se llama a router.`);
        hideGlobalLoading();
      }
    } else { // No hay usuario (logout o sesión expirada)
      if (campanitaInicializada) {
        desmontarCampanitaGlobal(supabase); // Asumiendo que desmontarCampanitaGlobal puede necesitar supabase
        if (notificacionesCampanitaContainer) notificacionesCampanitaContainer.innerHTML = '';
        campanitaInicializada = false;
      }
      currentPathLoaded = null; // Resetear ruta cargada
      if (!window.location.pathname.endsWith('/login.html')) {
        console.log("[Auth] Usuario no autenticado. Redirigiendo a login.html.");
        window.location.href = '/login.html';
      } else {
        // Si ya estamos en login.html, no hacer nada o limpiar el appContainer si es parte de una SPA que muestra login en #app-container
        if (appContainer && routes[window.location.hash.slice(1)]) appContainer.innerHTML = ''; // Limpiar si era una ruta de app
        console.log("[Auth] Usuario no autenticado. Ya en login.html.");
        hideGlobalLoading();
      }
    }
  });

  // Llamada inicial al router después de configurar el listener de authStateChange
  // onAuthStateChange se encargará de la primera llamada a router() cuando el estado de auth se resuelva.
  // No necesitamos una llamada explícita a router() aquí si onAuthStateChange lo maneja todo.
  // Sin embargo, para el primer hash (si ya existe y el usuario ya está logueado),
  // el authStateChange podría no ser suficiente si no cambia el estado.
  // Una solución más robusta es que onAuthStateChange siempre llame a router si hay usuario
  // y el router decida si recargar o no.
  
  // Asegurar que el router se ejecute al menos una vez si hay un hash inicial
  // y el estado de autenticación no cambia inmediatamente.
  // Esta llamada es ahora manejada por la lógica dentro de onAuthStateChange.
  
  window.addEventListener('hashchange', () => {
      console.log("[Router] Evento hashchange detectado. Nuevo hash:", window.location.hash);
      router(); // Llamar al router en cada cambio de hash
  });

  // No es necesario llamar a hideGlobalLoading() aquí, onAuthStateChange lo hará.
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('app-container') || !document.getElementById('main-nav')) {
      console.error("Faltan elementos HTML esenciales (app-container o main-nav) en DOMContentLoaded. La aplicación no puede iniciarse.");
      if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Faltan elementos base de la aplicación.</p>";
      return;
  }
  initializeApp().catch(error => {
    console.error("Error fatal durante la inicialización de la aplicación:", error);
    const appContainerError = document.getElementById('app-container');
    if (appContainerError) {
        appContainerError.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error crítico al iniciar la aplicación.</p>`;
    }
    hideGlobalLoading(); // Asegurarse de ocultar el loading en caso de error fatal
  });
});