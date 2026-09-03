import {
  calcularMontoDescuento,
  consultarDescuentosElegibles,
  descuentoAplicaAReserva,
  normalizarCodigoDescuento,
  seleccionarDescuentoPreferido,
  serviciosAplicablesAlDescuento
} from '../../services/descuentosService.js';

function runtimeWindow() {
  return typeof window !== 'undefined' ? window : {};
}

export async function buscarDescuentoParaServicios(
  serviciosSeleccionados,
  codigoManual = null,
  supabaseParam = null,
  hotelIdParam = null
) {
  try {
    if (!Array.isArray(serviciosSeleccionados) || serviciosSeleccionados.length === 0) return null;

    const appWindow = runtimeWindow();
    const supabase = supabaseParam || appWindow.supabase || null;
    const hotelId = hotelIdParam || appWindow.hotelIdGlobal || null;
    if (!supabase || !hotelId) return null;

    const codigo = normalizarCodigoDescuento(codigoManual);
    const descuentos = await consultarDescuentosElegibles({
      supabase,
      hotelId,
      codigoManual: codigo || null
    });

    const candidatos = codigo
      ? descuentos.filter((descuento) => descuento.tipo_descuento_general === 'codigo')
      : descuentos;

    const descuento = seleccionarDescuentoPreferido(
      candidatos,
      { codigoManual: codigo || null },
      (item) => serviciosAplicablesAlDescuento(item, serviciosSeleccionados).length > 0
    );

    if (!descuento) return null;

    const serviciosAfectados = serviciosAplicablesAlDescuento(descuento, serviciosSeleccionados);
    const baseDescuento = serviciosAfectados.reduce(
      (sum, servicio) => sum + ((Number(servicio.cantidad) || 1) * (Number(servicio.precio) || 0)),
      0
    );
    const monto = calcularMontoDescuento(descuento, baseDescuento);
    if (monto <= 0) return null;

    return {
      descuento,
      monto,
      serviciosAplicadosNombres: serviciosAfectados.map((servicio) => servicio.nombre).filter(Boolean).join(', ')
    };
  } catch (err) {
    console.error('Excepcion al buscar descuentos de servicios:', err);
    return null;
  }
}

export async function buscarDescuentoParaAlquiler(
  supabase,
  hotelId,
  clienteId,
  habitacionId,
  codigoManual = null,
  minutosSeleccionados = 0,
  nochesSeleccionadas = 0,
  tiempos = []
) {
  try {
    if (!supabase || !hotelId) return null;

    const codigo = normalizarCodigoDescuento(codigoManual);
    const descuentos = await consultarDescuentosElegibles({
      supabase,
      hotelId,
      clienteId,
      codigoManual: codigo || null
    });

    const tiempoHora = Number(minutosSeleccionados) > 0
      ? (tiempos || []).find((tiempo) => Number(tiempo.minutos) === Number(minutosSeleccionados))
      : null;

    return seleccionarDescuentoPreferido(
      descuentos,
      { clienteId, codigoManual: codigo || null },
      (descuento) => descuentoAplicaAReserva(descuento, {
        habitacionId,
        tiempoEstanciaId: tiempoHora?.id || null,
        esNoche: Number(nochesSeleccionadas) > 0
      })
    );
  } catch (err) {
    console.error('Excepcion al buscar descuento para alquiler:', err);
    return null;
  }
}
