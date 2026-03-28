function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const TEMPLATE_DEFINITIONS = {
  recepcion: {
    label: 'Recepción',
    description: 'Reservas, mapa, habitaciones y clientes.',
    include: ['reserva', 'habitacion', 'mapa', 'cliente', 'checkin', 'checkout', 'recepcion'],
    exclude: ['usuario', 'plan', 'suscripcion', 'superadmin', 'facturacion saas']
  },
  caja: {
    label: 'Caja',
    description: 'Cobros, caja, turnos y reportes básicos.',
    include: ['caja', 'turno', 'cobro', 'pago', 'reporte'],
    exclude: ['usuario', 'plan', 'suscripcion', 'superadmin']
  },
  supervisor: {
    label: 'Supervisor',
    description: 'Vista amplia de operación y control.',
    include: ['reserva', 'habitacion', 'mapa', 'cliente', 'caja', 'turno', 'reporte', 'limpieza', 'mantenimiento', 'tienda', 'restaurante'],
    exclude: ['suscripcion', 'superadmin']
  },
  mantenimiento: {
    label: 'Mantenimiento',
    description: 'Mantenimiento, mapa hotel y limpieza.',
    include: ['mantenimiento', 'limpieza', 'habitacion', 'mapa'],
    exclude: ['caja', 'suscripcion', 'usuario', 'superadmin']
  },
  tienda: {
    label: 'Tienda',
    description: 'POS, inventario, proveedores y compras.',
    include: ['tienda', 'inventario', 'proveedor', 'compra', 'lista de compras', 'pos'],
    exclude: ['suscripcion', 'superadmin']
  },
  restaurante: {
    label: 'Restaurante',
    description: 'POS restaurante, menú e inventario.',
    include: ['restaurante', 'plato', 'menu', 'inventario', 'categoria', 'comanda'],
    exclude: ['suscripcion', 'superadmin']
  }
};

function matchesTemplate(permission, template) {
  const haystack = normalize(`${permission.nombre} ${permission.descripcion || ''}`);
  const include = template.include.some((term) => haystack.includes(normalize(term)));
  const exclude = template.exclude.some((term) => haystack.includes(normalize(term)));
  return include && !exclude;
}

export function getPermissionTemplates(permisos = []) {
  return Object.entries(TEMPLATE_DEFINITIONS).map(([key, template]) => ({
    key,
    ...template,
    matchedPermissionIds: permisos.filter((permission) => matchesTemplate(permission, template)).map((permission) => permission.id)
  }));
}

export function applyPermissionTemplate(permisos = [], templateKey) {
  const template = getPermissionTemplates(permisos).find((item) => item.key === templateKey);
  const allowed = new Set(template?.matchedPermissionIds || []);
  return permisos.map((permission) => ({
    ...permission,
    checked: allowed.has(permission.id)
  }));
}

export function suggestTemplateFromRoles(roleNames = []) {
  const haystack = normalize(roleNames.join(' '));
  if (haystack.includes('recepcion')) return 'recepcion';
  if (haystack.includes('caja')) return 'caja';
  if (haystack.includes('mantenimiento')) return 'mantenimiento';
  if (haystack.includes('restaurante')) return 'restaurante';
  if (haystack.includes('tienda') || haystack.includes('inventario')) return 'tienda';
  if (haystack.includes('supervisor') || haystack.includes('admin')) return 'supervisor';
  return null;
}
