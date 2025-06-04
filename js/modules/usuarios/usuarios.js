// js/modules/usuarios/usuarios.js
console.log(">>> usuarios.js cargado");
let currentContainerEl = null;
let currentModuleUser = null;
let currentSupabaseInstance = null;
let currentHotelId = null;
let rolesDisponiblesCache = [];
let permisosDisponiblesCache = [];
let moduleListeners = [];
let activePlanDetails = null;
const EDGE_FUNC_PERMISOS = "https://iikpqpdoslyduecibaij.supabase.co/functions/v1/actualizar_permisos_usuario";

// ----------- Helpers para UI y feedback -----------

function showUsuariosFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 5000) {
  if (!feedbackEl) {
    alert(message);
    return;
  }
  feedbackEl.textContent = message;
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${
    typeClass === 'error-indicator'
      ? 'bg-red-100 border-red-400 text-red-700'
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
  feedbackEl.className = 'feedback-message mt-2 mb-3 opacity-0 transition-opacity duration-300';
  setTimeout(() => {
    if (feedbackEl.textContent === '') feedbackEl.style.display = 'none';
  }, 300);
}

// ----------- Funciones de permisos -----------

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
      permisosUsuario[perm.permiso_id].checked = !!perm.permitido;
    }
  }
  return Object.values(permisosUsuario);
}

// ----------- Modal permisos -----------

function crearModalPermisos() {
  let modal = document.getElementById('modal-permisos-usuario');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-permisos-usuario';
    modal.style = `
      position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:10000;
      background:rgba(0,0,0,0.28); display:none; align-items:center; justify-content:center;
    `;
    modal.innerHTML = `
      <div style="background:white; border-radius:10px; min-width:320px; max-width:400px; padding:2rem; box-shadow:0 4px 16px #2225;">
        <h3 id="modal-permisos-title" style="margin-bottom:1em;">Editar permisos</h3>
        <form id="form-permisos-usuario">
          <div id="modal-lista-permisos" style="max-height:280px;overflow:auto;margin-bottom:1.5em;"></div>
          <div style="display:flex;gap:8px;justify-content:end;">
            <button type="button" id="cancelar-modal-permisos" class="button button-outline">Cancelar</button>
            <button type="submit" class="button button-primary">Guardar</button>
          </div>
        </form>
        <div id="modal-permisos-feedback" style="min-height:22px; color:#e11d48; margin-top:0.8em;"></div>
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
  listaDiv.innerHTML = '<div style="text-align:center;color:#888;">Cargando permisos...</div>';

  if (!permisosDisponiblesCache.length) await cargarPermisosDisponibles();
  const permisosUsuario = await cargarPermisosUsuario(usuario.id);

  listaDiv.innerHTML = permisosUsuario.map(p => `
    <label style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
      <input type="checkbox" name="permiso" value="${p.id}" ${p.checked ? 'checked' : ''}>
      <span>${p.nombre}</span>
      <span style="font-size:12px;color:#888;margin-left:auto">${p.descripcion || ''}</span>
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
      const resp = await fetch(EDGE_FUNC_PERMISOS, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${currentSupabaseInstance.auth.session()?.access_token}` // Se recomienda añadir autenticación
        },
        body: JSON.stringify({ usuario_id: usuario.id, permisos: permisosSeleccionados })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'No se pudieron actualizar los permisos');
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

// ----------- Helpers de roles y usuarios -----------

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
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-red-600">Error: Hotel ID no disponible para cargar usuarios.</td></tr>`;
    return;
  }
  tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">Cargando usuarios...</td></tr>`;
  try {
    const { data: usuarios, error } = await supabaseInstance
      .from('usuarios')
      .select('id, nombre, correo, activo, hotel_id, usuarios_roles ( roles (id, nombre) )')
      .eq('hotel_id', hotelIdParaCarga)
      .order('nombre', { ascending: true });

    if (error) throw error;

    tbodyEl.innerHTML = '';
    if (!usuarios || usuarios.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">No hay usuarios para mostrar.</td></tr>`;
      return;
    }

    usuarios.forEach(u => {
      const rolesNombres = u.usuarios_roles.map(ur => ur.roles?.nombre).filter(Boolean).join(', ') || 'Sin rol';
      const tr = document.createElement('tr');
      tr.className = "hover:bg-gray-50 transition-colors duration-150";
      tr.dataset.usuarioId = u.id;
      tr.innerHTML = `
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-700">${u.nombre || 'N/A'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${u.correo || 'N/A'}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${rolesNombres}</td>
        <td class="px-4 py-3 whitespace-nowrap text-sm">
          <span class="badge px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${u.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
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
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-red-600 text-center p-3">Error al cargar usuarios: ${err.message}</td></tr>`;
  }
}

// ----------- Funciones de formularios -----------

function resetearFormularioUsuario(formEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.usuarioIdEdit.value = '';
  if (formTitleEl) formTitleEl.textContent = 'Crear Nuevo Usuario';
  const emailInput = formEl.elements.correo;
  emailInput.disabled = false;
  emailInput.value = '';
  if (passwordGroupEl) {
    passwordGroupEl.style.display = 'block';
    formEl.elements.password.value = '';
  }
  if (selectRolesEl) {
    if (rolesDisponiblesCache.length > 0) {
      selectRolesEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
      selectRolesEl.value = "";
    } else {
      selectRolesEl.innerHTML = '<option value="" disabled>No hay roles</option>';
    }
  }
  formEl.elements.activo.checked = true;
  formEl.querySelector('#btn-guardar-usuario').textContent = 'Guardar Usuario';
  if (btnCancelarEl) btnCancelarEl.style.display = 'none';
  if(formEl.elements.nombre) formEl.elements.nombre.focus();
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

// ----------- Mount principal -----------

export async function mount(container, sbInstance, user, hotelId, planDetails) { // Parámetros actualizados
  console.log(">>> usuarios.js mount - Iniciando montaje...");
  unmount(container); // Limpia listeners y estado anterior

  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;
  currentHotelId = hotelId; // Usar el hotelId pasado directamente desde main.js
  activePlanDetails = planDetails; // Guardar los detalles del plan activo

  // Log para verificar que los datos llegan correctamente
  console.log("[Usuarios/mount] Hotel ID recibido:", currentHotelId);
  console.log("[Usuarios/mount] Detalles del plan recibidos:", activePlanDetails);

  // Contenido HTML del módulo (como lo tenías)
  currentContainerEl.innerHTML = `
    <div class="card usuarios-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Usuarios del Hotel</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="usuarios-feedback" role="alert" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px; display:none;"></div>
        <form id="form-crear-editar-usuario" class="form mb-6 p-4 border rounded-md bg-gray-50 shadow-sm" novalidate>
          <h3 id="form-usuario-titulo" class="text-lg font-semibold text-gray-700 mb-3">Crear Nuevo Usuario</h3>
          <input type="hidden" id="usuario-id-edit" name="usuarioIdEdit">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div class="form-group">
              <label for="usuario-nombre" class="block text-sm font-medium text-gray-600">Nombre Completo *</label>
              <input type="text" id="usuario-nombre" name="nombre" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required minlength="3">
            </div>
            <div class="form-group">
              <label for="usuario-correo" class="block text-sm font-medium text-gray-600">Correo Electrónico *</label>
              <input type="email" id="usuario-correo" name="correo" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required>
            </div>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
            <div class="form-group" id="password-group">
              <label for="usuario-password" class="block text-sm font-medium text-gray-600">Contraseña * <span class="text-xs text-gray-500">(para nuevos usuarios)</span></label>
              <input type="password" id="usuario-password" name="password" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" minlength="8" placeholder="Mínimo 8 caracteres">
            </div>
            <div class="form-group">
              <label for="usuario-roles" class="block text-sm font-medium text-gray-600">Roles Asignados *</label>
              <select multiple id="usuario-roles" name="roles" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required size="3"></select>
            </div>
          </div>
            <div class="form-group mb-4">
            <div class="flex items-center">
              <input type="checkbox" id="usuario-activo" name="activo" class="form-check-input h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
              <label for="usuario-activo" class="ml-2 block text-sm text-gray-900">Usuario Activo</label>
            </div>
          </div>
          <div class="form-actions flex items-center gap-3 mt-4">
            <button type="submit" id="btn-guardar-usuario" class="button button-primary py-2 px-4 rounded-md text-sm">Guardar Usuario</button>
            <button type="button" id="btn-cancelar-edicion-usuario" class="button button-outline py-2 px-4 rounded-md text-sm" style="display:none;">Cancelar Edición</button>
          </div>
        </form>
        <hr class="my-6"/>
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Usuarios Registrados</h3>
        <div class="table-container overflow-x-auto">
          <table class="tabla-estilizada w-full min-w-full divide-y divide-gray-200">
            <thead class="bg-gray-50">
              <tr>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Correo</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Roles</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Estado</th>
                <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
              </tr>
            </thead>
            <tbody id="tabla-usuarios-body" class="bg-white divide-y divide-gray-200"></tbody>
          </table>
        </div>
      </div>
    </div>`;

  // Selección de elementos del DOM (como ya los tenías)
  const formUsuarioEl = currentContainerEl.querySelector('#form-crear-editar-usuario');
  const tablaBodyEl = currentContainerEl.querySelector('#tabla-usuarios-body');
  const btnCancelarEl = currentContainerEl.querySelector('#btn-cancelar-edicion-usuario');
  const selectRolesEl = currentContainerEl.querySelector('#usuario-roles');
  const feedbackGlobalEl = currentContainerEl.querySelector('#usuarios-feedback');
  const formTitleEl = currentContainerEl.querySelector('#form-usuario-titulo');
  const passwordGroupEl = currentContainerEl.querySelector('#password-group');

  // Verificar si currentHotelId es válido antes de continuar
  if (!currentHotelId) {
    showUsuariosFeedback(feedbackGlobalEl, 'Error crítico: Hotel ID no disponible. Módulo deshabilitado.', 'error-indicator', 0);
    if(formUsuarioEl) formUsuarioEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return; // Detener el montaje si no hay hotelId
  }

  // Cargar datos iniciales
  await cargarRolesDisponibles(selectRolesEl, currentSupabaseInstance);
  await cargarPermisosDisponibles(); // Asegúrate que esta función use currentSupabaseInstance si es necesario
  await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
  resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);

  // Asignar event listener para el formulario (el handler 'formSubmitHandler' usará 'activePlanDetails')
  // Asegúrate que formSubmitHandler esté definido en este archivo y accesible
  const submitHandler = (event) => formSubmitHandler(event, formUsuarioEl, selectRolesEl, feedbackGlobalEl, formTitleEl, passwordGroupEl, btnCancelarEl, tablaBodyEl);
  formUsuarioEl.addEventListener('submit', submitHandler);
  moduleListeners.push({
    element: formUsuarioEl,
    type: 'submit',
    handler: submitHandler
  });

  // Asignar otros listeners (para la tabla, botón cancelar, etc., como ya los tenías)
  const tableClickHandler = async (event) => {
    // ... tu lógica existente para tableClickHandler ...
    const button = event.target.closest('button[data-accion]');
    if (!button) return;
    const usuarioId = button.dataset.id;
    const accion = button.dataset.accion;
    const userEmail = button.dataset.correo; // Asegúrate de tener estos data-attributes en tus botones
    const userName = button.dataset.nombre;

    clearUsuariosFeedback(feedbackGlobalEl);

    if (accion === 'editar') {
        try {
            const { data: usuarioToEdit, error } = await currentSupabaseInstance
                .from('usuarios')
                .select('*, usuarios_roles(roles(id, nombre))') // Asegúrate que tu tabla/vista permita esto
                .eq('id', usuarioId)
                .eq('hotel_id', currentHotelId)
                .single();
            
            if (error) throw error;
            
            if (usuarioToEdit) {
                formUsuarioEl.elements.usuarioIdEdit.value = usuarioToEdit.id;
                if(formTitleEl) formTitleEl.textContent = 'Editar Usuario';
                if(passwordGroupEl) passwordGroupEl.style.display = 'none'; 
                formUsuarioEl.elements.nombre.value = usuarioToEdit.nombre || '';
                formUsuarioEl.elements.correo.value = usuarioToEdit.correo || '';
                formUsuarioEl.elements.correo.disabled = true; // Deshabilitar correo al editar
                
                const rolesAsignadosIds = usuarioToEdit.usuarios_roles.map(ur => ur.roles?.id?.toString()).filter(Boolean);
                Array.from(selectRolesEl.options).forEach(option => {
                    option.selected = rolesAsignadosIds.includes(option.value);
                });
                formUsuarioEl.elements.activo.checked = usuarioToEdit.activo;
                formUsuarioEl.querySelector('#btn-guardar-usuario').textContent = 'Actualizar Usuario';
                if(btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
                formUsuarioEl.elements.nombre.focus();
            } else {
                showUsuariosFeedback(feedbackGlobalEl, 'Usuario no encontrado para editar.', 'error-indicator');
            }
        } catch (err) {
            showUsuariosFeedback(feedbackGlobalEl, `Error al cargar datos para editar: ${err.message}`, 'error-indicator', 0);
        }
    } else if (accion === 'toggle-activo') {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        const { error } = await currentSupabaseInstance
          .from('usuarios')
          .update({ activo: !estadoActual, updated_at: new Date().toISOString() })
          .eq('id', usuarioId)
          .eq('hotel_id', currentHotelId);
        if (error) throw error;
        showUsuariosFeedback(feedbackGlobalEl, `Usuario ${!estadoActual ? 'activado' : 'desactivado'}.`, 'success-indicator');
        await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
      } catch (err) {
        showUsuariosFeedback(feedbackGlobalEl, `Error al cambiar estado: ${err.message}`, 'error-indicator', 0);
      }
    } else if (accion === 'reset-password') {
      if (!userEmail) {
        showUsuariosFeedback(feedbackGlobalEl, 'No se pudo obtener el correo del usuario para el reseteo.', 'error-indicator');
        return;
      }
      if (confirm(`¿Está seguro de que desea enviar un enlace de reseteo de contraseña a ${userEmail}?`)) {
        try {
          const { error } = await currentSupabaseInstance.auth.resetPasswordForEmail(userEmail);
          if (error) throw error;
          showUsuariosFeedback(feedbackGlobalEl, `Enlace de reseteo de contraseña enviado a ${userEmail}.`, 'success-indicator');
        } catch (err) {
          showUsuariosFeedback(feedbackGlobalEl, `Error al enviar enlace de reseteo: ${err.message}`, 'error-indicator', 0);
        }
      }
    } else if (accion === 'permisos') {
        const usuario = { id: usuarioId, nombre: userName, correo: userEmail };
        await abrirModalPermisos(usuario); // Esta función usa `currentSupabaseInstance` y otras variables globales del módulo
    }
  };
  tablaBodyEl.addEventListener('click', tableClickHandler);
  moduleListeners.push({ element: tablaBodyEl, type: 'click', handler: tableClickHandler });

  const cancelHandler = () => resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);
  btnCancelarEl.addEventListener('click', cancelHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelHandler });

  console.log("[Usuarios/mount] Montaje completado.");
}