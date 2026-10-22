# Voice Studio — Estado del proyecto

**Fase 2A completada oficialmente**, según confirmación del usuario. T1–T5 están terminadas y entregadas localmente; la revisión RDD fue aprobada y su acknowledgement completó el cierre protocolario.

| Referencia | Valor |
| --- | --- |
| Rama de entrega | `feat/fase-2a-servicio-local` |
| Commit final | `f56f022aec9836597e5fcb4303a7b6abb2add838` |
| Padre del commit final | `4139a0ef71d4d4943bbd7ef271f2c0309c38c099` |
| RDD aprobado y cerrado | `review-b4cba67e13da3e9d` |
| Alcance del commit final | 45 archivos: 26 modificados y 19 nuevos |
| Publicación de esta entrega | No se hizo push ni merge |
| Fase 2B | Pendiente de definición y aprobación del alcance. No iniciada |

Esta actualización es una entrega documental independiente y todavía sin commit. No cambia el commit final, sus 45 archivos, el candidato congelado ni la autoridad RDD. Las validaciones de producto citadas son históricas: no se repiten pruebas, builds ni revisiones para actualizar estos documentos.

## Arquitectura y límites actuales

- React, TypeScript y Vite conservan las ocho pantallas y la experiencia de demostración. Los datos demo y modelos están en `src/demoData.ts` y `src/types.ts`.
- Electron posee el servicio `node:http`, la instancia única, la bandeja y el apagado. El servidor escucha exclusivamente en `127.0.0.1`; ofrece `GET /health` y control real desde React.
- El renderer usa `contextIsolation`, sandbox y `nodeIntegration: false`. El preload expone operaciones concretas de servicio; el proceso principal valida IPC y origen, sin puente Node genérico.
- Las preferencias de puerto (`1024`–`65535`), inicio automático y continuidad al cerrar se persisten en `localStorage` y se aplican al host. El puerto predeterminado es `4317`.
- Con `keepRunningOnClose=true`, cerrar oculta la ventana y conserva el servicio; con `false`, lo detiene y sale. «Salir» en bandeja solicita siempre el apagado. Un icono no disponible no bloquea el ocultamiento.
- El cierre temprano espera hasta tres segundos por la primera configuración válida; si no llega, solicita salida segura. Los cambios concurrentes de preferencias se aplican en orden, sin perder campos.
- Los errores del servicio tienen diagnóstico específico y modal. Un fallo al recuperar diagnósticos muestra una advertencia sin invalidar un servicio ya configurado.
- Voces, clonación, TTS, motores, director emocional, trabajos e historial de generaciones continúan en demostración. No hay integración real con proveedores, Streamer.bot o Twitch, inferencia, descarga de modelos ni SQLite.

Se conserva literalmente el texto original, incluidos `AAAAA---éééé%%%%`, `JAJAJAJAaaaáááá` y `¿¿¿???---!!!`. No se entrega un instalador definitivo de Windows. Ninguno de los elementos fuera del alcance actual constituye por sí mismo un requisito aprobado de una fase posterior.

Contrato y comandos: [servicio local](fase-2a-servicio-local.md) y [README](../README.md#comandos-existentes).

## Tareas T1–T5 completadas

| Tarea | Resultado | Commit de entrega |
| --- | --- | --- |
| T1 | Contrato del servicio, Electron, tipos, validación de preferencias y límites de confianza. | `794871b` |
| T2 | HTTP local, `/health`, loopback, estados efectivos, conflictos, reinicio y apagado. | `883b0f2` |
| T3 | Host Electron, preload/IPC restringido, instancia única, bandeja, restauración y cierre seguro. | `f56f022` |
| T4 | React conectado al estado real, controles, preferencias persistentes y modal de diagnóstico; resto demo conservado. | `f56f022` |
| T5 | Validaciones reconciliadas, revisión RDD cerrada y entrega selectiva del candidato aprobado. | `f56f022` |

La Fase 1 había quedado aprobada visualmente y entregada en `ca325d4`. La Fase 2A no rehizo esa interfaz: sustituyó únicamente el servicio simulado por el host y servicio reales autorizados. No se identificaron requisitos funcionales pendientes dentro del alcance de Fase 2A; los avisos informativos de revisión se conservan como seguimiento separado.

El seguimiento interno está en `odd/tasks/voice-studio-fase-2a.md` (L27–L37) y `odd/voice-studio-fase-2a/tasks`, ignorados por Git. Sus registros anteriores de bloqueo no representan el estado actual. No se modifican esos registros en esta entrega documental.

## Validaciones registradas

### Última ronda del candidato aprobado

| Comprobación | Resultado histórico |
| --- | --- |
| Build del renderer, host y preload | PASS |
| Preferencias concurrentes | 2/2 |
| Disponibilidad ante rechazo de diagnósticos | 1/1 |
| Cierre durante el arranque | 4/4 |
| Servicio e integración | 21/21 |
| Escritorio Electron | 60/60 |
| Autocheck de esperas poscierre | 4/4 |
| `git diff --check` | PASS |

Esa ronda se registró antes del nuevo START, sin deriva del contenido seleccionado. Incluye las correcciones TDD de preferencias obsoletas, conflación de disponibilidad/diagnósticos, carrera de cierre inicial, dependencia de artefactos de build y espera pos-salida.

### Evidencia anterior complementaria

- Phase 1: 41/41 comprobaciones y 16 capturas de las ocho pantallas a 1920×1080 y 1024×768; runner adaptado al modo sin host Electron.
- Puertos: prueba enfocada de `configurePort()` 6/6 y probe independiente 10/10; verificación de preservación de ajustes y datos ajenos al servicio.
- Verificación independiente aislada: servicio, build y regresiones, sin blocker reproducido en las comprobaciones documentadas. No todos los verificadores repitieron todos los flujos nativos.
- Bandeja nativa en desarrollo: continuidad de `/health` tras cerrar, restauración y salida mediante la opción real «Salir», con cierre del listener y proceso.
- Paquete temporal construido con el runtime Electron instalado: desktop 60/60 contra `Voice Studio.exe`, sin añadir dependencias ni packager. No equivale a validar un instalador definitivo.

Fuentes de continuidad: registros ODD locales y Engram `voice studio`, especialmente la validación del candidato de 45 rutas y el cierre RDD. Son evidencias de ejecuciones previas, no resultados recién ejecutados por esta actualización. Las capturas rastreadas conservan su carácter histórico.

## RDD aprobado y cierre protocolario

- Lineage: `review-b4cba67e13da3e9d`.
- Tier nativo: `high`; cuatro resultados de risk, resilience, readability y reliability preparados y admitidos.
- Resultado: `approved`. Acknowledgement único autorizado: `native-approved-acknowledgement-completed`, `status:closed`, `authority:burned`.
- Evidencia de consumo: `gentle-ai.review-acknowledged/v1`.
- Revisión consumida: `sha256:c700ffec1d80a1b8873bea1f0d7b1e4b63c3ca8dc87031d875824bb63f6add62`.
- Candidato: `sha256:e95799e44de3afbe61feca22f8efe921b8575b2c052e0ec7d362e57b66cf49bf`.
- Árbol aprobado y árbol del commit final: `f03702851601fa0e19a38224081aa5639b5a1a80`.

El cierre se acredita con la respuesta nativa del acknowledgement ya observada; no se volvió a consultar STATUS después del consumo ni se ejecuta RDD en esta entrega. No queda un cierre RDD pendiente para este candidato.

El lineage anterior `review-068ef6ecf95123a3` terminó `escalated` y se conservó intacto. Es historia de un candidato anterior, no una revisión activa que deba reabrirse. La aprobación RDD no autorizó automáticamente publicar ni comenzar otra fase; el commit final tuvo autorización humana separada.

## Seguimiento no bloqueante

Los seis hallazgos siguientes fueron admitidos como **informativos y no bloqueantes**. No abrieron una corrección, no invalidan la aprobación y no justifican repetir esta revisión. Sus IDs y ubicaciones son los emitidos por el proveedor sobre el candidato revisado; no son nuevas reproducciones de defectos ni tareas aprobadas de Fase 2B.

| Severidad nativa | Hallazgo | Ubicación |
| --- | --- | --- |
| WARNING | `R1-unvalidated-renderer-url` — validación de la URL de arranque del renderer. | `electron/main.ts:14` |
| WARNING | `R2-service-availability-conflation` — observación sobre disponibilidad y diagnóstico. | `src/App.tsx:98` |
| WARNING | `R2-tray-errors-hidden` — visibilidad de errores de bandeja. | `electron/tray-support.ts:19` |
| WARNING | `R3-navigation-redirect` — manejo de navegación/redirección. | `electron/main.ts:73-75` |
| SUGGESTION | `R2-generated-host-one-line` — legibilidad del host generado por el arnés. | `scripts/phase2a-preferences-check.cjs:104` |
| SUGGESTION | `R2-unvalidated-exit-policy` — validación explícita de la política de espera. | `scripts/phase2a-desktop-check.mjs:138-146` |

Su análisis y cualquier corrección posterior requieren un alcance separado. No se presentan como defectos críticos pendientes ni se confunden con las cinco causas ya corregidas mediante TDD.

## Estado de Git y archivos excluidos

El commit final se creó en `feat/fase-2a-servicio-local`, con el mensaje autorizado `feat: completa la integración de escritorio de la fase 2A`. Antes de crearlo se comprobaron las 45 rutas literales, sus blobs/modos frente al árbol aprobado y `git diff --cached --check`. Después se verificaron el mensaje exacto, un único commit nuevo y el árbol completo aprobado.

Fuera de ese commit quedaron los mismos **35 untracked**: 32 archivos bajo `.r3-build-test/`, `gentle-shell-fix.cmd`, `gentle-shell-fix.cmd.lnk` y `scripts/phase2a-diagnostics-check.cjs`. No se alteran ni eliminan. Los 17 artefactos rastreados de interfaz ya incluidos en el candidato son evidencia histórica aprobada, no archivos ajenos que deban retirarse ahora.

Esta entrega modifica sólo `README.md` y `docs/PROJECT-STATE.md`, ambos fuera de los 45 archivos del commit final. No hace staging, commit, push ni merge. La publicación y el segundo commit documental requieren autorización propia; no se afirma un árbol de trabajo completamente limpio mientras existan los documentos modificados y los untracked excluidos.

## Continuidad y método

El proyecto canónico de Engram es **`voice studio`**. La memoria se recuperó mediante la integración de Gentle Shell; las notas anteriores de inaccesibilidad o de reparación son históricas, no un diagnóstico vigente. No se migran almacenes, no se cambian credenciales ni se eluden bloqueos de arranque. Los registros ODD y este documento permiten reconciliar el estado sin repetir la implementación o la revisión cerrada.

Se mantienen **TDD, RDD, KISS, DRY, YAGNI y desarrollo por fases**. Separar requisitos aprobados, trabajo implementado, evidencias históricas y autorizaciones futuras. Un cambio documental no autoriza correcciones de código, revisiones adicionales ni cambios del entorno.

## Fase 2B

**Pendiente de definición y aprobación del alcance. No iniciada**.
