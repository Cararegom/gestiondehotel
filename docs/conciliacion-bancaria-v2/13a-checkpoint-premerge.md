# Checkpoint previo a Fase 14/24

Estado: aprobado para integrar, sin iniciar Fase 14.

## Controles incorporados

- La disponibilidad bancaria se resuelve en servidor mediante `hotel_features`; el navegador falla cerrado y ya no compara el nombre del hotel.
- Solo Hotel Marena San Isidro tiene habilitada `bank_reconciliation_v2`.
- En el piloto no se permite editar el metodo de un movimiento de un turno cerrado. La correccion debe hacerse mediante reversion o ajuste administrativo trazable.
- Un cambio de cuenta `cash` a `bank` exige un motivo limpio, no vacio y de hasta 500 caracteres.
- La auditoria guarda actor, hotel, movimiento, turno, metodo y cuenta anterior/nueva, motivo, fecha y estados antes/despues.
- El aviso a administradores se intenta de forma independiente y su fallo no revierte el cambio financiero.
- La idempotencia bancaria usa exclusivamente `(hotel_id, gmail_message_id)`. Dos mensajes Gmail distintos se conservan aunque monto y hora coincidan.

## Verificaciones de produccion

- Funcion real inspeccionada con `pg_get_functiondef`.
- `authenticated` puede ejecutar el RPC; `anon` no.
- `hotel_features` tiene RLS y no ofrece lectura directa a `anon` ni `authenticated`.
- Auditoria Fase 13: 406 movimientos shadow, 0 sin ledger y 0 divergentes.
- Aislamiento: 0 cruces en allocations, metodos/cuentas y ledger/Caja.
- Duplicados por identidad Gmail: 0.
- Suite: 152 pruebas aprobadas, sin fallos; sintaxis, typecheck y lint aprobados.

Los avisos historicos de los asesores de Supabase permanecen fuera del alcance de este checkpoint; el objeto nuevo no agrega exposicion publica. No se crearon tablas futuras de movimientos bancarios.
