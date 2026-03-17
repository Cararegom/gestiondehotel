export async function buscarDescuentoParaReserva({
  supabase,
  hotelId,
  formData,
  codigoManual = null
}) {
  if (!formData?.habitacion_id && !codigoManual && !formData?.cliente_id) return null;

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
  if (formData?.cliente_id) orConditions.push(`cliente_id.eq.${formData.cliente_id}`);
  query = query.or(orConditions.join(','));

  const { data: descuentosPotenciales, error } = await query;
  if (error) {
    console.error('Error buscando descuentos de reserva:', error);
    return null;
  }

  const descuentosValidos = (descuentosPotenciales || []).filter(
    (descuento) => (descuento.usos_maximos || 0) === 0 || (descuento.usos_actuales || 0) < descuento.usos_maximos
  );

  if (formData?.cliente_id) {
    const descuentoCliente = descuentosValidos.find((descuento) => descuento.cliente_id === formData.cliente_id);
    if (descuentoCliente) return descuentoCliente;
  }

  if (codigoManual) {
    const descuentoCodigo = descuentosValidos.find(
      (descuento) => descuento.codigo && descuento.codigo.toUpperCase() === codigoManual.toUpperCase()
    );
    if (descuentoCodigo) return descuentoCodigo;
  }

  for (const descuento of descuentosValidos) {
    const aplicabilidad = descuento.aplicabilidad;
    const itemsAplicables = descuento.habitaciones_aplicables || [];

    if (aplicabilidad === 'tiempos_estancia_especificos') {
      if (formData?.tipo_calculo_duracion === 'noches_manual' && itemsAplicables.includes('NOCHE_COMPLETA')) {
        return descuento;
      }
      if (
        formData?.tipo_calculo_duracion === 'tiempo_predefinido' &&
        formData?.tiempo_estancia_id &&
        itemsAplicables.includes(formData.tiempo_estancia_id)
      ) {
        return descuento;
      }
    } else if (
      aplicabilidad === 'habitaciones_especificas' &&
      formData?.habitacion_id &&
      itemsAplicables.includes(formData.habitacion_id)
    ) {
      return descuento;
    } else if (aplicabilidad === 'reserva_total') {
      return descuento;
    }
  }

  return null;
}
