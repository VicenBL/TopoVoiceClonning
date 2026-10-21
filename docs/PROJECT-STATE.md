# Voice Studio — Estado del proyecto

Documento de continuidad basado en la auditoría de lectura del repositorio y sus registros locales. No sustituye los requisitos originales ni acredita una nueva ejecución de pruebas o una consulta de autoridad RDD.

## Arquitectura y decisiones vigentes

- Frontend React, TypeScript y Vite, con estilos propios y ocho pantallas: Producción, Biblioteca de voces, Clonar voz, Generación TTS, Director emocional, Motores, Historial y Ajustes.
- Datos de demostración centralizados en `src/demoData.ts`; modelos en `src/types.ts`; estado y preferencias persistidos en `localStorage`.
- Electron conserva el frontend existente. El proceso principal administra un único servicio `node:http`, la instancia única, bandeja y apagado.
- Renderer sin acceso directo a Node, con `contextIsolation`, `nodeIntegration: false` y sandbox. El preload expone operaciones específicas mediante `window.voiceStudio.service`, sin IPC genérico público.
- Servicio real restringido a `127.0.0.1`, con `/health`, inicio/parada/reinicio, estados efectivos y diagnósticos. Preferencias de puerto entre 1024 y 65535, inicio automático y continuidad al cerrar.
- Con `keepRunningOnClose` activo, cerrar oculta la ventana y mantiene el servicio. Desactivado, detiene el servicio y sale. «Salir» en bandeja siempre solicita el apagado. El icono se resuelve desde la raíz de la aplicación; su ausencia no debe bloquear el ocultamiento.
- Voces, clonación, trabajos, generación TTS, motores y director emocional siguen siendo demostraciones. No se implementan todavía SQLite, proveedores reales, inferencia, modelos locales, Streamer.bot ni Twitch.
- El texto original debe conservarse literalmente, incluidos `AAAAA---éééé%%%%`, `JAJAJAJAaaaáááá` y `¿¿¿???---!!!`.

Fuentes: `docs/fase-2a-servicio-local.md`, `electron/main.ts`, `electron/service-contract.ts`, `electron/preload-bridge.ts`, `src/App.tsx` y registros ODD.

## Fases y tareas

La Fase 1 está documentada como completada y aprobada visualmente por el usuario, con T1–T5 vinculadas al commit `ca325d4`. La revisión nativa de su candidato fue declinada sin crear lineage. La autorización posterior habilitó exclusivamente la Fase 2A.

La Fase 2A está implementada, pero no cerrada. Su seguimiento formal es:

| Tarea | Estado registrado | Evidencia / entrega |
| --- | --- | --- |
| T1 | Completada | Contrato, Electron y validaciones; commit `794871b`. |
| T2 | Completada | Servidor HTTP local, `/health`, estados, conflictos, reinicio y apagado; commit `883b0f2`. |
| T3 | En curso, implementación existente | Host Electron, preload, IPC, instancia única, bandeja y cierre; sin commit de cierre. |
| T4 | En curso, implementación existente | Integración React con estado real, preferencias persistentes y modal de diagnóstico; sin commit de cierre. |
| T5 | Bloqueada | Verificaciones documentadas; cierre detenido por revisión nativa pendiente. |

La Fase 2B no está autorizada. El empaquetado/instalador definitivo de Windows no forma parte de la entrega actual.

Fuentes: `odd/tasks/voice-studio-fase-1.md` (L18–L20), `odd/tasks/voice-studio-fase-2a.md` (Tasks, L21–L26) y `odd/voice-studio-fase-2a/tasks`.

## Git: instantánea observada en la auditoría

Rama activa: `feat/fase-2a-servicio-local`.

| Commit | Descripción | Referencias locales observadas |
| --- | --- | --- |
| `883b0f2` | `feat: implementa el servicio HTTP local` | HEAD de la rama activa |
| `794871b` | `chore: define el contrato del servicio local` | Antecesor de HEAD |
| `ca325d4` | `feat: incorpora la interfaz inicial de Voice Studio` | `main`, `origin/main` |

Antes de crear este documento había 26 archivos rastreados modificados y 17 archivos nuevos sin seguimiento, sin cambios staged. El diff rastreado mostraba 144 inserciones y 40 eliminaciones, excluyendo contenido binario y archivos nuevos. Comprendía integración de escritorio, React, servicio, pruebas, documentación y evidencia visual.

Estas cifras son históricas de la auditoría, no un contador actualizado: este documento agrega un archivo. No se consultó el remoto; `origin/main` es una referencia local, no prueba del estado actual en GitHub. `odd/` y `AGENTS.md` están ignorados por Git y no forman parte de los commits observados.

## Verificaciones: evidencia histórica frente a comprobaciones actuales

### Resultados históricos documentados

- `npm run test:phase1`: 41/41 comprobaciones y 16 capturas.
- `npm run test:service`: 21/21.
- Prueba enfocada de `configurePort()`: 6/6.
- `npm run build`: satisfactorio.
- `git diff --check`: sin errores; avisos de conversión LF a CRLF.
- Verificación independiente aislada: servicio 21/21, probe 3/3 y build/diff-check; sin blocker reproducido. Esa revisión final no repitió todas las interacciones Electron nativas.
- Otra revisión independiente documentó smoke desktop 60/60 y probe de puertos 10/10.
- Bandeja nativa en desarrollo: ocultamiento, continuidad de `/health` y salida mediante el menú real documentados, con cierre de proceso y listener.
- Aplicación empaquetada temporalmente con el runtime Electron instalado, sin añadir dependencias: suite desktop 60/60. Incluyó controles React, `/health`, conflictos y diagnóstico, instancia única, persistencia y limpieza. No equivale a verificar un instalador definitivo.

Fuentes: `odd/tasks/voice-studio-fase-2a.md` (L13–L25), su espejo local y `artifacts/phase1-ui-check.json`, cuyo encabezado registra 41/41 y 16 capturas.

### Comprobaciones actuales y límites

La auditoría leyó documentación, registros, fuente y metadatos/diffs Git. No ejecutó pruebas, builds, aplicación, consultas al remoto ni operaciones RDD. La creación de este documento tampoco autoriza tales ejecuciones.

Los resultados anteriores no se presentan como pruebas recién ejecutadas ni garantizan que los bytes actuales sigan pasando. La auditoría no acreditó la integridad o reproducibilidad de toda la evidencia temporal histórica.

## RDD pendiente y restricciones

Último estado documentado del lineage `review-068ef6ecf95123a3`:

- START registrado con tier high y cuatro lentes.
- ASSESS previo registrado como `unassessable` por la declaración de archivos sin seguimiento.
- Rechazos históricos del grupo de captura. Tras reabrirse el cierre, un único envío del grupo completo del STATUS vigente volvió a responder `capture-group-rejected`, con `mutation_performed:false`.
- Sin forecast, reviewers ejecutados, veredicto, aprobación ni acknowledgement documentados.
- Última decisión registrada del usuario: «Mantener lineage pendiente», sin nuevas capturas ni abandono.
- T5, cierre de Fase 2A y commit permanecen bloqueados. Push y Fase 2B no autorizados.

Esto es una recuperación documental, no una consulta de la autoridad actual ni una confirmación de su identidad frente al árbol de trabajo actual. Fuente: `odd/tasks/voice-studio-fase-2a.md`, L21–L26.

Si se autoriza retomar RDD, deben respetarse los `collectBindings` exactos del STATUS vigente, conservando campos, valores y orden. Ante `capture-group-rejected`, detener reintentos automáticos y conservar el diagnóstico; que STATUS reofrezca el grupo no autoriza repetirlo.

## Gentle Shell y memoria

Engram está temporalmente inaccesible por una incompatibilidad de Gentle Shell 4.3.0, según la indicación actual del usuario. No migrar, reparar ni inicializar una memoria nueva; no eludir la política de arranque. La continuidad se recuperó de archivos locales, no de historiales completos de Engram.

El usuario informa que hay una corrección de Gentle Shell preparada en un checkout independiente, commit `2d5560c2a`. Este dato se incluye por su solicitud expresa: no fue recuperado ni verificado durante la auditoría del repositorio Voice Studio. No se conoce aquí su diff, validación, integración o disponibilidad en el runtime actual; no debe tratarse como una corrección instalada ni como prueba de que RDD o Engram ya funcionan.

README y AGENTS conservan referencias anteriores al gate pendiente de Fase 1 y a reparaciones de memoria. Los registros ODD posteriores documentan la aprobación de Fase 1 y la autorización de Fase 2A. No se modificaron esos archivos.

## Próximos pasos autorizables — no ejecutados

1. Autorizar una inspección del checkout independiente de Gentle Shell para verificar `2d5560c2a`, su alcance y evidencia; cualquier integración o actualización requiere una decisión separada.
2. Decidir cuándo y cómo retomar la autoridad RDD pendiente, sin asumir que la corrección ya resolvió el rechazo ni repetir automáticamente capturas.
3. Autorizar, si corresponde, comprobaciones actuales sobre un candidato definido; distinguirlas de la evidencia histórica y documentar sus límites.
4. Una vez resuelto el bloqueo, reconciliar T3–T5 y solicitar autorización explícita para el commit final en la rama actual. Publicación, merge y Fase 2B requieren decisiones separadas.

La autorización vigente de esta entrega es únicamente crear este documento y comprobar que no esté ignorado por Git. No autoriza cambios de aplicación, modificaciones de AGENTS/ODD, pruebas, subagentes, operaciones RDD, commit ni push.
