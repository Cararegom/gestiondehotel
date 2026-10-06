# Permisos y seguridad

## Matriz actual

| Acción | Recepción Marena | Admin Marena | Usuario otro hotel | `anon` |
|---|---:|---:|---:|---:|
| Operar reservas, ventas y Caja según su rol | Sí | Sí | Solo su hotel, sin piloto | No |
| Ver el estado bancario mínimo de movimientos propios | Sí | Sí | No | No |
| Relacionar una transferencia con movimientos exactos de Caja | Sí, solo `link` | Sí | No | No |
| Ver correo, referencia bancaria o metadata de Gmail | No | Solo datos enmascarados necesarios | No | No |
| Redistribuir libremente, confirmar, rechazar o marcar revisada | No | Sí | No | No |
| Modificar eventos, asignaciones o auditoría directamente | No | No; solo mediante API/RPC | No | No |

## Perímetro del flujo administrativo

`bank_payment_allocations` y la auditoría usan RLS y revocación de acceso directo. `replace_bank_payment_allocations` solo permite `service_role`; `bank-email-api` valida al usuario administrador antes de invocarlo.

Los helpers de venta y disponibilidad se ejecutan con `SECURITY DEFINER`, `search_path` fijo, validación del UUID piloto y permisos mínimos. `PUBLIC`, `anon` y `authenticated` no pueden ejecutarlos directamente.

`bank-email-api` exige un administrador activo del hotel piloto para `list`, `detail`, `candidates` y toda `manual-action`. La ruta administrativa y los enlaces de notificaciones aplican la misma restricción. El endpoint `operational-summary` entrega solo conteos agregados y sanitizados.

## Perímetro del flujo de recepción

La relación desde Caja usa la API separada `bank-payment-relation-api`. El servidor verifica:

- sesión autenticada y perfil activo;
- pertenencia al hotel piloto;
- rol operativo permitido, incluido recepción;
- que la acción solicitada esté dentro del contrato reducido;
- que la transferencia y todos los movimientos pertenezcan al mismo hotel;
- que el monto y los destinos operativos coincidan exactamente.

Recepción puede consultar estados sanitizados, buscar candidatos y ejecutar únicamente la acción `link`. No puede invocar desde esta API las acciones administrativas `confirm`, `reject`, `mark_reviewed` ni una redistribución arbitraria.

La respuesta para recepción limita los datos de la transferencia a monto, estado, nombre truncado del remitente y fechas operativas. No devuelve el cuerpo del correo, referencias de Gmail ni metadata bancaria privada.

La escritura se realiza en servidor mediante `replace_bank_payment_allocations_from_caja`. El RPC vuelve a validar cada movimiento, persiste `bank_payment_allocations.caja_id`, registra actor, acción y motivo, y solo puede ejecutarse con `service_role`.

## Reglas permanentes

- Nunca exponer `service_role` al navegador.
- RLS y GRANT son capas distintas y ambas se prueban.
- Ninguna autorización usa el nombre del hotel ni `user_metadata` editable.
- Todo RPC privilegiado valida actor, hotel, rol y entidades antes de escribir.
- Un usuario de otro hotel recibe ausencia o denegación, sin información inferible.
- Referencias, metadata y logs permanecen mínimos; nunca incluyen tokens ni el cuerpo completo del correo.
- Las acciones avanzadas siguen separadas del flujo operativo de Caja.

## Rollback de permisos

Cada migración conserva su procedimiento de rollback. El rollback restaura funciones o grants específicos; nunca concede `UPDATE` general a tablas financieras para resolver un error de autorización.
