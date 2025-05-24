// js/modules/mantenimiento/mantenimiento.js

import { showLoading, showError, clearFeedback } from '../../uiUtils.js';
import { crearNotificacion } from '../../services/NotificationService.js';
import { registrarEnBitacora } from '../../services/bitacoraservice.js';

// Variables para listeners
let listeners = [];

// MOUNT PRINCIPAL
export async function mount(container, supabase, currentUser, hotelId) {
  container.innerHTML = `
    <h2 class="text-2xl font-bold mb-6">🛠️ Mantenimiento</h2>
    <div class="mb-4 flex flex-row gap-2">
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
  container.querySelector('#btn-filtrar').onclick = () => renderTareas(container, supabase, hotelId);
  container.querySelector('#btn-nueva-tarea').onclick = () => showModalTarea(container, supabase, hotelId, currentUser);

  await renderTareas(container, supabase, hotelId);
}

export function unmount() {
  listeners.forEach(fn => fn && fn());
  listeners = [];
}

// RENDER LISTA PRINCIPAL
async function renderTareas(container, supabase, hotelId) {
  showLoading(container.querySelector('#mant-list'));
  const estadoFiltro = container.querySelector('#filtro-estado')?.value || "";

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

  // Render simple, puedes mejorar la tabla
  list.innerHTML = `
    <table class="min-w-full table-auto border">
      <thead>
        <tr>
          <th>Título</th>
          <th>Descripción</th>
          <th>Habitación</th>
          <th>Prioridad</th>
          <th>Estado</th>
          <th>Fecha reporte</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${tareas.map(t => `
          <tr>
            <td>${t.titulo}</td>
            <td>${t.descripcion}</td>
            <td>${t.habitacion_id ?? '-'}</td>
            <td>${renderPrioridad(t.prioridad)}</td>
            <td>${renderEstado(t.estado)}</td>
            <td>${t.creado_en ? new Date(t.creado_en).toLocaleString() : ''}</td>
            <td>
              <button class="button button-xs button-primary" data-edit="${t.id}">Editar</button>
              <button class="button button-xs button-success" data-estado="${t.id}">Cambiar estado</button>
              <button class="button button-xs button-danger" data-del="${t.id}">Eliminar</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Asigna listeners a los botones
  tareas.forEach(t => {
    // Editar
    list.querySelector(`[data-edit="${t.id}"]`).onclick = () => showModalTarea(container, supabase, hotelId, null, t);
    // Cambiar estado
    list.querySelector(`[data-estado="${t.id}"]`).onclick = () => cambiarEstadoTarea(container, supabase, hotelId, t);
    // Eliminar
    list.querySelector(`[data-del="${t.id}"]`).onclick = () => eliminarTarea(container, supabase, hotelId, t);
  });
}

// RENDER MODAL CREAR/EDITAR TAREA
async function showModalTarea(container, supabase, hotelId, currentUser, tarea = null) {
  const modal = container.querySelector('#mant-modal');
  // Traer habitaciones (opcional)
  const { data: habitaciones } = await supabase.from('habitaciones').select('id, nombre').eq('hotel_id', hotelId);
  modal.innerHTML = `
    <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
      <div class="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
        <button id="close-modal-mant" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
        <h3 class="text-xl font-bold mb-4">${tarea ? "Editar tarea" : "Nueva tarea"}</h3>
        <form id="mant-form">
          <div class="mb-2">
            <label>Título *</label>
            <input required name="titulo" class="form-control" maxlength="60" value="${tarea?.titulo ?? ''}">
          </div>
          <div class="mb-2">
            <label>Descripción</label>
            <textarea name="descripcion" class="form-control">${tarea?.descripcion ?? ''}</textarea>
          </div>
          <div class="mb-2">
            <label>Habitación</label>
            <select name="habitacion_id" class="form-control">
              <option value="">Sin asignar</option>
              ${habitaciones.map(h => `<option value="${h.id}" ${tarea?.habitacion_id === h.id ? "selected" : ""}>${h.nombre}</option>`).join('')}
            </select>
          </div>
          <div class="mb-2">
            <label>Prioridad</label>
            <select name="prioridad" class="form-control">
              <option value="0" ${tarea?.prioridad == 0 ? "selected" : ""}>Baja</option>
              <option value="1" ${tarea?.prioridad == 1 ? "selected" : ""}>Media</option>
              <option value="2" ${!tarea || tarea?.prioridad == 2 ? "selected" : ""}>Alta</option>
              <option value="3" ${tarea?.prioridad == 3 ? "selected" : ""}>Urgente</option>
            </select>
          </div>
          <div class="mb-2">
            <label>Estado</label>
            <select name="estado" class="form-control">
              <option value="pendiente" ${!tarea || tarea?.estado === "pendiente" ? "selected" : ""}>Pendiente</option>
              <option value="en_progreso" ${tarea?.estado === "en_progreso" ? "selected" : ""}>En progreso</option>
              <option value="completada" ${tarea?.estado === "completada" ? "selected" : ""}>Completada</option>
              <option value="cancelada" ${tarea?.estado === "cancelada" ? "selected" : ""}>Cancelada</option>
            </select>
          </div>
          <div class="mb-2">
            <label>Fecha programada</label>
            <input name="fecha_programada" type="date" class="form-control" value="${tarea?.fecha_programada?.split('T')[0] ?? ''}">
          </div>
          <button type="submit" class="button button-primary w-full mt-2">${tarea ? "Actualizar" : "Crear"}</button>
        </form>
      </div>
    </div>
  `;
  // Cerrar modal
  modal.querySelector('#close-modal-mant').onclick = () => {
    modal.innerHTML = '';
  };
  // Guardar
  modal.querySelector('#mant-form').onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (!data.titulo) return alert("El título es obligatorio");
    data.prioridad = Number(data.prioridad);

    if (tarea) {
      await supabase.from('tareas_mantenimiento').update(data).eq('id', tarea.id);
    } else {
      await supabase.from('tareas_mantenimiento').insert([{
        ...data,
        hotel_id: hotelId,
        estado: data.estado || "pendiente",
        creada_por: currentUser?.id || null,
      }]);
    }
    modal.innerHTML = '';
    await renderTareas(container, supabase, hotelId);
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

// CAMBIAR ESTADO DE TAREA
async function cambiarEstadoTarea(container, supabase, hotelId, tarea) {
  const nuevoEstado = prompt("Nuevo estado para la tarea (pendiente, en_progreso, completada, cancelada):", tarea.estado);
  if (!nuevoEstado || !["pendiente", "en_progreso", "completada", "cancelada"].includes(nuevoEstado)) {
    alert("Estado inválido");
    return;
  }
  const update = { estado: nuevoEstado };
  if (nuevoEstado === "completada") update.fecha_completada = new Date().toISOString();
  await supabase.from('tareas_mantenimiento').update(update).eq('id', tarea.id);
  await renderTareas(container, supabase, hotelId);
}

// ELIMINAR TAREA
async function eliminarTarea(container, supabase, hotelId, tarea) {
  if (!confirm("¿Seguro de eliminar esta tarea de mantenimiento?")) return;
  // Liberar habitación si aplica
  if (tarea.habitacion_id) {
    await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', tarea.habitacion_id);
  }
  await supabase.from('tareas_mantenimiento').delete().eq('id', tarea.id);
  await renderTareas(container, supabase, hotelId);
}

// HELPERS
function renderPrioridad(p) {
  return ["Baja", "Media", "Alta", "Urgente"][p] || "-";
}
function renderEstado(e) {
  const map = {
    pendiente: '<span class="text-orange-500 font-bold">Pendiente</span>',
    en_progreso: '<span class="text-blue-600 font-bold">En progreso</span>',
    completada: '<span class="text-green-600 font-bold">Completada</span>',
    cancelada: '<span class="text-gray-400 font-bold">Cancelada</span>',
  };
  return map[e] || e;
}
