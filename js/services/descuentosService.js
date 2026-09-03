function toDate(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizarCodigoDescuento(value) {
  return String(value || '').trim().toUpperCase();
}

export function descuentoEstaVigente(descuento, fechaReferencia = new Date()) {
  if (!descuento || descuento.activo === false) return false;

  const referencia = toDate(fechaReferencia) || new Date();
  const inicio = toDate(descuento.fecha_inicio);
  const fin = toDate(descuento.fecha_fin);
  const expiracion = toDate(descuento.expiracion);

  if (inicio && referencia < inicio) return false;
  if (fin && referencia > fin) return false;
  if (expiracion && referencia > expiracion) return false;

  const usosMaximos = Number(descuento.usos_maximos) || 0;
  const usosActuales = Number(descuento.usos_actuales) || 0;
  if (usosMaximos > 0 && usosActuales >= usosMaximos) return false;

  return true;
}

function rankModoDescuento(descuento, { codigoManual = null, clienteId = null } = {}) {
  const tipoGeneral = String(descuento?.tipo_descuento_general || '').trim();
  const codigo = normalizarCodigoDescuento(codigoManual);

  if (
    tipoGeneral === 'cliente_especifico' &&
    clienteId &&
    String(descuento?.cliente_id || '') === String(clienteId)
  ) {
    return 3;
  }

  if (
    tipoGeneral === 'codigo' &&
    codigo &&
    normalizarCodigoDescuento(descuento?.codigo) === codigo
  ) {
    return 2;
  }

  if (tipoGeneral === 'automatico') return 1;
  return 0;
}

export function descuentoCoincideConAcceso(descuento, contexto = {}) {
  return rankModoDescuento(descuento, contexto) > 0;
}

export async function consultarDescuentosElegibles({
  supabase,
  hotelId,
  codigoManual = null,
  clienteId = null,
  fechaReferencia = new Date()
}) {
  if (!supabase || !hotelId) return [];

  const { data, error } = await supabase
    .from('descuentos')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('activo', true);

  if (error) throw error;

  const contexto = { codigoManual, clienteId };
  return (data || []).filter(
    (descuento) => descuentoEstaVigente(descuento, fechaReferencia) && descuentoCoincideConAcceso(descuento, contexto)
  );
}

function idsAplicables(descuento) {
  return Array.isArray(descuento?.habitaciones_aplicables)
    ? descuento.habitaciones_aplicables.map((value) => String(value))
    : [];
}

export function descuentoAplicaAReserva(descuento, {
  habitacionId = null,
  tiempoEstanciaId = null,
  esNoche = false
} = {}) {
  const aplicabilidad = String(descuento?.aplicabilidad || '');
  const items = idsAplicables(descuento);

  if (aplicabilidad === 'reserva_total') return true;
  if (aplicabilidad === 'todas_las_habitaciones') return Boolean(habitacionId);

  if (aplicabilidad === 'habitaciones_especificas') {
    return Boolean(habitacionId) && items.includes(String(habitacionId));
  }

  if (aplicabilidad === 'tiempos_estancia_especificos') {
    if (esNoche && items.includes('NOCHE_COMPLETA')) return true;
    return Boolean(tiempoEstanciaId) && items.includes(String(tiempoEstanciaId));
  }

  return false;
}

export function serviciosAplicablesAlDescuento(descuento, servicios = []) {
  if (String(descuento?.aplicabilidad || '') !== 'servicios_adicionales') return [];
  const items = idsAplicables(descuento);
  const lista = Array.isArray(servicios) ? servicios : [];

  return lista.filter((servicio) => {
    const servicioId = servicio?.servicio_id || servicio?.id;
    return servicioId && (items.length === 0 || items.includes(String(servicioId)));
  });
}

export function seleccionarDescuentoPreferido(descuentos = [], contexto = {}, predicate = () => true) {
  const lista = Array.isArray(descuentos) ? descuentos : [];
  const candidatos = lista.filter((descuento) => predicate(descuento));

  for (const rank of [3, 2, 1]) {
    const encontrado = candidatos.find((descuento) => rankModoDescuento(descuento, contexto) === rank);
    if (encontrado) return encontrado;
  }

  return null;
}

export function calcularMontoDescuento(descuento, base) {
  const baseSegura = Math.max(0, Number(base) || 0);
  const valor = Math.max(0, Number(descuento?.valor) || 0);
  if (!descuento || baseSegura <= 0 || valor <= 0) return 0;

  const monto = descuento.tipo === 'porcentaje'
    ? baseSegura * (valor / 100)
    : valor;

  return Math.min(baseSegura, Math.max(0, monto));
}
