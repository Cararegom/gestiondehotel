const clienteLookupTimers = new WeakMap();
const clienteLookupTokens = new WeakMap();

let installed = false;
let supabaseClient = null;
let submitCaptureHandler = null;
let inputHandler = null;

function getHotelId() {
  return globalThis.hotelIdGlobal || null;
}

function getRentalForm(target) {
  const form = target?.closest?.('#alquilar-form-pos');
  return form instanceof HTMLFormElement ? form : null;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function hasEnoughIdentityData(form) {
  const nombre = normalizeText(form?.elements?.cliente_nombre?.value);
  const documento = normalizeText(form?.elements?.cedula?.value).replace(/[^0-9A-Za-z]/g, '');
  const telefono = normalizeText(form?.elements?.telefono?.value).replace(/\D/g, '');
  return nombre.length >= 3 || documento.length >= 4 || telefono.length >= 4;
}

function ensureSuggestionHost(form) {
  let host = form.querySelector('[data-cliente-identity-suggestions]');
  if (host) return host;

  host = document.createElement('div');
  host.dataset.clienteIdentitySuggestions = 'true';
  host.className = 'hidden rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm shadow-sm';
  host.setAttribute('aria-live', 'polite');

  const nombreInput = form.elements?.cliente_nombre;
  const flexRow = nombreInput?.closest?.('.flex');
  const fieldBlock = flexRow?.parentElement || nombreInput?.parentElement;
  if (fieldBlock?.parentElement) {
    fieldBlock.insertAdjacentElement('afterend', host);
  } else {
    form.prepend(host);
  }

  return host;
}

function setHostMessage(form, message, kind = 'info') {
  const host = ensureSuggestionHost(form);
  host.innerHTML = '';
  host.classList.remove('hidden', 'border-emerald-200', 'bg-emerald-50', 'text-emerald-800', 'border-red-200', 'bg-red-50', 'text-red-700', 'border-slate-200', 'bg-slate-50', 'text-slate-700');

  if (kind === 'success') {
    host.classList.add('border-emerald-200', 'bg-emerald-50', 'text-emerald-800');
  } else if (kind === 'error') {
    host.classList.add('border-red-200', 'bg-red-50', 'text-red-700');
  } else {
    host.classList.add('border-slate-200', 'bg-slate-50', 'text-slate-700');
  }

  const text = document.createElement('div');
  text.className = 'font-semibold';
  text.textContent = message;
  host.appendChild(text);
}

function hideSuggestions(form) {
  const host = form.querySelector('[data-cliente-identity-suggestions]');
  if (!host) return;
  host.innerHTML = '';
  host.classList.add('hidden');
}

function applyClient(form, client, { fillFields = true } = {}) {
  if (!form || !client?.id) return;

  if (form.elements?.cliente_id) {
    form.elements.cliente_id.value = client.id;
  }

  if (fillFields) {
    if (form.elements?.cliente_nombre && client.nombre) {
      form.elements.cliente_nombre.value = client.nombre;
    }
    if (form.elements?.cedula && client.documento) {
      form.elements.cedula.value = client.documento;
    }
    if (form.elements?.telefono && client.telefono) {
      form.elements.telefono.value = client.telefono;
    }
  }

  setHostMessage(form, `Cliente existente seleccionado: ${client.nombre || 'sin nombre'}. Se conservará su historial en un solo perfil.`, 'success');
}

function renderSuggestions(form, clients) {
  const host = ensureSuggestionHost(form);
  host.innerHTML = '';
  host.classList.remove('border-emerald-200', 'bg-emerald-50', 'text-emerald-800', 'border-red-200', 'bg-red-50', 'text-red-700');
  host.classList.add('border-slate-200', 'bg-slate-50', 'text-slate-700');

  if (!Array.isArray(clients) || clients.length === 0) {
    host.classList.add('hidden');
    return;
  }

  host.classList.remove('hidden');

  const title = document.createElement('div');
  title.className = 'mb-2 font-semibold text-slate-700';
  title.textContent = '¿Ya está registrado? Selecciona el cliente para conservar todo su historial:';
  host.appendChild(title);

  const list = document.createElement('div');
  list.className = 'space-y-2';

  clients.forEach((client) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-blue-300 hover:bg-blue-50';

    const header = document.createElement('div');
    header.className = 'flex flex-wrap items-center justify-between gap-2';

    const name = document.createElement('span');
    name.className = 'font-semibold text-slate-900';
    name.textContent = client.nombre || 'Cliente sin nombre';
    header.appendChild(name);

    if (client.es_coincidencia_segura) {
      const badge = document.createElement('span');
      badge.className = 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700';
      badge.textContent = 'Coincidencia exacta';
      header.appendChild(badge);
    }

    const details = document.createElement('div');
    details.className = 'mt-1 text-xs text-slate-500';
    const parts = [];
    if (client.documento) parts.push(`Documento: ${client.documento}`);
    if (client.telefono) parts.push(`Tel: ${client.telefono}`);
    details.textContent = parts.length ? parts.join(' · ') : 'Sin documento o teléfono guardado';

    button.append(header, details);
    button.addEventListener('click', () => applyClient(form, client));
    list.appendChild(button);
  });

  host.appendChild(list);
}

async function lookupClients(form, { render = true } = {}) {
  const hotelId = getHotelId();
  if (!supabaseClient || !hotelId || !hasEnoughIdentityData(form)) {
    if (render) hideSuggestions(form);
    return { clients: [], error: null };
  }

  const token = (clienteLookupTokens.get(form) || 0) + 1;
  clienteLookupTokens.set(form, token);

  const { data, error } = await supabaseClient.rpc('buscar_clientes_similares', {
    p_hotel_id: hotelId,
    p_nombre: normalizeText(form.elements?.cliente_nombre?.value) || null,
    p_documento: normalizeText(form.elements?.cedula?.value) || null,
    p_telefono: normalizeText(form.elements?.telefono?.value) || null,
    p_limite: 5
  });

  if (clienteLookupTokens.get(form) !== token) {
    return { clients: [], error: null };
  }

  if (error) {
    console.warn('[ClienteIdentityGuard] No se pudo verificar si el cliente ya existe:', error);
    return { clients: [], error };
  }

  const clients = Array.isArray(data) ? data : [];
  if (render) renderSuggestions(form, clients);
  return { clients, error: null };
}

function scheduleLookup(form) {
  const previous = clienteLookupTimers.get(form);
  if (previous) clearTimeout(previous);

  const timer = setTimeout(() => {
    clienteLookupTimers.delete(form);
    lookupClients(form).catch((error) => {
      console.warn('[ClienteIdentityGuard] Error buscando sugerencias de clientes:', error);
    });
  }, 300);

  clienteLookupTimers.set(form, timer);
}

function clearSelectedClientWhenEdited(form) {
  if (form.elements?.cliente_id?.value) {
    form.elements.cliente_id.value = '';
  }
}

async function protectRentalSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'alquilar-form-pos') return;

  if (form.dataset.clienteIdentityGuardPass === '1') {
    delete form.dataset.clienteIdentityGuardPass;
    return;
  }

  if (normalizeText(form.elements?.cliente_id?.value)) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const { clients, error } = await lookupClients(form, { render: true });
  if (error) {
    setHostMessage(form, 'No fue posible verificar si este cliente ya existe. Intenta registrar nuevamente para evitar duplicar su historial.', 'error');
    return;
  }

  const safeMatch = clients.find((client) => client.es_coincidencia_segura);
  if (safeMatch) {
    applyClient(form, safeMatch, { fillFields: false });
  }

  form.dataset.clienteIdentityGuardPass = '1';
  const submitter = event.submitter instanceof HTMLElement ? event.submitter : undefined;
  form.requestSubmit(submitter);
}

export function installClienteIdentityGuard(client) {
  if (installed || !globalThis.document || !client) return;

  installed = true;
  supabaseClient = client;

  inputHandler = (event) => {
    const target = event.target;
    const form = getRentalForm(target);
    if (!form) return;

    if (!['cliente_nombre', 'cedula', 'telefono'].includes(target?.name)) return;

    clearSelectedClientWhenEdited(form);
    scheduleLookup(form);
  };

  submitCaptureHandler = (event) => {
    protectRentalSubmit(event).catch((error) => {
      console.error('[ClienteIdentityGuard] Error protegiendo el registro del cliente:', error);
      const form = event.target;
      if (form instanceof HTMLFormElement) {
        setHostMessage(form, 'No fue posible validar el cliente. No se registró el alquiler para evitar crear un cliente duplicado.', 'error');
      }
    });
  };

  document.addEventListener('input', inputHandler, true);
  document.addEventListener('submit', submitCaptureHandler, true);
}
