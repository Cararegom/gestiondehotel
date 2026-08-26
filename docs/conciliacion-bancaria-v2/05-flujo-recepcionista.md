# Flujo de recepcionista

La recepcionista continúa trabajando en Reserva, Tienda, Restaurante, Terraza y Caja. Selecciona Efectivo o Transferencia y registra una sola vez la operación. La conciliación nunca le pide recrear el ingreso.

## Experiencia objetivo

1. Registra la operación ya pagada, conforme al proceso de Hotel Marena.
2. Si el método es banco, Caja muestra `Pendiente de verificación`.
3. Cuando un administrador confirma la relación, cambia a `Verificado` en vivo.
4. Una inconsistencia muestra `En revisión administrativa` sin detalles técnicos.
5. Puede cerrar turno aunque Gmail esté temporalmente caído; el bloque bancario es informativo en piloto.

No puede abrir la consola completa, redistribuir, rechazar, editar monto/referencia, borrar eventos ni ver correo. Los errores visibles deben ser humanos; códigos RPC/RLS quedan en logs seguros.

## Aplicado en Fase 8

La campana y el globo persistente continúan avisando que llegó una transferencia, pero solo un administrador ve el enlace para abrirla. Una recepcionista que escriba directamente `#/pagos-bancarios` es bloqueada por el router y, aunque intente invocar la Edge Function, recibe 403 para listado, detalle, candidatos y acciones. El endpoint operativo devuelve únicamente conteos sanitarios preparados para los badges de Caja de la Fase 9.

## Aceptación

Probar recepción Marena y otro hotel. El primero ve solo estados de su operación; el segundo no ve menú, badges, canales Realtime ni datos del piloto. Rollback: ocultar estados y mantener intactos los módulos operativos.
