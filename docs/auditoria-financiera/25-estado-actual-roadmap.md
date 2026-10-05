# Estado actual y pr?ximos pasos financieros

Fecha: 2026-09-09.

## Lectura de la auditor?a

La auditor?a financiera no est? en Fase 1. Los documentos de cierre y el c?digo versionado muestran que el proyecto ya avanz? por las primeras fases del plan maestro:

| Bloque | Estado actual | Evidencia principal |
| --- | --- | --- |
| Fase 1 ? seguridad, trazabilidad y consistencia de cobros | Implementada en staging y producci?n el 2026-08-25 | `20-cierre-fase1.md`, migraciones Fase 1, suite completa |
| Fase 2 ? cuentas y ledger shadow | Implementada en staging y producci?n | `21-fase2-cuentas-ledger-shadow.md`, `finanzas-cuentas.js`, pruebas de ledger |
| Fase 3 ? gastos y cuentas por pagar | Implementada y validada en staging | `22-fase3-gastos-cuentas-por-pagar.md`, `gastos.js`, `fase3-expenses.test.cjs` |
| Fase 4 ? costeo de inventario y CMV | Implementada en shadow y validada en staging | `23-fase4-costeo-inventario-cmv.md`, `costeo.js`, `fase4-costeo.test.cjs` |
| Fase 5 ? estado de resultados, presupuestos y periodos | Implementada en shadow, pendiente de cierre mensual de prueba | `24-fase5-estado-resultados-presupuestos.md`, `finanzas-pnl.js`, `fase5-pnl-reportes.test.cjs` |
| Fase 6 ? conciliaci?n bancaria | Avanzada como piloto separado en `docs/conciliacion-bancaria-v2` | fases 2?25 de conciliaci?n, Edge Functions bancarias y pruebas espec?ficas |

## Pendientes reales detectados

### 1. Cierre mensual financiero de prueba

Antes de tratar el estado de resultados como oficial se debe ejecutar un cierre mensual controlado y conciliarlo contra Caja, CxP e inventarios. El cierre est? dise?ado para rechazar meses con ventas sin costo congelado.

El caso productivo documentado es una venta de `mojarra` por COP 12.000 sin CMV porque el plato no tiene receta configurada. El sistema hizo lo correcto: no invent? un costo. Para cerrar el mes se debe configurar la receta real, verificar costo/existencia de ingredientes, recalcular desde **Costeo y margen** y confirmar que el informe quede sin `cost_issue`. La UI ya gu?a el circuito completo: **Estado de resultados** lista cada pendiente, permite saltar al plato afectado, abre **Costeo y margen** filtrado por pendientes, recalcula CMV y ofrece volver al estado de resultados para intentar el cierre.

### 2. Conciliaci?n bancaria: producci?n y checklist operativo

El piloto bancario tiene fases avanzadas, incluido el ajuste para que recepci?n relacione transferencias desde Caja. El ?ltimo documento indica staging validado y producci?n sin cambios hasta autorizaci?n expl?cita.

Queda pendiente ejecutar el checklist operativo A?H de `docs/conciliacion-bancaria-v2/11-checklist-produccion.md` en el ambiente objetivo, revisar logs/advisors y aceptar riesgos residuales antes de marcar el piloto listo para operaci?n general.

### 3. P0 de usuarios y permisos

El parche P0 de gesti?n de usuarios ya qued? implementado, probado y aplicado en Supabase staging. El frontend staging tambi?n qued? desbloqueado: el repositorio fue vinculado a Vercel por Git, el preflight local pas? y se cre? el preview `https://gestiondehotel-l3nsj335u-cararegoms-projects.vercel.app`, deployment `dpl_GbFn5sVz3yWmAeKx9bNU4McSJq35`, target `preview`, estado `Ready`.

El preview est? protegido por Vercel: la URL p?blica puede mostrar `Login ? Vercel`, pero el contenido real fue verificado con `npx vercel curl` y carga la landing `Software de Gesti?n Hotelera | Gesti?n de Hotel`. Producci?n no fue modificada.

### 4. Fase 7 del plan maestro

Despu?s de estabilizar P&L y conciliaci?n, el siguiente bloque funcional del plan financiero es **activos y pasivos m?nimos**: compras financiadas, pr?stamos, principal, inter?s, cuotas, saldo y exportaci?n simple para contador. Esta fase sigue siendo opcional y no debe iniciarse antes de cerrar la validaci?n mensual y el piloto bancario.

## Orden recomendado desde aqu?

1. Validar funcionalmente el preview de Vercel para el P0 de usuarios con dos hoteles: crear colaborador, cambiar roles/permisos y comprobar rechazo cross-hotel.
2. Resolver el `cost_issue` de Restaurante configurando la receta real de `mojarra` y recalculando CMV cuando el hotel de prueba est? disponible.
3. Ejecutar cierre mensual de prueba en Fase 5 y documentar diferencias contra Caja, CxP e inventario.
4. Completar checklist A?H del piloto bancario en staging/ambiente objetivo.
5. Pedir aprobaci?n expl?cita antes de cualquier despliegue productivo pendiente: P0 usuarios/frontend o conciliaci?n bancaria recepci?n.
6. Solo despu?s, preparar Fase 7 de activos y pasivos m?nimos.

## Verificaci?n local y staging

- Suite completa: **518 pruebas aprobadas, 0 fallidas**.
- Preflight Vercel staging: v?nculo, auth, `vercel.json` y build local OK.
- Vercel inspect: preview `Ready`, target `preview`.
- Vercel curl autenticado: contenido real cargado correctamente detr?s de Deployment Protection.
