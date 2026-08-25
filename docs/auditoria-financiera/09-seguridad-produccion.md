# Fase 0 — seguridad de producción

Estado: **CATÁLOGO PRODUCTIVO INSPECCIONADO EN READ-ONLY**  
Fecha: 2026-08-09. No se probó acceso a otro hotel, no hubo impersonación y no se ejecutaron RPC.

## Antecedente y reanudación mediante Supabase MCP read-only

La auditoría anterior se detuvo porque no había acceso autenticado de catálogo con garantía de solo lectura. Se conserva esa explicación: los hallazgos eran hipótesis estáticas y no debían presentarse como producción. La reanudación usó el MCP `supabase`, ref confirmado `iikpqpdoslyduecibaij`, configuración `read_only=true`, y únicamente lecturas de `pg_catalog`, `information_schema`, advisors y metadatos del proyecto.

## RLS y aislamiento multi-hotel

Producción tiene 86 tablas públicas: **49 con RLS y 37 sin RLS**. Entre las 37 sin RLS están `ventas_restaurante`, `ventas_restaurante_items`, `ingredientes`, `platos`, `platos_recetas`, `bitacora`, `log_caja_eliminados`, `caja_movimientos_eliminados`, `pagos_cargos` y otras tablas operativas. El advisor oficial las clasifica como exposición crítica.

Todas las ACL examinadas conceden `arwdDxt` a `anon`, `authenticated` y `service_role`. En tablas sin RLS eso implica lectura y mutación directa por roles cliente. En tablas con RLS, las policies son la única barrera efectiva.

Se confirmaron policies permisivas abiertas:

- `ventas_tienda`: SELECT/UPDATE/DELETE `USING (true)` e INSERT `WITH CHECK (true)`;
- `detalle_ventas_tienda`: mismo patrón;
- `productos_tienda`: mismo patrón;
- `proveedores`: policies abiertas duplicadas;
- `movimientos_inventario`: SELECT `USING (true)` e INSERT `WITH CHECK (true)` para autenticados.

PostgreSQL combina policies permisivas con OR, así que las policies por hotel paralelas no restauran aislamiento. `caja` sí tiene RLS por `hotel_id`, pero una policy `ALL` permite CRUD a cualquier usuario que resuelva al hotel. `pagos_reserva` ofrece SELECT/INSERT/UPDATE/DELETE por hotel, sin separación de permiso financiero.

**Riesgo multi-hotel: CRÍTICO.** Es una conclusión estructural; no se accedió deliberadamente a datos de otro hotel.

## Funciones/RPC inspeccionadas, sin ejecutarlas

| Función | Seguridad | Validaciones/riesgo |
| --- | --- | --- |
| `abrir_turno_con_apertura` | DEFINER, `search_path=public` | valida `auth.uid`, actor, hotel y turno; EXECUTE también aparece para anon |
| `cerrar_turno_con_balance` | DEFINER, `search_path=public` | valida actor/hotel/propiedad; solo persiste balance agregado |
| `registrar_movimiento_caja_atomico` | DEFINER, `search_path=public` | valida actor, hotel, tipo y turno; ACL demasiado amplia |
| `registrar_y_eliminar_mov_caja` | DEFINER, sin `search_path` | no valida `auth.uid`, rol ni hotel; confía en usuario pasado y borra físicamente; ejecutable por anon/authenticated |
| `increment` | INVOKER, sin `search_path` | SQL dinámico con tabla/columna; no valida actor/hotel/stock; ejecutable por roles cliente |
| `cerrar_pedido_terraza` | DEFINER, `search_path=public` | valida actor y hotel, pero está hardcodeada a un UUID; ACL incluye anon |
| `cerrar_pedido_terraza_mixto` | DEFINER, `search_path=public` | no contiene validación directa `auth.uid()` y delega parcialmente; requiere revisión crítica antes de confiar |

No se encontró SQL dinámico en las funciones críticas salvo `increment`. La ausencia de autenticación directa en el wrapper mixto es riesgo aunque una función interna pueda validar: la autorización debe ser explícita y demostrable en el punto de entrada.

## Triggers, índices y constraints

- Triggers de timestamps en caja/pagos/reservas/productos y Terraza.
- Terraza recalcula totales de pedido tras INSERT/UPDATE/DELETE de items.
- El piloto bancario mantiene expectativas ante cambios/borrado de reservas y pagos.
- No existe unicidad para `caja(pago_reserva_id)`, validación compuesta de tenant ni idempotencia en pagos/ventas.
- Sí existe unicidad de turno abierto por `(hotel_id, usuario_id)`.
- Las tablas bancarias incluyen checks/fingerprints/estados posteriores al snapshot.

## Revalidación C-01 a C-06 y A-01 a A-10

| ID | Resultado | Evidencia productiva |
| --- | --- | --- |
| C-01 | ✅ CONFIRMADO | policies `true` abiertas en tienda/detalle/productos/proveedores |
| C-02 | ✅ CONFIRMADO | 37 tablas sin RLS; restaurante, recetas, bitácora y logs incluidos |
| C-03 | ✅ CONFIRMADO | no hay RPC/idempotencia general; 251 pagos sin caja, ventas sin detalle/caja |
| C-04 | ✅ CONFIRMADO | RPC de DELETE desplegado y 649 movimientos copiados al log de eliminados |
| C-05 | ✅ CONFIRMADO | DEFINER sin auth/search_path, ACL para anon/authenticated |
| C-06 | ✅ CONFIRMADO | no hay costos congelados/CMV; objetos financieros propuestos ausentes |
| A-01 | ✅ CONFIRMADO | 5.778 egresos en `caja`; 85,63% dependen de texto |
| A-02 | ✅ CONFIRMADO | 11.110 reservas difieren; 251 pagos sin caja; 3 con múltiples cajas |
| A-03 | ✅ CONFIRMADO | policies CRUD por hotel en caja/pagos y ACL completas |
| A-04 | ✅ CONFIRMADO | `turnos` solo guarda `balance_final`; no existe detalle de arqueo |
| A-05 | ✅ CONFIRMADO | 4.948 egresos sin referencia estructural; 4.000 quedan en Otros |
| A-06 | ✅ CONFIRMADO | decenas de miles de timestamps cambian de fecha al convertir a Bogotá |
| A-07 | ✅ CONFIRMADO | 844 compras recibidas, estados incompatibles y vínculo ambiguo con caja |
| A-08 | ✅ CONFIRMADO | `increment` desplegada con SQL dinámico, sin auth/hotel |
| A-09 | ✅ CONFIRMADO | no hay idempotency key; señales temporales de posibles duplicados |
| A-10 | ✅ CONFIRMADO | `pagos_cargos` existe pero tiene 0 filas; no hay aplicación operativa |

## Conclusión de seguridad

Los **6 de 6 hallazgos críticos** quedan confirmados. La primera intervención futura debe ser contención de autorización multi-hotel y de RPC peligrosos, pero no debe aplicarse improvisadamente: habilitar RLS sin matriz/policies verificadas puede bloquear producción. Esta auditoría no propone ni ejecuta SQL correctivo.
