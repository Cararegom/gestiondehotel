function countExact(queryBuilder) {
  return queryBuilder.select('*', { count: 'exact', head: true });
}

export async function loadHotelOnboardingSnapshot(supabase, hotelId) {
  const [
    { data: hotel },
    { data: config },
    { count: habitacionesCount },
    { count: usuariosCount },
    { count: metodosPagoCount },
    { count: reservasCount },
    { count: turnosCount }
  ] = await Promise.all([
    supabase.from('hoteles').select('id, nombre, plan, estado_suscripcion, creado_en').eq('id', hotelId).maybeSingle(),
    supabase.from('configuracion_hotel').select('*').eq('hotel_id', hotelId).maybeSingle(),
    countExact(supabase.from('habitaciones')).eq('hotel_id', hotelId),
    countExact(supabase.from('usuarios')).eq('hotel_id', hotelId),
    countExact(supabase.from('metodos_pago')).eq('hotel_id', hotelId).eq('activo', true),
    countExact(supabase.from('reservas')).eq('hotel_id', hotelId),
    countExact(supabase.from('turnos')).eq('hotel_id', hotelId)
  ]);

  const perfilCompleto = Boolean(
    hotel?.nombre &&
    (config?.direccion_fiscal || config?.telefono_fiscal || config?.logo_url || config?.nit_rut || config?.razon_social)
  );

  const steps = [
    {
      id: 'perfil',
      title: 'Configurar perfil del hotel',
      description: 'Completa datos fiscales, logo y datos base del negocio.',
      complete: perfilCompleto,
      meta: perfilCompleto ? 'Perfil operativo listo.' : 'Faltan datos base para tickets y documentos.',
      actionHref: '#/configuracion',
      actionLabel: 'Ir a configuración'
    },
    {
      id: 'habitaciones',
      title: 'Cargar habitaciones',
      description: 'Define habitaciones, tipos y tiempos de estancia para operar bien.',
      complete: Number(habitacionesCount || 0) > 0,
      meta: `${habitacionesCount || 0} habitaciones registradas`,
      actionHref: '#/habitaciones',
      actionLabel: 'Gestionar habitaciones'
    },
    {
      id: 'equipo',
      title: 'Crear equipo de trabajo',
      description: 'Agrega recepción, caja o supervisión con permisos según su rol.',
      complete: Number(usuariosCount || 0) > 1,
      meta: `${usuariosCount || 0} usuarios registrados`,
      actionHref: '#/usuarios',
      actionLabel: 'Administrar usuarios'
    },
    {
      id: 'pagos',
      title: 'Activar métodos de pago',
      description: 'Configura efectivo, transferencia, Nequi y demás medios operativos.',
      complete: Number(metodosPagoCount || 0) > 0,
      meta: `${metodosPagoCount || 0} métodos de pago activos`,
      actionHref: '#/configuracion',
      actionLabel: 'Ver configuración'
    },
    {
      id: 'caja',
      title: 'Operar la primera caja',
      description: 'Abre y usa al menos un turno para dejar la operación lista.',
      complete: Number(turnosCount || 0) > 0,
      meta: `${turnosCount || 0} turnos registrados`,
      actionHref: '#/caja',
      actionLabel: 'Abrir caja'
    },
    {
      id: 'reservas',
      title: 'Registrar la primera reserva',
      description: 'Haz tu primera reserva o alquiler para confirmar el flujo completo.',
      complete: Number(reservasCount || 0) > 0,
      meta: `${reservasCount || 0} reservas creadas`,
      actionHref: '#/reservas',
      actionLabel: 'Ir a reservas'
    }
  ];

  const completeCount = steps.filter((step) => step.complete).length;
  const progress = steps.length ? Math.round((completeCount / steps.length) * 100) : 0;
  const nextPendingStep = steps.find((step) => !step.complete) || null;

  return {
    hotel,
    config,
    stats: {
      habitacionesCount: Number(habitacionesCount || 0),
      usuariosCount: Number(usuariosCount || 0),
      metodosPagoCount: Number(metodosPagoCount || 0),
      reservasCount: Number(reservasCount || 0),
      turnosCount: Number(turnosCount || 0)
    },
    steps,
    progress,
    completeCount,
    nextPendingStep
  };
}
