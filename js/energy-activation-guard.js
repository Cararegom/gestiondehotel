import { supabase } from './supabaseClient.js';

let validating = false;

async function showAlert(options) {
  if (window.Swal?.fire) return window.Swal.fire(options);
  const confirmed = window.confirm(options.text || options.title || '¿Continuar?');
  return { isConfirmed: confirmed };
}

async function validateEnergyActivation(toggle) {
  const { data, error } = await supabase.rpc('energy_list_qr_tokens');
  if (error) {
    await showAlert({
      icon: 'error',
      title: 'No se puede activar todavía',
      text: 'No fue posible verificar los QR del hotel. Entra a Control de Energía y vuelve a intentarlo.'
    });
    return false;
  }

  const rooms = data || [];
  const missing = rooms.filter((room) => !room.token);
  if (missing.length > 0) {
    await showAlert({
      icon: 'warning',
      title: 'Faltan QR por preparar',
      text: `Faltan ${missing.length} QR por generar. Entra a Control de Energía, genera los códigos faltantes, imprímelos e instálalos antes de activar la función.`
    });
    return false;
  }

  const confirmation = await showAlert({
    icon: 'warning',
    title: '¿Los QR ya están instalados?',
    text: `Se encontraron ${rooms.length} habitaciones activas con QR generado. Activa el Control de Energía únicamente si los códigos ya fueron impresos y pegados en sus habitaciones.`,
    showCancelButton: true,
    confirmButtonText: 'Sí, activar Control de Energía',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#059669'
  });

  return confirmation.isConfirmed === true;
}

document.addEventListener('change', async (event) => {
  const toggle = event.target;
  if (!(toggle instanceof HTMLInputElement) || toggle.id !== 'energy_control_enabled') return;
  if (!toggle.checked) return;

  if (toggle.dataset.energyActivationConfirmed === 'true') {
    delete toggle.dataset.energyActivationConfirmed;
    return;
  }

  event.preventDefault();
  event.stopImmediatePropagation();
  toggle.checked = false;

  if (validating) return;
  validating = true;
  toggle.disabled = true;

  try {
    const allowed = await validateEnergyActivation(toggle);
    if (!allowed) return;

    toggle.dataset.energyActivationConfirmed = 'true';
    toggle.checked = true;
    toggle.disabled = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  } finally {
    validating = false;
    if (toggle.dataset.energyActivationConfirmed !== 'true') toggle.disabled = false;
  }
}, true);
