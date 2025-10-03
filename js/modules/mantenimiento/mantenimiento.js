// js/modules/mantenimiento/mantenimiento.js

import { showLoading, showError } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// ======================= GESTIÓN DEL MÓDULO ========================

// --- INICIO DE LA CORRECCIÓN DE SUSCRIPCIÓN ---
// Variables para gestionar la suscripción de Realtime y la instancia de Supabase.
// Esto es crucial para evitar errores de "canal duplicado".
let mantenimientoSubscription = null;
let supabaseInstance = null;
// --- FIN DE LA CORRECCIÓN DE SUSCRIPCIÓN ---


/**
 * Función principal que se ejecuta cuando el enrutador carga este módulo.
 * Debe estar exportada y llamarse 'mount'.
 */
export async function mount(container, supabase, currentUser, hotelId) {
  // Guardamos la instancia de Supabase para poder usarla en unmount y limpiar la suscripción.
  supabaseInstance = supabase;

  // Renderizamos el HTML base del módulo.
  container.innerHTML = `
    <h2 class="text-2xl font-bold mb-6 flex items-center gap-2">🛠️ <span>Mantenimiento</span></h2>
    <div class="mb-4 flex flex-row gap-2 flex-wrap items-center">
      <select id="filtro-estado" class="form-control w-auto rounded-lg">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_progreso">En progreso</option>
        <option value="completada">Completada</option>
        <option value="cancelada">Cancelada</option>
      </select>
      <button id="btn-filtrar" class="button button-primary">Filtrar</button>
      <button id="btn-nueva-tarea" class="button button-success ml-auto">+ Nueva tarea</button>
    </div>
    <div id="mant-list" class="mt-4"></div>
    <div id="mant-modal"></div>
  `;

  // Asignamos los eventos a los botones principales.
  container.querySelector('#btn-filtrar').onclick = () => renderTareas(container, supabase, hotelId, currentUser);
  container.querySelector('#btn-nueva-tarea').onclick = () => showModalTarea(container, supabase, hotelId, currentUser, null);

  // Carga inicial de las tareas.
  await renderTareas(container, supabase, hotelId, currentUser);

  // --- INICIO DE LA CORRECCIÓN DE SUSCRIPCIÓN ---
  // Nos aseguramos de que no haya suscripciones previas activas antes de crear una nueva.
  if (mantenimientoSubscription) {
    supabase.removeChannel(mantenimientoSubscription);
    mantenimientoSubscription = null;
  }

  // Creamos la suscripción a la tabla de tareas UNA SOLA VEZ al montar el módulo.
  mantenimientoSubscription = supabase.channel('public:tareas_mantenimiento')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tareas_mantenimiento' }, (payload) => {
        console.log('Cambio detectado en tareas_mantenimiento, recargando lista...', payload);
        renderTareas(container, supabase, hotelId, currentUser);
    })
    .subscribe(status => {
        if (status === 'SUBSCRIBED') {
            console.log('Conectado al canal de tareas de mantenimiento!');
        }
        if (status === 'CHANNEL_ERROR') {
            console.error('Error en la suscripción al canal de mantenimiento:', status);
        }
    });
  // --- FIN DE LA CORRECCIÓN DE SUSCRIPCIÓN ---
}

/**
 * Función que se ejecuta cuando el enrutador abandona este módulo.
 * Debe estar exportada y llamarse 'unmount'.
 */
export function unmount() {
  console.log("Desmontando módulo de mantenimiento y limpiando suscripción...");
  // --- INICIO DE LA CORRECCIÓN DE SUSCRIPCIÓN ---
  // Es VITAL eliminar la suscripción al salir para evitar errores.
  if (mantenimientoSubscription && supabaseInstance) {
      supabaseInstance.removeChannel(mantenimientoSubscription)
        .catch(error => console.error("Error al remover el canal de mantenimiento:", error));
      mantenimientoSubscription = null;
  }
  supabaseInstance = null; // Limpiamos la referencia.
  // --- FIN DE LA CORRECCIÓN DE SUSCRIPCIÓN ---
}


// ======================= RENDERIZADO Y LÓGICA ========================

// --- RENDERIZAR LA LISTA DE TAREAS ---
async function renderTareas(container, supabase, hotelId, currentUser) {
  const list = container.querySelector('#mant-list');
  if (!list) return;

  showLoading(list);
  const estadoFiltro = container.querySelector('#filtro-estado')?.value || "";

  // Optimizamos obteniendo mapas de habitaciones y usuarios
  const { data: habitacionesData } = await supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId);
  const habMap = new Map((habitacionesData || []).map(h => [h.id, h.nombre]));

  const { data: usuariosData } = await supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId);
  const userMap = new Map((usuariosData || []).map(u => [u.id, u.nombre || u.correo || u.id]));

  let query = supabase
    .from('tareas_mantenimiento')
    .select('id, habitacion_id, titulo, descripcion, prioridad, estado, tipo, fecha_programada, fecha_completada, asignada_a, creado_en')
    .eq('hotel_id', hotelId)
    .order('creado_en', { ascending: false });

  if (estadoFiltro) {
    query = query.eq('estado', estadoFiltro);
  }

  const { data: tareas, error } = await query;

  if (error) {
    showError(list, "Error cargando tareas: " + error.message);
    return;
  }

  if (!tareas || tareas.length === 0) {
    list.innerHTML = `<div class="p-4 text-center text-gray-500 bg-gray-50 rounded-lg">No hay tareas de mantenimiento que coincidan con los filtros.</div>`;
    return;
  }

  list.innerHTML = `
    <div class="overflow-auto rounded-xl shadow-md bg-white">
      <table class="min-w-full table-auto border-collapse text-sm md:text-base">
        <thead class="bg-gray-100 border-b">
          <tr>
            <th class="py-3 px-3 text-left">Encargado</th>
            <th class="py-3 px-3 text-left">Título</th>
            <th class="py-3 px-3 text-left">Habitación</th>
            <th class="py-3 px-3 text-center">Prioridad</th>
            <th class="py-3 px-3 text-center">Estado</th>
            <th class="py-3 px-3 text-left">Fecha Reporte</th>
            <th class="py-3 px-3 text-center">Acciones</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          ${tareas.map(t => `
            <tr class="hover:bg-blue-50 transition">
              <td class="py-2 px-3 font-semibold">${userMap.get(t.asignada_a) || 'No asignado'}</td>
              <td class="py-2 px-3">${t.titulo || '-'}</td>
              <td class="py-2 px-3">${t.habitacion_id ? (habMap.get(t.habitacion_id) || 'N/A') : 'General'}</td>
              <td class="py-2 px-3 text-center">${renderPrioridad(t.prioridad, true)}</td>
              <td class="py-2 px-3 text-center">${renderEstado(t.estado, true)}</td>
              <td class="py-2 px-3">${t.creado_en ? new Date(t.creado_en).toLocaleString() : ''}</td>
              <td class="py-2 px-3 text-center">
                <select class="accion-select border rounded-lg bg-gray-50 px-2 py-1 cursor-pointer" data-id="${t.id}">
                  <option value="">Acción…</option>
                  <option value="editar">✏️ Editar</option>
                  <option value="estado">🔄 Cambiar estado</option>
                  <option value="eliminar">🗑️ Eliminar</option>
                </select>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  list.querySelectorAll('.accion-select').forEach(select => {
    select.onchange = async function() {
      const tareaId = this.dataset.id;
      const tarea = tareas.find(t => t.id == tareaId);
      if (!tarea) return;

      if (this.value === "editar") {
        await showModalTarea(container, supabase, hotelId, currentUser, tarea);
      } else if (this.value === "estado") {
        await cambiarEstadoTarea(container, supabase, hotelId, tarea, currentUser);
      } else if (this.value === "eliminar") {
        await eliminarTarea(container, supabase, hotelId, tarea, currentUser);
      }
      this.value = "";
    };
  });
}

/**
 * Muestra el modal para crear o editar una tarea.
 * Se exporta para poder ser llamada desde otros módulos como mapa-habitaciones.js.
 */
// js/modules/mantenimiento/mantenimiento.js

// ... (asegúrate de que tus importaciones y otras funciones estén aquí) ...

/**
 * Muestra el modal para crear o editar una tarea.
 * AHORA TAMBIÉN GESTIONA EL CAMBIO DE ESTADO DE LA HABITACIÓN Y RESERVAS.
 * Se exporta para poder ser llamada desde otros módulos.
 */
export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  // Lógica flexible para encontrar el contenedor del modal
  let modalTargetContainer = container.querySelector('#mant-modal');
  if (!modalTargetContainer) {
    modalTargetContainer = container;
  }
  
  const { data: habitaciones } = await supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId).order('nombre');
  const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId).order('nombre');

  // El HTML del modal no necesita cambios.
  modalTargetContainer.innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 relative animate-fadeIn">
        <button id="close-modal-mant" class="absolute top-3 right-4 text-gray-400 hover:text-red-600 text-3xl transition">&times;</button>
        <h3 class="text-2xl font-bold text-gray-800 mb-5">${tarea && tarea.id ? "Editar Tarea" : "Nueva Tarea de Mantenimiento"}</h3>
        <form id="mant-form">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Encargado <span class="text-red-500">*</span></label>
              <select required name="asignada_a" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">Seleccione un usuario</option>
                ${(usuarios || []).map(u => `<option value="${u.id}" ${tarea?.asignada_a === u.id ? "selected" : ""}>${u.nombre || u.correo}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Habitación (Opcional)</label>
              <select name="habitacion_id" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">General / Sin asignar</option>
                ${(habitaciones || []).map(h => `<option value="${h.id}" ${tarea?.habitacion_id === h.id ? "selected" : ""}>${h.nombre}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Prioridad</label>
              <select name="prioridad" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="0" ${tarea?.prioridad == 0 ? "selected" : ""}>Baja</option>
                <option value="1" ${tarea?.prioridad == 1 ? "selected" : ""}>Media</option>
                <option value="2" ${!tarea || tarea?.prioridad == 2 ? "selected" : ""}>Alta</option>
                <option value="3" ${tarea?.prioridad == 3 ? "selected" : ""}>Urgente</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Estado</label>
              <select name="estado" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="pendiente" ${!tarea || tarea?.estado === "pendiente" ? "selected" : ""}>Pendiente</option>
                <option value="en_progreso" ${tarea?.estado === "en_progreso" ? "selected" : ""}>En progreso</option>
                <option value="completada" ${tarea?.estado === "completada" ? "selected" : ""}>Completada</option>
                <option value="cancelada" ${tarea?.estado === "cancelada" ? "selected" : ""}>Cancelada</option>
              </select>
            </div>
            <div class="md:col-span-2">
              <label class="block text-sm font-semibold mb-1">Título <span class="text-red-500">*</span></label>
              <input type="text" name="titulo" class="form-control w-full rounded-lg border-gray-300 p-2" value="${tarea?.titulo ?? ''}" required>
            </div>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-semibold mb-1">Descripción</label>
            <textarea name="descripcion" class="form-control w-full rounded-lg border-gray-300 p-2 min-h-[80px]">${tarea?.descripcion ?? ''}</textarea>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-semibold mb-1">Fecha Programada</label>
            <input name="fecha_programada" type="date" class="form-control w-full rounded-lg border-gray-300 p-2" value="${tarea?.fecha_programada?.split('T')[0] ?? ''}">
          </div>
          <button type="submit" class="button bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-lg w-full shadow-lg transition text-lg">${tarea && tarea.id ? "Actualizar Tarea" : "Crear Tarea"}</button>
        </form>
      </div>
    </div>
  `;
  
  const closeModal = () => {
    modalTargetContainer.innerHTML = '';
  };
  
  modalTargetContainer.querySelector('#close-modal-mant').onclick = closeModal;

// En: js/modules/mantenimiento/mantenimiento.js
// Reemplaza la función onsubmit dentro de showModalTarea con esta versión final.

modalTargetContainer.querySelector('#mant-form').onsubmit = async (e) => {
    e.preventDefault();
    const formData = Object.fromEntries(new FormData(e.target));
    
    const dataToSave = {
        ...formData,
        prioridad: Number(formData.prioridad),
        asignada_a: formData.asignada_a || null,
        habitacion_id: formData.habitacion_id || null,
        fecha_programada: formData.fecha_programada || null
    };

    if (!dataToSave.asignada_a || !dataToSave.titulo.trim()) {
      alert("Los campos 'Encargado' y 'Título' son obligatorios.");
      return;
    }

    try {
        let tareaResult;

        // Lógica para guardar la tarea (sin cambios)
        if (!tarea?.id && dataToSave.habitacion_id) {
            const { data: reservaActiva } = await supabase.from('reservas').select('id').eq('habitacion_id', dataToSave.habitacion_id).in('estado', ['activa', 'ocupada', 'tiempo agotado']).maybeSingle();
            if (reservaActiva) {
                await supabase.from('reservas').update({ estado: 'cancelada_mantenimiento' }).eq('id', reservaActiva.id);
                await supabase.from('cronometros').update({ activo: false }).eq('reserva_id', reservaActiva.id);
            }
        }
        if (tarea && tarea.id) {
            const { data, error } = await supabase.from('tareas_mantenimiento').update(dataToSave).eq('id', tarea.id).select().single();
            if(error) throw error;
            tareaResult = data;
        } else {
            const { data, error } = await supabase.from('tareas_mantenimiento').insert([{ ...dataToSave, hotel_id: hotelId, creada_por: currentUser?.id }]).select().single();
            if(error) throw error;
            tareaResult = data;
        }
        
        // Lógica para crear la notificación
        if (tareaResult && dataToSave.habitacion_id && dataToSave.estado !== 'completada' && dataToSave.estado !== 'cancelada') {
            const habitacionNombre = habitaciones.find(h => h.id === dataToSave.habitacion_id)?.nombre || 'Desconocida';
            const mensajeNotificacion = `La habitación ${habitacionNombre} ha sido enviada a mantenimiento. Tarea: "${dataToSave.titulo}"`;

            // ================== INICIO DE LA CORRECCIÓN FINAL ==================
            
           // EN: js/modules/mantenimiento/mantenimiento.js (dentro de la función showModalTarea)
// ...
        // ================== INICIO DE LA CORRECCIÓN FINAL ==================
            
            // Corregimos la llamada para que notifique a RECEPCIÓN, que es quien necesita saberlo.
            await crearNotificacion(supabase, {
                hotelId: hotelId,
                rolDestino: 'recepcionista', // ¡CORREGIDO! Notificar a recepción.
                tipo: 'mantenimiento',
                mensaje: mensajeNotificacion,
                entidadTipo: 'tareas_mantenimiento',
                entidadId: tareaResult.id,
                generadaPorUsuarioId: currentUser.id // ¡CORREGIDO! Usamos el mismo parámetro que en limpieza.js.
            });
            
        // =================== FIN DE LA CORRECCIÓN FINAL ====================
// ...
            
            // =================== FIN DE LA CORRECCIÓN FINAL ====================
             
            console.log("Notificación de mantenimiento creada.");
        }
        
        // Lógica para actualizar el estado de la habitación (sin cambios)
        if (dataToSave.habitacion_id) {
            const esTerminada = dataToSave.estado === "completada" || dataToSave.estado === "cancelada";
            let nuevoEstadoHab = esTerminada ? 'limpieza' : 'mantenimiento';
            if (esTerminada) {
                 const { count: otrasTareasCount } = await supabase.from('tareas_mantenimiento').select('id', { count: 'exact', head: true }).eq('habitacion_id', dataToSave.habitacion_id).not('id', 'eq', tareaResult.id).in('estado', ['pendiente', 'en_progreso']);
                if (otrasTareasCount > 0) {
                    nuevoEstadoHab = 'mantenimiento';
                }
            }
            await supabase.from('habitaciones').update({ estado: nuevoEstadoHab }).eq('id', dataToSave.habitacion_id);
        }

        closeModal();
        const mantListContainer = document.querySelector('#mant-list');
        if (mantListContainer) {
            await renderTareas(container, supabase, hotelId, currentUser);
        }
        
    } catch (error) {
        console.error("Error al guardar la tarea:", error);
        alert(`No se pudo guardar la tarea. Error: ${error.message}`);
    }
};
}

// ======================= FUNCIONES DE ACCIÓN Y HELPERS ========================

async function cambiarEstadoTarea(container, supabase, hotelId, tarea, currentUser) {
  const nuevoEstado = await mostrarPromptSelectEstado(tarea.estado);
  if (!nuevoEstado || nuevoEstado === tarea.estado) return;

  const update = { estado: nuevoEstado };
  if (nuevoEstado === "completada") {
    update.fecha_completada = new Date().toISOString();
  }

  const { error: updateError } = await supabase.from('tareas_mantenimiento').update(update).eq('id', tarea.id);

  if (updateError) {
      alert("Error al actualizar la tarea: " + updateError.message);
      return;
  }

  try {
    let habitacionInfo = '';
    if (tarea.habitacion_id) {
        const { data: hab } = await supabase.from('habitaciones').select('nombre').eq('id', tarea.habitacion_id).single();
        if(hab) habitacionInfo = `(Hab. ${hab.nombre})`;
    }

    const mensajeNotificacion = `Tarea "${tarea.titulo}" ${habitacionInfo} cambió a: ${nuevoEstado.replace('_', ' ')}.`;

    // --- INICIO DE LA CORRECIÓN ---
    // Usamos el tipo que ya confirmamos que existe en tu base de datos.
    await crearNotificacion(supabase, {
        hotelId: hotelId,
        rolDestino: 'recepcionista',
        tipo: 'cambio_estado_mantenimiento', // ¡ESTE ES EL VALOR CORRECTO!
        mensaje: mensajeNotificacion,
        entidadTipo: 'tareas_mantenimiento',
        entidadId: tarea.id,
        generadaPorUsuarioId: currentUser.id
    });
    // --- FIN DE LA CORRECIÓN ---

  } catch (notifError) {
      console.error("Error al crear la notificación de cambio de estado:", notifError);
  }

  if (tarea.habitacion_id) {
    const esTerminada = nuevoEstado === "completada" || nuevoEstado === "cancelada";
    const { count: otrasTareasCount } = await supabase
      .from('tareas_mantenimiento')
      .select('id', { count: 'exact', head: true })
      .eq('habitacion_id', tarea.habitacion_id)
      .not('id', 'eq', tarea.id)
      .in('estado', ['pendiente', 'en_progreso']);

    if (esTerminada && (otrasTareasCount === 0)) {
        await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', tarea.habitacion_id);
    }
  }

  await renderTareas(container, supabase, hotelId, currentUser);
}

async function eliminarTarea(container, supabase, hotelId, tarea, currentUser) {
  const confirmado = await mostrarConfirmacion(`¿Seguro que deseas eliminar la tarea "${tarea.titulo}"?`);
  if (!confirmado) return;

  await supabase.from('tareas_mantenimiento').delete().eq('id', tarea.id);
  
  if (tarea.habitacion_id) {
    const { data: otrasTareas } = await supabase
      .from('tareas_mantenimiento')
      .select('id', { count: 'exact' })
      .eq('habitacion_id', tarea.habitacion_id)
      .in('estado', ['pendiente', 'en_progreso']);

    if (!otrasTareas || otrasTareas.length === 0) {
      await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', tarea.habitacion_id);
    }
  }
  
  await renderTareas(container, supabase, hotelId, currentUser);
}

// --- Helpers Visuales ---
function renderPrioridad(p, color = false) {
  const prioridades = {
    0: { txt: "Baja", cls: "bg-green-100 text-green-800" },
    1: { txt: "Media", cls: "bg-yellow-100 text-yellow-800" },
    2: { txt: "Alta", cls: "bg-orange-100 text-orange-800" },
    3: { txt: "Urgente", cls: "bg-red-100 text-red-800" },
  };
  const item = prioridades[p] || { txt: "-", cls: "" };
  if (color) return `<span class="px-2 py-1 rounded-full font-semibold text-xs ${item.cls}">${item.txt}</span>`;
  return item.txt;
}

function renderEstado(e, color = false) {
  const map = {
    pendiente: { txt: "Pendiente", cls: "bg-orange-100 text-orange-700" },
    en_progreso: { txt: "En Progreso", cls: "bg-blue-100 text-blue-700" },
    completada: { txt: "Completada", cls: "bg-green-100 text-green-700" },
    cancelada: { txt: "Cancelada", cls: "bg-gray-200 text-gray-600" },
  };
  const item = map[e] || { txt: e, cls: "" };
  if (color) return `<span class="px-2 py-1 rounded-full font-semibold text-xs ${item.cls}">${item.txt}</span>`;
  return item.txt;
}

// --- Helpers de UI (Modales de confirmación) ---
function mostrarPromptSelectEstado(estadoActual) {
  return new Promise(resolve => {
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50 p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-lg w-full max-w-xs p-6 relative animate-fadeIn">
        <h3 class="text-lg font-bold mb-4">Cambiar Estado de la Tarea</h3>
        <select id="select-estado-tarea" class="form-control mb-5 w-full">
          <option value="pendiente" ${estadoActual === "pendiente" ? "selected" : ""}>Pendiente</option>
          <option value="en_progreso" ${estadoActual === "en_progreso" ? "selected" : ""}>En Progreso</option>
          <option value="completada" ${estadoActual === "completada" ? "selected" : ""}>Completada</option>
          <option value="cancelada" ${estadoActual === "cancelada" ? "selected" : ""}>Cancelada</option>
        </select>
        <div class="flex gap-3">
          <button id="btn-confirmar-estado" class="button button-success w-full">Aceptar</button>
          <button id="btn-cancelar-estado" class="button button-secondary w-full">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const cleanup = (value) => {
      document.body.removeChild(modal);
      resolve(value);
    };

    modal.querySelector("#btn-confirmar-estado").onclick = () => cleanup(modal.querySelector("#select-estado-tarea").value);
    modal.querySelector("#btn-cancelar-estado").onclick = () => cleanup(null);
  });
}

function mostrarConfirmacion(mensaje) {
  return new Promise(resolve => {
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4";
    modal.innerHTML = `
      <div class="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-center animate-fadeIn">
        <h3 class="text-lg font-semibold text-gray-800 mb-5">${mensaje}</h3>
        <div class="flex justify-center gap-4">
          <button id="btn-confirmar-accion" class="button button-danger flex-1">Confirmar</button>
          <button id="btn-cancelar-accion" class="button button-secondary flex-1">Cancelar</button>
        </div>
      </div>
      <style>
        @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .animate-fadeIn { animation: fadeIn 0.2s ease-out; }
      </style>
    `;
    document.body.appendChild(modal);

    const cleanup = (result) => {
      document.body.removeChild(modal);
      resolve(result);
    };

    modal.querySelector("#btn-confirmar-accion").onclick = () => cleanup(true);
    modal.querySelector("#btn-cancelar-accion").onclick = () => cleanup(false);
  });
}