let currentRooms = [];
let cronometrosInterval = {};

// IMPORTANTE: si tienes un servicio de notificaciones, descomenta la línea de abajo y ajústala
// import { crearNotificacion } from '../../services/NotificationService.js';

export async function mount(container, supabase, currentUser, hotelId) {
    container.innerHTML = `
        <div class="mb-6">
            <h2 class="text-2xl font-bold text-green-600 flex items-center">
                <img src="icons/mapa.svg" class="w-8 h-8 mr-2"> Mapa de Habitaciones
            </h2>
        </div>
        <div id="room-map-list" class="space-y-5"></div>
        <div id="modal-alquilar" style="display:none;"></div>
    `;
    await renderRooms(container, supabase, hotelId);
}

export function unmount() {
    Object.values(cronometrosInterval).forEach(clearInterval);
    cronometrosInterval = {};
}

async function renderRooms(container, supabase, hotelId) {
    const { data: habitaciones, error } = await supabase
        .from('habitaciones')
        .select('*')
        .eq('hotel_id', hotelId)
        .order('nombre', { ascending: true });

    if (error) {
        container.querySelector("#room-map-list").innerHTML = `<div class="text-red-600">Error cargando habitaciones: ${error.message}</div>`;
        return;
    }

    currentRooms = habitaciones;
    const list = container.querySelector("#room-map-list");
    list.innerHTML = '';
    habitaciones.forEach(room => {
        list.appendChild(roomCard(room, supabase, hotelId, container));
        if (room.estado === 'ocupada') startCronometro(room, supabase, hotelId, list);
        if (room.estado === 'tiempo agotado') startCronometro(room, supabase, hotelId, list); // sigue mostrando crono hacia arriba
    });
}

function roomCard(room, supabase, hotelId, container) {
    const div = document.createElement('div');
    div.className = "card p-6 flex flex-col gap-2 cursor-pointer hover:shadow-lg";
    div.innerHTML = `
        <div class="flex justify-between items-center mb-1">
            <span class="text-xl font-bold">${room.nombre}</span>
            <span class="inline-block px-4 py-1 text-xs rounded-full ${
                room.estado === "libre" ? "bg-green-200 text-green-700"
                : room.estado === "ocupada" ? "bg-yellow-200 text-yellow-700"
                : room.estado === "tiempo agotado" ? "bg-red-200 text-red-700"
                : room.estado === "mantenimiento" ? "bg-orange-200 text-orange-700"
                : "bg-blue-200 text-blue-700"
            }">${room.estado}</span>
        </div>
        <div><b>Tipo:</b> ${room.tipo || '-'}</div>
        <div><b>Amenidades:</b> ${(room.amenidades || []).map(am => `<span class="inline-block bg-gray-100 text-gray-600 text-xs rounded px-2 py-1 mr-1 mb-1">${am}</span>`).join('')}</div>
        <div id="cronometro-${room.id}" class="text-right font-mono text-blue-600 text-lg"></div>
    `;
    div.onclick = () => showHabitacionOpcionesModal(room, supabase, hotelId, container);
    return div;
}

function showHabitacionOpcionesModal(room, supabase, hotelId, container) {
    const modal = document.getElementById('modal-alquilar');
    modal.style.display = "block";
    let botonesHtml = '';

    if (room.estado === "libre") {
        botonesHtml += `<button id="btn-alquilar-directo" class="button button-primary w-full mb-2">Alquilar ahora</button>`;
        botonesHtml += `<button id="btn-ver-reservas" class="button w-full mb-2" style="background:#38bdf8;color:white;">Ver reservas futuras</button>`;
    } else if (room.estado === "ocupada") {
        botonesHtml += `<button id="btn-extender-tiempo" class="button w-full mb-2" style="background:#a21caf;color:white;">Extender tiempo</button>`;
        botonesHtml += `<button id="btn-entregar" class="button w-full mb-2" style="background:#22c55e;color:white;">Entregar habitación</button>`;
    } else if (room.estado === "reservada") {
        botonesHtml += `<button id="btn-ver-reserva" class="button w-full mb-2" style="background:#38bdf8;color:white;">Ver reserva</button>`;
        botonesHtml += `<button id="btn-entregar" class="button w-full mb-2" style="background:#22c55e;color:white;">Entregar habitación</button>`;
    }
    // --- Botón de mantenimiento (siempre disponible) ---
    botonesHtml += `<button id="btn-mantenimiento" class="button w-full mb-2" style="background:#fb923c;color:#a16207;">Enviar a mantenimiento</button>`;
    // Siempre la opción de reservar para otra fecha
    botonesHtml += `<button id="btn-reservar" class="button w-full mb-2" style="background:#f59e0b;color:white;">Reservar para otra fecha</button>`;
    botonesHtml += `<button id="btn-info-huesped" class="button w-full mb-2" style="background:#64748b;color:white;">Ver info huésped</button>`;
    botonesHtml += `<button id="close-modal-acciones" class="button w-full mt-1" style="background:#ef4444;color:white;">Cerrar</button>`;

    modal.innerHTML = `
        <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
                <h3 class="text-xl font-bold mb-4 text-blue-800 text-center">${room.nombre}</h3>
                <div class="flex flex-col gap-2">
                    ${botonesHtml}
                </div>
            </div>
        </div>
    `;

    // Evento para mantenimiento
    modal.querySelector('#btn-mantenimiento').onclick = () => {
        modal.innerHTML = `
            <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
                <div class="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
                    <button id="close-modal-mant" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
                    <h3 class="text-xl font-bold mb-4 text-orange-700">Enviar ${room.nombre} a mantenimiento</h3>
                    <form id="form-mantener">
                        <label class="mb-2 block">Describa el problema de la habitación:</label>
                        <textarea name="problema" class="form-control mb-4" rows="4" required></textarea>
                        <button type="submit" class="button w-full" style="background:#fb923c;color:#fff;">Enviar reporte</button>
                    </form>
                </div>
            </div>
        `;
        modal.querySelector('#close-modal-mant').onclick = () => {
            modal.innerHTML = "";
            modal.style.display = "none";
        };
        modal.querySelector('#form-mantener').onsubmit = async (e) => {
            e.preventDefault();
            const problema = e.target.problema.value;
            await supabase.from('habitaciones').update({ estado: 'mantenimiento' }).eq('id', room.id);
            if (typeof crearNotificacion === 'function') {
                await crearNotificacion({
                    titulo: `Habitación a mantenimiento`,
                    mensaje: `Habitación "${room.nombre}" reportada: ${problema}`,
                    tipo: 'mantenimiento',
                    prioridad: 'alta',
                    hotel_id: hotelId,
                    creado_en: new Date().toISOString()
                });
            }
            await supabase.from('mantenimiento').insert([{
                hotel_id: hotelId,
                habitacion_id: room.id,
                descripcion: problema,
                estado: "pendiente",
                creado_en: new Date().toISOString()
            }]);
            modal.innerHTML = "";
            modal.style.display = "none";
            await renderRooms(container, supabase, hotelId);
            alert('Reporte de mantenimiento enviado.');
        };
    };

    // Botón de reservar para otra fecha
    const reservarBtn = modal.querySelector('#btn-reservar');
    if (reservarBtn) {
        reservarBtn.onclick = () => {
            modal.innerHTML = "";
            modal.style.display = "none";
            showReservaFuturaModal(room, supabase, hotelId, container);
        };
    }

    modal.querySelector('#close-modal-acciones').onclick = () => {
        modal.innerHTML = "";
        modal.style.display = "none";
    };
    if (room.estado === "libre") {
        modal.querySelector('#btn-alquilar-directo').onclick = () => {
            modal.innerHTML = ""; modal.style.display = "none";
            showAlquilarModal(room, supabase, hotelId, container);
        };
        modal.querySelector('#btn-ver-reservas').onclick = () => {
            alert('Próximamente: Ver reservas futuras.');
        };
    }
    if (room.estado === "ocupada") {
        modal.querySelector('#btn-extender-tiempo').onclick = () => {
            modal.innerHTML = ""; modal.style.display = "none";
            showExtenderTiempoModal(room, supabase, hotelId, container);
        };
        modal.querySelector('#btn-entregar').onclick = async () => {
            await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', room.id);
            modal.innerHTML = "";
            modal.style.display = "none";
            await renderRooms(container, supabase, hotelId);
        };
    }
    if (room.estado === "reservada") {
        if (modal.querySelector('#btn-ver-reserva')) {
            modal.querySelector('#btn-ver-reserva').onclick = () => {
                alert('Próximamente: Ver detalles de reserva.');
            };
        }
        modal.querySelector('#btn-entregar').onclick = async () => {
            await supabase.from('habitaciones').update({ estado: 'libre' }).eq('id', room.id);
            modal.innerHTML = "";
            modal.style.display = "none";
            await renderRooms(container, supabase, hotelId);
        };
    }
    modal.querySelector('#btn-info-huesped').onclick = async () => {
        const { data: reservas, error } = await supabase
            .from('reservas')
            .select('*')
            .eq('habitacion_id', room.id)
            .eq('estado', 'activa')
            .order('fecha_inicio', { ascending: false })
            .limit(1);

        if (!reservas || reservas.length === 0) {
            mostrarInfoModal("No hay huésped activo en esta habitación.");
            return;
        }
        const reserva = reservas[0];
        mostrarInfoModal(`
            <div class="text-lg font-bold text-blue-700 mb-3">Información del huésped</div>
            <div class="mb-2"><b>👤 Nombre:</b> ${reserva.cliente_nombre}</div>
            <div class="mb-2"><b>🆔 Cédula:</b> ${reserva.cedula}</div>
            <div class="mb-2"><b>📱 Teléfono:</b> ${reserva.telefono}</div>
            <div class="mb-2"><b>👥 Cantidad de huéspedes:</b> ${reserva.cantidad_huespedes}</div>
            <div class="mb-2"><b>⏰ Ingreso:</b> ${new Date(reserva.fecha_inicio).toLocaleString()}</div>
            <div class="mb-2"><b>⏳ Salida:</b> ${new Date(reserva.fecha_fin).toLocaleString()}</div>
        `);
    };
}

function mostrarInfoModal(htmlContent) {
    const modal = document.getElementById('modal-alquilar');
    modal.style.display = "block";
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
                <button id="close-info-modal" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
                ${htmlContent}
            </div>
        </div>
    `;
    modal.querySelector('#close-info-modal').onclick = () => {
        modal.innerHTML = "";
        modal.style.display = "none";
    };
}

function showAlquilarModal(room, supabase, hotelId, container) {
    const modal = document.getElementById('modal-alquilar');
    modal.style.display = "block";
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
                <button id="close-modal-alquilar" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
                <h3 class="text-xl font-bold mb-4 text-blue-800">Alquilar ${room.nombre}</h3>
                <form id="alquilar-form">
                    <div class="form-group">
                        <label>Nombre huésped</label>
                        <input required name="cliente_nombre" class="form-control" maxlength="60">
                    </div>
                    <div class="form-group">
                        <label>Cédula</label>
                        <input required name="cedula" class="form-control" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label>Teléfono</label>
                        <input required name="telefono" class="form-control" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label>Tiempo de estancia</label>
                        <select required name="tiempo_estancia" class="form-control">
                            <option value="2">2 horas</option>
                            <option value="3">3 horas</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Cantidad huéspedes</label>
                        <input name="cantidad_huespedes" type="number" class="form-control" min="1" max="10" value="1">
                    </div>
                    <button type="submit" class="button button-primary w-full mt-2">Confirmar alquiler</button>
                </form>
            </div>
        </div>
    `;
    modal.querySelector('#close-modal-alquilar').onclick = () => {
        modal.innerHTML = "";
        modal.style.display = "none";
    };
    modal.querySelector('#alquilar-form').onsubmit = async (e) => {
        e.preventDefault();
        const form = e.target;
        const data = Object.fromEntries(new FormData(form));
        let horas = Number(data.tiempo_estancia);
        let tiempoObj = await getTiempoEstanciaByHoras(horas, supabase, hotelId);
        if (!tiempoObj) {
            alert('No se encontró el tiempo de estancia.');
            return;
        }
        let precio = tiempoObj.precio || tiempoObj.precio_adicional || 0;
        const inicioAt = new Date();
        const finAt = new Date(inicioAt.getTime() + horas * 60 * 60 * 1000);

        // 1. Crear reserva
        const { data: reservaData, error: errRes } = await supabase.from('reservas').insert([{
            cliente_nombre: data.cliente_nombre,
            cedula: data.cedula,
            telefono: data.telefono,
            habitacion_id: room.id,
            hotel_id: hotelId,
            fecha_inicio: inicioAt.toISOString(),
            fecha_fin: finAt.toISOString(),
            monto_total: precio,
            estado: "activa",
            cantidad_huespedes: Number(data.cantidad_huespedes),
        }]).select().single();

        if (errRes) {
            alert("Error creando reserva: " + errRes.message);
            return;
        }
        const reservaId = reservaData?.id;

        // 2. Movimiento caja
        await supabase.from('caja').insert([{
            hotel_id: hotelId,
            tipo: 'ingreso',
            monto: precio,
            concepto: `Alquiler de ${room.nombre} - ${data.cliente_nombre}`,
            fecha_movimiento: inicioAt.toISOString(),
            usuario_id: null,
            reserva_id: reservaId,
            creado_en: inicioAt.toISOString(),
            actualizado_en: inicioAt.toISOString(),
        }]);

        // 3. Cronómetro
        await supabase.from('cronometros').insert([{
            hotel_id: hotelId,
            reserva_id: reservaId,
            habitacion_id: room.id,
            fecha_inicio: inicioAt.toISOString(),
            fecha_fin: finAt.toISOString(),
            activo: true,
            creado_en: inicioAt.toISOString(),
            actualizado_en: inicioAt.toISOString(),
        }]);

        // 4. Estado habitación
        await supabase.from('habitaciones').update({ estado: 'ocupada' }).eq('id', room.id);

        modal.innerHTML = "";
        modal.style.display = "none";
        await renderRooms(container, supabase, hotelId);
    };
}

async function showExtenderTiempoModal(room, supabase, hotelId, container) {
    const modal = document.getElementById('modal-alquilar');
    modal.style.display = "block";
    let tiempos = await getTiemposEstancia(supabase, hotelId);
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-lg w-full max-w-sm p-6 relative">
                <button id="close-modal-extender" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
                <h3 class="text-xl font-bold mb-4 text-purple-800">${room.nombre} - Extender tiempo</h3>
                <form id="extender-form">
                    <label>Seleccione tiempo a extender:</label>
                    <select name="tiempo_estancia" class="form-control mb-3">
                        ${tiempos.map(t => `<option value="${t.minutos}">${t.nombre} (${t.minutos / 60}h) - $${Number(t.precio || t.precio_adicional || 0).toLocaleString()}</option>`).join('')}
                    </select>
                    <button type="submit" class="button w-full" style="background:#a21caf;color:white;">Confirmar extensión</button>
                </form>
            </div>
        </div>
    `;
    modal.querySelector('#close-modal-extender').onclick = () => {
        modal.innerHTML = "";
        modal.style.display = "none";
    };
    modal.querySelector('#extender-form').onsubmit = async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        const minutosExtra = Number(data.tiempo_estancia);
        const tiempoSel = tiempos.find(t => t.minutos == minutosExtra);
        if (!tiempoSel) {
            alert('No se encontró el tiempo de estancia.');
            return;
        }
        const precioExtra = tiempoSel.precio || tiempoSel.precio_adicional || 0;

        // Buscar reserva activa
        const { data: reservasActivas, error } = await supabase.from('reservas')
            .select('id,fecha_fin,monto_total')
            .eq('habitacion_id', room.id)
            .eq('estado', 'activa')
            .order('fecha_fin', { ascending: false })
            .limit(1);

        if (!reservasActivas || !reservasActivas.length) {
            alert('No se encontró reserva activa para la habitación.');
            return;
        }
        const reserva = reservasActivas[0];
        const fechaFinOriginal = new Date(reserva.fecha_fin);
        const fechaFinNueva = new Date(fechaFinOriginal.getTime() + minutosExtra * 60 * 1000);

        // Actualizar reserva
        await supabase.from('reservas').update({
            fecha_fin: fechaFinNueva.toISOString(),
            monto_total: (reserva.monto_total || 0) + precioExtra
        }).eq('id', reserva.id);

        // Insertar movimiento caja
        await supabase.from('caja').insert([{
            hotel_id: hotelId,
            tipo: 'ingreso',
            monto: precioExtra,
            concepto: `Extensión de tiempo en ${room.nombre}`,
            fecha_movimiento: new Date().toISOString(),
            usuario_id: null,
            reserva_id: reserva.id,
            creado_en: new Date().toISOString(),
            actualizado_en: new Date().toISOString(),
        }]);

        modal.innerHTML = "";
        modal.style.display = "none";
        await renderRooms(container, supabase, hotelId);
    };
}

function startCronometro(room, supabase, hotelId, listContainer) {
    supabase.from('reservas')
        .select('id, fecha_inicio, fecha_fin')
        .eq('habitacion_id', room.id)
        .eq('estado', 'activa')
        .order('fecha_inicio', { ascending: false })
        .limit(1)
        .then(async ({ data, error }) => {
            if (error || !data || !data.length) return;
            const reserva = data[0];
            const cronometroId = `cronometro-${room.id}`;
            const cronometroDiv = listContainer.querySelector(`#${cronometroId}`);
            if (!cronometroDiv) return;

            if (cronometrosInterval[cronometroId]) clearInterval(cronometrosInterval[cronometroId]);
            let tiempoAgotado = false;

            async function updateCrono() {
                const now = new Date();
                const fin = new Date(reserva.fecha_fin);
                let diff = fin - now;
                const badge = cronometroDiv.closest('.card').querySelector('span.inline-block');

                if (diff <= 0) {
                    // Cambia estado visual y en BD solo la primera vez
                    if (!tiempoAgotado) {
                        tiempoAgotado = true;
                        if (room.estado !== "tiempo agotado") {
                            await supabase.from('habitaciones').update({ estado: 'tiempo agotado' }).eq('id', room.id);
                        }
                        if (badge) {
                            badge.textContent = 'tiempo agotado';
                            badge.className = "inline-block px-4 py-1 text-xs rounded-full bg-red-200 text-red-700";
                        }
                    }
                    let diffPos = Math.abs(diff);
                    const h = String(Math.floor(diffPos / 1000 / 60 / 60)).padStart(2, '0');
                    const m = String(Math.floor((diffPos / 1000 / 60) % 60)).padStart(2, '0');
                    const s = String(Math.floor((diffPos / 1000) % 60)).padStart(2, '0');
                    cronometroDiv.innerHTML = `<span style="color:#dc2626;">-${h}:${m}:${s}</span>`;
                } else {
                    const h = String(Math.floor(diff / 1000 / 60 / 60)).padStart(2, '0');
                    const m = String(Math.floor((diff / 1000 / 60) % 60)).padStart(2, '0');
                    const s = String(Math.floor((diff / 1000) % 60)).padStart(2, '0');
                    cronometroDiv.innerHTML = `<span style="color:#2563eb;">${h}:${m}:${s}</span>`;
                }
            }

            updateCrono();
            cronometrosInterval[cronometroId] = setInterval(updateCrono, 1000);
        });
}

// ========== RESERVAR PARA OTRA FECHA ==========
async function showReservaFuturaModal(room, supabase, hotelId, container) {
    const modal = document.getElementById('modal-alquilar');
    modal.style.display = "block";
    let tiempos = await getTiemposEstancia(supabase, hotelId);
    modal.innerHTML = `
        <div class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
            <div class="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
                <button id="close-modal-reserva" class="absolute top-2 right-2 text-gray-500 hover:text-red-600 text-2xl">&times;</button>
                <h3 class="text-xl font-bold mb-4 text-blue-800">Reservar ${room.nombre} para otra fecha</h3>
                <form id="reserva-futura-form">
                    <div class="form-group">
                        <label>Nombre huésped</label>
                        <input required name="cliente_nombre" class="form-control" maxlength="60">
                    </div>
                    <div class="form-group">
                        <label>Cédula</label>
                        <input required name="cedula" class="form-control" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label>Teléfono</label>
                        <input required name="telefono" class="form-control" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label>Fecha de ingreso</label>
                        <input required type="datetime-local" name="fecha_inicio" class="form-control">
                    </div>
                    <div class="form-group">
                        <label>Tiempo de estancia</label>
                        <select required name="tiempo_estancia" class="form-control">
                            ${tiempos.map(t => `<option value="${t.minutos}">${t.nombre} (${t.minutos / 60}h) - $${Number(t.precio).toLocaleString()}</option>`).join('')}
                        </select>
                    </div>
                    <button type="submit" class="button button-primary w-full mt-2">Confirmar reserva</button>
                </form>
            </div>
        </div>
    `;
    modal.querySelector('#close-modal-reserva').onclick = () => {
        modal.innerHTML = "";
        modal.style.display = "none";
    };
    modal.querySelector('#reserva-futura-form').onsubmit = async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.target));
        const minutos = Number(data.tiempo_estancia);
        const inicio = new Date(data.fecha_inicio);
        const fin = new Date(inicio.getTime() + minutos * 60 * 1000);

        // Consulta reservas/cruces
        const { data: reservas } = await supabase.from('reservas')
            .select('fecha_inicio,fecha_fin')
            .eq('habitacion_id', room.id)
            .in('estado', ['activa','reservada']);

        const hayCruce = reservas && reservas.some(r => {
            const inicioExistente = new Date(r.fecha_inicio);
            const finExistente = new Date(r.fecha_fin);
            return (inicio < finExistente && fin > inicioExistente);
        });

        if (hayCruce) {
            alert("No se puede reservar. Hay una reserva que se cruza con el horario seleccionado.");
            return;
        }

        // Precio correcto
        const tiempoObj = tiempos.find(t => t.minutos == minutos);
        const precio = tiempoObj ? (tiempoObj.precio || 0) : 0;

        // Insertar reserva como "reservada"
        await supabase.from('reservas').insert([{
            cliente_nombre: data.cliente_nombre,
            cedula: data.cedula,
            telefono: data.telefono,
            habitacion_id: room.id,
            hotel_id: hotelId,
            fecha_inicio: inicio.toISOString(),
            fecha_fin: fin.toISOString(),
            monto_total: precio,
            estado: "reservada",
            cantidad_huespedes: 1
        }]);
        alert("Reserva creada correctamente.");
        modal.innerHTML = "";
        modal.style.display = "none";
        await renderRooms(container, supabase, hotelId);
    };
}

// ================== Helpers ======================
async function getTiemposEstancia(supabase, hotelId) {
    const { data, error } = await supabase.from('tiempos_estancia')
        .select('*')
        .eq('hotel_id', hotelId)
        .eq('activo', true);
    return data || [];
}
async function getTiempoEstanciaByHoras(horas, supabase, hotelId) {
    const tiempos = await getTiemposEstancia(supabase, hotelId);
    return tiempos.find(t => t.minutos === horas * 60);
}
