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
function formatCurrency(value) {
    const simboloMoneda = hotelConfigGlobal?.moneda_local || '$';
    // El código ISO y los decimales también podrían venir de hotelConfigGlobal si los guardas allí.
    // Por ahora, asumimos que el formato numérico es para 'es-CO' y sin decimales para el formateador base.
    // const codigoISO = hotelConfigGlobal?.codigo_moneda_iso || 'COP'; // Ejemplo si tuvieras el ISO
    // const decimales = parseInt(hotelConfigGlobal?.cantidad_decimales_moneda || 0); // Ejemplo si tuvieras los decimales

    let numeroFormateado;
    if (typeof value !== 'number' || isNaN(value)) {
        numeroFormateado = Number(0).toFixed(0); // O usa 'decimales' si lo tienes
    } else {
        numeroFormateado = Number(value).toFixed(0); // O usa 'decimales'
    }

    // Formatear el número con separadores de miles (estilo colombiano)
    const partes = numeroFormateado.toString().split(".");
    partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, "."); // Punto como separador de miles

    return `${simboloMoneda} ${partes.join(",")}`; // Coma como separador decimal si hubiera
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
        <div id="room-map-list" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 px-4 md:px-0"></div>
        <div id="modal-container" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" style="display:none;"></div>
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


async function renderRooms(listEl, supabase, currentUser, hotelId) {
    // Este listEl YA es el div donde se pintan las tarjetas de habitaciones
    if (!listEl) {
        console.error("renderRooms: listEl es null o indefinido. Verifica que se esté pasando correctamente desde mount.");
        return;
    }

    const { data: habitaciones, error } = await supabase
        .from('habitaciones')
        .select('*, precio')
        .eq('hotel_id', hotelId)
        .order('nombre', { ascending: true });

    if (error) {
        listEl.innerHTML = `<div class="col-span-full text-red-600 p-4 bg-red-100 rounded-md">Error cargando habitaciones: ${error.message}</div>`;
        return;
    }

    currentRooms = habitaciones;
    listEl.innerHTML = '';

    if (!habitaciones || habitaciones.length === 0) {
        listEl.innerHTML = `<div class="col-span-full text-gray-500 p-4 text-center">No hay habitaciones configuradas para este hotel.</div>`;
        return;
    }

    // ---- ORDEN NUMÉRICO DE HABITACIONES POR NOMBRE ----
    habitaciones.sort((a, b) => {
        const getNumber = nombre => {
            const match = nombre.match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
        };
        return getNumber(a.nombre) - getNumber(b.nombre);
    });

    // (Opcional) Log para verificar el orden
    console.log("Habitaciones a renderizar:", habitaciones.map(h => h.nombre));

    // ---- RENDER DE LAS TARJETAS ----
    habitaciones.forEach(room => {
        listEl.appendChild(roomCard(room, supabase, currentUser, hotelId, listEl));
        if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
            startCronometro(room, supabase, hotelId, listEl);
        }
    });
}


function roomCard(room, supabase, currentUser, hotelId, mainAppContainer) {
    const card = document.createElement('div');

    // ==================== COLOR DINÁMICO SEGÚN TIEMPO RESTANTE =======================
    let colorClase = "bg-white";
    let segundosRestantes = null;
    let fechaFin = room.fecha_fin ? new Date(room.fecha_fin) : null;
    let ahora = new Date();

    // Calcula segundosRestantes solo si la habitación está ocupada/activa/reservada/tiempo agotado
    if (["ocupada", "activa", "reservada", "tiempo agotado"].includes(room.estado) && fechaFin) {
        segundosRestantes = Math.floor((fechaFin - ahora) / 1000);

        if (segundosRestantes <= 0) {
            colorClase = "bg-red-500 text-white animate-pulse";
        } else if (segundosRestantes <= 15 * 60) {
            colorClase = "bg-orange-400 text-black";
        } else {
            colorClase = "bg-green-200 text-black";
        }
    }
    // =================================================================================

    card.className = `room-card ${colorClase} rounded-2xl shadow-xl overflow-hidden transition-all duration-300 ease-in-out hover:shadow-2xl hover:-translate-y-1 flex flex-col group relative`;

    // --- ICONOS Y BADGES ---
    const contentWrapper = document.createElement('div');
    contentWrapper.className = "p-5 flex-grow flex flex-col"; 

    let borderColorClass = 'border-slate-300';
    let badgeBgClass = 'bg-slate-100 text-slate-700';
    let estadoText = room.estado ? room.estado.toUpperCase().replace("_", " ") : 'DESCONOCIDO';
    let estadoIcon = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.755 4 3.92C16 13.09 14.828 15 12 15c-2.828 0-4-1.921-4-3.92A2.966 2.966 0 018.228 9z" /><path stroke-linecap="round" stroke-linejoin="round" d="M12 15V21m0 0H9m3 0h3" /></svg>`; 

    const estadoColores = {
        libre: { border: 'border-green-500', badge: 'bg-green-100 text-green-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" /></svg>` },
        ocupada: { border: 'border-yellow-500', badge: 'bg-yellow-100 text-yellow-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>` },
        "tiempo agotado": { border: 'border-red-600', badge: 'bg-red-100 text-red-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>` },
        mantenimiento: { border: 'border-orange-500', badge: 'bg-orange-100 text-orange-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>` },
        limpieza: { border: 'border-cyan-500', badge: 'bg-cyan-100 text-cyan-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M15.586 3.586a2 2 0 00-2.828 0L10 6.313 7.242 3.555a2 2 0 00-2.828 2.829L7.172 9.11l-2.757 2.758a2 2 0 102.828 2.828L10 11.938l2.758 2.757a2 2 0 002.828-2.828L12.828 9.11l2.757-2.757a2 2 0 000-2.828z" clip-rule="evenodd" /></svg>` },
        reservada: { border: 'border-indigo-500', badge: 'bg-indigo-100 text-indigo-700', icon: `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 inline mr-1.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>` },
    };

    if (estadoColores[room.estado]) {
        borderColorClass = estadoColores[room.estado].border;
        badgeBgClass = estadoColores[room.estado].badge;
        estadoIcon = estadoColores[room.estado].icon;
    }
    card.classList.add('border-t-4', borderColorClass);

    const iconBed = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-slate-500 group-hover:text-blue-600 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" /></svg>`;
    const iconTagPrice = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-slate-500 group-hover:text-blue-600 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A2 2 0 013 8V5c0-1.1.9-2 2-2z" /></svg>`;
    const iconSparkles = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2 text-slate-500 group-hover:text-blue-600 transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" /></svg>`;
    
    contentWrapper.innerHTML = `
        <div class="flex-grow"> 
            <div class="flex justify-between items-center mb-3"> 
                <h3 class="text-xl lg:text-2xl font-semibold text-slate-800 group-hover:text-blue-700 transition-colors duration-200 leading-tight min-w-0 truncate">
                    ${room.nombre}
                </h3>
                <span class="badge ${badgeBgClass} px-2 py-1 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm flex-shrink-0">
                    ${estadoIcon}
                    <span class="ml-1">${estadoText}</span>
                </span>
            </div>
            <div class="space-y-2.5 text-sm text-slate-600 mb-4">
                <p class="flex items-center text-slate-700">${iconBed} <span>${room.tipo || 'No especificado'}</span></p>
                <p class="flex items-center text-slate-700">${iconTagPrice} <span class="font-medium">${formatCurrency(room.precio || 0)}</span> <span class="text-xs text-slate-500 ml-1">/noche base</span></p>
                ${room.amenidades && room.amenidades.length > 0 ? 
                    `<div class="pt-1.5">
                        <p class="flex items-center mb-1.5 text-slate-700">${iconSparkles} <span class="font-medium">Amenidades:</span></p>
                        <div class="flex flex-wrap gap-2">
                            ${room.amenidades.map(am => `<span class="amenity-tag bg-slate-100 group-hover:bg-blue-50 text-slate-600 group-hover:text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full shadow-sm transition-colors duration-200">${am}</span>`).join('')}
                        </div>
                    </div>` 
                    : '<p class="text-xs text-slate-400 italic mt-1">Sin amenidades especificadas.</p>'
                }
            </div>
        </div>
        <div id="cronometro-${room.id}" class="cronometro-display mt-auto text-right font-mono text-xl flex items-center justify-end pt-4 border-t border-slate-200 group-hover:border-blue-200 transition-colors duration-200">
            <span id="cronometro-text-${room.id}"></span>
        </div>
    `;
    card.appendChild(contentWrapper);

    // ========== Lógica para mostrar el tiempo restante o excedido en la tarjeta ==========
   

    if (["ocupada", "activa", "reservada", "tiempo agotado"].includes(room.estado) && room.fecha_fin) {
        const cronometroTextEl = card.querySelector(`#cronometro-text-${room.id}`);
        function updateCronometro() {
            const ahora = new Date();
            const fechaFin = new Date(room.fecha_fin);
            let diff = fechaFin - ahora; // en ms

            let negativo = false;
            if (diff < 0) {
                negativo = true;
                diff = -diff;
            }

            let segundos = Math.floor(diff / 1000) % 60;
            let minutos = Math.floor(diff / 1000 / 60) % 60;
            let horas = Math.floor(diff / 1000 / 60 / 60);

            const formatted = `${negativo ? "+" : ""}${horas}:${minutos.toString().padStart(2, '0')}:${segundos.toString().padStart(2, '0')}`;

            if (negativo) {
                cronometroTextEl.innerHTML = `<span class="text-red-600 font-bold animate-pulse">Excedido ${formatted}</span>`;
                // SONIDO solo una vez
                if (!sonidoLanzado) {
                    playPopSound();
                    sonidoLanzado = true;
                }
            } else if (diff <= 15 * 60 * 1000) {
                cronometroTextEl.innerHTML = `<span class="text-orange-700 font-bold">Restan ${formatted}</span>`;
                sonidoLanzado = false; // reset
            } else {
                cronometroTextEl.innerHTML = `<span class="text-slate-800 font-bold">Restan ${formatted}</span>`;
                sonidoLanzado = false;
            }
        }
        updateCronometro();
        setInterval(updateCronometro, 1000);
    }

    card.onclick = () => showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer);
    return card;
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
if (room.estado === "ocupada") {
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
// Assume 'supabase', 'hotelId', 'mostrarInfoModalGlobal', and 'setupButtonListener' are defined.
// Assume 'modalContainer' is a globally accessible DOM element for the modal.
// e.g., const modalContainer = document.getElementById('modalContainer');
// (Ensure modalContainer is styled to be a full-screen overlay when display:flex, as in the previous example)

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
setupButtonListener('btn-servicios-adicionales', async (btn, roomContext) => { // roomContext es 'room'
  // 1. Busca la reserva activa de la habitación
  const { data: reserva, error: errRes } = await supabase
    .from('reservas')
    .select('id, cliente_nombre, estado, monto_pagado') //Añadido monto_pagado
    .eq('habitacion_id', roomContext.id)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();

  if (errRes || !reserva) {
    mostrarInfoModalGlobal("No hay una reserva activa en esta habitación para asignar servicios.", "Sin reserva activa");
    return;
  }

  // 2. Busca servicios adicionales activos
  const { data: servicios, error: errServ } = await supabase
    .from('servicios_adicionales')
    .select('id, nombre, precio') // Asegúrate que 'precio' es el precio unitario del servicio
    .eq('hotel_id', hotelId) // hotelId del scope de showHabitacionOpcionesModal
    .eq('activo', true);

  if (errServ || !servicios || servicios.length === 0) {
    mostrarInfoModalGlobal("No hay servicios adicionales configurados en el hotel.", "Servicios no encontrados");
    return;
  }

  // 3. Renderiza el modal moderno y visual (como ya lo tenías)
  const modalContainerServicios = document.getElementById('modal-container'); // Usar el mismo modal container
  modalContainerServicios.innerHTML = "";
  modalContainerServicios.style.display = "flex";
  const modalContentServicios = document.createElement('div');
  modalContentServicios.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-10 m-auto border-4 border-green-100 font-['Montserrat']"; // Tomado de tu código
  modalContentServicios.innerHTML = `
    <h3 class="text-3xl font-black mb-7 text-green-700 text-center flex items-center justify-center gap-2 drop-shadow">
      <span>✨ Servicios Adicionales</span>
      <span class="text-2xl text-green-400">(${roomContext.nombre})</span>
    </h3>
    <form id="form-servicios-adicionales" class="space-y-7">
      <div>
        <label class="block mb-2 font-semibold text-lg text-gray-700">Selecciona los servicios a agregar:</label>
        <div class="grid gap-4">
          ${servicios.map((s, i) => `
            <div class="flex items-center gap-4 rounded-xl bg-green-50 p-4 shadow transition-all hover:scale-[1.03] hover:shadow-lg border-2 border-green-100">
              <input type="checkbox" id="servicio_${s.id}" name="servicio_ids" value="${s.id}" class="mr-2 accent-green-600 scale-125">
              <label for="servicio_${s.id}" class="flex-1 font-bold text-green-900 flex items-center gap-2 text-lg select-none">
                <span>${i % 2 === 0 ? '🧺' : '🕒'}</span>
                ${s.nombre}
                <span class="text-green-600 text-lg ml-3">${s.precio ? formatCurrency(s.precio) : '(Gratis)'}</span>
              </label>
              <input type="number" min="1" value="1" name="cantidad_${s.id}" class="border-2 border-green-200 rounded-lg w-16 px-2 py-1 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-green-400 transition">
            </div>
          `).join('')}
        </div>
      </div>
      <div>
        <label class="block mb-2 text-lg font-semibold text-gray-700">Nota especial (opcional):</label>
        <textarea name="nota_servicio" id="nota_servicio" class="w-full border-2 border-green-200 rounded-xl p-3 text-lg focus:outline-none focus:ring-2 focus:ring-green-400 transition" rows="2" placeholder="Observaciones..."></textarea>
      </div>
      <div class="flex gap-4 mt-8 justify-center">
        <button type="submit" class="flex-1 py-3 rounded-2xl bg-gradient-to-r from-green-400 to-green-700 text-white font-black text-xl shadow-lg hover:scale-105 hover:from-green-500 transition-all">Siguiente ➡️</button>
        <button type="button" id="btn-cancelar-servicios" class="flex-1 py-3 rounded-2xl bg-gray-200 text-gray-700 font-black text-xl shadow hover:scale-105 transition-all">Cancelar</button>
      </div>
      <div id="servicios-feedback" class="text-center mt-2 font-semibold text-red-500 hidden"></div>
    </form>
  `;
  modalContainerServicios.appendChild(modalContentServicios);

  modalContentServicios.querySelector('#btn-cancelar-servicios').onclick = () => {
    modalContainerServicios.style.display = "none";
    modalContainerServicios.innerHTML = '';
  };

  const formServicios = modalContentServicios.querySelector('#form-servicios-adicionales');
  const feedbackEl = modalContentServicios.querySelector('#servicios-feedback');

  if (formServicios) {
    formServicios.onsubmit = async (ev) => {
      ev.preventDefault();
      feedbackEl.classList.add('hidden');
      feedbackEl.textContent = '';

      const formData = new FormData(ev.target);
      const serviciosSeleccionados = servicios
        .filter(s => formData.getAll('servicio_ids').includes(String(s.id))) // Asegurar que la comparación sea de string con string
        .map(s => ({
          servicio_id: s.id,
          cantidad: Number(formData.get(`cantidad_${s.id}`)) || 1,
          precio: s.precio || 0, // Precio unitario del servicio
          nombre: s.nombre
        }));

      if (serviciosSeleccionados.length === 0) {
        feedbackEl.textContent = "Debes seleccionar al menos un servicio.";
        feedbackEl.classList.remove('hidden');
        return;
      }
      const nota = formData.get('nota_servicio') || '';
      const totalServicios = serviciosSeleccionados.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);

      mostrarInfoModalGlobal(`
        <div class="text-center p-5">
          <h4 class="text-2xl font-bold mb-3 text-blue-900">¿Cómo desea cobrar estos servicios?</h4>
          <div class="rounded-xl bg-blue-50 text-blue-700 p-3 mb-4 border text-lg">
            <div class="mb-2 font-semibold">Resumen:</div>
            <ul class="text-left ml-7 mb-2">
              ${serviciosSeleccionados.map(s => `<li>• ${s.nombre} <b>x${s.cantidad}</b> ${formatCurrency(s.precio * s.cantidad)}</li>`).join('')}
            </ul>
            <div class="mt-2 text-right font-bold text-xl">Total: ${formatCurrency(totalServicios)}</div>
          </div>
          <div class="mb-4 flex flex-col gap-3">
            <button id="btn-cobro-ahora-serv" class="button button-success py-3 rounded-xl text-xl font-bold flex-1">Cobrar AHORA y registrar en caja</button>
            <button id="btn-cobro-final-serv" class="button button-neutral py-3 rounded-xl text-xl font-bold flex-1">Cobrar al FINAL (sumar a la factura)</button>
          </div>
          <button id="btn-cancelar-cobro-servicio-serv" class="mt-2 text-sm text-gray-600 hover:text-red-500 underline">Cancelar</button>
        </div>
      `, "¿Cómo desea cobrar?", [], modalContainerServicios); // Usar el mismo modal container

      setTimeout(() => { // setTimeout para asegurar que el DOM del modal de opciones de cobro esté listo
        const modalActualOpcionesCobro = modalContainerServicios.querySelector('.bg-white'); // El dialog interno
         if (!modalActualOpcionesCobro) { console.error("No se encontró el dialog del modal de opciones de cobro"); return;}

        modalActualOpcionesCobro.querySelector('#btn-cancelar-cobro-servicio-serv').onclick = () => {
            // Simplemente cierra este modal, volviendo al de selección de servicios o cerrando todo si es necesario
            // Por ahora, cerramos el contenedor principal. Si quieres volver al modal anterior,
            // tendrías que guardar su contenido y restaurarlo.
            modalContainerServicios.style.display = "none";
            modalContainerServicios.innerHTML = '';
        };

        modalActualOpcionesCobro.querySelector('#btn-cobro-final-serv').onclick = async () => {
          // Solo guarda en servicios_x_reserva, marcando como pendiente o sin estado de pago explícito
          const serviciosParaInsertar = serviciosSeleccionados.map(item => ({
            hotel_id: hotelId,
            reserva_id: reserva.id,
            servicio_id: item.servicio_id,
            cantidad: item.cantidad,
            precio_cobrado: item.precio, // Guardar el precio unitario al que se ofreció
            nota: nota,
            estado_pago: 'pendiente' // O dejar null si tu lógica de "Ver Consumos" lo maneja
          }));

          const { error: errInsertFinal } = await supabase.from('servicios_x_reserva').insert(serviciosParaInsertar);

          if (errInsertFinal) {
            mostrarInfoModalGlobal(`Error al agregar servicios para cobro final: ${errInsertFinal.message}`, "Error Guardado", [], modalContainerServicios);
          } else {
            mostrarInfoModalGlobal(`
              <div class="text-center text-blue-700 font-semibold text-lg p-3">
                Servicios adicionales agregados (se cobrarán en la factura final).
                <div class="mt-4"> <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="this.closest('#modal-container').style.display='none'; this.closest('#modal-container').innerHTML='';">Entendido</button> </div>
              </div>`, "Guardado para Factura Final", [], modalContainerServicios);
            // No es necesario renderRooms aquí a menos que cambie el estado visual de la tarjeta
          }
        };

        modalActualOpcionesCobro.querySelector('#btn-cobro-ahora-serv').onclick = async () => {
          const { data: metodosPagoDB } = await supabase
            .from('metodos_pago')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activo', true);

          if (!metodosPagoDB || metodosPagoDB.length === 0) {
            mostrarInfoModalGlobal("No hay métodos de pago activos configurados.","Sin métodos de pago", [], modalContainerServicios);
            return;
          }

          let selectHtml = '<select id="select-metodo-pago-serv" class="input px-3 py-2 rounded-xl border border-gray-300 text-lg w-full mb-4">';
          metodosPagoDB.forEach(mp => { selectHtml += `<option value="${mp.id}">${mp.nombre}</option>`; });
          selectHtml += '</select>';

          mostrarInfoModalGlobal(`
            <div class="text-center p-4">
              <h4 class="text-xl font-bold mb-2 text-blue-900">Confirma el cobro</h4>
              <div class="mb-2 text-gray-600">Total Servicios: <span class="font-bold text-green-700 text-2xl">${formatCurrency(totalServicios)}</span></div>
              ${selectHtml}
              <div class="flex gap-2 justify-center mt-4">
                <button id="btn-confirmar-pago-servicio-final" class="button button-success px-5 py-2 text-lg rounded-xl font-bold flex-1">Confirmar Pago</button>
                <button id="btn-cancelar-pago-servicio-final" class="button button-neutral px-5 py-2 text-lg rounded-xl font-bold flex-1">Cancelar</button>
              </div>
            </div>
          `, "Método de Pago - Servicios", [], modalContainerServicios);

          setTimeout(() => { // setTimeout para el modal de confirmación de pago
            const modalActualConfirmacionPago = modalContainerServicios.querySelector('.bg-white'); // El dialog interno
            if (!modalActualConfirmacionPago) { console.error("No se encontró el dialog del modal de confirmación de pago"); return;}


            modalActualConfirmacionPago.querySelector('#btn-cancelar-pago-servicio-final').onclick = () => {
                modalContainerServicios.style.display = "none";
                modalContainerServicios.innerHTML = '';
            };

            modalActualConfirmacionPago.querySelector('#btn-confirmar-pago-servicio-final').onclick = async () => {
              const btnConfirmarFinal = modalActualConfirmacionPago.querySelector('#btn-confirmar-pago-servicio-final');
              btnConfirmarFinal.disabled = true;
              btnConfirmarFinal.textContent = "Procesando...";

              const metodoPagoIdSeleccionado = modalActualConfirmacionPago.querySelector('#select-metodo-pago-serv').value;
              const turnoIdActualServicios = turnoService.getActiveTurnId ? turnoService.getActiveTurnId() : turnoService.getActiveTurn();

              if (!turnoIdActualServicios) {
                mostrarInfoModalGlobal("No hay turno activo en caja.", "Caja cerrada", [], modalContainerServicios);
                btnConfirmarFinal.disabled = false;
                btnConfirmarFinal.textContent = "Confirmar Pago";
                return;
              }
              if (!metodoPagoIdSeleccionado) {
                alert("Debe seleccionar un método de pago.");
                btnConfirmarFinal.disabled = false;
                btnConfirmarFinal.textContent = "Confirmar Pago";
                return;
              }

              try {
                // A. Registrar el PAGO GENERAL de estos servicios en 'pagos_reserva'
                const { data: pagoReservaServiciosData, error: errPagoReservaServicios } = await supabase
                    .from('pagos_reserva')
                    .insert({
                        hotel_id: hotelId,
                        reserva_id: reserva.id, // 'reserva' es la reserva activa de la habitación
                        monto: totalServicios,
                        fecha_pago: new Date().toISOString(),
                        metodo_pago_id: metodoPagoIdSeleccionado,
                        usuario_id: currentUser.id, // 'currentUser' del scope de showHabitacionOpcionesModal
                        concepto: `Pago servicios adicionales Hab. ${roomContext.nombre}`
                    })
                    .select()
                    .single();

                if (errPagoReservaServicios) throw new Error(`Error registrando pago en pagos_reserva: ${errPagoReservaServicios.message}`);
                
                // B. Actualizar el monto_pagado en la tabla 'reservas'
                // Usamos el 'reserva.monto_pagado' que ya teníamos de la reserva activa
                const nuevoMontoPagadoReserva = (reserva.monto_pagado || 0) + totalServicios;
                const { error: errUpdateReservaPago } = await supabase
                    .from('reservas')
                    .update({ monto_pagado: nuevoMontoPagadoReserva })
                    .eq('id', reserva.id);

                if (errUpdateReservaPago) throw new Error(`Error actualizando monto pagado en reserva: ${errUpdateReservaPago.message}`);

                // C. Insertar los servicios individuales en 'servicios_x_reserva' y marcarlos como pagados
                const serviciosParaDb = serviciosSeleccionados.map(item => ({
                    hotel_id: hotelId,
                    reserva_id: reserva.id,
                    servicio_id: item.servicio_id,
                    cantidad: item.cantidad,
                    precio_cobrado: item.precio,
                    nota: nota,
                    estado_pago: 'pagado',
                    pago_reserva_id: pagoReservaServiciosData.id
                }));
                const { error: errItemsServicio } = await supabase.from('servicios_x_reserva').insert(serviciosParaDb);
                if (errItemsServicio) throw new Error(`Error insertando detalles de servicios: ${errItemsServicio.message}`);

                // D. Insertar el movimiento en caja
                const listaServiciosDesc = serviciosSeleccionados.map(item => `${item.nombre} x${item.cantidad}`).join(', ');
                const conceptoCajaServicios = `Servicios adic.: ${listaServiciosDesc} - Hab. ${roomContext.nombre}`;
                const { error: errorCajaServicios } = await supabase.from('caja').insert({
                    tipo: "ingreso",
                    monto: totalServicios,
                    concepto: conceptoCajaServicios,
                    hotel_id: hotelId,
                    usuario_id: currentUser.id,
                    turno_id: turnoIdActualServicios,
                    metodo_pago_id: metodoPagoIdSeleccionado,
                    fecha_movimiento: new Date().toISOString(),
                    reserva_id: reserva.id,
                    pago_reserva_id: pagoReservaServiciosData.id
                });
                if (errorCajaServicios) throw new Error(`Pago de servicios registrado, pero error en caja: ${errorCajaServicios.message}. Revise la caja.`);

                mostrarInfoModalGlobal(`
                  <div class="text-center text-green-700 font-semibold text-xl p-3">
                    Servicios cobrados y registrados correctamente.
                    <div class="mt-4"> <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="this.closest('#modal-container').style.display='none'; this.closest('#modal-container').innerHTML='';">Entendido</button> </div>
                  </div>`, "Cobro Exitoso", [], modalContainerServicios);
                // await renderRooms(mainAppContainer, supabase, currentUser, hotelId); // Podría ser necesario si el estado visual de la tarjeta cambia
              
              } catch (error) {
                console.error("Error en el proceso de pago de servicios:", error);
                mostrarInfoModalGlobal(error.message, "Error en Pago de Servicios", [], modalContainerServicios);
              } finally {
                btnConfirmarFinal.disabled = false;
                btnConfirmarFinal.textContent = "Confirmar Pago";
              }
            };
          }, 120);
        };
      }, 180);
    };
  } else {
    console.error("No se encontró el formulario de servicios adicionales en el DOM");
  }
});

  // ====== Alquilar Ahora (con bloqueo por reservas próximas)
  setupButtonListener('btn-alquilar-directo', async () => {
    // Verificar si hay una reserva en menos de 2 horas
    const ahora = new Date();
    const dosHorasDespues = new Date(ahora.getTime() + 2 * 60 * 60 * 1000);

    const { data: reservasFuturas, error } = await supabase
      .from('reservas')
      .select('id, fecha_inicio')
      .eq('habitacion_id', room.id)
      .eq('estado', 'reservada')
      .gte('fecha_inicio', ahora.toISOString())
      .lte('fecha_inicio', dosHorasDespues.toISOString());

    if (error) {
      mostrarInfoModalGlobal("Error consultando reservas futuras: " + error.message, "Error");
      return;
    }

    if (reservasFuturas && reservasFuturas.length > 0) {
      mostrarInfoModalGlobal("No puedes alquilar esta habitación porque hay una reserva programada en menos de 2 horas.", "Alquiler bloqueado");
      return;
    }

    
    // Si no hay reservas próximas, sí permite alquilar
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
 * 
 * @param {object} supabase - Instancia de supabase.
 * @param {string} reservaId - UUID de la reserva activa.
 * @param {string} habitacionId - UUID de la habitación.
 * @returns {Promise<boolean>} true si puede entregar, false si no.
 */
async function validarCargosPendientesAntesDeEntregar(supabase, reservaId, habitacionId) {
  // 1. Consumos de restaurante
  const { data: restPend, error: errRest } = await supabase
    .from('ventas_restaurante')
    .select('id, monto_total')
    .eq('reserva_id', reservaId)
    .eq('estado_pago', 'pendiente');
  // 2. Consumos de tienda
  const { data: tiendaPend, error: errTienda } = await supabase
    .from('ventas_tienda')
    .select('id, total_venta')
    .eq('reserva_id', reservaId)
    .eq('estado_pago', 'pendiente');
  // 3. Servicios adicionales
  const { data: servPend, error: errServ } = await supabase
    .from('servicios_x_reserva')
    .select('id')
    .eq('reserva_id', reservaId)
    .eq('estado_pago', 'pendiente'); // Agrega este campo si lo implementas en la tabla
  // 4. Estancia/habitación
  const { data: reserva, error: errRes } = await supabase
    .from('reservas')
    .select('monto_total, monto_pagado')
    .eq('id', reservaId)
    .single();
  const debeAlojamiento = reserva && (Number(reserva.monto_pagado) < Number(reserva.monto_total));
  const debeRestaurante = restPend?.length > 0;
  const debeTienda = tiendaPend?.length > 0;
  const debeServicios = servPend?.length > 0;

  if (debeRestaurante || debeTienda || debeServicios || debeAlojamiento) {
    // Mostrar modal con detalle de deuda
    let mensaje = "⚠️ No se puede entregar la habitación. Pendientes:\n";
    if (debeAlojamiento) mensaje += `- Estancia/habitación: $${Number(reserva.monto_total) - Number(reserva.monto_pagado)}\n`;
    if (debeRestaurante) mensaje += `- Consumos de restaurante: $${restPend.reduce((t, r) => t + Number(r.monto_total), 0)}\n`;
    if (debeTienda) mensaje += `- Consumos de tienda: $${tiendaPend.reduce((t, r) => t + Number(r.total_venta), 0)}\n`;
    if (debeServicios) mensaje += `- Servicios adicionales (ver detalle)\n`;
    // Puedes mejorar el modal aquí, por ahora simple:
    alert(mensaje);
    return false;
  }
  // No hay deudas, se puede entregar
  return true;
}

  // =================== BOTÓN ENTREGAR (igual que antes)
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

setupButtonListener('btn-ver-consumos', async (btn, roomContext) => {
  const modalContainerConsumos = document.getElementById('modal-container');
  if (!modalContainerConsumos) {
    console.error("El contenedor del modal principal 'modal-container' no se encontró.");
    // Considera mostrar un error al usuario aquí, ya que el modal no se puede abrir.
    // Por ejemplo, usando tu función mostrarInfoModalGlobal si está diseñada para funcionar sin un contenedor de modal preexistente.
    // O un simple alert:
    // alert("Error crítico: No se puede mostrar la ventana de consumos. Contenedor no encontrado.");
    return;
  }

  // 1. Buscar la reserva activa
  const { data: reserva, error: errRes } = await supabaseGlobal
    .from('reservas')
    .select('id, cliente_nombre, cedula, monto_total, fecha_inicio, fecha_fin, hotel_id, monto_pagado, habitacion_id') //Añadido cedula, habitacion_id
    .eq('habitacion_id', roomContext.id)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();

  if (errRes || !reserva) {
    mostrarInfoModalGlobal("No hay reserva activa con consumos para esta habitación.", "Consumos", [], modalContainerConsumos);
    return;
  }
  // Es buena idea tener el nombre de la habitación desde roomContext si 'reserva' no lo trae directamente
  reserva.habitacion_nombre = roomContext.nombre;


  // --- Consumo habitación (Estancia Original) ---
  const alojamientoCargo = {
    tipo: "Habitación",
    nombre: "Estancia Principal",
    cantidad: 1,
    subtotal: Number(reserva.monto_total) || 0, // Costo de la estancia SIN extensiones
    id: "hab", // Identificador especial
    estado_pago: "pendiente", // Se recalculará
    fecha: reserva.fecha_inicio // Para ordenamiento
  };

  // --- Consumos de tienda ---
  const { data: ventasTienda, error: errorTienda } = await supabaseGlobal
    .from('ventas_tienda')
    .select('id, total_venta, estado_pago, creado_en')
    .eq('reserva_id', reserva.id);

  if (errorTienda) {
      console.error("Error al obtener ventas de tienda:", errorTienda);
      // Considera mostrar un mensaje parcial o manejar el error
  }

  let cargosTienda = [];
  if (ventasTienda && ventasTienda.length) {
    cargosTienda = ventasTienda.map(v => ({
      tipo: "Tienda",
      nombre: `Venta Tienda #${v.id.slice(0, 6)}`,
      id: `vt_${v.id}`,
      cantidad: 1,
      subtotal: Number(v.total_venta) || 0,
      estado_pago: v.estado_pago || "pendiente",
      fecha: v.creado_en
    }));
  }

  // --- Consumos de restaurante ---
  const { data: ventasRest, error: errorRest } = await supabaseGlobal
    .from('ventas_restaurante')
    .select('id, monto_total, estado_pago, creado_en')
    .eq('reserva_id', reserva.id);

  if (errorRest) {
      console.error("Error al obtener ventas de restaurante:", errorRest);
  }

  let cargosRest = [];
  if (ventasRest && ventasRest.length) {
    cargosRest = ventasRest.map(v => ({
      tipo: "Restaurante",
      nombre: `Venta Rest. #${v.id.slice(0, 6)}`,
      id: `vr_${v.id}`,
      cantidad: 1,
      subtotal: Number(v.monto_total) || 0,
      estado_pago: v.estado_pago || "pendiente",
      fecha: v.creado_en
    }));
  }

  // --- Servicios Adicionales Y Extensiones ---
  const { data: serviciosYExtensiones, error: errorServiciosExt } = await supabaseGlobal
    .from('servicios_x_reserva')
    .select('id, servicio_id, cantidad, nota, estado_pago, creado_en, precio_cobrado, pago_reserva_id, descripcion_manual') // ASEGÚRATE QUE ESTAS COLUMNAS EXISTAN
    .eq('reserva_id', reserva.id);

  if (errorServiciosExt) {
      console.error("Error al obtener servicios y extensiones:", errorServiciosExt);
      mostrarInfoModalGlobal(`Error al obtener detalle de servicios/extensiones: ${errorServiciosExt.message}. Algunos cargos podrían no mostrarse.`, "Error de Datos", [], modalContainerConsumos);
      // No retornamos, para intentar mostrar el resto.
  }

  let cargosServiciosYExtensiones = [];
  let nombresServicios = {};

  if (serviciosYExtensiones && serviciosYExtensiones.length) {
    const servicioIds = [...new Set(serviciosYExtensiones.map(s => s.servicio_id).filter(Boolean))];
    if (servicioIds.length > 0) {
      const { data: infoServicios } = await supabaseGlobal
        .from('servicios_adicionales')
        .select('id, nombre')
        .in('id', servicioIds);
      if (infoServicios) {
        infoServicios.forEach(s => { nombresServicios[s.id] = s.nombre; });
      }
    }

    cargosServiciosYExtensiones = serviciosYExtensiones.map(s => {
      let nombreItem = '';
      let tipoItem = "Servicios";

      if (s.descripcion_manual) { // Prioridad a descripción manual para extensiones
        nombreItem = s.descripcion_manual;
        if (s.descripcion_manual.toLowerCase().includes('extensi')) {
          tipoItem = "Extensión";
        }
      } else if (s.servicio_id && nombresServicios[s.servicio_id]) {
        nombreItem = nombresServicios[s.servicio_id];
      } else {
        nombreItem = `Ítem #${s.id.slice(0,6)}`;
      }

      return {
        tipo: tipoItem,
        nombre: nombreItem,
        id: `sxr_${s.id}`, // Prefijo para servicios_x_reserva para unicidad
        cantidad: s.cantidad || 1,
        subtotal: s.precio_cobrado !== null ? Number(s.precio_cobrado) : 0, // USAR precio_cobrado
        estado_pago: s.estado_pago || "pendiente",
        fecha: s.creado_en,
        nota: s.nota || ""
      };
    });
  }

  let todosLosCargos = [alojamientoCargo, ...cargosTienda, ...cargosRest, ...cargosServiciosYExtensiones]
    .filter(c => c.id === 'hab' || c.subtotal > 0 || (c.subtotal === 0 && c.id !== 'hab' && c.tipo !== "Habitación" && c.nombre && c.nombre.toLowerCase() !== "seleccione duración"));


  const totalPagadoCalculado = Number(reserva.monto_pagado) || 0;

  todosLosCargos.sort((a, b) => {
    if (a.id === 'hab') return -1;
    if (b.id === 'hab') return 1;
    if (a.estado_pago === 'pagado' && b.estado_pago !== 'pagado') return -1;
    if (a.estado_pago !== 'pagado' && b.estado_pago === 'pagado') return 1;
    return new Date(a.fecha || 0) - new Date(b.fecha || 0);
  });

  let saldoAcumuladoParaAplicar = totalPagadoCalculado;
  todosLosCargos.forEach(cargo => {
    if (cargo.estado_pago === 'pagado') {
      // Ya está pagado, no hacer nada con el saldo acumulado aquí si viene de DB
    } else if (cargo.subtotal <= 0) {
        cargo.estado_pago = "N/A";
    } else if (saldoAcumuladoParaAplicar >= cargo.subtotal) {
      cargo.estado_pago = "pagado";
      saldoAcumuladoParaAplicar -= cargo.subtotal;
    } else if (saldoAcumuladoParaAplicar > 0 && saldoAcumuladoParaAplicar < cargo.subtotal) {
      cargo.estado_pago = "parcial";
      saldoAcumuladoParaAplicar = 0;
    } else {
      cargo.estado_pago = "pendiente";
    }
  });

  const totalDeTodosLosCargos = todosLosCargos.reduce((sum, c) => sum + Number(c.subtotal), 0);
  const saldoPendienteFinal = Math.max(0, totalDeTodosLosCargos - totalPagadoCalculado);

  let htmlConsumos = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:650px;margin:auto;" class="bg-white p-6 rounded-xl">
      <div class="flex justify-between items-center mb-3">
          <h3 style="font-size:1.3em;font-weight:bold;color:#1459ae;">🧾 Consumos: Hab. ${roomContext.nombre}</h3>
          <button id="btn-cerrar-modal-consumos-X" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button>
      </div>
      <div style="font-size:0.9em; margin-bottom:10px;">Cliente: <strong>${reserva.cliente_nombre}</strong></div>
      <div class="max-h-[50vh] overflow-y-auto pr-2 mb-4 border rounded-md">
          <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
            <thead class="sticky top-0 bg-slate-100 z-10">
              <tr style="background:#f1f5f9;">
                <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Tipo</th>
                <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Detalle</th>
                <th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;">Cant.</th>
                <th style="padding:8px;text-align:right;border-bottom:1px solid #e2e8f0;">Subtotal</th>
                <th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;">Estado</th>
              </tr>
            </thead>
            <tbody>`;
  todosLosCargos.forEach(c => {
    let colorEstado = "#6b7280";
    if (c.estado_pago === "pagado") colorEstado = "#16a34a";
    else if (c.estado_pago === "parcial") colorEstado = "#ca8a04";
    else if (c.estado_pago === "pendiente") colorEstado = "#dc2626";
    let textoEstado = c.estado_pago ? (c.estado_pago.charAt(0).toUpperCase() + c.estado_pago.slice(1)) : "N/A";
    if (c.estado_pago === "N/A" && c.subtotal === 0 && c.id !== 'hab') textoEstado = "Gratis";

    htmlConsumos += `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:6px;">${c.tipo}</td>
        <td style="padding:6px;">${c.nombre}${c.nota ? ` <i class="text-xs text-gray-500">(${c.nota})</i>` : ''}</td>
        <td style="padding:6px;text-align:center;">${c.cantidad}</td>
        <td style="padding:6px;text-align:right;">${formatCurrency(c.subtotal)}</td>
        <td style="padding:6px;text-align:center;font-weight:bold;color:${colorEstado};">${textoEstado}</td>
      </tr>`;
  });
  htmlConsumos += `
            </tbody>
          </table>
      </div>
      <div style="margin-top:14px;font-size:1.1em; text-align:right; padding-right:10px;">
        <div style="font-weight:bold;color:#1e40af;">Total Cargos: ${formatCurrency(totalDeTodosLosCargos)}</div>
        <div style="font-weight:bold;color:#059669;">Total Pagado: ${formatCurrency(totalPagadoCalculado)}</div>
        <div style="font-weight:bold;color:${saldoPendienteFinal > 0 ? '#dc2626' : '#16a34a'};">Saldo Pendiente: ${formatCurrency(saldoPendienteFinal)}</div>
      </div>
      <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-end p-1">
        ${saldoPendienteFinal > 0 ? `<button id="btn-cobrar-pendientes-consumos" class="button button-warning py-2.5 px-5 text-sm">Cobrar Saldo (${formatCurrency(saldoPendienteFinal)})</button>` : `<div class="text-green-600 font-bold text-lg p-2 text-center">¡Todo saldado! ✅</div>`}
        <button id="btn-imprimir-estado-cuenta-consumos" class="button button-neutral py-2.5 px-5 text-sm">Imprimir Estado</button>
        <button id="btn-cerrar-modal-consumos" class="button button-danger py-2.5 px-5 text-sm">Cerrar</button>
      </div>
    </div>`;

  modalContainerConsumos.innerHTML = htmlConsumos;
  modalContainerConsumos.style.display = "flex";

  setTimeout(() => {
    const modalDialogActual = modalContainerConsumos.querySelector('.bg-white');
    if (!modalDialogActual) { console.error("No se encontró el dialog interno del modal de consumos."); return; }
    const cerrarDesdeModal = () => { modalContainerConsumos.style.display = "none"; modalContainerConsumos.innerHTML = ''; };
    const btnCerrarX = modalDialogActual.querySelector('#btn-cerrar-modal-consumos-X');
    if (btnCerrarX) btnCerrarX.onclick = cerrarDesdeModal;
    const btnCerrar = modalDialogActual.querySelector('#btn-cerrar-modal-consumos');
    if (btnCerrar) btnCerrar.onclick = cerrarDesdeModal;

    const btnImprimirEstadoConsumos = modalDialogActual.querySelector('#btn-imprimir-estado-cuenta-consumos');
    if (btnImprimirEstadoConsumos) {
      btnImprimirEstadoConsumos.onclick = async () => {
        const consumosParaTicket = todosLosCargos.filter(c => c.id !== 'hab').map(c => ({ nombre: `${c.tipo} - ${c.nombre}`, cantidad: c.cantidad, precio: c.cantidad > 0 ? parseFloat((c.subtotal / c.cantidad).toFixed(2)) : Number(c.subtotal), total: Number(c.subtotal) }));
        const datosParaTicketCompleto = { habitacion: roomContext.nombre, cliente: reserva.cliente_nombre, fechaIngreso: reserva.fecha_inicio, fechaSalida: reserva.fecha_fin, estanciaPrincipal: Number(alojamientoCargo.subtotal), totalPagado: totalPagadoCalculado, saldoPendiente: saldoPendienteFinal, consumos: consumosParaTicket, totalConsumo: totalDeTodosLosCargos, otrosDatos: `Atendido por: ${currentUserGlobal?.email || 'Sistema'}` };
        await imprimirTicketHabitacion({ supabase: supabaseGlobal, hotelId: reserva.hotel_id, datosTicket: datosParaTicketCompleto, tipoDocumento: 'Estado de Cuenta Detallado' });
      };
    }

    const btnCobrarConsumosPend = modalDialogActual.querySelector('#btn-cobrar-pendientes-consumos');
    if (btnCobrarConsumosPend) {
      btnCobrarConsumosPend.onclick = async () => {
        const { data: metodosPagoDB } = await supabaseGlobal.from('metodos_pago').select('id, nombre').eq('hotel_id', reserva.hotel_id).eq('activo', true);
        let opcionesPagoHTML = metodosPagoDB?.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('') || '';
        modalDialogActual.innerHTML = `
          <div style="font-family:'Segoe UI',Arial,sans-serif; padding:10px;">
            <div class="flex justify-between items-center mb-4"><h4 style="font-size:1.2em;font-weight:bold;color:#1e3a8a;">💳 Registrar Pago de Saldo</h4><button id="btn-cerrar-cobro-saldo-X-submodal" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button></div>
            <div style="margin-bottom:12px; text-align:center;">Saldo pendiente: <strong style="color:#c2410c; font-size:1.1em;">${formatCurrency(saldoPendienteFinal)}</strong></div>
            <div class="space-y-3">
                <div><label for="montoPagoPendienteModal" class="block text-sm font-medium text-gray-700 mb-1">Monto a pagar:</label><input type="number" id="montoPagoPendienteModal" min="0.01" max="${saldoPendienteFinal.toFixed(2)}" value="${saldoPendienteFinal.toFixed(2)}" step="0.01" class="form-control mt-0"></div>
                <div><label for="pagoMetodoPendModal" class="block text-sm font-medium text-gray-700 mb-1">Método de pago:</label><select id="pagoMetodoPendModal" class="form-control mt-0"> <option value="">-- Seleccione --</option> ${opcionesPagoHTML} </select></div>
                <div><label for="tipoFacturaModal" class="block text-sm font-medium text-gray-700 mb-1">Documento a generar:</label><select id="tipoFacturaModal" class="form-control mt-0"><option value="pos">Recibo POS / Comprobante</option><option value="electronica">Factura Electrónica (si aplica)</option></select></div>
            </div>
            <div class="mt-5 flex flex-col sm:flex-row gap-3 justify-center">
                <button id="btn-registrar-pago-confirmado-saldo" class="button button-success flex-1 py-2.5 text-base">Registrar Pago</button>
                <button type="button" id="cancelar-pago-modal-saldo" class="button button-neutral flex-1 py-2.5 text-base">Cancelar</button>
            </div></div>`;
        const cerrarSubmodalCobro = () => { modalContainerConsumos.style.display = "none"; modalContainerConsumos.innerHTML = ''; };
        modalDialogActual.querySelector('#btn-cerrar-cobro-saldo-X-submodal').onclick = cerrarSubmodalCobro;
        modalDialogActual.querySelector('#cancelar-pago-modal-saldo').onclick = cerrarSubmodalCobro;
        const btnRegPagoConfirmadoSaldo = modalDialogActual.querySelector('#btn-registrar-pago-confirmado-saldo');
        if (btnRegPagoConfirmadoSaldo) {
          btnRegPagoConfirmadoSaldo.onclick = async () => {
            btnRegPagoConfirmadoSaldo.disabled = true; btnRegPagoConfirmadoSaldo.textContent = 'Procesando...';
            const montoPagarInput = modalDialogActual.querySelector('#montoPagoPendienteModal');
            const metodoPagoSelect = modalDialogActual.querySelector('#pagoMetodoPendModal');
            const tipoFacturaSelect = modalDialogActual.querySelector('#tipoFacturaModal');
            const montoPagar = Number(montoPagarInput?.value); const metodoPagoId = metodoPagoSelect?.value; const tipoFactura = tipoFacturaSelect?.value;
            let errorValidacion = null;
            if (!montoPagar || montoPagar <= 0 || montoPagar > saldoPendienteFinal + 0.001 ) errorValidacion = "Monto inválido.";
            else if (!metodoPagoId) errorValidacion = "Seleccione un método de pago.";
            if (errorValidacion) { alert(errorValidacion); btnRegPagoConfirmadoSaldo.disabled = false; btnRegPagoConfirmadoSaldo.textContent = 'Registrar Pago'; return; }
            try {
              const { data: pagoData, error: errPago } = await supabaseGlobal.from('pagos_reserva').insert([{ hotel_id: reserva.hotel_id, reserva_id: reserva.id, monto: montoPagar, fecha_pago: new Date().toISOString(), metodo_pago_id: metodoPagoId, usuario_id: currentUserGlobal?.id, concepto: `Pago Saldo Hab. ${roomContext.nombre} (Res. ${reserva.id.slice(0,8)})` }]).select().single();
              if (errPago) throw new Error(`Error registrando el pago: ${errPago.message}`);
              const turnoIdActual = turnoService.getActiveTurnId();
              if (!turnoIdActual) throw new Error("No hay un turno de caja activo para registrar este pago.");
              const { error: errCaja } = await supabaseGlobal.from('caja').insert([{ hotel_id: reserva.hotel_id, tipo: 'ingreso', monto: montoPagar, concepto: `[COBRO SALDO] Hab. ${roomContext.nombre} (Res. ${reserva.id.slice(0,8)})`, fecha_movimiento: new Date().toISOString(), metodo_pago_id: metodoPagoId, usuario_id: currentUserGlobal?.id, reserva_id: reserva.id, pago_reserva_id: pagoData.id, turno_id: turnoIdActual }]);
              if (errCaja) throw new Error(`Pago de saldo registrado (ID: ${pagoData.id}), pero error en caja: ${errCaja.message}. Por favor, revise la caja.`);
              const nuevoMontoPagadoEnReserva = totalPagadoCalculado + montoPagar;
              const {error: errUpdateMontoPagado} = await supabaseGlobal.from('reservas').update({ monto_pagado: nuevoMontoPagadoEnReserva }).eq('id', reserva.id);
              if(errUpdateMontoPagado) console.warn("Advertencia: Monto pagado en reserva no actualizado:", errUpdateMontoPagado.message);
              if (Math.abs(saldoPendienteFinal - montoPagar) < 0.01) {
                const updatePromisesItems = [];
                todosLosCargos.forEach(cargo => {
                  if (cargo.id !== 'hab' && (cargo.estado_pago === 'pendiente' || cargo.estado_pago === 'parcial') && cargo.subtotal > 0) {
                    let tableName = '', idOriginal = cargo.id;
                    if (cargo.tipo === 'Tienda') { tableName = 'ventas_tienda'; idOriginal = idOriginal.replace('vt_','');}
                    else if (cargo.tipo === 'Restaurante') { tableName = 'ventas_restaurante'; idOriginal = idOriginal.replace('vr_',''); }
                    else if (cargo.tipo === 'Servicios' || cargo.tipo === 'Extensión') { tableName = 'servicios_x_reserva'; idOriginal = idOriginal.replace('sxr_',''); }
                    if (tableName && idOriginal) updatePromisesItems.push(supabaseGlobal.from(tableName).update({ estado_pago: 'pagado' }).eq('id', idOriginal));
                  }
                });
                const results = await Promise.allSettled(updatePromisesItems);
                results.forEach(result => { if (result.status === 'rejected') console.warn("Error actualizando estado de pago de un ítem:", result.reason); });
              }
              let botonesExitoFinal = [];
              if (tipoFactura === 'pos') {
                botonesExitoFinal.push({ texto: "Imprimir Recibo POS", clase: "button-primary py-2 px-4 text-sm", noCerrar: false, accion: async () => { const datosRecibo = { habitacion: roomContext.nombre, cliente: reserva.cliente_nombre, fechaPago: pagoData.fecha_pago, montoPagado: montoPagar, metodoPagoNombre: metodoPagoSelect.options[metodoPagoSelect.selectedIndex].text, conceptoPago: `Abono/Pago Saldo Hab. ${roomContext.nombre}`, otrosDatos: `ID Trans.: ${pagoData.id.slice(0,8)}<br>Reserva ID: ${reserva.id.slice(0,8)}<br>Atendido por: ${currentUserGlobal?.email || 'Sistema'}` }; await imprimirTicketHabitacion({ supabase: supabaseGlobal, hotelId: reserva.hotel_id, datosTicket: datosRecibo, tipoDocumento: 'Recibo de Pago' }); await renderRooms(mainAppContainer, supabaseGlobal, currentUserGlobal, reserva.hotel_id); } });
              } else if (tipoFactura === 'electronica') {
                botonesExitoFinal.push({ texto: "Fact. Electrónica", clase: "button-success py-2 px-4 text-sm", noCerrar: true, accion: async () => { const btnFactElec = modalContainerConsumos.querySelector('.button-success'); if(btnFactElec) {btnFactElec.textContent = "Generando..."; btnFactElec.disabled = true;} await facturarElectronicaYMostrarResultado({ supabase: supabaseGlobal, hotelId: reserva.hotel_id, reserva: { ...reserva, habitacion_nombre: roomContext.nombre, monto_total: totalDeTodosLosCargos }, consumosTienda: cargosTienda, consumosRest: cargosRest, consumosServicios: cargosServiciosYExtensiones, metodoPagoIdLocal: metodoPagoId }); if(btnFactElec) {btnFactElec.textContent = "Fact. Electrónica"; btnFactElec.disabled = false;} } });
              }
              botonesExitoFinal.push({ texto: "Finalizar y Recargar Mapa", clase: "button-neutral py-2 px-4 text-sm", noCerrar: false, accion: async () => { await renderRooms(mainAppContainer, supabaseGlobal, currentUserGlobal, reserva.hotel_id); } });
              modalDialogActual.innerHTML = '';
              mostrarInfoModalGlobal(`Pago de ${formatCurrency(montoPagar)} registrado con éxito.`, "Pago de Saldo Exitoso", botonesExitoFinal, modalContainerConsumos);
            } catch (error) {
              console.error("Error en el proceso de pago de saldo:", error);
              mostrarInfoModalGlobal(error.message, "Error en Pago de Saldo", [{ texto: "Cerrar", clase:"button-danger py-2 px-4 text-sm", accion: cerrarSubmodalCobro}], modalContainerConsumos);
            } finally {
              if(btnRegPagoConfirmadoSaldo) { btnRegPagoConfirmadoSaldo.disabled = false; btnRegPagoConfirmadoSaldo.textContent = 'Registrar Pago'; }
            }
          }; // Fin onclick btnRegPagoConfirmadoSaldo
        } // Fin if (btnRegPagoConfirmadoSaldo)
      }; // Fin onclick btnCobrarConsumosPend
    } // Fin if (btnCobrarConsumosPend)
  }, 100); // Fin setTimeout principal para modal de consumos
}); // Fin setupButtonListener btn-ver-consumos


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

// --- Funciones auxiliares para crear opciones de Noches/Horas (CON PRECIOS CORRECTOS) ---
function crearOpcionesNochesConPersonalizada(horarios, maxNoches = 5, fechaBase = null, tarifaNocheUnica, room) {
    let opciones = [];
    const precioNocheHabitacion = room.precio || 20000; 

    let baseParaCalculo = fechaBase ? new Date(fechaBase) : new Date(); 
    
    for (let i = 1; i <= maxNoches; i++) {
        let fechaFinCalculada = new Date(baseParaCalculo);
        const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
        fechaFinCalculada.setHours(checkoutH, checkoutM, 0, 0);

        if (baseParaCalculo >= fechaFinCalculada) {
            fechaFinCalculada.setDate(fechaFinCalculada.getDate() + 1);
        }
        fechaFinCalculada.setDate(fechaFinCalculada.getDate() + (i - 1));
        
        let precioTotalNoches = 0;
        if (tarifaNocheUnica && typeof tarifaNocheUnica.precio === 'number') {
            precioTotalNoches = tarifaNocheUnica.precio * i;
        } else {
            precioTotalNoches = precioNocheHabitacion * i; 
        }

        opciones.push({
            noches: i,
            label: `${i} noche${i > 1 ? 's' : ''} (hasta ${formatDateTime(fechaFinCalculada, undefined, {dateStyle:'short'})} ${horarios.checkout}) - ${formatCurrency(precioTotalNoches)}`,
            fechaFin: fechaFinCalculada,
            precioCalculado: precioTotalNoches 
        });
    }
    opciones.push({ noches: "personalizada", label: "Personalizada (N noches)...", precioCalculado: 0 });
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

// --- Función central para calcular detalles de la estancia (CON PRECIOS CORRECTOS) ---
function calcularDetallesEstancia(dataForm, room, tiempos, horarios, tarifaNocheUnica) {
    let finAt;
    let precioCalculadoSinImpuestos = 0; // Este será el precio antes de sumar impuestos, o el precio total si ya los incluye
    let descripcionEstancia = "No definida";
    let tipoCalculo = null;
    let cantidadCalculo = 0;

    const cantidadPersonas = dataForm.cantidad_personas ? parseInt(dataForm.cantidad_personas) : (room.capacidad_base || 2);
    const precioAdicionalPorHuesped = room.precio_adicional_huesped || 0;
    const capacidadBase = room.capacidad_base || 2; // Asumimos 2 si no está definido
    let costoHuespedesAdicionales = 0;

    if (cantidadPersonas > capacidadBase) {
        costoHuespedesAdicionales = (cantidadPersonas - capacidadBase) * precioAdicionalPorHuesped;
    }

    const precioNocheHabitacionFallback = room.precio || 0;

    const nochesSeleccionadasInput = dataForm.noches_personalizada && dataForm.noches_personalizada.trim() !== ''
        ? dataForm.noches_personalizada
        : dataForm.noches;

    const nochesSeleccionadas = nochesSeleccionadasInput && nochesSeleccionadasInput !== "personalizada"
        ? parseInt(nochesSeleccionadasInput)
        : 0;

    const minutosSeleccionados = dataForm.horas ? parseInt(dataForm.horas) : 0;
    const inicioAt = new Date();

    if (nochesSeleccionadas > 0) {
        tipoCalculo = 'noches';
        cantidadCalculo = nochesSeleccionadas;
        let fechaSalida = new Date(inicioAt);
        const [checkoutH, checkoutM] = (horarios.checkout || "12:00").split(':').map(Number);
        fechaSalida.setHours(checkoutH, checkoutM, 0, 0);

        if (inicioAt >= fechaSalida) {
            fechaSalida.setDate(fechaSalida.getDate() + 1);
        }
        fechaSalida.setDate(fechaSalida.getDate() + (nochesSeleccionadas - 1));
        finAt = fechaSalida;

        let precioBaseNoches;
        if (tarifaNocheUnica && typeof tarifaNocheUnica.precio === 'number' && tarifaNocheUnica.precio > 0) {
            precioBaseNoches = tarifaNocheUnica.precio * nochesSeleccionadas;
        } else {
            precioBaseNoches = precioNocheHabitacionFallback * nochesSeleccionadas;
        }
        precioCalculadoSinImpuestos = precioBaseNoches + (costoHuespedesAdicionales * nochesSeleccionadas); // Huéspedes adicionales por noche
        descripcionEstancia = `${nochesSeleccionadas} noche${nochesSeleccionadas > 1 ? 's' : ''} (hasta ${formatDateTime(finAt, undefined, { dateStyle: 'short', timeStyle: 'short' })})`;

    } else if (minutosSeleccionados > 0) {
        tipoCalculo = 'horas';
        cantidadCalculo = minutosSeleccionados;
        finAt = new Date(inicioAt.getTime() + minutosSeleccionados * 60 * 1000);
        const tiempoSeleccionado = tiempos.find(t => t.minutos === minutosSeleccionados && t.tipo_unidad !== 'noche');

        let precioHoras = 0;
        if (tiempoSeleccionado) {
            if ((tiempoSeleccionado.precio === null || tiempoSeleccionado.precio === 0) && typeof tiempoSeleccionado.precio_adicional === 'number') {
                precioHoras = tiempoSeleccionado.precio_adicional;
            } else if (typeof tiempoSeleccionado.precio === 'number') {
                precioHoras = tiempoSeleccionado.precio;
            }
        }

        if (precioHoras > 0) {
            precioCalculadoSinImpuestos = precioHoras + costoHuespedesAdicionales; // Huéspedes adicionales se suman una vez para estancias por horas
            descripcionEstancia = `${formatHorasMin(minutosSeleccionados)}`;
        } else {
            precioCalculadoSinImpuestos = 0 + costoHuespedesAdicionales;
            descripcionEstancia = `${formatHorasMin(minutosSeleccionados)} - Precio base no definido`;
        }
    } else {
        finAt = new Date(inicioAt);
        precioCalculadoSinImpuestos = 0;
        descripcionEstancia = "Seleccione duración";
    }

    if (!finAt || isNaN(finAt.getTime())) {
        console.error("Fecha de fin inválida calculada:", finAt, "Datos de formulario:", dataForm);
        finAt = new Date(inicioAt);
        if (descripcionEstancia === "Seleccione duración") precioCalculadoSinImpuestos = 0;
    }

    // Aplicar impuestos según configuración global
    let montoImpuesto = 0;
    let precioFinalConImpuestos = precioCalculadoSinImpuestos;
    let precioBaseParaCalculoImpuesto = precioCalculadoSinImpuestos;

    const porcentajeImpuesto = parseFloat(hotelConfigGlobal?.porcentaje_impuesto_principal);
    const impuestosIncluidos = hotelConfigGlobal?.impuestos_incluidos_en_precios === true;

    if (porcentajeImpuesto > 0) {
        if (impuestosIncluidos) {
            // El precioCalculadoSinImpuestos YA incluye el impuesto. Necesitamos desglosarlo.
            // PrecioBase = PrecioConImpuesto / (1 + (PorcentajeImpuesto / 100))
            precioBaseParaCalculoImpuesto = precioCalculadoSinImpuestos / (1 + (porcentajeImpuesto / 100));
            montoImpuesto = precioCalculadoSinImpuestos - precioBaseParaCalculoImpuesto;
            // precioFinalConImpuestos sigue siendo precioCalculadoSinImpuestos
        } else {
            // El precioCalculadoSinImpuestos NO incluye el impuesto. Necesitamos sumarlo.
            montoImpuesto = precioCalculadoSinImpuestos * (porcentajeImpuesto / 100);
            precioFinalConImpuestos = precioCalculadoSinImpuestos + montoImpuesto;
            // precioBaseParaCalculoImpuesto sigue siendo precioCalculadoSinImpuestos
        }
    }

    return {
        inicioAt,
        finAt,
        precioTotal: Math.round(precioFinalConImpuestos), // Este es el que el cliente paga
        precioBase: Math.round(precioBaseParaCalculoImpuesto), // Este es el precio antes de impuestos (o desglosado)
        montoImpuesto: Math.round(montoImpuesto), // El valor del impuesto
        descripcionEstancia,
        tipoCalculo,
        cantidadCalculo
    };
}
// === FACTURACIÓN ELECTRÓNICA UNIVERSAL ===
// === FACTURACIÓN ELECTRÓNICA UNIVERSAL (CORREGIDA Y COMPLETA) ===
// =========================================================================================
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





// ===================== MODAL DE ALQUILER (POS STYLE - COMPLETO Y CORREGIDO) =====================
// js/modules/mapa_habitaciones/mapa_habitaciones.js
// ... (asegúrate que las variables globales como supabaseGlobal, currentUserGlobal, hotelIdGlobal, hotelConfigGlobal, mainAppContainer están definidas y accesibles)
// ... (asegúrate que funciones como getHorariosHotel, getTiemposEstancia, getMetodosPago, crearOpcionesNochesConPersonalizada, crearOpcionesHoras, calcularDetallesEstancia, formatCurrency, mostrarInfoModalGlobal, renderRooms, turnoService.getActiveTurnId() estén definidas y accesibles)

async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
        console.error("Contenedor de modal principal 'modal-container' no encontrado.");
        alert("Error crítico: No se puede mostrar el modal de alquiler.");
        return;
    }
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = ""; // Limpiar contenido anterior

    let horarios, tiempos, metodosPagoDisponibles;
    try {
        // Usar las instancias globales o los parámetros. Aquí se usan parámetros.
        [horarios, tiempos, metodosPagoDisponibles] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
    } catch (err) {
        console.error("Error cargando datos para modal de alquiler:", err);
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler. Intente de nuevo.", "Error de Carga", [], modalContainer);
        return;
    }

    const pagoMixtoOpcion = { id: "mixto", nombre: "Pago Mixto" };
    metodosPagoDisponibles = metodosPagoDisponibles || [];
    metodosPagoDisponibles = [pagoMixtoOpcion, ...metodosPagoDisponibles.filter(mp => mp.id !== "mixto")];

    const tarifaNocheUnica = tiempos.find(t => t.tipo_unidad === 'noche' && t.cantidad_unidad === 1);
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, tarifaNocheUnica, room);
    const opcionesHoras = crearOpcionesHoras(tiempos);

    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-auto animate-fade-in-up overflow-hidden"; // Clase base del modal

    // HTML Mejorado (sin comentarios HTML literales)
    modalContent.innerHTML = `
    <div class="flex flex-col md:flex-row">
        <div class="w-full md:w-3/5 p-6 sm:p-8 space-y-6 bg-slate-50 md:rounded-l-xl">
            <div class="flex justify-between items-center">
                <h3 class="text-2xl md:text-3xl font-bold text-blue-700">Alquilar: ${room.nombre}</h3>
                <button id="close-modal-alquilar" class="text-gray-500 hover:text-red-600 text-3xl leading-none focus:outline-none">&times;</button>
            </div>
            <form id="alquilar-form-pos" class="space-y-5">
                <div>
                    <label for="cliente_nombre" class="form-label">Nombre del Huésped</label>
                    <input required name="cliente_nombre" id="cliente_nombre" class="form-control" maxlength="60" placeholder="Nombre completo">
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label for="cedula" class="form-label">Cédula / ID</label>
                        <input required name="cedula" id="cedula" class="form-control" maxlength="20" placeholder="Número de identificación">
                    </div>
                    <div>
                        <label for="telefono" class="form-label">Teléfono</label>
                        <input required name="telefono" id="telefono" type="tel" class="form-control" maxlength="20" placeholder="Número de contacto">
                    </div>
                </div>
                <div>
                    <label class="form-label">Duración de Estancia</label>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 items-end">
                        <div class="flex flex-col">
                            <label for="select-noches" class="text-xs text-gray-600 mb-1">Noches:</label>
                            <select name="noches" id="select-noches" class="form-control">
                                <option value="">-- Seleccionar Noches --</option>
                                ${opcionesNoches.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}
                            </select>
                        </div>
                        <div class="flex flex-col" id="container-noches-personalizada" style="display:none;">
                            <label for="input-noches-personalizada" class="text-xs text-gray-600 mb-1">Noches (Personalizado):</label>
                            <input type="number" min="1" max="365" step="1" placeholder="N°" id="input-noches-personalizada" name="noches_personalizada" class="form-control"/>
                        </div>
                        <div class="flex flex-col">
                            <label for="select-horas" class="text-xs text-gray-600 mb-1">Horas:</label>
                            <select name="horas" id="select-horas" class="form-control">
                                <option value="">-- Seleccionar Horas --</option>
                                ${opcionesHoras.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                    <div>
                        <label for="cantidad_huespedes" class="form-label">Cant. Huéspedes</label>
                        <input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" max="${room.capacidad_maxima || 10}" value="${room.capacidad_base || 1}">
                    </div>
                    <div id="metodo-pago-container-alquiler">
                        <label for="metodo_pago_id" class="form-label">Método de Pago</label>
                        <select required name="metodo_pago_id" id="metodo_pago_id" class="form-control">
                            ${metodosPagoDisponibles.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="pt-4">
                    <button type="submit" id="btn-alquilar-hab" class="button button-success w-full py-3 text-lg font-bold rounded-lg">Confirmar y Registrar Alquiler</button>
                </div>
            </form>
        </div>
        <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 sm:p-8 flex flex-col justify-between md:rounded-r-xl">
            <div>
                <h4 class="text-xl sm:text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-5 text-cyan-400">Resumen del Alquiler</h4>
                <div class="space-y-3 text-sm sm:text-base">
                    <div class="flex justify-between items-center"><span class="text-slate-300">Habitación:</span><strong id="ticket-room-name" class="text-right text-slate-100">${room.nombre}</strong></div>
                    <div class="flex justify-between items-center"><span class="text-slate-300">Tipo:</span><strong class="text-right text-slate-100">${room.tipo || 'N/A'}</strong></div>
                    <hr class="border-slate-700 my-3">
                    <div class="flex justify-between items-center"><span class="text-slate-300">Estancia:</span><strong id="ticket-stay-description" class="text-right text-slate-100">Seleccione duración</strong></div>
                    <div class="flex justify-between items-center"><span id="ticket-price-label" class="text-slate-300">Precio Base:</span><strong id="ticket-stay-price" class="text-right text-slate-100">${formatCurrency(0)}</strong></div>
                    <div class="flex justify-between items-center" id="fila-impuesto-resumen" style="display: none;"><span id="ticket-stay-tax-name" class="text-slate-300">Impuesto:</span><strong id="ticket-stay-tax-value" class="text-right text-slate-100">${formatCurrency(0)}</strong></div>
                </div>
            </div>
            <div class="border-t-2 border-cyan-500 pt-4 mt-6">
                <div class="flex justify-between items-baseline"><span class="text-xl font-semibold text-green-400">TOTAL:</span><span id="ticket-total-price" class="text-3xl font-bold text-green-300">${formatCurrency(0)}</span></div>
            </div>
        </div>
    </div>`;
    modalContainer.appendChild(modalContent);

    const metodoPagoContainerEl = modalContent.querySelector('#metodo-pago-container-alquiler');
    const selectMetodoPagoEl = modalContent.querySelector('#metodo_pago_id');

    if (hotelConfigGlobal && hotelConfigGlobal.cobro_al_checkin === false) {
        if (metodoPagoContainerEl) metodoPagoContainerEl.style.display = 'none';
        if (selectMetodoPagoEl) selectMetodoPagoEl.removeAttribute('required');
    } else {
        if (metodoPagoContainerEl) metodoPagoContainerEl.style.display = 'block';
        if (selectMetodoPagoEl) selectMetodoPagoEl.setAttribute('required', 'required');
    }

    const formEl = modalContent.querySelector('#alquilar-form-pos');
    const selectNochesEl = modalContent.querySelector('#select-noches');
    const inputNochesPersonalizadaEl = modalContent.querySelector('#input-noches-personalizada');
    const containerNochesPersonalizadaEl = modalContent.querySelector('#container-noches-personalizada');
    const selectHorasEl = modalContent.querySelector('#select-horas');
    
    const ticketDescEl = modalContent.querySelector('#ticket-stay-description');
    const ticketPriceLabelEl = modalContent.querySelector('#ticket-price-label');
    const ticketPriceEl = modalContent.querySelector('#ticket-stay-price');
    const filaImpuestoResumenEl = modalContent.querySelector('#fila-impuesto-resumen');
    const ticketTaxNameEl = modalContent.querySelector('#ticket-stay-tax-name');
    const ticketTaxValueEl = modalContent.querySelector('#ticket-stay-tax-value');
    const ticketTotalEl = modalContent.querySelector('#ticket-total-price');

    function actualizarResumenTicketAlquiler() {
        if (!formEl) return;
        const formDataValues = Object.fromEntries(new FormData(formEl));
        const detalles = calcularDetallesEstancia(formDataValues, room, tiempos, horarios, tarifaNocheUnica);

        if (ticketDescEl) ticketDescEl.textContent = detalles.descripcionEstancia;
        if (ticketTotalEl) ticketTotalEl.textContent = formatCurrency(detalles.precioTotal);

        if (ticketPriceEl && filaImpuestoResumenEl && ticketTaxNameEl && ticketTaxValueEl && ticketPriceLabelEl && hotelConfigGlobal) {
            const porcentajeImpuestoConfig = parseFloat(hotelConfigGlobal.porcentaje_impuesto_principal);
            if (detalles.montoImpuesto > 0 && porcentajeImpuestoConfig > 0) {
                ticketPriceLabelEl.textContent = "Precio Base:";
                ticketPriceEl.textContent = formatCurrency(detalles.precioBase);
                ticketTaxNameEl.textContent = `${hotelConfigGlobal.nombre_impuesto_principal || 'Impuesto'} (${porcentajeImpuestoConfig}%):`;
                ticketTaxValueEl.textContent = formatCurrency(detalles.montoImpuesto);
                filaImpuestoResumenEl.style.display = 'flex';
            } else {
                ticketPriceLabelEl.textContent = "Precio Estancia:";
                ticketPriceEl.textContent = formatCurrency(detalles.precioTotal); // Muestra el total si no hay desglose
                filaImpuestoResumenEl.style.display = 'none';
            }
        } else {
            if(ticketPriceEl && detalles) ticketPriceEl.textContent = formatCurrency(detalles.precioTotal); // Fallback
            if(filaImpuestoResumenEl) filaImpuestoResumenEl.style.display = 'none';
        }
    }

    if (selectNochesEl) selectNochesEl.onchange = () => {
        if (selectNochesEl.value === "personalizada") {
            if(containerNochesPersonalizadaEl) containerNochesPersonalizadaEl.style.display = "block";
            if(inputNochesPersonalizadaEl) { inputNochesPersonalizadaEl.required = true; inputNochesPersonalizadaEl.focus(); }
        } else {
            if(containerNochesPersonalizadaEl) containerNochesPersonalizadaEl.style.display = "none";
            if(inputNochesPersonalizadaEl) { inputNochesPersonalizadaEl.required = false; inputNochesPersonalizadaEl.value = '';}
        }
        if (selectNochesEl.value && selectHorasEl) selectHorasEl.value = "";
        actualizarResumenTicketAlquiler();
    };
    if (inputNochesPersonalizadaEl) inputNochesPersonalizadaEl.oninput = actualizarResumenTicketAlquiler;
    if (selectHorasEl) selectHorasEl.onchange = () => {
        if (selectHorasEl.value && selectNochesEl) {
            selectNochesEl.value = "";
            if(containerNochesPersonalizadaEl) containerNochesPersonalizadaEl.style.display = "none";
            if(inputNochesPersonalizadaEl) { inputNochesPersonalizadaEl.required = false; inputNochesPersonalizadaEl.value = ''; }
        }
        actualizarResumenTicketAlquiler();
    };
    actualizarResumenTicketAlquiler();

    modalContent.querySelector('#close-modal-alquilar').onclick = () => {
        modalContainer.style.display = "none"; modalContainer.innerHTML = '';
    };

    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const submitBtn = formEl.querySelector('#btn-alquilar-hab');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Registrando..."; }

        try {
            const formDataAlquiler = Object.fromEntries(new FormData(formEl));
            const detallesEstancia = calcularDetallesEstancia(formDataAlquiler, room, tiempos, horarios, tarifaNocheUnica);

            if (detallesEstancia.precioTotal <= 0 && !detallesEstancia.tipoCalculo) {
                alert('Debe seleccionar una duración válida para la estancia.');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                return;
            }

            const { data: reservasAnteriores } = await supabase.from('reservas')
                .select('id').eq('habitacion_id', room.id).in('estado', ['activa', 'ocupada']);
            if (reservasAnteriores && reservasAnteriores.length > 0) {
                for (const resAnterior of reservasAnteriores) {
                    await supabase.from('reservas').update({ estado: 'finalizada_auto' }).eq('id', resAnterior.id);
                    await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', resAnterior.id);
                }
            }
            await supabase.from('cronometros').update({ activo: false })
                .eq('habitacion_id', room.id).eq('activo', true).is('reserva_id', null);

            const metodoPagoSeleccionadoAlquiler = formDataAlquiler.metodo_pago_id;

            // =====================================================================
            // DEFINICIÓN DE registrarReservaYMovimientosCaja (ANIDADA)
            // =====================================================================
            async function registrarReservaYMovimientosCaja({ pagos, isMixto, formDataOriginal }) {
                const seCobraAlCheckinLocal = hotelConfigGlobal?.cobro_al_checkin === true;
                let metodoPagoReservaFinal = null;
                if (seCobraAlCheckinLocal && !isMixto && pagos && pagos.length > 0) {
                    metodoPagoReservaFinal = pagos[0].metodo_pago_id;
                }

                const reservaInsertData = {
                    cliente_nombre: formDataOriginal.cliente_nombre,
                    cedula: formDataOriginal.cedula,
                    telefono: formDataOriginal.telefono,
                    habitacion_id: room.id,
                    hotel_id: hotelId, // Usar el hotelId del parámetro de showAlquilarModal
                    fecha_inicio: detallesEstancia.inicioAt.toISOString(),
                    fecha_fin: detallesEstancia.finAt.toISOString(),
                    monto_total: detallesEstancia.precioTotal,
                    estado: "activa",
                    cantidad_huespedes: Number(formDataOriginal.cantidad_huespedes),
                    metodo_pago_id: metodoPagoReservaFinal,
                    monto_pagado: 0 // Inicializar en 0
                };
                
                let totalMontoPagadoInicial = 0;
                if (seCobraAlCheckinLocal && pagos && pagos.length > 0) {
                     totalMontoPagadoInicial = pagos.reduce((sum, p) => sum + Number(p.monto), 0);
                }
                reservaInsertData.monto_pagado = totalMontoPagadoInicial;


                const { data: reservaData, error: errRes } = await supabase.from('reservas')
                    .insert([reservaInsertData]).select().single();
                if (errRes) throw new Error("Error creando reserva: " + errRes.message);
                
                const reservaIdCreada = reservaData.id;

                if (seCobraAlCheckinLocal && pagos && pagos.length > 0 && detallesEstancia.precioTotal > 0) {
                    const turnoIdActualLocal = turnoService.getActiveTurnId();
                    if (!turnoIdActualLocal) {
                        throw new Error("ACCIÓN BLOQUEADA: No hay turno activo para registrar el pago en caja.");
                    }
                    for (const pago of pagos) {
                        const { data: pagoReservaData, error: errPagoReserva } = await supabase.from('pagos_reserva').insert({
                            hotel_id: hotelId, reserva_id: reservaIdCreada, monto: Number(pago.monto),
                            fecha_pago: new Date().toISOString(), metodo_pago_id: pago.metodo_pago_id,
                            usuario_id: currentUser?.id // Usar currentUser del parámetro de showAlquilarModal
                        }).select().single();
                        if (errPagoReserva) console.error("Error registrando en pagos_reserva:", errPagoReserva);

                        if (pagoReservaData) { // Solo registrar en caja si el pago_reserva fue exitoso
                            const { error: errCaja } = await supabase.from('caja').insert({
                                hotel_id: hotelId, tipo: 'ingreso', monto: Number(pago.monto),
                                concepto: `Alquiler INICIAL ${room.nombre} (${detallesEstancia.descripcionEstancia}) - ${formDataOriginal.cliente_nombre || 'Cliente Directo'}`,
                                fecha_movimiento: detallesEstancia.inicioAt.toISOString(),
                                usuario_id: currentUser?.id, reserva_id: reservaIdCreada,
                                metodo_pago_id: pago.metodo_pago_id, turno_id: turnoIdActualLocal,
                                pago_reserva_id: pagoReservaData.id // Enlazar con el pago_reserva
                            });
                            if (errCaja) console.error("Error registrando en caja:", errCaja);
                        }
                    }
                } else if (!seCobraAlCheckinLocal) {
                    console.log(`Política de cobro es 'Al Salir'. No se registra pago para estancia ${reservaIdCreada} en este momento.`);
                }

                await supabase.from('cronometros').insert([{
                    hotel_id: hotelId, reserva_id: reservaIdCreada, habitacion_id: room.id,
                    fecha_inicio: detallesEstancia.inicioAt.toISOString(),
                    fecha_fin: detallesEstancia.finAt.toISOString(), activo: true,
                }]);
                await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

                modalContainer.style.display = "none"; modalContainer.innerHTML = '';
                await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
            }
            // =====================================================================
            // FIN DE DEFINICIÓN DE registrarReservaYMovimientosCaja
            // =====================================================================

            // =====================================================================
            // DEFINICIÓN DE mostrarModalPagosMixtos (ANIDADA)
            // =====================================================================
            function mostrarModalPagosMixtos(totalAPagar, metodosDisponibles, callbackConfirmacion) {
                const body = document.body;
                let pagosRegistrados = [{ metodo_pago_id: '', monto: '' }];
                const modalElemento = document.createElement('div');
                modalElemento.className = "fixed inset-0 bg-black/50 z-[10000] flex items-center justify-center p-4";
                modalElemento.style.fontFamily = "'Segoe UI', Arial, sans-serif";
                
                modalElemento.innerHTML = `
                    <div class="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-auto animate-fade-in-up">
                        <h3 class="text-xl font-bold text-blue-700 mb-5 text-center">Registrar Pagos Mixtos</h3>
                        <div class="mb-3 text-center">Total a cubrir: <strong class="text-blue-600 text-lg">${formatCurrency(totalAPagar)}</strong></div>
                        <form id="formPagosMixtosInterno" class="space-y-3">
                            <div id="campos-pagos-mixtos-container" class="space-y-3 mb-3"></div>
                            <div class="mb-4">
                                <button type="button" id="btn-agregar-otro-pago" class="text-sm text-blue-600 hover:text-blue-800 font-semibold flex items-center">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" /></svg>
                                    Agregar otro método de pago
                                </button>
                            </div>
                            <div id="mensaje-error-pagos-mixtos" class="text-sm text-red-600 mb-4 min-h-[1.2em]"></div>
                            <div class="flex gap-3 justify-center mt-5">
                                <button type="submit" class="button button-success py-2.5 px-6 text-base">Registrar Pagos</button>
                                <button type="button" id="btn-cancelar-pagos-mixtos" class="button button-neutral py-2.5 px-6 text-base">Cancelar</button>
                            </div>
                        </form>
                    </div>`;
                body.appendChild(modalElemento);

                const camposContainer = modalElemento.querySelector('#campos-pagos-mixtos-container');
                const mensajeErrorEl = modalElemento.querySelector('#mensaje-error-pagos-mixtos');

                function renderizarCamposDePago() {
                    camposContainer.innerHTML = '';
                    pagosRegistrados.forEach((pagoItem, index) => {
                        const divPago = document.createElement('div');
                        divPago.className = "pago-mixto-item flex items-center gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200";
                        divPago.innerHTML = `
                            <select required name="metodo_pago_id_mixto" data-index="${index}" class="form-control flex-grow" style="min-width: 120px;">
                                <option value="">-- Método --</option>
                                ${metodosDisponibles.map(mp => `<option value="${mp.id}" ${pagoItem.metodo_pago_id === mp.id ? 'selected' : ''}>${mp.nombre}</option>`).join('')}
                            </select>
                            <input required type="number" name="monto_mixto" data-index="${index}" min="0.01" step="0.01" class="form-control w-32 text-right" placeholder="Monto" value="${pagoItem.monto || ''}">
                            ${pagosRegistrados.length > 1 ? `<button type="button" data-index="${index}" class="btn-eliminar-pago-mixto text-red-500 hover:text-red-700 font-bold text-xl px-2">&times;</button>` : ''}
                        `;
                        camposContainer.appendChild(divPago);
                    });

                    camposContainer.querySelectorAll('.btn-eliminar-pago-mixto').forEach(btn => {
                        btn.onclick = (e) => { pagosRegistrados.splice(Number(e.target.dataset.index), 1); renderizarCamposDePago(); };
                    });
                    camposContainer.querySelectorAll('select[name="metodo_pago_id_mixto"]').forEach(sel => {
                        sel.onchange = (e) => pagosRegistrados[Number(e.target.dataset.index)].metodo_pago_id = e.target.value;
                    });
                    camposContainer.querySelectorAll('input[name="monto_mixto"]').forEach(inp => {
                        inp.oninput = (e) => pagosRegistrados[Number(e.target.dataset.index)].monto = e.target.value;
                    });
                }
                renderizarCamposDePago();

                modalElemento.querySelector('#btn-agregar-otro-pago').onclick = () => {
                    pagosRegistrados.push({ metodo_pago_id: '', monto: '' }); renderizarCamposDePago();
                };
                modalElemento.querySelector('#btn-cancelar-pagos-mixtos').onclick = () => {
                    body.removeChild(modalElemento); callbackConfirmacion(null);
                };
                modalElemento.querySelector('#formPagosMixtosInterno').onsubmit = (e) => {
                    e.preventDefault();
                    mensajeErrorEl.textContent = '';
                    const totalPagadoMixto = pagosRegistrados.reduce((sum, p) => sum + Number(p.monto || 0), 0);
                    if (pagosRegistrados.some(p => !p.metodo_pago_id || !p.monto || Number(p.monto) <= 0)) {
                        mensajeErrorEl.textContent = "Todos los pagos deben tener método y monto válido (>0)."; return;
                    }
                    if (Math.abs(totalPagadoMixto - totalAPagar) > 0.001) {
                        mensajeErrorEl.textContent = `El total (${formatCurrency(totalPagadoMixto)}) debe sumar ${formatCurrency(totalAPagar)}.`; return;
                    }
                    body.removeChild(modalElemento);
                    callbackConfirmacion(pagosRegistrados.map(p => ({ metodo_pago_id: p.metodo_pago_id, monto: Number(p.monto) })));
                };
            }
            // =====================================================================
            // FIN DE DEFINICIÓN DE mostrarModalPagosMixtos
            // =====================================================================

            // --- Lógica de submit principal ---
            if (metodoPagoSeleccionadoAlquiler === "mixto") {
                if (hotelConfigGlobal?.cobro_al_checkin === false && detallesEstancia.precioTotal === 0) {
                    // Si es cobro al checkout y el precio es 0 (ej. solo cortesía sin definir duración aún)
                    // o si el precio es 0 por alguna razón y es mixto, no tiene sentido el modal mixto.
                    // Procedemos como si no hubiera pago inmediato.
                     await registrarReservaYMovimientosCaja({ pagos: [], isMixto: false, formDataOriginal: formDataAlquiler });
                } else if (hotelConfigGlobal?.cobro_al_checkin === false && detallesEstancia.precioTotal > 0) {
                    // Si es cobro al checkout pero se seleccionó mixto (y hay un precio total),
                    // esto es un caso un poco raro. Podríamos optar por no permitir mixto aquí
                    // o simplemente proceder sin pago inmediato. Por ahora, procedemos sin pago.
                    console.warn("Pago Mixto seleccionado con política de 'Cobro al Checkout'. No se procesará pago mixto en este momento.");
                    await registrarReservaYMovimientosCaja({ pagos: [], isMixto: false, formDataOriginal: formDataAlquiler });
                }
                 else { // Cobro al checkin y es mixto
                    mostrarModalPagosMixtos(detallesEstancia.precioTotal, metodosPagoDisponibles.filter(m => m.id !== "mixto"), async (pagosMixtos) => {
                        if (!pagosMixtos) {
                            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                            return;
                        }
                        await registrarReservaYMovimientosCaja({ pagos: pagosMixtos, isMixto: true, formDataOriginal: formDataAlquiler });
                    });
                }
            } else { // Pago único o no se cobra al checkin
                let pagosParaRegistrar = [];
                if (hotelConfigGlobal?.cobro_al_checkin === true && detallesEstancia.precioTotal > 0 && metodoPagoSeleccionadoAlquiler) {
                    pagosParaRegistrar = [{
                        metodo_pago_id: metodoPagoSeleccionadoAlquiler,
                        monto: detallesEstancia.precioTotal
                    }];
                } else if (hotelConfigGlobal?.cobro_al_checkin === false && metodoPagoContainerEl.style.display !== 'none') {
                    // Si el método de pago era visible (quizás por un error de lógica anterior o una configuración mixta)
                    // pero la política es no cobrar, no registramos pago.
                    console.log("Método de pago visible pero política es no cobrar al checkin. No se procesará pago.");
                }

                await registrarReservaYMovimientosCaja({
                    pagos: pagosParaRegistrar,
                    isMixto: false,
                    formDataOriginal: formDataAlquiler
                });
            }
        } catch (err) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
            console.error("Error en submit de alquiler:", err);
            mostrarInfoModalGlobal("Error: " + (err.message || "Ocurrió un problema al registrar la reserva."), "Error de Registro", [], modalContainer);
        }
    }; // Fin de formEl.onsubmit
} // Fin de showAlquilarModal
// ... (resto de tus funciones como showExtenderTiempoModal, showMantenimientoModal, setupButtonListener, etc.)
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

        const tarifaNocheUnicaExt = tiempos.find(t => t.tipo_unidad === 'noche' && t.cantidad_unidad === 1);
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
// ===================== BLOQUE CRONÓMETRO (VISUAL MEJORADO) =====================
function startCronometro(room, supabase, hotelId, listEl) {
    supabase.from('reservas')
        .select('id, fecha_fin, fecha_inicio')
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .then(async ({ data: reservasActivas, error: reservaError }) => {
            const cronometroDiv = listEl.querySelector(`#cronometro-${room.id}`);

            if (reservaError && reservaError.code !== 'PGRST116') {
                console.warn(`Error buscando reserva para cronómetro Hab ${room.id}: ${reservaError.message}`);
                if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-sm text-slate-400 italic">Error</span>`;
                return;
            }

            const reservaActual = reservasActivas && reservasActivas.length > 0 ? reservasActivas[0] : null;
            if (!reservaActual) {
                if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-sm text-slate-400 italic">No activo</span>`;
                return;
            }
            if (!cronometroDiv) return;

            const cronometroId = `cronometro-${room.id}`;
            if (cronometrosInterval[cronometroId]) clearInterval(cronometrosInterval[cronometroId]);

            // Necesitamos este flag para que el sonido solo suene una vez por "tiempo agotado"
            let tiempoAgotadoFlagInterna = room.estado === "tiempo agotado";

            async function updateCronoDisplay() {
                const now = new Date();
                let fechaFinDefinitiva;

                // Consulta el cronómetro activo, o usa fecha_fin de reserva como fallback
                const { data: cronoActivoArr, error: cronoError } = await supabase.from('cronometros')
                    .select('fecha_fin')
                    .eq('reserva_id', reservaActual.id)
                    .eq('activo', true)
                    .limit(1);

                if (cronoError) {
                    console.warn(`Error consultando cronómetro para reserva ${reservaActual.id}: ${cronoError.message}`);
                    fechaFinDefinitiva = new Date(reservaActual.fecha_fin);
                } else if (cronoActivoArr && cronoActivoArr.length > 0 && cronoActivoArr[0].fecha_fin) {
                    fechaFinDefinitiva = new Date(cronoActivoArr[0].fecha_fin);
                } else {
                    fechaFinDefinitiva = new Date(reservaActual.fecha_fin);
                }

                let diff = fechaFinDefinitiva - now;
                const cardElement = cronometroDiv.closest('.room-card');
                const badgeElement = cardElement?.querySelector('span.badge');

                cronometroDiv.className = 'cronometro-display mt-auto text-right font-mono text-xl flex items-center justify-end pt-4 border-t border-slate-200 group-hover:border-blue-200 transition-colors duration-200';
                if (cardElement) cardElement.classList.remove('animate-pulse-fast', 'ring-4', 'ring-opacity-50', 'ring-red-500', 'ring-yellow-500');

                // ---- TIEMPO AGOTADO (EXCEDIDO) ----
                if (diff <= 0) {
                    if (!tiempoAgotadoFlagInterna) {
                        tiempoAgotadoFlagInterna = true;
                        const currentRoomInMap = currentRooms.find(r => r.id === room.id);
                        if (currentRoomInMap && currentRoomInMap.estado !== "tiempo agotado" && currentRoomInMap.estado !== "mantenimiento" && currentRoomInMap.estado !== "limpieza") {
                            await supabase.from('habitaciones').update({ estado: 'tiempo agotado' }).eq('id', room.id);
                            if (cardElement) {
                                cardElement.classList.remove('border-yellow-500', 'bg-yellow-50', 'border-green-500', 'bg-white');
                                cardElement.classList.add('border-red-600', 'bg-red-50');
                            }
                            if (badgeElement) {
                                badgeElement.innerHTML = `${estadoColores['tiempo agotado'].icon} <span class="ml-1">TIEMPO AGOTADO</span>`;
                                badgeElement.className = `badge ${estadoColores['tiempo agotado'].badge} px-2.5 py-1.5 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm`;
                            }
                            currentRoomInMap.estado = 'tiempo agotado';
                            // ---- SONIDO ALERTA SOLO UNA VEZ ----
                            playPopSound && playPopSound();
                        }
                    }
                    let diffPos = Math.abs(diff);
                    const h = String(Math.floor(diffPos / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diffPos % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diffPos % 60000) / 1000)).padStart(2, '0');
                    cronometroDiv.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-1.5 inline text-red-500 animate-ping-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span class="font-bold text-red-500 animate-pulse">⏰ Tiempo excedido: -${h}:${m}:${s}</span>
                    `;
                    if (cardElement) {
                        cardElement.classList.add('animate-pulse-fast', 'ring-4', 'ring-red-500', 'ring-opacity-50');
                    }
                } else {
                    // ---- NORMAL, FALTANDO ----
                    tiempoAgotadoFlagInterna = false;
                    const h = String(Math.floor(diff / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diff % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diff % 60000) / 1000)).padStart(2, '0');

                    let textColor = 'text-green-600';
                    let iconColor = 'text-green-500';
                    if (diff < 10 * 60 * 1000) {
                        textColor = 'text-yellow-600 font-semibold';
                        iconColor = 'text-yellow-500';
                        if (cardElement) cardElement.classList.add('ring-4', 'ring-yellow-500', 'ring-opacity-50');
                    } else if (diff < 30 * 60 * 1000) {
                        textColor = 'text-orange-500';
                        iconColor = 'text-orange-500';
                    }

                    cronometroDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-1.5 inline ${iconColor}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span class="${textColor}">${h}:${m}:${s}</span>`;

                    // Si por error quedó como "tiempo agotado" pero ya está en tiempo normal, reestablece estado
                    const currentRoomInMap = currentRooms.find(r => r.id === room.id);
                    if (currentRoomInMap && currentRoomInMap.estado === "tiempo agotado") {
                        await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
                        if (cardElement) {
                            cardElement.classList.remove('border-red-600', 'bg-red-50', 'animate-pulse-fast', 'ring-4', 'ring-red-500', 'ring-opacity-50');
                            cardElement.classList.add('border-yellow-500', 'bg-yellow-50');
                        }
                        if (badgeElement) {
                            badgeElement.innerHTML = `${estadoColores['ocupada'].icon} <span class="ml-1">OCUPADA</span>`;
                            badgeElement.className = `badge ${estadoColores['ocupada'].badge} px-2.5 py-1.5 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm`;
                        }
                        currentRoomInMap.estado = 'ocupada';
                    }
                }
            }
            await updateCronoDisplay();
            cronometrosInterval[cronometroId] = setInterval(updateCronoDisplay, 1000);
        })
        .catch(err => {
            if (err.code !== 'PGRST116') {
                console.error(`Error iniciando cronómetro para hab ${room.id}:`, err.message);
            }
            const cronometroDiv = listEl.querySelector(`#cronometro-${room.id}`);
            if (cronometroDiv) cronometroDiv.innerHTML = `<span class="text-sm text-slate-400 italic">N/A</span>`;
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

import { showModalTarea } from '../mantenimiento/mantenimiento.js';

async function showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');

    // 1. Modal de confirmación
    const confirmacion = await new Promise(resolve => {
        mostrarInfoModalGlobal(
            `¿Desea crear una tarea de mantenimiento para la habitación <strong>${room.nombre}</strong>?<br><br><small>Al confirmar, deberá llenar los detalles de la tarea. Si hay una reserva activa, se cancelará automáticamente.</small>`,
            "Crear tarea de mantenimiento",
            modalContainer
        );
        const modalDialog = modalContainer.querySelector('.bg-white');
        const btnOk = modalDialog.querySelector('#btn-ok-info-modal-global');
        const btnClose = modalDialog.querySelector('#close-info-modal-global');
        btnOk.textContent = "Sí, continuar";
        btnOk.className = "button button-danger py-2 px-4 mr-2";
        const btnCancel = document.createElement('button');
        btnCancel.textContent = "Cancelar";
        btnCancel.className = "button button-neutral py-2 px-4";
        btnOk.parentElement.appendChild(btnCancel);

        btnOk.onclick = () => { 
            resolve(true); 
            modalContainer.style.display = "none"; 
            modalContainer.innerHTML = ''; 
        };
        btnCancel.onclick = () => { 
            resolve(false); 
            modalContainer.style.display = "none"; 
            modalContainer.innerHTML = ''; 
        };
        btnClose.onclick = () => { 
            resolve(false); 
            modalContainer.style.display = "none"; 
            modalContainer.innerHTML = ''; 
        };
    });

    // Si cancela la confirmación, no hace nada más
    if (!confirmacion) return;

    try {
        // 2. Cancela reserva activa si existe
        const { data: reservaActiva, error: errReserva } = await supabase
            .from('reservas')
            .select('id')
            .eq('habitacion_id', room.id)
            .eq('estado', 'ocupada')
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .single();

        if (errReserva && errReserva.code !== 'PGRST116') throw errReserva;
        if (reservaActiva) {
            await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', reservaActiva.id);
            await supabase.from('reservas').update({ estado: 'cancelada_mantenimiento' }).eq('id', reservaActiva.id);
        }

        // 3. Crea el container para el modal de tarea de mantenimiento
        let fakeContainer = document.createElement('div');
        fakeContainer.id = 'mant-modal-container-mapahab';
        fakeContainer.innerHTML = '<div id="mant-modal"></div>';
        document.body.appendChild(fakeContainer);

        // 4. Abre el formulario bonito de tarea de mantenimiento con datos prellenados
        await showModalTarea(
            fakeContainer,
            supabase,
            hotelId,
            currentUser,
            {
                habitacion_id: room.id,
                estado: 'pendiente',
                titulo: `Mantenimiento de habitación ${room.nombre}`
            }
        );

        // 5. Espera que el modal de tarea se cierre para refrescar
        const modal = fakeContainer.querySelector('#mant-modal');
        const observer = new MutationObserver(() => {
            if (!modal.innerHTML.trim()) {
                document.body.removeChild(fakeContainer);
                renderRooms(mainAppContainer, supabase, currentUser, hotelId);
                observer.disconnect();
            }
        });
        observer.observe(modal, { childList: true });

    } catch (error) {
        console.error("Error creando tarea de mantenimiento desde el mapa:", error);
        mostrarInfoModalGlobal(`Error al crear la tarea: ${error.message}`, "Error Mantenimiento");
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
