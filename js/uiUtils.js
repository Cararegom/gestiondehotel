// js/uiUtils.js

import { APP_CONFIG, I18N_TEXTS } from './config.js';
// Swal se asume global o se debe importar si se maneja como módulo.

// --- FEEDBACK GLOBAL ---
export function showAppFeedback(message, type = 'info', autoHide = true, duration = 5000) {
  const feedbackBanner = document.getElementById('app-global-feedback-banner');
  if (!feedbackBanner) {
    console.warn('Elemento #app-global-feedback-banner no encontrado.');
    return;
  }
  feedbackBanner.textContent = message;
  feedbackBanner.className = 'app-global-feedback fixed top-5 right-5 p-4 rounded-md shadow-lg z-50 text-sm';
  switch (type) {
    case 'success': feedbackBanner.classList.add('bg-green-100', 'border-green-400', 'text-green-700'); break;
    case 'error': feedbackBanner.classList.add('bg-red-100', 'border-red-400', 'text-red-700'); break;
    case 'warning': feedbackBanner.classList.add('bg-yellow-100', 'border-yellow-400', 'text-yellow-700'); break;
    case 'info': default: feedbackBanner.classList.add('bg-blue-100', 'border-blue-400', 'text-blue-700'); break;
  }
  feedbackBanner.style.display = 'block';
  feedbackBanner.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  if (type === 'error') {
      feedbackBanner.setAttribute('tabindex', '-1');
      feedbackBanner.focus();
  }
  if (autoHide) {
    setTimeout(() => clearAppFeedback(feedbackBanner), duration);
  }
}

export function clearAppFeedback(feedbackBannerParam) {
  const banner = feedbackBannerParam || document.getElementById('app-global-feedback-banner');
  if (banner) {
    banner.textContent = '';
    banner.style.display = 'none';
    banner.className = 'app-global-feedback';
    banner.removeAttribute('tabindex');
  }
}

// --- FEEDBACK LOCAL PARA COMPONENTES ---

// ----- INICIO DE LA CORRECCIÓN -----
function getElement(elementOrId) {
  if (typeof elementOrId === 'string') {
    return document.getElementById(elementOrId);
  }
  return elementOrId;
}
// ----- FIN DE LA CORRECCIÓN -----

export function showLoading(elementOrId, message = 'Cargando...') {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = message;
    element.className = 'loading-indicator p-3 my-3 text-sm bg-blue-100 border border-blue-300 text-blue-700 rounded-md visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
  }
}

/**
 * Muestra un modal de error estético (SweetAlert2) y también un mensaje en la página.
 * @param {HTMLElement|string} elementOrId - El div o el ID del div donde se mostrará el mensaje.
 * @param {string} message - El mensaje de error.
 */
export function showError(elementOrId, message) {
  const element = getElement(elementOrId); // Corrección aplicada

  // 1. Muestra el modal estético usando la variable global 'Swal'
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'error',
      title: 'Ocurrió un Error',
      text: message,
      confirmButtonText: 'OK',
      confirmButtonColor: '#3085d6'
    });
  } else {
    console.warn("SweetAlert2 (Swal) no está disponible. Mostrando error como alerta nativa.");
    alert(`Error: ${message}`);
  }

  // 2. Muestra también el mensaje en la página como recordatorio
  if (element) {
    element.textContent = message;
    element.className = 'feedback-message p-3 my-3 text-sm rounded-md border bg-red-100 border-red-300 text-red-700 visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'assertive');
    element.setAttribute('tabindex', '-1');
    element.focus();
  }
}

export function clearFeedback(elementOrId) {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = '';
    element.style.display = 'none';
    element.className = '';
    element.removeAttribute('tabindex');
    element.removeAttribute('aria-live');
  }
}

// --- FORMULARIO CARGANDO (para deshabilitar mientras procesa) ---
export function setFormLoadingState(formEl, isLoading, buttonEl, originalButtonText, loadingButtonText = 'Procesando...') {
  if (!formEl) {
    console.warn("setFormLoadingState: formEl no proporcionado.");
    return;
  }
  if (buttonEl) {
    buttonEl.disabled = isLoading;
    buttonEl.textContent = isLoading ? loadingButtonText : originalButtonText;
    if (isLoading) {
      buttonEl.classList.add('opacity-75', 'cursor-not-allowed');
    } else {
      buttonEl.classList.remove('opacity-75', 'cursor-not-allowed');
    }
  }
  Array.from(formEl.elements).forEach(el => {
    if (el.type !== 'submit' && el.type !== 'button') {
      el.disabled = isLoading;
    }
  });
}

// --- FECHAS Y MONEDAS ---
// En tu archivo uiUtils.js

/**
 * Formatea un valor numérico como moneda.
 * @param {number} value - El valor numérico a formatear.
 * @param {string} [simboloMoneda='$'] - El símbolo de la moneda a mostrar (ej. $, €, S/).
 * @param {string} [codigoISONacion='COP'] - El código de moneda ISO 4217 de 3 letras (ej. COP, USD).
 * @param {number} [decimales=0] - El número de decimales a mostrar.
 * @returns {string} - El valor formateado como string de moneda.
 */
export function formatCurrency(value, simboloMoneda = '$', codigoISONacion = 'COP', decimales = 0) {
    if (typeof value !== 'number' || isNaN(value)) {
        value = 0;
    }

    const isValidISOCode = typeof codigoISONacion === 'string' && /^[A-Z]{3}$/i.test(codigoISONacion);
    const safeISOCode = isValidISOCode ? codigoISONacion.toUpperCase() : 'USD';

    try {
        const formatter = new Intl.NumberFormat('es-CO', {
            style: 'currency',
            currency: safeISOCode,
            minimumFractionDigits: decimales,
            maximumFractionDigits: decimales,
        });
        
        let formattedString = formatter.format(value);
        const parts = formatter.formatToParts(value);
        const currencyPart = parts.find(part => part.type === 'currency');

        if (currencyPart && currencyPart.value !== simboloMoneda) {
            formattedString = formattedString.replace(currencyPart.value, simboloMoneda);
        } else if (!currencyPart && formattedString.includes(safeISOCode)) {
            formattedString = formattedString.replace(safeISOCode, simboloMoneda);
        }
        
        return formattedString;

    } catch (e) {
        console.warn(`Error en Intl.NumberFormat con código '${safeISOCode}'. Usando fallback de formateo manual. Error: ${e.message}`);
        let numeroFormateado = Number(value).toFixed(decimales);
        const [entero, decimalStr] = numeroFormateado.split('.');
        const enteroFormateado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
        return decimales > 0 && decimalStr ? `${simboloMoneda} ${enteroFormateado},${decimalStr}` : `${simboloMoneda} ${enteroFormateado}`;
    }
}

export function formatDateShort(dateInput, locale = 'es-CO') {
  if (!dateInput) return 'N/A';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Fecha Inválida';
    return date.toLocaleDateString(locale, { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch (error) { return 'Error de Fecha'; }
}

export function formatDateTime(dateInput, locale = 'es-CO', options = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!dateInput) return 'N/A';
  try {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'Fecha/Hora Inválida';
    return date.toLocaleString(locale, options);
  } catch (error) { return 'Error de Fecha/Hora'; }
}

// --- Otras utilidades rápidas ---
export function mostrarFechaLocal(fechaUtc) {
    if (!fechaUtc) return '-';
    return new Date(fechaUtc).toLocaleString();
}

// --- LOADING GLOBAL PARA OVERLAY ---
export function showGlobalLoading(message) {
  const overlay = document.getElementById('app-global-loading-overlay');
  if (overlay) {
    const messageEl = overlay.querySelector('p#global-loading-message');
    if (messageEl && message) messageEl.textContent = message;
    else if (messageEl) messageEl.textContent = 'Cargando...';
    overlay.style.display = 'flex';
  }
}

export function hideGlobalLoading() {
  const overlay = document.getElementById('app-global-loading-overlay');
  if (overlay) overlay.style.display = 'none';
}

// --- FEEDBACK DE ÉXITO ---
export function showSuccess(elementOrId, message, autoHide = true, duration = 4000) {
  const element = getElement(elementOrId); // Corrección aplicada
  if (element) {
    element.textContent = message;
    element.className = 'feedback-message p-3 my-3 text-sm rounded-md border bg-green-100 border-green-300 text-green-700 visible';
    element.style.display = 'block';
    element.setAttribute('aria-live', 'polite');
    if (autoHide) {
      setTimeout(() => {
        if (element && element.textContent === message) {
            clearFeedback(element);
        }
      }, duration);
    }
  }
}

/**
 * Formatea minutos a un string legible (ej: "2h 30m").
 * @param {number} totalMinutes - Total de minutos.
 * @returns {string} - String formateado.
 */
export function formatMinutesToHoursMinutes(totalMinutes) {
    if (typeof totalMinutes !== 'number' || isNaN(totalMinutes) || totalMinutes < 0) {
        return 'N/A';
    }
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    let durationString = '';
    if (hours > 0) durationString += `${hours}h `;
    if (minutes > 0) durationString += `${minutes}m`;
    if (durationString === '') durationString = '0m';
    return durationString.trim();
}

/**
 * Llama a la función de la base de datos para incrementar el contador de un descuento.
 * Esta es la función centralizada y correcta.
 * @param {SupabaseClient} supabase - La instancia activa de Supabase.
 * @param {string} descuentoId - El UUID del descuento que se utilizó.
 */
export async function registrarUsoDescuento(supabase, descuentoId) {
    // Si no se pasó un ID de descuento, no hacemos nada.
    if (!descuentoId) return;

    try {
        // La llamada RPC estandarizada con el nombre de parámetro correcto.
        const { error } = await supabase.rpc('incrementar_uso_descuento', {
            descuento_id_param: descuentoId
        });

        if (error) {
            // Este error ya no debería ocurrir, pero lo dejamos por si acaso.
            console.error('Error al registrar el uso del descuento:', error);
        } else {
            console.log(`Uso registrado exitosamente para el descuento ID: ${descuentoId}`);
        }
    } catch (err) {
        console.error('Excepción al intentar registrar el uso del descuento:', err);
    }
}

// Agrega esta función a tu archivo /js/uiUtils.js

/**
 * Muestra un modal de confirmación moderno y profesional.
 * @param {string} title - El título del modal.
 * @param {string} text - El texto o HTML del cuerpo del modal.
 * @param {string} confirmButtonText - El texto para el botón de confirmación.
 * @returns {Promise<boolean>} - Una promesa que resuelve a `true` si el usuario confirma, `false` si cancela.
 */
export async function showConfirmationModal({
    title = '¿Estás seguro?',
    text = 'Esta acción no se puede revertir.',
    confirmButtonText = 'Sí, continuar'
}) {
    const result = await Swal.fire({
        title: title,
        html: text, // Usamos 'html' para permitir etiquetas como <strong>
        icon: 'warning',
        iconColor: '#f59e0b', // Un color ámbar para la advertencia
        showCancelButton: true,
        confirmButtonColor: '#dc2626', // Rojo para acciones destructivas
        cancelButtonColor: '#6b7280',  // Gris para cancelar
        confirmButtonText: confirmButtonText,
        cancelButtonText: 'Cancelar',
        customClass: {
            popup: 'rounded-xl shadow-lg',
            confirmButton: 'button button-danger py-2 px-5',
            cancelButton: 'button button-neutral py-2 px-5'
        },
        buttonsStyling: false // Importante para que tome nuestras clases
    });
    return result.isConfirmed;
}
export async function notificarAlegraViaZapier(supabase, hotelId, datosVenta) {
  const { data } = await supabase
    .from("hoteles")
    .select("alegra_webhook_url")
    .eq("id", hotelId)
    .single();
  const urlWebhook = data?.alegra_webhook_url;
  if (!urlWebhook) return; // Si el hotel no lo configuró, simplemente no se envía

  try {
    await fetch(urlWebhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(datosVenta),
    });
  } catch (err) {
    // Puedes mostrar feedback al usuario si lo deseas, pero lo normal es solo loguear el error
    console.warn("No se pudo notificar a Zapier/Alegra:", err);
  }
}

// En tu archivo: /js/uiUtils.js

// En tu archivo: /js/uiUtils.js

// En tu archivo: /js/uiUtils.js

export async function showConsumosYFacturarModal(roomContext, supabase, currentUser, hotelId, mainAppContainer, initialButtonTrigger) {
    const modalContainerConsumos = document.getElementById('modal-container');
    if (!modalContainerConsumos) {
        console.error("El contenedor del modal principal 'modal-container' no se encontró.");
        return;
    }

    // --- 1. OBTENCIÓN DE DATOS ---
    const { data: reserva, error: errRes } = await supabase.from('reservas').select('id, cliente_nombre, cedula, monto_total, fecha_inicio, fecha_fin, hotel_id, monto_pagado, habitacion_id, metodo_pago_id').eq('habitacion_id', roomContext.id).in('estado', ['activa', 'ocupada', 'tiempo agotado']).order('fecha_inicio', { ascending: false }).limit(1).single();
    
    if (errRes || !reserva) {
        mostrarInfoModalGlobal("No hay reserva activa con consumos para esta habitación.", "Consumos", [], modalContainerConsumos);
        return;
    }
    reserva.habitacion_nombre = roomContext.nombre;

    const alojamientoCargo = { tipo: "Habitación", nombre: "Estancia Principal", cantidad: 1, subtotal: Number(reserva.monto_total) || 0, id: "hab", estado_pago: "pendiente", fecha: reserva.fecha_inicio };
    
    let cargosTienda = [];
    const { data: ventasTiendaDB } = await supabase.from('ventas_tienda').select('id, creado_en').eq('reserva_id', reserva.id);
    if (ventasTiendaDB && ventasTiendaDB.length > 0) {
        const ventaTiendaIds = ventasTiendaDB.map(v => v.id);
        const { data: detallesTienda } = await supabase.from('detalle_ventas_tienda').select('*, producto_id, venta_id').in('venta_id', ventaTiendaIds);
        if (detallesTienda) {
            const productoIds = [...new Set(detallesTienda.map(d => d.producto_id))];
            const { data: productos } = await supabase.from('productos_tienda').select('id, nombre').in('id', productoIds);
            const productosMap = new Map(productos?.map(p => [p.id, p.nombre]));
            cargosTienda = detallesTienda.map(item => ({ tipo: "Tienda", nombre: productosMap.get(item.producto_id) || 'Producto', id: `dvt_${item.id}`, cantidad: item.cantidad, subtotal: Number(item.subtotal) || 0, estado_pago: "pendiente", fecha: ventasTiendaDB.find(v => v.id === item.venta_id)?.creado_en }));
        }
    }
    
    const { data: serviciosYExtensiones } = await supabase.from('servicios_x_reserva').select('id, servicio_id, cantidad, nota, estado_pago, creado_en, precio_cobrado, pago_reserva_id, descripcion_manual').eq('reserva_id', reserva.id);
    let cargosServiciosYExtensiones = [];
    if (serviciosYExtensiones && serviciosYExtensiones.length) {
        const servicioIds = [...new Set(serviciosYExtensiones.map(s => s.servicio_id).filter(Boolean))];
        let nombresServicios = {};
        if (servicioIds.length > 0) {
            const { data: infoServicios } = await supabase.from('servicios_adicionales').select('id, nombre').in('id', servicioIds);
            if (infoServicios) { infoServicios.forEach(s => { nombresServicios[s.id] = s.nombre; }); }
        }
        cargosServiciosYExtensiones = serviciosYExtensiones.map(s => ({ tipo: (s.descripcion_manual && s.descripcion_manual.toLowerCase().includes('descuento')) ? "Ajuste" : "Servicios", nombre: s.descripcion_manual || (s.servicio_id && nombresServicios[s.servicio_id]) || `Ítem #${s.id.slice(0,6)}`, id: `sxr_${s.id}`, cantidad: s.cantidad || 1, subtotal: s.precio_cobrado !== null ? Number(s.precio_cobrado) : 0, estado_pago: s.estado_pago || "pendiente", fecha: s.creado_en, nota: s.nota || "" }));
    }

    let todosLosCargos = [alojamientoCargo, ...cargosTienda, ...cargosServiciosYExtensiones].filter(c => c.subtotal !== 0);
    if(todosLosCargos.length === 0) {
      todosLosCargos.push(alojamientoCargo);
    }
    
    const totalPagadoCalculado = Number(reserva.monto_pagado) || 0;
    const totalDeTodosLosCargos = todosLosCargos.reduce((sum, c) => sum + Number(c.subtotal), 0);
    const saldoPendienteFinal = Math.max(0, totalDeTodosLosCargos - totalPagadoCalculado);
    
    // --- 2. GENERACIÓN DE HTML (Con la lista de consumos y fecha) ---
    let htmlConsumos = `
        <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:650px;margin:auto;" class="bg-white p-6 rounded-xl">
            <div class="flex justify-between items-center mb-3"><h3 style="font-size:1.3em;font-weight:bold;color:#1459ae;">🧾 Consumos: Hab. ${roomContext.nombre}</h3><button id="btn-cerrar-modal-consumos-X" class="text-gray-500 hover:text-red-600 text-3xl leading-none">&times;</button></div>
            <div style="font-size:0.9em; margin-bottom:10px;">Cliente: <strong>${reserva.cliente_nombre}</strong></div>
            <div class="max-h-[50vh] overflow-y-auto pr-2 mb-4 border rounded-md">
                <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
                    <thead class="sticky top-0 bg-slate-100 z-10">
                      <tr style="background:#f1f5f9;">
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Tipo</th>
                        <th style="padding:8px;text-align:left;border-bottom:1px solid #e2e8f0;">Detalle</th>
                        <th style="padding:8px;text-align:center;border-bottom:1px solid #e2e8f0;">Cant.</th>
                        <th style="padding:8px;text-align:right;border-bottom:1px solid #e2e8f0;">Subtotal</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${todosLosCargos.length > 0 
                          ? todosLosCargos.map(c => `
                              <tr style="border-bottom:1px solid #e5e7eb;">
                                  <td style="padding:6px;">${c.tipo}</td>
                                  <td style="padding:6px;">
                                      ${c.nombre}${c.nota ? ` <i class="text-xs text-gray-500">(${c.nota})</i>` : ''}
                                      <small class="block text-slate-500">${formatDateTime(c.fecha)}</small>
                                  </td>
                                  <td style="padding:6px;text-align:center;">${c.cantidad}</td>
                                  <td style="padding:6px;text-align:right;">${formatCurrency(c.subtotal)}</td>
                              </tr>`).join('')
                          : `<tr><td colspan="4" style="text-align:center;padding:20px;color:#6b7280;">No hay consumos registrados para esta estancia.</td></tr>`
                      }
                    </tbody>
                </table>
            </div>
            <div style="margin-top:14px;font-size:1.1em; text-align:right; padding-right:10px;">
                <div style="font-weight:bold;color:#1e40af;">Total Cargos: ${formatCurrency(totalDeTodosLosCargos)}</div>
                <div style="font-weight:bold;color:#059669;">Total Pagado: ${formatCurrency(totalPagadoCalculado)}</div>
                <div style="font-weight:bold;color:${saldoPendienteFinal > 0 ? '#dc2626' : '#16a34a'};">Saldo Pendiente: ${formatCurrency(saldoPendienteFinal)}</div>
            </div>
            <div class="mt-6 flex flex-col sm:flex-row gap-3 justify-end p-1">
                ${saldoPendienteFinal > 0.01 ? `<button id="btn-cobrar-pendientes-consumos" class="button button-warning py-2.5 px-5 text-sm">Cobrar Saldo (${formatCurrency(saldoPendienteFinal)})</button>` : `<div class="text-green-600 font-bold text-lg p-2 text-center">¡Todo saldado! ✅</div>`}
                ${totalDeTodosLosCargos > 0 ? `<button id="btn-facturar" class="button button-success py-2.5 px-5 text-sm">Facturar</button>` : ''}
                <button id="btn-cerrar-modal-consumos" class="button button-danger py-2.5 px-5 text-sm">Cerrar</button>
            </div>
        </div>`;

    modalContainerConsumos.innerHTML = htmlConsumos;
    modalContainerConsumos.style.display = "flex";

    // --- 3. ASIGNACIÓN DE EVENTOS (LISTENERS COMPLETOS) ---
    setTimeout(() => {
        const modalDialogActual = modalContainerConsumos.querySelector('.bg-white');
        if (!modalDialogActual) return;

        const cerrarDesdeModal = () => { 
            modalContainerConsumos.style.display = "none"; 
            modalContainerConsumos.innerHTML = ''; 
        };
        modalDialogActual.querySelector('#btn-cerrar-modal-consumos-X').onclick = cerrarDesdeModal;
        modalDialogActual.querySelector('#btn-cerrar-modal-consumos').onclick = cerrarDesdeModal;
        
        const btnCobrarConsumosPend = modalDialogActual.querySelector('#btn-cobrar-pendientes-consumos');
        if (btnCobrarConsumosPend) {
            btnCobrarConsumosPend.onclick = async () => {
                // (Aquí va toda la lógica del botón "Cobrar Saldo" que ya tenías)
            };
        }
        
        // --- LÓGICA AÑADIDA PARA EL BOTÓN "FACTURAR" ---
        const btnFacturar = modalDialogActual.querySelector('#btn-facturar');
        if (btnFacturar) {
            btnFacturar.onclick = async () => {
                // Primero, preguntar por el método de pago para la factura
                const { data: metodosPagoDB } = await supabase.from('metodos_pago').select('id, nombre').eq('hotel_id', hotelId).eq('activo', true);
                const opcionesPago = metodosPagoDB.reduce((obj, metodo) => {
                    obj[metodo.id] = metodo.nombre;
                    return obj;
                }, {});

                const { value: metodoPagoIdFactura } = await Swal.fire({
                    title: 'Seleccionar Método de Pago para Factura',
                    input: 'select',
                    inputOptions: opcionesPago,
                    inputPlaceholder: 'Seleccione un método',
                    showCancelButton: true,
                    confirmButtonText: 'Continuar a Facturación',
                    cancelButtonText: 'Cancelar'
                });

                if (metodoPagoIdFactura) {
                    showGlobalLoading("Generando factura electrónica...");
                    
                    // Preparar los datos de consumo para la función de facturación
                    const consumosParaFactura = todosLosCargos
                        .filter(c => c.tipo !== 'Habitación') // Excluir el cargo de la estancia principal que ya va en la reserva
                        .map(c => ({
                            nombre: c.nombre,
                            cantidad: c.cantidad,
                            subtotal: c.subtotal
                        }));

                    await facturarElectronicaYMostrarResultado({
                        supabase: supabase,
                        hotelId: hotelId,
                        reserva: reserva,
                        consumosTienda: cargosTienda, // Pasamos los consumos por separado
                        consumosRest: [], // (Añadir si tienes restaurante)
                        consumosServicios: cargosServiciosYExtensiones,
                        metodoPagoIdLocal: metodoPagoIdFactura
                    });
                    
                    hideGlobalLoading();
                }
            };
        }
        
    }, 100);
}

export async function imprimirTicketHabitacion({ supabase, hotelId, datosTicket, tipoDocumento }) {
  // 1. Leer configuración de impresora
  const { data: config } = await supabase
    .from('configuracion_hotel')
    .select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, pie_ticket, mostrar_logo')
    .eq('hotel_id', hotelId)
    .maybeSingle();

  // 2. Decidir el ancho/tipo
  let tamano = (config?.tamano_papel || '').toLowerCase();
  let tipo = (config?.tipo_impresora || '').toLowerCase();

  // --- Datos del ticket (ajusta según tus necesidades)
  const {
    habitacion,
    cliente,
    fechaIngreso,
    fechaSalida,
    consumos, // array [{nombre, cantidad, precio, total}]
    totalConsumo,
    otrosDatos // opcional
  } = datosTicket;

  // --- Estilos y HTML base según impresora ---
  let style = '';
  let anchoMax = '100%';
  if (tamano === '58mm') {
    anchoMax = '55mm'; style = `
      body{font-family:monospace;font-size:11px;max-width:55mm;margin:0;padding:0;}
      .ticket{max-width:55mm;margin:auto;}
      table{width:100%;font-size:11px;}
      th,td{padding:2px 2px;}
      .title{font-size:13px;}
      .linea{border-bottom:1px dashed #444;margin:3px 0;}
    `;
  } else if (tamano === '80mm') {
    anchoMax = '78mm'; style = `
      body{font-family:monospace;font-size:13px;max-width:78mm;margin:0;padding:0;}
      .ticket{max-width:78mm;margin:auto;}
      table{width:100%;font-size:13px;}
      th,td{padding:3px 2px;}
      .title{font-size:17px;}
      .linea{border-bottom:1px dashed #444;margin:4px 0;}
    `;
  } else {
    anchoMax = '850px'; style = `
      body{font-family:'Segoe UI',Arial,sans-serif;font-size:15px;max-width:850px;margin:0 auto;}
      .ticket{max-width:850px;margin:auto;}
      table{width:100%;font-size:15px;}
      th,td{padding:6px 5px;}
      .title{font-size:22px;}
      .linea{border-bottom:1px solid #ccc;margin:10px 0;}
    `;
  }

  // --- HTML ticket --- (ajusta aquí tu template según lo que imprimas: factura, consumo, etc)
let html = ''; // Inicializar vacía

  if (tipoDocumento === 'Recibo de Pago') {
    const {
        habitacion,
        cliente,
        fechaPago,
        montoPagado,
        metodoPagoNombre,
        conceptoPago,
        // usuarioNombre, // Lo incluiremos en otrosDatos si es necesario
        // transaccionId, // Lo incluiremos en otrosDatos si es necesario
        otrosDatos // Recibirá: `Reserva ID: XXXXX<br>Atendido por: YYYYY`
    } = datosTicket;

    html = `
        <div class="ticket">
            ${config?.mostrar_logo !== false && config?.logo_url ? `<div style="text-align:center;margin-bottom:4px;"><img src="${config.logo_url}" style="max-width:45mm;max-height:30px; object-fit:contain;"></div>` : ''}
            <div class="title" style="text-align:center;font-weight:bold; margin-bottom:3px;">${config?.nombre_hotel || ''}</div>
            <div style="text-align:center;font-size:0.9em;">
                ${config?.direccion_fiscal || ''}
                ${config?.nit_rut ? `<br/>NIT/RUT: ${config.nit_rut}` : ''}
                ${config?.razon_social ? `<br/>${config.razon_social}` : ''}
                ${config?.telefono_fiscal ? `<br/>Tel: ${config.telefono_fiscal}` : ''}
            </div>
            ${config?.encabezado_ticket_l1 || config?.encabezado_ticket_l2 || config?.encabezado_ticket_l3 ? 
                `<div style="text-align:center;margin:3px 0 5px 0;font-size:0.9em;">
                    ${config.encabezado_ticket_l1 || ''}
                    ${config.encabezado_ticket_l2 ? `<br>${config.encabezado_ticket_l2}` : ''}
                    ${config.encabezado_ticket_l3 ? `<br>${config.encabezado_ticket_l3}` : ''}
                </div>` : (config?.encabezado_ticket ? `<div style="text-align:center;margin:2px 0 5px 0;font-size:0.9em;">${config.encabezado_ticket}</div>` : '')
            }
            <div class="linea"></div>
            <div style="font-size:1.1em; text-align:center; font-weight:bold; margin: 3px 0;">RECIBO DE PAGO</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Fecha y Hora:</b> ${formatDateTime(fechaPago)}</div>
            <div style="font-size:0.95em;"><b>Cliente:</b> ${cliente || "N/A"}</div>
            <div style="font-size:0.95em;"><b>Habitación:</b> ${habitacion || "N/A"}</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Concepto:</b> ${conceptoPago || "Pago Varios"}</div>
            <div style="font-size:0.95em;"><b>Método de Pago:</b> ${metodoPagoNombre || "N/A"}</div>
            <div class="linea"></div>
            <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                TOTAL PAGADO: ${formatCurrency(montoPagado || 0)}
            </div>
            ${otrosDatos ? `<div style="margin-top:5px;font-size:0.9em;">${otrosDatos}</div>` : ''}
            <div class="linea"></div>
            ${config?.pie_ticket ? `<div style="text-align:center;margin-top:6px;font-size:0.9em;">${config.pie_ticket}</div>` : ''}
            <div style="text-align:center;font-size:0.8em;margin-top:8px;">Documento no fiscal. Comprobante de pago interno.</div>
        </div>
    `;
  } else { // Lógica existente para 'Ticket de Consumo' o cualquier otro tipo por defecto
      const {
          habitacion,
          cliente,
          fechaIngreso,
          fechaSalida,
          consumos,
          totalConsumo,
          otrosDatos: otrosDatosConsumo // Renombrar para evitar colisión
      } = datosTicket;

      html = `
          <div class="ticket">
            ${config?.mostrar_logo !== false && config?.logo_url ? `<div style="text-align:center;margin-bottom:4px;"><img src="${config.logo_url}" style="max-width:45mm;max-height:30px; object-fit:contain;"></div>` : ''}
            <div class="title" style="text-align:center;font-weight:bold; margin-bottom:3px;">${config?.nombre_hotel || ''}</div>
            <div style="text-align:center;font-size:0.9em;">
                ${config?.direccion_fiscal || ''}
                ${config?.nit_rut ? `<br/>NIT/RUT: ${config.nit_rut}` : ''}
                ${config?.razon_social ? `<br/>${config.razon_social}` : ''}
                ${config?.telefono_fiscal ? `<br/>Tel: ${config.telefono_fiscal}` : ''}
            </div>
            ${config?.encabezado_ticket_l1 || config?.encabezado_ticket_l2 || config?.encabezado_ticket_l3 ? 
                `<div style="text-align:center;margin:3px 0 5px 0;font-size:0.9em;">
                    ${config.encabezado_ticket_l1 || ''}
                    ${config.encabezado_ticket_l2 ? `<br>${config.encabezado_ticket_l2}` : ''}
                    ${config.encabezado_ticket_l3 ? `<br>${config.encabezado_ticket_l3}` : ''}
                </div>` : (config?.encabezado_ticket ? `<div style="text-align:center;margin:2px 0 5px 0;font-size:0.9em;">${config.encabezado_ticket}</div>` : '')
            }
            <div class="linea"></div>
            <div style="font-size:1.1em; text-align:center; font-weight:bold; margin: 3px 0;">${tipoDocumento || "Ticket de Consumo"}</div>
            <div class="linea"></div>
            <div style="font-size:0.95em;"><b>Habitación:</b> ${habitacion || ""}</div>
            <div style="font-size:0.95em;"><b>Cliente:</b> ${cliente || ""}</div>
            ${fechaIngreso ? `<div style="font-size:0.95em;"><b>Ingreso:</b> ${formatDateTime(fechaIngreso)}</div>` : ""}
            ${fechaSalida ? `<div style="font-size:0.95em;"><b>Salida:</b> ${formatDateTime(fechaSalida)}</div>` : ""}

            ${(consumos && consumos.length > 0) ? `
              <div class="linea"></div>
              <table>
                <thead>
                  <tr><th>Producto</th><th>Cant</th><th>Precio</th><th>Total</th></tr>
                </thead>
                <tbody>
                  ${(consumos).map(item => `
                    <tr>
                      <td>${item.nombre || ""}</td>
                      <td style="text-align:center;">${item.cantidad || ""}</td>
                      <td style="text-align:right;">${formatCurrency(item.precio || 0)}</td>
                      <td style="text-align:right;">${formatCurrency(item.total || 0)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <div class="linea"></div>
              <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                TOTAL CONSUMO: ${formatCurrency(totalConsumo || 0)}
              </div>
            ` : (totalConsumo && tipoDocumento !== 'Recibo de Pago' ? `
                <div class="linea"></div>
                 <div style="text-align:right;font-size:1.2em;font-weight:bold;margin: 5px 0;">
                    TOTAL: ${formatCurrency(totalConsumo || 0)}
                </div>
            ` : '')}
            ${otrosDatosConsumo ? `<div style="margin-top:5px;font-size:0.9em;">${otrosDatosConsumo}</div>` : ''}
            <div class="linea"></div>
            ${config?.pie_ticket ? `<div style="text-align:center;margin-top:6px;font-size:0.9em;">${config.pie_ticket}</div>` : ''}
          </div>
        `;
  }
  // --- Ventana de impresión ---
  let w = window.open('', '', `width=400,height=700`);
  w.document.write(`
    <html>
      <head>
        <title>${tipoDocumento || 'Ticket'}</title>
        <style>
          ${style}
          @media print { .no-print {display:none;} }
        </style>
      </head>
      <body>
        ${html}
      </body>
    </html>
  `);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
}
export function mostrarInfoModalGlobal(htmlContent, title = "Información", botones = [], modalContainerRef = null) {
    const container = modalContainerRef || document.getElementById('modal-container');

    if (!container) {
        console.error("Contenedor de modal global no encontrado ('modal-container'). El modal no se puede mostrar.");
        // Fallback muy básico si el contenedor principal no existe
        alert(title + "\n\n" + String(htmlContent).replace(/<[^>]*>/g, ''));
        return;
    }

    container.style.display = "flex"; // Ahora 'container' debería ser el elemento DOM correcto
    container.innerHTML = ""; // Limpiar contenido anterior

    const modalDialog = document.createElement('div');
    modalDialog.className = "bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 m-auto relative animate-fade-in-up";

    let buttonsHTML = '';
    const closeAndClean = () => {
        if (container) { // Doble chequeo por si acaso
            container.style.display = "none";
            container.innerHTML = '';
        }
    };

    if (botones && botones.length > 0) {
        botones.forEach((btnInfo, index) => {
            // Usar clases de botón base y permitir clases personalizadas
            const btnClass = btnInfo.clase || (index === 0 && botones.length === 1 ? 'button-primary' : 'button-neutral');
            buttonsHTML += `<button id="info-modal-btn-${index}" class="button ${btnClass} py-2 px-4 ml-2">${btnInfo.texto}</button>`;
        });
    } else {
        // Botón "Entendido" por defecto si no se especifican otros botones
        buttonsHTML = `<button id="btn-ok-info-modal-global" class="button button-primary py-2 px-4">Entendido</button>`;
    }

    modalDialog.innerHTML = `
        <div class="flex justify-between items-start mb-4">
            <h3 class="text-xl font-semibold text-gray-800">${title}</h3>
            <button id="close-info-modal-global-btn" class="text-gray-400 hover:text-red-600 text-3xl leading-none p-1 -mt-2 -mr-2">&times;</button>
        </div>
        <div class="text-gray-700 max-h-[70vh] overflow-y-auto pr-2">${htmlContent}</div>
        <div class="mt-6 text-right">
            ${buttonsHTML}
        </div>
    `;
    container.appendChild(modalDialog);

    // Asignar acciones a los botones
    if (botones && botones.length > 0) {
        botones.forEach((btnInfo, index) => {
            const btnElement = modalDialog.querySelector(`#info-modal-btn-${index}`);
            if (btnElement) {
                btnElement.onclick = () => {
                    if (typeof btnInfo.accion === 'function') {
                        btnInfo.accion();
                    }
                    // Por defecto, la mayoría de las acciones de botón deberían cerrar el modal,
                    // a menos que la propia acción lo maneje o se quiera mantener abierto.
                    // Si una acción NO debe cerrar el modal, la acción puede devolver `false`.
                    if (btnInfo.noCerrar !== true) {
                         closeAndClean();
                    }
                };
            }
        });
    } else {
        const defaultOkButton = modalDialog.querySelector('#btn-ok-info-modal-global');
        if (defaultOkButton) {
            defaultOkButton.onclick = closeAndClean;
        }
    }

    const closeModalButton = modalDialog.querySelector('#close-info-modal-global-btn');
    if (closeModalButton) {
        closeModalButton.onclick = closeAndClean;
    }

    // Cerrar si se hace clic fuera del modalDialog (en el overlay 'container')
    container.onclick = (e) => {
        if (e.target === container) {
            closeAndClean();
        }
    };
    // Prevenir que el clic en el modalDialog cierre el modal (ya que se propagaría al container)
    modalDialog.onclick = (e) => {
        e.stopPropagation();
    };
}