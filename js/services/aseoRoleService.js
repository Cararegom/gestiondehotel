// Rol operativo de aseo (camarera / aseador). Solo ve el mapa en modo lectura,
// Limpieza (donde libera habitaciones) y el escaner de Control de Energia.

export const ASEO_ROLE_KEY = 'aseo';

export const ASEO_ALLOWED_MODULES = new Set(['mapa-habitaciones', 'limpieza', 'control-energia']);

export const ASEO_DEFAULT_HASH = '#/limpieza';

function normalizeRoleName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Debe coincidir con public.es_nombre_rol_aseo() en la base de datos.
export function isAseoRoleName(value) {
  const roleName = normalizeRoleName(value);
  if (!roleName) return false;
  return roleName === 'aseo'
    || roleName === 'limpieza'
    || roleName === 'housekeeping'
    || roleName.includes('camarer')
    || roleName.includes('aseador')
    || roleName.includes('mucama');
}

export function isAseoModuleAllowed(moduleKey) {
  return ASEO_ALLOWED_MODULES.has(moduleKey);
}

export function isAseoReadOnlyUser(user) {
  return user?.role === ASEO_ROLE_KEY;
}
