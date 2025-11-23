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
        stockLenceria || [],      // <-- NUEVO: Stock actual lencería
        valoresReales 
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

// REEMPLAZA TU FUNCIÓN renderizarModalArqueo ACTUAL CON ESTA VERSIÓN (CON CALCULADORA DE BILLETES)
function renderizarModalArqueo(metodosDePago, onConfirm) {
  // Encontrar el ID del método "Efectivo" para asociarle la calculadora
  const metodoEfectivo = metodosDePago.find(m => m.nombre.toLowerCase().includes('efectivo'));
  const idEfectivo = metodoEfectivo ? metodoEfectivo.id : null;

  // Creamos el HTML de los inputs por cada método de pago
  const inputsHtml = metodosDePago.map(metodo => {
    const esEfectivo = metodo.id === idEfectivo;
    
    // Si es efectivo, agregamos el botón de calculadora
    const botonCalc = esEfectivo 
        ? `<button type="button" id="btn-abrir-calc" class="absolute inset-y-0 right-0 px-3 flex items-center bg-gray-100 hover:bg-gray-200 border-l text-gray-600 rounded-r-md transition" title="Abrir calculadora de billetes">🧮 Contar</button>` 
        : '';
    
    return `
    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">
        ${metodo.nombre} (Dinero Físico/Real)
      </label>
      <div class="relative group">
        <span class="absolute inset-y-0 left-0 pl-3 flex items-center text-gray-500">$</span>
        <input 
          type="number" 
          id="arqueo-input-${metodo.id}" 
          class="form-control pl-7 ${esEfectivo ? 'pr-20' : ''} w-full border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 transition-colors" 
          placeholder="0" 
          min="0" 
          step="0.01"
        >
        ${botonCalc}
      </div>
    </div>
  `}).join('');

  // HTML de la Calculadora (Oculta por defecto)
  const calculadoraHtml = `
    <div id="panel-calculadora" class="hidden bg-gray-50 p-4 rounded-md border border-gray-200 mb-4 animate-fadeIn">
        <div class="flex justify-between items-center mb-2">
            <h4 class="text-sm font-bold text-gray-700">Desglose de Efectivo</h4>
            <span class="text-xs text-blue-600 cursor-pointer hover:underline" id="btn-limpiar-calc">Limpiar</span>
        </div>
        <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            ${[100000, 50000, 20000, 10000, 5000, 2000, 1000].map(val => `
                <div class="flex items-center justify-between">
                    <label class="text-gray-600">$${val/1000}k</label>
                    <input type="number" class="calc-billete w-20 p-1 border rounded text-right focus:ring-1 focus:ring-blue-500" data-valor="${val}" placeholder="0" min="0">
                </div>
            `).join('')}
            <div class="flex items-center justify-between col-span-2 border-t pt-2 mt-1">
                <label class="text-gray-600">Monedas (Total)</label>
                <input type="number" id="calc-monedas" class="w-24 p-1 border rounded text-right focus:ring-1 focus:ring-blue-500" placeholder="0" min="0">
            </div>
        </div>
        <div class="mt-3 text-right">
            <span class="text-xs text-gray-500 uppercase">Total Calculado:</span>
            <div class="text-lg font-bold text-blue-700" id="calc-total-display">$0</div>
        </div>
    </div>
  `;

  const modalHtml = `
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md overflow-hidden animate-fade-in-down transform transition-all">
      <div class="bg-gradient-to-r from-blue-600 to-blue-500 p-4 border-b">
        <h3 class="text-lg font-bold text-white flex items-center gap-2">
          🛡️ Arqueo de Caja
        </h3>
        <p class="text-blue-100 text-xs mt-1">
          Cuenta el dinero físico antes de ver el reporte.
        </p>
      </div>
      <div class="p-6">
        <form id="form-arqueo-ciego">
          ${calculadoraHtml}
          ${inputsHtml}
          <div class="mt-6 flex justify-end gap-3 pt-4 border-t">
            <button type="button" id="btn-cancelar-arqueo" class="button button-neutral px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Cancelar</button>
            <button type="submit" class="button button-primary bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-md transition transform active:scale-95">
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modalContainer = document.createElement('div');
  modalContainer.id = "modal-arqueo-ciego";
  modalContainer.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm";
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  // --- LÓGICA DE LA CALCULADORA ---
  if (idEfectivo) {
    const btnAbrir = modalContainer.querySelector('#btn-abrir-calc');
    const panelCalc = modalContainer.querySelector('#panel-calculadora');
    const inputEfectivo = modalContainer.querySelector(`#arqueo-input-${idEfectivo}`);
    const displayTotal = modalContainer.querySelector('#calc-total-display');
    const inputsBilletes = modalContainer.querySelectorAll('.calc-billete');
    const inputMonedas = modalContainer.querySelector('#calc-monedas');
    const btnLimpiar = modalContainer.querySelector('#btn-limpiar-calc');

    if (btnAbrir) {
        // Toggle abrir/cerrar
        btnAbrir.onclick = () => {
            const isHidden = panelCalc.classList.contains('hidden');
            if (isHidden) {
                panelCalc.classList.remove('hidden');
                // Movemos el panel calc para que quede justo arriba del input efectivo si es posible, o lo dejamos arriba
                inputsBilletes[0].focus();
            } else {
                panelCalc.classList.add('hidden');
            }
        };

        // Función de suma
        const recalcular = () => {
            let total = 0;
            inputsBilletes.forEach(inp => {
                const val = parseFloat(inp.dataset.valor);
                const count = parseFloat(inp.value) || 0;
                total += (val * count);
            });
            total += (parseFloat(inputMonedas.value) || 0);
            
            // Actualizar visual y el input real
            displayTotal.textContent = formatCurrency(total);
            inputEfectivo.value = total; // Actualiza el input principal automáticamente
        };

        // Listeners en inputs de calculadora
        inputsBilletes.forEach(inp => inp.addEventListener('input', recalcular));
        inputMonedas.addEventListener('input', recalcular);

        // Limpiar
        btnLimpiar.onclick = () => {
            inputsBilletes.forEach(inp => inp.value = '');
            inputMonedas.value = '';
            recalcular();
        };
        
        // Si el usuario escribe manualmente en el input principal, no borramos la calc, 
        // pero podríamos desincronizarla. Por simpleza, dejamos que la calc sobreescriba.
    }
  }

  // --- FIN LÓGICA CALCULADORA ---

  modalContainer.querySelector('#btn-cancelar-arqueo').onclick = () => modalContainer.remove();

  modalContainer.querySelector('#form-arqueo-ciego').onsubmit = (e) => {
    e.preventDefault();
    const valoresReales = {};
    metodosDePago.forEach(m => {
      const input = document.getElementById(`arqueo-input-${m.id}`);
      const valor = parseFloat(input.value) || 0;
      valoresReales[m.nombre] = valor;
    });
    modalContainer.remove();
    onConfirm(valoresReales);
  };
  
  setTimeout(() => {
    const firstInput = modalContainer.querySelector('input');
    if(firstInput) firstInput.focus();
  }, 100);
}


// REEMPLAZA TU FUNCIÓN mostrarResumenCorteDeCaja CON ESTA VERSIÓN (CON ARQUEO CIEGO)
async function mostrarResumenCorteDeCaja(valoresRealesArqueo = null) {
  const turnoParaResumir = turnoEnSupervision || turnoActivo;
  const esCierreForzoso = !!turnoEnSupervision;

  if (!turnoParaResumir) {
    alert("Error: No hay ningún turno activo para generar un resumen.");
    return;
  }

  // Solo mostramos loading si NO venimos del arqueo (para evitar parpadeos feos)
  if (!valoresRealesArqueo) showGlobalLoading('Preparando cierre...');

  try {
    // 1. Obtener Datos (Igual que antes)
    const { data: metodosDePago, error: metodosError } = await currentSupabaseInstance.from('metodos_pago').select('id, nombre').eq('hotel_id', currentHotelId).eq('activo', true).order('nombre', { ascending: true });
    if (metodosError) throw new Error("No se encontraron métodos de pago activos.");

    const { data: configHotel } = await currentSupabaseInstance.from('configuracion_hotel').select('*').eq('hotel_id', currentHotelId).maybeSingle();

    const { data: movimientos, error: movError } = await currentSupabaseInstance.from('caja').select('*, usuarios(nombre), metodos_pago(nombre)').eq('turno_id', turnoParaResumir.id).order('creado_en', { ascending: true });
    
    if (!valoresRealesArqueo) hideGlobalLoading(); // Ocultamos el loading inicial

    if (movError) throw movError;
    if (!movimientos || movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos para generar un resumen.');
      return;
    }

    // --- PUNTO DE INTERCEPCIÓN PARA EL ARQUEO CIEGO ---
    // Si la función se llamó sin valores (primera vez), mostramos el modal de conteo
    if (!valoresRealesArqueo) {
        renderizarModalArqueo(metodosDePago, (valoresCapturados) => {
            // Cuando el usuario confirme el conteo, volvemos a llamar a esta función pero pasando los valores
            mostrarResumenCorteDeCaja(valoresCapturados);
        });
        return; // Detenemos la ejecución aquí hasta que el usuario cuente
    }
    // --------------------------------------------------

    const reporte = procesarMovimientosParaReporte(movimientos);
    const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
    
    // Calcular totales del sistema
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

    // --- GENERAR HTML DE COMPARACIÓN (SISTEMA vs REAL) ---
    // Esta tabla reemplaza la fila de totales simples para mostrar discrepancias
    
    const filasComparativas = metodosDePago.map(m => {
        const sistema = totalesPorMetodo[m.nombre].balance;
        const real = valoresRealesArqueo[m.nombre] || 0;
        const diferencia = real - sistema;
        
        // Estilos según la diferencia
        let claseDif = "text-gray-500";
        let icono = "✅";
        if (diferencia < 0) { claseDif = "text-red-600 font-bold"; icono = "⚠️ Falta"; } // Falta dinero
        else if (diferencia > 0) { claseDif = "text-blue-600 font-bold"; icono = "🤔 Sobra"; } // Sobra dinero
        
        // Evitamos mostrar decimales innecesarios si es exacto
        const difFormat = diferencia === 0 ? '$0' : formatCurrency(diferencia);

        return `
            <tr class="border-b hover:bg-gray-50">
                <td class="px-4 py-3 font-medium">${m.nombre}</td>
                <td class="px-4 py-3 text-right text-gray-600">${formatCurrency(sistema)}</td>
                <td class="px-4 py-3 text-right font-bold text-gray-800 bg-yellow-50">${formatCurrency(real)}</td>
                <td class="px-4 py-3 text-right ${claseDif}">${icono} ${difFormat}</td>
            </tr>
        `;
    }).join('');


    // --- HTML DEL MODAL FINAL (REPORTAJE) ---
    const modalHtml = `
      <div class="bg-white p-0 rounded-2xl shadow-2xl w-full max-w-4xl mx-auto border border-slate-200 relative animate-fade-in-down max-h-[90vh] flex flex-col">
        <div class="py-5 px-8 border-b rounded-t-2xl bg-gradient-to-r from-blue-100 to-green-100 flex items-center justify-between">
          <h2 class="text-2xl font-bold text-slate-800">Resultado del Cierre</h2>
          <div class="text-sm bg-white px-3 py-1 rounded-full shadow-sm">
             Usuario: <b>${turnoParaResumir.usuarios?.nombre || 'Sistema'}</b>
          </div>
        </div>
        
        <div class="p-6 overflow-y-auto custom-scrollbar">
          
          <div class="mb-6 border rounded-lg overflow-hidden shadow-sm">
            <div class="bg-gray-800 text-white px-4 py-2 text-sm font-bold uppercase tracking-wider">Cuadre de Caja</div>
            <table class="w-full text-sm">
                <thead class="bg-gray-100 text-gray-700">
                    <tr>
                        <th class="px-4 py-2 text-left">Método</th>
                        <th class="px-4 py-2 text-right">Sistema (Esperado)</th>
                        <th class="px-4 py-2 text-right bg-yellow-100">Declarado (Real)</th>
                        <th class="px-4 py-2 text-right">Diferencia</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasComparativas}
                </tbody>
            </table>
          </div>

          <details class="group mb-4">
            <summary class="flex justify-between items-center font-medium cursor-pointer list-none p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
                <span>Ver desglose por conceptos (Habitaciones, Tienda, etc.)</span>
                <span class="transition group-open:rotate-180">▼</span>
            </summary>
            <div class="text-xs mt-3 text-gray-500 group-open:animate-fadeIn">
                <div class="overflow-x-auto">
                    <p class="p-2">Ingresos Totales Sistema: <b>${formatCurrency(totalIngresos)}</b> | Gastos Totales Sistema: <b>${formatCurrency(totalGastos)}</b></p>
                </div>
            </div>
          </details>

          <div class="flex flex-col md:flex-row justify-end gap-3 mt-6 pt-4 border-t">
            <button id="btn-imprimir-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-800 font-semibold transition order-2 md:order-1">🖨️ Imprimir Reporte</button>
            <button id="btn-cancelar-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition order-1 md:order-2">Volver / Corregir</button>
            <button id="btn-confirmar-corte-caja" class="button button-primary px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white font-bold shadow transition order-3">✅ Cerrar Turno Definitivamente</button>
          </div>
        </div>
      </div>
    `;

    // MOSTRAR EL MODAL
    const modal = document.createElement('div');
    modal.id = "modal-corte-caja";
    modal.className = "fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4";
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    // LISTENERS
    modal.querySelector('#btn-cancelar-corte-caja').onclick = () => modal.remove();
    
    modal.querySelector('#btn-confirmar-corte-caja').onclick = async () => {
      // AQUÍ PODRÍAS GUARDAR LAS DIFERENCIAS EN LA BASE DE DATOS SI QUISIERAS
      // Por ahora, procedemos al cierre normal
      modal.remove();
      if (esCierreForzoso) {
        await cerrarTurno(turnoParaResumir, turnoParaResumir.usuarios);
      } else {
        await cerrarTurno();
      }
    };

    modal.querySelector('#btn-imprimir-corte-caja').onclick = () => {
        // Datos para imprimir (Mantenemos la impresión del sistema por ahora)
        const ingresosPorMetodo = {};
        const egresosPorMetodo = {};
        const balancesPorMetodo = {};
        
        metodosDePago.forEach(m => { 
            ingresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.ingreso || 0;
            egresosPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.gasto || 0;
            // OJO: ¿Quieres imprimir lo que dice el sistema o lo que contó el usuario?
            // Usualmente se imprime el reporte del SISTEMA, y a mano se anota la diferencia, 
            // O se imprime el "Balance" del sistema. Dejémoslo como sistema para consistencia contable.
            balancesPorMetodo[m.nombre] = totalesPorMetodo[m.nombre]?.balance || 0;
        });
        
        const nombreUsuario = turnoParaResumir.usuarios?.nombre || turnoParaResumir.usuarios?.email || 'Usuario';
        const fechaLocal = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' });

        imprimirCorteCajaAdaptable(
            configHotel, 
            movimientos, 
            totalIngresos, 
            totalGastos, 
            balanceFinal, 
            ingresosPorMetodo, 
            egresosPorMetodo, 
            balancesPorMetodo,
            nombreUsuario, 
            fechaLocal,
            valoresRealesArqueo
        );
    };
    
  } catch (e) {
    hideGlobalLoading();
    // Si hay error y existe el modal, quitarlo para mostrar el error
    document.getElementById('modal-corte-caja')?.remove(); 
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error generando el resumen: ${e.message}`);
    console.error('Error en mostrarResumenCorteDeCaja:', e);
  }
}





// REEMPLAZA TU FUNCIÓN imprimirCorteCajaAdaptable CON ESTA (INCLUYE ALERTA DE DESCUADRE)
function imprimirCorteCajaAdaptable(config, movimientos, ingresos, egresos, balance, ingresosPorMetodo, egresosPorMetodo, balancesPorMetodo, usuarioNombre, fechaCierre, valoresReales = null) {
  let tamano = (config?.tamano_papel || '').toLowerCase();
  const esTermica = tamano === '58mm' || tamano === '80mm';
  const widthPage = tamano === '58mm' ? '58mm' : (tamano === '80mm' ? '78mm' : '100%');
  const fontSize = tamano === '58mm' ? '10px' : (tamano === '80mm' ? '11px' : '12px');

  // Datos del Encabezado
  let logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  let hotelNombre = config?.nombre_hotel || 'Hotel';
  let direccion = config?.direccion_fiscal || '';
  let nit = config?.nit_rut || '';
  let pie = config?.pie_ticket || '';

  // Lógica de Descuadre
  let alertaHtml = '';
  if (valoresReales) {
      // Sumar todo lo que el usuario declaró tener físicamente
      let totalDeclarado = 0;
      Object.values(valoresReales).forEach(val => totalDeclarado += val);
      
      let diferencia = totalDeclarado - balance;
      
      // Si la diferencia es mayor a 1 peso (para evitar errores de redondeo decimal)
      if (Math.abs(diferencia) > 1) {
          const esFaltante = diferencia < 0;
          const tipo = esFaltante ? 'FALTANTE (DEUDA)' : 'SOBRANTE';
          const color = esFaltante ? '#000' : '#000'; // En ticket térmico el color no importa tanto, usamos negrita
          const borde = esFaltante ? '2px dashed black' : '1px solid black';
          
          alertaHtml = `
            <div style="margin: 10px 0; padding: 8px; border: ${borde}; text-align: center;">
                <div style="font-weight: bold; font-size: 1.2em;">⚠️ ¡DESCUADRE DETECTADO!</div>
                <div style="margin-top: 4px;">Sistema espera: ${formatCurrency(balance)}</div>
                <div>Cajero entrega: ${formatCurrency(totalDeclarado)}</div>
                <div style="margin-top: 5px; font-weight: bold; font-size: 1.3em;">
                    ${tipo}: ${formatCurrency(diferencia)}
                </div>
            </div>
          `;
      }
  }

  // ESTILOS CSS
  let style = `
    @page { margin: ${esTermica ? '0' : '15mm'}; size: auto; }
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: ${fontSize}; margin: 0; padding: ${esTermica ? '5px' : '20px'}; width: ${esTermica ? widthPage : 'auto'}; color: #000; }
    .container { width: 100%; max-width: ${esTermica ? '100%' : '800px'}; margin: 0 auto; }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .bold { font-weight: bold; }
    .mb-2 { margin-bottom: 10px; }
    .mt-2 { margin-top: 10px; }
    .border-bottom { border-bottom: 1px dashed #444; padding-bottom: 5px; margin-bottom: 5px; }
    .border-top { border-top: 1px dashed #444; padding-top: 5px; margin-top: 5px; }
    table { width: 100%; border-collapse: collapse; margin-top: 5px; }
    th { text-align: left; border-bottom: 1px solid #000; padding: 3px 0; font-weight: bold; text-transform: uppercase; font-size: 0.9em; }
    td { padding: 4px 0; vertical-align: top; }
    .col-hora { width: 12%; } .col-tipo { width: 8%; text-align: center; } .col-concepto { width: 45%; } .col-metodo { width: 15%; } .col-monto { width: 20%; text-align: right; }
    .resumen-row { display: flex; justify-content: space-between; margin-bottom: 2px; }
    .balance-box { border: 1px solid #000; padding: 5px; margin: 10px 0; background-color: #f9f9f9; }
    @media print { .no-print { display: none; } body { -webkit-print-color-adjust: exact; } }
  `;

  let headerHtml = `
    <div class="text-center mb-2">
      ${logoUrl ? `<img src="${logoUrl}" style="max-width: 60%; max-height: 60px; object-fit: contain;">` : ''}
      <div class="bold" style="font-size: 1.1em; margin-top:5px;">${hotelNombre}</div>
      <div>${direccion}</div>
      ${nit ? `<div>NIT: ${nit}</div>` : ''}
    </div>
    <div class="border-bottom text-center bold">CIERRE DE CAJA</div>
    <div class="mb-2" style="font-size: 0.9em;">
      <div class="resumen-row"><span>Cajero:</span> <span class="bold">${usuarioNombre}</span></div>
      <div class="resumen-row"><span>Fecha:</span> <span>${fechaCierre}</span></div>
    </div>
  `;

  let totalesHtml = `
    <div class="mb-2">
      <div class="resumen-row"><span>(+) Ingresos Totales:</span> <span>${formatCurrency(ingresos)}</span></div>
      <div class="resumen-row"><span>(-) Egresos Totales:</span> <span>${formatCurrency(egresos)}</span></div>
      <div class="border-top resumen-row bold" style="font-size: 1.1em;">
        <span>(=) BALANCE SISTEMA:</span> <span>${formatCurrency(balance)}</span>
      </div>
    </div>
  `;

  // Lista de dinero a entregar (lo que dice el sistema)
  let listaBalances = Object.entries(balancesPorMetodo).map(([metodo, valor]) => {
     if(valor === 0) return '';
     return `<div class="resumen-row"><span>${metodo}:</span> <span class="bold">${formatCurrency(valor)}</span></div>`;
  }).join('');

  let detalleEntregarHtml = `
    <div class="balance-box">
      <div class="bold text-center border-bottom mb-1">DINERO ESPERADO (SISTEMA)</div>
      ${listaBalances || '<div class="text-center italic">Sin movimientos</div>'}
    </div>
  `;

  let filasMovimientos = movimientos.map(mv => {
    let hora = formatDateTime(mv.creado_en).split(',')[1].trim().slice(0, 5);
    let tipoSigno = mv.tipo === 'ingreso' ? '+' : (mv.tipo === 'egreso' ? '-' : '•');
    return `<tr><td class="col-hora">${hora}</td><td class="col-tipo">${tipoSigno}</td><td class="col-concepto">${mv.concepto || 'Sin concepto'}</td><td class="col-metodo">${(mv.metodos_pago?.nombre || 'N/A')}</td><td class="col-monto">${formatCurrency(mv.monto)}</td></tr>`;
  }).join('');

  let tablaHtml = `<div class="bold mt-2 border-bottom">MOVIMIENTOS</div><table><thead><tr><th class="col-hora">Hora</th><th class="col-tipo">T</th><th class="col-concepto">Concepto</th><th class="col-metodo">Met</th><th class="col-monto">Monto</th></tr></thead><tbody>${filasMovimientos}</tbody></table>`;

  let firmasHtml = `<div class="mt-2" style="margin-top: 30px; display: flex; justify-content: space-between; gap: 20px;"><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Cajero</div><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Supervisor</div></div>`;

  let fullHtml = `<html><head><title>Corte de Caja</title><style>${style}</style></head><body><div class="container">${headerHtml}${totalesHtml}${detalleEntregarHtml}${alertaHtml}${tablaHtml}${firmasHtml}${pie ? `<div class="text-center mt-2 border-top" style="font-size:0.8em; padding-top:5px;">${pie}</div>` : ''}</div></body></html>`;

  let w = window.open('', '_blank', `width=${esTermica ? '400' : '900'},height=700`);
  w.document.write(fullHtml);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 500);
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

// REEMPLAZA TU FUNCIÓN generarHTMLReporteCierre CON ESTA (AÑADE EL PARÁMETRO valoresReales AL FINAL)
function generarHTMLReporteCierre(
    reporte, metodosDePago, usuarioNombre, fechaCierre,
    movsCaja, movsAmenidades, movsLenceria, movsPrestamos,
    stockAmenidades, stockLenceria,
    valoresReales = null // <--- NUEVO PARÁMETRO AL FINAL
) {
  
  // --- LÓGICA DE CÁLCULO ESTÁNDAR ---
  const calcularTotalFila = (fila) => Object.values(fila.pagos).reduce((acc, val) => acc + val, 0);
  const totalesPorMetodo = {};
  metodosDePago.forEach(metodo => {
    const nombreMetodo = metodo.nombre;
    const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) + (reporte.cocina.pagos[nombreMetodo] || 0) + (reporte.tienda.pagos[nombreMetodo] || 0) + (reporte.propinas.pagos[nombreMetodo] || 0);
    const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
    totalesPorMetodo[nombreMetodo] = { ingreso: totalIngreso, gasto: totalGasto, balance: totalIngreso - totalGasto };
  });
  const totalIngresos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.ingreso, 0);
  const totalGastos = Object.values(totalesPorMetodo).reduce((acc, val) => acc + val.gasto, 0);
  const balanceFinal = totalIngresos - totalGastos;

  // --- NUEVA LÓGICA: GENERAR ALERTA VISUAL PARA EMAIL ---
  let alertaDescuadreHtml = '';
  if (valoresReales) {
      let totalDeclarado = 0;
      let filasDescuadre = metodosDePago.map(m => {
          const sistema = totalesPorMetodo[m.nombre].balance;
          const real = valoresReales[m.nombre] || 0;
          totalDeclarado += real;
          const dif = real - sistema;
          
          if (Math.abs(dif) < 1) return ''; // Ignorar si cuadra
          
          const color = dif < 0 ? 'red' : 'blue';
          const signo = dif > 0 ? '+' : '';
          return `<tr>
              <td style="padding:5px; border-bottom:1px solid #ddd;">${m.nombre}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(sistema)}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(real)}</td>
              <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right; color:${color}; font-weight:bold;">${signo}${formatCurrency(dif)}</td>
          </tr>`;
      }).join('');

      const diferenciaTotal = totalDeclarado - balanceFinal;

      if (Math.abs(diferenciaTotal) > 1 || filasDescuadre.trim() !== '') {
          const tituloEstado = diferenciaTotal < 0 ? 'DESCUADRE: FALTANTE DE DINERO' : (diferenciaTotal > 0 ? 'DESCUADRE: SOBRANTE DE DINERO' : 'DETALLE DE DIFERENCIAS');
          const colorFondo = diferenciaTotal < 0 ? '#fee2e2' : '#dbeafe'; // Rojo claro o Azul claro
          const colorTexto = diferenciaTotal < 0 ? '#991b1b' : '#1e40af';

          alertaDescuadreHtml = `
            <div style="background-color: ${colorFondo}; border: 2px dashed ${colorTexto}; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                <h3 style="color: ${colorTexto}; margin-top: 0; text-align: center;">⚠️ ${tituloEstado}</h3>
                <p style="text-align:center; font-size:16px;">
                    El sistema calculó <b>${formatCurrency(balanceFinal)}</b>, pero el cajero declaró tener <b>${formatCurrency(totalDeclarado)}</b>.
                </p>
                <div style="text-align:center; font-size:20px; font-weight:bold; color:${colorTexto}; margin-bottom:10px;">
                   Diferencia Total: ${diferenciaTotal > 0 ? '+' : ''}${formatCurrency(diferenciaTotal)}
                </div>
                <table style="width:100%; font-size:13px; background:white; border-collapse:collapse;">
                    <thead>
                        <tr style="background:#f3f4f6; color:#555;">
                            <th style="padding:5px; text-align:left;">Método</th>
                            <th style="padding:5px; text-align:right;">Sistema</th>
                            <th style="padding:5px; text-align:right;">Real (Declarado)</th>
                            <th style="padding:5px; text-align:right;">Diferencia</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filasDescuadre}
                    </tbody>
                </table>
            </div>
          `;
      }
  }

  // --- ESTILOS HTML (Compactados) ---
  const styles = {
    body: `font-family: Arial, sans-serif; font-size: 14px; color: #333; background-color: #f8f9fa; padding: 20px;`,
    container: `max-width: 800px; margin: 0 auto; padding: 20px; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px;`,
    header: `color: #212529; font-size: 24px; text-align: center; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px;`,
    table: `width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px;`,
    th: `border: 1px solid #dee2e6; padding: 8px; background-color: #f1f3f5; font-weight: bold;`,
    td: `border: 1px solid #dee2e6; padding: 8px; text-align: right;`,
    tdLeft: `border: 1px solid #dee2e6; padding: 8px; text-align: left;`
  };

  // --- (El resto de la generación de tablas de detalle se mantiene igual que tu versión anterior) ---
  // Para ahorrar espacio, pongo aquí la estructura básica, pero asegúrate de que sea la misma lógica de antes
  const thMetodos = metodosDePago.map(m => `<th style="${styles.th} text-align:right;">${m.nombre}</th>`).join('');
  const generarCeldasFila = (fila) => metodosDePago.map(m => `<td style="${styles.td}">${formatCurrency(fila.pagos[m.nombre] || 0)}</td>`).join('');
  
  // ... (Aquí irían los detalles de amenidades, lencería, etc. MANTÉN TU CÓDIGO EXISTENTE PARA ESAS PARTES) ...
  // Solo devolveré el inicio con la alerta inyectada para que lo veas:

  return `
    <body style="${styles.body}">
      <div style="${styles.container}">
        <h1 style="${styles.header}">Reporte de Cierre de Caja</h1>
        <p style="text-align:center; color:#666;">
          <strong>Responsable:</strong> ${usuarioNombre}<br>
          <strong>Fecha:</strong> ${fechaCierre}
        </p>

        ${alertaDescuadreHtml}
        <table style="${styles.table}">
          <thead>
            <tr><th style="${styles.th}">Concepto</th><th style="${styles.th}">Transac.</th>${thMetodos}<th style="${styles.th} text-align:right;">Totales</th></tr>
          </thead>
          <tbody>
             <tr>
              <td style="${styles.tdLeft}">Balance Final:</td>
              <td style="${styles.td} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>
              ${metodosDePago.map(m => `<td style="${styles.td}">${formatCurrency(totalesPorMetodo[m.nombre].balance)}</td>`).join('')}
              <td style="${styles.td} background-color:#007bff; color:white; font-weight:bold;">${formatCurrency(balanceFinal)}</td>
            </tr>
          </tbody>
        </table>
        
        <br>
        <div style="font-size:12px; color:#aaa; text-align:center;">Reporte generado automáticamente por Gestión de Hotel.</div>
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
