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

No existe un método genérico `send`, `invoke`, acceso a `ipcRenderer` ni objetos Node en `window`.

Las preferencias aceptadas son:

- `port`: entero entre `1024` y `65535`.
- `autoStart`: booleano.
- `keepRunningOnClose`: booleano.

El host ignora cualquier dirección enviada por el renderer y utiliza siempre `127.0.0.1`.

## Diagnósticos

Cada fallo registra:

- código estable;
- resumen comprensible;
- detalle técnico acotado;
- fecha y hora;
- host y puerto afectados.

El registro vive en memoria, está limitado a los 50 eventos más recientes y no incluye secretos. La interfaz muestra el fallo del servicio en un modal separado de los diagnósticos de trabajos simulados.

## Cierre de la aplicación

| Acción | `keepRunningOnClose` | Resultado |
| --- | --- | --- |
| Cerrar ventana | `true` | Ocultar ventana; mantener proceso Electron y servicio; mostrar bandeja. |
| Cerrar ventana | `false` | Detener servicio y salir. |
| «Salir» en bandeja | cualquiera | Detener servicio y salir. |
| Terminación de la aplicación | cualquiera | Solicitar el cierre del servidor antes de finalizar. |

La aplicación usa el bloqueo de instancia única de Electron. Una segunda apertura no crea otro servidor: activa la ventana existente y termina la segunda instancia.

## Modo navegador

`npm run dev` conserva el renderer para desarrollo visual, pero un navegador no puede gestionar el servidor. Sin el preload, la interfaz muestra «Host de escritorio no disponible» y no simula un estado activo. Las pruebas de interfaz pueden instalar un doble explícito del puente antes de cargar React; ese doble no forma parte del runtime de producción.

## Fuera de alcance

- SQLite o persistencia de dominio.
- API de generación TTS.
- Gestión real de voces.
- Fish Audio u otros proveedores.
- Inferencia o modelos locales.
- Director emocional real.
- Streamer.bot o Twitch.
- Empaquetado/instalador definitivo de Windows.
