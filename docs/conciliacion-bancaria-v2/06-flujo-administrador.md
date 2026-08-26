# Flujo de administrador

El administrador abre Conciliación bancaria desde Reportes, filtra eventos y revisa monto, fecha, pagador, banco y referencia parcial. El detalle debe cargar allocations actuales antes de permitir cambios.

## Acciones

- Relacionar una reserva, habitación y/o varias ventas.
- Asignar monto explícito por destino y ver total/diferencia.
- Confirmar solo con diferencia cero.
- Enviar a revisión o rechazar con motivo.
- Reabrir y redistribuir sin perder relaciones no visibles.
- Consultar auditoría antes/después.

Los candidatos muestran huéspedes/habitaciones o productos/cantidades, total y fecha; el UUID no es el rótulo principal. Las ventas pagadas por transferencia siguen siendo conciliables y no se cobran otra vez.

## Aceptación y rollback

Tres allocations reaparecen seleccionadas tras recargar; otra venta ya conciliada se rechaza; admin de otro hotel no accede. Si falla el nuevo editor se deshabilita la acción de escritura y se conserva lectura/auditoría.
