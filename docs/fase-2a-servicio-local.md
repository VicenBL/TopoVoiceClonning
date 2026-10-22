# Fase 2A — Contrato del servicio local

Voice Studio incorpora un host Electron sin sustituir React/Vite. El proceso principal posee un único servidor HTTP local y publica al renderer solamente operaciones concretas mediante un preload aislado.

## Camino rápido

1. La ventana carga las preferencias persistidas (`puerto`, `autoStart`, `keepRunningOnClose`).
2. El renderer entrega esas preferencias al host mediante el puente restringido.
3. Si `autoStart` está activo, el host intenta iniciar el servidor en `127.0.0.1`.
4. La interfaz representa el estado devuelto por el host; nunca deduce «Activo» del último botón pulsado.
5. `GET /health` confirma el estado efectivo del servidor.

## Límites de confianza

| Área | Decisión |
| --- | --- |
| Renderer | React/Vite sin acceso directo a Node, Electron, sockets ni sistema de archivos. |
| Preload | `contextIsolation: true`, `nodeIntegration: false`; expone sólo `window.voiceStudio.service`. |
| Proceso principal | Posee `node:http`, ciclo de vida, bandeja, diagnósticos e instancia única. |
| Red | Bind fijo a `127.0.0.1`; el host no acepta una dirección configurable. |
| Persistencia | `localStorage` conserva preferencias; el estado efectivo y los errores no se persisten como si siguieran vigentes. |
| Resto de la aplicación | Voces, trabajos, motores y director emocional continúan siendo demostraciones. |

## Estados

```text
detenido → iniciando → activo → deteniendo → detenido
                     ↘ error
```

- `iniciando` comienza antes de solicitar el puerto y termina sólo tras el evento real `listening`.
- `activo` implica que el servidor está escuchando en `127.0.0.1:<puerto>`.
- `deteniendo` termina sólo después del cierre efectivo del servidor.
- `error` contiene un diagnóstico comprensible. Un conflicto `EADDRINUSE` nunca se presenta como servicio activo.
- Iniciar un servidor ya activo en el mismo puerto es idempotente.
- Dos inicios concurrentes comparten la misma operación; no crean dos servidores.
- Reiniciar equivale a detener completamente y volver a iniciar con la configuración vigente.

## Endpoint HTTP

### `GET /health`

Respuesta `200 application/json`:

```json
{
  "status": "ok",
  "service": "voice-studio",
  "version": 1,
  "host": "127.0.0.1",
  "port": 4317,
  "pid": 1234,
  "startedAt": "2026-10-15T12:00:00.000Z"
}
```

El endpoint no devuelve configuración de voces, credenciales ni datos simulados. Las rutas desconocidas responden `404`; los métodos no admitidos responden `405`.

## Contrato IPC

El preload expone exclusivamente:

```ts
window.voiceStudio.service.getState()
window.voiceStudio.service.configure(preferences)
window.voiceStudio.service.start()
window.voiceStudio.service.stop()
window.voiceStudio.service.restart()
window.voiceStudio.service.getDiagnostics()
window.voiceStudio.service.onStateChange(listener)
```

No existe un método genérico `send`, `invoke`, acceso a `ipcRenderer` ni objetos Node en `window`. El proceso principal valida que cada llamada IPC provenga de la ventana principal y del origen/documento autorizado; también bloquea navegaciones a otros orígenes.

Las preferencias aceptadas son:

- `port`: entero entre `1024` y `65535`.
- `autoStart`: booleano.
- `keepRunningOnClose`: booleano.

El host ignora cualquier dirección enviada por el renderer y utiliza siempre `127.0.0.1`.

Los cambios de preferencias se aplican en orden sin perder campos: si se modifican `autoStart` y `keepRunningOnClose` antes de recibir la primera respuesta IPC, el host, la interfaz y `localStorage` deben conservar ambos cambios. El renderer fusiona cada cambio parcial con las últimas preferencias aplicadas dentro de la cola; el contrato IPC sigue recibiendo las tres preferencias completas.

## Diagnósticos

Cada fallo registra:

- código estable;
- resumen comprensible;
- detalle técnico acotado;
- fecha y hora;
- host y puerto afectados.

El registro vive en memoria, está limitado a los 50 eventos más recientes y no incluye secretos. La interfaz muestra el fallo del servicio en un modal separado de los diagnósticos de trabajos simulados. Si no se puede recuperar el registro, Ajustes mantiene una advertencia visible; ese fallo de lectura no invalida un servicio ya configurado ni oculta su `lastError` real.

## Cierre de la aplicación

| Acción | `keepRunningOnClose` | Resultado |
| --- | --- | --- |
| Cerrar ventana | `true` | Ocultar ventana; mantener proceso Electron y servicio; mostrar bandeja. Si no se puede cargar el icono, la ventana se oculta igualmente y la aplicación permanece activa. |
| Cerrar ventana | `false` | Detener servicio y salir. |
| «Salir» en bandeja | cualquiera | Detener servicio y salir. |
| Terminación de la aplicación | cualquiera | Solicitar el cierre del servidor antes de finalizar. |

Si se solicita cerrar antes de aplicar la primera configuración válida del renderer, la ventana no se oculta con un valor predeterminado: la decisión espera esas preferencias durante un máximo de 3 segundos. Al recibirlas, aplica la política de la tabla. Si no llegan, solicita la salida segura en lugar de mantener un proceso oculto indefinidamente.

La aplicación usa el bloqueo de instancia única de Electron. Una segunda apertura no crea otro servidor: activa la ventana existente y termina la segunda instancia. El icono incluido en `assets/tray.ico` se resuelve desde la raíz de la aplicación (`app.getAppPath()`), tanto en desarrollo como empaquetada; un recurso ausente o ilegible no interrumpe el cierre de la ventana.

## Ejecución de escritorio

Después de instalar las dependencias, ejecuta `npm run build` y luego `npm run start:desktop`. Electron abre el renderer compilado desde `dist/index.html`; Vite genera sus recursos con rutas relativas para que funcionen bajo `file:`. El preload se empaqueta como CommonJS compatible con el sandbox de Electron.

En desarrollo visual, `npm run dev` conserva el renderer, pero un navegador no puede gestionar el servidor. Para usar el host Electron con Vite, inicia Vite en `127.0.0.1:5173` y arranca Electron con `VITE_DEV_SERVER_URL=http://127.0.0.1:5173/`; el host acepta únicamente ese origen. Sin el preload, la interfaz muestra «Host de escritorio no disponible» y no simula un estado activo. Las pruebas de interfaz pueden instalar un doble explícito del puente antes de cargar React; ese doble no forma parte del runtime de producción.

## Pruebas de servicio

`npm run test:service` prepara el renderer y el preload mediante el build normal antes de ejecutar las pruebas del contrato y de los recursos empaquetados. Así las comprobaciones de integración no dependen de artefactos de una ejecución anterior.

## Verificación nativa de escritorio

En Windows, con una sesión de escritorio activa y el puerto `127.0.0.1:4317` libre, ejecuta `npm run test:phase2a:desktop`. El comando compila y lanza Electron con un perfil aislado; prueba start/stop/restart mediante el puente IPC real, `/health`, el cierre nativo de la ventana, la restauración por segunda instancia, la salida y la terminación de procesos descendientes. No automatiza un clic físico sobre la opción «Salir» del menú nativo de la bandeja; el cierre y el callback de salida comparten la rutina de apagado del proceso principal.

`node scripts/phase2a-desktop-check.mjs --wait-for-self-test` comprueba de forma determinista la espera del propio script: mantiene los fallos tempranos durante el arranque, permite una limpieza pos-salida que termina con retraso y conserva el timeout para procesos residuales o salidas no nulas.

## Regresión de cierre durante el arranque

`npm run test:phase2a:startup-close` compila copias temporales de la aplicación y ejecuta su `main` real. El arnés retiene la primera entrega IPC de las preferencias persistidas, solicita el cierre real de `BrowserWindow` y observa llamadas a `hide`, configuración y salida del proceso. Comprueba el cierre temprano con `keepRunningOnClose=false`, los cierres normales con ambos valores y el límite de espera sin preferencias. Sus perfiles, observación y control HTTP se mantienen fuera del repositorio; no sustituye el algoritmo de cierre ni añade APIs de producción.

## Regresión de preferencias concurrentes

`npm run test:phase2a:preferences` compila copias temporales del código de trabajo y ejecuta React, el preload, IPC y el controlador reales en un host Electron de prueba. Retiene la primera respuesta IPC y cambia las dos casillas en ambos órdenes; comprueba preferencias del controlador, interfaz, persistencia, dos notificaciones de éxito y conservación de ajustes ajenos. `R2_DIAGNOSTICS_FAILURE=1 node scripts/phase2a-preferences-check.cjs` verifica que un rechazo de diagnósticos mantiene activo y editable un servicio cuya configuración y `/health` siguen siendo correctos. Usa puertos y perfiles temporales fuera del repositorio, sin instalar dependencias ni consultar registros RDD. El host de prueba instrumentado no sustituye la verificación nativa de cierre, bandeja y reinicio de proceso de `test:phase2a:desktop`.

## Fuera de alcance

- SQLite o persistencia de dominio.
- API de generación TTS.
- Gestión real de voces.
- Fish Audio u otros proveedores.
- Inferencia o modelos locales.
- Director emocional real.
- Streamer.bot o Twitch.
- Empaquetado/instalador definitivo de Windows.
