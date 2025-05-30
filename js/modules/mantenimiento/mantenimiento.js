// js/modules/mantenimiento/mantenimiento.js

import { showLoading, showError, clearFeedback } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// Variables para listeners
let listeners = [];

// --- MOUNT PRINCIPAL ---
export async function mount(container, supabase, currentUser, hotelId) {
  container.innerHTML = `
    <h2 class="text-2xl font-bold mb-6 flex items-center gap-2">🛠️ <span>Mantenimiento</span></h2>
    <div class="mb-4 flex flex-row gap-2 flex-wrap">
      <select id="filtro-estado" class="form-control w-auto">
        <option value="">Todos los estados</option>
        <option value="pendiente">Pendiente</option>
        <option value="en_progreso">En progreso</option>
        <option value="completada">Completada</option>
        <option value="cancelada">Cancelada</option>
      </select>
      <button id="btn-filtrar" class="button button-primary">Filtrar</button>
      <button id="btn-nueva-tarea" class="button button-success ml-auto">+ Nueva tarea</button>
    </div>
    <div id="mant-list"></div>
    <div id="mant-modal"></div>
  `;
  // Listeners
  container.querySelector('#btn-filtrar').onclick = () => renderTareas(container, supabase, hotelId, currentUser);
  container.querySelector('#btn-nueva-tarea').onclick = () => showModalTarea(container, supabase, hotelId, currentUser);

  await renderTareas(container, supabase, hotelId, currentUser);
}

export function unmount() {
  listeners.forEach(fn => fn && fn());
  listeners = [];
}

// --- RENDER LISTA PRINCIPAL ---
async function renderTareas(container, supabase, hotelId, currentUser) {
  showLoading(container.querySelector('#mant-list'));
  const estadoFiltro = container.querySelector('#filtro-estado')?.value || "";

  // Traer habitaciones
  const { data: habitaciones } = await supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId);
  const habMap = {};
  (habitaciones || []).forEach(h => { habMap[h.id] = h.nombre; });

  // Traer usuarios (map ID=>nombre/correo)
  const { data: usuarios } = await supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId);
  const userMap = {};
  (usuarios || []).forEach(u => { userMap[u.id] = u.nombre || u.correo || u.id; });

  let query = supabase
    .from('tareas_mantenimiento')
    .select('id, habitacion_id, titulo, descripcion, prioridad, estado, tipo, fecha_programada, fecha_completada, asignada_a, creado_en')
    .eq('hotel_id', hotelId)
    .order('creado_en', { ascending: false });

  if (estadoFiltro) query = query.eq('estado', estadoFiltro);

  const { data: tareas, error } = await query;
  const list = container.querySelector('#mant-list');
  if (!list) return;
  if (error) {
    showError(list, "Error cargando tareas: " + error.message);
    return;
  }

  if (!tareas || tareas.length === 0) {
    list.innerHTML = `<div class="p-4 text-gray-500">No hay tareas de mantenimiento registradas.</div>`;
    return;
  }

  // Render tabla con usuario encargado
  list.innerHTML = `
    <div class="overflow-auto rounded-xl shadow-md bg-white">
    <table class="min-w-full table-auto border text-sm md:text-base">
      <thead class="bg-blue-50 border-b">
        <tr>
          <th class="py-3 px-2">Encargado</th>
          <th class="py-3 px-2">Título</th>
          <th class="py-3 px-2">Descripción</th>
          <th class="py-3 px-2">Habitación</th>
          <th class="py-3 px-2">Prioridad</th>
          <th class="py-3 px-2">Estado</th>
          <th class="py-3 px-2">Fecha reporte</th>
          <th class="py-3 px-2">Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${tareas.map(t => `
          <tr class="border-b hover:bg-blue-50 transition">
            <td class="py-2 px-2 font-semibold">${userMap[t.asignada_a] || '-'}</td>
            <td class="py-2 px-2">${t.titulo || '-'}</td>
            <td class="py-2 px-2">${t.descripcion}</td>
            <td class="py-2 px-2">${t.habitacion_id ? (habMap[t.habitacion_id] || '---') : '-'}</td>
            <td class="py-2 px-2">${renderPrioridad(t.prioridad, true)}</td>
            <td class="py-2 px-2">${renderEstado(t.estado, true)}</td>
            <td class="py-2 px-2">${t.creado_en ? new Date(t.creado_en).toLocaleString() : ''}</td>
            <td class="py-2 px-2">
              <select class="accion-select border rounded bg-gray-50 px-2 py-1" data-id="${t.id}">
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

  // Listeners para selects de acciones
  tareas.forEach(t => {
    const select = list.querySelector(`.accion-select[data-id="${t.id}"]`);
    if (select) {
      select.onchange = async function() {
        if (this.value === "editar") {
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

        } else if (this.value === "estado") {
          await cambiarEstadoTarea(container, supabase, hotelId, t);
        } else if (this.value === "eliminar") {
          await eliminarTarea(container, supabase, hotelId, t);
        }
        this.value = "";
      };
    }
  });
}

// --- MODAL CREAR/EDITAR TAREA MEJORADO ---
let fakeContainer = document.createElement('div');
fakeContainer.id = 'mant-modal-container-mapahab';
document.body.appendChild(fakeContainer);
// AGREGA EL DIV INTERNO ESPERADO:
fakeContainer.innerHTML = '<div id="mant-modal"></div>';

export async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null, usuariosPasados = null) {
  const modal = container.querySelector('#mant-modal');
  // Traer habitaciones
  const { data: habitaciones } = await supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId);

  // Traer usuarios (para select encargado)
  const usuarios = usuariosPasados || (await supabase.from('usuarios').select('id, nombre, correo').eq('hotel_id', hotelId)).data || [];
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6 relative animate-fadeIn">
        <button id="close-modal-mant" class="absolute top-4 right-4 text-gray-400 hover:text-red-600 text-3xl transition">&times;</button>
        <div class="flex items-center gap-3 mb-4">
          <div class="bg-blue-100 text-blue-600 rounded-full p-2 text-2xl flex items-center justify-center">
            <span>🛠️</span>
          </div>
          <h3 class="text-2xl font-bold text-gray-800">${tarea ? "Editar tarea" : "Nueva tarea"}</h3>
        </div>
        <form id="mant-form">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm font-semibold mb-1">Encargado <span class="text-red-500">*</span></label>
              <select required name="asignada_a" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">Seleccione usuario</option>
                ${usuarios.map(u => `<option value="${u.id}" ${tarea?.asignada_a === u.id ? "selected" : ""}>${u.nombre || u.correo}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold mb-1">Habitación</label>
              <select name="habitacion_id" class="form-control w-full rounded-lg border-gray-300 p-2">
                <option value="">Sin asignar</option>
                ${habitaciones.map(h => `<option value="${h.id}" ${tarea?.habitacion_id === h.id ? "selected" : ""}>${h.nombre}</option>`).join('')}
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
            <div>
              <label class="block text-sm font-semibold mb-1">Título <span class="text-red-500">*</span></label>
              <input type="text" name="titulo" class="form-control w-full rounded-lg border-gray-300 p-2" value="${tarea?.titulo ?? ''}" required>
            </div>
          </div>
          <div class="mb-4">
            <label class="block text-sm font-semibold mb-1">Descripción</label>
            <textarea name="descripcion" class="form-control w-full rounded-lg border-gray-300 p-2 min-h-[80px]">${tarea?.descripcion ?? ''}</textarea>
          </div>
          <div class="mb-6">
            <label class="block text-sm font-semibold mb-1">Fecha programada</label>
            <input name="fecha_programada" type="date" class="form-control w-full rounded-lg border-gray-300 p-2" value="${tarea?.fecha_programada?.split('T')[0] ?? ''}">
          </div>
          <button type="submit" class="button bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-lg w-full shadow transition text-lg">${tarea ? "Actualizar" : "Crear"}</button>
        </form>
      </div>
    </div>
    <style>
      @keyframes fadeIn { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: none; } }
      .animate-fadeIn { animation: fadeIn 0.25s; }
      .min-h-\[80px\] { min-height: 80px; }
    </style>
  `;
  // Cerrar modal
  modal.querySelector('#close-modal-mant').onclick = () => {
    modal.innerHTML = '';
  };
  // Guardar
  modal.querySelector('#mant-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.asignada_a) return alert("El usuario encargado es obligatorio");
    if (!data.titulo || !data.titulo.trim()) {
      alert("El título de la tarea es obligatorio.");
      return;
    }
    data.prioridad = Number(data.prioridad);

    if (tarea && tarea.id) {
  // update (editar tarea existente)
  await supabase.from('tareas_mantenimiento').update(data).eq('id', tarea.id);

  // ... (resto igual)
} else {
  // create (nueva tarea)
  const { data: nuevaTarea, error: errorInsert } = await supabase.from('tareas_mantenimiento').insert([{
    ...data,
    hotel_id: hotelId,
    estado: data.estado || "pendiente",
    creada_por: currentUser?.id || null,
  }]).select().single();

  if (errorInsert) {
    alert("Error al crear la tarea de mantenimiento: " + errorInsert.message);
    return;
  }

  // ... (resto igual)


      // --- ACTUALIZAR ESTADO DE LA HABITACIÓN SI SE ASIGNÓ ---
      if (data.habitacion_id) {
        if (data.estado === "pendiente" || data.estado === "en_progreso") {
          await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', data.habitacion_id);
        }
        if (data.estado === "completada" || data.estado === "cancelada") {
          await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', data.habitacion_id);
        }
      }
    }
    modal.innerHTML = '';
    await renderTareas(container, supabase, hotelId, currentUser);
    // Notificación
    crearNotificacion(supabase, {
      hotelId,
      tipo: "mantenimiento",
      mensaje: tarea ? "Tarea de mantenimiento actualizada" : "Nueva tarea de mantenimiento registrada",
      entidadTipo: "tarea_mantenimiento",
      entidadId: tarea ? tarea.id : undefined,
      userId: currentUser?.id || null,
    }).catch(() => {});
  };
}

// --- CAMBIAR ESTADO DE TAREA ---
async function cambiarEstadoTarea(container, supabase, hotelId, tarea) {
  // Prompt select tipo lista
  const nuevoEstado = await mostrarPromptSelectEstado(tarea.estado);
  if (!nuevoEstado) return; // Cancelado
  const update = { estado: nuevoEstado };
  if (nuevoEstado === "completada") update.fecha_completada = new Date().toISOString();
  await supabase.from('tareas_mantenimiento').update(update).eq('id', tarea.id);

  // --- ACTUALIZAR ESTADO DE LA HABITACIÓN SEGÚN NUEVO ESTADO ---
  if (tarea.habitacion_id) {
    if (nuevoEstado === "pendiente" || nuevoEstado === "en_progreso") {
      await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', tarea.habitacion_id);
    }
    if (nuevoEstado === "completada" || nuevoEstado === "cancelada") {
      await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', tarea.habitacion_id);
    }
  }

  await renderTareas(container, supabase, hotelId);
}

// Prompt select para elegir estado
function mostrarPromptSelectEstado(estadoActual) {
  return new Promise(resolve => {
    // Crea modal simple
    const modal = document.createElement("div");
    modal.className = "fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50";
    modal.innerHTML = `
      <div class="bg-white rounded-lg shadow-lg w-full max-w-xs p-6 relative">
        <h3 class="text-lg font-bold mb-2">Cambiar Estado</h3>
        <select id="select-estado-tarea" class="form-control mb-4 w-full">
          <option value="pendiente" ${estadoActual === "pendiente" ? "selected" : ""}>Pendiente</option>
          <option value="en_progreso" ${estadoActual === "en_progreso" ? "selected" : ""}>En progreso</option>
          <option value="completada" ${estadoActual === "completada" ? "selected" : ""}>Completada</option>
          <option value="cancelada" ${estadoActual === "cancelada" ? "selected" : ""}>Cancelada</option>
        </select>
        <div class="flex gap-2">
          <button id="btn-confirmar-estado" class="button button-success w-full">Aceptar</button>
          <button id="btn-cancelar-estado" class="button button-danger w-full">Cancelar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector("#btn-confirmar-estado").onclick = () => {
      const estado = modal.querySelector("#select-estado-tarea").value;
      document.body.removeChild(modal);
      resolve(estado);
    };
    modal.querySelector("#btn-cancelar-estado").onclick = () => {
      document.body.removeChild(modal);
      resolve(null);
    };
  });
}

// --- ELIMINAR TAREA ---
async function eliminarTarea(container, supabase, hotelId, tarea) {
  if (!confirm("¿Seguro de eliminar esta tarea de mantenimiento?")) return;
  // Liberar habitación si aplica
  if (tarea.habitacion_id) {
    await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', tarea.habitacion_id);
  }
  await supabase.from('tareas_mantenimiento').delete().eq('id', tarea.id);
  await renderTareas(container, supabase, hotelId);
}

// --- HELPERS ---
function renderPrioridad(p, color = false) {
  const prioridades = [
    { txt: "Baja", cls: "bg-green-100 text-green-800" },
    { txt: "Media", cls: "bg-yellow-100 text-yellow-800" },
    { txt: "Alta", cls: "bg-orange-100 text-orange-800" },
    { txt: "Urgente", cls: "bg-red-100 text-red-800" },
  ];
  if (color && prioridades[p])
    return `<span class="px-2 py-1 rounded-xl font-semibold ${prioridades[p].cls}">${prioridades[p].txt}</span>`;
  return prioridades[p] ? prioridades[p].txt : "-";
}

function renderEstado(e, color = false) {
  const map = {
    pendiente: { txt: "Pendiente", cls: "bg-orange-100 text-orange-700" },
    en_progreso: { txt: "En progreso", cls: "bg-blue-100 text-blue-700" },
    completada: { txt: "Completada", cls: "bg-green-100 text-green-700" },
    cancelada: { txt: "Cancelada", cls: "bg-gray-100 text-gray-500" },
  };
  if (color && map[e])
    return `<span class="px-2 py-1 rounded-xl font-semibold ${map[e].cls}">${map[e].txt}</span>`;
  return map[e] ? map[e].txt : e;
}
