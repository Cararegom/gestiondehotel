// js/modules/configuracion/configuracion.js

// Instancias globales para Supabase, hotelId y usuario actual
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentUser = null;
let metodosPagoCache = [];

/**
 * Monta el módulo de configuración en el contenedor especificado.
 * @param {HTMLElement} container - El elemento contenedor donde se renderizará el módulo.
 * @param {object} supabase - La instancia del cliente Supabase.
 * @param {object} user - El objeto del usuario autenticado.
 * @param {string} hotelId - El ID del hotel actual.
 */
export async function mount(container, supabase, user, hotelId) {
  currentSupabaseInstance = supabase;
  currentHotelId = hotelId; // Se asigna el hotelId pasado desde main.js
  currentUser = user;

  // Estructura HTML del formulario de configuración (igual a la versión anterior)
  container.innerHTML = `
    <div class="max-w-5xl mx-auto p-6 sm:p-10 bg-white rounded-3xl shadow-2xl mt-6 border border-blue-100">
      <header class="mb-8 text-center">
        <h2 class="text-3xl font-extrabold text-blue-800 mb-2 flex items-center justify-center gap-3">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01-.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
          </svg>
          Configuración General del Hotel
        </h2>
        <p class="text-base text-blue-700">
          Define los parámetros operativos, fiscales y de personalización para tu establecimiento.
        </p>
      </header>

      <form id="config-form" class="space-y-10">

        <fieldset class="border-2 border-blue-200 p-6 rounded-xl shadow-md bg-blue-50/30">
          <legend class="text-xl font-semibold text-blue-700 px-3 py-1 bg-white border-2 border-blue-200 rounded-lg shadow-sm">
            <span class="mr-2">🏢</span>Información Fiscal y Contacto
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div><label for="nombre_hotel" class="form-label">Nombre del Hotel*</label><input name="nombre_hotel" id="nombre_hotel" class="form-control" required /></div>
            <div><label for="nit_rut" class="form-label">NIT/RUT*</label><input name="nit_rut" id="nit_rut" class="form-control" required /></div>
            <div><label for="razon_social" class="form-label">Razón Social</label><input name="razon_social" id="razon_social" class="form-control" /></div>
            <div><label for="direccion_fiscal" class="form-label">Dirección Fiscal*</label><input name="direccion_fiscal" id="direccion_fiscal" class="form-control" required /></div>
            <div><label for="telefono_fiscal" class="form-label">Teléfono Fiscal</label><input name="telefono_fiscal" id="telefono_fiscal" type="tel" class="form-control" /></div>
            <div><label for="regimen_tributario" class="form-label">Régimen Tributario</label><input name="regimen_tributario" id="regimen_tributario" class="form-control" placeholder="Ej: Común, Simplificado, Simple" /></div>
            <div><label for="correo_reportes" class="form-label">Correo para Reportes</label><input name="correo_reportes" id="correo_reportes" type="email" class="form-control" placeholder="reportes@hotel.com" /></div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-orange-200 p-6 rounded-xl shadow-md bg-orange-50/30">
          <legend class="text-xl font-semibold text-orange-700 px-3 py-1 bg-white border-2 border-orange-200 rounded-lg shadow-sm">
            <span class="mr-2">🍴</span>Impuestos Específicos del Restaurante
          </legend>
          <p class="form-helper-text mb-4">Usa esta sección para impuestos que solo aplican a ventas de restaurante, como el Impoconsumo en Colombia.</p>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div>
              <label for="impuesto_porcentaje_restaurante" class="form-label">Porcentaje Impuesto Restaurante (%)</label>
              <input name="impuesto_porcentaje_restaurante" id="impuesto_porcentaje_restaurante" type="number" step="0.01" min="0" max="100" class="form-control" placeholder="Ej: 8" />
            </div>
            <div>
              <label for="impuesto_nombre_restaurante" class="form-label">Nombre del Impuesto Restaurante</label>
              <input name="impuesto_nombre_restaurante" id="impuesto_nombre_restaurante" class="form-control" placeholder="Ej: Impoconsumo" />
            </div>
            <div class="md:col-span-2">
              <label for="impuesto_restaurante_incluido" class="form-label">¿Los precios del menú ya incluyen este impuesto?</label>
              <select name="impuesto_restaurante_incluido" id="impuesto_restaurante_incluido" class="form-control">
                <option value="false">No, el impuesto se suma al precio del plato</option>
                <option value="true">Sí, el impuesto está incluido en el precio del plato</option>
              </select>
            </div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-green-200 p-6 rounded-xl shadow-md bg-green-50/30">
          <legend class="text-xl font-semibold text-green-700 px-3 py-1 bg-white border-2 border-green-200 rounded-lg shadow-sm">
            <span class="mr-2">💳</span>Métodos de Pago
          </legend>
          <div class="mt-4">
            <div style="display:flex; justify-content:flex-end; margin-bottom: 1rem;">
                <button type="button" id="btnNuevoMetodoPago" class="button button-success">
                    + Agregar Método de Pago
                </button>
            </div>
            <div style="overflow-x:auto; background:#fff; border-radius:10px; border: 1px solid #e2e8f0;">
                <table style="width:100%; font-size:1em; border-collapse:collapse;">
                    <thead style="background:#f8fafc;">
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                            <th style="padding:12px; text-align:left; color: #475569;">Nombre del Método</th>
                            <th style="padding:12px; text-align:center; color: #475569;">Estado</th>
                            <th style="padding:12px; text-align:center; color: #475569;">Acciones</th>
                        </tr>
                    </thead>
                    <tbody id="bodyMetodosPago">
                        <tr><td colspan="3" style="padding: 1rem; text-align: center; color: #6b7280;">Cargando...</td></tr>
                    </tbody>
                </table>
            </div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-green-200 p-6 rounded-xl shadow-md bg-green-50/30">
          <legend class="text-xl font-semibold text-green-700 px-3 py-1 bg-white border-2 border-green-200 rounded-lg shadow-sm">
             <span class="mr-2">⏱️</span>Horarios y Política de Cobro
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div>
              <label for="checkin_hora_config" class="form-label">Hora Check-in Predeterminada</label>
              <input name="checkin_hora_config" id="checkin_hora_config" type="time" class="form-control" />
            </div>
            <div>
              <label for="checkout_hora_config" class="form-label">Hora Check-out Predeterminada</label>
              <input name="checkout_hora_config" id="checkout_hora_config" type="time" class="form-control" />
            </div>
            <div class="md:col-span-2">
              <label for="cobro_al_checkin" class="form-label">¿Cuándo se cobra la estancia principal?</label>
              <select name="cobro_al_checkin" id="cobro_al_checkin" class="form-control">
                <option value="true">Al ingresar (Check-in)</option>
                <option value="false">Al salir (Check-out)</option>
              </select>
              <p class="form-helper-text">Define si el sistema debe exigir el pago total de la estancia al momento del check-in.</p>
            </div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-yellow-200 p-6 rounded-xl shadow-md bg-yellow-50/30">
          <legend class="text-xl font-semibold text-yellow-700 px-3 py-1 bg-white border-2 border-yellow-200 rounded-lg shadow-sm">
            <span class="mr-2">📊</span>Impuestos y Precios
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div><label for="porcentaje_impuesto_principal" class="form-label">Porcentaje Impuesto Principal (%)</label><input name="porcentaje_impuesto_principal" id="porcentaje_impuesto_principal" type="number" step="0.01" min="0" max="100" class="form-control" placeholder="Ej: 19" /></div>
            <div><label for="nombre_impuesto_principal" class="form-label">Nombre del Impuesto Principal</label><input name="nombre_impuesto_principal" id="nombre_impuesto_principal" class="form-control" placeholder="Ej: IVA, INC" /></div>
            <div class="md:col-span-2">
              <label for="impuestos_incluidos_en_precios" class="form-label">¿Los precios base de habitaciones/productos ya incluyen este impuesto?</label>
              <select name="impuestos_incluidos_en_precios" id="impuestos_incluidos_en_precios" class="form-control">
                <option value="false">No, el impuesto se suma al precio base</option>
                <option value="true">Sí, el impuesto está incluido en el precio base</option>
              </select>
              <p class="form-helper-text">Si es 'Sí', el sistema desglosará el impuesto del precio mostrado. Si es 'No', lo sumará.</p>
            </div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-purple-200 p-6 rounded-xl shadow-md bg-purple-50/30">
          <legend class="text-xl font-semibold text-purple-700 px-3 py-1 bg-white border-2 border-purple-200 rounded-lg shadow-sm">
            <span class="mr-2">🎨</span>Personalización de Documentos
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div>
              <label for="logo_upload" class="form-label">Subir Logo del Hotel</label>
              <input name="logo_upload" id="logo_upload" type="file" class="form-control" accept="image/png, image/jpeg, image/webp, image/svg+xml" />
              <div id="logo-preview-container" class="mt-2">
                <img id="logo-preview" src="#" alt="Vista previa del logo" class="hidden max-h-20 rounded border p-1"/>
                <span id="current-logo-url" class="text-xs text-gray-500 block"></span>
              </div>
            </div>
            <div><label for="mostrar_logo" class="form-label">Mostrar Logo en Documentos</label><select name="mostrar_logo" id="mostrar_logo" class="form-control"><option value="true">Sí</option><option value="false">No</option></select></div>
            <div class="md:col-span-2"><label for="encabezado_ticket_l1" class="form-label">Encabezado Tickets/Facturas - Línea 1</label><input name="encabezado_ticket_l1" id="encabezado_ticket_l1" class="form-control" /></div>
            <div class="md:col-span-2"><label for="encabezado_ticket_l2" class="form-label">Encabezado Tickets/Facturas - Línea 2</label><input name="encabezado_ticket_l2" id="encabezado_ticket_l2" class="form-control" /></div>
            <div class="md:col-span-2"><label for="encabezado_ticket_l3" class="form-label">Encabezado Tickets/Facturas - Línea 3</label><input name="encabezado_ticket_l3" id="encabezado_ticket_l3" class="form-control" /></div>
            <div class="md:col-span-2"><label for="pie_ticket" class="form-label">Pie de Página para Tickets/Facturas</label><textarea name="pie_ticket" id="pie_ticket" rows="2" class="form-control" placeholder="Agradecimientos, información legal, resolución DIAN..."></textarea></div>
          </div>
        </fieldset>

        <fieldset class="border-2 border-teal-200 p-6 rounded-xl shadow-md bg-teal-50/30">
          <legend class="text-xl font-semibold text-teal-700 px-3 py-1 bg-white border-2 border-teal-200 rounded-lg shadow-sm">
            <span class="mr-2">💰</span>Configuración de Moneda
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-x-6 gap-y-5 mt-4">
            <div><label for="moneda_local_simbolo" class="form-label">Símbolo Moneda (para 'moneda_local')</label><input name="moneda_local_simbolo" id="moneda_local_simbolo" class="form-control" placeholder="Ej: $" /></div>
            <div><label for="moneda_codigo_iso_info" class="form-label">Código ISO (Info.)</label><input name="moneda_codigo_iso_info" id="moneda_codigo_iso_info" class="form-control" placeholder="Ej: COP" disabled title="Informativo." /></div>
            <div><label for="moneda_decimales_info" class="form-label">Nº Decimales (Info.)</label><select name="moneda_decimales_info" id="moneda_decimales_info" class="form-control" disabled title="Informativo."><option value="0">0</option><option value="2">2</option></select></div>
          </div>
           <p class="form-helper-text mt-3">Solo el 'Símbolo Moneda' se almacena en la columna 'moneda_local'. Los demás son informativos para el formato en la interfaz.</p>
        </fieldset>

        <fieldset class="border-2 border-gray-300 p-6 rounded-xl shadow-md bg-gray-50/30">
          <legend class="text-xl font-semibold text-gray-700 px-3 py-1 bg-white border-2 border-gray-300 rounded-lg shadow-sm">
            <span class="mr-2">📜</span>Políticas Generales
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div class="md:col-span-2"><label for="politica_cancelacion" class="form-label">Política de Cancelación</label><textarea name="politica_cancelacion" id="politica_cancelacion" rows="3" class="form-control" placeholder="Detalles..."></textarea></div>
            <div class="md:col-span-2"><label for="terminos_condiciones" class="form-label">Términos y Condiciones Generales</label><textarea name="terminos_condiciones" id="terminos_condiciones" rows="3" class="form-control" placeholder="Detalles..."></textarea></div>
          </div>
        </fieldset>
        
        <fieldset class="border-2 border-cyan-200 p-6 rounded-xl shadow-md bg-cyan-50/30">
          <legend class="text-xl font-semibold text-cyan-700 px-3 py-1 bg-white border-2 border-cyan-200 rounded-lg shadow-sm">
            <span class="mr-2">🖨️</span>Configuración de Impresión
          </legend>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5 mt-4">
            <div><label for="tamano_papel" class="form-label">Tamaño Papel Tickets</label><select name="tamano_papel" id="tamano_papel" class="form-control"><option value="58mm">58mm</option><option value="80mm">80mm</option><option value="carta">Carta/A4</option></select></div>
            <div><label for="tipo_impresora" class="form-label">Tipo de Impresora Principal</label><select name="tipo_impresora" id="tipo_impresora" class="form-control"><option value="termica">Térmica</option><option value="matricial">Matricial</option><option value="estandar">Estándar</option></select></div>
          </div>
        </fieldset>

        <div class="col-span-1 md:col-span-2 mt-10 flex justify-center">
          <button id="btn-guardar-config" class="button button-success text-lg px-12 py-3.5 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:scale-105">
            <span class="mr-2">💾</span>Guardar Configuración
          </button>
        </div>
      </form>
      <div id="config-feedback" class="text-center mt-8 text-lg font-semibold min-h-[30px]"></div>
    </div>

    <style>
      .form-label { display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 0.3rem; }
      .form-control { width: 100%; padding: 0.65rem 0.9rem; border-radius: 0.65rem; border: 2px solid #d1d5db; background-color: #f9fafb; transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out; font-size: 0.9rem; }
      .form-control:focus { border-color: #60a5fa; box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.3); outline: none; }
      .form-helper-text { font-size: 0.75rem; color: #6b7280; margin-top: 0.25rem; }
      .feedback-success { color: #16a34a; animation: fadeInOut 3s ease-in-out; }
      .feedback-error { color: #dc2626; animation: shake 0.5s ease-in-out; }
      @keyframes fadeInOut { 0%, 100% { opacity: 0; } 10%, 90% { opacity: 1; } }
      @keyframes shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-5px); } 75% { transform: translateX(5px); } }
      #logo-preview.hidden { display: none; }
    </style>
  `;

  await cargarConfiguracionHotel();
  await cargarMetodosPago();
  renderTablaMetodosPago();
  const btnNuevoMetodo = document.getElementById('btnNuevoMetodoPago');
  if (btnNuevoMetodo) {
    btnNuevoMetodo.onclick = () => showModalMetodoPago();
  }

  const logoUploadInput = document.getElementById('logo_upload');
  const logoPreview = document.getElementById('logo-preview');

  if (logoUploadInput && logoPreview) {
    logoUploadInput.addEventListener('change', function(event) {
      const file = event.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(e) {
          logoPreview.src = e.target.result;
          logoPreview.classList.remove('hidden');
        }
        reader.readAsDataURL(file);
      } else {
        logoPreview.classList.add('hidden');
        logoPreview.src = "#";
      }
    });
  }

  const btnGuardar = document.getElementById('btn-guardar-config');
  if (btnGuardar) {
    btnGuardar.onclick = async (e) => {
      e.preventDefault();
      await guardarConfiguracionHotel();
    };
  }
}

async function cargarConfiguracionHotel() {
  if (!currentSupabaseInstance) {
      console.error("Supabase client no inicializado en cargarConfiguracionHotel.");
      const feedbackEl = document.getElementById('config-feedback');
      if(feedbackEl) {
          feedbackEl.textContent = 'Error crítico: Cliente Supabase no disponible.';
          feedbackEl.className = 'feedback-error text-sm';
      }
      return;
  }
  if (!currentHotelId) {
    const feedbackEl = document.getElementById('config-feedback');
    if(feedbackEl) {
        feedbackEl.textContent = 'Error: No se pudo identificar el hotel para cargar la configuración. Módulo deshabilitado.';
        feedbackEl.className = 'feedback-error text-sm';
    }
    console.error("Error crítico en cargarConfiguracionHotel: currentHotelId es nulo o indefinido.");
    const formToDisable = document.getElementById('config-form');
    if (formToDisable) {
        Array.from(formToDisable.elements).forEach(el => el.disabled = true);
    }
    return;
  }

  const { data, error } = await currentSupabaseInstance
    .from('configuracion_hotel')
    .select('*')
    .eq('hotel_id', currentHotelId)
    .maybeSingle();

  if (error) {
    console.error("Error cargando configuración del hotel:", error);
    const feedbackEl = document.getElementById('config-feedback');
    if(feedbackEl) {
        feedbackEl.textContent = `Error al cargar configuración: ${error.message}`;
        feedbackEl.className = 'feedback-error text-sm';
    }
    return;
  }

  const form = document.getElementById('config-form');
  if (!form) return;
  const logoPreview = document.getElementById('logo-preview');
  const currentLogoUrlSpan = document.getElementById('current-logo-url');

  if (data) {
    form.nombre_hotel.value = data.nombre_hotel || '';
    form.nit_rut.value = data.nit_rut || '';
    form.razon_social.value = data.razon_social || '';
    form.direccion_fiscal.value = data.direccion_fiscal || '';
    form.telefono_fiscal.value = data.telefono_fiscal || '';
    form.regimen_tributario.value = data.regimen_tributario || '';
    form.correo_reportes.value = data.correo_reportes || data.correos_reportes || '';
     form.impuesto_porcentaje_restaurante.value = data.impuesto_porcentaje_restaurante !== null ? data.impuesto_porcentaje_restaurante : '';
    form.impuesto_nombre_restaurante.value = data.impuesto_nombre_restaurante || '';
    form.impuesto_restaurante_incluido.value = (data.impuesto_restaurante_incluido === true) ? "true" : "false";

    form.checkin_hora_config.value = data.checkin_hora_config || '15:00';
    form.checkout_hora_config.value = data.checkout_hora_config || '12:00';


    if (data.hasOwnProperty('cobro_al_checkin')) {
        form.cobro_al_checkin.value = (data.cobro_al_checkin === true) ? "true" : "false";
    } else {
        form.cobro_al_checkin.value = "true"; 
        console.warn("Advertencia: La columna 'cobro_al_checkin' no fue encontrada en los datos. Usando valor por defecto 'true'.");
    }
    
    form.porcentaje_impuesto_principal.value = data.porcentaje_impuesto_principal !== null ? data.porcentaje_impuesto_principal : '';
    form.nombre_impuesto_principal.value = data.nombre_impuesto_principal || '';
    form.impuestos_incluidos_en_precios.value = (data.impuestos_incluidos_en_precios === true) ? "true" : "false";

    form.encabezado_ticket_l1.value = data.encabezado_ticket_l1 || '';
    form.encabezado_ticket_l2.value = data.encabezado_ticket_l2 || '';
    form.encabezado_ticket_l3.value = data.encabezado_ticket_l3 || '';
    form.pie_ticket.value = data.pie_ticket || '';
    
    if (data.logo_url && logoPreview) {
        logoPreview.src = data.logo_url;
        logoPreview.classList.remove('hidden');
        if(currentLogoUrlSpan) currentLogoUrlSpan.textContent = `Logo actual: ${data.logo_url.substring(data.logo_url.lastIndexOf('/') + 1)}`;
    } else {
        if(logoPreview) logoPreview.classList.add('hidden');
        if(currentLogoUrlSpan) currentLogoUrlSpan.textContent = 'No hay logo configurado.';
    }

    form.mostrar_logo.value = (data.mostrar_logo === true || (data.mostrar_logo === null && data.mostrar_logo_en_documentos === true)) ? "true" : "false";
    form.moneda_local_simbolo.value = data.moneda_local || '$';
    
    form.moneda_codigo_iso_info.value = data.codigo_moneda_iso || 'COP'; 
    form.moneda_decimales_info.value = (data.cantidad_decimales_moneda !== null && typeof data.cantidad_decimales_moneda !== 'undefined') 
                                        ? data.cantidad_decimales_moneda.toString() 
                                        : '0';


    form.politica_cancelacion.value = data.politica_cancelacion || '';
    form.terminos_condiciones.value = data.terminos_condiciones || '';
    form.tamano_papel.value = data.tamano_papel || '80mm';
    form.tipo_impresora.value = data.tipo_impresora || 'termica';

  } else { 
    form.checkin_hora_config.value = '15:00';
    form.checkout_hora_config.value = '12:00';
    form.cobro_al_checkin.value = "true";
    form.impuestos_incluidos_en_precios.value = "false";
    form.moneda_local_simbolo.value = '$';
    form.moneda_codigo_iso_info.value = 'COP';
    form.moneda_decimales_info.value = '0';
    form.mostrar_logo.value = "true";
    form.tamano_papel.value = '80mm';
    form.tipo_impresora.value = 'termica';
    if(logoPreview) logoPreview.classList.add('hidden');
    if(currentLogoUrlSpan) currentLogoUrlSpan.textContent = 'No hay logo configurado.';
    console.log("No se encontró configuración existente para el hotel. Se usarán valores por defecto en el formulario.");
  }
}



async function guardarConfiguracionHotel() {
  const feedbackEl = document.getElementById('config-feedback');
  if (!feedbackEl) return;
  feedbackEl.textContent = 'Guardando...';
  feedbackEl.className = 'text-blue-600 font-semibold';

  const form = document.getElementById('config-form');
  if (!form) { feedbackEl.textContent = 'Error: Formulario no encontrado.'; feedbackEl.className = 'feedback-error'; return; }

  const logoUploadInput = document.getElementById('logo_upload');
  const logoFile = logoUploadInput.files[0];
  let logoUrlParaGuardar = document.getElementById('logo-preview').src;
  if (logoUrlParaGuardar === window.location.href + "#" || logoUrlParaGuardar === '#') { 
      const currentLogoSpan = document.getElementById('current-logo-url');
      if (currentLogoSpan && currentLogoSpan.textContent.startsWith('Logo actual:') && !logoFile) {
          logoUrlParaGuardar = undefined; 
      } else {
          logoUrlParaGuardar = null;
      }
  }


  if (logoFile) {
      const fileName = `logos/logo_hotel_${currentHotelId}_${Date.now()}_${logoFile.name.replace(/\s+/g, '_')}`;
      const { data: uploadData, error: uploadError } = await currentSupabaseInstance.storage
        .from('hotel-logos') 
        .upload(fileName, logoFile, { cacheControl: '3600', upsert: true });

      if (uploadError) {
        console.error("Error subiendo logo:", uploadError);
        feedbackEl.textContent = `Error al subir el logo: ${uploadError.message}`;
        feedbackEl.className = 'feedback-error';
        return; 
      }
      const { data: publicUrlData } = currentSupabaseInstance.storage.from('hotel-logos').getPublicUrl(fileName);
      logoUrlParaGuardar = publicUrlData.publicUrl;
  }


  const configHotelData = {
    hotel_id: currentHotelId,
    nombre_hotel: form.nombre_hotel.value.trim(),
    nit_rut: form.nit_rut.value.trim(),
    razon_social: form.razon_social.value.trim() || null,
    direccion_fiscal: form.direccion_fiscal.value.trim(),
    telefono_fiscal: form.telefono_fiscal.value.trim() || null,
    regimen_tributario: form.regimen_tributario.value.trim() || null,
    correo_reportes: form.correo_reportes.value.trim() || null,
    checkin_hora_config: form.checkin_hora_config.value || null,
    checkout_hora_config: form.checkout_hora_config.value || null,
    cobro_al_checkin: form.cobro_al_checkin.value === "true",
    porcentaje_impuesto_principal: parseFloat(form.porcentaje_impuesto_principal.value) || 0,
    nombre_impuesto_principal: form.nombre_impuesto_principal.value.trim() || null,
    impuestos_incluidos_en_precios: form.impuestos_incluidos_en_precios.value === "true",
    impuesto_porcentaje_restaurante: parseFloat(form.impuesto_porcentaje_restaurante.value) || 0,
    impuesto_nombre_restaurante: form.impuesto_nombre_restaurante.value.trim() || null,
    impuesto_restaurante_incluido: form.impuesto_restaurante_incluido.value === "true",
    encabezado_ticket_l1: form.encabezado_ticket_l1.value.trim() || null,
    encabezado_ticket_l2: form.encabezado_ticket_l2.value.trim() || null,
    encabezado_ticket_l3: form.encabezado_ticket_l3.value.trim() || null,
    pie_ticket: form.pie_ticket.value.trim() || null,
    mostrar_logo: form.mostrar_logo.value === "true",
    moneda_local: form.moneda_local_simbolo.value.trim() || '$',
    politica_cancelacion: form.politica_cancelacion.value.trim() || null,
    terminos_condiciones: form.terminos_condiciones.value.trim() || null,
    tamano_papel: form.tamano_papel.value || '80mm',
    tipo_impresora: form.tipo_impresora.value || 'termica',
    actualizado_en: new Date().toISOString(),
  };

  if (logoUrlParaGuardar !== undefined) {
    configHotelData.logo_url = logoUrlParaGuardar;
  }
  
  for (const key in configHotelData) {
      if (configHotelData[key] === '') {
          if (typeof configHotelData[key] !== 'boolean' && key !== 'porcentaje_impuesto_principal') {
             configHotelData[key] = null;
          }
      }
  }

  if (!configHotelData.nombre_hotel || !configHotelData.nit_rut || !configHotelData.direccion_fiscal) {
    feedbackEl.textContent = 'Error: Nombre del hotel, NIT/RUT y Dirección Fiscal son obligatorios.';
    feedbackEl.className = 'feedback-error';
    return;
  }

  const { data: upsertData, error: errorConfig } = await currentSupabaseInstance
    .from('configuracion_hotel')
    .upsert(configHotelData, { onConflict: 'hotel_id' }) 
    .select();

  if (errorConfig) {
    console.error("Error guardando configuración del hotel:", errorConfig);
    feedbackEl.textContent = `Error al guardar configuración: ${errorConfig.message}`;
    feedbackEl.className = 'feedback-error';
    return;
  }

  // --- SECCIÓN DE FACTURACIÓN ELECTRÓNICA ELIMINADA ---
  // La lógica para guardar el proveedor_fe, usuario_fe, etc., ha sido removida.

  feedbackEl.textContent = '¡Configuración guardada exitosamente!';
  feedbackEl.className = 'feedback-success';

  setTimeout(() => {
    if (feedbackEl.className !== 'feedback-error') { 
        feedbackEl.textContent = '';
        feedbackEl.className = 'text-center mt-8 text-lg font-semibold min-h-[30px]';
    }
  }, 3500);
}

/**
 * Carga los métodos de pago desde la base de datos y los guarda en el caché.
 */
async function cargarMetodosPago() {
    try {
        let { data, error } = await currentSupabaseInstance
            .from('metodos_pago')
            .select('*')
            .eq('hotel_id', currentHotelId)
            .order('nombre', { ascending: true });

        if (error) throw error;
        metodosPagoCache = data || [];
    } catch (err) {
        console.error("Error cargando métodos de pago:", err);
        const tbody = document.getElementById('bodyMetodosPago');
        if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-center text-red-500 p-4">Error al cargar métodos de pago.</td></tr>`;
    }
}

/**
 * Dibuja la tabla con los datos del caché.
 */
function renderTablaMetodosPago() {
    let tbody = document.getElementById('bodyMetodosPago');
    if (!tbody) return;

    if (metodosPagoCache.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="padding: 1rem; text-align: center; color: #6b7280;">No hay métodos de pago creados.</td></tr>`;
        return;
    }

    tbody.innerHTML = '';
    metodosPagoCache.forEach(metodo => {
        let tr = document.createElement('tr');
        tr.style.borderTop = '1px solid #f1f5f9';
        tr.innerHTML = `
            <td style="padding:12px 14px; font-weight:600; color:#1e293b;">
                ${metodo.nombre}
            </td>
            <td style="padding:12px 14px; text-align:center;">
                <span style="display:inline-block; padding:5px 16px; border-radius:9999px; font-size:0.8rem; font-weight:700;
                    ${metodo.activo ? 'background:#dcfce7; color:#15803d;' : 'background:#fee2e2; color:#b91c1c;'}">
                    ${metodo.activo ? 'Activo' : 'Inactivo'}
                </span>
            </td>
            <td style="padding:12px 14px; text-align:center;">
                <button onclick="showModalMetodoPago('${metodo.id}')" title="Editar" class="button-icon bg-blue-100 text-blue-700 hover:bg-blue-200">
                    ✏️
                </button>
                <button onclick="toggleEstadoMetodoPago('${metodo.id}', ${!metodo.activo})" title="${metodo.activo ? 'Desactivar' : 'Activar'}" class="button-icon ${metodo.activo ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}">
                    ${metodo.activo ? '❌' : '✅'}
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

/**
 * Muestra el modal para crear o editar un método de pago.
 */
function showModalMetodoPago(metodoId = null) {
    const metodo = metodoId ? metodosPagoCache.find(m => m.id === metodoId) : null;
    const esEdicion = metodoId ? true : false;

    const modalContainer = document.createElement('div');
    modalContainer.id = 'dynamic-modal-container';
    modalContainer.className = "fixed inset-0 z-[1001] flex items-center justify-center bg-black/60 p-4";

    modalContainer.innerHTML = `
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up">
            <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">${esEdicion ? 'Editar' : 'Nuevo'} Método de Pago</h3>
            <form id="form-metodo-pago">
                <div>
                    <label for="metodoNombreInput" class="form-label">Nombre del Método*</label>
                    <input id="metodoNombreInput" class="form-control" placeholder="Ej: Nequi, Tarjeta de Crédito" value="${metodo?.nombre || ''}" required>
                </div>
                <div class="flex gap-3 mt-6">
                    <button type="button" id="btn-cancelar-modal" class="button button-neutral flex-1">Cancelar</button>
                    <button type="submit" class="button button-success flex-1">${esEdicion ? 'Actualizar' : 'Crear'}</button>
                </div>
            </form>
        </div>
    `;
    document.body.appendChild(modalContainer);

    const form = modalContainer.querySelector('#form-metodo-pago');
    const closeModal = () => document.body.removeChild(modalContainer);

    modalContainer.querySelector('#btn-cancelar-modal').onclick = closeModal;
    modalContainer.addEventListener('click', (e) => {
        if (e.target === modalContainer) closeModal();
    });

    form.onsubmit = async (e) => {
        e.preventDefault();
        await saveMetodoPago(metodoId, form.querySelector('#metodoNombreInput').value);
        closeModal();
    };
}

/**
 * Guarda los cambios en la base de datos.
 */
async function saveMetodoPago(metodoId, nombre) {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) {
        alert("El nombre del método de pago es obligatorio.");
        return;
    }

    const datos = {
        hotel_id: currentHotelId,
        nombre: nombreLimpio,
        actualizado_en: new Date().toISOString(),
    };

    try {
        if (metodoId) {
            const { error } = await currentSupabaseInstance.from('metodos_pago').update(datos).eq('id', metodoId);
            if (error) throw error;
        } else {
            datos.creado_en = new Date().toISOString();
            datos.activo = true;
            const { error } = await currentSupabaseInstance.from('metodos_pago').insert([datos]);
            if (error) throw error;
        }
        await cargarMetodosPago();
        renderTablaMetodosPago();
    } catch (error) {
        console.error("Error guardando método de pago:", error);
        alert("Error al guardar el método de pago: " + error.message);
    }
}

/**
 * Cambia el estado (activo/inactivo) de un método de pago.
 */
async function toggleEstadoMetodoPago(id, nuevoEstado) {
    try {
        const { error } = await currentSupabaseInstance
            .from('metodos_pago')
            .update({ activo: nuevoEstado, actualizado_en: new Date().toISOString() })
            .eq('id', id);
        if (error) throw error;
        await cargarMetodosPago();
        renderTablaMetodosPago();
    } catch (error) {
        console.error("Error cambiando estado del método de pago:", error);
        alert("No se pudo cambiar el estado: " + error.message);
    }
}