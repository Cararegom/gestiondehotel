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

// ===================================================================
// Cálculo de saldo pendiente de una reserva (estancia + servicios + tienda + restaurante - pagos)
// ===================================================================
async function calcularSaldoReserva(supabase, reservaId, hotelId) {
  // Pedimos todo en paralelo
  const [
    { data: reserva, error: errReserva },
    { data: servicios, error: errServicios },
    { data: ventasTienda, error: errTienda },
    { data: ventasRest, error: errRest },
    { data: pagos, error: errPagos }
  ] = await Promise.all([
    supabase
      .from('reservas')
      .select('monto_total')
      .eq('id', reservaId)
      .maybeSingle(),

    supabase
      .from('servicios_x_reserva')
      .select('precio_cobrado')
      .eq('reserva_id', reservaId)
      .eq('hotel_id', hotelId),

    supabase
      .from('ventas_tienda')
      .select('total_venta')
      .eq('reserva_id', reservaId)
      .eq('hotel_id', hotelId),

    supabase
      .from('ventas_restaurante')
      .select('monto_total, total_venta')
      .eq('reserva_id', reservaId)
      .eq('hotel_id', hotelId),

    supabase
      .from('pagos_reserva')
      .select('monto')
      .eq('reserva_id', reservaId)
      .eq('hotel_id', hotelId)
  ]);

  // Si algo falló, lo mostramos en consola pero no rompemos la app
  const errores = [errReserva, errServicios, errTienda, errRest, errPagos].filter(Boolean);
  if (errores.length) {
    console.error('Error calculando saldo de la reserva:', errores);
  }

  const totalEstancia   = Number((reserva && reserva.monto_total) || 0);
  const totalServicios  = (servicios || []).reduce((acc, s) => acc + Number(s.precio_cobrado || 0), 0);
  const totalTienda     = (ventasTienda || []).reduce((acc, v) => acc + Number(v.total_venta || 0), 0);
  const totalRest       = (ventasRest || []).reduce((acc, v) => acc + Number(v.monto_total || v.total_venta || 0), 0);
  const totalCargos     = totalEstancia + totalServicios + totalTienda + totalRest;
  const totalPagado     = (pagos || []).reduce((acc, p) => acc + Number(p.monto || 0), 0);

  const saldoPendiente  = totalCargos - totalPagado;

  return {
    totalDeTodosLosCargos: totalCargos,
    totalPagado,
    saldoPendiente
  };
}

// Helper rápido para mostrar montos en COP
function formatCOP(value) {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(Number(value) || 0));
}


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
// ===================================================================
// IMPRESIÓN DE FACTURA / CUENTA DE COBRO (ADAPTABLE A IMPRESORA)
// ===================================================================
export async function imprimirConsumosHabitacion(supabase, hotelId, datosTicket) {
  try {
    // 1. Cargamos la configuración del hotel para saber el tamaño de papel y datos fiscales
    const { data: config, error } = await supabase
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    if (error) {
      console.error("Error cargando configuración para imprimir:", error);
      alert("Error cargando configuración de impresión.");
      return;
    }

    // 2. Llamamos a la función de construcción de HTML adaptable (estilo POS)
    imprimirFacturaPosAdaptable(config, datosTicket);

  } catch (err) {
    console.error("Error en imprimirConsumosHabitacion:", err);
    alert("Ocurrió un error al intentar generar la factura.");
  }
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

    // Limpiar intervalos de cronómetros anteriores para evitar fugas de memoria
    Object.values(cronometrosInterval).forEach(clearInterval);
    cronometrosInterval = {};

    // Mostrar estado de carga
    gridEl.innerHTML = `<div class="col-span-full text-center text-slate-500 p-6">Cargando habitaciones...</div>`;

    // Consulta a Supabase
    const { data: habitaciones, error } = await supabase
        .from('habitaciones')
        .select('*, reservas(id, estado, fecha_inicio, fecha_fin, cliente_nombre, historial_articulos_prestados(id, articulo_nombre, accion, item_prestable_id))')
        .eq('hotel_id', hotelId)
        .order('nombre', { ascending: true });

    if (error) {
        gridEl.innerHTML = `<div class="col-span-full text-red-600 p-4 bg-red-100 rounded-md">Error: ${error.message}</div>`;
        return;
    }

    currentRooms = habitaciones;

    // ================== LÓGICA DE BLOQUEO (2 HORAS ANTES) ==================
    const ahora = new Date();
    const DOS_HORAS_MS = 2 * 60 * 60 * 1000; // 2 Horas en milisegundos

    currentRooms.forEach(room => {
        // Inicializamos la propiedad para guardar la info de la próxima reserva
        // Esto servirá para que 'roomCard' pueda pintar la fecha y hora
        room.proximaReservaData = null;

        if (!Array.isArray(room.reservas) || room.reservas.length === 0) return;

        // 1. Filtrar reservas futuras relevantes (reservada o confirmada)
        // Ignoramos las canceladas o las que ya pasaron
        const reservasFuturas = room.reservas
            .filter(r => 
                (r.estado === 'reservada' || r.estado === 'confirmada') && 
                new Date(r.fecha_inicio) > ahora
            )
            .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

        // 2. Si hay reservas futuras, tomamos la más cercana
        if (reservasFuturas.length > 0) {
            const proxima = reservasFuturas[0];
            const inicioReserva = new Date(proxima.fecha_inicio);
            const tiempoFaltante = inicioReserva.getTime() - ahora.getTime();

            // Guardamos la referencia de la reserva en el objeto habitación
            room.proximaReservaData = proxima;

            // 3. Aplicar bloqueo visual si faltan 2 horas o menos
            // Solo cambiamos el estado si la habitación no está ocupada, sucia o en mantenimiento
            if (tiempoFaltante <= DOS_HORAS_MS && tiempoFaltante > 0) {
                if (!['ocupada', 'tiempo agotado', 'limpieza', 'mantenimiento'].includes(room.estado)) {
                    room.estado = 'reservada'; // Forzamos el estado visual para el mapa
                }
            }
        }
    });
    // =================== FIN DE LÓGICA DE BLOQUEO ====================

    // Renderizar filtros de piso (Piso 1, Piso 2, etc.)
    renderFloorFilters(currentRooms, filterContainer, gridEl, supabase, currentUser, hotelId);
    
    // Limpiar grid para renderizar tarjetas finales
    gridEl.innerHTML = ''; 
    const mainAppContainer = gridEl;

    if (!currentRooms || currentRooms.length === 0) {
        gridEl.innerHTML = `<div class="col-span-full text-gray-500 p-4 text-center">No hay habitaciones configuradas.</div>`;
        return;
    }
    
    // Ordenar habitaciones numéricamente (101, 102, 201...) en lugar de alfabéticamente (1, 10, 100, 2)
    currentRooms.sort((a, b) => {
        const getNumber = nombre => {
            const match = String(nombre || '').match(/\d+/);
            return match ? parseInt(match[0], 10) : Infinity;
        };
        return getNumber(a.nombre) - getNumber(b.nombre);
    });

    // Generar las tarjetas
    currentRooms.forEach(room => {
        // Se pasa 'mainAppContainer' a roomCard para los modales
        gridEl.appendChild(roomCard(room, supabase, currentUser, hotelId, mainAppContainer));
        
        // Si la habitación está ocupada o tiempo agotado, iniciamos el cronómetro visual
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


// En js/modules/mapa_habitaciones/mapa_habitaciones.js

function roomCard(room, supabase, currentUser, hotelId, mainAppContainer) {
    const card = document.createElement('div');
    // Añadimos 'relative' para posicionar elementos si fuera necesario
    card.className = `room-card bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 ease-in-out hover:shadow-cyan-200/50 hover:border-cyan-500 border-2 border-transparent flex flex-col group relative`;

    // --- Lógica de estado y badge ---
    let badgeBgClass = 'bg-slate-100 text-slate-700';
    let estadoText = room.estado ? room.estado.toUpperCase().replace(/_/g, " ") : 'DESCONOCIDO';
    if (estadoColores[room.estado]) {
        badgeBgClass = estadoColores[room.estado].badge;
        // Si está reservada por el bloqueo de 2 horas, aseguramos el borde correcto
        if(room.estado === 'reservada') {
             card.classList.add('border-indigo-500');
             card.classList.remove('border-transparent');
        } else {
             card.classList.add(estadoColores[room.estado].border.split(' ')[0]); // Añadir color de borde
             card.classList.remove('border-transparent');
        }
    }
    
    const imageBannerHTML = room.imagen_url
        ? `<div class="relative h-48 bg-slate-200"><img src="${room.imagen_url}" class="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" alt="Habitación ${room.nombre}" /></div>`
        : '';

    // --- BLOQUE NUEVO: Mostrar Próxima Reserva ---
    let reservaInfoHTML = '';
    // Usamos el dato que calculamos en renderRooms (room.proximaReservaData)
    // O si la habitación ya tiene estado 'reservada', buscamos en su array
    if (room.proximaReservaData || (room.estado === 'reservada' && room.reservas && room.reservas.length > 0)) {
        
        // Preferimos el dato calculado, si no, buscamos fallback
        const r = room.proximaReservaData || room.reservas.find(res => res.estado === 'reservada');
        
        if (r) {
            const fechaObj = new Date(r.fecha_inicio);
            const horaStr = fechaObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true });
            const fechaStr = fechaObj.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
            
            // Icono de reloj/calendario
            const iconCal = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
            
            reservaInfoHTML = `
                <div class="mt-2 mb-1 p-2 bg-indigo-50 border border-indigo-100 rounded-lg flex items-start flex-col animate-pulse">
                    <div class="flex items-center w-full">
                        ${iconCal}
                        <span class="text-xs font-bold text-indigo-700 uppercase tracking-wide">Próxima Reserva</span>
                    </div>
                    <div class="pl-6 text-sm text-indigo-900 font-semibold">
                        ${fechaStr} - ${horaStr}
                    </div>
                    <div class="pl-6 text-xs text-indigo-500 truncate w-full">
                        ${r.cliente_nombre || 'Cliente'}
                    </div>
                </div>
            `;
        }
    }

    // --- Resto de información (Artículos prestados) ---
    const reservaOcupada = (Array.isArray(room.reservas) && room.reservas.length > 0)
        ? room.reservas.find(r => ['ocupada', 'activa', 'tiempo agotado'].includes(r.estado))
        : null;

    const articulosEnSeguimiento = reservaOcupada?.historial_articulos_prestados?.filter(h => h.accion === 'prestado') || [];
    let articulosInfoHTML = '';

    if (articulosEnSeguimiento.length > 0) {
        const iconEntrega = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5 text-blue-500" viewBox="0 0 20 20" fill="currentColor"><path d="M8 4a1 1 0 011 1v1H8a1 1 0 010-2zm0 3h2a1 1 0 011 1v2a1 1 0 01-1 1H8a1 1 0 01-1-1V8a1 1 0 011-1z" /><path fill-rule="evenodd" d="M4 3a2 2 0 012-2h8a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V3zm2 1h8v12H6V4z" clip-rule="evenodd" /></svg>`;
        articulosInfoHTML = `
            <div class="mt-2 pt-2 border-t border-slate-100 text-sm">
                <p class="flex items-center text-blue-700 font-semibold mb-1">
                    ${iconEntrega} <span>Artículos:</span>
                </p>
                <div class="flex flex-wrap gap-1">
                    ${articulosEnSeguimiento.map(item => `<span class="badge bg-blue-100 text-blue-800 px-2 py-0.5 text-[10px] font-medium rounded-full border border-blue-200">${item.articulo_nombre}</span>`).join('')}
                </div>
            </div>
        `;
    }

    card.innerHTML = `
        ${imageBannerHTML}
        <div class="p-4 flex-grow flex flex-col">
            <div class="flex justify-between items-start mb-2"> 
                <div>
                    <h3 class="text-lg font-bold text-slate-800 leading-tight">${room.nombre}</h3>
                    <p class="text-xs text-slate-500">${room.tipo || 'General'}</p>
                </div>
                <span class="badge ${badgeBgClass} px-2 py-1 text-[10px] uppercase font-bold rounded shadow-sm border border-black/5">
                    ${estadoText}
                </span>
            </div>

            ${reservaInfoHTML} ${articulosInfoHTML}

            ${room.amenidades && room.amenidades.length > 0 ? `
                <div class="mt-auto pt-3 border-t border-slate-100">
                    <div class="flex flex-wrap items-center gap-2 text-slate-400">
                        ${room.amenidades.slice(0, 4).map(am => getAmenityIcon(am)).join('')}
                        ${room.amenidades.length > 4 ? '<span class="text-xs text-slate-400">+</span>' : ''}
                    </div>
                </div>`
                : '<div class="flex-grow"></div>'
            }
        </div>
        
        <div class="bg-gray-50 border-t border-gray-200 px-4 py-1.5 flex justify-between items-center h-9">
             <div id="cronometro-${room.id}" class="cronometro-display w-full text-right font-mono text-sm flex items-center justify-end text-slate-600">
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

// =================================================================================
// FUNCIÓN FALTANTE: MODAL DE SERVICIOS ADICIONALES
// =================================================================================

function showEnhancedServiciosModal(roomDisplayInfo, availableServices, activeReservation) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = "";
    modalContainer.style.display = "flex";

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-6 sm:p-8 m-auto border-2 border-green-100 relative flex flex-col max-h-[90vh] animate-fade-in-up";

    modalContent.innerHTML = `
        <h3 class="text-2xl font-black mb-6 text-green-700 text-center flex items-center justify-center gap-2">
            <span>✨ Servicios Adicionales</span>
            <span class="text-xl text-green-500 font-medium">(${roomDisplayInfo.nombre})</span>
        </h3>
        
        <form id="form-servicios-adicionales" class="space-y-4 overflow-y-auto flex-grow pr-2">
            <label class="block text-lg font-semibold text-gray-700">Seleccione los servicios:</label>
            <div class="space-y-3">
                ${availableServices.map(s => `
                    <div class="service-item group flex items-center gap-3 rounded-xl bg-green-50 border border-green-200 p-3 hover:border-green-400 transition-all">
                        <input type="checkbox" id="servicio_${s.id}" name="servicio_ids" value="${s.id}" data-precio="${s.precio || 0}" class="form-checkbox h-5 w-5 text-green-600 rounded focus:ring-green-500 cursor-pointer">
                        
                        <label for="servicio_${s.id}" class="flex-1 flex justify-between items-center cursor-pointer select-none">
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-green-900">${s.nombre}</span>
                            </div>
                            <span class="text-green-700 font-semibold">${s.precio ? formatCurrency(s.precio) : 'Gratis'}</span>
                        </label>
                        
                        <input type="number" min="1" value="1" name="cantidad_${s.id}" 
                            class="quantity-input border-2 border-green-200 rounded-lg w-16 px-1 py-1 text-center font-bold text-gray-700 focus:ring-2 focus:ring-green-500 opacity-50 disabled:opacity-30 transition-opacity" 
                            disabled placeholder="Cant.">
                    </div>
                `).join('')}
            </div>

            <div class="pt-2">
                <label class="block mb-2 font-semibold text-gray-700">Nota (Opcional):</label>
                <textarea name="nota_servicio" class="w-full border-2 border-gray-200 rounded-xl p-3 focus:ring-2 focus:ring-green-500" rows="2" placeholder="Ej: Toallas extra, Sin hielo..."></textarea>
            </div>
        </form>

        <div class="mt-6 pt-4 border-t border-gray-100">
            <div class="flex justify-between items-center mb-4 text-xl font-bold text-gray-800">
                <span>Total Estimado:</span>
                <span id="preview-total-servicios" class="text-green-600">$0</span>
            </div>
            
            <div class="flex gap-3">
                <button type="submit" form="form-servicios-adicionales" class="flex-1 button button-success py-3 text-lg font-bold shadow-md">
                    Siguiente ➡
                </button>
                <button type="button" id="btn-cancelar-servicios" class="flex-1 button button-neutral py-3 text-lg font-bold shadow-md">
                    Cancelar
                </button>
            </div>
        </div>
    `;

    modalContainer.appendChild(modalContent);

    // --- LÓGICA DEL FORMULARIO ---
    const form = modalContent.querySelector('#form-servicios-adicionales');
    const previewTotalElement = modalContent.querySelector('#preview-total-servicios');
    const serviceItems = form.querySelectorAll('.service-item');

    // Actualizar total y habilitar inputs de cantidad
    const updateState = () => {
        let total = 0;
        serviceItems.forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const qtyInput = item.querySelector('.quantity-input');
            const precio = Number(checkbox.dataset.precio) || 0;

            if (checkbox.checked) {
                qtyInput.disabled = false;
                qtyInput.classList.remove('opacity-50');
                total += precio * (parseInt(qtyInput.value) || 1);
            } else {
                qtyInput.disabled = true;
                qtyInput.classList.add('opacity-50');
            }
        });
        previewTotalElement.textContent = formatCurrency(total);
    };

    form.addEventListener('input', updateState);
    
    // Cerrar modal
    modalContent.querySelector('#btn-cancelar-servicios').onclick = () => {
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
    };

    // --- SUBMIT DEL FORMULARIO (SELECCIÓN DE MÉTODO DE PAGO) ---
    form.onsubmit = async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        const nota = formData.get('nota_servicio');
        
        // Recopilar items seleccionados
        const itemsSeleccionados = [];
        serviceItems.forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            if (checkbox.checked) {
                const qty = parseInt(item.querySelector('.quantity-input').value) || 1;
                const precio = Number(checkbox.dataset.precio) || 0;
                itemsSeleccionados.push({
                    servicio_id: checkbox.value,
                    cantidad: qty,
                    precio_unitario: precio,
                    subtotal: qty * precio,
                    nombre: availableServices.find(s => s.id == checkbox.value)?.nombre
                });
            }
        });

        if (itemsSeleccionados.length === 0) {
            alert("Seleccione al menos un servicio.");
            return;
        }

        const totalPagar = itemsSeleccionados.reduce((sum, i) => sum + i.subtotal, 0);

        // PREGUNTAR: ¿Cobrar ahora o al final?
        const result = await Swal.fire({
            title: 'Confirmar Servicios',
            html: `
                <p class="mb-2">Total a cargar: <strong>${formatCurrency(totalPagar)}</strong></p>
                <div class="text-left text-sm bg-gray-50 p-3 rounded mb-4">
                    <ul class="list-disc ml-4">
                        ${itemsSeleccionados.map(i => `<li>${i.cantidad}x ${i.nombre}</li>`).join('')}
                    </ul>
                </div>
                <p class="text-sm text-gray-600">¿Desea cobrar esto ahora mismo o cargarlo a la cuenta?</p>
            `,
            icon: 'question',
            showDenyButton: true,
            showCancelButton: true,
            confirmButtonText: 'Cobrar AHORA (Caja)',
            denyButtonText: 'Cargar a la Cuenta',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#10b981', // Verde
            denyButtonColor: '#3b82f6'     // Azul
        });

        if (result.isDismissed) return;

        try {
            showGlobalLoading("Procesando servicios...");

            if (result.isConfirmed) { 
                // === COBRAR AHORA (Requiere Turno) ===
                const turnoId = turnoService.getActiveTurnId();
                if (!turnoId) throw new Error("No hay turno activo para cobrar en caja.");

                // 1. Obtener métodos de pago
                const { data: metodos } = await supabaseGlobal.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelIdGlobal).eq('activo', true);
                if(!metodos.length) throw new Error("No hay métodos de pago configurados.");
                
                // Mapear para Swal
                const opciones = metodos.reduce((acc, curr) => ({...acc, [curr.id]: curr.nombre}), {});
                
                hideGlobalLoading(); // Ocultar spinner anterior para mostrar input
                
                // Seleccionar método de pago
                const { value: metodoPagoId } = await Swal.fire({
                    title: 'Seleccione Método de Pago',
                    input: 'select',
                    inputOptions: opciones,
                    inputPlaceholder: 'Seleccione...',
                    showCancelButton: true
                });

                if (!metodoPagoId) return; // Cancelado
                showGlobalLoading("Registrando pago...");

                // 2. Registrar Pago en `pagos_reserva`
                const concepto = `Servicios Adicionales (${itemsSeleccionados.map(i=>i.nombre).join(', ')})`;
                const { data: pagoData, error: errPago } = await supabaseGlobal.from('pagos_reserva').insert({
                    hotel_id: hotelIdGlobal,
                    reserva_id: activeReservation.id,
                    monto: totalPagar,
                    metodo_pago_id: metodoPagoId,
                    usuario_id: currentUserGlobal.id,
                    concepto: concepto
                }).select().single();
                if(errPago) throw errPago;

                // 3. Registrar en Caja
                await supabaseGlobal.from('caja').insert({
                    hotel_id: hotelIdGlobal,
                    tipo: 'ingreso',
                    monto: totalPagar,
                    concepto: `Pago Servicios Hab. ${roomDisplayInfo.nombre}`,
                    metodo_pago_id: metodoPagoId,
                    usuario_id: currentUserGlobal.id,
                    reserva_id: activeReservation.id,
                    pago_reserva_id: pagoData.id,
                    turno_id: turnoId
                });

                // 4. Registrar los servicios como PAGADOS
                const serviciosInsert = itemsSeleccionados.map(item => ({
                    hotel_id: hotelIdGlobal,
                    reserva_id: activeReservation.id,
                    servicio_id: item.servicio_id,
                    cantidad: item.cantidad,
                    precio_cobrado: item.subtotal,
                    nota: nota,
                    estado_pago: 'pagado',
                    pago_reserva_id: pagoData.id
                }));
                const { error: errServ } = await supabaseGlobal.from('servicios_x_reserva').insert(serviciosInsert);
                if(errServ) throw errServ;

                // 5. Actualizar monto pagado reserva
                const nuevoPagado = (activeReservation.monto_pagado || 0) + totalPagar;
                await supabaseGlobal.from('reservas').update({ monto_pagado: nuevoPagado }).eq('id', activeReservation.id);

                Swal.fire('¡Éxito!', 'Servicios cobrados y registrados.', 'success');

            } else if (result.isDenied) {
                // === CARGAR A LA CUENTA (Pendiente) ===
                const serviciosInsert = itemsSeleccionados.map(item => ({
                    hotel_id: hotelIdGlobal,
                    reserva_id: activeReservation.id,
                    servicio_id: item.servicio_id,
                    cantidad: item.cantidad,
                    precio_cobrado: item.subtotal,
                    nota: nota,
                    estado_pago: 'pendiente' // Se paga al checkout
                }));

                const { error: errServ } = await supabaseGlobal.from('servicios_x_reserva').insert(serviciosInsert);
                if(errServ) throw errServ;

                Swal.fire('Registrado', 'Los servicios se han cargado a la cuenta de la habitación.', 'success');
            }

            // Cerrar modal y limpiar
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';

        } catch (error) {
            console.error(error);
            hideGlobalLoading();
            Swal.fire('Error', error.message, 'error');
        } finally {
            hideGlobalLoading();
        }
    };
}
// ================== MODAL OPCIONES HABITACIÓN ===================
// ================== MODAL OPCIONES HABITACIÓN (VERSIÓN COMPLETA Y UNIFICADA) ===================
async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    // 1. Declarar variables iniciales
    let reservaFutura = null;
    let botonesHtml = '';

    // Estilos de botones (Tailwind)
    const btnPrincipal = "w-full mb-2 py-2.5 rounded-lg text-white font-semibold bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";
    const btnSecundario = "w-full mb-2 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnVerde = "w-full mb-2 py-2.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 font-medium border border-green-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnNaranja = "w-full mb-2 py-2.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium border border-orange-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnRojo = "w-full mt-4 py-2.5 rounded-lg text-white font-semibold bg-red-600 hover:bg-red-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";

    // ---------------------------------------------------------------
    // 2. GENERAR HTML SEGÚN EL ESTADO DE LA HABITACIÓN
    // ---------------------------------------------------------------

    // --- CASO A: HABITACIÓN LIBRE ---
    if (room.estado === "libre") {
        botonesHtml += `<button id="btn-alquilar-directo" class="${btnPrincipal}"><span style="font-size:1.2em">🛏️</span> Alquilar Ahora</button>`;
        botonesHtml += `<button id="btn-enviar-limpieza" class="${btnSecundario}"><span style="font-size:1.2em">🧹</span> Enviar a Limpieza</button>`;
    }

    // --- CASO B: OCUPADA / ACTIVA / TIEMPO AGOTADO ---
    else if (["ocupada", "tiempo agotado", "activa"].includes(room.estado)) {
        botonesHtml += `<button id="btn-extender-tiempo" class="${btnPrincipal}"><span style="font-size:1.2em">⏱️</span> Extender Tiempo</button>`;
        botonesHtml += `<button id="btn-entregar" class="${btnSecundario}"><span style="font-size:1.2em">🔓</span> Liberar Habitación</button>`;
        botonesHtml += `<button id="btn-ver-consumos" class="${btnSecundario}"><span style="font-size:1.2em">🍽️</span> Ver Consumos</button>`;
        botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
        botonesHtml += `<button id="btn-seguimiento-articulos" class="${btnSecundario}"><span style="font-size:1.2em">📦</span> Gestionar Artículos</button>`;
        // Servicios adicionales
        botonesHtml += `<button id="btn-servicios-adicionales" class="${btnVerde}"><span style="font-size:1.2em">🛎️</span> Servicios adicionales</button>`;
    }

    // --- CASO C: RESERVADA (Check-in pendiente) ---
    else if (room.estado === "reservada") {
        // Consultar datos de la reserva futura
        const { data, error } = await supabase
            .from('reservas')
            .select('id, cliente_nombre, telefono, cantidad_huespedes, fecha_inicio, fecha_fin')
            .eq('habitacion_id', room.id)
            .eq('estado', 'reservada')
            .order('fecha_inicio', { ascending: true }) // La más próxima
            .limit(1)
            .maybeSingle();

        if (data) {
            reservaFutura = data;
            const fechaInicio = new Date(reservaFutura.fecha_inicio);
            const ahora = new Date();
            const diferenciaMin = (fechaInicio - ahora) / 60000;

            // Info visual
            botonesHtml += `<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-900 shadow-sm">
                <strong>Cliente:</strong> ${reservaFutura.cliente_nombre}<br>
                <strong>Huéspedes:</strong> ${reservaFutura.cantidad_huespedes}<br>
                <strong>Llegada:</strong> ${fechaInicio.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </div>`;

            // Botón Check-in (habilitado 2 horas antes o si ya pasó la hora)
            if (diferenciaMin <= 120) {
                botonesHtml += `<button id="btn-checkin-reserva" class="${btnVerde}"><span style="font-size:1.2em">✅</span> Check-in (Entrada)</button>`;
            } else {
                botonesHtml += `<div class="text-center text-xs text-orange-600 font-bold mb-2 bg-orange-50 p-2 rounded border border-orange-200">
                    ⏳ Check-in habilitado desde las ${new Date(fechaInicio.getTime() - 120 * 60000).toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'})}
                </div>`;
            }
        } else {
            botonesHtml += `<div class="text-xs text-red-500 mb-2 p-2 bg-red-50 rounded">No se encontró la reserva activa para check-in.</div>`;
        }
        
        // Cambio de habitación permitido en reserva
        botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
    }

    // --- OPCIONES COMUNES ---
    
    // Mantenimiento (si no está ya en mantenimiento)
    if (room.estado !== "mantenimiento") {
        botonesHtml += `<button id="btn-mantenimiento" class="${btnNaranja}"><span style="font-size:1.2em">🛠️</span> Enviar a Mantenimiento</button>`;
    }

    // Info Huésped (si hay alguien asociado a la habitación)
    if (["ocupada", "tiempo agotado", "reservada", "activa"].includes(room.estado)) {
        botonesHtml += `<button id="btn-info-huesped" class="${btnSecundario}"><span style="font-size:1.2em">👤</span> Ver Info Huésped</button>`;
    }

    // Cerrar Modal
    botonesHtml += `<button id="close-modal-acciones" class="${btnRojo}"><span style="font-size:1.2em">❌</span> Cerrar</button>`;

    // 3. RENDERIZAR EL MODAL EN EL DOM
    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up";
    modalContent.innerHTML = `
        <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">${room.nombre} (${room.estado ? room.estado.toUpperCase() : 'N/A'})</h3>
        <div class="flex flex-col gap-2.5">
            ${botonesHtml}
        </div>
    `;
    modalContainer.appendChild(modalContent);

    // Cierre al hacer click fuera del modal
    modalContainer.onclick = (e) => {
        if (e.target === modalContainer) {
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
        }
    };

    // Helper para asignar eventos de forma segura
    const setupButtonListener = (id, handler) => {
        const btn = modalContent.querySelector(`#${id}`);
        if (btn) {
            // Removemos listeners previos clonando el nodo (opcional, pero limpio)
            // En este caso, como creamos el modal de cero cada vez, no es estrictamente necesario clonar.
            btn.onclick = (e) => handler(btn, room);
        }
    };

    // =================================================================
    // 4. ASIGNACIÓN DE EVENTOS (AQUÍ ESTÁ LA CLAVE PARA QUE FUNCIONEN)
    // =================================================================

    // --- ACCIÓN: CERRAR ---
    setupButtonListener('close-modal-acciones', () => {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
    });

    // --- ACCIÓN: ALQUILAR ---
    setupButtonListener('btn-alquilar-directo', async () => {
        const ahora = new Date();
        // Validar si hay una reserva próxima que bloquee el alquiler
        const { data: reservasFuturas } = await supabase
            .from('reservas')
            .select('fecha_inicio')
            .eq('habitacion_id', room.id)
            .in('estado', ['reservada', 'activa'])
            .gte('fecha_fin', ahora.toISOString())
            .order('fecha_inicio', { ascending: true })
            .limit(1);

        if (reservasFuturas && reservasFuturas.length > 0) {
            const inicioBloqueo = new Date(new Date(reservasFuturas[0].fecha_inicio).getTime() - 2 * 60 * 60 * 1000); // 2 horas antes
            if (ahora >= inicioBloqueo) {
                mostrarInfoModalGlobal("No puedes alquilar: habitación bloqueada por reserva próxima.", "Bloqueado");
                return;
            }
        }
        showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer);
    });

    // --- ACCIÓN: EXTENDER TIEMPO ---
    setupButtonListener('btn-extender-tiempo', () => showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer));

    // --- ACCIÓN: MANTENIMIENTO ---
    setupButtonListener('btn-mantenimiento', () => showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer));

    // --- ACCIÓN: LIMPIEZA ---
    setupButtonListener('btn-enviar-limpieza', async (btn) => {
        btn.disabled = true; btn.textContent = "Enviando...";
        await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);
        modalContainer.style.display = "none"; modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    });

    // --- ACCIÓN: GESTIONAR ARTÍCULOS ---
    setupButtonListener('btn-seguimiento-articulos', () => showSeguimientoArticulosModal(room, supabase, currentUser, hotelId));

    // --- ACCIÓN: VER INFO HUÉSPED ---
    setupButtonListener('btn-info-huesped', async () => {
        const { data: reserva } = await supabase.from('reservas')
            .select('*')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .single();
            
        if (reserva) {
            mostrarInfoModalGlobal(`
                <b>Nombre:</b> ${reserva.cliente_nombre}<br>
                <b>Tel:</b> ${reserva.telefono || 'N/A'}<br>
                <b>Entrada:</b> ${formatDateTime(reserva.fecha_inicio)}<br>
                <b>Salida:</b> ${formatDateTime(reserva.fecha_fin)}<br>
                ${reserva.notas ? `<b>Notas:</b> ${reserva.notas}` : ''}
            `, "Info Huésped");
        } else {
            mostrarInfoModalGlobal("No se encontró información.", "Info");
        }
    });

    // --- ACCIÓN: CHECK-IN RESERVA ---
    if (reservaFutura) {
        setupButtonListener('btn-checkin-reserva', async () => {
            // Validar si requiere pago
            const ok = await puedeHacerCheckIn(reservaFutura.id);
            if (!ok) return;

            // Calcular nueva fecha fin basada en la duración original
            const duracionMs = new Date(reservaFutura.fecha_fin) - new Date(reservaFutura.fecha_inicio);
            const nuevoInicio = new Date();
            const nuevoFin = new Date(nuevoInicio.getTime() + duracionMs);

            // Actualizar Reserva
            await supabase.from('reservas').update({
                estado: 'activa', 
                fecha_inicio: nuevoInicio.toISOString(), 
                fecha_fin: nuevoFin.toISOString()
            }).eq('id', reservaFutura.id);

            // Actualizar Habitación
            await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

            // Crear Cronómetro
            await supabase.from('cronometros').insert([{
                hotel_id: hotelId, 
                reserva_id: reservaFutura.id, 
                habitacion_id: room.id,
                fecha_inicio: nuevoInicio.toISOString(), 
                fecha_fin: nuevoFin.toISOString(), 
                activo: true
            }]);

            modalContainer.style.display = "none"; modalContainer.innerHTML = '';
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
            mostrarInfoModalGlobal("Check-in realizado con éxito.", "Bienvenido");
        });
    }

    // --- ACCIÓN: CAMBIAR HABITACIÓN ---
setupButtonListener('btn-cambiar-habitacion', async (btn) => {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Cargando...';

    try {
        const { data: habsLibres, error: errHabs } = await supabase.from('habitaciones')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('estado', 'libre')
            .neq('id', room.id);

        if (errHabs) {
            console.error('Error obteniendo habitaciones libres:', errHabs);
            mostrarInfoModalGlobal("No se pudieron obtener las habitaciones libres.", "Error");
            return;
        }
        
        if (!habsLibres || habsLibres.length === 0) {
            mostrarInfoModalGlobal("No hay habitaciones libres disponibles.", "Error");
            return;
        }

        const options = habsLibres
            .map(h => `<option value="${h.id}">${h.nombre}</option>`)
            .join('');
        
        const { value: formValues } = await Swal.fire({
            title: 'Cambiar Habitación',
            html: `
                <label class="block text-left mb-1 text-sm">Destino:</label>
                <select id="swal-cambio-hab" class="swal2-input mb-3">${options}</select>
                <label class="block text-left mb-1 text-sm">Motivo:</label>
                <input id="swal-cambio-motivo" class="swal2-input" placeholder="Ej: Aire acondicionado fallando">
            `,
            showCancelButton: true,
            focusConfirm: false,
            preConfirm: () => {
                const id = document.getElementById('swal-cambio-hab').value;
                const motivo = document.getElementById('swal-cambio-motivo').value.trim();
                if (!id) Swal.showValidationMessage('Debes escoger una habitación destino.');
                if (!motivo) Swal.showValidationMessage('Debes escribir un motivo.');
                return { id, motivo };
            }
        });

        if (!formValues || !formValues.id || !formValues.motivo) return;

        const { data: resActiva, error: errResActiva } = await supabase.from('reservas')
            .select('id, estado')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (errResActiva) {
            console.error('Error obteniendo reserva activa para cambio:', errResActiva);
            mostrarInfoModalGlobal("No se pudo obtener la reserva actual de la habitación.", "Error");
            return;
        }

        if (!resActiva) {
            mostrarInfoModalGlobal("No se encontró una reserva activa asociada a esta habitación.", "Sin Reserva");
            return;
        }

        const { error: errRpc } = await supabase.rpc('cambiar_habitacion_transaccion', {
            p_reserva_id: resActiva.id,
            p_habitacion_origen_id: room.id,
            p_habitacion_destino_id: formValues.id,
            p_motivo_cambio: formValues.motivo,
            p_usuario_id: currentUser.id,
            p_hotel_id: hotelId,
            p_estado_destino: room.estado === 'reservada' ? 'reservada' : 'ocupada'
        });

        if (errRpc) {
            console.error('Error en cambiar_habitacion_transaccion:', errRpc);
            mostrarInfoModalGlobal("No se pudo cambiar la habitación: " + (errRpc.message || "Error en la transacción."), "Error");
            return;
        }

        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';

        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        mostrarInfoModalGlobal("Habitación cambiada correctamente.", "Éxito");
    } catch (err) {
        console.error('Error general al cambiar habitación:', err);
        mostrarInfoModalGlobal("Ocurrió un error al cambiar la habitación: " + (err.message || "Error desconocido"), "Error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});


    // --- ACCIÓN: SERVICIOS ADICIONALES ---
    setupButtonListener('btn-servicios-adicionales', async () => {
        const { data: reserva } = await supabase.from('reservas')
            .select('id, cliente_nombre, estado, monto_pagado')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .limit(1)
            .maybeSingle();
        
        if (!reserva) { 
            mostrarInfoModalGlobal("No hay reserva activa.", "Error"); 
            return; 
        }

        const { data: servicios } = await supabase.from('servicios_adicionales')
            .select('*')
            .eq('hotel_id', hotelId)
            .eq('activo', true);
        
        if (servicios && servicios.length > 0) {
            // Nota: Aquí llamamos a tu función externa, asegurate de que exista en el scope o importada
            showEnhancedServiciosModal(room, servicios, reserva);
        } else {
            mostrarInfoModalGlobal("No hay servicios configurados en el sistema.", "Info");
        }
    });

// ===================================================================
// Ver consumos (MODIFICADO: Usa modal local para evitar facturación electrónica)
// ===================================================================
setupButtonListener('btn-ver-consumos', async (btn) => {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Cargando...';
  btn.disabled = true;

  try {
    // 1. Buscar reserva activa
    const { data: r, error: errReserva } = await supabase
      .from('reservas')
      .select('*') // Traemos todo para tener datos del cliente
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .limit(1)
      .maybeSingle();

    if (errReserva) console.error(errReserva);

    if (!r) {
        mostrarInfoModalGlobal("No hay reserva activa para ver consumos.", "Sin Reserva");
        return;
    }

    // 2. Si es duración abierta, actualizar precio (lógica original)
    if (r.tipo_duracion === 'abierta') {
      try {
        const calculo = await calculateTimeAndPrice(supabase, r, hotelId, hotelConfigGlobal);
        if (calculo && calculo.precioAlojamientoCalculado !== Number(r.monto_total)) {
          const { error: upErr } = await supabase
            .from('reservas')
            .update({ monto_total: calculo.precioAlojamientoCalculado })
            .eq('id', r.id);
          if(!upErr) r.monto_total = calculo.precioAlojamientoCalculado; 
        }
      } catch (e) { console.error(e); }
    }

    // 3. LLAMAR A NUESTRA NUEVA VENTANA MODAL LOCAL
    await mostrarModalConsumosLocal(room, r, supabase, currentUser, hotelId);

  } catch (err) {
      console.error(err);
      mostrarInfoModalGlobal("Error al cargar consumos.", "Error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});


// ===================================================================
// ENTREGAR / LIBERAR HABITACIÓN (CON CORRECCIÓN DE ERROR DE DATOS)
// ===================================================================
setupButtonListener('btn-entregar', async (btn) => {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Procesando...';
  btn.disabled = true;

  try {
    // 1. Buscar reserva activa asociada a la habitación
    const { data: reservaActiva, error: errReserva } = await supabase
      .from('reservas')
      .select('id, estado')
      .eq('habitacion_id', room.id)
      .eq('hotel_id', hotelId)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .limit(1)
      .maybeSingle();

    if (errReserva) {
      console.error('Error buscando reserva activa al liberar:', errReserva);
    }

    // ========================================================================
    // CORRECCIÓN: MANEJO DE "ERROR DE DATOS" (Habitación ocupada sin reserva)
    // ========================================================================
    if (!reservaActiva) {
      // En lugar de bloquear, preguntamos si quieren forzar la limpieza
      const { isConfirmed } = await Swal.fire({
        icon: 'error', // Icono de error para alertar que algo raro pasa
        title: '⚠ Inconsistencia de Datos',
        html: `
          Esta habitación figura como ocupada, pero <b>no se encontró ninguna reserva activa</b> asociada.<br><br>
          ¿Deseas <b>forzar</b> el cambio de estado a <b>LIMPIEZA</b> para desbloquearla?
        `,
        showCancelButton: true,
        confirmButtonText: 'Sí, Forzar a Limpieza',
        confirmButtonColor: '#d33', // Rojo para indicar acción de fuerza
        cancelButtonText: 'Cancelar'
      });

      if (isConfirmed) {
        // 1. Forzar estado a limpieza
        await supabase.from('habitaciones')
            .update({ estado: 'limpieza', actualizado_en: new Date().toISOString() })
            .eq('id', room.id);
        
        // 2. Matar cualquier cronómetro huérfano
        await supabase.from('cronometros')
            .update({ activo: false, fecha_fin: new Date().toISOString() })
            .eq('habitacion_id', room.id);

        // 3. Cerrar modal y refrescar
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        
        Swal.fire('Corregido', 'La habitación ha sido enviada a limpieza forzosamente.', 'success');
      }
      
      // Restaurar botón y salir
      btn.innerHTML = originalText;
      btn.disabled = false;
      return; 
    }
    // ================= FIN DE LA CORRECCIÓN =================

    // SI SÍ HAY RESERVA, EL CÓDIGO SIGUE NORMALMENTE DESDE AQUÍ:
    
    // 2. Verificar artículos prestados sin devolver
    const { data: historialArticulos, error: errHist } = await supabase
      .from('historial_articulos_prestados')
      .select('articulo_nombre, cantidad, accion')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .eq('reserva_id', reservaActiva.id);

    if (errHist) {
      console.error('Error consultando historial de artículos prestados:', errHist);
      // Continuamos aunque haya error de consulta, por seguridad
    }

    // Calculamos saldo por artículo
    const saldoPorArticulo = {};
    (historialArticulos || []).forEach((h) => {
      const nombre = h.articulo_nombre || 'Artículo';
      const cant = Number(h.cantidad || 0);
      if (!saldoPorArticulo[nombre]) saldoPorArticulo[nombre] = 0;

      if (h.accion === 'prestado') {
        saldoPorArticulo[nombre] += cant;
      } else if (h.accion === 'devuelto') {
        saldoPorArticulo[nombre] -= cant;
      }
    });

    const articulosPendientes = Object.entries(saldoPorArticulo)
      .filter(([_, saldo]) => saldo > 0);

    if (articulosPendientes.length > 0) {
      const listaHTML = articulosPendientes
        .map(([nombre, saldo]) => `• ${nombre} x${saldo}`)
        .join('<br>');

      await Swal.fire({
        icon: 'warning',
        title: 'Artículos prestados pendientes',
        html: `
          Esta habitación tiene artículos prestados que aún no se han devuelto:<br><br>
          ${listaHTML}<br><br>
          Registra la devolución antes de liberar la habitación.
        `
      });
      btn.innerHTML = originalText;
      btn.disabled = false;
      return; // 🔒 NO se libera
    }

    // 3. Calcular saldo REAL
    const { totalDeTodosLosCargos, saldoPendiente } =
      await calcularSaldoReserva(supabase, reservaActiva.id, hotelId);

    const margen = 50; // margen en pesos para redondeos

    if (totalDeTodosLosCargos > 0 && saldoPendiente > margen) {
      // 🔒 NO PERMITIR LIBERAR CON SALDO
      await Swal.fire({
        icon: 'warning',
        title: 'Saldo pendiente',
        html: `
          La habitación tiene un saldo pendiente de
          <b>$ ${formatCOP(saldoPendiente)}</b>.<br><br>
          Por favor cobra el saldo desde "Ver consumos" antes de liberar la habitación.
        `
      });
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    // 4. Confirmar liberación (saldo = 0 y sin artículos pendientes)
    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: 'Liberar habitación',
      text: 'El saldo está en $0 y no hay artículos prestados pendientes. ¿Deseas liberar la habitación ahora?',
      showCancelButton: true,
      confirmButtonText: 'Sí, liberar',
      cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    const ahoraISO = new Date().toISOString();

    // 5. Cerrar reserva: estado finalizada
    await supabase.from('reservas')
      .update({
        estado: 'finalizada',
        fecha_fin: ahoraISO,
        monto_pagado: totalDeTodosLosCargos,
        actualizado_en: ahoraISO
      })
      .eq('id', reservaActiva.id);

    // 6. Detener cronómetro
    await supabase.from('cronometros')
      .update({ activo: false, fecha_fin: ahoraISO })
      .eq('habitacion_id', room.id)
      .eq('reserva_id', reservaActiva.id);

    // 7. Pasar habitación a estado "limpieza"
    await supabase.from('habitaciones')
      .update({ estado: 'limpieza', actualizado_en: ahoraISO })
      .eq('id', room.id);

    // 8. Registrar en bitácora (opcional)
    // ... tu lógica de bitácora ...

    // 9. Cerrar modal y recargar
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
    await renderRooms(mainAppContainer, supabase, currentUser, hotelId);

    await Swal.fire({
      icon: 'success',
      title: 'Habitación liberada',
      text: 'La habitación se ha pasado a estado Limpieza.',
      timer: 1500,
      showConfirmButton: false
    });

  } catch (e) {
    console.error('Error general al liberar la habitación:', e);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Ocurrió un error al liberar la habitación.'
    });
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
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


/**
 * Crea las opciones del select de horas usando el ID como valor único
 */
function crearOpcionesHoras(tiempos) {
    if (!tiempos || tiempos.length === 0) {
        return '<option value="">-- Sin tarifas disponibles --</option>';
    }
    
    // Filtramos para que no salgan tiempos de 0 minutos o tipo 'noche' si no corresponde
    const opciones = tiempos
        .filter(t => t.tipo_unidad !== 'noche' && t.minutos > 0)
        .map(t => {
            // CAMBIO IMPORTANTE: Usamos t.id en el value, no t.nombre
            return `<option value="${t.id}" data-precio="${t.precio}">${t.nombre} - ${formatCurrency(t.precio)}</option>`;
        });

    if (opciones.length === 0) {
         return '<option value="">-- No aplica --</option>';
    }

    return ['<option value="">-- Selecciona duración --</option>', ...opciones].join('');
}

function calcularDetallesEstancia(dataForm, room, tiempos, horarios, descuentoAplicado) {
  let inicioAt = new Date();
  let finAt;

  let montoEstanciaBaseBruto = 0; // antes de descuento
  let montoDescuento = 0;
  let descripcionEstancia = 'Seleccione duración';
  let tipoCalculo = null;
  let cantidadCalculo = 0;
  let precioFinalAntesDeImpuestos = 0;

  const nochesSeleccionadas = dataForm.noches ? parseInt(dataForm.noches, 10) : 0;

  // ✅ dataForm.horas puede venir como UUID (id) o como minutos ("120") o "-1"
  const horasValor = (dataForm.horas ?? '').toString().trim();

  let minutosSeleccionados = 0;
  let tiempoSeleccionado = null;

  if (horasValor) {
    // Si es número (minutos o -1)
    if (/^-?\d+$/.test(horasValor)) {
      minutosSeleccionados = parseInt(horasValor, 10);
      if (minutosSeleccionados > 0) {
        tiempoSeleccionado =
          tiempos.find((t) => Number(t.minutos) === minutosSeleccionados) || null;
      }
    } else {
      // Si NO es número, es UUID -> buscamos por id
      tiempoSeleccionado = tiempos.find((t) => t.id == horasValor) || null;
      minutosSeleccionados = Number(tiempoSeleccionado?.minutos) || 0;
    }
  }

  const tiempoEstanciaId = tiempoSeleccionado?.id || null;

  const cantidadHuespedes = Math.max(1, parseInt(dataForm.cantidad_huespedes, 10) || 1);
  const precioAdicionalPorPersona = Number(room.precio_huesped_adicional) || 0;

  const precioLibreActivado = dataForm.precio_libre_toggle === 'on';
  const precioLibreValor = parseFloat(dataForm.precio_libre_valor) || 0;

  // Helper: calcular fin por noches usando checkout
  const calcularFinPorNoches = (inicio, noches, checkoutStr) => {
    const fechaSalida = new Date(inicio);
    fechaSalida.setDate(fechaSalida.getDate() + noches);
    const [h, m] = (checkoutStr || '12:00').split(':').map(Number);
    fechaSalida.setHours(h || 0, m || 0, 0, 0);
    return fechaSalida;
  };

  // 1) PRECIO MANUAL
  if (precioLibreActivado) {
    montoEstanciaBaseBruto = precioLibreValor;
    precioFinalAntesDeImpuestos = precioLibreValor;
    descripcionEstancia = `Estancia (Precio Manual: ${formatCurrency(precioLibreValor)})`;
    tipoCalculo = 'manual';
    cantidadCalculo = precioLibreValor;

    // Fechas para cronómetro
    if (nochesSeleccionadas > 0) {
      finAt = calcularFinPorNoches(inicioAt, nochesSeleccionadas, horarios.checkout);
    } else if (minutosSeleccionados > 0) {
      finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
    } else if (minutosSeleccionados === -1) {
      // duración abierta
      finAt = new Date(inicioAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
    } else {
      finAt = new Date(inicioAt);
    }
  } else {
    // 2) CÁLCULO NORMAL

    // NOCHES
    if (nochesSeleccionadas > 0) {
      tipoCalculo = 'noches';
      cantidadCalculo = nochesSeleccionadas;
      finAt = calcularFinPorNoches(inicioAt, nochesSeleccionadas, horarios.checkout);
      descripcionEstancia = `${nochesSeleccionadas} Noche(s)`;

      // Precio base (NOCHES):
// 1) Si manejas precio_1_persona / precio_2_personas, se usan.
// 2) Si están en 0 o vacíos, se usa room.precio como respaldo (precio clásico por noche).
const precioNocheRespaldo = Number(room.precio) || 0;

let precioNocheBase = Number(room.precio_2_personas) || precioNocheRespaldo;
if (cantidadHuespedes === 1) {
  precioNocheBase = Number(room.precio_1_persona) || precioNocheRespaldo || precioNocheBase;
}


      let totalNoche = precioNocheBase * nochesSeleccionadas;
      if (cantidadHuespedes > 2) {
        totalNoche += ((cantidadHuespedes - 2) * precioAdicionalPorPersona) * nochesSeleccionadas;
      }
      montoEstanciaBaseBruto = totalNoche;
    }
    // HORAS
    else if (minutosSeleccionados > 0) {
      tipoCalculo = 'horas';
      cantidadCalculo = minutosSeleccionados;
      finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
      descripcionEstancia = tiempoSeleccionado?.nombre || formatHorasMin(minutosSeleccionados);

      // precio desde tiempos_estancia
      let precioTiempo = Number(tiempoSeleccionado?.precio) || 0;

      // fallback: si no trae precio, usa precio_base_hora de la habitación
      if (!precioTiempo) {
        const baseHora = Number(room.precio_base_hora) || 0;
        if (baseHora > 0) {
          precioTiempo = (minutosSeleccionados / 60) * baseHora;
        }
      }

      // extra por persona (>2)
      if (cantidadHuespedes > 2) {
        precioTiempo += (cantidadHuespedes - 2) * precioAdicionalPorPersona;
      }

      montoEstanciaBaseBruto = precioTiempo;
    }
    // ABIERTA (-1)
    else if (minutosSeleccionados === -1) {
      tipoCalculo = 'abierta';
      cantidadCalculo = 0;
      finAt = new Date(inicioAt.getTime() + 100 * 365 * 24 * 60 * 60 * 1000);
      descripcionEstancia = 'Duración Abierta';
      montoEstanciaBaseBruto = 0;
    } else {
      finAt = new Date(inicioAt);
    }

    // DESCUENTO
    const totalAntesDeDescuento = montoEstanciaBaseBruto;

    if (descuentoAplicado && totalAntesDeDescuento > 0) {
      const val = Number(descuentoAplicado.valor) || 0;
      if (descuentoAplicado.tipo === 'porcentaje') {
        montoDescuento = (totalAntesDeDescuento * val) / 100;
      } else {
        montoDescuento = val;
      }
      montoDescuento = Math.min(montoDescuento, totalAntesDeDescuento);
    }

    precioFinalAntesDeImpuestos = totalAntesDeDescuento - montoDescuento;
  }

  // IMPUESTOS
  const porcentajeImpuesto = Number(hotelConfigGlobal?.porcentaje_impuesto_principal) || 0;
  const impuestosIncluidos = hotelConfigGlobal?.impuestos_incluidos_en_precios === true;

  let montoImpuesto = 0;
  let baseSinImpuesto = precioFinalAntesDeImpuestos;

  if (porcentajeImpuesto > 0 && precioFinalAntesDeImpuestos > 0 && tipoCalculo !== 'abierta') {
    const tasa = porcentajeImpuesto / 100;
    if (impuestosIncluidos) {
      baseSinImpuesto = precioFinalAntesDeImpuestos / (1 + tasa);
      montoImpuesto = precioFinalAntesDeImpuestos - baseSinImpuesto;
    } else {
      montoImpuesto = precioFinalAntesDeImpuestos * tasa;
      baseSinImpuesto = precioFinalAntesDeImpuestos;
    }
  }

  const precioFinalConImpuestos = impuestosIncluidos
    ? precioFinalAntesDeImpuestos
    : (precioFinalAntesDeImpuestos + montoImpuesto);

  const totalRedondeado =
    tipoCalculo === 'abierta'
      ? 0
      : (precioLibreActivado ? precioLibreValor : Math.round(precioFinalConImpuestos));

  return {
    inicioAt,
    finAt,
    precioBase: Math.round(montoEstanciaBaseBruto),
    montoDescontado: Math.round(montoDescuento),
    descuentoAplicado,
    montoImpuesto: Math.round(montoImpuesto),
    porcentajeImpuestos: porcentajeImpuesto,
    nombreImpuesto: hotelConfigGlobal?.nombre_impuesto_principal || 'IVA',
    montoBaseSinImpuestos: Math.round(baseSinImpuesto),
    precioTotal: totalRedondeado,
    descripcionEstancia,
    tipoCalculo,
    cantidadCalculo,
    tiempoEstanciaId,
    minutosSeleccionados
  };
}



// =========================================================================================
// FUNCIÓN MODIFICADA: "FACTURAR" AHORA IMPRIME TICKET POS (BYPASS ELECTRÓNICO)
// =========================================================================================
async function facturarElectronicaYMostrarResultado({
    supabase,
    hotelId,
    reserva,
    consumosTienda,
    consumosRest,
    consumosServicios,
    metodoPagoIdLocal
}) {
    console.log("Generando Factura POS Local (Bypass Electrónico)...");

    try {
        // 1. Cargar Configuración del Hotel (para tamaño papel y logos)
        const { data: config } = await supabase
            .from('configuracion_hotel')
            .select('*')
            .eq('hotel_id', hotelId)
            .maybeSingle();

        // 2. Preparar los Ítems para el Ticket
        const itemsParaTicket = [];

        // A. Ítem de Estancia (Alojamiento)
        if (reserva && typeof reserva.monto_total === 'number' && reserva.monto_total > 0) {
            itemsParaTicket.push({
                nombre: `Alojamiento: ${reserva.habitacion_nombre || 'Habitación'}`,
                cantidad: 1,
                precioUnitario: reserva.monto_total,
                total: reserva.monto_total
            });
        }

        // B. Agregar Consumos (Tienda, Restaurante, Servicios)
        const todosLosConsumos = [
            ...(consumosTienda || []),
            ...(consumosRest || []),
            ...(consumosServicios || [])
        ];

        todosLosConsumos.forEach(item => {
            if (item.cantidad > 0 || item.subtotal > 0) {
                itemsParaTicket.push({
                    nombre: item.nombre || 'Consumo',
                    cantidad: item.cantidad || 1,
                    precioUnitario: item.cantidad > 0 ? (item.subtotal / item.cantidad) : item.subtotal,
                    total: item.subtotal
                });
            }
        });

        // 3. Calcular Totales
        const totalFactura = itemsParaTicket.reduce((sum, i) => sum + i.total, 0);
        
        // Obtenemos lo pagado. Si el objeto reserva no lo tiene actualizado, intentamos usar el totalFactura
        // asumiendo que si le dieron a "Facturar" es porque ya cobraron.
        // O mejor, mostramos lo que viene en la reserva.
        const totalPagado = reserva.monto_pagado || 0; 

        // 4. Construir objeto de datos para la función de impresión
        const datosTicket = {
            cliente: {
                nombre: reserva.cliente_nombre || 'Cliente General',
                documento: reserva.cedula || ''
            },
            reservaId: reserva.id,
            habitacionNombre: reserva.habitacion_nombre || '',
            items: itemsParaTicket,
            total: totalFactura,
            totalPagado: totalPagado,
            // Si quieres mostrar impuestos desglosados (opcional, aquí simplificado):
            impuestos: 0, 
            descuento: reserva.monto_descontado || 0,
            subtotal: totalFactura // Simplificado
        };

        // 5. LLAMAR A LA FUNCIÓN DE IMPRESIÓN POS (La misma que usas en caja.js)
        imprimirFacturaPosAdaptable(config, datosTicket);

        // Retornamos éxito para que el modal de uiUtils se cierre o muestre éxito
        return { success: true, mensaje: "Ticket generado correctamente" };

    } catch (err) {
        console.error("Error generando ticket POS:", err);
        return { success: false, error: err.message };
    }
}





async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) { console.error("Contenedor de modal no encontrado."); return; }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let descuentoAplicado = null; 

    // Obtención de datos iniciales
    let horarios, tiempos, metodosPagoDisponibles;
    try {
        [horarios, tiempos, metodosPagoDisponibles] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
    } catch (err) {
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler.", "Error de Carga");
        return;
    }
    
    // --- CORRECCIÓN 1: Filtramos los tiempos según el tipo de habitación (Aire vs Ventilador) ---
    const tipoHab = (room.tipo || 'aire').toLowerCase();
    const tiemposFiltrados = tiempos.filter(t => {
        // Asumimos que t.tipo_habitacion puede ser 'aire', 'ventilador' o 'ambas'
        const tipoTarifa = (t.tipo_habitacion || 'ambas').toLowerCase();
        return (tipoTarifa === 'ambas' || tipoTarifa === tipoHab) && t.minutos > 0;
    });

    metodosPagoDisponibles.unshift({ id: "mixto", nombre: "Pago Mixto" });
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, room);
    
    // No usamos crearOpcionesHoras aquí para tener control total del mapeo con ID en el HTML

    // HTML del Modal
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
                        
                        <select name="horas" id="select-horas" class="form-control">
                            <option value="">-- Horas --</option>
                            ${tiemposFiltrados.map(t => `<option value="${t.id}">${t.nombre} - ${formatCurrency(t.precio)}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="pt-2 mt-2 border-t">
                    <label class="flex items-center gap-2 cursor-pointer mt-2"><input type="checkbox" id="precio_libre_toggle_alquiler" name="precio_libre_toggle" class="form-checkbox h-5 w-5 text-indigo-600"><span class="font-semibold text-sm text-indigo-700">Asignar Precio Manual</span></label>
                    <div id="precio_libre_container_alquiler" class="mt-2" style="display:none;"><label for="precio_libre_valor_alquiler" class="font-semibold text-sm text-gray-700">Valor Total Estancia</label><input type="number" id="precio_libre_valor_alquiler" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0"></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div>
                        <label class="form-label">Cant. Huéspedes*</label>
                        <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" value="2" required>
                    </div>
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
    
    // Referencias
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
    
    // FUNCIÓN DE CÁLCULO
    const recalcularYActualizarTotalAlquiler = async (codigoManual = null) => {
        const formData = Object.fromEntries(new FormData(formEl));
        const clienteId = formData.cliente_id || null;
        const codigo = codigoManual === null ? codigoInputEl.value.trim().toUpperCase() : codigoManual;
        
        // --- CORRECCIÓN 3: Lógica para obtener tarifa por ID ---
        const horasIdSeleccionado = formData.horas; // Esto ahora es un ID (string)
        let minutosSeleccionados = 0;
        let tarifaEspecifica = null;

        if (horasIdSeleccionado) {
            // Buscamos la tarifa exacta usando el ID
            tarifaEspecifica = tiempos.find(t => t.id == horasIdSeleccionado);
            if (tarifaEspecifica) {
                minutosSeleccionados = tarifaEspecifica.minutos;
            }
        }

        const nochesSeleccionadas = parseInt(formData.noches) || 0; 
        
        // Si no hay noches y seleccionamos horas, usamos los minutos de la tarifa encontrada
        // Si tarifaEspecifica es null, asumimos 0
        
        const esDuracionAbierta = false; // Ajusta según tu lógica si tienes tarifas "abiertas"
        
        if (esDuracionAbierta) {
            selectNochesEl.value = ''; selectNochesEl.disabled = true;
            togglePrecioLibreEl.checked = false; togglePrecioLibreEl.disabled = true;
            containerPrecioLibreEl.style.display = 'none';
            metodoPagoWrapper.style.display = 'none'; formEl.elements.metodo_pago_id.required = false;
            descuentoWrapper.style.display = 'none'; codigoInputEl.value = '';
            btnAlquilar.textContent = "Registrar Entrada";
            feedbackDescuentoAlquilerEl.textContent = ''; descuentoAplicado = null;
        } else {
            selectNochesEl.disabled = false; togglePrecioLibreEl.disabled = false;
            metodoPagoWrapper.style.display = 'block'; formEl.elements.metodo_pago_id.required = true;
            descuentoWrapper.style.display = 'block'; btnAlquilar.textContent = "Confirmar y Registrar";
            containerPrecioLibreEl.style.display = togglePrecioLibreEl.checked ? 'block' : 'none';

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
        
        // Pasamos los datos a la función auxiliar
        // NOTA: Como formData.horas ahora tiene un ID, si calcularDetallesEstancia espera minutos, 
        // debemos tener cuidado. Sin embargo, lo más seguro es FORZAR el precio correcto abajo.
        const detalles = calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado); 
        
        // --- CORRECCIÓN 4: Forzamos el precio correcto si se eligió tarifa por ID ---
        // Esto arregla el problema de que calcularDetallesEstancia se confunda con los nombres
        if (tarifaEspecifica && !nochesSeleccionadas && !togglePrecioLibreEl.checked) {
            detalles.precioBase = tarifaEspecifica.precio;
            // Recalculamos el total basándonos en el precio base correcto
            detalles.precioTotal = detalles.precioBase - (detalles.montoDescontado || 0) + (detalles.montoImpuesto || 0);
            detalles.descripcionEstancia = tarifaEspecifica.nombre; // Aseguramos el nombre correcto
        }

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

    // --- LISTENERS ---
    
    selectNochesEl.addEventListener('change', async () => { if (selectNochesEl.value) { selectHorasEl.value = ''; } await recalcularYActualizarTotalAlquiler(); });
    selectHorasEl.addEventListener('change', async () => { if (selectHorasEl.value) { selectNochesEl.value = ''; } await recalcularYActualizarTotalAlquiler(); });
    
    const cantidadHuespedesEl = modalContainer.querySelector('#cantidad_huespedes');
    if (cantidadHuespedesEl) {
        cantidadHuespedesEl.addEventListener('input', async () => {
            await recalcularYActualizarTotalAlquiler();
        });
    }

    const precioLibreValorEl = modalContainer.querySelector('#precio_libre_valor_alquiler');
    if (precioLibreValorEl) {
        precioLibreValorEl.addEventListener('input', async () => { await recalcularYActualizarTotalAlquiler(); });
    }
    
    togglePrecioLibreEl.addEventListener('change', async () => { await recalcularYActualizarTotalAlquiler(); });
    modalContainer.querySelector('#btn-aplicar-descuento-alquiler').onclick = async () => { await recalcularYActualizarTotalAlquiler(); };
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
    
    // Submit
    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = formEl.querySelector('#btn-alquilar-hab');
        submitBtn.disabled = true;
        submitBtn.textContent = "Procesando...";
        try {
            const formData = Object.fromEntries(new FormData(formEl));
            const detallesFinales = calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado);
            
            // --- CORRECCIÓN 5: Aplicar la corrección de precio también al enviar ---
            const horasIdSeleccionado = formData.horas;
            if (horasIdSeleccionado && !formData.noches && !formData.precio_libre_toggle) {
                const tarifaEspecifica = tiempos.find(t => t.id == horasIdSeleccionado);
                if (tarifaEspecifica) {
                    detallesFinales.precioBase = tarifaEspecifica.precio;
                    detallesFinales.precioTotal = detallesFinales.precioBase - (detallesFinales.montoDescontado || 0);
                    // Importante: asegurarnos que 'minutos' sean correctos para la fecha de salida
                    detallesFinales.duracionMinutos = tarifaEspecifica.minutos;
                }
            }

            if (!formData.cliente_nombre.trim()) throw new Error("El nombre del huésped es obligatorio.");
            if (detallesFinales.tipoCalculo === null && formData.precio_libre_toggle !== 'on') throw new Error("Debe seleccionar una duración válida.");
            
            const totalCostoEstancia = detallesFinales.precioTotal;
            const metodoPagoId = formData.metodo_pago_id;
            
            if (detallesFinales.tipoCalculo === 'abierta' || totalCostoEstancia <= 0) {
                 await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [], room, supabase, currentUser, hotelId, mainAppContainer });
            } else if (metodoPagoId === "mixto") {
                showPagoMixtoModal(totalCostoEstancia, metodosPagoDisponibles, async (pagosMixtos) => {
                    await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: pagosMixtos, room, supabase, currentUser, hotelId, mainAppContainer });
                });
            } else {
                await registrarReservaYMovimientosCaja({ formData, detallesEstancia: detallesFinales, pagos: [{ metodo_pago_id: metodoPagoId, monto: totalCostoEstancia }], room, supabase, currentUser, hotelId, mainAppContainer });
            }
        } catch (err) {
            mostrarInfoModalGlobal(err.message, "Error de Registro");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirmar y Registrar";
        }
    };
    
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





async function registrarReservaYMovimientosCaja({
  formData,
  detallesEstancia,
  pagos,
  room,
  supabase,
  currentUser,
  hotelId,
  mainAppContainer
}) {
  // Helpers seguros para UI (por si alguna función no existe)
  const showError = (msg) => {
    console.error(msg);
    if (typeof mostrarErrorModalGlobal === "function") {
      mostrarErrorModalGlobal(msg, "Error");
    } else if (typeof mostrarInfoModalGlobal === "function") {
      mostrarInfoModalGlobal(msg, "Error");
    } else {
      alert(msg);
    }
  };

  try {
    // =========================
    // 0) VALIDACIONES BÁSICAS
    // =========================
    const clienteNombre = (formData?.cliente_nombre ?? "").toString().trim();
    if (!clienteNombre) throw new Error("Falta el nombre del cliente.");

    if (!detallesEstancia?.inicioAt || !detallesEstancia?.finAt) {
      throw new Error("No se pudo calcular la fecha de inicio/fin de la estancia.");
    }

    // Si es alquiler por horas, debe existir un cálculo válido
    if (detallesEstancia.tipoCalculo === "horas") {
      const minutos = Number(detallesEstancia.minutosSeleccionados || 0);
      if (minutos <= 0) throw new Error("Debe seleccionar una duración válida (minutos inválidos).");
    }

    const cantidadHuespedes = Math.max(1, parseInt(formData?.cantidad_huespedes, 10) || 1);

    // Normalizar pagos
    const pagosLimpios = Array.isArray(pagos)
      ? pagos
          .map((p) => ({
            monto: Number(p.monto) || 0,
            metodo_pago_id: p.metodo_pago_id || null
          }))
          .filter((p) => p.monto > 0 && p.metodo_pago_id)
      : [];

    const totalPagado = pagosLimpios.reduce((sum, p) => sum + p.monto, 0);

    // Si solo hay 1 pago, guardamos metodo_pago_id en la reserva
    const metodoPagoReserva = pagosLimpios.length === 1 ? pagosLimpios[0].metodo_pago_id : null;

    // =========================
    // 1) OBTENER / CREAR CLIENTE
    // =========================
    let clienteIdFinal = formData?.cliente_id || null;

    const cedula = (formData?.cedula ?? "").toString().trim() || null;
    const telefono = (formData?.telefono ?? "").toString().trim() || null;

    if (!clienteIdFinal) {
      const { data: nuevoCliente, error: errCliente } = await supabase
        .from("clientes")
        .insert({
          hotel_id: hotelId,
          nombre: clienteNombre,
          documento: cedula,
          telefono: telefono
        })
        .select("id")
        .single();

      if (errCliente) throw new Error(`Error al crear el nuevo cliente: ${errCliente.message}`);
      clienteIdFinal = nuevoCliente.id;
    }

    // =========================
    // 2) NOTAS (incluye precio manual)
    // =========================
    let notasFinales = formData?.notas ? formData.notas.toString().trim() : null;

    if (formData?.precio_libre_toggle === "on") {
      const precioManual = Number(formData?.precio_libre_valor) || 0;
      const precioManualStr = `[PRECIO MANUAL: ${formatCurrency(precioManual)}]`;
      notasFinales = notasFinales ? `${precioManualStr} ${notasFinales}` : precioManualStr;
    }

    // =========================
    // 3) CREAR RESERVA PRINCIPAL
    // =========================
    const reservaInsert = {
      hotel_id: hotelId,
      habitacion_id: room.id,
      cliente_id: clienteIdFinal,
      cliente_nombre: clienteNombre,
      cedula: cedula,
      telefono: telefono,

      // ✅ IMPORTANTÍSIMO: guardar el tiempo elegido (si existe)
      tiempo_estancia_id: detallesEstancia?.tiempoEstanciaId || null,

      fecha_inicio: detallesEstancia.inicioAt.toISOString(),
      fecha_fin: detallesEstancia.finAt.toISOString(),

      cantidad_huespedes: cantidadHuespedes,

      monto_total: Number(detallesEstancia?.precioTotal) || 0,
      monto_pagado: totalPagado,

      metodo_pago_id: metodoPagoReserva,

      estado: "ocupada",
      tipo_duracion: detallesEstancia?.tipoCalculo || null,
      cantidad_duracion: Number(detallesEstancia?.cantidadCalculo) || 0,

      // Guardar base e impuestos correctamente
      monto_estancia_base: Number(detallesEstancia?.precioBase) || 0,
      monto_estancia_base_sin_impuestos:
        Number(detallesEstancia?.montoBaseSinImpuestos) || Number(detallesEstancia?.precioBase) || 0,
      monto_impuestos_estancia: Number(detallesEstancia?.montoImpuesto) || 0,
      porcentaje_impuestos_aplicado: detallesEstancia?.porcentajeImpuestos ?? null,
      nombre_impuesto_aplicado: detallesEstancia?.nombreImpuesto ?? null,

      descuento_aplicado_id: detallesEstancia?.descuentoAplicado?.id || null,
      monto_descontado: Number(detallesEstancia?.montoDescontado) || 0,

      usuario_id: currentUser.id,
      notas: notasFinales
    };

    const { data: nuevaReserva, error: errReserva } = await supabase
      .from("reservas")
      .insert(reservaInsert)
      .select()
      .single();

    if (errReserva) throw new Error("Error al crear la reserva: " + errReserva.message);

    // =========================
    // 4) POST-RESERVA
    // =========================
    if (nuevaReserva.descuento_aplicado_id) {
      await registrarUsoDescuento(supabase, nuevaReserva.descuento_aplicado_id);
    }

    // Actualizar habitación
    const { error: errHab } = await supabase
      .from("habitaciones")
      .update({ estado: "ocupada" })
      .eq("id", room.id);

    if (errHab) throw new Error(`Reserva creada, pero error al actualizar habitación: ${errHab.message}`);

    // Crear cronómetro
    const { error: errCrono } = await supabase.from("cronometros").insert({
      hotel_id: hotelId,
      reserva_id: nuevaReserva.id,
      habitacion_id: room.id,
      fecha_inicio: nuevaReserva.fecha_inicio,
      fecha_fin: nuevaReserva.fecha_fin,
      activo: true
    });

    if (errCrono) throw new Error(`Reserva creada, pero error al crear cronómetro: ${errCrono.message}`);

    // Turno activo
    const turnoId = turnoService.getActiveTurnId
      ? turnoService.getActiveTurnId()
      : (await turnoService.getTurnoAbierto(supabase, currentUser.id, hotelId))?.id;

    if (!turnoId) {
      console.warn("No hay turno activo: se creó la reserva pero no se registró pago en caja.");
    } else if (pagosLimpios.length > 0) {
      // =========================
      // 5) PAGOS: pagos_reserva -> caja
      // =========================
      const pagosParaInsertar = pagosLimpios.map((p) => ({
        hotel_id: hotelId,
        reserva_id: nuevaReserva.id,
        monto: p.monto,
        fecha_pago: new Date().toISOString(),
        metodo_pago_id: p.metodo_pago_id,
        usuario_id: currentUser.id,
        concepto: `Alquiler Inicial Hab. ${room.nombre} (${detallesEstancia?.descripcionEstancia || ""})`
      }));

      const { data: pagosData, error: errPagoRes } = await supabase
        .from("pagos_reserva")
        .insert(pagosParaInsertar)
        .select("id");

      if (errPagoRes) {
        throw new Error(`Reserva creada, pero error al guardar pagos_reserva: ${errPagoRes.message}`);
      }

      // Caja (asumimos mismo orden del insert)
      const movimientosCaja = pagosLimpios.map((p, index) => ({
        hotel_id: hotelId,
        tipo: "ingreso",
        monto: p.monto,
        concepto: `Alquiler Hab. ${room.nombre} (${detallesEstancia?.descripcionEstancia || ""})`,
        fecha_movimiento: new Date().toISOString(),
        metodo_pago_id: p.metodo_pago_id,
        usuario_id: currentUser.id,
        reserva_id: nuevaReserva.id,
        turno_id: turnoId,
        pago_reserva_id: pagosData?.[index]?.id || null
      }));

      const { error: errCaja } = await supabase.from("caja").insert(movimientosCaja);
      if (errCaja) throw new Error(`Reserva creada, pero error al registrar movimiento en caja: ${errCaja.message}`);
    }

    // =========================
    // 6) FINALIZAR UI
    // =========================
    const modalContainer = document.getElementById("modal-container");
    if (modalContainer) {
      modalContainer.style.display = "none";
      modalContainer.innerHTML = "";
    }

    mostrarInfoModalGlobal("¡Habitación alquilada con éxito!", "Alquiler Registrado");
    await renderRooms(mainAppContainer, supabase, currentUser, hotelId);

    return nuevaReserva; // útil por si la llamas desde otro lado
  } catch (err) {
    showError(err.message || "Ocurrió un error inesperado.");
    throw err;
  }
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

            // === CÓDIGO DE AUTO-CORRECCIÓN MEJORADO ===
            if (reservaError || !reservaActiva) {
                 console.warn(`Inconsistencia detectada hab ${room.id}. Estado: ${room.estado} pero sin reserva activa.`);
                 
                 // OPCIÓN A: Mostrar mensaje visualmente
                 if(cronometroDiv) {
                    cronometroDiv.innerHTML = `<span class="text-xs text-gray-400 font-bold">⚠ Error Datos</span>`;
                 }

                 // OPCIÓN B (Más agresiva): Auto-corregir en base de datos a 'limpieza' automáticamente
                 /* await supabase.from('habitaciones')
                    .update({ estado: 'limpieza' })
                    .eq('id', room.id);
                 */
                 
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

// ===================================================================
// GENERADOR DE HTML PARA FACTURA POS (ADAPTABLE)
// Poner esto al final de mapa-habitaciones.js
// ===================================================================
function imprimirFacturaPosAdaptable(config, datos) {
  // 1. Detectar configuración de papel
  let tamano = (config?.tamano_papel || '80mm').toLowerCase();
  const esTermica = tamano === '58mm' || tamano === '80mm';
  
  // Ajustes de ancho y fuente
  const widthPage = tamano === '58mm' ? '58mm' : (tamano === '80mm' ? '74mm' : '100%');
  const fontSize = tamano === '58mm' ? '10px' : (tamano === '80mm' ? '11px' : '12px');
  // En impresoras térmicas, el width 100% a veces falla, mejor fixed mm. En carta usamos 800px max.
  const containerMaxWidth = esTermica ? '100%' : '800px'; 

  // 2. Datos del Encabezado
  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || 'Hotel';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let telefono = config?.telefono_fiscal || '';
  let pie = config?.pie_ticket || 'Gracias por su visita.';
  let resolucion = config?.encabezado_ticket_l1 || ''; 

  // 3. Datos del Cliente y Reserva
  const clienteNombre = datos.cliente?.nombre || 'Consumidor Final';
  const clienteDoc = datos.cliente?.documento || '';
  const fechaEmision = new Date().toLocaleString('es-CO');
  const reservaId = datos.reservaId ? datos.reservaId.split('-')[0].toUpperCase() : '---';
  const habitacion = datos.habitacionNombre || 'General';

  // 4. CSS
  let style = `
    @page { margin: ${esTermica ? '0' : '15mm'}; size: auto; }
    body { 
        font-family: 'Courier New', Courier, monospace; 
        font-size: ${fontSize}; 
        margin: 0; 
        padding: ${esTermica ? '2px' : '20px'}; 
        width: ${esTermica ? widthPage : 'auto'}; 
        color: #000;
        background: #fff;
    }
    .container { width: 100%; max-width: ${containerMaxWidth}; margin: 0 auto; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mb-1 { margin-bottom: 5px; }
    .border-bottom { border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }
    .border-top { border-top: 1px dashed #000; padding-top: 5px; margin-top: 5px; }
    
    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
    th { border-bottom: 1px solid #000; padding: 2px 0; font-size: 0.9em; text-align: left; }
    td { padding: 2px 0; vertical-align: top; }
    
    .col-cant { width: 15%; text-align: center; }
    .col-desc { width: 55%; text-align: left; }
    .col-total { width: 30%; text-align: right; }
    
    @media print { .no-print { display: none; } }
  `;

  // 5. HTML Contenido
  let headerHtml = `
    <div class="text-center mb-1">
      ${logoUrl ? `<img src="${logoUrl}" style="max-width: 50%; max-height: 60px; filter: grayscale(100%); margin-bottom:2px;">` : ''}
      <div class="bold" style="font-size: 1.1em;">${hotelNombre}</div>
      <div>NIT: ${nit}</div>
      <div>${direccion}</div>
      ${telefono ? `<div>Tel: ${telefono}</div>` : ''}
      ${resolucion ? `<div style="font-size:0.8em; margin-top:2px;">${resolucion}</div>` : ''}
    </div>
    
    <div class="border-bottom mb-1">
        <div class="bold text-center">FACTURA POS / CUENTA</div>
        <div style="display:flex; justify-content:space-between;"><span>F: ${fechaEmision}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Reserva: #${reservaId}</span></div>
        <div style="display:flex; justify-content:space-between;"><span>Hab: <b>${habitacion}</b></span></div>
    </div>

    <div class="border-bottom mb-1">
        <div><b>Cliente:</b> ${clienteNombre}</div>
        ${clienteDoc ? `<div><b>ID:</b> ${clienteDoc}</div>` : ''}
    </div>
  `;

  // Items
  let itemsHtml = '';
  if (datos.items && datos.items.length > 0) {
      const filas = datos.items.map(item => `
        <tr>
            <td class="col-cant">${item.cantidad}</td>
            <td class="col-desc">${item.nombre}</td>
            <td class="col-total">${formatCurrency(item.total)}</td>
        </tr>
      `).join('');
      itemsHtml = `<table><thead><tr><th class="col-cant">Cant</th><th class="col-desc">Desc</th><th class="col-total">Total</th></tr></thead><tbody>${filas}</tbody></table>`;
  } else {
      itemsHtml = '<div class="text-center">Sin ítems.</div>';
  }

  // Totales
  const total = datos.total || 0;
  const pagado = datos.totalPagado || 0;
  const saldo = total - pagado;

  let footerHtml = `
    <div class="border-top mt-2">
        <div style="display:flex; justify-content:space-between; font-size:1.1em;" class="bold">
            <span>TOTAL:</span><span>${formatCurrency(total)}</span>
        </div>
        ${pagado > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Pagado:</span><span>${formatCurrency(pagado)}</span></div>` : ''}
        ${saldo > 0 ? `<div style="display:flex; justify-content:space-between; color:red;" class="bold"><span>PENDIENTE:</span><span>${formatCurrency(saldo)}</span></div>` : ''}
        ${saldo <= 0 ? `<div class="text-center bold" style="margin-top:5px;">¡GRACIAS POR SU PAGO!</div>` : ''}
    </div>
    <div class="text-center mt-2" style="font-size:0.85em;">${pie}</div>
  `;

  let fullHtml = `<html><head><title>Imprimir</title><style>${style}</style></head><body><div class="container">${headerHtml}${itemsHtml}${footerHtml}</div><script>window.onload=function(){window.print();window.focus();}</script></body></html>`;

  let w = window.open('', '_blank', `width=${esTermica?400:800},height=600`);
  w.document.write(fullHtml);
  w.document.close();
}

// ===================================================================
// MODAL DE CONSUMOS LOCAL (Versión Detallada para Factura POS)
// ===================================================================
async function mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId) {
  const modalContainer = document.getElementById('modal-container');
  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = '<div class="text-white font-bold">Cargando consumos...</div>';

  const asNum = (v) => Number(v ?? 0);
  const asInt = (v) => Math.round(asNum(v));
  const money = (n) => (typeof formatCurrency === 'function'
    ? formatCurrency(asInt(n))
    : `$${asInt(n).toLocaleString('es-CO')}`);

  const hasSwal = typeof Swal !== 'undefined';
  const safeShowLoading = (msg) => (typeof showGlobalLoading === 'function' ? showGlobalLoading(msg) : null);
  const safeHideLoading = () => (typeof hideGlobalLoading === 'function' ? hideGlobalLoading() : null);

  const cerrarModal = () => {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
  };

  // ✅ Parse robusto de dinero: acepta "10000", "10.000", "10,000", "$ 10.000"
  const parseMoneyInput = (val) => {
    if (val === null || val === undefined) return 0;
    const s = String(val).trim();
    const digits = s.replace(/[^\d]/g, ''); // deja solo números
    return asInt(digits || 0);
  };

  async function obtenerTurnoActivoId() {
    if (typeof turnoService !== 'undefined' && typeof turnoService.getActiveTurnId === 'function') {
      const tid = turnoService.getActiveTurnId();
      if (tid) return tid;
    }
    const { data, error } = await supabase
      .from('turnos')
      .select('id')
      .eq('hotel_id', hotelId)
      .eq('usuario_id', user.id)
      .eq('estado', 'abierto')
      .order('fecha_apertura', { ascending: false })
      .limit(1);

    if (error) throw error;
    return data?.[0]?.id || null;
  }

  async function getTotalPagadoDb() {
    const { data, error } = await supabase
      .from('pagos_reserva')
      .select('monto')
      .eq('reserva_id', reserva.id);

    if (error) throw error;
    return asInt((data || []).reduce((s, p) => s + asInt(p.monto), 0));
  }

  async function elegirMetodoPagoId() {
    const { data: metodos, error } = await supabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', hotelId)
      .eq('activo', true);

    if (error) throw error;
    if (!metodos || metodos.length === 0) throw new Error('No hay métodos de pago configurados.');

    if (!hasSwal) return metodos[0].id;

    const opciones = metodos.reduce((acc, curr) => ({ ...acc, [curr.id]: curr.nombre }), {});
    const { value } = await Swal.fire({
      title: 'Método de pago',
      input: 'select',
      inputOptions: opciones,
      inputPlaceholder: 'Seleccione...',
      showCancelButton: true
    });

    return value || null;
  }

  async function registrarPagoEnBD(monto, { liquidarTodo = false, deudaTotalActual = 0 } = {}) {
    const montoInt = asInt(monto);
    if (!montoInt || montoInt <= 0) throw new Error('Monto inválido.');

    const turnoId = await obtenerTurnoActivoId();
    if (!turnoId) throw new Error('No hay turno activo para registrar el pago en caja.');

    const metodoPagoId = await elegirMetodoPagoId();
    if (!metodoPagoId) return { cancelled: true };

    const concepto = liquidarTodo
      ? `Pago total saldo Hab. նոյ ${room.nombre}`
      : `Abono saldo Hab. ${room.nombre}`;

    safeShowLoading('Registrando pago...');

    const { data: pagoData, error: errPago } = await supabase
      .from('pagos_reserva')
      .insert({
        hotel_id: hotelId,
        reserva_id: reserva.id,
        monto: montoInt,
        metodo_pago_id: metodoPagoId,
        usuario_id: user.id,
        concepto
      })
      .select()
      .single();

    if (errPago) {
      safeHideLoading();
      throw errPago;
    }

    const { error: errCaja } = await supabase.from('caja').insert({
      hotel_id: hotelId,
      tipo: 'ingreso',
      monto: montoInt,
      concepto,
      metodo_pago_id: metodoPagoId,
      usuario_id: user.id,
      reserva_id: reserva.id,
      pago_reserva_id: pagoData.id,
      turno_id: turnoId
    });

    if (errCaja) {
      safeHideLoading();
      throw errCaja;
    }

    const totalPagadoDb = await getTotalPagadoDb();
    const nuevoMontoPagado = Math.min(asInt(deudaTotalActual), totalPagadoDb);

    const { error: errUpd } = await supabase
      .from('reservas')
      .update({ monto_pagado: nuevoMontoPagado })
      .eq('id', reserva.id);

    if (errUpd) {
      safeHideLoading();
      throw errUpd;
    }

    safeHideLoading();
    return { cancelled: false, pagoReservaId: pagoData.id };
  }

  async function marcarPendientesComoPagados(pagoReservaId) {
    await supabase
      .from('servicios_x_reserva')
      .update({ estado_pago: 'pagado', pago_reserva_id: pagoReservaId })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');

    await supabase
      .from('ventas_tienda')
      .update({ estado_pago: 'pagado' })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');

    await supabase
      .from('ventas_restaurante')
      .update({ estado_pago: 'pagado' })
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id)
      .neq('estado_pago', 'pagado');
  }

  async function cargarCuentaDetallada() {
    const serviciosRes = await supabase
      .from('servicios_x_reserva')
      .select('id, cantidad, precio_cobrado, estado_pago, descripcion_manual, servicio:servicios_adicionales(nombre)')
      .eq('reserva_id', reserva.id);

    if (serviciosRes.error) throw serviciosRes.error;
    const servicios = serviciosRes.data || [];

    const ventasTiendaRes = await supabase
      .from('ventas_tienda')
      .select('id, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id);

    if (ventasTiendaRes.error) throw ventasTiendaRes.error;
    const ventasTienda = ventasTiendaRes.data || [];
    const ventaTiendaIds = ventasTienda.map(v => v.id);

    let detallesTienda = [];
    if (ventaTiendaIds.length > 0) {
      const detTiendaRes = await supabase
        .from('detalle_ventas_tienda')
        .select('venta_id, cantidad, subtotal, producto:productos_tienda(nombre)')
        .in('venta_id', ventaTiendaIds);

      if (detTiendaRes.error) throw detTiendaRes.error;
      detallesTienda = detTiendaRes.data || [];
    }

    const ventasRestRes = await supabase
      .from('ventas_restaurante')
      .select('id, monto_total, total_venta, estado_pago')
      .eq('hotel_id', hotelId)
      .eq('reserva_id', reserva.id);

    if (ventasRestRes.error) throw ventasRestRes.error;
    const ventasRest = ventasRestRes.data || [];
    const ventaRestIds = ventasRest.map(v => v.id);

    let itemsRest = [];
    if (ventaRestIds.length > 0) {
      const itemsRestRes = await supabase
        .from('ventas_restaurante_items')
        .select('venta_id, cantidad, subtotal, plato:platos(nombre)')
        .in('venta_id', ventaRestIds);

      if (itemsRestRes.error) throw itemsRestRes.error;
      itemsRest = itemsRestRes.data || [];
    }

    const pagosRes = await supabase
      .from('pagos_reserva')
      .select('id, monto, fecha_pago')
      .eq('reserva_id', reserva.id);

    if (pagosRes.error) throw pagosRes.error;
    const pagos = pagosRes.data || [];

    const totalEstancia = asInt(reserva.monto_total);

    const totalServiciosPend = asInt(servicios.reduce((s, x) => {
      const pagado = (x.estado_pago || 'pendiente') === 'pagado';
      return s + (pagado ? 0 : asInt(x.precio_cobrado));
    }, 0));

    const totalTiendaPend = asInt(ventasTienda.reduce((s, v) => {
      const pagado = (v.estado_pago || 'pendiente') === 'pagado';
      return s + (pagado ? 0 : asInt(v.total_venta));
    }, 0));

    const totalRestPend = asInt(ventasRest.reduce((s, v) => {
      const pagado = (v.estado_pago || 'pendiente') === 'pagado';
      const totalCab = asInt(v.monto_total ?? v.total_venta);
      return s + (pagado ? 0 : totalCab);
    }, 0));

    const deudaTotal = asInt(totalEstancia + totalServiciosPend + totalTiendaPend + totalRestPend);
    const totalPagado = asInt(pagos.reduce((s, p) => s + asInt(p.monto), 0));
    const saldo = Math.max(0, asInt(deudaTotal - totalPagado));

    const mapTiendaEstado = Object.fromEntries(ventasTienda.map(v => [v.id, (v.estado_pago || 'pendiente')]));
    const mapRestEstado = Object.fromEntries(ventasRest.map(v => [v.id, (v.estado_pago || 'pendiente')]));

    return {
      servicios,
      ventasTienda,
      detallesTienda,
      mapTiendaEstado,
      ventasRest,
      itemsRest,
      mapRestEstado,
      pagos,
      totalEstancia,
      deudaTotal,
      totalPagado,
      saldo
    };
  }

  try {
    const cuenta = await cargarCuentaDetallada();

    const listaItems = [];

    listaItems.push({
      tipo: 'Hospedaje',
      detalle: `Estancia Hab. ${room.nombre}`,
      cant: 1,
      subtotal: cuenta.totalEstancia,
      estado: 'PENDIENTE'
    });

    (cuenta.servicios || []).forEach(s => {
      const nombre = s?.servicio?.nombre || s.descripcion_manual || 'Servicio';
      const pagado = (s.estado_pago || 'pendiente') === 'pagado';
      listaItems.push({
        tipo: 'Servicio',
        detalle: nombre,
        cant: asInt(s.cantidad) || 1,
        subtotal: asInt(s.precio_cobrado),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    (cuenta.detallesTienda || []).forEach(d => {
      const estadoVenta = (cuenta.mapTiendaEstado?.[d.venta_id] || 'pendiente');
      const pagado = estadoVenta === 'pagado';
      listaItems.push({
        tipo: 'Tienda',
        detalle: d?.producto?.nombre || 'Producto Tienda',
        cant: asInt(d.cantidad) || 1,
        subtotal: asInt(d.subtotal),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    (cuenta.itemsRest || []).forEach(it => {
      const estadoVenta = (cuenta.mapRestEstado?.[it.venta_id] || 'pendiente');
      const pagado = estadoVenta === 'pagado';
      listaItems.push({
        tipo: 'Restaurante',
        detalle: it?.plato?.nombre || 'Plato',
        cant: asInt(it.cantidad) || 1,
        subtotal: asInt(it.subtotal),
        estado: pagado ? 'PAGADO' : 'PENDIENTE'
      });
    });

    const rowsHtml = listaItems.map(item => {
      const badge = item.estado === 'PAGADO'
        ? `<span class="text-xs px-2 py-1 rounded bg-green-100 text-green-700 font-bold">PAGADO</span>`
        : `<span class="text-xs px-2 py-1 rounded bg-red-100 text-red-700 font-bold">PENDIENTE</span>`;
      return `
        <tr class="border-b border-gray-100 hover:bg-gray-50">
          <td class="p-2 text-xs text-gray-500 uppercase tracking-wide">${item.tipo}</td>
          <td class="p-2 text-sm font-semibold text-gray-800 flex items-center justify-between gap-2">
            <span>${item.detalle}</span>
            ${badge}
          </td>
          <td class="p-2 text-sm text-center text-gray-600">${item.cant}</td>
          <td class="p-2 text-sm text-right font-bold text-gray-700">${money(item.subtotal)}</td>
        </tr>
      `;
    }).join('');

    const tieneSaldo = cuenta.saldo > 0;

    modalContainer.innerHTML = `
      <div class="bg-white rounded-lg shadow-xl w-full max-w-2xl overflow-hidden animate-fade-in-up flex flex-col max-h-[85vh]">
        <div class="bg-gray-50 px-6 py-4 border-b flex justify-between items-center flex-shrink-0">
          <div>
            <h3 class="text-lg font-bold text-gray-800">Detalle de Cuenta: ${room.nombre}</h3>
            <p class="text-sm text-gray-500">Cliente: <strong>${reserva.cliente_nombre || 'N/A'}</strong></p>
          </div>
          <button id="btn-cerrar-local" class="text-gray-400 hover:text-red-500 text-2xl transition">&times;</button>
        </div>

        <div class="p-0 overflow-y-auto flex-grow custom-scrollbar">
          <table class="w-full text-left border-collapse">
            <thead class="bg-blue-50 text-blue-800 uppercase text-xs sticky top-0 shadow-sm">
              <tr>
                <th class="p-3 font-semibold">Origen</th>
                <th class="p-3 font-semibold">Descripción</th>
                <th class="p-3 text-center font-semibold">Cant.</th>
                <th class="p-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>

        <div class="bg-gray-50 px-6 py-4 border-t flex-shrink-0">
          <div class="flex justify-end flex-col items-end space-y-1 mb-4 border-b border-gray-200 pb-2">
            <div class="text-sm text-gray-600">Deuda Total (pendiente):
              <span class="font-bold text-gray-900">${money(cuenta.deudaTotal)}</span>
            </div>
            <div class="text-sm text-green-600">Pagos aplicados:
              <span class="font-bold">${money(cuenta.totalPagado)}</span>
            </div>
          </div>

          <div class="flex justify-between items-center">
            <div class="text-xl ${cuenta.saldo > 0 ? 'text-red-600' : 'text-blue-600'}">
              Saldo: <span class="font-bold">${money(cuenta.saldo)}</span>
            </div>

            <div class="flex gap-3">
              ${tieneSaldo ? `
                <button id="btn-abonar-saldo-local" class="button button-warning px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                  ➕ Abonar
                </button>
                <button id="btn-pagar-saldo-local" class="button button-info px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                  💳 Pagar todo
                </button>
              ` : ''}

              <button id="btn-imprimir-pos-local" class="button button-success px-5 py-2 shadow-lg flex items-center gap-2 hover:scale-105 transition transform">
                Imprimir Factura
              </button>

              <button id="btn-cerrar-local-2" class="button button-neutral px-4 py-2">Cerrar</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-cerrar-local')?.addEventListener('click', cerrarModal);
    document.getElementById('btn-cerrar-local-2')?.addEventListener('click', cerrarModal);

    // ✅ PAGAR TODO
    document.getElementById('btn-pagar-saldo-local')?.addEventListener('click', async () => {
      try {
        const cuentaActual = await cargarCuentaDetallada();
        if (cuentaActual.saldo <= 0) {
          if (hasSwal) await Swal.fire('Info', 'Esta cuenta ya está saldada.', 'info');
          return mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
        }

        if (hasSwal) {
          const conf = await Swal.fire({
            title: 'Confirmar pago',
            text: `¿Deseas pagar TODO el saldo (${money(cuentaActual.saldo)})?`,
            icon: 'question',
            showCancelButton: true,
            confirmButtonText: 'Sí, pagar todo',
            cancelButtonText: 'Cancelar'
          });
          if (!conf.isConfirmed) return;
        }

        const resPago = await registrarPagoEnBD(cuentaActual.saldo, {
          liquidarTodo: true,
          deudaTotalActual: cuentaActual.deudaTotal
        });
        if (resPago?.cancelled) return;

        await marcarPendientesComoPagados(resPago.pagoReservaId);

        if (hasSwal) await Swal.fire('Listo', 'Pago registrado. Saldo en 0.', 'success');
        await mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
      } catch (e) {
        console.error(e);
        safeHideLoading();
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo registrar el pago.', 'error');
      }
    });

    // ✅ ABONAR (ARREGLADO: input TEXT + parse, sin error de step)
    document.getElementById('btn-abonar-saldo-local')?.addEventListener('click', async () => {
      try {
        const cuentaActual = await cargarCuentaDetallada();
        if (cuentaActual.saldo <= 0) {
          if (hasSwal) await Swal.fire('Info', 'Esta cuenta ya está saldada.', 'info');
          return mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
        }

        let montoAbono = 0;

        if (hasSwal) {
          const { value } = await Swal.fire({
            title: 'Abonar a la deuda',
            html: `Saldo actual: <b>${money(cuentaActual.saldo)}</b><br>¿Cuánto desea abonar? (Ej: 10000 o 10.000)`,
            input: 'text',
            inputValue: String(Math.min(cuentaActual.saldo, 10000)),
            inputAttributes: {
              inputmode: 'numeric',
              autocapitalize: 'off',
              autocomplete: 'off',
              autocorrect: 'off',
              spellcheck: 'false'
            },
            showCancelButton: true,
            confirmButtonText: 'Registrar abono',
            cancelButtonText: 'Cancelar',
            preConfirm: (val) => {
              const n = parseMoneyInput(val);
              if (!n || n <= 0) return Swal.showValidationMessage('Ingresa un monto válido.');
              if (n > cuentaActual.saldo) return Swal.showValidationMessage('El abono no puede ser mayor al saldo.');
              return n;
            }
          });

          if (!value) return;
          montoAbono = asInt(value);
        } else {
          montoAbono = Math.min(cuentaActual.saldo, 10000);
        }

        const resPago = await registrarPagoEnBD(montoAbono, {
          liquidarTodo: false,
          deudaTotalActual: cuentaActual.deudaTotal
        });
        if (resPago?.cancelled) return;

        if (hasSwal) await Swal.fire('Listo', `Abono registrado: ${money(montoAbono)}`, 'success');
        await mostrarModalConsumosLocal(room, reserva, supabase, user, hotelId);
      } catch (e) {
        console.error(e);
        safeHideLoading();
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo registrar el abono.', 'error');
      }
    });

    // IMPRIMIR (igual que antes)
    document.getElementById('btn-imprimir-pos-local')?.addEventListener('click', async () => {
      try {
        if (typeof imprimirFacturaPosAdaptable !== 'function') {
          if (hasSwal) return Swal.fire('Error', 'No existe imprimirFacturaPosAdaptable().', 'error');
          return;
        }

        const { data: config, error } = await supabase
          .from('configuracion_hotel')
          .select('*')
          .eq('hotel_id', hotelId)
          .maybeSingle();

        if (error) throw error;

        const datosParaImprimir = {
          cliente: {
            nombre: reserva.cliente_nombre,
            documento: reserva.cedula || reserva.cliente_cedula || ''
          },
          reservaId: reserva.id,
          habitacionNombre: room.nombre,
          items: listaItems.map(i => ({
            nombre: `${i.detalle} (${i.estado})`,
            cantidad: i.cant,
            total: i.subtotal,
            precioUnitario: i.cant > 0 ? asInt(i.subtotal / i.cant) : 0
          })),
          total: cuenta.deudaTotal,
          totalPagado: cuenta.totalPagado,
          impuestos: 0,
          descuento: asInt(reserva.monto_descontado),
          subtotal: cuenta.deudaTotal
        };

        imprimirFacturaPosAdaptable(config || {}, datosParaImprimir);
      } catch (e) {
        console.error(e);
        if (hasSwal) Swal.fire('Error', e.message || 'No se pudo imprimir.', 'error');
      }
    });

  } catch (error) {
    console.error('Error en mostrarModalConsumosLocal:', error);
    modalContainer.innerHTML = `
      <div class="bg-white p-4 rounded text-red-600">
        Error cargando consumos: ${error.message || error}
        <button id="btn-cerrar-error" class="ml-4 underline">Cerrar</button>
      </div>
    `;
    document.getElementById('btn-cerrar-error')?.addEventListener('click', cerrarModal);
  }
}

// ===================== FIN DEL ARCHIVO =====================