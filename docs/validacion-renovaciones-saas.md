# Validacion de Renovaciones SaaS

Guia corta para comprobar que una renovacion, upgrade o downgrade programado quedo bien aplicado despues de pagar en `Mi Cuenta`.

## Antes de probar

- genera un checkout nuevo desde `Mi Cuenta`
- no reutilices links viejos de pago
- toma nota de:
  - `hotel_id`
  - tipo de pago: `renew`, `upgrade` o `renew-downgrade`
  - periodo: `mensual` o `anual`
  - moneda: `COP` o `USD`
  - hora aproximada del pago

## 1. Revisar el hotel

En `Table Editor > hoteles`, busca el hotel y valida estos campos:

- `estado_suscripcion`
- `plan`
- `plan_id`
- `suscripcion_inicio`
- `suscripcion_fin`
- `plan_pendiente`
- `plan_pendiente_id`
- `plan_pendiente_desde`
- `gracia_hasta`

### Resultado esperado segun el caso

#### Renovacion mensual

- `estado_suscripcion = activo`
- `plan` se mantiene igual
- `suscripcion_fin` aumenta `1 mes`
- `plan_pendiente = null`
- `gracia_hasta = null`

#### Renovacion anual

- `estado_suscripcion = activo`
- `plan` se mantiene igual
- `suscripcion_fin` aumenta `12 meses`
- `plan_pendiente = null`

#### Upgrade

- `estado_suscripcion = activo`
- `plan` cambia inmediatamente al plan nuevo
- `plan_id` cambia inmediatamente
- `suscripcion_fin` conserva el final del ciclo actual
- `plan_pendiente = null`

#### Downgrade programado (`renew-downgrade`)

- `estado_suscripcion = activo`
- `plan` sigue siendo el actual mientras dure el ciclo vigente
- `suscripcion_fin` se extiende segun el pago (`1` o `12` meses)
- `plan_pendiente` queda con el plan nuevo mas economico
- `plan_pendiente_desde` debe apuntar al fin del ciclo actual

## 2. Revisar el pago

En `Table Editor > pagos`, filtra por el hotel y por la hora del pago.

Campos a validar:

- `hotel_id`
- `plan`
- `monto`
- `metodo_pago`
- `checkout_reference`
- `provider`
- `payment_type`
- `billing_period`
- `moneda`
- `fecha`

### Resultado esperado

- `checkout_reference` no debe quedar vacio
- `provider` debe ser `wompi` o `mercadopago`
- `payment_type` debe coincidir con el flujo que elegiste
- `billing_period` debe ser `mensual` o `anual`
- `moneda` debe coincidir con la pasarela usada
- no debe duplicarse el pago con el mismo `checkout_reference`

## 3. Revisar cambios de plan

Solo aplica para:

- `upgrade`
- `renew-downgrade`

En `Table Editor > cambios_plan`, valida:

- `hotel_id`
- `plan_anterior`
- `plan_nuevo`
- `fecha`
- `usuario_nombre`

### Resultado esperado

- `upgrade`: debe quedar un cambio registrado de plan anterior a plan nuevo
- `renew-downgrade`: tambien debe quedar registrado, aunque el plan nuevo se active despues

## 4. Consultas SQL utiles

### Ultimo estado del hotel

```sql
select
  id,
  nombre,
  plan,
  plan_id,
  estado_suscripcion,
  suscripcion_inicio,
  suscripcion_fin,
  plan_pendiente,
  plan_pendiente_id,
  plan_pendiente_desde,
  gracia_hasta,
  actualizado_en
from public.hoteles
where id = 'HOTEL_ID_AQUI';
```

### Ultimos pagos SaaS del hotel

```sql
select
  fecha,
  plan,
  monto,
  metodo_pago,
  provider,
  payment_type,
  billing_period,
  moneda,
  checkout_reference
from public.pagos
where hotel_id = 'HOTEL_ID_AQUI'
order by fecha desc
limit 20;
```

### Ultimos cambios de plan del hotel

```sql
select
  fecha,
  plan_anterior,
  plan_nuevo,
  usuario_nombre
from public.cambios_plan
where hotel_id = 'HOTEL_ID_AQUI'
order by fecha desc
limit 20;
```

### Buscar un pago por referencia de checkout

```sql
select *
from public.pagos
where checkout_reference = 'CHECKOUT_REFERENCE_AQUI';
```

## 5. Checklist rapido

- se genero checkout nuevo
- el pago quedo registrado una sola vez
- el hotel quedo `activo`
- la fecha `suscripcion_fin` cambio correctamente
- el plan cambio o no cambio segun el caso
- si fue downgrade, quedo `plan_pendiente`
- si fue upgrade o downgrade, se registro en `cambios_plan`

## 6. Si algo sale mal

Si el pago existe en `pagos` pero el hotel no cambio:

- revisar logs del webhook correspondiente:
  - `wompi-webhook`
  - `mercadopagoWebhook`

Si el hotel cambio pero el pago no se registro:

- revisar conflicto por `checkout_reference`
- revisar si la pasarela reintento el webhook y ya quedo marcado antes

Si el downgrade cambio el plan inmediatamente cuando no debia:

- revisar `plan_pendiente`
- revisar `plan_pendiente_desde`
- revisar si la fecha del ciclo ya habia vencido al momento de pagar
