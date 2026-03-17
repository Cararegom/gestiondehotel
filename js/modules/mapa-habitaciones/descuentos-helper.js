function normalizarFecha(fecha) {
  if (fecha instanceof Date) return fecha;
  return fecha ? new Date(fecha) : new Date();
}

function obtenerDiaSemana(fecha) {
  const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  return days[normalizarFecha(fecha).getDay()];
}

function descuentoDisponible(descuento) {
  return (descuento.usos_maximos || 0) === 0 || (descuento.usos_actuales || 0) < descuento.usos_maximos;
}

function hotelIdDesdeContexto(room) {
  return room?.hotel_id || window.hotelIdGlobal || null;
}

async function consultarDescuentosBase(supabase, hotelId, codigoManual = null) {
  if (!supabase) return [];

  const ahora = new Date().toISOString();
  let query = supabase
    .from('descuentos')
    .select('*')
    .eq('activo', true)
    .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
    .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

  if (hotelId) {
    query = query.eq('hotel_id', hotelId);
  }

  if (codigoManual) {
    query = query.eq('codigo', codigoManual.toUpperCase());
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error consultando descuentos:', error);
    return [];
  }

  return (data || []).filter(descuentoDisponible);
}

export async function buscarDescuentoAplicable(fechaCobro, room, reservaActiva, supabase) {
  try {
    const diaActual = obtenerDiaSemana(fechaCobro);
    const descuentos = await consultarDescuentosBase(supabase, hotelIdDesdeContexto(room));

    let mejorDescuento = null;
    for (const desc of descuentos) {
      const condition = desc.condiciones || {};

      if (condition.dias_semana && Array.isArray(condition.dias_semana) && !condition.dias_semana.includes(diaActual)) {
        continue;
      }
      if (condition.tipo_habitacion && room?.tipo_id && String(condition.tipo_habitacion) !== String(room.tipo_id)) {
        continue;
      }
      if (condition.duracion_minima_horas && reservaActiva?.horas && reservaActiva.horas < condition.duracion_minima_horas) {
        continue;
      }

      if (!mejorDescuento) {
        mejorDescuento = desc;
        continue;
      }

      if (desc.tipo_descuento === 'porcentaje' && mejorDescuento.tipo_descuento === 'porcentaje' && desc.valor > mejorDescuento.valor) {
        mejorDescuento = desc;
      } else if (desc.tipo_descuento === 'monto_fijo' && mejorDescuento.tipo_descuento === 'monto_fijo' && desc.valor > mejorDescuento.valor) {
        mejorDescuento = desc;
      }
    }

    return mejorDescuento;
  } catch (err) {
    console.error('Excepcion al buscar descuentos de habitacion:', err);
    return null;
  }
}

export async function buscarDescuentoParaServicios(serviciosSeleccionados, codigoManual = null, supabaseParam = null, hotelIdParam = null) {
  try {
    if (!Array.isArray(serviciosSeleccionados) || serviciosSeleccionados.length === 0) return null;

    const supabase = supabaseParam || window.supabase || null;
    const hotelId = hotelIdParam || window.hotelIdGlobal || null;
    const descuentos = await consultarDescuentosBase(supabase, hotelId, codigoManual);
    if (descuentos.length === 0) return null;

    for (const descuento of descuentos) {
      const aplicabilidad = descuento.aplicabilidad || descuento.aplicable_a;
      if (!['servicios', 'servicios_adicionales', 'ambos'].includes(aplicabilidad)) {
        continue;
      }

      const idsAplicables = descuento.habitaciones_aplicables || [];
      const serviciosAfectados = serviciosSeleccionados.filter((servicio) => idsAplicables.length === 0 || idsAplicables.includes(servicio.servicio_id));
      const baseDescuento = serviciosAfectados.reduce((sum, servicio) => sum + ((Number(servicio.cantidad) || 1) * (Number(servicio.precio) || 0)), 0);

      if (baseDescuento <= 0) continue;

      let monto = descuento.tipo_descuento === 'porcentaje'
        ? baseDescuento * ((Number(descuento.valor) || 0) / 100)
        : Number(descuento.valor) || 0;

      monto = Math.min(monto, baseDescuento);

      return {
        descuento,
        monto,
        serviciosAplicadosNombres: serviciosAfectados.map((servicio) => servicio.nombre).join(', ')
      };
    }

    return null;
  } catch (err) {
    console.error('Excepcion al buscar descuentos de servicios:', err);
    return null;
  }
}

export async function buscarDescuentoParaAlquiler(...args) {
  try {
    if (args[0] && typeof args[0].from === 'function') {
      const [
        supabase,
        hotelId,
        clienteId,
        habitacionId,
        codigoManual = null,
        minutosSeleccionados = 0,
        nochesSeleccionadas = 0,
        tiempos = []
      ] = args;

      const ahora = new Date().toISOString();
      let query = supabase
        .from('descuentos')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('activo', true)
        .or(`fecha_inicio.is.null,fecha_inicio.lte.${ahora}`)
        .or(`fecha_fin.is.null,fecha_fin.gte.${ahora}`);

      const orConditions = ['tipo_descuento_general.eq.automatico'];
      if (codigoManual) orConditions.push(`codigo.eq.${codigoManual.toUpperCase()}`);
      if (clienteId) orConditions.push(`cliente_id.eq.${clienteId}`);
      query = query.or(orConditions.join(','));

      const { data, error } = await query;
      if (error) {
        console.error('Error buscando descuentos para alquiler:', error);
        return null;
      }

      const descuentosValidos = (data || []).filter(descuentoDisponible);

      if (clienteId) {
        const porCliente = descuentosValidos.find((descuento) => String(descuento.cliente_id) === String(clienteId));
        if (porCliente) return porCliente;
      }

      if (codigoManual) {
        const porCodigo = descuentosValidos.find((descuento) => descuento.codigo && descuento.codigo.toUpperCase() === codigoManual.toUpperCase());
        if (porCodigo) return porCodigo;
      }

      for (const descuento of descuentosValidos) {
        const aplicabilidad = descuento.aplicabilidad;
        const itemsAplicables = descuento.habitaciones_aplicables || [];

        if (aplicabilidad === 'tiempos_estancia_especificos') {
          if (nochesSeleccionadas > 0 && itemsAplicables.includes('NOCHE_COMPLETA')) {
            return descuento;
          }

          if (minutosSeleccionados > 0) {
            const tiempoHora = (tiempos || []).find((tiempo) => Number(tiempo.minutos) === Number(minutosSeleccionados));
            if (tiempoHora && itemsAplicables.includes(tiempoHora.id)) {
              return descuento;
            }
          }
        } else if (aplicabilidad === 'habitaciones_especificas' && habitacionId && itemsAplicables.includes(habitacionId)) {
          return descuento;
        } else if (aplicabilidad === 'reserva_total') {
          return descuento;
        }
      }

      return null;
    }

    const [fechaCobro, room, tiempoDuracionHoras, supabase] = args;
    const diaActual = obtenerDiaSemana(fechaCobro);
    const descuentos = await consultarDescuentosBase(supabase, hotelIdDesdeContexto(room));
    if (descuentos.length === 0) return null;

    let mejorDescuento = null;
    for (const desc of descuentos) {
      if (!['habitaciones', 'ambos'].includes(desc.aplicable_a)) continue;

      const condition = desc.condiciones || {};
      if (condition.dias_semana && Array.isArray(condition.dias_semana) && !condition.dias_semana.includes(diaActual)) {
        continue;
      }
      if (condition.tipo_habitacion && room && String(condition.tipo_habitacion) !== String(room.tipo_id)) {
        continue;
      }
      if (condition.duracion_minima_horas && tiempoDuracionHoras && tiempoDuracionHoras < condition.duracion_minima_horas) {
        continue;
      }

      if (!mejorDescuento) {
        mejorDescuento = desc;
        continue;
      }

      if (desc.tipo_descuento === 'porcentaje' && mejorDescuento.tipo_descuento === 'porcentaje' && desc.valor > mejorDescuento.valor) {
        mejorDescuento = desc;
      } else if (desc.tipo_descuento === 'monto_fijo' && mejorDescuento.tipo_descuento === 'monto_fijo' && desc.valor > mejorDescuento.valor) {
        mejorDescuento = desc;
      }
    }

    return mejorDescuento;
  } catch (err) {
    console.error('Excepcion al buscar descuento para alquiler:', err);
    return null;
  }
}
