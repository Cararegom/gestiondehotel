import {
  formatCurrency,
  formatDateTime,
  hideGlobalLoading,
  showError,
  showGlobalLoading
} from '../../uiUtils.js';
import { escapeAttribute, escapeHtml, normalizeLegacyText } from '../../security.js';
import {
  formatMovementDateTime,
  getMovementTimeLabel,
  sortMovementsByDate
} from './caja-movimientos.js';

export function procesarMovimientosParaReporte(movimientos) {
  const crearCategoria = () => ({ pagos: {}, ventas: 0, transacciones: 0 });
  const reporte = {
    habitaciones: crearCategoria(),
    cocina: crearCategoria(),
    tienda: crearCategoria(),
    propinas: crearCategoria(),
    gastos: crearCategoria(),
    apertura: 0
  };

  if (!movimientos || movimientos.length === 0) {
    return reporte;
  }

  movimientos.forEach((movimiento) => {
    const monto = Number(movimiento.monto);
    const nombreMetodo = movimiento.metodos_pago?.nombre || 'Efectivo';
    const concepto = normalizeLegacyText(movimiento.concepto || '').toLowerCase();
    let categoria = null;

    if (movimiento.tipo === 'apertura') {
      reporte.apertura += monto;
      return;
    }

    if (movimiento.tipo === 'ingreso') {
      if (concepto.includes('restaurante') || concepto.includes('cocina')) {
        categoria = reporte.cocina;
      } else if (concepto.includes('tienda') || concepto.includes('producto')) {
        categoria = reporte.tienda;
      } else if (concepto.includes('propina')) {
        categoria = reporte.propinas;
      } else if (concepto.includes('habitaci') || concepto.includes('alquiler') || concepto.includes('reserva') || concepto.includes('extensi')) {
        categoria = reporte.habitaciones;
      } else {
        console.warn(`Movimiento de ingreso no clasificado, asignado a Habitaciones: "${movimiento.concepto}"`);
        categoria = reporte.habitaciones;
      }

      categoria.ventas += 1;
      categoria.transacciones += 1;
    } else if (movimiento.tipo === 'egreso') {
      categoria = reporte.gastos;
      categoria.transacciones += 1;
    }

    if (categoria) {
      categoria.pagos[nombreMetodo] = (categoria.pagos[nombreMetodo] || 0) + monto;
    }
  });

  return reporte;
}

export function esMetodoEfectivo(nombreMetodo = '') {
  return String(nombreMetodo).toLowerCase().includes('efectivo');
}

export function calcularTotalesSistemaCierre(reporte, metodosDePago) {
  const calcularTotalFila = (fila) => Object.values(fila?.pagos || {}).reduce((acc, val) => acc + val, 0);
  const totalIngresos = calcularTotalFila(reporte.habitaciones) + calcularTotalFila(reporte.cocina) + calcularTotalFila(reporte.tienda) + calcularTotalFila(reporte.propinas);
  const totalGastos = calcularTotalFila(reporte.gastos);
  const balanceFinal = (reporte.apertura || 0) + totalIngresos - totalGastos;

  const totalesPorMetodo = {};
  metodosDePago.forEach((metodo) => {
    const nombreMetodo = metodo.nombre;
    const totalIngreso = (reporte.habitaciones.pagos[nombreMetodo] || 0) +
      (reporte.cocina.pagos[nombreMetodo] || 0) +
      (reporte.tienda.pagos[nombreMetodo] || 0) +
      (reporte.propinas.pagos[nombreMetodo] || 0);
    const totalGasto = reporte.gastos.pagos[nombreMetodo] || 0;
    const balanceSinApertura = totalIngreso - totalGasto;

    totalesPorMetodo[nombreMetodo] = {
      ingreso: totalIngreso,
      gasto: totalGasto,
      balance: balanceSinApertura,
      esperadoArqueo: balanceSinApertura + (esMetodoEfectivo(nombreMetodo) ? (reporte.apertura || 0) : 0)
    };
  });

  return {
    totalIngresos,
    totalGastos,
    balanceFinal,
    totalesPorMetodo
  };
}

function extraerHabitacionDesdeConcepto(concepto = '') {
  const texto = normalizeLegacyText(concepto || '');
  const matchCompleto = texto.match(/(habitaci[oó]n\s+[a-z0-9-]+)/i);
  if (matchCompleto?.[1]) {
    return matchCompleto[1]
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^habitaci[oó]n/i, 'Habitación');
  }

  const matchCorto = texto.match(/hab\.\s*([a-z0-9-]+)/i);
  if (matchCorto?.[1]) {
    return `Habitación ${matchCorto[1].trim()}`;
  }

  return '';
}

export function construirResumenOperativoCierre({
  movimientos = [],
  reporte = null,
  ventasTienda = [],
  detallesVentasTienda = [],
  ventasRestaurante = [],
  itemsVentasRestaurante = [],
  serviciosReserva = []
} = {}) {
  const movimientosList = Array.isArray(movimientos) ? movimientos : [];
  const reporteSeguro = reporte || procesarMovimientosParaReporte(movimientosList);
  const habitacionesDetectadas = new Set();

  movimientosList.forEach((movimiento) => {
    if (movimiento?.tipo !== 'ingreso') return;

    const concepto = normalizeLegacyText(movimiento?.concepto || '');
    if (!/habitaci|alquiler|reserva|extensi/i.test(concepto)) return;

    const habitacion = extraerHabitacionDesdeConcepto(concepto);
    if (habitacion) habitacionesDetectadas.add(habitacion);
  });

  const tiendaUnidades = (Array.isArray(detallesVentasTienda) ? detallesVentasTienda : []).reduce(
    (acc, item) => acc + (Number(item?.cantidad) || 0),
    0
  );
  const restauranteUnidades = (Array.isArray(itemsVentasRestaurante) ? itemsVentasRestaurante : []).reduce(
    (acc, item) => acc + (Number(item?.cantidad) || 0),
    0
  );

  const serviciosValidos = (Array.isArray(serviciosReserva) ? serviciosReserva : []).filter((item) => {
    const descripcion = normalizeLegacyText(item?.descripcion_manual || '');
    return !/descuento/i.test(descripcion);
  });

  const serviciosUnidades = serviciosValidos.reduce((acc, item) => acc + (Number(item?.cantidad) || 1), 0);
  const serviciosTotal = serviciosValidos.reduce((acc, item) => acc + (Number(item?.precio_cobrado) || 0), 0);

  const metodosUsados = new Set(
    movimientosList
      .map((movimiento) => normalizeLegacyText(movimiento?.metodos_pago?.nombre || ''))
      .filter(Boolean)
  );

  return {
    habitacionesAlquiladas: habitacionesDetectadas.size || Number(reporteSeguro?.habitaciones?.ventas || 0),
    habitacionesCobros: Number(reporteSeguro?.habitaciones?.ventas || 0),
    tiendaVentas: Array.isArray(ventasTienda) ? ventasTienda.length : Number(reporteSeguro?.tienda?.ventas || 0),
    tiendaUnidades,
    tiendaIngresos: (Array.isArray(ventasTienda) ? ventasTienda : []).reduce((acc, item) => acc + (Number(item?.total_venta) || 0), 0),
    restauranteVentas: Array.isArray(ventasRestaurante) ? ventasRestaurante.length : Number(reporteSeguro?.cocina?.ventas || 0),
    restauranteUnidades,
    restauranteIngresos: (Array.isArray(ventasRestaurante) ? ventasRestaurante : []).reduce((acc, item) => acc + (Number(item?.monto_total ?? item?.total_venta) || 0), 0),
    serviciosUnidades,
    serviciosIngresos: serviciosTotal,
    ingresosRegistrados: movimientosList.filter((movimiento) => movimiento?.tipo === 'ingreso').length,
    egresosRegistrados: movimientosList.filter((movimiento) => movimiento?.tipo === 'egreso').length,
    metodosUsados: metodosUsados.size
  };
}

export function renderizarModalArqueo(metodosDePago, onConfirm) {
  const metodoEfectivo = metodosDePago.find((metodo) => esMetodoEfectivo(metodo.nombre));
  const idEfectivo = metodoEfectivo ? metodoEfectivo.id : null;

  const inputsHtml = metodosDePago.map((metodo) => {
    const esEfectivo = metodo.id === idEfectivo;
    const botonCalc = esEfectivo
      ? '<button type="button" id="btn-abrir-calc" class="absolute inset-y-0 right-0 px-3 flex items-center bg-gray-100 hover:bg-gray-200 border-l text-gray-600 rounded-r-md transition" title="Abrir calculadora de billetes">Contar</button>'
      : '';

    return `
      <div class="mb-4">
        <label class="block text-sm font-medium text-gray-700 mb-1">
          ${metodo.nombre} (Dinero fisico / real)
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
    `;
  }).join('');

  const calculadoraHtml = `
    <div id="panel-calculadora" class="hidden bg-gray-50 p-4 rounded-md border border-gray-200 mb-4 animate-fadeIn">
      <div class="flex justify-between items-center mb-2">
        <h4 class="text-sm font-bold text-gray-700">Desglose de Efectivo</h4>
        <span class="text-xs text-blue-600 cursor-pointer hover:underline" id="btn-limpiar-calc">Limpiar</span>
      </div>
      <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        ${[100000, 50000, 20000, 10000, 5000, 2000, 1000].map((val) => `
          <div class="flex items-center justify-between">
            <label class="text-gray-600">$${val / 1000}k</label>
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
        <h3 class="text-lg font-bold text-white flex items-center gap-2">Arqueo de caja</h3>
        <p class="text-blue-100 text-xs mt-1">Cuenta el dinero fisico antes de ver el reporte.</p>
      </div>
      <div class="p-6">
        <form id="form-arqueo-ciego">
          ${calculadoraHtml}
          ${inputsHtml}
          <div class="mt-6 flex justify-end gap-3 pt-4 border-t">
            <button type="button" id="btn-cancelar-arqueo" class="button button-neutral px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md transition">Cancelar</button>
            <button type="submit" class="button button-primary bg-blue-600 hover:bg-blue-700 text-white font-bold px-4 py-2 rounded-md shadow-md transition transform active:scale-95">Confirmar</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const modalContainer = document.createElement('div');
  modalContainer.id = 'modal-arqueo-ciego';
  modalContainer.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-60 p-4 backdrop-blur-sm';
  modalContainer.innerHTML = modalHtml;
  document.body.appendChild(modalContainer);

  if (idEfectivo) {
    const btnAbrir = modalContainer.querySelector('#btn-abrir-calc');
    const panelCalc = modalContainer.querySelector('#panel-calculadora');
    const inputEfectivo = modalContainer.querySelector(`#arqueo-input-${idEfectivo}`);
    const displayTotal = modalContainer.querySelector('#calc-total-display');
    const inputsBilletes = modalContainer.querySelectorAll('.calc-billete');
    const inputMonedas = modalContainer.querySelector('#calc-monedas');
    const btnLimpiar = modalContainer.querySelector('#btn-limpiar-calc');

    if (btnAbrir) {
      btnAbrir.onclick = () => {
        const isHidden = panelCalc.classList.contains('hidden');
        if (isHidden) {
          panelCalc.classList.remove('hidden');
          inputsBilletes[0].focus();
        } else {
          panelCalc.classList.add('hidden');
        }
      };

      const recalcular = () => {
        let total = 0;
        inputsBilletes.forEach((input) => {
          const val = parseFloat(input.dataset.valor);
          const count = parseFloat(input.value) || 0;
          total += val * count;
        });
        total += parseFloat(inputMonedas.value) || 0;

        displayTotal.textContent = formatCurrency(total);
        inputEfectivo.value = total;
      };

      inputsBilletes.forEach((input) => input.addEventListener('input', recalcular));
      inputMonedas.addEventListener('input', recalcular);

      btnLimpiar.onclick = () => {
        inputsBilletes.forEach((input) => {
          input.value = '';
        });
        inputMonedas.value = '';
        recalcular();
      };
    }
  }

  modalContainer.querySelector('#btn-cancelar-arqueo').onclick = () => modalContainer.remove();
  modalContainer.querySelector('#form-arqueo-ciego').onsubmit = (e) => {
    e.preventDefault();
    const valoresReales = {};
    metodosDePago.forEach((metodo) => {
      const input = document.getElementById(`arqueo-input-${metodo.id}`);
      const valor = parseFloat(input.value) || 0;
      valoresReales[metodo.nombre] = valor;
    });
    modalContainer.remove();
    onConfirm(valoresReales);
  };

  setTimeout(() => {
    const firstInput = modalContainer.querySelector('input');
    if (firstInput) firstInput.focus();
  }, 100);
}

export async function mostrarResumenCorteDeCaja({
  valoresRealesArqueo = null,
  turnoEnSupervision,
  turnoActivo,
  supabase,
  hotelId,
  currentModuleUser,
  currentContainerEl,
  handleCerrarTurno
}) {
  const turnoParaResumir = turnoEnSupervision || turnoActivo;
  const esCierreForzoso = !!turnoEnSupervision;

  if (!turnoParaResumir) {
    showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay ningun turno activo para generar un resumen.');
    return;
  }

  if (!valoresRealesArqueo) showGlobalLoading('Preparando cierre...');

  try {
    const { data: metodosDePago, error: metodosError } = await supabase
      .from('metodos_pago')
      .select('id, nombre')
      .eq('hotel_id', hotelId)
      .eq('activo', true)
      .order('nombre', { ascending: true });
    if (metodosError) throw new Error('No se encontraron metodos de pago activos.');

    const { data: configHotel } = await supabase
      .from('configuracion_hotel')
      .select('*')
      .eq('hotel_id', hotelId)
      .maybeSingle();

    const { data: movimientos, error: movError } = await supabase
      .from('caja')
      .select('*, usuarios(nombre), metodos_pago(nombre)')
      .eq('turno_id', turnoParaResumir.id);

    if (!valoresRealesArqueo) hideGlobalLoading();

    if (movError) throw movError;
    if (!movimientos || movimientos.length === 0) {
      showError(currentContainerEl.querySelector('#turno-global-feedback'), 'No hay movimientos para generar un resumen.');
      return;
    }

    const movimientosOrdenados = sortMovementsByDate(movimientos, true);

    if (!valoresRealesArqueo) {
      renderizarModalArqueo(metodosDePago, (valoresCapturados) => {
        mostrarResumenCorteDeCaja({
          valoresRealesArqueo: valoresCapturados,
          turnoEnSupervision,
          turnoActivo,
          supabase,
          hotelId,
          currentModuleUser,
          currentContainerEl,
          handleCerrarTurno
        });
      });
      return;
    }

    const reporte = procesarMovimientosParaReporte(movimientosOrdenados);
    const {
      totalesPorMetodo,
      totalIngresos,
      totalGastos,
      balanceFinal
    } = calcularTotalesSistemaCierre(reporte, metodosDePago);

    const filasComparativas = metodosDePago.map((metodo) => {
      const sistema = totalesPorMetodo[metodo.nombre].esperadoArqueo;
      const real = valoresRealesArqueo[metodo.nombre] || 0;
      const diferencia = real - sistema;

      let claseDif = 'text-gray-500';
      let icono = 'Cuadra';
      if (diferencia < 0) {
        claseDif = 'text-red-600 font-bold';
        icono = 'Falta';
      } else if (diferencia > 0) {
        claseDif = 'text-blue-600 font-bold';
        icono = 'Sobra';
      }

      const difFormat = diferencia === 0 ? '$0' : formatCurrency(diferencia);

      return `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-4 py-3 font-medium">${metodo.nombre}</td>
          <td class="px-4 py-3 text-right text-gray-600">${formatCurrency(sistema)}</td>
          <td class="px-4 py-3 text-right font-bold text-gray-800 bg-yellow-50">${formatCurrency(real)}</td>
          <td class="px-4 py-3 text-right ${claseDif}">${icono} ${difFormat}</td>
        </tr>
      `;
    }).join('');

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
                  <th class="px-4 py-2 text-left">Metodo</th>
                  <th class="px-4 py-2 text-right">Sistema (Esperado)</th>
                  <th class="px-4 py-2 text-right bg-yellow-100">Declarado (Real)</th>
                  <th class="px-4 py-2 text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>${filasComparativas}</tbody>
            </table>
          </div>

          <details class="group mb-4">
            <summary class="flex justify-between items-center font-medium cursor-pointer list-none p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition">
              <span>Ver desglose por conceptos (Habitaciones, Tienda, etc.)</span>
              <span class="transition group-open:rotate-180">v</span>
            </summary>
            <div class="text-xs mt-3 text-gray-500 group-open:animate-fadeIn">
              <div class="overflow-x-auto">
                <p class="p-2">Apertura: <b>${formatCurrency(reporte.apertura)}</b> | Ingresos operativos: <b>${formatCurrency(totalIngresos)}</b> | Gastos: <b>${formatCurrency(totalGastos)}</b> | Balance esperado: <b>${formatCurrency(balanceFinal)}</b></p>
              </div>
            </div>
          </details>

          <div class="flex flex-col md:flex-row justify-end gap-3 mt-6 pt-4 border-t">
            <button id="btn-imprimir-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-blue-800 font-semibold transition order-2 md:order-1">Imprimir reporte</button>
            <button id="btn-cancelar-corte-caja" class="button button-neutral px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition order-1 md:order-2">Volver / corregir</button>
            <button id="btn-confirmar-corte-caja" class="button button-primary px-4 py-2 rounded-lg bg-gradient-to-r from-green-600 to-green-500 hover:from-green-700 hover:to-green-600 text-white font-bold shadow transition order-3">Cerrar turno definitivamente</button>
          </div>
        </div>
      </div>
    `;

    const modal = document.createElement('div');
    modal.id = 'modal-corte-caja';
    modal.className = 'fixed inset-0 z-[10000] flex items-center justify-center bg-black bg-opacity-50 p-4';
    modal.innerHTML = modalHtml;
    document.body.appendChild(modal);

    modal.querySelector('#btn-cancelar-corte-caja').onclick = () => modal.remove();
    modal.querySelector('#btn-confirmar-corte-caja').onclick = async () => {
      modal.remove();
      if (esCierreForzoso) {
        await handleCerrarTurno(turnoParaResumir, turnoParaResumir.usuarios, valoresRealesArqueo);
      } else {
        await handleCerrarTurno(null, null, valoresRealesArqueo);
      }
    };

    modal.querySelector('#btn-imprimir-corte-caja').onclick = () => {
      const ingresosPorMetodo = {};
      const egresosPorMetodo = {};
      const balancesPorMetodo = {};

      metodosDePago.forEach((metodo) => {
        ingresosPorMetodo[metodo.nombre] = totalesPorMetodo[metodo.nombre]?.ingreso || 0;
        egresosPorMetodo[metodo.nombre] = totalesPorMetodo[metodo.nombre]?.gasto || 0;
        balancesPorMetodo[metodo.nombre] = totalesPorMetodo[metodo.nombre]?.esperadoArqueo || 0;
      });

      const nombreUsuario = turnoParaResumir.usuarios?.nombre || turnoParaResumir.usuarios?.email || 'Usuario';
      const fechaLocal = new Date().toLocaleString('es-CO', { dateStyle: 'full', timeStyle: 'medium' });

      imprimirCorteCajaAdaptable(
        configHotel,
        movimientosOrdenados,
        totalIngresos,
        totalGastos,
        balanceFinal,
        ingresosPorMetodo,
        egresosPorMetodo,
        balancesPorMetodo,
        nombreUsuario,
        fechaLocal,
        reporte.apertura,
        valoresRealesArqueo
      );
    };
  } catch (e) {
    hideGlobalLoading();
    document.getElementById('modal-corte-caja')?.remove();
    showError(currentContainerEl.querySelector('#turno-global-feedback'), `Error generando el resumen: ${e.message}`);
    console.error('Error en mostrarResumenCorteDeCaja:', e);
  }
}

export function imprimirCorteCajaAdaptable(config, movimientos, ingresos, egresos, balance, ingresosPorMetodo, egresosPorMetodo, balancesPorMetodo, usuarioNombre, fechaCierre, montoApertura = 0, valoresReales = null) {
  const tamano = (config?.tamano_papel || '').toLowerCase();
  const esTermica = tamano === '58mm' || tamano === '80mm';
  const widthPage = tamano === '58mm' ? '58mm' : (tamano === '80mm' ? '78mm' : '100%');
  const fontSize = tamano === '58mm' ? '10px' : (tamano === '80mm' ? '11px' : '12px');

  const logoUrl = config?.mostrar_logo !== false && config?.logo_url ? config.logo_url : null;
  const hotelNombre = config?.nombre_hotel || 'Hotel';
  const direccion = config?.direccion_fiscal || '';
  const nit = config?.nit_rut || '';
  const pie = config?.pie_ticket || '';

  let alertaHtml = '';
  if (valoresReales) {
    let totalDeclarado = 0;
    Object.values(valoresReales).forEach((val) => {
      totalDeclarado += val;
    });

    const diferencia = totalDeclarado - balance;

    if (Math.abs(diferencia) > 1) {
      const esFaltante = diferencia < 0;
      const tipo = esFaltante ? 'FALTANTE (DEUDA)' : 'SOBRANTE';
      const borde = esFaltante ? '2px dashed black' : '1px solid black';

      alertaHtml = `
        <div style="margin: 10px 0; padding: 8px; border: ${borde}; text-align: center;">
          <div style="font-weight: bold; font-size: 1.2em;">DESCUADRE DETECTADO</div>
          <div style="margin-top: 4px;">Sistema espera: ${formatCurrency(balance)}</div>
          <div>Cajero entrega: ${formatCurrency(totalDeclarado)}</div>
          <div style="margin-top: 5px; font-weight: bold; font-size: 1.3em;">
            ${tipo}: ${formatCurrency(diferencia)}
          </div>
        </div>
      `;
    }
  }

  const style = `
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

  const headerHtml = `
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

  const totalesHtml = `
    <div class="mb-2">
      <div class="resumen-row"><span>Apertura de caja (base inicial):</span> <span>${formatCurrency(montoApertura)}</span></div>
      <div class="resumen-row"><span>(+) Ingresos del turno:</span> <span>${formatCurrency(ingresos)}</span></div>
      <div class="resumen-row"><span>(-) Egresos del turno:</span> <span>${formatCurrency(egresos)}</span></div>
      <div class="resumen-row"><span>(=) Dinero generado en el turno:</span> <span>${formatCurrency(ingresos - egresos)}</span></div>
      <div class="border-top resumen-row bold" style="font-size: 1.1em;">
        <span>(=) BALANCE TOTAL INCLUYENDO APERTURA:</span> <span>${formatCurrency(balance)}</span>
      </div>
    </div>
  `;

  const listaBalances = Object.entries(balancesPorMetodo).map(([metodo, valor]) => {
    if (valor === 0) return '';
    return `<div class="resumen-row"><span>${metodo}:</span> <span class="bold">${formatCurrency(valor)}</span></div>`;
  }).join('');

  const detalleEntregarHtml = `
    <div class="balance-box">
      <div class="bold text-center border-bottom mb-1">BALANCE TOTAL INCLUYENDO APERTURA</div>
      ${listaBalances || '<div class="text-center italic">Sin movimientos</div>'}
    </div>
  `;

  const filasMovimientos = movimientos.map((movimiento) => {
    const hora = getMovementTimeLabel(movimiento);
    const tipoSigno = movimiento.tipo === 'ingreso' ? '+' : (movimiento.tipo === 'egreso' ? '-' : '*');
    return `<tr><td class="col-hora">${hora}</td><td class="col-tipo">${tipoSigno}</td><td class="col-concepto">${escapeHtml(normalizeLegacyText(movimiento.concepto || 'Sin concepto'))}</td><td class="col-metodo">${escapeHtml(normalizeLegacyText(movimiento.metodos_pago?.nombre || 'N/A'))}</td><td class="col-monto">${formatCurrency(movimiento.monto)}</td></tr>`;
  }).join('');

  const tablaHtml = `<div class="bold mt-2 border-bottom">MOVIMIENTOS</div><table><thead><tr><th class="col-hora">Hora</th><th class="col-tipo">T</th><th class="col-concepto">Concepto</th><th class="col-metodo">Met</th><th class="col-monto">Monto</th></tr></thead><tbody>${filasMovimientos}</tbody></table>`;
  const firmasHtml = '<div class="mt-2" style="margin-top: 30px; display: flex; justify-content: space-between; gap: 20px;"><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Cajero</div><div class="text-center" style="flex: 1; border-top: 1px solid #000; padding-top: 5px;">Firma Supervisor</div></div>';
  const fullHtml = `<html><head><title>Corte de Caja</title><style>${style}</style></head><body><div class="container">${headerHtml}${totalesHtml}${detalleEntregarHtml}${alertaHtml}${tablaHtml}${firmasHtml}${pie ? `<div class="text-center mt-2 border-top" style="font-size:0.8em; padding-top:5px;">${pie}</div>` : ''}</div></body></html>`;

  const previewWindow = window.open('', '_blank', `width=${esTermica ? '400' : '900'},height=700`);
  previewWindow.document.write(fullHtml);
  previewWindow.document.close();
  setTimeout(() => {
    previewWindow.focus();
    previewWindow.print();
  }, 500);
}

export async function popularMetodosPagoSelect({ selectEl, supabase, hotelId }) {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Cargando...</option>';
  const { data, error } = await supabase
    .from('metodos_pago')
    .select('id, nombre')
    .eq('hotel_id', hotelId)
    .eq('activo', true);
  if (error || !data.length) {
    selectEl.innerHTML = '<option value="" disabled>No hay metodos</option>';
  } else {
    selectEl.innerHTML = `<option value="">-- Seleccione --</option>${data.map((metodo) => `<option value="${escapeAttribute(metodo.id || '')}">${escapeHtml(metodo.nombre || 'Sin nombre')}</option>`).join('')}`;
    if (data.length === 1) selectEl.value = data[0].id;
  }
}

export function generarHTMLReporteCierre(
  reporte,
  metodosDePago,
  usuarioNombre,
  fechaCierre,
  movsCaja,
  movsAmenidades,
  movsLenceria,
  movsPrestamos,
  stockAmenidades,
  stockLenceria,
  valoresReales = null,
  resumenOperativo = null
) {
  const {
    totalesPorMetodo,
    totalIngresos,
    totalGastos,
    balanceFinal
  } = calcularTotalesSistemaCierre(reporte, metodosDePago);
  const balanceOperativo = totalIngresos - totalGastos;
  const saldoEsperadoEnCaja = balanceFinal;
  const resumenOperativoSeguro = resumenOperativo || construirResumenOperativoCierre({
    movimientos: movsCaja,
    reporte
  });

  let alertaDescuadreHtml = '';
  if (valoresReales) {
    let totalDeclarado = 0;
    const filasDescuadre = metodosDePago.map((metodo) => {
      const sistema = totalesPorMetodo[metodo.nombre].esperadoArqueo;
      const real = valoresReales[metodo.nombre] || 0;
      totalDeclarado += real;
      const dif = real - sistema;

      if (Math.abs(dif) < 1) return '';

      const color = dif < 0 ? '#dc2626' : '#2563eb';
      const signo = dif > 0 ? '+' : '';
      return `<tr>
        <td style="padding:8px; border-bottom:1px solid #e5e7eb; white-space:nowrap;">${metodo.nombre}</td>
        <td style="padding:8px; border-bottom:1px solid #e5e7eb; text-align:right; white-space:nowrap;">${formatCurrency(sistema)}</td>
        <td style="padding:8px; border-bottom:1px solid #e5e7eb; text-align:right; white-space:nowrap;">${formatCurrency(real)}</td>
        <td style="padding:8px; border-bottom:1px solid #e5e7eb; text-align:right; color:${color}; font-weight:bold; white-space:nowrap;">${signo}${formatCurrency(dif)}</td>
      </tr>`;
    }).join('');

    const diferenciaTotal = totalDeclarado - saldoEsperadoEnCaja;
    if (Math.abs(diferenciaTotal) > 1 || filasDescuadre.trim() !== '') {
      const tituloEstado = diferenciaTotal < 0 ? 'DESCUADRE: FALTANTE DE DINERO' : (diferenciaTotal > 0 ? 'DESCUADRE: SOBRANTE DE DINERO' : 'DETALLE DE DIFERENCIAS');
      const colorFondo = diferenciaTotal < 0 ? '#fef2f2' : '#eff6ff';
      const colorBorde = diferenciaTotal < 0 ? '#f87171' : '#60a5fa';
      const colorTexto = diferenciaTotal < 0 ? '#991b1b' : '#1e40af';

      alertaDescuadreHtml = `
        <div style="background-color: ${colorFondo}; border: 2px dashed ${colorBorde}; padding: 20px; border-radius: 12px; margin-bottom: 24px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <h3 style="color: ${colorTexto}; margin-top: 0; text-align: center; font-size: 18px;">${tituloEstado}</h3>
          <p style="text-align:center; font-size:15px; color: ${colorTexto}; margin-bottom: 16px;">
            Saldo esperado: <strong style="font-size: 16px;">${formatCurrency(saldoEsperadoEnCaja)}</strong><br>
            Cajero declaró: <strong style="font-size: 16px;">${formatCurrency(totalDeclarado)}</strong>
          </p>
          <div style="text-align:center; font-size:22px; font-weight:bold; color:${colorTexto}; margin-bottom:16px; padding: 10px; background: rgba(255,255,255,0.5); border-radius: 8px;">
            Diferencia: ${diferenciaTotal > 0 ? '+' : ''}${formatCurrency(diferenciaTotal)}
          </div>
          <div style="overflow-x:auto; -webkit-overflow-scrolling:touch; border-radius: 8px; border: 1px solid #e5e7eb;">
          <table style="width:100%; font-size:13px; background:white; border-collapse:collapse; text-align: left;">
            <thead>
              <tr style="background:#f8fafc; color:#475569; font-size: 11px; text-transform: uppercase;">
                <th style="padding:10px 8px; border-bottom: 2px solid #e5e7eb; white-space:nowrap;">Método</th>
                <th style="padding:10px 8px; border-bottom: 2px solid #e5e7eb; text-align:right; white-space:nowrap;">Esperado</th>
                <th style="padding:10px 8px; border-bottom: 2px solid #e5e7eb; text-align:right; white-space:nowrap;">Real</th>
                <th style="padding:10px 8px; border-bottom: 2px solid #e5e7eb; text-align:right; white-space:nowrap;">Diferencia</th>
              </tr>
            </thead>
            <tbody>${filasDescuadre}</tbody>
          </table>
          </div>
        </div>`;
    }
  }

  const styles = {
    body: 'font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; background-color: #eef3f8; margin: 0; padding: 12px;',
    container: 'max-width: 800px; width: 100%; margin: 0 auto; background-color: #ffffff; border: 1px solid #dbe4ee; border-radius: 18px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);',
    hero: 'background-color: #0f172a; padding: 22px 16px 18px; color: #ffffff;',
    heroEyebrow: 'font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: #93c5fd; margin-bottom: 10px; font-weight: bold;',
    heroTitle: 'font-size: 24px; line-height: 1.15; margin: 0; font-weight: bold;',
    heroSubtitle: 'font-size: 14px; color: #cbd5e1; margin: 8px 0 0;',
    metaTable: 'width: 100%; margin-top: 16px; border-collapse: collapse;',
    metaLabel: 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #93c5fd;',
    metaValue: 'font-size: 14px; color: #ffffff; font-weight: bold;',
    section: 'padding: 16px 14px 24px;',
    headerDetalle: 'color: #0f172a; font-size: 18px; text-align: left; margin: 28px 0 12px; padding: 0 0 10px; border-bottom: 2px solid #e5e7eb;',
    legacyTableWrap: 'margin-top: 18px; border-radius: 8px; overflow: hidden; background-color: #ffffff;',
    legacyTable: 'width: 100%; border-collapse: collapse; font-size: 13px;',
    legacyTh: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; background-color: #f1f3f5; font-weight: 600; color:#212529;',
    legacyTd: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; color:#333; white-space:nowrap;',
    legacyTdConcepto: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: 500; color:#212529;',
    legacyTdTotal: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #e9ecef; color:#212529; white-space:nowrap;',
    legacyTdTotalConcepto: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: bold; background-color: #e9ecef; color:#212529;',
    compactTable: 'width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px;',
    table: 'width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 13px;',
    th: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; background-color: #f1f3f5; font-weight: 600; color:#212529;',
    td: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; color:#333;',
    tdLeft: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; color:#333;',
    tdConcepto: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: left; font-weight: 500; color:#212529;',
    tdMuted: 'display:block; font-size:11px; color:#6c757d; margin-top:4px; line-height:1.45;',
    tdStrong: 'display:block; font-weight:bold; color:#212529; font-size: 13px;',
    tdHighlight: 'border: 1px solid #dee2e6; padding: 12px 10px; text-align: right; font-weight: bold; background-color: #f8f9fa;',
    summaryTable: 'width: 100%; border-collapse: separate; border-spacing: 0 10px; margin: 0;',
    summaryCell: 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px;',
    summaryLabel: 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.14em; color: #64748b; margin-bottom: 8px; font-weight: bold;',
    summaryValue: 'font-size: 22px; line-height: 1.1; color: #0f172a; font-weight: bold;',
    summaryHint: 'font-size: 12px; color: #64748b; margin-top: 6px; line-height: 1.45;',
    infoBox: 'background:#f8fafc; border:1px solid #dbeafe; color:#1e3a8a; padding:14px 16px; border-radius:12px; margin:18px 0 4px; font-size:13px; line-height:1.6;',
    footer: 'text-align: center; font-size: 12px; color: #94a3b8; margin-top: 28px; padding: 18px 0 0; border-top: 1px solid #e5e7eb;'
  };

  const calcularTotalCategoria = (fila) => Object.values(fila?.pagos || {}).reduce((acc, val) => acc + val, 0);

  const renderSummaryCard = (label, value, hint, color = '#0f172a') => `
    <table role="presentation" style="${styles.summaryTable}">
      <tr>
        <td style="${styles.summaryCell}">
          <div style="${styles.summaryLabel}">${label}</div>
          <div style="${styles.summaryValue}; color:${color};">${value}</div>
          <div style="${styles.summaryHint}">${hint}</div>
        </td>
      </tr>
    </table>
  `;

  const resumenCardsHtml = [
    renderSummaryCard('Apertura', formatCurrency(reporte.apertura), 'Base inicial del turno'),
    renderSummaryCard('Ingresos', formatCurrency(totalIngresos), 'Total facturado en el turno', '#166534'),
    renderSummaryCard('Egresos', formatCurrency(totalGastos), 'Salidas de dinero del turno', '#b91c1c'),
    renderSummaryCard('Dinero generado', formatCurrency(balanceOperativo), 'Ingresos menos egresos', '#2563eb'),
    renderSummaryCard('Balance total incluyendo apertura', formatCurrency(saldoEsperadoEnCaja), 'Apertura mas dinero generado', '#0f766e')
  ].join('');

  const thMetodosResumen = metodosDePago
    .map((metodo) => `<th style="${styles.legacyTh} text-align:right; white-space:nowrap;">${escapeHtml(metodo.nombre)}</th>`)
    .join('');
  const generarCeldasResumen = (fila) => metodosDePago
    .map((metodo) => `<td style="${styles.legacyTd}">${formatCurrency(fila?.pagos?.[metodo.nombre] || 0)}</td>`)
    .join('');
  const tdTotalesIngresosResumen = metodosDePago
    .map((metodo) => `<td style="${styles.legacyTdTotal}">${formatCurrency(totalesPorMetodo[metodo.nombre].ingreso)}</td>`)
    .join('');
  const tdTotalesGastosResumen = metodosDePago
    .map((metodo) => `<td style="${styles.legacyTdTotal} color:#dc2626;">(${formatCurrency(totalesPorMetodo[metodo.nombre].gasto)})</td>`)
    .join('');
  const tdTotalesBalanceResumen = metodosDePago
    .map((metodo) => `<td style="${styles.legacyTdTotal} background-color:#eff6ff;">${formatCurrency(totalesPorMetodo[metodo.nombre].balance)}</td>`)
    .join('');
  const tdTotalesEsperadoResumen = metodosDePago
    .map((metodo) => `<td style="${styles.legacyTdTotal} background-color:#f0fdf4;">${formatCurrency(totalesPorMetodo[metodo.nombre].esperadoArqueo)}</td>`)
    .join('');

  const resumenPrincipalTablaHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Reporte de ingresos y gastos</h2>
    <div style="${styles.legacyTableWrap} overflow-x:auto; -webkit-overflow-scrolling:touch;">
      <table class="report-table" style="${styles.legacyTable}">
        <thead>
          <tr>
            <th style="${styles.legacyTh} white-space:nowrap;">Concepto</th>
            <th style="${styles.legacyTh} text-align:center; white-space:nowrap;">N° Ventas</th>
            <th style="${styles.legacyTh} text-align:center; white-space:nowrap;">Transac.</th>
            ${thMetodosResumen}
            <th style="${styles.legacyTh} text-align:right; white-space:nowrap;">Totales</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="${styles.legacyTdConcepto}">Apertura de caja:</td>
            <td style="${styles.legacyTd} text-align:center;">-</td>
            <td style="${styles.legacyTd} text-align:center;">-</td>
            ${metodosDePago.map((metodo) => `<td style="${styles.legacyTd}">${esMetodoEfectivo(metodo.nombre) ? formatCurrency(reporte.apertura) : '$ 0'}</td>`).join('')}
            <td style="${styles.legacyTdTotal}">${formatCurrency(reporte.apertura)}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdConcepto}">HABITACIONES:</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.habitaciones?.ventas || 0))}</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.habitaciones?.transacciones || 0))}</td>
            ${generarCeldasResumen(reporte.habitaciones)}
            <td style="${styles.legacyTdTotal}">${formatCurrency(calcularTotalCategoria(reporte.habitaciones))}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdConcepto}">COCINA:</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.cocina?.ventas || 0))}</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.cocina?.transacciones || 0))}</td>
            ${generarCeldasResumen(reporte.cocina)}
            <td style="${styles.legacyTdTotal}">${formatCurrency(calcularTotalCategoria(reporte.cocina))}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdConcepto}">TIENDA:</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.tienda?.ventas || 0))}</td>
            <td style="${styles.legacyTd} text-align:center;">${escapeHtml(String(reporte.tienda?.transacciones || 0))}</td>
            ${generarCeldasResumen(reporte.tienda)}
            <td style="${styles.legacyTdTotal}">${formatCurrency(calcularTotalCategoria(reporte.tienda))}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdTotalConcepto}">Ingresos del turno:</td>
            <td style="${styles.legacyTdTotal} text-align:center;">${escapeHtml(String((reporte.habitaciones?.ventas || 0) + (reporte.cocina?.ventas || 0) + (reporte.tienda?.ventas || 0) + (reporte.propinas?.ventas || 0)))}</td>
            <td style="${styles.legacyTdTotal} text-align:center;">${escapeHtml(String((reporte.habitaciones?.transacciones || 0) + (reporte.cocina?.transacciones || 0) + (reporte.tienda?.transacciones || 0) + (reporte.propinas?.transacciones || 0)))}</td>
            ${tdTotalesIngresosResumen}
            <td style="${styles.legacyTdTotal}">${formatCurrency(totalIngresos)}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdTotalConcepto}">Egresos del turno:</td>
            <td style="${styles.legacyTdTotal} text-align:center;">-</td>
            <td style="${styles.legacyTdTotal} text-align:center;">${escapeHtml(String(reporte.gastos?.transacciones || 0))}</td>
            ${tdTotalesGastosResumen}
            <td style="${styles.legacyTdTotal} color:red;">(${formatCurrency(totalGastos)})</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdTotalConcepto}">Dinero generado en el turno:</td>
            <td style="${styles.legacyTdTotal} text-align:center;">-</td>
            <td style="${styles.legacyTdTotal} text-align:center;">${escapeHtml(String(((reporte.habitaciones?.transacciones || 0) + (reporte.cocina?.transacciones || 0) + (reporte.tienda?.transacciones || 0) + (reporte.propinas?.transacciones || 0) + (reporte.gastos?.transacciones || 0))))}</td>
            ${tdTotalesBalanceResumen}
            <td style="${styles.legacyTdTotal} background-color:#007bff; color:white;">${formatCurrency(balanceOperativo)}</td>
          </tr>
          <tr>
            <td style="${styles.legacyTdTotalConcepto}">Balance total incluyendo apertura:</td>
            <td style="${styles.legacyTdTotal} text-align:center;">-</td>
            <td style="${styles.legacyTdTotal} text-align:center;">-</td>
            ${tdTotalesEsperadoResumen}
            <td style="${styles.legacyTdTotal} background-color:#0f766e; color:white;">${formatCurrency(saldoEsperadoEnCaja)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;



  const resumenOperativoHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Resumen operativo del turno</h2>
    <table class="report-table" style="${styles.compactTable}">
      <tbody>
        <tr>
          <td style="${styles.tdLeft}">
            <span style="${styles.tdStrong}">Habitaciones alquiladas</span>
            <span style="${styles.tdMuted}">${resumenOperativoSeguro.habitacionesCobros || 0} cobros relacionados con alojamiento.</span>
          </td>
          <td style="${styles.tdHighlight}">${escapeHtml(String(resumenOperativoSeguro.habitacionesAlquiladas || 0))}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}">
            <span style="${styles.tdStrong}">Tienda</span>
            <span style="${styles.tdMuted}">${escapeHtml(String(resumenOperativoSeguro.tiendaVentas || 0))} ventas · ${escapeHtml(String(resumenOperativoSeguro.tiendaUnidades || 0))} unidades</span>
          </td>
          <td style="${styles.tdHighlight}">${formatCurrency(resumenOperativoSeguro.tiendaIngresos || 0)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}">
            <span style="${styles.tdStrong}">Restaurante</span>
            <span style="${styles.tdMuted}">${escapeHtml(String(resumenOperativoSeguro.restauranteVentas || 0))} ventas · ${escapeHtml(String(resumenOperativoSeguro.restauranteUnidades || 0))} items</span>
          </td>
          <td style="${styles.tdHighlight}">${formatCurrency(resumenOperativoSeguro.restauranteIngresos || 0)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}">
            <span style="${styles.tdStrong}">Servicios y extensiones</span>
            <span style="${styles.tdMuted}">${escapeHtml(String(resumenOperativoSeguro.serviciosUnidades || 0))} registros aplicados.</span>
          </td>
          <td style="${styles.tdHighlight}">${formatCurrency(resumenOperativoSeguro.serviciosIngresos || 0)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}">
            <span style="${styles.tdStrong}">Transacciones registradas</span>
            <span style="${styles.tdMuted}">${escapeHtml(String(resumenOperativoSeguro.ingresosRegistrados || 0))} ingresos · ${escapeHtml(String(resumenOperativoSeguro.egresosRegistrados || 0))} egresos · ${escapeHtml(String(resumenOperativoSeguro.metodosUsados || 0))} metodos usados</span>
          </td>
          <td style="${styles.tdHighlight}">${escapeHtml(String((resumenOperativoSeguro.ingresosRegistrados || 0) + (resumenOperativoSeguro.egresosRegistrados || 0)))}</td>
        </tr>
      </tbody>
    </table>
  `;

  const resumenFinancieroHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Resumen financiero del turno</h2>
    <table class="report-table" style="${styles.compactTable}">
      <tbody>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Apertura de caja (base inicial)</span></td>
          <td style="${styles.tdHighlight}">${formatCurrency(reporte.apertura)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Habitaciones</span></td>
          <td style="${styles.td}">${formatCurrency(calcularTotalCategoria(reporte.habitaciones))}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Tienda</span></td>
          <td style="${styles.td}">${formatCurrency(calcularTotalCategoria(reporte.tienda))}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Restaurante / cocina</span></td>
          <td style="${styles.td}">${formatCurrency(calcularTotalCategoria(reporte.cocina))}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Propinas</span></td>
          <td style="${styles.td}">${formatCurrency(calcularTotalCategoria(reporte.propinas))}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Ingresos del turno</span></td>
          <td style="${styles.tdHighlight}">${formatCurrency(totalIngresos)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Egresos del turno</span></td>
          <td style="${styles.tdHighlight}; color:#b91c1c;">-${formatCurrency(totalGastos)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Dinero generado en el turno</span></td>
          <td style="${styles.tdHighlight}; color:#2563eb;">${formatCurrency(balanceOperativo)}</td>
        </tr>
        <tr>
          <td style="${styles.tdLeft}"><span style="${styles.tdStrong}">Balance total incluyendo apertura</span></td>
          <td style="${styles.tdHighlight}; color:#0f766e;">${formatCurrency(saldoEsperadoEnCaja)}</td>
        </tr>
      </tbody>
    </table>
  `;

  const metodoRowsHtml = metodosDePago.map((metodo) => {
    const totalMetodo = totalesPorMetodo[metodo.nombre];
    return `
      <tr>
        <td style="${styles.tdLeft}">
          <span style="${styles.tdStrong}">${escapeHtml(metodo.nombre)}</span>
          <span style="${styles.tdMuted}">
            Ingresos: ${formatCurrency(totalMetodo.ingreso)}<br>
            Egresos: ${formatCurrency(totalMetodo.gasto)}<br>
            Neto del turno: ${formatCurrency(totalMetodo.balance)}
          </span>
        </td>
        <td style="${styles.tdHighlight}">${formatCurrency(totalMetodo.esperadoArqueo)}</td>
      </tr>
    `;
  }).join('');

  const desgloseMetodosHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Desglose por metodo de pago</h2>
    <table class="report-table" style="${styles.compactTable}">
      <thead>
        <tr>
          <th style="${styles.th}">Metodo</th>
          <th style="${styles.th}; text-align:right;">Saldo esperado</th>
        </tr>
      </thead>
      <tbody>${metodoRowsHtml}</tbody>
    </table>
  `;

  const detalleCajaHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Detalle de Movimientos de Caja</h2>
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch; border:1px solid #e5e7eb; border-radius:8px;">
    <table class="report-table" style="${styles.compactTable} border:none; margin-top:0;">
      <thead>
        <tr>
          <th style="${styles.th}">Movimiento</th>
          <th style="${styles.th}; text-align:right; white-space:nowrap;">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${(movsCaja && movsCaja.length > 0) ? movsCaja.map((movimiento) => `
          <tr>
            <td style="${styles.tdLeft}">
              <span style="${styles.tdStrong}">${formatMovementDateTime(movimiento)}</span>
              <strong style="display:block; color:#0f172a; word-break:break-word;">${escapeHtml(normalizeLegacyText(movimiento.concepto || 'Sin concepto'))}</strong>
              <span style="display:block; font-size:10px; color:#64748b; margin-top:4px; word-break:break-word;">${escapeHtml(normalizeLegacyText(movimiento.tipo || 'N/A'))} · ${escapeHtml(normalizeLegacyText(movimiento.metodos_pago?.nombre || 'N/A'))}</span>
            </td>
            <td style="${styles.td} font-weight:bold; color:${movimiento.tipo === 'ingreso' ? '#166534' : (movimiento.tipo === 'egreso' ? '#991b1b' : 'inherit')}; white-space:nowrap; vertical-align:middle;">
              ${formatCurrency(movimiento.monto)}
            </td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay movimientos de caja.</td></tr>`}
      </tbody>
    </table>
    </div>
  `;

  const amenidadesAgrupadas = {};
  if (movsAmenidades && movsAmenidades.length > 0) {
    movsAmenidades.forEach((movimiento) => {
      const habitacionNombre = movimiento.habitaciones?.nombre || 'N/A (Registro Manual)';
      const itemNombre = movimiento.amenidades_inventario?.nombre_item || 'N/A';
      const cantidad = movimiento.cantidad_usada;
      if (!amenidadesAgrupadas[habitacionNombre]) amenidadesAgrupadas[habitacionNombre] = [];
      amenidadesAgrupadas[habitacionNombre].push(`${itemNombre} (<b>${cantidad}</b>)`);
    });
  }

  const detalleAmenidadesHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Registro de Amenidades (Agrupado por Habitacion)</h2>
    <table class="report-table" style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulos entregados en el turno</th>
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

  const detalleLenceriaHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Registro de Lenceria (Ropa de cama)</h2>
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
    <table class="report-table" style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th} white-space:nowrap;">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th} white-space:nowrap; text-align:center;">Cant.</th>
        </tr>
      </thead>
      <tbody>
        ${(movsLenceria && movsLenceria.length > 0) ? movsLenceria.map((movimiento) => `
          <tr>
            <td style="${styles.td} text-align:left; white-space:nowrap;">${formatDateTime(movimiento.fecha_uso)}</td>
            <td style="${styles.tdConcepto} word-break:break-word;">${movimiento.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto} word-break:break-word;">${movimiento.inventario_lenceria?.nombre_item || 'N/A'}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${movimiento.cantidad_usada}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de lenceria.</td></tr>`}
      </tbody>
    </table>
    </div>
  `;

  const detallePrestamosHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Registro de Prestamos</h2>
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
    <table class="report-table" style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th} white-space:nowrap;">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Accion</th>
        </tr>
      </thead>
      <tbody>
        ${(movsPrestamos && movsPrestamos.length > 0) ? movsPrestamos.map((movimiento) => `
          <tr>
            <td style="${styles.td} text-align:left; white-space:nowrap;">${formatDateTime(movimiento.fecha_accion)}</td>
            <td style="${styles.tdConcepto} word-break:break-word;">${movimiento.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto} word-break:break-word;">${movimiento.articulo_nombre}</td>
            <td style="${styles.tdConcepto} word-break:break-word;">${movimiento.accion}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de prestamos.</td></tr>`}
      </tbody>
    </table>
    </div>
  `;

  const stockAmenidadesHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Stock Actual de Amenidades</h2>
    <table class="report-table" style="${styles.table}">
      <thead><tr><th style="${styles.th}">Articulo</th><th style="${styles.th}">Stock Actual</th></tr></thead>
      <tbody>
        ${(stockAmenidades && stockAmenidades.length > 0) ? stockAmenidades.map((item) => `
          <tr>
            <td style="${styles.tdConcepto}">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_actual}</td>
          </tr>
        `).join('') : `<tr><td colspan="2" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
  `;

  const stockLenceriaHtml = `
    <h2 class="report-heading" style="${styles.headerDetalle}">Stock Actual de Lenceria</h2>
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch;">
    <table class="report-table" style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th} text-align:center; white-space:nowrap;">Limpio</th>
          <th style="${styles.th} text-align:center; white-space:nowrap;">Lavanderia</th>
          <th style="${styles.th} text-align:center; white-space:nowrap;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${(stockLenceria && stockLenceria.length > 0) ? stockLenceria.map((item) => `
          <tr>
            <td style="${styles.tdConcepto} word-break:break-word;">${item.nombre_item}</td>
            <td style="${styles.td} text-align:center; font-weight:bold; color:#166534;">${item.stock_limpio_almacen || 0}</td>
            <td style="${styles.td} text-align:center; color:#CA8A04;">${item.stock_en_lavanderia || 0}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${item.stock_total || 0}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay datos de stock.</td></tr>`}
      </tbody>
    </table>
    </div>
  `;

  return `
    <html lang="es">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Cierre de Caja</title>
        <style>
          * { box-sizing: border-box; }
          .mobile-only { display: none; max-height: 0; overflow: hidden; }
          div.desktop-only { display: block; }
          .scroll-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; width: 100%; }
          .report-table { width: 100%; border-collapse: collapse; }
          .report-table th, .report-table td { word-wrap: break-word; }
          @media only screen and (max-width: 600px) {
            body {
              margin: 0 !important;
              padding: 0 !important;
            }
            .report-container {
              display: block !important;
              width: 100% !important;
              max-width: 100% !important;
              min-width: 0 !important;
              border-radius: 0 !important;
              border: none !important;
              box-shadow: none !important;
            }
            .report-hero {
              padding: 16px 10px 14px !important;
            }
            .report-hero-title {
              font-size: 18px !important;
            }
            .report-section {
              padding: 10px 4px 14px !important;
            }
            .report-heading {
              font-size: 14px !important;
              margin: 16px 0 8px !important;
            }
            .report-table {
              width: 100% !important;
              table-layout: fixed !important;
            }
            .report-table th,
            .report-table td {
              padding: 4px 1px !important;
              font-size: 8px !important;
              white-space: normal !important;
              word-break: break-all !important;
              overflow-wrap: break-word !important;
            }
            .desktop-only {
              display: none !important;
              max-height: 0 !important;
              overflow: hidden !important;
              mso-hide: all !important;
            }
            table.mobile-only {
              display: table !important;
              width: 100% !important;
              max-height: none !important;
              overflow: visible !important;
            }
            div.mobile-only {
              display: block !important;
              width: 100% !important;
              max-height: none !important;
              overflow: visible !important;
            }
          }
        </style>
      </head>
      <body style="${styles.body}">
        <div class="report-container" style="${styles.container}">
          <div class="report-hero" style="${styles.hero}">
            <div style="${styles.heroEyebrow}">Gestion de Hotel</div>
            <h1 class="report-hero-title" style="${styles.heroTitle}">Cierre de Caja</h1>
            <p style="${styles.heroSubtitle}">Resumen financiero, movimientos y control de entregas del turno.</p>
            <table role="presentation" style="${styles.metaTable}">
              <tr>
                <td style="vertical-align:top; padding:0 0 12px;">
                  <div style="${styles.metaLabel}">Realizado por</div>
                  <div style="${styles.metaValue}">${usuarioNombre}</div>
                </td>
              </tr>
              <tr>
                <td style="vertical-align:top; padding:0;">
                  <div style="${styles.metaLabel}">Fecha de cierre</div>
                  <div style="${styles.metaValue}">${fechaCierre}</div>
                </td>
              </tr>
            </table>
          </div>

          <div class="report-section" style="${styles.section}">
          ${alertaDescuadreHtml}
          ${resumenPrincipalTablaHtml}
          ${resumenOperativoHtml}
          ${resumenFinancieroHtml}
          ${desgloseMetodosHtml}
          ${detalleCajaHtml}
          ${detalleAmenidadesHtml}
          ${detalleLenceriaHtml}
          ${detallePrestamosHtml}
          ${stockAmenidadesHtml}
          ${stockLenceriaHtml}

            <div style="${styles.footer}">Este es un reporte automatico generado por Gestion de Hotel.</div>
          </div>
        </div>
      </body>
    </html>`;
}

export async function enviarReporteCierreCaja({
  asunto,
  htmlReporte,
  supabase,
  hotelId,
  fallbackEmail = ''
}) {
  const { data, error } = await supabase.functions.invoke('send-cash-close-report', {
    body: {
      hotelId,
      subject: asunto,
      html: htmlReporte,
      fallbackEmail
    }
  });
  if (error || !data?.sent) {
    return {
      sent: false,
      reason: data?.reason || 'request_failed'
    };
  }
  return { sent: true };
}
