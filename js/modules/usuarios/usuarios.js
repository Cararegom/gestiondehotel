// js/modules/usuarios/usuarios.js
console.log(">>> usuarios.js cargado v2.0 (mejorado)");
let currentContainerEl = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let currentHotelId = null;
let rolesDisponiblesCache = [];
let permisosDisponiblesCache = [];
let moduleListeners = [];
let activePlanDetails = null;
const EDGE_FUNC_PERMISOS = "https://iikpqpdoslyduecibaij.supabase.co/functions/v1/actualizar_permisos_usuario";
import { supabase } from '../../supabaseClient.js';

// ----------- Helpers para UI y feedback -----------

function showUsuariosFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 5000) {
  if (!feedbackEl) {
    alert(message);
    return;
  }
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message my-4 p-3 rounded-lg border text-sm font-medium ${
    typeClass === 'error-indicator'
      ? 'bg-red-100 border-red-400 text-red-800'
      : typeClass === 'info-indicator'
      ? 'bg-blue-100 border-blue-400 text-blue-700'
      : typeClass === 'warning-indicator'
      ? 'bg-yellow-100 border-yellow-400 text-yellow-700'
      : 'bg-green-100 border-green-400 text-green-700'
  } visible opacity-100 transition-opacity duration-300`;
  feedbackEl.style.display = 'block';
  if (duration > 0) {
    setTimeout(() => clearUsuariosFeedback(feedbackEl), duration);
  }
}

function clearUsuariosFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message my-4 opacity-0 transition-opacity duration-300';
  setTimeout(() => {
    if (feedbackEl.textContent === '') feedbackEl.style.display = 'none';
  }, 300);
}

//---------- Helpers y configuración de Turnos -------------------

function esPlanMax() {
  return activePlanDetails && (
    (activePlanDetails.nombre && activePlanDetails.nombre.toLowerCase() === 'max') ||
    (activePlanDetails.key && activePlanDetails.key.toLowerCase() === 'max')
  );
}

async function renderConfiguracionTurnos(container, usuarioId) {
  if (!container) return;

  if (!esPlanMax()) {
    container.innerHTML = `<div class="col-span-1 md:col-span-2 p-3 text-sm text-center text-gray-500 bg-gray-100 rounded-lg">La configuración de turnos avanzados solo está disponible en el <strong>Plan Max</strong>.</div>`;
    return;
  }

  let actual = {};
  if (usuarioId) {
    const { data: conf } = await currentSupabaseInstance
      .from('configuracion_turnos')
      .select('*')
      .eq('hotel_id', currentHotelId)
      .eq('usuario_id', usuarioId)
      .single();
    actual = conf || {};
  }
  
  container.innerHTML = `
    <fieldset class="col-span-1 md:col-span-2 border-t mt-4 pt-4">
      <legend class="text-sm font-semibold text-gray-600 px-2">Configuración de Turnos del Usuario</legend>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-2">
        <label class="flex items-center space-x-3 col-span-1 md:col-span-2 p-2 bg-blue-50 rounded-md">
          <input type="checkbox" id="turno-activo" name="turno_activo" class="form-check-input h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" ${actual.activo !== false ? 'checked' : ''}/>
          <span class="font-medium text-gray-800">Este usuario trabaja por turnos (obligatorio para el horario)</span>
        </label>
        
        <div class="form-group">
          <label for="tipo_turno" class="block text-sm font-medium text-gray-600">Tipo de Turno</label>
          <select id="tipo_turno" name="tipo_turno" class="form-control mt-1">
            <option value="rotativo" ${actual.tipo_turno === 'rotativo' ? 'selected' : ''}>Rotativo</option>
            <option value="solo_dia" ${actual.tipo_turno === 'solo_dia' ? 'selected' : ''}>Solo Día</option>
            <option value="solo_noche" ${actual.tipo_turno === 'solo_noche' ? 'selected' : ''}>Solo Noche</option>
          </select>
        </div>
        <div class="form-group">
          <label for="horas_turno" class="block text-sm font-medium text-gray-600">Horas por Turno</label>
          <select id="horas_turno" name="horas_turno" class="form-control mt-1">
            <option value="8" ${actual.horas_turno == 8 ? 'selected' : ''}>8 horas</option>
            <option value="12" ${actual.horas_turno == 12 ? 'selected' : ''}>12 horas</option>
          </select>
        </div>
        <div class="form-group">
          <label for="turnos_por_semana" class="block text-sm font-medium text-gray-600">Turnos por Semana</label>
          <input type="number" id="turnos_por_semana" name="turnos_por_semana" class="form-control mt-1" min="1" max="7" value="${actual.turnos_por_semana || 5}"/>
        </div>
        <div class="form-group">
          <label for="dias_descanso" class="block text-sm font-medium text-gray-600">Días de Descanso</label>
          <input type="number" id="dias_descanso" name="dias_descanso" class="form-control mt-1" min="1" max="6" value="${actual.dias_descanso || 2}"/>
        </div>
        <div class="col-span-1 md:col-span-2 space-y-2 mt-2">
            <label class="flex items-center space-x-2"><input type="checkbox" id="evita_turno_noche" name="evita_turno_noche" class="form-check-input" ${actual.evita_turno_noche ? 'checked' : ''}/> <span>Evitar Turno de Noche</span></label>
            <label class="flex items-center space-x-2"><input type="checkbox" id="prefiere_turno_dia" name="prefiere_turno_dia" class="form-check-input" ${actual.prefiere_turno_dia ? 'checked' : ''}/> <span>Preferir Turno de Día</span></label>
        </div>
      </div>
    </fieldset>
  `;
}

// =================================================================
// ========= SECCIÓN DEL HORARIO DE TURNOS SEMANAL (MODIFICADO) ======
// =================================================================

window.actualizarTurnoUsuario = async function(selectElement, usuarioId, fecha) {
  const nuevoTurno = selectElement.value;
  const cell = selectElement.parentElement;
  
  cell.style.opacity = '0.5';
  selectElement.disabled = true;

  try {
    // 1. Limpiar asignaciones previas para este usuario en esta fecha.
    await currentSupabaseInstance
      .from('turnos_programados')
      .delete()
      .match({ turno_dia: usuarioId, fecha: fecha, hotel_id: currentHotelId });
    await currentSupabaseInstance
      .from('turnos_programados')
      .delete()
      .match({ turno_noche: usuarioId, fecha: fecha, hotel_id: currentHotelId });
    await currentSupabaseInstance
      .from('turnos_programados')
      .delete()
      .match({ descansa: usuarioId, fecha: fecha, hotel_id: currentHotelId });

    // 2. Si el nuevo turno no es 'vacio', insertar la nueva asignación.
    if (nuevoTurno !== 'vacio') {
      const registro = {
        fecha: fecha,
        hotel_id: currentHotelId,
        turno_dia: nuevoTurno === 'dia' ? usuarioId : null,
        turno_noche: nuevoTurno === 'noche' ? usuarioId : null,
        descansa: nuevoTurno === 'descanso' ? usuarioId : null,
        usuario_id: currentModuleUser.id
      };
      
      const { error: insertError } = await currentSupabaseInstance.from('turnos_programados').insert(registro);
      if (insertError) throw insertError;
    }
    
    // Asignar clase de color al select para feedback visual permanente
    selectElement.className = selectElement.className.replace(/bg-\w+-100/g, '');
    if(nuevoTurno === 'dia') selectElement.classList.add('bg-blue-100');
    else if(nuevoTurno === 'noche') selectElement.classList.add('bg-purple-100');
    else if(nuevoTurno === 'descanso') selectElement.classList.add('bg-green-100');

  } catch (error) {
    alert(`Error al actualizar el turno: ${error.message}`);
    renderHorarioTurnosSemanal(); // Recargar para mostrar estado real
  } finally {
    cell.style.opacity = '1';
    selectElement.disabled = false;
  }
};


async function renderHorarioTurnosSemanal() {
  const container = document.getElementById('horario-turnos-semanal');
  if (!container) return;
  container.innerHTML = '<div class="text-center p-8 text-gray-500">Cargando horario de recepcionistas...</div>';

  const ahora = new Date();
  const lunes = new Date(ahora);
  lunes.setDate(ahora.getDate() - (ahora.getDay() === 0 ? 6 : ahora.getDay() - 1));
  const internationalDateFormatter = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: '2-digit' });
  
  const semana = Array.from({ length: 7 }, (_, i) => {
    const fecha = new Date(lunes);
    fecha.setDate(lunes.getDate() + i);
    return {
        fechaISO: fecha.toISOString().slice(0, 10),
        label: internationalDateFormatter.format(fecha).replace('.', '')
    };
  });

  try {
    // **MODIFICADO**: Cargar usuarios con rol de 'Recepcionista'.
    const { data: rolData, error: rolError } = await currentSupabaseInstance
        .from('roles').select('id').eq('nombre', 'Recepcionista').single();
    if (rolError || !rolData) throw new Error("No se encontró el rol 'Recepcionista'.");
    
    const { data: userRoles, error: userRolesError } = await currentSupabaseInstance
        .from('usuarios_roles')
        .select('usuario_id')
        .eq('rol_id', rolData.id)
        .eq('hotel_id', currentHotelId); // <-- ¡ESTA ES LA LÍNEA AÑADIDA!
    if (userRolesError) throw userRolesError;
    const recepcionistaIds = userRoles.map(ur => ur.usuario_id);

    if (recepcionistaIds.length === 0) {
        container.innerHTML = '<div class="text-center p-8 text-gray-500">No hay usuarios con el rol de "Recepcionista" para mostrar en el horario.</div>';
        return;
    }

    const { data: usuarios, error: errorUsuarios } = await currentSupabaseInstance
      .from('usuarios')
      .select('id, nombre')
      .in('id', recepcionistaIds)
      .eq('activo', true)
      .order('nombre', { ascending: true });
    if (errorUsuarios) throw errorUsuarios;

    const { data: turnos, error: errorTurnos } = await currentSupabaseInstance
      .from('turnos_programados')
      .select('*')
      .eq('hotel_id', currentHotelId)
      .gte('fecha', semana[0].fechaISO)
      .lte('fecha', semana[6].fechaISO);
    if (errorTurnos) throw errorTurnos;

    let tablaHTML = `
      <div class="bg-white p-4 sm:p-6 rounded-xl shadow-lg mt-8">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-bold text-gray-800">🗓️ Horario Semanal de Recepción</h3>
          <button onclick="imprimirHorarioTurnos()" class="button button-outline button-small">Imprimir</button>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full min-w-[800px] border-collapse">
            <thead>
              <tr>
                <th class="p-3 text-left text-sm font-semibold text-gray-600 bg-gray-100 rounded-tl-lg">Usuario</th>
                ${semana.map(d => `<th class="p-3 text-center text-sm font-semibold text-gray-600 bg-gray-100 capitalize">${d.label}</th>`).join('')}
              </tr>
            </thead>
            <tbody>`;

    if (usuarios.length === 0) {
        tablaHTML += '<tr><td colspan="8" class="text-center p-6 text-gray-500">No hay recepcionistas activos para mostrar.</td></tr>';
    } else {
        usuarios.forEach(u => {
            tablaHTML += `<tr class="border-b border-gray-200 last:border-b-0">
                          <td class="p-3 font-medium text-gray-700 whitespace-nowrap">${u.nombre}</td>`;
            semana.forEach(d => {
                const fecha = d.fechaISO;
                let estadoActual = 'vacio';
                if (turnos.some(t => t.fecha === fecha && t.turno_dia === u.id)) estadoActual = 'dia';
                else if (turnos.some(t => t.fecha === fecha && t.turno_noche === u.id)) estadoActual = 'noche';
                else if (turnos.some(t => t.fecha === fecha && t.descansa === u.id)) estadoActual = 'descanso';
                
                let bgColorClass = '';
                if(estadoActual === 'dia') bgColorClass = 'bg-blue-100';
                else if(estadoActual === 'noche') bgColorClass = 'bg-purple-100';
                else if(estadoActual === 'descanso') bgColorClass = 'bg-green-100';

                tablaHTML += `<td class="p-1 align-middle">
                    <select class="w-full p-2 border-0 rounded-md text-center font-semibold cursor-pointer transition-all duration-200 focus:ring-2 focus:ring-blue-500 ${bgColorClass}" 
                            onchange="actualizarTurnoUsuario(this, '${u.id}', '${fecha}')">
                        <option value="vacio" ${estadoActual === 'vacio' ? 'selected' : ''} class="text-gray-400 font-normal">—</option>
                        <option value="dia" ${estadoActual === 'dia' ? 'selected' : ''} class="font-bold text-blue-700">☀️ Día</option>
                        <option value="noche" ${estadoActual === 'noche' ? 'selected' : ''} class="font-bold text-purple-700">🌙 Noche</option>
                        <option value="descanso" ${estadoActual === 'descanso' ? 'selected' : ''} class="font-bold text-green-700">✔️ Descanso</option>
                    </select>
                </td>`;
            });
            tablaHTML += `</tr>`;
        });
    }

    tablaHTML += `</tbody></table></div></div>`;
    container.innerHTML = tablaHTML;

  } catch (error) {
      container.innerHTML = `<div class="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg" role="alert"><strong>Error:</strong> ${error.message}</div>`;
      console.error("Error en renderHorarioTurnosSemanal:", error);
  }
}

window.imprimirHorarioTurnos = function() {
  const nodo = document.getElementById('horario-turnos-semanal')?.querySelector('table');
  if(!nodo) return;
  const clone = nodo.cloneNode(true);
  clone.querySelectorAll('select').forEach(select => {
    const selectedOption = select.options[select.selectedIndex];
    const texto = selectedOption.textContent;
    const color = window.getComputedStyle(selectedOption).color;
    select.outerHTML = `<span style="font-weight:600; color:${color};">${texto}</span>`;
  });
  const printWindow = window.open('', '_blank');
  printWindow.document.write('<html><head><title>Horario Semanal</title><style>body{font-family:sans-serif;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:8px;text-align:center} th{background-color:#f2f2f2}</style></head><body>');
  printWindow.document.write(clone.outerHTML);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  printWindow.print();
};

// ======== FIN DEL BLOQUE HORARIO ========

// El resto del código permanece mayormente igual, con ajustes en el formulario y su manejo.
// Se omiten funciones sin cambios como cargarPermisosDisponibles, crearModalPermisos, etc. para brevedad en este comentario.
// El código completo proporcionado sí las incluye.


// ----------- Funciones de permisos (sin cambios) -----------

async function cargarPermisosDisponibles() {
  if (!currentSupabaseInstance) return [];
  const { data, error } = await currentSupabaseInstance
    .from('permisos')
    .select('id, nombre, descripcion')
    .order('nombre', { ascending: true });
  if (error) {
    console.error('Error cargando permisos:', error);
    return [];
  }
  permisosDisponiblesCache = data || [];
  return permisosDisponiblesCache;
}

async function cargarPermisosUsuario(usuarioId) {
  if (!usuarioId || !currentSupabaseInstance) return [];

  // 1. Permisos por rol
  const { data: roles } = await currentSupabaseInstance
    .from('usuarios_roles')
    .select('rol_id')
    .eq('usuario_id', usuarioId);
  const rolesIds = (roles || []).map(r => r.rol_id);

  const { data: permisosRol } = await currentSupabaseInstance
    .from('roles_permisos')
    .select('permiso_id')
    .in('rol_id', rolesIds.length ? rolesIds : ['00000000-0000-0000-0000-000000000000']);

  const permisosRolSet = new Set((permisosRol || []).map(pr => pr.permiso_id));

  // 2. Permisos individuales (usuarios_permisos)
  const { data: permisosPersonalizados } = await currentSupabaseInstance
    .from('usuarios_permisos')
    .select('permiso_id, permitido')
    .eq('usuario_id', usuarioId);

  // Calculamos el estado final de cada permiso
  const permisosUsuario = {};
  for (const p of permisosDisponiblesCache) {
    permisosUsuario[p.id] = {
      ...p,
      checked: permisosRolSet.has(p.id)
    };
  }
  if (permisosPersonalizados && permisosPersonalizados.length > 0) {
    for (const perm of permisosPersonalizados) {
      if(permisosUsuario[perm.permiso_id]) {
         permisosUsuario[perm.permiso_id].checked = !!perm.permitido;
      }
    }
  }
  return Object.values(permisosUsuario);
}

// ----------- Modal permisos (sin cambios) -----------

function crearModalPermisos() {
  let modal = document.getElementById('modal-permisos-usuario');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-permisos-usuario';
    modal.className = 'fixed inset-0 w-screen h-screen z-[10000] bg-black bg-opacity-30 hidden items-center justify-center';
    modal.innerHTML = `
      <div class="bg-white rounded-xl min-w-[320px] max-w-md p-7 shadow-2xl">
        <h3 id="modal-permisos-title" class="text-xl font-bold text-gray-800 mb-4">Editar permisos</h3>
        <form id="form-permisos-usuario">
          <div id="modal-lista-permisos" class="max-h-72 overflow-y-auto mb-6 pr-2"></div>
          <div class="flex gap-2 justify-end">
            <button type="button" id="cancelar-modal-permisos" class="button button-outline">Cancelar</button>
            <button type="submit" class="button button-primary">Guardar</button>
          </div>
        </form>
        <div id="modal-permisos-feedback" class="min-h-[22px] text-red-600 mt-3 text-sm"></div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return modal;
}

async function abrirModalPermisos(usuario) {
  const modal = crearModalPermisos();
  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  document.getElementById('modal-permisos-title').textContent = `Permisos: ${usuario.nombre || usuario.correo}`;
  const listaDiv = document.getElementById('modal-lista-permisos');
  listaDiv.innerHTML = '<div class="text-center text-gray-500">Cargando permisos...</div>';

  if (!permisosDisponiblesCache.length) await cargarPermisosDisponibles();
  const permisosUsuario = await cargarPermisosUsuario(usuario.id);

  listaDiv.innerHTML = permisosUsuario.map(p => `
    <label class="flex items-center gap-3 p-2 hover:bg-gray-100 rounded-md">
      <input type="checkbox" name="permiso" value="${p.id}" ${p.checked ? 'checked' : ''} class="form-check-input h-4 w-4">
      <span class="font-medium text-gray-800">${p.nombre}</span>
      <span class="text-xs text-gray-500 ml-auto text-right">${p.descripcion || ''}</span>
    </label>
  `).join('');

  document.getElementById('cancelar-modal-permisos').onclick = () => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  document.getElementById('form-permisos-usuario').onsubmit = async (e) => {
    e.preventDefault();
    const feedbackEl = document.getElementById('modal-permisos-feedback');
    feedbackEl.textContent = '';

    const permisosSeleccionados = Array.from(listaDiv.querySelectorAll('input[name="permiso"]')).map(input => ({
      permiso_id: input.value,
      checked: input.checked
    }));

    try {
      const { data, error } = await supabase.functions.invoke('actualizar_permisos_usuario', {
          body: { usuario_id: usuario.id, permisos: permisosSeleccionados },
      });
      if (error) throw error;
      feedbackEl.style.color = '#16a34a';
      feedbackEl.textContent = 'Permisos actualizados con éxito';
      setTimeout(() => {
        modal.style.display = 'none';
        document.body.style.overflow = '';
      }, 900);
    } catch (err) {
      feedbackEl.style.color = '#e11d48';
      feedbackEl.textContent = err.message || 'Error inesperado';
    }
  };
}


// ----------- Helpers de roles y usuarios (sin cambios) -----------

async function cargarRolesDisponibles(selectEl, supabaseInstance) {
  if (!selectEl) return;
  selectEl.innerHTML = `<option value="">Cargando roles...</option>`;
  try {
    const { data: roles, error } = await supabaseInstance
      .from('roles')
      .select('id, nombre')
      .order('nombre', { ascending: true });
    if (error) throw error;
    rolesDisponiblesCache = roles || [];
    if (rolesDisponiblesCache.length > 0) {
      selectEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
    } else {
      selectEl.innerHTML = `<option value="" disabled>No hay roles configurados</option>`;
    }
  } catch (e) {
    selectEl.innerHTML = `<option value="" disabled>Error al cargar roles</option>`;
    rolesDisponiblesCache = [];
  }
}

async function cargarYRenderizarUsuarios(tbodyEl, supabaseInstance, hotelIdParaCarga) {
  if (!tbodyEl) return;
  if (!hotelIdParaCarga) {
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-red-600">Error: Hotel ID no disponible.</td></tr>`;
    return;
  }
  tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-500">Cargando usuarios...</td></tr>`;
  try {
    const { data: usuarios, error } = await supabaseInstance
      .from('usuarios')
      .select('id, nombre, correo, activo, hotel_id, usuarios_roles ( roles (id, nombre) )')
      .eq('hotel_id', hotelIdParaCarga)
      .order('nombre', { ascending: true });

    if (error) throw error;

    tbodyEl.innerHTML = '';
    if (!usuarios || usuarios.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-4 text-gray-500">No hay usuarios para mostrar.</td></tr>`;
      return;
    }

    usuarios.forEach(u => {
      const rolesNombres = u.usuarios_roles.map(ur => ur.roles?.nombre).filter(Boolean).join(', ') || 'Sin rol';
      const tr = document.createElement('tr');
      tr.className = "hover:bg-gray-50 transition-colors duration-150";
      tr.dataset.usuarioId = u.id;
      tr.innerHTML = `
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700 font-medium">${u.nombre || 'N/A'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${u.correo || 'N/A'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${rolesNombres}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <span class="px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${u.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${u.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="px-4 py-3 whitespace-nowrap text-sm font-medium space-x-2">
          <button class="button button-outline button-small text-xs" data-accion="editar" data-id="${u.id}">Editar</button>
          <button class="button button-small text-xs ${u.activo ? 'button-warning' : 'button-success'}" data-accion="toggle-activo" data-id="${u.id}" data-estado-actual="${u.activo}">${u.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="button button-accent button-small text-xs" data-accion="reset-password" data-id="${u.id}" data-correo="${u.correo}">Reset Pass</button>
          <button class="button button-outline button-small text-xs" style="color:#2563eb;border-color:#2563eb" data-accion="permisos" data-id="${u.id}" data-nombre="${u.nombre || ''}" data-correo="${u.correo}">Permisos</button>
        </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-red-600 text-center p-4">Error al cargar usuarios: ${err.message}</td></tr>`;
  }
}

// ----------- Funciones de formularios -----------

function resetearFormularioUsuario(formEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.usuarioIdEdit.value = '';
  if (formTitleEl) formTitleEl.textContent = 'Crear Nuevo Usuario';
  formEl.elements.correo.disabled = false;
  if (passwordGroupEl) passwordGroupEl.style.display = 'block';
  if (selectRolesEl) {
    selectRolesEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
    selectRolesEl.value = "";
  }
  formEl.elements.activo.checked = true;
  formEl.querySelector('#btn-guardar-usuario').textContent = 'Guardar Usuario';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  if(formEl.elements.nombre) formEl.elements.nombre.focus();
  renderConfiguracionTurnos(formEl.querySelector('#configuracion-turnos-container'), null);
}


// ----------- Unmount -----------

export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  rolesDisponiblesCache = [];
  permisosDisponiblesCache = [];
  currentHotelId = null;
  currentModuleUser = null;
  currentSupabaseInstance = null;
  if (currentContainerEl) {
    currentContainerEl.innerHTML = '';
  }
  currentContainerEl = null;
  console.log("Módulo de usuarios desmontado y listeners limpiados.");
}


async function formSubmitHandler(event, formUsuarioEl, selectRolesEl, feedbackGlobalEl, formTitleEl, passwordGroupEl, btnCancelarEl, tablaBodyEl) {
    event.preventDefault();
    clearUsuariosFeedback(feedbackGlobalEl);

    const formData = new FormData(formUsuarioEl);
    const usuarioIdEdit = formData.get('usuarioIdEdit');
    const nombre = formData.get('nombre').trim();
    const correo = formData.get('correo').trim();
    const password = formData.get('password');
    const activo = formData.get('activo') === 'on';
    const roles = Array.from(selectRolesEl.selectedOptions).map(opt => opt.value);

    // --- Validación ---
    if (!nombre || nombre.length < 3) return showUsuariosFeedback(feedbackGlobalEl, 'El nombre es obligatorio (mínimo 3 caracteres).', 'error-indicator');
    if (!correo || !correo.includes('@')) return showUsuariosFeedback(feedbackGlobalEl, 'Debes ingresar un correo válido.', 'error-indicator');
    if (!usuarioIdEdit && (!password || password.length < 8)) return showUsuariosFeedback(feedbackGlobalEl, 'La contraseña debe tener mínimo 8 caracteres para usuarios nuevos.', 'error-indicator');
    if (!roles.length) return showUsuariosFeedback(feedbackGlobalEl, 'Debes seleccionar al menos un rol.', 'error-indicator');

    // **NUEVA VALIDACIÓN**: Configuración de turnos obligatoria para usuarios nuevos
    if (!usuarioIdEdit && esPlanMax()) {
        const trabajaPorTurnos = formData.get('turno_activo') === 'on';
        if (!trabajaPorTurnos) {
            return showUsuariosFeedback(feedbackGlobalEl, 'Debe activar y completar la "Configuración de Turnos" para el nuevo usuario.', 'error-indicator');
        }
        // Puedes añadir más validaciones específicas de los campos de turno si lo deseas
        const turnosSemana = parseInt(formData.get('turnos_por_semana'));
        if (isNaN(turnosSemana) || turnosSemana < 1 || turnosSemana > 7) {
            return showUsuariosFeedback(feedbackGlobalEl, 'El número de turnos por semana debe ser válido (entre 1 y 7).', 'error-indicator');
        }
    }
    
    showUsuariosFeedback(feedbackGlobalEl, usuarioIdEdit ? 'Actualizando usuario...' : 'Creando usuario...', 'info-indicator', 0);
    const btnGuardar = formUsuarioEl.querySelector('#btn-guardar-usuario');
    btnGuardar.disabled = true;
    btnGuardar.innerHTML += '...';

    try {
        let usuarioId = usuarioIdEdit;
        // 1. CREAR O ACTUALIZAR USUARIO
        if (!usuarioIdEdit) {
            const { data: authData, error: authError } = await currentSupabaseInstance.auth.signUp({
                email: correo,
                password,
                options: { data: { nombre, hotel_id: currentHotelId } }
            });
            if (authError) throw authError;
            usuarioId = authData.user.id;

            const { error: dbError } = await currentSupabaseInstance
                .from('usuarios').insert({ id: usuarioId, nombre, correo, hotel_id: currentHotelId, activo });
            if (dbError) throw dbError;
        } else {
             const { error: updateError } = await currentSupabaseInstance
                .from('usuarios').update({ nombre, activo }).eq('id', usuarioId);
             if (updateError) throw updateError;
        }

        // 2. GUARDAR CONFIGURACIÓN DE TURNOS (si aplica)
        if (esPlanMax()) {
             const configTurnos = {
                hotel_id: currentHotelId,
                usuario_id: usuarioId,
                activo: formData.get('turno_activo') === 'on',
                tipo_turno: formData.get('tipo_turno'),
                horas_turno: parseInt(formData.get('horas_turno')),
                turnos_por_semana: parseInt(formData.get('turnos_por_semana')),
                dias_descanso: parseInt(formData.get('dias_descanso')),
                evita_turno_noche: formData.get('evita_turno_noche') === 'on',
                prefiere_turno_dia: formData.get('prefiere_turno_dia') === 'on'
            };
            const { error: turnosError } = await currentSupabaseInstance
                .from('configuracion_turnos').upsert(configTurnos, { onConflict: 'hotel_id, usuario_id' });
            if (turnosError) console.warn("Advertencia al guardar config. de turnos:", turnosError.message);
        }

        // 3. ASIGNAR ROLES
        await currentSupabaseInstance.from('usuarios_roles').delete().eq('usuario_id', usuarioId);
        const rolesData = roles.map(rol_id => ({ usuario_id: usuarioId, rol_id, hotel_id: currentHotelId }));
        const { error: rolesError } = await currentSupabaseInstance.from('usuarios_roles').insert(rolesData);
        if (rolesError) throw rolesError;

        showUsuariosFeedback(feedbackGlobalEl, usuarioIdEdit ? 'Usuario actualizado con éxito.' : 'Usuario creado con éxito.', 'success-indicator');
        await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
        await renderHorarioTurnosSemanal(); // Recargar horario por si el nuevo usuario es recepcionista
        resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);

    } catch (err) {
        showUsuariosFeedback(feedbackGlobalEl, 'Error: ' + (err.message || err.error_description), 'error-indicator', 0);
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.textContent = usuarioIdEdit ? 'Actualizar Usuario' : 'Guardar Usuario';
    }
}


// ----------- Mount principal -----------

export async function mount(container, sbInstance, user, hotelId, planDetails) {
  console.log(">>> usuarios.js mount - Iniciando montaje profesional...");
  unmount(container);

  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;
  currentHotelId = hotelId;
  activePlanDetails = planDetails;

  console.log("[Usuarios/mount] Hotel ID:", currentHotelId);
  console.log("[Usuarios/mount] Plan activo:", activePlanDetails?.nombre);

  currentContainerEl.innerHTML = `
    <div class="usuarios-module p-2 sm:p-4">
      <div class="bg-white p-4 sm:p-6 rounded-xl shadow-lg">
        <div class="card-header mb-6">
          <h2 class="text-2xl font-bold text-gray-800">🔑 Gestión de Usuarios del Hotel</h2>
          <p class="text-gray-500 mt-1">Crea, edita y gestiona los accesos y roles de tu equipo.</p>
        </div>
        <div class="card-body">
          <div id="usuarios-feedback" role="alert" aria-live="polite" class="feedback-message" style="display:none;"></div>
          
          <form id="form-crear-editar-usuario" class="form mb-8 p-4 sm:p-6 border rounded-xl bg-gray-50/50" novalidate>
            <h3 id="form-usuario-titulo" class="text-xl font-bold text-gray-700 mb-5">Crear Nuevo Usuario</h3>
            <input type="hidden" id="usuario-id-edit" name="usuarioIdEdit">
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 mb-4">
              <div class="form-group">
                <label for="usuario-nombre" class="block text-sm font-medium text-gray-600">Nombre Completo *</label>
                <input type="text" id="usuario-nombre" name="nombre" class="form-control mt-1" required minlength="3">
              </div>
              <div class="form-group">
                <label for="usuario-correo" class="block text-sm font-medium text-gray-600">Correo Electrónico *</label>
                <input type="email" id="usuario-correo" name="correo" class="form-control mt-1" required>
              </div>
              <div class="form-group" id="password-group">
                <label for="usuario-password" class="block text-sm font-medium text-gray-600">Contraseña * <span class="text-xs text-gray-500">(para nuevos)</span></label>
                <input type="password" id="usuario-password" name="password" class="form-control mt-1" minlength="8" placeholder="Mínimo 8 caracteres">
              </div>
              <div class="form-group">
                <label for="usuario-roles" class="block text-sm font-medium text-gray-600">Roles Asignados *</label>
                <select multiple id="usuario-roles" name="roles" class="form-control mt-1" required size="3"></select>
              </div>
              <div class="form-group md:col-span-2 flex items-center mt-2">
                <input type="checkbox" id="usuario-activo" name="activo" class="form-check-input h-4 w-4" checked>
                <label for="usuario-activo" class="ml-2 block text-sm font-medium text-gray-800">Usuario Activo</label>
              </div>
              
              <div id="configuracion-turnos-container" class="md:col-span-2"></div>
            </div>

            <div class="form-actions flex items-center gap-3 mt-6 border-t pt-5">
              <button type="submit" id="btn-guardar-usuario" class="button button-primary">Guardar Usuario</button>
              <button type="button" id="btn-cancelar-edicion-usuario" class="button button-outline" style="display:none;">Cancelar Edición</button>
            </div>
          </form>
          
          <hr class="my-8"/>

          <h3 class="text-xl font-bold text-gray-800 mb-4">👥 Usuarios Registrados</h3>
          <div class="table-container overflow-x-auto rounded-lg border">
            <table class="w-full min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Nombre</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Correo</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Roles</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Estado</th>
                  <th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Acciones</th>
                </tr>
              </thead>
              <tbody id="tabla-usuarios-body" class="bg-white divide-y divide-gray-200"></tbody>
            </table>
          </div>
          
          <div id="horario-turnos-semanal"></div>
        </div>
      </div>
    </div>`;

  const formUsuarioEl = currentContainerEl.querySelector('#form-crear-editar-usuario');
  const tablaBodyEl = currentContainerEl.querySelector('#tabla-usuarios-body');
  const btnCancelarEl = currentContainerEl.querySelector('#btn-cancelar-edicion-usuario');
  const selectRolesEl = currentContainerEl.querySelector('#usuario-roles');
  const feedbackGlobalEl = currentContainerEl.querySelector('#usuarios-feedback');
  const formTitleEl = currentContainerEl.querySelector('#form-usuario-titulo');
  const passwordGroupEl = currentContainerEl.querySelector('#password-group');
  const turnosContainer = currentContainerEl.querySelector('#configuracion-turnos-container');

  if (!currentHotelId) {
    showUsuariosFeedback(feedbackGlobalEl, 'Error crítico: Hotel ID no disponible. Módulo deshabilitado.', 'error-indicator', 0);
    formUsuarioEl?.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Cargar datos iniciales
  await Promise.all([
    cargarRolesDisponibles(selectRolesEl, currentSupabaseInstance),
    cargarPermisosDisponibles(),
    cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId),
    renderHorarioTurnosSemanal()
  ]);
  
  resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);

  // Asignar listeners
  const submitHandler = (event) => formSubmitHandler(event, formUsuarioEl, selectRolesEl, feedbackGlobalEl, formTitleEl, passwordGroupEl, btnCancelarEl, tablaBodyEl);
  formUsuarioEl.addEventListener('submit', submitHandler);
  moduleListeners.push({ element: formUsuarioEl, type: 'submit', handler: submitHandler });

  const cancelHandler = () => resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);
  btnCancelarEl.addEventListener('click', cancelHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelHandler });
  
  const tableClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;
    const usuarioId = button.dataset.id;
    const accion = button.dataset.accion;

    clearUsuariosFeedback(feedbackGlobalEl);

    if (accion === 'editar') {
        try {
            const { data: usuarioToEdit, error } = await currentSupabaseInstance
                .from('usuarios').select('*, usuarios_roles(roles(id))').eq('id', usuarioId).single();
            if (error) throw error;
            
            formUsuarioEl.elements.usuarioIdEdit.value = usuarioToEdit.id;
            formTitleEl.textContent = 'Editar Usuario';
            passwordGroupEl.style.display = 'none'; 
            formUsuarioEl.elements.nombre.value = usuarioToEdit.nombre || '';
            formUsuarioEl.elements.correo.value = usuarioToEdit.correo || '';
            formUsuarioEl.elements.correo.disabled = true;
            
            const rolesAsignadosIds = usuarioToEdit.usuarios_roles.map(ur => ur.roles.id);
            Array.from(selectRolesEl.options).forEach(opt => {
                opt.selected = rolesAsignadosIds.includes(opt.value);
            });

            formUsuarioEl.elements.activo.checked = usuarioToEdit.activo;
            btnGuardar.textContent = 'Actualizar Usuario';
            btnCancelarEl.style.display = 'inline-block';
            formUsuarioEl.elements.nombre.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            await renderConfiguracionTurnos(turnosContainer, usuarioToEdit.id);

        } catch (err) {
            showUsuariosFeedback(feedbackGlobalEl, `Error al cargar datos: ${err.message}`, 'error-indicator', 0);
        }
    } else if (accion === 'toggle-activo') {
        const estadoActual = button.dataset.estadoActual === 'true';
        const { error } = await currentSupabaseInstance.from('usuarios')
            .update({ activo: !estadoActual }).eq('id', usuarioId);
        if(error) showUsuariosFeedback(feedbackGlobalEl, `Error: ${error.message}`, 'error-indicator');
        else {
            showUsuariosFeedback(feedbackGlobalEl, `Usuario ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success-indicator');
            await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
            await renderHorarioTurnosSemanal();
        }
    } else if (accion === 'reset-password') {
        const userEmail = button.dataset.correo;
        if (confirm(`¿Enviar enlace para resetear contraseña a ${userEmail}?`)) {
            const { error } = await currentSupabaseInstance.auth.resetPasswordForEmail(userEmail);
            if (error) showUsuariosFeedback(feedbackGlobalEl, `Error: ${error.message}`, 'error-indicator');
            else showUsuariosFeedback(feedbackGlobalEl, `Enlace de reseteo enviado a ${userEmail}.`, 'success-indicator');
        }
    } else if (accion === 'permisos') {
        const usuario = { id: usuarioId, nombre: button.dataset.nombre, correo: button.dataset.correo };
        await abrirModalPermisos(usuario);
    }
  };
  tablaBodyEl.addEventListener('click', tableClickHandler);
  moduleListeners.push({ element: tablaBodyEl, type: 'click', handler: tableClickHandler });

  console.log("[Usuarios/mount] Montaje profesional completado.");
}