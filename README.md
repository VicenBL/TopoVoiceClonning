# Voice Studio — Fase 1 Frontend Demo

Interfaz de demostración para una futura aplicación de escritorio Windows orientada a gestión de voces clonadas, generación TTS simulada y dirección emocional simulada.

> **Estado:** Fase 1 exclusivamente frontend. No hay backend real, inferencia TTS, llamadas externas, modelos IA, integración con Streamer.bot ni claves API reales.

## Continuidad entre sesiones

Abrí la sesión de Pi/Gentle Shell en la carpeta de este proyecto. El nombre canónico en Engram es **`voice studio`**, con espacio; no es `voicestudio` ni `TopoVoiceCloning`.

- `.engram/config.json` fija la identidad del proyecto para Engram.
- `.pi/mcp.json` deshabilita la conexión MCP independiente para no eludir el control de arranque. La conexión prevista es el proveedor `gentle-engram` de Shell, con proyecto explícito `voice studio`.
- `AGENTS.md` indica al agente recuperar memoria, leer el prompt completo y reconciliar las tareas antes de continuar.
- `odd/requests/voice-studio-phase-1-original.md` conserva el prompt original completo, incluso si Engram no está disponible.
- `odd/tasks/voice-studio-fase-1.md` contiene el seguimiento de la fase, todavía sin cierre de aceptación.

En una sesión existente, ejecutá `/reload` para recargar instrucciones y configuración. No habilites el MCP independiente para sortear la política de Shell. Las instrucciones de `AGENTS.md` y la copia local siguen disponibles. La configuración no habilita conexiones con proveedores TTS ni servicios de la aplicación.

### Estado de la reparación de memoria

La primera comprobación con el Pi global falló: la sesión heredaba una política de memoria deshabilitada de Shell. También apareció un error de credenciales de ese Pi global; no se modificaron credenciales. Ese ejecutable no es el Pi integrado que administra Gentle Shell.

El servidor existente está ahora activo y comprobado en `127.0.0.1:7437`: `/compatibility` respondió HTTP 200, `status: ready`, `active_reuse_authorized: true`, y la identidad coincide con el almacén. El sondeo y clasificador nativos de Shell autorizaron la reutilización en un entorno de arranque nuevo. Además, una prueba real del launcher administrado y Pi integrado en modo RPC terminó con código 0: recibió `startup_policy=allow`, seleccionó el servidor y recuperó el contexto de `voice studio`, sin pedir inferencia a un modelo. La revisión independiente verificó respaldo, tarea, listener, identidad y protección.

Una sesión que ya arrancó con la política `disabled` conserva ese estado: no se modifica ni se elude. Cerrá y abrí Gentle Shell desde la carpeta del proyecto para que vuelva a decidir; un `/reload` por sí solo no cambia la política heredada. Usá el launcher administrado `%LOCALAPPDATA%/gentle-shell/bin/gentle-shell.cmd`, no el `pi` global.

No borres datos, no fabriques procedencia y no desactives el control. Si una actualización futura cambia la compatibilidad, Shell puede bloquear de nuevo la memoria; una versión coincidente por sí sola no demuestra reutilización segura.

### Diagnóstico y reparación preparada

La identidad del almacén coincide con el registro de Shell, pero la huella del ejecutable integrado de Engram no coincide. No había servidor escuchando en `127.0.0.1:7437`. No se modificó el registro de procedencia.

Respaldo verificado por SHA-256: `C:/Users/loren/.engram-backups/before-shell-repair-20261014-194122`. Incluye la base y sus archivos WAL/SHM. El rechazo del sondeo offline es compatible con la presencia de esos archivos; no acredita corrupción ni autoriza una apertura.

Se prepararon `scripts/start-engram-memory.ps1` y `scripts/install-engram-memory-task.ps1` para iniciar el servidor existente con privilegios limitados al entrar en Windows, comprobar loopback, identidad y `/compatibility`, y evitar duplicados. El primer intento fue rechazado por la política efectiva Restricted. Después de una autorización específica del usuario se estableció `RemoteSigned` solamente en `CurrentUser`; el estado anterior (`Undefined`) está registrado en `execution-policy-before.json` dentro del respaldo. No se utilizó Bypass ni se modificó LocalMachine. La tarea `VoiceStudio-EngramMemory` quedó registrada e iniciada: `Running`, usuario interactivo, privilegios `Limited`, sin contraseña almacenada. Su trigger de próximo inicio de sesión está registrado; todavía no se observó un cierre e inicio real de Windows.

El arranque usa el ejecutable existente `%LOCALAPPDATA%/engram/bin/engram.exe`, conserva los datos en `%USERPROFILE%/.engram` y escribe logs en `%USERPROFILE%/.gentle-shell/agent/memory-logs`. No descarga software ni guarda contraseñas. Si el proyecto se mueve, hay que actualizar la ruta de la tarea.

Reversión manual (no ejecutada):

```powershell
Stop-ScheduledTask -TaskName 'VoiceStudio-EngramMemory'
Unregister-ScheduledTask -TaskName 'VoiceStudio-EngramMemory' -Confirm
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy Undefined
```

La reversión de la tarea no borra las memorias ni el respaldo.

Para comprobar la memoria sin MCP, únicamente cuando no exista un bloqueo de seguridad de arranque:

```bash
engram context --project "voice studio"
engram search "Voice Studio Phase 1" --project "voice studio" --limit 20
```

La recuperación está configurada para sesiones abiertas en esta carpeta; no para sesiones iniciadas en cualquier otra carpeta. No se fusionaron ni borraron las memorias existentes.

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

Abrí la URL local que imprime Vite, normalmente:

```text
http://127.0.0.1:5173/
```

## Verificar build y flujos de Fase 1

```bash
npm run build
npm run test:phase1
```

`test:phase1` utiliza una instalación local de Microsoft Edge o Google Chrome en modo headless. Recorre los flujos principales mediante la interfaz pública, comprueba la consola y genera capturas de las ocho pantallas a 1920×1080 y 1024×768 en `artifacts/screenshots/phase1/`.

## Estructura principal

```text
src/
  App.tsx        # Aplicación, navegación, pantallas e interacciones demo
  demoData.ts   # Datos simulados centralizados: voces, motores, trabajos, ajustes
  types.ts      # Modelos tipados principales
  styles.css    # Sistema visual oscuro y responsive
  main.tsx      # Entrada React/Vite
scripts/
  phase1-ui-check.mjs # Verificación funcional y visual automatizada con navegador local
odd/
  tasks/voice-studio-fase-1.md  # Documento ODD de la fase
```

## Pantallas implementadas

- Producción
- Biblioteca de voces
- Clonar voz
- Generación TTS
- Director emocional
- Motores
- Historial y actividad
- Ajustes

Todas comparten navegación lateral, barra superior persistente, estado simulado de servicio local y sistema de notificaciones.

## Datos simulados

Los datos demo están centralizados en `src/demoData.ts`:

- Voces: Topota, Chiquito, Dumbledore y Chocás.
- Versiones múltiples para validar selección activa y conservación de versiones.
- Motores ficticios: Fish Audio — demo, Motor local A — demo, Motor local B — demo.
- Capacidades declarativas por motor para adaptar formularios de clonación y generación.
- Referencias de audio reutilizables.
- Perfiles emocionales simulados.
- Trabajos iniciales con estados completado y error.

Los identificadores externos son ficticios y no corresponden a cuentas reales.

## Interacciones cubiertas

- Deshabilitar/habilitar voces y verlo reflejado entre Producción y Biblioteca.
- Cambiar versión activa de una voz desde vistas distintas.
- Crear voz o nueva versión demo sin activar automáticamente la versión nueva.
- Cambiar motor de producción con confirmación e incompatibilidades visibles.
- Adaptar controles de clonación según capacidades declaradas del motor.
- Ejecutar generación simulada y verla en cola/historial.
- Simular solicitud externa de Streamer.bot sin conectar Streamer.bot real.
- Provocar errores demo y abrir diagnóstico específico del trabajo.
- Mantener literalmente textos con símbolos, acentos y secuencias extrañas.
- Comparar configuraciones A/B usando el mismo texto original.
- Activar/desactivar servicio local simulado desde la barra superior y Ajustes.
- Persistir ajustes y estado demo en `localStorage`.
- Restaurar datos de demostración desde la barra superior.

## Pendiente para fases posteriores

- Backend/API local real.
- Integración con Streamer.bot.
- Integración con Fish Audio u otros proveedores.
- Instalación/ejecución de modelos locales.
- Inferencia TTS real.
- Grabación real de micrófono y subida/procesamiento real de audio.
- Director emocional con IA real.
- Reproductor y archivos de audio reales por generación.
- Gestión segura de secretos y credenciales.
- Empaquetado definitivo para escritorio Windows.

## Verificación realizada

- `npm run build`: **PASS**. TypeScript estricto y build de Vite completados. Vite informa únicamente una advertencia no bloqueante sobre la futura carga nativa de `vite.config.js`.
- `npm run test:phase1`: **PASS — 41/41 comprobaciones** mediante Microsoft Edge headless y la interfaz pública.
- Flujos comprobados: navegación, sincronización de disponibilidad y versión, candidata de clonación sin guardar independiente de la versión activa, nueva versión sin autoactivación, capacidades dinámicas de clonación, texto original exacto, cola serial, A/B enlazado con controles independientes, diagnóstico específico, cambio de motor, director emocional, historial, persistencia, `autoStart` y `keepRunningOnClose`.
- Casos literales comprobados: `AAAAA---éééé%%%%`, `JAJAJAJAaaaáááá` y `¿¿¿???---!!!`.
- Consola del navegador: sin excepciones ni errores de recursos.
- Informe reproducible: `artifacts/phase1-ui-check.json`.

## Notas de revisión visual

Se generaron y revisaron las ocho pantallas tanto a **1920×1080** como a **1024×768**: 16 capturas en `artifacts/screenshots/phase1/`. Las hojas `contact-desktop.png` y `contact-reduced.png` facilitan la revisión conjunta.

La inspección no mostró solapamientos, controles esenciales inaccesibles ni desbordamiento horizontal global. En ventana reducida la navegación y la barra superior permanecen visibles, mientras el contenido usa scroll vertical y las tablas mantienen su propio scroll cuando corresponde.

La verificación técnica de la Fase 1 está completa. La fase conserva un último gate externo: la revisión visual y aprobación del usuario antes de avanzar a cualquier backend, servicio o integración real.
