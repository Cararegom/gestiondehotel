// js/modules/usuarios/usuarios.js
console.log(">>> usuarios.js cargado v3.0 (con turnos globales de 8/12h)");

// Dependencias y variables globales del módulo
import { supabase } from '../../supabaseClient.js';

let currentContainerEl = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let currentHotelId = null;
let rolesDisponiblesCache = [];
let permisosDisponiblesCache = [];
let moduleListeners = [];
let activePlanDetails = null;

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

// Función para obtener la configuración de turnos del hotel.
async function getTipoTurnoGlobal() {
    if (!currentSupabaseInstance || !currentHotelId) return 12; // Valor por defecto
    const { data: config } = await currentSupabaseInstance
        .from('configuracion_hotel')
        .select('tipo_turno_global')
        .eq('hotel_id', currentHotelId)
        .single();
    return parseInt(config?.tipo_turno_global || 12);
}


// =================================================================
// ========= SECCIÓN DE CONFIGURACIÓN Y HORARIO DE TURNOS ==========
// =================================================================

// NUEVO: Función para renderizar el selector de tipo de turno global
async function renderConfiguracionGlobalTurnos(container) {
  if (!container) return;

  const tipoTurnoActual = await getTipoTurnoGlobal();

  container.innerHTML = `
    <div class="bg-blue-50 p-4 sm:p-5 rounded-xl border border-blue-200 mb-8">
      <h3 class="text-lg font-bold text-gray-800 mb-3">⚙️ Configuración General de Turnos</h3>
      <p class="text-sm text-gray-600 mb-4">
        Selecciona la duración de los turnos para todo el hotel. Esto afectará cómo se muestra y gestiona el horario de recepción.
      </p>
      <div class="flex items-center gap-6">
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="tipo_turno_global" value="12" class="form-radio h-4 w-4 text-blue-600" ${tipoTurnoActual == 12 ? 'checked' : ''}>
          <span class="font-medium text-gray-700">Turnos de 12 horas (Día / Noche)</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input type="radio" name="tipo_turno_global" value="8" class="form-radio h-4 w-4 text-blue-600" ${tipoTurnoActual == 8 ? 'checked' : ''}>
          <span class="font-medium text-gray-700">Turnos de 8 horas (Mañana / Tarde / Noche)</span>
        </label>
      </div>
       <div id="feedback-turno-global" class="mt-3 text-sm"></div>
    </div>
  `;

  // Listener para guardar el cambio
  const radios = container.querySelectorAll('input[name="tipo_turno_global"]');
  radios.forEach(radio => {
    radio.addEventListener('change', async (e) => {
      const nuevoValor = parseInt(e.target.value);
      const feedbackEl = container.querySelector('#feedback-turno-global');
      feedbackEl.textContent = 'Guardando...';
      feedbackEl.className = 'mt-3 text-sm text-blue-700';

      const { error: updateError } = await currentSupabaseInstance
        .from('configuracion_hotel')
        .update({ tipo_turno_global: nuevoValor })
        .eq('hotel_id', currentHotelId);

      if (updateError) {
        feedbackEl.textContent = `Error al guardar: ${updateError.message}`;
        feedbackEl.className = 'mt-3 text-sm text-red-700';
      } else {
        feedbackEl.textContent = '✅ Configuración guardada. El horario se recargará.';
        feedbackEl.className = 'mt-3 text-sm text-green-700';
        setTimeout(() => {
           renderHorarioTurnosSemanal(); // Recargamos la tabla de horarios
           feedbackEl.textContent = '';
        }, 1500);
      }
    });
  });
}


/**
 * VERSIÓN FINAL: Actualiza, inserta o elimina un turno para un usuario
 * basándose en la estructura de una fila por asignación (fecha, usuario_id, tipo_turno).
 */
async function actualizarTurnoUsuario(selectEl, usuarioId, fecha) {
    const nuevoTurno = selectEl.value; // 'manana', 'tarde', 'noche', 'descanso', o 'vacio'

    try {
        if (nuevoTurno === 'vacio') {
            // Si se selecciona "—" (vacío), eliminamos la asignación de turno para ese usuario y día.
            const { error } = await currentSupabaseInstance
                .from('turnos_programados')
                .delete()
                .eq('hotel_id', currentHotelId)
                .eq('usuario_id', usuarioId)
                .eq('fecha', fecha);
            if (error) throw error;
        } else {
            // Si se selecciona cualquier otro turno, hacemos un UPSERT.
            const { error } = await currentSupabaseInstance
                .from('turnos_programados')
                .upsert({
                    hotel_id: currentHotelId,
                    fecha: fecha,
                    usuario_id: usuarioId,
                    tipo_turno: nuevoTurno,
                    generado_auto: false
                }, {
                    onConflict: 'hotel_id, fecha, usuario_id'
                });
            if (error) throw error;
        }
        // Feedback visual inmediato en el select
        const claseSeleccionada = selectEl.options[selectEl.selectedIndex].className;
        selectEl.className = 'w-full p-2 border-0 rounded-md text-center font-semibold cursor-pointer transition-all duration-200 focus:ring-2 focus:ring-blue-500';
        selectEl.classList.add(...claseSeleccionada.split(' '));
    } catch (error) {
        console.error("Error al actualizar turno:", error);
        alert("Error al actualizar el turno: " + error.message);
    }
}

/**
 * VERSIÓN FINAL: Renderiza la tabla de horarios leyendo la configuración global (8/12h)
 * y buscando el turno de cada usuario para cada día.
 */
async function renderHorarioTurnosSemanal() {
    const container = document.getElementById('horario-turnos-semanal');
    if (!container) return;
    container.innerHTML = '<div class="text-center p-8 text-gray-500">Cargando horario de recepcionistas...</div>';

    const tipoTurnoGlobal = await getTipoTurnoGlobal();

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
        const { data: rolData } = await currentSupabaseInstance.from('roles').select('id').eq('nombre', 'Recepcionista').single();
        if (!rolData) throw new Error('El rol "Recepcionista" no fue encontrado.');
        const { data: userRoles } = await currentSupabaseInstance.from('usuarios_roles').select('usuario_id').eq('rol_id', rolData.id).eq('hotel_id', currentHotelId);
        const recepcionistaIds = userRoles.map(ur => ur.usuario_id);
        if (recepcionistaIds.length === 0) {
            container.innerHTML = '<div class="text-center p-8 text-gray-500">No hay usuarios con el rol "Recepcionista".</div>';
            return;
        }
        const { data: usuarios } = await currentSupabaseInstance.from('usuarios').select('id, nombre').in('id', recepcionistaIds).eq('activo', true).order('nombre');
        const { data: turnos } = await currentSupabaseInstance
            .from('turnos_programados')
            .select('fecha, usuario_id, tipo_turno')
            .eq('hotel_id', currentHotelId)
            .gte('fecha', semana[0].fechaISO)
            .lte('fecha', semana[6].fechaISO);

        const opciones = tipoTurnoGlobal === 8
            ? [
                  { valor: 'manana', texto: '🌅 Mañana', clase: 'bg-yellow-100 text-yellow-800' },
                  { valor: 'tarde', texto: '🌤️ Tarde', clase: 'bg-orange-100 text-orange-800' },
                  { valor: 'noche', texto: '🌙 Noche', clase: 'bg-indigo-100 text-indigo-800' },
              ]
            : [
                  { valor: 'dia', texto: '☀️ Día', clase: 'bg-blue-100 text-blue-800' },
                  { valor: 'noche', texto: '🌙 Noche', clase: 'bg-indigo-100 text-indigo-800' },
              ];
        opciones.push({ valor: 'descanso', texto: '✔️ Descanso', clase: 'bg-green-100 text-green-800' });
        opciones.push({ valor: 'vacio', texto: '—', clase: 'bg-gray-100 text-gray-800' });

        let tablaHTML = `
            <div class="bg-white p-4 sm:p-6 rounded-xl shadow-lg mt-8">
                <div class="flex items-center justify-between mb-4">
                    <h3 class="text-lg font-bold text-gray-800">🗓️ Horario Semanal de Recepción (${tipoTurnoGlobal} horas)</h3>
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

        usuarios.forEach(u => {
            tablaHTML += `<tr class="border-b border-gray-200 last:border-b-0"><td class="p-3 font-medium text-gray-700 whitespace-nowrap">${u.nombre}</td>`;
            semana.forEach(d => {
                const fecha = d.fechaISO;
                const turnoAsignado = turnos.find(t => t.fecha === fecha && t.usuario_id === u.id);
                const valor = turnoAsignado ? turnoAsignado.tipo_turno : 'vacio';
                const claseActual = opciones.find(o => o.valor === valor)?.clase || 'bg-gray-100';

                tablaHTML += `<td class="p-1 align-middle">
                    <select class="w-full p-2 border-0 rounded-md text-center font-semibold cursor-pointer transition-all duration-200 focus:ring-2 focus:ring-blue-500 ${claseActual}" 
                            onchange="actualizarTurnoUsuario(this, '${u.id}', '${fecha}')">
                        ${opciones.map(opt => `
                            <option value="${opt.valor}" ${valor === opt.valor ? 'selected' : ''} class="${opt.clase}">${opt.texto}</option>
                        `).join('')}
                    </select>
                </td>`;
            });
            tablaHTML += `</tr>`;
        });

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
    const cell = select.parentElement;
    // Usamos el color de fondo de la opción para la celda
    const bgColor = window.getComputedStyle(selectedOption).backgroundColor;
    cell.style.backgroundColor = bgColor;
    cell.innerHTML = `<span style="font-weight:600;">${texto}</span>`;
  });
  const printWindow = window.open('', '_blank');
  printWindow.document.write('<html><head><title>Horario Semanal</title><style>body{font-family:sans-serif;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:8px;text-align:center} th{background-color:#f2f2f2}</style></head><body>');
  printWindow.document.write(clone.outerHTML);
  printWindow.document.write('</body></html>');
  printWindow.document.close();
  printWindow.print();
};

// ======== FIN DEL BLOQUE DE HORARIOS ========


// El resto del código permanece igual. Se incluyen todas las funciones
// originales para la gestión de usuarios, roles y permisos.

// ----------- Funciones de permisos (sin cambios) -----------
async function cargarPermisosDisponibles() {
  if (!currentSupabaseInstance) return [];
  const { data, error } = await currentSupabaseInstance.from('permisos').select('id, nombre, descripcion').order('nombre');
  if (error) { console.error('Error cargando permisos:', error); return []; }
  permisosDisponiblesCache = data || [];
  return permisosDisponiblesCache;
}

async function cargarPermisosUsuario(usuarioId) {
  if (!usuarioId || !currentSupabaseInstance) return [];
  const { data: roles } = await currentSupabaseInstance.from('usuarios_roles').select('rol_id').eq('usuario_id', usuarioId);
  const rolesIds = (roles || []).map(r => r.rol_id);
  const { data: permisosRol } = await currentSupabaseInstance.from('roles_permisos').select('permiso_id').in('rol_id', rolesIds.length ? rolesIds : ['00000000-0000-0000-0000-000000000000']);
  const permisosRolSet = new Set((permisosRol || []).map(pr => pr.permiso_id));
  const { data: permisosPersonalizados } = await currentSupabaseInstance.from('usuarios_permisos').select('permiso_id, permitido').eq('usuario_id', usuarioId);
  const permisosUsuario = {};
  for (const p of permisosDisponiblesCache) {
    permisosUsuario[p.id] = { ...p, checked: permisosRolSet.has(p.id) };
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
    const { data: roles, error } = await supabaseInstance.from('roles').select('id, nombre').order('nombre');
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
      .order('nombre');
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
}

async function formSubmitHandler(event, formUsuarioEl, selectRolesEl, feedbackGlobalEl, formTitleEl, passwordGroupEl, btnCancelarEl, tablaBodyEl) {
  event.preventDefault();
  clearUsuariosFeedback(feedbackGlobalEl);

  const formData = new FormData(formUsuarioEl);
  const usuarioIdEdit = formData.get('usuarioIdEdit');
  const correo = (formUsuarioEl.querySelector('#usuario-correo')?.value || '').trim();
  const nombre = (formData.get('nombre') || '').trim();
  const password = formData.get('password');
  const activo = formData.get('activo') === 'on';
  const roles = Array.from(selectRolesEl.selectedOptions).map(opt => opt.value);

  if (!nombre || nombre.length < 3) return showUsuariosFeedback(feedbackGlobalEl, 'El nombre es obligatorio (mínimo 3 caracteres).', 'error-indicator');
  if (!correo || !correo.includes('@')) return showUsuariosFeedback(feedbackGlobalEl, 'Debes ingresar un correo válido.', 'error-indicator');
  if (!usuarioIdEdit && (!password || password.length < 8)) return showUsuariosFeedback(feedbackGlobalEl, 'La contraseña debe tener mínimo 8 caracteres para usuarios nuevos.', 'error-indicator');
  if (!roles.length) return showUsuariosFeedback(feedbackGlobalEl, 'Debes seleccionar al menos un rol.', 'error-indicator');
  
  showUsuariosFeedback(feedbackGlobalEl, usuarioIdEdit ? 'Actualizando usuario...' : 'Creando usuario...', 'info-indicator', 0);
  const btnGuardar = formUsuarioEl.querySelector('#btn-guardar-usuario');
  btnGuardar.disabled = true;

  try {
    let usuarioId = usuarioIdEdit;
    if (!usuarioIdEdit) {
      const { data: authData, error: authError } = await currentSupabaseInstance.auth.signUp({ email: correo, password, options: { data: { nombre, hotel_id: currentHotelId } } });
      if (authError) throw authError;
      usuarioId = authData.user.id;
      const { error: dbError } = await currentSupabaseInstance.from('usuarios').insert({ id: usuarioId, nombre, correo, hotel_id: currentHotelId, activo });
      if (dbError) throw dbError;
    } else {
      const { error: updateError } = await currentSupabaseInstance.from('usuarios').update({ nombre, activo }).eq('id', usuarioId);
      if (updateError) throw updateError;
    }

    await currentSupabaseInstance.from('usuarios_roles').delete().eq('usuario_id', usuarioId);
    const rolesData = roles.map(rol_id => ({ usuario_id: usuarioId, rol_id, hotel_id: currentHotelId }));
    const { error: rolesError } = await currentSupabaseInstance.from('usuarios_roles').insert(rolesData);
    if (rolesError) throw rolesError;

    showUsuariosFeedback(feedbackGlobalEl, usuarioIdEdit ? 'Usuario actualizado.' : 'Usuario creado.', 'success-indicator');
    await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
    await renderHorarioTurnosSemanal();
    resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);

  } catch (err) {
    showUsuariosFeedback(feedbackGlobalEl, 'Error: ' + (err.message || err.error_description), 'error-indicator', 0);
  } finally {
    btnGuardar.disabled = false;
  }
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
  if (currentContainerEl) currentContainerEl.innerHTML = '';
  currentContainerEl = null;
  console.log("Módulo de usuarios desmontado.");
}

// ----------- Mount principal -----------
export async function mount(container, sbInstance, user, hotelId, planDetails) {
  unmount(container);
  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;
  currentHotelId = hotelId;
  activePlanDetails = planDetails;

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
            </div>
            <div class="form-actions flex items-center gap-3 mt-6 border-t pt-5">
              <button type="submit" id="btn-guardar-usuario" class="button button-primary">Guardar Usuario</button>
              <button type="button" id="btn-cancelar-edicion-usuario" class="button button-outline" style="display:none;">Cancelar Edición</button>
            </div>
          </form>
          
          <hr class="my-8"/>
          
          <div id="configuracion-global-turnos-container" class="mb-8"></div>
          
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
  const turnosGlobalContainer = currentContainerEl.querySelector('#configuracion-global-turnos-container');
  
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
    renderConfiguracionGlobalTurnos(turnosGlobalContainer),
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
            const { data: u, error } = await sbInstance.from('usuarios').select('*, usuarios_roles(roles(id))').eq('id', usuarioId).single();
            if (error) throw error;
            formUsuarioEl.elements.usuarioIdEdit.value = u.id;
            formTitleEl.textContent = 'Editar Usuario';
            passwordGroupEl.style.display = 'none';
            formUsuarioEl.elements.nombre.value = u.nombre || '';
            formUsuarioEl.elements.correo.value = u.correo || '';
            formUsuarioEl.elements.correo.disabled = true;
            const rolesIds = u.usuarios_roles.map(ur => ur.roles.id);
            Array.from(selectRolesEl.options).forEach(opt => { opt.selected = rolesIds.includes(opt.value); });
            formUsuarioEl.elements.activo.checked = u.activo;
            formUsuarioEl.querySelector('#btn-guardar-usuario').textContent = 'Actualizar Usuario';
            btnCancelarEl.style.display = 'inline-block';
            formUsuarioEl.elements.nombre.focus();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showUsuariosFeedback(feedbackGlobalEl, `Error al cargar datos: ${err.message}`, 'error-indicator', 0);
        }
    } else if (accion === 'toggle-activo') {
        const estadoActual = button.dataset.estadoActual === 'true';
        const { error } = await sbInstance.from('usuarios').update({ activo: !estadoActual }).eq('id', usuarioId);
        if (error) showUsuariosFeedback(feedbackGlobalEl, `Error: ${error.message}`, 'error-indicator');
        else {
            showUsuariosFeedback(feedbackGlobalEl, `Usuario ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success-indicator');
            await cargarYRenderizarUsuarios(tablaBodyEl, sbInstance, hotelId);
            await renderHorarioTurnosSemanal();
        }
    } else if (accion === 'reset-password') {
        const email = button.dataset.correo;
        if (confirm(`¿Enviar enlace para resetear contraseña a ${email}?`)) {
            const { error } = await sbInstance.auth.resetPasswordForEmail(email);
            if (error) showUsuariosFeedback(feedbackGlobalEl, `Error: ${error.message}`, 'error-indicator');
            else showUsuariosFeedback(feedbackGlobalEl, `Enlace de reseteo enviado a ${email}.`, 'success-indicator');
        }
    } else if (accion === 'permisos') {
        const usuario = { id: usuarioId, nombre: button.dataset.nombre, correo: button.dataset.correo };
        await abrirModalPermisos(usuario);
    }
  };
  tablaBodyEl.addEventListener('click', tableClickHandler);
  moduleListeners.push({ element: tablaBodyEl, type: 'click', handler: tableClickHandler });
}