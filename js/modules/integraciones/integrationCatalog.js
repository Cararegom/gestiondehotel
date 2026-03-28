import { escapeHtml } from '../../security.js';

export const ACCOUNTING_INTEGRATIONS = [
  {
    provider: 'Alegra',
    category: 'contable-fiscal',
    status: 'activa',
    badge: 'Activa hoy',
    description: 'Configuracion real de facturacion y pruebas operativas desde este modulo.'
  },
  {
    provider: 'Siigo',
    category: 'contable-fiscal',
    status: 'roadmap',
    badge: 'Roadmap',
    description: 'Muy relevante para Colombia. Se deja priorizable desde aqui segun interes comercial.'
  },
  {
    provider: 'Facturacion electronica DIAN',
    category: 'contable-fiscal',
    status: 'evaluacion',
    badge: 'En evaluacion',
    description: 'Ruta pensada para hoteles que necesiten mayor formalizacion tributaria.'
  },
  {
    provider: 'QuickBooks',
    category: 'contable-fiscal',
    status: 'roadmap',
    badge: 'Roadmap',
    description: 'Opcion futura para cuentas internacionales o administracion contable mas robusta.'
  },
  {
    provider: 'Xero',
    category: 'contable-fiscal',
    status: 'roadmap',
    badge: 'Roadmap',
    description: 'Interesante para operacion global o grupos hoteleros con equipo financiero externo.'
  }
];

export const OTA_INTEGRATIONS = [
  {
    provider: 'Booking.com',
    category: 'otas-channel',
    status: 'evaluacion',
    badge: 'Alta prioridad',
    description: 'Se perfila como una de las integraciones OTA mas valiosas para conversion y ocupacion.'
  },
  {
    provider: 'Airbnb',
    category: 'otas-channel',
    status: 'evaluacion',
    badge: 'Alta prioridad',
    description: 'Clave para hostales, apartahoteles y hoteles que tambien venden inventario flexible.'
  },
  {
    provider: 'Expedia',
    category: 'otas-channel',
    status: 'evaluacion',
    badge: 'Evaluacion',
    description: 'Complementa distribucion internacional y volumen corporativo.'
  },
  {
    provider: 'Beds24 / Channel manager',
    category: 'otas-channel',
    status: 'exploracion',
    badge: 'Exploracion',
    description: 'Alternativa para acelerar salida a OTAs sin construir cada integracion desde cero.'
  },
  {
    provider: 'Cloudbeds / PMS Sync',
    category: 'otas-channel',
    status: 'exploracion',
    badge: 'Exploracion',
    description: 'Sirve como benchmark para decidir hasta donde conviene crecer o conectarse con terceros.'
  }
];

export function formatIntegrationDate(value) {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'Sin fecha'
    : parsed.toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

export function getIntegrationStatusChip(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('activa')) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (normalized.includes('prioridad') || normalized.includes('evalu')) return 'border-amber-200 bg-amber-50 text-amber-700';
  if (normalized.includes('explor')) return 'border-blue-200 bg-blue-50 text-blue-700';
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

export function renderCatalogCards(items = []) {
  return items.map((item) => `
    <article class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs uppercase tracking-[0.22em] text-slate-400">${escapeHtml(item.category)}</p>
          <h3 class="mt-1 text-lg font-bold text-slate-900">${escapeHtml(item.provider)}</h3>
        </div>
        <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getIntegrationStatusChip(item.status)}">
          ${escapeHtml(item.badge)}
        </span>
      </div>
      <p class="mt-3 text-sm leading-6 text-slate-600">${escapeHtml(item.description)}</p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          class="integration-request-btn rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          data-provider="${escapeHtml(item.provider)}"
          data-category="${escapeHtml(item.category)}"
        >
          Solicitar prioridad
        </button>
      </div>
    </article>
  `).join('');
}

export function renderRequestList(requests = []) {
  if (!requests.length) {
    return `
      <div class="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
        Aun no hay solicitudes registradas para este hotel.
      </div>
    `;
  }

  return `
    <div class="space-y-3">
      ${requests.map((request) => `
        <article class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p class="text-xs uppercase tracking-[0.22em] text-slate-400">${escapeHtml(request.categoria || 'integracion')}</p>
              <h4 class="mt-1 text-sm font-bold text-slate-900">${escapeHtml(request.proveedor || 'Proveedor')}</h4>
            </div>
            <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getIntegrationStatusChip(request.estado)}">
              ${escapeHtml(request.estado || 'nuevo')}
            </span>
          </div>
          <p class="mt-2 text-xs text-slate-500">${escapeHtml(formatIntegrationDate(request.created_at))}</p>
          ${request.notas ? `<p class="mt-3 text-sm text-slate-600">${escapeHtml(request.notas)}</p>` : ''}
        </article>
      `).join('')}
    </div>
  `;
}
