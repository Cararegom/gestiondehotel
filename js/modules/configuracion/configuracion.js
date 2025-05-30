// js/modules/configuracion/configuracion.js

let supabase = null;
let hotelId = null;
let configActual = null;

export async function mount(container, supabaseClient, currentUser, currentHotelId) {
  supabase = supabaseClient;
  hotelId = currentHotelId;
  container.innerHTML = generarHTML();

  // Cargar datos previos si existen
  await cargarConfiguracionInicial();
  await cargarMetodosPago();

  // Eventos configuración hotel
  document.getElementById('config-form').addEventListener('submit', guardarConfiguracion);
  document.querySelector('input[name="logo"]').addEventListener('change', mostrarVistaPreviaLogo);

  // Eventos Métodos de Pago
  document.getElementById('nuevo-metodo-pago-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('nuevo-metodo-pago').value.trim();
    if (!nombre) return;
    await supabase.from('metodos_pago').insert([{ hotel_id: hotelId, nombre, activo: true }]);
    document.getElementById('nuevo-metodo-pago').value = '';
    cargarMetodosPago();
  });

  document.getElementById('lista-metodos-pago').addEventListener('change', async (e) => {
    if (e.target.classList.contains('toggle-activo-metodo')) {
      const id = e.target.dataset.metodoId;
      await supabase.from('metodos_pago').update({ activo: e.target.checked }).eq('id', id);
      cargarMetodosPago();
    }
  });

  document.getElementById('lista-metodos-pago').addEventListener('click', async (e) => {
    if (e.target.classList.contains('borrar-metodo-pago')) {
      const id = e.target.dataset.metodoId;
      if (confirm('¿Seguro que deseas borrar este método de pago?')) {
        await supabase.from('metodos_pago').delete().eq('id', id);
        cargarMetodosPago();
      }
    }
  });
}

// ======= GENERAR HTML =======
function generarHTML() {
  return `
  <div class="max-w-3xl mx-auto bg-gradient-to-br from-blue-50 to-white shadow-2xl rounded-3xl overflow-hidden my-8 border border-blue-100">
    <div class="bg-blue-800 p-7 flex items-center gap-3">
      <span class="inline-block bg-white bg-opacity-20 p-2 rounded-xl">
        <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L6 21m0 0l-3.75-4m3.75 4V3m7.5 0v18m0 0l3.75-4m-3.75 4l3.75-4M18 3v18"></path></svg>
      </span>
      <h2 class="text-3xl font-bold text-white tracking-tight">Configuración General del Hotel</h2>
    </div>
    <form id="config-form" class="p-8 bg-white grid grid-cols-1 md:grid-cols-2 gap-7">
      
      <div class="col-span-2">
        <h3 class="text-blue-700 text-lg font-semibold mb-1 flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M3 21v-2a4 4 0 014-4h10a4 4 0 014 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          Datos Generales
        </h3>
      </div>
      <div>
        <label class="block font-medium mb-1">Nombre del Hotel</label>
        <input name="nombre_hotel" class="input w-full bg-blue-50 rounded-xl px-4 py-2" required />
      </div>
      <div>
        <label class="block font-medium mb-1">Teléfono</label>
        <input name="telefono_fiscal" class="input w-full bg-blue-50 rounded-xl px-4 py-2" />
      </div>
      <div class="col-span-2">
        <label class="block font-medium mb-1">Dirección</label>
        <input name="direccion_fiscal" class="input w-full bg-blue-50 rounded-xl px-4 py-2" />
      </div>

      <div class="col-span-2 border-t pt-5 mt-1">
        <h3 class="text-blue-700 text-lg font-semibold mb-1 flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M9 17v-2a4 4 0 014-4h2a4 4 0 014 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          Datos Fiscales
        </h3>
      </div>
      <div>
        <label class="block font-medium mb-1">NIT / RUT</label>
        <input name="nit_rut" class="input w-full bg-blue-50 rounded-xl px-4 py-2" />
      </div>
      <div>
        <label class="block font-medium mb-1">Razón Social</label>
        <input name="razon_social" class="input w-full bg-blue-50 rounded-xl px-4 py-2" />
      </div>

      <div class="col-span-2 border-t pt-5 mt-1">
        <h3 class="text-blue-700 text-lg font-semibold mb-1 flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 00.33 1.82c.63.63 1.71.18 1.71-.7V7.88A1.65 1.65 0 0019.4 9M4.6 9a1.65 1.65 0 00-.33-1.82c-.63-.63-1.71-.18-1.71.7v8.25c0 .88 1.08 1.33 1.71.7A1.65 1.65 0 004.6 15"></path></svg>
          Preferencias y Documentos
        </h3>
      </div>
      <div>
        <label class="block font-medium mb-1">Moneda Local</label>
        <input name="moneda_local" class="input w-full bg-blue-50 rounded-xl px-4 py-2" placeholder="Ej: COP, USD, EUR" />
      </div>
      <div>
        <label class="block font-medium mb-1">Tipo de Impresora</label>
        <select name="tipo_impresora" class="input w-full bg-blue-50 rounded-xl px-4 py-2">
          <option value="termica">Térmica</option>
          <option value="carta">Tamaño carta</option>
        </select>
      </div>
      <div>
        <label class="block font-medium mb-1">Tamaño de Papel</label>
        <select name="tamano_papel" class="input w-full bg-blue-50 rounded-xl px-4 py-2">
          <option value="80mm">80mm (Térmica)</option>
          <option value="58mm">58mm (Térmica pequeña)</option>
          <option value="carta">Carta</option>
        </select>
      </div>
      <div>
        <label class="block font-medium mb-1">Logo del Hotel</label>
        <input type="file" name="logo" accept="image/*" class="input w-full bg-blue-50 rounded-xl px-4 py-2" />
        <div id="logo-preview" class="my-2"></div>
        <div class="flex items-center gap-2 mt-2">
          <input type="checkbox" name="mostrar_logo" id="mostrar_logo" class="accent-blue-700" checked />
          <label for="mostrar_logo" class="text-sm">Mostrar logo en documentos</label>
        </div>
      </div>
      <div class="col-span-2">
        <label class="block font-medium mb-1">Encabezado para Facturas/Recibos</label>
        <textarea name="encabezado_ticket" class="input w-full bg-blue-50 rounded-xl px-4 py-2" rows="2" placeholder="Ej: Hotel Corales del Mar, NIT 123456, Dir. Calle 123..."></textarea>
      </div>
      <div class="col-span-2">
        <label class="block font-medium mb-1">Pie de Página para Facturas/Recibos</label>
        <textarea name="pie_ticket" class="input w-full bg-blue-50 rounded-xl px-4 py-2" rows="2" placeholder="Ej: ¡Gracias por su visita!"></textarea>
      </div>
      <div class="col-span-2 border-t pt-5 mt-1">
        <h3 class="text-blue-700 text-lg font-semibold mb-1 flex items-center gap-2">
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 00.33 1.82c.63.63 1.71.18 1.71-.7V7.88A1.65 1.65 0 0019.4 9M4.6 9a1.65 1.65 0 00-.33-1.82c-.63-.63-1.71-.18-1.71.7v8.25c0 .88 1.08 1.33 1.71.7A1.65 1.65 0 004.6 15"></path></svg>
          <span class="text-base text-blue-700">Correos para reportes y notificaciones de cierre de caja</span>
        </h3>
      </div>
      <div class="col-span-2">
        <label class="block font-medium mb-1">
          Correo para reportes <span class="text-xs text-gray-500">(solo uno, sin comas)</span>
        </label>
        <input name="correo_reportes" type="email" class="input w-full bg-blue-50 rounded-xl px-4 py-2" placeholder="ejemplo@email.com" required />
        <div class="text-xs text-gray-500 mt-1">
          Aquí llegará el reporte automático de cierres de caja y otras notificaciones importantes.
        </div>
      </div>
      <div class="col-span-2 flex justify-end mt-6">
        <button class="bg-gradient-to-r from-blue-700 to-blue-600 hover:from-blue-900 hover:to-blue-700 transition text-white px-10 py-3 rounded-2xl shadow-lg font-bold text-lg flex items-center gap-2">
          <svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg>
          Guardar Configuración
        </button>
      </div>
    </form>
    <!-- Métodos de Pago (¡fuera del form principal!) -->
    <div class="col-span-2 border-t pt-5 mt-8 p-8">
      <h3 class="text-blue-700 text-lg font-semibold mb-2 flex items-center gap-2">
        <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 00.33 1.82c.63.63 1.71.18 1.71-.7V7.88A1.65 1.65 0 0019.4 9M4.6 9a1.65 1.65 0 00-.33-1.82c-.63-.63-1.71-.18-1.71.7v8.25c0 .88 1.08 1.33 1.71.7A1.65 1.65 0 004.6 15"></path></svg>
        Métodos de Pago
      </h3>
      <form id="nuevo-metodo-pago-form" class="flex gap-2 mb-4">
        <input type="text" id="nuevo-metodo-pago" placeholder="Ej: Efectivo, Nequi, Bancolombia, Datafono..." class="input bg-blue-50 px-4 py-2 rounded-xl" required>
        <button type="submit" class="bg-blue-700 hover:bg-blue-900 text-white px-5 py-2 rounded-xl shadow font-bold">Agregar</button>
      </form>
      <div id="lista-metodos-pago" class="space-y-2"></div>
    </div>
  </div>
  `;
}

// ======= CONFIGURACIÓN HOTEL =======

async function cargarConfiguracionInicial() {
  try {
    const { data, error } = await supabase
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .single();
    if (data) {
      configActual = data;
      poblarFormulario(data);
      if (data.logo_url) mostrarLogoGuardado(data.logo_url);
    }
  } catch (e) {
    // Si no hay configuración previa, ignora
  }
}

function poblarFormulario(config) {
  const form = document.getElementById('config-form');
  form.nombre_hotel.value = config.nombre_hotel || '';
  form.direccion_fiscal.value = config.direccion_fiscal || '';
  form.telefono_fiscal.value = config.telefono_fiscal || '';
  form.nit_rut.value = config.nit_rut || '';
  form.razon_social.value = config.razon_social || '';
  form.moneda_local.value = config.moneda_local || '';
  form.tipo_impresora.value = config.tipo_impresora || 'termica';
  form.tamano_papel.value = config.tamano_papel || '80mm';
  form.encabezado_ticket.value = config.encabezado_ticket || '';
  form.pie_ticket.value = config.pie_ticket || '';
  form.mostrar_logo.checked = config.mostrar_logo !== false;
  form.correo_reportes.value = config.correo_reportes || '';
}

function mostrarLogoGuardado(url) {
  const preview = document.getElementById('logo-preview');
  preview.innerHTML = `<img src="${url}" alt="Logo actual" class="h-16 mb-2 rounded shadow" />`;
}

function mostrarVistaPreviaLogo(e) {
  const file = e.target.files[0];
  const preview = document.getElementById('logo-preview');
  if (file) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      preview.innerHTML = `<img src="${ev.target.result}" alt="Vista previa logo" class="h-16 mb-2 rounded shadow" />`;
    };
    reader.readAsDataURL(file);
  } else {
    preview.innerHTML = '';
  }
}

async function guardarConfiguracion(e) {
  e.preventDefault();
  const form = e.target;
  const correo = form.correo_reportes.value.trim();

  // Validar correo (solo uno)
  if (correo.includes(",") || correo.split("@").length !== 2) {
    alert('Solo se permite ingresar un correo electrónico válido, sin comas ni espacios extra.');
    form.correo_reportes.focus();
    return;
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(correo)) {
    alert('Por favor, ingresa un correo electrónico válido.');
    form.correo_reportes.focus();
    return;
  }

  const config = {
    hotel_id: hotelId,
    nombre_hotel: form.nombre_hotel.value,
    direccion_fiscal: form.direccion_fiscal.value,
    telefono_fiscal: form.telefono_fiscal.value,
    nit_rut: form.nit_rut.value,
    razon_social: form.razon_social.value,
    moneda_local: form.moneda_local.value,
    tipo_impresora: form.tipo_impresora.value,
    tamano_papel: form.tamano_papel.value,
    encabezado_ticket: form.encabezado_ticket.value,
    pie_ticket: form.pie_ticket.value,
    mostrar_logo: form.mostrar_logo.checked,
    correo_reportes: correo
  };

  // Subir logo si hay
  const logoInput = form.logo;
  if (logoInput.files && logoInput.files[0]) {
    const file = logoInput.files[0];
    const ext = file.name.split('.').pop();
    const filePath = `logos/${hotelId}.${ext}`;
    let { error: uploadError } = await supabase.storage
      .from('hotel-logos')
      .upload(filePath, file, { upsert: true });

    if (uploadError && !uploadError.message.includes('The resource already exists')) {
      alert('Error subiendo logo: ' + uploadError.message);
      return;
    }
    const { data: urlData } = supabase.storage.from('hotel-logos').getPublicUrl(filePath);
    config.logo_url = urlData.publicUrl;
  } else if (configActual && configActual.logo_url) {
    config.logo_url = configActual.logo_url;
  }

  const { error: errorSave } = await supabase
    .from('configuracion_hotel')
    .upsert([config], { onConflict: 'hotel_id' });
  if (errorSave) {
    alert('Error guardando configuración: ' + errorSave.message);
  } else {
    alert('¡Configuración guardada!');
    configActual = config;
    if (config.logo_url) mostrarLogoGuardado(config.logo_url);
  }
}

// ======= MÉTODOS DE PAGO =======

async function cargarMetodosPago() {
  const { data, error } = await supabase
    .from('metodos_pago')
    .select('*')
    .eq('hotel_id', hotelId)
    .order('creado_en', { ascending: true });
  if (error) {
    document.getElementById('lista-metodos-pago').innerHTML = '<div class="text-red-500">Error al cargar métodos de pago</div>';
    return;
  }
  renderizarMetodosPago(data);
}

function renderizarMetodosPago(metodos) {
  const cont = document.getElementById('lista-metodos-pago');
  if (!cont) return;
  cont.innerHTML = metodos.map(met =>
    `<div class="flex items-center gap-2 border p-2 rounded-xl bg-blue-50">
      <span class="font-medium flex-1">${met.nombre}</span>
      <label class="flex items-center gap-1 text-xs">
        <input type="checkbox" ${met.activo ? 'checked' : ''} data-metodo-id="${met.id}" class="toggle-activo-metodo">
        Activo
      </label>
      <button data-metodo-id="${met.id}" class="borrar-metodo-pago text-red-600 hover:text-red-800 px-2 py-1 rounded-lg">🗑</button>
    </div>`
  ).join('') || '<div class="text-gray-400 italic">No hay métodos de pago creados aún.</div>';
}

