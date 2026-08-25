# Fase 2 — cuentas y ledger shadow

Fecha: 2026-08-25.

## Estado

**FASE_2_SHADOW_IMPLEMENTADA = SÍ**

Desplegada en staging y producción. No reemplaza `caja`, no importa históricos y no modifica reportes oficiales existentes.

## Modelo

- `financial_accounts`: efectivo, banco, billetera/tarjeta o transitoria por hotel;
- `metodos_pago.financial_account_id`: cuenta predeterminada de cada método;
- `account_movements`: entradas y salidas inmutables enlazadas a `caja` o a una transferencia;
- `account_transfers`: transferencia balanceada entre dos cuentas del mismo hotel.

## Proyección shadow

Un trigger unidireccional `AFTER INSERT` sobre `caja` crea el movimiento de cuenta dentro de la misma transacción. Si el método aún no tiene cuenta, crea una cuenta inicial según su nombre y guarda la asignación. La restricción única sobre `caja_id` impide duplicar la proyección.

No existe escritura inversa desde el ledger hacia `caja`. Las transferencias generan `out` e `in` por el mismo monto y deliberadamente no crean ingresos ni egresos operativos en `caja`.

## Seguridad

- RLS por hotel y permiso `finanzas.ver` para lectura;
- permiso `finanzas.cuentas_gestionar` para administradores, gerentes y propietarios;
- transferencias, creación de cuentas y asignación de métodos mediante RPC `SECURITY DEFINER` con `auth.uid()`, hotel y `search_path` seguro;
- escritura directa de movimientos y transferencias revocada a usuarios autenticados.

## Interfaz

Ruta: `#/finanzas-cuentas`.

Permite:

- ver saldos shadow por cuenta;
- crear cuentas con saldo inicial explícito;
- asignar métodos de pago;
- transferir entre cuentas;
- consultar los últimos 100 movimientos;
- visualizar el contador `Caja sin ledger`.

## Evidencia de staging

- recepción de compra proyectada al ledger;
- `caja_without_ledger = 0`;
- transferencia de COP 200 produjo exactamente una salida y una entrada;
- transferencia sin movimientos en `caja`;
- reintento de transferencia devolvió `idempotent=true`;
- creación de cuenta con saldo inicial COP 500;
- asignación de método a cuenta aprobada.
- Hotel B vio cero cuentas de Hotel A y una transferencia cross-hotel fue rechazada.

## Validación

- suite completa: 80/80 pruebas aprobadas;
- staging y producción con las mismas migraciones;
- producción sin migraciones pendientes.

## Límite antes del cutover contable

Los saldos son válidos desde `shadow_started_at` más el saldo inicial configurado. No deben presentarse como saldo bancario histórico ni reemplazar reportes de `caja` hasta ejecutar conciliación diaria durante un periodo acordado y resolver cualquier diferencia.
