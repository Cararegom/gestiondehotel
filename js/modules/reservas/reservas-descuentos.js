import {
  consultarDescuentosElegibles,
  descuentoAplicaAReserva,
  normalizarCodigoDescuento,
  seleccionarDescuentoPreferido
} from '../../services/descuentosService.js';

export async function buscarDescuentoParaReserva({
  supabase,
  hotelId,
  formData,
  codigoManual = null
}) {
  if (!supabase || !hotelId) return null;
  if (!formData?.habitacion_id && !codigoManual && !formData?.cliente_id) return null;

  try {
    const codigo = normalizarCodigoDescuento(codigoManual);
    const descuentos = await consultarDescuentosElegibles({
      supabase,
      hotelId,
      clienteId: formData?.cliente_id || null,
      codigoManual: codigo || null
    });

    return seleccionarDescuentoPreferido(
      descuentos,
      {
        clienteId: formData?.cliente_id || null,
        codigoManual: codigo || null
      },
      (descuento) => descuentoAplicaAReserva(descuento, {
        habitacionId: formData?.habitacion_id || null,
        tiempoEstanciaId: formData?.tipo_calculo_duracion === 'tiempo_predefinido'
          ? formData?.tiempo_estancia_id || null
          : null,
        esNoche: formData?.tipo_calculo_duracion === 'noches_manual'
      })
    );
  } catch (error) {
    console.error('Error buscando descuentos de reserva:', error);
    return null;
  }
}
