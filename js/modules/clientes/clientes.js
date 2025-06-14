// js/modules/clientes/clientes.js

// Importaciones de utilidades UI
import { showError, showSuccess, showLoading, clearFeedback } from '../../uiUtils.js';

// NOTA IMPORTANTE sobre Chart.js y SheetJS:
// Si no estás usando un 'bundler' como Webpack o Vite que maneje las importaciones de npm,
// DEBES cargar estas librerías globalmente en tu index.html usando etiquetas <script>.
// Por ejemplo:
// <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
// <script src="https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js"></script>
// Si las has cargado globalmente, entonces no necesitas las líneas 'import' de aquí.
// Si las instalaste via npm (p.ej. 'npm install chart.js xlsx') y usas un bundler, entonces SÍ necesitas descomentar estas líneas:
// import Chart from 'chart.js/auto'; // Descomentar si usas un bundler
// import * as XLSX from 'xlsx';      // Descomentar si usas un bundler

// Variables globales para el módulo
let clientesData = [];
let hotelIdActual = null;
let supabaseInstance = null; // La instancia de Supabase será asignada aquí
let currentChartInstance = null; // Para mantener la instancia de Chart.js y poder destruirla

// --- FUNCIONES DE UTILIDAD Y AYUDA ---
function logDebug(message, ...args) {
    // console.log(`%c[Clientes Debug] ${message}`, 'color: #007bff;', ...args);
    // Descomenta la línea de arriba para ver logs de debug
}

function logError(message, ...args) {
    console.error(`%c[Clientes Error] ${message}`, 'color: #dc3545;', ...args);
}

/**
 * Formatea una cadena de fecha a formato de fecha local.
 * @param {string} dateString La cadena de fecha a formatear.
 * @returns {string} La fecha formateada o cadena vacía si no es válida.
 */
function formatDate(dateString) {
    if (!dateString) return '';
    try {
        const date = new Date(dateString);
        // Opciones para asegurar formato DD/MM/AAAA o similar
        return date.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
        logError('Error formateando fecha:', e, dateString);
        return dateString; // Retorna la original si hay error
    }
}

/**
 * Formatea un monto numérico a formato de moneda (COP).
 * @param {number} amount El monto a formatear.
 * @returns {string} El monto formateado como moneda.
 */
function formatCurrency(amount) {
    // Asegura que el monto sea un número antes de formatear
    const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (isNaN(numAmount)) {
        logError('Monto inválido para formatear como moneda:', amount);
        return 'N/A';
    }
    return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' }).format(numAmount);
}

// --- MONTAJE Y DESMONTAJE DEL MÓDULO PRINCIPAL ---

/**
 * Inicializa el módulo de clientes, monta la interfaz de usuario y carga los datos iniciales.
 * Esta función es el punto de entrada para el módulo SPA.
 * @param {HTMLElement} container El elemento DOM donde se montará el módulo.
 * @param {object} supabase La instancia del cliente de Supabase.
 * @param {object} user El objeto de usuario autenticado (puede ser null).
 * @param {string} hotelId El ID del hotel actualmente autenticado.
 * @param {object} opts Parámetros opcionales.
 */
export async function mount(container, supabase, user, hotelId, opts = {}) {
    logDebug('Montando módulo de clientes...', { container, user, hotelId, opts });
    hotelIdActual = hotelId;
    supabaseInstance = supabase; // Se recibe la instancia de Supabase desde main.js
    console.log("DEBUG: supabaseInstance en clientes.js mount:", supabaseInstance); // Para depuración

    // Limpia el contenedor y renderiza la estructura base del módulo
    container.innerHTML = `
        <div class="card bg-white shadow-lg rounded-lg overflow-hidden">
            <div class="card-header p-4 bg-gray-100 border-b flex justify-between items-center">
                <h2 class="text-2xl font-semibold text-gray-800">Clientes & CRM</h2>
                <button id="btn-nuevo-cliente" class="button button-primary bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors duration-200">＋ Nuevo Cliente</button>
            </div>
            <div class="card-body p-4">
                <div class="flex flex-wrap items-center mb-4 gap-3">
                    <input id="buscar-cliente" class="form-control flex-grow p-2 border border-gray-300 rounded-md focus:ring focus:ring-blue-200" type="text" placeholder="Buscar por nombre, email, documento o teléfono">
                    <input type="date" id="filtro-fecha-inicio" class="form-control p-2 border border-gray-300 rounded-md">
                    <input type="date" id="filtro-fecha-fin" class="form-control p-2 border border-gray-300 rounded-md">
                    <button id="btn-aplicar-filtro-fechas" class="button button-info bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md transition-colors duration-200">Filtrar por Fecha</button>
                    <button id="btn-limpiar-filtro-fechas" class="button button-neutral bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-md transition-colors duration-200">Limpiar Filtro</button>
                    <button id="btn-exportar-clientes" class="button button-secondary bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md transition-colors duration-200">Exportar Excel</button>
                </div>
                <div id="clientes-feedback" class="mb-4 text-center"></div>
                <div id="clientes-table-wrapper" class="overflow-x-auto">
                    </div>
            </div>
        </div>
        <div id="modal-container" class="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50 hidden"></div>
    `;

    // Cargar y renderizar la lista inicial de clientes
    await cargarYRenderizarClientes();
    // Configurar los listeners de eventos para los elementos de la UI
    setupEventListeners(container);
    // Limpiar cualquier mensaje de feedback residual
    clearFeedback(container.querySelector('#clientes-feedback'));
    logDebug('Módulo de clientes montado exitosamente.');
}

/**
 * Limpia el módulo cuando es desmontado.
 * Destruye la instancia del gráfico si existe para evitar fugas de memoria.
 * @param {HTMLElement} container El elemento DOM donde el módulo fue montado.
 */
export function unmount(container) {
    logDebug('Desmontando módulo de clientes...');
    if (currentChartInstance) {
        currentChartInstance.destroy(); // Destruir la instancia del gráfico
        currentChartInstance = null;
    }
    container.innerHTML = ''; // Limpiar el contenido del contenedor
    // Restablecer variables globales
    hotelIdActual = null;
    supabaseInstance = null; // Asegurarse de limpiar la referencia de Supabase
    clientesData = [];
    logDebug('Módulo de clientes desmontado.');
}

/**
 * Configura los escuchadores de eventos para los elementos principales del módulo.
 * @param {HTMLElement} container El contenedor del módulo.
 */
function setupEventListeners(container) {
    container.querySelector('#btn-nuevo-cliente').onclick = () => mostrarFormularioCliente(null, supabaseInstance, hotelIdActual);
    container.querySelector('#buscar-cliente').oninput = (e) => filtrarTabla(e.target.value, getFechaFiltro());
    container.querySelector('#btn-exportar-clientes').onclick = exportarExcel;

    // Listeners para los filtros de fecha
    container.querySelector('#filtro-fecha-inicio').onchange = (e) => filtrarTabla(container.querySelector('#buscar-cliente').value, getFechaFiltro());
    container.querySelector('#filtro-fecha-fin').onchange = (e) => filtrarTabla(container.querySelector('#buscar-cliente').value, getFechaFiltro());
    container.querySelector('#btn-aplicar-filtro-fechas').onclick = () => filtrarTabla(container.querySelector('#buscar-cliente').value, getFechaFiltro());
    container.querySelector('#btn-limpiar-filtro-fechas').onclick = () => {
        container.querySelector('#filtro-fecha-inicio').value = '';
        container.querySelector('#filtro-fecha-fin').value = '';
        filtrarTabla(container.querySelector('#buscar-cliente').value, getFechaFiltro());
    };
    logDebug('Escuchadores de eventos principales configurados.');
}

/**
 * Obtiene los valores de los filtros de fecha.
 * @returns {object} Un objeto con las fechas de inicio y fin.
 */
function getFechaFiltro() {
    const fechaInicio = document.getElementById('filtro-fecha-inicio').value;
    const fechaFin = document.getElementById('filtro-fecha-fin').value;
    return { inicio: fechaInicio, fin: fechaFin };
}

// --- OPERACIONES DE DATOS CON SUPABASE ---

/**
 * Obtiene todos los clientes para el hotel actual, con opciones de búsqueda y filtrado por rango de fechas.
 * @param {object} params - Objeto que contiene hotelId, cadena de búsqueda y rango de fechas.
 * @returns {Array} Un array de objetos de cliente.
 */
export async function getClientes({ hotelId, search = '', dateRange = {} } = {}) {
    logDebug('Obteniendo clientes con parámetros:', { hotelId, search, dateRange });
    try {
        // VERIFICACIÓN CRÍTICA: Asegurarse de que supabaseInstance sea válido aquí.
        if (!supabaseInstance) {
            logError('Supabase instance no está inicializada en getClientes (después del mount).');
            throw new Error('Supabase no está disponible para operaciones de clientes.');
        }

        let query = supabaseInstance.from('clientes').select('*');
        if (hotelId || hotelIdActual) {
            query = query.eq('hotel_id', hotelId || hotelIdActual);
        }

        if (search) {
            const searchLower = search.toLowerCase();
            query = query.or(`nombre.ilike.%${searchLower}%,email.ilike.%${searchLower}%,documento.ilike.%${searchLower}%,telefono.ilike.%${searchLower}%`);
        }

        if (dateRange.inicio) {
            query = query.gte('fecha_creado', dateRange.inicio);
        }
        if (dateRange.fin) {
            // Añadir un día a la fecha fin para incluir todos los registros de ese día
            const endDatePlusOne = new Date(dateRange.fin);
            endDatePlusOne.setDate(endDatePlusOne.getDate() + 1);
            query = query.lt('fecha_creado', endDatePlusOne.toISOString().split('T')[0]);
        }

        let { data, error } = await query.order('fecha_creado', { ascending: false });

        if (error) {
            logError('Error al obtener clientes desde Supabase:', error);
            throw error; // Propaga el error para que la UI pueda mostrarlo
        }
        logDebug('Clientes obtenidos:', data ? data.length : 0);
        return data || [];
    } catch (e) {
        logError('Excepción en getClientes:', e);
        // Muestra un error visible en la UI del módulo
        showError(document.getElementById('clientes-feedback'), "Error al cargar clientes: " + (e.message || e));
        return [];
    }
}

/**
 * Obtiene un único cliente por su ID.
 * @param {string} clienteId El ID del cliente a obtener.
 * @returns {object|null} El objeto del cliente o null si no se encuentra.
 */
export async function getClienteById(clienteId) {
    logDebug('Obteniendo cliente por ID:', clienteId);
    try {
        if (!supabaseInstance) {
            logError('Supabase instance no está inicializada en getClienteById.');
            throw new Error('Supabase no está disponible.');
        }
        let { data, error } = await supabaseInstance.from('clientes').select('*').eq('id', clienteId).single();
        if (error) {
            logError('Error al obtener cliente por ID:', error);
            throw error;
        }
        logDebug('Cliente obtenido por ID:', data);
        return data;
    } catch (e) {
        logError('Excepción en getClienteById:', e);
        return null;
    }
}

/**
 * Obtiene datos históricos de un cliente específico de varias tablas relacionadas.
 * @param {string} clienteId El ID del cliente.
 * @returns {object} Un objeto que contiene reservas, ventas, ventas de tienda, ventas de restaurante y actividades CRM.
 */
async function fetchClientHistory(clienteId) {
    logDebug('Obteniendo historial del cliente para ID:', clienteId);
    const feedbackEl = document.getElementById('clientes-feedback');
    showLoading(feedbackEl, 'Cargando historial del cliente...');
    try {
        if (!supabaseInstance) {
            logError('Supabase instance no está inicializada al obtener historial del cliente.');
            throw new Error('Supabase no está disponible.');
        }

        const [
            { data: reservas, error: errorReservas },
            { data: ventas, error: errorVentas },
            { data: ventasTienda, error: errorVentasTienda },
            { data: ventasRestaurante, error: errorVentasRestaurante },
            { data: actividades, error: errorActividades }
        ] = await Promise.all([
            supabaseInstance.from('reservas').select('*').eq('cliente_id', clienteId),
            supabaseInstance.from('ventas').select('*').eq('cliente_id', clienteId),
            supabaseInstance.from('ventas_tienda').select('*').eq('cliente_id', clienteId),
            supabaseInstance.from('ventas_restaurante').select('*').eq('cliente_id', clienteId),
            supabaseInstance.from('crm_actividades').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false })
        ]);

        if (errorReservas) logError('Error al obtener reservas:', errorReservas);
        if (errorVentas) logError('Error al obtener ventas generales:', errorVentas);
        if (errorVentasTienda) logError('Error al obtener ventas de tienda:', errorVentasTienda);
        if (errorVentasRestaurante) logError('Error al obtener ventas de restaurante:', errorVentasRestaurante);
        if (errorActividades) logError('Error al obtener actividades CRM:', errorActividades);

        logDebug('Historial del cliente obtenido exitosamente.');
        return {
            reservas: reservas || [],
            ventas: ventas || [],
            ventasTienda: ventasTienda || [],
            ventasRestaurante: ventasRestaurante || [],
            actividades: actividades || []
        };
    } catch (e) {
        logError('Excepción al obtener historial del cliente:', e);
        showError(feedbackEl, "Error al cargar historial: " + (e.message || e));
        return { reservas: [], ventas: [], ventasTienda: [], ventasRestaurante: [], actividades: [] };
    } finally {
        clearFeedback(feedbackEl);
    }
}

// --- LISTADO Y FILTRADO DE CLIENTES ---

/**
 * Carga y renderiza la lista de clientes en la tabla principal.
 */
async function cargarYRenderizarClientes() {
    logDebug('Cargando y renderizando clientes...');
    const feedbackEl = document.getElementById('clientes-feedback');
    showLoading(feedbackEl, 'Cargando clientes...'); // Muestra el mensaje de carga
    try {
        clientesData = await getClientes({ hotelId: hotelIdActual }); // Espera a que los clientes se carguen
        renderTablaClientes(clientesData); // Renderiza la tabla con los datos
        clearFeedback(feedbackEl); // Limpia el mensaje de carga/error
        logDebug('Clientes cargados y renderizados.');
    } catch (e) {
        // Este catch ya está en getClientes, pero lo dejo aquí para un manejo explícito si getClientes lanza error.
        logError('Fallo al cargar y renderizar clientes:', e);
        showError(feedbackEl, "Error al cargar clientes: " + (e.message || e));
    }
}

/**
 * Renderiza la tabla HTML de clientes.
 * @param {Array} clientes Array de objetos de cliente a mostrar.
 */
function renderTablaClientes(clientes) {
    logDebug('Renderizando tabla de clientes con', clientes.length, 'clientes.');
    const wrapper = document.getElementById('clientes-table-wrapper');
    if (!wrapper) {
        logError('Elemento #clientes-table-wrapper no encontrado para renderizar la tabla.');
        return;
    }
    if (!clientes.length) {
        wrapper.innerHTML = `<div class="text-center text-gray-500 p-6">No hay clientes registrados que coincidan con el filtro.</div>`;
        return;
    }
    wrapper.innerHTML = `
        <table class="table w-full text-left border-collapse">
            <thead>
                <tr class="bg-gray-200">
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Nombre</th>
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Documento</th>
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Email</th>
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Teléfono</th>
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Registrado</th>
                    <th class="py-3 px-4 border-b border-gray-300 text-gray-700 font-bold">Acciones</th>
                </tr>
            </thead>
            <tbody>
                ${clientes.map(cli => `
                    <tr class="hover:bg-gray-50 transition-colors duration-150 ease-in-out">
                        <td class="py-2 px-4 border-b border-gray-200">${cli.nombre || ''}</td>
                        <td class="py-2 px-4 border-b border-gray-200">${cli.documento || ''}</td>
                        <td class="py-2 px-4 border-b border-gray-200">${cli.email || ''}</td>
                        <td class="py-2 px-4 border-b border-gray-200">${cli.telefono || ''}</td>
                        <td class="py-2 px-4 border-b border-gray-200">${formatDate(cli.fecha_creado)}</td>
                        <td class="py-2 px-4 border-b border-gray-200 whitespace-nowrap">
                            <button class="button button-accent button-sm bg-purple-500 hover:bg-purple-600 text-white px-3 py-1 rounded-md mr-2" data-id="${cli.id}" data-action="ver">Ver</button>
                            <button class="button button-primary button-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded-md" data-id="${cli.id}" data-action="editar">Editar</button>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
    // ASIGNACIÓN CORRECTA DE LISTENERS PARA "VER" Y "EDITAR"
    wrapper.querySelectorAll('button[data-action="ver"]').forEach(btn => {
        btn.onclick = () => mostrarHistorialCliente(btn.dataset.id);
    });
    wrapper.querySelectorAll('button[data-action="editar"]').forEach(btn => {
        btn.onclick = () => mostrarFormularioCliente(btn.dataset.id);
    });
    logDebug('Tabla de clientes renderizada.');
}

/**
 * Filtra la tabla de clientes dinámicamente.
 * @param {string} texto El texto de búsqueda.
 * @param {object} dateRange El rango de fechas para filtrar.
 */
async function filtrarTabla(texto, dateRange) {
    logDebug('Filtrando tabla con texto:', texto, 'y rango de fechas:', dateRange);
    const feedbackEl = document.getElementById('clientes-feedback');
    showLoading(feedbackEl, 'Filtrando clientes...');
    try {
        const filteredClients = await getClientes({ hotelId: hotelIdActual, search: texto, dateRange: dateRange });
        renderTablaClientes(filteredClients);
        clearFeedback(feedbackEl);
        logDebug('Tabla filtrada y re-renderizada.');
    } catch (e) {
        logError('Error durante el filtrado de tabla:', e);
        showError(feedbackEl, 'Error al filtrar clientes: ' + (e.message || e));
    }
}

// --- FORMULARIO DE CLIENTES (CREAR/EDITAR) ---

/**
 * Muestra un formulario modal para crear un nuevo cliente o editar uno existente.
 * @param {string|null} clienteId El ID del cliente a editar, o null para un nuevo cliente.
 * @param {object} opts Parámetros opcionales, como un callback 'afterSave'.
 */


export function mostrarFormularioCliente(clienteId = null, supabase, hotelId, opts = {}) {
    logDebug('Mostrando formulario de cliente para ID:', clienteId);

    if (!supabase || !hotelId) {
        logError("Se intentó llamar a mostrarFormularioCliente sin supabase o hotelId.");
        alert("Error de configuración al abrir el formulario de cliente.");
        return;
    }

    // --- CORRECCIÓN: Usar el contenedor de modal secundario para evitar conflictos ---
    const modal = document.getElementById('modal-container-secondary');
    if (!modal) {
        console.error("Error: #modal-container-secondary no fue encontrado. Asegúrate que esté en tu HTML principal.");
        // Fallback al modal primario si el secundario no existe
        modal = document.getElementById('modal-container');
    }
    
    const cliente = clienteId ? clientesData.find(c => c.id === clienteId) : {};
    
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-xl shadow-2xl p-6 max-w-lg mx-auto w-full relative">
            <button class="modal-close-button absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl font-bold">&times;</button>
            <h3 class="text-2xl font-bold mb-4">${clienteId ? 'Editar Cliente' : 'Registrar Cliente'}</h3>
            <form id="form-cliente">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="form-group mb-3 md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Nombre *</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="nombre" required value="${cliente?.nombre || ''}">
                    </div>
                    <div class="form-group mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Documento</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="documento" value="${cliente?.documento || ''}">
                    </div>
                    <div class="form-group mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="email" type="email" value="${cliente?.email || ''}">
                    </div>
                    <div class="form-group mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="telefono" value="${cliente?.telefono || ''}">
                    </div>
                    <div class="form-group mb-3">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="direccion" value="${cliente?.direccion || ''}">
                    </div>
                    <div class="form-group mb-3 md:col-span-2">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
                        <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="fecha_nacimiento" type="date" value="${cliente?.fecha_nacimiento ? cliente.fecha_nacimiento.substr(0, 10) : ''}">
                    </div>
                </div>
                <div class="form-group mb-4">
                    <label class="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                    <textarea class="form-control w-full p-2 border border-gray-300 rounded-md h-24" name="notas">${cliente?.notas || ''}</textarea>
                </div>
                <div id="feedback-form-cliente" class="mb-3 text-center"></div>
                <div class="flex justify-end gap-2 mt-4">
                    <button type="button" class="button button-neutral" id="btn-cancelar-form">Cancelar</button>
                    <button type="submit" class="button button-success">${clienteId ? 'Guardar Cambios' : 'Registrar'}</button>
                </div>
            </form>
        </div>
    `;
    modal.style.display = 'flex';

    const afterSaveCallback = opts.afterSave || (() => {});
    const closeModal = () => { modal.innerHTML = ''; modal.style.display = 'none'; };
    modal.querySelector('.modal-close-button').onclick = closeModal;
    modal.querySelector('#btn-cancelar-form').onclick = closeModal;
     modal.querySelector('.modal-content').onclick = (e) => e.stopPropagation();


    modal.querySelector('#form-cliente').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form));
        const feedback = document.getElementById('feedback-form-cliente');
        clearFeedback(feedback);

        if (!data.nombre) return showError(feedback, "El nombre es obligatorio.");
        
        showLoading(feedback, 'Guardando...');
        try {
            let resp;
            if (clienteId) {
                resp = await supabase.from('clientes').update(data).eq('id', clienteId).select().single();
            } else {
                resp = await supabase.from('clientes').insert([{ ...data, hotel_id: hotelId }]).select().single();
            }
            if (resp.error) throw resp.error;

            showSuccess(feedback, "Cliente guardado exitosamente.");
            
            // --- CORRECCIÓN FINAL ---
            // Solo intentamos recargar la tabla si existe en el DOM (es decir, si estamos en la página de clientes)
            if (document.getElementById('clientes-table-wrapper')) {
                await cargarYRenderizarClientes();
            }
            
            setTimeout(() => {
                closeModal();
                afterSaveCallback(resp.data); // Ejecutar el callback con el cliente nuevo/actualizado
            }, 500);

        } catch (err) {
            logError('Error al guardar cliente:', err);
            showError(feedback, `Error: ${err.message}`);
        }
    };
}// --- VISTA DETALLADA DEL CLIENTE (PESTAÑAS, HISTORIAL, CRM, GRÁFICOS) ---

/**
 * Muestra una vista detallada de un cliente con pestañas para datos generales, historial, gastos y actividades CRM.
 * @param {string} clienteId El ID del cliente a mostrar.
 */
async function mostrarHistorialCliente(clienteId) {
    logDebug('Mostrando historial del cliente para ID:', clienteId);
    const cliente = clientesData.find(c => c.id === clienteId);
    if (!cliente) {
        showError(document.getElementById('clientes-feedback'), 'Cliente no encontrado.');
        logError('Cliente no encontrado para ID:', clienteId);
        return;
    }

    const modal = document.getElementById('modal-container');
    showLoading(modal, `Cargando detalles de ${cliente.nombre}...`); // Mensaje de carga en el modal

    // Obtener todo el historial del cliente de forma asíncrona
    const { reservas, ventas, ventasTienda, ventasRestaurante, actividades } = await fetchClientHistory(clienteId);

    // NUEVO: Obtener descuentos asociados a este cliente
    let descuentosCliente = [];
    try {
        if (!supabaseInstance) {
            logError('Supabase instance no está inicializada al obtener descuentos del cliente.');
            throw new Error('Supabase no está disponible para obtener descuentos.');
        }
        const { data: clienteDescuentos, error: errDescuentos } = await supabaseInstance
            .from('clientes_descuentos') // Asumimos una tabla de relación muchos a muchos
            .select('descuentos(*)') // Traer los detalles del descuento
            .eq('cliente_id', clienteId);

        if (errDescuentos) throw errDescuentos;
        descuentosCliente = clienteDescuentos.map(cd => cd.descuentos) || [];
    } catch (err) {
        logError('Error al cargar descuentos del cliente:', err);
        // showAppFeedback (o similar) si es un error que el usuario final deba ver.
    }

    // Calcular el total de gastos por módulo
    const totalVentas = ventas.reduce((sum, item) => sum + (item.total || 0), 0);
    const totalVentasTienda = ventasTienda.reduce((sum, item) => sum + (item.total_venta || item.total || 0), 0);
    const totalVentasRestaurante = ventasRestaurante.reduce((sum, item) => sum + (item.monto_total || item.total_venta || item.total || 0), 0);
    const totalReservas = reservas.reduce((sum, item) => sum + (item.precio_total || 0), 0); // Asumiendo que las reservas tienen un precio_total

    // Renderiza la estructura HTML del modal de detalles del cliente
    modal.innerHTML = `
        <div class="modal-content bg-white rounded-xl shadow-2xl p-6 max-w-4xl mx-auto w-full relative h-5/6 flex flex-col">
            <button class="modal-close-button absolute top-4 right-4 text-gray-500 hover:text-gray-700 text-2xl font-bold">&times;</button>
            <h3 class="text-2xl font-bold mb-4 border-b pb-2">Detalles de Cliente: ${cliente.nombre}</h3>

            <div class="tabs flex border-b border-gray-200 mb-4 bg-gray-50 rounded-t-lg overflow-hidden">
                <button class="tab-button flex-1 py-3 px-4 text-center font-semibold text-gray-700 hover:bg-gray-100 transition-colors duration-200" data-tab="datos-generales">Datos Generales</button>
                <button class="tab-button flex-1 py-3 px-4 text-center font-semibold text-gray-700 hover:bg-gray-100 transition-colors duration-200" data-tab="historial-visitas">Historial de Visitas</button>
                <button class="tab-button flex-1 py-3 px-4 text-center font-semibold text-gray-700 hover:bg-gray-100 transition-colors duration-200" data-tab="historial-gastos">Historial de Gastos</button>
                <button class="tab-button flex-1 py-3 px-4 text-center font-semibold text-gray-700 hover:bg-gray-100 transition-colors duration-200" data-tab="actividades-crm">Actividades CRM</button>
                <button class="tab-button flex-1 py-3 px-4 text-center font-semibold text-gray-700 hover:bg-gray-100 transition-colors duration-200" data-tab="descuentos-cliente">Descuentos</button>
            </div>
            <div id="tab-content" class="flex-grow overflow-y-auto">
                <div id="tab-datos-generales" class="tab-pane active p-2">
                    <form id="form-cliente-detail">
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="nombre" value="${cliente.nombre || ''}"></div>
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Documento</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="documento" value="${cliente.documento || ''}"></div>
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="email" type="email" value="${cliente.email || ''}"></div>
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="telefono" value="${cliente.telefono || ''}"></div>
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Dirección</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="direccion" value="${cliente.direccion || ''}"></div>
                            <div class="form-group"><label class="block text-sm font-medium text-gray-700 mb-1">Fecha de nacimiento</label>
                                <input class="form-control w-full p-2 border border-gray-300 rounded-md" name="fecha_nacimiento" type="date" value="${cliente.fecha_nacimiento ? cliente.fecha_nacimiento.substr(0, 10) : ''}"></div>
                        </div>
                        <div class="form-group mt-4"><label class="block text-sm font-medium text-gray-700 mb-1">Notas</label>
                            <textarea class="form-control w-full p-2 border border-gray-300 rounded-md h-24" name="notas">${cliente.notas || ''}</textarea></div>
                        <div id="feedback-form-cliente-detail" class="mt-3 text-center"></div>
                        <div class="flex justify-end gap-2 mt-4">
                            <button type="submit" class="button button-success bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md">Guardar Cambios</button>
                        </div>
                    </form>
                </div>

                <div id="tab-historial-visitas" class="tab-pane hidden p-2">
                    <h4 class="font-bold mb-2 text-lg">Reservas Realizadas</h4>
                    <ul class="list-disc list-inside space-y-1 text-gray-700">
                        ${renderReservas(reservas)}
                    </ul>
                    <button id="btn-exportar-pdf-historial" class="button button-secondary bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-md mt-4">Exportar Historial a PDF</button>
                </div>

                <div id="tab-historial-gastos" class="tab-pane hidden p-2">
                    <h4 class="font-bold mb-2 text-lg">Resumen de Gastos</h4>
                    <p class="text-gray-700"><strong>Total en Reservas:</strong> ${formatCurrency(totalReservas)}</p>
                    <p class="text-gray-700"><strong>Total en Ventas Generales:</strong> ${formatCurrency(totalVentas)}</p>
                    <p class="text-gray-700"><strong>Total en Tienda:</strong> ${formatCurrency(totalVentasTienda)}</p>
                    <p class="text-gray-700"><strong>Total en Restaurante:</strong> ${formatCurrency(totalVentasRestaurante)}</p>
                    <div class="mt-4 h-64"> <canvas id="gastosChart"></canvas>
                    </div>
                    <div class="mt-8">
                        <h4 class="font-bold mb-2 text-lg">Detalle de Consumos</h4>
                        <div class="overflow-y-auto max-h-64 border border-gray-200 rounded p-2 bg-gray-50">
                            ${renderDetalleGastos(reservas, ventas, ventasTienda, ventasRestaurante)}
                        </div>
                    </div>
                </div>

                <div id="tab-actividades-crm" class="tab-pane hidden p-2">
                    <h4 class="font-bold mb-2 text-lg">Actividades CRM</h4>
                    <ul id="lista-actividades-crm" class="list-disc list-inside mb-4 space-y-2">
                        ${renderActividades(actividades)}
                    </ul>
                    <form id="form-crm-actividad" class="mt-4 border-t pt-3 border-gray-200">
                        <label class="block text-base font-semibold text-gray-800 mb-2">Agregar Actividad CRM</label>
                        <div class="flex flex-wrap gap-3 mb-3">
                            <select name="tipo" class="form-control p-2 border border-gray-300 rounded-md flex-grow" required>
                                <option value="">Tipo de Actividad</option>
                                <option>Llamada</option>
                                <option>Email</option>
                                <option>Nota</option>
                                <option>Tarea</option>
                                <option>WhatsApp</option>
                                <option>Visita</option>
                                <option>Recordatorio</option>
                            </select>
                            <select name="estado" class="form-control p-2 border border-gray-300 rounded-md flex-grow" required>
                                <option value="pendiente">Pendiente</option>
                                <option value="completada">Completada</option>
                                <option value="reagendada">Reagendada</option>
                                <option value="cancelada">Cancelada</option>
                            </select>
                        </div>
                        <textarea name="descripcion" class="form-control w-full p-2 border border-gray-300 rounded-md h-24 mb-3" required placeholder="Descripción de la actividad"></textarea>
                        <div id="feedback-form-crm-actividad" class="mb-3 text-center"></div>
                        <div class="flex justify-between items-center">
                            <button type="submit" class="button button-success bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-md">Agregar Actividad</button>
                            <button id="btn-ai-sugerencia" class="button button-info bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-2 rounded-md">Sugerencia IA</button>
                        </div>
                    </form>
                </div>
            </div>

            <div class="flex justify-end mt-4 border-t pt-4">
                <button class="button button-neutral bg-gray-300 hover:bg-gray-400 text-gray-800 px-4 py-2 rounded-md" id="btn-cerrar-historial">Cerrar</button>
            </div>
        </div>
    `;
    modal.style.display = 'flex'; // Usar flexbox para centrar el modal

    setupClientDetailListeners(clienteId, cliente, reservas, ventas, ventasTienda, ventasRestaurante, actividades);
    logDebug('Modal de detalles de cliente renderizado y escuchadores configurados.');
}

/**
 * Configura los escuchadores de eventos para la vista detallada del cliente.
 * @param {string} clienteId
 * @param {object} cliente
 * @param {Array} reservas
 * @param {Array} ventas
 * @param {Array} ventasTienda
 * @param {Array} ventasRestaurante
 * @param {Array} actividades
 */
function setupClientDetailListeners(clienteId, cliente, reservas, ventas, ventasTienda, ventasRestaurante, actividades) {
    const modal = document.getElementById('modal-container');

    // Función para cerrar el modal de detalles
    const closeModal = () => {
        modal.innerHTML = '';
        modal.style.display = 'none';
        if (currentChartInstance) {
            currentChartInstance.destroy(); // Destruir el gráfico al cerrar el modal
            currentChartInstance = null;
        }
        logDebug('Modal de detalles de cliente cerrado.');
    };

    modal.querySelector('.modal-close-button').onclick = closeModal;
    modal.querySelector('#btn-cerrar-historial').onclick = closeModal;

    // Lógica para cambiar de pestaña
    modal.querySelectorAll('.tab-button').forEach(button => {
        button.onclick = (e) => {
            // 1. Quitar clases 'active' y restaurar 'inactivo' a TODAS las pestañas
            modal.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove(
                    'active',
                    'bg-white',        // Fondo blanco (activo)
                    'border-b-2',      // Borde inferior (activo)
                    'border-blue-600', // Color del borde (activo)
                    'text-blue-600',   // Color del texto (activo)
                    'shadow-sm'        // Sombra (activo)
                );
                // Restaurar clases de inactivo (fondo gris, texto gris)
                btn.classList.add('bg-gray-50', 'text-gray-700'); 
            });

            // 2. Añadir clases 'active' y quitar 'inactivo' a la pestaña clickeada
            e.target.classList.add(
                'active',
                'bg-white',
                'border-b-2',
                'border-blue-600',
                'text-blue-600',
                'shadow-sm'
            );
            // Quitar clases de inactivo de la pestaña actual
            e.target.classList.remove('bg-gray-50', 'text-gray-700');
            
            // 3. Ocultar todos los paneles de contenido y mostrar solo el del activo
            const targetTab = e.target.dataset.tab;
            modal.querySelectorAll('.tab-pane').forEach(pane => pane.classList.add('hidden'));
            modal.querySelector(`#tab-${targetTab}`).classList.remove('hidden');

            // 4. Lógica específica para gráficos (si la pestaña de gastos es seleccionada)
            if (targetTab === 'historial-gastos') {
                renderGastosChart({ reservas, ventas, ventasTienda, ventasRestaurante });
            } else if (currentChartInstance) {
                currentChartInstance.destroy(); // Destruir chart si la pestaña es cambiada
                currentChartInstance = null;
            }
            logDebug(`Cambiado a la pestaña: ${targetTab}`);
        };
    });

    // Guardar datos generales del cliente (formulario en la pestaña "Datos Generales")
    modal.querySelector('#form-cliente-detail').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form));
        const feedback = document.getElementById('feedback-form-cliente-detail');
        clearFeedback(feedback);
        logDebug('Guardando datos generales del cliente:', data);
        showLoading(feedback, 'Guardando cambios...');
        try {
            const { error } = await supabaseInstance.from('clientes').update(data).eq('id', clienteId);
            if (error) throw error;
            showSuccess(feedback, "Datos generales actualizados.");
            logDebug('Datos generales del cliente actualizados.');
            // Actualizar el cliente en la caché local para reflejar los cambios
            const updatedClient = { ...cliente, ...data };
            clientesData = clientesData.map(c => c.id === clienteId ? updatedClient : c);
            setTimeout(() => clearFeedback(feedback), 2000); // Limpiar feedback después de un retardo
        } catch (err) {
            logError('Error al actualizar datos generales del cliente:', err);
            showError(feedback, "Error al guardar: " + (err?.message || err));
        }
    };

    // Agregar actividad CRM (formulario en la pestaña "Actividades CRM")
    modal.querySelector('#form-crm-actividad').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form));
        const feedback = document.getElementById('feedback-form-crm-actividad');
        clearFeedback(feedback);

        if (!data.tipo || !data.descripcion || !data.estado) {
            return showError(feedback, "Por favor, completa Tipo, Descripción y Estado.");
        }

        let nuevaActividad = {
            ...data,
            cliente_id: clienteId,
            hotel_id: hotelIdActual,
            usuario_creador_id: null, // Asumirás que el ID del usuario loggeado se manejará aquí
            fecha: new Date().toISOString()
        };

        logDebug('Añadiendo nueva actividad CRM:', nuevaActividad);
        showLoading(feedback, 'Guardando actividad...');
        try {
            const { error } = await supabaseInstance.from('crm_actividades').insert([nuevaActividad]);
            if (error) throw error;
            showSuccess(feedback, "Actividad CRM registrada.");
            logDebug('Actividad CRM añadida exitosamente.');

            // Volver a obtener y renderizar las actividades para que se muestre la nueva
            const { data: updatedActivities, error: fetchError } = await supabaseInstance.from('crm_actividades').select('*').eq('cliente_id', clienteId).order('fecha', { ascending: false });
            if (fetchError) throw fetchError; // Lanzar error si la re-obtención falla
            modal.querySelector('#lista-actividades-crm').innerHTML = renderActividades(updatedActivities);
            form.reset(); // Limpiar el formulario
            setTimeout(() => clearFeedback(feedback), 2000); // Limpiar feedback después de un retardo

        } catch (err) {
            logError('Error al añadir actividad CRM:', err);
            showError(feedback, 'Error al guardar actividad: ' + (err?.message || err));
        }
    };

    // Placeholder para la sugerencia de IA
    modal.querySelector('#btn-ai-sugerencia').onclick = () => {
        alert('Próximamente: Sugerencias de acciones CRM por IA.');
        logDebug('Botón de sugerencia IA clickeado (placeholder).');
    };

    // Placeholder para la exportación a PDF
    modal.querySelector('#btn-exportar-pdf-historial').onclick = () => {
        alert('Próximamente: Exportar historial individual a PDF.');
        logDebug('Botón de exportar PDF clickeado (placeholder).');
    };
}

/**
 * Renderiza la lista de reservas para el historial del cliente.
 * @param {Array} reservas Array de objetos de reserva.
 * @returns {string} HTML para la lista de reservas.
 */
function renderReservas(reservas) {
    if (!reservas || !reservas.length) return '<li>No tiene reservas registradas.</li>';
    return reservas.map(r => `
        <li class="mb-1 p-1 bg-gray-50 rounded">
            <strong>Fecha:</strong> ${formatDate(r.fecha_checkin || r.fecha_inicio)} -
            <strong>Habitación:</strong> ${r.habitacion_nombre || 'N/A'} -
            <strong>Total:</strong> ${formatCurrency(r.precio_total || 0)}
        </li>
    `).join('');
}

/**
 * Renderiza la lista de actividades CRM.
 * @param {Array} arr Array de objetos de actividad CRM.
 * @returns {string} HTML para la lista de actividades.
 */
function renderActividades(arr) {
    if (!arr || !arr.length) return '<li>No hay actividades CRM registradas.</li>';
    return arr.map(a => `
        <li class="mb-2 p-3 border border-gray-200 rounded-md bg-white shadow-sm">
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-blue-700">${a.tipo}</span>
                <span class="text-xs text-gray-500">${formatDate(a.fecha)}</span>
            </div>
            <div class="text-gray-700 text-sm mb-1">${a.descripcion || ''}</div>
            <div class="text-xs text-gray-500">Estado: <span class="capitalize font-semibold">${a.estado || 'Pendiente'}</span></div>
        </li>
    `).join('');
}

/**
 * Renderiza el detalle de todos los gastos del cliente en una tabla combinada.
 * @param {Array} reservas
 * @param {Array} ventas
 * @param {Array} ventasTienda
 * @param {Array} Array de ventasRestaurante.
 * @returns {string} HTML para la tabla de detalle de gastos.
 */
function renderDetalleGastos(reservas, ventas, ventasTienda, ventasRestaurante) {
    let allTransactions = [];

    reservas.forEach(r => allTransactions.push({
        type: 'Reserva',
        date: r.fecha_checkin || r.fecha_inicio || new Date().toISOString(),
        description: `Habitación: ${r.habitacion_nombre || 'N/A'}`,
        amount: r.precio_total || 0,
        id: r.id
    }));
    ventas.forEach(v => allTransactions.push({
        type: 'Venta General',
        date: v.fecha_venta || new Date().toISOString(),
        description: v.descripcion || `Venta #${v.id}`,
        amount: v.total || 0,
        id: v.id
    }));
    ventasTienda.forEach(vt => allTransactions.push({
        type: 'Venta Tienda',
        date: vt.fecha || vt.fecha_venta || new Date().toISOString(),
        description: vt.descripcion || `Compra tienda #${vt.id}`,
        amount: vt.total_venta || vt.total || 0,
        id: vt.id
    }));
    ventasRestaurante.forEach(vr => allTransactions.push({
        type: 'Venta Restaurante',
        date: vr.fecha || vr.fecha_venta || new Date().toISOString(),
        description: vr.descripcion || `Consumo restaurante #${vr.id}`,
        amount: vr.monto_total || vr.total_venta || vr.total || 0,
        id: vr.id
    }));

    // Ordenar todas las transacciones por fecha descendente
    allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!allTransactions.length) return '<p class="text-center text-gray-500 p-4">No hay detalles de gastos registrados para este cliente.</p>';

    return `
        <table class="table w-full text-sm border-collapse">
            <thead>
                <tr class="bg-gray-100">
                    <th class="py-2 px-3 border-b text-left text-gray-600 font-semibold">Fecha</th>
                    <th class="py-2 px-3 border-b text-left text-gray-600 font-semibold">Tipo</th>
                    <th class="py-2 px-3 border-b text-left text-gray-600 font-semibold">Descripción</th>
                    <th class="py-2 px-3 border-b text-right text-gray-600 font-semibold">Monto</th>
                </tr>
            </thead>
            <tbody>
                ${allTransactions.map(t => `
                    <tr class="hover:bg-gray-50">
                        <td class="py-2 px-3 border-b border-gray-200">${formatDate(t.date)}</td>
                        <td class="py-2 px-3 border-b border-gray-200">${t.type}</td>
                        <td class="py-2 px-3 border-b border-gray-200">${t.description}</td>
                        <td class="py-2 px-3 border-b border-gray-200 text-right font-medium">${formatCurrency(t.amount)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

/**
 * Renderiza el gráfico de gastos del cliente usando Chart.js.
 * @param {object} data Objeto con los arrays de reservas, ventas, etc.
 */
function renderGastosChart({ reservas, ventas, ventasTienda, ventasRestaurante }) {
    logDebug('Renderizando gráfico de gastos...');
    if (currentChartInstance) {
        currentChartInstance.destroy(); // Destruye cualquier instancia anterior para evitar duplicados
    }

    const ctx = document.getElementById('gastosChart');
    if (!ctx) {
        logError('Elemento canvas para el gráfico no encontrado.');
        return;
    }

    // Calcula los totales
    const totalReservas = reservas.reduce((sum, item) => sum + (item.precio_total || 0), 0);
    const totalVentas = ventas.reduce((sum, item) => sum + (item.total || 0), 0);
    const totalVentasTienda = ventasTienda.reduce((sum, item) => sum + (item.total_venta || item.total || 0), 0);
    const totalVentasRestaurante = ventasRestaurante.reduce((sum, item) => sum + (item.monto_total || item.total_venta || item.total || 0), 0);

    const dataChart = {
        labels: ['Reservas', 'Ventas Generales', 'Ventas Tienda', 'Ventas Restaurante'],
        datasets: [{
            label: 'Total de Gastos',
            data: [totalReservas, totalVentas, totalVentasTienda, totalVentasRestaurante],
            backgroundColor: [
                'rgba(255, 99, 132, 0.7)', // Rojo
                'rgba(54, 162, 235, 0.7)', // Azul
                'rgba(255, 206, 86, 0.7)', // Amarillo
                'rgba(75, 192, 192, 0.7)'  // Verde
            ],
            borderColor: [
                'rgba(255, 99, 132, 1)',
                'rgba(54, 162, 235, 1)',
                'rgba(255, 206, 86, 1)',
                'rgba(75, 192, 192, 1)'
            ],
            borderWidth: 1
        }]
    };

    const config = {
        type: 'bar', // Tipo de gráfico: barras
        data: dataChart,
        options: {
            responsive: true,
            maintainAspectRatio: false, // Permitir que el gráfico no mantenga su aspecto si el contenedor cambia de tamaño
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Monto ($)'
                    },
                    ticks: {
                        callback: function(value) {
                            return formatCurrency(value); // Formatear los ticks del eje Y como moneda
                        }
                    }
                }
            },
            plugins: {
                legend: {
                    display: false // No mostrar la leyenda si solo hay un dataset
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            // Formatear el valor del tooltip como moneda
                            return `${context.label}: ${formatCurrency(context.raw)}`;
                        }
                    }
                }
            }
        }
    };
    // Crea una nueva instancia del gráfico y la guarda en currentChartInstance
    currentChartInstance = new Chart(ctx, config);
    logDebug('Gráfico de gastos renderizado.');
}

// --- MODAL DE SELECCIÓN DE CLIENTES (REUTILIZABLE) ---

/**
 * Muestra un modal para seleccionar un cliente existente o crear uno nuevo.
 * Útil para módulos como reservas o descuentos.
 * @param {object} params - Opciones: onSelect (callback al seleccionar un cliente), searchPlaceholder.
 */
/**
 * Muestra un modal para seleccionar un cliente.
 * Esta función puede ser llamada desde otros módulos (como reservas.js).
 * Acepta supabase y hotelId opcionales, para garantizar independencia del mount().
 */
export async function showClienteSelectorModal(supabaseManual, hotelIdManual, opts = {}) {
  // ----- ¡CAMBIO CLAVE AQUÍ! Usamos el contenedor secundario -----
  const modal = document.getElementById('modal-container-secondary');
  
  if (!modal) {
    console.error("[Clientes Error] No se encontró #modal-container-secondary en el DOM.");
    alert("Error: El contenedor para el selector de clientes no está disponible.");
    return;
  }

  // Asignar instancias si se pasan manualmente
  if (supabaseManual) supabaseInstance = supabaseManual;
  if (hotelIdManual) hotelIdActual = hotelIdManual;

  const onSelect = opts.onSelect || (() => {});

  if (!supabaseInstance || !hotelIdActual) {
    console.error('[Clientes Error] Supabase o hotelId no están disponibles en showClienteSelectorModal');
    return;
  }

  // Mostrar modal centrado y elegante
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal-content bg-white rounded-2xl shadow-2xl max-w-xl w-full p-6 sm:p-8 relative animate-fade-in-up">
        <button id="cerrar-modal-clientes" class="absolute top-4 right-4 text-gray-400 hover:text-red-500 text-3xl font-bold leading-none transition-colors duration-200 p-1">&times;</button>
        <h2 class="text-2xl font-bold text-gray-800 mb-5 flex items-center gap-3">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Seleccionar Cliente
        </h2>
        <input id="filtro-cliente"
               type="text"
               placeholder="Buscar por nombre, cédula o teléfono..."
               class="w-full px-4 py-3 rounded-lg text-base border border-gray-300 focus:outline-none focus:ring-2 focus:ring-green-400 mb-4 bg-white shadow-sm transition-all duration-200" />
        <div id="lista-clientes" class="rounded-lg border border-gray-200 max-h-[300px] overflow-y-auto divide-y divide-gray-100 bg-white shadow-inner">
            </div>
        <div class="mt-6 text-right">
            <button id="cerrar-modal-clientes2" class="button button-neutral py-2 px-6">
                Cerrar
            </button>
        </div>
    </div>
  `;

  const listaDiv = modal.querySelector('#lista-clientes');
  const inputFiltro = modal.querySelector('#filtro-cliente');
  const btnCerrar = modal.querySelector('#cerrar-modal-clientes');
  const btnCerrar2 = modal.querySelector('#cerrar-modal-clientes2');

  const cerrar = () => {
    modal.style.display = 'none';
    modal.innerHTML = '';
  };
  btnCerrar.onclick = cerrar;
  btnCerrar2.onclick = cerrar;
  
  // Cerrar si se hace clic en el fondo oscuro
  modal.onclick = (e) => {
    if (e.target === modal) {
        cerrar();
    }
  };
  // Prevenir que el clic en el contenido del modal lo cierre
  modal.querySelector('.modal-content').onclick = (e) => e.stopPropagation();

  // Obtener todos los clientes del hotel
  const { data: clientes, error } = await supabaseInstance
    .from('clientes')
    .select('*')
    .eq('hotel_id', hotelIdActual)
    .order('nombre', { ascending: true });

  if (error) {
    listaDiv.innerHTML = `<div class="text-red-600 p-3">Error al cargar clientes.</div>`;
    console.error('[Clientes Error] Error al obtener clientes:', error);
    return;
  }

  const renderClientes = (filtro = '') => {
    const filtroLower = filtro.toLowerCase();
    const filtrados = clientes.filter(c =>
      c.nombre.toLowerCase().includes(filtroLower) ||
      (c.documento || '').toLowerCase().includes(filtroLower) ||
      (c.telefono || '').toLowerCase().includes(filtroLower)
    );

    if (filtrados.length === 0) {
      listaDiv.innerHTML = '<div class="p-4 text-gray-500 text-center">No se encontraron clientes.</div>';
      return;
    }

    listaDiv.innerHTML = filtrados.map(c => `
      <div class="p-4 bg-white hover:bg-green-50 cursor-pointer transition-colors duration-150"
           data-id="${c.id}"
           data-nombre="${c.nombre}"
           data-documento="${c.documento || ''}"
           data-telefono="${c.telefono || ''}">
        <div class="font-medium text-gray-800">${c.nombre}</div>
        <div class="text-sm text-gray-500">${c.documento || 'Sin documento'} • ${c.telefono || 'Sin teléfono'}</div>
      </div>
    `).join('');

    listaDiv.querySelectorAll('[data-id]').forEach(item => {
      item.onclick = () => {
        const clienteId = item.getAttribute('data-id');
        const nombre = item.getAttribute('data-nombre');
        const documento = item.getAttribute('data-documento');
        const telefono = item.getAttribute('data-telefono');

        onSelect({ id: clienteId, nombre, documento, telefono });

        cerrar();
      };
    });
  };

  inputFiltro.oninput = () => {
    renderClientes(inputFiltro.value);
  };
  inputFiltro.focus();
  renderClientes();
}
// --- FUNCIONALIDAD DE EXPORTACIÓN A EXCEL ---

/**
 * Exporta todos los datos de los clientes a un archivo Excel (.xlsx).
 * Utiliza la librería SheetJS (xlsx).
 */
async function exportarExcel() {
    logDebug('Intentando exportar clientes a Excel.');
    const feedbackEl = document.getElementById('clientes-feedback');
    showLoading(feedbackEl, 'Preparando exportación a Excel...');
    try {
        // Asegúrate de que XLSX esté disponible globalmente o importado
        if (typeof XLSX === 'undefined') {
            const errMsg = 'Error: SheetJS (XLSX) no está cargado. Asegúrate de incluirlo en tu index.html o de importarlo correctamente.';
            logError(errMsg);
            showError(feedbackEl, errMsg);
            return;
        }

        const allClients = await getClientes({ hotelId: hotelIdActual }); // Obtiene todos los clientes sin filtros de búsqueda/fecha

        if (!allClients || allClients.length === 0) {
            showError(feedbackEl, 'No hay clientes para exportar.');
            logDebug('No hay clientes para exportar.');
            return;
        }

        // Mapea los datos de los clientes a un formato amigable para Excel
        const dataForExport = allClients.map(cli => ({
            ID: cli.id,
            Nombre: cli.nombre || '',
            Documento: cli.documento || '',
            Email: cli.email || '',
            Telefono: cli.telefono || '',
            Direccion: cli.direccion || '',
            'Fecha Nacimiento': cli.fecha_nacimiento ? formatDate(cli.fecha_nacimiento) : '',
            'Fecha Registro': cli.fecha_creado ? formatDate(cli.fecha_creado) : '',
            Notas: cli.notas || ''
        }));

        const ws = XLSX.utils.json_to_sheet(dataForExport); // Crea una hoja de trabajo a partir de los datos JSON
        const wb = XLSX.utils.book_new(); // Crea un nuevo libro de trabajo
        XLSX.utils.book_append_sheet(wb, ws, "Clientes"); // Añade la hoja al libro
        const filename = `clientes_hotel_${hotelIdActual}_${new Date().toISOString().split('T')[0]}.xlsx`; // Nombre del archivo

        XLSX.writeFile(wb, filename); // Escribe y descarga el archivo Excel

        showSuccess(feedbackEl, 'Clientes exportados a Excel exitosamente.');
        logDebug('Clientes exportados a Excel:', filename);
    } catch (e) {
        logError('Error al exportar clientes a Excel:', e);
        showError(feedbackEl, 'Error al exportar clientes a Excel: ' + (e.message || e));
    } finally {
        clearFeedback(feedbackEl); // Limpia el mensaje de feedback
    }
}