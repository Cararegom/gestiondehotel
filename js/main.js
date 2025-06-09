// js/main.js
import { supabase } from './supabaseClient.js';
import { getCurrentUser, handleLogout, onAuthStateChange } from './authService.js';
import { showAppFeedback, showGlobalLoading, hideGlobalLoading } from './uiUtils.js';

// Importa tus módulos
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
  '/dashboard': { module: Dashboard, moduleKey: 'dashboard' },
  '/reservas': { module: Reservas, moduleKey: 'reservas' },
  '/habitaciones': { module: Habitaciones, moduleKey: 'habitaciones' },
  '/mapa-habitaciones': { module: MapaHabitaciones, moduleKey: 'mapa-habitaciones' },
  '/caja': { module: Caja, moduleKey: 'caja' },
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
  '/micuenta': { module: Micuenta, moduleKey: 'micuenta' }
};

const navLinksConfig = [
    { path: '#/dashboard', text: 'Dashboard', icon: '📊', moduleKey: 'dashboard' },
    { path: '#/reservas', text: 'Reservas', icon: '📅', moduleKey: 'reservas' },
    { path: '#/mapa-habitaciones', text: 'Mapa Hotel', icon: '🗺️', moduleKey: 'mapa-habitaciones' },
    { path: '#/habitaciones', text: 'Habitaciones', icon: '🚪', moduleKey: 'habitaciones' },
    { path: '#/caja', text: 'Caja/Turnos', icon: '💰', moduleKey: 'caja' },
    { path: '#/servicios', text: 'Servicios', icon: '🛎️', moduleKey: 'servicios' },
    { path: '#/tienda', text: 'Tienda', icon: '🛍️', moduleKey: 'tienda' },
    { path: '#/restaurante', text: 'Restaurante', icon: '🍽️', moduleKey: 'restaurante' },
    { path: '#/limpieza', text: 'Limpieza', icon: '🧹', moduleKey: 'limpieza' },
    { path: '#/reportes', text: 'Reportes', icon: '📈', moduleKey: 'reportes' },
    { path: '#/mantenimiento', text: 'Mantenimiento', icon: '🛠️', moduleKey: 'mantenimiento' },
    { path: '#/descuentos', text: 'Descuentos', icon: '🏷️', moduleKey: 'descuentos' },
    { path: '#/usuarios', text: 'Usuarios', icon: '👥', moduleKey: 'usuarios' },
    { path: '#/configuracion', text: 'Configuración', icon: '⚙️', moduleKey: 'configuracion' },
    { path: '#/integraciones', text: 'Integraciones', icon: '🔗', moduleKey: 'integraciones' },
    { path: '#/notificaciones', text: 'Ver Notificaciones', icon: '📜', moduleKey: 'notificaciones_page' },
    { path: '#/micuenta', text: 'Mi cuenta', icon: '🛡️', moduleKey: 'micuenta' }
];

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
    console.error("Error crítico cargando detalles del hotel y/o plan:", error.message);
    currentActiveHotel = null; 
    currentActivePlanDetails = { 
        nombre: "ErrorCargaPlan", 
        funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['dashboard', 'micuenta'] } 
    };
  }
}

function renderNavigation(user) {
    if (!mainNav) return;
    const dynamicLinksContainer = mainNav.querySelector('#dynamic-nav-links');
    
    if (dynamicLinksContainer) {
        dynamicLinksContainer.innerHTML = ''; 
    } else {
        const existingDynamicLinks = mainNav.querySelectorAll('a.nav-link-dynamic');
        existingDynamicLinks.forEach(link => link.remove());
        // console.warn("Contenedor #dynamic-nav-links no encontrado en mainNav."); // Opcional: crear si no existe
    }

    if (!user) return; 

    let esAdminNavegacion = false;
    if (currentActiveHotel && user && currentUserRole) {
         esAdminNavegacion = (currentUserRole === 'admin' || currentUserRole === 'superadmin' || user.id === currentActiveHotel.creado_por);
    }

    if (isSubscriptionFueraDeGracia && esAdminNavegacion) {
        navLinksConfig.forEach(linkConfig => {
            if (linkConfig.moduleKey === 'micuenta') {
                const a = document.createElement('a');
                a.href = linkConfig.path;
                a.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';
                a.innerHTML = `<span class="mr-2 text-lg">${linkConfig.icon}</span> ${linkConfig.text}`;
                if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
            }
        });
    } else if (currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {
        const modulosPermitidos = currentActivePlanDetails.funcionalidades.modulos_permitidos;
        navLinksConfig.forEach(linkConfig => {
            if (linkConfig.moduleKey === 'micuenta' || 
                modulosPermitidos.includes(linkConfig.moduleKey)) { // "Dashboard", etc. deben estar en modulos_permitidos del plan
                
                const a = document.createElement('a');
                a.href = linkConfig.path;
                a.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';
                a.innerHTML = `<span class="mr-2 text-lg">${linkConfig.icon}</span> ${linkConfig.text}`;
                if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
            }
        });
    } else { 
        navLinksConfig.forEach(linkConfig => {
            if (linkConfig.moduleKey === 'micuenta' || linkConfig.moduleKey === 'dashboard') {
                 const a = document.createElement('a');
                 a.href = linkConfig.path;
                 a.className = 'nav-link nav-link-dynamic p-2 hover:bg-gray-700 rounded flex items-center text-sm';
                 a.innerHTML = `<span class="mr-2 text-lg">${linkConfig.icon}</span> ${linkConfig.text}`;
                 if (dynamicLinksContainer) dynamicLinksContainer.appendChild(a); else mainNav.appendChild(a);
            }
        });
        console.warn("RenderNavigation: Detalles del plan no disponibles o incompletos, mostrando navegación esencial.");
    }
}

function updateUserInfo(user) {
  if (!userInfoNav) return;
  if (user) {
    const userEmail = user.email;
    const displayRol = currentUserRole ? (currentUserRole.charAt(0).toUpperCase() + currentUserRole.slice(1)) : (user.app_metadata?.rol || user.user_metadata?.rol || 'Usuario'); 
    userInfoNav.innerHTML = `
      <div class="user-profile text-sm p-2 border-t border-gray-700 mt-auto">
        <span class="user-email block font-medium text-white truncate" title="${userEmail}">${userEmail}</span>
        <span class="user-role block text-xs text-gray-400">${displayRol}</span>
      </div>
      <button id="logout-button" class="button button-danger w-full text-left p-2 hover:bg-red-700 rounded flex items-center text-sm mt-2">
        <span class="mr-2 text-lg">🚪</span> Cerrar Sesión
      </button>
    `;
    const logoutButton = userInfoNav.querySelector('#logout-button');
    if (logoutButton) {
  logoutButton.replaceWith(logoutButton.cloneNode(true)); 
  userInfoNav.querySelector('#logout-button').addEventListener('click', async () => {
    showGlobalLoading("Verificando caja...");
    const user = getCurrentUser();
    let hotelId = user?.user_metadata?.hotel_id || user?.app_metadata?.hotel_id;
    if (!hotelId && user?.id) {
        // Obtén hotelId si no viene en metadata
        const { data: perfil } = await supabase.from('usuarios').select('hotel_id').eq('id', user.id).single();
        hotelId = perfil?.hotel_id;
    }
    // --- CONSULTA EN TURNOS ---
    let hayCajaAbierta = false;
    try {
      const { data: turnosAbiertos, error } = await supabase
        .from('turnos')
        .select('id')
        .eq('usuario_id', user.id)
        .eq('hotel_id', hotelId)
        .is('fecha_cierre', null); // SOLO los turnos abiertos

      console.log("[DEBUG] turnosAbiertos:", turnosAbiertos, "Error:", error);

      hayCajaAbierta = turnosAbiertos && turnosAbiertos.length > 0;
      if (hayCajaAbierta) {
        console.log("[DEBUG] ¡El usuario tiene caja (turno) abierta!");
      } else {
        console.log("[DEBUG] El usuario NO tiene caja abierta.");
      }
    } catch (err) {
      console.error("Error verificando caja abierta:", err);
      showAppFeedback("No se pudo verificar si tienes caja abierta. Intenta de nuevo.", "error");
      hideGlobalLoading();
      return;
    }
    // Si hay caja abierta, muestra advertencia
    if (hayCajaAbierta) {
  hideGlobalLoading(); // ← Esto OCULTA el overlay ANTES de mostrar el SweetAlert
  const confirm = await Swal.fire({
    icon: 'warning',
    title: '¡Caja abierta!',
    text: 'Tienes una caja (turno) abierta sin cerrar. Si sales, la caja quedará abierta. ¿Seguro que quieres cerrar sesión?',
    showCancelButton: true,
    confirmButtonText: 'Sí, cerrar sesión',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d33',
  });
  if (!confirm.isConfirmed) {
    // hideGlobalLoading(); // Ya está oculto, no lo repitas
    return;
  }
}

    // Procede con el logout
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

    // RESTRICCIÓN DE ACCESO POR PLAN
    if (userForModule && currentActivePlanDetails && currentActivePlanDetails.funcionalidades && currentActivePlanDetails.funcionalidades.modulos_permitidos) {
        if (moduleKeyFromRoute && 
            moduleKeyFromRoute !== 'micuenta' && 
            // moduleKeyFromRoute !== 'dashboard' && // Dashboard también debe estar en modulos_permitidos
            !currentActivePlanDetails.funcionalidades.modulos_permitidos.includes(moduleKeyFromRoute)) {
            
            console.warn(`[Router] Acceso denegado al módulo '${moduleKeyFromRoute}' para el plan '${currentActivePlanDetails.nombre}'.`);
            appContainer.innerHTML = `
              <div class="p-6 md:p-8 text-center">
                <h2 class="text-2xl font-semibold text-red-600 mb-3">Acceso Restringido al Módulo</h2>
                <p class="text-gray-700 mb-1">La funcionalidad o módulo '<strong>${moduleKeyFromRoute}</strong>' no está incluida en tu plan actual (<strong>${currentActivePlanDetails.nombre}</strong>).</p>
                <p class="text-gray-600 text-sm">Si necesitas acceder a esta sección, puedes mejorar tu plan.</p>
                <div class="mt-6">
                  <a href="#/micuenta" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg shadow transition-colors">
                    Ir a Mi Cuenta para Ver Planes
                  </a>
                </div>
              </div>`;
            hideGlobalLoading();
            routerBusy = false;
            return;
        }
    } else if (userForModule && moduleKeyFromRoute !== 'micuenta' && moduleKeyFromRoute !== 'dashboard' && !currentActivePlanDetails) {
         console.warn("[Router] No se pudieron determinar los permisos del plan. Acceso limitado.");
         // Potencialmente mostrar error o redirigir si se intenta acceder a un módulo protegido sin datos del plan
    }
    
    // BLOQUEO POR SUSCRIPCIÓN VENCIDA (Usa variables globales actualizadas)
    if (hotelIdForModule && userForModule && currentActiveHotel) {
        const usuarioId = userForModule.id;
        const esAdminRouter = (currentUserRole === 'admin' || currentUserRole === 'superadmin' || usuarioId === currentActiveHotel.creado_por);
        
        if (isSubscriptionFueraDeGracia) { // Usa la variable global
            if (esAdminRouter) {
                if (baseRoute !== '/micuenta') {
                    showAppFeedback(
                        'Tu suscripción ha vencido. Solo puedes acceder a "Mi Cuenta" para renovar tu plan.',
                        'warning', true, 6000
                    );
                    window.location.hash = '#/micuenta';
                    return; 
                }
            } else { 
                document.body.innerHTML = `
                    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;background-color:#f3f4f6;">
                        <h2 style="color:#be123c;font-size:1.8rem;margin-bottom:1rem;">Suscripción Vencida</h2>
                        <p style="font-size:1.1rem;color:#374151;">La suscripción del hotel ha expirado.<br>
                        Comunícate con el administrador para renovar el acceso.</p>
                    </div>
                `;
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
          if(appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error: Módulo para "${baseRoute}" inválido.</p>`;
        }
      } else {
    try {
      console.log(`[Router] Montando módulo para: ${baseRoute}`);
      // Asegúrate de que hotelIdForModule y currentActivePlanDetails estén definidos y sean correctos
      await moduleDefinition.mount(appContainer, supabase, userForModule, hotelIdForModule, currentActivePlanDetails); // <--- AÑADIDO currentActivePlanDetails
      currentModuleUnmount = moduleDefinition.unmount || null;
      currentPathLoaded = baseRoute;
    } catch (error) {
          if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-4 bg-red-100 text-red-700 rounded">Error al cargar módulo: ${error.message}</p>`;
          currentPathLoaded = null;
        }
      }
    } else {
      if (appContainer) appContainer.innerHTML = `<p class="error-indicator p-8 text-center text-xl">404 - Página no encontrada (${baseRoute})</p>`;
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

// js/main.js
// ... (todos tus imports y variables globales como currentActiveHotel, currentUserRole, etc. deben estar definidas antes) ...

async function initializeApp() {
  appContainer = document.getElementById('app-container');
  mainNav = document.getElementById('main-nav'); 
  userInfoNav = document.getElementById('user-info-nav');
  notificacionesCampanitaContainer = document.getElementById('notificaciones-campanita-container');

  if (!appContainer || !mainNav) {
      console.error("initializeApp: Faltan elementos HTML esenciales (app-container o main-nav). La aplicación no puede continuar.");
      if(document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Faltan elementos base de la aplicación. Revise los IDs #app-container y #main-nav en su HTML.</p>";
      return;
  }
  // Asegurar que exista el contenedor para los links dinámicos de navegación
  if (mainNav && !mainNav.querySelector('#dynamic-nav-links')) {
      const dynamicLinksDiv = document.createElement('div');
      dynamicLinksDiv.id = 'dynamic-nav-links';
      // Podrías añadirlo en un lugar específico del mainNav si es necesario, o al final.
      mainNav.appendChild(dynamicLinksDiv); 
  }
  
  showGlobalLoading("Inicializando aplicación...");

  onAuthStateChange(async (user, session) => { // 'user' aquí es el currentUser de authService
    const appUser = user; 
    console.log("[Auth] Estado de autenticación cambiado. Usuario actual:", appUser ? appUser.email : "Ninguno");

    if (appUser) {
        let hotelIdToLoad = appUser.user_metadata?.hotel_id || appUser.app_metadata?.hotel_id;
        
        // Obtener hotel_id Y rol desde la tabla usuarios
        const { data: perfil, error: perfilError } = await supabase
            .from('usuarios')
            .select('hotel_id, rol')
            .eq('id', appUser.id)
            .single();

        if (perfilError) {
            console.error("onAuthStateChange: Error obteniendo perfil (hotel_id, rol):", perfilError.message);
            currentUserRole = "Usuario"; // Fallback conservador
        } else if (perfil) {
            if (!hotelIdToLoad) hotelIdToLoad = perfil.hotel_id; // Usar hotel_id del perfil si no estaba en metadata
            currentUserRole = perfil.rol || "Usuario"; // Asignar rol o fallback
        } else {
            console.warn("onAuthStateChange: No se encontró perfil de usuario en la tabla 'usuarios'.");
            currentUserRole = "Usuario"; // Fallback si no hay perfil
        }
        
        updateUserInfo(appUser); // Actualizar UI con email y rol ANTES de cargar plan

        if (hotelIdToLoad) {
            await loadHotelAndPlanDetails(hotelIdToLoad, supabase); // Carga currentActiveHotel y currentActivePlanDetails
            if (currentActiveHotel) { 
                isSubscriptionFueraDeGracia = calculateSubscriptionExpiredStatus(currentActiveHotel);
            } else {
                 // Si currentActiveHotel es null después de loadHotelAndPlanDetails, hubo un error o no se encontró
                 isSubscriptionFueraDeGracia = false; // Asumir no vencida si no hay datos de hotel
                 console.warn("onAuthStateChange: currentActiveHotel no se pudo cargar, usando estado de suscripción por defecto.");
            }
        } else {
            console.warn("Usuario autenticado pero sin hotel_id asociado. Usando plan/estado de suscripción por defecto.");
            currentActiveHotel = null; // Asegurar que esté limpio
            // Plan por defecto para usuarios sin hotel o con error al cargar hotelId
            currentActivePlanDetails = { nombre: "UsuarioSinHotel", funcionalidades: { limite_habitaciones: 0, modulos_permitidos: ['micuenta'] } }; // Solo micuenta
            isSubscriptionFueraDeGracia = false; // No se puede determinar, asumir no vencida
        }
        
        renderNavigation(appUser); // Renderizar navegación DESPUÉS de cargar rol, hotel y plan

        if (notificacionesCampanitaContainer && !campanitaInicializada && hotelIdToLoad) { // Solo inicializar si hay hotelId
            await inicializarCampanitaGlobal(notificacionesCampanitaContainer, supabase, appUser, hotelIdToLoad); // Pasar hotelId
            campanitaInicializada = true;
        }
        
        if (window.location.pathname.endsWith('/login.html')) {
            // El script de login.html ya debería haber redirigido a #/micuenta o #/dashboard según el estado.
            // Si por alguna razón llega aquí sin hash, lo mandamos a dashboard.
            let targetHash = window.location.hash || '#/dashboard';
            console.log(`[Auth] Usuario autenticado en login.html, redirigiendo a la app con hash: ${targetHash}`);
            window.location.href = `/app/index.html${targetHash}`;
        } else {
            console.log(`[Auth] Usuario autenticado en la app. Actualizando/Enrutando...`);
            await router(); // El router usará los datos globales actualizados
        }
    } else { // No hay usuario (logout o sesión no iniciada)
        currentActiveHotel = null;
        currentActivePlanDetails = null;
        currentUserRole = null;
        isSubscriptionFueraDeGracia = false;

        if (campanitaInicializada) {
            desmontarCampanitaGlobal(supabase); 
            if (notificacionesCampanitaContainer) notificacionesCampanitaContainer.innerHTML = '';
            campanitaInicializada = false;
        }
        updateUserInfo(null); 
        renderNavigation(null); 
        currentPathLoaded = null; 

        if (!window.location.pathname.endsWith('/login.html')) {
            console.log("[Auth] Usuario no autenticado. Redirigiendo a login.html.");
            window.location.href = '/login.html';
        } else {
            console.log("[Auth] Usuario no autenticado. Ya en login.html.");
            hideGlobalLoading(); // Ocultar si estaba visible
        }
    }
  });
  
  window.addEventListener('hashchange', async () => {
      console.log("[Router] Evento hashchange detectado. Nuevo hash:", window.location.hash);
      await router(); 
  });

  // --- LÓGICA DEL MENÚ HAMBURGUESA ---
  const hamburgerButton = document.getElementById('hamburger-button');
  const sidebar = document.getElementById('sidebar');
  const menuOverlay = document.getElementById('menu-overlay'); 
  // const mainContentArea = document.getElementById('main-content-area'); // Descomentar si usas pointerEvents

  if (hamburgerButton && sidebar) {
    hamburgerButton.addEventListener('click', () => {
      const isOpen = sidebar.classList.toggle('open');
      hamburgerButton.setAttribute('aria-expanded', String(isOpen)); // aria-expanded debe ser string "true" o "false"
      if (menuOverlay) {
        menuOverlay.classList.toggle('active', isOpen);
      }
      // if(mainContentArea) mainContentArea.style.pointerEvents = isOpen ? 'none' : 'auto'; 
    });
  }

  if (menuOverlay && sidebar) { // Solo añadir listener si menuOverlay existe
    menuOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      menuOverlay.classList.remove('active');
      if(hamburgerButton) hamburgerButton.setAttribute('aria-expanded', 'false');
      // if(mainContentArea) mainContentArea.style.pointerEvents = 'auto';
    });
  }
  // --- FIN LÓGICA MENÚ HAMBURGUESA ---

  // hideGlobalLoading() es llamado dentro del router o en onAuthStateChange si no hay usuario.
  // No es necesario una llamada explícita aquí, ya que onAuthStateChange se ejecutará.
}
document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('app-container')) {
      console.error("Falta #app-container en DOMContentLoaded.");
      if(document.body) document.body.innerHTML = "<p style='color:red; text-align:center;'>Error crítico: Falta #app-container.</p>";
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