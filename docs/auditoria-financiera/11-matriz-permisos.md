# Fase 1 — matriz de permisos real y propuesta

Fecha: 2026-08-09. Fuente: catálogo productivo consultado mediante MCP read-only y código versionado. Este documento precede a las policies propuestas.

## Modelo real

La identidad es `auth.uid()`. El perfil operativo es `public.usuarios`: `id`, `hotel_id`, `activo` y `rol` textual. En producción hay 13 perfiles activos con `rol=admin`, 32 activos con `rol=usuario` y 8 usuarios inactivos. La segunda capa es `usuarios_roles(usuario_id, rol_id, hotel_id)`:

- `Administrador`: 15 asignaciones;
- `Recepcionista`: 36;
- `Mesero/a`: 3;
- `Gerente` y `Aseador`: sin asignaciones actuales.

Los permisos reales son: `crear_productos_tienda`, `crear_reservas`, `editar_productos_tienda`, `editar_reservas`, `editar_usuarios`, `eliminar_usuarios`, `terraza.cobrar`, `terraza.pedidos`, `terraza.ver`, `ver_caja`, `ver_limpieza`, `ver_mantenimiento` y `ver_usuarios`. `usuarios_permisos` permite override individual, pero no hay permisos financieros específicos para contabilidad, reversión, arqueo o soporte transversal.

## Decisión de autorización

1. Toda operación tenant exige usuario autenticado, perfil activo y coincidencia de `hotel_id`.
2. `usuarios.hotel_id` es la membresía primaria actual. `usuarios_roles.hotel_id` solo amplía capacidades dentro del mismo hotel; no concede acceso transversal.
3. `superadmin` no recibe acceso financiero global. Un perfil sin membresía al hotel es rechazado, aunque su texto de rol diga `superadmin`.
4. Las capacidades nuevas se expresan mediante permisos, no por nombres libres de rol. La migración crea permisos `finanzas.ver`, `finanzas.revertir`, `finanzas.cerrar_turno`, `inventario.ajustar`, `tienda.operar` y `restaurante.operar` y los asigna conservadoramente a roles existentes.
5. Contabilidad y propietario no existen como roles reales. Se habilitarán creando un rol/asignación explícita con los permisos necesarios; nunca se inferirán automáticamente.
6. Soporte transversal futuro requerirá una concesión temporal y auditada separada; queda fuera de Fase 1.

## Matriz funcional

| Intención | Mapeo real | Lectura | Escritura | Operaciones sensibles |
| --- | --- | --- | --- | --- |
| Recepcionista | rol `Recepcionista` o permisos operativos | su hotel y datos necesarios | reservas, cobros/ventas por RPC, turno propio | no DELETE financiero; no reversión |
| Administrador | `Administrador` o `usuarios.rol=admin` con membresía | todo su hotel | administración operativa por RPC | reversión/cierre con permiso y auditoría |
| Mesero | `Mesero/a` + permisos `terraza.*` | Terraza de su hotel | pedidos/cobro por RPC | sin caja global ni borrado |
| Contabilidad | no existe; requiere asignación explícita | finanzas del hotel | RPC financieras autorizadas | nunca DELETE; cierre/reversión según permiso |
| Propietario | no existe; requiere asignación explícita por hotel | finanzas de hoteles asignados | aprobación sensible | nunca acceso implícito por superadmin |
| Superadmin/soporte | texto legacy, sin concesión financiera implícita | ninguna sin membresía/permiso | ninguna | concesión temporal auditada futura |
| Usuario inactivo/sin hotel | cualquier rol | ninguna | ninguna | ninguna |

## Policies propuestas por dominio

| Tabla | SELECT | INSERT/UPDATE | DELETE |
| --- | --- | --- | --- |
| tienda/productos/proveedores | miembro activo del mismo hotel | mismo hotel + permiso operativo | denegado al cliente |
| detalles tienda | tenant derivado de cabecera y `hotel_id` propio | exclusivamente RPC atómico | denegado |
| caja/pagos | miembro activo con necesidad operativa; finanzas amplía lectura | exclusivamente RPC financiera | denegado |
| restaurante/platos/ingredientes | JOIN/mismo hotel | RPC o permiso del dominio | denegado |
| items restaurante | tenant mediante JOIN a venta padre | RPC atómico | denegado |
| inventario | miembro activo de hotel | RPC específica con permiso | denegado |
| bitácora/auditoría/logs | administrador/finanzas del hotel | solo RPC/triggers/backend | denegado |
| Terraza | mismo hotel + `terraza.*` | RPC validadas | denegado salvo transición de pedido por RPC |

## Grants objetivo

| Objeto/rol | Actual | Nuevo | Motivo/dependencia |
| --- | --- | --- | --- |
| tablas financieras / `anon` | ACL CRUD amplia | sin privilegios | no hay flujo financiero anónimo legítimo |
| tablas financieras / `authenticated` | CRUD amplio | SELECT mínimo; escrituras por RPC | RLS no sustituye separación de capacidades |
| RPC financieras / `anon` | EXECUTE por defecto | revocado | requieren `auth.uid()` |
| RPC nuevas / `authenticated` | no existen | EXECUTE explícito | único camino de escritura |
| `service_role` | administrativo | se conserva | backend/operación controlada |
| logs/auditoría / cliente | CRUD amplio | SELECT limitado; sin INSERT/UPDATE/DELETE | preservar evidencia |

Las revocaciones se programan al final, después de migrar callers y pasar pruebas.
