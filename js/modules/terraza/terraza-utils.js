import { formatCurrency } from '../../uiUtils.js';

export function money(value) {
  return formatCurrency(Number(value || 0));
}

export function numberOrZero(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatDate(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
}

export function getPedidoItems(pedido) {
  return pedido?.items || pedido?.terraza_pedido_items || [];
}

export function normalizeTextKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function getSafeFileName(value) {
  return String(value || 'terraza')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'terraza';
}

export function normalizeSilla(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isBeerText(value = '') {
  const key = normalizeTextKey(value);
  if (!key) return false;
  return [
    'cerveza',
    'cervezas',
    'beer',
    'corona',
    'aguila',
    'poker',
    'clubcolombia',
    'costena',
    'heineken',
    'budweiser',
    'stellaartois',
    'modelo'
  ].some((term) => key.includes(term));
}

export function isBeerProduct(producto) {
  return producto?.permite_michelada === true || isBeerText(producto?.categoria) || isBeerText(producto?.nombre);
}

export function isLoungeTable(mesa) {
  return Number(mesa?.numero) === 6 || normalizeTextKey(mesa?.nombre).includes('sillon');
}

export function isAdminRoleName(value = '') {
  const roleKey = normalizeTextKey(value);
  return roleKey === 'admin' || roleKey === 'administrador' || roleKey === 'superadmin';
}

export function isMicheladaItem(item) {
  return item?.es_michelada === true || item?.es_michelada === 'true';
}

export function getItemDisplayName(item) {
  const baseName = item?.producto_nombre || 'Producto';
  return isMicheladaItem(item) ? `${baseName} Michelada` : baseName;
}
