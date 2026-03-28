import { turnoService } from '../../services/turnoService.js';
import {
  hideGlobalLoading,
  showConfirmationModal,
  showError,
  showGlobalLoading,
  showSuccess
} from '../../uiUtils.js';

export async function solicitarMontoInicialTurno() {
  if (typeof Swal !== 'undefined') {
    const result = await Swal.fire({
      title: 'Abrir turno',
      text: 'Ingresa el monto inicial de caja.',
      input: 'number',
      inputValue: '0',
      inputAttributes: {
        min: '0',
        step: '0.01'
      },
      showCancelButton: true,
      confirmButtonText: 'Abrir turno',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#16a34a',
      inputValidator: (value) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0) {
          return 'Debes ingresar un monto igual o mayor a 0.';
        }
        return null;
      }
    });

    if (!result.isConfirmed) return null;
    return Number(result.value);
  }

  const montoInicialStr = prompt('Cual es el monto inicial de caja?');
  if (montoInicialStr === null) return null;

  const montoInicial = Number(montoInicialStr);
  return Number.isFinite(montoInicial) ? montoInicial : Number.NaN;
}

export async function seleccionarMetodoPago(metodos, metodoActualId = '') {
  if (!Array.isArray(metodos) || metodos.length === 0) return null;

  if (typeof Swal !== 'undefined') {
    const inputOptions = Object.fromEntries(
      metodos.map((metodo) => [metodo.id, metodo.nombre || 'Sin nombre'])
    );

    const result = await Swal.fire({
      title: 'Cambiar metodo de pago',
      input: 'select',
      inputOptions,
      inputValue: metodoActualId || metodos[0].id,
      showCancelButton: true,
      confirmButtonText: 'Guardar',
      cancelButtonText: 'Cancelar',
      confirmButtonColor: '#2563eb',
      inputPlaceholder: 'Selecciona un metodo'
    });

    if (!result.isConfirmed) return null;
    return result.value;
  }

  const opciones = metodos.map((metodo, index) => `${index + 1}. ${metodo.nombre}`).join('\n');
  const seleccionado = prompt(`Selecciona el metodo de pago:\n${opciones}`);
  const indice = Number(seleccionado) - 1;
  return metodos[indice]?.id || null;
}

export async function confirmAction(options) {
  if (typeof Swal !== 'undefined') {
    return showConfirmationModal(options);
  }

  const plainText = String(options?.text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return window.confirm(plainText || 'Estas seguro de continuar?');
}

export async function iniciarModoSupervision({ turno, setTurnoEnSupervision, renderizarUI }) {
  setTurnoEnSupervision(turno);
  document.getElementById('modal-turnos-abiertos')?.remove();
  await renderizarUI();
}

export async function salirModoSupervision({ setTurnoEnSupervision, renderizarUI }) {
  setTurnoEnSupervision(null);
  await renderizarUI();
}

export async function verificarTurnoActivo({
  supabase,
  currentModuleUser,
  currentHotelId,
  currentContainerEl
}) {
  if (!currentModuleUser?.id || !currentHotelId) return null;

  const { data: turnosAbiertos, error } = await supabase
    .from('turnos')
    .select('*, usuarios(nombre, email)')
    .eq('usuario_id', currentModuleUser.id)
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'abierto')
    .order('fecha_apertura', { ascending: false });

  if (error) {
    console.error('Error verificando turno activo:', error);
    showError(
      currentContainerEl.querySelector('#turno-global-feedback'),
      'No se pudo verificar el estado del turno.'
    );
    return null;
  }

  if (!turnosAbiertos || turnosAbiertos.length === 0) {
    return null;
  }

  if (turnosAbiertos.length > 1) {
    console.warn(
      `[Caja] Hay ${turnosAbiertos.length} turnos abiertos para este usuario. Tomare el mas reciente. IDs:`,
      turnosAbiertos.map((turno) => turno.id)
    );
  }

  const turnoReciente = turnosAbiertos[0];
  turnoService.setActiveTurn(turnoReciente.id);
  return turnoReciente;
}

export async function abrirTurnoFlow({
  supabase,
  currentHotelId,
  currentModuleUser,
  currentContainerEl,
  renderizarUI,
  setTurnoActivo
}) {
  const montoInicial = await solicitarMontoInicialTurno();
  if (montoInicial === null) {
    return;
  }

  if (!Number.isFinite(montoInicial) || montoInicial < 0) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'Monto invalido. Turno no iniciado.');
    return;
  }

  showGlobalLoading('Abriendo nuevo turno...');
  try {
    const fechaMovimiento = new Date().toISOString();
    const { data: nuevoTurno, error } = await supabase.rpc('abrir_turno_con_apertura', {
      p_hotel_id: currentHotelId,
      p_usuario_id: currentModuleUser.id,
      p_monto_inicial: montoInicial,
      p_fecha_movimiento: fechaMovimiento
    });
    if (error) throw error;

    const turnoPreparado = {
      ...nuevoTurno,
      usuarios: {
        nombre: currentModuleUser?.nombre || currentModuleUser?.email || 'Usuario',
        email: currentModuleUser?.email || ''
      }
    };

    setTurnoActivo(turnoPreparado);
    turnoService.setActiveTurn(turnoPreparado.id);
    await renderizarUI();
    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Turno iniciado con exito.');
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al abrir turno: ${err.message}`);
    await renderizarUI();
  } finally {
    hideGlobalLoading();
  }
}

export async function cerrarTurnoFlow({
  turnoExterno = null,
  usuarioDelTurnoExterno = null,
  valoresReales = null,
  turnoActivo,
  currentModuleUser,
  currentHotelId,
  currentContainerEl,
  supabase,
  renderizarUI,
  setTurnoActivo,
  setTurnoEnSupervision,
  procesarMovimientosParaReporte,
  calcularTotalesSistemaCierre,
  generarHTMLReporteCierre,
  enviarReporteCierreCaja,
  sortMovementsByDate
}) {
  const turnoACerrar = turnoExterno || turnoActivo;
  const usuarioDelTurno = usuarioDelTurnoExterno || currentModuleUser;

  if (!turnoACerrar) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay un turno activo para cerrar.');
    return;
  }

  const esCierreForzoso = !!turnoExterno;
  const adminNombre = currentModuleUser?.email;
  const tituloLoading = esCierreForzoso
    ? `Forzando cierre del turno de ${usuarioDelTurno.nombre || 'usuario'}...`
    : 'Realizando cierre de turno...';

  showGlobalLoading(tituloLoading);

  try {
    const fechaCierreISO = new Date().toISOString();
    const fechaAperturaISO = turnoACerrar.fecha_apertura;
    const usuarioDelTurnoId = usuarioDelTurno.id;

    const { data: metodosDePago, error: metodosError } = await supabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', currentHotelId)
      .eq('activo', true)
      .order('nombre');
    if (metodosError) throw metodosError;

    const { data: movimientos, error: movError } = await supabase
      .from('caja')
      .select('*, usuarios(nombre), metodos_pago(nombre)')
      .eq('turno_id', turnoACerrar.id);
    if (movError) throw movError;

    const [
      { data: logAmenidades, error: logAmenidadesError },
      { data: logLenceria, error: logLenceriaError },
      { data: logPrestamos, error: logPrestamosError },
      { data: stockAmenidades, error: stockAmenidadesError },
      { data: stockLenceria, error: stockLenceriaError }
    ] = await Promise.all([
      supabase
        .from('log_amenidades_uso')
        .select('*, amenidades_inventario(nombre_item), habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_uso', fechaAperturaISO)
        .lte('fecha_uso', fechaCierreISO),
      supabase
        .from('log_lenceria_uso')
        .select('*, inventario_lenceria(nombre_item), habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_uso', fechaAperturaISO)
        .lte('fecha_uso', fechaCierreISO),
      supabase
        .from('historial_articulos_prestados')
        .select('*, habitaciones(nombre)')
        .eq('usuario_id', usuarioDelTurnoId)
        .gte('fecha_accion', fechaAperturaISO)
        .lte('fecha_accion', fechaCierreISO),
      supabase
        .from('amenidades_inventario')
        .select('nombre_item, stock_actual')
        .eq('hotel_id', currentHotelId),
      supabase
        .from('inventario_lenceria')
        .select('nombre_item, stock_limpio_almacen, stock_en_lavanderia, stock_total')
        .eq('hotel_id', currentHotelId)
    ]);

    if (logAmenidadesError) throw logAmenidadesError;
    if (logLenceriaError) throw logLenceriaError;
    if (logPrestamosError) throw logPrestamosError;
    if (stockAmenidadesError) throw stockAmenidadesError;
    if (stockLenceriaError) throw stockLenceriaError;

    const movimientosOrdenados = sortMovementsByDate(movimientos, true);
    const reporte = procesarMovimientosParaReporte(movimientos);
    const { balanceFinal: balanceFinalEnCaja } = calcularTotalesSistemaCierre(reporte, metodosDePago);

    const fechaCierreLocal = new Date(fechaCierreISO).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = usuarioDelTurno?.nombre || usuarioDelTurno?.email || 'Sistema';

    let asuntoEmail = `Cierre de Caja - ${usuarioNombre} - ${fechaCierreLocal}`;
    if (esCierreForzoso) {
      asuntoEmail += ` (Forzado por ${adminNombre})`;
    }

    const htmlReporte = generarHTMLReporteCierre(
      reporte,
      metodosDePago,
      usuarioNombre,
      fechaCierreLocal,
      movimientosOrdenados || [],
      logAmenidades || [],
      logLenceria || [],
      logPrestamos || [],
      stockAmenidades || [],
      stockLenceria || [],
      valoresReales
    );

    const emailResult = await enviarReporteCierreCaja({
      asunto: asuntoEmail,
      htmlReporte
    });

    const { error: updateError } = await supabase.rpc('cerrar_turno_con_balance', {
      p_turno_id: turnoACerrar.id,
      p_usuario_id: currentModuleUser?.id || usuarioDelTurnoId,
      p_balance_final: balanceFinalEnCaja,
      p_fecha_cierre: fechaCierreISO
    });

    if (updateError) throw updateError;

    const successMessage = emailResult?.sent
      ? 'Turno cerrado y reporte enviado.'
      : 'Turno cerrado. El reporte no se pudo enviar por correo.';

    if (turnoActivo && turnoACerrar.id === turnoActivo.id) {
      showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), successMessage);
      setTurnoActivo(null);
      setTurnoEnSupervision(null);
      turnoService.clearActiveTurn();
      await renderizarUI();
    } else if (esCierreForzoso) {
      const supervisionMessage = emailResult?.sent
        ? `Turno de ${usuarioDelTurno.nombre || 'usuario'} cerrado exitosamente.`
        : `Turno de ${usuarioDelTurno.nombre || 'usuario'} cerrado, pero el reporte no se envio por correo.`;
      showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), supervisionMessage);
      setTurnoEnSupervision(null);
      await renderizarUI();
    }
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error en el cierre de turno: ${err.message}`);
    if (turnoActivo && turnoACerrar.id === turnoActivo.id) {
      await renderizarUI();
    }
  } finally {
    hideGlobalLoading();
  }
}
