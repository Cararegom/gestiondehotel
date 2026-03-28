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
  valoresReales = null
) {
  const {
    totalesPorMetodo,
    totalIngresos,
    totalGastos,
    balanceFinal
  } = calcularTotalesSistemaCierre(reporte, metodosDePago);
  const balanceOperativo = totalIngresos - totalGastos;
  const saldoEsperadoEnCaja = balanceFinal;

  let alertaDescuadreHtml = '';
  if (valoresReales) {
    let totalDeclarado = 0;
    const filasDescuadre = metodosDePago.map((metodo) => {
      const sistema = totalesPorMetodo[metodo.nombre].esperadoArqueo;
      const real = valoresReales[metodo.nombre] || 0;
      totalDeclarado += real;
      const dif = real - sistema;

      if (Math.abs(dif) < 1) return '';

      const color = dif < 0 ? 'red' : 'blue';
      const signo = dif > 0 ? '+' : '';
      return `<tr>
        <td style="padding:5px; border-bottom:1px solid #ddd;">${metodo.nombre}</td>
        <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(sistema)}</td>
        <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right;">${formatCurrency(real)}</td>
        <td style="padding:5px; border-bottom:1px solid #ddd; text-align:right; color:${color}; font-weight:bold;">${signo}${formatCurrency(dif)}</td>
      </tr>`;
    }).join('');

    const diferenciaTotal = totalDeclarado - saldoEsperadoEnCaja;
    if (Math.abs(diferenciaTotal) > 1 || filasDescuadre.trim() !== '') {
      const tituloEstado = diferenciaTotal < 0 ? 'DESCUADRE: FALTANTE DE DINERO' : (diferenciaTotal > 0 ? 'DESCUADRE: SOBRANTE DE DINERO' : 'DETALLE DE DIFERENCIAS');
      const colorFondo = diferenciaTotal < 0 ? '#fee2e2' : '#dbeafe';
      const colorTexto = diferenciaTotal < 0 ? '#991b1b' : '#1e40af';

      alertaDescuadreHtml = `
        <div style="background-color: ${colorFondo}; border: 2px dashed ${colorTexto}; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="color: ${colorTexto}; margin-top: 0; text-align: center;">${tituloEstado}</h3>
          <p style="text-align:center; font-size:16px;">
            El saldo esperado en caja era <b>${formatCurrency(saldoEsperadoEnCaja)}</b>, pero el cajero declaro tener <b>${formatCurrency(totalDeclarado)}</b>.
          </p>
          <div style="text-align:center; font-size:20px; font-weight:bold; color:${colorTexto}; margin-bottom:10px;">
            Diferencia Total: ${diferenciaTotal > 0 ? '+' : ''}${formatCurrency(diferenciaTotal)}
          </div>
          <table style="width:100%; font-size:13px; background:white; border-collapse:collapse;">
            <thead>
              <tr style="background:#f3f4f6; color:#555;">
                <th style="padding:5px; text-align:left;">Metodo</th>
                <th style="padding:5px; text-align:right;">Sistema (Esperado)</th>
                <th style="padding:5px; text-align:right;">Real (Declarado)</th>
                <th style="padding:5px; text-align:right;">Diferencia</th>
              </tr>
            </thead>
            <tbody>${filasDescuadre}</tbody>
          </table>
        </div>`;
    }
  }

  const styles = {
    body: 'font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #1f2937; background-color: #eef3f8; margin: 0; padding: 24px;',
    container: 'max-width: 1100px; width: 100%; margin: 0 auto; background-color: #ffffff; border: 1px solid #dbe4ee; border-radius: 18px; overflow: hidden; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);',
    hero: 'background-color: #0f172a; padding: 28px 32px 22px; color: #ffffff;',
    heroEyebrow: 'font-size: 11px; letter-spacing: 0.28em; text-transform: uppercase; color: #93c5fd; margin-bottom: 10px; font-weight: bold;',
    heroTitle: 'font-size: 30px; line-height: 1.15; margin: 0; font-weight: bold;',
    heroSubtitle: 'font-size: 14px; color: #cbd5e1; margin: 8px 0 0;',
    metaTable: 'width: 100%; margin-top: 18px; border-collapse: separate; border-spacing: 0 10px;',
    metaLabel: 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: #93c5fd;',
    metaValue: 'font-size: 14px; color: #ffffff; font-weight: bold;',
    section: 'padding: 26px 28px 30px;',
    headerDetalle: 'color: #0f172a; font-size: 18px; text-align: left; margin: 34px 0 14px; padding: 0 0 10px; border-bottom: 2px solid #e5e7eb;',
    table: 'width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 13px; border: 1px solid #e5e7eb; overflow: hidden;',
    th: 'border: 1px solid #e5e7eb; padding: 12px 10px; text-align: left; background-color: #f8fafc; color: #334155; font-weight: 700;',
    td: 'border: 1px solid #e5e7eb; padding: 11px 10px; text-align: right; background-color: #ffffff;',
    tdConcepto: 'border: 1px solid #e5e7eb; padding: 11px 10px; text-align: left; font-weight: 500; background-color: #ffffff;',
    tdTotal: 'border: 1px solid #dbeafe; padding: 11px 10px; text-align: right; font-weight: bold; background-color: #f8fbff;',
    tdTotalConcepto: 'border: 1px solid #dbeafe; padding: 11px 10px; text-align: left; font-weight: bold; background-color: #f8fbff;',
    summaryTable: 'width: 100%; border-collapse: separate; border-spacing: 10px; margin: 20px 0 0;',
    summaryCell: 'background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px;',
    summaryLabel: 'font-size: 11px; text-transform: uppercase; letter-spacing: 0.16em; color: #64748b; margin-bottom: 10px; font-weight: bold;',
    summaryValue: 'font-size: 24px; line-height: 1.1; color: #0f172a; font-weight: bold;',
    summaryHint: 'font-size: 12px; color: #64748b; margin-top: 6px;',
    infoBox: 'background:#f8fafc; border:1px solid #dbeafe; color:#1e3a8a; padding:14px 16px; border-radius:12px; margin:22px 0 6px; font-size:13px; line-height:1.6;',
    footer: 'text-align: center; font-size: 12px; color: #94a3b8; margin-top: 30px; padding: 18px 0 0; border-top: 1px solid #e5e7eb;'
  };

  const thMetodos = metodosDePago.map((metodo) => `<th style="${styles.th} text-align:right;">${metodo.nombre}</th>`).join('');
  const generarCeldasFila = (fila) => metodosDePago.map((metodo) => `<td style="${styles.td}">${formatCurrency(fila.pagos[metodo.nombre] || 0)}</td>`).join('');
  const calcularTotalCategoria = (fila) => Object.values(fila?.pagos || {}).reduce((acc, val) => acc + val, 0);
  const tdTotalesIngresos = metodosDePago.map((metodo) => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[metodo.nombre].ingreso)}</td>`).join('');
  const tdTotalesGastos = metodosDePago.map((metodo) => `<td style="${styles.tdTotal} color:red;">(${formatCurrency(totalesPorMetodo[metodo.nombre].gasto)})</td>`).join('');
  const tdTotalesBalanceOperativo = metodosDePago.map((metodo) => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[metodo.nombre].balance)}</td>`).join('');
  const tdTotalesEsperadoCaja = metodosDePago.map((metodo) => `<td style="${styles.tdTotal}">${formatCurrency(totalesPorMetodo[metodo.nombre].esperadoArqueo)}</td>`).join('');

  const resumenCardsHtml = `
    <table role="presentation" style="${styles.summaryTable}">
      <tr>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Apertura</div>
          <div style="${styles.summaryValue}">${formatCurrency(reporte.apertura)}</div>
          <div style="${styles.summaryHint}">Base inicial del turno</div>
        </td>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Ingresos</div>
          <div style="${styles.summaryValue}; color:#166534;">${formatCurrency(totalIngresos)}</div>
          <div style="${styles.summaryHint}">Total facturado en el turno</div>
        </td>
        <td style="${styles.summaryCell}; width: 33.33%;">
          <div style="${styles.summaryLabel}">Egresos</div>
          <div style="${styles.summaryValue}; color:#b91c1c;">${formatCurrency(totalGastos)}</div>
          <div style="${styles.summaryHint}">Salidas de dinero del turno</div>
        </td>
      </tr>
    </table>
    <table role="presentation" style="${styles.summaryTable}; margin-top: 0;">
      <tr>
        <td style="${styles.summaryCell}; width: 50%;">
          <div style="${styles.summaryLabel}">Dinero generado</div>
          <div style="${styles.summaryValue}; color:#2563eb;">${formatCurrency(balanceOperativo)}</div>
          <div style="${styles.summaryHint}">Ingresos menos egresos</div>
        </td>
        <td style="${styles.summaryCell}; width: 50%;">
          <div style="${styles.summaryLabel}">Total esperado en caja</div>
          <div style="${styles.summaryValue}; color:#0f766e;">${formatCurrency(saldoEsperadoEnCaja)}</div>
          <div style="${styles.summaryHint}">Apertura mas dinero generado</div>
        </td>
      </tr>
    </table>
  `;

  const detalleCajaHtml = `
    <h2 style="${styles.headerDetalle}">Detalle de Movimientos de Caja</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Tipo</th>
          <th style="${styles.th}">Concepto</th>
          <th style="${styles.th}">Metodo</th>
          <th style="${styles.th}">Monto</th>
        </tr>
      </thead>
      <tbody>
        ${(movsCaja && movsCaja.length > 0) ? movsCaja.map((movimiento) => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatMovementDateTime(movimiento)}</td>
            <td style="${styles.tdConcepto}">${escapeHtml(normalizeLegacyText(movimiento.tipo || 'N/A'))}</td>
            <td style="${styles.tdConcepto}">${escapeHtml(normalizeLegacyText(movimiento.concepto || 'Sin concepto'))}</td>
            <td style="${styles.tdConcepto}">${escapeHtml(normalizeLegacyText(movimiento.metodos_pago?.nombre || 'N/A'))}</td>
            <td style="${styles.td} font-weight:bold; color:${movimiento.tipo === 'ingreso' ? 'green' : (movimiento.tipo === 'egreso' ? 'red' : 'inherit')};">
              ${formatCurrency(movimiento.monto)}
            </td>
          </tr>
        `).join('') : `<tr><td colspan="5" style="${styles.td} text-align:center;">No hay movimientos de caja.</td></tr>`}
      </tbody>
    </table>
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
    <h2 style="${styles.headerDetalle}">Registro de Amenidades (Agrupado por Habitacion)</h2>
    <table style="${styles.table}">
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
    <h2 style="${styles.headerDetalle}">Registro de Lenceria (Ropa de cama)</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Cantidad</th>
        </tr>
      </thead>
      <tbody>
        ${(movsLenceria && movsLenceria.length > 0) ? movsLenceria.map((movimiento) => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(movimiento.fecha_uso)}</td>
            <td style="${styles.tdConcepto}">${movimiento.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${movimiento.inventario_lenceria?.nombre_item || 'N/A'}</td>
            <td style="${styles.td} text-align:center; font-weight:bold;">${movimiento.cantidad_usada}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de lenceria.</td></tr>`}
      </tbody>
    </table>
  `;

  const detallePrestamosHtml = `
    <h2 style="${styles.headerDetalle}">Registro de Prestamos</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Fecha</th>
          <th style="${styles.th}">Habitacion</th>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Accion</th>
        </tr>
      </thead>
      <tbody>
        ${(movsPrestamos && movsPrestamos.length > 0) ? movsPrestamos.map((movimiento) => `
          <tr>
            <td style="${styles.td} text-align:left; min-width: 130px;">${formatDateTime(movimiento.fecha_accion)}</td>
            <td style="${styles.tdConcepto}">${movimiento.habitaciones?.nombre || 'N/A'}</td>
            <td style="${styles.tdConcepto}">${movimiento.articulo_nombre}</td>
            <td style="${styles.tdConcepto}">${movimiento.accion}</td>
          </tr>
        `).join('') : `<tr><td colspan="4" style="${styles.td} text-align:center;">No hay registros de prestamos.</td></tr>`}
      </tbody>
    </table>
  `;

  const stockAmenidadesHtml = `
    <h2 style="${styles.headerDetalle}">Stock Actual de Amenidades</h2>
    <table style="${styles.table}">
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
    <h2 style="${styles.headerDetalle}">Stock Actual de Lenceria</h2>
    <table style="${styles.table}">
      <thead>
        <tr>
          <th style="${styles.th}">Articulo</th>
          <th style="${styles.th}">Limpio (Almacen)</th>
          <th style="${styles.th}">En Lavanderia</th>
          <th style="${styles.th}">Stock Total</th>
        </tr>
      </thead>
      <tbody>
        ${(stockLenceria && stockLenceria.length > 0) ? stockLenceria.map((item) => `
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

  return `
    <body style="${styles.body}">
      <div style="${styles.container}">
        <div style="${styles.hero}">
          <div style="${styles.heroEyebrow}">Gestion de Hotel</div>
          <h1 style="${styles.heroTitle}">Cierre de Caja</h1>
          <p style="${styles.heroSubtitle}">Resumen financiero, movimientos y control de entregas del turno.</p>
          <table role="presentation" style="${styles.metaTable}">
            <tr>
              <td style="width:50%; vertical-align:top;">
                <div style="${styles.metaLabel}">Realizado por</div>
                <div style="${styles.metaValue}">${usuarioNombre}</div>
              </td>
              <td style="width:50%; vertical-align:top; text-align:right;">
                <div style="${styles.metaLabel}">Fecha de cierre</div>
                <div style="${styles.metaValue}">${fechaCierre}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="${styles.section}">
          ${resumenCardsHtml}
          <div style="${styles.infoBox}">
            <strong>Como leer este reporte:</strong> la <strong>apertura de caja</strong> es la base inicial del turno. El <strong>dinero generado en el turno</strong> muestra solo ingresos menos egresos. El <strong>balance total incluyendo apertura</strong> incluye la apertura mas el dinero generado en el turno.
          </div>
          ${alertaDescuadreHtml}
          <table style="${styles.table}">
            <thead>
              <tr>
                <th style="${styles.th}">Concepto</th>
                <th style="${styles.th}">No. Ventas</th>
                <th style="${styles.th}">Transac.</th>
                ${thMetodos}
                <th style="${styles.th} text-align:right;">Totales</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style="${styles.tdConcepto}">Apertura de caja (base inicial):</td>
                <td style="${styles.td} text-align:center;">-</td>
                <td style="${styles.td} text-align:center;">-</td>
                ${metodosDePago.map(() => `<td style="${styles.td}">-</td>`).join('')}
                <td style="${styles.tdTotal}">${formatCurrency(reporte.apertura)}</td>
              </tr>
              <tr>
                <td style="${styles.tdConcepto}">HABITACIONES:</td>
                <td style="${styles.td} text-align:center;">${reporte.habitaciones.ventas}</td>
                <td style="${styles.td} text-align:center;">${reporte.habitaciones.transacciones}</td>
                ${generarCeldasFila(reporte.habitaciones)}
                <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.habitaciones))}</td>
              </tr>
              <tr>
                <td style="${styles.tdConcepto}">COCINA:</td>
                <td style="${styles.td} text-align:center;">${reporte.cocina.ventas}</td>
                <td style="${styles.td} text-align:center;">${reporte.cocina.transacciones}</td>
                ${generarCeldasFila(reporte.cocina)}
                <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.cocina))}</td>
              </tr>
              <tr>
                <td style="${styles.tdConcepto}">TIENDA:</td>
                <td style="${styles.td} text-align:center;">${reporte.tienda.ventas}</td>
                <td style="${styles.td} text-align:center;">${reporte.tienda.transacciones}</td>
                ${generarCeldasFila(reporte.tienda)}
                <td style="${styles.tdTotal}">${formatCurrency(calcularTotalCategoria(reporte.tienda))}</td>
              </tr>
              <tr>
                <td style="${styles.tdTotalConcepto}">Ingresos del turno:</td>
                <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.ventas + reporte.cocina.ventas + reporte.tienda.ventas}</td>
                <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones}</td>
                ${tdTotalesIngresos}
                <td style="${styles.tdTotal}">${formatCurrency(totalIngresos)}</td>
              </tr>
              <tr>
                <td style="${styles.tdTotalConcepto}">Egresos del turno:</td>
                <td style="${styles.tdTotal} text-align:center;">-</td>
                <td style="${styles.tdTotal} text-align:center;">${reporte.gastos.transacciones}</td>
                ${tdTotalesGastos}
                <td style="${styles.tdTotal} color:red;">(${formatCurrency(totalGastos)})</td>
              </tr>
              <tr>
                <td style="${styles.tdTotalConcepto}">Dinero generado en el turno:</td>
                <td style="${styles.tdTotal} text-align:center;">-</td>
                <td style="${styles.tdTotal} text-align:center;">${reporte.habitaciones.transacciones + reporte.cocina.transacciones + reporte.tienda.transacciones + reporte.gastos.transacciones}</td>
                ${tdTotalesBalanceOperativo}
                <td style="${styles.tdTotal} background-color:#007bff; color:white;">${formatCurrency(balanceOperativo)}</td>
              </tr>
              <tr>
                <td style="${styles.tdTotalConcepto}">Balance total incluyendo apertura:</td>
                <td style="${styles.tdTotal} text-align:center;">-</td>
                <td style="${styles.tdTotal} text-align:center;">-</td>
                ${tdTotalesEsperadoCaja}
                <td style="${styles.tdTotal} background-color:#0f766e; color:white;">${formatCurrency(saldoEsperadoEnCaja)}</td>
              </tr>
            </tbody>
          </table>

          ${detalleCajaHtml}
          ${detalleAmenidadesHtml}
          ${detalleLenceriaHtml}
          ${detallePrestamosHtml}
          ${stockAmenidadesHtml}
          ${stockLenceriaHtml}

          <div style="${styles.footer}">Este es un reporte automatico generado por Gestion de Hotel.</div>
        </div>
      </div>
    </body>`;
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
