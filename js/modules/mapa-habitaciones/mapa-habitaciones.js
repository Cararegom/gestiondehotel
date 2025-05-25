// js/modules/mapa_habitaciones/mapa_habitaciones.js

// ======================= BLOQUE PRINCIPAL ========================
let containerGlobal = null;
let supabaseGlobal = null;
let currentUserGlobal = null;
let hotelIdGlobal = null;

let currentRooms = [];
let cronometrosInterval = {};
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

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

    container.innerHTML = `
        <div class="mb-8 px-4 md:px-0">
            <h2 class="text-3xl font-bold text-gray-800 flex items-center">
                Mapa de Habitaciones
            </h2>
        </div>
        <div id="room-map-list" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 px-4 md:px-0"></div>
        <div id="modal-container" class="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" style="display:none;"></div>
    `;

    // IMPORTANTE: el roomsListEl se busca después de inyectar el HTML
    const roomsListEl = container.querySelector("#room-map-list");
    if (!roomsListEl) {
        console.error("No se encontró el div #room-map-list dentro del container. Corrige el template HTML.");
        return;
    }

    // Llama a renderRooms pasando el roomsListEl
    await renderRooms(roomsListEl, supabase, currentUser, hotelId);
}




document.addEventListener('datosActualizados', () => {
    // Solo refresca si todo está listo
    if (containerGlobal && supabaseGlobal && currentUserGlobal && hotelIdGlobal) {
        renderRooms(containerGlobal, supabaseGlobal, currentUserGlobal, hotelIdGlobal);
    }
});
export function unmount() {
    Object.values(cronometrosInterval).forEach(clearInterval);
    cronometrosInterval = {};
    const modalContainer = document.getElementById('modal-container');
    if (modalContainer) {
      modalContainer.style.display = 'none';
      modalContainer.innerHTML = '';
    }
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

    habitaciones.forEach(room => {
        listEl.appendChild(roomCard(room, supabase, currentUser, hotelId, listEl));
        if (room.estado === 'ocupada' || room.estado === 'tiempo agotado') {
            startCronometro(room, supabase, hotelId, listEl);
        }
    });
}


// ================== CARD DE HABITACIÓN (VISUAL MEJORADO v3 - CORRECCIÓN BADGE) ===================
function roomCard(room, supabase, currentUser, hotelId, mainAppContainer) {
    const card = document.createElement('div');
    card.className = `room-card bg-white rounded-2xl shadow-xl overflow-hidden transition-all duration-300 ease-in-out hover:shadow-2xl hover:-translate-y-1 flex flex-col group relative`;

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
        </div>
    `;
    
    card.appendChild(contentWrapper);
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
    botonesHtml += `<button id="btn-facturar" class="button w-full mb-2 py-2.5" style="background:#22d3ee;color:#047857;font-weight:bold;">Facturar Todo</button>`;
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
    if (btn) btn.onclick = handler;
  };

  setupButtonListener('close-modal-acciones', () => {
    modalContainer.style.display = "none";
    modalContainer.innerHTML = '';
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
      await supabase.from('reservas').update({
        estado: 'activa',
        fecha_inicio: new Date().toISOString()
      }).eq('id', reservaFutura.id);

      await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

      // Crear cronómetro para la reserva
      await supabase.from('cronometros').insert([{
        hotel_id: hotelId,
        reserva_id: reservaFutura.id,
        habitacion_id: room.id,
        fecha_inicio: new Date().toISOString(),
        fecha_fin: reservaFutura.fecha_fin,
        activo: true
      }]);

      mostrarInfoModalGlobal("Check-in realizado correctamente. ¡La habitación está ocupada!", "Check-in Exitoso");
      modalContainer.style.display = "none";
      modalContainer.innerHTML = '';
      await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    });
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
  setupButtonListener('btn-ver-consumos', async () => {
    // 1. Buscar la reserva activa
    const { data: reserva, error: errRes } = await supabase
        .from('reservas')
        .select('id, cliente_nombre, monto_total')
        .eq('habitacion_id', room.id)
        .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .single();

    if (errRes || !reserva) {
        mostrarInfoModalGlobal("No hay reserva activa con consumos para esta habitación.", "Consumos");
        return;
    }

    // 2. Buscar ventas de tienda asociadas a esa reserva
    const { data: ventasTienda, error: errVentas } = await supabase
        .from('ventas_tienda')
        .select('id, total_venta')
        .eq('reserva_id', reserva.id);

    // 3. Buscar los detalles de ventas (productos vendidos en tienda)
    let detalles = [];
    let totalTienda = 0;

    if (ventasTienda && ventasTienda.length > 0) {
        const ventaIds = ventasTienda.map(v => v.id);
        // Supabase no permite más de 1000 elementos en .in, pero para hotel nunca será tanto.
        const { data: detallesVentas, error: errDetalles } = await supabase
            .from('detalle_ventas_tienda')
            .select('producto_id, cantidad, precio_unitario_venta, subtotal, producto:producto_id (nombre)')
            .in('venta_id', ventaIds);

        if (detallesVentas && detallesVentas.length > 0) {
            detalles = detallesVentas;
            totalTienda = detallesVentas.reduce((sum, det) => sum + (det.subtotal || 0), 0);
        }
    }

    // 4. Mostrar resumen
    let html = `<b>Consumos habitación:</b><ul>`;
    let totalGeneral = 0;

    // Estancia habitación
    html += `<li>Estancia: <b>${formatCurrency(reserva.monto_total)}</b></li>`;
    totalGeneral += reserva.monto_total || 0;

    // Tienda
    if (detalles.length > 0) {
        html += `<li style="margin-top:8px;"><b>Consumos Tienda:</b><ul>`;
        detalles.forEach(t => {
            html += `<li>${t.cantidad} x ${(t.producto?.nombre || 'Producto')} = <b>${formatCurrency(t.subtotal)}</b></li>`;
        });
        html += `</ul><b>Total Tienda:</b> ${formatCurrency(totalTienda)}</li>`;
        totalGeneral += totalTienda;
    } else if (ventasTienda && ventasTienda.length > 0) {
        html += `<li><b>Total Tienda:</b> ${formatCurrency(ventasTienda.reduce((sum, v) => sum + (v.total_venta || 0), 0))}</li>`;
        totalGeneral += ventasTienda.reduce((sum, v) => sum + (v.total_venta || 0), 0);
    }

    html += `</ul><hr><b style="font-size:1.1em;">Total a pagar: ${formatCurrency(totalGeneral)}</b>`;

    mostrarInfoModalGlobal(html, "Consumos Estancia + Tienda");
});



  // =================== BOTÓN FACTURAR (igual que antes)
  setupButtonListener('btn-facturar', async () => {
    // 1. Buscar reserva activa
    const { data: reserva } = await supabase
      .from('reservas')
      .select('id, cliente_nombre, monto_total, fecha_inicio, fecha_fin')
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .order('fecha_inicio', { ascending: false })
      .limit(1)
      .single();

    if (!reserva) {
      mostrarInfoModalGlobal("No hay reserva activa para facturar.", "Facturación");
      return;
    }

    // 2. Buscar ventas de tienda asociadas a esa reserva
    const { data: ventasTienda } = await supabase
      .from('ventas_tienda')
      .select('id, total_venta')
      .eq('reserva_id', reserva.id);

    let totalTienda = ventasTienda?.reduce((sum, v) => sum + (v.total_venta || 0), 0) || 0;

    // 3. Detalles del resumen
    let totalGeneral = (reserva.monto_total || 0) + totalTienda;

    let html = `
        <b>Factura Estancia + Consumos</b>
        <br>
        <b>Huésped:</b> ${reserva.cliente_nombre}<br>
        <b>Fecha:</b> ${formatDateTime(reserva.fecha_inicio)} - ${formatDateTime(reserva.fecha_fin)}<br>
        <b>Estancia:</b> ${formatCurrency(reserva.monto_total)}<br>
        ${totalTienda > 0 ? `<b>Consumos Tienda:</b> ${formatCurrency(totalTienda)}<br>` : ''}
        <hr>
        <b style="font-size:1.3em;color:green;">Total a pagar: ${formatCurrency(totalGeneral)}</b><br><br>
        <button onclick="window.print()" class="button button-primary">Imprimir Recibo</button>
    `;

    mostrarInfoModalGlobal(html, "Factura");
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
  <b>🆔 Nombre:</b> ${reserva.cliente_nombre}<br>
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
        console.error("Error cargando datos para modal de alquiler:", err);
        mostrarInfoModalGlobal("No se pudieron cargar los datos necesarios para el alquiler. Intente de nuevo.", "Error de Carga", modalContainer);
        return;
    }
    
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
                        <div><label for="cantidad_huespedes" class="form-label">Cant. Huéspedes</label><input name="cantidad_huespedes" id="cantidad_huespedes" type="number" class="form-control" min="1" max="${room.capacidad_maxima || 10}" value="1"></div>
                        <div><label for="metodo_pago_id" class="form-label">Método de Pago</label><select required name="metodo_pago_id" id="metodo_pago_id" class="form-control"><option value="">-- Seleccionar --</option>${metodosPago.map(mp => `<option value="${mp.id}">${mp.nombre}</option>`).join('')}</select></div>
                    </div>
                     <div class="pt-3"><button type="submit" class="button button-success w-full py-3 text-lg font-semibold">Confirmar y Registrar Alquiler</button></div>
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

    formEl.onsubmit = async (e) => {
        e.preventDefault();
        const formData = Object.fromEntries(new FormData(formEl));
        const detallesEstancia = calcularDetallesEstancia(formData, room, tiempos, horarios, tarifaNocheUnica);

        if (detallesEstancia.precioTotal <= 0 && (!detallesEstancia.tipoCalculo) ) {
            alert('Debe seleccionar una duración válida para la estancia (noches u horas).'); return;
        }
        if (!formData.metodo_pago_id) {
            alert('Por favor, seleccione un método de pago.'); return;
        }

        const { data: reservasAnterioresActivas } = await supabase
            .from('reservas').select('id').eq('habitacion_id', room.id).eq('estado', 'activa');
        if (reservasAnterioresActivas && reservasAnterioresActivas.length > 0) {
            for (const res of reservasAnterioresActivas) {
                await supabase.from('reservas').update({ estado: 'finalizada_auto' }).eq('id', res.id);
                await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', res.id);
            }
        }
        await supabase.from('cronometros').update({ activo: false }).eq('habitacion_id', room.id).eq('activo', true).is('reserva_id', null);

        const { data: reservaData, error: errRes } = await supabase.from('reservas').insert([{
            cliente_nombre: formData.cliente_nombre, cedula: formData.cedula, telefono: formData.telefono,
            habitacion_id: room.id, hotel_id: hotelId,
            fecha_inicio: detallesEstancia.inicioAt.toISOString(), fecha_fin: detallesEstancia.finAt.toISOString(),
            monto_total: detallesEstancia.precioTotal, estado: "activa", 
            cantidad_huespedes: Number(formData.cantidad_huespedes), metodo_pago_id: formData.metodo_pago_id,
        }]).select().single();

        if (errRes) { console.error("Error creando reserva:", errRes); alert("Error creando reserva: " + errRes.message); return; }
        const reservaId = reservaData?.id;

        await supabase.from('caja').insert([{
            hotel_id: hotelId, tipo: 'ingreso', monto: detallesEstancia.precioTotal,
            concepto: `Alquiler ${room.nombre} (${detallesEstancia.descripcionEstancia}) - ${formData.cliente_nombre}`,
            fecha_movimiento: detallesEstancia.inicioAt.toISOString(), usuario_id: currentUser?.id, reserva_id: reservaId,
            metodo_pago_id: formData.metodo_pago_id
        }]);
        await supabase.from('cronometros').insert([{
            hotel_id: hotelId, reserva_id: reservaId, habitacion_id: room.id,
            fecha_inicio: detallesEstancia.inicioAt.toISOString(), fecha_fin: detallesEstancia.finAt.toISOString(), activo: true,
        }]);
        await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

        modalContainer.style.display = "none";
        modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
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
            if (precioExtraSubmit > 0) { 
                await supabase.from('caja').insert([{
                    hotel_id: hotelId, tipo: 'ingreso', monto: Math.round(precioExtraSubmit),
                    concepto: `Extensión ${room.nombre} (${descExtraSubmit}) - ${reservaActiva.cliente_nombre || 'N/A'}`,
                    fecha_movimiento: new Date().toISOString(), usuario_id: currentUser?.id, reserva_id: reservaActiva.id,
                    metodo_pago_id: formDataExt.metodo_pago_ext_id
                }]);
            }
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
            
            let tiempoAgotadoFlagInterna = false;
            
            async function updateCronoDisplay() {
                const now = new Date();
                let fechaFinDefinitiva;

                // CORRECCIÓN: Quitar .single() de esta consulta interna para evitar 406 si no hay cronómetro activo
                const { data: cronoActivoArr, error: cronoError } = await supabase.from('cronometros')
                    .select('fecha_fin')
                    .eq('reserva_id', reservaActual.id)
                    .eq('activo', true)
                    .limit(1); // Solo limit(1), no single()

                if (cronoError) {
                    console.warn(`Error consultando cronómetro para reserva ${reservaActual.id}: ${cronoError.message}`);
                    // Usar la fecha_fin de la reserva como fallback si hay error en crono
                    fechaFinDefinitiva = new Date(reservaActual.fecha_fin);
                } else if (cronoActivoArr && cronoActivoArr.length > 0 && cronoActivoArr[0].fecha_fin) {
                    fechaFinDefinitiva = new Date(cronoActivoArr[0].fecha_fin);
                } else {
                    // No se encontró cronómetro activo, usar fecha_fin de la reserva
                    fechaFinDefinitiva = new Date(reservaActual.fecha_fin);
                }
                
                let diff = fechaFinDefinitiva - now;
                const cardElement = cronometroDiv.closest('.room-card');
                const badgeElement = cardElement?.querySelector('span.badge');

                cronometroDiv.className = 'cronometro-display mt-auto text-right font-mono text-xl flex items-center justify-end pt-4 border-t border-slate-200 group-hover:border-blue-200 transition-colors duration-200';
                if (cardElement) cardElement.classList.remove('animate-pulse-fast', 'ring-4', 'ring-opacity-50', 'ring-red-500', 'ring-yellow-500');

                if (diff <= 0) { 
                    if (!tiempoAgotadoFlagInterna) {
                        tiempoAgotadoFlagInterna = true;
                        const currentRoomInMap = currentRooms.find(r => r.id === room.id);
                        if (currentRoomInMap && currentRoomInMap.estado !== "tiempo agotado" && currentRoomInMap.estado !== "mantenimiento" && currentRoomInMap.estado !== "limpieza") {
                             await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', id);
                             if (cardElement) {
                                 cardElement.classList.remove('border-yellow-500', 'bg-yellow-50', 'border-green-500', 'bg-white');
                                 cardElement.classList.add('border-red-600', 'bg-red-50');
                             }
                             if(badgeElement) {
                                badgeElement.innerHTML = `${estadoColores['tiempo agotado'].icon} <span class="ml-1">TIEMPO AGOTADO</span>`;
                                badgeElement.className = `badge ${estadoColores['tiempo agotado'].badge} px-2.5 py-1.5 text-xs font-bold rounded-full whitespace-nowrap flex items-center shadow-sm`;
                             }
                             currentRoomInMap.estado = 'tiempo agotado';
                        }
                    }
                    let diffPos = Math.abs(diff);
                    const h = String(Math.floor(diffPos / 3600000)).padStart(2, '0');
                    const m = String(Math.floor((diffPos % 3600000) / 60000)).padStart(2, '0');
                    const s = String(Math.floor((diffPos % 60000) / 1000)).padStart(2, '0');
                    cronometroDiv.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 mr-1.5 inline text-red-500 animate-ping-slow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><span class="font-bold text-red-500">-${h}:${m}:${s}</span>`;
                    if (cardElement) {
                        cardElement.classList.add('animate-pulse-fast', 'ring-4', 'ring-red-500', 'ring-opacity-50');
                    }
                } else { 
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
                    
                     const currentRoomInMap = currentRooms.find(r => r.id === room.id);
                     if (currentRoomInMap && currentRoomInMap.estado === "tiempo agotado") { 
                        await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);
                        if (cardElement) {
                            cardElement.classList.remove('border-red-600', 'bg-red-50', 'animate-pulse-fast', 'ring-4', 'ring-red-500', 'ring-opacity-50');
                            cardElement.classList.add('border-yellow-500', 'bg-yellow-50');
                        }
                        if(badgeElement) {
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
async function showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer) {
    const modalContainer = document.getElementById('modal-container');
    const confirmacion = await new Promise(resolve => {
        mostrarInfoModalGlobal(
            `¿Está seguro de que desea enviar la habitación <strong>${room.nombre}</strong> a mantenimiento? Si hay una reserva activa para esta habitación, será cancelada. Esta acción no se puede deshacer fácilmente.`,
            "Confirmar Mantenimiento",
            modalContainer
        );
        const modalDialog = modalContainer.querySelector('.bg-white');
        const btnOk = modalDialog.querySelector('#btn-ok-info-modal-global');
        const btnClose = modalDialog.querySelector('#close-info-modal-global');
        
        btnOk.textContent = "Sí, Enviar a Mantenimiento";
        btnOk.className = "button button-danger py-2 px-4 mr-2";
        const btnCancel = document.createElement('button');
        btnCancel.textContent = "Cancelar";
        btnCancel.className = "button button-neutral py-2 px-4";
        btnOk.parentElement.appendChild(btnCancel);

        btnOk.onclick = () => { resolve(true); modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };
        btnCancel.onclick = () => { resolve(false); modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };
        btnClose.onclick = () => { resolve(false); modalContainer.style.display = "none"; modalContainer.innerHTML = ''; };
    });

    if (!confirmacion) return;

    try {
        const { data: reservaActiva, error: errReserva } = await supabase
            .from('reservas')
            .select('id, fecha_fin, fecha_inicio')
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
        await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', room.id);
        mostrarInfoModalGlobal(`La habitación ${room.nombre} ha sido enviada a mantenimiento.`, "Mantenimiento Exitoso");
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    } catch (error) {
        console.error("Error enviando habitación a mantenimiento:", error);
        mostrarInfoModalGlobal(`Error al enviar a mantenimiento: ${error.message}`, "Error Mantenimiento");
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
