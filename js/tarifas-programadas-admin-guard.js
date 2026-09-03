import { supabase } from './supabaseClient.js';

let resolvedAccess = null;
let resolvingAccess = null;

async function canManageTariffs() {
  if (resolvedAccess !== null) return resolvedAccess;
  if (resolvingAccess) return resolvingAccess;

  resolvingAccess = (async () => {
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user?.id) return false;

      const { data: profile, error: profileError } = await supabase
        .from('usuarios')
        .select('hotel_id')
        .eq('id', userData.user.id)
        .maybeSingle();
      if (profileError || !profile?.hotel_id) return false;

      const { data, error } = await supabase.rpc('usuario_actual_es_admin_hotel', {
        p_hotel_id: profile.hotel_id
      });
      if (error) return false;
      return data === true;
    } catch {
      return false;
    }
  })();

  resolvedAccess = await resolvingAccess;
  resolvingAccess = null;
  return resolvedAccess;
}

function applyReadOnlyMode(section) {
  if (!section || section.dataset.tariffPermissionGuard === 'readonly') return;
  section.dataset.tariffPermissionGuard = 'readonly';

  const form = section.querySelector('#tarifa-programada-form');
  if (form) {
    const notice = document.createElement('div');
    notice.className = 'rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800';
    notice.textContent = 'Las tarifas pueden consultarse aquí. Solo un administrador del hotel puede crear, editar, activar, desactivar o eliminar tarifas.';
    form.replaceWith(notice);
  }

  section.querySelectorAll('[data-action]').forEach((button) => button.remove());
}

async function enforceTariffPermissions() {
  const section = document.getElementById('habitaciones-tarifas-programadas');
  if (!section) return;

  const allowed = await canManageTariffs();
  if (!allowed) applyReadOnlyMode(section);
}

const observer = new MutationObserver(() => {
  enforceTariffPermissions().catch(() => {});
});

observer.observe(document.documentElement, { childList: true, subtree: true });
enforceTariffPermissions().catch(() => {});
