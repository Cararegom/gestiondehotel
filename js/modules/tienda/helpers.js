import { fetchTurnoActivo } from '../../services/turnoService.js';
import { tiendaState } from './state.js';

export const TIENDA_TABS = [
  'POS',
  'Inventario',
  'Categor\u00edas',
  'Proveedores',
  'Lista de Compras',
  'Compras',
  'Compras Pendientes',
  'Pedidos web',
];

export function normalizeRoleKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function isMeseroRole(value = '') {
  const roleKey = normalizeRoleKey(value);
  return roleKey === 'mesero' || roleKey === 'mesero/a' || roleKey === 'mesera';
}

export function getTiendaTabsForCurrentUser() {
  if (isMeseroRole(tiendaState.currentUser?.role)) {
    return ['Inventario'];
  }
  return TIENDA_TABS;
}

export async function checkTurnoActivo(supabase, hotelId, usuarioId) {
  const turno = await fetchTurnoActivo(supabase, hotelId, usuarioId);
  if (!turno) {
    mostrarInfoModalGlobal(
      'Accion bloqueada: No hay un turno de caja abierto. Abrelo desde el modulo de Caja.',
      'Turno Requerido'
    );
    return false;
  }
  return true;
}

export function injectTiendaStyles() {
  const styleId = 'tienda-module-styles';
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement('style');
  style.id = styleId;
  style.type = 'text/css';
  style.appendChild(document.createTextNode(`
    .tienda-salidas-cards {
      display: none;
    }

    .tienda-salida-card {
      background: #fff;
      border: 1px solid #fed7aa;
      border-radius: 12px;
      padding: 12px;
      box-shadow: 0 8px 20px rgba(154, 52, 18, 0.08);
    }

    .tienda-salida-card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 10px;
    }

    .tienda-salida-card-title {
      margin: 0;
      color: #1e293b;
      font-size: 0.96rem;
      font-weight: 800;
      line-height: 1.25;
    }

    .tienda-salida-qty {
      flex: 0 0 auto;
      background: #fee2e2;
      color: #b91c1c;
      border-radius: 999px;
      padding: 4px 9px;
      font-weight: 900;
      font-size: 0.8rem;
    }

    .tienda-salida-detail {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      border-top: 1px solid #ffedd5;
      padding-top: 7px;
      margin-top: 7px;
      color: #475569;
      font-size: 0.86rem;
    }

    .tienda-salida-detail strong {
      color: #9a3412;
      font-weight: 800;
    }

    .tienda-salida-actions {
      display: flex;
      gap: 8px;
      margin-top: 12px;
    }

    .tienda-salida-actions button {
      flex: 1 1 0;
      min-height: 42px;
    }

    @media (max-width: 768px) {
      #inventario-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 1rem;
      }

      .inventario-actions {
        flex-wrap: wrap;
        justify-content: flex-start;
      }

      #inventario-filters {
        flex-direction: column;
        align-items: stretch;
      }

      #inventario-filters > input,
      #inventario-filters > select {
        max-width: none;
        width: 100%;
      }

      .tienda-salidas-table {
        display: none !important;
      }

      .tienda-salidas-cards {
        display: grid;
        gap: 10px;
      }
    }
  `));

  document.head.appendChild(style);
}

export function formatCurrency(num) {
  return '$' + Number(num || 0).toLocaleString('es-CO', { minimumFractionDigits: 0 });
}

export function showGlobalLoading(msg = 'Cargando...') {
  if (document.getElementById('globalLoadingModal')) return;
  const div = document.createElement('div');
  div.id = 'globalLoadingModal';
  div.style = `
    position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:999999;
    background:rgba(51,65,85,0.13);display:flex;align-items:center;justify-content:center;`;
  div.innerHTML = `<div style="background:#fff;padding:36px 36px 22px 36px;border-radius:16px;box-shadow:0 8px 60px #2563eb40;text-align:center;">
    <div style="font-size:2em;color:#1d4ed8;margin-bottom:14px;">⌛</div>
    <div style="font-size:1.13em;font-weight:600;">${msg}</div>
  </div>`;
  document.body.appendChild(div);
}

export function hideGlobalLoading() {
  const modal = document.getElementById('globalLoadingModal');
  if (modal) modal.remove();
}

export function closeModal() {
  const modalContainer = document.getElementById('modalContainer');
  if (modalContainer) {
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
  }
}

export function getTabContentEl() {
  return document.getElementById('contenidoTiendaTab');
}

export function getModalContainerEl() {
  return document.getElementById('modalContainer');
}

export function renderTiendaTabsShell(activeTab) {
  if (!tiendaState.currentContainerEl) return;
  const tabs = getTiendaTabsForCurrentUser();

  tiendaState.currentContainerEl.innerHTML = `
    <div style="
      border-bottom: 1px solid #ddd;
      margin-bottom: 10px;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
      -webkit-overflow-scrolling: touch;
      padding-bottom: 5px;
    ">
      ${tabs.map((tab) => `
        <button onclick="onTabTiendaClick('${tab}')" style="
          padding: 7px 16px;
          background: ${tab === activeTab ? '#337ab7' : '#f7f7f7'};
          color: ${tab === activeTab ? '#fff' : '#333'};
          border: none;
          border-bottom: ${tab === activeTab ? '2px solid #337ab7' : 'none'};
          border-radius: 4px 4px 0 0;
          font-weight: ${tab === activeTab ? 'bold' : 'normal'};
          cursor: pointer;
          flex-shrink: 0;
        ">${tab}</button>
      `).join('')}
    </div>
    <div id="contenidoTiendaTab"></div>
    <div id="modalContainer" style="position:fixed;top:0;left:0;width:100%;height:100%;background:#00000080;display:none;align-items:center;justify-content:center;z-index:1000;"></div>
  `;
}

export function mostrarInfoModalGlobal(message, title = 'Informacion') {
  if (typeof Swal !== 'undefined') {
    Swal.fire({
      icon: 'info',
      title,
      text: message,
      confirmButtonText: 'Entendido',
    });
    return;
  }
  alert(`${title}: ${message}`);
}
