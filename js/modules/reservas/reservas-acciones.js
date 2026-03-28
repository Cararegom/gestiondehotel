export function getAccionesReservaHTML(reserva, currentUser) {
    let actions = '';
    const baseClass = 'button text-xs px-3 py-2 rounded-xl shadow-sm font-semibold disabled:opacity-50';
    const estado = reserva.estado;

    if (['reservada', 'confirmada', 'activa'].includes(estado) && reserva.pendiente > 0) {
        actions += `<button class="${baseClass} bg-green-500 hover:bg-green-600 text-white" data-action="abonar" data-id="${reserva.id}">Abonar</button>`;
    }
    if (['reservada', 'confirmada'].includes(estado)) {
        actions += `<button class="${baseClass} bg-yellow-400 hover:bg-yellow-500 text-black" data-action="editar" data-id="${reserva.id}">Editar</button>`;
    }

    switch (estado) {
        case 'reservada': {
            actions += `<button class="${baseClass} bg-cyan-500 hover:bg-cyan-600 text-white" data-action="confirmar" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Confirmar</button>`;

            const fInicioRes = new Date(reserva.fecha_inicio);
            const ahoraRes = new Date();
            const inicioVentanaCheckinRes = new Date(fInicioRes.getTime() - 24 * 60 * 60 * 1000);
            const finVentanaCheckinRes = new Date(fInicioRes.getFullYear(), fInicioRes.getMonth(), fInicioRes.getDate(), 23, 59, 59);
            if (ahoraRes >= inicioVentanaCheckinRes && ahoraRes <= finVentanaCheckinRes) {
                actions += `<button class="${baseClass} bg-blue-500 hover:bg-blue-600 text-white" data-action="checkin" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-in</button>`;
            }

            actions += `<button class="${baseClass} bg-red-500 hover:bg-red-600 text-white" data-action="cancelar_reserva" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar Reserva</button>`;
            actions += `<button class="${baseClass} bg-purple-500 hover:bg-purple-600 text-white" data-action="no_show" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">No Presentado</button>`;
            break;
        }

        case 'confirmada': {
            const fInicioConf = new Date(reserva.fecha_inicio);
            const ahoraConf = new Date();
            const inicioVentanaCheckinConf = new Date(fInicioConf.getTime() - 24 * 60 * 60 * 1000);
            const finVentanaCheckinConf = new Date(fInicioConf.getFullYear(), fInicioConf.getMonth(), fInicioConf.getDate(), 23, 59, 59);
            if (ahoraConf >= inicioVentanaCheckinConf && ahoraConf <= finVentanaCheckinConf) {
                actions += `<button class="${baseClass} bg-blue-500 hover:bg-blue-600 text-white" data-action="checkin" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-in</button>`;
            }
            actions += `<button class="${baseClass} bg-red-500 hover:bg-red-600 text-white" data-action="cancelar_reserva" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Cancelar Reserva</button>`;
            actions += `<button class="${baseClass} bg-purple-500 hover:bg-purple-600 text-white" data-action="no_show" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">No Presentado</button>`;
            break;
        }

        case 'activa':
            actions += `<button class="${baseClass} bg-teal-500 hover:bg-teal-600 text-white" data-action="checkout" data-id="${reserva.id}" data-habitacion-id="${reserva.habitacion_id}">Check-out</button>`;
            break;

        case 'cancelada':
            if (currentUser && currentUser.rol === 'administrador') {
                actions += `<button class="${baseClass} bg-gray-600 hover:bg-gray-700 text-white" data-action="eliminar" data-id="${reserva.id}">Eliminar Permanentemente</button>`;
            }
            break;
    }

    return actions;
}
