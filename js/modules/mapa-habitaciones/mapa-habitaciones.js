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
import { formatCurrency, showError, registrarUsoDescuento } from '../../uiUtils.js';

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
    const audio = new Audio('js/assets/notificacion.mp3'); // O la ruta correcta a tu archivo mp3
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
async function buscarDescuentoParaAlquiler(supabase, hotelId, clienteId, habitacionId, codigoManual = null) {
    if (!habitacionId && !codigoManual && !clienteId) return null;

    const ahora = new Date().toISOString();
    let query = supabase.from('descuentos').select('*')
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

    const orConditions = ['tipo_descuento_general.eq.automatico'];
    if (codigoManual) {
        orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`);
    }
    if (clienteId) {
        orConditions.push(`cliente_id.eq.${clienteId}`);
    }
    query = query.or(orConditions.join(','));

    const { data: descuentosPotenciales, error } = await query;
    if (error) {
        console.error("Error buscando descuentos de alquiler:", error);
        return null;
    }

    const descuentosValidos = descuentosPotenciales.filter(d => (d.usos_maximos || 0) === 0 || (d.usos_actuales || 0) < d.usos_maximos);

    // Prioridad: por cliente > por código > automáticos
    if (clienteId) {
        const descuentoCliente = descuentosValidos.find(d => d.cliente_id === clienteId);
        if (descuentoCliente) return descuentoCliente;
    }
    if (codigoManual) {
        const descuentoCodigo = descuentosValidos.find(d => d.codigo && d.codigo.toUpperCase() === codigoManual.toUpperCase());
        if (descuentoCodigo) return descuentoCodigo;
    }
    for (const descuento of descuentosValidos) {
        const aplicabilidad = descuento.aplicabilidad;
        if (aplicabilidad === 'reserva_total') return descuento;
        if (aplicabilidad === 'habitaciones_especificas' && habitacionId && descuento.habitaciones_aplicables?.includes(habitacionId)) {
            return descuento;
        }
    }
    return null;
}


async function imprimirTicketHabitacion({ supabase, hotelId, datosTicket, tipoDocumento }) {
  // 1. Leer configuración de impresora
  const { data: config } = await supabase
    .from('configuracion_hotel')
    .select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, pie_ticket, mostrar_logo')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  // 2. Decidir el ancho/tipo
  let tamano = (config?.tamano_papel || '').toLowerCase();
  let tipo = (config?.tipo_impresora || '').toLowerCase();

  // --- Datos del ticket (ajusta según tus necesidades)
  const {
    habitacion,
    cliente,
    fechaIngreso,
    fechaSalida,
    consumos, // array [{nombre, cantidad, precio, total}]
    totalConsumo,
    otrosDatos // opcional
  } = datosTicket;

  // --- Estilos y HTML base según impresora ---
  let style = '';
  let anchoMax = '100%';
  if (tamano === '58mm') {
    anchoMax = '55mm'; style = `
      body{font-family:monospace;font-size:11px;max-width:55mm;margin:0;padding:0;}
      .ticket{max-width:55mm;margin:auto;}
      table{width:100%;font-size:11px;}
      th,td{padding:2px 2px;}
      .title{font-size:13px;}
      .linea{border-bottom:1px dashed #444;margin:3px 0;}
    `;
  } else if (tamano === '80mm') {
    anchoMax = '78mm'; style = `
      body{font-family:monospace;font-size:13px;max-width:78mm;margin:0;padding:0;}
      .ticket{max-width:78mm;margin:auto;}
      table{width:100%;font-size:13px;}
      th,td{padding:3px 2px;}
      .title{font-size:17px;}
      .linea{border-bottom:1px dashed #444;margin:4px 0;}
    `;
  } else {
    anchoMax = '850px'; style = `
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:15px;max-width:850px;margin:0 auto;}
      .ticket{max-width:850px;margin:auto;}
      table{width:100%;font-size:15px;}
      th,td{padding:6px 5px;}
      .title{font-size:22px;}
      .linea{border-bottom:1px solid #ccc;margin:10px 0;}
    `;
  }

  // --- HTML ticket --- (ajusta aquí tu template según lo que imprimas: factura, consumo, etc)
let html = ''; // Inicializar vacía

  if (tipoDocumento === 'Recibo de Pago') {
    const {
        habitacion,
        cliente,
        fechaPago,
        montoPagado,
        metodoPagoNombre,
        conceptoPago,
        // usuarioNombre, // Lo incluiremos en otrosDatos si es necesario
        // transaccionId, // Lo incluiremos en otrosDatos si es necesario
        otrosDatos // Recibirá: `Reserva ID: XXXXX<br>Atendido por: YYYYY`
    } = datosTicket;

    html = `
        <div class="ticket">
            ${config?.mostrar_logo !== false && config?.logo_url ? `<div style="text-align:center;margin-bottom:4px;"><img src="${config.logo_url}" style="max-width:45mm;max-height:30px; object-fit:contain;"></div>` : ''}
            <div class="title" style="text-align:center;font-weight:bold; margin-bottom:3px;">${config?.nombre_hotel || ''}</div>
            <div style="text-align:center;font-size:0.9em;">
                ${config?.direccion_fiscal || ''}
                ${config?.nit_rut ? `<br/>NIT/RUT: ${config.nit_rut}` : ''}
                ${config?.razon_social ? `<br/>${config.razon_social}` : ''}
                ${config?.telefono_fiscal ? `<br/>Tel: ${config.telefono_fiscal}` : ''}
            </div>
            ${config?.encabezado_ticket_l1 || config?.encabezado_ticket_l2 || config?.encabezado_ticket_l3 ? 
                `<div style="text-align:center;margin:3px 0 5px 0;font-size:0.9em;">
                    ${config.encabezado_ticket_l1 || ''}
                    ${config.encabezado_ticket_l2 ? `<br>${config.encabezado_ticket_l2}` : ''}
                    ${config.encabezado_ticket_l3 ? `<br>${config.encabezado_ticket_l3}` : ''}
                </div>` : (config?.encabezado_ticket ? `<div style="text-align:center;margin:2px 0 5px 0;font-size:0.9em;">${config.encabezado_ticket}</div>` : '')
            }
            <div class="linea"></div>
            <div style="font-size:1.1em; text-align:center; font-weight:bold; margin: 3px 0;">RECIBO DE PAGO</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Fecha y Hora:</b> ${formatDateTime(fechaPago)}</div>
            <div style="font-size:0.95em;"><b>Cliente:</b> ${cliente || "N/A"}</div>
            <div style="font-size:0.95em;"><b>Habitación:</b> ${habitacion || "N/A"}</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Concepto:</b> ${conceptoPago || "Pago Varios"}</div>
            <div style="font-size:0.95em;"><b>Método de Pago:</b> ${metodoPagoNombre || "N/A"}</div>
            <div class="linea"></div>
            <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                TOTAL PAGADO: ${formatCurrency(montoPagado || 0)}
            </div>
            ${otrosDatos ? `<div style="margin-top:5px;font-size:0.9em;">${otrosDatos}</div>` : ''}
            <div class="linea"></div>
            ${config?.pie_ticket ? `<div style="text-align:center;margin-top:6px;font-size:0.9em;">${config.pie_ticket}</div>` : ''}
            <div style="text-align:center;font-size:0.8em;margin-top:8px;">Documento no fiscal. Comprobante de pago interno.</div>
        </div>
    `;
  } else { // Lógica existente para 'Ticket de Consumo' o cualquier otro tipo por defecto
      const {
          habitacion,
          cliente,
          fechaIngreso,
          fechaSalida,
          consumos,
          totalConsumo,
          otrosDatos: otrosDatosConsumo // Renombrar para evitar colisión
      } = datosTicket;

      html = `
          <div class="ticket">
            ${config?.mostrar_logo !== false && config?.logo_url ? `<div style="text-align:center;margin-bottom:4px;"><img src="${config.logo_url}" style="max-width:45mm;max-height:30px; object-fit:contain;"></div>` : ''}
            <div class="title" style="text-align:center;font-weight:bold; margin-bottom:3px;">${config?.nombre_hotel || ''}</div>
            <div style="text-align:center;font-size:0.9em;">
                ${config?.direccion_fiscal || ''}
                ${config?.nit_rut ? `<br/>NIT/RUT: ${config.nit_rut}` : ''}
                ${config?.razon_social ? `<br/>${config.razon_social}` : ''}
                ${config?.telefono_fiscal ? `<br/>Tel: ${config.telefono_fiscal}` : ''}
            </div>
            ${config?.encabezado_ticket_l1 || config?.encabezado_ticket_l2 || config?.encabezado_ticket_l3 ? 
                `<div style="text-align:center;margin:3px 0 5px 0;font-size:0.9em;">
                    ${config.encabezado_ticket_l1 || ''}
                    ${config.encabezado_ticket_l2 ? `<br>${config.encabezado_ticket_l2}` : ''}
                    ${config.encabezado_ticket_l3 ? `<br>${config.encabezado_ticket_l3}` : ''}
                </div>` : (config?.encabezado_ticket ? `<div style="text-align:center;margin:2px 0 5px 0;font-size:0.9em;">${config.encabezado_ticket}</div>` : '')
            }
            <div class="linea"></div>
            <div style="font-size:1.1em; text-align:center; font-weight:bold; margin: 3px 0;">${tipoDocumento || "Ticket de Consumo"}</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Habitación:</b> ${habitacion || ""}</div>
            <div style="font-size:0.95em;"><b>Cliente:</b> ${cliente || ""}</div>
            ${fechaIngreso ? `<div style="font-size:0.95em;"><b>Ingreso:</b> ${formatDateTime(fechaIngreso)}</div>` : ""}
            ${fechaSalida ? `<div style="font-size:0.95em;"><b>Salida:</b> ${formatDateTime(fechaSalida)}</div>` : ""}

            ${(consumos && consumos.length > 0) ? `
              <div class="linea"></div>
              <table>
                <thead>
                  <tr><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th></tr>
                </thead>
                <tbody>
                  ${(consumos).map(item => `
                    <tr>
                      <td>${item.nombre || ""}</td>
                      <td style="text-align:center;">${item.cantidad || ""}</td>
                      <td style="text-align:right;">${formatCurrency(item.precio || 0)}</td>
                      <td style="text-align:right;">${formatCurrency(item.total || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <div class="linea"></div>
              <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                TOTAL CONSUMO: ${formatCurrency(totalConsumo || 0)}
              </div>
            ` : (totalConsumo && tipoDocumento !== 'Recibo de Pago' ? `
                <div class="linea"></div>
                 <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                    TOTAL: ${formatCurrency(totalConsumo || 0)}
                </div>
            ` : '')}
            ${otrosDatosConsumo ? `<div style="margin-top:5px;font-size:0.9em;">${otrosDatosConsumo}</div>` : ''}
            <div class="linea"></div>
            ${config?.pie_ticket ? `<div style="text-align:center;margin-top:6px;font-size:0.9em;">${config.pie_ticket}</div>` : ''}
          </div>
        `;
  }
  // --- Ventana de impresión ---
  let w = window.open('', '', `width=400,height=700`);
  w.document.write(`
    <html>
      <head>
        <title>${tipoDocumento || 'Ticket'}</title>
        <style>
          ${style}
          @media print { .no-print {display:none;} }
        </style>
      </head>
      <body>
        ${html}
      </body>
    </html>
  `);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
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
        .select('*, reservas(estado, fecha_inicio)')
        .eq('hotel_id', hotelId)
        .order('nombre', { ascending: true });

    if (error) {
        gridEl.innerHTML = `<div class="col-span-full text-red-600 p-4 bg-red-100 rounded-md">Error: ${error.message}</div>`;
        return;
    }

    currentRooms = habitaciones;
    
    // El contenedor principal para refrescar es el grid de las habitaciones (gridEl)
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
        // --- CORRECCIÓN AQUÍ ---
        // Se pasa 'mainAppContainer' (que ahora es gridEl) a la función roomCard.
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

  // Botón "Alquilar Ahora" solo si está libre (¡con lógica para bloquear por reservas próximas!)
  if (room.estado === "libre") {
    botonesHtml += `<button id="btn-alquilar-directo" class="button button-primary w-full mb-2 py-2.5">Alquilar Ahora</button>`;
  }

  // Botones para habitación ocupada, reservada o con tiempo agotado
  else if (room.estado === "ocupada" || room.estado === "reservada" || room.estado === "tiempo agotado") {
    botonesHtml += `<button id="btn-extender-tiempo" class="button w-full mb-2 py-2.5" style="background:#a21caf;color:white;">Extender Tiempo</button>`;
    botonesHtml += `<button id="btn-entregar" class="button w-full mb-2 py-2.5" style="background:#06b6d4;color:white;">Entregar Habitación</button>`;
    botonesHtml += `<button id="btn-ver-consumos" class="button w-full mb-2 py-2.5" style="background:#0ea5e9;color:white;">Ver Consumos</button>`;
    botonesHtml += `<button id="btn-cambiar-habitacion" class="button w-full mb-2 py-2.5" style="background:#6366f1;color:white;">Cambiar de Habitación</button>`;

 }
if (["ocupada", "tiempo agotado"].includes(room.estado)) {
      botonesHtml += `<button id="btn-servicios-adicionales" class="button w-full mb-2 py-2.5" style="background:#84cc16;color:white;"><span style="font-size:1.2em">🛎️</span> Servicios adicionales</button>`;
  }

  // Botón mantenimiento
  if (["libre", "ocupada", "tiempo agotado", "limpieza", "reservada"].includes(room.estado)) {
    botonesHtml += `<button id="btn-mantenimiento" class="button w-full mb-2 py-2.5" style="background:#ff5100;font-weight:bold;color:white;"><span style="font-size:1.2em">🛠️</span> Enviar a Mantenimiento</button>`;
  }

  // Botón de check-in para reservas activas que ya puedan ingresar
let reservaFutura = null;
if (room.estado === "reservada") {
  // Buscar la reserva activa para esta habitación
  const { data, error } = await supabase
    .from('reservas')
    .select('*')
    .eq('habitacion_id', room.id)
    .eq('estado', 'reservada')
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();

  if (!error && data) {
    reservaFutura = data;
    const fechaInicio = new Date(reservaFutura.fecha_inicio);
    const ahora = new Date();
    const diferenciaMin = (fechaInicio - ahora) / (60 * 1000); // minutos

    // Permitir check-in si falta 120 minutos o menos (2 horas), o si ya pasó la fecha de inicio
    if (diferenciaMin <= 120) {
      botonesHtml += `<button id="btn-checkin-reserva" class="button w-full mb-2 py-2.5" style="background:#059669;color:white;font-weight:bold;"><span style="font-size:1.2em">✅</span> Check-in ahora</button>`;
    } else {
      botonesHtml += `<div class="text-center text-xs text-gray-500 mb-2"><span style="font-size:1.1em">⏳</span> Check-in habilitado desde: ${new Date(fechaInicio.getTime() - 2 * 60 * 60 * 1000).toLocaleString('es-CO')} (2 horas antes)</div>`;
    }
    // Info del huésped en la reserva
    botonesHtml += `
      <div class="bg-gray-50 rounded p-2 mb-2 text-xs">
        <b>Reserva:</b> ${reservaFutura.cliente_nombre} <br>
        <b>Tel:</b> ${reservaFutura.telefono} <br>
        <b>Huéspedes:</b> ${reservaFutura.cantidad_huespedes} <br>
        <b>Llegada:</b> ${fechaInicio.toLocaleString('es-CO')}
      </div>
    `;
  } else {
    botonesHtml += `<div class="text-xs text-red-500 mb-2">No se encontró la reserva activa para check-in.</div>`;
  }
}


  // Botón info huésped si no está libre ni en mantenimiento
  if (room.estado !== "libre" && room.estado !== "mantenimiento") {
    botonesHtml += `<button id="btn-info-huesped" class="button w-full mb-2 py-2.5" style="background:#475569;color:white;">Ver Info Huésped</button>`;
  }

  botonesHtml += `<button id="close-modal-acciones" class="button w-full mt-3 py-2.5" style="background:#ef4444;color:white;">Cerrar</button>`;

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
  modalCambioContent.querySelector('#btnConfirmarCambioHabitacion').onclick = async () => {
    const selectNuevaHabitacionEl = modalCambioContent.querySelector('#selectNuevaHabitacion');
    const motivoCambioEl = modalCambioContent.querySelector('#motivoCambio');
    const btnConfirmarEl = modalCambioContent.querySelector('#btnConfirmarCambioHabitacion');

    const habitacionDestinoId = selectNuevaHabitacionEl.value;
    const motivo = motivoCambioEl.value.trim();

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

    try {
      // Busca la reserva activa de la habitación ORIGEN
      const { data: reservasActivas, error: errReservaActiva } = await supabaseGlobal
        .from('reservas')
        .select('id')
        .eq('habitacion_id', room.id) // room.id es la habitación origen
        .in('estado', ['activa', 'ocupada', 'tiempo agotado']) // Incluir tiempo agotado por si acaso
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .single();

      if (errReservaActiva || !reservasActivas) {
        throw new Error(errReservaActiva?.message || "No se encontró una reserva activa para la habitación origen.");
      }
      const reservaIdActual = reservasActivas.id;

      // Actualiza la reserva con la nueva habitación_id
      const { error: errUpdateReserva } = await supabaseGlobal.from('reservas')
        .update({ habitacion_id: habitacionDestinoId })
        .eq('id', reservaIdActual);
      if (errUpdateReserva) throw new Error("Error actualizando la reserva: " + errUpdateReserva.message);

      // Actualiza el cronómetro asociado a la reserva si existe y está activo
      const { error: errUpdateCrono } = await supabaseGlobal.from('cronometros')
        .update({ habitacion_id: habitacionDestinoId })
        .eq('reserva_id', reservaIdActual)
        .eq('activo', true);
      if (errUpdateCrono) console.warn("Advertencia al actualizar cronómetro (puede que no exista activo):", errUpdateCrono.message);

      // Actualiza estados de las habitaciones
      const { error: errUpdateHabOrigen } = await supabaseGlobal.from('habitaciones')
        .update({ estado: 'limpieza' }) // La habitación origen queda en limpieza o libre
        .eq('id', room.id);
      if (errUpdateHabOrigen) throw new Error("Error actualizando habitación origen: " + errUpdateHabOrigen.message);

      const { error: errUpdateHabDestino } = await supabaseGlobal.from('habitaciones')
        .update({ estado: room.estado }) // La habitación destino toma el estado de la reserva (ocupada, activa, etc.)
        .eq('id', habitacionDestinoId);
      if (errUpdateHabDestino) throw new Error("Error actualizando habitación destino: " + errUpdateHabDestino.message);

      // Inserta el registro de cambio en la tabla 'cambios_habitacion'
      const { error: errLogCambio } = await supabaseGlobal.from('cambios_habitacion').insert([{
        hotel_id: hotelIdGlobal,
        reserva_id: reservaIdActual,
        habitacion_origen_id: room.id,
        habitacion_destino_id: habitacionDestinoId,
        motivo: motivo,
        usuario_id: currentUserGlobal.id, // Usar currentUserGlobal
        fecha: new Date().toISOString()
      }]);
      if (errLogCambio) console.warn("Advertencia al registrar el cambio de habitación en bitácora:", errLogCambio.message);

      // El modal de cambio ya está en modalContainerPrincipal, se reemplazará por el de éxito.
      mostrarInfoModalGlobal(
        "¡El cambio de habitación fue realizado exitosamente!",
        "Cambio Exitoso",
        [{ // Definimos un botón "Entendido" para el modal de éxito
            texto: "Entendido",
            clase: "button-primary", // O la clase que prefieras
            accion: async () => {
                // La función closeAndClean de mostrarInfoModalGlobal se encargará de cerrar este modal de éxito.
                // Luego recargamos las habitaciones.
                await renderRooms(mainAppContainer, supabaseGlobal, currentUserGlobal, hotelIdGlobal);
            }
        }],
        modalContainerPrincipal // Usamos el mismo contenedor principal para el mensaje de éxito
      );

    } catch (error) {
      console.error("Error en el proceso de cambio de habitación:", error);
      // El modal de cambio sigue visible, mostramos el error en un nuevo modal de información
      // que reemplazará al de cambio si usamos el mismo modalContainerPrincipal.
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
  }; // Fin onclick btnConfirmarCambioHabitacion
}); // Fin setupButtonListener btn-cambiar-habitacion
/**
 * Consulta todos los cargos pendientes de la reserva/habitación.
 * Bloquea entrega si hay alguna deuda pendiente.
 * Muestra un resumen de los pendientes si los hay.

/**
/**
 * REESCRITA Y CORREGIDA
 * Consulta el costo total REAL de todos los consumos y lo compara con el monto pagado en la reserva.
 * Muestra un modal profesional si hay deudas.
 * @param {object} supabase - Instancia de supabase.
 * @param {string} reservaId - UUID de la reserva activa.
 * @param {string} habitacionId - UUID de la habitación.
 * @returns {Promise<boolean>} true si puede entregar, false si no.
 */
async function validarCargosPendientesAntesDeEntregar(supabase, reservaId, habitacionId) {
    try {
        // 1. Obtener la reserva principal para saber el monto pagado y la estancia
        const { data: reserva, error: errRes } = await supabase.from('reservas').select('monto_total, monto_pagado').eq('id', reservaId).single();
        if (errRes) throw new Error(`No se pudo obtener la reserva principal: ${errRes.message}`);

        // 2. Obtener TODOS los cargos asociados, igual que en "Ver Consumos"
        const alojamientoCargo = { subtotal: Number(reserva.monto_total) || 0 };
        
        // Ventas de Tienda
        const { data: ventasTienda } = await supabase.from('ventas_tienda').select('id').eq('reserva_id', reservaId);
        let totalTienda = 0;
        if (ventasTienda && ventasTienda.length > 0) {
            const ventaTiendaIds = ventasTienda.map(v => v.id);
            const { data: detallesTienda } = await supabase.from('detalle_ventas_tienda').select('subtotal').in('venta_id', ventaTiendaIds);
            if (detallesTienda) {
                totalTienda = detallesTienda.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
            }
        }

        // Ventas de Restaurante
        const { data: ventasRest } = await supabase.from('ventas_restaurante').select('id').eq('reserva_id', reservaId);
        let totalRestaurante = 0;
        if (ventasRest && ventasRest.length > 0) {
            const ventaRestIds = ventasRest.map(v => v.id);
            const { data: detallesRest } = await supabase.from('ventas_restaurante_items').select('subtotal').in('venta_id', ventaRestIds);
            if (detallesRest) {
                totalRestaurante = detallesRest.reduce((sum, item) => sum + (Number(item.subtotal) || 0), 0);
            }
        }

        // Servicios Adicionales
        const { data: servicios } = await supabase.from('servicios_x_reserva').select('precio_cobrado').eq('reserva_id', reservaId);
        const totalServicios = servicios ? servicios.reduce((sum, item) => sum + (Number(item.precio_cobrado) || 0), 0) : 0;

        // 3. Calcular el total real de la deuda
        const totalDeTodosLosCargos = alojamientoCargo.subtotal + totalTienda + totalRestaurante + totalServicios;
        const totalPagado = Number(reserva.monto_pagado) || 0;
        const saldoPendiente = totalDeTodosLosCargos - totalPagado;

        // 4. Validar y mostrar el modal si es necesario
        if (saldoPendiente > 0.01) { // Usamos una pequeña tolerancia para evitar errores de redondeo
            const htmlPendientes = `
                <div class="text-left">
                    <p class="mb-3">No se puede finalizar la estancia porque la cuenta tiene un saldo pendiente de:</p>
                    <div class="text-center text-3xl font-bold text-red-600 my-4">${formatCurrency(saldoPendiente)}</div>
                    <p class="mt-4 font-semibold">Por favor, cobre el saldo total antes de entregar la habitación.</p>
                </div>
            `;
            
            mostrarInfoModalGlobal(htmlPendientes, "⚠️ Deuda Pendiente");
            return false; // No se puede entregar
        }

        // Si no hay deuda, se puede entregar
        return true;

    } catch (error) {
        console.error("Error en validarCargosPendientesAntesDeEntregar:", error);
        mostrarInfoModalGlobal(`Ocurrió un error al validar las deudas: ${error.message}`, "Error de Validación");
        return false; // Por seguridad, no permitir la entrega si hay un error
    }
}  // =================== BOTÓN ENTREGAR (igual que antes)
setupButtonListener('btn-entregar', async () => {
  let reservaActiva = null;
  for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
    const { data, error } = await supabase
      .from('reservas')
      .select('id, fecha_fin, fecha_inicio')
      .eq('habitacion_id', room.id)
      .eq('estado', estado)
      .order('fecha_inicio', { ascending: false })
      .limit(1);
    if (error && error.code !== 'PGRST116') {
      console.error("Error buscando reserva activa para entregar:", error);
      mostrarInfoModalGlobal("Error al buscar la reserva activa para entregar.", "Error");
      return;
    }
    if (data && data.length > 0) {
      reservaActiva = data[0];
      break;
    }
  }

  // ===== NUEVO BLOQUE: VALIDACIÓN DE PENDIENTES =====
  if (reservaActiva) {
    const reservaId = reservaActiva.id;
    // Validar cargos pendientes antes de entregar habitación
    const puedeEntregar = await validarCargosPendientesAntesDeEntregar(supabase, reservaId, room.id);
    if (!puedeEntregar) {
      // Si hay pendientes, NO continúa el flujo de entrega
      return;
    }
  }
  // ================================================

  if (reservaActiva) {
    await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', reservaActiva.id).eq('activo', true);
    await supabase.from('reservas').update({ estado: 'completada' }).eq('id', reservaActiva.id);
  } else {
    await supabase.from('cronometros').update({ activo: false }).eq('habitacion_id', room.id).eq('activo', true);
  }
  await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);
  modalContainer.style.display = "none";
  modalContainer.innerHTML = '';
  await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
});

  // =================== BOTÓN VER CONSUMOS (igual que antes)
   // Utilidades
const formatCurrency = val => Number(val || 0).toLocaleString('es-CO', { style: 'currency', currency: 'COP' });
const formatDateTime = d => new Date(d).toLocaleString('es-CO');

// =================== BOTÓN VER CONSUMOS Y FACTURAR ===================


// Asegúrate que estas variables y funciones estén accesibles en el scope:
// supabaseGlobal, currentUserGlobal, hotelIdGlobal, hotelConfigGlobal, mainAppContainer (para renderRooms)
// mostrarInfoModalGlobal, formatCurrency, formatDateTime, imprimirTicketHabitacion, facturarElectronicaYMostrarResultado, turnoService

// Asegúrate que estas variables y funciones estén accesibles en el scope:
// supabaseGlobal, currentUserGlobal, hotelIdGlobal, hotelConfigGlobal, mainAppContainer (para renderRooms)
// mostrarInfoModalGlobal, formatCurrency, formatDateTime, imprimirTicketHabitacion, facturarElectronicaYMostrarResultado, turnoService

// =================== BOTÓN VER CONSUMOS Y FACTURAR (CORREGIDO Y REFACTORIZADO) ===================

// Esta es la nueva función que contiene toda la lógica para mostrar los consumos.
// =================== BOTÓN VER CONSUMOS Y FACTURAR (CORREGIDO Y REFACTORIZADO) ===================

// Esta es la nueva función que contiene toda la lógica para mostrar los consumos.
async function showConsumosYFacturarModal(roomContext, supabase, currentUser, hotelId, mainAppContainer, initialButtonTrigger) {
    const modalContainerConsumos = document.getElementById('modal-container');
    if (!modalContainerConsumos) {
        console.error("El contenedor del modal principal 'modal-container' no se encontró.");
        return;
    }

    // --- Toda la lógica inicial para obtener los datos permanece sin cambios ---
    const { data: reserva, error: errRes } = await supabase.from('reservas').select('id, cliente_nombre, cedula, monto_total, fecha_inicio, fecha_fin, hotel_id, monto_pagado, habitacion_id, metodo_pago_id').eq('habitacion_id', roomContext.id).in('estado', ['activa', 'ocupada', 'tiempo agotado']).order('fecha_inicio', { ascending: false }).limit(1).single();
    if (errRes || !reserva) {
        mostrarInfoModalGlobal("No hay reserva activa con consumos para esta habitación.", "Consumos", [], modalContainerConsumos);
        return;
    }
    reserva.habitacion_nombre = roomContext.nombre;
    const alojamientoCargo = { tipo: "Habitación", nombre: "Estancia Principal", cantidad: 1, subtotal: Number(reserva.monto_total) || 0, id: "hab", estado_pago: "pendiente", fecha: reserva.fecha_inicio };
    let cargosTienda = [];
    const { data: ventasTiendaDB } = await supabase.from('ventas_tienda').select('id, creado_en').eq('reserva_id', reserva.id);
    if (ventasTiendaDB && ventasTiendaDB.length > 0) {
        const ventaTiendaIds = ventasTiendaDB.map(v => v.id);
        const { data: detallesTienda, error: errDetallesT } = await supabase.from('detalle_ventas_tienda').select('*, producto_id').in('venta_id', ventaTiendaIds);
        if (errDetallesT) { console.error("Error obteniendo detalles de tienda:", errDetallesT); }
        else if (detallesTienda && detallesTienda.length > 0) {
            const productoIds = [...new Set(detallesTienda.map(d => d.producto_id))];
            const { data: productos } = await supabase.from('productos_tienda').select('id, nombre').in('id', productoIds);
            const productosMap = new Map(productos?.map(p => [p.id, p.nombre]));
            cargosTienda = detallesTienda.map(item => {
                const ventaPadre = ventasTiendaDB.find(v => v.id === item.venta_id);
                return { tipo: "Tienda", nombre: productosMap.get(item.producto_id) || 'Producto', id: `dvt_${item.id}`, cantidad: item.cantidad, subtotal: Number(item.subtotal) || 0, estado_pago: "pendiente", fecha: ventaPadre?.creado_en };
            });
        }
    }
    let cargosRest = [];
    const { data: ventasRestDB } = await supabase.from('ventas_restaurante').select('id, creado_en').eq('reserva_id', reserva.id);
    if (ventasRestDB && ventasRestDB.length > 0) {
        const ventaRestIds = ventasRestDB.map(v => v.id);
        const { data: detallesRest, error: errDetallesR } = await supabase.from('ventas_restaurante_items').select('*, plato_id').in('venta_id', ventaRestIds);
        if (errDetallesR) { console.error("Error obteniendo detalles de restaurante:", errDetallesR); }
        else if (detallesRest) {
            const platoIds = [...new Set(detallesRest.map(d => d.plato_id))];
            const { data: platos } = await supabase.from('platos').select('id, nombre').in('id', platoIds);
            const platosMap = new Map(platos?.map(p => [p.id, p.nombre]));
            cargosRest = detallesRest.map(item => {
                const ventaPadre = ventasRestDB.find(v => v.id === item.venta_id);
                return { tipo: "Restaurante", nombre: platosMap.get(item.plato_id) || 'Plato', id: `dvr_${item.id}`, cantidad: item.cantidad, subtotal: Number(item.subtotal) || 0, estado_pago: "pendiente", fecha: ventaPadre?.creado_en };
            });
        }
    }
    const { data: serviciosYExtensiones } = await supabase.from('servicios_x_reserva').select('id, servicio_id, cantidad, nota, estado_pago, creado_en, precio_cobrado, pago_reserva_id, descripcion_manual').eq('reserva_id', reserva.id);
    let cargosServiciosYExtensiones = [];
    if (serviciosYExtensiones && serviciosYExtensiones.length) {
        const servicioIds = [...new Set(serviciosYExtensiones.map(s => s.servicio_id).filter(Boolean))];
        let nombresServicios = {};
        if (servicioIds.length > 0) {
            const { data: infoServicios } = await supabase.from('servicios_adicionales').select('id, nombre').in('id', servicioIds);
            if (infoServicios) { infoServicios.forEach(s => { nombresServicios[s.id] = s.nombre; }); }
        }
        cargosServiciosYExtensiones = serviciosYExtensiones.map(s => {
            let nombreItem = s.descripcion_manual || (s.servicio_id && nombresServicios[s.servicio_id]) || `Ítem #${s.id.slice(0,6)}`;
            let tipoItem = "Servicios";
            if (s.descripcion_manual && (s.descripcion_manual.toLowerCase().includes('extensi') || s.descripcion_manual.toLowerCase().includes('descuento'))) { 
                tipoItem = "Ajuste";
            }
            return { tipo: tipoItem, nombre: nombreItem, id: `sxr_${s.id}`, cantidad: s.cantidad || 1, subtotal: s.precio_cobrado !== null ? Number(s.precio_cobrado) : 0, estado_pago: s.estado_pago || "pendiente", fecha: s.creado_en, nota: s.nota || "" };
        });
    }
    
    let todosLosCargos = [alojamientoCargo, ...cargosTienda, ...cargosRest, ...cargosServiciosYExtensiones].filter(c => c.id === 'hab' || c.subtotal !== 0);
    const totalPagadoCalculado = Number(reserva.monto_pagado) || 0;
    todosLosCargos.sort((a, b) => { if (a.id === 'hab') return -1; if (b.id === 'hab') return 1; return new Date(a.fecha || 0) - new Date(b.fecha || 0); });
    let saldoAcumuladoParaAplicar = totalPagadoCalculado;
    todosLosCargos.forEach(cargo => { if (cargo.estado_pago === 'pagado') { return; } if (cargo.subtotal <= 0) { cargo.estado_pago = "N/A"; } else if (saldoAcumuladoParaAplicar >= cargo.subtotal) { cargo.estado_pago = "pagado"; saldoAcumuladoParaAplicar -= cargo.subtotal; } else if (saldoAcumuladoParaAplicar > 0 && saldoAcumuladoParaAplicar < cargo.subtotal) { cargo.estado_pago = "parcial"; saldoAcumuladoParaAplicar = 0; } else { cargo.estado_pago = "pendiente"; } });
    const totalDeTodosLosCargos = todosLosCargos.reduce((sum, c) => sum + Number(c.subtotal), 0);
    const saldoPendienteFinal = Math.max(0, totalDeTodosLosCargos - totalPagadoCalculado);
    
    // --- El HTML del modal principal no cambia ---
    let htmlConsumos = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:650px;margin:auto;" class="bg-white p-6 rounded-xl">
        <div class="flex justify-between items-center mb-3"><h3 style="font-size:1.3em;font-weight:bold;color:#1459ae;">🧾 Consumos: Hab. ${roomContext.nombre}</h3><button id="btn-cerrar-modal-consumos-X" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button></div>
        <div style="font-size:0.9em; margin-bottom:10px;">Cliente: <strong>${reserva.cliente_nombre}</strong></div>
        <div class="max-h-[50vh] overflow-y-auto pr-2 mb-4 border rounded-md">
            <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
                <thead class="sticky top-0 bg-slate-100 z-10"><tr style="background:#f1f5f9;"><th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Tipo</th><th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Detalle</th><th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;">Cant.</th><th style="padding:8px;text-align:right;border-bottom:1px solid #e2e8f0;">Subtotal</th><th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;">Estado</th></tr></thead>
                <tbody>${todosLosCargos.map(c => `<tr style="border-bottom:1px solid #e5e7eb;"><td style="padding:6px;">${c.tipo}</td><td style="padding:6px;">${c.nombre}${c.nota ? ` <i class="text-xs text-gray-500">(${c.nota})</i>` : ''}</td><td style="padding:6px;text-align:center;">${c.cantidad}</td><td style="padding:6px;text-align:right;">${formatCurrency(c.subtotal)}</td><td style="padding:6px;text-align:center;font-weight:bold;color:${{"pagado":"#16a34a","parcial":"#ca8a04","pendiente":"#dc2626","aplicado":"#16a34a"}[c.estado_pago] || "#6b7280"};">${c.estado_pago ? c.estado_pago.charAt(0).toUpperCase() + c.estado_pago.slice(1) : "N/A"}</td></tr>`).join('')}</tbody>
            </table>
        </div>
        <div style="margin-top:14px;font-size:1.1em; text-align:right; padding-right:10px;">
            <div style="font-weight:bold;color:#1e40af;">Total Cargos: ${formatCurrency(totalDeTodosLosCargos)}</div>
            <div style="font-weight:bold;color:#059669;">Total Pagado: ${formatCurrency(totalPagadoCalculado)}</div>
            <div style="font-weight:bold;color:${saldoPendienteFinal > 0 ? '#dc2626' : '#16a34a'};">Saldo Pendiente: ${formatCurrency(saldoPendienteFinal)}</div>
        </div>
        <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-end p-1">
            ${saldoPendienteFinal > 0 ? `<button id="btn-cobrar-pendientes-consumos" class="button button-warning py-2.5 px-5 text-sm">Cobrar Saldo (${formatCurrency(saldoPendienteFinal)})</button>` : `<div class="text-green-600 font-bold text-lg p-2 text-center">¡Todo saldado! ✅</div>`}
            ${totalDeTodosLosCargos > 0 ? `<button id="btn-facturar" class="button button-success py-2.5 px-5 text-sm">Facturar</button>` : ''}
            <button id="btn-cerrar-modal-consumos" class="button button-danger py-2.5 px-5 text-sm">Cerrar</button>
        </div>
    </div>`;

    modalContainerConsumos.innerHTML = htmlConsumos;
    modalContainerConsumos.style.display = "flex";
    
    setTimeout(() => {
        const modalDialogActual = modalContainerConsumos.querySelector('.bg-white');
        if (!modalDialogActual) { return; }

        const cerrarDesdeModal = () => { 
            modalContainerConsumos.style.display = "none"; 
            modalContainerConsumos.innerHTML = ''; 
        };
        modalDialogActual.querySelector('#btn-cerrar-modal-consumos-X').onclick = cerrarDesdeModal;
        modalDialogActual.querySelector('#btn-cerrar-modal-consumos').onclick = cerrarDesdeModal;
        
        // ========= INICIO DE LA MODIFICACIÓN: LÓGICA DE FACTURACIÓN DIRECTA A POS =========
        const btnFacturar = modalDialogActual.querySelector('#btn-facturar');
        if (btnFacturar) {
            btnFacturar.onclick = async () => {
                // 1. Validar que no haya saldo pendiente
                if (saldoPendienteFinal > 0) {
                    mostrarInfoModalGlobal(`No se puede facturar porque hay un saldo pendiente de <strong>${formatCurrency(saldoPendienteFinal)}</strong>.`, "Saldo Pendiente", [], modalContainerConsumos);
                    return;
                }
                
                // 2. Ejecutar directamente la lógica para imprimir la Factura POS
                try {
                    btnFacturar.disabled = true;
                    btnFacturar.textContent = "Generando...";

                    const consumosParaTicket = todosLosCargos.map(c => ({ nombre: c.nombre, cantidad: c.cantidad, precio: c.cantidad > 0 ? (c.subtotal / c.cantidad) : c.subtotal, total: c.subtotal }));
                    const datosParaTicketCompleto = { habitacion: roomContext.nombre, cliente: reserva.cliente_nombre, fechaIngreso: reserva.fecha_inicio, fechaSalida: reserva.fecha_fin, consumos: consumosParaTicket, totalConsumo: totalDeTodosLosCargos, otrosDatos: `Atendido por: ${currentUser?.email || 'Sistema'}<br>Total Pagado: ${formatCurrency(totalPagadoCalculado)}` };
                    
                    await imprimirTicketHabitacion({ 
                        supabase: supabase, 
                        hotelId: reserva.hotel_id, 
                        datosTicket: datosParaTicketCompleto, 
                        tipoDocumento: 'Factura POS' 
                    });

                } catch (error) {
                    console.error("Error al generar factura POS:", error);
                    mostrarInfoModalGlobal(`Ocurrió un error al generar la factura: ${error.message}`, "Error", [], modalContainerConsumos);
                } finally {
                    btnFacturar.disabled = false;
                    btnFacturar.textContent = "Facturar";
                }
            };
        }
        // ========= FIN DE LA MODIFICACIÓN =========

        const btnCobrarConsumosPend = modalDialogActual.querySelector('#btn-cobrar-pendientes-consumos');
        if (btnCobrarConsumosPend) {
            btnCobrarConsumosPend.onclick = async () => {
                const { data: metodosPagoDB } = await supabase.from('metodos_pago').select('id, nombre').eq('hotel_id', reserva.hotel_id).eq('activo', true);
                let opcionesPagoHTML = metodosPagoDB?.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('') || '';

                // La lógica de Pago Mixto permanece aquí sin cambios
                modalDialogActual.innerHTML = `
                <div style="font-family:'Segoe UI',Arial,sans-serif; padding:10px 20px;">
                    <div class="flex justify-between items-center mb-3">
                        <h4 style="font-size:1.2em;font-weight:bold;color:#1e3a8a;">💳 Registrar Pago de Saldo</h4>
                        <button id="btn-cerrar-cobro-saldo-X-submodal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
                    </div>
                    <div style="margin-bottom:15px; text-align:center; font-size:1.1em;">Saldo Total: <strong style="color:#c2410c; font-size:1.2em;">${formatCurrency(saldoPendienteFinal)}</strong></div>
                    <div id="pagos-mixtos-container" class="space-y-3 mb-4 pr-2 max-h-[40vh] overflow-y-auto"></div>
                    <button id="btn-agregar-pago-mixto" class="text-sm text-blue-600 hover:text-blue-800 font-semibold mb-4 flex items-center gap-1">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                        Agregar Método de Pago
                    </button>
                    <div class="text-right font-bold text-lg space-y-1 p-2 bg-gray-50 rounded-md">
                        <div>Total Ingresado: <span id="total-ingresado-mixto" class="text-gray-800"></span></div>
                        <div class="text-red-700">Restante: <span id="restante-pago-mixto"></span></div>
                    </div>
                    <div class="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
                        <button id="btn-registrar-pago-confirmado-saldo" class="button button-success flex-1 py-2.5 text-base" disabled>Registrar Pago</button>
                        <button type="button" id="cancelar-pago-modal-saldo" class="button button-neutral flex-1 py-2.5 text-base">Cancelar</button>
                    </div>
                </div>`;
                
                const pagosContainer = modalDialogActual.querySelector('#pagos-mixtos-container');
                const btnAgregarPago = modalDialogActual.querySelector('#btn-agregar-pago-mixto');
                const totalIngresadoSpan = modalDialogActual.querySelector('#total-ingresado-mixto');
                const restanteSpan = modalDialogActual.querySelector('#restante-pago-mixto');
                const btnConfirmarPago = modalDialogActual.querySelector('#btn-registrar-pago-confirmado-saldo');

                const updateTotalesPagoMixto = () => {
                    const lineas = pagosContainer.querySelectorAll('.pago-mixto-linea');
                    let totalIngresado = 0;
                    lineas.forEach(linea => {
                        const montoInput = linea.querySelector('input[type="number"]');
                        totalIngresado += parseFloat(montoInput.value) || 0;
                    });
                    const restante = saldoPendienteFinal - totalIngresado;
                    totalIngresadoSpan.textContent = formatCurrency(totalIngresado);
                    restanteSpan.textContent = formatCurrency(restante);
                    if (Math.abs(restante) < 0.01) {
                         btnConfirmarPago.disabled = false;
                         restanteSpan.parentElement.classList.remove('text-red-700');
                         restanteSpan.parentElement.classList.add('text-green-700');
                    } else {
                         btnConfirmarPago.disabled = true;
                         restanteSpan.parentElement.classList.remove('text-green-700');
                         restanteSpan.parentElement.classList.add('text-red-700');
                    }
                };

                const agregarNuevaLineaDePago = (esPrimeraLinea = false) => {
                    const lineaId = `linea-${Date.now()}`;
                    const div = document.createElement('div');
                    div.className = 'pago-mixto-linea flex items-center gap-2';
                    div.id = lineaId;
                    div.innerHTML = `
                        <select class="form-control mt-0 flex-grow" required>
                            <option value="">-- Método --</option>
                            ${opcionesPagoHTML}
                        </select>
                        <input type="number" class="form-control mt-0 w-36" placeholder="Monto" min="0.01" step="0.01" required>
                        ${!esPrimeraLinea ? `<button data-linea-id="${lineaId}" class="p-1 rounded-full hover:bg-red-100"><svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 12H6"></path></svg></button>` : '<div class="w-7"></div>'}
                    `;
                    pagosContainer.appendChild(div);
                    if (!esPrimeraLinea) {
                        div.querySelector('button').addEventListener('click', (e) => {
                            document.getElementById(e.currentTarget.dataset.lineaId).remove();
                            updateTotalesPagoMixto();
                        });
                    }
                };

                pagosContainer.addEventListener('input', updateTotalesPagoMixto);
                btnAgregarPago.onclick = () => agregarNuevaLineaDePago(false);
                agregarNuevaLineaDePago(true);
                const primerInputMonto = pagosContainer.querySelector('input[type="number"]');
                if(primerInputMonto) {
                    primerInputMonto.value = saldoPendienteFinal.toFixed(2);
                }
                updateTotalesPagoMixto();

                const cerrarSubmodalCobro = () => {
                    showConsumosYFacturarModal(roomContext, supabase, currentUser, hotelId, mainAppContainer, initialButtonTrigger);
                };
                modalDialogActual.querySelector('#btn-cerrar-cobro-saldo-X-submodal').onclick = cerrarSubmodalCobro;
                modalDialogActual.querySelector('#cancelar-pago-modal-saldo').onclick = cerrarSubmodalCobro;
                
                if (btnConfirmarPago) {
                    btnConfirmarPago.onclick = async () => {
                        btnConfirmarPago.disabled = true;
                        btnConfirmarPago.textContent = 'Procesando...';
                        const lineasDePago = pagosContainer.querySelectorAll('.pago-mixto-linea');
                        const pagosARegistrar = [];
                        for (const linea of lineasDePago) {
                            const monto = parseFloat(linea.querySelector('input[type="number"]').value);
                            const metodoPagoId = linea.querySelector('select').value;
                            if (monto > 0 && metodoPagoId) {
                                pagosARegistrar.push({ monto, metodoPagoId });
                            }
                        }
                        if (pagosARegistrar.length === 0) {
                            alert("No hay pagos válidos para registrar.");
                            btnConfirmarPago.disabled = false;
                            btnConfirmarPago.textContent = 'Registrar Pago';
                            return;
                        }
                        try {
                            const turnoIdActual = turnoService.getActiveTurnId();
                            if (!turnoIdActual) throw new Error("No hay un turno de caja activo para registrar los pagos.");
                            let montoTotalRegistrado = 0;
                            for (const pago of pagosARegistrar) {
                                const { data: pagoData, error: errPago } = await supabase.from('pagos_reserva')
                                    .insert([{ hotel_id: reserva.hotel_id, reserva_id: reserva.id, monto: pago.monto, fecha_pago: new Date().toISOString(), metodo_pago_id: pago.metodoPagoId, usuario_id: currentUser?.id, concepto: `Pago Saldo Hab. ${roomContext.nombre}` }])
                                    .select().single();
                                if (errPago) throw new Error(`Error registrando un pago de ${formatCurrency(pago.monto)}: ${errPago.message}`);
                                await supabase.from('caja').insert([{ hotel_id: reserva.hotel_id, tipo: 'ingreso', monto: pago.monto, concepto: `[COBRO SALDO] Hab. ${roomContext.nombre}`, fecha_movimiento: new Date().toISOString(), metodo_pago_id: pago.metodoPagoId, usuario_id: currentUser?.id, reserva_id: reserva.id, pago_reserva_id: pagoData.id, turno_id: turnoIdActual }]);
                                montoTotalRegistrado += pago.monto;
                            }
                            await supabase.from('reservas').update({ monto_pagado: totalPagadoCalculado + montoTotalRegistrado }).eq('id', reserva.id);
                            mostrarInfoModalGlobal(`Pagos por un total de ${formatCurrency(montoTotalRegistrado)} registrados correctamente.`, "Pago Exitoso", [{ texto: "Entendido", accion: cerrarSubmodalCobro }], modalContainerConsumos);
                        } catch (error) {
                            mostrarInfoModalGlobal(error.message, "Error en Pago de Saldo", [{ texto: "Cerrar", accion: cerrarSubmodalCobro }], modalContainerConsumos);
                        } finally {
                            if(btnConfirmarPago) { btnConfirmarPago.disabled = false; btnConfirmarPago.textContent = 'Registrar Pago'; }
                        }
                    };
                }
            };
        }
    }, 100);
}

// Este es el listener original, ahora simplificado para llamar a la nueva función.
setupButtonListener('btn-ver-consumos', async (btn, roomContext) => {
    // Las variables globales/de módulo se pasan aquí a la función principal
    await showConsumosYFacturarModal(roomContext, supabaseGlobal, currentUserGlobal, hotelIdGlobal, mainAppContainer, btn);
});
// Este es el listener original, ahora simplificado para llamar a la nueva función.
setupButtonListener('btn-ver-consumos', async (btn, roomContext) => {
    // Las variables globales/de módulo se pasan aquí a la función principal
    await showConsumosYFacturarModal(roomContext, supabaseGlobal, currentUserGlobal, hotelIdGlobal, mainAppContainer, btn);
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
    return tiempos
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
}

// js/modules/mapa_habitaciones/mapa_habitaciones.js

// Reemplaza esta función completa en: js/modules/mapa_habitaciones/mapa_habitaciones.js

function calcularDetallesEstancia(dataForm, room, tiempos, horarios, descuentoAplicado) {
    let finAt;
    let montoEstanciaBaseBruto = 0;
    let descripcionEstancia = "Seleccione duración";
    let tipoCalculo = null;
    let cantidadCalculo = 0;

    const inicioAt = new Date();
    const nochesSeleccionadas = dataForm.noches ? parseInt(dataForm.noches) : 0;
    const minutosSeleccionados = dataForm.horas ? parseInt(dataForm.horas) : 0;
    
    // Se lee la cantidad de huéspedes del formulario. Si no hay, se asume 1.
    const cantidadPersonas = dataForm.cantidad_huespedes ? parseInt(dataForm.cantidad_huespedes) : 1;
    
    // --- Lógica para calcular la fecha de fin (sin cambios) ---
    if (nochesSeleccionadas > 0) {
        tipoCalculo = 'noches';
        cantidadCalculo = nochesSeleccionadas;
        let fechaSalida = new Date(inicioAt);
        const [checkoutH, checkoutM] = (horarios.checkout || "12:00").split(':').map(Number);
        fechaSalida.setHours(checkoutH, checkoutM, 0, 0);
        if (inicioAt >= fechaSalida) fechaSalida.setDate(fechaSalida.getDate() + 1);
        fechaSalida.setDate(fechaSalida.getDate() + (nochesSeleccionadas - 1));
        finAt = fechaSalida;
        descripcionEstancia = `${nochesSeleccionadas} noche${nochesSeleccionadas > 1 ? 's' : ''}`;
    } else if (minutosSeleccionados > 0) {
        tipoCalculo = 'horas';
        cantidadCalculo = minutosSeleccionados;
        finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
        descripcionEstancia = formatHorasMin(minutosSeleccionados);
    } else {
        finAt = new Date(inicioAt);
    }

    const precioLibreActivado = dataForm.precio_libre_toggle === 'on';
    const precioLibreValor = parseFloat(dataForm.precio_libre_valor);

    if (precioLibreActivado && !isNaN(precioLibreValor) && precioLibreValor >= 0) {
        montoEstanciaBaseBruto = precioLibreValor;
    } else {
        // --- INICIO DE LA LÓGICA DE CÁLCULO POR OCUPACIÓN ---
        if (nochesSeleccionadas > 0) {
            let precioBasePorNoche = 0;
            // Se decide el precio base por noche según el número de personas
            if (cantidadPersonas <= 1) {
                precioBasePorNoche = room.precio_1_persona || 0;
            } else if (cantidadPersonas === 2) {
                precioBasePorNoche = room.precio_2_personas || 0;
            } else { // 3 o más huéspedes
                const huespedesAdicionales = cantidadPersonas - 2;
                precioBasePorNoche = (room.precio_2_personas || 0) + (huespedesAdicionales * (room.precio_huesped_adicional || 0));
            }
            montoEstanciaBaseBruto = precioBasePorNoche * nochesSeleccionadas;
        } else if (minutosSeleccionados > 0) {
            const tiempoSeleccionado = tiempos.find(t => t.minutos === minutosSeleccionados);
            montoEstanciaBaseBruto = tiempoSeleccionado?.precio || 0;
        }
        // --- FIN DE LA LÓGICA DE CÁLCULO ---
    }
    
    // --- El resto de la función (descuentos, impuestos) permanece igual ---
    const totalAntesDeDescuento = montoEstanciaBaseBruto;
    let montoDescontado = 0;
    if (descuentoAplicado) {
        if (descuentoAplicado.tipo === 'fijo') montoDescontado = parseFloat(descuentoAplicado.valor);
        else if (descuentoAplicado.tipo === 'porcentaje') montoDescontado = totalAntesDeDescuento * (parseFloat(descuentoAplicado.valor) / 100);
    }
    montoDescontado = Math.min(totalAntesDeDescuento, montoDescontado);
    const subtotalConDescuento = totalAntesDeDescuento - montoDescontado;

    let montoImpuesto = 0;
    let precioFinalConImpuestos = subtotalConDescuento;
    const porcentajeImpuesto = parseFloat(hotelConfigGlobal?.porcentaje_impuesto_principal || 0);
    if (porcentajeImpuesto > 0) {
        if (hotelConfigGlobal?.impuestos_incluidos_en_precios) {
            const baseImponible = subtotalConDescuento / (1 + (porcentajeImpuesto / 100));
            montoImpuesto = subtotalConDescuento - baseImponible;
        } else {
            montoImpuesto = subtotalConDescuento * (porcentajeImpuesto / 100);
            precioFinalConImpuestos += montoImpuesto;
        }
    }

    return {
        inicioAt,
        finAt,
        precioTotal: Math.round(precioFinalConImpuestos),
        montoDescontado: Math.round(montoDescontado),
        montoImpuesto: Math.round(montoImpuesto),
        precioBase: Math.round(montoEstanciaBaseBruto),
        descripcionEstancia,
        tipoCalculo,
        cantidadCalculo,
        descuentoAplicado
    };
}

// === FUNCIÓN DEFINITIVA PARA FACTURACIÓN ELECTRÓNICA CON ALEGRA (MAPA DE HABITACIONES) ===
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



// js/modules/mapa_habitaciones/mapa_habitaciones.js

// Reemplaza esta función completa en: js/modules/mapa_habitaciones/mapa_habitaciones.js

async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error("Contenedor de modal principal no encontrado.");
        return;
    }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let descuentoAplicado = null;
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
    
    metodosPagoDisponibles.unshift({ id: "mixto", nombre: "Pago Mixto" });
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, room);
    const opcionesHoras = crearOpcionesHoras(tiempos);

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-auto animate-fade-in-up overflow-hidden";
    
    modalContent.innerHTML = `
    <div class="flex flex-col md:flex-row">
        <div class="w-full md:w-3/5 p-6 sm:p-8 space-y-6 bg-slate-50 md:rounded-l-xl">
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
                    <div id="precio_libre_container_alquiler" class="mt-2" style="display:none;"><label for="precio_libre_valor_alquiler" class="font-semibold text-sm text-gray-700">Valor Total Estancia (sin impuestos)</label><input type="number" id="precio_libre_valor_alquiler" name="precio_libre_valor" class="form-control text-lg font-bold" placeholder="0"></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div><label class="form-label">Cant. Huéspedes*</label><input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" value="2" required></div>
                    <div><label class="form-label">Método de Pago*</label><select required name="metodo_pago_id" id="metodo_pago_id" class="form-control">${metodosPagoDisponibles.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}</select></div>
                </div>
                <div>
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
    
    const formEl = modalContent.querySelector('#alquilar-form-pos');
    
    // --- FUNCIÓN DE RECÁLCULO (INTERNA Y CORREGIDA) ---
    const recalcularYActualizarTotalAlquiler = async () => {
        const formData = Object.fromEntries(new FormData(formEl));
        // Llamada a la función de cálculo correcta, sin parámetros obsoletos
        const detalles = calcularDetallesEstancia(formData, room, tiempos, horarios, descuentoAplicado);
        
        const ticketResumenEl = modalContent.querySelector('#ticket-resumen-container');
        const ticketTotalEl = modalContent.querySelector('#ticket-total-price');

        let resumenHtml = `
            <div class="flex justify-between"><span class="text-slate-300">Estancia:</span><strong>${detalles.descripcionEstancia}</strong></div>
            <div class="flex justify-between"><span class="text-slate-300">Precio Base:</span><strong>${formatCurrency(detalles.precioBase)}</strong></div>
            ${detalles.montoDescontado > 0 ? `<div class="flex justify-between text-green-300"><span>Descuento:</span><strong>-${formatCurrency(detalles.montoDescontado)}</strong></div>` : ''}
            ${detalles.montoImpuesto > 0 ? `<div class="flex justify-between"><span>Impuestos:</span><strong>${formatCurrency(detalles.montoImpuesto)}</strong></div>` : ''}
        `;
        ticketResumenEl.innerHTML = resumenHtml;
        ticketTotalEl.textContent = formatCurrency(detalles.precioTotal);
    };

    // --- EVENT LISTENERS (CORREGIDOS Y SIMPLIFICADOS) ---
    modalContent.querySelector('#close-modal-alquilar').onclick = () => {
        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
    };

    // Se unifica el listener para todos los campos que afectan el precio
    formEl.addEventListener('input', recalcularYActualizarTotalAlquiler);
    formEl.addEventListener('change', recalcularYActualizarTotalAlquiler);

    // Lógica para que los selectores de Noches y Horas se excluyan mutuamente
    const selectNochesEl = modalContent.querySelector('#select-noches');
    const selectHorasEl = modalContent.querySelector('#select-horas');
    selectNochesEl.addEventListener('change', () => { if (selectNochesEl.value) selectHorasEl.value = ''; });
    selectHorasEl.addEventListener('change', () => { if (selectHorasEl.value) selectNochesEl.value = ''; });

    // El resto de la lógica (buscar cliente, aplicar descuento, onsubmit) no cambia...
    // ...
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
            if (formData.precio_libre_toggle === 'on' && (!parseFloat(formData.precio_libre_valor) || parseFloat(formData.precio_libre_valor) <= 0)) throw new Error("Si asigna precio manual, debe ser un valor mayor a cero.");

            if (formData.metodo_pago_id === "mixto") {
                showPagoMixtoModal(detallesFinales.precioTotal, metodosPagoDisponibles, async (pagosMixtos) => {
                    await registrarReservaYMovimientosCaja({
                        formData, detallesEstancia: detallesFinales, pagos: pagosMixtos,
                        room, supabase, currentUser, hotelId, mainAppContainer
                    });
                });
            } else {
                await registrarReservaYMovimientosCaja({
                    formData, detallesEstancia: detallesFinales, pagos: [{ metodo_pago_id: formData.metodo_pago_id, monto: detallesFinales.precioTotal }],
                    room, supabase, currentUser, hotelId, mainAppContainer
                });
            }
        } catch (err) {
            mostrarInfoModalGlobal(err.message, "Error de Registro");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "Confirmar y Registrar";
        }
    };

    // Llamada inicial para mostrar los valores base
    recalcularYActualizarTotalAlquiler();
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
async function showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error("Contenedor de modal 'modal-container' no encontrado.");
        alert("Error crítico: No se puede mostrar el modal para extender tiempo.");
        return;
    }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = ""; // Limpiar modal

    let reservaActiva = null;
    try {
        // Buscar la reserva activa o con tiempo agotado para la habitación
        for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
            const { data, error } = await supabase
                .from('reservas')
                .select('id, fecha_fin, fecha_inicio, cliente_nombre, monto_total, metodo_pago_id, monto_pagado') // Incluir monto_pagado
                .eq('habitacion_id', room.id)
                .eq('estado', estado)
                .order('fecha_inicio', { ascending: false })
                .limit(1)
                .maybeSingle(); // Usar maybeSingle para evitar error si no encuentra nada en un estado

            if (error && error.code !== 'PGRST116') { // PGRST116: "exact / at most one row expected" (ignorable si es por maybeSingle y no encuentra)
                throw error;
            }
            if (data) {
                reservaActiva = data;
                break;
            }
        }

        if (!reservaActiva) {
            mostrarInfoModalGlobal("No se encontró una reserva activa o con tiempo agotado para extender en esta habitación.", "Operación no posible", [], modalContainer);
            return;
        }

        // Obtener datos necesarios para el modal
        const [horarios, tiempos, metodosPagoExtension] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);

const tarifaNocheUnicaExt = tiempos.find(t => t.nombre.toLowerCase().includes('noche'));
        const precioNocheHabitacionExt = room.precio || 0; // Precio base de la habitación por noche como fallback

        const opcionesNochesExt = crearOpcionesNochesConPersonalizada(horarios, 5, reservaActiva.fecha_fin, tarifaNocheUnicaExt, room);
        const opcionesHorasExt = crearOpcionesHoras(tiempos);

        const modalContent = document.createElement('div');
        modalContent.className = "bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl shadow-2xl w-full max-w-3xl p-0 m-auto animate-fade-in-up overflow-hidden";

        const fechaFinActual = new Date(reservaActiva.fecha_fin);
        const ahora = new Date();
        const tiempoRestanteMs = fechaFinActual - ahora;
        let tiempoRestanteStr = tiempoRestanteMs > 0 ? `Tiempo restante: ${formatHorasMin(Math.floor(tiempoRestanteMs / 60000))}` : `Tiempo excedido: ${formatHorasMin(Math.floor(Math.abs(tiempoRestanteMs) / 60000))}`;

        // Usar la clase button-custom-purple para el botón de confirmar
        modalContent.innerHTML = `
            <div class="flex flex-col md:flex-row">
                <div class="w-full md:w-3/5 p-6 md:p-8 space-y-5">
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
                                <div class="flex flex-col">
                                    <label for="select-noches-ext" class="text-xs text-gray-500 mb-1">Noches Adicionales:</label>
                                    <select name="noches_extender" id="select-noches-ext" class="form-control">
                                        <option value="">-- Noches --</option>
                                        ${opcionesNochesExt.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}
                                    </select>
                                </div>
                                <div class="flex flex-col" id="container-noches-pers-ext" style="display:none;">
                                    <label for="input-noches-pers-ext" class="text-xs text-gray-500 mb-1">Noches (Personalizado):</label>
                                    <input type="number" min="1" max="365" step="1" placeholder="N°" id="input-noches-pers-ext" name="noches_personalizada_ext" class="form-control"/>
                                </div>
                                <div class="flex flex-col">
                                    <label for="select-horas-ext" class="text-xs text-gray-500 mb-1">Horas Adicionales:</label>
                                    <select name="horas_extender" id="select-horas-ext" class="form-control">
                                        <option value="">-- Horas --</option>
                                        ${opcionesHorasExt.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}
                                    </select>
                                </div>
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
        const inputNochesPersExtEl = modalContent.querySelector('#input-noches-pers-ext');
        const containerNochesPersExtEl = modalContent.querySelector('#container-noches-pers-ext');
        const selectHorasExtEl = modalContent.querySelector('#select-horas-ext');
        const ticketExtDescEl = modalContent.querySelector('#ticket-ext-description');
        const ticketExtPriceEl = modalContent.querySelector('#ticket-ext-price');
        const ticketExtTotalEl = modalContent.querySelector('#ticket-ext-total-price');
        const nuevaSalidaEstimadaEl = modalContent.querySelector('#nueva-salida-estimada');

        function actualizarResumenTicketExtension() {
            // ... (lógica existente para actualizar el resumen, no la cambio)
            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtra = 0; let descExtra = "Seleccione duración"; let nuevaFechaFinExt = new Date(reservaActiva.fecha_fin);
            const nochesSelExtInput = formDataExt.noches_personalizada_ext ? formDataExt.noches_personalizada_ext : formDataExt.noches_extender;
            const nochesSelExt = nochesSelExtInput && nochesSelExtInput !== "personalizada" ? parseInt(nochesSelExtInput) : 0;
            const minutosSelExt = formDataExt.horas_extender ? parseInt(formDataExt.horas_extender) : 0;
            if (nochesSelExt > 0) {
                let fechaCalculo = new Date(reservaActiva.fecha_fin); const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                fechaCalculo.setHours(checkoutH, checkoutM, 0, 0); if (new Date(reservaActiva.fecha_fin) >= fechaCalculo) fechaCalculo.setDate(fechaCalculo.getDate() + 1);
                fechaCalculo.setDate(fechaCalculo.getDate() + (nochesSelExt - 1)); nuevaFechaFinExt = fechaCalculo;
                if (tarifaNocheUnicaExt && typeof tarifaNocheUnicaExt.precio === 'number') precioExtra = tarifaNocheUnicaExt.precio * nochesSelExt; else precioExtra = precioNocheHabitacionExt * nochesSelExt;
                descExtra = `${nochesSelExt} noche${nochesSelExt > 1 ? 's' : ''} adicional${nochesSelExt > 1 ? 'es' : ''}`;
            } else if (minutosSelExt > 0) {
                nuevaFechaFinExt = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosSelExt * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosSelExt && t.tipo_unidad !== 'noche');
                let precioHorasExt = 0; if (tiempoSelExt) precioHorasExt = (tiempoSelExt.precio === null || tiempoSelExt.precio === 0) && (typeof tiempoSelExt.precio_adicional === 'number') ? tiempoSelExt.precio_adicional : (typeof tiempoSelExt.precio === 'number' ? tiempoSelExt.precio : 0);
                if (precioHorasExt > 0) { precioExtra = precioHorasExt; descExtra = `${formatHorasMin(minutosSelExt)} adicionales`; }
                else { precioExtra = 0; descExtra = `${formatHorasMin(minutosSelExt)} adicionales - Precio no definido`; }
            }
            ticketExtDescEl.textContent = descExtra; ticketExtPriceEl.textContent = formatCurrency(precioExtra);
            ticketExtTotalEl.textContent = formatCurrency(precioExtra); nuevaSalidaEstimadaEl.textContent = formatDateTime(nuevaFechaFinExt);
        }

        selectNochesExtEl.onchange = () => { if (selectNochesExtEl.value === "personalizada") { containerNochesPersExtEl.style.display = "block"; inputNochesPersExtEl.required = true; inputNochesPersExtEl.focus(); } else { containerNochesPersExtEl.style.display = "none"; inputNochesPersExtEl.required = false; inputNochesPersExtEl.value = ''; } if (selectNochesExtEl.value) selectHorasExtEl.value = ""; actualizarResumenTicketExtension(); };
        inputNochesPersExtEl.oninput = actualizarResumenTicketExtension;
        selectHorasExtEl.onchange = () => { if (selectHorasExtEl.value) { selectNochesExtEl.value = ""; containerNochesPersExtEl.style.display = "none"; inputNochesPersExtEl.required = false; inputNochesPersExtEl.value = ''; } actualizarResumenTicketExtension(); };
        actualizarResumenTicketExtension(); // Llamada inicial

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
            let pagoReservaExtensionId = null;

            const nochesExtSubmitInput = formDataExt.noches_personalizada_ext ? formDataExt.noches_personalizada_ext : formDataExt.noches_extender;
            const nochesExtSubmit = nochesExtSubmitInput && nochesExtSubmitInput !== "personalizada" ? parseInt(nochesExtSubmitInput) : 0;
            const minutosExtSubmit = formDataExt.horas_extender ? parseInt(formDataExt.horas_extender) : 0;

            if (nochesExtSubmit > 0) {
                let fechaBaseExt = new Date(reservaActiva.fecha_fin); const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                nuevaFechaFinSubmit = new Date(fechaBaseExt); nuevaFechaFinSubmit.setHours(checkoutH, checkoutM, 0, 0);
                if (fechaBaseExt >= nuevaFechaFinSubmit) nuevaFechaFinSubmit.setDate(nuevaFechaFinSubmit.getDate() + 1);
                nuevaFechaFinSubmit.setDate(nuevaFechaFinSubmit.getDate() + (nochesExtSubmit -1));
                precioExtraSubmit = (tarifaNocheUnicaExt?.precio || precioNocheHabitacionExt) * nochesExtSubmit;
                descExtraSubmit = `${nochesExtSubmit} noche(s) adicional(es)`;
            } else if (minutosExtSubmit > 0) {
                nuevaFechaFinSubmit = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosExtSubmit * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosExtSubmit && t.tipo_unidad !== 'noche');
                let precioHorasExtSubmit = 0; if(tiempoSelExt) precioHorasExtSubmit = (tiempoSelExt.precio === null || tiempoSelExt.precio === 0) && (typeof tiempoSelExt.precio_adicional === 'number') ? tiempoSelExt.precio_adicional : (typeof tiempoSelExt.precio === 'number' ? tiempoSelExt.precio : 0);
                precioExtraSubmit = precioHorasExtSubmit; descExtraSubmit = `${formatHorasMin(minutosExtSubmit)} adicionales`;
            } else { 
                alert('Debe seleccionar noches o horas para extender.'); 
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                return; 
            }
            
            if (precioExtraSubmit <= 0 && (nochesExtSubmit > 0 || minutosExtSubmit > 0) ) {
                const confirmNoCost = window.confirm(`La extensión seleccionada (${descExtraSubmit}) no tiene un costo asociado o es $0. ¿Desea extender el tiempo de todas formas?`);
                if (!confirmNoCost) { submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión"; return; }
            }

            if (!formDataExt.metodo_pago_ext_id && precioExtraSubmit > 0) { 
                alert('Por favor, seleccione un método de pago para la extensión.'); 
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                return; 
            }
            
            const turnoId = turnoService.getActiveTurnId();
            if (precioExtraSubmit > 0 && !turnoId) {
                mostrarInfoModalGlobal("ACCIÓN BLOQUEADA: No se puede registrar el pago de la extensión en caja porque no hay un turno activo.", "Turno Requerido", modalContainer);
                submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                return; 
            }

            // ========= INICIO LÓGICA DE PAGO Y ACTUALIZACIÓN =========
            if (precioExtraSubmit > 0) { // Solo si hay costo, se procesa pago y se guarda en servicios_x_reserva
                // 1. Registrar el pago en pagos_reserva
                const { data: pagoData, error: errPagoReserva } = await supabase
                    .from('pagos_reserva')
                    .insert({
                        hotel_id: hotelId,
                        reserva_id: reservaActiva.id,
                        monto: Math.round(precioExtraSubmit),
                        fecha_pago: new Date().toISOString(),
                        metodo_pago_id: formDataExt.metodo_pago_ext_id,
                        usuario_id: currentUser?.id,
                        concepto: `Pago por extensión: ${descExtraSubmit}`
                    })
                    .select('id') // Solo necesitamos el ID
                    .single();

                if (errPagoReserva) {
                    alert('Error registrando el pago de la extensión: ' + errPagoReserva.message);
                    submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                    return;
                }
                pagoReservaExtensionId = pagoData.id;

                // 2. Registrar la extensión como un ítem en servicios_x_reserva
                const { error: errServicioExt } = await supabase
                    .from('servicios_x_reserva')
                    .insert({
                        hotel_id: hotelId,
                        reserva_id: reservaActiva.id,
                        descripcion_manual: `Extensión: ${descExtraSubmit}`,
                        cantidad: 1,
                        precio_cobrado: Math.round(precioExtraSubmit),
                        estado_pago: 'pagado', // Se pagó ahora
                        pago_reserva_id: pagoReservaExtensionId, // Vincular al pago
                        fecha_servicio: new Date().toISOString()
                    });

                if (errServicioExt) {
                    console.warn("Advertencia: No se pudo registrar el detalle de la extensión como servicio:", errServicioExt.message);
                    // No es fatal, pero se podría notificar o registrar internamente
                }

                // 3. Actualizar la reserva: SOLO fecha_fin y monto_pagado. NO monto_total.
                const nuevoMontoPagadoReserva = (reservaActiva.monto_pagado || 0) + Math.round(precioExtraSubmit);
                const { error: errUpdRes } = await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(),
                    monto_pagado: nuevoMontoPagadoReserva,
                    // NO SE ACTUALIZA monto_total aquí
                    estado: 'activa'
                }).eq('id', reservaActiva.id);

                if (errUpdRes) {
                    alert('Error actualizando la reserva: ' + errUpdRes.message);
                     // Considerar revertir el pago en pagos_reserva si la actualización de reserva falla
                    submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                    return;
                }

                // 4. Registrar en caja
                const movimientoCajaExtension = {
                    hotel_id: hotelId, tipo: 'ingreso', monto: Math.round(precioExtraSubmit),
                    concepto: `Extensión Hab. ${room.nombre} (${descExtraSubmit}) - ${reservaActiva.cliente_nombre || 'N/A'}`,
                    fecha_movimiento: new Date().toISOString(), usuario_id: currentUser?.id,
                    reserva_id: reservaActiva.id, metodo_pago_id: formDataExt.metodo_pago_ext_id,
                    turno_id: turnoId, pago_reserva_id: pagoReservaExtensionId
                };
                const { error: errorCajaExtension } = await supabase.from('caja').insert(movimientoCajaExtension);
                if (errorCajaExtension) {
                    console.error("Error registrando extensión en caja:", errorCajaExtension);
                    mostrarInfoModalGlobal(`Error al registrar el pago en caja: ${errorCajaExtension.message}. La extensión se aplicó pero el pago en caja falló. Revise manualmente.`, "Error en Caja", modalContainer);
                    // No detenemos el flujo, pero el usuario debe saber que hubo un problema en caja
                }

            } else { // Extensión sin costo o con costo cero
                const { error: errUpdRes } = await supabase.from('reservas').update({
                    fecha_fin: nuevaFechaFinSubmit.toISOString(),
                    estado: 'activa'
                }).eq('id', reservaActiva.id);
                if (errUpdRes) {
                    alert('Error actualizando la reserva (extensión sin costo): ' + errUpdRes.message);
                    submitButton.disabled = false; submitButton.textContent = "Confirmar Extensión";
                    return;
                }
                // Opcional: Registrar la extensión sin costo en servicios_x_reserva
                if (nochesExtSubmit > 0 || minutosExtSubmit > 0) { // Solo si se seleccionó alguna duración
                    await supabase.from('servicios_x_reserva').insert({
                        hotel_id: hotelId, reserva_id: reservaActiva.id,
                        descripcion_manual: `Extensión: ${descExtraSubmit} (Sin costo)`,
                        cantidad: 1, precio_cobrado: 0, estado_pago: 'N/A',
                        fecha_servicio: new Date().toISOString()
                    });
                }
            }
            // ========= FIN LÓGICA DE PAGO Y ACTUALIZACIÓN =========

            // Actualizar cronómetro (esto es común para extensiones con o sin costo)
            const { data: cronoAct } = await supabase.from('cronometros').select('id').eq('reserva_id', reservaActiva.id).eq('activo', true).limit(1).single();
            if (cronoAct) {
                await supabase.from('cronometros').update({ fecha_fin: nuevaFechaFinSubmit.toISOString(), actualizado_en: new Date().toISOString() }).eq('id', cronoAct.id);
            } else {
                // Si no hay cronómetro activo para la reserva, pero la reserva está activa, se crea uno.
                // Esto podría pasar si el cronómetro se detuvo manualmente o por un error.
                 await supabase.from('cronometros').insert([{
                    hotel_id: hotelId, reserva_id: reservaActiva.id, habitacion_id: room.id,
                    fecha_inicio: reservaActiva.fecha_inicio, 
                    fecha_fin: nuevaFechaFinSubmit.toISOString(), activo: true,
                }]);
            }
            
            if (room.estado === 'tiempo agotado') {
                await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
            }

            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId); // mainAppContainer es el contenedor de la lista de habitaciones

        }; // Fin onsubmit
    } catch (err) {
        console.error("Error preparando modal de extensión:", err);
        mostrarInfoModalGlobal("Error al preparar el modal de extensión: " + (err.message || "Error desconocido"), "Error Crítico", [], modalContainer);
        // Si el modal ya estaba parcialmente renderizado y falla, limpiarlo para no dejarlo a medias
        if (modalContainer.style.display === "flex" && !modalContainer.querySelector('#extender-form-pos')) {
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
        }
    }
}


// ===================== BLOQUE CRONÓMETRO (VERSIÓN OPTIMIZADA) =====================
function startCronometro(room, supabase, hotelId, listEl) {
    // 1. OBTENER LA FECHA FIN UNA SOLA VEZ
    // Esta es la única consulta a la base de datos al inicio del cronómetro.
    supabase.from('reservas')
        .select('id, fecha_fin')
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .single()
        .then(({ data: reservaActiva, error: reservaError }) => {
            const cronometroDiv = listEl.querySelector(`#cronometro-${room.id}`);
            if (reservaError || !reservaActiva) {
                if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-sm text-slate-400 italic">No activo</span>`;
                return;
            }

            const fechaFin = new Date(reservaActiva.fecha_fin);
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
                const diff = fechaFin - now;
                const cardElement = cronometroDiv.closest('.room-card');
                
                if (diff <= 0) {
                    if (!tiempoAgotadoNotificado) {
                        tiempoAgotadoNotificado = true;
                        console.log(`⚡️ Notificando a Supabase: Habitación ${room.id} ha agotado su tiempo.`);
                        supabase.from('habitaciones')
                            .update({ estado: 'tiempo agotado' })
                            .eq('id', room.id)
                            .then(({ error }) => {
                                if (error) {
                                    console.error("Error al actualizar habitación a 'tiempo agotado':", error);
                                } else {
                                    playPopSound && playPopSound();
                                }
                            });
                    }

                    // Actualización visual inmediata
                    const diffPos = Math.abs(diff);
                    const h = String(Math.floor(diffPos / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diffPos % 3600000) / 60000)).padStart(2, '0');
                    // CAMBIO 1: Añadir segundos al cálculo y al texto
                    const s = String(Math.floor((diffPos % 60000) / 1000)).padStart(2, '0');
                    cronometroDiv.innerHTML = `<span class="font-bold text-red-500 animate-pulse">⏰ Excedido: -${h}:${m}:${s}</span>`;
                    
                    if (cardElement) {
                        cardElement.classList.add('animate-pulse-fast', 'ring-4', 'ring-red-500');
                        cardElement.classList.remove('ring-yellow-500');
                    }

                } else {
                    // CAMBIO 1 (cont.): Añadir segundos al cálculo y al texto
                    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');

                    let textColor = 'text-green-600';
                    let iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                    
                    if (cardElement) cardElement.classList.remove('animate-pulse-fast', 'ring-4', 'ring-red-500', 'ring-yellow-500');
                    
                    if (diff < 10 * 60 * 1000) { // Menos de 10 min
                        textColor = 'text-yellow-600 font-semibold';
                        iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                        if (cardElement) cardElement.classList.add('ring-4', 'ring-yellow-500');
                    } else if (diff < 30 * 60 * 1000) { // Menos de 30 min
                        textColor = 'text-orange-500';
                        iconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;
                    }
                    
                    // Se añade la variable 's' para los segundos
                    cronometroDiv.innerHTML = `${iconSVG}<span class="${textColor}">${h}:${m}:${s}</span>`;
                }
            }
            
            updateCronoDisplay();

            // CAMBIO 2: El intervalo ahora se ejecuta cada segundo (1000ms)
            cronometrosInterval[cronometroId] = setInterval(updateCronoDisplay, 1000); 
        })
        .catch(err => {
            if (err.code !== 'PGRST116') {
                console.error(`Error iniciando cronómetro para hab ${room.id}:`, err.message);
            }
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
function mostrarInfoModalGlobal(htmlContent, title = "Información", botones = [], modalContainerRef = null) {
    const container = modalContainerRef || document.getElementById('modal-container');

    if (!container) {
        console.error("Contenedor de modal global no encontrado ('modal-container'). El modal no se puede mostrar.");
        // Fallback muy básico si el contenedor principal no existe
        alert(title + "\n\n" + String(htmlContent).replace(/<[^>]*>/g, ''));
        return;
    }

    container.style.display = "flex"; // Ahora 'container' debería ser el elemento DOM correcto
    container.innerHTML = ""; // Limpiar contenido anterior

    const modalDialog = document.createElement('div');
    modalDialog.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto relative animate-fade-in-up";

    let buttonsHTML = '';
    const closeAndClean = () => {
        if (container) { // Doble chequeo por si acaso
            container.style.display = "none";
            container.innerHTML = '';
        }
    };

    if (botones && botones.length > 0) {
        botones.forEach((btnInfo, index) => {
            // Usar clases de botón base y permitir clases personalizadas
            const btnClass = btnInfo.clase || (index === 0 && botones.length === 1 ? 'button-primary' : 'button-neutral');
            buttonsHTML += `<button id="info-modal-btn-${index}" class="button ${btnClass} py-2 px-4 ml-2">${btnInfo.texto}</button>`;
        });
    } else {
        // Botón "Entendido" por defecto si no se especifican otros botones
        buttonsHTML = `<button id="btn-ok-info-modal-global" class="button button-primary py-2 px-4">Entendido</button>`;
    }

    modalDialog.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <h3 class="text-xl font-semibold text-gray-800">${title}</h3>
            <button id="close-info-modal-global-btn" class="text-gray-400 hover:text-red-600 text-3xl leading-none p-1 -mt-2 -mr-2">&times;</button>
        </div>
        <div class="text-gray-700 max-h-[70vh] overflow-y-auto pr-2">${htmlContent}</div>
        <div class="mt-6 text-right">
            ${buttonsHTML}
        </div>
    `;
    container.appendChild(modalDialog);

    // Asignar acciones a los botones
    if (botones && botones.length > 0) {
        botones.forEach((btnInfo, index) => {
            const btnElement = modalDialog.querySelector(`#info-modal-btn-${index}`);
            if (btnElement) {
                btnElement.onclick = () => {
                    if (typeof btnInfo.accion === 'function') {
                        btnInfo.accion();
                    }
                    // Por defecto, la mayoría de las acciones de botón deberían cerrar el modal,
                    // a menos que la propia acción lo maneje o se quiera mantener abierto.
                    // Si una acción NO debe cerrar el modal, la acción puede devolver `false`.
                    if (btnInfo.noCerrar !== true) {
                         closeAndClean();
                    }
                };
            }
        });
    } else {
        const defaultOkButton = modalDialog.querySelector('#btn-ok-info-modal-global');
        if (defaultOkButton) {
            defaultOkButton.onclick = closeAndClean;
        }
    }

    const closeModalButton = modalDialog.querySelector('#close-info-modal-global-btn');
    if (closeModalButton) {
        closeModalButton.onclick = closeAndClean;
    }

    // Cerrar si se hace clic fuera del modalDialog (en el overlay 'container')
    container.onclick = (e) => {
        if (e.target === container) {
            closeAndClean();
        }
    };
    // Prevenir que el clic en el modalDialog cierre el modal (ya que se propagaría al container)
    modalDialog.onclick = (e) => {
        e.stopPropagation();
    };
}
// ===================== FUNCIONES DE MANTENIMIENTO Y RESERVA FUTURA =====================
// --- NUEVA FUNCIÓN showMantenimientoModal CON FORMULARIO DE TAREA ---


// En tu archivo mapa-habitaciones.js, reemplaza esta función:

// En tu archivo mapa-habitaciones.js, REEMPLAZA esta función completa:

// CÓDIGO CORREGIDO Y OPTIMIZADO en mapa-habitaciones.js

// js/modules/mapa_habitaciones/mapa_habitaciones.js

// ... (asegúrate de que la importación esté al inicio de tu archivo)
import { showModalTarea } from '../mantenimiento/mantenimiento.js';

// ... (resto de tus funciones del mapa de habitaciones)

// REEMPLAZA TU FUNCIÓN showMantenimientoModal ACTUAL CON ESTA VERSIÓN CORREGIDA
async function showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');

    // 1. Confirmar la acción con el usuario.
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

    // Si el usuario cancela la confirmación inicial, no hacemos nada más.
    if (!confirmacion) {
        return;
    }
    
    // --- LÓGICA CORREGIDA ---
    // NO HAY NINGUNA MODIFICACIÓN A LA BASE DE DATOS AQUÍ.
    // Solo llamamos al modal para que el usuario cree la tarea.
    try {
        const modalTareaContainer = document.createElement('div');
        modalTareaContainer.id = 'mant-modal-temp-container';
        modalTareaContainer.className = "fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4";
        document.body.appendChild(modalTareaContainer);

        // Llamamos a la función del otro módulo para que muestre el formulario.
        // La lógica de guardar y cambiar estado está DENTRO de showModalTarea.
        await showModalTarea(
            modalTareaContainer,
            supabase,
            hotelId,
            currentUser,
            { // Objeto 'tarea' pre-llenado
                habitacion_id: room.id,
                estado: 'pendiente',
                titulo: `Mantenimiento Hab. ${room.nombre}`
            }
        );
        
        // 3. Observer para saber cuándo se cierra el modal de tarea y refrescar el mapa.
        // Esto es para que, sin importar si se guarda o se cancela, el mapa se actualice al final.
        const observer = new MutationObserver(async (mutationsList, obs) => {
            if (!document.body.contains(modalTareaContainer) || !modalTareaContainer.innerHTML.trim()) {
                if (document.body.contains(modalTareaContainer)) {
                    document.body.removeChild(modalTareaContainer);
                }
                await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
                obs.disconnect();
            }
        });

        observer.observe(document.body, { childList: true, subtree: true });

    } catch (error) {
        console.error("Error al invocar el modal de mantenimiento:", error);
        mostrarInfoModalGlobal(`Error al iniciar el proceso: ${error.message}`, "Error");
    }
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

// ===================== FIN DEL ARCHIVO =====================
