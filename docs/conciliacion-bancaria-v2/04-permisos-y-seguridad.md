# Permisos y seguridad

## Matriz objetivo

| Acción | Recepcionista Marena | Admin Marena | Usuario otro hotel | `anon` |
|---|---:|---:|---:|---:|
| Operar reservas/ventas/Caja según rol actual | Sí | Sí | Solo su hotel, sin piloto | No |
| Ver estado bancario mínimo de su operación | Sí, read-only | Sí | No | No |
| Ver correo/referencia sensible | No | Solo datos enmascarados necesarios | No | No |
| Relacionar, redistribuir, confirmar, rechazar | No | Sí | No | No |
| Modificar evento/auditoría directamente | No | No; solo RPC | No | No |

## Estado auditado

`bank_payment_allocations` y auditoría usan RLS y revocación de acceso directo. `replace_bank_payment_allocations` solo permite `service_role`; `bank-email-api` valida al usuario admin antes de invocarlo. El patrón es correcto y se conserva.

Fase 5 añadió `bank_email_sale_is_reconcilable` como `SECURITY DEFINER` con `search_path` fijo, validación explícita del UUID piloto y ejecución exclusiva de `service_role`. `PUBLIC`, `anon` y `authenticated` no pueden invocarla. El helper legacy `bank_email_sale_is_payable` conserva su contrato para flujos antiguos.

Fase 6 aplica el mismo perímetro a `bank_email_sale_available_amount_cop`: solo `service_role`, `search_path` fijo y retorno nulo fuera del UUID piloto. El RPC conserva validación de administrador en la API y suma exacta antes de reemplazar allocations.

## Reglas

- Nunca exponer `service_role` al navegador.
- RLS y GRANT son capas distintas; ambas deben probarse.
- Ninguna autorización usa nombre del hotel ni `user_metadata` editable.
- RPC privilegiado valida `auth.uid`/actor, hotel, rol y entidad antes de escribir.
- Otro hotel obtiene ausencia/denegación, no información inferible.
- Referencias, metadata y logs permanecen mínimos; nunca tokens ni cuerpo completo del correo.

## Rollback de permisos

Cada migración guardará los grants previos en su documento de despliegue. El rollback restaura funciones/grants específicos; nunca se concede UPDATE general a tablas financieras para resolver un 403.
