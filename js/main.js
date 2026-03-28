// js/main.js
import { supabase } from './supabaseClient.js';
import { getCurrentUser, handleLogout, onAuthStateChange } from './authService.js';
import { showAppFeedback, showGlobalLoading, hideGlobalLoading } from './uiUtils.js';
import { fetchTurnoActivo } from './services/turnoService.js';
import { destroyMonitoring, initMonitoring, logMonitoringEvent } from './services/monitoringService.js';
import { escapeHtml, installLegacyTextNormalizer } from './security.js';
import { initInternalSupportChat, destroyInternalSupportChat } from './app-support-chat.js';
import { initPWAExperience } from './services/pwaService.js';

import { inicializarCampanitaGlobal, desmontarCampanitaGlobal } from './modules/notificaciones/notificaciones.js';

let currentModuleUnmount = null;
let appContainer = null;
let mainNav = null;
let userInfoNav = null;
let notificacionesCampanitaContainer = null;
let campanitaInicializada = false;
let currentPathLoaded = null;
let routerBusy = false;

// Información del hotel, plan activo, rol del usuario y estado de suscripción
let currentActiveHotel = null;
let currentActivePlanDetails = null;
let currentUserRole = null;
let isSubscriptionFueraDeGracia = false;

const routes = {
  '/dashboard': { loadModule: () => import('./modules/dashboard/dashboard.js'), moduleKey: 'dashboard' },
  '/reservas': { loadModule: () => import('./modules/reservas/reservas.js'), moduleKey: 'reservas' },
  '/habitaciones': { loadModule: () => import('./modules/habitaciones/habitaciones.js'), moduleKey: 'habitaciones' },
  '/mapa-habitaciones': { loadModule: () => import('./modules/mapa-habitaciones/mapa-habitaciones.js'), moduleKey: 'mapa-habitaciones' },
  '/caja': { loadModule: () => import('./modules/caja/caja.js'), moduleKey: 'caja' },
  '/clientes': { loadModule: () => import('./modules/clientes/clientes.js'), moduleKey: 'clientes' },
  '/servicios': { loadModule: () => import('./modules/servicios/servicios.js'), moduleKey: 'servicios' },
  '/tienda': { loadModule: () => import('./modules/tienda/tienda.js'), moduleKey: 'tienda' },
  '/restaurante': { loadModule: () => import('./modules/restaurante/restaurante.js'), moduleKey: 'restaurante' },
  '/usuarios': { loadModule: () => import('./modules/usuarios/usuarios.js'), moduleKey: 'usuarios' },
  '/configuracion': { loadModule: () => import('./modules/configuracion/configuracion.js'), moduleKey: 'configuracion' },
  '/reportes': { loadModule: () => import('./modules/reportes/reportes.js'), moduleKey: 'reportes' },
  '/limpieza': { loadModule: () => import('./modules/limpieza/limpieza.js'), moduleKey: 'limpieza' },
  '/integraciones': { loadModule: () => import('./modules/integraciones/integraciones.js'), moduleKey: 'integraciones' },
  '/notificaciones': { loadModule: () => import('./modules/notificaciones/notificaciones.js'), moduleKey: 'notificaciones_page' },
  '/mantenimiento': { loadModule: () => import('./modules/mantenimiento/mantenimiento.js'), moduleKey: 'mantenimiento' },
  '/descuentos': { loadModule: () => import('./modules/descuentos/descuentos.js'), moduleKey: 'descuentos' },
  '/micuenta': { loadModule: () => import('./modules/micuenta/micuenta.js'), moduleKey: 'micuenta' },
  '/faq': { loadModule: () => import('./modules/faq/faq.js'), moduleKey: 'faq' },
  '/bitacora': { loadModule: () => import('./modules/bitacora/bitacora.js'), moduleKey: 'bitacora' },
  '/ops-saas': { loadModule: () => import('./modules/ops-saas/ops-saas.js'), moduleKey: 'ops-saas' },
  '/soporte': { loadModule: () => import('./modules/soporte/soporte.js'), moduleKey: 'soporte' },
  '/onboarding': { loadModule: () => import('./modules/onboarding/onboarding.js'), moduleKey: 'onboarding' },
  '/sandbox': { loadModule: () => import('./modules/sandbox/sandbox.js'), moduleKey: 'sandbox' },
  '/operacion-hoy': { loadModule: () => import('./modules/operacion-hoy/operacion-hoy.js'), moduleKey: 'operacion-hoy' }
};

const navLinksConfig = [
  { path: '#/dashboard', text: 'Dashboard', icon: '\u{1F4CA}', moduleKey: 'dashboard' },
  { path: '#/operacion-hoy', text: 'Hoy en operación', icon: '\u{1F4CB}', moduleKey: 'operacion-hoy' },
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
  { path: '#/soporte', text: 'Soporte', icon: '\u{1F6DF}\uFE0F', moduleKey: 'soporte' },
  { path: '#/mantenimiento', text: 'Mantenimiento', icon: '\u{1F6E0}\uFE0F', moduleKey: 'mantenimiento' },
  { path: '#/descuentos', text: 'Descuentos', icon: '\u{1F3F7}\uFE0F', moduleKey: 'descuentos' },
  { path: '#/usuarios', text: 'Usuarios', icon: '\u{1F465}', moduleKey: 'usuarios' },
  { path: '#/configuracion', text: 'Configuraci\u00F3n', icon: '\u2699\uFE0F', moduleKey: 'configuracion' },
  { path: '#/integraciones', text: 'Integraciones', icon: '\u{1F517}', moduleKey: 'integraciones' },
  { path: '#/notificaciones', text: 'Ver Notificaciones', icon: '\u{1F4DC}', moduleKey: 'notificaciones_page' },
  { path: '#/onboarding', text: 'Primeros pasos', icon: '\u{1F6E0}\uFE0F', moduleKey: 'onboarding' },
  { path: '#/sandbox', text: 'Sandbox', icon: '\u{1F9EA}', moduleKey: 'sandbox' },
  { path: '#/ops-saas', text: 'Consola SaaS', icon: '\u{1F3E2}', moduleKey: 'ops-saas', superadminOnly: true },
  { path: '#/bitacora?scope=soporte-global', text: 'Incidencias SaaS', icon: '\u{1F6DF}\uFE0F', moduleKey: 'bitacora', superadminOnly: true },
  { path: '#/micuenta', text: 'Mi cuenta', icon: '\u{1F6E1}\uFE0F', moduleKey: 'micuenta' },
  { path: '#/faq', text: 'FAQ', icon: '\u2753', moduleKey: 'faq' }
];

const SUPERADMIN_EMAILS = new Set(['cararegom@gmail.com']);
const superadminNavLinksConfig = [
  { path: '#/ops-saas', text: 'Admin Panel', icon: '\u{1F3E2}', moduleKey: 'ops-saas' },
  { path: '#/bitacora?scope=soporte-global', text: 'Incidencias SaaS', icon: '\u{1F6DF}\uFE0F', moduleKey: 'bitacora' },
  { path: '#/soporte', text: 'Centro de Soporte', icon: '\u{1F4AC}', moduleKey: 'soporte' },
  { path: '#/faq', text: 'FAQ', icon: '\u2753', moduleKey: 'faq' }
];
const superadminAllowedRoutes = new Set(['/ops-saas', '/bitacora', '/soporte', '/faq']);

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isWhitelistedSuperadminAccount(user, perfil = null) {
  const email = normalizeEmail(
    user?.email ||
    perfil?.correo ||
    user?.user_metadata?.email ||
    user?.app_metadata?.email
  );
  return perfil?.rol === 'superadmin' || SUPERADMIN_EMAILS.has(email);
}

function buildSuperadminPlanDetails() {
  return {
    nombre: 'Superadmin SaaS',
    funcionalidades: {
      limite_habitaciones: 0,
      modulos_permitidos: ['ops-saas', 'bitacora', 'soporte', 'faq']
    }
  };
}

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

function scheduleModuleWarmup(currentRole = null) {
  const preloadRoutes = currentRole === 'superadmin'
    ? ['/ops-saas', '/bitacora', '/soporte']
    : ['/dashboard', '/operacion-hoy', '/reservas', '/mapa-habitaciones', '/caja', '/onboarding'];

  const runner = () => {
    preloadRoutes.forEach((path) => {
      routes[path]?.loadModule?.().catch(() => {});
    });
  };

  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runner, { timeout: 2500 });
  } else {
    window.setTimeout(runner, 1200);
  }
}

function calculateSubscriptionExpiredStatus(hotel) {
  if (!hotel || !hotel.estado_suscripcion || (!hotel.suscripcion_fin && !hotel.trial_fin)) {
    return false;
  }
  const fechaFinSusc = new Date(hotel.suscripcion_fin || hotel.trial_fin);
  const fechaFinMasGracia = new Date(fechaFinSusc);
  fechaFinMasGracia.setDate(fechaFinSusc.getDate() + 2);
  const graciaManualHasta = hotel.gracia_hasta ? new Date(hotel.gracia_hasta) : null;
  const fechaLimite = graciaManualHasta && !Number.isNaN(graciaManualHasta.getTime()) && graciaManualHasta > fechaFinMasGracia
    ? graciaManualHasta
    : fechaFinMasGracia;
  return (new Date() > fechaLimite) && hotel.estado_suscripcion === 'vencido';
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
      .select('id, nombre, plan, estado_suscripcion, suscripcion_fin, trial_fin, gracia_hasta, gracia_motivo, creado_por')
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
    console.error("Error crítico cargando detalles del hotel y/o plan:", error.message);
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

  if (currentUserRole === 'superadmin') {
    superadminNavLinksConfig.forEach((linkConfig) => {
      const a = buildNavLinkElement(linkConfig);
      if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
    });
    return;
  }

  let esAdminNavegacion = false;
  if (currentActiveHotel && user && currentUserRole) {
    esAdminNavegacion = (currentUserRole === 'admin' || currentUserRole === 'superadmin' || user.id === currentActiveHotel.creado_por);
  }

  if (isSubscriptionFueraDeGracia && esAdminNavegacion) {
    // Lógica para suscripción vencida (sin cambios)
    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.moduleKey === 'micuenta') {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
  } else if (currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {
    const modulosPermitidos = currentActivePlanDetails.funcionalidades.modulos_permitidos;

    // â–¼â–¼â–¼ INICIO DE LA CORRECCIÃ“N â–¼â–¼â–¼
    // Se añade la misma lista de módulos exentos que en el router.
    const modulosExentos = ['micuenta', 'faq', 'bitacora', 'ops-saas', 'soporte', 'onboarding', 'sandbox', 'operacion-hoy'];

    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.adminOnly && !esAdminNavegacion) {
        return;
      }
      if (linkConfig.superadminOnly && currentUserRole !== 'superadmin') {
        return;
      }
      // Un enlace se muestra si su 'moduleKey' está en la lista de permitidos O en la lista de exentos.
      if (modulosPermitidos.includes(linkConfig.moduleKey) || modulosExentos.includes(linkConfig.moduleKey)) {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
    // â–²â–²â–² FIN DE LA CORRECCIÃ“N â–²â–²â–²
  } else {
    // Lógica de fallback (sin cambios)
    navLinksConfig.forEach(linkConfig => {
      if (linkConfig.moduleKey === 'micuenta' || linkConfig.moduleKey === 'dashboard') {
        const a = buildNavLinkElement(linkConfig);
        if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
      }
    });
    console.warn("RenderNavigation: Detalles del plan no disponibles o incompletos, mostrando navegación esencial.");
  }
}
function updateUserInfo(user) {
  if (!userInfoNav) return;
  if (user) {
    const userEmail = user.email || '';
    const displayRol = currentUserRole
      ? (currentUserRole === 'superadmin'
          ? 'Superadmin SaaS'
          : (currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1)))
      : (user.app_metadata?.rol || user.user_metadata?.rol || 'Usuario');
    /* Legacy template removed during security hardening.
      <div class="user-profile text-sm p-2 border-t border-gray-700 mt-auto">
        <span class="user-email block font-medium text-white truncate" title="${userEmail}">${userEmail}</span>
        <span class="user-role block text-xs text-gray-400">${displayRol}</span>
      </div>
      <button id="logout-button" class="button button-danger w-full text-left p-2 hover:bg-red-700 rounded flex items-center text-sm mt-2">
        <span class="mr-2 text-lg">ðŸšª</span> Cerrar Sesión
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
    console.log('[Router] Detenido: El formulario de reseteo de contraseña está activo.');
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
      console.error("Router: appContainer no está definido.");
      if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Falta #app-container.</p>";
      routerBusy = false;
      return;
    }

    const path = window.location.hash.slice(1) || (currentUserRole === 'superadmin' ? '/ops-saas' : '/dashboard');
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
    appContainer.innerHTML = '<div class="p-8 text-center text-gray-500">Cargando vista...</div>';

    const userForModule = getCurrentUser();

    if (currentUserRole === 'superadmin' && !superadminAllowedRoutes.has(baseRoute)) {
      window.location.hash = '#/ops-saas';
      hideGlobalLoading();
      routerBusy = false;
      return;
    }

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

    // En js/main.js, dentro de la función router()

    if (userForModule && currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {

      // â–¼â–¼â–¼ INICIO DE LA CORRECCIÃ“N â–¼â–¼â–¼
      // Creamos una lista de módulos que SIEMPRE deben estar accesibles.
      const modulosExentos = ['micuenta', 'faq', 'bitacora', 'ops-saas', 'soporte', 'onboarding', 'sandbox', 'operacion-hoy'];

      // Verificamos si el módulo actual está en la lista de exentos.
      const esModuloExento = modulosExentos.includes(moduleKeyFromRoute);

      // Si el módulo NO es exento Y NO está en la lista de permitidos del plan, entonces bloqueamos.
      if (!esModuloExento && moduleKeyFromRoute && !currentActivePlanDetails.funcionalidades.modulos_permitidos.includes(moduleKeyFromRoute)) {

        console.warn(`[Router] Acceso denegado al módulo '${moduleKeyFromRoute}' para el plan '${currentActivePlanDetails.nombre}'.`);
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
            showAppFeedback('Tu suscripción ha vencido. Solo puedes acceder a "Mi Cuenta" para renovar tu plan.', 'warning', true, 6000);
            window.location.hash = '#/micuenta';
            return;
          }
        } else {
          document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;background-color:#f3f4f6;"><h2 style="color:#be123c;font-size:1.8rem;margin-bottom:1rem;">Suscripción Vencida</h2><p style="font-size:1.1rem;color:#374151;">La suscripción del hotel ha expirado.<br>Comunícate con el administrador para renovar el acceso.</p></div>`;
          hideGlobalLoading();
          routerBusy = false;
          return;
        }
      }
    }

    const moduleDefinition = routeEntry?.loadModule
      ? await routeEntry.loadModule()
      : null;

    if (moduleDefinition) {
      if (typeof moduleDefinition.mount !== 'function') {
        if (typeof moduleDefinition.default === 'function') {
          await moduleDefinition.default(appContainer, supabase, userForModule, hotelIdForModule);
          currentModuleUnmount = null;
        } else {
          if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error: M\u00F3dulo para "${escapeHtml(baseRoute)}" inv\u00E1lido.</p>`;
          void logMonitoringEvent({
            source: 'router',
            level: 'error',
            eventType: 'invalid_module_definition',
            message: `La ruta ${baseRoute} no tiene una definicion de modulo valida.`,
            details: { baseRoute, moduleKeyFromRoute }
          });
        }
      } else {
        try {
          console.log(`[Router] Montando módulo para: ${baseRoute}`);
          console.log("DEBUG main.js: Valor de 'supabase' antes de pasarlo al módulo:", supabase);
          await moduleDefinition.mount(appContainer, supabase, userForModule, hotelIdForModule, currentActivePlanDetails);
          currentModuleUnmount = moduleDefinition.unmount || null;
          currentPathLoaded = baseRoute;
        } catch (error) {
          if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error al cargar m\u00F3dulo: ${escapeHtml(error?.message || 'Error desconocido')}</p>`;
          currentPathLoaded = null;
          void logMonitoringEvent({
            source: 'router',
            level: 'error',
            eventType: 'module_mount_failed',
            message: `Fallo montando la ruta ${baseRoute}.`,
            details: {
              baseRoute,
              moduleKeyFromRoute,
              error: error?.message || 'Error desconocido'
            }
          });
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

// ASEGÃšRATE DE QUE ESTA FUNCIÃ“N ESTÁ ASÍ EN TU main.js

async function initializeApp() {
  appContainer = document.getElementById('app-container');
  mainNav = document.getElementById('main-nav');
  userInfoNav = document.getElementById('user-info-nav');
  notificacionesCampanitaContainer = document.getElementById('notificaciones-campanita-container');

  await initPWAExperience();

  if (!appContainer || !mainNav) {
    console.error("initializeApp: Faltan elementos HTML esenciales (app-container o main-nav). La aplicación no puede continuar.");
    if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Faltan elementos base de la aplicación. Revise los IDs #app-container y #main-nav en su HTML.</p>";
    return;
  }

  if (mainNav && !mainNav.querySelector('#dynamic-nav-links')) {
    const dynamicLinksDiv = document.createElement('div');
    dynamicLinksDiv.id = 'dynamic-nav-links';
    mainNav.appendChild(dynamicLinksDiv);
  }

  showGlobalLoading("Inicializando aplicación...");

  onAuthStateChange(async (event, session) => {
    const appUser = session?.user;
    console.log("[Auth] Estado cambiado. Evento:", event, "Usuario actual:", appUser ? appUser.email : "Ninguno");

    if (session && session.user && session.user.aud === 'authenticated' && session.expires_in === 3600) {
      const urlParams = new URLSearchParams(window.location.hash.substring(1));
      const type = urlParams.get('type');

      if (type === 'recovery') {
        console.log('âœ…âœ…âœ… Evento de recuperación de contraseña detectado por URL. Mostrando formulario.');
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

      const esSuperadminWhitelisted = isWhitelistedSuperadminAccount(appUser, perfil);

      if (perfilError && !esSuperadminWhitelisted) {
        console.error("onAuthStateChange: Error obteniendo perfil (hotel_id, rol):", perfilError.message);
        currentUserRole = "Usuario";
      } else if (perfil || esSuperadminWhitelisted) {
        if (!hotelIdToLoad) hotelIdToLoad = perfil?.hotel_id || null;
        currentUserRole = esSuperadminWhitelisted ? 'superadmin' : (perfil.rol || "Usuario");
      } else {
        console.warn("onAuthStateChange: No se encontró perfil de usuario en la tabla 'usuarios'.");
        currentUserRole = "Usuario";
      }

      updateUserInfo(appUser);

      if (currentUserRole === 'superadmin') {
        currentActiveHotel = null;
        currentActivePlanDetails = buildSuperadminPlanDetails();
        isSubscriptionFueraDeGracia = false;
      } else if (hotelIdToLoad) {
        await loadHotelAndPlanDetails(hotelIdToLoad, supabase);
        if (currentActiveHotel) {
          isSubscriptionFueraDeGracia = calculateSubscriptionExpiredStatus(currentActiveHotel);
        } else {
          isSubscriptionFueraDeGracia = false;
          console.warn("onAuthStateChange: currentActiveHotel no se pudo cargar, usando estado de suscripción por defecto.");
        }
      } else {
        console.warn("Usuario autenticado pero sin hotel_id asociado. Usando plan/estado de suscripción por defecto.");
        currentActiveHotel = null;
        currentActivePlanDetails = { nombre: "UsuarioSinHotel", funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['micuenta'] } };
        isSubscriptionFueraDeGracia = false;
      }

      initMonitoring({
        supabase,
        user: appUser,
        hotel: currentActiveHotel,
        role: currentUserRole
      });

      if (perfilError) {
        void logMonitoringEvent({
          source: 'auth',
          level: 'error',
          eventType: 'profile_load_failed',
          message: 'No se pudo cargar el perfil operativo del usuario.',
          details: {
            error: perfilError.message,
            code: perfilError.code || null
          }
        });
      }

      // Precargar turno activo en memoria para evitar que se resetee al recargar
      if (hotelIdToLoad && appUser && currentUserRole !== 'superadmin') {
        try {
          await fetchTurnoActivo(supabase, hotelIdToLoad, appUser.id);
        } catch (e) {
          console.warn('[main.js] No se pudo precargar el turno activo:', e.message);
        }
      }

      renderNavigation(appUser);
      scheduleModuleWarmup(currentUserRole);

      if (notificacionesCampanitaContainer && !campanitaInicializada && hotelIdToLoad && currentUserRole !== 'superadmin') {
        await inicializarCampanitaGlobal(notificacionesCampanitaContainer, supabase, appUser, hotelIdToLoad);
        campanitaInicializada = true;
      }

      await initInternalSupportChat(appUser, currentActiveHotel);

      if (window.location.pathname.endsWith('/login.html')) {
        let targetHash = window.location.hash || (currentUserRole === 'superadmin' ? '#/ops-saas' : '#/dashboard');
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
      destroyMonitoring();
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

  // Listener para cerrar el menú al hacer clic en un enlace
  if (mainNav && sidebar && menuOverlay && hamburgerButton) {
    mainNav.addEventListener('click', (e) => {
      const linkClickeado = e.target.closest('a.nav-link-dynamic');

      if (linkClickeado) {
        console.log('[Menú Móvil] Enlace clickeado, cerrando menú.');
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
        console.log('[VisibilityChange] Pestaña volvió a estar activa. Cerrando menú y overlay por seguridad.');
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
    document.body.innerHTML = "Error crítico: no se pudo mostrar el formulario de recuperación.";
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
          Establece tu nueva contraseña
        </h2>
      </div>

      <div class="mt-8 w-full max-w-md">
        <div class="bg-white py-8 px-4 shadow-xl sm:rounded-lg sm:px-10">
          <form id="reset-password-form" class="space-y-6">
            <div>
              <label for="password" class="block text-sm font-medium text-gray-700">
                Nueva Contraseña
              </label>
              <div class="mt-1">
                <input id="password" name="password" type="password" autocomplete="new-password" required class="form-control w-full">
              </div>
            </div>

            <div>
              <label for="password-confirm" class="block text-sm font-medium text-gray-700">
                Confirmar Nueva Contraseña
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

  // Añadimos la lógica para manejar el envío del formulario.
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

    // Usamos supabase.auth.updateUser para establecer la nueva contraseña.
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
    if (document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Falta #app-container.</p>";
    return;
  }
  initializeApp().catch(error => {
    console.error("Error fatal durante la inicialización:", error);
    const appContainerError = document.getElementById('app-container');
    if (appContainerError) {
      appContainerError.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error crítico al iniciar.</p>`;
    }
    hideGlobalLoading();
  });
});
