// js/modules/gestion-hotel.js
// Módulo unificado para la gestión completa del hotel con pestañas.

// ======================= IMPORTACIONES Y SERVICIOS (Comunes) ========================
import { registrarEnBitacora } from '../../services/bitacoraservice.js';
import { crearNotificacion } from '../../services/NotificationService.js'; // Asumiendo que existe
import { ROOM_STATUS_OPTIONS } from '../../config.js'; // Para limpieza
import {
    showLoading, // Para mantenimiento y otros
    showError,   // Para mantenimiento y otros
    clearFeedback, // Para mantenimiento y otros
    showGlobalLoading, // Para limpieza
    hideGlobalLoading, // Para limpieza
    showAppFeedback,   // Para limpieza y habitaciones (admin)
    clearAppFeedback,  // Para limpieza y habitaciones (admin)
    setFormLoadingState // Para habitaciones (admin) y reservas (admin)
} from '../../uiUtils.js';


// ======================= VARIABLES GLOBALES DEL MÓDULO UNIFICADO ========================
let currentHotelId = null;
let currentSupabaseInstance = null;
let currentAppUser = null; // Renombrado de currentUser para evitar conflictos con params
let activeTab = 'mapa'; // Pestaña activa por defecto

// --- Variables específicas que antes eran globales en cada módulo ---
// Para Mapa de Habitaciones
let mapa_currentRooms = [];
let mapa_cronometrosInterval = {};

// Para Configuración de Habitaciones (admin)
let adminHab_moduleListeners = [];
let adminHab_todosLosTiemposEstanciaCache = [];
let adminHab_currentContainerEl = null;
let adminHab_hotelCheckin = "15:00";
let adminHab_hotelCheckout = "12:00";


// Para Limpieza
let limpieza_moduleListeners = [];

// Para Mantenimiento
let mantenimiento_moduleListeners = [];

// Para Gestión de Reservas (admin)
let adminRes_editMode = false;
let adminRes_editingReservaId = null;
let adminRes_originalFormSubmitHandler = null;
let adminRes_tiemposEstanciaDisponibles = [];


// ======================= FUNCIONES AUXILIARES COMUNES ========================
function formatCurrency(value, currency = 'COP') {
    if (typeof value !== 'number' || isNaN(value)) {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(0);
    }
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: currency, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

function formatHorasMin(minutos) {
    if (typeof minutos !== 'number' || isNaN(minutos) || minutos < 0) return "0h 0m";
    const horas = Math.floor(minutos / 60);
    const min = minutos % 60;
    return `${horas}h ${min}m`;
}

function formatDateTime(dateStr, locale = 'es-CO', options = { dateStyle: 'medium', timeStyle: 'short' }) {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString(locale, options);
}

// ======================= LÓGICA DE DATOS COMUNES (Supabase) ===========================
async function getHorariosHotelComun(supabase, hotelId) { /* ... tu función ... */ }
async function getTiemposEstanciaComun(supabase, hotelId) { /* ... tu función ... */ }
async function getMetodosPagoComun(supabase, hotelId) { /* ... tu función ... */ }

// (Copiar las implementaciones de getHorariosHotel, getTiemposEstancia, getMetodosPago aquí,
//  renombradas con "Comun" si es necesario para evitar conflictos con las que puedan
//  estar dentro de las secciones de los módulos que pegarás)
// EJEMPLO:
async function getHorariosHotelComun(supabase, hotelId) {
    const { data, error } = await supabase.from('hoteles').select('checkin_hora, checkout_hora').eq('id', hotelId).single();
    if (error) {
        console.error("Error obteniendo horarios del hotel:", error);
        return { checkin: "15:00", checkout: "12:00" };
    }
    return { checkin: data.checkin_hora || "15:00", checkout: data.checkout_hora || "12:00" };
}
async function getTiemposEstanciaComun(supabase, hotelId) {
    const { data, error } = await supabase.from('tiempos_estancia').select('*').eq('hotel_id', hotelId).eq('activo', true).order('minutos', { ascending: true });
    if (error) { console.error("Error obteniendo tiempos de estancia:", error); return []; }
    return data || [];
}
async function getMetodosPagoComun(supabase, hotelId) {
    const { data, error } = await supabase.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelId).eq('activo', true).order('nombre', { ascending: true });
    if (error) { console.error("Error obteniendo métodos de pago:", error); return []; }
    return data || [];
}


// ======================= SECCIÓN: MAPA DE HABITACIONES ========================
// (Aquí pegarás TODO el contenido de tu archivo `mapa-habitaciones.js` MÁS RECIENTE,
//  pero con las siguientes adaptaciones)

// 1. NO incluyas el import de bitacoraservice si ya está arriba.
// 2. Las funciones auxiliares de formato (formatCurrency, etc.) si son idénticas, usa las comunes de arriba.
// 3. Las funciones de datos (getHorariosHotel, etc.) si son idénticas, usa las comunes de arriba.
// 4. Renombra su `mount` a `mapa_mount` y su `unmount` a `mapa_unmount`.
// 5. Las variables globales como `currentRooms` y `cronometrosInterval` se referirán a `mapa_currentRooms` y `mapa_cronometrosInterval`.
// 6. La función `realizarCheckIn` la moveremos a un nivel superior (común) o la llamaremos directamente si es específica.
//    Por ahora, la mantendremos aquí, pero asegurándonos que use las variables globales correctas.

let mapa_mainAppContainer; // Para que mount pueda ser llamado desde otras funciones del mapa

async function mapa_realizarCheckIn(reserva, supabase, hotelId, currentUser) {
    // ... (tu lógica de realizarCheckIn que ya tenías en mapa-habitaciones.js)
    // ... usa mapa_mainAppContainer para llamar a mount al final
    // EJEMPLO de cómo se adaptaría:
    if (!reserva) { /*...*/ return; }
    if (reserva.monto_pagado < reserva.monto_total) { /*...*/ return; }
    const { data: reservaActualizada, error: updateError } = await supabase.from('reservas').update({
        estado: 'activa', fecha_inicio: new Date().toISOString()
    }).eq('id', reserva.id).select().single();
    if (updateError || !reservaActualizada) { /*...*/ return; }
    await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', reserva.habitacion_id);
    await supabase.from('cronometros').insert([{
        hotel_id: hotelId, reserva_id: reservaActualizada.id, habitacion_id: reservaActualizada.habitacion_id,
        fecha_inicio: reservaActualizada.fecha_inicio, fecha_fin: reservaActualizada.fecha_fin, activo: true
    }]);
    mapa_mostrarInfoModalGlobal(`Check-in para ${reserva.cliente_nombre}.`, "Éxito");
    const modalContainer = document.getElementById('gestion-hotel-modal-container'); // Usar el modal container global
    if (modalContainer) { modalContainer.style.display = "none"; modalContainer.innerHTML = ''; }
    await mountGestionHotel(mapa_mainAppContainer, supabase, currentUser, hotelId); // Llama al mount principal del módulo unificado
}


async function mapa_mount(tabContentContainer, supabase, currentUser, hotelId) {
    mapa_mainAppContainer = tabContentContainer; // Guardar referencia para otras funciones del mapa
    tabContentContainer.innerHTML = `
        <div class="mb-8 px-4 md:px-0">
            <h2 class="text-3xl font-bold text-gray-800 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-9 w-9 mr-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                Mapa de Habitaciones
            </h2>
        </div>
        <div id="mapa-room-map-list" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 px-4 md:px-0"></div>
        <div class="mt-12 px-4 md:px-0">
            <h3 class="text-2xl font-bold text-gray-700 mb-4">Próximas Reservas</h3>
            <div id="mapa-future-reservations-list" class="bg-white rounded-lg shadow p-4 space-y-3">
                <p class="text-gray-500">Cargando reservas futuras...</p>
            </div>
        </div>
        `;
    await mapa_renderRooms(tabContentContainer, supabase, currentUser, hotelId);
    await mapa_renderReservasFuturas(tabContentContainer, supabase, currentUser, hotelId);
}

function mapa_unmount() {
    Object.values(mapa_cronometrosInterval).forEach(clearInterval);
    mapa_cronometrosInterval = {};
    // El modal global se limpia en el unmount principal o al cambiar de tab
}

async function mapa_renderRooms(container, supabase, currentUser, hotelId) { /* ... tu función adaptada ... */ }
async function mapa_renderReservasFuturas(container, supabase, currentUser, hotelId) { /* ... tu función adaptada ... */ }
function mapa_roomCard(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... tu función adaptada ... */ }
function mapa_calcularDetallesEstancia(dataForm, room, tiempos, horarios, tarifaNocheUnica, fechaInicioOpcional = null) { /* ... */ }
function mapa_crearOpcionesNochesConPersonalizada(horarios, maxNoches, fechaBase, tarifaNocheUnica, room) { /* ... */ }
function mapa_crearOpcionesHoras(tiempos) { /* ... */ }
async function mapa_showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }
async function mapa_showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }
async function mapa_showReservaFuturaModal(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }
async function mapa_showAgregarPagoModal(reserva, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }
async function mapa_showEditarReservaModal(reserva, supabase, hotelId, mainAppContainer, currentUser) { /* ... */ }
async function mapa_confirmarEliminarReserva(reserva, supabase, mainAppContainer, currentUser, hotelId) { /* ... */ }
async function mapa_showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }
function mapa_startCronometro(room, supabase, hotelId, mainAppContainer, currentUser) { /* ... tu función adaptada, llamando a mountGestionHotel si es necesario ... */ }
function mapa_mostrarInfoModalGlobal(htmlContent, title = "Información") { /* ... DEBE USAR EL MODAL CONTAINER GLOBAL ... */ }
async function mapa_showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer) { /* ... */ }

// Dentro de mapa_mostrarInfoModalGlobal, el container debe ser el global:
// const container = document.getElementById('gestion-hotel-modal-container');


// ======================= SECCIÓN: CONFIGURACIÓN DE HABITACIONES Y TARIFAS (Admin) ========================
// (Aquí pegarás el contenido de tu archivo `habitaciones.js`)
// Adaptaciones:
// 1. Renombra `mount` a `adminHab_mount` y `unmount` a `adminHab_unmount`.
// 2. Usa las variables globales `adminHab_...` para su estado interno.
// 3. Las funciones de UI (showAppFeedback, etc.) y formato ya están importadas/definidas globalmente.
// 4. `currentHotelId`, `currentSupabaseInstance`, `currentModuleUser` serán pasados como parámetros.

async function adminHab_mount(tabContentContainer, supabase, currentUser, hotelId) {
    adminHab_currentContainerEl = tabContentContainer; // Guardar referencia para otras funciones del módulo
    // El resto de tu lógica de montaje de habitaciones.js
    // ...
    // Ejemplo de cómo adaptarías el inicio de tu mount original de habitaciones.js:
    console.log("[AdminHabitaciones/mount] Iniciando montaje...");
    adminHab_unmount(); // Limpia listeners anteriores de ESTA sección

    adminHab_currentSupabaseInstance = supabase;
    adminHab_currentModuleUser = currentUser;
    // currentHotelId ya está disponible globalmente en gestion-hotel.js

    tabContentContainer.innerHTML = `
        <div class="card habitaciones-module shadow-lg rounded-lg">
          <div class="card-header bg-gray-100 p-4 border-b">
            <h2 class="text-xl font-semibold text-gray-800">Gestión de Hotel: Habitaciones y Tiempos de Estancia</h2>
          </div>
          <div class="card-body p-4 md:p-6 space-y-8">
            <div id="adminHab-global-feedback" role="status" aria-live="polite" class="feedback-message mb-3" style="min-height: 24px;"></div>
            <div id="adminHab-config-horarios-hotel"></div>
            <section id="adminHab-section-tiempos-estancia" class="p-4 border rounded-md bg-gray-50 shadow-sm">
              </section>
            <hr class="my-8 border-t-2 border-gray-300"/>
            <section id="adminHab-section-habitaciones" class="p-4 border rounded-md bg-gray-50 shadow-sm">
              </section>
          </div>
        </div>`;
    
    // ... El resto de la lógica de tu mount de habitaciones.js, adaptando selectores de ID ...
    const feedbackGlobalEl = tabContentContainer.querySelector('#adminHab-global-feedback');
    // ...etc.

    // Asegúrate de que las funciones internas como cargarYRenderizarTiemposEstancia usen las
    // variables correctas (ej. adminHab_todosLosTiemposEstanciaCache) y los parámetros pasados.
}

function adminHab_unmount() {
    console.log("AdminHabitaciones.unmount: Limpiando listeners y estado...");
    adminHab_moduleListeners.forEach(({ element, type, handler }) => {
        if (element && typeof element.removeEventListener === 'function') {
            element.removeEventListener(type, handler);
        }
    });
    adminHab_moduleListeners = [];
    adminHab_todosLosTiemposEstanciaCache = [];
    adminHab_currentContainerEl = null;
}
// ... (Pega aquí el resto de funciones de tu habitaciones.js, adaptando nombres si es necesario)
// como: adminHab_parseTimeToDate, adminHab_calcMinutesBetween, adminHab_cargarYRenderizarTiemposEstancia, etc.


// ======================= SECCIÓN: LIMPIEZA ========================
// (Aquí pegarás el contenido de tu archivo `limpieza.js`)
// Adaptaciones:
// 1. Renombra `mount` a `limpieza_mount` y `unmount` a `limpieza_unmount`.
// 2. Usa `limpieza_moduleListeners`.
// 3. `currentHotelId`, `supabase`, `user` serán pasados como parámetros.

async function limpieza_mount(tabContentContainer, supabase, currentUser, hotelId) {
    limpieza_unmount(); // Limpiar listeners previos de ESTA sección
    // El resto de tu lógica de mount de limpieza.js
    // ...
    // Ejemplo:
    currentSupabaseInstance = supabase; // O usa 'supabase' directamente
    currentAppUser = currentUser;       // O usa 'currentUser' directamente
    // currentHotelId ya está disponible globalmente

    tabContentContainer.innerHTML = `
        <div class="card max-w-lg mx-auto shadow-lg rounded-lg">
          <div class="card-header bg-gray-100 p-4 border-b">
            <h2 class="text-xl font-semibold text-gray-800">Gestión de Limpieza</h2>
          </div>
          <div class="card-body p-4">
            <h3 class="font-medium mb-2">Habitaciones Pendientes de Limpieza</h3>
            <div id="limpieza-pendientes-feedback" class="mb-2"></div>
            <div id="limpieza-pendientes-list"></div>
          </div>
        </div>`;
    // ...El resto de tu lógica de montaje, adaptando selectores de ID...
}

function limpieza_unmount() {
    limpieza_moduleListeners.forEach(({ el, evt, fn }) => el.removeEventListener(evt, fn));
    limpieza_moduleListeners = [];
}
// ... (Pega aquí el resto de funciones de tu limpieza.js)


// ======================= SECCIÓN: MANTENIMIENTO ========================
// (Aquí pegarás el contenido de tu archivo `mantenimiento.js`)
// Adaptaciones:
// 1. Renombra `mount` a `mantenimiento_mount` y `unmount` a `mantenimiento_unmount`.
// 2. Usa `mantenimiento_moduleListeners`.

async function mantenimiento_mount(tabContentContainer, supabase, currentUser, hotelId) {
    mantenimiento_unmount();
    // El resto de tu lógica de mount de mantenimiento.js
    // ...
    tabContentContainer.innerHTML = `
        <h2 class="text-2xl font-bold mb-6">🛠️ Mantenimiento</h2>
        <div class="mb-4 flex flex-row gap-2">
          <select id="mantenimiento-filtro-estado" class="form-control w-auto">
            </select>
          <button id="mantenimiento-btn-filtrar" class="button button-primary">Filtrar</button>
          <button id="mantenimiento-btn-nueva-tarea" class="button button-success ml-auto">+ Nueva tarea</button>
        </div>
        <div id="mantenimiento-list"></div>
        `;
    // ... El resto de tu lógica, adaptando selectores de ID...
}

function mantenimiento_unmount() {
    mantenimiento_moduleListeners.forEach(fn => fn && fn());
    mantenimiento_moduleListeners = [];
}
// ... (Pega aquí el resto de funciones de tu mantenimiento.js)


// ======================= SECCIÓN: GESTIÓN DE RESERVAS (Admin) ========================
// (Aquí pegarás el contenido de tu archivo `reservas.js`)
// Adaptaciones:
// 1. Renombra `mount` a `adminRes_mount` y `unmount` a `adminRes_unmount` (si lo tuviera).
// 2. Usa las variables `adminRes_...`.

async function adminRes_mount(tabContentContainer, supabase, currentUser, hotelId) {
    // Lógica de montaje para la pestaña de gestión de todas las reservas
    // ...
    tabContentContainer.innerHTML = `
        <div class="max-w-4xl mx-auto mt-7 px-4">
          <h2 id="adminRes-form-title" class="text-2xl md:text-3xl font-bold mb-6 text-blue-800">Administrar Todas las Reservas</h2>
          <div id="adminRes-feedback" class="mb-6"></div>
          <div id="adminRes-list" class="mt-8"></div>
        </div>
    `;
    // ... Lógica para renderizar la lista completa de reservas, con filtros, etc.
    // ... Similar a renderReservas del mapa, pero más completa y con todas las reservas.
}

function adminRes_unmount() {
    // Lógica de limpieza si es necesaria para esta pestaña
}
// ... (Pega aquí el resto de funciones de tu reservas.js)


// ======================= LÓGICA PRINCIPAL DEL MÓDULO UNIFICADO ========================

function unmountCurrentTabContent() {
    if (activeTab === 'mapa' && typeof mapa_unmount === 'function') mapa_unmount();
    if (activeTab === 'adminHabitaciones' && typeof adminHab_unmount === 'function') adminHab_unmount();
    if (activeTab === 'limpieza' && typeof limpieza_unmount === 'function') limpieza_unmount();
    if (activeTab === 'mantenimiento' && typeof mantenimiento_unmount === 'function') mantenimiento_unmount();
    if (activeTab === 'adminReservas' && typeof adminRes_unmount === 'function') adminRes_unmount();

    // Limpiar el contenedor de modal global también al cambiar de pestaña
    const modalContainer = document.getElementById('gestion-hotel-modal-container');
    if (modalContainer) {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
    }
}

async function loadTabContent(tabId, tabContentContainer) {
    unmountCurrentTabContent(); // Limpia la pestaña anterior
    tabContentContainer.innerHTML = '<div class="p-8 text-center text-gray-500">Cargando contenido...</div>'; // Feedback de carga
    activeTab = tabId;

    // Resaltar pestaña activa
    document.querySelectorAll('#gestion-hotel-tabs .tab-button').forEach(btn => {
        btn.classList.remove('bg-blue-600', 'text-white');
        btn.classList.add('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');
    });
    document.querySelector(`#gestion-hotel-tabs .tab-button[data-tab="${tabId}"]`).classList.add('bg-blue-600', 'text-white');
    document.querySelector(`#gestion-hotel-tabs .tab-button[data-tab="${tabId}"]`).classList.remove('bg-gray-200', 'text-gray-700', 'hover:bg-gray-300');


    switch (tabId) {
        case 'mapa':
            await mapa_mount(tabContentContainer, currentSupabaseInstance, currentAppUser, currentHotelId);
            break;
        case 'adminHabitaciones':
            await adminHab_mount(tabContentContainer, currentSupabaseInstance, currentAppUser, currentHotelId);
            break;
        case 'limpieza':
            await limpieza_mount(tabContentContainer, currentSupabaseInstance, currentAppUser, currentHotelId);
            break;
        case 'mantenimiento':
            await mantenimiento_mount(tabContentContainer, currentSupabaseInstance, currentAppUser, currentHotelId);
            break;
        case 'adminReservas':
             await adminRes_mount(tabContentContainer, currentSupabaseInstance, currentAppUser, currentHotelId);
            break;
        default:
            tabContentContainer.innerHTML = `<p class="p-4 text-red-500">Pestaña no reconocida: ${tabId}</p>`;
    }
}

export async function mountGestionHotel(mainContainer, supabase, currentUser, hotelId) {
    console.log("Montando GestionHotel Module...");
    currentSupabaseInstance = supabase;
    currentAppUser = currentUser;
    currentHotelId = hotelId;

    if (!currentHotelId && currentUser && currentUser.id) {
        try {
            const { data: perfil, error: perfilError } = await supabase
                .from('usuarios').select('hotel_id').eq('id', currentUser.id).single();
            if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
            currentHotelId = perfil?.hotel_id;
        } catch (err) {
            console.error("GestionHotel: Error fetching hotelId from profile:", err);
        }
    }
    
    if (!currentHotelId) {
         mainContainer.innerHTML = `<div class="p-6 bg-red-100 text-red-700 rounded-md">Error crítico: No se pudo identificar el hotel para el usuario actual. Contacte a soporte.</div>`;
         return;
    }


    mainContainer.innerHTML = `
        <div class="gestion-hotel-container p-4 md:p-6">
            <div id="gestion-hotel-tabs" class="flex flex-wrap border-b border-gray-300 mb-6">
                <button class="tab-button text-sm md:text-base py-2 px-3 md:px-4 font-medium rounded-t-md" data-tab="mapa">Mapa de Habitaciones</button>
                <button class="tab-button text-sm md:text-base py-2 px-3 md:px-4 font-medium rounded-t-md" data-tab="adminReservas">Gestión de Reservas</button>
                <button class="tab-button text-sm md:text-base py-2 px-3 md:px-4 font-medium rounded-t-md" data-tab="limpieza">Limpieza</button>
                <button class="tab-button text-sm md:text-base py-2 px-3 md:px-4 font-medium rounded-t-md" data-tab="mantenimiento">Mantenimiento</button>
                <button class="tab-button text-sm md:text-base py-2 px-3 md:px-4 font-medium rounded-t-md" data-tab="adminHabitaciones">Config. Habitaciones/Tarifas</button>
            </div>
            <div id="gestion-hotel-tab-content" class="tab-content">
                </div>
        </div>
        <div id="gestion-hotel-modal-container" class="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" style="display:none;"></div>
    `;

    const tabContentContainer = mainContainer.querySelector('#gestion-hotel-tab-content');
    const tabButtons = mainContainer.querySelectorAll('#gestion-hotel-tabs .tab-button');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            loadTabContent(button.dataset.tab, tabContentContainer);
        });
    });

    // Cargar la pestaña por defecto (mapa)
    await loadTabContent(activeTab, tabContentContainer);
}

export function unmountGestionHotel() {
    console.log("Desmontando GestionHotel Module...");
    unmountCurrentTabContent(); // Limpia la pestaña activa actual
    
    // Limpiar variables globales del módulo unificado
    currentHotelId = null;
    currentSupabaseInstance = null;
    currentAppUser = null;
    activeTab = 'mapa';

    mapa_currentRooms = [];
    mapa_cronometrosInterval = {};
    adminHab_moduleListeners = [];
    adminHab_todosLosTiemposEstanciaCache = [];
    adminHab_currentContainerEl = null;
    limpieza_moduleListeners = [];
    mantenimiento_moduleListeners = [];
    adminRes_editMode = false;
    adminRes_editingReservaId = null;
    adminRes_originalFormSubmitHandler = null;
    adminRes_tiemposEstanciaDisponibles = [];

    const mainContainer = document.querySelector('.gestion-hotel-container'); // Asume que hay un contenedor principal
    if (mainContainer && mainContainer.parentElement) {
        mainContainer.parentElement.innerHTML = ''; // O la forma que uses para limpiar el contenedor de la app
    }
    const modalContainer = document.getElementById('gestion-hotel-modal-container');
    if (modalContainer) {
        modalContainer.remove(); // Eliminar el contenedor del modal al desmontar
    }
}