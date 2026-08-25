# Auditoría financiera — flujos de dinero

## 1. Habitación → pago → caja → reporte

```mermaid
sequenceDiagram
  actor U as Recepción
  participant FE as Frontend
  participant R as reservas
  participant P as pagos_reserva
  participant C as caja
  participant REP as Reportes/Cierre
  U->>FE: Registra abono o pago total
  FE->>P: INSERT monto, método, hotel, usuario
  FE->>R: UPDATE monto_pagado
  alt turno activo
    FE->>C: INSERT ingreso con pago_reserva_id
  else sin turno (uno de los flujos)
    FE-->>U: Pago guardado; registre caja manualmente
  end
  REP->>C: SUM(monto) por fecha/tipo/concepto
```

Evaluación:

- El cobro real está duplicado en `pagos_reserva` y `caja`.
- Las escrituras no son atómicas en los flujos activos del navegador.
- `reservas.monto_pagado` es un tercer valor derivado que puede divergir.
- No existe unicidad para impedir dos filas de caja por el mismo pago.
- La reserva puede borrarse junto con pagos; la cancelación también borra caja/pagos.
- Reportes de habitaciones dependen de `reserva_id` o patrones de texto.

### Cargo de consumos a habitación

```mermaid
flowchart LR
  A[Reserva activa] --> S[Servicio]
  A --> T[Venta tienda pendiente]
  A --> R[Venta restaurante pendiente]
  S --> D[Cuenta derivada en frontend]
  T --> D
  R --> D
  D --> P[Uno o varios pagos_reserva]
  P --> C[Uno o varios ingresos caja]
  P --> E[Marcar todos los consumos pendientes pagados]
```

No hay aplicación detallada pago↔cargo. Un pago parcial puede marcar grupos completos como pagados o dejar un agregado difícil de reconstruir.

## 2. Tienda → venta → inventario → caja → reporte

```mermaid
sequenceDiagram
  actor U as Cajero
  participant FE as POS tienda
  participant V as ventas_tienda
  participant D as detalle_ventas_tienda
  participant I as productos_tienda
  participant C as caja
  participant REP as Reportes
  U->>FE: Confirma carrito/pagos
  FE->>V: INSERT cabecera
  loop cada producto
    FE->>D: INSERT detalle
    FE->>I: RPC increment(stock_actual, -cantidad)
  end
  alt pago inmediato
    loop cada método
      FE->>C: INSERT ingreso vinculado a venta
    end
  else cargo habitación
    FE->>V: estado pendiente + reserva_id
  end
  REP->>C: SUM ingresos
  REP->>D: cantidades/subtotales para KPI
```

Riesgos:

- secuencia no transaccional;
- errores de inserts/RPC dentro del bucle no siempre se verifican;
- reintento sin idempotencia;
- no se registra movimiento de inventario de venta en el flujo mostrado, solo decremento genérico;
- no se congela costo;
- precio y descuento se calculan en cliente;
- si se borra caja, una migración reciente intenta restaurar stock, pero borrar una evidencia de cobro no debería deshacer necesariamente la venta física; mezcla reversión financiera e inventario.

## 3. Restaurante → orden/venta → pago → caja → reporte

```mermaid
sequenceDiagram
  actor U as Cajero
  participant FE as POS restaurante
  participant V as ventas_restaurante
  participant I as ventas_restaurante_items
  participant C as caja
  participant INV as ingredientes
  U->>FE: Finaliza venta
  FE->>V: INSERT cabecera pagada/pendiente
  FE->>I: INSERT items
  alt inmediata
    FE->>C: INSERT por método
  else habitación
    FE->>V: reserva_id + pendiente
  end
  Note over I,INV: No se confirmó consumo/costo histórico fiable por venta
```

El RPC histórico `procesar_venta_restaurante_y_caja` es atómico, pero el frontend actual usa escrituras separadas. La función antigua de descuento de ingredientes referencia un modelo de recetas no presente; no debe considerarse prueba de CMV operativo.

## 4. Terraza → pedido → inventario → caja → reporte

```mermaid
sequenceDiagram
  actor U as Mesero/Cajero
  participant P as terraza_pedidos
  participant I as terraza_pedido_items
  participant RPC as cerrar_pedido_terraza(_mixto)
  participant S as stock terraza/tienda
  participant C as caja
  U->>P: Abre pedido
  U->>I: Agrega items
  I-->>P: Trigger recalcula total
  U->>RPC: Cobra consumo + propina
  RPC->>P: Valida y marca pagado
  RPC->>S: Descuenta stock
  RPC->>C: Ingreso(s) consumo/propina
```

Este es el flujo mejor encapsulado. Continúa faltando costo de inventario/CMV, cuenta de propinas por pagar y generalización multi-hotel.

## 5. Gasto → pago → caja/banco → reporte

### Gasto manual actual

```mermaid
flowchart LR
  U[Usuario] --> F[Formulario caja: tipo egreso, monto, concepto, método, fecha]
  F --> RPC[registrar_movimiento_caja_atomico]
  RPC --> C[caja]
  C --> REP[Reporte: SUM egresos y categoría por texto]
```

No hay documento de gasto independiente. Por tanto, el sistema no representa gasto pendiente, fecha de vencimiento, proveedor, comprobante, pago parcial, recurrencia, centro de costo ni cuenta origen.

### Compra tienda actual

```mermaid
flowchart LR
  OC[compras_tienda] --> DET[detalle_compras_tienda]
  DET --> REC[Recepción]
  REC --> INV[Incrementar stock]
  REC --> EST[Marcar recibido]
  REC --> C[Crear egreso(s) caja]
  C --> REP[Reporte]
```

Recepción y pago son una sola acción conceptual, aunque se ejecutan en varias llamadas. No existen factura/saldo/vencimiento.

## 6. Apertura y cierre de turno

```mermaid
flowchart TD
  A[RPC abrir turno] --> T[turnos abierto]
  A --> AP[caja tipo apertura]
  AP --> M[Ingresos/egresos por turno]
  M --> CALC[Clasificación por texto y método]
  CALC --> ARQ[Usuario declara real por método]
  ARQ --> DIF[Diferencia mostrada]
  DIF --> EMAIL[Reporte por correo]
  DIF --> CIERRE[RPC guarda balance_final y fecha]
```

El arqueo y las diferencias no se guardan de forma estructurada. El email es evidencia externa, no fuente transaccional.

## 7. Fechas y corte diario

La fecha de operación puede ser `fecha_movimiento`, `fecha_pago`, `fecha`, `fecha_venta`, `fecha_inicio`, `creado_en` o `created_at`. Varios reportes construyen límites `T00:00:00.000Z` y `T23:59:59.999Z`; Bogotá es UTC-5. Por ejemplo, un pago a las 22:30 de Bogotá corresponde a 03:30Z del día siguiente: según la columna y conversión usada puede asignarse a días distintos.

Recomendación: conservar `occurred_at timestamptz`, `business_date date` calculada con la zona del hotel, `recorded_at`, y una zona horaria obligatoria por hotel. Los cierres deben usar `business_date`, no cortar implícitamente en UTC.

## 8. Conciliación bancaria propuesta

```mermaid
flowchart LR
  V[Venta/cuenta por cobrar] --> E[expected_payment opcional]
  B[bank_transactions importadas] --> M[Motor de matching]
  E --> M
  M -->|único, monto/fecha/ref.| OK[Conciliado]
  M -->|sin venta| SV[Pago sin venta]
  M -->|sin banco| SP[Venta sin pago]
  M -->|monto distinto| MD[Diferencia]
  M -->|fingerprint/ref. repetida| DUP[Duplicado]
  M --> REV[Cola de revisión humana]
  REV --> AUD[Historial inmutable]
```

El piloto local ya aporta parser Bancolombia, fingerprint, eventos, expectativas y auditoría. Para arquitectura definitiva:

1. separar `bank_transactions` de la fuente Gmail; Gmail es un importador, no el modelo bancario;
2. asociar cada transacción a `account_id` y hotel;
3. usar tabla de reconciliaciones N:M o 1:N, no columnas polimórficas `sale_id/sale_type` como única relación;
4. no crear ingresos automáticamente al detectar correo; primero importar, proponer match y confirmar;
5. mantener hash/fingerprint y referencia bancaria únicos por cuenta;
6. permitir diferencias, comisiones, pagos agrupados y pagos parciales;
7. auditar cada cambio y prohibir borrado físico.
