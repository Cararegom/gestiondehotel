# Evaluacion de Channel Manager y OTAs

Este documento resume la linea futura de OTAs e integraciones de distribucion.

## OTAs priorizadas

1. Booking.com
2. Airbnb
3. Expedia

## Enfoques posibles

### Opcion A: conectores propios

- Mayor control del producto.
- Mayor complejidad tecnica y de mantenimiento.
- Mas tiempo hasta salir a produccion.

### Opcion B: apoyarse en channel manager tercero

- Reduce tiempo de salida.
- Permite validar demanda comercial mas rapido.
- Puede sacrificar margen o flexibilidad.

## Recomendacion actual

- Priorizar primero señal comercial real desde `integraciones`.
- Medir cuantos hoteles piden Booking.com, Airbnb o channel manager.
- Si la demanda supera un umbral claro, evaluar integracion por partner primero y conectores propios despues.

## Senales para decidir

- Solicitudes registradas en `integraciones_interes`.
- Tipo de hotel: hostal, apartahotel, hotel urbano, vacacional.
- Tamaño del inventario y volumen de reservas.
- Cuanto tiempo manual invierte cada hotel en sincronizar disponibilidad.
