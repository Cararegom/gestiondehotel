export async function showHabitacionOpcionesModal(room, supabase, currentUser, hotelId, mainAppContainer, turnoService) {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.style.display = "flex";
    modalContainer.innerHTML = "";

    // 1. Declarar variables iniciales
    let reservaFutura = null;
    let botonesHtml = '';

    // Estilos de botones (Tailwind)
    const btnPrincipal = "w-full mb-2 py-2.5 rounded-lg text-white font-semibold bg-blue-600 hover:bg-blue-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";
    const btnSecundario = "w-full mb-2 py-2.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium border border-blue-200 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnVerde = "w-full mb-2 py-2.5 rounded-lg bg-green-100 hover:bg-green-200 text-green-800 font-medium border border-green-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnNaranja = "w-full mb-2 py-2.5 rounded-lg bg-orange-100 hover:bg-orange-200 text-orange-800 font-medium border border-orange-300 shadow-sm hover:shadow flex items-center justify-center gap-2";
    const btnRojo = "w-full mt-4 py-2.5 rounded-lg text-white font-semibold bg-red-600 hover:bg-red-700 shadow-sm hover:shadow transition flex items-center justify-center gap-2";

    // ---------------------------------------------------------------
    // 2. GENERAR HTML SEGÚN EL ESTADO DE LA HABITACIÓN
    // ---------------------------------------------------------------

    // --- CASO A: HABITACIÓN LIBRE ---
    if (room.estado === "libre") {
        botonesHtml += `<button id="btn-alquilar-directo" class="${btnPrincipal}"><span style="font-size:1.2em">🛏️</span> Alquilar Ahora</button>`;
        botonesHtml += `<button id="btn-enviar-limpieza" class="${btnSecundario}"><span style="font-size:1.2em">🧹</span> Enviar a Limpieza</button>`;
    }

    // --- CASO B: OCUPADA / ACTIVA / TIEMPO AGOTADO ---
    else if (["ocupada", "tiempo agotado", "activa"].includes(room.estado)) {
        botonesHtml += `<button id="btn-extender-tiempo" class="${btnPrincipal}"><span style="font-size:1.2em">⏱️</span> Extender Tiempo</button>`;
        botonesHtml += `<button id="btn-entregar" class="${btnSecundario}"><span style="font-size:1.2em">🔓</span> Liberar Habitación</button>`;
        botonesHtml += `<button id="btn-ver-consumos" class="${btnSecundario}"><span style="font-size:1.2em">🍽️</span> Ver Consumos</button>`;
        botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
        botonesHtml += `<button id="btn-seguimiento-articulos" class="${btnSecundario}"><span style="font-size:1.2em">📦</span> Gestionar Artículos</button>`;
        // Servicios adicionales
        botonesHtml += `<button id="btn-servicios-adicionales" class="${btnVerde}"><span style="font-size:1.2em">🛎️</span> Servicios adicionales</button>`;
    }

    // --- CASO C: RESERVADA (Check-in pendiente) ---
    else if (room.estado === "reservada") {
        // Consultar datos de la reserva futura
        const { data, error } = await supabase
            .from('reservas')
            .select('id, cliente_nombre, telefono, cantidad_huespedes, fecha_inicio, fecha_fin')
            .eq('habitacion_id', room.id)
            .eq('estado', 'reservada')
            .order('fecha_inicio', { ascending: true }) // La más próxima
            .limit(1)
            .maybeSingle();

        if (data) {
            reservaFutura = data;
            const fechaInicio = new Date(reservaFutura.fecha_inicio);
            const ahora = new Date();
            const diferenciaMin = (fechaInicio - ahora) / 60000;

            // Info visual
            botonesHtml += `<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 text-sm text-blue-900 shadow-sm">
                <strong>Cliente:</strong> ${reservaFutura.cliente_nombre}<br>
                <strong>Huéspedes:</strong> ${reservaFutura.cantidad_huespedes}<br>
                <strong>Llegada:</strong> ${fechaInicio.toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </div>`;

            // Botón Check-in (habilitado 2 horas antes o si ya pasó la hora)
            if (diferenciaMin <= 120) {
                botonesHtml += `<button id="btn-checkin-reserva" class="${btnVerde}"><span style="font-size:1.2em">✅</span> Check-in (Entrada)</button>`;
            } else {
                botonesHtml += `<div class="text-center text-xs text-orange-600 font-bold mb-2 bg-orange-50 p-2 rounded border border-orange-200">
                    ⏳ Check-in habilitado desde las ${new Date(fechaInicio.getTime() - 120 * 60000).toLocaleTimeString('es-CO', {hour: '2-digit', minute:'2-digit'})}
                </div>`;
            }
        } else {
            botonesHtml += `<div class="text-xs text-red-500 mb-2 p-2 bg-red-50 rounded">No se encontró la reserva activa para check-in.</div>`;
        }
        
        // Cambio de habitación permitido en reserva
        botonesHtml += `<button id="btn-cambiar-habitacion" class="${btnSecundario}"><span style="font-size:1.2em">🔁</span> Cambiar de Habitación</button>`;
    }

    // --- OPCIONES COMUNES ---
    
    // Mantenimiento (si no está ya en mantenimiento)
    if (room.estado !== "mantenimiento") {
        botonesHtml += `<button id="btn-mantenimiento" class="${btnNaranja}"><span style="font-size:1.2em">🛠️</span> Enviar a Mantenimiento</button>`;
    }

    // Info Huésped (si hay alguien asociado a la habitación)
    if (["ocupada", "tiempo agotado", "reservada", "activa"].includes(room.estado)) {
        botonesHtml += `<button id="btn-info-huesped" class="${btnSecundario}"><span style="font-size:1.2em">👤</span> Ver Info Huésped</button>`;
    }

    // Cerrar Modal
    botonesHtml += `<button id="close-modal-acciones" class="${btnRojo}"><span style="font-size:1.2em">❌</span> Cerrar</button>`;

    // 3. RENDERIZAR EL MODAL EN EL DOM
    const modalContent = document.createElement('div');
    modalContent.className = "bg-white rounded-xl shadow-2xl w-full max-w-sm p-6 m-auto relative animate-fade-in-up";
    modalContent.innerHTML = `
        <h3 class="text-xl font-bold mb-5 text-blue-700 text-center">${room.nombre} (${room.estado ? room.estado.toUpperCase() : 'N/A'})</h3>
        <div class="flex flex-col gap-2.5">
            ${botonesHtml}
        </div>
    `;
    modalContainer.appendChild(modalContent);

    // Cierre al hacer click fuera del modal
    modalContainer.onclick = (e) => {
        if (e.target === modalContainer) {
            modalContainer.style.display = "none";
            modalContainer.innerHTML = '';
        }
    };

    // Helper para asignar eventos de forma segura
    const setupButtonListener = (id, handler) => {
        const btn = modalContent.querySelector(`#${id}`);
        if (btn) {
            // Removemos listeners previos clonando el nodo (opcional, pero limpio)
            // En este caso, como creamos el modal de cero cada vez, no es estrictamente necesario clonar.
            btn.onclick = (e) => handler(btn, room);
        }
    };

    // =================================================================
    // 4. ASIGNACIÓN DE EVENTOS (AQUÍ ESTÁ LA CLAVE PARA QUE FUNCIONEN)
    // =================================================================

    // --- ACCIÓN: CERRAR ---
    setupButtonListener('close-modal-acciones', () => {
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
    });

    // --- ACCIÓN: ALQUILAR ---
    setupButtonListener('btn-alquilar-directo', async () => {
        const ahora = new Date();
        // Validar si hay una reserva próxima que bloquee el alquiler
        const { data: reservasFuturas } = await supabase
            .from('reservas')
            .select('fecha_inicio')
            .eq('habitacion_id', room.id)
            .in('estado', ['reservada', 'activa'])
            .gte('fecha_fin', ahora.toISOString())
            .order('fecha_inicio', { ascending: true })
            .limit(1);

        if (reservasFuturas && reservasFuturas.length > 0) {
            const inicioBloqueo = new Date(new Date(reservasFuturas[0].fecha_inicio).getTime() - 2 * 60 * 60 * 1000); // 2 horas antes
            if (ahora >= inicioBloqueo) {
                mostrarInfoModalGlobal("No puedes alquilar: habitación bloqueada por reserva próxima.", "Bloqueado");
                return;
            }
        }
        showAlquilarModal(room, supabase, currentUser, hotelId, mainAppContainer);
    });

    // --- ACCIÓN: EXTENDER TIEMPO ---
    setupButtonListener('btn-extender-tiempo', () => showExtenderTiempoModal(room, supabase, currentUser, hotelId, mainAppContainer));

    // --- ACCIÓN: MANTENIMIENTO ---
    setupButtonListener('btn-mantenimiento', () => showMantenimientoModal(room, supabase, currentUser, hotelId, mainAppContainer));

    // --- ACCIÓN: LIMPIEZA ---
    setupButtonListener('btn-enviar-limpieza', async (btn) => {
        btn.disabled = true; btn.textContent = "Enviando...";
        await supabase.from('habitaciones').update({ estado: 'limpieza' }).eq('id', room.id);
        modalContainer.style.display = "none"; modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
    });

    // --- ACCIÓN: GESTIONAR ARTÍCULOS ---
    setupButtonListener('btn-seguimiento-articulos', () => showSeguimientoArticulosModal(room, supabase, currentUser, hotelId));

    // --- ACCIÓN: VER INFO HUÉSPED ---
    setupButtonListener('btn-info-huesped', async () => {
        const { data: reserva } = await supabase.from('reservas')
            .select('*')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .single();
            
        if (reserva) {
            mostrarInfoModalGlobal(`
                <b>Nombre:</b> ${reserva.cliente_nombre}<br>
                <b>Tel:</b> ${reserva.telefono || 'N/A'}<br>
                <b>Entrada:</b> ${formatDateTime(reserva.fecha_inicio)}<br>
                <b>Salida:</b> ${formatDateTime(reserva.fecha_fin)}<br>
                ${reserva.notas ? `<b>Notas:</b> ${reserva.notas}` : ''}
            `, "Info Huésped");
        } else {
            mostrarInfoModalGlobal("No se encontró información.", "Info");
        }
    });

    // --- ACCIÓN: CHECK-IN RESERVA ---
    if (reservaFutura) {
        setupButtonListener('btn-checkin-reserva', async () => {
            // Validar si requiere pago
            const ok = await puedeHacerCheckIn(reservaFutura.id);
            if (!ok) return;

            // Calcular nueva fecha fin basada en la duración original
            const duracionMs = new Date(reservaFutura.fecha_fin) - new Date(reservaFutura.fecha_inicio);
            const nuevoInicio = new Date();
            const nuevoFin = new Date(nuevoInicio.getTime() + duracionMs);

            // Actualizar Reserva
            await supabase.from('reservas').update({
                estado: 'activa', 
                fecha_inicio: nuevoInicio.toISOString(), 
                fecha_fin: nuevoFin.toISOString()
            }).eq('id', reservaFutura.id);

            // Actualizar Habitación
            await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

            // Crear Cronómetro
            await supabase.from('cronometros').insert([{
                hotel_id: hotelId, 
                reserva_id: reservaFutura.id, 
                habitacion_id: room.id,
                fecha_inicio: nuevoInicio.toISOString(), 
                fecha_fin: nuevoFin.toISOString(), 
                activo: true
            }]);

            modalContainer.style.display = "none"; modalContainer.innerHTML = '';
            await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
            mostrarInfoModalGlobal("Check-in realizado con éxito.", "Bienvenido");
        });
    }

    // --- ACCIÓN: CAMBIAR HABITACIÓN ---
setupButtonListener('btn-cambiar-habitacion', async (btn) => {
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Cargando...';

    try {
        const { data: habsLibres, error: errHabs } = await supabase.from('habitaciones')
            .select('id, nombre')
            .eq('hotel_id', hotelId)
            .eq('estado', 'libre')
            .neq('id', room.id);

        if (errHabs) {
            console.error('Error obteniendo habitaciones libres:', errHabs);
            mostrarInfoModalGlobal("No se pudieron obtener las habitaciones libres.", "Error");
            return;
        }
        
        if (!habsLibres || habsLibres.length === 0) {
            mostrarInfoModalGlobal("No hay habitaciones libres disponibles.", "Error");
            return;
        }

        const options = habsLibres
            .map(h => `<option value="${h.id}">${h.nombre}</option>`)
            .join('');
        
        const { value: formValues } = await Swal.fire({
            title: 'Cambiar Habitación',
            html: `
                <label class="block text-left mb-1 text-sm">Destino:</label>
                <select id="swal-cambio-hab" class="swal2-input mb-3">${options}</select>
                <label class="block text-left mb-1 text-sm">Motivo:</label>
                <input id="swal-cambio-motivo" class="swal2-input" placeholder="Ej: Aire acondicionado fallando">
            `,
            showCancelButton: true,
            focusConfirm: false,
            preConfirm: () => {
                const id = document.getElementById('swal-cambio-hab').value;
                const motivo = document.getElementById('swal-cambio-motivo').value.trim();
                if (!id) Swal.showValidationMessage('Debes escoger una habitación destino.');
                if (!motivo) Swal.showValidationMessage('Debes escribir un motivo.');
                return { id, motivo };
            }
        });

        if (!formValues || !formValues.id || !formValues.motivo) return;

        const { data: resActiva, error: errResActiva } = await supabase.from('reservas')
            .select('id, estado')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado', 'reservada'])
            .order('fecha_inicio', { ascending: false })
            .limit(1)
            .maybeSingle();
        
        if (errResActiva) {
            console.error('Error obteniendo reserva activa para cambio:', errResActiva);
            mostrarInfoModalGlobal("No se pudo obtener la reserva actual de la habitación.", "Error");
            return;
        }

        if (!resActiva) {
            mostrarInfoModalGlobal("No se encontró una reserva activa asociada a esta habitación.", "Sin Reserva");
            return;
        }

        const { error: errRpc } = await supabase.rpc('cambiar_habitacion_transaccion', {
            p_reserva_id: resActiva.id,
            p_habitacion_origen_id: room.id,
            p_habitacion_destino_id: formValues.id,
            p_motivo_cambio: formValues.motivo,
            p_usuario_id: currentUser.id,
            p_hotel_id: hotelId,
            p_estado_destino: room.estado === 'reservada' ? 'reservada' : 'ocupada'
        });

        if (errRpc) {
            console.error('Error en cambiar_habitacion_transaccion:', errRpc);
            mostrarInfoModalGlobal("No se pudo cambiar la habitación: " + (errRpc.message || "Error en la transacción."), "Error");
            return;
        }

        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';

        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        mostrarInfoModalGlobal("Habitación cambiada correctamente.", "Éxito");
    } catch (err) {
        console.error('Error general al cambiar habitación:', err);
        mostrarInfoModalGlobal("Ocurrió un error al cambiar la habitación: " + (err.message || "Error desconocido"), "Error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});


    // --- ACCIÓN: SERVICIOS ADICIONALES ---
    setupButtonListener('btn-servicios-adicionales', async () => {
        const { data: reserva } = await supabase.from('reservas')
            .select('id, cliente_nombre, estado, monto_pagado')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
            .limit(1)
            .maybeSingle();
        
        if (!reserva) { 
            mostrarInfoModalGlobal("No hay reserva activa.", "Error"); 
            return; 
        }

        const { data: servicios } = await supabase.from('servicios_adicionales')
            .select('*')
            .eq('hotel_id', hotelId)
            .eq('activo', true);
        
        if (servicios && servicios.length > 0) {
            // Nota: Aquí llamamos a tu función externa, asegurate de que exista en el scope o importada
            showEnhancedServiciosModal(room, servicios, reserva);
        } else {
            mostrarInfoModalGlobal("No hay servicios configurados en el sistema.", "Info");
        }
    });

// ===================================================================
// Ver consumos (MODIFICADO: Usa modal local para evitar facturación electrónica)
// ===================================================================
setupButtonListener('btn-ver-consumos', async (btn) => {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Cargando...';
  btn.disabled = true;

  try {
    // 1. Buscar reserva activa
    const { data: r, error: errReserva } = await supabase
      .from('reservas')
      .select('*') // Traemos todo para tener datos del cliente
      .eq('habitacion_id', room.id)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .limit(1)
      .maybeSingle();

    if (errReserva) console.error(errReserva);

    if (!r) {
        mostrarInfoModalGlobal("No hay reserva activa para ver consumos.", "Sin Reserva");
        return;
    }

    // 2. Si es duración abierta, actualizar precio (lógica original)
    if (r.tipo_duracion === 'abierta') {
      try {
        const calculo = await calculateTimeAndPrice(supabase, r, hotelId, hotelConfigGlobal);
        if (calculo && calculo.precioAlojamientoCalculado !== Number(r.monto_total)) {
          const { error: upErr } = await supabase
            .from('reservas')
            .update({ monto_total: calculo.precioAlojamientoCalculado })
            .eq('id', r.id);
          if(!upErr) r.monto_total = calculo.precioAlojamientoCalculado; 
        }
      } catch (e) { console.error(e); }
    }

    // 3. LLAMAR A NUESTRA NUEVA VENTANA MODAL LOCAL
    await mostrarModalConsumosLocal(room, r, supabase, currentUser, hotelId);

  } catch (err) {
      console.error(err);
      mostrarInfoModalGlobal("Error al cargar consumos.", "Error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});


// ===================================================================
// ENTREGAR / LIBERAR HABITACIÓN (CON CORRECCIÓN DE ERROR DE DATOS)
// ===================================================================
setupButtonListener('btn-entregar', async (btn) => {
  const originalText = btn.innerHTML;
  btn.innerHTML = 'Procesando...';
  btn.disabled = true;

  try {
    // 1. Buscar reserva activa asociada a la habitación
    const { data: reservaActiva, error: errReserva } = await supabase
      .from('reservas')
      .select('id, estado')
      .eq('habitacion_id', room.id)
      .eq('hotel_id', hotelId)
      .in('estado', ['activa', 'ocupada', 'tiempo agotado'])
      .limit(1)
      .maybeSingle();

    if (errReserva) {
      console.error('Error buscando reserva activa al liberar:', errReserva);
    }

    // ========================================================================
    // CORRECCIÓN: MANEJO DE "ERROR DE DATOS" (Habitación ocupada sin reserva)
    // ========================================================================
    if (!reservaActiva) {
      // En lugar de bloquear, preguntamos si quieren forzar la limpieza
      const { isConfirmed } = await Swal.fire({
        icon: 'error', // Icono de error para alertar que algo raro pasa
        title: '⚠ Inconsistencia de Datos',
        html: `
          Esta habitación figura como ocupada, pero <b>no se encontró ninguna reserva activa</b> asociada.<br><br>
          ¿Deseas <b>forzar</b> el cambio de estado a <b>LIMPIEZA</b> para desbloquearla?
        `,
        showCancelButton: true,
        confirmButtonText: 'Sí, Forzar a Limpieza',
        confirmButtonColor: '#d33', // Rojo para indicar acción de fuerza
        cancelButtonText: 'Cancelar'
      });

      if (isConfirmed) {
        // 1. Forzar estado a limpieza
        await supabase.from('habitaciones')
            .update({ estado: 'limpieza', actualizado_en: new Date().toISOString() })
            .eq('id', room.id);
        
        // 2. Matar cualquier cronómetro huérfano
        await supabase.from('cronometros')
            .update({ activo: false, fecha_fin: new Date().toISOString() })
            .eq('habitacion_id', room.id);

        // 3. Cerrar modal y refrescar
        modalContainer.style.display = 'none';
        modalContainer.innerHTML = '';
        await renderRooms(mainAppContainer, supabase, currentUser, hotelId);
        
        Swal.fire('Corregido', 'La habitación ha sido enviada a limpieza forzosamente.', 'success');
      }
      
      // Restaurar botón y salir
      btn.innerHTML = originalText;
      btn.disabled = false;
      return; 
    }
    // ================= FIN DE LA CORRECCIÓN =================

    // SI SÍ HAY RESERVA, EL CÓDIGO SIGUE NORMALMENTE DESDE AQUÍ:
    
    // 2. Verificar artículos prestados sin devolver
    const { data: historialArticulos, error: errHist } = await supabase
      .from('historial_articulos_prestados')
      .select('articulo_nombre, cantidad, accion')
      .eq('hotel_id', hotelId)
      .eq('habitacion_id', room.id)
      .eq('reserva_id', reservaActiva.id);

    if (errHist) {
      console.error('Error consultando historial de artículos prestados:', errHist);
      // Continuamos aunque haya error de consulta, por seguridad
    }

    // Calculamos saldo por artículo
    const saldoPorArticulo = {};
    (historialArticulos || []).forEach((h) => {
      const nombre = h.articulo_nombre || 'Artículo';
      const cant = Number(h.cantidad || 0);
      if (!saldoPorArticulo[nombre]) saldoPorArticulo[nombre] = 0;

      if (h.accion === 'prestado') {
        saldoPorArticulo[nombre] += cant;
      } else if (h.accion === 'devuelto') {
        saldoPorArticulo[nombre] -= cant;
      }
    });

    const articulosPendientes = Object.entries(saldoPorArticulo)
      .filter(([_, saldo]) => saldo > 0);

    if (articulosPendientes.length > 0) {
      const listaHTML = articulosPendientes
        .map(([nombre, saldo]) => `• ${nombre} x${saldo}`)
        .join('<br>');

      await Swal.fire({
        icon: 'warning',
        title: 'Artículos prestados pendientes',
        html: `
          Esta habitación tiene artículos prestados que aún no se han devuelto:<br><br>
          ${listaHTML}<br><br>
          Registra la devolución antes de liberar la habitación.
        `
      });
      btn.innerHTML = originalText;
      btn.disabled = false;
      return; // 🔒 NO se libera
    }

    // 3. Calcular saldo REAL
    const { totalDeTodosLosCargos, saldoPendiente } =
      await calcularSaldoReserva(supabase, reservaActiva.id, hotelId);

    const margen = 50; // margen en pesos para redondeos

    if (totalDeTodosLosCargos > 0 && saldoPendiente > margen) {
      // 🔒 NO PERMITIR LIBERAR CON SALDO
      await Swal.fire({
        icon: 'warning',
        title: 'Saldo pendiente',
        html: `
          La habitación tiene un saldo pendiente de
          <b>$ ${formatCOP(saldoPendiente)}</b>.<br><br>
          Por favor cobra el saldo desde "Ver consumos" antes de liberar la habitación.
        `
      });
      btn.innerHTML = originalText;
      btn.disabled = false;
      return;
    }

    // 4. Confirmar liberación (saldo = 0 y sin artículos pendientes)
    const { isConfirmed } = await Swal.fire({
      icon: 'question',
      title: 'Liberar habitación',
      text: 'El saldo está en $0 y no hay artículos prestados pendientes. ¿Deseas liberar la habitación ahora?',
      showCancelButton: true,
      confirmButtonText: 'Sí, liberar',
      cancelButtonText: 'Cancelar'
    });

    if (!isConfirmed) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        return;
    }

    const ahoraISO = new Date().toISOString();

    // 5. Cerrar reserva: estado finalizada
    await supabase.from('reservas')
      .update({
        estado: 'finalizada',
        fecha_fin: ahoraISO,
        monto_pagado: totalDeTodosLosCargos,
        actualizado_en: ahoraISO
      })
      .eq('id', reservaActiva.id);

    // 6. Detener cronómetro
    await supabase.from('cronometros')
      .update({ activo: false, fecha_fin: ahoraISO })
      .eq('habitacion_id', room.id)
      .eq('reserva_id', reservaActiva.id);

    // 7. Pasar habitación a estado "limpieza"
    await supabase.from('habitaciones')
      .update({ estado: 'limpieza', actualizado_en: ahoraISO })
      .eq('id', room.id);

    // 8. Registrar en bitácora (opcional)
    // ... tu lógica de bitácora ...

    // 9. Cerrar modal y recargar
    modalContainer.style.display = 'none';
    modalContainer.innerHTML = '';
    await renderRooms(mainAppContainer, supabase, currentUser, hotelId);

    await Swal.fire({
      icon: 'success',
      title: 'Habitación liberada',
      text: 'La habitación se ha pasado a estado Limpieza.',
      timer: 1500,
      showConfirmButton: false
    });

  } catch (e) {
    console.error('Error general al liberar la habitación:', e);
    await Swal.fire({
      icon: 'error',
      title: 'Error',
      text: 'Ocurrió un error al liberar la habitación.'
    });
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
});



}