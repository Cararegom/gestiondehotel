// js/modules/clientes/clientes.js
import { showError, showSuccess, showLoading, clearFeedback, formatCurrency, formatDateTime } from '../../uiUtils.js';

let supabase = null;
let hotelId = null;
let user = null;
let clientesData = [];
let currentChart = null;

export async function mount(container, supabaseInstance, userObject, hotelIdActual) {
    supabase = supabaseInstance;
    user = userObject;
    hotelId = hotelIdActual;

    container.innerHTML = `
      <div class="card">
        <div class="card-header flex justify-between items-center">
          <h2 class="text-xl font-bold">Clientes & CRM</h2>
          <button id="btn-nuevo-cliente" class="button button-primary">＋ Nuevo Cliente</button>
        </div>
        <div class="card-body">
          <div class="flex flex-col md:flex-row mb-4 gap-2">
            <input id="buscar-cliente" class="form-control flex-1" type="text" placeholder="Buscar por nombre, email, documento o teléfono">
            <input id="filtro-fecha-inicio" type="date" class="form-control" style="max-width:160px;">
            <input id="filtro-fecha-fin" type="date" class="form-control" style="max-width:160px;">
            <button id="btn-filtrar-fechas" class="button button-secondary">Filtrar</button>
            <button id="btn-exportar-clientes" class="button button-accent">Exportar Excel</button>
          </div>
          <div id="clientes-feedback"></div>
          <div id="clientes-table-wrapper"></div>
        </div>
      </div>
      <div id="modal-container"></div>
    `;

    // Listeners
    container.querySelector('#btn-nuevo-cliente').onclick = () => mostrarFormularioCliente();
    container.querySelector('#buscar-cliente').oninput = (e) => filtrarTabla(e.target.value);
    container.querySelector('#btn-exportar-clientes').onclick = exportarExcel;
    container.querySelector('#btn-filtrar-fechas').onclick = filtrarPorFechas;

    await cargarYRenderizarClientes();
}

export function unmount(container) {
    // Limpieza si es necesario (charts, listeners globales, etc)
    if (currentChart) { currentChart.destroy(); currentChart = null; }
}

async function cargarYRenderizarClientes({ filtro = '', fechaInicio = '', fechaFin = '' } = {}) {
    const feedbackEl = document.getElementById('clientes-feedback');
    showLoading(feedbackEl, 'Cargando clientes...');
    try {
        let query = supabase.from('clientes').select('*').eq('hotel_id', hotelId);
        if (filtro) query = query.ilike('nombre', `%${filtro}%`);
        if (fechaInicio) query = query.gte('fecha_creado', fechaInicio + 'T00:00:00');
        if (fechaFin) query = query.lte('fecha_creado', fechaFin + 'T23:59:59');
        let { data, error } = await query.order('fecha_creado', { ascending: false });
        if (error) throw error;
        clientesData = data || [];
        renderTablaClientes(clientesData);
        clearFeedback(feedbackEl);
        console.log('[Clientes] Lista cargada:', clientesData.length);
    } catch (error) {
        showError(feedbackEl, 'Error al cargar clientes: ' + error.message);
        console.error('[Clientes] Error cargarYRenderizarClientes:', error);
    }
}

function renderTablaClientes(clientes) {
    const wrapper = document.getElementById('clientes-table-wrapper');
    if (!clientes.length) {
        wrapper.innerHTML = `<div class="text-center text-gray-500 p-6">No hay clientes registrados.</div>`;
        return;
    }
    wrapper.innerHTML = `
      <table class="table">
        <thead>
          <tr>
            <th>Nombre</th>
            <th>Documento</th>
            <th>Email</th>
            <th>Teléfono</th>
            <th>Registrado</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${clientes.map(cli => `
            <tr>
              <td>${cli.nombre || ''}</td>
              <td>${cli.documento || ''}</td>
              <td>${cli.email || ''}</td>
              <td>${cli.telefono || ''}</td>
              <td>${cli.fecha_creado ? formatDateTime(cli.fecha_creado, 'es-CO', { dateStyle: 'short' }) : ''}</td>
              <td>
                <button class="button button-accent" data-id="${cli.id}" data-action="ver">Ver</button>
                <button class="button button-primary" data-id="${cli.id}" data-action="editar">Editar</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    wrapper.querySelectorAll('button[data-action="ver"]').forEach(btn => {
        btn.onclick = () => mostrarVistaCliente(btn.dataset.id);
    });
    wrapper.querySelectorAll('button[data-action="editar"]').forEach(btn => {
        btn.onclick = () => mostrarFormularioCliente(btn.dataset.id);
    });
}

function filtrarTabla(texto) {
    texto = (texto || '').toLowerCase();
    const filtrados = clientesData.filter(c =>
        (c.nombre || '').toLowerCase().includes(texto) ||
        (c.email || '').toLowerCase().includes(texto) ||
        (c.documento || '').toLowerCase().includes(texto) ||
        (c.telefono || '').toLowerCase().includes(texto)
    );
    renderTablaClientes(filtrados);
}

function filtrarPorFechas() {
    const inicio = document.getElementById('filtro-fecha-inicio').value;
    const fin = document.getElementById('filtro-fecha-fin').value;
    cargarYRenderizarClientes({ fechaInicio: inicio, fechaFin: fin });
}

function exportarExcel() {
    if (typeof XLSX === "undefined") return alert('SheetJS/XLSX no está cargado.');
    const ws = XLSX.utils.json_to_sheet(clientesData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Clientes");
    XLSX.writeFile(wb, "clientes.xlsx");
}

// ========== MODAL FORMULARIO CLIENTE ==========
function mostrarFormularioCliente(clienteId = null, { afterSave } = {}) {
    let cliente = clienteId ? clientesData.find(c => c.id === clienteId) : {};
    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-container bg-white rounded-xl shadow-2xl p-6 max-w-lg mx-auto mt-12 relative z-50">
        <h3 class="text-2xl font-bold mb-4">${clienteId ? 'Editar Cliente' : 'Registrar Cliente'}</h3>
        <form id="form-cliente">
          <div class="form-group"><label>Nombre *</label>
            <input class="form-control" name="nombre" required value="${cliente?.nombre || ''}"></div>
          <div class="form-group"><label>Documento</label>
            <input class="form-control" name="documento" value="${cliente?.documento || ''}"></div>
          <div class="form-group"><label>Email</label>
            <input class="form-control" name="email" type="email" value="${cliente?.email || ''}"></div>
          <div class="form-group"><label>Teléfono</label>
            <input class="form-control" name="telefono" value="${cliente?.telefono || ''}"></div>
          <div class="form-group"><label>Dirección</label>
            <input class="form-control" name="direccion" value="${cliente?.direccion || ''}"></div>
          <div class="form-group"><label>Fecha de nacimiento</label>
            <input class="form-control" name="fecha_nacimiento" type="date" value="${cliente?.fecha_nacimiento ? cliente.fecha_nacimiento.substr(0, 10) : ''}"></div>
          <div class="form-group"><label>Notas</label>
            <textarea class="form-control" name="notas">${cliente?.notas || ''}</textarea></div>
          <div id="feedback-form-cliente"></div>
          <div class="flex justify-end gap-2 mt-4">
            <button type="button" class="button button-neutral" id="btn-cancelar">Cancelar</button>
            <button type="submit" class="button button-success">${clienteId ? 'Guardar Cambios' : 'Registrar'}</button>
          </div>
        </form>
      </div>
    `;
    modal.style.display = 'block';
    modal.querySelector('#btn-cancelar').onclick = () => { modal.innerHTML = ''; modal.style.display = 'none'; };

    modal.querySelector('#form-cliente').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form));
        const feedback = document.getElementById('feedback-form-cliente');
        clearFeedback(feedback);
        if (!data.nombre) return showError(feedback, "El nombre es obligatorio");
        let resp;
        try {
            if (clienteId) {
                resp = await supabase.from('clientes').update(data).eq('id', clienteId);
            } else {
                resp = await supabase.from('clientes').insert([{ ...data, hotel_id: hotelId }]).select();
            }
            if (resp.error) throw resp.error;
            showSuccess(feedback, clienteId ? "Cambios guardados." : "Cliente registrado.");
            modal.innerHTML = '';
            modal.style.display = 'none';
            await cargarYRenderizarClientes();
            if (!clienteId && afterSave && resp.data && resp.data[0]) {
                afterSave(resp.data[0]);
            }
        } catch (err) {
            showError(feedback, "Error al guardar: " + (err?.message || err));
        }
    };
}

// ========== VISTA DETALLADA DEL CLIENTE (con PESTAÑAS) ==========
async function mostrarVistaCliente(clienteId) {
    const cliente = clientesData.find(c => c.id === clienteId);
    if (!cliente) return;

    const reservas = (await supabase.from('reservas').select('*').eq('cliente_id', clienteId)).data || [];
    const ventas = (await supabase.from('ventas').select('*').eq('cliente_id', clienteId)).data || [];
    const ventasTienda = (await supabase.from('ventas_tienda').select('*').eq('cliente_id', clienteId)).data || [];
    const ventasRestaurante = (await supabase.from('ventas_restaurante').select('*').eq('cliente_id', clienteId)).data || [];
    const actividades = (await supabase.from('crm_actividades').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })).data || [];

    // Sumatorias para la gráfica
    const sumVentas = ventas.reduce((s, v) => s + (Number(v.total) || 0), 0);
    const sumTienda = ventasTienda.reduce((s, v) => s + (Number(v.total_venta || v.total) || 0), 0);
    const sumRest = ventasRestaurante.reduce((s, v) => s + (Number(v.monto_total || v.total_venta || v.total) || 0), 0);

    const modal = document.getElementById('modal-container');
    modal.innerHTML = `
      <div class="modal-container bg-white rounded-xl shadow-2xl p-6 max-w-2xl mx-auto mt-12 relative z-50">
        <div class="flex flex-wrap gap-3 mb-4">
          <button class="button button-accent tab-btn" data-tab="datos">Datos</button>
          <button class="button button-secondary tab-btn" data-tab="visitas">Historial Visitas</button>
          <button class="button button-primary tab-btn" data-tab="gastos">Historial Gastos</button>
          <button class="button button-neutral tab-btn" data-tab="crm">Actividades CRM</button>
        </div>
        <div id="tab-content"></div>
        <div class="flex justify-between gap-2 mt-5">
          <button class="button button-success" id="btn-exportar-pdf">Exportar a PDF</button>
          <button class="button button-neutral" id="btn-cerrar-vista-cliente">Cerrar</button>
        </div>
      </div>
    `;
    modal.style.display = 'block';

    // PESTAÑAS
    const tabs = {
      datos: () => `
        <h3 class="text-xl font-bold mb-3">Datos Generales</h3>
        <div class="mb-2"><strong>Nombre:</strong> ${cliente.nombre || ''}</div>
        <div class="mb-2"><strong>Documento:</strong> ${cliente.documento || ''}</div>
        <div class="mb-2"><strong>Email:</strong> ${cliente.email || ''}</div>
        <div class="mb-2"><strong>Teléfono:</strong> ${cliente.telefono || ''}</div>
        <div class="mb-2"><strong>Dirección:</strong> ${cliente.direccion || ''}</div>
        <div class="mb-2"><strong>Fecha nacimiento:</strong> ${cliente.fecha_nacimiento || ''}</div>
        <div class="mb-2"><strong>Notas:</strong> ${cliente.notas || ''}</div>
        <div class="mb-2"><strong>Registrado:</strong> ${formatDateTime(cliente.fecha_creado, 'es-CO', { dateStyle: 'short', timeStyle: 'short' })}</div>
      `,
      visitas: () => `
        <h3 class="text-xl font-bold mb-3">Historial de Reservas</h3>
        <ul>
          ${(reservas.length > 0) ?
            reservas.map(r => `<li>${formatDateTime(r.fecha_checkin || r.fecha_inicio, 'es-CO', { dateStyle: 'short' })} - Habitación: ${r.habitacion_nombre || r.habitacion_id || ''}</li>`).join('')
            : '<li>No tiene reservas registradas.</li>'}
        </ul>
      `,
      gastos: () => `
        <h3 class="text-xl font-bold mb-3">Historial de Gastos</h3>
        <canvas id="grafica-gastos-cliente" height="80"></canvas>
        <ul class="mt-4">
          <li><strong>Total Consumos Generales:</strong> ${formatCurrency(sumVentas)}</li>
          <li><strong>Total Tienda:</strong> ${formatCurrency(sumTienda)}</li>
          <li><strong>Total Restaurante:</strong> ${formatCurrency(sumRest)}</li>
          <li><strong>Total Global:</strong> ${formatCurrency(sumVentas + sumTienda + sumRest)}</li>
        </ul>
      `,
      crm: () => `
        <h3 class="text-xl font-bold mb-3">Actividades CRM</h3>
        <ul id="lista-actividades-crm" class="mb-3">
          ${(actividades.length > 0) ?
            actividades.map(a => `
              <li class="mb-2 border-b pb-1">
                <b>${a.tipo}</b> (${a.estado || 'pendiente'}) 
                <span class="text-xs text-gray-400">${a.fecha ? formatDateTime(a.fecha) : ''}</span><br>
                <span class="text-gray-600">${a.descripcion || ''}</span>
              </li>
            `).join('')
            : '<li>No hay actividades CRM.</li>'}
        </ul>
        <form id="form-crm-actividad" class="mt-3 border-t pt-3">
          <label><b>Agregar Actividad CRM</b></label>
          <div class="flex gap-2 mb-2">
            <select name="tipo" class="form-control" required>
              <option value="">Tipo</option>
              <option>Llamada</option>
              <option>Email</option>
              <option>Nota</option>
              <option>Tarea</option>
              <option>WhatsApp</option>
              <option>Visita</option>
            </select>
            <select name="estado" class="form-control" required>
              <option value="pendiente">Pendiente</option>
              <option value="completada">Completada</option>
              <option value="reagendada">Reagendada</option>
            </select>
          </div>
          <textarea name="descripcion" class="form-control mb-2" required placeholder="Descripción"></textarea>
          <button type="submit" class="button button-success">Agregar Actividad</button>
        </form>
      `
    };

    // Inicializar con datos
    function renderTab(tab) {
        modal.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('bg-opacity-90', 'opacity-80'));
        modal.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('bg-opacity-90', 'opacity-80');
        modal.querySelector('#tab-content').innerHTML = tabs[tab]();
        if (tab === 'gastos') {
            setTimeout(() => renderGraficaGastos(sumVentas, sumTienda, sumRest), 80);
        }
        if (tab === 'crm') {
            modal.querySelector('#form-crm-actividad').onsubmit = async (e) => {
                e.preventDefault();
                const data = Object.fromEntries(new FormData(e.target));
                let nueva = { ...data, cliente_id: clienteId, hotel_id: hotelId, usuario_creador_id: user?.id, fecha: new Date().toISOString() };
                let { error } = await supabase.from('crm_actividades').insert([nueva]);
                if (error) return alert('Error al guardar actividad: ' + error.message);
                let act2 = (await supabase.from('crm_actividades').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })).data || [];
                modal.querySelector('#lista-actividades-crm').innerHTML = act2.map(a => `
                  <li class="mb-2 border-b pb-1"><b>${a.tipo}</b> (${a.estado || 'pendiente'}) <span class="text-xs text-gray-400">${a.fecha ? formatDateTime(a.fecha) : ''}</span><br>
                  <span class="text-gray-600">${a.descripcion || ''}</span></li>
                `).join('');
                e.target.reset();
            };
        }
    }

    // Eventos de pestañas
    modal.querySelectorAll('.tab-btn').forEach(btn => {
        btn.onclick = () => renderTab(btn.dataset.tab);
    });
    renderTab('datos'); // Pestaña inicial

    // Exportar PDF
    modal.querySelector('#btn-exportar-pdf').onclick = () => exportarHistorialPDF(cliente, reservas, ventas, ventasTienda, ventasRestaurante, actividades);
    modal.querySelector('#btn-cerrar-vista-cliente').onclick = () => { modal.innerHTML = ''; modal.style.display = 'none'; };
}

function renderGraficaGastos(ventas, tienda, restaurante) {
    const ctx = document.getElementById('grafica-gastos-cliente');
    if (!ctx) return;
    if (currentChart) currentChart.destroy();
    currentChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Ventas', 'Tienda', 'Restaurante'],
            datasets: [{
                data: [ventas, tienda, restaurante],
                backgroundColor: ['#3b82f6', '#f59e0b', '#10b981'],
            }]
        },
        options: {
            responsive: true,
            plugins: { legend: { display: true, position: 'bottom' } }
        }
    });
}

// ========== EXPORTAR HISTORIAL INDIVIDUAL (PDF) ==========
function exportarHistorialPDF(cliente, reservas, ventas, ventasTienda, ventasRestaurante, actividades) {
    if (typeof html2pdf === "undefined") return alert('html2pdf.js no está cargado.');
    const pdfContent = document.createElement('div');
    pdfContent.innerHTML = `
      <h2>Historial de Cliente: ${cliente.nombre}</h2>
      <h4>Datos:</h4>
      <ul>
        <li><b>Documento:</b> ${cliente.documento || ''}</li>
        <li><b>Email:</b> ${cliente.email || ''}</li>
        <li><b>Teléfono:</b> ${cliente.telefono || ''}</li>
        <li><b>Dirección:</b> ${cliente.direccion || ''}</li>
        <li><b>Fecha nacimiento:</b> ${cliente.fecha_nacimiento || ''}</li>
        <li><b>Notas:</b> ${cliente.notas || ''}</li>
      </ul>
      <h4>Reservas:</h4>
      <ul>
        ${(reservas || []).map(r => `<li>${formatDateTime(r.fecha_checkin || r.fecha_inicio, 'es-CO', { dateStyle: 'short' })} - Habitación: ${r.habitacion_nombre || r.habitacion_id}</li>`).join('')}
      </ul>
      <h4>Ventas generales:</h4>
      <ul>
        ${(ventas || []).map(v => `<li>${formatDateTime(v.fecha_venta, 'es-CO', { dateStyle: 'short' })} - $${v.total}</li>`).join('')}
      </ul>
      <h4>Ventas Tienda:</h4>
      <ul>
        ${(ventasTienda || []).map(vt => `<li>${formatDateTime(vt.fecha, 'es-CO', { dateStyle: 'short' })} - $${vt.total_venta || vt.total}</li>`).join('')}
      </ul>
      <h4>Ventas Restaurante:</h4>
      <ul>
        ${(ventasRestaurante || []).map(vr => `<li>${formatDateTime(vr.fecha, 'es-CO', { dateStyle: 'short' })} - $${vr.monto_total || vr.total_venta || vr.total}</li>`).join('')}
      </ul>
      <h4>Actividades CRM:</h4>
      <ul>
        ${(actividades || []).map(a => `<li><b>${a.tipo}</b> (${a.estado || 'pendiente'}) - ${a.descripcion}</li>`).join('')}
      </ul>
    `;
    html2pdf().from(pdfContent).save(`Historial_${cliente.nombre || 'cliente'}.pdf`);
}

// ========== MODAL UNIVERSAL SELECTOR DE CLIENTE ==========
export async function showClienteSelectorModal({ onSelect, searchPlaceholder = "Buscar cliente..." } = {}) {
    let clientes = clientesData.length ? clientesData : await getClientes();
    const modal = document.getElementById('modal-container');
    function renderLista(filtrados) {
        return filtrados.map(cli => `
            <div class="p-2 border-b flex items-center gap-2 hover:bg-blue-50 cursor-pointer" data-id="${cli.id}">
                <span class="font-bold">${cli.nombre}</span>
                <span class="text-gray-500 text-xs">${cli.email || ''}</span>
                <span class="text-gray-400 text-xs">${cli.documento || ''}</span>
            </div>
        `).join('');
    }
    function setupListeners() {
        modal.querySelectorAll('div[data-id]').forEach(div => {
            div.onclick = () => {
                let cliente = clientes.find(c => c.id === div.dataset.id);
                if (onSelect) onSelect(cliente);
                modal.innerHTML = '';
                modal.style.display = 'none';
            };
        });
        modal.querySelector('#btn-crear-cliente').onclick = () => {
            modal.innerHTML = '';
            modal.style.display = 'none';
            mostrarFormularioCliente(null, { afterSave: (nuevoCliente) => { if (onSelect) onSelect(nuevoCliente); } });
        };
        modal.querySelector('#btn-cerrar-selector-cliente').onclick = () => {
            modal.innerHTML = '';
            modal.style.display = 'none';
        };
        modal.querySelector('#buscador-modal-clientes').oninput = (e) => {
            let txt = e.target.value.toLowerCase();
            let filtrados = clientes.filter(c =>
                (c.nombre || '').toLowerCase().includes(txt) ||
                (c.email || '').toLowerCase().includes(txt) ||
                (c.documento || '').toLowerCase().includes(txt)
            );
            modal.querySelector('#clientes-selector-list').innerHTML = renderLista(filtrados);
            setupListeners();
        };
    }
    modal.innerHTML = `
        <div class="modal-container bg-white rounded-xl shadow-2xl p-6 max-w-lg mx-auto mt-12 relative z-50">
            <h3 class="text-2xl font-bold mb-4">Seleccionar Cliente</h3>
            <input id="buscador-modal-clientes" class="form-control mb-3" placeholder="${searchPlaceholder}">
            <div id="clientes-selector-list" style="max-height:340px; overflow-y:auto;">
                ${renderLista(clientes)}
            </div>
            <div class="flex justify-between mt-4 gap-2">
                <button class="button button-success" id="btn-crear-cliente">＋ Nuevo Cliente</button>
                <button class="button button-neutral" id="btn-cerrar-selector-cliente">Cancelar</button>
            </div>
        </div>
    `;
    modal.style.display = 'block';
    setupListeners();
}

// ========== API PARA OTROS MÓDULOS ==========
export async function getClientes({ hotelId: id, search = '' } = {}) {
    try {
        let query = supabase.from('clientes').select('*');
        if (id || hotelId) query = query.eq('hotel_id', id || hotelId);
        if (search) query = query.ilike('nombre', `%${search}%`);
        let { data, error } = await query.order('fecha_creado', { ascending: false });
        if (error) {
            console.error('[Clientes] Error en getClientes:', error);
            return [];
        }
        return data || [];
    } catch (e) {
        console.error('[Clientes] Exception en getClientes:', e);
        return [];
    }
}

export async function getClienteById(clienteId) {
    try {
        let { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
        if (error) {
            console.error('[Clientes] Error en getClienteById:', error);
            return null;
        }
        return data;
    } catch (e) {
        console.error('[Clientes] Exception en getClienteById:', e);
        return null;
    }
}

// ========== ESTRUCTURA SUGERENCIAS IA (dummy) ==========
export function getIASuggestionsForClient(cliente) {
    // Esta función está preparada para integrar IA/fidelización, puedes llamar a tu endpoint o OpenAI aquí.
    // Ejemplo de dummy:
    return [
        { tipo: 'Descuento personalizado', mensaje: 'Ofrece un 10% de descuento en su próxima reserva.' },
        { tipo: 'Seguimiento', mensaje: 'Llama para agradecer su última estadía.' }
    ];
}
