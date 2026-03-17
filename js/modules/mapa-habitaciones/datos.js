import { formatCurrency } from '../../uiUtils.js';

function resolveSupabase(arg1, arg2) {
  if (arg1 && typeof arg1.from === 'function') return { supabase: arg1, hotelId: arg2 };
  if (arg2 && typeof arg2.from === 'function') return { supabase: arg2, hotelId: arg1 };
  return { supabase: window.supabase || null, hotelId: arg2 || arg1 || null };
}

function calcularSaldoReservaLocal(reservaActiva) {
  if (!reservaActiva) return {
    montoHabitacion: 0,
    montoPenalidadNoPagada: 0,
    montoExtensiones: 0,
    consumosPendientes: 0,
    deudaTotalParcial: 0,
    totalAbonado: 0,
    saldoGeneral: 0,
    tieneConsumosExtra: false
  };

  const totalAbonosPuros = Array.isArray(reservaActiva.pagos)
    ? reservaActiva.pagos.reduce((sum, pago) => sum + (Number(pago.monto) || 0), 0)
    : 0;

  const montoHabitacion = Number(reservaActiva.monto_total || 0);

  const itemsPenalidad = Array.isArray(reservaActiva.historial_consumos)
    ? reservaActiva.historial_consumos.filter((item) => item.nota && item.nota.includes('Penalidad') && item.estado !== 'pagado')
    : [];
  const montoPenalidadNoPagada = itemsPenalidad.reduce((sum, item) => {
    return sum + ((Number(item.precio_unitario) || 0) * (Number(item.cantidad) || 1));
  }, 0);

  const montoExtensiones = Array.isArray(reservaActiva.extensiones)
    ? reservaActiva.extensiones.reduce((sum, ext) => sum + (Number(ext.monto) || 0), 0)
    : 0;

  let montoAbonosExtra = 0;
  let consumosPendientes = 0;
  let tieneConsumosExtra = false;

  if (Array.isArray(reservaActiva.historial_consumos)) {
    reservaActiva.historial_consumos.forEach((item) => {
      if (item.estado === 'pagado') {
        if (!item.nota || !item.nota.includes('Penalidad')) {
          if (item.cantidad === 1 && item.precio_unitario > Number(reservaActiva.monto_total)) {
            const abono = Number(item.precio_unitario) - Number(reservaActiva.monto_total);
            if (abono > 0) montoAbonosExtra += abono;
          }
        }
        return;
      }

      if (!item.nota || !item.nota.includes('Penalidad')) {
        const extra = item.cantidad > 1
          ? ((item.cantidad - 1) * item.precio_unitario)
          : (Number(item.precio_unitario) * Number(item.cantidad));

        consumosPendientes += Number(extra || 0);
        tieneConsumosExtra = true;
      }
    });
  }

  const totalDebeHabitacion = montoHabitacion + montoExtensiones;
  const deudaTotalParcial = totalDebeHabitacion + montoPenalidadNoPagada + consumosPendientes;
  const totalAbonado = totalAbonosPuros + montoAbonosExtra;

  return {
    montoHabitacion,
    montoPenalidadNoPagada,
    montoExtensiones,
    consumosPendientes,
    deudaTotalParcial,
    totalAbonado,
    saldoGeneral: Math.max(0, deudaTotalParcial - totalAbonado),
    tieneConsumosExtra
  };
}

export function calcularSaldoReserva(arg1, reservaId, hotelId) {
  if (arg1 && typeof arg1.from === 'function' && reservaId) {
    const supabase = arg1;
    return (async () => {
      const [
        { data: reserva },
        { data: servicios },
        { data: ventasTienda },
        { data: ventasRest },
        { data: pagos }
      ] = await Promise.all([
        supabase.from('reservas').select('monto_total').eq('id', reservaId).maybeSingle(),
        supabase.from('servicios_x_reserva').select('precio_cobrado').eq('reserva_id', reservaId).eq('hotel_id', hotelId),
        supabase.from('ventas_tienda').select('total_venta').eq('reserva_id', reservaId).eq('hotel_id', hotelId),
        supabase.from('ventas_restaurante').select('monto_total, total_venta').eq('reserva_id', reservaId).eq('hotel_id', hotelId),
        supabase.from('pagos_reserva').select('monto').eq('reserva_id', reservaId).eq('hotel_id', hotelId)
      ]);

      const totalEstancia = Number(reserva?.monto_total || 0);
      const totalServicios = (servicios || []).reduce((acc, item) => acc + Number(item.precio_cobrado || 0), 0);
      const totalTienda = (ventasTienda || []).reduce((acc, item) => acc + Number(item.total_venta || 0), 0);
      const totalRest = (ventasRest || []).reduce((acc, item) => acc + Number(item.monto_total || item.total_venta || 0), 0);
      const totalPagado = (pagos || []).reduce((acc, item) => acc + Number(item.monto || 0), 0);

      return {
        totalDeTodosLosCargos: totalEstancia + totalServicios + totalTienda + totalRest,
        totalPagado,
        saldoPendiente: totalEstancia + totalServicios + totalTienda + totalRest - totalPagado
      };
    })();
  }

  return calcularSaldoReservaLocal(arg1);
}

export async function obtenerReservaActivaIdDeHabitacion(habitacionId, supabaseParam = null) {
  const supabase = supabaseParam || window.supabase;
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('reservas')
    .select('id')
    .eq('habitacion_id', habitacionId)
    .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error obteniendo reserva activa para hab:', habitacionId, error);
    return null;
  }
  return data?.id || null;
}

export async function getHorariosHotel(arg1, arg2, arg3) {
  let supabase = null;
  let hotelId = null;
  let hotelConfig = null;

  if (arg1 && typeof arg1.from === 'function') {
    supabase = arg1;
    hotelId = arg2;
    hotelConfig = window.hotelConfigGlobal || {};
  } else {
    hotelId = arg1;
    hotelConfig = arg2 || window.hotelConfigGlobal || {};
    supabase = arg3 || window.supabase || null;
  }

  let checkin = hotelConfig?.checkin_hora_config || '15:00';
  let checkout = hotelConfig?.checkout_hora_config || '12:00';
  let applyLimits = true;

  if ((!hotelConfig || Object.keys(hotelConfig).length === 0) && supabase && hotelId) {
    const { data, error } = await supabase
      .from('configuracion_hotel')
      .select('checkin_hora_config, checkout_hora_config')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    if (!error && data) {
      checkin = data.checkin_hora_config || checkin;
      checkout = data.checkout_hora_config || checkout;
    }
  }

  return {
    checkin,
    checkout,
    checkInTime: checkin,
    checkOutTime: checkout,
    applyLimits
  };
}

export async function puedeHacerCheckIn(reservaParaValidar, hotelId, hotelConfigParam, supabaseParam, mostrarInfoParam) {
  const supabase = supabaseParam || window.supabase;
  const hotelConfig = hotelConfigParam || window.hotelConfigGlobal || {};
  const mostrarInfo = mostrarInfoParam || window.mostrarInfoModalGlobal || ((msg, title) => alert(`${title || 'Info'}: ${msg}`));

  if (typeof reservaParaValidar === 'string') {
    const reservaId = reservaParaValidar;

    if (hotelConfig && hotelConfig.cobro_al_checkin === false) {
      return true;
    }

    if (!supabase) return true;

    const { data: reserva, error: errReserva } = await supabase
      .from('reservas')
      .select('id, monto_total, cliente_nombre')
      .eq('id', reservaId)
      .maybeSingle();

    if (errReserva || !reserva) {
      console.error('Error obteniendo reserva para puedeHacerCheckIn:', errReserva);
      return false;
    }

    if (!reserva.monto_total || reserva.monto_total <= 0) return true;

    const { data: pagos, error: errPagos } = await supabase
      .from('pagos_reserva')
      .select('monto')
      .eq('reserva_id', reservaId);

    if (errPagos) {
      console.error('Error consultando pagos para puedeHacerCheckIn:', errPagos);
      return false;
    }

    const totalPagado = Array.isArray(pagos) ? pagos.reduce((sum, item) => sum + Number(item.monto || 0), 0) : 0;
    if (totalPagado >= reserva.monto_total) return true;

    const pendiente = reserva.monto_total - totalPagado;
    const monedaSimbolo = hotelConfig?.moneda_local_simbolo || hotelConfig?.moneda_local || '$';
    const html = `La reserva de <strong>${reserva.cliente_nombre || 'este huésped'}</strong> tiene un saldo pendiente de <strong>${formatCurrency(pendiente, monedaSimbolo)}</strong>.<br/>Según la política del hotel, se requiere el pago total de <strong>${formatCurrency(reserva.monto_total, monedaSimbolo)}</strong> para realizar el check-in.`;

    if (typeof Swal !== 'undefined') {
      await Swal.fire({
        icon: 'warning',
        title: 'Pago Pendiente para Check-in',
        html,
        confirmButtonColor: '#1d4ed8'
      });
    } else {
      mostrarInfo(html, 'Pago Pendiente para Check-in');
    }
    return false;
  }

  if (!reservaParaValidar) return true;

  try {
    const horarios = await getHorariosHotel(hotelId, hotelConfig, supabase);
    if (!horarios.applyLimits) return true;

    const [confHora, confMin] = horarios.checkInTime.split(':').map((value) => parseInt(value, 10));
    const fechaInicioReserva = new Date(reservaParaValidar.fecha_inicio);
    if (Number.isNaN(fechaInicioReserva.getTime())) return true;

    const hLimiteCheckIn = new Date(
      fechaInicioReserva.getFullYear(),
      fechaInicioReserva.getMonth(),
      fechaInicioReserva.getDate(),
      confHora,
      confMin,
      0
    );

    if (new Date() < hLimiteCheckIn) {
      mostrarInfo(
        `Aún no es la hora de Check-in para esta reserva. La hora configurada por el hotel es a partir de las ${hLimiteCheckIn.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}.`,
        'Aviso de Check-in Temprano'
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error validando horario de checkin:', error);
    return true;
  }
}

export async function getTiemposEstancia(arg1, arg2) {
  const { supabase, hotelId } = resolveSupabase(arg1, arg2);
  if (!supabase || !hotelId) return [];

  const runQuery = async (orderColumn) => supabase
    .from('tiempos_estancia')
    .select('*')
    .eq('hotel_id', hotelId)
    .eq('activo', true)
    .order(orderColumn, { ascending: true });

  let { data, error } = await runQuery('minutos');

  if (error && error.code === '42703') {
    ({ data, error } = await runQuery('horas'));
  }

  if (error) {
    console.error('Error obteniendo tiempos de estancia:', error);
    return [];
  }

  return (data || [])
    .map((tiempo) => {
      const minutos = Number(tiempo.minutos);
      const horas = Number(tiempo.horas);
      const minutosNormalizados = Number.isFinite(minutos) && minutos > 0
        ? minutos
        : (Number.isFinite(horas) && horas > 0 ? horas * 60 : 0);

      return {
        ...tiempo,
        minutos: minutosNormalizados,
        horas: Number.isFinite(horas) && horas > 0 ? horas : (minutosNormalizados > 0 ? minutosNormalizados / 60 : 0)
      };
    })
    .sort((a, b) => Number(a.minutos || 0) - Number(b.minutos || 0));
}

export async function getMetodosPago(arg1, arg2) {
  const { supabase, hotelId } = resolveSupabase(arg1, arg2);
  if (!supabase) return [];

  let query = supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('activo', true)
    .order('nombre', { ascending: true });

  if (hotelId) {
    query = query.eq('hotel_id', hotelId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Error obteniendo métodos de pago:', error);
    return [];
  }
  return data || [];
}
