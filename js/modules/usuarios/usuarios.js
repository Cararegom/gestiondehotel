// js/modules/usuarios/usuarios.js
// import { supabase } from '../../supabaseClient.js'; // Will use currentSupabaseInstance from mount

// --- Module-Scoped Variables ---
let currentContainerEl = null;
let currentModuleUser = null; // The user interacting with this module (admin, manager)
let currentSupabaseInstance = null;
let currentHotelId = null;
let rolesDisponiblesCache = [];
let moduleListeners = [];

// --- UI Helper Functions (Scoped) ---
/**
 * Shows a feedback message within the usuarios module.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 * @param {string} message - The message to show.
 * @param {'success-indicator' | 'error-indicator' | 'info-indicator'} [typeClass='success-indicator'] - CSS class for feedback type.
 * @param {number} [duration=4000] - Duration in ms. 0 for indefinite.
 */
function showUsuariosFeedback(feedbackEl, message, typeClass = 'success-indicator', duration = 4000) {
  if (!feedbackEl) {
    console.warn("Feedback element not provided to showUsuariosFeedback");
    return;
  }
  feedbackEl.textContent = message;
  let alertClasses = 'bg-green-100 border-green-300 text-green-700'; // success
  if (typeClass === 'error-indicator') {
    alertClasses = 'bg-red-100 border-red-300 text-red-700';
  } else if (typeClass === 'info-indicator') {
    alertClasses = 'bg-blue-100 border-blue-300 text-blue-700';
  }
  feedbackEl.className = `feedback-message mt-2 mb-3 p-3 rounded-md border text-sm ${alertClasses} visible`;
  feedbackEl.style.display = 'block';
  feedbackEl.setAttribute('aria-live', typeClass === 'error-indicator' ? 'assertive' : 'polite');

  if (typeClass.includes('error-indicator')) {
    feedbackEl.setAttribute('tabindex', '-1'); // Make it focusable for screen readers
    feedbackEl.focus();
  }
  if (duration > 0) {
    setTimeout(() => clearUsuariosFeedback(feedbackEl), duration);
  }
}

/**
 * Clears the feedback message.
 * @param {HTMLElement} feedbackEl - The feedback display element.
 */
function clearUsuariosFeedback(feedbackEl) {
  if (!feedbackEl) return;
  feedbackEl.textContent = '';
  feedbackEl.className = 'feedback-message mt-2 mb-3'; // Reset classes
  feedbackEl.style.display = 'none';
  feedbackEl.removeAttribute('tabindex');
}

/**
 * Sets the loading state for a form.
 * @param {HTMLFormElement} formEl - The form element.
 * @param {boolean} isLoading - True if loading, false otherwise.
 * @param {HTMLButtonElement} buttonEl - The submit button.
 * @param {string} originalButtonText - The button's original text.
 * @param {string} [loadingButtonText='Procesando...'] - Text for the button when loading.
 */
function setFormLoadingState(formEl, isLoading, buttonEl, originalButtonText, loadingButtonText = 'Procesando...') {
  if (!formEl) return;
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? loadingButtonText : originalButtonText;
    if(isLoading) buttonEl.classList.add('opacity-75', 'cursor-not-allowed');
    else buttonEl.classList.remove('opacity-75', 'cursor-not-allowed');
  }
  Array.from(formEl.elements).forEach(el => {
    // Disable all input/select/textarea/button elements within the form, except the main submit button if handled separately
    if (el !== buttonEl && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON')) {
      el.disabled = isLoading;
    }
  });
}

/**
 * Loads and renders users into the table.
 * @param {HTMLElement} tbodyEl - The tbody element of the users table.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The ID of the current hotel.
 */
async function cargarYRenderizarUsuarios(tbodyEl, supabaseInstance, hotelId) {
  if (!tbodyEl || !hotelId) {
    console.error("Cannot load users: tbody or hotelId missing.");
    if (tbodyEl) tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-red-600">Error: Datos insuficientes para cargar usuarios.</td></tr>`;
    return;
  }
  tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">
    <span class="loading-indicator visible">Cargando usuarios...</span>
  </td></tr>`;

  try {
    const { data: usuarios, error } = await supabaseInstance
      .from('usuarios') // This should be your user profiles table, not auth.users directly for custom fields
      .select(`
        id,
        nombre,
        correo,
        activo,
        hotel_id, 
        usuarios_roles (
          roles (id, nombre)
        )
      `)
      .eq('hotel_id', hotelId) // Filter by the hotel_id of the current admin/manager
      .order('nombre', { ascending: true });
    if (error) throw error;

    tbodyEl.innerHTML = '';
    if (!usuarios || usuarios.length === 0) {
      tbodyEl.innerHTML = `<tr><td colspan="5" class="text-center p-3 text-gray-500">
        No hay usuarios registrados para este hotel.
      </td></tr>`;
      return;
    }

    usuarios.forEach(u => {
      const rolesNombres = u.usuarios_roles.map(ur => ur.roles.nombre).join(', ') || 'Sin rol asignado';
      const tr = document.createElement('tr');
      tr.className = "hover:bg-gray-50";
      tr.dataset.usuarioId = u.id;
      tr.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-700">${u.nombre || 'N/A'}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${u.correo || 'N/A'}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${rolesNombres}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm">
          <span class="badge px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${u.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}">
            ${u.activo ? 'Activo' : 'Inactivo'}
          </span>
        </td>
        <td class="px-4 py-2 whitespace-nowrap text-sm font-medium space-x-2">
          <button class="button button-outline button-small text-xs" data-accion="editar" data-id="${u.id}" title="Editar ${u.nombre || u.correo}">Editar</button>
          <button class="button button-small text-xs ${u.activo ? 'button-warning' : 'button-success'}"
                  data-accion="toggle-activo" data-id="${u.id}" data-estado-actual="${u.activo}" title="${u.activo ? 'Desactivar' : 'Activar'}">
            ${u.activo ? 'Desactivar' : 'Activar'}
          </button>
          <button class="button button-accent button-small text-xs" data-accion="reset-password"
                  data-id="${u.id}" data-correo="${u.correo}" title="Enviar reseteo de contraseña a ${u.correo}">
            Reset Pass
          </button>
        </td>`;
      tbodyEl.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading users:', err);
    tbodyEl.innerHTML = `<tr><td colspan="5" class="text-red-600 text-center p-3">
      Error al cargar usuarios: ${err.message}
    </td></tr>`;
  }
}

/**
 * Loads available roles for the current hotel into a select element.
 * @param {HTMLSelectElement} selectEl - The select element to populate.
 * @param {object} supabaseInstance - The Supabase client instance.
 * @param {string} hotelId - The ID of the current hotel.
 */
async function cargarRolesDisponibles(selectEl, supabaseInstance, hotelId) {
  if (!selectEl || !hotelId) {
    console.error("Cannot load roles: selectElement or hotelId missing.");
    if(selectEl) selectEl.innerHTML = `<option value="" disabled>Error</option>`;
    return;
  }
  selectEl.innerHTML = `<option value="">Cargando roles...</option>`;
  try {
    // Assuming 'roles' are specific to a hotel or filtered by RLS.
    // If 'roles' table has a 'hotel_id' column and it's not handled by RLS, add .eq('hotel_id', hotelId)
    const { data: roles, error } = await supabaseInstance
      .from('roles')
      .select('id, nombre')
      // .eq('hotel_id', hotelId) // Add if roles are directly tied to hotel_id and not via RLS
      .order('nombre', { ascending: true });
    if (error) throw error;
    
    rolesDisponiblesCache = roles || [];
    if (rolesDisponiblesCache.length > 0) {
      selectEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
    } else {
      selectEl.innerHTML = `<option value="" disabled>No hay roles configurados para este hotel</option>`;
    }
  } catch (e) {
    console.error('Error loading roles:', e);
    selectEl.innerHTML = `<option value="" disabled>Error al cargar roles</option>`;
    rolesDisponiblesCache = []; // Clear cache on error
  }
}

/**
 * Populates the user form for editing.
 * @param {HTMLFormElement} formEl - The user form element.
 * @param {object} usuarioData - The user data to populate the form with.
 * @param {HTMLElement} formTitleEl - The HMTL element for the form title.
 * @param {HTMLElement} passwordGroupEl - The password input group element.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel edit button.
 */
function poblarFormularioEdicion(formEl, usuarioData, formTitleEl, passwordGroupEl, btnCancelarEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.usuarioIdEdit.value = usuarioData.id;
  if(formTitleEl) formTitleEl.textContent = `Editando Usuario: ${usuarioData.nombre || usuarioData.correo}`;
  
  formEl.elements.nombre.value = usuarioData.nombre || '';
  const emailInput = formEl.elements.correo;
  emailInput.value = usuarioData.correo || '';
  emailInput.disabled = true; // Do not allow email change for existing users via this form

  if(passwordGroupEl) passwordGroupEl.style.display = 'none'; // Hide password field for editing user profile data

  const selectRolesEl = formEl.elements.roles;
  // Repopulate roles in case cache was cleared or for safety, ensuring options are fresh
  selectRolesEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
  const rolesAsignadosIds = usuarioData.usuarios_roles.map(ur => ur.roles.id.toString()); // Ensure string comparison for values
  Array.from(selectRolesEl.options).forEach(option => {
    option.selected = rolesAsignadosIds.includes(option.value);
  });

  formEl.elements.activo.checked = usuarioData.activo;

  formEl.querySelector('#btn-guardar-usuario').textContent = 'Actualizar Usuario';
  if(btnCancelarEl) btnCancelarEl.style.display = 'inline-block';
  formEl.elements.nombre.focus();
}

/**
 * Resets the user form to its initial state for creating a new user.
 * @param {HTMLFormElement} formEl - The user form element.
 * @param {HTMLElement} formTitleEl - The HMTL element for the form title.
 * @param {HTMLElement} passwordGroupEl - The password input group element.
 * @param {HTMLButtonElement} btnCancelarEl - The cancel edit button.
 * @param {HTMLSelectElement} selectRolesEl - The roles select element.
 */
function resetearFormularioUsuario(formEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl) {
  if (!formEl) return;
  formEl.reset();
  formEl.elements.usuarioIdEdit.value = '';
  if(formTitleEl) formTitleEl.textContent = 'Crear Nuevo Usuario';
  
  const emailInput = formEl.elements.correo;
  emailInput.disabled = false;
  if(passwordGroupEl) passwordGroupEl.style.display = 'block'; // Show password field for new user
  
  // Reset roles selection
  if (selectRolesEl) {
    selectRolesEl.innerHTML = rolesDisponiblesCache.map(r => `<option value="${r.id}">${r.nombre}</option>`).join('');
    Array.from(selectRolesEl.options).forEach(opt => opt.selected = false);
  }
  formEl.elements.activo.checked = true; // Default to active

  formEl.querySelector('#btn-guardar-usuario').textContent = 'Guardar Usuario';
  if(btnCancelarEl) btnCancelarEl.style.display = 'none';
  formEl.elements.nombre.focus();
}

/**
 * Main mount function for the Usuarios module.
 * @param {HTMLElement} container - The main container for the module.
 * @param {object} sbInstance - The Supabase client instance.
 * @param {object} user - The current authenticated user (admin/manager).
 */
export async function mount(container, sbInstance, user) {
  unmount(container); // Clean up previous instance

  currentContainerEl = container;
  currentSupabaseInstance = sbInstance;
  currentModuleUser = user;

  // Fetch hotelId for the current admin/manager
  currentHotelId = currentModuleUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentModuleUser?.id) {
    try {
      const { data: perfil, error: perfilError } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      if (perfilError && perfilError.code !== 'PGRST116') throw perfilError;
      currentHotelId = perfil?.hotel_id;
    } catch (e) {
      console.error('Usuarios Module: Error fetching hotelId from profile:', e);
    }
  }

  currentContainerEl.innerHTML = `
    <div class="card usuarios-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Gestión de Usuarios del Hotel</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="usuarios-feedback" role="status" aria-live="polite" class="feedback-message mb-4" style="min-height: 24px;"></div>
        
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
              <select multiple id="usuario-roles" name="roles" class="form-control mt-1 block w-full rounded-md border-gray-300 shadow-sm sm:text-sm" required size="3">
                <option>Cargando roles...</option>
              </select>
            </div>
          </div>
          <div class="form-group mb-4">
            <div class="flex items-center">
              <input type="checkbox" id="usuario-activo" name="activo" class="form-check-input h-4 w-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500" checked>
              <label for="usuario-activo" class="ml-2 block text-sm text-gray-900">Usuario Activo</label>
            </div>
          </div>
          <div class="form-actions flex items-center gap-3">
            <button type="submit" id="btn-guardar-usuario" class="button button-primary py-2 px-4 rounded-md text-sm">Guardar Usuario</button>
            <button type="button" id="btn-cancelar-edicion-usuario" class="button button-outline py-2 px-4 rounded-md text-sm" style="display:none;">Cancelar Edición</button>
          </div>
        </form>
        
        <hr class="my-6"/>
        
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Usuarios Registrados en el Hotel</h3>
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

  const formUsuarioEl = currentContainerEl.querySelector('#form-crear-editar-usuario');
  const tablaBodyEl = currentContainerEl.querySelector('#tabla-usuarios-body');
  const btnGuardarEl = currentContainerEl.querySelector('#btn-guardar-usuario');
  const btnCancelarEl = currentContainerEl.querySelector('#btn-cancelar-edicion-usuario');
  const selectRolesEl = currentContainerEl.querySelector('#usuario-roles');
  const feedbackGlobalEl = currentContainerEl.querySelector('#usuarios-feedback');
  const formTitleEl = currentContainerEl.querySelector('#form-usuario-titulo');
  const passwordGroupEl = currentContainerEl.querySelector('#password-group');

  if (!currentHotelId) {
    showUsuariosFeedback(feedbackGlobalEl, 'Error crítico: No se pudo determinar el hotel. Módulo de usuarios deshabilitado.', 'error-indicator', 0);
    formUsuarioEl.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
    return;
  }

  // Initial data load
  setFormLoadingState(formUsuarioEl, true, btnGuardarEl, 'Guardar Usuario', 'Cargando...');
  await cargarRolesDisponibles(selectRolesEl, currentSupabaseInstance, currentHotelId);
  await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
  resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);
  setFormLoadingState(formUsuarioEl, false, btnGuardarEl, 'Guardar Usuario');


  // --- Event Handlers ---
  const formSubmitHandler = async (event) => {
    event.preventDefault();
    clearUsuariosFeedback(feedbackGlobalEl);
    const originalButtonText = btnGuardarEl.textContent;
    setFormLoadingState(formUsuarioEl, true, btnGuardarEl, originalButtonText, 'Procesando...');

    const formData = new FormData(formUsuarioEl);
    const idEdit = formData.get('usuarioIdEdit');
    const nombre = formData.get('nombre')?.trim();
    const correo = formData.get('correo')?.trim().toLowerCase();
    const password = formData.get('password'); // Only for new users
    const activo = formUsuarioEl.elements.activo.checked; // Get from checkbox state
    const rolesSeleccionadosIds = Array.from(selectRolesEl.selectedOptions).map(opt => opt.value);

    if (!nombre || !correo || rolesSeleccionadosIds.length === 0) {
      showUsuariosFeedback(feedbackGlobalEl, 'Nombre, correo y al menos un rol son obligatorios.', 'error-indicator');
      setFormLoadingState(formUsuarioEl, false, btnGuardarEl, originalButtonText);
      return;
    }
    if (!idEdit && (!password || password.length < 8)) { // Password required and min length for new users
      showUsuariosFeedback(feedbackGlobalEl, 'Para nuevos usuarios, la contraseña es obligatoria (mínimo 8 caracteres).', 'error-indicator');
      setFormLoadingState(formUsuarioEl, false, btnGuardarEl, originalButtonText);
      formUsuarioEl.elements.password.focus();
      return;
    }

    try {
      if (idEdit) { // --- Update Existing User ---
        // 1. Update user profile data in 'usuarios' table
        const { error: profileUpdateError } = await currentSupabaseInstance
          .from('usuarios')
          .update({ nombre, activo, updated_at: new Date().toISOString() })
          .eq('id', idEdit)
          .eq('hotel_id', currentHotelId); // Ensure update is scoped to hotel
        if (profileUpdateError) throw profileUpdateError;

        // 2. Update roles: Delete existing roles and insert new ones
        const { error: deleteRolesError } = await currentSupabaseInstance
          .from('usuarios_roles')
          .delete()
          .eq('usuario_id', idEdit);
        if (deleteRolesError) throw deleteRolesError;

        if (rolesSeleccionadosIds.length > 0) {
          const rolesToInsert = rolesSeleccionadosIds.map(rolId => ({
            usuario_id: idEdit,
            rol_id: rolId,
            // hotel_id: currentHotelId // Add if your usuarios_roles table has hotel_id and it's not set by default/trigger
          }));
          const { error: insertRolesError } = await currentSupabaseInstance
            .from('usuarios_roles')
            .insert(rolesToInsert);
          if (insertRolesError) throw insertRolesError;
        }
        showUsuariosFeedback(feedbackGlobalEl, 'Usuario actualizado exitosamente.', 'success-indicator');
      } else { // --- Create New User ---
        // Call RPC function to create Auth user, profile in 'usuarios', and assign roles
        const { data: rpcResult, error: rpcError } = await currentSupabaseInstance.rpc(
          'crear_usuario_hotel_con_perfil_y_roles',
          {
            p_email: correo,
            p_password: password,
            p_nombre: nombre,
            p_hotel_id: currentHotelId,
            p_roles_ids: rolesSeleccionadosIds,
            p_activo: activo
            // p_user_metadata: { hotel_id: currentHotelId, rol: rolesDisponiblesCache.find(r => r.id === rolesSeleccionadosIds[0])?.nombre || 'usuario' } // Example metadata
          }
        );
        if (rpcError) throw rpcError;
        if (rpcResult && rpcResult.error) throw new Error(rpcResult.message || 'Error devuelto por la función del servidor.');
        
        showUsuariosFeedback(feedbackGlobalEl, `Usuario ${rpcResult?.user_name || correo} creado exitosamente.`, 'success-indicator');
      }
      resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);
      await cargarYRenderizarUsuarios(tablaBodyEl, currentSupabaseInstance, currentHotelId);
    } catch (err) {
      console.error('Error saving user:', err);
      showUsuariosFeedback(feedbackGlobalEl, `Error al guardar usuario: ${err.message}`, 'error-indicator', 0);
    } finally {
      setFormLoadingState(formUsuarioEl, false, btnGuardarEl, originalButtonText);
    }
  };
  formUsuarioEl.addEventListener('submit', formSubmitHandler);
  moduleListeners.push({ element: formUsuarioEl, type: 'submit', handler: formSubmitHandler });

  const cancelEditHandler = () => {
    resetearFormularioUsuario(formUsuarioEl, formTitleEl, passwordGroupEl, btnCancelarEl, selectRolesEl);
    clearUsuariosFeedback(feedbackGlobalEl);
  };
  btnCancelarEl.addEventListener('click', cancelEditHandler);
  moduleListeners.push({ element: btnCancelarEl, type: 'click', handler: cancelEditHandler });

  // Event delegation for actions on the users table
  const tablaUsuariosClickHandler = async (event) => {
    const button = event.target.closest('button[data-accion]');
    if (!button) return;

    const usuarioId = button.dataset.id;
    const accion = button.dataset.accion;
    const userEmail = button.dataset.correo; // For password reset

    clearUsuariosFeedback(feedbackGlobalEl);

    if (accion === 'editar') {
      try {
        const { data: usuarioToEdit, error } = await currentSupabaseInstance
          .from('usuarios')
          .select('*, usuarios_roles(roles(id, nombre))') // Fetch roles for pre-selection
          .eq('id', usuarioId)
          .eq('hotel_id', currentHotelId)
          .single();
        if (error) throw error;
        if (usuarioToEdit) {
          poblarFormularioEdicion(formUsuarioEl, usuarioToEdit, formTitleEl, passwordGroupEl, btnCancelarEl);
          window.scrollTo({ top: formUsuarioEl.offsetTop - 20, behavior: 'smooth' });
        } else {
          showUsuariosFeedback(feedbackGlobalEl, 'Usuario no encontrado para editar.', 'error-indicator');
        }
      } catch (err) {
        showUsuariosFeedback(feedbackGlobalEl, `Error al cargar datos para editar: ${err.message}`, 'error-indicator', 0);
      }
    } else if (accion === 'toggle-activo') {
      const estadoActual = button.dataset.estadoActual === 'true';
      try {
        // Note: Supabase Auth user status (enabled/disabled) is separate from your 'usuarios.activo' field.
        // This only updates your custom 'activo' field.
        // To disable login, you'd need to use Supabase Admin SDK on the server or an Edge Function.
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
          // This sends an email via Supabase Auth
          const { error } = await currentSupabaseInstance.auth.resetPasswordForEmail(userEmail, {
            // redirectTo: 'URL_DE_REDIRECCION_TRAS_RESETEO' // Optional: URL to redirect after password reset
          });
          if (error) throw error;
          showUsuariosFeedback(feedbackGlobalEl, `Enlace de reseteo de contraseña enviado a ${userEmail}.`, 'success-indicator');
        } catch (err) {
          showUsuariosFeedback(feedbackGlobalEl, `Error al enviar enlace de reseteo: ${err.message}`, 'error-indicator', 0);
        }
      }
    }
  };
  tablaBodyEl.addEventListener('click', tablaUsuariosClickHandler);
  moduleListeners.push({ element: tablaBodyEl, type: 'click', handler: tablaUsuariosClickHandler });
}

/**
 * Unmounts the Usuarios module, cleaning up listeners and state.
 * @param {HTMLElement} container - The main container of the module (optional).
 */
export function unmount(container) {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];

  // Reset module-scoped variables
  rolesDisponiblesCache = [];
  currentHotelId = null;
  currentModuleUser = null;
  currentSupabaseInstance = null;
  
  if (currentContainerEl) { // Use the stored container reference
    currentContainerEl.innerHTML = '';
  }
  currentContainerEl = null; // Clear the reference
  
  console.log('Usuarios module unmounted.');
}
