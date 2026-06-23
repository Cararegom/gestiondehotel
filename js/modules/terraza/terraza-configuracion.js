export function renderConfiguracionTab(deps) {
  const {
    escapeAttribute,
    getTerrazaConfig,
    money,
    numberOrZero
  } = deps;
  const config = getTerrazaConfig();

  return `
    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <form id="terraza-config-form" class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
        <div class="mb-4">
          <h2 class="text-lg font-bold text-slate-800">Configuracion de Terraza</h2>
          <p class="mt-1 text-sm text-slate-500">Define recargos y opciones que usan los meseros al vender y entregar recibos.</p>
        </div>

        <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label class="form-label text-xs">Precio adicional de michelada</label>
            <input name="precio_michelada" type="number" min="0" step="100" class="form-control" value="${escapeAttribute(config.precio_michelada ?? 0)}" required>
            <p class="mt-1 text-xs text-slate-500">Se suma al precio de la cerveza cuando el mesero marca "Vender como michelada".</p>
          </div>
          <div>
            <label class="form-label text-xs">Propina sugerida (%)</label>
            <input name="propina_sugerida_porcentaje" type="number" min="0" max="100" step="0.01" class="form-control" value="${escapeAttribute(config.propina_sugerida_porcentaje ?? 10)}" required>
            <p class="mt-1 text-xs text-slate-500">Sirve solo para calcular el monto sugerido; el mesero registra la propina real en pesos al cobrar.</p>
          </div>
          <label class="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700 md:col-span-2">
            <input name="permitir_descarga_pdf" type="checkbox" class="mt-1 h-4 w-4" ${config.permitir_descarga_pdf !== false ? 'checked' : ''}>
            <span>
              Permitir descargar factura o ticket en PDF
              <span class="mt-1 block text-xs font-normal text-slate-500">Si lo desactivas, los meseros solo veran la opcion de imprimir recibo.</span>
            </span>
          </label>
        </div>

        <div class="mt-5 flex justify-end">
          <button class="button button-primary" type="submit">Guardar configuracion</button>
        </div>
      </form>

      <aside class="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <h3 class="font-bold">Como se aplica</h3>
        <p class="mt-2">Los productos cuya categoria sea Cerveza o Cervezas muestran el check de michelada en el mapa.</p>
        <p class="mt-2">Ejemplo: cerveza ${money(7000)} + michelada ${money(config.precio_michelada)} = ${money(7000 + numberOrZero(config.precio_michelada))}.</p>
      </aside>
    </div>
  `;
}

export async function saveConfiguracion(form, deps) {
  const {
    defaultTerrazaConfig,
    refreshAndRender,
    showFeedback,
    state
  } = deps;

  if (!state.isAdmin) {
    throw new Error('Solo un administrador puede cambiar la configuracion de Terraza.');
  }

  const formData = new FormData(form);
  const precioMichelada = Number(formData.get('precio_michelada') || 0);
  const propinaPorcentaje = Number(formData.get('propina_sugerida_porcentaje') || 0);
  const permitirPdf = formData.get('permitir_descarga_pdf') === 'on';

  if (!Number.isFinite(precioMichelada) || precioMichelada < 0) {
    throw new Error('El precio de la michelada no es valido.');
  }
  if (!Number.isFinite(propinaPorcentaje) || propinaPorcentaje < 0 || propinaPorcentaje > 100) {
    throw new Error('La propina sugerida debe estar entre 0 y 100%.');
  }

  const payload = {
    hotel_id: state.hotelId,
    precio_michelada: precioMichelada,
    propina_sugerida_porcentaje: propinaPorcentaje,
    permitir_descarga_pdf: permitirPdf
  };

  const { error } = await state.supabase
    .from('terraza_configuracion')
    .upsert(payload, { onConflict: 'hotel_id' });

  if (error) throw error;

  state.configuracion = { ...defaultTerrazaConfig, ...payload };
  state.activeTab = 'configuracion';
  await refreshAndRender();
  showFeedback('Configuracion de Terraza guardada.', 'success');
}
