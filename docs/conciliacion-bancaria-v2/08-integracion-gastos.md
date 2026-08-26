# Integración con Gastos y salidas bancarias

Las transferencias salientes detectadas (`sent` / `outgoing_transfer_detected`) no son ingresos fallidos ni egresos automáticos de Caja. Deben entrar a una futura bandeja administrativa “Movimientos bancarios por clasificar”.

Destinos posibles: gasto existente, nuevo gasto, cuenta por pagar, transferencia entre cuentas, retiro propietario, devolución u otro. La clasificación enlazará evidencia bancaria con las tablas de gastos/cuentas de las migraciones `fase3_gastos_cuentas_por_pagar` y con ledger; no creará un segundo gasto si ya existe.

En esta iteración queda solo el diseño porque mezclar salida e ingreso aumenta el riesgo del piloto. Aceptación futura: salida nunca aparece como ingreso negativo a recepción, clasificación es admin-only, idempotente y auditada. Rollback: desactivar la bandeja y conservar el evento sin clasificar.
