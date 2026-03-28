import { formatCurrency, formatDateTime, showError } from '../../uiUtils.js';
import { escapeAttribute, escapeHtml, normalizeLegacyText } from '../../security.js';

export async function mostrarLogEliminados({ supabase }) {
  const modalContainer = document.createElement('div');
  modalContainer.id = 'modal-log-eliminados';
  modalContainer.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-70 p-4';
  modalContainer.innerHTML = '<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl text-center"><p>Cargando historial...</p></div>';
  document.body.appendChild(modalContainer);

  try {
    const { data: logs, error } = await supabase
      .from('log_caja_eliminados')
      .select('creado_en, datos_eliminados, eliminado_por_usuario:usuarios(nombre)')
      .order('creado_en', { ascending: false })
      .limit(100);

    if (error) throw error;

    let tableRowsHtml = '';
    if (!logs || logs.length === 0) {
      tableRowsHtml = '<tr><td colspan="6" class="text-center p-4">No hay movimientos eliminados.</td></tr>';
    } else {
      tableRowsHtml = logs.map((log) => {
        const datos = log.datos_eliminados || {};
        const usuarioElimino = escapeHtml(log.eliminado_por_usuario?.nombre || 'Desconocido');
        const tipoOriginal = escapeHtml(normalizeLegacyText(datos.tipo || 'N/A'));
        const conceptoOriginal = escapeHtml(normalizeLegacyText(datos.concepto || 'N/A'));
        return `
          <tr class="hover:bg-gray-50 border-b">
            <td class="p-3 text-sm">${formatDateTime(log.creado_en)}</td>
            <td class="p-3 text-sm text-red-600 font-medium">${usuarioElimino}</td>
            <td class="p-3 text-sm">${formatDateTime(datos.creado_en)}</td>
            <td class="p-3 text-sm font-semibold ${datos.tipo === 'ingreso' ? 'text-green-700' : 'text-orange-700'}">${tipoOriginal}</td>
            <td class="p-3 text-sm font-bold">${formatCurrency(datos.monto || 0)}</td>
            <td class="p-3 text-sm text-left">${conceptoOriginal}</td>
          </tr>
        `;
      }).join('');
    }

    modalContainer.innerHTML = `
      <div class="bg-white p-0 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div class="flex justify-between items-center p-4 border-b bg-gray-50 rounded-t-lg">
          <h3 class="text-xl font-bold text-gray-700">Historial de Movimientos Eliminados</h3>
          <button id="btn-cerrar-log-modal" class="text-gray-500 hover:text-red-600 text-3xl">&times;</button>
        </div>
        <div class="overflow-y-auto">
          <table class="w-full text-left">
            <thead class="bg-gray-100 sticky top-0">
              <tr>
                <th class="p-3 text-sm font-semibold">Fecha eliminacion</th>
                <th class="p-3 text-sm font-semibold">Eliminado Por</th>
                <th class="p-3 text-sm font-semibold">Fecha Original</th>
                <th class="p-3 text-sm font-semibold">Tipo Original</th>
                <th class="p-3 text-sm font-semibold">Monto Original</th>
                <th class="p-3 text-sm font-semibold">Concepto Original</th>
              </tr>
            </thead>
            <tbody>
              ${tableRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;

    modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();
  } catch (err) {
    modalContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md text-center">
      <p class="text-red-600">Error al cargar el historial: ${escapeHtml(err.message)}</p>
      <button id="btn-cerrar-log-modal" class="button button-neutral mt-4">Cerrar</button>
    </div>`;
    modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();
  }
}

export async function mostrarTurnosAbiertos({
  event,
  supabase,
  hotelId,
  currentModuleUser,
  currentContainerEl,
  turnosAbiertosCache,
  iniciarModoSupervision
}) {
  if (document.getElementById('modal-turnos-abiertos')) {
    return;
  }

  const boton = event.currentTarget;
  const rect = boton.getBoundingClientRect();
  const top = rect.bottom + window.scrollY + 5;
  const right = window.innerWidth - rect.right;
  const isMobile = window.innerWidth < 640;

  const modalContainer = document.createElement('div');
  modalContainer.id = 'modal-turnos-abiertos';
  modalContainer.style.zIndex = '10000';
  modalContainer.className = isMobile
    ? 'fixed inset-0 bg-black/50 p-4 flex items-start justify-center overflow-y-auto'
    : 'fixed inset-0';

  const modalPanel = document.createElement('div');
  modalPanel.className = 'bg-white rounded-2xl shadow-xl border w-full text-center overflow-hidden';
  modalPanel.style.maxWidth = isMobile ? '28rem' : '24rem';
  modalPanel.style.maxHeight = isMobile ? 'calc(100vh - 2rem)' : 'min(75vh, 34rem)';

  if (isMobile) {
    modalPanel.style.marginTop = '1rem';
  } else {
    modalPanel.style.position = 'absolute';
    modalPanel.style.top = `${top}px`;
    modalPanel.style.right = `${right}px`;
  }

  modalPanel.innerHTML = '<div class="p-4"><p>Buscando turnos abiertos...</p></div>';
  modalContainer.appendChild(modalPanel);
  document.body.appendChild(modalContainer);

  const closeModal = () => {
    modalContainer.remove();
    document.removeEventListener('click', closeOnClickOutside);
    document.removeEventListener('keydown', closeOnEscape);
  };

  const closeOnClickOutside = (e) => {
    if (isMobile) {
      if (e.target === modalContainer) {
        closeModal();
      }
      return;
    }

    if (!modalPanel.contains(e.target) && e.target !== boton) {
      closeModal();
    }
  };

  const closeOnEscape = (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  };

  setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);
  document.addEventListener('keydown', closeOnEscape);

  try {
    const { data: turnos, error } = await supabase
      .from('turnos')
      .select('*, usuarios(*)')
      .eq('estado', 'abierto')
      .eq('hotel_id', hotelId)
      .order('fecha_apertura', { ascending: true });

    if (error) throw error;

    turnosAbiertosCache.clear();
    (turnos || []).forEach((turno) => {
      turnosAbiertosCache.set(String(turno.id), turno);
    });

    let tableRowsHtml = '';
    if (!turnos || turnos.length === 0) {
      tableRowsHtml = '<tr><td class="text-center p-4">Excelente. No hay turnos abiertos.</td></tr>';
    } else {
      tableRowsHtml = turnos.map((turno) => {
        const nombreUsuario = turno.usuarios?.nombre || turno.usuarios?.email || 'Usuario Desconocido';
        const esMiTurno = turno.usuario_id === currentModuleUser.id;

        const botonGestion = esMiTurno
          ? '<span class="text-gray-400 italic">Es tu turno actual</span>'
          : `<button class="button bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded" data-turno-id="${escapeAttribute(turno.id || '')}">Gestionar turno</button>`;

        return `
          <tr class="hover:bg-gray-50 border-b">
            <td class="p-3 text-sm text-left">${escapeHtml(nombreUsuario)}</td>
            <td class="p-3 text-sm text-left">${formatDateTime(turno.fecha_apertura)}</td>
            <td class="p-3 text-sm text-center">${botonGestion}</td>
          </tr>
        `;
      }).join('');
    }

    modalPanel.innerHTML = `
      <div class="flex justify-between items-center p-3 border-b bg-gray-50 rounded-t-lg">
        <h3 class="text-md font-bold text-gray-700">Turnos Abiertos</h3>
        <button id="btn-cerrar-turnos-modal" class="text-gray-500 hover:text-red-600 text-xl">&times;</button>
      </div>
      <div class="overflow-y-auto" style="max-height: ${isMobile ? 'calc(100vh - 8.5rem)' : '22rem'};">
        <table class="w-full text-left">
          <tbody>
            ${tableRowsHtml}
          </tbody>
        </table>
      </div>
    `;

    modalPanel.querySelector('#btn-cerrar-turnos-modal').onclick = closeModal;

    modalPanel.querySelectorAll('button[data-turno-id]').forEach((btn) => {
      btn.onclick = async (e) => {
        const turnoId = e.currentTarget.dataset.turnoId;
        const turnoData = turnosAbiertosCache.get(String(turnoId));
        closeModal();
        if (!turnoData) {
          showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudo cargar el turno seleccionado.');
          return;
        }
        await iniciarModoSupervision(turnoData);
      };
    });
  } catch (err) {
    modalPanel.innerHTML = `<div class="p-4 text-red-600">Error: ${escapeHtml(err.message)}</div>`;
  }
}
