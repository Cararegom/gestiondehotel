import { showError } from '../../uiUtils.js';
import { tiendaState } from './state.js';
import { closeModal, getModalContainerEl, getTabContentEl } from './helpers.js';

export async function renderProveedores() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <h3 style="color:#1d4ed8;font-size:1.3em;font-weight:bold;letter-spacing:.5px;margin:0;">Proveedores</h3>
      <button id="btnNuevoProveedor"
        style="
          background:linear-gradient(90deg,#22c55e,#1d4ed8);
          color:#fff;padding:10px 20px;
          border:none;
          border-radius:7px;
          font-size:1em;
          font-weight:600;
          box-shadow:0 1px 8px #1d4ed820;
          cursor:pointer;
        "
      >+ Agregar Proveedor</button>
    </div>

    <div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
      <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
        <thead>
          <tr style="background:#f1f5f9;color:#222;">
            <th style="padding:13px 10px;text-align:left;">Nombre</th>
            <th style="padding:13px 10px;text-align:left;">Contacto</th>
            <th style="padding:13px 10px;text-align:center;">Telefono</th>
            <th style="padding:13px 10px;text-align:left;">Email</th>
            <th style="padding:13px 10px;text-align:center;">NIT</th>
            <th style="padding:13px 10px;text-align:center;">Estado</th>
            <th style="padding:13px 10px;text-align:center;">Acciones</th>
          </tr>
        </thead>
        <tbody id="bodyProveedores"></tbody>
      </table>
    </div>
  `;

  document.getElementById('btnNuevoProveedor').onclick = () => showModalProveedor();
  await cargarProveedores();
  renderTablaProveedores();
}

export async function cargarProveedores() {
  if (!tiendaState.currentHotelId) {
    tiendaState.proveedores.lista = [];
    return;
  }

  const { data, error } = await tiendaState.currentSupabase
    .from('proveedores')
    .select('*')
    .eq('hotel_id', tiendaState.currentHotelId);

  if (error) {
    console.error('[Proveedores] Error cargando proveedores:', error);
    tiendaState.proveedores.lista = [];
    return;
  }

  tiendaState.proveedores.lista = data || [];
}

export function renderTablaProveedores() {
  const tbody = document.getElementById('bodyProveedores');
  if (!tbody) return;

  if (!tiendaState.proveedores.lista.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:18px;text-align:center;color:#64748b;">No hay proveedores registrados.</td></tr>';
    return;
  }

  tbody.innerHTML = tiendaState.proveedores.lista.map((pr) => `
    <tr>
      <td style="padding:12px 10px;font-weight:600;color:#1e293b;">${pr.nombre || 'N/A'}</td>
      <td style="padding:12px 10px;color:#475569;">${pr.contacto || 'N/A'}</td>
      <td style="padding:12px 10px;text-align:center;color:#475569;">${pr.telefono || 'N/A'}</td>
      <td style="padding:12px 10px;color:#475569;">${pr.email || 'N/A'}</td>
      <td style="padding:12px 10px;text-align:center;color:#475569;">${pr.nit || 'N/A'}</td>
      <td style="padding:12px 10px;text-align:center;">
        <span style="display:inline-block;padding:4px 14px;border-radius:16px;font-size:0.93em;font-weight:600;${pr.activo ? 'background:#dcfce7;color:#15803d;' : 'background:#fee2e2;color:#b91c1c;'}">
          ${pr.activo ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td style="padding:12px 10px;text-align:center;">
        <button onclick="window.showModalProveedor('${pr.id}')" style="background:#e0e7ff;border:none;border-radius:5px;padding:6px 12px;margin-right:5px;font-size:1em;cursor:pointer;">Editar</button>
        <button onclick="window.toggleEstadoProveedor('${pr.id}',${!pr.activo})" style="background:${pr.activo ? '#fee2e2' : '#dcfce7'};border:none;border-radius:5px;padding:6px 12px;font-size:1em;cursor:pointer;">
          ${pr.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>
  `).join('');
}

export async function showModalProveedor(proveedorId = null) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  const proveedor = proveedorId
    ? tiendaState.proveedores.lista.find((item) => item.id === proveedorId) || null
    : null;

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff; border-radius:18px; box-shadow:0 8px 40px #1d4ed828; max-width:500px; width:95vw; margin:auto; padding:34px 26px 22px 26px; position:relative; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <button onclick="window.closeModal()" style="position:absolute; right:14px; top:10px; background:none; border:none; font-size:25px; color:#64748b; cursor:pointer;" title="Cerrar">&times;</button>
      <h2 style="margin-bottom:19px; text-align:center; font-size:1.22rem; font-weight:700; color:#1d4ed8;">
        ${proveedor ? 'Editar' : 'Nuevo'} Proveedor
      </h2>
      <form id="formProveedor" autocomplete="off">
        <div style="display:grid;gap:12px;">
          <div>
            <label>Nombre del proveedor*</label>
            <input id="provNombre" required value="${proveedor?.nombre || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          </div>
          <div>
            <label>Contacto</label>
            <input id="provContacto" value="${proveedor?.contacto || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          </div>
          <div>
            <label>Telefono</label>
            <input id="provTelefono" value="${proveedor?.telefono || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          </div>
          <div>
            <label>Email</label>
            <input id="provEmail" value="${proveedor?.email || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          </div>
          <div>
            <label>NIT</label>
            <input id="provNit" value="${proveedor?.nit || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
          </div>
        </div>
        <div style="margin-top:23px;display:flex;gap:14px;justify-content:flex-end;">
          <button type="button" onclick="window.closeModal()" class="button button-neutral py-2 px-5">Cancelar</button>
          <button id="btnGuardarProveedor" type="submit" class="button button-primary py-2 px-5">${proveedor ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('formProveedor').onsubmit = (event) => {
    event.preventDefault();
    saveProveedor(proveedorId);
  };
}

export async function saveProveedor(proveedorId) {
  const btnGuardar = document.getElementById('btnGuardarProveedor');
  if (btnGuardar) btnGuardar.disabled = true;

  try {
    const nombre = document.getElementById('provNombre').value.trim();
    if (!nombre) {
      showError(null, 'El nombre del proveedor es obligatorio.');
      return;
    }

    const datos = {
      hotel_id: tiendaState.currentHotelId,
      nombre,
      contacto: document.getElementById('provContacto').value,
      telefono: document.getElementById('provTelefono').value,
      email: document.getElementById('provEmail').value,
      nit: document.getElementById('provNit').value,
      activo: true,
      actualizado_en: new Date().toISOString(),
    };

    if (proveedorId) {
      const { error } = await tiendaState.currentSupabase
        .from('proveedores')
        .update(datos)
        .eq('id', proveedorId);
      if (error) throw error;
    } else {
      datos.creado_en = new Date().toISOString();
      const { error } = await tiendaState.currentSupabase
        .from('proveedores')
        .insert([datos]);
      if (error) throw error;
    }

    closeModal();
    await cargarProveedores();
    renderTablaProveedores();
  } catch (error) {
    let mensajeUsuario = `Error al guardar: ${error.message}`;
    if (error.message.includes('proveedores_hotel_id_nombre_key')) {
      mensajeUsuario = 'Error: Ya existe un proveedor con este nombre. Usa un nombre unico.';
    }
    showError(null, mensajeUsuario);
  } finally {
    if (btnGuardar) btnGuardar.disabled = false;
  }
}

export async function toggleEstadoProveedor(id, activo) {
  const { error } = await tiendaState.currentSupabase
    .from('proveedores')
    .update({ activo, actualizado_en: new Date().toISOString() })
    .eq('id', id);

  if (error) {
    showError(null, `No se pudo actualizar el proveedor: ${error.message}`);
    return;
  }

  await cargarProveedores();
  renderTablaProveedores();
}
