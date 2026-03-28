function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDaysFromNow(value) {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function getLatestDate(values = []) {
  return values
    .map(toDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

function getPreferredChannel(activities = []) {
  const counts = activities.reduce((acc, item) => {
    const key = String(item.tipo || '').trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const best = ranked[0]?.[0];

  if (best?.includes('whatsapp')) return 'WhatsApp';
  if (best?.includes('email')) return 'Email';
  if (best?.includes('llamada')) return 'Llamada';
  if (best?.includes('visita')) return 'Visita';
  return 'Sin preferencia';
}

function getSegment({ visitsCount, totalSpend, inactiveDays, isVIPFlag }) {
  if (isVIPFlag || totalSpend >= 1200000 || visitsCount >= 6) return 'vip';
  if (inactiveDays !== null && inactiveDays >= 60 && visitsCount >= 1) return 'en_riesgo';
  if (visitsCount >= 3 || totalSpend >= 450000) return 'frecuente';
  if (visitsCount === 0) return 'nuevo';
  return 'ocasional';
}

export function getSegmentMeta(segment) {
  switch (segment) {
    case 'vip':
      return { label: 'VIP', badgeClass: 'bg-amber-100 text-amber-800', accentClass: 'text-amber-700' };
    case 'frecuente':
      return { label: 'Frecuente', badgeClass: 'bg-emerald-100 text-emerald-800', accentClass: 'text-emerald-700' };
    case 'en_riesgo':
      return { label: 'En riesgo', badgeClass: 'bg-rose-100 text-rose-800', accentClass: 'text-rose-700' };
    case 'nuevo':
      return { label: 'Nuevo', badgeClass: 'bg-blue-100 text-blue-800', accentClass: 'text-blue-700' };
    default:
      return { label: 'Ocasional', badgeClass: 'bg-slate-100 text-slate-700', accentClass: 'text-slate-600' };
  }
}

export function buildClientCommercialInsights({
  clientes = [],
  reservas = [],
  ventas = [],
  ventasTienda = [],
  ventasRestaurante = [],
  actividades = []
}) {
  const grouped = new Map();

  clientes.forEach((cliente) => {
    grouped.set(cliente.id, {
      cliente,
      reservas: [],
      ventas: [],
      ventasTienda: [],
      ventasRestaurante: [],
      actividades: []
    });
  });

  const assign = (collection, key, item) => {
    const clientId = item?.[key];
    if (!clientId || !grouped.has(clientId)) return;
    grouped.get(clientId)[collection].push(item);
  };

  reservas.forEach((item) => assign('reservas', 'cliente_id', item));
  ventas.forEach((item) => assign('ventas', 'cliente_id', item));
  ventasTienda.forEach((item) => assign('ventasTienda', 'cliente_id', item));
  ventasRestaurante.forEach((item) => assign('ventasRestaurante', 'cliente_id', item));
  actividades.forEach((item) => assign('actividades', 'cliente_id', item));

  const insightsByClientId = {};

  grouped.forEach((value, clientId) => {
    const totalReservas = value.reservas.reduce((acc, item) => acc + toNumber(item.monto_total), 0);
    const totalVentas = value.ventas.reduce((acc, item) => acc + toNumber(item.total), 0);
    const totalVentasTienda = value.ventasTienda.reduce((acc, item) => acc + toNumber(item.total_venta || item.total), 0);
    const totalVentasRestaurante = value.ventasRestaurante.reduce((acc, item) => acc + toNumber(item.monto_total || item.total_venta || item.total), 0);

    const totalSpend = totalReservas + totalVentas + totalVentasTienda + totalVentasRestaurante;
    const visitsCount = value.reservas.length;
    const lastVisitDate = getLatestDate([
      ...value.reservas.map((item) => item.fecha_inicio || item.fecha_fin || item.creado_en),
      ...value.ventasTienda.map((item) => item.fecha || item.creado_en),
      ...value.ventasRestaurante.map((item) => item.fecha_venta || item.creado_en)
    ]);
    const lastCRMActivityDate = getLatestDate(value.actividades.map((item) => item.fecha));
    const pendingActivities = value.actividades.filter((item) => item.estado === 'pendiente').length;
    const inactiveDays = lastVisitDate ? diffDaysFromNow(lastVisitDate) : diffDaysFromNow(value.cliente?.fecha_creado);
    const preferredChannel = getPreferredChannel(value.actividades);
    const averageTicket = visitsCount > 0 ? totalReservas / visitsCount : totalSpend;
    const segment = getSegment({
      visitsCount,
      totalSpend,
      inactiveDays,
      isVIPFlag: Boolean(value.cliente?.cliente_vip)
    });

    insightsByClientId[clientId] = {
      clientId,
      visitsCount,
      totalSpend,
      totalReservas,
      totalVentas,
      totalVentasTienda,
      totalVentasRestaurante,
      averageTicket: Number.isFinite(averageTicket) ? averageTicket : 0,
      lastVisitDate,
      lastCRMActivityDate,
      pendingActivities,
      inactiveDays,
      preferredChannel,
      birthdayMonth: value.cliente?.fecha_nacimiento ? toDate(value.cliente.fecha_nacimiento)?.getMonth() : null,
      segment,
      ...getSegmentMeta(segment)
    };
  });

  return insightsByClientId;
}

export function summarizeCRMPortfolio(clientes = [], insightsByClientId = {}) {
  const summary = {
    total: clientes.length,
    vip: 0,
    frecuentes: 0,
    enRiesgo: 0,
    nuevos: 0,
    valorTotal: 0,
    pendientes: 0
  };

  clientes.forEach((cliente) => {
    const insight = insightsByClientId[cliente.id];
    if (!insight) return;
    summary.valorTotal += insight.totalSpend || 0;
    summary.pendientes += insight.pendingActivities || 0;

    switch (insight.segment) {
      case 'vip':
        summary.vip += 1;
        break;
      case 'frecuente':
        summary.frecuentes += 1;
        break;
      case 'en_riesgo':
        summary.enRiesgo += 1;
        break;
      case 'nuevo':
        summary.nuevos += 1;
        break;
      default:
        break;
    }
  });

  return summary;
}

export function buildCampaignSuggestions(clientes = [], insightsByClientId = {}) {
  const now = new Date();
  const currentMonth = now.getMonth();

  const activeClients = clientes
    .map((cliente) => ({ cliente, insight: insightsByClientId[cliente.id] }))
    .filter((entry) => entry.insight);

  const targetsReactivate = activeClients.filter(({ insight }) => (insight.inactiveDays || 0) >= 60 && insight.visitsCount > 0);
  const targetsBirthday = activeClients.filter(({ insight }) => insight.birthdayMonth === currentMonth);
  const targetsVIP = activeClients.filter(({ insight }) => ['vip', 'frecuente'].includes(insight.segment) && (insight.pendingActivities || 0) === 0);
  const targetsUpsell = activeClients.filter(({ insight }) => insight.totalVentasTienda + insight.totalVentasRestaurante < insight.totalReservas * 0.15 && insight.visitsCount >= 2);

  return [
    {
      id: 'reactivacion',
      title: 'Reactivar clientes dormidos',
      description: 'Crea tareas de seguimiento para clientes que no vuelven desde hace 60 días o más.',
      channel: 'WhatsApp',
      targetEntries: targetsReactivate,
      activityType: 'WhatsApp',
      messageTemplate: 'Campaña automática: reactivación de cliente inactivo. Validar oferta de regreso o llamada de seguimiento.'
    },
    {
      id: 'cumple_mes',
      title: 'Cumpleaños del mes',
      description: 'Lista clientes con cumpleaños este mes para enviar detalle o beneficio especial.',
      channel: 'WhatsApp / Email',
      targetEntries: targetsBirthday,
      activityType: 'Recordatorio',
      messageTemplate: 'Campaña automática: saludo de cumpleaños y oferta especial para cliente frecuente.'
    },
    {
      id: 'vip_sin_contacto',
      title: 'Seguimiento VIP',
      description: 'Genera acciones comerciales para clientes VIP o frecuentes sin seguimiento pendiente.',
      channel: 'Llamada',
      targetEntries: targetsVIP,
      activityType: 'Llamada',
      messageTemplate: 'Campaña automática: seguimiento VIP. Confirmar próximas visitas y beneficios preferenciales.'
    },
    {
      id: 'upsell_consumos',
      title: 'Upsell de consumos',
      description: 'Clientes que se hospedan, pero casi no consumen tienda o restaurante.',
      channel: 'WhatsApp',
      targetEntries: targetsUpsell,
      activityType: 'WhatsApp',
      messageTemplate: 'Campaña automática: upsell de servicios y consumos. Presentar combos o beneficios adicionales.'
    }
  ];
}

export function buildCampaignActivityRows({ campaign, hotelId, userId }) {
  return (campaign?.targetEntries || []).map(({ cliente }) => ({
    cliente_id: cliente.id,
    hotel_id: hotelId,
    usuario_creador_id: userId || null,
    tipo: campaign.activityType,
    descripcion: campaign.messageTemplate,
    estado: 'pendiente',
    fecha: new Date().toISOString()
  }));
}
