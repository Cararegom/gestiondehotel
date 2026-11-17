// Alta de hotel desde el registro publico (S1/S2 auditoria 2026-11-03).
// El servidor crea hotel, perfil admin y rol en una sola transaccion y asigna el
// trial de 30 dias con su propia fecha (RPC registrar_hotel_inicial).

// Datos que el formulario de registro guarda en user_metadata al llamar a signUp,
// para crear el hotel en el primer inicio de sesion cuando Auth exige confirmar el correo.
export function metadataRegistroHotel({ hotelName, adminName, referidoId }) {
  return {
    full_name: adminName,
    hotel_name: hotelName,
    referido_id: referidoId || null,
  };
}

export function datosRegistroPendiente(user, emailRespaldo = '') {
  const meta = user?.user_metadata || {};
  const hotelName = typeof meta.hotel_name === 'string' ? meta.hotel_name.trim() : '';
  if (!hotelName) return null;
  return {
    hotelName,
    adminName: (typeof meta.full_name === 'string' && meta.full_name.trim()) || emailRespaldo,
    referidoId: typeof meta.referido_id === 'string' ? meta.referido_id : null,
  };
}

export async function completarRegistroHotel(supabase, { hotelName, adminName, referidoId }) {
  const { data: hotelId, error } = await supabase.rpc('registrar_hotel_inicial', {
    p_nombre_hotel: hotelName,
    p_nombre_admin: adminName,
    p_referido_por: referidoId || null,
  });
  if (error) throw error;
  if (!hotelId) throw new Error('registro_incompleto');
  return hotelId;
}

// Flujo del formulario de registro. Devuelve { cuentaExistente, hotelCreado }:
// - cuenta nueva sin sesion (Auth exige confirmar el correo): el hotel se crea al iniciar sesion;
// - cuenta nueva con sesion, o cuenta existente cuya contrasena coincide: crea el hotel ahora.
// Cualquier fallo se lanza para que la pantalla no muestre exito.
export async function registrarCuentaYHotel(supabase, { email, password, hotelName, adminName, referidoId }) {
  const datosHotel = { hotelName, adminName, referidoId };
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email,
    password,
    options: { data: metadataRegistroHotel(datosHotel) },
  });

  const cuentaExistente = esCuentaAuthExistente(authData, authError);
  if (authError && !cuentaExistente) throw authError;

  let session = authData?.session || null;
  if (cuentaExistente) {
    // Retoma un alta a medias: la cuenta de Auth existe, quiza sin hotel.
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(/not confirmed/i.test(signInError.message || '') ? 'registro_confirmar_correo' : 'User already registered');
    }
    session = signInData?.session || null;
  }

  if (!session) return { cuentaExistente, hotelCreado: false };
  await completarRegistroHotel(supabase, datosHotel);
  return { cuentaExistente, hotelCreado: true };
}

export function esCuentaAuthExistente(authData, authError) {
  if (authError) return /already registered/i.test(authError.message || '');
  // Con confirmacion de correo activa, Supabase responde a un correo ya registrado
  // con un usuario sin identidades en lugar de un error.
  const identities = authData?.user?.identities;
  return Array.isArray(identities) && identities.length === 0;
}
