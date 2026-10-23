# Voice Studio

Aplicación de escritorio Windows con interfaz React/TypeScript y host Electron. **Fase 2A completada**: el servicio HTTP local y sus controles son reales; voces, clonación, generación TTS, motores y director emocional siguen en modo demostración.

- Commit de cierre: `f56f022aec9836597e5fcb4303a7b6abb2add838`.
- RDD aprobado y cerrado: `review-b4cba67e13da3e9d`, con acknowledgement completado.
- Fase 2B: **Tarea 1 implementada; verificación independiente pendiente**. La selección nativa de un archivo local de audio/vídeo no reproduce ni procesa medios.

## Abrir la aplicación

Con Node.js/npm y las dependencias del proyecto instalados:

```bash
npm install
npm run build
npm run start:desktop
```

Electron carga el renderer compilado y gestiona el servicio sin una ventana CMD adicional para el servidor. En Ajustes se pueden cambiar el puerto, el inicio automático y la continuidad al cerrar la ventana.

Para trabajar sólo en la interfaz con Vite:

```bash
npm run dev
```

Abrí la URL local que imprime Vite, normalmente `http://127.0.0.1:5173/`. **El navegador por sí solo no tiene el preload de Electron**: muestra «Host de escritorio no disponible» y deshabilita los controles del servicio, en lugar de simular que está activo.

El uso conjunto de Electron y Vite está descrito en [el contrato del servicio local](docs/fase-2a-servicio-local.md#ejecución-de-escritorio). `npm run preview` permite previsualizar el renderer ya compilado, también sin host Electron.

## Qué está implementado

| Área | Estado actual |
| --- | --- |
| Interfaz | Ocho pantallas: Producción, Biblioteca de voces, Clonar voz, Generación TTS, Director emocional, Motores, Historial y actividad, Ajustes. |
| Servicio local | Un servidor `node:http` en el proceso principal, limitado a `127.0.0.1`; puerto predeterminado `4317`, configurable entre `1024` y `65535`. |
| Control y diagnóstico | Inicio, parada y reinicio desde React; estados efectivos, detección de conflictos y modal de diagnóstico específico. `GET /health` confirma el servicio real. |
| Preferencias | Puerto, inicio automático y continuidad al cerrar persistidos en `localStorage` y aplicados al host. |
| Ciclo de vida | Instancia única, bandeja, restauración y apagado con limpieza del servicio. |
| Aislamiento | Renderer sin acceso directo a Node; `contextIsolation`, sandbox y preload con operaciones concretas e IPC validado. |

Con `keepRunningOnClose` activado, cerrar oculta la ventana y mantiene el servicio. Desactivado, detiene el servicio y sale. «Salir» en bandeja siempre solicita el apagado. Un icono ausente o ilegible no bloquea el ocultamiento. Si el cierre ocurre antes de recibir las preferencias iniciales, el host espera como máximo tres segundos y, si no llegan, solicita una salida segura.

Contrato, endpoint, IPC y comportamiento detallados: [Fase 2A — Servicio local](docs/fase-2a-servicio-local.md).

### Qué sigue siendo demostración

Las voces y versiones, referencias de audio, motores, cola, generaciones TTS, comparaciones A/B y planes emocionales utilizan datos simulados centralizados en `src/demoData.ts`. Se conservan las interacciones entre pantallas y el estado demo; no se genera audio real ni se conecta con Streamer.bot o Twitch.

No hay proveedores TTS reales, inferencia, modelos descargados, claves API reales ni director emocional con IA. Tampoco se entrega un instalador definitivo de Windows. Estas ausencias describen los límites actuales, **no requisitos aprobados de una fase posterior**.

El texto introducido se conserva literalmente, incluidos `AAAAA---éééé%%%%`, `JAJAJAJAaaaáááá` y `¿¿¿???---!!!`.

## Comandos existentes

Los comandos siguientes ya están definidos en `package.json`; esta actualización documental no los ejecuta ni los modifica.

| Comando | Uso |
| --- | --- |
| `npm run dev` | Renderer Vite en loopback, sin host Electron. |
| `npm run build` | TypeScript, host/preload Electron y renderer Vite. |
| `npm run build:electron` | Compila el host y empaqueta el preload. |
| `npm run preview` | Previsualiza el renderer compilado. |
| `npm run start:desktop` | Abre Electron; requiere build previo. |
| `npm run test:service` | Prepara el build y ejecuta `node --test electron/*.test.ts`. |
| `npm run test:phase2a:preferences` | Regresión de preferencias concurrentes con React, preload, IPC y controlador reales. |
| `npm run test:phase2a:startup-close` | Regresión del cierre antes de recibir las preferencias iniciales. |
| `npm run test:phase2a:desktop` | Build y comprobación funcional nativa del escritorio. |
| `npm run test:phase1` | Regresión de interfaz con Edge/Chrome headless y capturas; valida el modo sin host. |

También existen dos modos directos de los scripts:

- `node scripts/phase2a-desktop-check.mjs --wait-for-self-test`: autocheck de las esperas de arranque y limpieza poscierre.
- `R2_DIAGNOSTICS_FAILURE=1 node scripts/phase2a-preferences-check.cjs`: regresión ante rechazo de diagnósticos; esa sintaxis de variable corresponde a Bash. En PowerShell, establecé `$env:R2_DIAGNOSTICS_FAILURE = '1'`, ejecutá el script y retirala después con `Remove-Item Env:R2_DIAGNOSTICS_FAILURE`.

Las comprobaciones nativas requieren Windows con sesión de escritorio activa; el smoke desktop espera el puerto `4317` libre. Las suites utilizan perfiles y temporales aislados. `test:phase1` genera el informe `artifacts/phase1-ui-check.json` y capturas; no debe ejecutarse sólo para actualizar la documentación. El entorno de pruebas registrado utilizó Node.js 24.

## Fase 2B · Tarea 2: preparar y reproducir audio local

En «Clonar voz», la tarjeta «Archivo local · selección real» permite seleccionar audio o vídeo local. Voice Studio usa `ffprobe` para comprobar la pista de audio y leer la duración cuando existe; después usa `ffmpeg` para crear un WAV temporal PCM mono a 48 kHz, sin modificar el original. Las herramientas `ffprobe` y `ffmpeg` deben estar disponibles en `PATH`. El reproductor HTML5 ofrece reproducción, pausa, posición, duración y desplazamiento temporal. Cancelar el selector conserva el archivo previo; al confirmar otro archivo, Voice Studio libera el reproductor anterior antes de retirar su temporal. Los temporales se eliminan al sustituir el medio o salir de la aplicación.

Para probarlo manualmente, ejecuta `npm run build` y `npm run start:desktop`, abre «Clonar voz» y selecciona primero un WAV pequeño y después un vídeo pequeño con audio. Espera a que desaparezca «Preparando audio…», pulsa reproducir y pausa, comprueba que avanza la posición y mueve la barra de búsqueda. También puedes probar un archivo corrupto o un vídeo sin audio: deben mostrar un error, nunca un reproductor válido. La tarea está pensada inicialmente para archivos pequeños; cada operación FFmpeg tiene un límite de 60 segundos y los archivos mayores pueden requerir un tratamiento posterior. No se exporta WAV ni se altera el archivo de entrada.

### Evidencias y límites de verificación de Tarea 2

- Validación humana: MP4 y WAV reales reproducen, pausan y permiten desplazamiento temporal; WAV corrupto muestra error sin reproductor válido.
- Evidencia previa reutilizada, no repetida: build PASS; suite focalizada independiente 18/18 PASS (incluye un archivo auxiliar como subtest); regresiones de concurrencia 3/3 PASS; FFmpeg real cancelado tras escribir un parcial, con cierre esperado del hijo, limpieza y sin publicar el resultado, a nivel del controlador.
- **Pendientes:** salida real del host Electron durante FFmpeg (incluido ocultamiento en bandeja frente a salida efectiva) y presentación del error para vídeo sin pista de audio. La prueba del controlador no acredita el cierre del host; el rechazo de vídeo sin audio sí tiene prueba de controlador, no de interfaz.
- El comprobador del diálogo nativo de Windows permanece bloqueado; no se declara PASS ni se vuelve a ejecutar. RDD se solicita sobre el diff exclusivo de Tarea 2 con estas limitaciones expresas, sin autorizar commit, push ni Tarea 3.

## Fase 2B · Tarea 3: recortes temporales de audio

Después de preparar un archivo en «Clonar voz», la sección «Recortar audio» permite escribir inicio y fin en segundos o tomar la posición del reproductor original. Muestra el intervalo y su duración; «Generar fragmento WAV» crea un recorte real y añade un reproductor HTML5 independiente. Se pueden crear varios fragmentos numerados del mismo archivo durante la sesión.

El host valida números finitos, `0 ≤ inicio < fin ≤ duración`, duración conocida e identidad del archivo preparado. Solo usa su propio WAV preparado como entrada; el renderer no proporciona rutas arbitrarias de entrada ni salida. FFmpeg genera PCM de 16 bits, mono y 48 kHz; ffprobe verifica formato y duración antes de publicar. La tolerancia máxima es **50 ms** respecto de `fin − inicio`. Una operación activa por sesión; los fallos no publican parciales. Los recortes y sus procesos se invalidan y limpian al cambiar de archivo o salir; cancelar el selector conserva los recortes. Un archivo sin duración fiable no permite recortar.

Para comprobarlo manualmente con el build actual: `npm run start:desktop` → «Clonar voz» → seleccionar WAV o MP4 real → esperar la preparación → marcar 0,5–1,5 s → generar y reproducir/pausar/desplazar el fragmento → repetir con otro intervalo y comprobar ambos fragmentos. Probar inicio negativo, fin fuera de duración e inicio igual o mayor que fin: el botón no debe permitir generar. Cambiar de archivo no debe mostrar fragmentos anteriores. Los originales no se modifican.

Comprobaciones focalizadas de Tarea 3: `node --test electron/media-trimming.test.ts electron/media-trimming-ipc.test.ts`. El smoke `node scripts/phase2b-trim-smoke.cjs` comprueba únicamente arranque real de Electron, preload restringido, navegación en escritorio/ventana reducida y salida en reposo; no abre el selector ni acredita reproducción de fragmentos o cierre durante FFmpeg.

No hay «Guardar como», exportación definitiva ni Tarea 4. El usuario confirmó PASS manual para WAV y MP4, escucha/pausa/desplazamiento, dos fragmentos independientes, cambio de fuente e intervalos inválidos; RDD de Tarea 3 está autorizado. El editor visual con forma de onda y selección arrastrable queda como backlog UX futuro, fuera de esta tarea y de sus criterios de aceptación. Las dos deudas de Tarea 2 (cierre real del host durante FFmpeg y error de vídeo sin audio en UI) siguen pendientes de validación previa a distribución: no se declaran PASS por estas pruebas de recorte.

## Evidencia del cierre

Son **resultados históricos ya observados**, no pruebas nuevas de esta actualización:

- Última validación del candidato: build PASS; preferencias **2/2**; diagnósticos **1/1**; cierre inicial **4/4**; servicio **21/21**; desktop **60/60**; autocheck poscierre **4/4**; diff-check PASS.
- Evidencia anterior: regresión Phase 1 **41/41**, 16 capturas a 1920×1080 y 1024×768, verificación independiente, salida mediante el menú real de bandeja y paquete temporal de Electron **60/60**. El paquete temporal no equivale a un instalador definitivo.
- Los cuatro resultados RDD fueron admitidos; la revisión quedó `approved` y su acknowledgement terminó con `status:closed`, `authority:burned`.
- El commit final contiene exactamente **45 archivos**: 26 modificados y 19 nuevos. Su árbol completo coincide con el aprobado.

Los seis hallazgos admitidos son **no bloqueantes**, no reabren la revisión ni obligan a corregir o repetir RDD. Su lista y ubicaciones están en [el estado del proyecto](docs/PROJECT-STATE.md#seguimiento-no-bloqueante).

## Estructura y continuidad

- `src/`: interfaz, modelos de datos y datos demo.
- `electron/`: host, servicio HTTP, contrato, preload, IPC y pruebas.
- `scripts/`: comprobaciones de interfaz y escritorio.
- `assets/tray.ico`: recurso de bandeja.
- `docs/fase-2a-servicio-local.md`: contrato y ejecución del servicio.
- [docs/PROJECT-STATE.md](docs/PROJECT-STATE.md): tareas, commits, validaciones, RDD y seguimiento.
- `odd/tasks/voice-studio-fase-2a.md` y `odd/voice-studio-fase-2a/tasks`: seguimiento interno ignorado por Git.

El proyecto canónico de Engram es **`voice studio`**. Recuperá el estado actual y sus evidencias antes de continuar: las notas antiguas de Fase 1 o de reparación de memoria no sustituyen este cierre. Usá la integración de memoria de Gentle Shell; no habilites rutas alternativas para eludir un bloqueo de seguridad de arranque. Esta documentación no cambia la instalación de Shell ni la configuración de memoria.

## Método y siguiente fase

Se mantienen **TDD, RDD, KISS, DRY, YAGNI y desarrollo por fases**: requisitos y contratos claros, prueba que falle cuando corresponda, implementación mínima, verificación y revisión controlada. Las decisiones de commit, publicación y comienzo de otra fase requieren autorización separada.

**Fase 2B: Tarea 1 implementada; verificación independiente pendiente. Tarea 2 pendiente de autorización.**
