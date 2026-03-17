import { showError } from '../../uiUtils.js';
import { tiendaState } from './state.js';
import { closeModal, getModalContainerEl, getTabContentEl } from './helpers.js';

export async function renderCategorias() {
  const cont = getTabContentEl();
  if (!cont) return;

  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
      <h3 style="color:#1d4ed8;font-size:1.4em;font-weight:bold;letter-spacing:.5px;margin:0;">Categorias de Productos</h3>
      <button id="btnNuevaCategoria"
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
      >+ Agregar Categoria</button>
    </div>

    <div style="overflow-x:auto;background:#fff;border-radius:10px;box-shadow:0 2px 16px #0001;">
      <table style="width:100%;font-size:1em;border-collapse:collapse;overflow:hidden;">
        <thead>
          <tr style="background:#f1f5f9;color:#222;">
            <th style="padding:13px 10px;text-align:left;">Nombre</th>
            <th style="padding:13px 10px;text-align:left;">Descripcion</th>
            <th style="padding:13px 10px;text-align:center;">Estado</th>
            <th style="padding:13px 10px;text-align:center;">Acciones</th>
          </tr>
        </thead>
        <tbody id="bodyCategorias"></tbody>
      </table>
    </div>
  `;

  document.getElementById('btnNuevaCategoria').onclick = () => showModalCategoria();
  await cargarCategorias();
  renderTablaCategorias();
}

export async function cargarCategorias() {
  const { data } = await tiendaState.currentSupabase
    .from('categorias_producto')
    .select('*')
    .eq('hotel_id', tiendaState.currentHotelId);

  tiendaState.categorias.lista = data || [];
}

export function renderTablaCategorias() {
  const tbody = document.getElementById('bodyCategorias');
  if (!tbody) return;

  tbody.innerHTML = '';
  tiendaState.categorias.lista.forEach((cat) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="padding:12px 10px;font-weight:500;color:#1e293b;">${cat.nombre}</td>
      <td style="padding:12px 10px;color:#475569;">
        ${cat.descripcion || '<span style="color:#aaa;">Sin descripcion</span>'}
      </td>
      <td style="padding:12px 0;text-align:center;">
        <span style="
          display:inline-block;
          padding:4px 14px;
          border-radius:16px;
          font-size:0.93em;
          font-weight:600;
          ${cat.activa ? 'background:#dcfce7;color:#15803d;' : 'background:#fee2e2;color:#b91c1c;'}
        ">
          ${cat.activa ? 'Activa' : 'Inactiva'}
        </span>
      </td>
      <td style="padding:12px 0;text-align:center;">
        <button onclick="window.showModalCategoria('${cat.id}')"
          title="Editar"
          style="background:#e0e7ff;border:none;border-radius:5px;padding:6px 12px;margin-right:5px;font-size:1em;cursor:pointer;"
        >Editar</button>
        <button onclick="window.toggleEstadoCategoria('${cat.id}',${!cat.activa})"
          title="${cat.activa ? 'Desactivar' : 'Activar'}"
          style="background:${cat.activa ? '#fee2e2' : '#dcfce7'};border:none;border-radius:5px;padding:6px 12px;font-size:1em;cursor:pointer;"
        >
          ${cat.activa ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

export async function showModalCategoria(categoriaId = null) {
  const modalContainer = getModalContainerEl();
  if (!modalContainer) return;

  const cat = categoriaId ? tiendaState.categorias.lista.find((item) => item.id === categoriaId) : null;
  const esEdicion = Boolean(cat);

  modalContainer.style.display = 'flex';
  modalContainer.innerHTML = `
    <div style="background:#fff; border-radius:18px; box-shadow:0 8px 40px #1d4ed828; max-width:430px; width:95vw; margin:auto; padding:34px 26px 22px 26px; position:relative; font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
      <button onclick="window.closeModal()" style="position:absolute; right:14px; top:10px; background:none; border:none; font-size:25px; color:#64748b; cursor:pointer;" title="Cerrar">&times;</button>
      <h2 style="margin-bottom:19px; text-align:center; font-size:1.22rem; font-weight:700; color:#1d4ed8;">
        ${esEdicion ? 'Editar' : 'Nueva'} Categoria
      </h2>
      <form id="formCategoria" autocomplete="off" class="space-y-4">
        <div>
          <label>Nombre de la Categoria*</label>
          <input id="catNombre" required value="${cat?.nombre || ''}" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">
        </div>
        <div>
          <label>Descripcion (Opcional)</label>
          <textarea id="catDescripcion" rows="3" style="width:100%;padding:8px 11px;margin-top:2px;border:1.5px solid #cbd5e1;border-radius:6px;">${cat?.descripcion || ''}</textarea>
        </div>
        <div style="margin-top:23px;display:flex;gap:14px;justify-content:flex-end;">
          <button type="button" onclick="window.closeModal()" class="button button-neutral py-2 px-5">Cancelar</button>
          <button id="btnGuardarCategoria" type="submit" class="button button-primary py-2 px-5">${esEdicion ? 'Actualizar' : 'Crear'}</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('formCategoria').onsubmit = (event) => {
    event.preventDefault();
    saveCategoria(categoriaId);
  };
}

export async function saveCategoria(categoriaId) {
  const btnGuardar = document.getElementById('btnGuardarCategoria');
  if (btnGuardar) btnGuardar.disabled = true;

  try {
    const datos = {
      hotel_id: tiendaState.currentHotelId,
      nombre: document.getElementById('catNombre').value,
      descripcion: document.getElementById('catDescripcion').value,
      activa: true,
      actualizado_en: new Date().toISOString(),
    };

    if (categoriaId) {
      const { error } = await tiendaState.currentSupabase
        .from('categorias_producto')
        .update(datos)
        .eq('id', categoriaId);
      if (error) throw error;
    } else {
      datos.creado_en = new Date().toISOString();
      const { error } = await tiendaState.currentSupabase
        .from('categorias_producto')
        .insert([datos]);
      if (error) throw error;
    }

    closeModal();
    await cargarCategorias();
    renderTablaCategorias();
  } catch (error) {
    let mensajeUsuario = 'Ocurrio un error al guardar la categoria.';
    if (error.message.includes('categorias_producto_hotel_id_nombre_key')) {
      mensajeUsuario = 'Error: Ya existe una categoria con este nombre. Usa un nombre unico.';
    } else {
      mensajeUsuario = `Error al guardar: ${error.message}`;
    }
    showError(null, mensajeUsuario);
  } finally {
    if (btnGuardar) btnGuardar.disabled = false;
  }
}

export async function toggleEstadoCategoria(id, activa) {
  await tiendaState.currentSupabase
    .from('categorias_producto')
    .update({ activa })
    .eq('id', id);

  await cargarCategorias();
  renderTablaCategorias();
}
