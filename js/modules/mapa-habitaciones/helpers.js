export function formatCOP(value) {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Math.round(Number(value) || 0));
}

export const estadoColores = {
  libre: 'border-green-500',
  disponible: 'border-green-500',
  ocupada: 'border-yellow-500',
  reservada: 'border-indigo-500',
  mantenimiento: 'border-orange-500',
  limpieza: 'border-cyan-500',
  'tiempo agotado': 'border-red-600',
  default: 'border-gray-300'
};

export function playPopSound() {
  const audio = new Audio('js/assets/notificacion.mp3');
  audio.volume = 0.8;
  audio.play().catch((error) => console.warn('No se pudo reproducir el sonido:', error));
}

export function cerrarModalContainer() {
  const modalContainer = document.getElementById('modal-container');
  if (modalContainer) {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
  }
}

export function waitForButtonAndBind(buttonId, callbacks, timeout = 2000, context = document) {
  const startedAt = Date.now();
  const bind = () => {
    const button = context.querySelector(`#${buttonId}`);
    if (button) {
      callbacks.forEach((callback) => button.addEventListener('click', callback));
      return;
    }
    if (Date.now() - startedAt < timeout) {
      requestAnimationFrame(bind);
    }
  };
  bind();
}

export function cerrarModalGlobal(modalElement) {
  if (modalElement) {
    modalElement.style.display = 'none';
    modalElement.innerHTML = '';
  }
}

export function formatHorasMin(minutes) {
  if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes < 0) return '0h 0m';
  const horas = Math.floor(minutes / 60);
  const minutos = minutes % 60;
  return `${horas}h ${minutos}m`;
}

export function formatDateTime(isoString, locale = 'es-CO', options = { dateStyle: 'short', timeStyle: 'short' }) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? 'Fecha Inválida' : date.toLocaleString(locale, options);
}

export function getAmenityIcon(amenityStr) {
  const value = String(amenityStr || '').toLowerCase();
  const iconMap = {
    wifi: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.906 14.142 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" /></svg>',
    tv: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>',
    aire: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" /></svg>',
    bano: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>',
    baño: '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" /></svg>'
  };

  for (const [key, icon] of Object.entries(iconMap)) {
    if (value.includes(key)) return icon;
  }
  return '';
}

export function mostrarInfoModalGlobal(mensaje, titulo = 'Información', botones = [], modalToClose = null) {
  const baseContainer = document.getElementById('modal-container-secondary') || document.getElementById('modal-container');
  if (!baseContainer) return;

  let modalOriginalHTML = '';
  if (modalToClose) {
    modalOriginalHTML = modalToClose.innerHTML;
    modalToClose.innerHTML = '';
  }

  const htmlBotones = botones.length > 0
    ? botones.map((boton, index) => `<button id="info-btn-${index}" class="${boton.clase || 'button button-primary mt-4'}">${boton.texto}</button>`).join(' ')
    : '<button id="btn-info-ok" class="button button-accent mt-4">Aceptar</button>';

  baseContainer.innerHTML = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-sm p-6 relative flex flex-col items-center animate-fade-in-up">
      <h3 class="text-xl font-bold text-gray-800 mb-2">${titulo}</h3>
      <p class="text-center text-gray-600 mb-4">${mensaje}</p>
      <div class="flex gap-2 w-full justify-center">
        ${htmlBotones}
      </div>
    </div>
  `;
  baseContainer.style.display = 'flex';

  if (botones.length === 0) {
    document.getElementById('btn-info-ok')?.addEventListener('click', () => {
      baseContainer.style.display = 'none';
      baseContainer.innerHTML = '';
      if (modalToClose) modalToClose.innerHTML = modalOriginalHTML;
    });
    return;
  }

  botones.forEach((boton, index) => {
    document.getElementById(`info-btn-${index}`)?.addEventListener('click', () => {
      baseContainer.style.display = 'none';
      baseContainer.innerHTML = '';
      if (modalToClose) modalToClose.innerHTML = modalOriginalHTML;
      if (typeof boton.accion === 'function') boton.accion();
    });
  });
}

window.playPopSound = playPopSound;
window.mostrarInfoModalGlobal = mostrarInfoModalGlobal;
