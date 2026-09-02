import { supabase } from '../../supabaseClient.js';
import { registrarAccionSensible } from '../../services/sensitiveAuditService.js';
import { confirmDestructiveAction } from '../../services/destructiveConfirmationService.js';

const ENHANCED_ATTR = 'data-archivo-usuarios-enhanced';
let actorContextPromise = null;

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

async function getActorContext() {
  if (!actorContextPromise) {
    actorContextPromise = (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: profile } = await supabase
        .from('usuarios')
        .select('id, hotel_id')
        .eq('id', user.id)
        .maybeSingle();
      return profile ? { id: user.id, hotel_id: profile.hotel_id } : null;
    })();
  }
  return actorContextPromise;
}

async function readFunctionError(error) {
  try {
    if (error?.context && typeof error.context.json === 'function') {
      const payload = await error.context.json();
      if (payload?.error) return payload;
    }
  } catch {
    // Supabase puede entregar un body ya consumido; usamos el mensaje genérico.
  }
  return { error: error?.message || 'No se pudo completar la operación.' };
}

async function invokeLifecycle(action, userId) {
  const { data, error } = await supabase.functions.invoke('manage-user-lifecycle', {
    body: { action, user_id: userId }
  });
  if (error) {
    const payload = await readFunctionError(error);
    const lifecycleError = new Error(payload.error || error.message || 'No se pudo completar la operación.');
    lifecycleError.code = payload.code;
    lifecycleError.dependencies = payload.dependencies;
    throw lifecycleError;
  }
  if (!data?.ok) throw new Error(data?.error || 'La operación no fue confirmada por el servidor.');
  return data;
}

function getRowIsActive(row) {
  if (row.dataset.lifecycleStatus) return row.dataset.lifecycleStatus === 'active';
  const statusText = normalizeText(row.children?.[3]?.textContent);
  return statusText.includes('activo') && !statusText.includes('inactivo');
}

function setActionVisibility(row, action, visible) {
  const button = row.querySelector(`button[data-accion="${action}"]`);
  if (button) button.style.display = visible ? '' : 'none';
}

function setRowState(row, active) {
  row.dataset.lifecycleStatus = active ? 'active' : 'archived';
  const statusCell = row.children?.[3];
  const statusBadge = statusCell?.querySelector('span');
  if (statusBadge) {
    statusBadge.textContent = active ? 'Activo' : 'Archivado';
    statusBadge.className = `px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
      active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-700'
    }`;
  }

  const toggleButton = row.querySelector('button[data-accion="toggle-activo"]');
  if (toggleButton) {
    toggleButton.dataset.estadoActual = String(active);
    toggleButton.textContent = active ? 'Retirar empleado' : 'Reactivar';
    toggleButton.className = `button button-small text-xs ${active ? 'button-warning' : 'button-success'}`;
  }

  const deleteButton = row.querySelector('button[data-accion="eliminar"]');
  if (deleteButton) {
    deleteButton.textContent = 'Eliminar definitivamente';
    deleteButton.style.display = active ? 'none' : '';
  }

  // Un empleado archivado conserva su historia, pero no se edita ni se le
  // restablece contraseña hasta ser reactivado.
  setActionVisibility(row, 'editar', active);
  setActionVisibility(row, 'reset-password', active);
  setActionVisibility(row, 'permisos', active);
}

function decorateRows(root) {
  const rows = root.querySelectorAll('#tabla-usuarios-body tr[data-usuario-id]');
  rows.forEach((row) => setRowState(row, getRowIsActive(row)));
  applyCurrentFilter(root);
}

function updateCounts(root) {
  const rows = [...root.querySelectorAll('#tabla-usuarios-body tr[data-usuario-id]')];
  const activeCount = rows.filter((row) => row.dataset.lifecycleStatus === 'active').length;
  const archivedCount = rows.filter((row) => row.dataset.lifecycleStatus === 'archived').length;
  const activeCountEl = root.querySelector('[data-user-count="active"]');
  const archivedCountEl = root.querySelector('[data-user-count="archived"]');
  if (activeCountEl) activeCountEl.textContent = String(activeCount);
  if (archivedCountEl) archivedCountEl.textContent = String(archivedCount);
}

function applyCurrentFilter(root) {
  const view = root.dataset.userListView || 'active';
  root.querySelectorAll('#tabla-usuarios-body tr[data-usuario-id]').forEach((row) => {
    row.hidden = row.dataset.lifecycleStatus !== view;
  });
  root.querySelectorAll('[data-user-view]').forEach((button) => {
    const selected = button.dataset.userView === view;
    button.className = selected
      ? 'rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm'
      : 'rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50';
  });
  const empty = root.querySelector('#usuarios-archivo-empty');
  const visibleRows = [...root.querySelectorAll('#tabla-usuarios-body tr[data-usuario-id]')].filter((row) => !row.hidden);
  if (empty) {
    empty.style.display = visibleRows.length ? 'none' : 'block';
    empty.textContent = view === 'active'
      ? 'No hay empleados activos para mostrar.'
      : 'No hay empleados archivados.';
  }
  updateCounts(root);
}

function installToolbar(root) {
  if (root.querySelector('#usuarios-archivo-toolbar')) return;
  const tbody = root.querySelector('#tabla-usuarios-body');
  const tableContainer = tbody?.closest('.table-container');
  if (!tableContainer) return;

  const toolbar = document.createElement('div');
  toolbar.id = 'usuarios-archivo-toolbar';
  toolbar.className = 'mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between';
  toolbar.innerHTML = `
    <div>
      <div class="flex flex-wrap gap-2">
        <button type="button" data-user-view="active" class="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white shadow-sm">
          Personal activo <span data-user-count="active" class="ml-1 rounded-full bg-white/20 px-2 py-0.5">0</span>
        </button>
        <button type="button" data-user-view="archived" class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50">
          Archivados <span data-user-count="archived" class="ml-1 rounded-full bg-slate-100 px-2 py-0.5">0</span>
        </button>
      </div>
      <p class="mt-2 text-xs text-slate-500">Los exempleados se archivan para conservar reservas, caja, ventas, turnos y auditoría.</p>
    </div>`;
  tableContainer.parentElement?.insertBefore(toolbar, tableContainer);

  const empty = document.createElement('div');
  empty.id = 'usuarios-archivo-empty';
  empty.className = 'mb-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500';
  empty.style.display = 'none';
  tableContainer.parentElement?.insertBefore(empty, tableContainer);

  toolbar.addEventListener('click', (event) => {
    const button = event.target.closest('[data-user-view]');
    if (!button) return;
    root.dataset.userListView = button.dataset.userView;
    applyCurrentFilter(root);
  });
}

function hideLegacyActiveCheckbox(root) {
  const checkbox = root.querySelector('#usuario-activo');
  if (!checkbox) return;
  checkbox.checked = true;
  const group = checkbox.closest('.form-group');
  if (group) group.style.display = 'none';
}

async function auditLifecycle(action, targetId, targetName) {
  try {
    const actor = await getActorContext();
    if (!actor?.hotel_id) return;
    const actionMap = {
      archive: 'RETIRAR_USUARIO',
      reactivate: 'REACTIVAR_USUARIO',
      delete: 'ELIMINAR_USUARIO_SIN_HISTORIAL'
    };
    await registrarAccionSensible({
      supabase,
      hotelId: actor.hotel_id,
      usuarioId: actor.id,
      modulo: 'Usuarios',
      accion: actionMap[action] || 'GESTIONAR_USUARIO',
      detalles: { usuario_id_objetivo: targetId, usuario_objetivo: targetName }
    });
  } catch (error) {
    console.warn('[Usuarios archivo] No se pudo registrar auditoría adicional:', error);
  }
}

async function confirmArchive(name) {
  if (globalThis.Swal?.fire) {
    const result = await Swal.fire({
      title: `Retirar a ${name}`,
      html: 'Perderá el acceso al sistema y pasará a <strong>Archivados</strong>. Su historial operativo se conservará.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sí, retirar empleado',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#d97706'
    });
    return result.isConfirmed;
  }
  return window.confirm(`¿Retirar a ${name}? Su historial se conservará.`);
}

async function confirmReactivate(name) {
  if (globalThis.Swal?.fire) {
    const result = await Swal.fire({
      title: `Reactivar a ${name}`,
      text: 'El usuario recuperará el acceso al sistema con sus roles y permisos actuales.',
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sí, reactivar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a'
    });
    return result.isConfirmed;
  }
  return window.confirm(`¿Reactivar a ${name}?`);
}

function rowName(row) {
  return row.children?.[0]?.textContent?.trim() || 'este usuario';
}

async function handleLifecycleClick(root, event) {
  const button = event.target.closest('#tabla-usuarios-body button[data-accion]');
  if (!button || !root.contains(button)) return;
  const action = button.dataset.accion;
  if (!['toggle-activo', 'eliminar'].includes(action)) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  const row = button.closest('tr[data-usuario-id]');
  if (!row) return;
  const userId = button.dataset.id || row.dataset.usuarioId;
  const name = button.dataset.nombre || rowName(row);
  const active = row.dataset.lifecycleStatus === 'active';

  try {
    button.disabled = true;
    if (action === 'toggle-activo') {
      if (active) {
        if (!(await confirmArchive(name))) return;
        await invokeLifecycle('archive', userId);
        setRowState(row, false);
        await auditLifecycle('archive', userId, name);
        if (globalThis.Swal?.fire) await Swal.fire({ icon: 'success', title: 'Empleado retirado', text: 'Quedó archivado y sin acceso al sistema.', timer: 1800, showConfirmButton: false });
      } else {
        if (!(await confirmReactivate(name))) return;
        await invokeLifecycle('reactivate', userId);
        setRowState(row, true);
        await auditLifecycle('reactivate', userId, name);
        if (globalThis.Swal?.fire) await Swal.fire({ icon: 'success', title: 'Usuario reactivado', timer: 1600, showConfirmButton: false });
      }
      applyCurrentFilter(root);
      return;
    }

    if (active) return;
    const confirmed = await confirmDestructiveAction({
      title: `Eliminar definitivamente a ${name}`,
      html: 'Solo se permitirá si esta cuenta <strong>nunca tuvo actividad operativa</strong>. Si existe historial, el servidor bloqueará la eliminación.',
      keyword: 'ELIMINAR',
      confirmButtonText: 'Eliminar definitivamente'
    });
    if (!confirmed) return;

    await invokeLifecycle('delete', userId);
    row.remove();
    await auditLifecycle('delete', userId, name);
    applyCurrentFilter(root);
    if (globalThis.Swal?.fire) await Swal.fire({ icon: 'success', title: 'Usuario eliminado', text: 'La cuenta no tenía historial operativo.', timer: 1800, showConfirmButton: false });
  } catch (error) {
    const message = error?.code === 'USER_HAS_HISTORY'
      ? 'Este empleado tiene historial operativo. Se mantendrá archivado para conservar la trazabilidad del hotel.'
      : (error?.message || 'No se pudo completar la operación.');
    if (globalThis.Swal?.fire) {
      await Swal.fire({ icon: error?.code === 'USER_HAS_HISTORY' ? 'info' : 'error', title: error?.code === 'USER_HAS_HISTORY' ? 'Debe permanecer archivado' : 'No se pudo completar', text: message });
    } else {
      alert(message);
    }
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}

function enhanceUsersModule(root) {
  if (!root || root.hasAttribute(ENHANCED_ATTR)) return;
  const tbody = root.querySelector('#tabla-usuarios-body');
  if (!tbody) return;
  root.setAttribute(ENHANCED_ATTR, 'true');
  root.dataset.userListView = 'active';

  const title = [...root.querySelectorAll('h3')].find((el) => normalizeText(el.textContent).includes('usuarios registrados'));
  if (title) title.textContent = '👥 Personal del hotel';

  hideLegacyActiveCheckbox(root);
  installToolbar(root);
  decorateRows(root);

  root.addEventListener('click', (event) => handleLifecycleClick(root, event), true);
  const tableObserver = new MutationObserver(() => decorateRows(root));
  tableObserver.observe(tbody, { childList: true });
}

function scan() {
  document.querySelectorAll('.usuarios-module').forEach(enhanceUsersModule);
}

const observer = new MutationObserver(scan);
observer.observe(document.documentElement, { childList: true, subtree: true });
scan();
