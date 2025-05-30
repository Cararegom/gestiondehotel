// js/modules/mapa_habitaciones/mapa_habitaciones.js

// ======================= BLOQUE PRINCIPAL ========================
let containerGlobal = null;
let supabaseGlobal = null;
let currentUserGlobal = null;
let hotelIdGlobal = null;

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
  let html = `
    <div class="ticket">
      ${config?.mostrar_logo !== false && config?.logo_url ? `<div style="text-align:center;margin-bottom:4px;"><img src="${config.logo_url}" style="max-width:45mm;max-height:30px;"></div>` : ''}
      <div class="title" style="text-align:center;font-weight:bold;">${config?.nombre_hotel || ''}</div>
      <div style="text-align:center;">${config?.direccion_fiscal || ''}${config?.nit_rut ? '<br/>NIT: ' + config.nit_rut : ''}${config?.razon_social ? '<br/>' + config.razon_social : ''}</div>
      ${config?.encabezado_ticket ? `<div style="text-align:center;margin:2px 0 5px 0;">${config.encabezado_ticket}</div>` : ''}
      <div class="linea"></div>
      <div style="font-size:13px;"><b>${tipoDocumento || "Ticket de Consumo"}</b></div>
      <div class="linea"></div>
      <div><b>Habitación:</b> ${habitacion || ""}</div>
      <div><b>Cliente:</b> ${cliente || ""}</div>
      <div><b>Ingreso:</b> ${fechaIngreso ? formatDateTime(fechaIngreso) : ""}</div>
      <div><b>Salida:</b> ${fechaSalida ? formatDateTime(fechaSalida) : ""}</div>
      <div class="linea"></div>
      <table>
        <thead>
          <tr><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th></tr>
        </thead>
        <tbody>
          ${(consumos || []).map(item => `
            <tr>
              <td>${item.nombre || ""}</td>
              <td>${item.cantidad || ""}</td>
              <td style="text-align:right;">${formatCurrency(item.precio || 0)}</td>
              <td style="text-align:right;">${formatCurrency(item.total || 0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <div class="linea"></div>
      <div style="text-align:right;font-size:14px;">
        <b>TOTAL: ${formatCurrency(totalConsumo || 0)}</b>
      </div>
      ${otrosDatos ? `<div>${otrosDatos}</div>` : ''}
      <div class="linea"></div>
      ${config?.pie_ticket ? `<div style="text-align:center;margin-top:6px;">${config.pie_ticket}</div>` : ''}
    </div>
  `;

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

// ======================= LÓGICA DE DATOS (Supabase) ===========================
async function getHorariosHotel(supabase, hotelId) {
    const { data, error } = await supabase
        .from('hoteles')
        .select('checkin_hora, checkout_hora')
        .eq('id', hotelId)
        .single();
    if (error) {
        console.error("Error obteniendo horarios del hotel:", error);
        return { checkin: "15:00", checkout: "12:00" }; 
    }
    return {
        checkin: data.checkin_hora || "15:00",
        checkout: data.checkout_hora || "12:00"
    };
}
async function puedeHacerCheckIn(reservaId) {
  // Usa las globales (asumiendo que están correctamente inicializadas en mount)
  const supabase = supabaseGlobal;

  // Busca la reserva y su monto total
  const { data: reserva, error } = await supabase
    .from('reservas')
    .select('id, monto_total')
    .eq('id', reservaId)
    .single();

  if (error || !reserva) {
    alert('Error obteniendo reserva.');
    return false;
  }

  // Suma los pagos realizados (puede que el abono esté en otra tabla)
  const { data: pagos, error: errPagos } = await supabase
    .from('pagos_reserva')
    .select('monto')
    .eq('reserva_id', reservaId);

  if (errPagos) {
    alert('Error consultando pagos.');
    return false;
  }

  // Suma todos los pagos
  const totalPagado = pagos ? pagos.reduce((sum, p) => sum + Number(p.monto), 0) : 0;

  if (totalPagado >= reserva.monto_total) {
  return true;
} else {
  Swal.fire({
    icon: 'warning',
    title: 'No se puede hacer Check-in',
    text: 'El pago está incompleto.',
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

export async function mount(container, supabase, currentUser, hotelId) {
    containerGlobal = container;
    supabaseGlobal = supabase;
    currentUserGlobal = currentUser;
    hotelIdGlobal = hotelId;

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
setupButtonListener('btn-servicios-adicionales', async () => {
  // 1. Busca la reserva activa de la habitación
  const { data: reserva, error: errRes } = await supabase
    .from('reservas')
    .select('id, cliente_nombre, estado')
    .eq('habitacion_id', room.id)
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
    .select('id, nombre, precio')
    .eq('hotel_id', hotelId)
    .eq('activo', true);

  if (errServ || !servicios || servicios.length === 0) {
    mostrarInfoModalGlobal("No hay servicios adicionales configurados en el hotel.", "Servicios");
    return;
  }

  // 3. Renderiza el modal moderno y visual
  modalContainer.innerHTML = "";
  modalContainer.style.display = "flex";
  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-3xl shadow-2xl w-full max-w-xl p-10 m-auto border-4 border-green-100 font-['Montserrat']";
  modalContent.innerHTML = `
    <h3 class="text-3xl font-black mb-7 text-green-700 text-center flex items-center justify-center gap-2 drop-shadow">
      <span>✨ Servicios Adicionales</span>
      <span class="text-2xl text-green-400">(${room.nombre})</span>
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
                <span class="text-green-600 text-lg ml-3">${s.precio ? `$${s.precio}` : ''}</span>
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
  modalContainer.appendChild(modalContent);

  // Botón cancelar del formulario
  modalContent.querySelector('#btn-cancelar-servicios').onclick = () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
  };

  // *** SOLO DESPUÉS del appendChild asignas el onsubmit ***
  const formServicios = modalContent.querySelector('#form-servicios-adicionales');
  const feedbackEl = modalContent.querySelector('#servicios-feedback');

  if (formServicios) {
    formServicios.onsubmit = async (ev) => {
      ev.preventDefault();
      feedbackEl.classList.add('hidden');
      feedbackEl.textContent = '';

      const formData = new FormData(ev.target);
      const serviciosSeleccionados = servicios
        .filter(s => formData.getAll('servicio_ids').includes(s.id))
        .map(s => ({
          servicio_id: s.id,
          cantidad: Number(formData.get(`cantidad_${s.id}`)) || 1,
          precio: s.precio || 0,
          nombre: s.nombre
        }));

      if (serviciosSeleccionados.length === 0) {
        feedbackEl.textContent = "Debes seleccionar al menos un servicio.";
        feedbackEl.classList.remove('hidden');
        return;
      }
      const nota = formData.get('nota_servicio') || '';
      const totalServicios = serviciosSeleccionados.reduce((sum, item) => sum + (item.cantidad * item.precio), 0);

      // --- PREGUNTA CÓMO COBRAR, con UX pro ---
      mostrarInfoModalGlobal(`
        <div class="text-center p-5">
          <h4 class="text-2xl font-bold mb-3 text-blue-900">¿Cómo desea cobrar estos servicios?</h4>
          <div class="rounded-xl bg-blue-50 text-blue-700 p-3 mb-4 border text-lg">
            <div class="mb-2 font-semibold">Resumen:</div>
            <ul class="text-left ml-7 mb-2">
              ${serviciosSeleccionados.map(s => `<li>• ${s.nombre} <b>x${s.cantidad}</b> $${s.precio * s.cantidad}</li>`).join('')}
            </ul>
            <div class="mt-2 text-right font-bold text-xl">Total: $${totalServicios}</div>
          </div>
          <div class="mb-4 flex flex-col gap-3">
            <button id="btn-cobro-ahora" class="button button-success py-3 rounded-xl text-xl font-bold flex-1">Cobrar AHORA y registrar en caja</button>
            <button id="btn-cobro-final" class="button button-neutral py-3 rounded-xl text-xl font-bold flex-1">Cobrar al FINAL (sumar a la factura)</button>
          </div>
          <button id="btn-cancelar-cobro-servicio" class="mt-2 text-sm text-gray-600 hover:text-red-500 underline">Cancelar</button>
        </div>
      `, "¿Cómo desea cobrar?");

      setTimeout(() => {
        document.getElementById('btn-cancelar-cobro-servicio').onclick = () => {
          modalContainer.style.display = "none";
          modalContainer.innerHTML = '';
        };

        document.getElementById('btn-cobro-final').onclick = async () => {
          // Solo guarda en servicios_x_reserva
          for (const item of serviciosSeleccionados) {
            await supabase.from('servicios_x_reserva').insert({
              hotel_id: hotelId,
              reserva_id: reserva.id,
              servicio_id: item.servicio_id,
              cantidad: item.cantidad,
              nota: nota
            });
          }
          mostrarInfoModalGlobal(`
            <div class="text-center text-blue-700 font-semibold text-lg p-3">
              Servicios adicionales agregados exitosamente (se cobrarán en la factura final).
              <div class="mt-4">
                <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="document.querySelector('.modal-container').style.display='none'">Entendido</button>
              </div>
            </div>
          `, "Guardado");
          setTimeout(() => {
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
          }, 1800);
        };

        document.getElementById('btn-cobro-ahora').onclick = async () => {
          // Modal para seleccionar método de pago
          const { data: metodosPago } = await supabase
            .from('metodos_pago')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('activo', true);
          if (!metodosPago || metodosPago.length === 0) {
            mostrarInfoModalGlobal(`
              <div class="text-center p-4">
                <span class="text-red-600 font-semibold text-lg">No hay métodos de pago activos configurados.</span>
                <div class="mt-4">
                  <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="document.querySelector('.modal-container').style.display='none'">Aceptar</button>
                </div>
              </div>
            `, "Sin métodos de pago");
            return;
          }

          let selectHtml = '<select id="select-metodo-pago" class="input px-3 py-2 rounded-xl border border-gray-300 text-lg w-full mb-4">';
          metodosPago.forEach(mp => {
            selectHtml += `<option value="${mp.id}">${mp.nombre}</option>`;
          });
          selectHtml += '</select>';

          mostrarInfoModalGlobal(`
            <div class="text-center p-4">
              <h4 class="text-xl font-bold mb-2 text-blue-900">Confirma el cobro</h4>
              <div class="mb-2 text-gray-600">Total: <span class="font-bold text-green-700 text-2xl">$${totalServicios}</span></div>
              ${selectHtml}
              <div class="flex gap-2 justify-center mt-4">
                <button id="btn-confirmar-pago-servicio" class="button button-success px-5 py-2 text-lg rounded-xl font-bold flex-1">Confirmar</button>
                <button id="btn-cancelar-pago-servicio" class="button button-neutral px-5 py-2 text-lg rounded-xl font-bold flex-1">Cancelar</button>
              </div>
            </div>
          `, "Método de pago");

          setTimeout(() => {
            document.getElementById('btn-cancelar-pago-servicio').onclick = () => {
              modalContainer.style.display = "none";
              modalContainer.innerHTML = '';
            };
            document.getElementById('btn-confirmar-pago-servicio').onclick = async () => {
              const metodoPagoId = document.getElementById('select-metodo-pago').value;
              const turnoId = turnoService.getActiveTurnId ? turnoService.getActiveTurnId() : turnoService.getActiveTurn();
              if (!turnoId) {
                mostrarInfoModalGlobal(`
                  <div class="text-center p-4">
                    <span class="text-red-600 font-semibold text-lg">No hay turno activo en caja.</span>
                    <div class="mt-4">
                      <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="document.querySelector('.modal-container').style.display='none'">Aceptar</button>
                    </div>
                  </div>
                `, "Caja cerrada");
                return;
              }

              // 1. Inserta los servicios a la reserva
              for (const item of serviciosSeleccionados) {
                await supabase.from('servicios_x_reserva').insert({
                  hotel_id: hotelId,
                  reserva_id: reserva.id,
                  servicio_id: item.servicio_id,
                  cantidad: item.cantidad,
                  nota: nota
                });
              }

              // 2. Inserta el movimiento en caja (concepto bonito)
              const listaServicios = serviciosSeleccionados
                .map(item => `${item.nombre} x${item.cantidad}`)
                .join(', ');
              const conceptoCaja = `Servicios adicionales: ${listaServicios} - Habitación ${room.nombre}`;

              const { error } = await supabase.from('caja').insert({
                tipo: "ingreso",
                monto: totalServicios,
                concepto: conceptoCaja,
                hotel_id: hotelId,
                usuario_id: currentUser.id,
                turno_id: turnoId,
                metodo_pago_id: metodoPagoId,
                fecha_movimiento: new Date().toISOString()
              });

              if (error) {
                mostrarInfoModalGlobal(`
                  <div class="text-center p-4">
                    <span class="text-red-600 font-semibold text-lg">Error al registrar el ingreso en caja:<br>${error.message}</span>
                    <div class="mt-4">
                      <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="document.querySelector('.modal-container').style.display='none'">Aceptar</button>
                    </div>
                  </div>
                `, "Error en caja");
              } else {
                mostrarInfoModalGlobal(`
                  <div class="text-center text-green-700 font-semibold text-xl p-3">
                    Servicios cobrados y registrados correctamente en caja.
                    <div class="mt-4">
                      <button class="button button-success w-full py-2 rounded-xl font-bold" onclick="document.querySelector('.modal-container').style.display='none'">Entendido</button>
                    </div>
                  </div>
                `, "Cobro exitoso");
                setTimeout(() => {
                  modalContainer.style.display = "none";
                  modalContainer.innerHTML = '';
                }, 2000);
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

// 4. Actualiza el cronómetro con esas fechas
await supabase.from('cronometros').insert([{
  hotel_id: hotelId,
  reserva_id: reservaFutura.id,
  habitacion_id: room.id,
  fecha_inicio: nuevoInicio.toISOString(),
  fecha_fin: nuevoFin.toISOString(),
  activo: true
}]);

      mostrarInfoModalGlobal("Check-in realizado correctamente. ¡La habitación está ocupada!", "Check-in Exitoso");
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
      await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    });
  }
setupButtonListener('btn-cambiar-habitacion', async () => {
  const modalContainer = document.getElementById('modal-container');
  // Cargar habitaciones libres (excepto la actual)
  const { data: habitacionesLibres } = await supabase
    .from('habitaciones')
    .select('id, nombre')
    .eq('hotel_id', hotelId)
    .eq('estado', 'libre')
    .neq('id', room.id);

  if (!habitacionesLibres || habitacionesLibres.length === 0) {
    mostrarInfoModalGlobal("No hay habitaciones libres disponibles para hacer el cambio.", "Sin habitaciones libres");
    return;
  }

  // Modal para seleccionar habitación y motivo
  const modalContent = document.createElement('div');
  modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up";
  modalContent.innerHTML = `
    <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">Cambiar de Habitación</h3>
    <div class="mb-3">
      <label for="selectNuevaHabitacion" class="block mb-1">Selecciona habitación destino:</label>
      <select id="selectNuevaHabitacion" class="form-control w-full mb-2" required>
        <option value="">-- Habitaciones libres --</option>
        ${habitacionesLibres.map(h => `<option value="${h.id}">${h.nombre}</option>`).join('')}
      </select>
    </div>
    <div class="mb-3">
      <label for="motivoCambio" class="block mb-1">Motivo del cambio:</label>
      <textarea id="motivoCambio" class="form-control w-full" rows="2" placeholder="Describe el motivo..." required></textarea>
    </div>
    <div class="flex gap-2 mt-4">
      <button id="btnConfirmarCambio" class="button button-success flex-1">Confirmar cambio</button>
      <button id="btnCancelarCambio" class="button button-neutral flex-1">Cancelar</button>
    </div>
  `;
  modalContainer.innerHTML = "";
  modalContainer.appendChild(modalContent);

  // Cerrar modal
  modalContent.querySelector('#btnCancelarCambio').onclick = () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
  };

  // Confirmar cambio
  modalContent.querySelector('#btnConfirmarCambio').onclick = async () => {
    const habitacionDestinoId = modalContent.querySelector('#selectNuevaHabitacion').value;
    const motivo = modalContent.querySelector('#motivoCambio').value.trim();
    if (!habitacionDestinoId || !motivo) {
      alert("Debes seleccionar una habitación y escribir el motivo.");
      return;
    }

    // Busca la reserva activa
    const { data: reservasActivas } = await supabase
      .from('reservas')
      .select('id')
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada'])
      .order('fecha_inicio', { ascending: false })
      .limit(1);

    const reserva = reservasActivas && reservasActivas.length > 0 ? reservasActivas[0] : null;
    if (!reserva) {
      mostrarInfoModalGlobal("No se encontró una reserva activa para esta habitación.", "Error");
      return;
    }

    // Actualiza la reserva con la nueva habitación
    await supabase.from('reservas')
      .update({ habitacion_id: habitacionDestinoId })
      .eq('id', reserva.id);

    // Actualiza cronómetro asociado si tienes uno
    await supabase.from('cronometros')
      .update({ habitacion_id: habitacionDestinoId })
      .eq('reserva_id', reserva.id)
      .eq('activo', true);

    // Actualiza estados de las habitaciones
    await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', room.id); // la original
    await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', habitacionDestinoId); // la nueva

    // Inserta el registro de cambio en la nueva tabla
    await supabase.from('cambios_habitacion').insert([{
      hotel_id: hotelId,
      reserva_id: reserva.id,
      habitacion_origen_id: room.id,
      habitacion_destino_id: habitacionDestinoId,
      motivo: motivo,
      usuario_id: currentUser.id
    }]);

    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';

    // Muestra mensaje global y recarga SOLO después de cerrar el mensaje
    mostrarInfoModalGlobal(
      "¡El cambio de habitación fue realizado exitosamente!",
      "Cambio exitoso",
      null,
      async () => {
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
      }
    );
  }; // <- AQUÍ cierras la función onclick de Confirmar Cambio
}); // <- AQUÍ cierras el setupButtonListener PRINCIPAL (y pones el punto y coma)


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
setupButtonListener('btn-ver-consumos', async () => {
  // Buscar reserva activa
  const { data: reserva, error: errRes } = await supabase
    .from('reservas')
    .select('id, cliente_nombre, monto_total, fecha_inicio, fecha_fin, hotel_id')
    .eq('habitacion_id', room.id)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .single();
  if (errRes || !reserva) {
    mostrarInfoModalGlobal("No hay reserva activa con consumos para esta habitación.", "Consumos");
    return;
  }

  // ========== TIENDA ==========
  const { data: ventasTienda } = await supabase
    .from('ventas_tienda')
    .select('id')
    .eq('reserva_id', reserva.id);

  let consumosTienda = [], totalTienda = 0;
  let ventaIdsTienda = Array.isArray(ventasTienda) ? ventasTienda.map(v => v.id).filter(Boolean) : [];
  ventaIdsTienda = ventaIdsTienda.map(x => (typeof x === 'string' ? x.trim() : String(x)));

  if (ventaIdsTienda.length > 0) {
    const { data: rowsTienda } = await supabase
      .from('detalle_ventas_tienda')
      .select('producto_id, cantidad, subtotal')
      .in('venta_id', ventaIdsTienda);

    const productoIds = rowsTienda.map(dt => dt.producto_id).filter(Boolean);
    let nombresProductos = {};
    if (productoIds.length) {
      const { data: productos } = await supabase
        .from('productos_tienda')
        .select('id, nombre')
        .in('id', productoIds);
      if (productos) {
        productos.forEach(prod => { nombresProductos[prod.id] = prod.nombre; });
      }
    }

    consumosTienda = rowsTienda.map(t => ({
      nombre: nombresProductos[t.producto_id] || "Producto",
      cantidad: t.cantidad,
      subtotal: t.subtotal
    }));
    totalTienda = consumosTienda.reduce((sum, i) => sum + Number(i.subtotal), 0);
  }

  // ========== RESTAURANTE ==========
  const { data: ventasRest } = await supabase
    .from('ventas_restaurante')
    .select('id')
    .eq('reserva_id', reserva.id);

  let consumosRest = [], totalRest = 0;
  let ventaIdsRest = Array.isArray(ventasRest) ? ventasRest.map(v => v.id).filter(Boolean) : [];
  ventaIdsRest = ventaIdsRest.map(x => (typeof x === 'string' ? x.trim() : String(x)));

  if (ventaIdsRest.length > 0) {
    const { data: rowsRest } = await supabase
      .from('ventas_restaurante_items')
      .select('plato_id, cantidad, subtotal')
      .in('venta_id', ventaIdsRest);

    const platoIds = rowsRest.map(dt => dt.plato_id).filter(Boolean);
    let nombresPlatos = {};
    if (platoIds.length) {
      const { data: platos } = await supabase
        .from('platos')
        .select('id, nombre')
        .in('id', platoIds);
      if (platos) {
        platos.forEach(plato => { nombresPlatos[plato.id] = plato.nombre; });
      }
    }

    consumosRest = rowsRest.map(t => ({
      nombre: nombresPlatos[t.plato_id] || "Plato",
      cantidad: t.cantidad,
      subtotal: t.subtotal
    }));
    totalRest = consumosRest.reduce((sum, i) => sum + Number(i.subtotal), 0);
  }

  // ========== SERVICIOS ADICIONALES ==========
  const { data: serviciosReserva } = await supabase
    .from('servicios_x_reserva')
    .select('servicio_id, cantidad, nota')
    .eq('reserva_id', reserva.id);

  let consumosServicios = [], totalServicios = 0;
  if (serviciosReserva && serviciosReserva.length > 0) {
    const servicioIds = [...new Set(serviciosReserva.map(s => s.servicio_id))].filter(Boolean)
      .map(x => (typeof x === 'string' ? x.trim() : String(x)));
    let nombresServicios = {}, preciosServicios = {};
    if (servicioIds.length > 0) {
      const { data: infoServicios } = await supabase
        .from('servicios_adicionales')
        .select('id, nombre, precio')
        .in('id', servicioIds);
      if (infoServicios) {
        infoServicios.forEach(s => {
          nombresServicios[s.id] = s.nombre;
          preciosServicios[s.id] = s.precio || 0;
        });
      }
    }
    serviciosReserva.forEach(det => {
      consumosServicios.push({
        nombre: nombresServicios[det.servicio_id] || "Servicio",
        cantidad: det.cantidad,
        subtotal: (det.cantidad * (preciosServicios[det.servicio_id] || 0)),
        nota: det.nota || ""
      });
    });
    totalServicios = consumosServicios.reduce((sum, i) => sum + Number(i.subtotal), 0);
  }

  // ========== TOTAL GENERAL ==========
  const totalGeneral = (reserva.monto_total || 0) + totalTienda + totalRest + totalServicios;

  // ========== MÉTODOS DE PAGO ==========
  const { data: metodosPago } = await supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', reserva.hotel_id)
    .eq('activo', true);

  // ========== MODAL CONSUMOS ==========
  let html = `
  <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width:420px; margin:auto;">
    <div style="font-size:1.25em;font-weight:bold;color:#1459ae;margin-bottom:6px;">🧾 Detalle de Consumos</div>
    <div style="margin-bottom:18px;">
      <b style="color:#0ea5e9;">Huésped:</b> ${reserva.cliente_nombre}<br>
      <b style="color:#0ea5e9;">Estancia:</b> ${formatDateTime(reserva.fecha_inicio)} - ${formatDateTime(reserva.fecha_fin)}
    </div>
    <div>
      <span style="color:#475569;">Estancia habitación:</span>
      <span style="color:#06b6d4;">${formatCurrency(reserva.monto_total)}</span>
    </div>
    ${consumosTienda.length ? `
      <div style="margin-top:12px;">
        <b>🛒 Tienda:</b>
        <ul>${consumosTienda.map(t => `<li>${t.nombre} x${t.cantidad}: ${formatCurrency(t.subtotal)}</li>`).join('')}</ul>
        <b>Total Tienda: ${formatCurrency(totalTienda)}</b>
      </div>
    ` : ''}
    ${consumosRest.length ? `
      <div style="margin-top:12px;">
        <b>🍽️ Restaurante:</b>
        <ul>${consumosRest.map(r => `<li>${r.nombre} x${r.cantidad}: ${formatCurrency(r.subtotal)}</li>`).join('')}</ul>
        <b>Total Restaurante: ${formatCurrency(totalRest)}</b>
      </div>
    ` : ''}
    ${consumosServicios.length ? `
      <div style="margin-top:12px;">
        <b>🧰 Servicios Adicionales:</b>
        <ul>${consumosServicios.map(s => `<li>${s.nombre} x${s.cantidad}: ${formatCurrency(s.subtotal)}${s.nota ? ` <i>(${s.nota})</i>` : ''}</li>`).join('')}</ul>
        <b>Total Servicios: ${formatCurrency(totalServicios)}</b>
      </div>
    ` : ''}
    <div style="margin-top:14px; font-weight:bold; color:#059669; font-size:1.1em;">
      Total a pagar: ${formatCurrency(totalGeneral)}
    </div>
    ${(totalGeneral > 0 && metodosPago?.length) ? `
      <div style="margin-top:18px;">
        <label for="metodoPagoFact" style="font-weight:600;">Método de pago:</label>
        <select id="metodoPagoFact" style="padding:6px 14px; border-radius:6px; border:1px solid #d1d5db; margin-left:10px;">
          <option value="">Selecciona...</option>
          ${metodosPago.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}
        </select>
        <button id="btn-facturar-final" style="margin-left:16px; background:#059669; color:#fff; padding:9px 22px; border-radius:6px; border:none; font-size:1.05em; font-weight:600;">Facturar Todo</button>
      </div>
    ` : ''}
  </div>
  `;

  mostrarInfoModalGlobal(html, "Detalle de Consumos");

  // ========== LÓGICA FACTURAR ==========
  waitForButtonAndBind('btn-facturar-final', (btnFacturar) => {
    btnFacturar.onclick = async () => {
      // Validar método de pago
      const metodoPagoId = document.getElementById('metodoPagoFact').value;
      if (!metodoPagoId) {
        alert("Seleccione un método de pago.");
        return;
      }
      // --- TURNO DE CAJA: SOLO REGISTRA SI HAY TURNO ACTIVO ---
      const turnoId = (typeof turnoService !== "undefined" && turnoService.getActiveTurnId)
        ? turnoService.getActiveTurnId()
        : null;
      if (!turnoId) {
        mostrarInfoModalGlobal("No se puede registrar en caja porque no hay un turno activo.", "Turno requerido");
        return;
      }

      let concepto = `Ingreso habitación ${room.nombre}\n`;
      if (consumosTienda.length) {
        concepto += `Tienda:\n`;
        consumosTienda.forEach(t =>
          concepto += `- ${t.nombre} x${t.cantidad}: ${formatCurrency(t.subtotal)}\n`
        );
        concepto += `Total Tienda: ${formatCurrency(totalTienda)}\n`;
      }
      if (consumosRest.length) {
        concepto += `Restaurante:\n`;
        consumosRest.forEach(r =>
          concepto += `- ${r.nombre} x${r.cantidad}: ${formatCurrency(r.subtotal)}\n`
        );
        concepto += `Total Restaurante: ${formatCurrency(totalRest)}\n`;
      }
      if (consumosServicios.length) {
        concepto += `Servicios:\n`;
        consumosServicios.forEach(s =>
          concepto += `- ${s.nombre} x${s.cantidad}: ${formatCurrency(s.subtotal)}\n`
        );
        concepto += `Total Servicios: ${formatCurrency(totalServicios)}\n`;
      }
      concepto += `TOTAL FACTURADO: ${formatCurrency(totalGeneral)}`;

      // ========== REGISTRO EN CAJA ==========
      const { error, data } = await supabase.from('caja').insert({
        hotel_id: reserva.hotel_id,
        tipo: 'ingreso',
        monto: totalGeneral,
        concepto: concepto,
        fecha_movimiento: new Date().toISOString(),
        metodo_pago_id: metodoPagoId,
        usuario_id: currentUser.id,
        reserva_id: reserva.id,
        creado_en: new Date().toISOString(),
        turno_id: turnoId  // <<<<<<  CLAVE PARA QUE REGISTRE BIEN
      });

      if (error) {
        alert("❌ ERROR al registrar en CAJA:\n\n" + error.message);
        console.error("Supabase caja error:", error);
        return;
      }
      mostrarInfoModalGlobal(
        "Factura registrada correctamente.<br>El ingreso quedó en caja.<br><small>Puedes revisar el concepto y monto en el módulo de Caja.</small>",
        "Facturación completada"
      );
    };
  });
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
    let precio = 0;
    let descripcionEstancia = "No definida";
    let tipoCalculo = null; 
    let cantidadCalculo = 0;

    // 1. Obtén la cantidad de personas (default 2 si no viene)
    const cantidadPersonas = dataForm.cantidad_personas ? parseInt(dataForm.cantidad_personas) : 2;
    const precioAdicional = room.precio_adicional_huesped || 0;
    let adicionales = 0;
    if (cantidadPersonas > 2) {
        adicionales = cantidadPersonas - 2;
    }

    const precioNocheHabitacionFallback = room.precio || 20000; 

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
        const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
        fechaSalida.setHours(checkoutH, checkoutM, 0, 0);

        if (inicioAt >= fechaSalida) {
            fechaSalida.setDate(fechaSalida.getDate() + 1);
        }
        fechaSalida.setDate(fechaSalida.getDate() + (nochesSeleccionadas -1));
        finAt = fechaSalida;
        
        if (tarifaNocheUnica && typeof tarifaNocheUnica.precio === 'number') {
            precio = tarifaNocheUnica.precio * nochesSeleccionadas;
        } else {
            precio = precioNocheHabitacionFallback * nochesSeleccionadas; 
        }
        // --- Suma extra por personas ---
        if (adicionales > 0 && precioAdicional > 0) {
            precio += adicionales * precioAdicional * nochesSeleccionadas; // Aplica por cada noche
        }
        descripcionEstancia = `${nochesSeleccionadas} noche${nochesSeleccionadas > 1 ? 's' : ''} (hasta ${formatDateTime(finAt, undefined, {dateStyle:'short', timeStyle:'short'})})`;

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
            precio = precioHoras;
            // --- Suma extra por personas ---
            if (adicionales > 0 && precioAdicional > 0) {
                precio += adicionales * precioAdicional; // Solo por la estancia, no por noche
            }
            descripcionEstancia = `${formatHorasMin(minutosSeleccionados)}`;
        } else {
            precio = 0; 
            descripcionEstancia = `${formatHorasMin(minutosSeleccionados)} - Precio no definido`;
        }
    } else {
        finAt = new Date(inicioAt); 
        precio = 0;
        descripcionEstancia = "Seleccione duración";
    }
    
    if (!finAt || isNaN(finAt.getTime())) { 
      console.error("Fecha de fin inválida calculada:", finAt, "Datos de formulario:", dataForm);
      finAt = new Date(inicioAt); 
      if (descripcionEstancia === "Seleccione duración") precio = 0; 
    }

    return {
        inicioAt,
        finAt,
        precioTotal: Math.round(precio), 
        descripcionEstancia,
        tipoCalculo, 
        cantidadCalculo 
    };
}


// ===================== MODAL DE ALQUILER (POS STYLE - COMPLETO) =====================
async function showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let horarios, tiempos, metodosPago;
    try {
        [horarios, tiempos, metodosPago] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);
    } catch (err) {
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler. Intente de nuevo.", "Error de Carga", modalContainer);
        return;
    }

    // Asegura la opción "Pago Mixto"
    const pagoMixto = { id: "mixto", nombre: "Pago Mixto" };
    metodosPago = [pagoMixto, ...metodosPago];

    const tarifaNocheUnica = tiempos.find(t => t.tipo_unidad === 'noche' && t.cantidad_unidad === 1);
    const opcionesNoches = crearOpcionesNochesConPersonalizada(horarios, 5, null, tarifaNocheUnica, room);
    const opcionesHoras = crearOpcionesHoras(tiempos);

    const modalContent = document.createElement('div');
    modalContent.className = "bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl shadow-2xl w-full max-w-3xl p-0 m-auto animate-fade-in-up overflow-hidden";
    modalContent.innerHTML = `
        <div class="flex flex-col md:flex-row">
            <div class="w-full md:w-3/5 p-6 md:p-8 space-y-5">
                <div class="flex justify-between items-center">
                    <h3 class="text-2xl font-bold text-blue-700">Alquilar Habitación: ${room.nombre}</h3>
                    <button id="close-modal-alquilar" class="text-gray-400 hover:text-red-600 text-3xl leading-none">&times;</button>
                </div>
                <form id="alquilar-form-pos" class="space-y-4">
                    <div>
                        <label for="cliente_nombre" class="form-label">Nombre Huésped</label>
                        <input required name="cliente_nombre" id="cliente_nombre" class="form-control" maxlength="60">
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label for="cedula" class="form-label">Cédula</label><input required name="cedula" id="cedula" class="form-control" maxlength="20"></div>
                        <div><label for="telefono" class="form-label">Teléfono</label><input required name="telefono" id="telefono" class="form-control" maxlength="20"></div>
                    </div>
                    <div>
                        <label class="form-label">Duración de Estancia:</label>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start">
                            <div class="flex flex-col">
                                <label for="select-noches" class="text-xs text-gray-500 mb-1">Noches:</label>
                                <select name="noches" id="select-noches" class="form-control">
                                    <option value="">-- Noches --</option>
                                    ${opcionesNoches.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}
                                </select>
                            </div>
                            <div class="flex flex-col" id="container-noches-personalizada" style="display:none;">
                                <label for="input-noches-personalizada" class="text-xs text-gray-500 mb-1">Noches (Personalizado):</label>
                                <input type="number" min="1" max="365" step="1" placeholder="N°" id="input-noches-personalizada" name="noches_personalizada" class="form-control"/>
                            </div>
                            <div class="flex flex-col">
                                <label for="select-horas" class="text-xs text-gray-500 mb-1">Horas:</label>
                                <select name="horas" id="select-horas" class="form-control">
                                    <option value="">-- Horas --</option>
                                    ${opcionesHoras.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}
                                </select>
                            </div>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div><label for="cantidad_huespedes" class="form-label">Cant. Huéspedes</label><input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" max="${room.capacidad_maxima || 10}" value="2"></div>
                        <div>
                            <label for="metodo_pago_id" class="form-label">Método de Pago</label>
                            <select required name="metodo_pago_id" id="metodo_pago_id" class="form-control">
                                ${metodosPago.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                    <div class="pt-3">
                        <button type="submit" id="btn-alquilar-hab" class="button button-success w-full py-3 text-lg font-semibold">Confirmar y Registrar Alquiler</button>
                    </div>
                </form>
            </div>
            <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 md:p-8 flex flex-col justify-between">
                <div>
                    <h4 class="text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-4 text-cyan-400">Resumen del Alquiler</h4>
                    <div class="space-y-3 text-sm">
                        <div class="flex justify-between"><span>Habitación:</span> <strong id="ticket-room-name" class="text-right">${room.nombre}</strong></div>
                        <div class="flex justify-between"><span>Tipo:</span> <strong class="text-right">${room.tipo || 'N/A'}</strong></div>
                        <div class="flex justify-between"><span>Estancia:</span> <strong id="ticket-stay-description" class="text-right">Seleccione duración</strong></div>
                        <div class="flex justify-between"><span>Precio Estancia:</span> <strong id="ticket-stay-price" class="text-right">${formatCurrency(0)}</strong></div>
                    </div>
                </div>
                <div class="border-t-2 border-cyan-500 pt-4 mt-6">
                    <div class="flex justify-between items-center font-bold text-3xl text-green-400"><span>TOTAL:</span><span id="ticket-total-price">${formatCurrency(0)}</span></div>
                </div>
            </div>
        </div>
    `;
    modalContainer.appendChild(modalContent);

    // ---- Interacciones normales ----
    const formEl = modalContent.querySelector('#alquilar-form-pos');
    const selectNochesEl = modalContent.querySelector('#select-noches');
    const inputNochesPersonalizadaEl = modalContent.querySelector('#input-noches-personalizada');
    const containerNochesPersonalizadaEl = modalContent.querySelector('#container-noches-personalizada');
    const selectHorasEl = modalContent.querySelector('#select-horas');
    const ticketDescEl = modalContent.querySelector('#ticket-stay-description');
    const ticketPriceEl = modalContent.querySelector('#ticket-stay-price');
    const ticketTotalEl = modalContent.querySelector('#ticket-total-price');

    function actualizarResumenTicketAlquiler() {
        const formData = Object.fromEntries(new FormData(formEl));
        const detalles = calcularDetallesEstancia(formData, room, tiempos, horarios, tarifaNocheUnica);
        ticketDescEl.textContent = detalles.descripcionEstancia;
        ticketPriceEl.textContent = formatCurrency(detalles.precioTotal);
        ticketTotalEl.textContent = formatCurrency(detalles.precioTotal);
    }

    selectNochesEl.onchange = () => {
        if (selectNochesEl.value === "personalizada") {
            containerNochesPersonalizadaEl.style.display = "block";
            inputNochesPersonalizadaEl.required = true; inputNochesPersonalizadaEl.focus();
        } else {
            containerNochesPersonalizadaEl.style.display = "none";
            inputNochesPersonalizadaEl.required = false; inputNochesPersonalizadaEl.value = '';
        }
        if (selectNochesEl.value) selectHorasEl.value = "";
        actualizarResumenTicketAlquiler();
    };
    inputNochesPersonalizadaEl.oninput = actualizarResumenTicketAlquiler;
    selectHorasEl.onchange = () => {
        if (selectHorasEl.value) {
            selectNochesEl.value = "";
            containerNochesPersonalizadaEl.style.display = "none";
            inputNochesPersonalizadaEl.required = false; inputNochesPersonalizadaEl.value = '';
        }
        actualizarResumenTicketAlquiler();
    };
    actualizarResumenTicketAlquiler();

    modalContent.querySelector('#close-modal-alquilar').onclick = () => {
        modalContainer.style.display = "none"; modalContainer.innerHTML = '';
    };

    // ==================== FLUJO DE SUBMIT: PAGO MIXTO ====================
    formEl.onsubmit = async (e) => {
        e.preventDefault();

        const submitBtn = formEl.querySelector('button[type="submit"], #btn-alquilar-hab');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Registrando..."; }

        try {
            const formData = Object.fromEntries(new FormData(formEl));
            const detallesEstancia = calcularDetallesEstancia(formData, room, tiempos, horarios, tarifaNocheUnica);
            if (detallesEstancia.precioTotal <= 0 && (!detallesEstancia.tipoCalculo)) {
                alert('Debe seleccionar una duración válida para la estancia (noches u horas).');
                if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                return;
            }

            // --- Validar reservas activas previas
            const { data: reservasAnterioresActivas } = await supabase
                .from('reservas').select('id').eq('habitacion_id', room.id).eq('estado', 'activa');
            if (reservasAnterioresActivas && reservasAnterioresActivas.length > 0) {
                for (const res of reservasAnterioresActivas) {
                    await supabase.from('reservas').update({ estado: 'finalizada_auto' }).eq('id', res.id);
                    await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', res.id);
                }
            }
            await supabase.from('cronometros').update({ activo: false }).eq('habitacion_id', room.id).eq('activo', true).is('reserva_id', null);

            // --- FLUJO PAGO MIXTO ---
            if (formData.metodo_pago_id === "mixto") {
                mostrarModalPagosMixtos(detallesEstancia.precioTotal, metodosPago.filter(m => m.id !== "mixto"), async (pagosMixtos) => {
                    if (!pagosMixtos) {
                        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                        return;
                    }
                    await registrarReservaYMovimientosCaja({ pagos: pagosMixtos, isMixto: true });
                });
            } else {
                await registrarReservaYMovimientosCaja({
                    pagos: [{
                        metodo_pago_id: formData.metodo_pago_id,
                        monto: detallesEstancia.precioTotal
                    }],
                    isMixto: false
                });
            }

            async function registrarReservaYMovimientosCaja({ pagos, isMixto }) {
                // 1. Crear la reserva (con metodo_pago_id null si es mixto)
                const { data: reservaData, error: errRes } = await supabase.from('reservas').insert([{
                    cliente_nombre: formData.cliente_nombre, cedula: formData.cedula, telefono: formData.telefono,
                    habitacion_id: room.id, hotel_id: hotelId,
                    fecha_inicio: detallesEstancia.inicioAt.toISOString(), fecha_fin: detallesEstancia.finAt.toISOString(),
                    monto_total: detallesEstancia.precioTotal, estado: "activa", 
                    cantidad_huespedes: Number(formData.cantidad_huespedes), 
                    metodo_pago_id: isMixto ? null : pagos[0].metodo_pago_id
                }]).select().single();

                if (errRes) { 
                    alert("Error creando reserva: " + errRes.message); 
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                    return; 
                }
                const reservaId = reservaData?.id;

                // 2. TurNo de caja
                const turnoId = turnoService.getActiveTurnId();
                if (!turnoId) {
                    mostrarInfoModalGlobal("ACCIÓN BLOQUEADA: No se puede registrar el alquiler en caja porque no hay un turno activo.", "Turno Requerido", modalContainer);
                    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
                    return;
                }

                // 3. Un movimiento en caja por cada pago
                for (const pago of pagos) {
                    const movimientoCaja = {
                        hotel_id: hotelId, 
                        tipo: 'ingreso', 
                        monto: Number(pago.monto),
                        concepto: `Alquiler ${room.nombre} (${detallesEstancia.descripcionEstancia}) - ${formData.cliente_nombre || 'Cliente Directo'}`,
                        fecha_movimiento: detallesEstancia.inicioAt.toISOString(), 
                        usuario_id: currentUser?.id, 
                        reserva_id: reservaId,
                        metodo_pago_id: pago.metodo_pago_id,
                        turno_id: turnoId
                    };
                    await supabase.from('caja').insert(movimientoCaja);
                }

                // 4. Crea cronómetro y actualiza habitación
                await supabase.from('cronometros').insert([{
                    hotel_id: hotelId, reserva_id: reservaId, habitacion_id: room.id,
                    fecha_inicio: detallesEstancia.inicioAt.toISOString(), fecha_fin: detallesEstancia.finAt.toISOString(), activo: true,
                }]);
                await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

                modalContainer.style.display = "none";
                modalContainer.innerHTML = '';
                await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
            }

            // --- Modal pagos mixtos auxiliar ---
            function mostrarModalPagosMixtos(total, metodosPago, callback) {
                const body = document.body;
                let pagos = [{ metodo_pago_id: '', monto: '' }];
                const modal = document.createElement('div');
                modal.className = "fixed inset-0 bg-black/40 z-[9999] flex items-center justify-center";
                modal.innerHTML = `
                    <div class="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-auto animate-fade-in-up" style="font-family:'Segoe UI',sans-serif;">
                        <h3 class="text-xl font-bold text-blue-700 mb-4 text-center">Pagos Mixtos</h3>
                        <div style="margin-bottom:8px;">Total de la estancia: <b style="color:#0ea5e9;font-size:18px;">$${total}</b></div>
                        <form id="formPagosMixtosPOS">
                            <div id="pagosMixtosPOSCampos"></div>
                            <div style="margin:13px 0;">
                                <button type="button" id="agregarPagoPOS" style="background:#e0e7ff;color:#2563eb;border:none;border-radius:7px;padding:7px 18px;font-weight:600;font-size:1em;cursor:pointer;">+ Agregar Pago</button>
                            </div>
                            <div style="font-size:15px;margin-bottom:8px;color:#f43f5e;" id="msgPagosMixtosPOS"></div>
                            <div style="display:flex;gap:12px;justify-content:center;margin-top:20px;">
                                <button type="submit" style="background:linear-gradient(90deg,#22c55e,#2563eb);color:#fff;font-weight:700;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #22c55e22;cursor:pointer;">Registrar Pagos</button>
                                <button type="button" id="cancelarPagoPOS" style="background:#e0e7ef;color:#334155;font-weight:600;border:none;border-radius:7px;padding:11px 28px;font-size:1.08em;box-shadow:0 2px 10px #64748b15;cursor:pointer;">Cancelar</button>
                            </div>
                        </form>
                    </div>
                `;
                body.appendChild(modal);

                function renderPagosCampos() {
                    const campos = modal.querySelector('#pagosMixtosPOSCampos');
                    campos.innerHTML = '';
                    pagos.forEach((pago, idx) => {
                        campos.innerHTML += `
                            <div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">
                                <select required style="flex:2;padding:7px;border-radius:7px;border:1.5px solid #d1d5db;" name="metodo_pago_id" data-idx="${idx}">
                                    <option value="">Método...</option>
                                    ${metodosPago.map(mp => `<option value="${mp.id}" ${mp.id === pago.metodo_pago_id ? 'selected' : ''}>${mp.nombre}</option>`).join('')}
                                </select>
                                <input required type="number" min="1" max="${total}" name="monto" data-idx="${idx}" style="flex:1;padding:7px 12px;border-radius:7px;border:1.5px solid #d1d5db;" placeholder="Monto" value="${pago.monto || ''}">
                                ${pagos.length > 1 ? `<button type="button" data-idx="${idx}" class="btnEliminarPagoPOS" style="color:#e11d48;font-size:1.2em;background:transparent;border:none;cursor:pointer;padding:0 5px;">✕</button>` : ''}
                            </div>
                        `;
                    });

                    // Evento para eliminar
                    campos.querySelectorAll('.btnEliminarPagoPOS').forEach(btn => {
                        btn.onclick = (e) => {
                            const idx = Number(btn.dataset.idx);
                            pagos.splice(idx, 1);
                            renderPagosCampos();
                        };
                    });
                    // Evento para cambio
                    campos.querySelectorAll('select[name="metodo_pago_id"]').forEach(sel => {
                        sel.onchange = (e) => {
                            pagos[Number(sel.dataset.idx)].metodo_pago_id = sel.value;
                        };
                    });
                    campos.querySelectorAll('input[name="monto"]').forEach(inp => {
                        inp.oninput = (e) => {
                            pagos[Number(inp.dataset.idx)].monto = inp.value;
                        };
                    });
                }
                renderPagosCampos();

                modal.querySelector('#agregarPagoPOS').onclick = () => {
                    pagos.push({ metodo_pago_id: '', monto: '' });
                    renderPagosCampos();
                };

                modal.querySelector('#cancelarPagoPOS').onclick = () => {
                    body.removeChild(modal);
                    callback(null);
                };

                modal.querySelector('#formPagosMixtosPOS').onsubmit = (e) => {
                    e.preventDefault();
                    const totalPagado = pagos.reduce((sum, p) => sum + Number(p.monto || 0), 0);
                    const msgEl = modal.querySelector('#msgPagosMixtosPOS');
                    msgEl.textContent = '';
                    if (pagos.some(p => !p.metodo_pago_id || !p.monto)) {
                        msgEl.textContent = "Completa todos los métodos y montos.";
                        return;
                    }
                    if (totalPagado !== total) {
                        msgEl.textContent = "El total de los pagos debe sumar exactamente $" + total;
                        return;
                    }
                    body.removeChild(modal);
                    callback(pagos.map(p => ({ metodo_pago_id: p.metodo_pago_id, monto: Number(p.monto) })));
                };
            }

        } catch (err) {
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Confirmar y Registrar Alquiler"; }
            alert("Error: " + (err.message || "Ocurrió un problema al registrar la reserva"));
        }
    };
}

// ===================== MODAL EXTENDER TIEMPO (POS STYLE - COMPLETO) =====================
async function showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    let horarios, tiempos, metodosPagoExtension;
    try {
        let reservaActiva = null;
        for (const estado of ['activa', 'ocupada', 'tiempo agotado']) {
            const { data, error } = await supabase
                .from('reservas')
                .select('id, fecha_fin, fecha_inicio, cliente_nombre, monto_total, metodo_pago_id')
                .eq('habitacion_id', room.id)
                .eq('estado', estado)
                .order('fecha_inicio', { ascending: false })
                .limit(1);

            if (error && error.code !== 'PGRST116') throw error;
            if (data && data.length > 0) {
                reservaActiva = data[0];
                break;
            }
        }
        if (!reservaActiva) {
            mostrarInfoModalGlobal("No se encontró reserva activa, ocupada o con tiempo agotado para extender.", "Sin reserva activa");
            return;
        }
        [horarios, tiempos, metodosPagoExtension] = await Promise.all([
            getHorariosHotel(supabase, hotelId),
            getTiemposEstancia(supabase, hotelId),
            getMetodosPago(supabase, hotelId)
        ]);

        const tarifaNocheUnicaExt = tiempos.find(t => t.tipo_unidad === 'noche' && t.cantidad_unidad === 1);
        const precioNocheHabitacionExt = room.precio || 0;

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
                <div class="w-full md:w-3/5 p-6 md:p-8 space-y-5">
                    <div class="flex justify-between items-center"><h3 class="text-2xl font-bold text-purple-700">Extender Estancia: ${room.nombre}</h3><button id="close-modal-extender" class="text-gray-400 hover:text-red-600 text-3xl leading-none">&times;</button></div>
                    <div class="text-sm text-gray-600"><p>Huésped: <strong>${reservaActiva.cliente_nombre || 'N/A'}</strong></p><p>Salida actual: <strong>${formatDateTime(reservaActiva.fecha_fin)}</strong></p><p class="${tiempoRestanteMs > 0 ? 'text-green-600' : 'text-red-600'}">${tiempoRestanteStr}</p></div>
                    <form id="extender-form-pos" class="space-y-4">
                        <div>
                            <label class="form-label">Extender Por:</label>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 items-start">
                                <div class="flex flex-col"><label for="select-noches-ext" class="text-xs text-gray-500 mb-1">Noches Adicionales:</label><select name="noches_extender" id="select-noches-ext" class="form-control"><option value="">-- Noches --</option>${opcionesNochesExt.map(o => `<option value="${o.noches}">${o.label}</option>`).join('')}</select></div>
                                <div class="flex flex-col" id="container-noches-pers-ext" style="display:none;"><label for="input-noches-pers-ext" class="text-xs text-gray-500 mb-1">Noches (Personalizado):</label><input type="number" min="1" max="365" step="1" placeholder="N°" id="input-noches-pers-ext" name="noches_personalizada_ext" class="form-control"/></div>
                                <div class="flex flex-col"><label for="select-horas-ext" class="text-xs text-gray-500 mb-1">Horas Adicionales:</label><select name="horas_extender" id="select-horas-ext" class="form-control"><option value="">-- Horas --</option>${opcionesHorasExt.map(o => `<option value="${o.minutos}">${o.label}</option>`).join('')}</select></div>
                            </div>
                        </div>
                        <div><label for="metodo_pago_ext_id" class="form-label">Método de Pago (Extensión)</label><select required name="metodo_pago_ext_id" id="metodo_pago_ext_id" class="form-control"><option value="">-- Seleccionar --</option>${metodosPagoExtension.map(mp => `<option value="${mp.id}" ${reservaActiva.metodo_pago_id === mp.id ? 'selected' : ''}>${mp.nombre}</option>`).join('')}</select></div>
                        <div class="pt-3"><button type="submit" class="button button-success w-full py-3 text-lg font-semibold" style="background-color:#a21caf;">Confirmar Extensión</button></div>
                    </form>
                </div>
                <div class="w-full md:w-2/5 bg-slate-800 text-white p-6 md:p-8 flex flex-col justify-between">
                    <div><h4 class="text-2xl font-semibold text-center border-b border-slate-600 pb-3 mb-4 text-purple-400">Costo de Extensión</h4><div class="space-y-3 text-sm"><div class="flex justify-between"><span>Extensión:</span> <strong id="ticket-ext-description" class="text-right">Seleccione duración</strong></div><div class="flex justify-between"><span>Costo Extensión:</span> <strong id="ticket-ext-price" class="text-right">${formatCurrency(0)}</strong></div></div></div>
                    <div class="border-t-2 border-purple-500 pt-4 mt-6"><div class="flex justify-between items-center font-bold text-3xl text-green-400"><span>A PAGAR:</span><span id="ticket-ext-total-price">${formatCurrency(0)}</span></div><p class="text-xs text-slate-400 mt-2">Nueva salida estimada: <strong id="nueva-salida-estimada">${formatDateTime(reservaActiva.fecha_fin)}</strong></p></div>
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
            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtra = 0;
            let descExtra = "Seleccione duración";
            let nuevaFechaFinExt = new Date(reservaActiva.fecha_fin);

            const nochesSelExtInput = formDataExt.noches_personalizada_ext 
                ? formDataExt.noches_personalizada_ext
                : formDataExt.noches_extender;
            
            const nochesSelExt = nochesSelExtInput && nochesSelExtInput !== "personalizada"
                ? parseInt(nochesSelExtInput)
                : 0;
            const minutosSelExt = formDataExt.horas_extender ? parseInt(formDataExt.horas_extender) : 0;

            if (nochesSelExt > 0) {
                let fechaCalculo = new Date(reservaActiva.fecha_fin);
                const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                fechaCalculo.setHours(checkoutH, checkoutM, 0, 0);
                if (new Date(reservaActiva.fecha_fin) >= fechaCalculo) {
                    fechaCalculo.setDate(fechaCalculo.getDate() + 1);
                }
                fechaCalculo.setDate(fechaCalculo.getDate() + (nochesSelExt -1));
                nuevaFechaFinExt = fechaCalculo;

                if (tarifaNocheUnicaExt && typeof tarifaNocheUnicaExt.precio === 'number') {
                    precioExtra = tarifaNocheUnicaExt.precio * nochesSelExt;
                } else {
                    precioExtra = precioNocheHabitacionExt * nochesSelExt;
                }
                descExtra = `${nochesSelExt} noche${nochesSelExt > 1 ? 's' : ''} adicional${nochesSelExt > 1 ? 'es' : ''}`;
            } else if (minutosSelExt > 0) {
                nuevaFechaFinExt = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosSelExt * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosSelExt && t.tipo_unidad !== 'noche');
                
                let precioHorasExt = 0;
                if(tiempoSelExt){
                    precioHorasExt = (tiempoSelExt.precio === null || tiempoSelExt.precio === 0) && (typeof tiempoSelExt.precio_adicional === 'number')
                                    ? tiempoSelExt.precio_adicional
                                    : (typeof tiempoSelExt.precio === 'number' ? tiempoSelExt.precio : 0);
                }

                if (precioHorasExt > 0) {
                    precioExtra = precioHorasExt;
                    descExtra = `${formatHorasMin(minutosSelExt)} adicionales`;
                } else {
                     precioExtra = 0; 
                     descExtra = `${formatHorasMin(minutosSelExt)} adicionales - Precio no definido`;
                }
            }
            
            ticketExtDescEl.textContent = descExtra;
            ticketExtPriceEl.textContent = formatCurrency(precioExtra);
            ticketExtTotalEl.textContent = formatCurrency(precioExtra);
            nuevaSalidaEstimadaEl.textContent = formatDateTime(nuevaFechaFinExt);
        }

        selectNochesExtEl.onchange = () => {
            if (selectNochesExtEl.value === "personalizada") {
                containerNochesPersExtEl.style.display = "block"; inputNochesPersExtEl.required = true; inputNochesPersExtEl.focus();
            } else {
                containerNochesPersExtEl.style.display = "none"; inputNochesPersExtEl.required = false; inputNochesPersExtEl.value = '';
            }
            if (selectNochesExtEl.value) selectHorasExtEl.value = "";
            actualizarResumenTicketExtension();
        };
        inputNochesPersExtEl.oninput = actualizarResumenTicketExtension;
        selectHorasExtEl.onchange = () => {
            if (selectHorasExtEl.value) {
                selectNochesExtEl.value = "";
                containerNochesPersExtEl.style.display = "none"; inputNochesPersExtEl.required = false; inputNochesPersExtEl.value = '';
            }
            actualizarResumenTicketExtension();
        };
        actualizarResumenTicketExtension();

        modalContent.querySelector('#close-modal-extender').onclick = () => {
            modalContainer.style.display = "none"; modalContainer.innerHTML = '';
        };

        formExtEl.onsubmit = async (ev) => {
            ev.preventDefault();
            const formDataExt = Object.fromEntries(new FormData(formExtEl));
            let precioExtraSubmit = 0;
            let nuevaFechaFinSubmit;
            let descExtraSubmit = "";

            const nochesExtSubmitInput = formDataExt.noches_personalizada_ext ? formDataExt.noches_personalizada_ext : formDataExt.noches_extender;
            const nochesExtSubmit = nochesExtSubmitInput && nochesExtSubmitInput !== "personalizada" ? parseInt(nochesExtSubmitInput) : 0;
            const minutosExtSubmit = formDataExt.horas_extender ? parseInt(formDataExt.horas_extender) : 0;

            if (nochesExtSubmit > 0) {
                let fechaBaseExt = new Date(reservaActiva.fecha_fin);
                const [checkoutH, checkoutM] = horarios.checkout.split(':').map(Number);
                nuevaFechaFinSubmit = new Date(fechaBaseExt);
                nuevaFechaFinSubmit.setHours(checkoutH, checkoutM, 0, 0);
                if (fechaBaseExt >= nuevaFechaFinSubmit) { nuevaFechaFinSubmit.setDate(nuevaFechaFinSubmit.getDate() + 1); }
                nuevaFechaFinSubmit.setDate(nuevaFechaFinSubmit.getDate() + (nochesExtSubmit -1));
                precioExtraSubmit = (tarifaNocheUnicaExt?.precio || precioNocheHabitacionExt) * nochesExtSubmit;
                descExtraSubmit = `${nochesExtSubmit} noche(s) adicional(es)`;
            } else if (minutosExtSubmit > 0) {
                nuevaFechaFinSubmit = new Date(new Date(reservaActiva.fecha_fin).getTime() + minutosExtSubmit * 60 * 1000);
                const tiempoSelExt = tiempos.find(t => t.minutos === minutosExtSubmit && t.tipo_unidad !== 'noche');
                
                let precioHorasExtSubmit = 0;
                if(tiempoSelExt){
                    precioHorasExtSubmit = (tiempoSelExt.precio === null || tiempoSelExt.precio === 0) && (typeof tiempoSelExt.precio_adicional === 'number')
                                    ? tiempoSelExt.precio_adicional
                                    : (typeof tiempoSelExt.precio === 'number' ? tiempoSelExt.precio : 0);
                }
                precioExtraSubmit = precioHorasExtSubmit;
                descExtraSubmit = `${formatHorasMin(minutosExtSubmit)} adicionales`;
            } else { alert('Debe seleccionar noches o horas para extender.'); return; }
            
            if (precioExtraSubmit <= 0 && (nochesExtSubmit > 0 || minutosExtSubmit > 0) ) {
                const confirmNoCost = window.confirm(`La extensión seleccionada (${descExtraSubmit}) no tiene un costo asociado o es $0. ¿Desea extender el tiempo de todas formas?`);
                if (!confirmNoCost) return;
            }

            if (!formDataExt.metodo_pago_ext_id && precioExtraSubmit > 0) { 
                 alert('Por favor, seleccione un método de pago para la extensión.'); return; 
            }

            const { error: errUpdRes } = await supabase.from('reservas').update({
                fecha_fin: nuevaFechaFinSubmit.toISOString(),
                monto_total: (reservaActiva.monto_total || 0) + Math.round(precioExtraSubmit),
                estado: 'activa' 
            }).eq('id', reservaActiva.id);
            if (errUpdRes) { alert('Error actualizando reserva: ' + errUpdRes.message); return; }

            const { data: cronoAct } = await supabase.from('cronometros').select('id').eq('reserva_id', reservaActiva.id).eq('activo', true).limit(1).single();
            if (cronoAct) {
                await supabase.from('cronometros').update({ fecha_fin: nuevaFechaFinSubmit.toISOString(), actualizado_en: new Date().toISOString() }).eq('id', cronoAct.id);
            } else {
                 await supabase.from('cronometros').insert([{
                    hotel_id: hotelId, reserva_id: reservaActiva.id, habitacion_id: room.id,
                    fecha_inicio: reservaActiva.fecha_inicio, 
                    fecha_fin: nuevaFechaFinSubmit.toISOString(), activo: true,
                }]);
            }
            // ... (código para actualizar la reserva y el cronómetro) ...

// ---> INICIO DE LA MODIFICACIÓN PARA CAJA EN showExtenderTiempoModal <---
if (precioExtraSubmit > 0) { 
    // 1. Preguntamos al "conserje" por el ID del turno activo
    const turnoId = turnoService.getActiveTurnId();

    // 2. VALIDACIÓN CLAVE: Si el conserje dice que no hay turno, bloqueamos la acción.
    if (!turnoId) {
        mostrarInfoModalGlobal("ACCIÓN BLOQUEADA: No se puede registrar el pago de la extensión en caja porque no hay un turno activo.", "Turno Requerido", modalContainer);
        // OJO: La reserva y el cronómetro SÍ se actualizaron. Esto es una inconsistencia.
        // Idealmente, esta validación debería ocurrir ANTES de actualizar la reserva.
        // Si decides eso, mueve la validación del turno antes de `supabase.from('reservas').update(...)`
        // y haz un `return;` para salir del onsubmit si no hay turno.
    } else {
        // 3. Si hay turno, preparamos el movimiento de caja y AÑADIMOS EL TURNO_ID
        const movimientoCajaExtension = {
            hotel_id: hotelId, 
            tipo: 'ingreso', 
            monto: Math.round(precioExtraSubmit),
            concepto: `Extensión <span class="math-inline">\{room\.nombre\} \(</span>{descExtraSubmit}) - ${reservaActiva.cliente_nombre || 'N/A'}`,
            fecha_movimiento: new Date().toISOString(), 
            usuario_id: currentUser?.id, 
            reserva_id: reservaActiva.id,
            metodo_pago_id: formDataExt.metodo_pago_ext_id,
            turno_id: turnoId // <-- ¡LA LÍNEA CLAVE AÑADIDA!
        };

        // 4. Insertamos en la tabla caja
        const { error: errorCajaExtension } = await supabase.from('caja').insert(movimientoCajaExtension); // Ya no es un array

        if (errorCajaExtension) {
            console.error("Error registrando extensión en caja:", errorCajaExtension);
            mostrarInfoModalGlobal(`Error al registrar el pago de la extensión en caja: ${errorCajaExtension.message}. La extensión de la reserva podría necesitar ajuste manual en caja.`, "Error en Caja", modalContainer);
        }
    }
}
// ---> FIN DE LA MODIFICACIÓN PARA CAJA EN showExtenderTiempoModal <---

// ... (código para actualizar estado de habitación si es necesario y recargar) ...
            if (room.estado === 'tiempo agotado') {
                await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
            }
            modalContainer.style.display = "none"; modalContainer.innerHTML = '';
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        };
    } catch (err) {
        console.error("Error en showExtenderTiempoModal:", err);
        mostrarInfoModalGlobal(err.message || "Error al preparar modal de extensión.", "Error", modalContainer);
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
function mostrarInfoModalGlobal(htmlContent, title = "Información", modalContainerRef = null) {
    const container = modalContainerRef || document.getElementById('modal-container');
    if (!container) {
        console.error("Contenedor de modal global no encontrado.");
        alert(title + "\n\n" + String(htmlContent).replace(/<[^>]*>/g, ''));
        return;
    }
    container.style.display = "flex";
    container.innerHTML = ""; 

    const modalDialog = document.createElement('div');
    modalDialog.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto relative animate-fade-in-up";
    modalDialog.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <h3 class="text-xl font-semibold text-gray-800">${title}</h3>
            <button id="close-info-modal-global" class="text-gray-400 hover:text-red-600 text-3xl leading-none p-1 -mt-2 -mr-2">&times;</button>
        </div>
        <div class="text-gray-700 max-h-[70vh] overflow-y-auto pr-2">${htmlContent}</div>
        <div class="mt-6 text-right">
            <button id="btn-ok-info-modal-global" class="button button-primary py-2 px-4">Entendido</button>
        </div>
    `;
    container.appendChild(modalDialog);
    
    const closeAndClean = () => {
        container.style.display = "none";
        container.innerHTML = '';
    };
    container.onclick = (e) => { 
        if (e.target === container) closeAndClean();
    };
    modalDialog.querySelector('#close-info-modal-global').onclick = closeAndClean;
    modalDialog.querySelector('#btn-ok-info-modal-global').onclick = closeAndClean;
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
