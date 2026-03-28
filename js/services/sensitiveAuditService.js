import { registrarEnBitacora } from './bitacoraservice.js';

function sanitizeString(value, maxLength = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function maskEmail(email) {
  const safeEmail = sanitizeString(email, 120);
  if (!safeEmail.includes('@')) return safeEmail;
  const [localPart, domain] = safeEmail.split('@');
  const visibleLocal = localPart.length <= 2 ? localPart : `${localPart.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
}

function sanitizeDetalles(detalles = {}) {
  if (!detalles || typeof detalles !== 'object' || Array.isArray(detalles)) {
    return { valor: detalles };
  }

  const output = {};
  for (const [key, value] of Object.entries(detalles)) {
    if (value === undefined) continue;
    if (key.toLowerCase().includes('password')) continue;
    if (key.toLowerCase().includes('correo') || key.toLowerCase().includes('email')) {
      output[key] = maskEmail(String(value));
      continue;
    }
    output[key] = value;
  }
  return output;
}

export async function registrarAccionSensible({
  supabase,
  hotelId,
  usuarioId,
  modulo = 'Mi Cuenta',
  accion,
  detalles = {}
}) {
  if (!supabase || !hotelId || !accion) return;

  await registrarEnBitacora({
    supabase,
    hotel_id: hotelId,
    usuario_id: usuarioId || null,
    modulo,
    accion,
    detalles: {
      sensible: true,
      ...sanitizeDetalles(detalles)
    }
  });
}
