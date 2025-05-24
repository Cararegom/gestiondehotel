// js/modules/configuracion/configuracion.js

import {
  showLoading, showError, clearFeedback, showAppFeedback
} from '../../uiUtils.js';

// Estado global
let moduleListeners = [];
let currentSupabaseInstance = null;
let currentModuleUser = null;
let currentHotelId = null;
let metodosPagoCache = [];

// =============== SUBIR LOGO ===============
async function subirLogo(logoFile, hotelId, supabaseInst) {
  const fileName = `logos_hoteles/${hotelId}/${Date.now()}_${logoFile.name.replace(/\s/g, '_')}`;
  const { error } = await supabaseInst.storage
    .from('logos_hoteles')
    .upload(fileName, logoFile, { cacheControl: '3600', upsert: true });
  if (error) throw error;
  const { data: publicUrlData } = supabaseInst.storage.from('logos_hoteles').getPublicUrl(fileName);
  return publicUrlData?.publicUrl || null;
}

// =============== HTML PRINCIPAL ===============
function generarHTMLConfiguracion() {
  return `
    <div class="card configuracion-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b">
        <h2 class="text-xl font-semibold text-gray-800">Configuración del Hotel</h2>
      </div>
      <div class="card-body p-4 md:p-6">
        <div id="config-global-feedback" class="feedback-message mb-4" style="min-height: 24px;"></div>
        <form id="form-configuracion-hotel" novalidate class="space-y-6">
          <!-- ====== DATOS HOTEL ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Datos del Hotel</legend>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="hotel_nombre">Nombre del Hotel *</label>
                <input type="text" name="hotel_nombre" id="hotel_nombre" class="form-control mt-1" required />
              </div>
              <div>
                <label for="hotel_correo_institucional">Correo Institucional</label>
                <input type="email" name="hotel_correo_institucional" id="hotel_correo_institucional" class="form-control mt-1" />
              </div>
              <div class="md:col-span-2">
                <label for="hotel_direccion">Dirección</label>
                <input type="text" name="hotel_direccion" id="hotel_direccion" class="form-control mt-1" />
              </div>
              <div>
                <label for="hotel_telefonos">Teléfonos</label>
                <input type="text" name="hotel_telefonos" id="hotel_telefonos" class="form-control mt-1" />
              </div>
              <div>
                <label for="hotel_ciudad">Ciudad</label>
                <input type="text" name="hotel_ciudad" id="hotel_ciudad" class="form-control mt-1" />
              </div>
              <div>
                <label for="hotel_pais">País</label>
                <input type="text" name="hotel_pais" id="hotel_pais" class="form-control mt-1" />
              </div>
            </div>
          </fieldset>
          <!-- ====== IMPRESIÓN Y TICKETS ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Impresión y Tickets</legend>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label for="encabezado_ticket_l1">Encabezado Línea 1</label>
                <input name="encabezado_ticket_l1" id="encabezado_ticket_l1" class="form-control" />
              </div>
              <div>
                <label for="encabezado_ticket_l2">Encabezado Línea 2</label>
                <input name="encabezado_ticket_l2" id="encabezado_ticket_l2" class="form-control" />
              </div>
              <div>
                <label for="encabezado_ticket_l3">Encabezado Línea 3</label>
                <input name="encabezado_ticket_l3" id="encabezado_ticket_l3" class="form-control" />
              </div>
            </div>
            <div class="mt-4">
              <label for="pie_ticket">Pie de ticket</label>
              <input name="pie_ticket" id="pie_ticket" class="form-control" />
            </div>
            <div class="mt-4 flex items-center">
              <input type="checkbox" name="mostrar_logo_en_documentos" id="mostrar_logo_en_documentos" class="mr-2" />
              <label for="mostrar_logo_en_documentos">¿Mostrar logo en documentos?</label>
            </div>
          </fieldset>
          <!-- ====== IMPUESTOS Y FISCAL ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Impuestos y Fiscal</legend>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="nombre_impuesto_principal">Nombre Impuesto (Ej: IVA)</label>
                <input name="nombre_impuesto_principal" id="nombre_impuesto_principal" class="form-control" />
              </div>
              <div>
                <label for="porcentaje_impuesto_principal">Porcentaje Impuesto (%)</label>
                <input name="porcentaje_impuesto_principal" id="porcentaje_impuesto_principal" type="number" step="0.01" class="form-control" />
              </div>
              <div class="md:col-span-2 flex items-center mt-4">
                <input type="checkbox" name="impuestos_incluidos_en_precios" id="impuestos_incluidos_en_precios" class="mr-2" />
                <label for="impuestos_incluidos_en_precios">¿Precios incluyen impuestos?</label>
              </div>
              <div>
                <label for="nit_rut">NIT/RUT</label>
                <input name="nit_rut" id="nit_rut" class="form-control" />
              </div>
              <div>
                <label for="razon_social">Razón social</label>
                <input name="razon_social" id="razon_social" class="form-control" />
              </div>
              <div>
                <label for="regimen_tributario">Régimen tributario</label>
                <input name="regimen_tributario" id="regimen_tributario" class="form-control" />
              </div>
              <div>
                <label for="direccion_fiscal">Dirección fiscal</label>
                <input name="direccion_fiscal" id="direccion_fiscal" class="form-control" />
              </div>
              <div>
                <label for="telefono_fiscal">Teléfono fiscal</label>
                <input name="telefono_fiscal" id="telefono_fiscal" class="form-control" />
              </div>
            </div>
          </fieldset>
          <!-- ====== PISCINA ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Piscina</legend>
            <div class="flex items-center mb-4">
              <input type="checkbox" name="piscina_activada" id="piscina_activada" class="mr-2" />
              <label for="piscina_activada">¿Piscina activada?</label>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="piscina_horario_apertura">Horario apertura</label>
                <input type="time" name="piscina_horario_apertura" id="piscina_horario_apertura" class="form-control" />
              </div>
              <div>
                <label for="piscina_horario_cierre">Horario cierre</label>
                <input type="time" name="piscina_horario_cierre" id="piscina_horario_cierre" class="form-control" />
              </div>
            </div>
          </fieldset>
          <!-- ====== PREFERENCIAS GENERALES ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Preferencias Generales</legend>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label for="moneda_local">Moneda Principal (Ej: COP, USD) *</label>
                <input type="text" name="moneda_local" id="moneda_local" class="form-control" value="COP" required maxlength="3" />
              </div>
              <div>
                <label for="formato_fecha">Formato fecha (Ej: DD/MM/YYYY)</label>
                <input type="text" name="formato_fecha" id="formato_fecha" class="form-control" />
              </div>
              <div>
                <label for="formato_hora">Formato hora (Ej: HH:mm)</label>
                <input type="text" name="formato_hora" id="formato_hora" class="form-control" />
              </div>
              <div>
                <label for="idioma_predeterminado">Idioma predeterminado (Ej: es, en)</label>
                <input type="text" name="idioma_predeterminado" id="idioma_predeterminado" class="form-control" />
              </div>
            </div>
          </fieldset>
          <!-- ====== LEGALES ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Legales</legend>
            <div class="mb-4">
              <label for="politica_cancelacion">Política de Cancelación</label>
              <textarea name="politica_cancelacion" id="politica_cancelacion" class="form-control"></textarea>
            </div>
            <div>
              <label for="terminos_condiciones">Términos y condiciones</label>
              <textarea name="terminos_condiciones" id="terminos_condiciones" class="form-control"></textarea>
            </div>
          </fieldset>
          <!-- ====== LOGO HOTEL ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Logo del Hotel</legend>
            <div class="form-group">
              <label for="logo_uploader">Subir nuevo logo (PNG, JPG, max 2MB)</label>
              <input type="file" id="logo_uploader" name="logo_uploader_file" class="form-control mt-1" accept="image/png, image/jpeg">
              <img id="preview_logo" src="#" alt="Vista previa del logo" class="mt-3 max-h-32 rounded border" style="display:none;" />
              <p id="no_logo_message" class="text-sm text-gray-500 mt-2">No hay logo cargado actualmente.</p>
              <input type="hidden" id="logo_url_actual" name="logo_url_actual" />
            </div>
          </fieldset>
          <!-- ====== METODOS DE PAGO ====== -->
          <fieldset class="p-4 border rounded-md bg-gray-50">
            <legend class="text-lg font-medium text-gray-900 px-2 mb-2">Métodos de Pago</legend>
            <div style="margin-bottom:10px;">
              <input id="nuevo_metodo_pago" placeholder="Nuevo método de pago" style="padding:6px 12px;margin-right:8px;border-radius:4px;border:1px solid #ccc;width:220px;" />
              <button type="button" id="btnAgregarMetodoPago" style="background:#337ab7;color:#fff;padding:7px 15px;border:none;border-radius:4px;">Agregar</button>
            </div>
            <div id="metodosPagoLista"></div>
          </fieldset>
          <div id="config-feedback" class="feedback-message mt-4" style="min-height:24px;"></div>
          <div class="form-actions mt-6">
            <button type="submit" id="btn-guardar-configuracion" class="button button-primary py-2 px-4 rounded-md">Guardar Configuración</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// =============== CARGAR CONFIGURACION Y DATOS HOTEL ===============
async function cargarConfiguracion(formEl, hotelId, supabaseInst, feedbackGlobalEl) {
  if (!formEl) return;
  const feedbackFormEl = formEl.querySelector('#config-feedback');
  if (feedbackFormEl) showLoading(feedbackFormEl, 'Cargando configuración...');
  else if (feedbackGlobalEl) showAppFeedback(feedbackGlobalEl, 'Cargando configuración...', 'info', 0);
  try {
    // Configuración específica del hotel
    const { data: config, error: cfgError } = await supabaseInst
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();
    if (cfgError && cfgError.code !== 'PGRST116') throw cfgError;

    // Datos generales del hotel
    const { data: hotelData, error: hotelErr } = await supabaseInst
      .from('hoteles')
      .select('nombre, direccion, telefono, correo, ciudad, pais, logo_url')
      .eq('id', hotelId)
      .single();
    if (hotelErr) throw hotelErr;

    // Métodos de pago
    await cargarMetodosPago(hotelId, supabaseInst);
    renderMetodosPago();

    // Poblado de campos (igual que antes)
    const setVal = (name, val) => { if (formEl.elements[name]) formEl.elements[name].value = val || ''; };
    const setCheck = (name, val) => { if (formEl.elements[name]) formEl.elements[name].checked = !!val; };
    // HOTEL
    setVal('hotel_nombre', hotelData.nombre);
    setVal('hotel_correo_institucional', hotelData.correo);
    setVal('hotel_direccion', hotelData.direccion);
    setVal('hotel_telefonos', hotelData.telefono);
    setVal('hotel_ciudad', hotelData.ciudad);
    setVal('hotel_pais', hotelData.pais);

    // LOGO
    if (formEl.elements.logo_url_actual) {
      const preview = formEl.querySelector('#preview_logo');
      const noLogoMessage = formEl.querySelector('#no_logo_message');
      let logo_url = config?.logo_url || hotelData.logo_url || '';
      if (logo_url) {
        if (preview) preview.src = logo_url;
        if (preview) preview.style.display = 'block';
        formEl.elements.logo_url_actual.value = logo_url;
        if (noLogoMessage) noLogoMessage.style.display = 'none';
      } else {
        if (preview) { preview.src = '#'; preview.style.display = 'none'; }
        if (noLogoMessage) noLogoMessage.style.display = 'block';
        formEl.elements.logo_url_actual.value = '';
      }
    }

    // IMPRESIÓN / TICKETS
    setVal('encabezado_ticket_l1', config?.encabezado_ticket_l1);
    setVal('encabezado_ticket_l2', config?.encabezado_ticket_l2);
    setVal('encabezado_ticket_l3', config?.encabezado_ticket_l3);
    setVal('pie_ticket', config?.pie_ticket);
    setCheck('mostrar_logo_en_documentos', config?.mostrar_logo_en_documentos);

    // IMPUESTOS Y FISCAL
    setVal('nombre_impuesto_principal', config?.nombre_impuesto_principal);
    setVal('porcentaje_impuesto_principal', config?.porcentaje_impuesto_principal);
    setCheck('impuestos_incluidos_en_precios', config?.impuestos_incluidos_en_precios);
    setVal('nit_rut', config?.nit_rut);
    setVal('razon_social', config?.razon_social);
    setVal('regimen_tributario', config?.regimen_tributario);
    setVal('direccion_fiscal', config?.direccion_fiscal);
    setVal('telefono_fiscal', config?.telefono_fiscal);

    // PISCINA
    setCheck('piscina_activada', config?.piscina_activada);
    setVal('piscina_horario_apertura', config?.piscina_horario_apertura);
    setVal('piscina_horario_cierre', config?.piscina_horario_cierre);

    // PREFERENCIAS GENERALES
    setVal('moneda_local', config?.moneda_local || 'COP');
    setVal('formato_fecha', config?.formato_fecha);
    setVal('formato_hora', config?.formato_hora);
    setVal('idioma_predeterminado', config?.idioma_predeterminado);

    // LEGALES
    setVal('politica_cancelacion', config?.politica_cancelacion);
    setVal('terminos_condiciones', config?.terminos_condiciones);

    if (feedbackFormEl) clearFeedback(feedbackFormEl);
    else if (feedbackGlobalEl) showAppFeedback(feedbackGlobalEl, '', 'info', 0);
  } catch (err) {
    if (feedbackFormEl) showError(feedbackFormEl, `Error al cargar configuración: ${err.message}`);
    else if (feedbackGlobalEl) showAppFeedback(feedbackGlobalEl, `Error al cargar configuración: ${err.message}`, 'error', 0);
  }
}

// =============== MÉTODOS DE PAGO ===============
async function cargarMetodosPago(hotelId, supabaseInst) {
  let { data, error } = await supabaseInst
    .from('metodos_pago')
    .select('id, nombre, activo')
    .eq('hotel_id', hotelId);
  metodosPagoCache = data || [];
}

function renderMetodosPago() {
  const listaDiv = document.getElementById('metodosPagoLista');
  if (!listaDiv) return;
  if (metodosPagoCache.length === 0) {
    listaDiv.innerHTML = `<div style="color:#888;">No hay métodos de pago creados.</div>`;
    return;
  }
  listaDiv.innerHTML = `
    <ul style="list-style:none;padding:0;">
      ${metodosPagoCache.map(m=>`
        <li style="margin-bottom:6px;">
          <span style="display:inline-block;width:140px;">${m.nombre}</span>
          <button type="button" onclick="window.toggleMetodoPagoActivo('${m.id}', ${!m.activo})"
            style="margin-left:12px;color:${m.activo?'#25a325':'#c62c2c'};font-weight:bold;border:none;background:none;cursor:pointer;">
            ${m.activo ? 'Activo' : 'Inactivo'}
          </button>
          <button type="button" onclick="window.eliminarMetodoPago('${m.id}')" style="margin-left:10px;color:#e11;font-size:16px;border:none;background:none;cursor:pointer;">🗑️</button>
        </li>
      `).join('')}
    </ul>
  `;
}

window.toggleMetodoPagoActivo = async (id, activo) => {
  await currentSupabaseInstance.from('metodos_pago').update({activo}).eq('id',id);
  await cargarMetodosPago(currentHotelId, currentSupabaseInstance);
  renderMetodosPago();
};
window.eliminarMetodoPago = async (id) => {
  if (!confirm("¿Seguro de eliminar este método de pago?")) return;
  await currentSupabaseInstance.from('metodos_pago').delete().eq('id',id);
  await cargarMetodosPago(currentHotelId, currentSupabaseInstance);
  renderMetodosPago();
};

async function agregarMetodoPago() {
  const input = document.getElementById('nuevo_metodo_pago');
  if (!input.value.trim()) return;
  await currentSupabaseInstance.from('metodos_pago').insert([{
    hotel_id: currentHotelId,
    nombre: input.value.trim(),
    activo: true
  }]);
  input.value = '';
  await cargarMetodosPago(currentHotelId, currentSupabaseInstance);
  renderMetodosPago();
}

// =============== GUARDAR CONFIGURACION ===============
async function guardarConfiguracion(formEl, hotelId, supabaseInst, btnGuardarEl, feedbackFormEl, previewLogoEl, logoUrlActualInputEl) {
  const formData = new FormData(formEl);
  const datosHotel = {
    nombre: formData.get('hotel_nombre')?.trim() || null,
    correo: formData.get('hotel_correo_institucional')?.trim() || null,
    direccion: formData.get('hotel_direccion')?.trim() || null,
    telefono: formData.get('hotel_telefonos')?.trim() || null,
    ciudad: formData.get('hotel_ciudad')?.trim() || null,
    pais: formData.get('hotel_pais')?.trim() || null,
  };
  // Configuración completa
  const configuracionHotelPayload = {
    hotel_id: hotelId,
    actualizado_en: new Date().toISOString(),

    // Impresión/tickets
    encabezado_ticket_l1: formData.get('encabezado_ticket_l1')?.trim() || null,
    encabezado_ticket_l2: formData.get('encabezado_ticket_l2')?.trim() || null,
    encabezado_ticket_l3: formData.get('encabezado_ticket_l3')?.trim() || null,
    pie_ticket: formData.get('pie_ticket')?.trim() || null,
    mostrar_logo_en_documentos: formEl.elements.mostrar_logo_en_documentos.checked,

    // Impuestos y fiscal
    nombre_impuesto_principal: formData.get('nombre_impuesto_principal')?.trim() || null,
    porcentaje_impuesto_principal: formData.get('porcentaje_impuesto_principal') || null,
    impuestos_incluidos_en_precios: formEl.elements.impuestos_incluidos_en_precios.checked,
    nit_rut: formData.get('nit_rut')?.trim() || null,
    razon_social: formData.get('razon_social')?.trim() || null,
    regimen_tributario: formData.get('regimen_tributario')?.trim() || null,
    direccion_fiscal: formData.get('direccion_fiscal')?.trim() || null,
    telefono_fiscal: formData.get('telefono_fiscal')?.trim() || null,

    // Piscina
    piscina_activada: formEl.elements.piscina_activada.checked,
    piscina_horario_apertura: formData.get('piscina_horario_apertura') || null,
    piscina_horario_cierre: formData.get('piscina_horario_cierre') || null,

    // Preferencias generales
    moneda_local: formData.get('moneda_local')?.trim().toUpperCase() || 'COP',
    formato_fecha: formData.get('formato_fecha')?.trim() || null,
    formato_hora: formData.get('formato_hora')?.trim() || null,
    idioma_predeterminado: formData.get('idioma_predeterminado')?.trim() || null,

    // Legales
    politica_cancelacion: formData.get('politica_cancelacion')?.trim() || null,
    terminos_condiciones: formData.get('terminos_condiciones')?.trim() || null,
  };

  // Logo
  const logoInputEl = formEl.elements.logo_uploader;
  const logoFile = logoInputEl?.files?.[0];
  let newLogoUrl = logoUrlActualInputEl?.value || null;
  if (logoFile) {
    try {
      if (logoFile.size > 2 * 1024 * 1024) throw new Error("El logo supera los 2MB.");
      newLogoUrl = await subirLogo(logoFile, hotelId, supabaseInst);
      configuracionHotelPayload.logo_url = newLogoUrl;
      datosHotel.logo_url = newLogoUrl;
    } catch (err) {
      showError(feedbackFormEl, `Error al subir logo: ${err.message}`);
    }
  } else {
    configuracionHotelPayload.logo_url = newLogoUrl;
    datosHotel.logo_url = newLogoUrl;
  }
  // Guardar en DB
  try {
    await supabaseInst.from('hoteles').update(datosHotel).eq('id', hotelId);
    await supabaseInst.from('configuracion_hotel').upsert(configuracionHotelPayload, { onConflict: 'hotel_id' });
    showAppFeedback(feedbackFormEl, '¡Configuración guardada exitosamente!', 'success', true);
    if (logoUrlActualInputEl && newLogoUrl) logoUrlActualInputEl.value = newLogoUrl;
    if (previewLogoEl && newLogoUrl) previewLogoEl.src = newLogoUrl;
  } catch (err) {
    showAppFeedback(feedbackFormEl, `Error al guardar: ${err.message}`, 'error', true);
  }
}

// =============== MONTAJE PRINCIPAL ===============
export async function mount(container, supabaseInstance, user) {
  if (!container) return;
  unmount();
  container.innerHTML = generarHTMLConfiguracion();
  currentSupabaseInstance = supabaseInstance;
  currentModuleUser = user;
  currentHotelId = currentModuleUser?.user_metadata?.hotel_id;
  if (!currentHotelId && currentModuleUser?.id) {
    try {
      const { data: perfil } = await currentSupabaseInstance
        .from('usuarios').select('hotel_id').eq('id', currentModuleUser.id).single();
      currentHotelId = perfil?.hotel_id;
    } catch (e) {}
  }
  await cargarConfiguracion(
    container.querySelector('#form-configuracion-hotel'),
    currentHotelId,
    currentSupabaseInstance,
    container.querySelector('#config-global-feedback')
  );
  // Logo preview
  const logoInputEl = container.querySelector('#logo_uploader');
  const previewLogoEl = container.querySelector('#preview_logo');
  const noLogoMessageEl = container.querySelector('#no_logo_message');
  const logoUrlActualInputEl = container.querySelector('#logo_url_actual');
  if (logoInputEl) {
    const logoChangeHandler = e => {
      const file = e.target.files[0];
      if (file && (file.type === "image/png" || file.type === "image/jpeg")) {
        const reader = new FileReader();
        reader.onload = ev => {
          if (previewLogoEl) {
            previewLogoEl.src = ev.target.result;
            previewLogoEl.style.display = 'block';
          }
          if (noLogoMessageEl) noLogoMessageEl.style.display = 'none';
        };
        reader.readAsDataURL(file);
      } else {
        if (previewLogoEl) previewLogoEl.style.display = 'none';
        if (noLogoMessageEl) noLogoMessageEl.style.display = 'block';
      }
    };
    logoInputEl.addEventListener('change', logoChangeHandler);
    moduleListeners.push({ element: logoInputEl, type: 'change', handler: logoChangeHandler });
  }
  // Métodos de pago: Agregar
  const btnAgregarMetodoPago = container.querySelector('#btnAgregarMetodoPago');
  if (btnAgregarMetodoPago) {
    btnAgregarMetodoPago.onclick = agregarMetodoPago;
  }
  // Guardado config
  const formEl = container.querySelector('#form-configuracion-hotel');
  const feedbackFormEl = container.querySelector('#config-feedback');
  const btnGuardarEl = container.querySelector('#btn-guardar-configuracion');
  if (formEl && btnGuardarEl && logoInputEl && feedbackFormEl && logoUrlActualInputEl && previewLogoEl) {
    const formConfigSubmitHandler = async e => {
      e.preventDefault();
      btnGuardarEl.disabled = true;
      await guardarConfiguracion(formEl, currentHotelId, currentSupabaseInstance, btnGuardarEl, feedbackFormEl, previewLogoEl, logoUrlActualInputEl);
      btnGuardarEl.disabled = false;
    };
    formEl.addEventListener('submit', formConfigSubmitHandler);
    moduleListeners.push({ element: formEl, type: 'submit', handler: formConfigSubmitHandler });
  }
}
export function unmount() {
  moduleListeners.forEach(({ element, type, handler }) => {
    if (element && typeof element.removeEventListener === 'function') {
      element.removeEventListener(type, handler);
    }
  });
  moduleListeners = [];
  currentSupabaseInstance = null;
  currentModuleUser = null;
  currentHotelId = null;
}
