import { turnoService } from '../../services/turnoService.js';
import { escapeAttribute, escapeHtml } from '../../security.js';

function formatDateInputValue(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const localDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return localDate.toISOString().slice(0, 16);
}

function getReservaStatusMeta(reserva) {
  if (reserva?.estado === 'en_curso') {
    return { label: 'En consumo', className: 'bg-blue-100 text-blue-800 border-blue-200' };
  }
  if (reserva?.estado === 'completada') {
    return { label: 'Completada', className: 'bg-green-100 text-green-800 border-green-200' };
  }
  if (reserva?.estado === 'cancelada') {
    return { label: 'Cancelada', className: 'bg-slate-100 text-slate-600 border-slate-200' };
  }
  return { label: 'Reservada', className: 'bg-purple-100 text-purple-800 border-purple-200' };
}

function renderReservaForm(deps) {
  const { state, getMetodosPagoActivos } = deps;
  const mesasReservables = state.mesas.filter((mesa) => mesa.activo !== false);
  const metodosActivos = getMetodosPagoActivos();
  const fechaDefault = formatDateInputValue(new Date(Date.now() + 60 * 60 * 1000));

  return `
    <form id="terraza-reserva-form" class="overflow-hidden rounded-xl border border-purple-100 bg-white shadow-sm">
      <div class="border-b border-purple-100 bg-purple-50 px-5 py-4 md:px-6">
        <div class="flex flex-col justify-between gap-3 md:flex-row md:items-center">
          <div>
            <p class="text-xs font-bold uppercase tracking-wide text-purple-700">Reserva de terraza</p>
            <h3 class="mt-1 text-xl font-extrabold text-slate-900">Nueva reserva de mesa</h3>
            <p class="mt-1 text-sm text-purple-900/80">Registra cliente, ubicacion y anticipo consumible para productos del inventario de Terraza.</p>
          </div>
          <div class="rounded-lg border border-purple-200 bg-white px-4 py-2 text-sm font-bold text-purple-800">
            Anticipo = saldo consumible
          </div>
        </div>
      </div>

      <div class="space-y-6 p-5 md:p-6">
        <section>
          <div class="mb-3">
            <h4 class="text-sm font-extrabold uppercase tracking-wide text-slate-700">Datos del cliente</h4>
            <p class="mt-1 text-xs text-slate-500">Estos datos ayudan a identificar rapidamente la reserva cuando el cliente llegue.</p>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Cliente</label>
              <input name="cliente_nombre" class="form-control min-h-[46px] text-base" required placeholder="Nombre del cliente">
            </div>
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Telefono</label>
              <input name="cliente_telefono" class="form-control min-h-[46px] text-base" placeholder="Opcional">
            </div>
          </div>
        </section>

        <section>
          <div class="mb-3">
            <h4 class="text-sm font-extrabold uppercase tracking-wide text-slate-700">Ubicacion y horario</h4>
            <p class="mt-1 text-xs text-slate-500">Puedes reservar mesa completa o una silla puntual si aplica.</p>
          </div>
          <div class="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div class="xl:col-span-2">
              <label class="form-label text-sm font-bold text-slate-700">Mesa</label>
              <select name="mesa_id" class="form-control min-h-[46px] text-base" required ${mesasReservables.length ? '' : 'disabled'}>
                <option value="">Selecciona mesa</option>
                ${mesasReservables.map((mesa) => `
                  <option value="${escapeAttribute(mesa.id)}">${escapeHtml(mesa.nombre)} (${escapeHtml(String(mesa.sillas || 1))} puesto(s))</option>
                `).join('')}
              </select>
            </div>
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Silla opcional</label>
              <input name="silla_numero" type="number" min="1" step="1" class="form-control min-h-[46px] text-base" placeholder="Mesa completa">
            </div>
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Personas</label>
              <input name="cantidad_personas" type="number" min="1" step="1" class="form-control min-h-[46px] text-base" value="2">
            </div>
            <div class="md:col-span-2">
              <label class="form-label text-sm font-bold text-slate-700">Fecha y hora</label>
              <input name="fecha_reserva" type="datetime-local" class="form-control min-h-[46px] text-base" required value="${escapeAttribute(fechaDefault)}">
            </div>
          </div>
        </section>

        <section>
          <div class="mb-3">
            <h4 class="text-sm font-extrabold uppercase tracking-wide text-slate-700">Anticipo y observaciones</h4>
            <p class="mt-1 text-xs text-slate-500">Si registras anticipo, selecciona metodo de pago para que quede en caja.</p>
          </div>
          <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Anticipo consumible</label>
              <input name="anticipo_consumible" type="number" min="0" step="1000" class="form-control min-h-[46px] text-base" value="0">
            </div>
            <div>
              <label class="form-label text-sm font-bold text-slate-700">Metodo anticipo</label>
              <select name="metodo_pago_id" class="form-control min-h-[46px] text-base" ${metodosActivos.length ? '' : 'disabled'}>
                <option value="">Sin anticipo</option>
                ${metodosActivos.map((metodo) => `<option value="${escapeAttribute(metodo.id)}">${escapeHtml(metodo.nombre || 'Metodo')}</option>`).join('')}
              </select>
              ${metodosActivos.length ? '' : '<p class="mt-1 text-xs font-semibold text-red-600">No hay metodos de pago activos para registrar anticipos.</p>'}
            </div>
            <div class="lg:col-span-3">
              <label class="form-label text-sm font-bold text-slate-700">Notas</label>
              <textarea name="notas" rows="3" class="form-control min-h-[92px] resize-y text-base" placeholder="Ej: cumpleanos, ubicacion preferida, hora limite..."></textarea>
            </div>
          </div>
        </section>

        <div class="flex flex-col gap-3 border-t border-slate-100 pt-5 md:flex-row md:items-center md:justify-between">
          <p class="text-sm font-semibold text-slate-500">La reserva quedara visible en el mapa y podra activarse al llegar el cliente.</p>
          <button class="button button-primary min-h-[46px] px-6 text-base font-extrabold" type="submit" ${mesasReservables.length ? '' : 'disabled'}>Crear reserva</button>
        </div>
      </div>
    </form>
  `;
}

function renderReservasList(deps) {
  const {
    state,
    formatDate,
    getPedidoLocationLabel,
    getReservaAnticipo,
    getReservaSaldoDisponible,
    money
  } = deps;

  if (!state.reservas.length) {
    return '<div class="rounded-xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500">Aun no hay reservas de Terraza.</div>';
  }

  return `
    <div class="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div class="border-b border-slate-200 p-4">
        <h3 class="font-bold text-slate-800">Reservas registradas</h3>
        <p class="mt-1 text-xs text-slate-500">Activa la reserva cuando el cliente llegue para abrir la cuenta con el anticipo consumible.</p>
      </div>
      <div class="divide-y divide-slate-100">
        ${state.reservas.map((reserva) => {
          const meta = getReservaStatusMeta(reserva);
          const saldo = getReservaSaldoDisponible(reserva);
          const ubicacion = getPedidoLocationLabel(reserva);
          const puedeActivar = reserva.estado === 'reservada';
          const puedeCancelar = reserva.estado === 'reservada';
          return `
            <article class="flex flex-col justify-between gap-3 p-4 text-sm md:flex-row md:items-start">
              <div class="min-w-0 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-bold text-slate-900">${escapeHtml(reserva.cliente_nombre || 'Cliente')}</span>
                  <span class="rounded-full border px-2 py-0.5 text-[11px] font-bold ${meta.className}">${meta.label}</span>
                </div>
                <p class="mt-1 text-xs text-slate-500">${formatDate(reserva.fecha_reserva)} - ${escapeHtml(ubicacion)}</p>
                ${reserva.cliente_telefono ? `<p class="mt-1 text-xs text-slate-500">Tel: ${escapeHtml(reserva.cliente_telefono)}</p>` : ''}
                ${reserva.notas ? `<p class="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">${escapeHtml(reserva.notas)}</p>` : ''}
              </div>
              <div class="flex flex-col items-start gap-2 md:items-end">
                <div class="text-left md:text-right">
                  <div class="text-xs text-slate-500">Anticipo: ${money(getReservaAnticipo(reserva))}</div>
                  <div class="font-extrabold text-purple-700">Saldo: ${money(saldo)}</div>
                  <div class="text-xs text-slate-500">${escapeHtml(reserva.metodo?.nombre || 'Sin metodo')}</div>
                </div>
                <div class="flex flex-wrap gap-2 md:justify-end">
                  ${puedeActivar ? `<button class="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-purple-700" data-action="activate-reservation" data-reserva-id="${escapeAttribute(reserva.id)}">Activar</button>` : ''}
                  ${puedeCancelar ? `<button class="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50" data-action="cancel-reservation" data-reserva-id="${escapeAttribute(reserva.id)}">Cancelar</button>` : ''}
                </div>
              </div>
            </article>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

export function renderReservasTab(deps) {
  return `
    <div class="space-y-5">
      ${deps.renderStats()}
      ${renderReservaForm(deps)}
      ${renderReservasList(deps)}
    </div>
  `;
}

export async function saveReserva(form, deps) {
  const { state, getMesaById, money, refreshAndRender, showFeedback } = deps;
  const formData = new FormData(form);
  const clienteNombre = String(formData.get('cliente_nombre') || '').trim();
  const clienteTelefono = String(formData.get('cliente_telefono') || '').trim();
  const fechaReservaRaw = String(formData.get('fecha_reserva') || '').trim();
  const mesaId = String(formData.get('mesa_id') || '').trim();
  const sillaNumeroRaw = String(formData.get('silla_numero') || '').trim();
  const cantidadPersonas = Number(formData.get('cantidad_personas') || 1);
  const anticipo = Number(formData.get('anticipo_consumible') || 0);
  const metodoPagoId = String(formData.get('metodo_pago_id') || '').trim();
  const notas = String(formData.get('notas') || '').trim();
  const fechaReserva = new Date(fechaReservaRaw);
  const sillaNumero = sillaNumeroRaw ? Number(sillaNumeroRaw) : null;

  if (!clienteNombre) throw new Error('El nombre del cliente es obligatorio.');
  if (!mesaId) throw new Error('Selecciona la mesa reservada.');
  if (Number.isNaN(fechaReserva.getTime())) throw new Error('La fecha de reserva no es valida.');
  if (!Number.isInteger(cantidadPersonas) || cantidadPersonas <= 0) throw new Error('La cantidad de personas no es valida.');
  if (!Number.isFinite(anticipo) || anticipo < 0) throw new Error('El anticipo consumible no es valido.');
  if (sillaNumero !== null && (!Number.isInteger(sillaNumero) || sillaNumero <= 0)) {
    throw new Error('La silla debe ser un numero mayor a cero.');
  }
  if (anticipo > 0 && !metodoPagoId) {
    throw new Error('Selecciona el metodo con el que recibiste el anticipo.');
  }

  const mesa = getMesaById(mesaId);
  if (sillaNumero && mesa && sillaNumero > Number(mesa.sillas || 0)) {
    throw new Error(`La mesa seleccionada solo tiene ${mesa.sillas || 0} puesto(s).`);
  }

  let turnoId = null;
  if (anticipo > 0) {
    const turno = await turnoService.getTurnoAbierto(state.supabase, state.user.id, state.hotelId);
    if (!turno) {
      throw new Error('Abre turno en Caja antes de registrar un anticipo de reserva.');
    }
    turnoId = turno.id;
  }

  const { data, error } = await state.supabase.rpc('crear_reserva_terraza', {
    p_hotel_id: state.hotelId,
    p_mesa_id: mesaId,
    p_silla_numero: sillaNumero,
    p_cliente_nombre: clienteNombre,
    p_cliente_telefono: clienteTelefono || null,
    p_fecha_reserva: fechaReserva.toISOString(),
    p_cantidad_personas: cantidadPersonas,
    p_anticipo_consumible: anticipo,
    p_metodo_pago_id: metodoPagoId || null,
    p_usuario_id: state.user.id,
    p_turno_id: turnoId,
    p_notas: notas || null
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo crear la reserva.');

  state.activeTab = 'reservas';
  await refreshAndRender();
  showFeedback(`Reserva creada. Anticipo consumible: ${money(anticipo)}.`, 'success');
}

export async function activateReservation(reservaId, deps) {
  const {
    state,
    getReservaById,
    getReservaAnticipo,
    getPedidoSeleccionado,
    money,
    normalizeSilla,
    refreshAndRender,
    showFeedback
  } = deps;
  const reserva = getReservaById(reservaId);
  if (!reserva) throw new Error('No se encontro la reserva.');
  if (reserva.estado !== 'reservada') throw new Error('Esta reserva no esta disponible para activar.');

  const pedidoSeleccionado = getPedidoSeleccionado?.();
  const pedidoEsMismaUbicacion = pedidoSeleccionado
    && pedidoSeleccionado.estado === 'abierto'
    && pedidoSeleccionado.mesa_id === reserva.mesa_id
    && normalizeSilla(pedidoSeleccionado.silla_numero) === normalizeSilla(reserva.silla_numero);

  if (pedidoEsMismaUbicacion) {
    const { error: reservaError } = await state.supabase
      .from('terraza_reservas')
      .update({
        estado: 'en_curso',
        pedido_id: pedidoSeleccionado.id,
        saldo_consumido: 0
      })
      .eq('id', reserva.id)
      .eq('estado', 'reservada');
    if (reservaError) throw reservaError;

    const { error: pedidoError } = await state.supabase
      .from('terraza_pedidos')
      .update({
        reserva_terraza_id: reserva.id,
        cliente_nombre: pedidoSeleccionado.cliente_nombre || reserva.cliente_nombre || null
      })
      .eq('id', pedidoSeleccionado.id)
      .eq('estado', 'abierto');
    if (pedidoError) throw pedidoError;

    state.selectedMesaId = reserva.mesa_id;
    state.selectedSillaNumero = normalizeSilla(reserva.silla_numero);
    state.activeTab = 'mapa';
    await refreshAndRender();
    showFeedback(`Reserva aplicada a la cuenta actual. Anticipo disponible: ${money(getReservaAnticipo(reserva))}.`, 'success');
    return;
  }

  const { data, error } = await state.supabase.rpc('activar_reserva_terraza', {
    p_reserva_id: reservaId,
    p_usuario_id: state.user.id
  });

  if (error) throw error;
  if (data?.error) throw new Error(data.message || 'No se pudo activar la reserva.');

  state.selectedMesaId = data?.mesa_id || reserva.mesa_id;
  state.selectedSillaNumero = normalizeSilla(data?.silla_numero ?? reserva.silla_numero);
  state.activeTab = 'mapa';
  await refreshAndRender();
  showFeedback(`Reserva activada para ${reserva.cliente_nombre}. Anticipo disponible: ${money(getReservaAnticipo(reserva))}.`, 'success');
}

export async function cancelReservation(reservaId, deps) {
  const {
    state,
    confirmDialog,
    getReservaById,
    getReservaAnticipo,
    refreshAndRender,
    showFeedback
  } = deps;
  const reserva = getReservaById(reservaId);
  if (!reserva) throw new Error('No se encontro la reserva.');
  if (reserva.estado !== 'reservada') throw new Error('Solo se pueden cancelar reservas pendientes.');

  const confirmed = await confirmDialog(
    'Cancelar reserva',
    getReservaAnticipo(reserva) > 0
      ? 'La reserva quedara cancelada. Si devuelves el anticipo, registra el egreso correspondiente en Caja.'
      : 'La reserva quedara cancelada.',
    'Cancelar reserva'
  );
  if (!confirmed) return;

  const { error } = await state.supabase
    .from('terraza_reservas')
    .update({
      estado: 'cancelada',
      cancelado_por_usuario_id: state.user.id,
      fecha_cancelacion: new Date().toISOString()
    })
    .eq('id', reservaId);
  if (error) throw error;

  state.activeTab = 'reservas';
  await refreshAndRender();
  showFeedback('Reserva cancelada.', 'success');
}
