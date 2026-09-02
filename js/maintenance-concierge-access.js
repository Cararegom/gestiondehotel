import { supabase } from './supabaseClient.js';

const DEFAULT_HASH = '#/mapa-habitaciones';
const ALLOWED_ROUTES = new Set([
  '/mapa-habitaciones',
  '/mantenimiento',
  '/control-energia',
  '/notificaciones'
]);

function normalizeRole(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function isMaintenanceConciergeRoleName(value) {
  const role = normalizeRole(value);
  return role === 'mantenimiento'
    || role.includes('mantenimiento')
    || role.includes('conserje');
}

export function getRouteFromHash(hashValue = window.location.hash) {
  const raw = String(hashValue || '').replace(/^#/, '');
  return (raw.split('?')[0] || '/').trim();
}

export function isMaintenanceConciergeRouteAllowed(hashValue = window.location.hash) {
  return ALLOWED_ROUTES.has(getRouteFromHash(hashValue));
}

function replaceInitialHash() {
  if (isMaintenanceConciergeRouteAllowed()) return;
  const nextUrl = `${window.location.pathname}${window.location.search}${DEFAULT_HASH}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function redirectToDefault() {
  if (window.location.hash === DEFAULT_HASH) return;
  window.location.hash = DEFAULT_HASH;
}

function restrictNavigationDom() {
  if (!window.__maintenanceConciergeMode) return;

  document.documentElement.dataset.operationalProfile = 'mantenimiento-conserje';

  document.querySelectorAll('a.nav-link-dynamic').forEach((link) => {
    const route = getRouteFromHash(link.getAttribute('href'));
    if (!ALLOWED_ROUTES.has(route)) link.remove();
  });

  document.querySelectorAll('a[href="#/dashboard"]').forEach((link) => {
    link.setAttribute('href', DEFAULT_HASH);
    link.setAttribute('title', 'Ir al mapa de habitaciones');
  });
}

function installHashGuard() {
  window.addEventListener('hashchange', (event) => {
    if (!window.__maintenanceConciergeMode || isMaintenanceConciergeRouteAllowed()) return;
    event.stopImmediatePropagation();
    redirectToDefault();
  }, true);

  document.addEventListener('click', (event) => {
    if (!window.__maintenanceConciergeMode) return;
    const link = event.target?.closest?.('a[href*="#/"]');
    if (!link) return;
    const route = getRouteFromHash(link.getAttribute('href'));
    if (ALLOWED_ROUTES.has(route)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    redirectToDefault();
  }, true);
}

async function resolveMaintenanceConciergeProfile() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const user = sessionData?.session?.user;
  if (!user?.id) return { active: false, user: null, profile: null };

  const { data: profile, error } = await supabase
    .from('usuarios')
    .select('id, hotel_id, rol, activo, usuarios_roles(roles(nombre))')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!profile || profile.activo === false) return { active: false, user, profile };

  const assignedRoles = (profile.usuarios_roles || [])
    .map((item) => item?.roles?.nombre)
    .filter(Boolean);
  const active = isMaintenanceConciergeRoleName(profile.rol)
    || assignedRoles.some(isMaintenanceConciergeRoleName);

  return { active, user, profile, assignedRoles };
}

export async function initializeMaintenanceConciergeAccess() {
  const context = await resolveMaintenanceConciergeProfile();
  window.__maintenanceConciergeMode = context.active === true;

  if (!window.__maintenanceConciergeMode) return context;

  window.__maintenanceConciergeAccess = Object.freeze({
    profile: 'mantenimiento-conserje',
    defaultHash: DEFAULT_HASH,
    allowedRoutes: [...ALLOWED_ROUTES]
  });

  replaceInitialHash();
  installHashGuard();
  restrictNavigationDom();

  const observer = new MutationObserver(() => restrictNavigationDom());
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
  window.__maintenanceConciergeNavObserver = observer;

  return context;
}
