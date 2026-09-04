import { supabase } from './supabaseClient.js';

const FORM_ID = 'form-crear-editar-usuario';
let creating = false;

function setFeedback(message, type = 'info') {
  const el = document.getElementById('usuarios-feedback');
  if (!el) return;
  el.textContent = message;
  el.style.display = 'block';
  el.classList.remove('error-indicator', 'success-indicator', 'info-indicator');
  el.classList.add(type === 'error' ? 'error-indicator' : type === 'success' ? 'success-indicator' : 'info-indicator');
}

function getSelectedRoles(form) {
  const select = form.querySelector('#usuario-roles');
  return Array.from(select?.selectedOptions || []).map((option) => option.value).filter(Boolean);
}

async function resolveCurrentHotelId() {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData?.user;
  if (userError || !user?.id) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');

  const { data: profile, error: profileError } = await supabase
    .from('usuarios')
    .select('hotel_id')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.hotel_id) {
    throw new Error('No se pudo identificar el hotel de tu cuenta.');
  }
  return profile.hotel_id;
}

async function createCollaborator(form) {
  if (creating) return;

  const editId = form.querySelector('#usuario-id-edit')?.value?.trim();
  if (editId) return;

  const nombre = form.querySelector('#usuario-nombre')?.value?.trim() || '';
  const correo = form.querySelector('#usuario-correo')?.value?.trim() || '';
  const password = form.querySelector('#usuario-password')?.value || '';
  const activo = Boolean(form.querySelector('#usuario-activo')?.checked);
  const roles = getSelectedRoles(form);

  if (nombre.length < 3) throw new Error('El nombre es obligatorio (mínimo 3 caracteres).');
  if (!correo || !correo.includes('@')) throw new Error('Debes ingresar un correo válido.');
  if (password.length < 8) throw new Error('La contraseña debe tener mínimo 8 caracteres.');
  if (!roles.length) throw new Error('Debes seleccionar al menos un rol.');

  creating = true;
  const button = form.querySelector('#btn-guardar-usuario');
  if (button) button.disabled = true;
  setFeedback('Creando usuario...', 'info');

  try {
    const hotelId = await resolveCurrentHotelId();
    const { data, error } = await supabase.functions.invoke('crear_colaborador', {
      body: { nombre, correo, password, hotel_id: hotelId, roles },
    });

    if (error) {
      let message = error.message || 'No se pudo crear el usuario.';
      try {
        const context = error.context;
        if (context && typeof context.json === 'function') {
          const payload = await context.json();
          message = payload?.error || message;
        }
      } catch (_) {}
      throw new Error(message);
    }
    if (data?.error) throw new Error(data.error);

    if (!activo && data?.userId) {
      const { error: activeError } = await supabase
        .from('usuarios')
        .update({ activo: false })
        .eq('id', data.userId)
        .eq('hotel_id', hotelId);
      if (activeError) console.warn('Usuario creado, pero no se pudo marcar como inactivo:', activeError);
    }

    setFeedback('Usuario creado correctamente. Actualizando la lista...', 'success');
    form.reset();
    setTimeout(() => window.location.reload(), 650);
  } finally {
    creating = false;
    if (button) button.disabled = false;
  }
}

// Intercepta únicamente la creación de usuarios nuevos antes del listener legacy.
// La edición continúa usando el flujo actual del módulo.
document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== FORM_ID) return;

  const editId = form.querySelector('#usuario-id-edit')?.value?.trim();
  if (editId) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  createCollaborator(form).catch((error) => {
    setFeedback(`Error: ${error?.message || 'No se pudo crear el usuario.'}`, 'error');
  });
}, true);
