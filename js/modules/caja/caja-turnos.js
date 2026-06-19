import { turnoService } from '../../services/turnoService.js';
import {
  formatCurrency,
  hideGlobalLoading,
  showConfirmationModal,
  showError,
  showGlobalLoading,
  showSuccess
} from '../../uiUtils.js';
import { escapeHtml } from '../../security.js';

function normalizeRoleKey(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function isMeseroRoleName(value) {
  const key = normalizeRoleKey(value);
  return key === 'mesero' || key === 'mesera' || key === 'meseroa';
}

function getAssignedRoleNames(perfil = {}) {
  const rows = Array.isArray(perfil?.usuarios_roles) ? perfil.usuarios_roles : [];
  return rows.map((row) => row?.roles?.nombre || row?.rol?.nombre || row?.nombre).filter(Boolean);
}

function isMeseroProfile(perfil = {}) {
  return isMeseroRoleName(perfil?.rol) || getAssignedRoleNames(perfil).some(isMeseroRoleName);
}

function buildTerrazaInventoryHtml(productos = []) {
  const productosList = Array.isArray(productos) ? productos : [];
  const totalUnidades = productosList.reduce((acc, item) => acc + Number(item?.stock_actual || 0), 0);
  const productosBajos = productosList.filter((item) => item?.activo !== false && Number(item?.stock_actual || 0) <= Number(item?.stock_minimo || 0)).length;
  const rowsHtml = productosList.length
    ? productosList.map((item) => {
      const stockActual = Number(item?.stock_actual || 0);
      const stockMinimo = Number(item?.stock_minimo || 0);
      const stockColor = stockActual <= stockMinimo ? '#b45309' : '#166534';
      return `
        <tr>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:left; font-weight:600;">${escapeHtml(item?.nombre || 'Producto')}</td>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:left;">${escapeHtml(item?.categoria || 'Bebidas')}</td>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:right; white-space:nowrap;">${formatCurrency(item?.precio || 0)}</td>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:center; font-weight:700; color:${stockColor};">${escapeHtml(String(stockActual))}</td>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:center;">${escapeHtml(String(stockMinimo))}</td>
          <td style="border:1px solid #e5e7eb; padding:8px; text-align:center;">${item?.activo === false ? 'Inactivo' : 'Activo'}</td>
        </tr>
      `;
    }).join('')
    : '<tr><td colspan="6" style="border:1px solid #e5e7eb; padding:10px; text-align:center;">No hay productos registrados en Terraza.</td></tr>';

  return `
    <h2 class="report-heading" style="font-size:18px; color:#0f172a; margin:26px 0 10px; padding-bottom:8px; border-bottom:2px solid #2563eb;">Inventario de Terraza al cierre</h2>
    <div style="margin-bottom:10px; color:#475569; font-size:12px;">
      Productos: <strong>${escapeHtml(String(productosList.length))}</strong> | Unidades totales: <strong>${escapeHtml(String(totalUnidades))}</strong> | Bajo minimo: <strong>${escapeHtml(String(productosBajos))}</strong>
    </div>
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
      <table class="report-table" style="width:100%; border-collapse:collapse; font-size:12px;">
        <thead>
          <tr>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:left; background:#f8fafc;">Producto</th>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:left; background:#f8fafc;">Categoria</th>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:right; background:#f8fafc;">Precio</th>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:center; background:#f8fafc;">Stock</th>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:center; background:#f8fafc;">Minimo</th>
            <th style="border:1px solid #e5e7eb; padding:8px; text-align:center; background:#f8fafc;">Estado</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
  `;
}

function appendHtmlBeforeBodyEnd(html, fragment) {
  if (!fragment) return html;
  const footerPattern = /(\s*<div style="[^"]*">Este es un reporte automatico generado por Gestion de Hotel\.<\/div>)/i;
  if (footerPattern.test(html)) {
    return html.replace(footerPattern, `${fragment}$1`);
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${fragment}</body>`);
  }
  return `${html}${fragment}`;
}

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
  construirResumenOperativoCierre,
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
    let resumenOperativo = null;

    try {
      const [
        { data: ventasTiendaTurno, error: ventasTiendaError },
        { data: ventasRestauranteTurno, error: ventasRestauranteError },
        { data: ventasTerrazaTurno, error: ventasTerrazaError },
        { data: serviciosReservaTurno, error: serviciosReservaError }
      ] = await Promise.all([
        supabase
          .from('ventas_tienda')
          .select('id, total_venta, fecha, creado_en')
          .eq('hotel_id', currentHotelId)
          .eq('usuario_id', usuarioDelTurnoId)
          .gte('creado_en', fechaAperturaISO)
          .lte('creado_en', fechaCierreISO),
        supabase
          .from('ventas_restaurante')
          .select('id, monto_total, total_venta, fecha_venta, creado_en')
          .eq('hotel_id', currentHotelId)
          .eq('usuario_id', usuarioDelTurnoId)
          .gte('creado_en', fechaAperturaISO)
          .lte('creado_en', fechaCierreISO),
        supabase
          .from('terraza_pedidos')
          .select('id, total, fecha_cierre, creado_en')
          .eq('hotel_id', currentHotelId)
          .eq('usuario_id', usuarioDelTurnoId)
          .eq('estado', 'pagado')
          .gte('fecha_cierre', fechaAperturaISO)
          .lte('fecha_cierre', fechaCierreISO),
        supabase
          .from('servicios_x_reserva')
          .select('id, cantidad, precio_cobrado, descripcion_manual, creado_en')
          .eq('hotel_id', currentHotelId)
          .gte('creado_en', fechaAperturaISO)
          .lte('creado_en', fechaCierreISO)
      ]);

      if (ventasTiendaError) throw ventasTiendaError;
      if (ventasRestauranteError) throw ventasRestauranteError;
      if (ventasTerrazaError) throw ventasTerrazaError;
      if (serviciosReservaError) throw serviciosReservaError;

      const ventaTiendaIds = (ventasTiendaTurno || []).map((item) => item.id).filter(Boolean);
      const ventasRestauranteIds = (ventasRestauranteTurno || []).map((item) => item.id).filter(Boolean);
      const ventasTerrazaIds = (ventasTerrazaTurno || []).map((item) => item.id).filter(Boolean);

      const [
        { data: detallesVentasTiendaTurno, error: detallesTiendaError },
        { data: itemsVentasRestauranteTurno, error: itemsRestauranteError },
        { data: itemsVentasTerrazaTurno, error: itemsTerrazaError }
      ] = await Promise.all([
        ventaTiendaIds.length
          ? supabase
            .from('detalle_ventas_tienda')
            .select('venta_id, cantidad, subtotal')
            .in('venta_id', ventaTiendaIds)
          : Promise.resolve({ data: [], error: null }),
        ventasRestauranteIds.length
          ? supabase
            .from('ventas_restaurante_items')
            .select('venta_id, cantidad, subtotal')
            .in('venta_id', ventasRestauranteIds)
          : Promise.resolve({ data: [], error: null }),
        ventasTerrazaIds.length
          ? supabase
            .from('terraza_pedido_items')
            .select('pedido_id, cantidad, subtotal')
            .in('pedido_id', ventasTerrazaIds)
          : Promise.resolve({ data: [], error: null })
      ]);

      if (detallesTiendaError) throw detallesTiendaError;
      if (itemsRestauranteError) throw itemsRestauranteError;
      if (itemsTerrazaError) throw itemsTerrazaError;

      resumenOperativo = construirResumenOperativoCierre({
        movimientos: movimientosOrdenados || [],
        reporte,
        ventasTienda: ventasTiendaTurno || [],
        detallesVentasTienda: detallesVentasTiendaTurno || [],
        ventasRestaurante: ventasRestauranteTurno || [],
        itemsVentasRestaurante: itemsVentasRestauranteTurno || [],
        ventasTerraza: ventasTerrazaTurno || [],
        itemsVentasTerraza: itemsVentasTerrazaTurno || [],
        serviciosReserva: serviciosReservaTurno || []
      });
    } catch (resumenError) {
      console.warn('[Caja] No se pudo construir el resumen operativo del cierre.', resumenError);
    }

    const fechaCierreLocal = new Date(fechaCierreISO).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = usuarioDelTurno?.nombre || usuarioDelTurno?.email || 'Sistema';
    let inventarioTerrazaHtml = '';

    try {
      const { data: perfilCierre, error: perfilCierreError } = await supabase
        .from('usuarios')
        .select('rol, usuarios_roles(roles(nombre))')
        .eq('id', usuarioDelTurnoId)
        .maybeSingle();

      if (perfilCierreError) throw perfilCierreError;

      const perfilConRoles = {
        ...(usuarioDelTurno || {}),
        ...(perfilCierre || {})
      };

      if (isMeseroProfile(perfilConRoles)) {
        const { data: inventarioTerraza, error: inventarioTerrazaError } = await supabase
          .from('terraza_productos')
          .select('nombre, categoria, precio, stock_actual, stock_minimo, codigo_barras, activo')
          .eq('hotel_id', currentHotelId)
          .order('categoria', { ascending: true })
          .order('nombre', { ascending: true });

        if (inventarioTerrazaError) throw inventarioTerrazaError;
        inventarioTerrazaHtml = buildTerrazaInventoryHtml(inventarioTerraza || []);
      }
    } catch (inventarioError) {
      console.warn('[Caja] No se pudo adjuntar inventario de Terraza al cierre del mesero.', inventarioError);
    }

    let asuntoEmail = `Cierre de Caja - ${usuarioNombre} - ${fechaCierreLocal}`;
    if (esCierreForzoso) {
      asuntoEmail += ` (Forzado por ${adminNombre})`;
    }

    const htmlReporteBase = generarHTMLReporteCierre(
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
      valoresReales,
      resumenOperativo
    );
    const htmlReporte = appendHtmlBeforeBodyEnd(htmlReporteBase, inventarioTerrazaHtml);

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
