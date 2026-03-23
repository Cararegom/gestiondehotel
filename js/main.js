// js/main.js
import { supabase } from './supabaseClient.js';
import { getCurrentUser, handleLogout, onAuthStateChange } from './authService.js';
import { showAppFeedback, showGlobalLoading, hideGlobalLoading } from './uiUtils.js';
import { fetchTurnoActivo } from './services/turnoService.js';
import { escapeHtml, installLegacyTextNormalizer } from './security.js';
import { initInternalSupportChat, destroyInternalSupportChat } from './app-support-chat.js';

// Importa tus mÃ³dulos
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
import * as Descuentos from './modules/descuentos/descuentos.js';
import * as Micuenta from './modules/micuenta/micuenta.js';
import * as Clientes from './modules/clientes/clientes.js';
import * as faq from './modules/faq/faq.js';
import * as Bitacora from './modules/bitacora/bitacora.js';

import { inicializarCampanitaGlobal, desmontarCampanitaGlobal } from './modules/notificaciones/notificaciones.js';

let currentModuleUnmount = null;
let appContainer = null;
let mainNav = null;
let userInfoNav = null;
let notificacionesCampanitaContainer = null;
let campanitaInicializada = false;
let currentPathLoaded = null;
let routerBusy = false;

// InformaciÃ³n del hotel, plan activo, rol del usuario y estado de suscripciÃ³n
let currentActiveHotel = null;
let currentActivePlanDetails = null;
let currentUserRole = null;
let isSubscriptionFueraDeGracia = false;

const routes = {
  '/dashboard': { module: Dashboard, moduleKey: 'dashboard' },
  '/reservas': { module: Reservas, moduleKey: 'reservas' },
  '/habitaciones': { module: Habitaciones, moduleKey: 'habitaciones' },
  '/mapa-habitaciones': { module: MapaHabitaciones, moduleKey: 'mapa-habitaciones' },
  '/caja': { module: Caja, moduleKey: 'caja' },
  '/clientes': { module: Clientes, moduleKey: 'clientes' },
  '/servicios': { module: Servicios, moduleKey: 'servicios' },
  '/tienda': { module: Tienda, moduleKey: 'tienda' },
  '/restaurante': { module: Restaurante, moduleKey: 'restaurante' },
  '/usuarios': { module: Usuarios, moduleKey: 'usuarios' },
  '/configuracion': { module: Configuracion, moduleKey: 'configuracion' },
  '/reportes': { module: Reportes, moduleKey: 'reportes' },
  '/limpieza': { module: Limpieza, moduleKey: 'limpieza' },
  '/integraciones': { module: Integraciones, moduleKey: 'integraciones' },
  '/notificaciones': { module: NotificacionesPage, moduleKey: 'notificaciones_page' },
  '/mantenimiento': { module: Mantenimiento, moduleKey: 'mantenimiento' },
  '/descuentos': { module: Descuentos, moduleKey: 'descuentos' },
  '/micuenta': { module: Micuenta, moduleKey: 'micuenta' },
  '/faq': { module: faq, moduleKey: 'faq' },
  '/bitacora': { module: Bitacora, moduleKey: 'bitacora' }
};

const navLinksConfig = [
  { path: '#/dashboard', text: 'Dashboard', icon: '\u{1F4CA}', moduleKey: 'dashboard' },
  { path: '#/reservas', text: 'Reservas', icon: '\u{1F4C5}', moduleKey: 'reservas' },
  { path: '#/mapa-habitaciones', text: 'Mapa Hotel', icon: '\u{1F5FA}\uFE0F', moduleKey: 'mapa-habitaciones' },
  { path: '#/habitaciones', text: 'Habitaciones', icon: '\u{1F6AA}', moduleKey: 'habitaciones' },
  { path: '#/caja', text: 'Caja/Turnos', icon: '\u{1F4B0}', moduleKey: 'caja' },
  { path: '#/clientes', text: 'Clientes', icon: '\u{1F9D1}\u200D\u{1F4BC}', moduleKey: 'clientes' },
  { path: '#/servicios', text: 'Servicios', icon: '\u{1F6CE}\uFE0F', moduleKey: 'servicios' },
  { path: '#/tienda', text: 'Tienda', icon: '\u{1F6CD}\uFE0F', moduleKey: 'tienda' },
  { path: '#/restaurante', text: 'Restaurante', icon: '\u{1F37D}\uFE0F', moduleKey: 'restaurante' },
  { path: '#/limpieza', text: 'Limpieza', icon: '\u{1F9F9}', moduleKey: 'limpieza' },
  { path: '#/reportes', text: 'Reportes', icon: '\u{1F4C8}', moduleKey: 'reportes' },
  { path: '#/mantenimiento', text: 'Mantenimiento', icon: '\u{1F6E0}\uFE0F', moduleKey: 'mantenimiento' },
  { path: '#/descuentos', text: 'Descuentos', icon: '\u{1F3F7}\uFE0F', moduleKey: 'descuentos' },
  { path: '#/usuarios', text: 'Usuarios', icon: '\u{1F465}', moduleKey: 'usuarios' },
  { path: '#/configuracion', text: 'Configuraci\u00F3n', icon: '\u2699\uFE0F', moduleKey: 'configuracion' },
  { path: '#/integraciones', text: 'Integraciones', icon: '\u{1F517}', moduleKey: 'integraciones' },
  { path: '#/notificaciones', text: 'Ver Notificaciones', icon: '\u{1F4DC}', moduleKey: 'notificaciones_page' },
  { path: '#/bitacora?scope=soporte-global', text: 'Incidencias SaaS', icon: '\u{1F6DF}\uFE0F', moduleKey: 'bitacora', superadminOnly: true },
  { path: '#/micuenta', text: 'Mi cuenta', icon: '\u{1F6E1}\uFE0F', moduleKey: 'micuenta' },
  { path: '#/faq', text: 'FAQ', icon: '\u2753', moduleKey: 'faq' }
];

function buildNavLinkElement(linkConfig) {
  const link = document.createElement('a');
  link.href = linkConfig.path;
  link.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';

  const icon = document.createElement('span');
  icon.className = 'mr-2 text-lg';
  icon.textContent = linkConfig.icon;

  link.appendChild(icon);
  link.appendChild(document.createTextNode(linkConfig.text));
  return link;
}

function calculateSubscriptionExpiredStatus(hotel) {
  if (!hotel || !hotel.estado_suscripcion || (!hotel.suscripcion_fin && !hotel.trial_fin)) {
    return false;
  }
  const fechaFinSusc = new Date(hotel.suscripcion_fin || hotel.trial_fin);
  const fechaFinMasGracia = new Date(fechaFinSusc);
  fechaFinMasGracia.setDate(fechaFinSusc.getDate() + 2);
  return (new Date() > fechaFinMasGracia) && hotel.estado_suscripcion === 'vencido';
}

async function loadHotelAndPlanDetails(hotelId, supabaseInstance) {
  if (!hotelId) {
    console.warn("loadHotelAndPlanDetails: hotelId no proporcionado. Usando plan restringido.");
    currentActiveHotel = null;
    currentActivePlanDetails = { nombre: "Invitado", funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['micuenta'] } };
    return;
  }
  try {
    const { data: hotelData, error: hotelError } = await supabaseInstance
      .from('hoteles')
      .select('id, nombre, plan, estado_suscripcion, suscripcion_fin, trial_fin, creado_por')
      .eq('id', hotelId)
      .single();

    if (hotelError) throw hotelError;
    if (!hotelData) throw new Error(`Hotel con ID ${hotelId} no encontrado.`);
    currentActiveHotel = hotelData;

    if (!currentActiveHotel.plan) {
      console.warn(`Hotel ${currentActiveHotel.id} no tiene un plan ('hoteles.plan') asignado. Usando plan por defecto restringido.`);
      currentActivePlanDetails = {
        nombre: "SinPlanAsignado",
        funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['dashboard', 'micuenta'] }
      };
      return;
    }
    console.log("[DEBUG Plan] Buscando plan con nombre:", currentActiveHotel.plan);
    const { data: planData, error: planError } = await supabaseInstance
      .from('planes')
      .select('nombre, funcionalidades')
      .eq('nombre', currentActiveHotel.plan)
      .single();

    if (planError) throw planError;
    if (!planData) throw new Error(`Detalles del plan '${currentActiveHotel.plan}' no encontrados en tabla 'planes'.`);

    currentActivePlanDetails = planData;
    console.log(`[PlanManager] Detalles del plan activo '${currentActivePlanDetails.nombre}' cargados:`, currentActivePlanDetails.funcionalidades);

  } catch (error) {
    console.error("Error crÃ­tico cargando detalles del hotel y/o plan:", error.message);
    currentActiveHotel = null;
    currentActivePlanDetails = {
      nombre: "ErrorCargaPlan",
      funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['dashboard', 'micuenta'] }
    };
  }
}

// REEMPLAZA ESTA FUNCIÃ“N COMPLETA en tu archivo js/main.js

function renderNavigation(user) {
  if (!mainNav) return;
  const dynamicLinksContainer = mainNav.querySelector('#dynamic-nav-links');

  if (dynamicLinksContainer) {
    dynamicLinksContainer.innerHTML = '';
  } else {
    const existingDynamicLinks = mainNav.querySelectorAll('a.nav-link-dynamic');
    existingDynamicLinks.forEach(link => link.remove());
  }

  if (!user) return;

  let esAdminNavegacion = false;
  if (currentActiveHotel && user && currentUserRole) {
    esAdminNavegacion = (currentUserRole === 'admin' || currentUserRole === 'superadmin' || user.id === currentActiveHotel.creado_por);
  }

  if (isSubscriptionFueraDeGracia && esAdminNavegacion) {
    // LÃ³gica para suscripciÃ³n vencida (sin cambios)
    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.moduleKey === 'micuenta') {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
  } else if (currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {
    const modulosPermitidos = currentActivePlanDetails.funcionalidades.modulos_permitidos;

    // â–¼â–¼â–¼ INICIO DE LA CORRECCIÃ“N â–¼â–¼â–¼
    // Se aÃ±ade la misma lista de mÃ³dulos exentos que en el router.
    const modulosExentos = ['micuenta', 'faq', 'bitacora'];

    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.adminOnly && !esAdminNavegacion) {
        return;
      }
      if (linkConfig.superadminOnly && currentUserRole !== 'superadmin') {
        return;
      }
      // Un enlace se muestra si su 'moduleKey' estÃ¡ en la lista de permitidos O en la lista de exentos.
      if (modulosPermitidos.includes(linkConfig.moduleKey) || modulosExentos.includes(linkConfig.moduleKey)) {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
    // â–²â–²â–² FIN DE LA CORRECCIÃ“N â–²â–²â–²
  } else {
    // LÃ³gica de fallback (sin cambios)
    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.moduleKey === 'micuenta' || linkConfig.moduleKey === 'dashboard') {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
    console.warn("RenderNavigation: Detalles del plan no disponibles o incompletos, mostrando navegaciÃ³n esencial.");
  }
}
function updateUserInfo(user) {
  if (!userInfoNav) return;
  if (user) {
    const userEmail = user.email || '';
    const displayRol = currentUserRole
      ? (currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1))
      : (user.app_metadata?.rol || user.user_metadata?.rol || 'Usuario');
    /* Legacy template removed during security hardening.
      <div class="user-profile text-sm p-2 border-t border-gray-700 mt-auto">
        <span class="user-email block font-medium text-white truncate" title="${userEmail}">${userEmail}</span>
        <span class="user-role block text-xs text-gray-400">${displayRol}</span>
      </div>
      <button id="logout-button" class="button button-danger w-full text-left p-2 hover:bg-red-700 rounded flex items-center text-sm mt-2">
        <span class="mr-2 text-lg">ðŸšª</span> Cerrar SesiÃ³n
      </button>
    */
    userInfoNav.innerHTML = '';

    const profile = document.createElement('div');
    profile.className = 'user-profile text-sm p-2 border-t border-gray-700 mt-auto';

    const emailSpan = document.createElement('span');
    emailSpan.className = 'user-email block font-medium text-white truncate';
    emailSpan.title = userEmail || '';
    emailSpan.textContent = userEmail || 'Usuario';

    const roleSpan = document.createElement('span');
    roleSpan.className = 'user-role block text-xs text-gray-400';
    roleSpan.textContent = displayRol;

    const logoutButtonEl = document.createElement('button');
    logoutButtonEl.id = 'logout-button';
    logoutButtonEl.className = 'button button-danger w-full text-left p-2 hover:bg-red-700 rounded flex items-center text-sm mt-2';

    const iconSpan = document.createElement('span');
    iconSpan.className = 'mr-2 text-lg';
    iconSpan.textContent = '\u{1F6AA}';

    logoutButtonEl.appendChild(iconSpan);
    logoutButtonEl.appendChild(document.createTextNode('Cerrar sesi\u00F3n'));

    profile.appendChild(emailSpan);
    profile.appendChild(roleSpan);
    userInfoNav.appendChild(profile);
    userInfoNav.appendChild(logoutButtonEl);

    const logoutButton = userInfoNav.querySelector('#logout-button');
    if (logoutButton) {
      logoutButton.replaceWith(logoutButton.cloneNode(true));
      userInfoNav.querySelector('#logout-button').addEventListener('click', async () => {
        showGlobalLoading("Verificando caja...");
        const user = getCurrentUser();
        let hotelId = user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id;
        if (!hotelId && user?.id) {
          const { data: perfil } = await supabase.from('usuarios').select('hotel_id').eq('id', user.id).single();
          hotelId = perfil?.hotel_id;
        }

        let hayCajaAbierta = false;
        try {
          const { data: turnosAbiertos } = await supabase
            .from('turnos')
            .select('id')
            .eq('usuario_id', user.id)
            .eq('hotel_id', hotelId)
            .is('fecha_cierre', null);

          hayCajaAbierta = turnosAbiertos && turnosAbiertos.length > 0;
        } catch (err) {
          console.error("Error verificando caja abierta:", err);
          showAppFeedback("No se pudo verificar si tienes caja abierta. Intenta de nuevo.", "error");
          hideGlobalLoading();
          return;
        }

        if (hayCajaAbierta) {
          hideGlobalLoading();
          const confirm = await Swal.fire({
            icon: 'warning',
            title: '\u00A1Caja abierta!',
            text: 'Tienes una caja (turno) abierta sin cerrar. Si sales, la caja quedar\u00E1 abierta. \u00BFSeguro que quieres cerrar sesi\u00F3n?',
            showCancelButton: true,
            confirmButtonText: 'S\u00ED, cerrar sesi\u00F3n',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#d33',
          });
          if (!confirm.isConfirmed) {
            return;
          }
        }

        showGlobalLoading("Cerrando sesi\u00F3n...");
        await handleLogout(supabase);
        hideGlobalLoading();
      });
    }
  } else {
    userInfoNav.innerHTML = '';
  }
}

async function router() {
  // --- FRENO DE SEGURIDAD AÃ‘ADIDO ---
  if (document.getElementById('reset-password-form')) {
    console.log('[Router] Detenido: El formulario de reseteo de contraseÃ±a estÃ¡ activo.');
    hideGlobalLoading();
    return;
  }
  // --- FIN DEL FRENO DE SEGURIDAD ---

  if (routerBusy) {
    console.warn('[Router] Ya estoy montando, ignoro esta llamada.');
    return;
  }
  routerBusy = true;
  try {
    if (!appContainer) {
      console.error("Router: appContainer no estÃ¡ definido.");
      if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crÃ­tico: Falta #app-container.</p>";
      routerBusy = false;
      return;
    }

    const path = window.location.hash.slice(1) || '/dashboard';
    const baseRoute = path.split('?')[0];
    const routeEntry = routes[baseRoute];
    const moduleKeyFromRoute = routeEntry?.moduleKey;

    if (currentPathLoaded === baseRoute && appContainer.innerHTML !== '' && !appContainer.innerHTML.includes('Cargando vista...')) {
      console.log(`[Router] Ruta ${baseRoute} ya cargada. Omitiendo re-montaje.`);
      hideGlobalLoading();
      updateActiveNavLink(baseRoute);
      routerBusy = false;
      return;
    }

    console.log(`[Router] Navegando a: ${baseRoute}. MÃ³dulo anterior: ${currentPathLoaded}`);
    showGlobalLoading(`Cargando ${baseRoute}...`);

    if (typeof currentModuleUnmount === 'function') {
      try {
        console.log(`[Router] Desmontando mÃ³dulo para: ${currentPathLoaded}`);
        currentModuleUnmount(appContainer);
      } catch (e) {
        console.error("[Router] Error al desmontar el mÃ³dulo anterior:", currentPathLoaded, e);
      }
    }
    currentModuleUnmount = null;
    appContainer.innerHTML = '<div class="p-8 text-center text-gray-500">Cargando vista...</div>';

    const userForModule = getCurrentUser();

    if (!userForModule && baseRoute !== '/login') {
      console.log("[Router] Usuario no autenticado. Redirigiendo a login.html.");
      hideGlobalLoading();
      if (!window.location.pathname.endsWith('/login.html')) {
        window.location.href = '/login.html';
      }
      routerBusy = false;
      return;
    }

    let hotelIdForModule = currentActiveHotel?.id;
    if (!hotelIdForModule && userForModule) {
      const { data: perfilUserAppRouter } = await supabase.from('usuarios').select('hotel_id').eq('id', userForModule.id).single();
      hotelIdForModule = perfilUserAppRouter?.hotel_id;
    }

    // En js/main.js, dentro de la funciÃ³n router()

    if (userForModule && currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {

      // â–¼â–¼â–¼ INICIO DE LA CORRECCIÃ“N â–¼â–¼â–¼
      // Creamos una lista de mÃ³dulos que SIEMPRE deben estar accesibles.
      const modulosExentos = ['micuenta', 'faq', 'bitacora'];

      // Verificamos si el mÃ³dulo actual estÃ¡ en la lista de exentos.
      const esModuloExento = modulosExentos.includes(moduleKeyFromRoute);

      // Si el mÃ³dulo NO es exento Y NO estÃ¡ en la lista de permitidos del plan, entonces bloqueamos.
      if (!esModuloExento && moduleKeyFromRoute && !currentActivePlanDetails.funcionalidades.modulos_permitidos.includes(moduleKeyFromRoute)) {

        console.warn(`[Router] Acceso denegado al mÃ³dulo '${moduleKeyFromRoute}' para el plan '${currentActivePlanDetails.nombre}'.`);
        appContainer.innerHTML = `<div class="p-6 md:p-8 text-center"><h2 class="text-2xl font-semibold text-red-600 mb-3">Acceso Restringido al M\u00F3dulo</h2><p class="text-gray-700 mb-1">La funcionalidad o m\u00F3dulo '<strong>${escapeHtml(moduleKeyFromRoute)}</strong>' no est\u00E1 incluida en tu plan actual (<strong>${escapeHtml(currentActivePlanDetails.nombre)}</strong>).</p><p class="text-gray-600 text-sm">Si necesitas acceder a esta secci\u00F3n, puedes mejorar tu plan.</p><div class="mt-6"><a href="#/micuenta" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg shadow transition-colors">Ir a Mi Cuenta para Ver Planes</a></div></div>`;
        hideGlobalLoading();
        routerBusy = false;
        return;
      }
      // â–²â–²â–² FIN DE LA CORRECCIÃ“N â–²â–²â–²
    }

    if (hotelIdForModule && userForModule && currentActiveHotel) {
      const usuarioId = userForModule.id;
      const esAdminRouter = (currentUserRole === 'admin' || currentUserRole === 'superadmin' || usuarioId === currentActiveHotel.creado_por);

      const routeConfig = navLinksConfig.find((linkConfig) => linkConfig.moduleKey === moduleKeyFromRoute);
      if (routeConfig?.adminOnly && !esAdminRouter) {
        appContainer.innerHTML = `<div class="p-6 md:p-8 text-center"><h2 class="text-2xl font-semibold text-red-600 mb-3">Acceso restringido</h2><p class="text-gray-700">Esta vista es solo para administradores del hotel.</p></div>`;
        hideGlobalLoading();
        routerBusy = false;
        return;
      }
      if (routeConfig?.superadminOnly && currentUserRole !== 'superadmin') {
        appContainer.innerHTML = `<div class="p-6 md:p-8 text-center"><h2 class="text-2xl font-semibold text-red-600 mb-3">Acceso restringido</h2><p class="text-gray-700">Esta vista es solo para mantenimiento SaaS o superadministradores.</p></div>`;
        hideGlobalLoading();
        routerBusy = false;
        return;
      }

      if (isSubscriptionFueraDeGracia) {
        if (esAdminRouter) {
          if (baseRoute !== '/micuenta') {
            showAppFeedback('Tu suscripciÃ³n ha vencido. Solo puedes acceder a "Mi Cuenta" para renovar tu plan.', 'warning', true, 6000);
            window.location.hash = '#/micuenta';
            return;
          }
        } else {
          document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;background-color:#f3f4f6;"><h2 style="color:#be123c;font-size:1.8rem;margin-bottom:1rem;">SuscripciÃ³n Vencida</h2><p style="font-size:1.1rem;color:#374151;">La suscripciÃ³n del hotel ha expirado.<br>ComunÃ­cate con el administrador para renovar el acceso.</p></div>`;
          hideGlobalLoading();
          routerBusy = false;
          return;
        }
      }
    }

    const moduleDefinition = routeEntry?.module;

    if (moduleDefinition) {
      if (typeof moduleDefinition.mount !== 'function') {
        if (typeof moduleDefinition.default === 'function') {
          await moduleDefinition.default(appContainer, supabase, userForModule, hotelIdForModule);
          currentModuleUnmount = null;
        } else {
          if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error: M\u00F3dulo para "${escapeHtml(baseRoute)}" inv\u00E1lido.</p>`;
        }
      } else {
        try {
          console.log(`[Router] Montando mÃ³dulo para: ${baseRoute}`);
          console.log("DEBUG main.js: Valor de 'supabase' antes de pasarlo al mÃ³dulo:", supabase);
          await moduleDefinition.mount(appContainer, supabase, userForModule, hotelIdForModule, currentActivePlanDetails);
          currentModuleUnmount = moduleDefinition.unmount || null;
          currentPathLoaded = baseRoute;
        } catch (error) {
          if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error al cargar m\u00F3dulo: ${escapeHtml(error?.message || 'Error desconocido')}</p>`;
          currentPathLoaded = null;
        }
      }
    } else {
      if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-8 text-center text-xl">404 - P\u00E1gina no encontrada (${escapeHtml(baseRoute)})</p>`;
      currentPathLoaded = null;
    }

    hideGlobalLoading();
    updateActiveNavLink(baseRoute);

  } finally {
    routerBusy = false;
  }
}

function updateActiveNavLink(currentPath) {
  if (!mainNav) return;
  const dynamicLinksContainer = mainNav.querySelector('#dynamic-nav-links') || mainNav;
  dynamicLinksContainer.querySelectorAll('a.nav-link-dynamic').forEach(link => {
    const linkHash = link.hash;
    const linkBasePath = linkHash ? linkHash.slice(1).split('?')[0] : '';

    if (linkBasePath === currentPath) {
      link.classList.add('active', 'bg-indigo-700', 'text-white');
      link.classList.remove('hover:bg-gray-700');
    } else {
      link.classList.remove('active', 'bg-indigo-700', 'text-white');
      link.classList.add('hover:bg-gray-700');
    }
  });
}

// REEMPLAZA TU FUNCIÃ“N initializeApp COMPLETA CON ESTA VERSIÃ“N

// ASEGÃšRATE DE QUE ESTA FUNCIÃ“N ESTÃ ASÃ EN TU main.js

async function initializeApp() {
  appContainer = document.getElementById('app-container');
  mainNav = document.getElementById('main-nav');
  userInfoNav = document.getElementById('user-info-nav');
  notificacionesCampanitaContainer = document.getElementById('notificaciones-campanita-container');

  if (!appContainer || !mainNav) {
    console.error("initializeApp: Faltan elementos HTML esenciales (app-container o main-nav). La aplicaciÃ³n no puede continuar.");
    if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crÃ­tico: Faltan elementos base de la aplicaciÃ³n. Revise los IDs #app-container y #main-nav en su HTML.</p>";
    return;
  }

  if (mainNav && !mainNav.querySelector('#dynamic-nav-links')) {
    const dynamicLinksDiv = document.createElement('div');
    dynamicLinksDiv.id = 'dynamic-nav-links';
    mainNav.appendChild(dynamicLinksDiv);
  }

  showGlobalLoading("Inicializando aplicaciÃ³n...");

  onAuthStateChange(async (event, session) => {
    const appUser = session?.user;
    console.log("[Auth] Estado cambiado. Evento:", event, "Usuario actual:", appUser ? appUser.email : "Ninguno");

    if (session && session.user && session.user.aud === 'authenticated' && session.expires_in === 3600) {
      const urlParams = new URLSearchParams(window.location.hash.substring(1));
      const type = urlParams.get('type');

      if (type === 'recovery') {
        console.log('âœ…âœ…âœ… Evento de recuperaciÃ³n de contraseÃ±a detectado por URL. Mostrando formulario.');
        hideGlobalLoading();
        mostrarFormularioNuevaContrasena();
        return;
      }
    }

    if (appUser) {
      let hotelIdToLoad = appUser.user_metadata?.hotel_id || appUser.app_metadata?.hotel_id;

      const { data: perfil, error: perfilError } = await supabase
        .from('usuarios')
        .select('hotel_id, rol')
        .eq('id', appUser.id)
        .single();

      if (perfilError) {
        console.error("onAuthStateChange: Error obteniendo perfil (hotel_id, rol):", perfilError.message);
        currentUserRole = "Usuario";
      } else if (perfil) {
        if (!hotelIdToLoad) hotelIdToLoad = perfil.hotel_id;
        currentUserRole = perfil.rol || "Usuario";
      } else {
        console.warn("onAuthStateChange: No se encontrÃ³ perfil de usuario en la tabla 'usuarios'.");
        currentUserRole = "Usuario";
      }

      updateUserInfo(appUser);

      if (hotelIdToLoad) {
        await loadHotelAndPlanDetails(hotelIdToLoad, supabase);
        if (currentActiveHotel) {
          isSubscriptionFueraDeGracia = calculateSubscriptionExpiredStatus(currentActiveHotel);
        } else {
          isSubscriptionFueraDeGracia = false;
          console.warn("onAuthStateChange: currentActiveHotel no se pudo cargar, usando estado de suscripciÃ³n por defecto.");
        }
      } else {
        console.warn("Usuario autenticado pero sin hotel_id asociado. Usando plan/estado de suscripciÃ³n por defecto.");
        currentActiveHotel = null;
        currentActivePlanDetails = { nombre: "UsuarioSinHotel", funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['micuenta'] } };
        isSubscriptionFueraDeGracia = false;
      }

      // Precargar turno activo en memoria para evitar que se resetee al recargar
      if (hotelIdToLoad && appUser) {
        try {
          await fetchTurnoActivo(supabase, hotelIdToLoad, appUser.id);
        } catch (e) {
          console.warn('[main.js] No se pudo precargar el turno activo:', e.message);
        }
      }

      renderNavigation(appUser);

      if (notificacionesCampanitaContainer && !campanitaInicializada && hotelIdToLoad) {
        await inicializarCampanitaGlobal(notificacionesCampanitaContainer, supabase, appUser, hotelIdToLoad);
        campanitaInicializada = true;
      }

      await initInternalSupportChat(appUser, currentActiveHotel);

      if (window.location.pathname.endsWith('/login.html')) {
        let targetHash = window.location.hash || '#/dashboard';
        console.log(`[Auth] Usuario autenticado en login.html, redirigiendo a la app con hash: ${targetHash}`);
        window.location.href = `/app/index.html${targetHash}`;
      } else {
        console.log(`[Auth] Usuario autenticado en la app. Actualizando/Enrutando...`);
        await router();
      }
    } else {
      currentActiveHotel = null;
      currentActivePlanDetails = null;
      currentUserRole = null;
      isSubscriptionFueraDeGracia = false;

      if (campanitaInicializada) {
        desmontarCampanitaGlobal(supabase);
        if (notificacionesCampanitaContainer) notificacionesCampanitaContainer.innerHTML = '';
        campanitaInicializada = false;
      }
      destroyInternalSupportChat();
      updateUserInfo(null);
      renderNavigation(null);
      currentPathLoaded = null;

      if (!window.location.pathname.endsWith('/login.html')) {
        console.log("[Auth] Usuario no autenticado. Redirigiendo a login.html.");
        window.location.href = '/login.html';
      } else {
        console.log("[Auth] Usuario no autenticado. Ya en login.html.");
        hideGlobalLoading();
      }
    }
  });

  window.addEventListener('hashchange', async () => {
    console.log("[Router] Evento hashchange detectado. Nuevo hash:", window.location.hash);
    await router();
  });

  const hamburgerButton = document.getElementById('hamburger-button');
  const sidebar = document.getElementById('sidebar');
  const menuOverlay = document.getElementById('menu-overlay');

  if (hamburgerButton && sidebar) {
    hamburgerButton.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      hamburgerButton.setAttribute('aria-expanded', String(isOpen));
      if (menuOverlay) {
        menuOverlay.classList.toggle('active', isOpen);
      }
    });
  }

  // Listener para cerrar el menÃº al hacer clic en un enlace
  if (mainNav && sidebar && menuOverlay && hamburgerButton) {
    mainNav.addEventListener('click', (e) => {
      const linkClickeado = e.target.closest('a.nav-link-dynamic');

      if (linkClickeado) {
        console.log('[MenÃº MÃ³vil] Enlace clickeado, cerrando menÃº.');
        sidebar.classList.remove('open');
        menuOverlay.classList.remove('active');
        hamburgerButton.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (menuOverlay && sidebar) {
    menuOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      menuOverlay.classList.remove('active');
      if (hamburgerButton) hamburgerButton.setAttribute('aria-expanded', 'false');
    });
  }
  // ========= INICIO DE LA CORRECCIÃ“N PARA EL CAMBIO DE PESTAÃ‘A =========
  // Este listener se activa cada vez que la ventana del navegador vuelve a tener foco.
  window.addEventListener('visibilitychange', () => {
    const sidebar = document.getElementById('sidebar');
    const menuOverlay = document.getElementById('menu-overlay');
    const hamburgerButton = document.getElementById('hamburger-button');

    if (document.visibilityState === 'visible') {
      if (window.innerWidth <= 900) {
        console.log('[VisibilityChange] PestaÃ±a volviÃ³ a estar activa. Cerrando menÃº y overlay por seguridad.');
        if (sidebar) sidebar.classList.remove('open');
        if (menuOverlay) menuOverlay.classList.remove('active');
        if (hamburgerButton) hamburgerButton.setAttribute('aria-expanded', 'false');
      }
    }
  });
}

// ===================================================================
// ============= FUNCIÃ“N PARA MOSTRAR FORMULARIO DE RESETEO =============
// ===================================================================

// ===================================================================
// ============= FUNCIÃ“N PARA MOSTRAR FORMULARIO DE RESETEO =============
// ===================================================================

function mostrarFormularioNuevaContrasena() {
  const container = document.getElementById('app-container');
  if (!container) {
    console.error("El contenedor #app-container no fue encontrado.");
    document.body.innerHTML = "Error crÃ­tico: no se pudo mostrar el formulario de recuperaciÃ³n.";
    return;
  }

  // Ocultamos otros elementos de la UI principal para dar espacio al formulario
  // --- INICIO DE LA CORRECCIÃ“N ---
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.style.display = 'none';
  }

  const mainHeader = document.getElementById('main-header');
  if (mainHeader) {
    mainHeader.style.display = 'none';
  }
  // --- FIN DE LA CORRECCIÃ“N ---

  // Inyectamos el HTML del formulario de reseteo.
  container.innerHTML = `
    <div class="min-h-screen bg-gray-100 flex flex-col justify-center items-center py-12 px-4">
      <div class="w-full max-w-md">
        <h2 class="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Establece tu nueva contraseÃ±a
        </h2>
      </div>

      <div class="mt-8 w-full max-w-md">
        <div class="bg-white py-8 px-4 shadow-xl sm:rounded-lg sm:px-10">
          <form id="reset-password-form" class="space-y-6">
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">
                Nueva ContraseÃ±a
              </label>
              <div class="mt-1">
                <input id="password" name="password" type="password" autocomplete="new-password" required class="form-control w-full">
              </div>
            </div>

            <div>
              <label for="password-confirm" class="block text-sm font-medium text-gray-700">
                Confirmar Nueva ContraseÃ±a
              </label>
              <div class="mt-1">
                <input id="password-confirm" name="password-confirm" type="password" autocomplete="new-password" required class="form-control w-full">
              </div>
            </div>

            <div>
              <button type="submit" class="button button-primary w-full">
                Guardar y Acceder
              </button>
            </div>
          </form>
          <div id="reset-feedback" class="mt-4 text-center text-sm"></div>
        </div>
      </div>
    </div>
  `;

  // AÃ±adimos la lÃ³gica para manejar el envÃ­o del formulario.
  const form = document.getElementById('reset-password-form');
  const feedbackEl = document.getElementById('reset-feedback');
  const submitButton = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newPassword = form.elements.password.value;
    const confirmPassword = form.elements['password-confirm'].value;

    if (newPassword.length < 8) {
      feedbackEl.className = 'mt-4 text-center text-sm text-red-600'; feedbackEl.textContent = 'La contrase\u00F1a debe tener al menos 8 caracteres.';
      return;
    }
    if (newPassword !== confirmPassword) {
      feedbackEl.className = 'mt-4 text-center text-sm text-red-600'; feedbackEl.textContent = 'Las contrase\u00F1as no coinciden.';
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = 'Guardando...';
    feedbackEl.textContent = ''; feedbackEl.className = 'mt-4 text-center text-sm';

    // Usamos supabase.auth.updateUser para establecer la nueva contraseÃ±a.
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      feedbackEl.className = 'mt-4 text-center text-sm text-red-600'; feedbackEl.textContent = `Error: ${error.message || 'No se pudo actualizar la contrase\u00F1a.'}`;
      submitButton.disabled = false;
      submitButton.textContent = 'Guardar y Acceder';
    } else {
      feedbackEl.className = 'mt-4 text-center text-sm text-green-600'; feedbackEl.textContent = '\u00A1Contrase\u00F1a actualizada con \u00E9xito! Redirigiendo...';

      await supabase.auth.signOut();
      setTimeout(() => {
        window.location.href = '/login.html';
      }, 2500);
    }
  });
}
// --- INICIO DE LA APLICACIÃ“N ---
document.addEventListener('DOMContentLoaded', () => {
  installLegacyTextNormalizer(document.body);
  if (!document.getElementById('app-container')) {
    console.error("Falta #app-container en DOMContentLoaded.");
    if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crÃ­tico: Falta #app-container.</p>";
    return;
  }
  initializeApp().catch(error => {
    console.error("Error fatal durante la inicializaciÃ³n:", error);
    const appContainerError = document.getElementById('app-container');
    if (appContainerError) {
      appContainerError.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error crÃ­tico al iniciar.</p>`;
    }
    hideGlobalLoading();
  });
});
