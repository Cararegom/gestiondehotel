import * as reportesCore from './reportes-centro-core.js';

function convertirZonaHorariaEnSoloLectura(container) {
  const label = container?.querySelector('label[for="reportes-zona-horaria"]');
  const panel = label?.parentElement;
  if (!panel) return;

  const select = panel.querySelector('#reportes-zona-horaria');
  const visibleZone = select?.value
    || Array.from(panel.querySelectorAll('p')).map((node) => node.textContent?.trim()).find((text) => text?.includes('/'))
    || 'Configurada en el módulo Configuración';

  panel.innerHTML = '';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'text-[11px] font-bold uppercase tracking-[.16em] text-blue-100';
  eyebrow.textContent = 'Zona horaria activa';

  const value = document.createElement('p');
  value.className = 'mt-2 text-sm font-bold text-white';
  value.textContent = visibleZone;

  const note = document.createElement('p');
  note.className = 'mt-1 text-xs font-semibold text-blue-100';
  note.textContent = 'Se administra únicamente desde Configuración del hotel.';

  panel.append(eyebrow, value, note);
}

export async function mount(container, supabase, user, hotelId, planDetails) {
  await reportesCore.mount(container, supabase, user, hotelId, planDetails);
  convertirZonaHorariaEnSoloLectura(container);
}

export function unmount(container) {
  if (typeof reportesCore.unmount === 'function') reportesCore.unmount(container);
}
