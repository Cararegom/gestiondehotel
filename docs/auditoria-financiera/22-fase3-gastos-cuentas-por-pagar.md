# Fase 3 — Gastos y cuentas por pagar

Estado: implementada y validada en staging el 25 de agosto de 2026.

## Resultado

Se incorporó un registro formal de obligaciones que permite diferenciar la fecha del gasto, su vencimiento y la fecha de cada pago. El módulo es exclusivo para administradores y aparece como **Gastos y cuentas por pagar**.

Incluye:

- categorías contables y centros de costo separados por hotel;
- proveedor, documento y enlace opcional al soporte;
- estados por aprobar, pendiente, pago parcial, pagado y cancelado;
- umbral de aprobación de COP 1.000.000 por defecto;
- pagos parciales y saldo pendiente;
- registro simultáneo del egreso en Caja y en Cuentas financieras;
- operaciones idempotentes para evitar duplicados al reintentar;
- aislamiento RLS y autorización también dentro de cada RPC.

## Decisiones de seguridad y compatibilidad

El navegador no puede insertar, modificar ni eliminar directamente gastos o pagos. Toda mutación pasa por `crear_gasto`, `aprobar_gasto`, `pagar_gasto` o `cancelar_gasto`.

Un gasto con pagos no se puede cancelar. Requiere una futura operación explícita de reversión para conservar el historial. Los pagos continúan escribiendo un egreso en `caja`; el mecanismo shadow de la Fase 2 crea su movimiento en `account_movements` dentro de la misma transacción.

No se convirtieron gastos históricos automáticamente. Esto evita clasificar como cuentas por pagar movimientos antiguos cuya naturaleza no se puede determinar con seguridad.

## Validación en staging

- creación y reintento idempotente: correcto;
- pago de COP 400 y cierre con COP 600: estados `partial` y `paid`;
- dos pagos, dos registros de Caja y dos vínculos al ledger: correcto;
- pago antes de aprobar: bloqueado;
- aprobación de gasto en umbral: correcto;
- lectura del Hotel A desde Hotel B: cero filas;
- intento de mutación cruzada desde Hotel B: bloqueado con código `42501`.

## Archivos

- `supabase/migrations/20260825140000_fase3_gastos_cuentas_por_pagar.sql`
- `js/modules/gastos/gastos.js`
- `tests/fase3-expenses.test.cjs`

## Siguiente fase recomendada

Fase 4: conciliación bancaria y arqueo asistido. Debe comparar los movimientos del ledger con extractos o confirmaciones externas, proponer coincidencias sin confirmarlas silenciosamente y registrar diferencias, responsables y resolución.
