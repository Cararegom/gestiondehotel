# Deuda técnica: duplicación, legacy y contraste documentación vs código

> Fuente: código real (abierto archivo por archivo), `git log`/`git show`, `supabase/migrations/`,
> `graphify-out/graph.json` para orientación inicial. No hay acceso en vivo a Supabase — el estado de
> tablas/RPC se infiere de las migraciones versionadas, no de la base remota real.
>
> Este documento **no repite** `docs/legacy-cleanup.md` ni `docs/revision-modulos-especial.md`: verifica
> si siguen vigentes y añade lo que esos dos no cubrían (import maps, versiones paralelas vivas,
> contraste con documentación de producto/roadmap).

## 0. Vigencia de los documentos previos

> **Estado posterior al corte (2026-09-30): M16 corregido como control de deuda.** El roadmap ya no
> presenta la fragmentación como completada, `revision-modulos-especial.md` distingue la cifra histórica
> de la medición actual (3289 líneas) y CI ejecuta `npm run check:module-budgets`. El presupuesto falla
> si `reservas.js` supera esa línea base; las extracciones futuras deben reducir tanto el archivo como el
> límite. La regresión manual y la reducción adicional continúan pendientes en el roadmap.

- **`docs/legacy-cleanup.md` — VIGENTE.** Se verificó con `grep` en todo el repo (excluyendo
  `node_modules`, `graphify-out` y el propio `archive/`) que ninguno de los 12 archivos movidos a
  `archive/legacy/` tiene una referencia activa (`import`, `<script src>`, `require`) desde código vivo.
  La convención se sigue respetando: no se detectaron archivos nuevos "sueltos" (backup/old/extract) por
  fuera de `archive/legacy/` en los módulos que ya fueron limpiados (`caja`, `reservas`, `tienda`,
  `mapa-habitaciones`).
- **`docs/revision-modulos-especial.md` — VIGENTE en su diagnóstico de riesgo, DESACTUALIZADO en una
  cifra.** El documento (corte 2026-03-28) afirma que `reservas.js` "ya bajó a 2853 líneas" tras el
  refactor. Hoy `reservas.js` tiene **3291 líneas** (`wc -l`), es decir **creció ~438 líneas** desde esa
  revisión en vez de seguir bajando — contradice la narrativa de "refactor ya completado" del propio
  `docs/roadmap-mejoras.md` (ítem 12, marcado `[x]`). `caja.js` sí coincide razonablemente: doc dice 740,
  hoy son 778 líneas (deriva menor, aceptable). El resto de la priorización (reservas > caja >
  mapa-habitaciones > reportes > ...) sigue siendo un diagnóstico razonable y no se contradice con nada
  encontrado en esta revisión.

## 1. Archivos duplicados / legacy

| Archivo | Tipo | ¿Tiene consumidores reales hoy? | Evidencia | Estado recomendado |
|---|---|---|---|---|
| `js/modules/control-energia/control-energia.js` | Versión "canónica" del módulo, activamente editada | **Depende del contexto**: `js/main.js` la referencia literalmente (`import('./modules/control-energia/control-energia.js')`), pero un `importmap` en `app/index.html` (línea 130) **redirige esa ruta en runtime** hacia `control-energia-20260902.js?v=2`. El navegador nunca ejecuta el contenido real de `control-energia.js`. | Import map en `app/index.html:127-133`; `sw.js:15` precachea solo la versión `-20260902`; `tests/energy-module-loading.test.cjs` afirma explícitamente el import map y que `main.js` importa la ruta sin fecha. | **CRÍTICO — no archivar, pero reconciliar.** Ver hallazgo detallado en §2. No es código muerto en el sentido clásico: es código que se sigue editando pensando que es el que corre, pero no es el que corre. |
| `js/modules/control-energia/control-energia-20260902.js` | Snapshot fechado, es el que realmente se ejecuta | Sí — es el destino real del import map, está en `sw.js` (precache) y en las aserciones de los tests | Igual que arriba | Activo en producción; falta que reciba las correcciones que sí se aplicaron al otro archivo (ver §2) |
| `js/modules/caja/caja.backup-20260316-204706.js` | Backup manual | No | Vive en `archive/legacy/`, cero referencias en código vivo | Ya archivado correctamente — mantener |
| `js/modules/reservas/reservas.backup-20260316-213103.js` | Backup manual | No | Igual, en `archive/legacy/` | Ya archivado correctamente — mantener |
| `js/modules/tienda/tienda.backup-20260317-000459.js` | Backup manual | No | Igual, en `archive/legacy/` | Ya archivado correctamente — mantener |
| `js/modules/mapa-habitaciones/mapa-habitaciones.old.js`, `mapa-habitaciones.github.js`, `extract.js`, `extract_modals.js`, `extracted-modal.js`, `fix_alquiler.js`, `remove_dups.js`, `replace-modal.js`, `diff.patch` | Utilidades de extracción/parcheo manual, ya históricas | No | Todos en `archive/legacy/`, cero referencias activas | Ya archivados correctamente — mantener |
| `js/modules/faq/Tienda.mp4`, `Tienda - copia.mp4` y `Restaurante.mp4` | Videos locales sin consumidor; los dos de Tienda eran idénticos | No | `faq.js` usa exclusivamente URLs de Google Drive y miniaturas PNG. Los dos archivos de Tienda compartían SHA-256 y tamaño exactos; no había ninguna referencia a los MP4 locales. | **Corregido después del corte:** se retiraron los tres videos del árbol activo y una prueba impide su reaparición. Git conserva el historial. |
| `gestion de tales.rar` (raíz del repo, 37,54 MiB) | Archivo comprimido de respaldo | No | La revisión posterior corrigió el diagnóstico original: el archivo sí estaba versionado, aunque `.vercelignore` evitaba su despliegue. No tenía consumidor de runtime. | **Corregido después del corte:** se retiró del árbol activo; `*.rar` queda excluido por Git y Vercel. El historial permite recuperarlo. |
| `prueba-google-watch/` (con `package.json`/`package-lock.json`, dependencia `googleapis`) | Proyecto Node aislado de prueba | No — no se importa desde ningún `.js`/`.html` del proyecto principal | Está listado explícitamente en `.vercelignore`; `grep` en todo el repo no encontró ninguna referencia fuera de sí mismo | Aislado y sin efecto en producción — recomendación: mover fuera del repo principal (o a un repo propio) para que no genere confusión sobre si es parte del sistema, pero no es urgente |

## 2. Implementación paralela viva: `control-energia.js` vs `control-energia-20260902.js` (CRÍTICO)

> **Estado posterior al corte (2026-09-10): corregido y probado en preview.** Se retiró el import map, `js/main.js` carga directamente `control-energia.js` con versionado por query string y el archivo fechado quedó reducido a un puente de compatibilidad que reexporta la implementación canónica. El service worker renovó su versión y precarga el mismo asset que ejecuta la aplicación. La prueba `tests/c6-energy-runtime.test.cjs` sigue la ruta efectiva desde `main.js` y verifica que el código alcanzado contiene el arreglo de cámara. Evidencia completa en [16-estado-implementacion.md](16-estado-implementacion.md).

Esto es más grave que un simple "duplicado legacy": son **dos copias completas y divergentes del mismo
módulo, ambas dentro del árbol activo**, donde una se sigue desarrollando y la otra es la que realmente
corre.

**Mecanismo confirmado (`app/index.html:127-133`):**

```html
<script type="importmap">
  { "imports": {
      "/js/modules/control-energia/control-energia.js": "/js/modules/control-energia/control-energia-20260902.js?v=2"
  } }
</script>
```

`js/main.js:64` hace `import('./modules/control-energia/control-energia.js')` — pero gracias al import
map de arriba, el navegador resuelve y descarga en realidad `control-energia-20260902.js`. El archivo
`control-energia.js` **nunca se ejecuta en producción**, aunque el nombre sin fecha sugiera que es "el
módulo real" y el otro sea un respaldo puntual.

**Por qué es crítico — evidencia de un fix perdido:** `git log` muestra que ambos archivos comparten
historia hasta el commit `d3638e3` (2026-09-02), pero después `control-energia.js` recibió un commit
adicional que `control-energia-20260902.js` nunca recibió:

```
55eb53f  Evita bloqueo del escáner QR de energía   (4 sep 2026) → SOLO en control-energia.js
```

Ese commit agrega manejo de timeouts (`ENERGY_SCANNER_STOP_TIMEOUT_MS`, `withTimeout()`), reporte de
errores a monitoreo (`reportEnergyError` → `HotelMonitoring.captureException`) y una UI de reintento
(`renderScanRetry`) para evitar que el escáner de cámara se quede bloqueado. Es decir: **se corrigió un
bug de bloqueo de cámara el 4 de septiembre, pero el fix se escribió en el archivo equivocado** y nunca
llegó a producción, porque `control-energia-20260902.js` (633 líneas, sin el fix) sigue siendo el único
archivo:
- referenciado por el import map,
- precacheado por el service worker (`sw.js:15`),
- afirmado por `tests/energy-module-loading.test.cjs` como la fuente real.

Los tests existentes (`tests/control-energia-syntax.test.cjs`, `tests/energy-module-loading.test.cjs`)
verifican que *ambos* archivos tengan sintaxis válida y que el import map/service worker apunten al
archivo fechado — pero ningún test verifica que el contenido de ambos archivos esté sincronizado. Los
tests pasan hoy mismo aunque el fix del 4 de septiembre esté ausente del código que corre.

**Impacto funcional probable:** el problema de "bloqueo del escáner QR de energía" que motivó el commit
`55eb53f` probablemente sigue reproduciéndose en producción, porque el fix vive en un archivo inerte.

**`js/energy-module-recovery.js`** (cargado antes que `main.js` en `app/index.html:134`) es un
manejador de emergencia que detecta errores de sintaxis o de módulo dinámico al navegar a
`#/control-energia` y muestra una pantalla de "recarga la app" — esto sugiere que este patrón de import
map + archivo fechado ya causó incidentes de caché en producción antes, y el `-20260902` fue la
respuesta reactiva (fijar una copia conocida-buena vía import map en vez de resolver la causa raíz de
caché del service worker).

**Recomendación de estado (no de borrado):** no archivar ninguno de los dos. Definir cuál es la fuente
de verdad real, portar manualmente el commit `55eb53f` al archivo que efectivamente se sirve (o eliminar
el import map y volver a servir `control-energia.js` directamente una vez resuelto el problema de caché
que motivó la redirección), y añadir un test que compare ambos archivos byte a byte o que falle si
divergen, para que esta situación no se repita silenciosamente.

## 3. Otros patrones de "código paralelo" (no duplicados de archivo completo)

> **Estado posterior al corte (2026-10-01): M17 corregido y probado.**
> `tests/m17-runtime-extension-contracts.test.cjs` mantiene un inventario de las diez extensiones
> cargadas directamente por `app/index.html`, exige una única URL versionada para cada una, conserva el
> orden recuperación → `main.js` → extensiones y cruza cada selector/evento con el módulo base que lo
> publica. También verifica las dos extensiones encadenadas mediante imports dinámicos. El bootstrap de
> conciliación bancaria recibió la versión de caché que le faltaba.

- **Capa de "enhancer"/"bootstrap"/"hotfix" cargada aparte en `app/index.html`:** además de los módulos
  montados por `main.js`, hay al menos 9 scripts sueltos cargados directamente en el HTML con su propio
  query string de versión (`js/mapa-saldo-enhancer.js`, `js/mapa-consumos-pagos-enhancer.js` —importado
  *dentro* del anterior, no huérfano—, `js/modules/usuarios/usuarios-archivo-enhancer.js`,
  `js/habitaciones-tarifas-bootstrap.js`, `js/mapa-tarifas-programadas-bootstrap.js`,
  `js/tarifas-programadas-simulador-bootstrap.js`, `js/tarifas-programadas-admin-guard.js`,
  `js/usuarios-crear-colaborador-hotfix.js`, `js/user-active-session-guard.js`,
  `js/bank-payment-reception-bootstrap.js`, `js/energy-activation-guard.js`). Todos tienen consumidor
  real (se cargan desde `app/index.html`), así que ninguno es código muerto. Pero es un patrón de
  "parchar por fuera" en vez de integrar la lógica dentro del módulo dueño de la pantalla — cada uno se
  versiona con su propio `?v=fecha-descripcion` en el HTML, lo que hace que rastrear qué versión de qué
  parche está activa dependa de leer manualmente `app/index.html` completo. No es duplicación de lógica
  de negocio (se verificó que `mapa-saldo-enhancer.js` y `usuarios-archivo-enhancer.js` hacen cosas
  distintas entre sí y de sus módulos base), pero sí es fragmentación arquitectónica que aumenta el
  riesgo de que un cambio en el módulo base rompa un enhancer sin que nadie lo note (no hay tests que
  crucen ambos lados en todos los casos).
- **`prueba-google-watch/`** trae su propia dependencia (`googleapis`) que no aparece en el
  `package.json` raíz del proyecto — confirma que es un experimento totalmente aislado (probable prueba
  de integración con Google Calendar/Watch API) y no un módulo en desarrollo activo dentro del sistema
  real.

## 4. Documentación vs código

> **Estado posterior al corte (2026-09-15): A18 corregido.** El ítem 49 de `docs/roadmap-mejoras.md` volvió a estado pendiente y ahora distingue el andamiaje existente de las capacidades funcionales que faltan. `docs/multi-propiedad-plan.md` también declara el avance parcial, marca sus fases pendientes y define un criterio verificable para considerar completa la primera fase.

| # | Afirmación en doc | Doc | ¿Vigente? | Verificación en código |
|---|---|---|---|---|
| 1 | "Gaps todavía abiertos: Channel manager real y conectores OTA operativos... Multi-propiedad profunda con vistas consolidadas por cadena" | `docs/producto-vivo.md` (marzo 2026) | **VIGENTE** | No se encontró ningún conector OTA real (Booking/Airbnb/Expedia) fuera de menciones de catálogo/evaluación en `integraciones.js` e `integrationCatalog.js`. `grupos_hoteleros`/`grupo_hoteles` solo se usan en `js/modules/ops-saas/ops-saas.js` como un contador (`saas_resumen_grupos_hoteleros`) en el panel de superadmin — no hay vista consolidada por cadena para el hotel/grupo mismo. El gap sigue existiendo tal como lo describe el doc. |
| 2 | El ítem 49 del roadmap presentaba "Preparar el sistema para multi-propiedad" como **Completado** `[x]` | `docs/roadmap-mejoras.md` | **CORREGIDO DESPUÉS DEL CORTE** | El ítem está ahora pendiente `[ ]` y enumera por separado la base existente —tablas y resumen numérico para superadmin— y las capacidades faltantes: gestión funcional, acceso multi-hotel, cambio de sede, permisos por grupo y reportes consolidados. `docs/multi-propiedad-plan.md` conserva esas fases abiertas y define cuándo podrá marcarse completada la Fase 1. |
| 3 | "`Mantenimiento` ya permite frecuencia preventiva... y reprograma automáticamente la siguiente tarea" (roadmap ítem 20) | `docs/roadmap-mejoras.md` | **VIGENTE** | Confirmado en `js/modules/mantenimiento/mantenimiento-domain.js`: existen `normalizeTaskFrequency()`, `calculateNextScheduledDate()`, `getWorkflowAction()`, y el módulo está fragmentado en `mantenimiento-{repository,ui,workflow-ui,mobile-ui,preventivo}.js` como describe también `docs/auditoria-integral-2026/02-arquitectura-actual.md`, que lo señala como "mejor ejemplo de arquitectura del repo". Consistente. |
| 4 | Ítem 12 del roadmap: "Terminar de fraccionar los módulos monolíticos que siguen pesados. **Completado**" (refiriéndose en general a la deuda técnica de módulos grandes) | `docs/roadmap-mejoras.md` | **PARCIALMENTE DESACTUALIZADO** | El propio roadmap, dos secciones más abajo ("Módulos que merecen revisión especial"), deja sin marcar `[ ]` a `reportes`, `restaurante`, `clientes`, `limpieza`, `habitaciones` y `mapa-habitaciones`, y aclara que `reservas`/`caja` solo completaron la partición técnica pero falta regresión funcional. Además `reservas.js` **creció** de 2853 a 3291 líneas desde el corte de `revision-modulos-especial.md` (ver §0), lo que contradice la idea de que la fragmentación esté "terminada" incluso para el módulo que se cita como ejemplo de éxito. El ítem 12 debería redactarse como "en progreso", no "completado". |
| 5 | "`Integraciones` ya muestra una línea OTA priorizada (Booking.com, Airbnb, Expedia, channel manager)" (roadmap ítem 43) y `docs/channel-manager-evaluacion.md` (documento de evaluación, no de feature terminada) | `docs/roadmap-mejoras.md` / `docs/channel-manager-evaluacion.md` | **VIGENTE** | `js/modules/integraciones/integraciones.js` e `integrationCatalog.js` sí mencionan Booking.com/Airbnb/Expedia. El doc de evaluación es explícito en que es una decisión pendiente ("Recomendación actual: priorizar primero señal comercial... si la demanda supera un umbral claro, evaluar"), no afirma que exista integración real — coherente con lo que hay en código (catálogo de interés, no conector). |
| 6 | "`archive/legacy/` no forma parte del runtime de la app" | `docs/legacy-cleanup.md` | **VIGENTE** | Confirmado con grep exhaustivo (ver §0). |
| 7 | Ítem 11 del roadmap: "respaldos, parches manuales y utilidades legacy de `caja`, `reservas`, `tienda` y `mapa-habitaciones` quedaron archivados en `archive/legacy/`" | `docs/roadmap-mejoras.md` | **VIGENTE** | Coincide exactamente con el listado de `docs/legacy-cleanup.md`, verificado archivo por archivo. |

## 5. Resumen de severidad

- **CRÍTICO:** `control-energia.js` vs `control-energia-20260902.js` — un fix de bug de producción
  (bloqueo de escáner QR, commit `55eb53f`) fue escrito en el archivo que el import map de
  `app/index.html` hace inalcanzable en runtime. El fix nunca llegó a los usuarios.
- **ALTO, corregido después del corte:** el roadmap de multi-propiedad ya refleja el avance parcial y
  coincide con `docs/investment-readiness.md`; el producto consolidado por cadena continúa como trabajo
  pendiente explícito.
- **MEDIO:** `reservas.js` volvió a crecer (2853 → 3291 líneas) después de que la documentación diera
  por cerrado el refactor de fragmentación; conviene una re-medición periódica en vez de fiarse de la
  cifra congelada en el doc de marzo.
- **MEDIO:** Patrón de "enhancer/bootstrap/hotfix" cargado aparte en `app/index.html` (11 scripts) sin
  test cruzado que garantice que siguen funcionando si el módulo base cambia.
- **BAJO, corregido después del corte:** se retiraron los tres MP4 locales sin consumidores y el
  respaldo `gestion de tales.rar`; en total salieron 254,68 MiB del árbol activo. Los tutoriales del
  FAQ continúan en Google Drive y los patrones de exclusión evitan que estos artefactos reaparezcan.
- **BAJO:** `prueba-google-watch/` está correctamente aislado (en `.vercelignore`, sin imports desde el
  sistema real) pero sigue viviendo dentro del repo principal.

## 6. Lo que está bien gestionado

- La convención `archive/legacy/` documentada en `docs/legacy-cleanup.md` se cumple al 100 %: los 12
  archivos movidos allí no tienen ni un solo consumidor activo hoy, y no aparecieron archivos nuevos
  "sueltos" tipo backup/old fuera de esa carpeta en los módulos ya limpiados.
- El módulo `mantenimiento` (`mantenimiento-{repository,ui,workflow-ui,mobile-ui,domain,preventivo}.js`)
  es un ejemplo real de separación de responsabilidades sin duplicación — no se encontró lógica repetida
  entre esos archivos, cada uno tiene un rol claro y `mantenimiento.js` quedó como fachada de 10 líneas.
