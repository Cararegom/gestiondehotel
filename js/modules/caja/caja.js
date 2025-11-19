// js/modules/caja/caja.js
import { turnoService } from '../../services/turnoService.js';
import {
  showError,
  clearFeedback,
  formatCurrency,
  formatDateTime,
  showGlobalLoading,
  hideGlobalLoading,
  setFormLoadingState,
  showSuccess
} from '../../uiUtils.js';

let moduleListeners = [];
let currentSupabaseInstance = null;
let currentHotelId = null;
let currentModuleUser = null;
let currentContainerEl = null;
let currentUserRole = null;
let turnoActivo = null; // Guardará el estado del turno actual
let turnoEnSupervision = null;


const EMAIL_REPORT_ENDPOINT = "https://hook.us2.make.com/ta2p8lu2ybrevyujf755nmb44ip8u876";

// --- LÓGICA DE TURNOS ---
// js/modules/caja/caja.js

// ...

// NUEVA FUNCIÓN para entrar en modo supervisión
async function iniciarModoSupervision(turno) {
  turnoEnSupervision = turno;
  // Cerramos el modal de la lista de turnos
  document.getElementById('modal-turnos-abiertos')?.remove();
  // Volvemos a renderizar toda la UI, que ahora detectará el modo supervisión
  await renderizarUI();
}

// NUEVA FUNCIÓN para salir del modo supervisión
async function salirModoSupervision() {
  turnoEnSupervision = null;
  // Volvemos a renderizar la UI para mostrar la vista normal del admin
  await renderizarUI();
}

// ...

async function verificarTurnoActivo() {
  if (!currentModuleUser?.id || !currentHotelId) return null;
  const { data, error } = await currentSupabaseInstance
    .from('turnos')
    .select('*')
    .eq('usuario_id', currentModuleUser.id)
    .eq('hotel_id', currentHotelId)
    .eq('estado', 'abierto')
    .maybeSingle();
  if (error) {
    console.error("Error verificando turno activo:", error);
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No se pudo verificar el estado del turno.');
    return null;
  }
  if (data) {
    turnoService.setActiveTurn(data.id);
  }
  return data;
}

async function abrirTurno() {
  const montoInicialStr = prompt("¿Cuál es el monto inicial de caja?");
  const montoInicial = parseFloat(montoInicialStr);
  if (isNaN(montoInicial) || montoInicial < 0) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'Monto inválido. Turno no iniciado.');
    return;
  }
  showGlobalLoading("Abriendo nuevo turno...");
  try {
    const { data: nuevoTurno, error } = await currentSupabaseInstance
      .from('turnos')
      .insert({
        usuario_id: currentModuleUser.id,
        hotel_id: currentHotelId,
        estado: 'abierto'
      })
      .select()
      .single();
    if (error) throw error;
    turnoActivo = nuevoTurno;
    turnoService.setActiveTurn(turnoActivo.id);
    await currentSupabaseInstance.from('caja').insert({
      tipo: 'apertura',
      monto: montoInicial,
      concepto: 'Apertura de caja',
      hotel_id: currentHotelId,
      usuario_id: currentModuleUser.id,
      turno_id: turnoActivo.id,
      fecha_movimiento: new Date().toISOString()
    });
    await renderizarUI();
    showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), '¡Turno iniciado con éxito!');
  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error al abrir turno: ${err.message}`);
    await renderizarUI();
  } finally {
    hideGlobalLoading();
  }
}

// js/modules/caja/caja.js


// REEMPLAZA TU FUNCIÓN 'cerrarTurno' CON ESTA
async function cerrarTurno(turnoExterno = null, usuarioDelTurnoExterno = null) {
  const turnoACerrar = turnoExterno || turnoActivo;
  const usuarioDelTurno = usuarioDelTurnoExterno || currentModuleUser;

  if (!turnoACerrar) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay un turno activo para cerrar.');
    return;
  }

  const esCierreForzoso = !!turnoExterno;
  const adminNombre = currentModuleUser?.email;
  const tituloLoading = esCierreForzoso 
    ? `Forzando cierre del turno de ${usuarioDelTurno.nombre}...` 
    : "Realizando cierre de turno...";
  
  showGlobalLoading(tituloLoading);

  try {
    // --- 1. Definimos la fecha de cierre una sola vez ---
    const fechaCierreISO = new Date().toISOString();
    const fechaAperturaISO = turnoACerrar.fecha_apertura;
    const usuarioDelTurnoId = usuarioDelTurno.id;

    // --- 2. Obtenemos los datos de CAJA (Como antes) ---
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance
      .from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre');
    if (metodosError) throw metodosError;

    const { data: movimientos, error: movError } = await currentSupabaseInstance
      .from('caja').select('*, usuarios(nombre), metodos_pago(nombre)').eq('turno_id', turnoACerrar.id);
    if (movError) throw movError;
    
    // --- 3. Obtenemos los LOGS del turno (Como antes) ---
    
    // Log de Amenidades
    const { data: logAmenidades, error: amenidadesError } = await currentSupabaseInstance
      .from('log_amenidades_uso')
      .select('*, amenidades_inventario(nombre_item), habitaciones(nombre)')
      .eq('usuario_id', usuarioDelTurnoId)
      .gte('fecha_uso', fechaAperturaISO)
      .lte('fecha_uso', fechaCierreISO);
    if (amenidadesError) console.warn("Error cargando log de amenidades:", amenidadesError.message);

    // Log de Lencería
    const { data: logLenceria, error: lenceriaError } = await currentSupabaseInstance
      .from('log_lenceria_uso')
      .select('*, inventario_lenceria(nombre_item), habitaciones(nombre)')
      .eq('usuario_id', usuarioDelTurnoId)
      .gte('fecha_uso', fechaAperturaISO)
      .lte('fecha_uso', fechaCierreISO);
    if (lenceriaError) console.warn("Error cargando log de lencería:", lenceriaError.message);

    // Log de Préstamos
    const { data: logPrestamos, error: prestamosError } = await currentSupabaseInstance
      .from('historial_articulos_prestados')
      .select('*, habitaciones(nombre)')
      .eq('usuario_id', usuarioDelTurnoId)
      .gte('fecha_accion', fechaAperturaISO)
      .lte('fecha_accion', fechaCierreISO);
    if (prestamosError) console.warn("Error cargando log de préstamos:", prestamosError.message);

    // --- 4. (NUEVO) Obtenemos el STOCK ACTUAL de Inventarios ---
        
    // Stock de Amenidades
    const { data: stockAmenidades, error: stockAmenError } = await currentSupabaseInstance
      .from('amenidades_inventario')
      .select('nombre_item, stock_actual')
      .eq('hotel_id', currentHotelId)
      .order('nombre_item');
    if (stockAmenError) console.warn("Error cargando stock de amenidades:", stockAmenError.message);

    // Stock de Lencería
    const { data: stockLenceria, error: stockLencError } = await currentSupabaseInstance
      .from('inventario_lenceria')
      .select('nombre_item, stock_limpio_almacen, stock_en_lavanderia, stock_total')
      .eq('hotel_id', currentHotelId)
      .order('nombre_item');
    if (stockLencError) console.warn("Error cargando stock de lencería:", stockLencError.message);


    // --- 5. Procesamos y generamos el HTML ---
    const reporte = procesarMovimientosParaReporte(movimientos);
    const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
    const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
    const totalGastos = calcularTotalFila(reporte.gastos);
    const balanceFinalEnCaja = reporte.apertura + totalIngresos - totalGastos;
    
    const fechaCierreLocal = new Date(fechaCierreISO).toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'short' });
    const usuarioNombre = usuarioDelTurno?.nombre || usuarioDelTurno?.email || 'Sistema';
    
    let asuntoEmail = `Cierre de Caja - ${usuarioNombre} - ${fechaCierreLocal}`;
    if (esCierreForzoso) {
      asuntoEmail += ` (Forzado por ${adminNombre})`;
    }

    // (NUEVO) Pasamos todos los logs Y los stocks a la función que genera el HTML
    const htmlReporte = generarHTMLReporteCierre(
        reporte, 
        metodosDePago, 
        usuarioNombre, 
        fechaCierreLocal,
        movimientos || [],         // <-- Detalle de caja
        logAmenidades || [],     // <-- Detalle de amenidades
        logLenceria || [],       // <-- Detalle de lencería
        logPrestamos || [],      // <-- Detalle de préstamos
        stockAmenidades || [],   // <-- NUEVO: Stock actual amenidades
        stockLenceria || []      // <-- NUEVO: Stock actual lencería
    );

    await enviarReporteCierreCaja({
      asunto: asuntoEmail,
      htmlReporte: htmlReporte,
      feedbackEl: currentContainerEl.querySelector('#turno-global-feedback')
    });

    // --- 6. Actualizamos el turno en la DB ---
    const { error: updateError } = await currentSupabaseInstance.from('turnos').update({
        estado: 'cerrado',
        fecha_cierre: fechaCierreISO, // Usamos la fecha ISO
        balance_final: balanceFinalEnCaja,
      }).eq('id', turnoACerrar.id);

    if (updateError) throw updateError;
    
    // --- 7. Actualizamos la UI ---
    if (turnoActivo && turnoACerrar.id === turnoActivo.id) {
        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), '¡Turno cerrado y reporte enviado!');
        turnoActivo = null;
        turnoEnSupervision = null;
        turnoService.clearActiveTurn();
        await renderizarUI();
    } else if (esCierreForzoso) {
        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), `¡Turno de ${usuarioDelTurno.nombre || 'usuario'} cerrado exitosamente!`);
        turnoEnSupervision = null;
        await renderizarUI();
    }

  } catch (err) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error en el cierre de turno: ${err.message}`);
    if(turnoActivo && turnoACerrar.id === turnoActivo.id) {
       await renderizarUI();
    }
  } finally {
    hideGlobalLoading();
  }
}


// REEMPLAZA TU FUNCIÓN CON ESTA VERSIÓN COMPLETA Y FINAL
async function loadAndRenderMovements(tBodyEl, summaryEls, turnoId) {
    if (!turnoId) {
        tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4 text-red-500">Error: No se ha especificado un turno para cargar.</td></tr>`;
        return;
    }
    tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">Cargando movimientos del turno...</td></tr>`;
    try {
        const { data: movements, error } = await currentSupabaseInstance
            .from('caja')
            .select('id,tipo,monto,concepto,creado_en,usuario_id,usuarios(nombre),metodo_pago_id,metodos_pago(nombre)')
            .eq('hotel_id', currentHotelId)
            .eq('turno_id', turnoId)
            .order('creado_en', { ascending: false });

        if (error) throw error;
        
        let ingresos = 0;
        let egresos = 0;
        const apertura = Number(movements.find(m => m.tipo === 'apertura')?.monto || 0);

        tBodyEl.innerHTML = '';
        const isAdmin = currentUserRole && ['admin', 'administrador'].includes(currentUserRole.toLowerCase());

        if (!movements || movements.length === 0) {
            tBodyEl.innerHTML = `<tr><td colspan="6" class="text-center p-4">No hay movimientos en este turno.</td></tr>`;
        } else {
            movements.forEach(mv => {
                if (mv.tipo === 'ingreso') ingresos += Number(mv.monto);
                else if (mv.tipo === 'egreso') egresos += Number(mv.monto);

                const tr = document.createElement('tr');
                tr.className = "hover:bg-gray-50";
                
                let tipoBadge = '';
                if (mv.tipo === 'ingreso') {
                    tipoBadge = `<span class="badge bg-green-100 text-green-800">${mv.tipo}</span>`;
                } else if (mv.tipo === 'egreso') {
                    tipoBadge = `<span class="badge bg-red-100 text-red-800">${mv.tipo}</span>`;
                } else {
                    tipoBadge = `<span class="badge bg-blue-100 text-blue-800">${mv.tipo}</span>`;
                }

                tr.innerHTML = `
                    <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${formatDateTime(mv.creado_en)}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-sm">${tipoBadge}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-sm font-medium ${mv.tipo === 'ingreso' ? 'text-green-600' : 'text-red-600'}">${formatCurrency(mv.monto)}</td>
                    <td class="px-4 py-2 whitespace-normal text-sm text-gray-700">${mv.concepto || 'N/A'}</td>
                    <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${mv.usuarios?.nombre || 'Sistema'}</td>
                    <td class="px-4 py-2 text-sm text-gray-500">
                        <div class="flex items-center justify-center">
                            <span class="truncate">${mv.metodos_pago?.nombre || 'N/A'}</span>
                            <div class="flex-shrink-0 ml-3 flex items-center space-x-2">
                                <button class="text-blue-500 hover:text-blue-700" title="Editar Método de Pago" data-edit-metodo="${mv.id}">✏️</button>
                                ${isAdmin ? `<button class="text-red-500 hover:text-red-700" title="Eliminar Movimiento" data-delete-movimiento="${mv.id}" data-concepto="${mv.concepto || 'N/A'}" data-monto="${formatCurrency(mv.monto)}" data-tipo="${mv.tipo}">🗑️</button>` : ''}
                            </div>
                        </div>
                    </td>
                `;
                tBodyEl.appendChild(tr);
            });

            // --- SECCIÓN DE CÓDIGO RESTAURADA Y CORREGIDA ---
            
            // Listener para editar método de pago
            tBodyEl.querySelectorAll('button[data-edit-metodo]').forEach(btn => {
                btn.onclick = async () => {
                    const movimientoId = btn.getAttribute('data-edit-metodo');
                    showGlobalLoading("Cargando métodos de pago...");
                    const { data: metodos, error: errMetodos } = await currentSupabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre');
                    hideGlobalLoading();
                    if (errMetodos || !metodos || !metodos.length) {
                        alert("No se pudieron cargar los métodos de pago para editar.");
                        return;
                    }
                    const opcionesHTML = metodos.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('');
                    const editModalDiv = document.createElement('div');
                    editModalDiv.innerHTML = `<div class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[99999]"><div class="bg-white rounded-xl p-6 shadow-xl w-full max-w-sm"><h4 class="text-xl font-bold mb-4 text-gray-800">Cambiar Método de Pago</h4><select id="select-new-metodo" class="form-control w-full">${opcionesHTML}</select><div class="mt-5 flex gap-3 justify-end"><button id="btn-confirm-edit" class="button button-accent px-5 py-2 rounded">Guardar</button><button id="btn-cancel-edit" class="button button-neutral px-5 py-2 rounded">Cancelar</button></div></div></div>`;
                    document.body.appendChild(editModalDiv);
                    const cleanup = () => editModalDiv.remove();
                    document.getElementById('btn-cancel-edit').onclick = cleanup;
                    document.getElementById('btn-confirm-edit').onclick = async () => {
                        const nuevoMetodoId = document.getElementById('select-new-metodo').value;
                        await currentSupabaseInstance.from('caja').update({ metodo_pago_id: nuevoMetodoId }).eq('id', movimientoId);
                        cleanup();
                        showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Método de pago actualizado.');
                        await loadAndRenderMovements(tBodyEl, summaryEls, turnoId);
                    };
                };
            });

            // Listeners para eliminar movimiento (solo para administradores)
            if (isAdmin) {
                tBodyEl.querySelectorAll('button[data-delete-movimiento]').forEach(btn => {
                    btn.onclick = async () => {
                        const movimientoId = btn.dataset.deleteMovimiento;
                        const concepto = btn.dataset.concepto;
                        const monto = btn.dataset.monto;
                        const tipo = btn.dataset.tipo;
                        
                        let warningMessage = `<p>¿Realmente desea eliminar este movimiento de caja?</p><div class="my-3 p-2 bg-gray-100 border border-gray-300 rounded text-left"><strong>Concepto:</strong> ${concepto}<br><strong>Monto:</strong> ${monto}</div><p class="font-bold text-red-600">¡Esta acción es irreversible!</p>`;
                        if (tipo === 'apertura') {
                          warningMessage = `<p class="font-bold text-lg text-red-700">¡ADVERTENCIA MÁXIMA!</p><p>Está a punto de eliminar el movimiento de <strong>APERTURA DE TURNO</strong>.</p><div class="my-3 p-2 bg-red-100 border border-red-400 rounded text-left"><strong>Monto:</strong> ${monto}</div><p>Eliminar esto afectará todos los cálculos. ¿Está seguro?</p>`;
                        }
                        
                        const confirmDiv = document.createElement('div');
                        confirmDiv.innerHTML = `<div class="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-[99999]"><div class="bg-white rounded-xl p-6 border-4 border-red-200 shadow-xl w-full max-w-md text-center"><h4 class="text-xl font-bold mb-3 text-red-800">Confirmar Eliminación</h4><div class="text-gray-700">${warningMessage}</div><div class="mt-5 flex gap-3 justify-center"><button id="btn-confirm-delete" class="button bg-red-600 hover:bg-red-700 text-white font-bold px-5 py-2 rounded">Sí, Eliminar</button><button id="btn-cancel-delete" class="button button-neutral px-5 py-2 rounded">Cancelar</button></div></div></div>`;
                        document.body.appendChild(confirmDiv);
                        
                        document.getElementById('btn-cancel-delete').onclick = () => confirmDiv.remove();
            
                        document.getElementById('btn-confirm-delete').onclick = async () => {
                            const confirmBtn = document.getElementById('btn-confirm-delete');
                            confirmBtn.disabled = true;
                            confirmBtn.textContent = 'Procesando...';
            
                            const { error: rpcError } = await currentSupabaseInstance.rpc('registrar_y_eliminar_mov_caja', {
                                movimiento_id_param: movimientoId,
                                eliminado_por_usuario_id_param: currentModuleUser.id
                            });
            
                            if (rpcError) {
                                alert('Error al eliminar el movimiento: ' + rpcError.message);
                                confirmBtn.disabled = false;
                                confirmBtn.textContent = 'Sí, Eliminar';
                            } else {
                                confirmDiv.remove();
                                showSuccess(currentContainerEl.querySelector('#turno-global-feedback'), 'Movimiento eliminado y registrado.');
                                await loadAndRenderMovements(tBodyEl, summaryEls, turnoId);
                            }
                        };
                    };
                });
            }
             // --- FIN DE LA SECCIÓN RESTAURADA ---
        }
        
        const balance = apertura + ingresos - egresos;
        summaryEls.ingresos.textContent = formatCurrency(ingresos);
        summaryEls.egresos.textContent = formatCurrency(egresos);
        summaryEls.balance.textContent = formatCurrency(balance);
        summaryEls.balance.className = `text-2xl font-bold ${balance < 0 ? 'text-red-600' : 'text-green-600'}`;

    } catch (err) {
        showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error cargando movimientos: ${err.message}`);
        console.error("Error en loadAndRenderMovements:", err);
    }
}





async function renderizarUIAbierta() {
    console.log("renderizarUIAbierta llamado");

    // 1. DETERMINAR QUÉ TURNO MOSTRAR (EL PROPIO O EL SUPERVISADO)
    const esModoSupervision = !!turnoEnSupervision;
    const turnoParaMostrar = turnoEnSupervision || turnoActivo;
    
    if (!turnoParaMostrar) {
        console.error("Se intentó renderizar UI abierta sin un turno válido.");
        renderizarUICerrada();
        return;
    }

    const isAdmin = currentUserRole && ['admin', 'administrador'].includes(currentUserRole.toLowerCase());
    
    // 2. CONSTRUIR EL HTML DE LA INTERFAZ
    const supervisionBannerHtml = esModoSupervision
        ? `
        <div class="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4 rounded-md flex justify-between items-center" role="alert">
            <div>
                <p class="font-bold">Modo Supervisión</p>
                <p>Estás gestionando el turno de: <strong>${turnoParaMostrar.usuarios?.nombre || 'Usuario'}</strong> (Inició: ${formatDateTime(turnoParaMostrar.fecha_apertura)})</p>
            </div>
            <button id="btn-salir-supervision" class="button bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded">Salir de Supervisión</button>
        </div>`
        : '';

    currentContainerEl.innerHTML = `
    <div class="card caja-module shadow-lg rounded-lg">
      <div class="card-header bg-gray-100 p-4 border-b flex justify-between items-center">
        <h2 class="text-xl font-semibold text-gray-800">${esModoSupervision ? 'Gestionando Turno Ajeno' : 'Turno Activo'}</h2>
        <div class="flex items-center space-x-2">
          ${isAdmin ? `
            <button id="btn-ver-turnos-abiertos" class="button button-neutral py-2 px-4 rounded-md shadow-sm">👥 Ver Turnos Abiertos</button>
            <button id="btn-ver-eliminados" class="button button-neutral py-2 px-4 rounded-md shadow-sm">📜 Ver Eliminados</button>
          ` : ''}
          <button id="btn-cerrar-turno" class="button ${esModoSupervision ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'} text-white font-bold py-2 px-4 rounded-md shadow-sm">
            ${esModoSupervision ? 'Forzar Cierre de este Turno' : 'Realizar Corte de Caja'}
          </button>
        </div>
      </div>
      <div class="card-body p-4 md:p-6">
        ${supervisionBannerHtml} 
        <div id="turno-global-feedback" role="status" aria-live="polite" class="feedback-message mb-4"></div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 text-center">
          <div class="p-3 bg-green-50 rounded-md shadow"><span class="block text-sm text-gray-500">Ingresos del Turno</span><span id="turno-total-ingresos" class="text-2xl font-bold text-green-600">$0.00</span></div>
          <div class="p-3 bg-red-50 rounded-md shadow"><span class="block text-sm text-gray-500">Egresos del Turno</span><span id="turno-total-egresos" class="text-2xl font-bold text-red-600">$0.00</span></div>
          <div class="p-3 bg-blue-50 rounded-md shadow"><span class="block text-sm text-gray-500">Balance del Turno</span><span id="turno-balance" class="text-2xl font-bold text-blue-600">$0.00</span></div>
        </div>
        <div class="table-container overflow-x-auto mb-6">
          <table class="tabla-estilizada w-full">
            <thead class="bg-gray-50"><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Concepto</th><th>Usuario</th><th>Método Pago</th></tr></thead>
            <tbody id="turno-movements-body"></tbody>
          </table>
        </div>
        <hr class="my-6"/>
        <h3 class="text-lg font-semibold text-gray-700 mb-3">Agregar Nuevo Movimiento</h3>
        <form id="turno-add-form" class="form p-4 border rounded-md bg-gray-50 shadow-sm">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
            <div><label>Tipo *</label><select name="tipo" class="form-control" required><option value="">-- Seleccione --</option><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></select></div>
            <div><label>Monto *</label><input type="number" name="monto" class="form-control" step="0.01" min="0.01" required /></div>
            <div><label>Método de Pago *</label><select name="metodoPagoId" class="form-control" required><option value="">Cargando...</option></select></div>
          </div>
          <div class="mb-4"><label>Concepto/Descripción *</label><input type="text" name="concepto" class="form-control" required minlength="3" /></div>
          
          <div class="flex items-center gap-6 mb-4">
            <div style="display:flex;align-items:center;gap:7px;">
              <input type="checkbox" id="egreso-fuera-turno" name="egreso_fuera_turno" style="transform:scale(1.3);">
              <label for="egreso-fuera-turno" style="margin:0;">Registrar fuera del turno/caja</label>
            </div>
            <div style="display:flex;align-items:center;gap:7px;">
              <input type="checkbox" id="fecha-anterior-check" name="fecha_anterior_check" style="transform:scale(1.3);">
              <label for="fecha-anterior-check" style="margin:0;">Registrar con fecha anterior</label>
            </div>
          </div>
          <div id="fecha-anterior-container" class="mb-4" style="display:none;">
            <label>Fecha y Hora del Movimiento *</label>
            <input type="datetime-local" id="fecha-movimiento-custom" name="fecha_movimiento_custom" class="form-control">
          </div>
          <button type="submit" class="button button-accent">＋ Agregar Movimiento</button>
          <div id="turno-add-feedback" class="feedback-message mt-3"></div>
        </form>
      </div>
    </div>`;

    // 3. LIMPIAR Y ASIGNAR LISTENERS
    moduleListeners.forEach(({ element, type, handler }) => element?.removeEventListener(type, handler));
    moduleListeners = [];

    const tBodyEl = currentContainerEl.querySelector('#turno-movements-body');
    const summaryEls = {
        ingresos: currentContainerEl.querySelector('#turno-total-ingresos'),
        egresos: currentContainerEl.querySelector('#turno-total-egresos'),
        balance: currentContainerEl.querySelector('#turno-balance')
    };
    
    await loadAndRenderMovements(tBodyEl, summaryEls, turnoParaMostrar.id);

    if (esModoSupervision) {
        const salirBtn = currentContainerEl.querySelector('#btn-salir-supervision');
        if(salirBtn) {
            const handler = () => salirModoSupervision();
            salirBtn.addEventListener('click', handler);
            moduleListeners.push({ element: salirBtn, type: 'click', handler });
        }
    }

    if (isAdmin) {
        const verTurnosBtn = currentContainerEl.querySelector('#btn-ver-turnos-abiertos');
        if(verTurnosBtn) {
            const handler = (event) => mostrarTurnosAbiertos(event);
            verTurnosBtn.addEventListener('click', handler);
            moduleListeners.push({ element: verTurnosBtn, type: 'click', handler });
        }
        const verEliminadosBtn = currentContainerEl.querySelector('#btn-ver-eliminados');
        if (verEliminadosBtn) {
            const handler = () => mostrarLogEliminados();
            verEliminadosBtn.addEventListener('click', handler);
            moduleListeners.push({ element: verEliminadosBtn, type: 'click', handler: handler });
        }
    }
    
    const cerrarTurnoBtn = currentContainerEl.querySelector('#btn-cerrar-turno');
    const resumenHandler = () => mostrarResumenCorteDeCaja();
    cerrarTurnoBtn.addEventListener('click', resumenHandler);
    moduleListeners.push({ element: cerrarTurnoBtn, type: 'click', handler: resumenHandler });
    
    const addFormEl = currentContainerEl.querySelector('#turno-add-form');
    const metodoPagoSelect = addFormEl.elements.metodoPagoId;
    await popularMetodosPagoSelect(metodoPagoSelect);

    // ▼▼▼ LISTENER PARA EL CHECKBOX 'fecha-anterior-check' ▼▼▼
    const fechaAnteriorCheck = addFormEl.querySelector('#fecha-anterior-check');
    const fechaAnteriorContainer = addFormEl.querySelector('#fecha-anterior-container');
    fechaAnteriorCheck.addEventListener('change', () => {
        fechaAnteriorContainer.style.display = fechaAnteriorCheck.checked ? 'block' : 'none';
    });
    // ▲▲▲ FIN DEL LISTENER ▲▲▲

    // --- INICIO DEL submitHandler CORREGIDO ---
    const submitHandler = async (e) => {
        e.preventDefault();
        const formData = new FormData(addFormEl);
        
        // --- 🐞 AQUÍ ESTÁ EL ARREGLO ---
        
        // 1. Leemos el valor del checkbox (lo renombramos para claridad)
        const esFueraTurno = !!formData.get('egreso_fuera_turno');
        
        // 2. Asignamos el ID del turno actual por defecto
        let turnoIdToSave = turnoParaMostrar.id;

        // 3. Si el checkbox está marcado (SIN IMPORTAR EL TIPO), ponemos el ID en null
        if (esFueraTurno) {
            turnoIdToSave = null;
        }
        // --- FIN DEL ARREGLO ---
        
        // ▼▼▼ LÓGICA DE FECHA (sin cambios) ▼▼▼
        const esFechaAnterior = !!formData.get('fecha_anterior_check');
        const fechaCustom = formData.get('fecha_movimiento_custom');

        const newMovement = {
            tipo: formData.get('tipo'),
            monto: parseFloat(formData.get('monto')),
            concepto: (formData.get('concepto') || '').trim(),
            metodo_pago_id: formData.get('metodoPagoId'),
            usuario_id: currentModuleUser.id,
            hotel_id: currentHotelId,
            turno_id: turnoIdToSave, // Se usa la variable corregida
            fecha_movimiento: (esFechaAnterior && fechaCustom) ? new Date(fechaCustom).toISOString() : new Date().toISOString()
        };
        // ▲▲▲ FIN DE LA LÓGICA DE FECHA ▲▲▲

        const feedbackEl = addFormEl.querySelector('#turno-add-feedback');
        setFormLoadingState(addFormEl, true);

        if (!(newMovement.monto > 0) || !newMovement.concepto || !newMovement.metodo_pago_id || !newMovement.tipo) {
            showError(feedbackEl, 'Todos los campos son obligatorios.');
            setFormLoadingState(addFormEl, false);
            return;
        }
        
        if (esFechaAnterior && !fechaCustom) {
            showError(feedbackEl, 'Debes seleccionar una fecha y hora si marcas la opción de fecha anterior.');
            setFormLoadingState(addFormEl, false);
            return;
        }

        const { error } = await currentSupabaseInstance.from('caja').insert(newMovement);
        if (error) {
            showError(feedbackEl, `Error: ${error.message}`);
        } else {
            showSuccess(feedbackEl, 'Movimiento agregado.');
            addFormEl.reset();
            fechaAnteriorContainer.style.display = 'none'; // Ocultar el campo de fecha después de agregar
            await loadAndRenderMovements(tBodyEl, summaryEls, turnoParaMostrar.id);
        }
        setFormLoadingState(addFormEl, false);
    };
    // --- FIN DEL submitHandler CORREGIDO ---

    addFormEl.addEventListener('submit', submitHandler);
    moduleListeners.push({ element: addFormEl, type: 'submit', handler: submitHandler });
}

// --- COPIA TODA ESTA FUNCIÓN ---
async function mostrarLogEliminados() {
    const modalContainer = document.createElement('div');
    modalContainer.id = "modal-log-eliminados";
    modalContainer.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-70 p-4";
    modalContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-4xl text-center"><p>Cargando historial...</p></div>`;
    document.body.appendChild(modalContainer);

    try {
        const { data: logs, error } = await currentSupabaseInstance
            .from('log_caja_eliminados')
            .select('creado_en, datos_eliminados, eliminado_por_usuario:usuarios(nombre)')
            .order('creado_en', { ascending: false })
            .limit(100); // Limitamos a los 100 más recientes para no sobrecargar

        if (error) throw error;

        let tableRowsHtml = '';
        if (!logs || logs.length === 0) {
            tableRowsHtml = '<tr><td colspan="6" class="text-center p-4">No hay movimientos eliminados.</td></tr>';
        } else {
            tableRowsHtml = logs.map(log => {
                const datos = log.datos_eliminados || {};
                return `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="p-3 text-sm">${formatDateTime(log.creado_en)}</td>
                        <td class="p-3 text-sm text-red-600 font-medium">${log.eliminado_por_usuario?.nombre || 'Desconocido'}</td>
                        <td class="p-3 text-sm">${formatDateTime(datos.creado_en)}</td>
                        <td class="p-3 text-sm font-semibold ${datos.tipo === 'ingreso' ? 'text-green-700' : 'text-orange-700'}">${datos.tipo || 'N/A'}</td>
                        <td class="p-3 text-sm font-bold">${formatCurrency(datos.monto || 0)}</td>
                        <td class="p-3 text-sm text-left">${datos.concepto || 'N/A'}</td>
                    </tr>
                `;
            }).join('');
        }

        const modalContent = `
            <div class="bg-white p-0 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
                <div class="flex justify-between items-center p-4 border-b bg-gray-50 rounded-t-lg">
                    <h3 class="text-xl font-bold text-gray-700">Historial de Movimientos Eliminados</h3>
                    <button id="btn-cerrar-log-modal" class="text-gray-500 hover:text-red-600 text-3xl">&times;</button>
                </div>
                <div class="overflow-y-auto">
                    <table class="w-full text-left">
                        <thead class="bg-gray-100 sticky top-0">
                            <tr>
                                <th class="p-3 text-sm font-semibold">Fecha Eliminación</th>
                                <th class="p-3 text-sm font-semibold">Eliminado Por</th>
                                <th class="p-3 text-sm font-semibold">Fecha Original</th>
                                <th class="p-3 text-sm font-semibold">Tipo Original</th>
                                <th class="p-3 text-sm font-semibold">Monto Original</th>
                                <th class="p-3 text-sm font-semibold">Concepto Original</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
        modalContainer.innerHTML = modalContent;
        modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();

    } catch (err) {
        modalContainer.innerHTML = `<div class="bg-white p-6 rounded-lg shadow-xl w-full max-w-md text-center">
            <p class="text-red-600">Error al cargar el historial: ${err.message}</p>
            <button id="btn-cerrar-log-modal" class="button button-neutral mt-4">Cerrar</button>
        </div>`;
        modalContainer.querySelector('#btn-cerrar-log-modal').onclick = () => modalContainer.remove();
    }
}



// Reemplaza tu función mostrarTurnosAbiertos con esta versión
// REEMPLAZA TU FUNCIÓN ACTUAL CON ESTA VERSIÓN MEJORADA
async function mostrarTurnosAbiertos(event) {
    // 1. Prevenir duplicados: Si el modal ya existe, no hacemos nada.
    if (document.getElementById('modal-turnos-abiertos')) {
        return;
    }

    // --- Lógica de posicionamiento ---
    const boton = event.currentTarget;
    const rect = boton.getBoundingClientRect();
    const top = rect.bottom + window.scrollY + 5; // 5px debajo del botón
    const right = window.innerWidth - rect.right; // Alineado a la derecha del botón

    const modalContainer = document.createElement('div');
    modalContainer.id = "modal-turnos-abiertos";
    // --- 2. Estilos para que sea un popover flotante ---
    modalContainer.style.position = 'absolute';
    modalContainer.style.top = `${top}px`;
    modalContainer.style.right = `${right}px`;
    modalContainer.style.zIndex = '1000'; // Asegura que esté por encima de otros elementos
    modalContainer.className = "bg-white rounded-lg shadow-xl border w-full max-w-sm text-center";
    modalContainer.innerHTML = `<div class="p-4"><p>Buscando turnos abiertos...</p></div>`;
    document.body.appendChild(modalContainer);

    // --- 3. Lógica para cerrar el modal al hacer clic fuera ---
    const closeOnClickOutside = (e) => {
        if (!modalContainer.contains(e.target) && e.target !== boton) {
            modalContainer.remove();
            document.removeEventListener('click', closeOnClickOutside);
        }
    };
    // Añadimos el listener un instante después para evitar que se cierre con el mismo clic que lo abrió
    setTimeout(() => document.addEventListener('click', closeOnClickOutside), 0);
    
    try {
        const { data: turnos, error } = await currentSupabaseInstance
            .from('turnos')
            .select('*, usuarios(*)')
            .eq('estado', 'abierto')
            .eq('hotel_id', currentHotelId)
            .order('fecha_apertura', { ascending: true });

        if (error) throw error;

        let tableRowsHtml = '';
        if (!turnos || turnos.length === 0) {
            tableRowsHtml = '<tr><td class="text-center p-4">¡Excelente! No hay turnos abiertos.</td></tr>';
        } else {
            tableRowsHtml = turnos.map(turno => {
                const nombreUsuario = turno.usuarios?.nombre || turno.usuarios?.email || 'Usuario Desconocido';
                const esMiTurno = turno.usuario_id === currentModuleUser.id;

                const botonGestion = esMiTurno
                    ? `<span class="text-gray-400 italic">Es tu turno actual</span>`
                    : `<button class="button bg-blue-500 hover:bg-blue-700 text-white font-bold py-1 px-3 rounded" data-turno-json='${JSON.stringify(turno)}'>Gestionar Turno</button>`;

                return `
                    <tr class="hover:bg-gray-50 border-b">
                        <td class="p-3 text-sm text-left">${nombreUsuario}</td>
                        <td class="p-3 text-sm text-left">${formatDateTime(turno.fecha_apertura)}</td>
                        <td class="p-3 text-sm text-center">${botonGestion}</td>
                    </tr>
                `;
            }).join('');
        }

        const modalContent = `
            <div class="flex justify-between items-center p-3 border-b bg-gray-50 rounded-t-lg">
                <h3 class="text-md font-bold text-gray-700">Turnos Abiertos</h3>
                <button id="btn-cerrar-turnos-modal" class="text-gray-500 hover:text-red-600 text-xl">&times;</button>
            </div>
            <div class="overflow-y-auto">
                <table class="w-full text-left">
                    <tbody>
                        ${tableRowsHtml}
                    </tbody>
                </table>
            </div>
        `;
        modalContainer.innerHTML = modalContent;
        
        // El botón 'X' también debe cerrar el popover y el listener
        modalContainer.querySelector('#btn-cerrar-turnos-modal').onclick = () => {
            modalContainer.remove();
            document.removeEventListener('click', closeOnClickOutside);
        };
        
        modalContainer.querySelectorAll('button[data-turno-json]').forEach(btn => {
            btn.onclick = async (e) => {
                const turnoData = JSON.parse(e.target.dataset.turnoJson);
                document.removeEventListener('click', closeOnClickOutside); // Limpiar listener antes de cambiar de vista
                await iniciarModoSupervision(turnoData);
            };
        });

    } catch (err) {
        modalContainer.innerHTML = `<div class="p-4 text-red-600">Error: ${err.message}</div>`;
    }
}




function renderizarUICerrada() {
  currentContainerEl.innerHTML = `
    <div class="card shadow-lg rounded-lg">
      <div class="card-body p-6 text-center">
        <div id="turno-global-feedback" class="feedback-message mb-4"></div>
        <h2 class="text-2xl font-semibold text-gray-700 mb-4">La caja está cerrada</h2>
        <p class="text-gray-500 mb-6">No hay un turno activo. Para registrar ingresos o egresos, por favor, inicia un nuevo turno.</p>
        <button id="btn-abrir-turno" class="button button-primary button-lg py-3 px-6 text-lg">Abrir Turno</button>
      </div>
    </div>`;
  const abrirTurnoBtn = currentContainerEl.querySelector('#btn-abrir-turno');
  abrirTurnoBtn.addEventListener('click', abrirTurno);
  moduleListeners.push({ element: abrirTurnoBtn, type: 'click', handler: abrirTurnoBtn });
}

// Reemplaza tu función renderizarUI con esta
async function renderizarUI() {
    console.log("renderizarUI llamado");
  
    // Si estamos en modo supervisión, no necesitamos verificar el turno del admin.
    // Usaremos el que ya tenemos guardado en `turnoEnSupervision`.
    if (turnoEnSupervision) {
        await renderizarUIAbierta();
        return;
    }
  
    // Si no, procedemos con la lógica normal
    turnoActivo = await verificarTurnoActivo();
    if (turnoActivo) {
        await renderizarUIAbierta();
    } else {
        renderizarUICerrada();
    }
}
// --- MODAL DE RESUMEN DE CAJA ANTES DE CORTE (CON IMPRESIÓN ADAPTABLE) ---

// Reemplaza tu función mostrarResumenCorteDeCaja existente con esta versión final.
// Agrega esta nueva función a tu archivo caja.js

/**
 * Procesa una lista de movimientos y devuelve un objeto de reporte estructurado.
 * @param {Array} movimientos - El array de movimientos de caja del turno.
 * @returns {object} El objeto de reporte con los totales calculados.
 */
function procesarMovimientosParaReporte(movimientos) {
  const crearCategoria = () => ({ pagos: {}, ventas: 0, transacciones: 0 });
  const reporte = {
    habitaciones: crearCategoria(),
    cocina:       crearCategoria(),
    tienda:       crearCategoria(),
    propinas:     crearCategoria(),
    gastos:       crearCategoria(),
    apertura: 0,
  };

  if (!movimientos || movimientos.length === 0) {
    return reporte;
  }

  movimientos.forEach(mv => {
    const monto = Number(mv.monto);
    const nombreMetodo = mv.metodos_pago?.nombre || 'Efectivo';
    const concepto = (mv.concepto || '').toLowerCase();
    let categoria = null;

    if (mv.tipo === 'apertura') {
      reporte.apertura += monto;
      return; // Continuar con el siguiente movimiento
    }
    
    // --- INICIO DE LA LÓGICA CORREGIDA ---
    if (mv.tipo === 'ingreso') {
        // Se mejora la clasificación para incluir más términos
        if (concepto.includes('restaurante') || concepto.includes('cocina')) {
            categoria = reporte.cocina;
        } else if (concepto.includes('tienda') || concepto.includes('producto')) {
            categoria = reporte.tienda;
        } else if (concepto.includes('propina')) {
            categoria = reporte.propinas;
        } else if (concepto.includes('habitaci') || concepto.includes('alquiler') || concepto.includes('reserva') || concepto.includes('extensi')) {
            // Esta categoría ahora agrupa todo lo relacionado a alojamiento
            categoria = reporte.habitaciones;
        } else {
            // Fallback para cualquier otro ingreso, se va a habitaciones
            console.warn(`Movimiento de ingreso no clasificado, asignado a Habitaciones: "${mv.concepto}"`);
            categoria = reporte.habitaciones;
        }
        
        categoria.ventas += 1; // O puedes ajustar esta lógica si es necesario
        categoria.transacciones += 1;

    } else if (mv.tipo === 'egreso') {
        categoria = reporte.gastos;
        categoria.transacciones += 1;
    }
    // --- FIN DE LA LÓGICA CORREGIDA ---

    if (categoria) {
      categoria.pagos[nombreMetodo] = (categoria.pagos[nombreMetodo] || 0) + monto;
    }
  });

  return reporte;
}




// REEMPLAZA TU FUNCIÓN CON ESTA VERSIÓN 100% COMPLETA
async function mostrarResumenCorteDeCaja() {
  const turnoParaResumir = turnoEnSupervision || turnoActivo;
  const esCierreForzoso = !!turnoEnSupervision;

  if (!turnoParaResumir) {
    alert("Error: No hay ningún turno activo para generar un resumen.");
    return;
  }

  showGlobalLoading('Cargando resumen del turno...');
  try {
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre', { ascending: true });
    if (metodosError) throw new Error("No se encontraron métodos de pago activos.");

    const { data: configHotel } = await currentSupabaseInstance.from('configuracion_hotel').select('logo_url, nombre_hotel, direccion_fiscal, nit_rut, razon_social, tipo_impresora, tamano_papel, encabezado_ticket, pie_ticket, mostrar_logo').eq('hotel_id', currentHotelId).maybeSingle();

    const { data: movimientos, error: movError } = await currentSupabaseInstance.from('caja').select('*, usuarios(nombre), metodos_pago(nombre)').eq('turno_id', turnoParaResumir.id).order('creado_en', { ascending: true });
    if (movError) throw movError;
    if (!movimientos || movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos para generar un resumen.');
      hideGlobalLoading();
      return;
    }

    const reporte = procesarMovimientosParaReporte(movimientos);
    const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
    const totalesPorMetodo = {};
    metodosDePago.forEach(metodo => {
      const nombreMetodo = metodo.nombre;
      const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) + (reporte.cocina.pagos[nombreMetodo] || 0) + (reporte.tienda.pagos[nombreMetodo] || 0) + (reporte.propinas.pagos[nombreMetodo] || 0);
      const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
      totalesPorMetodo[nombreMetodo] = { ingreso: totalIngreso, gasto: totalGasto, balance: totalIngreso - totalGasto };
    });
    const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
    const totalGastos = calcularTotalFila(reporte.gastos);
    const balanceFinal = totalIngresos - totalGastos;
    
    // --- HTML COMPLETO DEL MODAL RESTAURADO ---
    const thMetodos = metodosDePago.map(m => `<th class="px-3 py-2 text-right">${m.nombre}</th>`).join('');
    const generarCeldasFila = (fila) => metodosDePago.map(m => `<td class="px-3 py-2 text-right">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
    const tdTotalesIngresos = metodosDePago.map(m => `<td class="px-3 py-2 text-right">${formatCurrency(totalesPorMetodo[m.nombre].ingreso)}</td>`).join('');
    const tdTotalesGastos = metodosDePago.map(m => `<td class="px-3 py-2 text-right text-red-700">(${formatCurrency(totalesPorMetodo[m.nombre].gasto)})</td>`).join('');
    const tdTotalesBalance = metodosDePago.map(m => `<td class="px-3 py-2 text-right text-blue-800">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('');
    
    const modalHtml = `
      <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-fit mx-auto border border-slate-200 relative animate-fade-in-down">
        <div class="py-5 px-8 border-b rounded-t-2xl bg-gradient-to-r from-blue-100 to-green-100 flex items-center gap-3">
          <h2 class="text-2xl font-bold text-slate-800 ml-2">Resumen de Corte de Caja</h2>
        </div>
        <div class="p-4 md:p-6 space-y-3">
          <div id="print-corte-caja" class="overflow-x-auto">
            <table class="tabla-estilizada w-full text-sm">
              <thead class="bg-gray-50">
                <tr>
                  <th class="px-3 py-2 text-left">Concepto</th>
                  <th class="px-3 py-2 text-center">N° Transac.</th>
                  ${thMetodos}
                  <th class="px-3 py-2 text-right">Totales</th>
                </tr>
              </thead>
              <tbody>
                <tr><td class="px-3 py-2 font-medium">HABITACIONES:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones}</td>${generarCeldasFila(reporte.habitaciones)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.habitaciones))}</td></tr>
                <tr><td class="px-3 py-2 font-medium">COCINA:</td><td class="px-3 py-2 text-center">${reporte.cocina.transacciones}</td>${generarCeldasFila(reporte.cocina)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.cocina))}</td></tr>
                <tr><td class="px-3 py-2 font-medium">TIENDA:</td><td class="px-3 py-2 text-center">${reporte.tienda.transacciones}</td>${generarCeldasFila(reporte.tienda)}<td class="px-3 py-2 text-right font-bold bg-gray-50">${formatCurrency(calcularTotalFila(reporte.tienda))}</td></tr>
                <tr class="bg-gray-100 font-bold"><td class="px-3 py-2">Ingresos Totales:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>${tdTotalesIngresos}<td class="px-3 py-2 text-right">${formatCurrency(totalIngresos)}</td></tr>
                <tr class="bg-red-50 font-bold"><td class="px-3 py-2 text-red-700">Gastos Totales:</td><td class="px-3 py-2 text-center text-red-700">${reporte.gastos.transacciones}</td>${tdTotalesGastos}<td class="px-3 py-2 text-right text-red-700">(${formatCurrency(totalGastos)})</td></tr>
                <tr class="bg-blue-100 font-extrabold text-base"><td class="px-3 py-2 text-blue-800">Balance Final:</td><td class="px-3 py-2 text-center">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>${tdTotalesBalance}<td class="px-3 py-2 text-right text-blue-800">${formatCurrency(balanceFinal)}</td></tr>
              </tbody>
            </table>
          </div>
          <div class="flex flex-col md:flex-row justify-end gap-3 mt-6">
            <button id="btn-imprimir-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-800 font-semibold transition order-2 md:order-1">🖨️ Imprimir</button>
            <button id="btn-cancelar-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition order-1 md:order-2">Cancelar</button>
            <button id="btn-confirmar-corte-caja" class="button button-primary px-4 py-2 rounded-lg bg-gradient-to-r from-green-500 to-blue-500 hover:from-green-600 hover:to-blue-700 text-white font-bold shadow transition order-3">Confirmar Corte y Enviar</button>
          </div>
        </div>
      </div>
    `;

    // MOSTRAR EL MODAL Y ASIGNAR LISTENERS
    const modal = document.createElement('div');
    modal.id = "modal-corte-caja";
    modal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4";
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);
    hideGlobalLoading();

    // Ahora los querySelector encontrarán los botones porque el HTML está completo
    modal.querySelector('#btn-cancelar-corte-caja').onclick = () => modal.remove();
    
    modal.querySelector('#btn-confirmar-corte-caja').onclick = async () => {
      modal.remove();
      if (esCierreForzoso) {
        await cerrarTurno(turnoParaResumir, turnoParaResumir.usuarios);
      } else {
        await cerrarTurno();
      }
    };

   

    // DENTRO DE: mostrarResumenCorteDeCaja

    modal.querySelector('#btn-imprimir-corte-caja').onclick = () => {
        // 1. Extraemos Ingresos
        const ingresosPorMetodo = {};
        metodosDePago.forEach(m => { ingresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.ingreso || 0 });
        
        // 2. Extraemos Egresos
        const egresosPorMetodo = {};
        metodosDePago.forEach(m => { egresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.gasto || 0 });
        
        // 3. Extraemos Balances
        const balancesPorMetodo = {};
        metodosDePago.forEach(m => { balancesPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.balance || 0 });
        
        // 4. DATOS DE CONTEXTO (Usuario y Fecha Local)
        // Usamos 'turnoParaResumir' para obtener el nombre del usuario responsable del turno
        const nombreUsuario = turnoParaResumir.usuarios?.nombre || turnoParaResumir.usuarios?.email || 'Usuario';
        
        // Generamos la fecha local. 'es-CO' asegura formato Colombia (dd/mm/yyyy), 'medium' incluye hora con segundos si se desea.
        const fechaLocal = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' });

        // 5. Enviamos todo a la función de imprimir
        imprimirCorteCajaAdaptable(
            configHotel, 
            movimientos, 
            totalIngresos, 
            totalGastos, 
            balanceFinal, 
            ingresosPorMetodo, 
            egresosPorMetodo, 
            balancesPorMetodo,
            nombreUsuario, // <--- NUEVO
            fechaLocal     // <--- NUEVO
        );
    };
    
  } catch (e) {
    hideGlobalLoading();
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error generando el resumen: ${e.message}`);
    console.error('Error en mostrarResumenCorteDeCaja:', e);
  }
}





// BUSCA LA FUNCIÓN imprimirCorteCajaAdaptable Y REEMPLÁZALA POR ESTA:
function imprimirCorteCajaAdaptable(config, movimientos, ingresos, egresos, balance, ingresosPorMetodo, egresosPorMetodo, balancesPorMetodo, usuarioNombre, fechaCierre) {
  let tamano = (config?.tamano_papel || '').toLowerCase();
  let tipo = (config?.tipo_impresora || '').toLowerCase();

  // --- Header personalizable ---
  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || '';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let razon = config?.razon_social || '';
  let pie = config?.pie_ticket || '';

  let style = '';
  let html = '';
  
  // Helper para lista de balances
  const generarListaBalances = (estiloLi) => {
    return Object.entries(balancesPorMetodo).map(([k, v]) => {
        const esPositivo = v > 0;
        const estiloValor = esPositivo ? 'font-weight:bold; color: #000;' : 'color: #555;';
        return `<li style="${estiloLi}">${k}: <b style="${estiloValor}">${formatCurrency(v)}</b></li>`;
    }).join('');
  };

  // === FORMATO 58mm ===
  if (tamano === '58mm') {
    style = `
      @page { size: 58mm auto; margin: 0; }
      body{font-family:monospace;font-size:11px;max-width:55mm;margin:0;padding:0;}
      .ticket{max-width:55mm;margin:auto;}
      .hotel-title{text-align:center;font-weight:bold;font-size:13px;}
      .info{text-align:center;font-size:10px;}
      .line{border-bottom:1px dashed #444;margin:3px 0;}
      .totales{margin-bottom:2px;}
      .totales b{float:right;}
      ul.resumido{margin:0;padding-left:0;list-style:none;}
      ul.resumido li{display:flex;justify-content:space-between;}
      .movs-table{width:100%;font-size:10px;border-collapse:collapse;}
      .movs-table th,.movs-table td{padding:1px 2px;}
      .pie{text-align:center;margin-top:4px;font-size:10px;}
      .titulo-seccion{font-weight:bold; border-top: 1px solid #000; margin-top:5px; padding-top:2px;}
      .datos-cierre { font-size: 10px; margin-bottom: 4px; }
    `;
    
    let movsCortos = movimientos; 
    
    html = `
      <div class="ticket">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:4px;"><img src="${logoUrl}" style="max-width:45mm;max-height:30px;"></div>` : ''}
        <div class="hotel-title">${hotelNombre}</div>
        <div class="info">${direccion ? direccion + '<br/>' : ''}${nit ? 'NIT: ' + nit : ''}${razon ? '<br/>' + razon : ''}</div>
        <div class="line"></div>
        <div style="text-align:center;font-size:12px;font-weight:bold;">CIERRE DE CAJA</div>
        <div class="line"></div>
        
        <div class="datos-cierre"><b>Cajero:</b> ${usuarioNombre}</div>
        <div class="datos-cierre"><b>Fecha:</b> ${fechaCierre}</div>
        <div class="line"></div>
        
        <div class="totales">Apertura:<b>${formatCurrency(movsCortos.find(m => m.tipo === 'apertura')?.monto ?? 0)}</b></div>
        <div class="totales">Ingresos:<b>${formatCurrency(ingresos)}</b></div>
        <div class="totales">Egresos:<b>${formatCurrency(egresos)}</b></div>
        <div class="totales" style="font-size:13px; border-top:1px solid #000; margin-top:2px; padding-top:2px;">TOTAL NETO:<b>${formatCurrency(balance)}</b></div>
        
        <div class="line"></div>
        <div class="titulo-seccion">A ENTREGAR (BALANCE):</div>
        <ul class="resumido">
          ${generarListaBalances('')}
        </ul>

        <div class="line"></div>
        <div style="font-size:10px; margin-bottom:2px;"><b>Detalle Ingresos:</b></div>
        <ul class="resumido" style="font-size:9px; color:#444;">
          ${Object.entries(ingresosPorMetodo).map(([k, v]) => `<li>${k}<span>${formatCurrency(v)}</span></li>`).join('') || '<li>Sin ingresos</li>'}
        </ul>
        
        <div class="line"></div>
        ${pie ? `<div class="pie">${pie}</div>` : ''}
      </div>
    `;
  }
  // === FORMATO 80mm y CARTA ===
  else {
    const maxW = tamano === '80mm' ? '78mm' : '850px';
    const fontSize = tamano === '80mm' ? '12px' : '14px';
    
    style = `
      body{font-family:monospace;font-size:${fontSize};max-width:${maxW};margin:0 auto;padding:0;}
      .ticket{max-width:100%;margin:auto;}
      table{width:100%;font-size:${fontSize};border-collapse:collapse;}
      th,td{padding:3px 2px;}
      .title{font-size:1.2em; font-weight:bold; text-align:center;}
      .totales span{display:inline-block; width:100%;}
      .linea{border-bottom:1px dashed #444;margin:8px 0;}
      .seccion-box { border: 2px solid #000; padding: 5px; margin: 5px 0; border-radius: 4px; }
    `;
    
    html = `
      <div class="ticket">
        ${logoUrl ? `<div style="text-align:center;margin-bottom:4px;"><img src="${logoUrl}" style="max-width:60%;max-height:50px;"></div>` : ''}
        <div class="title">${hotelNombre}</div>
        <div style="text-align:center;">${direccion}${direccion ? '<br/>' : ''}${nit ? 'NIT: ' + nit : ''}</div>
        <div class="linea"></div>
        <div style="text-align:center; font-weight:bold; font-size:1.1em;">RESUMEN DE CIERRE DE CAJA</div>
        <div class="linea"></div>
        
        <div style="display:flex; justify-content:space-between; margin-bottom:5px;">
            <span><b>Cajero:</b> ${usuarioNombre}</span>
            <span><b>Fecha:</b> ${fechaCierre}</span>
        </div>
        <div class="linea"></div>
        
        <div class="totales">
          <span>(+) Ingresos Totales: <b style="float:right">${formatCurrency(ingresos)}</b></span>
          <span>(-) Egresos Totales: <b style="float:right">${formatCurrency(egresos)}</b></span>
          <div style="border-top:1px solid #000; margin-top:4px; padding-top:4px; font-weight:bold; font-size:1.2em;">
            <span>(=) BALANCE TOTAL: <b style="float:right">${formatCurrency(balance)}</b></span>
          </div>
        </div>
        
        <div class="linea"></div>
        
        <div class="seccion-box">
            <div style="text-align:center; font-weight:bold; margin-bottom:5px; border-bottom:1px solid #ccc;">DINERO A ENTREGAR (POR MÉTODO)</div>
            <ul style="margin:0;padding-left:5px; list-style:none;">
              ${generarListaBalances('display:flex; justify-content:space-between; margin-bottom:2px;')}
            </ul>
        </div>

        <div style="display:flex; gap:10px; margin-top:10px;">
            <div style="flex:1;">
                <b>Detalle Ingresos:</b>
                <ul style="margin:0;padding-left:14px; font-size:0.9em;">
                  ${Object.entries(ingresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
                </ul>
            </div>
            <div style="flex:1;">
                <b>Detalle Egresos:</b>
                <ul style="margin:0;padding-left:14px; font-size:0.9em;">
                   ${Object.entries(egresosPorMetodo).length === 0 ? '<li>Sin egresos</li>' : Object.entries(egresosPorMetodo).map(([k, v]) => `<li>${k}: <b>${formatCurrency(v)}</b></li>`).join('')}
                </ul>
            </div>
        </div>
        
        <div class="linea"></div>
        <div style="font-weight:bold;">Movimientos del Turno:</div>
        <table>
          <thead>
            <tr style="border-bottom:1px solid #000;"><th>Hora</th><th>Tipo</th><th>Monto</th><th>Concepto</th><th>Método</th></tr>
          </thead>
          <tbody>
            ${movimientos.map(mv => `
              <tr>
                <td>${formatDateTime(mv.creado_en).slice(11, 16)}</td>
                <td>${mv.tipo.charAt(0).toUpperCase()}</td>
                <td style="text-align:right;color:${mv.tipo === 'ingreso' ? '#000' : '#000'};">${formatCurrency(mv.monto)}</td>
                <td>${(mv.concepto || '').slice(0, 15)}</td>
                <td>${(mv.metodos_pago?.nombre || '').slice(0,3)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        
        <div class="linea"></div>
        <br/>
        <div style="display:flex; justify-content:space-between; margin-top:20px;">
            <div style="border-top:1px solid #000; width:40%; text-align:center; padding-top:5px;">Firma Recepcionista (${usuarioNombre})</div>
            <div style="border-top:1px solid #000; width:40%; text-align:center; padding-top:5px;">Firma Admin/Supervisor</div>
        </div>
        
        ${pie ? `<div style="text-align:center;margin-top:20px;font-size:0.8em;">${pie}</div>` : ''}
      </div>
    `;
  }

  let w = window.open('', '', `width=400,height=700`);
  w.document.write(`<html><head><title>Corte de Caja</title><style>${style}@media print {.no-print{display:none;}}</style></head><body>${html}</body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 250);
}

// --- FUNCIONES AUXILIARES (Email, Métodos de Pago, etc.) ---

async function popularMetodosPagoSelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Cargando...</option>';
  const { data, error } = await currentSupabaseInstance
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', currentHotelId)
    .eq('activo', true);
  if (error || !data.length) {
    selectEl.innerHTML = '<option value="" disabled>No hay métodos</option>';
  } else {
    selectEl.innerHTML = `<option value="">-- Seleccione --</option>${data.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}`;
    if (data.length === 1) selectEl.value = data[0].id;
  }
}

// REEMPLAZA TU FUNCIÓN 'generarHTMLReporteCierre' CON ESTA
function generarHTMLReporteCierre(
    reporte, 
    metodosDePago, 
    usuarioNombre, 
    fechaCierre,
    // (NUEVO) Recibimos los 4 listados de movimientos
    movsCaja, 
    movsAmenidades, 
    movsLenceria, 
    movsPrestamos,
    // (NUEVO) Recibimos los 2 listados de STOCK
    stockAmenidades, 
    stockLenceria 
) {
  
  // --- LÓGICA DE CÁLCULO (Sin cambios) ---
  const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
  const totalesPorMetodo = {};
  metodosDePago.forEach(metodo => {
    const nombreMetodo = metodo.nombre;
    const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) +
                         (reporte.cocina.pagos[nombreMetodo] || 0) +
                         (reporte.tienda.pagos[nombreMetodo] || 0) +
                         (reporte.propinas.pagos[nombreMetodo] || 0);
    const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
    totalesPorMetodo[nombreMetodo] = { ingreso: totalIngreso, gasto: totalGasto, balance: totalIngreso - totalGasto };
  });
  const totalIngresos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.ingreso, 0);
  const totalGastos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.gasto, 0);
  const balanceFinal = totalIngresos - totalGastos;

  // --- ESTILOS HTML (Sin cambios) ---
  const styles = {
    body: `font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; color: #333; background-color: #f8f9fa; margin: 0; padding: 20px;`,
    container: `max-width: fit-content; min-width: 800px; margin: 20px auto; padding: 25px; border: 1px solid #dee2e6; border-radius: 8px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);`,
    header: `color: #212529; font-size: 26px; text-align: center; margin-bottom: 10px; border-bottom: 2px solid #007bff; padding-bottom: 10px;`,
    subHeader: `font-size: 16px; color: #6c757d; text-align: center; margin-bottom: 25px;`,
    headerDetalle: `color: #212529; font-size: 20px; text-align: left; margin-top: 35px; margin-bottom: 15px; border-bottom: 1px solid #ccc; padding-bottom: 8px;`,
    table: `width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 13px;`,
    th: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; background-color: #f1f3f5; font-weight: 600;`,
    td: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: right;`,
    tdConcepto: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: 500;`,
    tdTotal: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #e9ecef;`,
    tdTotalConcepto: `border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: bold; background-color: #e9ecef;`,
    footer: `text-align: center; font-size: 12px; color: #adb5bd; margin-top: 30px; padding-top: 15px; border-top: 1px solid #e9ecef;`
  };

  // --- GENERACIÓN DE TABLAS DE RESUMEN (Sin cambios) ---
  const thMetodos = metodosDePago.map(m => `<th style="${styles.th} text-align:right;">${m.nombre}</th>`).join('');
  const generarCeldasFila = (fila) => metodosDePago.map(m => `<td style="${styles.td}">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
  const tdTotalesIngresos = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].ingreso)}</td>`).join('');
  const tdTotalesGastos = metodosDePago.map(m => `<td style="${styles.tdTotal} color:red;">(${formatCurrency(totalesPorMetodo[m.nombre].gasto)})</td>`).join('');
  const tdTotalesBalance = metodosDePago.map(m => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('');
  
  // --- (NUEVO) GENERACIÓN DE TABLAS DE DETALLE ---

  // 1. Detalle de Caja (Sin cambios)
  const detalleCajaHtml = `
    <h2 style="${styles.headerDetalle}">Detalle de Movimientos de Caja</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Tipo</th>
          <th style="${styles.th}">Concepto</th>
          <th style="${styles.th}">Método</th>
          <th style="${styles.th}">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${(movsCaja && movsCaja.length > 0) ? movsCaja.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(mv.creado_en)}</td>
            <td style="${styles.tdConcepto}">${mv.tipo}</td>
            <td style="${styles.tdConcepto}">${mv.concepto}</td>
            <td style="${styles.tdConcepto}">${mv.metodos_pago?.nombre || 'N/A'}</td>
            <td style="${styles.td} font-weight:bold; color:${mv.tipo === 'ingreso' ? 'green' : (mv.tipo === 'egreso' ? 'red' : 'inherit')};">
              ${formatCurrency(mv.monto)}
            </td>
          </tr>
        `).join('') : `<tr><td colspan="5" style="${styles.td} text-align:center;">No hay movimientos de caja.</td></tr>`}
      </tbody>
    </table>
  `;

  // 2. (MODIFICADO) Detalle de Amenidades (Agrupado)
  const amenidadesAgrupadas = {};
  if (movsAmenidades && movsAmenidades.length > 0) {
    movsAmenidades.forEach(mv => {
      const habitacionNombre = mv.habitaciones?.nombre || 'N/A (Registro Manual)';
      const itemNombre = mv.amenidades_inventario?.nombre_item || 'N/A';
      const cantidad = mv.cantidad_usada;
      
      if (!amenidadesAgrupadas[habitacionNombre]) {
        amenidadesAgrupadas[habitacionNombre] = [];
      }
      amenidadesAgrupadas[habitacionNombre].push(`${itemNombre} (<b>${cantidad}</b>)`);
    });
  }
  const detalleAmenidadesHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Amenidades (Agrupado por Habitación)</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Habitación</th>
          <th style="${styles.th}">Artículos Entregados en el Turno</th>
        </tr>
      </thead>
      <tbody>
        ${(Object.keys(amenidadesAgrupadas).length > 0) ? Object.entries(amenidadesAgrupadas).map(([habitacion, items]) => `
          <tr>
            <td style="${styles.tdConcepto}">${habitacion}</td>
            <td style="${styles.tdConcepto}">${items.join('<br>')}</td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay registros de amenidades.</td></tr>`}
      </tbody>
    </table>
  `;


  // 3. Detalle de Lencería (Sin cambios)
  const detalleLenceriaHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Lencería (Ropa de Cama)</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitación</th>
          <th style="${styles.th}">Artículo</th>
          <th style="${styles.th}">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${(movsLenceria && movsLenceria.length > 0) ? movsLenceria.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(mv.fecha_uso)}</td>
            <td style="${styles.tdConcepto}">${mv.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${mv.inventario_lenceria?.nombre_item || 'N/A'}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${mv.cantidad_usada}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de lencería.</td></tr>`}
      </tbody>
    </table>
  `;

  // 4. Detalle de Préstamos (Sin cambios)
  const detallePrestamosHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Préstamos</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitación</th>
          <th style="${styles.th}">Artículo</th>
          <th style="${styles.th}">Acción</th>
        </tr>
      </thead>
      <tbody>
        ${(movsPrestamos && movsPrestamos.length > 0) ? movsPrestamos.map(mv => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(mv.fecha_accion)}</td>
            <td style="${styles.tdConcepto}">${mv.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${mv.articulo_nombre}</td>
            <td style="${styles.tdConcepto}">${mv.accion}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de préstamos.</td></tr>`}
      </tbody>
    </table>
  `;
  
  // 5. (NUEVO) Stock de Amenidades
  const stockAmenidadesHtml = `
    <h2 style="${styles.headerDetalle}">Stock Actual de Amenidades</h2>
    <table style="${styles.table}">
      <thead><tr><th style="${styles.th}">Artículo</th><th style="${styles.th}">Stock Actual</th></tr></thead>
      <tbody>
        ${(stockAmenidades && stockAmenidades.length > 0) ? stockAmenidades.map(item => `
          <tr>
            <td style="${styles.tdConcepto}">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_actual}</td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
  `;

  // 6. (NUEVO) Stock de Lencería
  const stockLenceriaHtml = `
    <h2 style="${styles.headerDetalle}">Stock Actual de Lencería</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Artículo</th>
          <th style="${styles.th}">Limpio (Almacén)</th>
          <th style="${styles.th}">En Lavandería</th>
          <th style="${styles.th}">Stock Total</th>
        </tr>
      </thead>
      <tbody>
        ${(stockLenceria && stockLenceria.length > 0) ? stockLenceria.map(item => `
          <tr>
            <td style="${styles.tdConcepto}">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold; color:green;">${item.stock_limpio_almacen || 0}</td>
            <td style="${styles.td} text-align:center; color:#CA8A04;">${item.stock_en_lavanderia || 0}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_total || 0}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
  `;


  // --- ARMADO DEL HTML FINAL ---
  return `
    <body style="${styles.body}">
      <div style="${styles.container}">
        <h1 style="${styles.header}">Reporte de Ingresos y Gastos</h1>
        <p style="${styles.subHeader}">
          <strong>Realizado por:</strong> ${usuarioNombre}<br>
          <strong>Fecha de Cierre:</strong> ${fechaCierre}
        </G>
        
        <table style="${styles.table}">
          <thead>
            <tr>
              <th style="${styles.th}">Concepto</th>
              <th style="${styles.th}">N° Ventas</th>
              <th style="${styles.th}">Transac.</th>
              ${thMetodos}
              <th style="${styles.th} text-align:right;">Totales</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style="${styles.tdConcepto}">HABITACIONES:</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.transacciones}</td>
              ${generarCeldasFila(reporte.habitaciones)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.habitaciones))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">COCINA:</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.cocina.transacciones}</td>
              ${generarCeldasFila(reporte.cocina)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.cocina))}</td>
            </tr>
            <tr>
              <td style="${styles.tdConcepto}">TIENDA:</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.ventas}</td>
              <td style="${styles.td} text-align:center;">${reporte.tienda.transacciones}</td>
              ${generarCeldasFila(reporte.tienda)}
              <td style="${styles.tdTotal}">${formatCurrency(calcularTotalFila(reporte.tienda))}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Ingresos Totales:</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.ventas + reporte.cocina.ventas + reporte.tienda.ventas}</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>
              ${tdTotalesIngresos}
              <td style="${styles.tdTotal}">${formatCurrency(totalIngresos)}</td>
            </tr>
            <tr>
              <td style="${styles.tdTotalConcepto}">Gastos Totales:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.gastos.transacciones}</td>
              ${tdTotalesGastos}
              <td style="${styles.tdTotal} color:red;">(${formatCurrency(totalGastos)})</td>
            </tr>
             <tr>
              <td style="${styles.tdTotalConcepto}">Balance Final:</td>
              <td style="${styles.tdTotal} text-align:center;">-</td>
              <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>
              ${tdTotalesBalance}
              <td style="${styles.tdTotal} background-color:#007bff; color:white;">${formatCurrency(balanceFinal)}</td>
            </tr>
          </tbody>
        </table>
        
        ${detalleCajaHtml}
        ${detalleAmenidadesHtml} ${detalleLenceriaHtml}
        ${detallePrestamosHtml}
        
        ${stockAmenidadesHtml}
        ${stockLenceriaHtml}

        <div style="${styles.footer}">Este es un reporte automático generado por el sistema.</div>
      </div>
    </body>`;
}



async function enviarReporteCierreCaja({ asunto, htmlReporte, feedbackEl }) {
  const { data: config } = await currentSupabaseInstance
    .from('configuracion_hotel')
    .select('correo_reportes, correo_remitente')
    .eq('hotel_id', currentHotelId)
    .maybeSingle();
  let toCorreos = (config?.correo_reportes || '').trim();
  if (!toCorreos) {
    toCorreos = currentModuleUser.email || "tucorreo@tudominio.com";
  }
  if (!toCorreos || !toCorreos.split(',').some(correo => correo.trim().includes('@'))) {
    showError(feedbackEl, "No hay correo de destino válido para enviar el cierre de caja. Configúralo en Ajustes.");
    return;
  }
  toCorreos = toCorreos.split(',').map(c => c.trim()).filter(c => !!c).join(',');
  const fromCorreo = config?.correo_remitente || "no-reply@gestiondehotel.com";
  const payload = {
    to: toCorreos,
    from: fromCorreo,
    subject: asunto,
    html: htmlReporte
  };
  const response = await fetch(EMAIL_REPORT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    showError(feedbackEl, 'No se pudo enviar el reporte por email.');
  }
}

// --- MOUNT / UNMOUNT ---

// En el archivo caja.js

export async function mount(container, supabaseInst, user) {
  console.log("MOUNT caja.js llamado");
  unmount();
  currentContainerEl = container;
  currentSupabaseInstance = supabaseInst;
  currentModuleUser = user;

  const { data: perfil } = await supabaseInst.from('usuarios').select('hotel_id, rol').eq('id', user.id).single();
  
  currentHotelId = perfil?.hotel_id;
  currentUserRole = perfil?.rol;

  // --- AÑADE ESTA LÍNEA PARA DEPURAR ---
  console.log('ROL DEL USUARIO ACTUAL:', currentUserRole); 
  // ------------------------------------

  if (!currentHotelId) {
    container.innerHTML = `<div class="p-4 text-red-600">Error: Hotel no identificado.</div>`;
    return;
  }
  container.innerHTML = `<div class="p-8 text-center">Cargando estado de la caja...</div>`;
  await renderizarUI();
}


export function unmount() {
  // Limpia todos los listeners registrados
  moduleListeners.forEach(({ element, type, handler }) => {
    element?.removeEventListener(type, handler);
  });
  moduleListeners = [];
  currentSupabaseInstance = null;
  currentHotelId = null;
  currentModuleUser = null;
  currentContainerEl = null;
  turnoActivo = null;
}
