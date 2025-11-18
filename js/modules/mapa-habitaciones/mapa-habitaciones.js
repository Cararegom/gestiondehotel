// js/modules/mapa_habitaciones/mapa_habitaciones.js

// ======================= BLOQUE PRINCIPAL ========================
let containerGlobal = null;
let supabaseGlobal = null;
let currentUserGlobal = null;
let hotelIdGlobal = null;
let hotelConfigGlobal = null;
let currentRooms = [];
let cronometrosInterval = {};
import { turnoService } from '../../services/turnoService.js';
import { showClienteSelectorModal, mostrarFormularioCliente } from '../clientes/clientes.js';
import { formatCurrency, showError, registrarUsoDescuento, showGlobalLoading, hideGlobalLoading, showConsumosYFacturarModal, imprimirTicketHabitacion, mostrarInfoModalGlobal } from '../../uiUtils.js';



const estadoColores = {
    libre: { border: 'border-green-500', badge: 'bg-green-100 text-green-700', icon: `...` },
    ocupada: { border: 'border-yellow-500', badge: 'bg-yellow-100 text-yellow-700', icon: `...` },
    "tiempo agotado": { border: 'border-red-600', badge: 'bg-red-100 text-red-700', icon: `...` },
    mantenimiento: { border: 'border-orange-500', badge: 'bg-orange-100 text-orange-700', icon: `...` },
    limpieza: { border: 'border-cyan-500', badge: 'bg-cyan-100 text-cyan-700', icon: `...` },
    reservada: { border: 'border-indigo-500', badge: 'bg-indigo-100 text-indigo-700', icon: `...` },
    // agrega más si los tienes
};
 // SONIDO SOLO UNA VEZ
    let sonidoLanzado = false;
   function playPopSound() {
    const audio = new Audio('../../js/assets/notificacion.mp3'); // O la ruta correcta a tu archivo mp3
    audio.volume = 0.8;
    audio.play();
}
function cerrarModalContainer() {
  const cont = document.getElementById('modal-container');
  if (cont) {
    cont.style.display = 'none';
    cont.innerHTML = '';
  }
}
// Función robusta para asignar eventos a botones cuando estén en el DOM
function waitForButtonAndBind(id, fn) {
  let tries = 0;
  function tryBind() {
    const el = document.getElementById(id);
    if (el) {
      fn(el);
    } else if (++tries < 20) {
      setTimeout(tryBind, 100);
    }
  }
  tryBind();
}

function cerrarModalGlobal() {
    const container = document.getElementById('modal-global');
    if (container) {
        container.style.display = 'none';
        container.innerHTML = '';
    }
}

import { fetchTurnoActivo } from '../../services/turnoService.js';
/**
 * Busca y devuelve el mejor descuento automático aplicable para una habitación y fecha.
 * @param {object} supabase - Instancia de Supabase.
 * @param {string} hotelId - ID del hotel.
 * @param {string} habitacionId - ID de la habitación que se está reservando.
 * @param {Date} fechaDeEstancia - La fecha para la cual se quiere verificar el descuento.
 * @returns {object|null} - El objeto del descuento aplicable o null si no hay ninguno.
 */
async function buscarDescuentoAplicable(supabase, hotelId, habitacionId, fechaDeEstancia) {
    console.log(`[buscarDescuentoAplicable] Buscando descuento para Hab. ${habitacionId.substring(0,8)} en fecha ${fechaDeEstancia.toISOString()}`);
    
    const fechaISO = fechaDeEstancia.toISOString();

    const { data, error } = await supabase
        .from('descuentos')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .is('codigo', null) // Solo buscar descuentos automáticos (sin código)
        .lte('fecha_inicio', fechaISO) // La estancia debe ser después del inicio del descuento
        .gte('fecha_fin', fechaISO);    // Y antes del fin del descuento

    if (error) {
        console.error("Error buscando descuentos automáticos:", error);
        return null;
    }

    if (!data || data.length === 0) {
        console.log("[buscarDescuentoAplicable] No se encontraron descuentos activos para esta fecha.");
        return null;
    }

    // Filtrar por aplicabilidad
    const descuentosValidos = data.filter(d => {
        if (d.aplicabilidad === 'todas_las_habitaciones') {
            return true; // Aplica a todas
        }
        if (d.aplicabilidad === 'habitaciones_especificas') {
            // El ID de la habitación debe estar en la lista de habitaciones aplicables
            return d.habitaciones_aplicables && d.habitaciones_aplicables.includes(habitacionId);
        }
        return false;
    });

    if (descuentosValidos.length === 0) {
        console.log("[buscarDescuentoAplicable] Se encontraron descuentos por fecha, pero ninguno aplica a esta habitación específica.");
        return null;
    }

    // Lógica para decidir qué descuento aplicar si hay varios (ej. el de mayor valor)
    // Por ahora, simplemente devolvemos el primero que encontró.
    console.log("[buscarDescuentoAplicable] Descuento encontrado y aplicable:", descuentosValidos[0]);
    return descuentosValidos[0];
}

// PEGA ESTA NUEVA FUNCIÓN EN mapa-habitaciones.js



/**
 * Busca el mejor descuento aplicable para una lista de servicios.
 * @param {Array} serviciosSeleccionados - Array de objetos de servicio [{servicio_id, nombre, cantidad, precio}].
 * @param {string|null} codigoManual - El código opcional introducido por el usuario.
 * @returns {Promise<{descuento: object, monto: number, serviciosAplicadosNombres: string}|null>} - El descuento, monto, y los nombres de los servicios, o null.
 */
async function buscarDescuentoParaServicios(serviciosSeleccionados, codigoManual = null) {
    if (!serviciosSeleccionados || serviciosSeleccionados.length === 0) return null;

    const ahora = new Date().toISOString();
    let query = supabaseGlobal.from('descuentos').select('*')
        .eq('hotel_id', hotelIdGlobal)
        .eq('activo', true)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

    if (codigoManual) {
        query = query.eq('codigo', codigoManual.toUpperCase());
    } else {
        query = query.is('codigo', null).lte('fecha_inicio', ahora);
    }

    const { data: descuentos, error } = await query;
    if (error) {
        console.error("Error buscando descuentos para servicios:", error);
        return null;
    }

    if (!descuentos || descuentos.length === 0) return null;

    for (const d of descuentos) {
        if ((d.usos_maximos || 0) > 0 && (d.usos_actuales || 0) >= d.usos_maximos) continue;
        if (d.aplicabilidad !== 'servicios_adicionales') continue;

        const idsServiciosAplicables = d.habitaciones_aplicables || [];
        
        // Filtra los servicios de la promoción para obtener sus detalles
        const serviciosAfectados = serviciosSeleccionados
            .filter(s => idsServiciosAplicables.includes(s.servicio_id));

        const baseDescuento = serviciosAfectados.reduce((sum, s) => sum + (s.cantidad * s.precio), 0);

        if (baseDescuento > 0) {
            let montoADescontar = 0;
            if (d.tipo === 'porcentaje') {
                montoADescontar = baseDescuento * (d.valor / 100);
            } else {
                montoADescontar = d.valor;
            }
            montoADescontar = Math.min(montoADescontar, baseDescuento);

            // Obtenemos los nombres de los servicios para mayor claridad
            const nombresServiciosAplicados = serviciosAfectados.map(s => s.nombre).join(', ');

            console.log(`Descuento encontrado: ${d.nombre}, Monto: ${montoADescontar}`);
            return { 
                descuento: d, 
                monto: montoADescontar,
                serviciosAplicadosNombres: nombresServiciosAplicados // Devolvemos los nombres
            };
        }
    }

    return null;
}

/**
 * Busca un descuento aplicable para un alquiler desde el mapa de habitaciones.
 * @param {string} habitacionId - El ID de la habitación para la que se busca el descuento.
 * @param {string|null} codigoManual - El código opcional introducido por el usuario.
 * @returns {Promise<object|null>} El objeto del descuento o null.
 */

async function buscarDescuentoParaAlquiler(supabase, hotelId, clienteId, habitacionId, codigoManual = null, minutosSeleccionados = 0, nochesSeleccionadas = 0, tiempos = []) {
    if (!habitacionId && !codigoManual && !clienteId && minutosSeleccionados === 0 && nochesSeleccionadas === 0) return null;

    const ahora = new Date().toISOString();
    let query = supabase.from('descuentos').select('*')
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

    const orConditions = ['tipo_descuento_general.eq.automatico'];
    if (codigoManual) { orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`); }
    if (clienteId) { orConditions.push(`cliente_id.eq.${clienteId}`); }
    query = query.or(orConditions.join(','));

    const { data: descuentosPotenciales, error } = await query;
    if (error) { console.error("Error buscando descuentos:", error); return null; }

    const descuentosValidos = descuentosPotenciales.filter(d => (d.usos_maximos || 0) === 0 || (d.usos_actuales || 0) < d.usos_maximos);
    
    // Prioridad de búsqueda:
    if (clienteId) { const d = descuentosValidos.find(d => d.cliente_id === clienteId); if (d) return d; }
    if (codigoManual) { const d = descuentosValidos.find(d => d.codigo && d.codigo.toUpperCase() === codigoManual.toUpperCase()); if (d) return d; }

    for (const descuento of descuentosValidos) {
        const aplicabilidad = descuento.aplicabilidad;
        const itemsAplicables = descuento.habitaciones_aplicables || [];

        if (aplicabilidad === 'tiempos_estancia_especificos') {
            // --- INICIO DE LA LÓGICA CORREGIDA (similar a reservas.js) ---
            if (nochesSeleccionadas > 0 && itemsAplicables.includes('NOCHE_COMPLETA')) {
                // Si el alquiler es por noches, y el descuento aplica a "NOCHE_COMPLETA"
                return descuento;
            }
            if (minutosSeleccionados > 0) {
                // Si el alquiler es por horas, busca el ID del tiempo por hora
                const tiempoHoraObj = tiempos.find(t => t.minutos === minutosSeleccionados);
                if (tiempoHoraObj && itemsAplicables.includes(tiempoHoraObj.id)) {
                    return descuento;
                }
            }
            // --- FIN DE LA LÓGICA CORREGIDA ---
        }
        else if (aplicabilidad === 'habitaciones_especificas' && habitacionId && itemsAplicables.includes(habitacionId)) {
            return descuento;
        }
        else if (aplicabilidad === 'reserva_total') {
            return descuento;
        }
    }
    
    return null;
}




async function obtenerReservaActivaIdDeHabitacion(habitacionId) {
  const { data, error } = await supabase
    .from('reservas')
    .select('id')
    .eq('habitacion_id', habitacionId)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();
  return data?.id || null;
}

// ---------------------------------------------------
// Exporta la función para usarla desde los botones:

export async function imprimirConsumosHabitacion(supabase, hotelId, datosTicket) {
  await imprimirTicketHabitacion({
    supabase,
    hotelId,
    datosTicket,
    tipoDocumento: 'Ticket de Consumo'
  });
}

// --- Funciones auxiliares de formato ---
// REEMPLAZA TU FUNCIÓN formatCurrency ACTUAL CON ESTA VERSIÓN MEJORADA



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

// js/modules/mapa_habitaciones/mapa_habitaciones.js

// js/modules/mapa_habitaciones/mapa_habitaciones.js

function renderFloorFilters(allRooms, containerEl, gridEl, supabase, currentUser, hotelId) {
    if (!containerEl) return;

    const floors = [...new Set(allRooms.map(r => r.piso).filter(p => p != null))].sort((a, b) => a - b);

    let filtersHTML = `<button class="floor-filter-btn active" data-floor="all">Todos</button>`;
    floors.forEach(floor => {
        filtersHTML += `<button class="floor-filter-btn" data-floor="${floor}">Piso ${floor}</button>`;
    });
    containerEl.innerHTML = filtersHTML;

    containerEl.addEventListener('click', (e) => {
        const target = e.target;
        if (!target.matches('.floor-filter-btn')) return;

        containerEl.querySelectorAll('.floor-filter-btn').forEach(btn => btn.classList.remove('active'));
        target.classList.add('active');

        const selectedFloor = target.dataset.floor;
        const roomsToRender = selectedFloor === 'all'
            ? allRooms
            : allRooms.filter(room => String(room.piso) === selectedFloor);
        
        gridEl.innerHTML = '';
        const mainAppContainer = gridEl; // El contenedor sigue siendo el grid

        roomsToRender.forEach(room => {
            // --- CORRECCIÓN AQUÍ ---
            // Se pasa 'mainAppContainer' (que es gridEl) a la función roomCard.
            gridEl.appendChild(roomCard(room, supabase, currentUser, hotelId, mainAppContainer));
            if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
                startCronometro(room, supabase, hotelId, gridEl);
            }
        });
    });
}




// ======================= LÓGICA DE DATOS (Supabase) ===========================
async function getHorariosHotel(supabase, hotelId) {
    // Ya tenemos la configuración cargada en hotelConfigGlobal al inicio del módulo
    if (hotelConfigGlobal && hotelConfigGlobal.hotel_id === hotelId) {
        // console.log("Usando horarios desde hotelConfigGlobal:", hotelConfigGlobal.checkin_hora_config, hotelConfigGlobal.checkout_hora_config);
        return {
            checkin: hotelConfigGlobal.checkin_hora_config || "15:00", // Usamos el default si no está
            checkout: hotelConfigGlobal.checkout_hora_config || "12:00" // Usamos el default si no está
        };
    } else {
        // Si por alguna razón hotelConfigGlobal no está (esto no debería pasar si mount funcionó bien)
        // o no coincide el hotel_id, intentamos cargarla directamente como fallback.
        // Pero idealmente, esto indica un problema en el flujo de carga inicial.
        console.warn("ADVERTENCIA: hotelConfigGlobal no disponible o no coincide en getHorariosHotel. Intentando carga directa de configuración para horarios.");
        try {
            const { data, error } = await supabase
                .from('configuracion_hotel')
                .select('checkin_hora_config, checkout_hora_config')
                .eq('hotel_id', hotelId)
                .single();

            if (error) {
                console.error("Error obteniendo horarios desde configuracion_hotel (fallback):", error);
                return { checkin: "15:00", checkout: "12:00" }; // Defaults si todo falla
            }
            // Asegurarse que data no sea null y tenga las propiedades
            if (data) {
                 return {
                    checkin: data.checkin_hora_config || "15:00",
                    checkout: data.checkout_hora_config || "12:00"
                };
            } else {
                console.error("No se encontraron datos de configuración de horarios para el hotel (fallback).");
                return { checkin: "15:00", checkout: "12:00" }; // Defaults
            }
        } catch (e) {
            console.error("Excepción en fallback de getHorariosHotel:", e);
            return { checkin: "15:00", checkout: "12:00" }; // Defaults en caso de excepción
        }
    }
}

async function puedeHacerCheckIn(reservaId) {
    // Verificar la configuración global del hotel.
    // Esta variable hotelConfigGlobal debe ser llenada en la función mount de mapa-habitaciones.js
    if (hotelConfigGlobal && hotelConfigGlobal.cobro_al_checkin === false) {
        console.log("[Mapa Habitaciones] puedeHacerCheckIn: Política es Cobro al Checkout. Check-in permitido sin verificar pago para reserva:", reservaId);
        return true; // Permite el check-in inmediatamente si la política es cobrar al checkout
    }

    // Si la política es cobrar al check-in (o la configuración no está disponible), proceder con la verificación de pago
    console.log("[Mapa Habitaciones] puedeHacerCheckIn: Política es Cobro al Check-in (o default). Verificando pago para reserva:", reservaId);
    const supabase = supabaseGlobal; // Usar la instancia global de Supabase

    const { data: reserva, error: errReserva } = await supabase
        .from('reservas')
        .select('id, monto_total, cliente_nombre') // cliente_nombre para un mensaje más amigable
        .eq('id', reservaId)
        .single();

    if (errReserva || !reserva) {
        console.error("Error obteniendo reserva para puedeHacerCheckIn:", errReserva);
        Swal.fire({
            icon: 'error',
            title: 'Error de Datos',
            text: 'No se pudo obtener la información de la reserva para verificar el pago.',
            confirmButtonColor: '#1d4ed8' // Azul consistente
        });
        return false;
    }

    // Si la reserva no tiene monto a pagar (ej. cortesía o error), permitir check-in
    if (!reserva.monto_total || reserva.monto_total <= 0) {
        console.log("[Mapa Habitaciones] puedeHacerCheckIn: Reserva sin monto a pagar. Check-in permitido.");
        return true;
    }

    const { data: pagos, error: errPagos } = await supabase
        .from('pagos_reserva') // Nombre de tu tabla de pagos asociados a reservas
        .select('monto')
        .eq('reserva_id', reservaId);

    if (errPagos) {
        console.error("Error consultando pagos para puedeHacerCheckIn:", errPagos);
        Swal.fire({
            icon: 'error',
            title: 'Error de Consulta',
            text: 'No se pudieron consultar los pagos de la reserva.',
            confirmButtonColor: '#1d4ed8'
        });
        return false;
    }

    const totalPagado = pagos ? pagos.reduce((sum, p) => sum + Number(p.monto), 0) : 0;

    if (totalPagado >= reserva.monto_total) {
        console.log(`[Mapa Habitaciones] puedeHacerCheckIn: Pago completo para reserva ${reservaId}. Check-in permitido.`);
        return true;
    } else {
        const pendiente = reserva.monto_total - totalPagado;
        const monedaSimbolo = hotelConfigGlobal?.moneda_local_simbolo || hotelConfigGlobal?.moneda_local || '$';
        // Asumiendo que formatCurrency puede tomar el símbolo de hotelConfigGlobal o un default
        
        console.log(`[Mapa Habitaciones] puedeHacerCheckIn: Pago incompleto para reserva ${reservaId}. Pendiente: ${formatCurrency(pendiente, monedaSimbolo)}`);
        Swal.fire({
            icon: 'warning',
            title: 'Pago Pendiente para Check-in',
            html: `La reserva de <strong>${reserva.cliente_nombre || 'este huésped'}</strong> tiene un saldo pendiente de <strong>${formatCurrency(pendiente, monedaSimbolo)}</strong>.<br/>Según la política del hotel, se requiere el pago total de <strong>${formatCurrency(reserva.monto_total, monedaSimbolo)}</strong> para realizar el check-in.`,
            confirmButtonText: 'Entendido',
            confirmButtonColor: '#1d4ed8'
        });
        return false;
    }
}
async function getTiemposEstancia(supabase, hotelId) {
    const { data, error } = await supabase.from('tiempos_estancia')
        .select('*') 
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .order('minutos', { ascending: true });
    if (error) {
        console.error("Error obteniendo tiempos de estancia:", error);
        return [];
    }
    return data || [];
}

async function getMetodosPago(supabase, hotelId) {
    const { data, error } = await supabase.from('metodos_pago')
        .select('id, nombre')
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .order('nombre', { ascending: true });
    if (error) {
        console.error("Error obteniendo métodos de pago:", error);
        return [];
    }
    return data || [];
}

// ======================= LÓGICA DE RENDERIZADO DE HABITACIONES ===========================

import { checkTurnoActivo } from '../../services/turnoService.js';

export async function mount(container, supabase, currentUser, hotelId) {
    containerGlobal = container;
    supabaseGlobal = supabase;
    currentUserGlobal = currentUser;
    hotelIdGlobal = hotelId;
// Cargar la configuración del hotel ANTES de cualquier otra cosa
    try {
        const { data: configData, error: configError } = await supabaseGlobal
            .from('configuracion_hotel')
            .select('*')
            .eq('hotel_id', hotelIdGlobal)
            .maybeSingle();

        if (configError) {
            console.error("Error crítico cargando configuración del hotel:", configError);
            // Mostrar un mensaje al usuario aquí si es necesario
            container.innerHTML = `<div class="p-4 text-red-700 bg-red-100 rounded">Error cargando la configuración esencial del hotel. Algunas funciones podrían no operar correctamente.</div>`;
            return; // Detener si no se puede cargar la configuración
        }
        hotelConfigGlobal = configData || {}; // Si no hay config, usamos un objeto vacío como default
        // console.log("Configuración del hotel cargada:", hotelConfigGlobal); // Para depurar

        // Establecer algunos defaults si no vienen en la configuración, para evitar errores más adelante
        hotelConfigGlobal.cobro_al_checkin = hotelConfigGlobal.hasOwnProperty('cobro_al_checkin') ? hotelConfigGlobal.cobro_al_checkin : true; // Default: cobrar al check-in
        hotelConfigGlobal.checkin_hora_config = hotelConfigGlobal.checkin_hora_config || '15:00';
        hotelConfigGlobal.checkout_hora_config = hotelConfigGlobal.checkout_hora_config || '12:00';

    } catch (e) {
        console.error("Excepción al cargar configuración del hotel:", e);
        container.innerHTML = `<div class="p-4 text-red-700 bg-red-100 rounded">Error fatal al cargar la configuración del hotel.</div>`;
        return;
    }

    // ==== CHEQUEO DE TURNO ACTIVO ====
    const hayTurno = await checkTurnoActivo(supabase, hotelId, currentUser.id);
    if (!hayTurno) return; // No sigas si no hay turno abierto

    // Pinta el HTML base primero
   container.innerHTML = `
        <div class="mb-8 px-4 md:px-0">
            <h2 class="text-3xl font-bold text-gray-800 flex items-center">
                Mapa de Habitaciones
            </h2>
        </div>

        <div id="floor-filter-container" class="flex flex-wrap items-center gap-2 mb-6 pb-4 border-b border-slate-200 px-4 md:px-0">
            </div>

        <div id="room-map-list" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 px-4 md:px-0"></div>
        
        <div id="modal-container" class="fixed inset-0 z-[100] flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 pt-8 overflow-y-auto" style="display:none;"></div>
        
        <div id="modal-container-secondary" class="fixed inset-0 z-[200] flex items-start justify-center bg-black/60 p-4 pt-8 overflow-y-auto" style="display:none;"></div>
        `;
    // Selecciona el contenedor de habitaciones después de inyectar el HTML
    const roomsListEl = container.querySelector("#room-map-list");
    if (!roomsListEl) {
        console.error("No se encontró el div #room-map-list dentro del container. Corrige el template HTML.");
        return;
    }

    // Llama a renderRooms para pintar las tarjetas
    await renderRooms(roomsListEl, supabase, currentUser, hotelId);
}




async function renderRooms(gridEl, supabase, currentUser, hotelId) {
    if (!gridEl) {
        console.error("renderRooms: gridEl es null o indefinido.");
        return;
    }
    const filterContainer = document.getElementById('floor-filter-container');

    Object.values(cronometrosInterval).forEach(clearInterval);
    cronometrosInterval = {};
    gridEl.innerHTML = `<div class="col-span-full text-center text-slate-500 p-6">Cargando habitaciones...</div>`;

    const { data: habitaciones, error } = await supabase
        .from('habitaciones')
        .select('*, reservas(estado, fecha_inicio, historial_articulos_prestados(id, articulo_nombre, accion, item_prestable_id))')
        .eq('hotel_id', hotelId)
        .order('nombre', { ascending: true });

    if (error) {
        gridEl.innerHTML = `<div class="col-span-full text-red-600 p-4 bg-red-100 rounded-md">Error: ${error.message}</div>`;
        return;
    }

    currentRooms = habitaciones;

    // ================== INICIO DE LA LÓGICA DE CORRECCIÓN ==================
    // Aquí añadimos la lógica para verificar y cambiar el estado dinámicamente.

   const ahora = new Date();
const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

currentRooms.forEach(room => {
  // Si no hay arreglo de reservas, no hacemos nada
  if (!Array.isArray(room.reservas) || room.reservas.length === 0) return;

  // Tomamos la próxima reserva futura en estado 'reservada'
  const proximaReserva = room.reservas
    .filter(r => r.estado === 'reservada' && new Date(r.fecha_inicio) > ahora)
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio))[0];

  if (!proximaReserva) return;

  const inicioReserva = new Date(proximaReserva.fecha_inicio);
  const diff = inicioReserva.getTime() - ahora.getTime();

  // Si faltan más de 3 horas: mostrar "LIBRE" (solo para la vista),
  // excepto si realmente está ocupada/agotada/limpieza/mantenimiento.
  if (diff > TRES_HORAS_MS) {
    if (!['ocupada', 'tiempo agotado', 'limpieza', 'mantenimiento'].includes(room.estado)) {
      room.estado = 'libre';
    }
    return;
  }

  // Si faltan entre 0 y 3 horas: mostrar "RESERVADA"
  if (diff > 0 && diff <= TRES_HORAS_MS) {
    room.estado = 'reservada';
  }
});
    // =================== FIN DE LA LÓGICA DE CORRECCIÓN ====================


    const mainAppContainer = gridEl;
    
    renderFloorFilters(currentRooms, filterContainer, gridEl, supabase, currentUser, hotelId);
    
    gridEl.innerHTML = ''; 
    if (!currentRooms || currentRooms.length === 0) {
        gridEl.innerHTML = `<div class="col-span-full text-gray-500 p-4 text-center">No hay habitaciones.</div>`;
        return;
    }
    
    currentRooms.sort((a, b) => {
        const getNumber = nombre => {
            const match = String(nombre || '').match(/\d+/);
            return match ? parseInt(match[0], 10) : Infinity;
        };
        return getNumber(a.nombre) - getNumber(b.nombre);
    });

    currentRooms.forEach(room => {
        // Ahora, cuando se llame a roomCard, algunas habitaciones ya tendrán su estado modificado a 'reservada'.
        gridEl.appendChild(roomCard(room, supabase, currentUser, hotelId, mainAppContainer));
        if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
            startCronometro(room, supabase, hotelId, gridEl);
        }
    });
}

// Añade esta función en: js/modules/mapa_habitaciones/mapa_habitaciones.js

// Añade esta función en: js/modules/mapa_habitaciones/mapa_habitaciones.js

/**
 * Devuelve un icono SVG basado en el nombre de la amenidad.
 * @param {string} amenityText - El texto de la amenidad (ej: "wifi", "tv", "ac").
 * @returns {string} - El string del SVG del icono.
 */
function getAmenityIcon(amenityText) {
    const text = amenityText.toLowerCase().trim();
    const iconClass = "h-4 w-4 text-cyan-600";

    if (text.includes('wifi')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="${iconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10 10 0 0114.142 0M1.394 8.929a15 15 0 0121.212 0" /></svg>`;
    }
    if (text.includes('tv')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="${iconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>`;
    }
    if (text.includes('ac') || text.includes('aire')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="${iconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h2M8 16h8" /></svg>`;
    }
    if (text.includes('baño')) {
        return `<svg xmlns="http://www.w3.org/2000/svg" class="${iconClass}" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a1 1 0 00-1 1v1a1 1 0 002 0V3a1 1 0 00-1-1zM4 12a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM15 12a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM8 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1zM12 8a1 1 0 00-1 1v2a1 1 0 102 0V9a1 1 0 00-1-1z" /><path fill-rule="evenodd" d="M4.09 14.342A5.993 5.993 0 004 15a6 6 0 1012 0 5.993 5.993 0 00-.09-1.658l.102.002a2.999 2.999 0 013.185 2.51L19.5 16.5a1.5 1.5 0 01-1.5 1.5H2A1.5 1.5 0 01.5 16.5l.303-.646a2.999 2.999 0 013.186-2.511l.1-.001z" clip-rule="evenodd" /></svg>`;
    }
    // Icono por defecto
    return `<svg xmlns="http://www.w3.org/2000/svg" class="${iconClass}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>`;
}


// Reemplaza esta función completa en: js/modules/mapa_habitaciones/mapa_habitaciones.js

// js/modules/mapa_habitaciones/mapa_habitaciones.js

function roomCard(room, supabase, currentUser, hotelId, mainAppContainer) {
    const card = document.createElement('div');
    card.className = `room-card bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 ease-in-out hover:shadow-cyan-200/50 hover:border-cyan-500 border-2 border-transparent flex flex-col group`;

    // --- Lógica de estado y badge (sin cambios) ---
    let badgeBgClass = 'bg-slate-100 text-slate-700';
    let estadoText = room.estado ? room.estado.toUpperCase().replace(/_/g, " ") : 'DESCONOCIDO';
    if (estadoColores[room.estado]) {
        badgeBgClass = estadoColores[room.estado].badge;
    }
    
    // --- Lógica para mostrar la imagen (sin cambios) ---
    const imageBannerHTML = room.imagen_url
        ? `<div class="relative h-48 bg-slate-200"><img src="${room.imagen_url}" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" alt="Habitación ${room.nombre}" /></div>`
        : '';

    // --- INICIO DE LA NUEVA LÓGICA: Mostrar información de la reserva ---
    let reservaInfoHTML = '';
    if (room.estado === 'reservada' && Array.isArray(room.reservas) && room.reservas.length > 0) {
        // Encontrar la primera reserva que tenga el estado 'reservada'
        const reservaActiva = room.reservas.find(r => r.estado === 'reservada');
        if (reservaActiva && reservaActiva.fecha_inicio) {
            const iconCalendar = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
            reservaInfoHTML = `
                <div class="mt-3 pt-3 border-t border-slate-100 text-sm">
                    <p class="flex items-center text-indigo-700 font-semibold">
                        ${iconCalendar}
                        <span>Llega: ${formatDateTime(reservaActiva.fecha_inicio)}</span>
                    </p>
                </div>
            `;
        }
    }
    // --- FIN DE LA NUEVA LÓGICA ---

    // Nuevo (Bloque de Reemplazo)
// --- INICIO DE NUEVA LÓGICA: Mostrar artículos en seguimiento ---
const reservaOcupada = (Array.isArray(room.reservas) && room.reservas.length > 0)
    ? room.reservas.find(r => ['ocupada', 'activa', 'tiempo agotado'].includes(r.estado))
    : null;

// Filtramos el historial para mostrar solo los que están 'prestados'
const articulosEnSeguimiento = reservaOcupada?.historial_articulos_prestados?.filter(h => h.accion === 'prestado') || [];
let articulosInfoHTML = '';

if (articulosEnSeguimiento.length > 0) {
    const iconEntrega = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor"><path d="M8 4a1 1 0 011 1v1H8a1 1 0 010-2zm0 3h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V8a1 1 0 011-1z" /><path fill-rule="evenodd" d="M4 3a2 2 0 012-2h8a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V3zm2 1h8v12H6V4z" clip-rule="evenodd" /></svg>`;
    articulosInfoHTML = `
        <div class="mt-3 pt-3 border-t border-slate-100 text-sm">
            <p class="flex items-center text-blue-700 font-semibold mb-2">
                ${iconEntrega}
                <span>Artículos Prestados:</span>
            </p>
            <div class="flex flex-wrap gap-1.5">
                ${articulosEnSeguimiento.map(item => `<span class="badge bg-blue-100 text-blue-800 px-2 py-0.5 text-xs font-medium rounded-full">${item.articulo_nombre}</span>`).join('')}
            </div>
        </div>
    `;
}
// --- FIN DE LA NUEVA LÓGICA ---

    card.innerHTML = `
        ${imageBannerHTML}
        <div class="p-4 flex-grow flex flex-col">
            <div class="flex justify-between items-start mb-3"> 
                <div>
                    <h3 class="text-lg font-bold text-slate-800">${room.nombre}</h3>
                    <p class="text-sm text-slate-500 -mt-1">${room.tipo || 'No especificado'}</p>
                </div>
                <span class="badge ${badgeBgClass} px-2.5 py-1 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm flex-shrink-0">
                    ${estadoText}
                </span>
            </div>

            ${reservaInfoHTML}
           
            ${reservaInfoHTML}

            ${articulosInfoHTML}

            ${room.amenidades && room.amenidades.length > 0 ? `
            
                <div class="mt-3 pt-3 border-t border-slate-100 flex-grow">
                    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
                        ${room.amenidades.map(am => `<div class="flex items-center gap-1.5 text-sm text-slate-600">${getAmenityIcon(am)}<span class="capitalize">${am}</span></div>`).join('')}
                    </div>
                </div>`
                : '<div class="flex-grow"></div>'
            }
        </div>
        <div class="bg-gray-50 border-t border-gray-200 px-4 py-1">
             <div id="cronometro-${room.id}" class="cronometro-display text-right font-mono text-base flex items-center justify-end text-slate-600 h-6">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span id="cronometro-text-${room.id}" class="w-full text-center"></span>
            </div>
        </div>
    `;

 card.onclick = () => showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer);
    
    return card;
}
function updateClienteFields(cliente) {
    const newClientFieldsContainer = ui.container.querySelector('#new-client-fields');
    const clienteNombreManualInput = ui.form.elements.cliente_nombre;

    if (cliente) {
        // --- Rellenar los campos del formulario ---
        ui.clienteIdHiddenInput.value = cliente.id;
        clienteNombreManualInput.value = cliente.nombre; // También llenamos el input manual
        ui.form.elements.cedula.value = cliente.documento || '';
        ui.form.elements.telefono.value = cliente.telefono || '';

        // --- Mostrar el display del cliente seleccionado ---
        ui.clienteNombreDisplay.querySelector('#selected_client_name').textContent = cliente.nombre;
        ui.clienteNombreDisplay.classList.remove('hidden');
        
        // --- Ocultar los campos para crear cliente nuevo ---
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'none';
        clienteNombreManualInput.required = false;

    } else {
        // --- Limpiar todo si se deselecciona el cliente ---
        ui.clienteIdHiddenInput.value = '';
        clienteNombreManualInput.value = '';
        ui.form.elements.cedula.value = '';
        ui.form.elements.telefono.value = '';

        // --- Ocultar el display y mostrar los campos manuales de nuevo ---
        ui.clienteNombreDisplay.classList.add('hidden');
        if(newClientFieldsContainer) newClientFieldsContainer.style.display = 'block';
        clienteNombreManualInput.required = true;
    }
}


// ================== MODAL OPCIONES HABITACIÓN ===================
async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.style.display = "flex";
  modalContainer.innerHTML = "";

let botonesHtml = '';

// Estilos compactos
const btnPrincipal = "w-full mb-2 py-2.5 rounded-lg text-white font-semibold bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";
const btnSecundario = "w-full mb-2 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 shadow-sm hover:shadow flex items-center justify-center gap-2";
const btnVerde = "w-full mb-2 py-2.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 font-medium border border-green-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
const btnNaranja = "w-full mb-2 py-2.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium border border-orange-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
const btnRojo = "w-full mt-4 py-2.5 rounded-lg text-white font-semibold bg-red-600 hover:bg-red-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";

// LIBRE
if (room.estado === "libre") {
    botonesHtml += `<button id="btn-alquilar-directo" class="${btnPrincipal}"><span style="font-size:1.2em">🛏️</span> Alquilar Ahora</button>`;
    botonesHtml += `<button id="btn-enviar-limpieza" class="${btnSecundario}"><span style="font-size:1.2em">🧹</span> Enviar a Limpieza</button>`;
}

// OCUPADA, RESERVADA, TIEMPO AGOTADO
else if (["ocupada", "reservada", "tiempo agotado"].includes(room.estado)) {
    botonesHtml += `<button id="btn-extender-tiempo" class="${btnPrincipal}"><span style="font-size:1.2em">⏱️</span> Extender Tiempo</button>`;
    botonesHtml += `<button id="btn-entregar" class="${btnSecundario}"><span style="font-size:1.2em">🔓</span> Liberar Habitación</button>`;
    botonesHtml += `<button id="btn-ver-consumos" class="${btnSecundario}"><span style="font-size:1.2em">🍽️</span> Ver Consumos</button>`;
    botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
    botonesHtml += `<button id="btn-seguimiento-articulos" class="${btnSecundario}"><span style="font-size:1.2em">📦</span> Gestionar Artículos</button>`;
}

// SERVICIOS ADICIONALES
if (["ocupada", "tiempo agotado"].includes(room.estado)) {
    botonesHtml += `<button id="btn-servicios-adicionales" class="${btnVerde}"><span style="font-size:1.2em">🛎️</span> Servicios adicionales</button>`;
}

// MANTENIMIENTO
if (["libre", "ocupada", "tiempo agotado", "limpieza", "reservada"].includes(room.estado)) {
    botonesHtml += `<button id="btn-mantenimiento" class="${btnNaranja}"><span style="font-size:1.2em">🛠️</span> Enviar a Mantenimiento</button>`;
}

// CHECK-IN
let reservaFutura = null;
if (room.estado === "reservada") {
    const { data, error } = await supabase.from('reservas').select('*').eq('habitacion_id', room.id).eq('estado', 'reservada').order('fecha_inicio', { ascending: false }).limit(1).single();

    if (!error && data) {
        reservaFutura = data;
        const fechaInicio = new Date(reservaFutura.fecha_inicio);
        const ahora = new Date();
        const diferenciaMin = (fechaInicio - ahora) / 60000;

        if (diferenciaMin <= 120) {
            botonesHtml += `<button id="btn-checkin-reserva" class="${btnVerde}"><span style="font-size:1.2em">✅</span> Check-in ahora</button>`;
        } else {
            botonesHtml += `<div class="text-center text-xs text-gray-500 mb-2"><span style="font-size:1.1em">⏳</span> Check-in habilitado desde: ${new Date(fechaInicio.getTime() - 120 * 60000).toLocaleString('es-CO')}</div>`;
        }

        botonesHtml += `<div class="bg-gray-50 rounded p-2 mb-2 text-xs">
            <b>Reserva:</b> ${reservaFutura.cliente_nombre}<br>
            <b>Tel:</b> ${reservaFutura.telefono}<br>
            <b>Huéspedes:</b> ${reservaFutura.cantidad_huespedes}<br>
            <b>Llegada:</b> ${fechaInicio.toLocaleString('es-CO')}
        </div>`;
    } else {
        botonesHtml += `<div class="text-xs text-red-500 mb-2">No se encontró la reserva activa para check-in.</div>`;
    }
}

// INFO HUÉSPED
if (room.estado !== "libre" && room.estado !== "mantenimiento") {
    botonesHtml += `<button id="btn-info-huesped" class="${btnSecundario}"><span style="font-size:1.2em">👤</span> Ver Info Huésped</button>`;
}

// CERRAR
botonesHtml += `<button id="close-modal-acciones" class="${btnRojo}"><span style="font-size:1.2em">❌</span> Cerrar</button>`;

  // Render modal content
  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up";
  modalContent.innerHTML = `
      <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">${room.nombre} (${room.estado ? room.estado.toUpperCase() : 'N/A'})</h3>
      <div class="flex flex-col gap-2.5">
          ${botonesHtml}
      </div>
  `;
  modalContainer.appendChild(modalContent);
  modalContainer.onclick = (e) => {
    if (e.target === modalContainer) {
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
    }
  };

  // Función para asociar eventos a los botones
  const setupButtonListener = (id, handler) => {
    const btn = modalContent.querySelector(`#${id}`);
    if (btn) btn.onclick = (e) => handler(btn, room); // <- aquí le pasas room al handler
};

// REEMPLAZA esta función en tu archivo reservas.js

// REEMPLAZA esta función en tu archivo reservas.js

const setupEventListeners = () => {
    // Listener para el selector de cliente
    if (ui.btnBuscarCliente) {
        ui.btnBuscarCliente.onclick = () => {
            showClienteSelectorModal(state.supabase, state.hotelId, {
                onSelect: async (cliente) => {
                    updateClienteFields(cliente);
                    await recalcularYActualizarTotalUI();
                }
            });
        };
    }

    if (ui.btnCrearCliente) {
        ui.btnCrearCliente.onclick = () => {
            mostrarFormularioCliente(null, state.supabase, state.hotelId, { 
                afterSave: (nuevoCliente) => {
                    updateClienteFields(nuevoCliente);
                    showSuccess(ui.feedbackDiv, `Cliente "${nuevoCliente.nombre}" creado y seleccionado.`);
                }
            });
        };
    }
    
    ui.container.querySelector('#btn_clear_cliente')?.addEventListener('click', () => {
        updateClienteFields(null);
        recalcularYActualizarTotalUI();
    });

    // Listener para el tipo de duración
    if (ui.tipoCalculoDuracionEl) {
        ui.tipoCalculoDuracionEl.addEventListener('change', () => {
            const esNochesManual = ui.tipoCalculoDuracionEl.value === 'noches_manual';

            if(ui.nochesManualContainer) ui.nochesManualContainer.style.display = esNochesManual ? '' : 'none';
            if(ui.cantidadNochesInput) ui.cantidadNochesInput.required = esNochesManual;
            if(ui.tiempoPredefinidoContainer) ui.tiempoPredefinidoContainer.style.display = esNochesManual ? 'none' : '';
            if(ui.tiempoEstanciaIdSelect) ui.tiempoEstanciaIdSelect.required = !esNochesManual;

            // ▼▼▼ LÓGICA CORREGIDA PARA LIMPIAR CAMPOS ▼▼▼
            if (esNochesManual) {
                if (ui.tiempoEstanciaIdSelect) ui.tiempoEstanciaIdSelect.value = '';
            } else {
                if (ui.cantidadNochesInput) ui.cantidadNochesInput.value = '1';
            }
            // ▲▲▲ FIN DE LA CORRECCIÓN ▲▲▲
            
            recalcularYActualizarTotalUI();
        });
    }

    // Listener para el toggle de Precio Libre
    const togglePrecioLibre = ui.container.querySelector('#precio_libre_toggle');
    if (togglePrecioLibre) {
        togglePrecioLibre.addEventListener('change', () => {
            const containerPrecioLibre = ui.container.querySelector('#precio_libre_container');
            if (containerPrecioLibre) containerPrecioLibre.style.display = togglePrecioLibre.checked ? 'block' : 'none';
        });
    }

    // Lista de todos los inputs que disparan recálculo
    const inputsToRecalculate = [
        ui.habitacionIdSelect, ui.cantidadNochesInput, ui.tiempoEstanciaIdSelect,
        ui.form.elements.cantidad_huespedes, ui.fechaEntradaInput,
        togglePrecioLibre, ui.container.querySelector('#precio_libre_valor')
    ];

    inputsToRecalculate.forEach(el => {
        if (el) {
            const eventType = (el.tagName === 'SELECT' || el.type === 'checkbox') ? 'change' : 'input';
            el.addEventListener(eventType, recalcularYActualizarTotalUI);
        }
    });
    
    // Otros listeners
    ui.container.querySelector('#btn-aplicar-descuento-reserva')?.addEventListener('click', handleAplicarDescuentoReserva);
    ui.form.elements.tipo_pago?.addEventListener('change', actualizarVisibilidadPago);
    ui.form.elements.monto_abono?.addEventListener('input', actualizarVisibilidadPago);
    ui.form?.addEventListener('submit', handleFormSubmit);
    ui.cancelEditButton?.addEventListener('click', () => resetFormToCreateMode());
    ui.reservasListEl?.addEventListener('click', handleListActions);
    document.addEventListener('datosActualizados', handleExternalUpdate);
};

/**
 * Displays the enhanced modal for selecting additional services.
 * @param {object} roomDisplayInfo - Object with room details for display (e.g., { nombre: 'Habitación 101' }).
 * @param {Array<object>} availableServices - Array of service objects from Supabase (id, nombre, precio, opcional: icono).
 * @param {object} activeReservation - The active reservation object for which services are being added.
 */
function showEnhancedServiciosModal(roomDisplayInfo, availableServices, activeReservation) {
    modalContainer.innerHTML = ""; // Clear previous content
    modalContainer.style.display = "flex"; // Show the modal container

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 sm:p-8 m-auto border-2 border-green-100 relative flex flex-col max-h-[90vh]";

    const barraProgreso = `
      <div class="w-full flex justify-center mb-6">
        <div class="flex space-x-2">
          <div class="h-2.5 w-16 bg-green-500 rounded-full"></div>
          <div class="h-2.5 w-16 bg-gray-200 rounded-full"></div>
          <div class="h-2.5 w-16 bg-gray-200 rounded-full"></div>
        </div>
      </div>
    `;

    modalContent.innerHTML = `
      ${barraProgreso}
      <div class="flex-shrink-0">
        <h3 class="text-3xl font-black mb-2 text-green-700 text-center flex items-center justify-center gap-2">
          <span>✨ Servicios Adicionales</span>
        </h3>
        <p class="text-center text-green-600 font-semibold mb-6 text-lg">Para: ${roomDisplayInfo.nombre}</p>
      </div>

      <form id="form-servicios-adicionales" class="space-y-5 overflow-y-auto flex-grow pr-2">
        <div>
          <label class="block mb-3 text-lg font-semibold text-gray-700">Agrega lo que el huésped necesite:</label>
          <div class="space-y-4">
          ${availableServices.map((s, i) => `
            <div class="service-item group flex items-center gap-3 rounded-xl bg-green-50 border-2 border-green-200 p-4 shadow-sm transition-all duration-200 ease-in-out hover:border-green-400 hover:shadow-md relative">
              <input
                type="checkbox"
                id="servicio_${s.id}"
                name="servicio_ids"
                value="${s.id}"
                data-precio="${s.precio || 0}"
                class="form-checkbox h-6 w-6 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer peer"
              >
              <label for="servicio_${s.id}" class="flex-1 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer">
                <div class="flex items-center gap-2">
                  <span class="text-xl">${s.icono || (i % 2 === 0 ? '🧺' : '🕒')}</span>
                  <span class="font-bold text-green-900 text-base sm:text-lg">${s.nombre}</span>
                </div>
                <span class="text-green-700 text-base sm:text-lg font-semibold sm:ml-3 mt-1 sm:mt-0">${s.precio ? `$${Number(s.precio).toLocaleString('es-CO')}` : 'Gratis'}</span>
              </label>
              <input
                type="number"
                min="1"
                value="1"
                name="cantidad_${s.id}"
                class="quantity-input border-2 border-green-200 rounded-lg w-20 px-2 py-1.5 text-center text-lg font-semibold text-gray-700 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-opacity duration-200 opacity-0 peer-checked:opacity-100"
                placeholder="Cant."
                ${!s.precio ? 'disabled' : ''}
              >
            </div>
          `).join('')}
          </div>
        </div>
        <div class="pt-2">
          <label for="nota_servicio" class="block mb-2 text-lg font-semibold text-gray-700">Nota especial (opcional):</label>
          <textarea
            name="nota_servicio"
            id="nota_servicio"
            class="w-full border-2 border-gray-200 rounded-xl p-3 text-lg focus:ring-2 focus:ring-green-500 focus:border-transparent hover:border-gray-300"
            rows="3"
            placeholder="Ej: Alergias, preferencias, etc."
          ></textarea>
        </div>
      </form>
            <div id="descuento-servicios-container" class="pt-2">
    <label for="codigo-descuento-servicios" class="block mb-2 text-lg font-semibold text-gray-700">Código de Descuento (Opcional)</label>
    <div class="flex items-center gap-2">
        <input type="text" id="codigo-descuento-servicios" class="form-control flex-grow uppercase" placeholder="CÓDIGO PROMO">
        <button type="button" id="btn-aplicar-descuento-servicios" class="button button-info px-4 py-2">Aplicar</button>
    </div>
    <div id="feedback-descuento-servicios" class="text-sm mt-2 h-5"></div>
  </div>
      <div class="mt-8 flex-shrink-0">
        <div
          id="sticky-total-servicios"
          class="bg-green-600 text-white px-6 py-4 rounded-xl shadow-lg text-xl sm:text-2xl font-bold flex items-center justify-between gap-3 z-50 mb-6"
        >
          <span>Total Adicional:</span>
          <span id="preview-total-servicios">$0</span>
        </div>
        <div class="flex flex-col sm:flex-row gap-3">
          <button type="submit" form="form-servicios-adicionales" class="w-full sm:flex-1 py-3.5 text-lg rounded-xl font-bold transition-all duration-200 ease-in-out hover:scale-[1.03] flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white shadow-md hover:shadow-lg">
            <span>➕</span> Siguiente
          </button>
          <button type="button" id="btn-cancelar-servicios" class="w-full sm:flex-1 py-3.5 text-lg rounded-xl font-bold transition-all duration-200 ease-in-out hover:scale-[1.03] bg-gray-200 hover:bg-gray-300 text-gray-700 shadow-md hover:shadow-lg">
            Cancelar
          </button>
        </div>
      </div>
    `;

    // Font application (ensure Montserrat is linked in your main HTML)
    if (!document.getElementById('montserrat-font')) {
        const link = document.createElement('link');
        link.id = 'montserrat-font';
        link.href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&display=swap';
        link.rel = 'stylesheet';
        document.head.appendChild(link);
    }
    modalContent.querySelectorAll('*').forEach(el => {
        el.style.fontFamily = "'Montserrat', sans-serif";
    });

    modalContainer.appendChild(modalContent);

    // Event Listeners & Logic (similar to the previous "bonito" modal)
    const form = modalContent.querySelector('#form-servicios-adicionales');
    const previewTotalElement = modalContent.querySelector('#preview-total-servicios');
    const serviceItems = form.querySelectorAll('.service-item');

    const updatePreviewTotal = () => {
        let total = 0;
        serviceItems.forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"][name="servicio_ids"]');
            if (checkbox.checked) {
                const precio = Number(checkbox.dataset.precio) || 0;
                const cantidadInput = item.querySelector('input[type="number"]');
                const cantidad = Number(cantidadInput.value) || 1;
                if (precio > 0) {
                    total += cantidad * precio;
                }
            }
        });
        previewTotalElement.textContent = `$${total.toLocaleString('es-CO')}`;
    };

    form.addEventListener('input', (event) => {
        const target = event.target;
        if (target.matches('input[type="checkbox"], input[type="number"]')) {
            if (target.type === 'checkbox') {
                const quantityInput = target.closest('.service-item').querySelector('.quantity-input');
                const isFree = Number(target.dataset.precio) === 0;
                if (target.checked) {
                    quantityInput.classList.remove('opacity-0');
                    quantityInput.disabled = isFree;
                    if (isFree) quantityInput.value = 1;
                } else {
                    quantityInput.classList.add('opacity-0');
                    quantityInput.disabled = true;
                }
            }
            updatePreviewTotal();
        }
    });
    
    // Initialize quantity inputs and total
    serviceItems.forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"][name="servicio_ids"]');
        const quantityInput = item.querySelector('.quantity-input');
        const isFree = Number(checkbox.dataset.precio) === 0;
        if (checkbox.checked) {
            quantityInput.classList.remove('opacity-0');
            quantityInput.disabled = isFree;
            if (isFree) quantityInput.value = 1;
        } else {
            quantityInput.classList.add('opacity-0');
            quantityInput.disabled = true;
        }
    });
    updatePreviewTotal();

    modalContent.querySelector('#btn-cancelar-servicios').onclick = () => {
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const selectedServiceItems = [];
        formData.getAll('servicio_ids').forEach(id => {
            const serviceData = availableServices.find(s => s.id.toString() === id);
            if (serviceData) {
                selectedServiceItems.push({
                    servicio_id: serviceData.id, // for DB
                    nombre: serviceData.nombre, // for display or logging
                    cantidad: parseInt(formData.get(`cantidad_${id}`) || 1),
                    precio_unitario: serviceData.precio, // for DB
                    // reserva_id: activeReservation.id // You'll need this!
                });
            }
        });
        const nota = formData.get('nota_servicio');
        const totalCalculated = parseFloat(previewTotalElement.textContent.replace(/[$.]/g, '').replace(',', '.'));

        console.log("Active Reservation ID:", activeReservation.id);
        console.log("Selected Services for DB:", selectedServiceItems);
        console.log("Nota:", nota);
        console.log("Total:", totalCalculated);

        // **Aquí iría tu lógica para guardar los servicios en Supabase**
        // For example:
        // const itemsToInsert = selectedServiceItems.map(item => ({
        //   reserva_id: activeReservation.id,
        //   servicio_adicional_id: item.servicio_id,
        //   cantidad: item.cantidad,
        //   precio_cobrado: item.precio_unitario * item.cantidad, // o solo precio_unitario y calculas en backend/trigger
        //   nota_huesped: nota // podría ser una nota general para el pedido o por item
        // }));
        //
        // if (itemsToInsert.length > 0) {
        //   const { error } = await supabase.from('reservas_servicios_adicionales').insert(itemsToInsert);
        //   if (error) {
        //     console.error("Error saving additional services:", error);
        //     mostrarInfoModalGlobal(`Error al guardar: ${error.message}`, "Error");
        //   } else {
        //     mostrarInfoModalGlobal("Servicios agregados con éxito!", "Éxito");
        //     modalContainer.style.display = "none";
        //     modalContainer.innerHTML = '';
        //     // Opcional: actualizar UI, etc.
        //   }
        // } else {
        //    mostrarInfoModalGlobal("No se seleccionaron servicios.", "Información");
        // }
        alert(`Simulación: Guardando servicios para reserva ${activeReservation.id}. Total: $${totalCalculated.toLocaleString('es-CO')}. Nota: ${nota}`);
        // modalContainer.style.display = "none"; // Hide modal on successful submission
        // modalContainer.innerHTML = '';
    };
}


// This is your main event listener setup
// `room` here is the specific room for which the button 'btn-servicios-adicionales' was clicked.
// Ensure `room` has at least `id` and `nombre` properties.
// Asegúrate que estas variables estén accesibles en el scope de showHabitacionOpcionesModal
// let supabaseGlobal = supabase; // Ejemplo, si las renombras o usas las globales
// let currentUserGlobal = currentUser;
// let hotelIdGlobal = hotelId;
// let mainAppContainer = mainAppContainer; // El contenedor principal para renderRooms

// ... (el resto de tu función showHabitacionOpcionesModal y otras funciones) ...

// Dentro de showHabitacionOpcionesModal, después de crear modalContent:

// Listener para 'btn-servicios-adicionales' CON CORRECCIONES
setupButtonListener('close-modal-acciones', () => {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
    });




setupButtonListener('btn-servicios-adicionales', async (btn, roomContext) => {
      console.log("ID del usuario en la APP:", currentUserGlobal.id);
  const { data: reserva, error: errRes } = await supabaseGlobal
    .from('reservas')
    .select('id, cliente_nombre, estado, monto_pagado')
    .eq('habitacion_id', roomContext.id)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();

  if (errRes || !reserva) {
    mostrarInfoModalGlobal("No hay una reserva activa en esta habitación para asignar servicios.", "Sin reserva activa");
    return;
  }

  const { data: servicios, error: errServ } = await supabaseGlobal
    .from('servicios_adicionales')
    .select('id, nombre, precio')
    .eq('hotel_id', hotelIdGlobal)
    .eq('activo', true);

  if (errServ || !servicios || servicios.length === 0) {
    mostrarInfoModalGlobal("No hay servicios adicionales configurados en el hotel.", "Servicios no encontrados");
    return;
  }
  
  const modalContainer = document.getElementById('modal-container');
  modalContainer.innerHTML = "";
  modalContainer.style.display = "flex";
  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 sm:p-8 m-auto border-2 border-green-100 relative flex flex-col max-h-[90vh]";

  modalContent.innerHTML = `
      <h3 class="text-3xl font-black mb-7 text-green-700 text-center flex items-center justify-center gap-2 drop-shadow">
          <span>✨ Servicios Adicionales</span>
          <span class="text-2xl text-green-400">(${roomContext.nombre})</span>
      </h3>
      <form id="form-servicios-adicionales" class="space-y-5 overflow-y-auto flex-grow pr-2">
          <div>
              <label class="block mb-3 text-lg font-semibold text-gray-700">Agrega lo que el huésped necesite:</label>
              <div class="space-y-4">
                  ${servicios.map((s, i) => `
                      <div class="service-item group flex items-center gap-3 rounded-xl bg-green-50 border-2 border-green-200 p-4 shadow-sm transition-all duration-200 ease-in-out hover:border-green-400 hover:shadow-md relative">
                          <input type="checkbox" id="servicio_${s.id}" name="servicio_ids" value="${s.id}" data-precio="${s.precio || 0}" class="form-checkbox h-6 w-6 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer peer">
                          <label for="servicio_${s.id}" class="flex-1 flex flex-col sm:flex-row sm:items-center justify-between cursor-pointer">
                              <div class="flex items-center gap-2">
                                  <span class="text-xl">${s.icono || (i % 2 === 0 ? '🧺' : '🕒')}</span>
                                  <span class="font-bold text-green-900 text-base sm:text-lg">${s.nombre}</span>
                              </div>
                              <span class="text-green-700 text-base sm:text-lg font-semibold sm:ml-3 mt-1 sm:mt-0">${s.precio ? formatCurrency(s.precio) : 'Gratis'}</span>
                          </label>
                          <input type="number" min="1" value="1" name="cantidad_${s.id}" class="quantity-input border-2 border-green-200 rounded-lg w-20 px-2 py-1.5 text-center text-lg font-semibold text-gray-700 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-opacity duration-200 opacity-0 peer-checked:opacity-100" placeholder="Cant.">
                      </div>
                  `).join('')}
              </div>
          </div>
          <div class="pt-2">
              <label for="nota_servicio" class="block mb-2 text-lg font-semibold text-gray-700">Nota especial (opcional):</label>
              <textarea name="nota_servicio" id="nota_servicio" class="w-full border-2 border-gray-200 rounded-xl p-3 text-lg focus:ring-2 focus:ring-green-500 focus:border-transparent hover:border-gray-300" rows="3" placeholder="Ej: Alergias, preferencias, etc."></textarea>
          </div>
      </form>
      
      <div id="descuento-servicios-container" class="pt-4">
          <label for="codigo-descuento-servicios" class="block mb-2 text-lg font-semibold text-gray-700">Código de Descuento (Opcional)</label>
          <div class="flex items-center gap-2">
              <input type="text" id="codigo-descuento-servicios" class="form-control flex-grow uppercase" placeholder="CÓDIGO PROMO">
              <button type="button" id="btn-aplicar-descuento-servicios" class="button button-info px-4 py-2">Aplicar</button>
          </div>
          <div id="feedback-descuento-servicios" class="text-sm mt-2 h-5 font-semibold"></div>
      </div>

      <div class="mt-8 flex-shrink-0">
          <div id="sticky-total-servicios" class="bg-green-600 text-white px-6 py-4 rounded-xl shadow-lg text-xl sm:text-2xl font-bold flex items-center justify-between gap-3 z-50 mb-6">
              <span>Total Adicional:</span>
              <span id="preview-total-servicios">$0</span>
          </div>
          <div class="flex flex-col sm:flex-row gap-3">
              <button type="submit" form="form-servicios-adicionales" class="w-full sm:flex-1 py-3.5 text-lg rounded-xl font-bold transition-all duration-200 ease-in-out hover:scale-[1.03] flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white shadow-md hover:shadow-lg">
                  <span>➕</span> Siguiente
              </button>
              <button type="button" id="btn-cancelar-servicios" class="w-full sm:flex-1 py-3.5 text-lg rounded-xl font-bold transition-all duration-200 ease-in-out hover:scale-[1.03] bg-gray-200 hover:bg-gray-300 text-gray-700 shadow-md hover:shadow-lg">
                  Cancelar
              </button>
          </div>
      </div>
  `;
  modalContainer.appendChild(modalContent);
  
  const form = modalContent.querySelector('#form-servicios-adicionales');
  const serviceItems = form.querySelectorAll('.service-item');
  const feedbackDescuentoEl = modalContent.querySelector('#feedback-descuento-servicios');
  const codigoInputEl = modalContent.querySelector('#codigo-descuento-servicios');
  
  let descuentoAplicado = null;
  let montoDescuento = 0;
  // Guardaremos los nombres de los servicios a los que se aplica el descuento
  let nombresServiciosDescuento = ''; 

  const actualizarResumenYDescuento = async (codigoManual = null) => {
    const serviciosSeleccionados = Array.from(serviceItems)
      .map(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!checkbox.checked) return null;
        return {
          servicio_id: checkbox.value,
          cantidad: Number(item.querySelector('input[type="number"]').value) || 1,
          precio: Number(checkbox.dataset.precio) || 0,
          nombre: servicios.find(s => s.id === checkbox.value)?.nombre || 'Servicio'
        };
      })
      .filter(Boolean);

    const subtotal = serviciosSeleccionados.reduce((sum, s) => sum + (s.cantidad * s.precio), 0);
    
    const resultadoDescuento = await buscarDescuentoParaServicios(serviciosSeleccionados, codigoManual);

    if (resultadoDescuento) {
        descuentoAplicado = resultadoDescuento.descuento;
        montoDescuento = resultadoDescuento.monto;
        nombresServiciosDescuento = resultadoDescuento.serviciosAplicadosNombres; // Guardamos los nombres
        feedbackDescuentoEl.textContent = `Descuento "${descuentoAplicado.nombre}" aplicado: -${formatCurrency(montoDescuento)}`;
        feedbackDescuentoEl.className = 'text-sm mt-2 h-5 text-green-600 font-semibold';
    } else {
        descuentoAplicado = null;
        montoDescuento = 0;
        nombresServiciosDescuento = ''; // Limpiamos los nombres
        if (codigoManual) {
            feedbackDescuentoEl.textContent = 'Código no válido o no aplicable.';
            feedbackDescuentoEl.className = 'text-sm mt-2 h-5 text-red-600 font-semibold';
        } else {
            feedbackDescuentoEl.textContent = '';
        }
    }
    
    const totalFinal = subtotal - montoDescuento;
    const totalContainer = modalContent.querySelector('#sticky-total-servicios');
    if (montoDescuento > 0) {
      totalContainer.innerHTML = `
        <div class="text-xs text-left">
          <div>Subtotal: ${formatCurrency(subtotal)}</div>
          <div class="text-green-200 font-semibold">Descuento: -${formatCurrency(montoDescuento)}</div>
        </div>
        <div class="text-right">
          <span class="text-lg">Total:</span>
          <span class="text-2xl font-bold">${formatCurrency(totalFinal)}</span>
        </div>`;
    } else {
      totalContainer.innerHTML = `
        <span>Total Adicional:</span>
        <span id="preview-total-servicios">${formatCurrency(subtotal)}</span>`;
    }
  };

  form.addEventListener('input', (event) => {
    const target = event.target;
    if (target.matches('input[type="checkbox"], input[type="number"]')) {
      codigoInputEl.value = '';
      actualizarResumenYDescuento(null);
    }
  });

  modalContent.querySelector('#btn-aplicar-descuento-servicios').onclick = async () => {
    const codigo = codigoInputEl.value.trim();
    await actualizarResumenYDescuento(codigo || null);
  };

  modalContent.querySelector('#btn-cancelar-servicios').onclick = () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
  };
  
form.onsubmit = async (ev) => {
    ev.preventDefault();
    const formData = new FormData(ev.target);
    const nota = formData.get('nota_servicio') || '';

    const serviciosSeleccionados = Array.from(serviceItems)
      .map(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (!checkbox.checked) return null;
        return {
          servicio_id: checkbox.value,
          cantidad: Number(item.querySelector('input[type="number"]').value) || 1,
          precio: Number(checkbox.dataset.precio) || 0,
          nombre: servicios.find(s => s.id === checkbox.value)?.nombre || 'Servicio'
        };
      }).filter(Boolean);

    if (serviciosSeleccionados.length === 0) {
      mostrarInfoModalGlobal("Debes seleccionar al menos un servicio.", "Validación", [], modalContainer);
      return;
    }

    const subtotal = serviciosSeleccionados.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);
    const totalFinalConDescuento = subtotal - montoDescuento;

    mostrarInfoModalGlobal(`
      <div class="text-center p-5">
        <h4 class="text-2xl font-bold mb-3 text-blue-900">¿Cómo desea cobrar estos servicios?</h4>
        <div class="rounded-xl bg-blue-50 text-blue-700 p-3 mb-4 border text-lg">
          <div class="mb-2 font-semibold">Resumen:</div>
          <ul class="text-left ml-7 mb-2">
            ${serviciosSeleccionados.map(s => `<li>• ${s.nombre} <b>x${s.cantidad}</b> ${formatCurrency(s.precio * s.cantidad)}</li>`).join('')}
          </ul>
          ${montoDescuento > 0 ? `<div class="mt-2 text-right text-green-600 font-bold">Descuento: -${formatCurrency(montoDescuento)}</div>` : ''}
          <div class="mt-2 text-right font-bold text-xl">Total a Pagar: ${formatCurrency(totalFinalConDescuento)}</div>
        </div>
        <div class="mb-4 flex flex-col gap-3">
          <button id="btn-cobro-ahora-serv" class="button button-success py-3 rounded-xl text-xl font-bold flex-1">Cobrar AHORA y registrar en caja</button>
          <button id="btn-cobro-final-serv" class="button button-neutral py-3 rounded-xl text-xl font-bold flex-1">Cobrar al FINAL (sumar a la factura)</button>
        </div>
        <button id="btn-cancelar-cobro-servicio-serv" class="mt-2 text-sm text-gray-600 hover:text-red-500 underline">Cancelar</button>
      </div>
    `, "¿Cómo desea cobrar?", [], modalContainer);

    setTimeout(() => {
        const modalOpciones = document.getElementById('modal-container').querySelector('.bg-white');
        if (!modalOpciones) return;

        // Botón Cobrar al FINAL (sin cambios)
        modalOpciones.querySelector('#btn-cobro-final-serv').onclick = async () => {
          let serviciosParaInsertar = serviciosSeleccionados.map(item => ({
            hotel_id: hotelIdGlobal, reserva_id: reserva.id, servicio_id: item.servicio_id,
            cantidad: item.cantidad, precio_cobrado: item.precio * item.cantidad,
            nota, estado_pago: 'pendiente'
          }));
          
          if (montoDescuento > 0 && descuentoAplicado) {
            let descripcionDescuento = `Descuento: ${descuentoAplicado.nombre}`;
            if (nombresServiciosDescuento) {
                descripcionDescuento += ` (a ${nombresServiciosDescuento})`;
            }
            serviciosParaInsertar.push({
              hotel_id: hotelIdGlobal, reserva_id: reserva.id,
              descripcion_manual: descripcionDescuento,
              cantidad: 1,
              precio_cobrado: -montoDescuento,
              estado_pago: 'aplicado'
            });
          }
          
          const { error } = await supabaseGlobal.from('servicios_x_reserva').insert(serviciosParaInsertar);
          if (error) {
            mostrarInfoModalGlobal(`Error al agregar servicios: ${error.message}`, "Error", [], modalContainer);
          } else {
            const modalOpcionesContainer = modalOpciones.closest('#modal-container');
            if(modalOpcionesContainer) {
                modalOpcionesContainer.style.display = 'none';
                modalOpcionesContainer.innerHTML = '';
            }
            mostrarInfoModalGlobal("Servicios agregados a la cuenta final de la habitación.", "Éxito");
          }
        };

        // ▼▼▼ INICIO DEL BLOQUE CORREGIDO Y MEJORADO ▼▼▼

        // Función interna para procesar el pago (tanto único como mixto)
        const procesarCobroInmediato = async (pagos) => {
            try {
                const turnoId = turnoService.getActiveTurnId();
                if (!turnoId) throw new Error("ACCIÓN BLOQUEADA: No se puede registrar el pago porque no hay un turno de caja activo.");

                const totalPagado = pagos.reduce((sum, p) => sum + p.monto, 0);

                // --- MEJORA: Crear descripción detallada de servicios ---
                const descripcionServicios = serviciosSeleccionados.map(s => `${s.cantidad}x ${s.nombre}`).join(', ');
                const conceptoCaja = `Pago Serv: ${descripcionServicios} (Hab. ${roomContext.nombre})`;
                const conceptoPagos = `Pago servicios: ${descripcionServicios}`;
                // --- FIN MEJORA ---

                // 1. Insertar cada pago en `pagos_reserva` con concepto detallado
                const pagosParaInsertar = pagos.map(p => ({
                    hotel_id: hotelIdGlobal, reserva_id: reserva.id, monto: p.monto,
                    fecha_pago: new Date().toISOString(), metodo_pago_id: p.metodo_pago_id,
                    usuario_id: currentUserGlobal.id, concepto: conceptoPagos
                }));
                const { data: pagosData, error: errPagos } = await supabaseGlobal.from('pagos_reserva').insert(pagosParaInsertar).select('id');
                if (errPagos) throw new Error(`Error al registrar los pagos: ${errPagos.message}`);
                const primerPagoId = pagosData && pagosData.length > 0 ? pagosData[0].id : null;

                // 2. Insertar cada movimiento en `caja` con concepto detallado
                const movimientosCaja = pagos.map((p, index) => ({
                    hotel_id: hotelIdGlobal, tipo: 'ingreso', monto: p.monto,
                    concepto: conceptoCaja, // Se usa el concepto detallado
                    fecha_movimiento: new Date().toISOString(), metodo_pago_id: p.metodo_pago_id,
                    usuario_id: currentUserGlobal.id, reserva_id: reserva.id,
                    pago_reserva_id: pagosData[index].id, turno_id: turnoId,
                }));
                await supabaseGlobal.from('caja').insert(movimientosCaja);

                // 3. Actualizar el monto total pagado en la reserva principal
                const nuevoMontoPagado = (reserva.monto_pagado || 0) + totalPagado;
                await supabaseGlobal.from('reservas').update({ monto_pagado: nuevoMontoPagado }).eq('id', reserva.id);

                // 4. Preparar y registrar los servicios y el descuento
                let serviciosParaInsertar = serviciosSeleccionados.map(item => ({
                    hotel_id: hotelIdGlobal, reserva_id: reserva.id, servicio_id: item.servicio_id,
                    cantidad: item.cantidad, precio_cobrado: item.precio * item.cantidad,
                    estado_pago: 'pagado', pago_reserva_id: primerPagoId
                }));
                
                if (montoDescuento > 0 && descuentoAplicado) {
                    let descripcionDescuento = `Descuento: ${descuentoAplicado.nombre} (a ${nombresServiciosDescuento})`;
                    serviciosParaInsertar.push({
                        hotel_id: hotelIdGlobal, reserva_id: reserva.id, descripcion_manual: descripcionDescuento,
                        cantidad: 1, precio_cobrado: -montoDescuento, estado_pago: 'aplicado', pago_reserva_id: primerPagoId
                    });
                    await supabaseGlobal.rpc('incrementar_uso_descuento', { descuento_id_param: descuentoAplicado.id });
                }

                await supabaseGlobal.from('servicios_x_reserva').insert(serviciosParaInsertar);

                // 5. Mostrar éxito y cerrar modales
                mostrarInfoModalGlobal("¡Pago de servicios registrado con éxito en la caja!", "Éxito");
                const modalOpcionesContainer = modalOpciones.closest('#modal-container');
                 if(modalOpcionesContainer) {
                    modalOpcionesContainer.style.display = 'none';
                    modalOpcionesContainer.innerHTML = '';
                }

            } catch (error) {
                console.error("Error procesando el cobro inmediato:", error);
                mostrarInfoModalGlobal(`Error al procesar el pago: ${error.message}`, "Error Crítico", [], modalContainer);
            }
        };

        // Lógica del botón "Cobrar AHORA" con opción de pago mixto
        modalOpciones.querySelector('#btn-cobro-ahora-serv').onclick = async () => {
            try {
                if (!turnoService.getActiveTurnId()) {
                    mostrarInfoModalGlobal("No hay un turno de caja activo.", "Error de Turno", [], modalContainer);
                    return;
                }

                const { data: metodosPagoDB } = await supabaseGlobal.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelIdGlobal).eq('activo', true);
                if (!metodosPagoDB || metodosPagoDB.length === 0) {
                    mostrarInfoModalGlobal("No hay métodos de pago activos configurados.", "Error de Configuración", [], modalContainer);
                    return;
                }
                
                metodosPagoDB.unshift({ id: "mixto", nombre: "Pago Mixto" });
                const opcionesMetodosHTML = metodosPagoDB.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('');

                const { value: metodoPagoId, isConfirmed } = await Swal.fire({
                    title: 'Confirmar Cobro Inmediato',
                    html: `
                        <p class="mb-4">Se cobrará un total de <strong>${formatCurrency(totalFinalConDescuento)}</strong>.</p>
                        <label for="swal-metodo-pago" class="swal2-label">Seleccione el método de pago:</label>
                        <select id="swal-metodo-pago" class="swal2-input">${opcionesMetodosHTML}</select>`,
                    focusConfirm: false,
                    preConfirm: () => {
                        const metodo = document.getElementById('swal-metodo-pago').value;
                        if (!metodo) Swal.showValidationMessage('Por favor, seleccione un método de pago.');
                        return metodo;
                    },
                    showCancelButton: true,
                    confirmButtonText: 'Siguiente',
                    cancelButtonText: 'Cancelar'
                });

                if (!isConfirmed || !metodoPagoId) return;

                if (metodoPagoId === "mixto") {
                    modalOpciones.closest('#modal-container').style.display = 'none';
                    showPagoMixtoModal(totalFinalConDescuento, metodosPagoDB, procesarCobroInmediato);
                } else {
                    const pagoUnico = [{ metodo_pago_id: metodoPagoId, monto: totalFinalConDescuento }];
                    await procesarCobroInmediato(pagoUnico);
                }
            } catch (error) {
                console.error("Error en preparación de cobro:", error);
                mostrarInfoModalGlobal(`Error al preparar cobro: ${error.message}`, "Error", [], modalContainer);
            }
        };
        // ▲▲▲ FIN DEL BLOQUE CORREGIDO Y MEJORADO ▲▲▲

        modalOpciones.querySelector('#btn-cancelar-cobro-servicio-serv').onclick = () => {
          modalContainer.style.display = 'none';
          modalContainer.innerHTML = '';
        };
    }, 100);
  };
  
  actualizarResumenYDescuento(null);
});






// ====== Alquilar Ahora (con bloqueo por reservas próximas)
setupButtonListener('btn-alquilar-directo', async () => {
  const ahora = new Date();

  // Obtén la duración del alquiler solicitado (aquí puedes poner el valor por defecto o traerlo de tu selector/modal)
  let minutosAlquilerSolicitado = 120; // Por defecto 2 horas
  // Si tienes un selector en el modal, ¡trae aquí el valor real que seleccionó el usuario!

  // 1. Buscar TODAS las reservas futuras y activas de la habitación
  const { data: reservasFuturas, error } = await supabase
    .from('reservas')
    .select('id, fecha_inicio, fecha_fin')
    .eq('habitacion_id', room.id)
    .in('estado', ['reservada', 'activa'])
    .gte('fecha_fin', ahora.toISOString())
    .order('fecha_inicio', { ascending: true });

  if (error) {
    mostrarInfoModalGlobal("Error consultando reservas futuras: " + error.message, "Error");
    return;
  }

  // 2. Validar cruce con cada reserva futura
  const alquilerDesde = ahora;
  const alquilerHasta = new Date(alquilerDesde.getTime() + minutosAlquilerSolicitado * 60 * 1000);

  for (const reserva of reservasFuturas || []) {
const inicioReserva = new Date(new Date(reserva.fecha_inicio).getTime() + new Date().getTimezoneOffset() * 60000);
    const finReserva = new Date(reserva.fecha_fin);
    const inicioBloqueo = new Date(inicioReserva.getTime() - 2 * 60 * 60 * 1000);

    // A. Bloqueo: ¿ya estamos dentro del margen de 2 horas antes de la reserva?
    if (alquilerDesde >= inicioBloqueo && alquilerDesde < finReserva) {
      mostrarInfoModalGlobal(
        "No puedes alquilar esta habitación porque está bloqueada por una reserva próxima o en curso.",
        "Alquiler bloqueado"
      );
      return;
    }

    // B. ¿El rango de alquiler invade el periodo de bloqueo+reserva?
    if (alquilerDesde < finReserva && alquilerHasta > inicioBloqueo) {
      mostrarInfoModalGlobal(
        "No puedes alquilar esta habitación porque tu horario invade una reserva próxima.",
        "Alquiler bloqueado"
      );
      return;
    }
  }

  // Si no hay cruce ni bloqueo, sí permite alquilar
  showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer);
});
  
  setupButtonListener('btn-extender-tiempo', () => showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer));
  setupButtonListener('btn-mantenimiento', () => showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer));

  if (reservaFutura && modalContent.querySelector('#btn-checkin-reserva')) {
    setupButtonListener('btn-checkin-reserva', async () => {
      // 1. Validar que el pago esté completo antes de permitir el check-in
      const ok = await puedeHacerCheckIn(reservaFutura.id);
      if (!ok) return; // Si no está completo, sale y muestra alerta

      // 2. Si el pago está completo, hacer el check-in como siempre
      // 1. Calcular duración en milisegundos:
const minutos = Math.round(
  (new Date(reservaFutura.fecha_fin) - new Date(reservaFutura.fecha_inicio)) / 60000
);

// 2. Nuevo inicio: ahora
const nuevoInicio = new Date();
const nuevoFin = new Date(nuevoInicio.getTime() + minutos * 60000);

// 3. Actualiza la reserva con nueva fecha_inicio y fecha_fin
await supabase.from('reservas').update({
  estado: 'activa',
  fecha_inicio: nuevoInicio.toISOString(),
  fecha_fin: nuevoFin.toISOString()
}).eq('id', reservaFutura.id);

// 3b. Actualiza la habitación a "ocupada"
await supabase.from('habitaciones').update({
  estado: 'ocupada'
}).eq('id', room.id);

// 4. Actualiza el cronómetro con esas fechas
await supabase.from('cronometros').insert([{
  hotel_id: hotelId,
  reserva_id: reservaFutura.id,
  habitacion_id: room.id,
  fecha_inicio: nuevoInicio.toISOString(),
  fecha_fin: nuevoFin.toISOString()
}]);


      mostrarInfoModalGlobal("Check-in realizado correctamente. ¡La habitación está ocupada!", "Check-in Exitoso");
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
      await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    });
  }
setupButtonListener('btn-cambiar-habitacion', async (btn, room) => { // 'room' se pasa como segundo argumento desde showHabitacionOpcionesModal
  const modalContainerPrincipal = document.getElementById('modal-container'); // Contenedor principal para todos los modales

  // Cargar habitaciones libres (excepto la actual)
  const { data: habitacionesLibres, error: errHabLibres } = await supabaseGlobal // Usar supabaseGlobal consistentemente
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', hotelIdGlobal) // Usar hotelIdGlobal consistentemente
    .eq('estado', 'libre')
    .neq('id', room.id); // 'room' es el contexto de la habitación actual

  if (errHabLibres) {
    console.error("Error cargando habitaciones libres:", errHabLibres);
    mostrarInfoModalGlobal("Error al cargar habitaciones libres: " + errHabLibres.message, "Error", [], modalContainerPrincipal);
    return;
  }

  if (!habitacionesLibres || habitacionesLibres.length === 0) {
    mostrarInfoModalGlobal("No hay habitaciones libres disponibles para hacer el cambio.", "Sin habitaciones libres", [], modalContainerPrincipal);
    return;
  }

  // Modal para seleccionar habitación y motivo
  // Este modal de cambio se mostrará DENTRO de modalContainerPrincipal
  const modalCambioContent = document.createElement('div');
  modalCambioContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up";
  modalCambioContent.innerHTML = `
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-xl font-bold text-blue-700">Cambiar Habitación: ${room.nombre}</h3>
        <button id="btn-cerrar-modal-cambio-X" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
    </div>
    <div class="mb-3">
      <label for="selectNuevaHabitacion" class="block text-sm font-medium text-gray-700 mb-1">Selecciona habitación destino:</label>
      <select id="selectNuevaHabitacion" class="form-control w-full">
        <option value="">-- Habitaciones libres --</option>
        ${habitacionesLibres.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="mb-3">
      <label for="motivoCambio" class="block text-sm font-medium text-gray-700 mb-1">Motivo del cambio:</label>
      <textarea id="motivoCambio" class="form-control w-full" rows="2" placeholder="Describe el motivo..."></textarea>
    </div>
    <div class="flex gap-3 mt-5">
      <button id="btnConfirmarCambioHabitacion" class="button button-success flex-1 py-2.5 text-base">Confirmar Cambio</button>
      <button id="btnCancelarCambioHabitacion" class="button button-neutral flex-1 py-2.5 text-base">Cancelar</button>
    </div>
  `;
  modalContainerPrincipal.innerHTML = ""; // Limpiar contenido previo del contenedor principal
  modalContainerPrincipal.appendChild(modalCambioContent);
  modalContainerPrincipal.style.display = 'flex'; // Asegurarse que el contenedor principal esté visible

  const cerrarModalDeCambio = () => {
    modalContainerPrincipal.style.display = "none";
    modalContainerPrincipal.innerHTML = '';
  };

  modalCambioContent.querySelector('#btn-cerrar-modal-cambio-X').onclick = cerrarModalDeCambio;
  modalCambioContent.querySelector('#btnCancelarCambioHabitacion').onclick = cerrarModalDeCambio;

  // Confirmar cambio
// En el archivo: js/modules/mapa_habitaciones/mapa_habitaciones.js
// Dentro de la función showHabitacionOpcionesModal...
// Reemplaza el listener del botón de confirmar cambio por este:

  // Confirmar cambio
  modalCambioContent.querySelector('#btnConfirmarCambioHabitacion').onclick = async () => {
    const selectNuevaHabitacionEl = modalCambioContent.querySelector('#selectNuevaHabitacion');
    const motivoCambioEl = modalCambioContent.querySelector('#motivoCambio');
    const btnConfirmarEl = modalCambioContent.querySelector('#btnConfirmarCambioHabitacion');

    const habitacionDestinoId = selectNuevaHabitacionEl.value;
    const motivo = motivoCambioEl.value.trim();

    // ▼▼▼ CÓDIGO AÑADIDO: Obtenemos el nombre de la habitación destino ▼▼▼
    const habitacionDestinoNombre = selectNuevaHabitacionEl.options[selectNuevaHabitacionEl.selectedIndex].text;
    // ▲▲▲ FIN DEL CÓDIGO AÑADIDO ▲▲▲

    if (!habitacionDestinoId) {
      alert("Debes seleccionar una habitación destino.");
      selectNuevaHabitacionEl.focus();
      return;
    }
    if (!motivo) {
      alert("Debes escribir el motivo del cambio.");
      motivoCambioEl.focus();
      return;
    }

    btnConfirmarEl.disabled = true;
    btnConfirmarEl.textContent = "Procesando...";

// ... (dentro del listener de btnConfirmarCambioHabitacion.onclick)
try {
  // Primero, aún necesitamos el ID de la reserva activa. Esta consulta se mantiene.
  const { data: reservaActiva, error: errReserva } = await supabaseGlobal
    .from('reservas')
    .select('id')
    .eq('habitacion_id', room.id) // room.id es la habitación origen
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();

  if (errReserva || !reservaActiva) {
    throw new Error(errReserva?.message || "No se encontró una reserva activa para la habitación origen.");
  }

  // Ahora, llamamos a nuestra "super-función" con todos los datos
  const { error } = await supabaseGlobal.rpc('cambiar_habitacion_transaccion', {
      p_reserva_id: reservaActiva.id,
      p_habitacion_origen_id: room.id,
      p_habitacion_destino_id: habitacionDestinoId,
      p_motivo_cambio: motivo,
      p_usuario_id: currentUserGlobal.id,
      p_hotel_id: hotelIdGlobal,
      p_nuevo_estado_destino: room.estado // Pasamos el estado actual de la habitación (ej. 'ocupada')
  });

  // Si la función de la base de datos devuelve un error, lo capturamos aquí
  if (error) {
      throw error;
  }

  // Si llegamos aquí, ¡TODO salió bien!
  mostrarInfoModalGlobal(
    "¡El cambio de habitación fue realizado exitosamente!",
    "Cambio Exitoso",
    [{
        texto: "Entendido",
        clase: "button-primary",
        accion: async () => {
            await renderRooms(mainAppContainer, supabaseGlobal, currentUserGlobal, hotelIdGlobal);
        }
    }],
    modalContainerPrincipal
  );

} catch (error) {
  console.error("Error en el proceso de cambio de habitación:", error);
  mostrarInfoModalGlobal(
    "Error al realizar el cambio de habitación: " + error.message,
    "Error en Cambio",
    [{ texto: "Cerrar", clase: "button-danger", accion: cerrarModalDeCambio }],
    modalContainerPrincipal
  );
} finally {
  if (btnConfirmarEl) {
    btnConfirmarEl.disabled = false;
    btnConfirmarEl.textContent = "Confirmar Cambio";
  }
}
  };
}); // Fin setupButtonListener btn-cambiar-habitacion
/**
 * Consulta todos los cargos pendientes de la reserva/habitación.
 * Bloquea entrega si hay alguna deuda pendiente.
 * Muestra un resumen de los pendientes si los hay.

/**
/**
 * REESCRITA Y CORREGIDA
 /**
 * REESCRITA Y CORREGIDA para soportar Duración Abierta (cálculo dinámico de alojamiento).
 * Consulta el costo total REAL de todos los consumos y lo compara con el monto pagado.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} reservaId - UUID de la reserva activa.
 * @param {string} habitacionId - UUID de la habitación.
 * @returns {Promise<boolean>} true si puede entregar, false si no.
 */
async function validarCargosPendientesAntesDeEntregar(supabase, reservaId, habitacionId) {
    try {
        // 1. Obtener la reserva principal y los nuevos campos tipo_duracion y fecha_inicio
        const { data: reserva, error: errRes } = await supabase
            .from('reservas')
            .select('monto_total, monto_pagado, tipo_duracion, fecha_inicio')
            .eq('id', reservaId)
            .single();
        if (errRes) throw new Error(`No se pudo obtener la reserva principal: ${errRes.message}`);

        let montoAlojamientoCalculado = Number(reserva.monto_total) || 0; // Default: usar el monto_total guardado

        // --- INICIO DE LA LÓGICA DE CÁLCULO PARA DURACIÓN ABIERTA (DINÁMICO) ---
        if (reserva.tipo_duracion === 'abierta') {
            const now = new Date();
            const inicio = new Date(reserva.fecha_inicio);
            // Tiempo transcurrido en minutos, redondeando al minuto superior
            const tiempoTranscurridoMin = Math.ceil((now - inicio) / 60000); 

            const tiempos = await getTiemposEstancia(supabase, hotelIdGlobal);
            // Encuentra el bloque más corto (tarifa por hora base)
            const tarifaPorHora = tiempos.filter(t => t.minutos > 0)
                                        .sort((a, b) => a.minutos - b.minutos)[0];

            if (tarifaPorHora && tarifaPorHora.minutos > 0 && tarifaPorHora.precio > 0) {
                const minutosBloque = tarifaPorHora.minutos;
                const precioBloque = tarifaPorHora.precio || 0;
                
                // Bloques completados (redondeo hacia arriba para el cobro)
                const bloquesCompletados = Math.ceil(tiempoTranscurridoMin / minutosBloque);
                let precioAlojamientoBase = bloquesCompletados * precioBloque;

                // Aplicar impuesto si no está incluido
                const porcentajeImpuesto = parseFloat(hotelConfigGlobal?.porcentaje_impuesto_principal || 0);
                if (porcentajeImpuesto > 0 && !hotelConfigGlobal?.impuestos_incluidos_en_precios) {
                     precioAlojamientoBase = precioAlojamientoBase * (1 + (porcentajeImpuesto / 100));
                }
                
                montoAlojamientoCalculado = Math.round(precioAlojamientoBase);
                // NOTA: No actualizamos la BD aquí, solo calculamos el valor actual para la validación.
            } else {
                 console.error("No se pudo encontrar tarifa base para cálculo dinámico de Duración Abierta.");
            }
        }
        // --- FIN DE LA LÓGICA DE CÁLCULO PARA DURACIÓN ABIERTA ---


        // 2. Obtener TODOS los cargos asociados, usando el monto calculado para alojamiento
        const alojamientoCargo = { subtotal: montoAlojamientoCalculado }; // <--- USO DEL MONTO CALCULADO
        
        // Ventas de Tienda (la lógica sigue igual)
        const { data: ventasTienda } = await supabase.from('ventas_tienda').select('id').eq('reserva_id', reservaId);
        let totalTienda = 0;
        if (ventasTienda && ventasTienda.length > 0) {
            const ventaTiendaIds = ventasTienda.map(v => v.id);
            const { data: detallesTienda } = await supabase.from('detalle_ventas_tienda').select('subtotal').in('venta_id', ventaTiendaIds);
            if (detallesTienda) {
                totalTienda = detallesTienda.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
            }
        }

        // Ventas de Restaurante (la lógica sigue igual)
        const { data: ventasRest } = await supabase.from('ventas_restaurante').select('id').eq('reserva_id', reservaId);
        let totalRestaurante = 0;
        if (ventasRest && ventasRest.length > 0) {
            const ventaRestIds = ventasRest.map(v => v.id);
            const { data: detallesRest } = await supabase.from('ventas_restaurante_items').select('subtotal').in('venta_id', ventaRestIds);
            if (detallesRest) {
                totalRestaurante = detallesRest.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
            }
        }

        // Servicios Adicionales (la lógica sigue igual)
        const { data: servicios } = await supabase.from('servicios_x_reserva').select('precio_cobrado').eq('reserva_id', reservaId);
        const totalServicios = servicios ? servicios.reduce((sum, item) => sum + (Number(item.precio_cobrado) || 0), 0) : 0;

        // 3. Calcular el total real de la deuda
        const totalDeTodosLosCargos = alojamientoCargo.subtotal + totalTienda + totalRestaurante + totalServicios;
        const totalPagado = Number(reserva.monto_pagado) || 0;
        const saldoPendiente = totalDeTodosLosCargos - totalPagado;
        
        // 4. Validar y mostrar el modal si es necesario
        if (saldoPendiente > 0.01) { 
            const htmlPendientes = `
                <div class="text-left">
                    <p class="mb-3">No se puede finalizar la estancia porque la cuenta tiene un saldo pendiente de:</p>
                    <div class="text-center text-3xl font-bold text-red-600 my-4">${formatCurrency(saldoPendiente)}</div>
                    <p class="mt-4 font-semibold">Por favor, cobre el saldo total antes de entregar la habitación.</p>
                </div>
            `;
            
            mostrarInfoModalGlobal(htmlPendientes, "⚠️ Deuda Pendiente");
            return false;
        }

        // Si no hay deuda, se puede entregar
        return true;

    } catch (error) {
        console.error("Error en validarCargosPendientesAntesDeEntregar:", error);
        mostrarInfoModalGlobal(`Ocurrió un error al validar las deudas: ${error.message}`, "Error de Validación");
        return false;
    }
}


// =========================================================================================
// FUNCIONES AUXILIARES PARA CÁLCULO Y CIERRE
// =========================================================================================

// =========================================================================================
// 1. FUNCIÓN DE CÁLCULO DE PRECIO (LÓGICA DE REDONDEO HACIA ARRIBA)
// =========================================================================================
async function calculateTimeAndPrice(supabase, reservaActiva, hotelId, hotelConfig) {
    // Si NO es duración abierta, devolvemos el monto fijo que ya tiene
    if (reservaActiva.tipo_duracion !== 'abierta') {
        return {
            tiempoTranscurridoMin: 0,
            precioAlojamientoCalculado: Number(reservaActiva.monto_total) || 0,
            bloquesCompletados: 0,
            minutosBloque: 0
        };
    }
    
    const now = new Date();
    const inicio = new Date(reservaActiva.fecha_inicio);
    // Calculamos minutos totales transcurridos (Redondeo hacia arriba para capturar el primer minuto)
    let tiempoTranscurridoMin = Math.ceil((now - inicio) / 60000);
    
    // Asegurar que siempre haya al menos 1 minuto para forzar el cobro mínimo
    if (tiempoTranscurridoMin <= 0) tiempoTranscurridoMin = 1; 
    
    // Obtenemos las tarifas
    const tiempos = await getTiemposEstancia(supabase, hotelId);
    
    // BUSCAMOS LA TARIFA BASE: La duración activa más corta (ej. 1 Hora)
    const tarifaBase = tiempos.filter(t => t.minutos > 0).sort((a, b) => a.minutos - b.minutos)[0];

    let precioAlojamientoCalculado = 0;
    let bloquesCompletados = 0;
    let minutosBloque = 0;
    
    if (tarifaBase && tarifaBase.minutos > 0 && tarifaBase.precio > 0) {
        minutosBloque = tarifaBase.minutos; 
        const precioBloque = tarifaBase.precio || 0; 
        
        // LÓGICA DE COBRO: 
        // Si lleva 1 min y el bloque es de 60 min -> Math.ceil(1/60) = 1 bloque.
        bloquesCompletados = Math.ceil(tiempoTranscurridoMin / minutosBloque);
        
        // Seguridad adicional: Si es tiempo libre, MÍNIMO se cobra 1 bloque siempre.
        if (bloquesCompletados < 1) bloquesCompletados = 1;

        let precioAlojamientoBase = bloquesCompletados * precioBloque;

        // Impuestos
        const porcentajeImpuesto = parseFloat(hotelConfig?.porcentaje_impuesto_principal || 0);
        if (porcentajeImpuesto > 0 && !hotelConfig.impuestos_incluidos_en_precios) {
             precioAlojamientoBase = precioAlojamientoBase * (1 + (porcentajeImpuesto / 100));
        }
        precioAlojamientoCalculado = Math.round(precioAlojamientoBase);
    }
    
    return { 
        tiempoTranscurridoMin, 
        precioAlojamientoCalculado,
        bloquesCompletados,
        minutosBloque
    };
}

// ======================================================================
// CALCULAR SALDO REAL DE LA RESERVA (CON DESGLOSE)
// ======================================================================
async function calcularSaldoReserva(supabase, reservaId, hotelId) {
    // 1. Obtener datos básicos de la reserva
    const { data: reserva, error: errRes } = await supabase
        .from('reservas')
        .select('id, monto_total, tipo_duracion, fecha_inicio')
        .eq('id', reservaId)
        .single();

    if (errRes || !reserva) {
        console.error("[calcularSaldoReserva] Error obteniendo reserva:", errRes);
        throw errRes || new Error("Reserva no encontrada");
    }

    // 2. Calcular Alojamiento (si es tiempo libre, calcular al vuelo)
    let montoTotalAlojamiento = Number(reserva.monto_total) || 0;

    if (reserva.tipo_duracion === 'abierta') {
        const calculoTiempo = await calculateTimeAndPrice(
            supabase,
            reserva,
            hotelId,
            hotelConfigGlobal
        );
        montoTotalAlojamiento = Number(calculoTiempo.precioAlojamientoCalculado) || 0;
    }

    // 3. Traer consumos extras y pagos
    const [
        ventasTiendaRes,
        ventasRestRes,
        serviciosRes,
        pagosRes
    ] = await Promise.all([
        supabase.from('ventas_tienda').select('total_venta').eq('reserva_id', reservaId),
        supabase.from('ventas_restaurante').select('monto_total').eq('reserva_id', reservaId),
        supabase.from('servicios_x_reserva').select('precio_cobrado').eq('reserva_id', reservaId),
        supabase.from('pagos_reserva').select('monto').eq('reserva_id', reservaId)
    ]);

    // 4. Sumatorias
    const totalTienda = ventasTiendaRes.data ? ventasTiendaRes.data.reduce((sum, item) => sum + (Number(item.total_venta) || 0), 0) : 0;
    const totalRestaurante = ventasRestRes.data ? ventasRestRes.data.reduce((sum, item) => sum + (Number(item.monto_total) || 0), 0) : 0;
    const totalServicios = serviciosRes.data ? serviciosRes.data.reduce((sum, item) => sum + (Number(item.precio_cobrado) || 0), 0) : 0;
    const totalPagado = pagosRes.data ? pagosRes.data.reduce((sum, item) => sum + (Number(item.monto) || 0), 0) : 0;

    // 5. Totales finales
    const totalDeTodosLosCargos = montoTotalAlojamiento + totalTienda + totalRestaurante + totalServicios;
    const saldoPendiente = Math.round((totalDeTodosLosCargos - totalPagado) * 100) / 100;

    // RETORNAMOS EL DESGLOSE COMPLETO
    return {
        totalDeTodosLosCargos,
        totalPagado,
        saldoPendiente,
        desglose: {
            alojamiento: montoTotalAlojamiento,
            tienda: totalTienda,
            restaurante: totalRestaurante,
            servicios: totalServicios
        }
    };
}


// =========================================================================================
// 3. FUNCIÓN FINAL DE CIERRE (CON DESGLOSE DE CAJA CORREGIDO)
// =========================================================================================
async function registrarPagosYCierreReserva({ reservaActiva, room, supabase, currentUser, hotelId, mainAppContainer, pagos, totalCosto, desgloseDeuda }) {
    const totalPagadoExt = pagos.reduce((sum, p) => sum + p.monto, 0);
    showGlobalLoading(); 

    try {
        // 1. Validar turno
        const turnoId = turnoService.getActiveTurnId();
        if (!turnoId) throw new Error("ACCIÓN BLOQUEADA: No hay turno de caja activo.");

        // 2. Calcular proporciones si hay deuda (para no asignar todo a alojamiento)
        // Si desgloseDeuda no viene (caso raro), asumimos todo es alojamiento.
        const deudaTotalBase = desgloseDeuda 
            ? (desgloseDeuda.alojamiento + desgloseDeuda.tienda + desgloseDeuda.restaurante + desgloseDeuda.servicios) 
            : totalCosto;

        const safeDeuda = deudaTotalBase > 0 ? deudaTotalBase : 1; // Evitar división por cero

        if (totalPagadoExt > 0) {
            // A. Registrar Pagos en 'pagos_reserva' (Aquí sí se guarda el total por método)
            const pagosParaInsertar = pagos.map(p => ({
                hotel_id: hotelId, reserva_id: reservaActiva.id, monto: p.monto,
                fecha_pago: new Date().toISOString(), metodo_pago_id: p.metodo_pago_id,
                usuario_id: currentUser.id, concepto: `Cierre Cuenta Hab. ${room.nombre}`
            }));
            
            const { data: pagosData, error: errPagoReserva } = await supabase.from('pagos_reserva').insert(pagosParaInsertar).select('id');
            if (errPagoReserva) throw new Error(`Error pagos: ${errPagoReserva.message}`);

            // B. Registrar Movimientos en 'caja' (AQUÍ DESGLOSAMOS)
            let movimientosCaja = [];

            pagos.forEach((pago, index) => {
                const pagoId = pagosData[index].id;
                const factor = pago.monto / safeDeuda; // Qué % de la deuda cubre este pago

                // Helper para crear movimiento
                const pushMov = (montoBase, conceptoTipo) => {
                    const montoParcial = Math.round((montoBase * factor) * 100) / 100;
                    if (montoParcial > 0) {
                        movimientosCaja.push({
                            hotel_id: hotelId, tipo: 'ingreso', monto: montoParcial,
                            concepto: `Pago ${conceptoTipo} (Hab. ${room.nombre})`, // <--- CLAVE PARA EL REPORTE
                            fecha_movimiento: new Date().toISOString(), metodo_pago_id: pago.metodo_pago_id,
                            usuario_id: currentUser.id, reserva_id: reservaActiva.id,
                            pago_reserva_id: pagoId, turno_id: turnoId,
                        });
                    }
                };

                if (desgloseDeuda) {
                    pushMov(desgloseDeuda.tienda, 'Tienda');
                    pushMov(desgloseDeuda.restaurante, 'Restaurante/Cocina');
                    pushMov(desgloseDeuda.servicios, 'Servicios');
                    
                    // El resto va a alojamiento para cuadrar decimales
                    const sumaParciales = movimientosCaja
                        .filter(m => m.pago_reserva_id === pagoId)
                        .reduce((sum, m) => sum + m.monto, 0);
                    
                    // CORRECCIÓN AQUÍ: Usar 'pago.monto' en lugar de 'p.monto'
                    const restoAlojamiento = pago.monto - sumaParciales; 
                    
                    if (restoAlojamiento > 0) {
                         movimientosCaja.push({
                            hotel_id: hotelId, tipo: 'ingreso', monto: restoAlojamiento,
                            concepto: `Pago Alojamiento (Hab. ${room.nombre})`,
                            fecha_movimiento: new Date().toISOString(), metodo_pago_id: pago.metodo_pago_id,
                            usuario_id: currentUser.id, reserva_id: reservaActiva.id,
                            pago_reserva_id: pagoId, turno_id: turnoId,
                        });
                    }
                } else {
                    // Fallback por si no hay desglose
                     movimientosCaja.push({
                        hotel_id: hotelId, tipo: 'ingreso', monto: pago.monto,
                        concepto: `Cierre Cuenta Hab. ${room.nombre}`,
                        fecha_movimiento: new Date().toISOString(), metodo_pago_id: pago.metodo_pago_id,
                        usuario_id: currentUser.id, reserva_id: reservaActiva.id,
                        pago_reserva_id: pagoId, turno_id: turnoId,
                    });
                }
            });

            const { error: errCaja } = await supabase.from('caja').insert(movimientosCaja);
            if (errCaja) throw new Error(`Error caja: ${errCaja.message}`);
        }
        
        // 3. Finalizar reserva
        const nuevoMontoPagado = (Number(reservaActiva.monto_pagado) || 0) + totalPagadoExt;
        const { error: updateError } = await supabase.from('reservas').update({
            monto_total: totalCosto, 
            monto_pagado: nuevoMontoPagado, 
            fecha_fin: new Date().toISOString(),
            estado: 'completada'
        }).eq('id', reservaActiva.id);

        if (updateError) throw new Error(`Error actualizando reserva: ${updateError.message}`);

        // 4. Liberar habitación
        await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', reservaActiva.id);
        await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);

        // 5. UI Update
        document.getElementById('modal-container').style.display = "none";
        document.getElementById('modal-container').innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        Swal.fire('¡Check-out Exitoso!', `Cuenta saldada y desglosada en caja.`, 'success');

    } catch (error) {
        console.error("Error cierre:", error);
        mostrarInfoModalGlobal(`Error: ${error.message}`, "Error Crítico");
    } finally {
        hideGlobalLoading();
    }
}






// =========================================================================================
// LISTENER PARA EL BOTÓN DE ENTREGAR HABITACIÓN (Lógica de Tiempo Libre + Pago)
// =========================================================================================


// =================== BOTÓN ENTREGAR / LIBERAR (ACTUALIZADO) ===================
setupButtonListener('btn-entregar', async (btn, room) => {
    
    const originalContent = btn.innerHTML;
    
    // 1. Confirmación inicial
    const confirmResult = await Swal.fire({
        title: `¿Entregar Habitación ${room.nombre}?`,
        text: "Se calculará el tiempo final y verificará pagos.",
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#3085d6',
        confirmButtonText: 'Procesar',
        cancelButtonText: 'Cancelar'
    });

    if (!confirmResult.isConfirmed) return;
    
    btn.disabled = true;
    btn.innerHTML = 'Procesando...';
    showGlobalLoading(); 

    try {
        // 2. Buscar reserva
        let reservaActiva = null;
        const { data, error } = await supabaseGlobal
            .from('reservas')
            .select('id, fecha_fin, fecha_inicio, tipo_duracion, monto_total, monto_pagado, cliente_id') 
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (error || !data) throw new Error(`No se encontró reserva activa.`);
        reservaActiva = data;
        
        // 3. Actualizar Tiempo Libre (si aplica)
        if (reservaActiva.tipo_duracion === 'abierta') {
            const calculo = await calculateTimeAndPrice(supabaseGlobal, reservaActiva, hotelIdGlobal, hotelConfigGlobal);
            await supabaseGlobal.from('reservas').update({ 
                monto_total: calculo.precioAlojamientoCalculado,
                fecha_fin: new Date().toISOString()
            }).eq('id', reservaActiva.id);
            reservaActiva.monto_total = calculo.precioAlojamientoCalculado;
        }
        
        // 4. OBTENER SALDOS Y DESGLOSE (AQUÍ ESTÁ EL CAMBIO)
        const { totalDeTodosLosCargos, saldoPendiente, desglose } = await calcularSaldoReserva(supabaseGlobal, reservaActiva.id, hotelIdGlobal);

        hideGlobalLoading();

        // 5. Validar Pagos
        if (saldoPendiente > 50) {
            // Aún debe dinero
            const swalCosto = await Swal.fire({
                title: "Resumen de Cuenta",
                html: `
                    <div class="text-left text-sm">
                        <p>Total Cargos: <strong>${formatCurrency(totalDeTodosLosCargos)}</strong></p>
                        <ul class="text-xs text-gray-500 ml-4 mb-2">
                           <li>🏠 Alojamiento: ${formatCurrency(desglose.alojamiento)}</li>
                           <li>🛒 Tienda: ${formatCurrency(desglose.tienda)}</li>
                           <li>🍽️ Restaurante: ${formatCurrency(desglose.restaurante)}</li>
                           <li>🛎️ Servicios: ${formatCurrency(desglose.servicios)}</li>
                        </ul>
                        <hr class="my-2">
                        <p class="text-xl text-red-600 font-bold text-center">Pendiente: ${formatCurrency(saldoPendiente)}</p>
                    </div>`,
                icon: 'warning',
                confirmButtonText: 'Ir a Pagar',
                showCancelButton: true,
                cancelButtonText: 'Cancelar'
            });

            if (!swalCosto.isConfirmed) { btn.disabled = false; btn.innerHTML = originalContent; return; }

            showGlobalLoading();
            const { data: metodosPago } = await supabaseGlobal.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelIdGlobal).eq('activo', true);
            metodosPago.unshift({ id: "mixto", nombre: "Pago Mixto" });
            hideGlobalLoading();

            // Callback al pagar (PASAMOS EL DESGLOSE)
            const alConfirmarPago = async (pagosRealizados) => {
                const modalPago = document.getElementById('modal-container-secondary'); 
                if(modalPago) modalPago.style.display = 'none';
                
                await registrarPagosYCierreReserva({
                    reservaActiva, room, supabase: supabaseGlobal, currentUser: currentUserGlobal, 
                    hotelId: hotelIdGlobal, mainAppContainer, 
                    pagos: pagosRealizados, 
                    totalCosto: totalDeTodosLosCargos,
                    desgloseDeuda: desglose // <--- PASAMOS EL DESGLOSE AQUÍ
                });
            };

            showPagoMixtoModal(saldoPendiente, metodosPago, alConfirmarPago);

        } else {
            // Ya está pagado
             const confirmSalida = await Swal.fire({
                title: 'Cuenta Saldada',
                text: 'El saldo es $0. ¿Liberar habitación?',
                icon: 'success',
                showCancelButton: true,
                confirmButtonText: 'Sí, Liberar'
            });

            if (confirmSalida.isConfirmed) {
                // Pasamos pagos vacío pero el totalCosto para cerrar
                await registrarPagosYCierreReserva({
                    reservaActiva, room, supabase: supabaseGlobal, currentUser: currentUserGlobal, 
                    hotelId: hotelIdGlobal, mainAppContainer, 
                    pagos: [], 
                    totalCosto: totalDeTodosLosCargos,
                    desgloseDeuda: desglose
                });
            } else {
                btn.disabled = false;
                btn.innerHTML = originalContent;
            }
        }

    } catch (error) {
        hideGlobalLoading();
        console.error("Error checkout:", error);
        mostrarInfoModalGlobal(`Error: ${error.message}`, "Error Crítico");
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
});

// ----------------------------------------------------------------------------------------
// ❗ Nota sobre "Ver Consumos" (Punto 2 del requerimiento del usuario)
// ----------------------------------------------------------------------------------------
// Para que el modal "Ver Consumos" muestre el precio por bloque (costo en dinero),
// debes asegurarte de que la función `showConsumosYFacturarModal` también utilice la lógica
// de `calculateTimeAndPrice` para obtener el costo de la estancia y mostrarlo en la tabla
// de consumos.


  // =================== BOTÓN VER CONSUMOS (igual que antes)
   // Utilidades
const formatCurrency = val => Number(val || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP' });
const formatDateTime = d => new Date(d).toLocaleString('es-CO');


// =================== BOTÓN VER CONSUMOS (CORREGIDO) ===================
setupButtonListener('btn-ver-consumos', async (btn, roomContext) => {
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Calculando...';
    btn.disabled = true;

    try {
        // 1. Buscar la reserva actual para asegurar precios de tiempo libre actualizados
        const { data: reservaPre } = await supabaseGlobal
            .from('reservas')
            .select('id, fecha_inicio, tipo_duracion, monto_total')
            .eq('habitacion_id', roomContext.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .limit(1)
            .maybeSingle();

        // Si es tiempo libre, actualizar monto_total a lo que corresponde AHORA antes de abrir el modal
        if (reservaPre && reservaPre.tipo_duracion === 'abierta') {
            const calculo = await calculateTimeAndPrice(
                supabaseGlobal,
                reservaPre,
                hotelIdGlobal,
                hotelConfigGlobal
            );

            // Actualizamos solo si hay diferencia para mantener la BD al día
            if (calculo.precioAlojamientoCalculado !== Number(reservaPre.monto_total)) {
                await supabaseGlobal
                    .from('reservas')
                    .update({ monto_total: calculo.precioAlojamientoCalculado })
                    .eq('id', reservaPre.id);
            }
        }
    } catch (err) {
        console.error("Error actualizando precio tiempo libre antes de ver consumos:", err);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }

    // 2. Abrir el modal de consumos (aquí el usuario puede pagar)
    // NOTA: showConsumosYFacturarModal debe ser una función async que espera a que el modal se cierre
    // o el modal debe gestionar sus propios eventos. Asumimos que al cerrar el modal, el flujo continúa.
    await showConsumosYFacturarModal(
        roomContext,
        supabaseGlobal,
        currentUserGlobal,
        hotelIdGlobal,
        mainAppContainer,
        btn
    );

    // 3. VERIFICACIÓN POST-CIERRE DEL MODAL
    // Consultamos el saldo FRESH desde la base de datos
    try {
        // Pequeña pausa para asegurar que la BD haya procesado cualquier transacción del modal
        await new Promise(r => setTimeout(r, 300));

        const { data: reservaCheck } = await supabaseGlobal
            .from('reservas')
            .select('id, monto_total, monto_pagado')
            .eq('habitacion_id', roomContext.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .limit(1)
            .maybeSingle();

        if (reservaCheck) {
            // Usamos calcularSaldoReserva que suma TODOS los pagos reales de la tabla pagos_reserva
            const {
                saldoPendiente,
                totalDeTodosLosCargos
            } = await calcularSaldoReserva(
                supabaseGlobal,
                reservaCheck.id,
                hotelIdGlobal
            );

            console.log(`[Post-Consumos] Cargos: ${totalDeTodosLosCargos}, Saldo Pendiente: ${saldoPendiente}`);

            // LÓGICA DE LIBERACIÓN AUTOMÁTICA
            // Si hay cargos (no es una reserva vacía) Y el saldo es efectivamente CERO (con margen de error de 50 pesos)
            if (totalDeTodosLosCargos > 0 && saldoPendiente >= -50 && saldoPendiente <= 50) {
                
                const confirmSalida = await Swal.fire({
                    title: '¡Cuenta Saldada!',
                    html: `
                        <div class="text-center">
                            <p class="text-gray-600 mb-2">El saldo pendiente es <strong>$0</strong>.</p>
                            <p class="text-xl font-bold text-blue-700">¿Desea liberar la habitación ahora?</p>
                        </div>
                    `,
                    icon: 'success',
                    showCancelButton: true,
                    confirmButtonText: 'Sí, Liberar y Limpieza',
                    cancelButtonText: 'No, mantener ocupada',
                    confirmButtonColor: '#10b981',
                    cancelButtonColor: '#6b7280'
                });

                if (confirmSalida.isConfirmed) {
                    // Llamamos a registrar cierre con lista de pagos vacía porque YA se pagó
                    await registrarPagosYCierreReserva({
                        reservaActiva: reservaCheck,
                        room: roomContext,
                        supabase: supabaseGlobal,
                        currentUser: currentUserGlobal,
                        hotelId: hotelIdGlobal,
                        mainAppContainer,
                        pagos: [], // Array vacío: No cobramos nada nuevo
                        totalCosto: totalDeTodosLosCargos
                    });
                }
            }
        }
    } catch (e) {
        console.error("Error en check post-consumo:", e);
    }
});



// =================== BOTÓN INFO HUÉSPED (igual que antes)
 setupButtonListener('btn-info-huesped', async () => {
    // Buscar la reserva activa
    const { data: reserva, error: errRes } = await supabase
        .from('reservas')
        .select('cliente_nombre, telefono, cantidad_huespedes, fecha_inicio, fecha_fin, notas')
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .single();

    if (errRes || !reserva) {
        mostrarInfoModalGlobal("No hay información del huésped disponible.", "Huésped");
        return;
    }

    let html = `
  <b>👤 Nombre:</b> ${reserva.cliente_nombre}<br>
  <b>📞 Teléfono:</b> ${reserva.telefono}<br>
  <b>🧑‍🤝‍🧑 Huéspedes:</b> ${reserva.cantidad_huespedes}<br>
  <b>🟢 Check-in:</b> ${formatDateTime(reserva.fecha_inicio)}<br>
  <b>🔴 Check-out:</b> ${formatDateTime(reserva.fecha_fin)}<br>
  ${reserva.notas ? `<b>📝 Notas:</b> ${reserva.notas}<br>` : ''}
`;


    mostrarInfoModalGlobal(html, "Información del Huésped");
});

// Añade este bloque junto a los otros listeners, al final de la función

setupButtonListener('btn-enviar-limpieza', async (btn, room) => {
    const originalContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Enviando...
    `;

    try {
        const { error } = await supabase
            .from('habitaciones')
            .update({ estado: 'limpieza' }) // Actualiza el estado a 'limpieza'
            .eq('id', room.id);

        if (error) {
            throw error;
        }

        // Cierra el modal de opciones
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';

        // Refresca el mapa de habitaciones para mostrar el cambio
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);

    } catch (error) {
        console.error("Error al enviar a limpieza:", error);
        mostrarInfoModalGlobal(`Error: ${error.message}`, "Error");
    } finally {
        // En este caso, el 'finally' es solo una buena práctica,
        // ya que el modal se cierra antes, pero no está de más.
        btn.disabled = false;
        btn.innerHTML = originalContent;
    }
});
setupButtonListener('btn-seguimiento-articulos', (btn, roomContext) => {
    // Usamos las variables globales que ya tienes
    showSeguimientoArticulosModal(roomContext, supabaseGlobal, currentUserGlobal, hotelIdGlobal); 
});

}



function crearOpcionesNochesConPersonalizada(horarios, maxNoches = 5, fechaBase = null, room) {
    let opciones = [];
    let baseParaCalculo = fechaBase ? new Date(fechaBase) : new Date(); 
    
    for (let i = 1; i <= maxNoches; i++) {
        let fechaFinCalculada = new Date(baseParaCalculo);
        const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
        fechaFinCalculada.setHours(checkoutH, checkoutM, 0, 0);

        if (baseParaCalculo >= fechaFinCalculada) {
            fechaFinCalculada.setDate(fechaFinCalculada.getDate() + 1);
        }
        fechaFinCalculada.setDate(fechaFinCalculada.getDate() + (i - 1));
        
        // --- CAMBIO CLAVE: Se elimina el precio del texto de la opción ---
        opciones.push({
            noches: i,
            label: `${i} noche${i > 1 ? 's' : ''} (hasta ${formatDateTime(fechaFinCalculada, undefined, {dateStyle:'short'})} ${horarios.checkout})`,
            fechaFin: fechaFinCalculada
        });
    }
    opciones.push({ noches: "personalizada", label: "Personalizada (N noches)..." });
    return opciones;
}


function crearOpcionesHoras(tiempos) { 
    if (!tiempos || tiempos.length === 0) {
        return [];
    }
    const opciones = tiempos
        .filter(t => t.tipo_unidad !== 'noche' && t.minutos > 0) 
        .map(t => {
            const precioAUsar = (t.precio === null || t.precio === 0) && (typeof t.precio_adicional === 'number') 
                                ? t.precio_adicional 
                                : (typeof t.precio === 'number' ? t.precio : 0);
            return {
                minutos: t.minutos,
                label: `${t.nombre || formatHorasMin(t.minutos)} - ${formatCurrency(precioAUsar)}`, 
                precio: precioAUsar 
            };
        });
    
    // ==========================================
    // NUEVA OPCIÓN: DURACIÓN ABIERTA
    // ==========================================
    opciones.push({
        minutos: -1, // Valor clave para identificar la duración abierta
        label: "Duración Abierta (Pago al Check-out)", 
        precio: 0 // El precio se calculará al final
    });
    
    return opciones;
}

// REEMPLAZA esta función completa en tu archivo mapa-habitaciones.js
function calcularDetallesEstancia(dataForm, room, tiempos, horarios, descuentoAplicado) {
    let inicioAt = new Date();
    let finAt;
    let montoEstanciaBaseBruto = 0;
    let montoDescuento = 0;
    let descripcionEstancia = "Seleccione duración";
    let tipoCalculo = null;
    let cantidadCalculo = 0;
    let precioFinalAntesDeImpuestos;

    const nochesSeleccionadas = dataForm.noches ? parseInt(dataForm.noches) : 0;
    const minutosSeleccionados = dataForm.horas ? parseInt(dataForm.horas) : 0;
    
    const precioLibreActivado = dataForm.precio_libre_toggle === 'on';
    const precioLibreValor = parseFloat(dataForm.precio_libre_valor);

    // --- INICIO DE LA LÓGICA CORREGIDA ---
    if (precioLibreActivado && !isNaN(precioLibreValor) && precioLibreValor >= 0) {
        
        montoEstanciaBaseBruto = precioLibreValor;
        montoDescuento = 0; // Forzamos el descuento a cero.
        precioFinalAntesDeImpuestos = precioLibreValor;
        descripcionEstancia = "Estancia (Precio Manual)";
        tipoCalculo = 'manual';
        cantidadCalculo = precioLibreValor;

        // Se sigue calculando la fecha de fin para el registro
        if (nochesSeleccionadas > 0) {
            let fechaSalida = new Date(inicioAt);
            fechaSalida.setDate(fechaSalida.getDate() + nochesSeleccionadas);
            const [checkoutH, checkoutM] = (horarios.checkout || "12:00").split(':').map(Number);
            fechaSalida.setHours(checkoutH, checkoutM, 0, 0);
            finAt = fechaSalida;
        } else if (minutosSeleccionados > 0) {
            finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
        } else {
            finAt = new Date(inicioAt); // Si no hay duración, no se mueve.
        }

    } else {
        // --- LÓGICA DE CÁLCULO NORMAL (SI EL PRECIO MANUAL NO ESTÁ ACTIVO) ---
        if (nochesSeleccionadas > 0) {
            tipoCalculo = 'noches';
            cantidadCalculo = nochesSeleccionadas;
            descripcionEstancia = `${nochesSeleccionadas} noche${nochesSeleccionadas > 1 ? 's' : ''}`;

            let fechaSalida = new Date(inicioAt);
            fechaSalida.setDate(fechaSalida.getDate() + nochesSeleccionadas);
            // 🐛 ERROR DE SINTAXIS CORREGIDO AQUÍ:
            const [checkoutH, checkoutM] = (horarios.checkout || "12:00").split(':').map(Number);
            fechaSalida.setHours(checkoutH, checkoutM, 0, 0);
            finAt = fechaSalida;
            
            let precioBasePorNoche = 0;
            const cantidadHuespedes = parseInt(dataForm.cantidad_huespedes) || 1;
            if (cantidadHuespedes === 1) precioBasePorNoche = room.precio_1_persona || 0;
            else precioBasePorNoche = room.precio_2_personas || 0;

            if (cantidadHuespedes > 2) {
                const huespedesAdicionales = cantidadHuespedes - 2;
                const costoAdicional = room.precio_huesped_adicional || 0;
                precioBasePorNoche += huespedesAdicionales * costoAdicional;
            }
            montoEstanciaBaseBruto = precioBasePorNoche * nochesSeleccionadas;

        } else if (minutosSeleccionados > 0) {
            tipoCalculo = 'horas';
            cantidadCalculo = minutosSeleccionados;
            finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
            descripcionEstancia = formatHorasMin(minutosSeleccionados);
            const tiempoSeleccionado = tiempos.find(t => t.minutos === minutosSeleccionados);
            montoEstanciaBaseBruto = tiempoSeleccionado?.precio || 0;
        
        } else if (minutosSeleccionados === -1) { 
            tipoCalculo = 'abierta';
            cantidadCalculo = 0;
            // Se establece una fecha de fin muy lejana para que el cronómetro cuente hacia arriba
            finAt = new Date(inicioAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000); 
            descripcionEstancia = "Duración Abierta";
            montoEstanciaBaseBruto = 0; // El costo se calcula al final
            
        } else {
            finAt = new Date(inicioAt);
        }

        const totalAntesDeDescuento = montoEstanciaBaseBruto;
        if (descuentoAplicado) {
            if (descuentoAplicado.tipo === 'fijo') {
                montoDescuento = parseFloat(descuentoAplicado.valor);
            } else if (descuentoAplicado.tipo === 'porcentaje') {
                montoDescuento = totalAntesDeDescuento * (parseFloat(descuentoAplicado.valor) / 100);
            }
        }
        montoDescuento = Math.min(totalAntesDeDescuento, montoDescuento);
        precioFinalAntesDeImpuestos = totalAntesDeDescuento - montoDescuento;
    }
    // --- FIN DE LA LÓGICA CORREGIDA ---


    // --- CÁLCULO DE IMPUESTOS (COMÚN PARA AMBOS CASOS) ---
    let montoImpuesto = 0;
    let precioFinalConImpuestos = precioFinalAntesDeImpuestos;
    const porcentajeImpuesto = parseFloat(hotelConfigGlobal?.porcentaje_impuesto_principal || 0);
    if (porcentajeImpuesto > 0) {
        if (hotelConfigGlobal?.impuestos_incluidos_en_precios) {
            const baseImponible = precioFinalAntesDeImpuestos / (1 + (porcentajeImpuesto / 100));
            montoImpuesto = precioFinalAntesDeImpuestos - baseImponible;
        } else {
            montoImpuesto = precioFinalAntesDeImpuestos * (porcentajeImpuesto / 100);
            precioFinalConImpuestos += montoImpuesto;
        }
    }

    return {
        inicioAt,
        finAt,
        // Si es duración abierta, el total es 0, de lo contrario, se usa el cálculo normal
        precioTotal: tipoCalculo === 'abierta' ? 0 : Math.round(precioFinalConImpuestos),
        montoDescontado: tipoCalculo === 'abierta' ? 0 : Math.round(montoDescuento),
        montoImpuesto: tipoCalculo === 'abierta' ? 0 : Math.round(montoImpuesto),
        precioBase: tipoCalculo === 'abierta' ? 0 : Math.round(montoEstanciaBaseBruto),
        descripcionEstancia,
        tipoCalculo,
        cantidadCalculo,
        descuentoAplicado
    };
}

// =========================================================================================
async function facturarElectronicaYMostrarResultado({
    supabase,           // Instancia del cliente Supabase
    hotelId,            // ID del hotel actual
    reserva,            // Objeto de la reserva (debe incluir id, cliente_nombre, cedula, monto_total, y opcionalmente habitacion_nombre)
    consumosTienda,     // Array de consumos de la tienda [{nombre, cantidad, subtotal}, ...]
    consumosRest,       // Array de consumos del restaurante [{nombre, cantidad, subtotal}, ...]
    consumosServicios,  // Array de servicios adicionales [{nombre, cantidad, subtotal}, ...]
    metodoPagoIdLocal,  // ID del método de pago seleccionado en TU sistema (ej. el valor de 'metodoPagoFact')
    // La variable 'room' (con room.nombre) debe estar accesible o su nombre debe pasarse en 'reserva.habitacion_nombre'
    // para el detalle del ítem de la estancia. Usaremos reserva.habitacion_nombre como ejemplo.
}) {
    const FN_NAME = "facturarElectronicaYMostrarResultado"; // Para logs
    console.log(`${FN_NAME} | Iniciando para Reserva ID: ${reserva?.id}, Hotel ID: ${hotelId}`);
    if (!reserva || !reserva.id) {
        mostrarInfoModalGlobal("Datos de la reserva incompletos para facturación electrónica.", "Error Interno");
        console.error(`${FN_NAME} | Objeto 'reserva' o 'reserva.id' no proporcionado.`);
        return;
    }
    console.log(`${FN_NAME} | Datos Reserva:`, reserva);
    console.log(`${FN_NAME} | Consumos Tienda:`, consumosTienda);
    console.log(`${FN_NAME} | Consumos Restaurante:`, consumosRest);
    console.log(`${FN_NAME} | Consumos Servicios:`, consumosServicios);
    console.log(`${FN_NAME} | Método de Pago Local ID:`, metodoPagoIdLocal);

    // 1. Cargar configuración de integración electrónica del hotel desde Supabase
    let integracion;
    try {
        const { data, error } = await supabase
            .from('integraciones_hotel')
            .select('facturador_nombre, facturador_usuario, facturador_api_key, facturador_api_url')
            .eq('hotel_id', hotelId)
            .maybeSingle();
        if (error) throw error;
        integracion = data;
    } catch (dbError) {
        console.error(`${FN_NAME} | Error al cargar la configuración del facturador:`, dbError);
        mostrarInfoModalGlobal(
            `Error crítico al cargar la configuración del facturador: ${dbError.message}. Verifique la conexión o la configuración interna.`,
            "Error Configuración Facturador"
        );
        return;
    }

    console.log(`${FN_NAME} | Datos de integración cargados:`, integracion);

    if (!integracion || !integracion.facturador_usuario || !integracion.facturador_api_key || !integracion.facturador_api_url) {
        mostrarInfoModalGlobal(
            "La configuración del facturador electrónico está incompleta (faltan usuario, API key o URL base). Vaya a Configuración -> Integraciones del Hotel y complete los datos.",
            "Configuración Incompleta del Facturador"
        );
        return;
    }

    if (integracion.facturador_nombre && integracion.facturador_nombre.toLowerCase() !== 'alegra') {
        mostrarInfoModalGlobal(
            `Este sistema está configurado para facturar con Alegra, pero el proveedor configurado es '${integracion.facturador_nombre}'. No se puede procesar la factura electrónica.`,
            "Proveedor de Facturación Incorrecto"
        );
        return;
    }

    // 2. Preparar token de autenticación Basic para Alegra
    const tokenBasic = btoa(`${integracion.facturador_usuario}:${integracion.facturador_api_key}`);
    // console.log(`${FN_NAME} | Token Basic generado.`); // No loguear el token en producción por seguridad

    // 3. Preparar los ítems de la factura para el payload de Alegra
    const itemsAlegra = [];

    // Ítem principal: Costo de la estancia
    if (reserva && typeof reserva.monto_total === 'number' && reserva.monto_total > 0) {
        itemsAlegra.push({
            name: `Estancia Habitación ${reserva.habitacion_nombre || 'Principal'}`, // Usar reserva.habitacion_nombre o un genérico
            price: parseFloat(reserva.monto_total.toFixed(2)), // Precio total de la estancia como precio unitario del ítem
            quantity: 1,
            description: `Servicio de alojamiento principal.`,
            // Opcional: Si tienes el ID de un producto/servicio "Estancia" configurado en Alegra:
            // id: ID_PRODUCTO_ESTANCIA_EN_ALEGRA,
            // Para impuestos: si el monto_total ya incluye impuestos y Alegra está configurado así, está bien.
            // Si no, y quieres que Alegra los calcule, el ítem "Estancia" en Alegra debe tener los impuestos asociados.
            // O puedes enviar el desglose aquí: tax: [{ id: ID_IMPUESTO_HOTELERIA_ALEGRA }]
        });
    }

    // Ítems adicionales: Consumos
    const todosLosConsumos = [
        ...(consumosTienda || []),
        ...(consumosRest || []),
        ...(consumosServicios || [])
    ];

    todosLosConsumos.forEach(item => {
        if (!item.nombre || typeof item.cantidad === 'undefined' || typeof item.subtotal === 'undefined') {
            console.warn(`${FN_NAME} | Item de consumo omitido por datos incompletos:`, item);
            return;
        }
        if (item.cantidad <= 0 && item.subtotal !== 0) {
            console.warn(`${FN_NAME} | Item de consumo omitido por cantidad inválida para su subtotal:`, item);
            return;
        }
        if (item.subtotal < 0) {
            console.warn(`${FN_NAME} | Item de consumo omitido por subtotal negativo:`, item);
            return;
        }
        // Solo agregar items con valor o cantidad. Si la cantidad es 0 y el subtotal es 0, no tiene sentido facturarlo.
        if (item.cantidad > 0 || item.subtotal > 0) {
            itemsAlegra.push({
                name: item.nombre.substring(0, 150), // Limitar longitud
                quantity: item.cantidad,
                price: item.cantidad > 0 ? parseFloat((item.subtotal / item.cantidad).toFixed(2)) : 0, // Precio unitario
                // Opcional: id: ID_PRODUCTO_EN_ALEGRA (si lo tienes mapeado)
                // Opcional: tax: [{ id: ID_IMPUESTO_EN_ALEGRA }] (si necesitas especificarlo)
            });
        }
    });

    if (itemsAlegra.length === 0) {
        mostrarInfoModalGlobal(
            "No hay ítems válidos (incluyendo estancia o consumos) para incluir en la factura electrónica. Verifique los montos y consumos.",
            "Error en Ítems de Factura"
        );
        return;
    }
    console.log(`${FN_NAME} | Items preparados para Alegra:`, JSON.stringify(itemsAlegra, null, 2));

    // 4. Mapear método de pago local a los esperados por Alegra
    let paymentFormAlegra = "CASH"; // "CASH" (Contado), "CREDIT" (Crédito)
    let paymentMethodAlegra = "CASH"; // "CASH", "TRANSFER", "CHECK", "CREDIT_CARD", "OTHER_PAYMENT_METHOD"

    // Ejemplo básico de mapeo (debes ajustarlo a tus IDs y a los valores de Alegra)
    // Este mapeo debería ser más robusto, quizás cargado desde una configuración.
    if (metodoPagoIdLocal) {
        // Asumimos que tienes una forma de saber si un método de pago local es "Crédito" o "Contado"
        // y cuál es el método específico para Alegra.
        // EJEMPLO MUY SIMPLIFICADO:
        // if (metodoPagoIdLocal === 'ID_DE_TU_PAGO_TARJETA_CREDITO') {
        //     paymentFormAlegra = "CREDIT"; // O podría seguir siendo CASH si es pago inmediato con tarjeta
        //     paymentMethodAlegra = "CREDIT_CARD";
        // } else if (metodoPagoIdLocal === 'ID_DE_TU_PAGO_TRANSFERENCIA') {
        //     paymentFormAlegra = "CASH";
        //     paymentMethodAlegra = "TRANSFER";
        // } // ... etc.
        console.log(`${FN_NAME} | Usando método de pago local ID ${metodoPagoIdLocal}. Mapeo pendiente para Alegra (actualmente defaulting a CASH).`);
    }


    // 5. Construir el payload completo para la API de Alegra
    const payload = {
        date: new Date().toISOString().slice(0,10),      // Fecha de emisión YYYY-MM-DD
        dueDate: new Date().toISOString().slice(0,10),    // Fecha de vencimiento YYYY-MM-DD (misma para contado)
        client: {
            name: reserva.cliente_nombre ? reserva.cliente_nombre.substring(0, 100) : "Cliente Ocasional",
            identification: reserva.cedula || "222222222222", // NIT genérico para consumidor final en Colombia
            // Considera agregar 'identificationType' si es requerido por Alegra/DIAN para Colombia.
            // Ejemplo: identificationObject: { type: "CC", number: "123456789" }
            //         o simplemente identification: "123456789" y Alegra infiere o tiene un default.
            //         Verifica la documentación de Alegra para el formato exacto.
            // email: reserva.email_cliente || undefined, // Si tienes el email
            // phonePrimary: reserva.telefono_cliente || undefined, // Si tienes el teléfono
            // address: { street: reserva.direccion_cliente || undefined, city: reserva.ciudad_cliente || undefined } // Si tienes dirección
        },
        items: itemsAlegra,
        paymentForm: paymentFormAlegra,
        paymentMethod: paymentMethodAlegra,
        stamp: { // Requerido para Colombia para que la factura sea electrónica y válida ante la DIAN.
            generateStamp: true
        },
        notes: `Factura de servicios hoteleros. Reserva ID: ${reserva.id}. Gracias por su preferencia.`,
        // Campos opcionales que podrían ser útiles:
        // seller: { id: ID_DEL_VENDEDOR_EN_ALEGRA }, // Si usas vendedores en Alegra
        // priceList: { id: ID_LISTA_PRECIOS_ALEGRA }, // Si usas listas de precios
        // warehouse: { id: ID_BODEGA_ALEGRA }, // Si manejas inventario por bodegas
        // observations: "Alguna observación pública en la factura",
    };
    console.log(`${FN_NAME} | Payload final para Alegra:`, JSON.stringify(payload, null, 2));

    // 6. Realizar la llamada a la API de Alegra
    let apiUrl = integracion.facturador_api_url;
    if (apiUrl && !apiUrl.endsWith('/')) { // Asegurar que la URL base termine con '/'
        apiUrl += '/';
    }
    apiUrl += 'invoices'; // Endpoint estándar para crear facturas en Alegra API v1

    console.log(`${FN_NAME} | Enviando solicitud a API Alegra URL: ${apiUrl}`);

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${tokenBasic}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json' // Es buena práctica indicar que aceptas JSON
            },
            body: JSON.stringify(payload)
        });

        const responseStatus = response.status;
        const responseText = await response.text(); // Obtener la respuesta como texto para depuración
        console.log(`${FN_NAME} | Respuesta de Alegra (Status ${responseStatus}):`, responseText);

        let resultJson;
        try {
            resultJson = JSON.parse(responseText); // Intentar parsear el texto como JSON
        } catch (parseError) {
            console.error(`${FN_NAME} | Error parseando respuesta JSON de Alegra:`, parseError);
            mostrarInfoModalGlobal(
                `Error al procesar la respuesta del facturador (no era JSON válido). Código ${responseStatus}. Respuesta: ${responseText.substring(0, 300)}`,
                "Error Comunicación Facturador"
            );
            return { success: false, error: "Respuesta no JSON", details: responseText };
        }

        if (responseStatus === 201 || responseStatus === 200) { // 201 (Created) o 200 (OK)
            if (resultJson && resultJson.id) {
                const numeroFacturaVisible = resultJson.number || resultJson.id; // 'number' suele ser el consecutivo
                const alegraInvoiceId = resultJson.id; // ID interno de Alegra
                const linkPdf = resultJson.pdfPath || (resultJson.metadata && resultJson.metadata.pdfPath) || null;

                let mensajeExito = `¡Factura electrónica generada con éxito en Alegra! Número: <b>${numeroFacturaVisible}</b>.`;
                if (linkPdf) {
                    mensajeExito += `<br><a href="${linkPdf}" target="_blank" class="text-blue-600 hover:underline">Ver PDF de la Factura</a>`;
                }
                mostrarInfoModalGlobal(mensajeExito, "Facturación Electrónica Exitosa");

                // **ACCIÓN IMPORTANTE: Guardar el ID/Número de factura de Alegra en tu BD local**
                // Esto es crucial para tu control interno y evitar duplicados.
                // Elige la tabla y la forma de identificar el registro a actualizar.
                // Ejemplo: Actualizar la tabla 'reservas'.
                try {
                    const { error: updateDbError } = await supabase
                        .from('reservas') // O tu tabla 'caja' si allí registras la venta final
                        .update({
                            id_factura_electronica: alegraInvoiceId,
                            numero_factura_electronica: numeroFacturaVisible,
                            // Puedes añadir un campo como 'estado_factura_electronica': 'GENERADA'
                        })
                        .eq('id', reserva.id); // Condición para encontrar la reserva correcta

                    if (updateDbError) {
                        console.error(`${FN_NAME} | Error al actualizar BD local con ID de Alegra:`, updateDbError);
                        mostrarInfoModalGlobal(
                            `Factura ${numeroFacturaVisible} generada en Alegra, pero hubo un error guardando la referencia en el sistema local: ${updateDbError.message}. Por favor, anote el número de factura.`,
                            "Advertencia Post-Facturación"
                        );
                    } else {
                        console.log(`${FN_NAME} | Referencia de factura Alegra (${numeroFacturaVisible}) guardada en BD local para reserva ID: ${reserva.id}`);
                    }
                } catch (dbCatchError) {
                     console.error(`${FN_NAME} | Excepción al actualizar BD local con ID de Alegra:`, dbCatchError);
                }
                return { success: true, alegraInvoiceId: alegraInvoiceId, alegraInvoiceNumber: numeroFacturaVisible, pdfLink: linkPdf };

            } else {
                mostrarInfoModalGlobal(
                    `Factura aparentemente creada en Alegra (Código ${responseStatus}), pero no se obtuvo un ID claro en la respuesta. Respuesta: ${responseText.substring(0, 300)}`,
                    "Facturación Electrónica Incompleta"
                );
                return { success: false, error: "ID no encontrado en respuesta exitosa", details: resultJson };
            }
        } else if (responseStatus === 401) { // Unauthorized
            mostrarInfoModalGlobal(
                `Error de autenticación con Alegra (Código 401). Verifique que el correo y el token API estén correctos y activos en la configuración del hotel. Detalle: ${resultJson.message || responseText}`,
                "Error Autenticación Facturador"
            );
        } else if (responseStatus === 400) { // Bad Request (problemas con el payload)
             mostrarInfoModalGlobal(
                `Error en los datos enviados a Alegra (Código 400): ${resultJson.message || responseText}. Revise los datos del cliente, los ítems y la estructura del payload enviado. Consulte la consola para más detalles.`,
                "Error en Datos para Factura Electrónica"
            );
        } else { // Otros errores
            mostrarInfoModalGlobal(
                `Error al generar la factura electrónica en Alegra (Código ${responseStatus}). Mensaje: ${resultJson.message || responseText}`,
                "Error Facturación Electrónica Desconocido"
            );
        }
        return { success: false, error: `Error Alegra ${responseStatus}`, details: resultJson };

    } catch (networkError) { // Errores de red o excepciones en el fetch
        console.error(`${FN_NAME} | Excepción durante fetch a Alegra:`, networkError);
        mostrarInfoModalGlobal(
            "Error de red o comunicación con el servicio de facturación electrónica. Verifique su conexión a internet e inténtelo de nuevo. Detalle técnico: " + networkError.message,
            "Error de Red (Facturación)"
        );
        return { success: false, error: "Error de red", details: networkError.message };
    }
}
// ===================== FIN DE LA FUNCIÓN DE FACTURACIÓN ELECTRÓNICA =====================





async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) { console.error("Contenedor de modal no encontrado."); return; }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let descuentoAplicado = null; 

    // Obtención de datos iniciales
    let horarios, tiempos, metodosPagoDisponibles;
    try {
        // [CÓDIGO ORIGINAL REVERTIDO] Solo cargar los 3 datos esenciales.
        [horarios, tiempos, metodosPagoDisponibles] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
    } catch (err) {
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler.", "Error de Carga");
        console.error("Error en Promise.all de showAlquilarModal (sin getDescuentos):", err);
        return;
    }
    
    metodosPagoDisponibles.unshift({ id: "mixto", nombre: "Pago Mixto" });
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, room);
    const opcionesHoras = crearOpcionesHoras(tiempos); // Contiene la opción "Duración Abierta" (-1)

    // Creación del contenido HTML del modal (Se conservan los IDs para los wrappers)
    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-auto animate-fade-in-up overflow-hidden";
    
    modalContent.innerHTML = `
    <div class="flex flex-col md:flex-row">
        <div class="w-full md:w-3/5 p-6 sm:p-8 space-y-6 bg-slate-50 md:rounded-l-xl max-h-[90vh] overflow-y-auto">
            <div class="flex justify-between items-center">
                <h3 class="text-2xl md:text-3xl font-bold text-blue-700">Alquilar: ${room.nombre}</h3>
                <button id="close-modal-alquilar" class="text-gray-500 hover:text-red-600 text-3xl leading-none focus:outline-none">&times;</button>
            </div>
            <form id="alquilar-form-pos" class="space-y-5">
                <input type="hidden" name="cliente_id" id="cliente_id_alquiler">
                <div>
                    <label class="form-label">Huésped*</label>
                    <div class="flex items-center gap-2">
                        <input required name="cliente_nombre" id="cliente_nombre" class="form-control flex-grow" placeholder="Nombre completo o busque existente">
                        <button type="button" id="btn-buscar-cliente-alquiler" class="button button-info p-2 rounded-full" title="Buscar cliente existente"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd" /></svg></button>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div><label class="form-label">Cédula / ID</label><input name="cedula" id="cedula" class="form-control"></div>
                    <div><label class="form-label">Teléfono</label><input name="telefono" id="telefono" type="tel" class="form-control"></div>
                </div>
                <div>
                    <label class="form-label">Duración de Estancia*</label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                        <select name="noches" id="select-noches" class="form-control"><option value="">-- Noches --</option>${opcionesNoches.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}</select>
                        <select name="horas" id="select-horas" class="form-control"><option value="">-- Horas --</option>${opcionesHoras.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}</select>
                    </div>
                </div>
                <div class="pt-2 mt-2 border-t">
                    <label class="flex items-center gap-2 cursor-pointer mt-2"><input type="checkbox" id="precio_libre_toggle_alquiler" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600"><span class="font-semibold text-sm text-indigo-700">Asignar Precio Manual</span></label>
                    <div id="precio_libre_container_alquiler" class="mt-2" style="display:none;"><label for="precio_libre_valor_alquiler" class="font-semibold text-sm text-gray-700">Valor Total Estancia</label><input type="number" id="precio_libre_valor_alquiler" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0"></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div><label class="form-label">Cant. Huéspedes*</label><input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" value="2" required></div>
                    <div id="metodo-pago-wrapper">
                        <label class="form-label">Método de Pago*</label><select required name="metodo_pago_id" id="metodo_pago_id" class="form-control">${metodosPagoDisponibles.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}</select>
                    </div>
                </div>
                <div id="descuento-wrapper">
                    <label class="form-label">Código de Descuento</label>
                    <div class="flex items-center gap-2"><input type="text" id="codigo-descuento-alquiler" class="form-control flex-grow uppercase" placeholder="CÓDIGO OPCIONAL"><button type="button" id="btn-aplicar-descuento-alquiler" class="button button-info">Aplicar</button></div>
                    <div id="feedback-descuento-alquiler" class="text-xs mt-1 h-4 font-semibold"></div>
                </div>
                <div class="pt-4"><button type="submit" id="btn-alquilar-hab" class="button button-success w-full py-3 text-lg font-bold rounded-lg">Confirmar y Registrar</button></div>
            </form>
        </div>
        <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 sm:p-8 flex flex-col justify-between md:rounded-r-xl">
            <div>
                <h4 class="text-xl sm:text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-5 text-cyan-400">Resumen del Alquiler</h4>
                <div id="ticket-resumen-container" class="space-y-2 text-sm sm:text-base"></div>
            </div>
            <div class="border-t-2 border-cyan-500 pt-4 mt-6">
                <div class="flex justify-between items-baseline"><span class="text-xl font-semibold text-green-400">TOTAL A PAGAR:</span><span id="ticket-total-price" class="text-3xl font-bold text-green-300">$0</span></div>
            </div>
        </div>
    </div>`;
    modalContainer.appendChild(modalContent);
    
    // 3. OBTENER REFERENCIAS Y LÓGICA DINÁMICA
    const formEl = modalContainer.querySelector('#alquilar-form-pos');
    const togglePrecioLibreEl = modalContainer.querySelector('#precio_libre_toggle_alquiler');
    const containerPrecioLibreEl = modalContainer.querySelector('#precio_libre_container_alquiler');
    const codigoInputEl = modalContainer.querySelector('#codigo-descuento-alquiler');
    const feedbackDescuentoAlquilerEl = modalContainer.querySelector('#feedback-descuento-alquiler');
    const selectNochesEl = modalContainer.querySelector('#select-noches');
    const selectHorasEl = modalContainer.querySelector('#select-horas');
    const metodoPagoWrapper = modalContainer.querySelector('#metodo-pago-wrapper');
    const descuentoWrapper = modalContainer.querySelector('#descuento-wrapper');
    const btnAlquilar = modalContainer.querySelector('#btn-alquilar-hab');

    // FUNCIÓN CENTRAL PARA RECALCULAR Y MANEJAR VISIBILIDAD
    const recalcularYActualizarTotalAlquiler = async (codigoManual = null) => {
        const formData = Object.fromEntries(new FormData(formEl));
        const clienteId = formData.cliente_id || null;
        const codigo = codigoManual === null ? codigoInputEl.value.trim().toUpperCase() : codigoManual;
        
        const minutosSeleccionados = parseInt(formData.horas) || 0;
        const nochesSeleccionadas = parseInt(formData.noches) || 0; 
        
        // 1. MANEJAR VISIBILIDAD PARA DURACIÓN ABIERTA (minutos: -1)
        const esDuracionAbierta = minutosSeleccionados === -1;
        
        if (esDuracionAbierta) {
            // Deshabilitar/Ocultar Noches, Precio Manual, Pago y Descuento
            selectNochesEl.value = ''; 
            selectNochesEl.disabled = true;

            togglePrecioLibreEl.checked = false;
            togglePrecioLibreEl.disabled = true;
            containerPrecioLibreEl.style.display = 'none';

            metodoPagoWrapper.style.display = 'none';
            formEl.elements.metodo_pago_id.required = false;

            descuentoWrapper.style.display = 'none';
            codigoInputEl.value = '';
            
            // Texto del botón
            btnAlquilar.textContent = "Registrar Entrada";
            feedbackDescuentoAlquilerEl.textContent = '';
            descuentoAplicado = null;
        } else {
            // Habilitar Noches y Modo Normal
            selectNochesEl.disabled = false;
            togglePrecioLibreEl.disabled = false;

            // Mostrar campos de Pago y Descuento
            metodoPagoWrapper.style.display = 'block';
            formEl.elements.metodo_pago_id.required = true;

            descuentoWrapper.style.display = 'block';
            btnAlquilar.textContent = "Confirmar y Registrar";

            // Mostrar/Ocultar el campo de precio manual basado en el toggle
             containerPrecioLibreEl.style.display = togglePrecioLibreEl.checked ? 'block' : 'none';


            // Aplicar descuento si hay código
            // ESTA FUNCIÓN ESTÁ DEFINIDA EN TU ARCHIVO Y NO REQUIERE LOS DATOS DE DESCUENTOS EN EL PROMISE.ALL
            descuentoAplicado = await buscarDescuentoParaAlquiler(supabase, hotelId, clienteId, room.id, codigo, minutosSeleccionados, nochesSeleccionadas, tiempos);

            if (descuentoAplicado) {
                feedbackDescuentoAlquilerEl.className = 'text-xs mt-1 h-4 font-semibold text-green-600';
                feedbackDescuentoAlquilerEl.textContent = `¡"${descuentoAplicado.nombre}" aplicado!`;
            } else if (codigo) {
                feedbackDescuentoAlquilerEl.className = 'text-xs mt-1 h-4 font-semibold text-red-600';
                feedbackDescuentoAlquilerEl.textContent = 'Código no válido o no aplicable.';
            } else {
                feedbackDescuentoAlquilerEl.textContent = '';
            }
        }
        
        // 2. CALCULAR DETALLES 
        const detalles = calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado); 
        
        // 3. ACTUALIZAR RESUMEN
        const ticketResumenEl = modalContainer.querySelector('#ticket-resumen-container');
        const ticketTotalEl = modalContainer.querySelector('#ticket-total-price');

        let resumenHtml = `
            <div class="flex justify-between"><span class="text-slate-300">Estancia:</span><strong>${detalles.descripcionEstancia}</strong></div>
            <div class="flex justify-between"><span class="text-slate-300">Precio Base:</span><strong>${formatCurrency(detalles.precioBase)}</strong></div>
            ${detalles.montoDescontado > 0 ? `<div class="flex justify-between text-green-300"><span>Descuento Aplicado:</span><strong>-${formatCurrency(detalles.montoDescontado)}</strong></div>` : ''}
            ${detalles.montoImpuesto > 0 ? `<div class="flex justify-between"><span>Impuestos:</span><strong>${formatCurrency(detalles.montoImpuesto)}</strong></div>` : ''}
        `;
        ticketResumenEl.innerHTML = resumenHtml;
        ticketTotalEl.textContent = formatCurrency(detalles.precioTotal);
    };

    // 4. LISTENERS
    
    // Listeners de Duración (manejan el toggle)
    selectNochesEl.addEventListener('change', async () => { 
        if (selectNochesEl.value) { selectHorasEl.value = ''; } 
        await recalcularYActualizarTotalAlquiler(); 
    });
    selectHorasEl.addEventListener('change', async () => { 
        if (selectHorasEl.value) { selectNochesEl.value = ''; } 
        await recalcularYActualizarTotalAlquiler(); 
    });
    
    // Listeners de otros campos que afectan el cálculo
    ['cantidad_huespedes', 'precio_libre_valor_alquiler'].forEach(id => {
        const el = modalContainer.querySelector(`#${id}`);
        if (el) el.addEventListener('input', recalcularYActualizarTotalAlquiler);
    });
    
    // Listener para el toggle de Precio Manual (que debe recalcular)
    togglePrecioLibreEl.addEventListener('change', async () => {
        await recalcularYActualizarTotalAlquiler();
    });
    
    // Listener para botón de Aplicar Descuento
    modalContainer.querySelector('#btn-aplicar-descuento-alquiler').onclick = async () => { 
        await recalcularYActualizarTotalAlquiler();
    };
    
    // Listeners de Interfaz
    modalContainer.querySelector('#close-modal-alquilar').onclick = () => { modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };
    modalContainer.querySelector('#btn-buscar-cliente-alquiler').onclick = () => {
        showClienteSelectorModal(supabase, hotelId, {
            onSelect: async (cliente) => {
                formEl.elements.cliente_nombre.value = cliente.nombre;
                formEl.elements.cedula.value = cliente.documento || '';
                formEl.elements.telefono.value = cliente.telefono || '';
                formEl.elements.cliente_id.value = cliente.id;
                await recalcularYActualizarTotalAlquiler();
            }
        });
    };
    
    // 5. Lógica del submit
    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = formEl.querySelector('#btn-alquilar-hab');
        submitBtn.disabled = true;
        submitBtn.textContent = "Procesando...";
        try {
            const formData = Object.fromEntries(new FormData(formEl));
            const detallesFinales = calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado);
            
            if (!formData.cliente_nombre.trim()) throw new Error("El nombre del huésped es obligatorio.");
            if (detallesFinales.tipoCalculo === null && formData.precio_libre_toggle !== 'on') throw new Error("Debe seleccionar una duración válida.");
            
            const totalCostoEstancia = detallesFinales.precioTotal;
            const metodoPagoId = formData.metodo_pago_id;
            
            // Lógica para Duración Abierta o costo cero
            if (detallesFinales.tipoCalculo === 'abierta' || totalCostoEstancia <= 0) {
                 await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [], room, supabase, currentUser, hotelId, mainAppContainer });
            } 
            // Lógica para Pago Mixto
            else if (metodoPagoId === "mixto") {
                showPagoMixtoModal(totalCostoEstancia, metodosPagoDisponibles, async (pagosMixtos) => {
                    await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: pagosMixtos, room, supabase, currentUser, hotelId, mainAppContainer });
                });
            } 
            // Lógica para Pago Único
            else {
                await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [{ metodo_pago_id: metodoPagoId, monto: totalCostoEstancia }], room, supabase, currentUser, hotelId, mainAppContainer });
            }
        } catch (err) {
            mostrarInfoModalGlobal(err.message, "Error de Registro");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirmar y Registrar";
        }
    };
    // 6. Inicializar cálculo al cargar
    await recalcularYActualizarTotalAlquiler();
}



/**
 * Muestra un modal para dividir el pago en varios métodos.
 * @param {number} totalAPagar - El monto total que se debe cubrir.
 * @param {Array} metodosPago - La lista de métodos de pago disponibles.
 * @param {Function} onConfirm - Callback que se ejecuta con el array de pagos al confirmar.
 */
async function showPagoMixtoModal(totalAPagar, metodosPago, onConfirm) {
    const modalContainer = document.getElementById('modal-container-secondary');
    modalContainer.style.display = 'flex';
    modalContainer.innerHTML = '';

    const metodosDisponibles = metodosPago.filter(mp => mp.id !== 'mixto');
    const opcionesMetodosHTML = metodosDisponibles.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('');

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto animate-fade-in-up";
    modalContent.innerHTML = `
        <form id="form-pago-mixto">
            <h3 class="text-xl font-bold mb-2 text-indigo-700">Pago Mixto</h3>
            <p class="mb-4 text-gray-600">Divida el total de <strong class="text-2xl">${formatCurrency(totalAPagar)}</strong>.</p>
            <div id="lista-pagos-mixtos" class="space-y-3 pr-2 max-h-60 overflow-y-auto"></div>
            <button type="button" id="btn-agregar-pago-mixto" class="button button-neutral w-full mt-4 text-sm py-2">Agregar Otro Método</button>
            <hr class="my-4">
            <div class="flex justify-between items-center text-lg font-bold">
                <span class="text-gray-700">Total Cubierto:</span>
                <span id="total-cubierto-mixto">${formatCurrency(0)}</span>
            </div>
            <div class="flex justify-between items-center text-lg font-bold mt-1">
                <span class="text-gray-700">Faltante por Pagar:</span>
                <span id="faltante-pago-mixto" class="text-red-600">${formatCurrency(totalAPagar)}</span>
            </div>
            <div class="flex gap-3 mt-6">
                <button type="submit" id="btn-confirmar-pago-mixto" class="button button-success flex-1 py-2.5" disabled>Confirmar Pago</button>
                <button type="button" id="btn-cancelar-pago-mixto" class="button button-danger flex-1 py-2.5">Cancelar</button>
            </div>
        </form>
    `;
    modalContainer.appendChild(modalContent);

    const formMixto = modalContent.querySelector('#form-pago-mixto');
    const listaPagosDiv = modalContent.querySelector('#lista-pagos-mixtos');
    const btnConfirmar = modalContent.querySelector('#btn-confirmar-pago-mixto');
    
    const actualizarTotalesMixtos = () => {
        let totalCubierto = 0;
        listaPagosDiv.querySelectorAll('input.monto-pago-mixto').forEach(input => {
            totalCubierto += Number(input.value) || 0;
        });
        const faltante = totalAPagar - totalCubierto;
        modalContent.querySelector('#total-cubierto-mixto').textContent = formatCurrency(totalCubierto);
        const faltanteEl = modalContent.querySelector('#faltante-pago-mixto');
        faltanteEl.textContent = formatCurrency(faltante);
        
        if (Math.abs(faltante) < 0.01) {
            btnConfirmar.disabled = false;
            faltanteEl.className = 'text-green-600';
        } else {
            btnConfirmar.disabled = true;
            faltanteEl.className = 'text-red-600';
        }
    };

    const agregarFilaDePago = () => {
        const newRow = document.createElement('div');
        newRow.className = 'pago-mixto-row flex items-center gap-2';
        newRow.innerHTML = `
            <select class="form-control flex-grow">${opcionesMetodosHTML}</select>
            <input type="number" class="form-control w-32 monto-pago-mixto" placeholder="Monto" min="0" step="any">
            <button type="button" class="btn-remover-pago-mixto text-red-500 hover:text-red-700 text-2xl font-bold">&times;</button>
        `;
        listaPagosDiv.appendChild(newRow);
        newRow.querySelector('.btn-remover-pago-mixto').onclick = () => {
            newRow.remove();
            actualizarTotalesMixtos();
        };
    };

    modalContent.querySelector('#btn-agregar-pago-mixto').onclick = agregarFilaDePago;
    listaPagosDiv.addEventListener('input', actualizarTotalesMixtos);
    agregarFilaDePago(); // Agrega la primera fila al iniciar
    listaPagosDiv.querySelector('input.monto-pago-mixto').value = totalAPagar; // Pre-llena el total
    actualizarTotalesMixtos();

    modalContent.querySelector('#btn-cancelar-pago-mixto').onclick = () => {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
        const btnPrincipal = document.querySelector('#btn-alquilar-hab');
        if(btnPrincipal) {
            btnPrincipal.disabled = false;
            btnPrincipal.textContent = "Confirmar y Registrar";
        }
    };

    formMixto.onsubmit = async (e) => {
        e.preventDefault();
        btnConfirmar.disabled = true;
        btnConfirmar.textContent = "Procesando...";
        
        const pagosFinales = [];
        listaPagosDiv.querySelectorAll('.pago-mixto-row').forEach(row => {
            const metodoId = row.querySelector('select').value;
            const monto = Number(row.querySelector('input').value);
            if (metodoId && monto > 0) {
                pagosFinales.push({ metodo_pago_id: metodoId, monto: monto });
            }
        });

        if (pagosFinales.length > 0) {
            await onConfirm(pagosFinales);
            modalContainer.style.display = 'none';
            modalContainer.innerHTML = '';
        } else {
            alert("No se ha definido ningún pago válido.");
            btnConfirmar.disabled = false;
            btnConfirmar.textContent = "Confirmar Pago";
        }
    };
}





// REEMPLAZA esta función en tu archivo mapa-habitaciones.js

async function registrarReservaYMovimientosCaja({ formData, detallesEstancia, pagos, room, supabase, currentUser, hotelId, mainAppContainer }) {
    // 1. OBTENER Y CREAR CLIENTE (SI ES NECESARIO)
    let clienteIdFinal = formData.cliente_id;
    if (!clienteIdFinal) {
        const { data: nuevoCliente, error: errCliente } = await supabase
            .from('clientes')
            .insert({
                hotel_id: hotelId,
                nombre: formData.cliente_nombre.trim(),
                documento: formData.cedula.trim() || null,
                telefono: formData.telefono.trim() || null
            })
            .select('id')
            .single();
        if (errCliente) throw new Error(`Error al crear el nuevo cliente: ${errCliente.message}`);
        clienteIdFinal = nuevoCliente.id;
    }

    // 2. PREPARAR NOTAS (INCLUYENDO LA DE PRECIO MANUAL)
    let notasFinales = formData.notas ? formData.notas.trim() : null;
    if (formData.precio_libre_toggle === 'on') {
        const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(parseFloat(formData.precio_libre_valor))}]`;
        notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
    }

    // 3. CREAR LA RESERVA PRINCIPAL
    const totalPagado = pagos.reduce((sum, pago) => sum + pago.monto, 0);
    const { data: nuevaReserva, error: errReserva } = await supabase.from('reservas').insert({
        hotel_id: hotelId,
        habitacion_id: room.id,
        cliente_id: clienteIdFinal,
        cliente_nombre: formData.cliente_nombre.trim(),
        cedula: formData.cedula.trim() || null,
        telefono: formData.telefono.trim() || null,
        fecha_inicio: detallesEstancia.inicioAt.toISOString(),
        fecha_fin: detallesEstancia.finAt.toISOString(),
        cantidad_huespedes: parseInt(formData.cantidad_huespedes),
        monto_total: detallesEstancia.precioTotal,
        monto_pagado: totalPagado,
        estado: 'ocupada',
        tipo_duracion: detallesEstancia.tipoCalculo,
        cantidad_duracion: detallesEstancia.cantidadCalculo,
        usuario_id: currentUser.id,
        monto_estancia_base_sin_impuestos: detallesEstancia.precioBase,
        monto_impuestos_estancia: detallesEstancia.montoImpuesto,
        descuento_aplicado_id: detallesEstancia.descuentoAplicado?.id || null,
        monto_descontado: detallesEstancia.montoDescontado,
        notas: notasFinales // <-- Se usan las notas preparadas
    }).select().single();
    if (errReserva) throw new Error('Error al crear la reserva: ' + errReserva.message);

    // 4. LÓGICA POST-RESERVA (NO CAMBIA)
    if (nuevaReserva.descuento_aplicado_id) {
        await registrarUsoDescuento(supabase, nuevaReserva.descuento_aplicado_id);
    }
    await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
    await supabase.from('cronometros').insert({
        hotel_id: hotelId,
        reserva_id: nuevaReserva.id,
        habitacion_id: room.id,
        fecha_inicio: nuevaReserva.fecha_inicio,
        fecha_fin: nuevaReserva.fecha_fin,
        activo: true
    });
    const turnoId = turnoService.getActiveTurnId ? turnoService.getActiveTurnId() : (await turnoService.getTurnoAbierto(supabase, currentUser.id, hotelId))?.id;
    if (!turnoId) throw new Error("No hay un turno de caja activo para registrar el pago.");

    const movimientosCaja = pagos.map(pago => ({
        hotel_id: hotelId, tipo: 'ingreso', monto: pago.monto,
        concepto: `Alquiler Hab. ${room.nombre} (${detallesEstancia.descripcionEstancia})`,
        fecha_movimiento: new Date().toISOString(), metodo_pago_id: pago.metodo_pago_id,
        usuario_id: currentUser.id, reserva_id: nuevaReserva.id, turno_id: turnoId,
    }));
    const { error: errCaja } = await supabase.from('caja').insert(movimientosCaja);
    if (errCaja) throw new Error(`¡Reserva creada, pero error al registrar pago en caja! ${errCaja.message}`);

    document.getElementById('modal-container').style.display = 'none';
    document.getElementById('modal-container').innerHTML = '';
    mostrarInfoModalGlobal("¡Habitación alquilada con éxito!", "Alquiler Registrado");
    await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
}

// ===================== MODAL EXTENDER TIEMPO (POS STYLE - COMPLETO) =====================

// REEMPLAZA esta función completa en tu archivo mapa-habitaciones.js

async function showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error("Contenedor de modal 'modal-container' no encontrado.");
        alert("Error crítico: No se puede mostrar el modal para extender tiempo.");
        return;
    }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let reservaActiva = null;
    try {
        for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
            const { data, error } = await supabase
                .from('reservas')
                .select('id, fecha_fin, fecha_inicio, cliente_nombre, monto_total, metodo_pago_id, monto_pagado, cantidad_huespedes')
                .eq('habitacion_id', room.id)
                .eq('estado', estado)
                .order('fecha_inicio', { ascending: false })
                .limit(1)
                .maybeSingle(); 
            if (error && error.code !== 'PGRST116') throw error;
            if (data) {
                reservaActiva = data;
                break;
            }
        }

        if (!reservaActiva) {
            mostrarInfoModalGlobal("No se encontró una reserva activa o con tiempo agotado para extender en esta habitación.", "Operación no posible", [], modalContainer);
            return;
        }

        const [horarios, tiempos, metodosPagoExtension] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
        
        metodosPagoExtension.unshift({ id: "mixto", nombre: "Pago Mixto" });
        const tarifaNocheUnicaExt = tiempos.find(t => t.nombre.toLowerCase().includes('noche'));
        const opcionesNochesExt = crearOpcionesNochesConPersonalizada(horarios, 5, reservaActiva.fecha_fin, tarifaNocheUnicaExt, room);
        const opcionesHorasExt = crearOpcionesHoras(tiempos);

        const modalContent = document.createElement('div');
        modalContent.className = "bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl shadow-2xl w-full max-w-3xl p-0 m-auto animate-fade-in-up overflow-hidden";

        const fechaFinActual = new Date(reservaActiva.fecha_fin);
        const ahora = new Date();
        const tiempoRestanteMs = fechaFinActual - ahora;
        let tiempoRestanteStr = tiempoRestanteMs > 0 ? `Tiempo restante: ${formatHorasMin(Math.floor(tiempoRestanteMs / 60000))}` : `Tiempo excedido: ${formatHorasMin(Math.floor(Math.abs(tiempoRestanteMs) / 60000))}`;

        modalContent.innerHTML = `
            <div class="flex flex-col md:flex-row">
                <div class="w-full md:w-3/5 p-6 md:p-8 space-y-5 max-h-[90vh] overflow-y-auto">
                    <div class="flex justify-between items-center">
                        <h3 class="text-2xl font-bold text-purple-700">Extender Estancia: ${room.nombre}</h3>
                        <button id="close-modal-extender" class="text-gray-400 hover:text-red-600 text-3xl leading-none">&times;</button>
                    </div>
                    <div class="text-sm text-gray-600">
                        <p>Huésped: <strong>${reservaActiva.cliente_nombre || 'N/A'}</strong></p>
                        <p>Salida actual: <strong>${formatDateTime(reservaActiva.fecha_fin)}</strong></p>
                        <p class="${tiempoRestanteMs > 0 ? 'text-green-600' : 'text-red-600'}">${tiempoRestanteStr}</p>
                    </div>
                    <form id="extender-form-pos" class="space-y-4">
                        <div>
                            <label class="form-label">Extender Por:</label>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start">
                                <select name="noches_extender" id="select-noches-ext" class="form-control"><option value="">-- Noches --</option>${opcionesNochesExt.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}</select>
                                <select name="horas_extender" id="select-horas-ext" class="form-control"><option value="">-- Horas --</option>${opcionesHorasExt.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}</select>
                            </div>
                        </div>
                        
                        <div class="pt-2 mt-2 border-t">
                            <label class="flex items-center gap-2 cursor-pointer mt-2">
                                <input type="checkbox" id="precio_libre_toggle_ext" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600">
                                <span class="font-semibold text-sm text-indigo-700">Asignar Precio Manual a la Extensión</span>
                            </label>
                            <div id="precio_libre_container_ext" class="mt-2" style="display:none;">
                                <label for="precio_libre_valor_ext" class="font-semibold text-sm text-gray-700">Valor Total de la Extensión</label>
                                <input type="number" id="precio_libre_valor_ext" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0">
                            </div>
                        </div>
                        <div>
                            <label for="metodo_pago_ext_id" class="form-label">Método de Pago (Extensión)</label>
                            <select required name="metodo_pago_ext_id" id="metodo_pago_ext_id" class="form-control">
                                <option value="">-- Seleccionar --</option>
                                ${metodosPagoExtension.map(mp => `<option value="${mp.id}" ${reservaActiva.metodo_pago_id === mp.id ? 'selected' : ''}>${mp.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="pt-3">
                            <button type="submit" class="button button-custom-purple w-full py-3 text-lg font-semibold">Confirmar Extensión</button>
                        </div>
                    </form>
                </div>
                <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 md:p-8 flex flex-col justify-between">
                    <div>
                        <h4 class="text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-4 text-purple-400">Costo de Extensión</h4>
                        <div class="space-y-3 text-sm">
                            <div class="flex justify-between"><span>Extensión:</span> <strong id="ticket-ext-description" class="text-right">Seleccione duración</strong></div>
                            <div class="flex justify-between"><span>Costo Extensión:</span> <strong id="ticket-ext-price" class="text-right">${formatCurrency(0)}</strong></div>
                        </div>
                    </div>
                    <div class="border-t-2 border-purple-500 pt-4 mt-6">
                        <div class="flex justify-between items-center font-bold text-3xl text-green-400"><span>A PAGAR:</span><span id="ticket-ext-total-price">${formatCurrency(0)}</span></div>
                        <p class="text-xs text-slate-400 mt-2">Nueva salida estimada: <strong id="nueva-salida-estimada">${formatDateTime(reservaActiva.fecha_fin)}</strong></p>
                    </div>
                </div>
            </div>
        `;
        modalContainer.appendChild(modalContent);

        const formExtEl = modalContent.querySelector('#extender-form-pos');
        const selectNochesExtEl = modalContent.querySelector('#select-noches-ext');
        const selectHorasExtEl = modalContent.querySelector('#select-horas-ext');
        const ticketExtDescEl = modalContent.querySelector('#ticket-ext-description');
        const ticketExtPriceEl = modalContent.querySelector('#ticket-ext-price');
        const ticketExtTotalEl = modalContent.querySelector('#ticket-ext-total-price');
        const nuevaSalidaEstimadaEl = modalContent.querySelector('#nueva-salida-estimada');
        
        // ▼▼▼ BLOQUE AÑADIDO: Listeners para precio manual ▼▼▼
        const togglePrecioLibreExtEl = modalContent.querySelector('#precio_libre_toggle_ext');
        const containerPrecioLibreExtEl = modalContent.querySelector('#precio_libre_container_ext');
        const valorPrecioLibreExtEl = modalContent.querySelector('#precio_libre_valor_ext');
        
        togglePrecioLibreExtEl.addEventListener('change', () => {
            containerPrecioLibreExtEl.style.display = togglePrecioLibreExtEl.checked ? 'block' : 'none';
            actualizarResumenTicketExtension();
        });
        valorPrecioLibreExtEl.addEventListener('input', actualizarResumenTicketExtension);
        // ▲▲▲ FIN DEL BLOQUE AÑADIDO ▲▲▲

        function actualizarResumenTicketExtension() {
            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtra = 0; let descExtra = "Seleccione duración"; let nuevaFechaFinExt = new Date(reservaActiva.fecha_fin);
            const nochesSelExt = parseInt(formDataExt.noches_extender) || 0;
            const minutosSelExt = parseInt(formDataExt.horas_extender) || 0;
            
            // ▼▼▼ LÓGICA MODIFICADA: Ahora considera el precio manual ▼▼▼
            const esPrecioLibre = togglePrecioLibreExtEl.checked;
            const valorPrecioLibre = parseFloat(valorPrecioLibreExtEl.value) || 0;

            if (nochesSelExt > 0) {
                let fechaCalculo = new Date(reservaActiva.fecha_fin);
                fechaCalculo.setDate(fechaCalculo.getDate() + nochesSelExt);
                const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                fechaCalculo.setHours(checkoutH, checkoutM, 0, 0);
                nuevaFechaFinExt = fechaCalculo;
                descExtra = `${nochesSelExt} noche${nochesSelExt > 1 ? 's' : ''}`;

                if (esPrecioLibre) {
                    precioExtra = valorPrecioLibre;
                    descExtra += " (Precio Manual)";
                } else {
                    let precioBaseNocheExtension = room.precio || 0;
                    precioExtra = precioBaseNocheExtension * nochesSelExt;
                }

            } else if (minutosSelExt > 0) {
                nuevaFechaFinExt = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosSelExt * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosSelExt);
                descExtra = tiempoSelExt?.nombre || formatHorasMin(minutosSelExt);
                
                if (esPrecioLibre) {
                    precioExtra = valorPrecioLibre;
                    descExtra += " (Precio Manual)";
                } else {
                    precioExtra = tiempoSelExt?.precio || 0;
                }
            }
            
            ticketExtDescEl.textContent = descExtra;
            ticketExtPriceEl.textContent = formatCurrency(precioExtra);
            ticketExtTotalEl.textContent = formatCurrency(precioExtra); 
            nuevaSalidaEstimadaEl.textContent = formatDateTime(nuevaFechaFinExt);
        }

        selectNochesExtEl.onchange = () => { if (selectNochesExtEl.value) selectHorasExtEl.value = ""; actualizarResumenTicketExtension(); };
        selectHorasExtEl.onchange = () => { if (selectHorasExtEl.value) selectNochesExtEl.value = ""; actualizarResumenTicketExtension(); };
        actualizarResumenTicketExtension();

        modalContent.querySelector('#close-modal-extender').onclick = () => { modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };

        formExtEl.onsubmit = async (ev) => {
            ev.preventDefault();
            const submitButton = formExtEl.querySelector('button[type="submit"]');
            submitButton.disabled = true;
            submitButton.textContent = "Procesando...";

            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtraSubmit = 0;
            let nuevaFechaFinSubmit;
            let descExtraSubmit = "";
            let notasAdicionales = "";

            const nochesExtSubmit = parseInt(formDataExt.noches_extender) || 0;
            const minutosExtSubmit = parseInt(formDataExt.horas_extender) || 0;

            // ▼▼▼ LÓGICA MODIFICADA: El submit también considera el precio manual ▼▼▼
            const esPrecioLibreSubmit = formDataExt.precio_libre_toggle === 'on';
            const valorPrecioLibreSubmit = parseFloat(formDataExt.precio_libre_valor) || 0;

            if (nochesExtSubmit > 0) {
                nuevaFechaFinSubmit = new Date(reservaActiva.fecha_fin);
                nuevaFechaFinSubmit.setDate(nuevaFechaFinSubmit.getDate() + nochesExtSubmit);
                const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                nuevaFechaFinSubmit.setHours(checkoutH, checkoutM, 0, 0);
                descExtraSubmit = `${nochesExtSubmit} noche(s) adicional(es)`;
                
                if (esPrecioLibreSubmit) {
                    precioExtraSubmit = valorPrecioLibreSubmit;
                    notasAdicionales = `[EXTENSIÓN MANUAL: ${formatCurrency(precioExtraSubmit)}]`;
                } else {
                    precioExtraSubmit = (room.precio || 0) * nochesExtSubmit;
                }

            } else if (minutosExtSubmit > 0) {
                nuevaFechaFinSubmit = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosExtSubmit * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosExtSubmit);
                descExtraSubmit = tiempoSelExt?.nombre || formatHorasMin(minutosExtSubmit);

                if (esPrecioLibreSubmit) {
                    precioExtraSubmit = valorPrecioLibreSubmit;
                    notasAdicionales = `[EXTENSIÓN MANUAL: ${formatCurrency(precioExtraSubmit)}]`;
                } else {
                    precioExtraSubmit = tiempoSelExt?.precio || 0;
                }
            } else { 
                alert('Debe seleccionar noches o horas para extender.'); 
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                return; 
            }
            
            // Lógica de pago y actualización (el resto de la función no necesita cambios significativos)...
            const turnoId = turnoService.getActiveTurnId();
            if (precioExtraSubmit > 0 && !turnoId) {
                mostrarInfoModalGlobal("ACCIÓN BLOQUEADA: No se puede registrar el pago de la extensión porque no hay un turno activo.", "Turno Requerido", [], modalContainer);
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                return; 
            }
            
            const handlePaymentAndDBUpdate = async (pagos) => {
                const totalPagadoExt = pagos.reduce((sum, p) => sum + p.monto, 0);
                
                const pagosParaInsertar = pagos.map(p => ({
                    hotel_id: hotelId, reserva_id: reservaActiva.id, monto: p.monto,
                    fecha_pago: new Date().toISOString(), metodo_pago_id: p.metodo_pago_id,
                    usuario_id: currentUser?.id, concepto: `Pago por extensión: ${descExtraSubmit}`
                }));
                const { data: pagosData, error: errPagoReserva } = await supabase.from('pagos_reserva').insert(pagosParaInsertar).select('id');
                if (errPagoReserva) throw new Error('Error registrando el pago de la extensión: ' + errPagoReserva.message);

                await supabase.from('servicios_x_reserva').insert({
                    hotel_id: hotelId, reserva_id: reservaActiva.id,
                    descripcion_manual: `Extensión: ${descExtraSubmit}`, cantidad: 1,
                    precio_cobrado: Math.round(precioExtraSubmit), estado_pago: 'pagado',
                    pago_reserva_id: pagosData[0].id, fecha_servicio: new Date().toISOString()
                });

                const nuevoMontoPagadoReserva = (reservaActiva.monto_pagado || 0) + totalPagadoExt;
                await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(),
                    monto_pagado: nuevoMontoPagadoReserva,
                    estado: 'activa',
                    notas: reservaActiva.notas ? `${reservaActiva.notas}\n${notasAdicionales}` : notasAdicionales
                }).eq('id', reservaActiva.id);

                const movimientosCaja = pagos.map(p => ({
                    hotel_id: hotelId, tipo: 'ingreso', monto: p.monto,
                    concepto: `Extensión Hab. ${room.nombre} (${descExtraSubmit})`,
                    fecha_movimiento: new Date().toISOString(), usuario_id: currentUser?.id,
                    reserva_id: reservaActiva.id, metodo_pago_id: p.metodo_pago_id,
                    turno_id: turnoId, pago_reserva_id: pagosData[pagos.indexOf(p)].id
                }));
                await supabase.from('caja').insert(movimientosCaja);
            };

            if (precioExtraSubmit > 0) {
                 const metodoPagoSeleccionado = formDataExt.metodo_pago_ext_id;
                 if(metodoPagoSeleccionado === 'mixto'){
                    showPagoMixtoModal(precioExtraSubmit, metodosPagoExtension, handlePaymentAndDBUpdate);
                 } else {
                    await handlePaymentAndDBUpdate([{ metodo_pago_id: metodoPagoSeleccionado, monto: precioExtraSubmit }]);
                 }
            } else {
                 await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(), estado: 'activa'
                }).eq('id', reservaActiva.id);
            }
            
            const { data: cronoAct } = await supabase.from('cronometros').select('id').eq('reserva_id', reservaActiva.id).eq('activo', true).limit(1).single();
            if (cronoAct) await supabase.from('cronometros').update({ fecha_fin: nuevaFechaFinSubmit.toISOString() }).eq('id', cronoAct.id);
            
await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

modalContainer.style.display = "none";            modalContainer.innerHTML = '';
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        };
    } catch (err) {
        console.error("Error preparando modal de extensión:", err);
        mostrarInfoModalGlobal("Error al preparar el modal de extensión: " + (err.message || "Error desconocido"), "Error Crítico", [], modalContainer);
    }
}




function startCronometro(room, supabase, hotelId, listEl) {
    // MODIFICACIÓN DE LA CONSULTA: Obtener fecha_inicio y tipo_duracion
    supabase.from('reservas')
        .select('id, fecha_fin, fecha_inicio, tipo_duracion') 
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .then(async ({ data: reservas, error: reservaError }) => {
            const reservaActiva = (reservas && reservas.length > 0) ? reservas[0] : null;
            const cronometroDiv = listEl.querySelector(`#cronometro-${room.id}`);

            // === CÓDIGO DE AUTO-CORRECCIÓN EXISTENTE ===
            if (reservaError || !reservaActiva) {
                // ... (Lógica de corrección existente sin cambios) ...
                 console.warn(`Inconsistencia detectada hab ${room.id}.`);
                 return;
            }

            const fechaFin = new Date(reservaActiva.fecha_fin);
            const fechaInicio = new Date(reservaActiva.fecha_inicio);
            const esDuracionAbierta = reservaActiva.tipo_duracion === 'abierta'; 
            const cronometroId = `cronometro-${room.id}`;
            let tiempoAgotadoNotificado = room.estado === "tiempo agotado";

            if (cronometrosInterval[cronometroId]) {
                clearInterval(cronometrosInterval[cronometroId]);
            }

            function updateCronoDisplay() {
                if (!cronometroDiv) {
                    clearInterval(cronometrosInterval[cronometroId]);
                    return;
                }

                const now = new Date();
                const cardElement = cronometroDiv.closest('.room-card');
                
                if (esDuracionAbierta) {
                    // ==========================================
                    // 1. ESTILO VISUAL PARA TIEMPO LIBRE (AZUL)
                    // ==========================================
                    if (cardElement) {
                        // Cambiar borde a Azul
                        cardElement.classList.remove('border-yellow-500', 'border-red-600', 'border-green-500');
                        cardElement.classList.add('border-blue-500', 'ring-1', 'ring-blue-200'); // Anillo suave azul
                        
                        // Cambiar Badge a "TIEMPO LIBRE"
                        const badgeEl = cardElement.querySelector('.badge');
                        if (badgeEl) {
                            badgeEl.className = 'badge bg-blue-100 text-blue-800 px-2.5 py-1 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm flex-shrink-0';
                            badgeEl.innerHTML = `
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                TIEMPO LIBRE
                            `;
                        }
                    }

                    // Lógica de contador hacia arriba
                    const diffElapased = now - fechaInicio;
                    const h = String(Math.floor(diffElapased / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diffElapased % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diffElapased % 60000) / 1000)).padStart(2, '0');
                    
                    // Icono de infinito o reloj corriendo
                    const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-blue-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>`;
                    
                    cronometroDiv.innerHTML = `${iconSVG}<span class="text-blue-700 font-bold text-lg tracking-wider">${h}:${m}:${s}</span>`;

                } else {
                    // ==========================================
                    // LÓGICA NORMAL (TIEMPO FIJO)
                    // ==========================================
                    const diff = fechaFin - now;
                    
                    if (diff <= 0) {
                        if (!tiempoAgotadoNotificado) {
                            tiempoAgotadoNotificado = true;
                            supabase.from('habitaciones')
                                .update({ estado: 'tiempo agotado' })
                                .eq('id', room.id)
                                .then(({ error }) => {
                                    if (!error) playPopSound && playPopSound();
                                });
                        }
                        const diffPos = Math.abs(diff);
                        const h = String(Math.floor(diffPos / 3600000)).padStart(2, '0');
                        const m = String(Math.floor((diffPos % 3600000) / 60000)).padStart(2, '0');
                        const s = String(Math.floor((diffPos % 60000) / 1000)).padStart(2, '0');
                        cronometroDiv.innerHTML = `<span class="font-bold text-red-600 animate-pulse">⏰ -${h}:${m}:${s}</span>`;
                        
                        if (cardElement) {
                            cardElement.classList.add('border-red-600', 'ring-2', 'ring-red-200');
                            cardElement.classList.remove('border-yellow-500');
                        }

                    } else {
                        // Tiempo restante normal
                        const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
                        const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                        const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');

                        let textColor = 'text-green-600';
                        if (diff < 10 * 60 * 1000) textColor = 'text-red-500 font-bold';
                        else if (diff < 30 * 60 * 1000) textColor = 'text-orange-500 font-semibold';
                        
                        const iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-2 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                        cronometroDiv.innerHTML = `${iconSVG}<span class="${textColor}">${h}:${m}:${s}</span>`;
                    }
                }
            }
            
            updateCronoDisplay();
            cronometrosInterval[cronometroId] = setInterval(updateCronoDisplay, 1000);
        })
        .catch(err => {
             if (err.code !== 'PGRST116') console.error(err);
        });
}

// ===================== MODAL DE INFORMACIÓN GLOBAL =====================
/**
 * Muestra un modal universal con contenido HTML y un título opcional.
 * @param {string} htmlContent - El HTML que quieres mostrar en el modal.
 * @param {string} title - El título del modal.
 * @param {Array} botones - (Opcional) Array de objetos {texto, accion, color} para botones extra.
 */
/**
 * Muestra un modal universal con contenido HTML, un título y botones opcionales.
 * @param {string} htmlContent - El HTML que quieres mostrar en el modal.
 * @param {string} [title="Información"] - El título del modal.
 * @param {Array<object>} [botones=[]] - Array de objetos para botones personalizados. Ej: [{texto: 'Sí', accion: miFuncionSi, clase: 'button-success'}, {texto: 'No', accion: miFuncionNo}]
 * @param {HTMLElement|null} [modalContainerRef=null] - Referencia opcional al contenedor del modal. Si es null, usa 'modal-container'.
 */

// ===================== FUNCIONES DE MANTENIMIENTO Y RESERVA FUTURA =====================
// --- NUEVA FUNCIÓN showMantenimientoModal CON FORMULARIO DE TAREA ---


// En tu archivo mapa-habitaciones.js, reemplaza esta función:

// En tu archivo mapa-habitaciones.js, REEMPLAZA esta función completa:

// CÓDIGO CORREGIDO Y OPTIMIZADO en mapa-habitaciones.js

// js/modules/mapa_habitaciones/mapa_habitaciones.js

// ... (asegúrate de que la importación esté al inicio de tu archivo)
import { showModalTarea } from '../mantenimiento/mantenimiento.js';

// En tu archivo mapa-habitaciones.js, REEMPLAZA esta función completa:

// En tu archivo mapa-habitaciones.js, REEMPLAZA esta función completa:

async function showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');

    // 1. Confirmar la acción inicial con el usuario.
    const confirmacion = await new Promise(resolve => {
        mostrarInfoModalGlobal(
            `¿Desea crear una tarea de mantenimiento para la habitación <strong>${room.nombre}</strong>?<br><br><small>La habitación se marcará como 'mantenimiento' solo si guarda la tarea.</small>`,
            "Confirmar Envío a Mantenimiento",
            [
                { texto: "Sí, crear tarea", clase: "button-danger", accion: () => resolve(true) },
                { texto: "Cancelar", clase: "button-neutral", accion: () => resolve(false) }
            ],
            modalContainer
        );
    });

    if (!confirmacion) {
        return; // El usuario canceló, no hacemos nada más.
    }
    
    // 2. Crear el contenedor con el fondo oscuro para el modal de la tarea.
    const modalTareaContainer = document.createElement('div');
    modalTareaContainer.id = 'mant-modal-temp-container';
    modalTareaContainer.className = "fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4";
    document.body.appendChild(modalTareaContainer);

    // 3. Llamar a la función que muestra el formulario DENTRO del contenedor.
    showModalTarea(
        modalTareaContainer,
        supabase,
        hotelId,
        currentUser,
        {
            habitacion_id: room.id,
            estado: 'pendiente',
            titulo: `Mantenimiento Hab. ${room.nombre}`
        }
    );

    // 4. Usar un observador preciso para saber cuándo se cierra el modal.
    // Este "vigilante" solo se fija si el contenido del formulario desaparece.
    const observer = new MutationObserver(async (mutationsList, obs) => {
        // Si el contenedor ya no tiene el formulario adentro...
        if (modalTareaContainer.children.length === 0) {
            
            // Desconectamos el vigilante para que no se ejecute más.
            obs.disconnect(); 
            
            // Eliminamos el contenedor con el fondo oscuro.
            if (document.body.contains(modalTareaContainer)) {
                document.body.removeChild(modalTareaContainer);
            }
            
            // Refrescamos el mapa de habitaciones para ver el estado actualizado.
            console.log("Modal de tarea cerrado. Refrescando el mapa.");
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        }
    });

    // Le decimos al vigilante que observe solo el contenedor que creamos.
    observer.observe(modalTareaContainer, { childList: true });
}



async function showReservaFuturaModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto";
    modalContent.innerHTML = `
        <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">Reservar para otra fecha: ${room.nombre}</h3>
        <form id="form-reserva-futura" class="space-y-3">
            <input required name="cliente_nombre" class="form-control" placeholder="Nombre huésped">
            <input required name="cedula" class="form-control" placeholder="Cédula">
            <input required name="telefono" class="form-control" placeholder="Teléfono">
            <label class="block text-sm mb-1 mt-2">Fecha entrada:</label>
            <input required type="date" name="fecha_inicio" class="form-control">
            <label class="block text-sm mb-1 mt-2">Fecha salida:</label>
            <input required type="date" name="fecha_fin" class="form-control">
            <input required type="number" min="1" max="10" name="cantidad_huespedes" class="form-control mt-2" value="1" placeholder="Cantidad huéspedes">
            <button type="submit" class="button button-success w-full mt-2">Guardar reserva futura</button>
            <button type="button" id="cerrar-modal-futura" class="button w-full mt-2" style="background:#ef4444;color:white;">Cancelar</button>
        </form>
    `;
    modalContainer.appendChild(modalContent);

    modalContent.querySelector('#cerrar-modal-futura').onclick = () => {
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
    };

    modalContent.querySelector('#form-reserva-futura').onsubmit = async (e) => {
        e.preventDefault();
        const formData = Object.fromEntries(new FormData(e.target));
        // Validación básica de fechas
        if (formData.fecha_inicio > formData.fecha_fin) {
            mostrarInfoModalGlobal("La fecha de salida debe ser posterior a la de entrada.", "Error fechas");
            return;
        }
        // Crear la reserva futura
        await supabase.from('reservas').insert([{
            cliente_nombre: formData.cliente_nombre,
            cedula: formData.cedula,
            telefono: formData.telefono,
            habitacion_id: room.id,
            hotel_id: hotelId,
            fecha_inicio: formData.fecha_inicio,
            fecha_fin: formData.fecha_fin,
            estado: "reservada",
            cantidad_huespedes: Number(formData.cantidad_huespedes),
        }]);
        mostrarInfoModalGlobal("Reserva futura guardada correctamente.", "Reserva creada");
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    }
}

// REEMPLAZA ESTA FUNCIÓN COMPLETA

/**
 * Muestra un modal para gestionar la lista de artículos prestados de una reserva.
 * AHORA CONECTADO A INVENTARIO_PRESTABLES.
 */
async function showSeguimientoArticulosModal(room, supabase, currentUser, hotelId) {
    const modalContainer = document.getElementById('modal-container');
    showGlobalLoading("Cargando inventario...", modalContainer);
    
    try {
        // 1. Encontrar la reserva activa
        const { data: reservaActiva, error: errRes } = await supabase
            .from('reservas')
            .select('id')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .single();

        if (errRes || !reservaActiva) {
            throw new Error("No se encontró una reserva activa para esta habitación.");
        }

        // 2. Cargar datos en paralelo
        const [prestadosRes, disponiblesRes] = await Promise.all([
            // Artículos YA prestados a esta reserva
            supabase.from('historial_articulos_prestados')
                .select('id, articulo_nombre, item_prestable_id')
                .eq('reserva_id', reservaActiva.id)
                .eq('accion', 'prestado'),
            // Artículos DISPONIBLES en el inventario
            supabase.from('inventario_prestables')
                .select('id, nombre_item, stock_disponible')
                .eq('hotel_id', hotelId)
                .gt('stock_disponible', 0) // ¡Solo los que tienen stock!
        ]);

        if (prestadosRes.error) throw new Error(`Error cargando prestados: ${prestadosRes.error.message}`);
        if (disponiblesRes.error) throw new Error(`Error cargando disponibles: ${disponiblesRes.error.message}`);

        const itemsYaPrestados = prestadosRes.data || [];
        const itemsDisponibles = disponiblesRes.data || [];

        hideGlobalLoading();
        modalContainer.innerHTML = ""; // Limpiar el "cargando"
        const modalContent = document.createElement('div');
        modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-md p-6 m-auto relative animate-fade-in-up";

        // 3. Crear el HTML del modal
        const opcionesSelect = itemsDisponibles.length > 0
            ? itemsDisponibles.map(item => `<option value="${item.id}" data-nombre="${item.nombre_item}">${item.nombre_item} (Stock: ${item.stock_disponible})</option>`).join('')
            : '<option value="" disabled>No hay artículos disponibles</option>';

        modalContent.innerHTML = `
            <h3 class="text-xl font-bold mb-4 text-blue-700">Gestionar Artículos (Hab. ${room.nombre})</h3>
            <div class="mb-4">
                <label class="form-label" for="select-articulo-prestable">Añadir artículo:</label>
                <div class="flex gap-2">
                    <select id="select-articulo-prestable" class="form-control flex-grow">
                        <option value="">-- Seleccione un artículo --</option>
                        ${opcionesSelect}
                    </select>
                    <button id="btn-add-articulo" class="button button-info">Prestar</button>
                </div>
            </div>
            <div class="mb-4">
                <p class="font-semibold text-gray-700">Artículos prestados actualmente:</p>
                <div id="lista-articulos-seguimiento" class="mt-2 space-y-2 max-h-40 overflow-y-auto p-2 bg-gray-50 rounded">
                    </div>
            </div>
            <div class="flex gap-3 mt-6">
                <button id="btn-cerrar-seguimiento" class="button button-neutral flex-1">Cerrar</button>
            </div>
        `;
        modalContainer.appendChild(modalContent);

        const listaEl = modalContent.querySelector('#lista-articulos-seguimiento');
        const selectEl = modalContent.querySelector('#select-articulo-prestable');

        // 4. Función para renderizar la lista de artículos prestados
        // 4. Función para renderizar la lista de artículos prestados
        function renderListaPrestados(items) {
            if (items.length === 0) {
                listaEl.innerHTML = `<p class="text-gray-500 italic text-sm text-center">No hay artículos prestados.</p>`;
                return;
            }
            listaEl.innerHTML = items.map(item => `
                <div class="flex justify-between items-center bg-white p-2 rounded shadow-sm">
                    <span class="text-gray-800">${item.articulo_nombre}</span>
                    
                    <button data-historial-id="${item.id}" data-item-id="${item.item_prestable_id}" 
                            class="btn-devolver-articulo button button-danger button-small text-xs py-1 px-2" 
                            title="Marcar como Devuelto">
                        Devolver
                    </button>
                    </div>
            `).join('');
        }
        renderListaPrestados(itemsYaPrestados); // Renderizado inicial

        // 5. Listeners del modal
        modalContent.querySelector('#btn-cerrar-seguimiento').onclick = () => {
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
            // Refrescar el mapa para que la tarjeta muestre el cambio
            renderRooms(document.getElementById('room-map-list'), supabase, currentUser, hotelId);
        };

        // PRESTAR artículo
        modalContent.querySelector('#btn-add-articulo').onclick = async () => {
            const selectedOption = selectEl.options[selectEl.selectedIndex];
            const itemId = selectedOption.value;
            const itemNombre = selectedOption.dataset.nombre;

            if (!itemId) {
                alert("Por favor, seleccione un artículo para prestar.");
                return;
            }
            
            const btn = modalContent.querySelector('#btn-add-articulo');
            btn.disabled = true;
            btn.textContent = "Prestando...";

            try {
                // 1. Llamar a la RPC para descontar stock
                const { error: rpcError } = await supabase.rpc('prestar_articulo', { p_item_id: itemId });
                if (rpcError) throw rpcError;

                // 2. Insertar en el historial
                const { data: nuevoHistorial, error: insertError } = await supabase.from('historial_articulos_prestados').insert({
                    hotel_id: hotelId,
                    reserva_id: reservaActiva.id,
                    habitacion_id: room.id,
                    usuario_id: currentUser.id,
                    articulo_nombre: itemNombre,
                    item_prestable_id: itemId,
                    accion: 'prestado',
                    cantidad: 1
                }).select('id, articulo_nombre, item_prestable_id').single();
                if (insertError) throw insertError;

                // 3. Recargar el modal
                await showSeguimientoArticulosModal(room, supabase, currentUser, hotelId);

            } catch (err) {
                alert(`Error al prestar artículo: ${err.message}`);
                btn.disabled = false;
                btn.textContent = "Prestar";
            }
        };

       // DEVOLVER artículo (antes del check-out)
        listaEl.onclick = async (e) => {
            if (e.target.classList.contains('btn-devolver-articulo')) {
                const btn = e.target;
                const historialId = btn.dataset.historialId;
                const itemId = btn.dataset.itemId;
                
                // --- INICIO DE LA MODIFICACIÓN ---
                const result = await Swal.fire({
                    title: 'Confirmar Devolución',
                    text: '¿Está seguro de que desea marcar este artículo como devuelto?',
                    icon: 'question',
                    showCancelButton: true,
                    confirmButtonColor: '#1d4ed8', // El azul de tu app
                    cancelButtonColor: '#d33',
                    confirmButtonText: 'Sí, devolver',
                    cancelButtonText: 'Cancelar'
                });
        
                if (!result.isConfirmed) {
                    return; // Si el usuario cancela, no hacemos nada
                }
                // --- FIN DE LA MODIFICACIÓN ---

                btn.disabled = true;
                
                try {
                    // 1. Llamar a la RPC para devolver al stock
                    const { error: rpcError } = await supabase.rpc('recibir_articulo_devuelto', { p_item_id: itemId });
                    if (rpcError) throw rpcError;

                    // 2. Actualizar el historial
                    const { error: updateError } = await supabase.from('historial_articulos_prestados')
                        .update({ accion: 'devuelto' })
                        .eq('id', historialId);
                    if (updateError) throw updateError;
                    
                    // 3. Recargar el modal
                    await showSeguimientoArticulosModal(room, supabase, currentUser, hotelId);
                    
                } catch (err) {
                    alert(`Error al devolver artículo: ${err.message}`);
                    btn.disabled = false;
                }
            }
        };

    } catch (err) {
        hideGlobalLoading();
        mostrarInfoModalGlobal(err.message, "Error", [], modalContainer);
    }
}
// ===================== FIN DEL ARCHIVO =====================