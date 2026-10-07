# Corrección de cobros duplicados al extender una estancia

La incidencia reportada el 7 de octubre de 2026 contiene dos ingresos reales de
$60.000 para la misma extensión de la habitación 303 de Marena San Isidro / Hotel OK,
con 3 minutos y 46 segundos de diferencia. Los registros tienen pagos y UUID de
operación distintos: no son dos representaciones del mismo movimiento.

## Causa y cambio

El formulario cobraba primero y después escribía el servicio, la reserva, el
cronómetro y la habitación con solicitudes independientes. Los errores de esas
escrituras no se comprobaban. El servicio de pagos eliminaba el UUID del reintento
al terminar cada cobro, antes de completar la operación principal. Un reintento o
una confirmación repetida podía crear otro pago; el pago mixto también podía repetir
la primera parte si fallaba una parte posterior.

`extender_estancia_reserva_atomica` reúne cobros, servicio, reserva, cronómetro,
habitación y auditoría en una sola transacción. Bloquea la reserva, compara la fecha
de salida anterior y conserva el resultado de cada UUID. Una segunda solicitud con
otro UUID y la misma fecha anterior se rechaza antes del cobro. Otra extensión
legítima del mismo valor usa la nueva fecha anterior y se permite.

Los formularios y servicios comparten las solicitudes que estén en curso. El pago
mixto conserva el bloqueo mientras se confirma; las partes de otros lotes de pagos
conservan su UUID hasta que termina el lote. Los reintentos conservan su identidad
aunque el navegador bloquee sessionStorage.

Un índice único impide dos ingresos `reservation_payment` para el mismo pago. Las
versiones antiguas que todavía intenten cobrar una extensión por pasos reciben un
mensaje para recargar la aplicación, sin registrar cobro.

No se eliminan automáticamente registros históricos por coincidir en importe,
cliente o cercanía temporal: esos criterios también pueden describir pagos válidos.

## Verificación

- 820 pruebas del proyecto y 17 pruebas específicas aprobadas.
- Sintaxis y límites de tamaño de módulos aprobados.
- Lint y compilación de producción aprobados. El chequeo local de tipos de Edge Functions quedó bloqueado por la conexión a esm.sh; debe completarse en CI antes de integrar.
- Pruebas PostgreSQL de reintento, UUID nuevo con fecha anterior, siguiente extensión
  válida del mismo valor, fallo tardío con rollback, pago mixto, importes incompletos,
  turnos cerrados, aislamiento de hoteles, usuarios inactivos y sesiones anónimas.
- Verificación sobre el esquema real de staging mediante
  `scripts/verify-extension-rollback.sql`: un pago, un ingreso, un servicio y un
  cronómetro activo; el reintento conserva los IDs y un formulario obsoleto se bloquea.
  Toda la prueba se revierte, incluidos el hotel y el usuario sintéticos.

La migración es `20261007194220_extension_estancia_atomica.sql`. Aplicar primero en
Supabase y publicar después el frontend. Para verificar el esquema real sin dejar
registros sintéticos, ejecutar `scripts/verify-extension-rollback.sql`.
