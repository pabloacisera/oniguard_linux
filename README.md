<p align="center">
  <img src="web/assets/logo.png" alt="PulseDev Logo" width="128">
</p>

# ⚡ PulseDev

**Native Node.js development server — static files, hot reload, and logging in 1.9MB**

[![npm version](https://img.shields.io/badge/npm-0.1.1-blueviolet?style=flat-square)](https://www.npmjs.com/package/pulsedev)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.0.0-green?style=flat-square&logo=node.js)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue?style=flat-square)](https://opensource.org/licenses/ISC)
[![Status](https://img.shields.io/badge/status-active-success?style=flat-square)]()
[![Zero deps](https://img.shields.io/badge/dependencies-zero-orange?style=flat-square)]()

---

# English

> Two commands. No `node_modules` in your project. No complicated setup.
> Just `pulsedev init` and `pulsedev run`.

## What is PulseDev?

PulseDev is a CLI tool for Node.js that starts a local HTTP server, watches your files for changes, and reloads the server automatically. It's built **100% with Node.js native modules**, with zero production dependencies.

Designed for developers who need a fast, lightweight dev environment without Webpack, Vite, or any other bundler.

**What it does:**

- 🖥️ native HTTP server (no Express, no Fastify)
- 👁️ file system watching with `fs.watch`, reloads on real changes
- 🔁 automatic cache busting: MD5 hash injection into `src` and `href` attributes
- 📝 HTTP request logging to terminal or persistent file with auto-rotation
- 📁 project scaffolding with a single command
- 🎨 extended MIME types: images, video, audio, fonts, documents, and more
- ⚙️ configurable via `pulsedev.json`
- ⚡ zero production dependencies — all native Node.js

## Installation

```bash
npm install -g pulsedev
```

Installation is **global**. No `node_modules` in your project.

> **Requirement:** Node.js 22 LTS or higher

**Local development:**

```bash
git clone https://github.com/pabloacisera/pulsedev_linux.git
cd pulsedev
npm link
```

## 📺 Demo

Check out PulseDev in action:

<video src="docs/video/video_presentation_v.1.2.mkv" width="100%" controls></video>

## Quick start

### 1 — Initialize the project

```bash
pulsedev init
```

Automatically generates:

```
your-project/
├── pulsedev.json          ← configuration
└── src/
    ├── index.html         ← main page
    ├── css/
    │   └── index.css      ← base styles
    ├── js/
    │   ├── index.js       ← main script
    │   └── socket-client.js ← WebSocket client
    └── assets/
        └── Arimo-VariableFont_wght.ttf
```

### 2 — Start the server

```bash
pulsedev run
```

The server runs at `http://localhost:3003` (or your configured port).
From that moment, any file change in `src/` triggers an automatic reload.

### 3 — Help and version

```bash
pulsedev --help
pulsedev --version
```

## Configuration — `pulsedev.json`

```json
{
    "watchPath": ["*"],
    "runFile": "index.html",
    "port": 3003,
    "outputPath": "terminal",
    "ignoreExtensions": ["*.txt", "*.log", "*.env", "*.md"],
    "debounceDelay": 0.5,
    "recursive": true,
    "logLimit": 5
}
```

| Property | Type | Description | Default |
|----------|------|-------------|---------|
| `watchPath` | `string[]` | Directories to watch. `["*"]` watches everything | `["*"]` |
| `runFile` | `string` | Entry HTML file | `"index.html"` |
| `port` | `number` | HTTP server port | `3003` |
| `outputPath` | `string` | Log destination: `"terminal"` or folder path | `"terminal"` |
| `ignoreExtensions` | `string[]` | Extensions the watcher ignores | `["*.txt","*.log","*.env","*.md"]` |
| `debounceDelay` | `number` | Seconds to wait before reload (prevents duplicate events) | `0.5` |
| `recursive` | `boolean` | Watch subdirectories. See note below. | `true` |
| `logLimit` | `number` | Max log file size in KB before rotation | `5` |

---

`recursive` controls whether the watcher enters subdirectories.
Its behavior depends on `watchPath`:

**Case 1 — `watchPath: ["*"]` with `recursive: false` → Invalid**

```json
{
    "watchPath": ["*"],
    "recursive": false
}
```

With `watchPath: ["*"]` the server listens from the project root.
If `recursive` were `false`, it would only detect changes in files directly
at the root (where normally only `pulsedev.json` lives). Changes in `src/`
would never be detected, breaking hot reload.

PulseDev detects this combination, ignores the `false`, forces `recursive: true`
automatically, and shows a warning explaining why.

**Case 2 — Specific `watchPath` with `recursive: false` → Valid**

```json
{
    "watchPath": ["./src/css", "./src/js"],
    "recursive": false
}
```

With specific paths the user controls exactly which directories to watch.
`recursive: false` is valid here: the watcher only monitors files at the root
of each configured path, without entering subdirectories.
PulseDev shows an info message confirming the active mode.

**Case 3 — Any `watchPath` with `recursive: true` or unset → Correct**

```json
{
    "watchPath": ["*"],
    "recursive": true
}
```

Standard behavior. The watcher enters all subdirectories
of the configured paths. Recommended for most projects.

## How hot reload works

PulseDev does not reload on every file system event. Before triggering a
reload, it computes the MD5 hash of the modified file and compares it to the
previous hash stored in memory. **It only reloads if the content actually changed.**

```
file saved to disk
    → fs.watch detects the event
        → stat() verifies it's a file (not a directory)
            → compareChanges() computes MD5 and compares with in-memory Map
                → if changed → debounce → reloadServer()
```

Additionally, when serving HTML, the server automatically injects the hash of
each referenced CSS and JS file:

```html
<!-- what you write -->
<link rel="stylesheet" href="css/index.css">

<!-- what the browser receives -->
<link rel="stylesheet" href="css/index.css?v=a3f2c1b4">
```

### WebSocket auto-reload system

PulseDev notifies the browser when the server restarts via a persistent **WebSocket** connection. The flow:

```
file changed → watcher detects → reloadServer()
    → closeAllConnections() closes WS sockets
    → HTTP server restarts with new config
        → browser detects closed socket (onclose)
            → location.reload() refreshes the page
```

**Injected WebSocket client** (`socket-client.js`):

```javascript
let ws = new WebSocket("ws://localhost:" + location.port);
ws.onclose = () => location.reload();        // server restarted
ws.onerror = () => setTimeout(() => location.reload(), 500);  // connection error
```

**Why WebSocket over SSE or polling?**

- **Bidirectional**: server can notify the client instantly
- **Low overhead**: single open TCP connection, no multiple HTTP requests
- **Zero latency**: no polling interval, notification is immediate
- **Native in the browser**: no additional dependencies
- **Persistent**: connection stays open while the browser is on the page

## Logging system

By default, HTTP requests are logged to `logs/requests.log`. A native Worker Thread
handles file rotation when it exceeds the `logLimit` threshold, without blocking
the main thread:

```
server running at http://localhost:3003
- watching for changes in /path/to/project
- log written to logs/requests.log
```

To see logs in the terminal instead, set `"outputPath"` to `"terminal"` in your
`pulsedev.json`.

## Supported content types

The server recognizes and correctly serves over 40 file types:

| Category | Extensions |
|----------|------------|
| Web | `html`, `css`, `js`, `mjs`, `json`, `xml`, `txt` |
| Images | `png`, `jpg`, `gif`, `webp`, `avif`, `svg`, `ico`, `bmp`, `tiff` |
| Fonts | `ttf`, `otf`, `woff`, `woff2`, `eot` |
| Audio | `mp3`, `wav`, `ogg`, `aac`, `flac`, `opus` |
| Video | `mp4`, `webm`, `avi`, `mov`, `mkv` |
| Documents | `pdf`, `doc`, `docx`, `xls`, `xlsx`, `zip` |

## Project architecture

```
pulsedev/
├── bin/
│   └── cli.js                   ← CLI entry point (init / run / --help / --version)
├── core/
│   ├── init.js                  ← Project scaffolding
│   ├── run.js                   ← Re-export of serverManager
│   └── serverManager.js         ← HTTP server, state, and reload
├── helpers/
│   ├── watcher.js               ← File watcher with fs.watch and debounce
│   ├── hashFingerprint.js       ← MD5 comparison and cache busting
│   ├── resourceHasher.js        ← Hash injection into HTML
│   ├── mimeTypes.js             ← MIME types and binary extensions
│   ├── writter.js               ← File read/write + log Worker
│   └── counterChar.js           ← Worker Thread for log rotation
└── web/
    ├── assets/
    │   ├── Arimo-VariableFont_wght.ttf
    │   ├── github.svg
    │   └── npm.svg
    └── templates/
        ├── pulsedev.json         ← Default config
        ├── index.html            ← Welcome page
        ├── index.css             ← Base styles
        ├── index.js              ← Main script
        └── socket-client.js      ← WebSocket client
```

## Built with

PulseDev is built **100% with Node.js native modules**. Zero production dependencies.

| Module | Usage |
|--------|-------|
| `node:http` | HTTP server |
| `node:fs` / `node:fs/promises` | File reading, writing, and watching |
| `node:path` | Path resolution |
| `node:os` | Hostname for logs |
| `node:crypto` | MD5 hash for fingerprinting and cache busting |
| `node:worker_threads` | Worker Thread for log rotation |
| `node:util` → `styleText` | Terminal colors |
| `node:url` | `__dirname` resolution in ESM |

---

---

# Español

> Dos comandos. Sin `node_modules` en tu proyecto. Sin configuración complicada.
> Solo `pulsedev init` y `pulsedev run`.

## ¿Qué es PulseDev?

PulseDev es una herramienta CLI para Node.js que levanta un servidor HTTP local, vigila los cambios en tus archivos y recarga el servidor automáticamente. Está construida **100% con módulos nativos de Node.js**, sin ninguna dependencia de producción.

Está pensada para developers que necesitan un entorno de desarrollo rápido y liviano, sin instalar Webpack, Vite ni nada por el estilo.

**¿Qué hace exactamente?**

- 🖥️ Levanta un servidor HTTP nativo (sin Express, sin Fastify)
- 👁️ Vigila el sistema de archivos con `fs.watch` y recarga ante cambios reales
- 🔁 Cache busting automático: inyecta hashes MD5 en los `src` y `href` del HTML
- 📝 Logs de peticiones HTTP en terminal o archivo persistente con rotación automática
- 📁 Genera la estructura base del proyecto con un solo comando
- 🎨 Tipos MIME extendidos: imágenes, video, audio, fuentes, documentos y más
- ⚙️ Configurable vía `pulsedev.json`
- ⚡ Cero dependencias de producción — todo Node.js nativo

## Instalación

```bash
npm install -g pulsedev
```

La instalación es **global**. No se genera `node_modules` en tu proyecto.

> **Requisito:** Node.js 22 LTS o superior

**Desarrollo local:**

```bash
git clone https://github.com/pabloacisera/pulsedev_linux.git
cd pulsedev
npm link
```

## Uso rápido

### 1 — Inicializar el proyecto

```bash
pulsedev init
```

Genera automáticamente:

```
tu-proyecto/
├── pulsedev.json          ← configuración
└── src/
    ├── index.html         ← página principal
    ├── css/
    │   └── index.css      ← estilos base
    ├── js/
    │   ├── index.js       ← script principal
    │   └── socket-client.js ← cliente WebSocket
    └── assets/
        └── Arimo-VariableFont_wght.ttf
```

### 2 — Levantar el servidor

```bash
pulsedev run
```

El servidor queda corriendo en `http://localhost:3003` (o el puerto configurado).
Desde ese momento, cualquier cambio en los archivos de `src/` dispara un reload automático.

### 3 — Ayuda y versión

```bash
pulsedev --help
pulsedev --version
```

## Configuración — `pulsedev.json`

```json
{
    "watchPath": ["*"],
    "runFile": "index.html",
    "port": 3003,
    "outputPath": "terminal",
    "ignoreExtensions": ["*.txt", "*.log", "*.env", "*.md"],
    "debounceDelay": 0.5,
    "recursive": true,
    "logLimit": 5
}
```

| Propiedad | Tipo | Descripción | Default |
|-----------|------|-------------|---------|
| `watchPath` | `string[]` | Directorios a vigilar. `["*"]` vigila todo el proyecto | `["*"]` |
| `runFile` | `string` | Archivo HTML de entrada | `"index.html"` |
| `port` | `number` | Puerto del servidor HTTP | `3003` |
| `outputPath` | `string` | Destino de logs: `"terminal"` o ruta de carpeta | `"terminal"` |
| `ignoreExtensions` | `string[]` | Extensiones que el watcher ignora | `["*.txt","*.log","*.env","*.md"]` |
| `debounceDelay` | `number` | Segundos de espera antes del reload (evita eventos repetidos) | `0.5` |
| `recursive` | `boolean` | Vigilar subdirectorios. Ver nota importante abajo. | `true` |
| `logLimit` | `number` | Tamaño máximo del log en KB antes de rotar | `5` |

---

`recursive` controla si el watcher entra en subdirectorios al vigilar cambios.
Su comportamiento depende de cómo esté configurado `watchPath`:

**Caso 1 — `watchPath: ["*"]` con `recursive: false` → Configuración inválida**

```json
{
    "watchPath": ["*"],
    "recursive": false
}
```

Con `watchPath: ["*"]` el servidor escucha desde la raíz del proyecto.
Si `recursive` fuera `false`, solo detectaría cambios en archivos ubicados
directamente en esa raíz (donde normalmente solo está `pulsedev.json`).
Ningún cambio en `src/` sería detectado y el hot reload nunca funcionaría.

PulseDev detecta esta combinación, ignora el `false`, fuerza `recursive: true`
automáticamente y muestra una advertencia en terminal explicando el motivo.

**Caso 2 — `watchPath` con rutas propias y `recursive: false` → Válido**

```json
{
    "watchPath": ["./src/css", "./src/js"],
    "recursive": false
}
```

Con rutas específicas el usuario controla exactamente qué directorios vigilar.
`recursive: false` es válido acá: el watcher escucha solo los archivos
en la raíz de cada ruta configurada, sin entrar en subdirectorios.
PulseDev muestra un mensaje informativo confirmando el modo activo.

**Caso 3 — Cualquier `watchPath` con `recursive: true` o sin configurar → Correcto**

```json
{
    "watchPath": ["*"],
    "recursive": true
}
```

Comportamiento estándar. El watcher entra en todos los subdirectorios
de las rutas configuradas. Es el modo recomendado para la mayoría de los proyectos.

## Cómo funciona el hot reload

PulseDev no recarga ante cualquier evento del sistema de archivos. Antes de disparar el
reload, calcula el hash MD5 del archivo modificado y lo compara con el hash anterior
guardado en memoria. **Solo recarga si el contenido realmente cambió.**

```
archivo guardado en disco
    → fs.watch detecta el evento
        → stat() verifica que sea un archivo (no carpeta)
            → compareChanges() calcula MD5 y compara con Map en memoria
                → si cambió → debounce → reloadServer()
```

Adicionalmente, al servir el HTML el servidor inyecta automáticamente el hash del
contenido actual de cada CSS y JS referenciado:

```html
<!-- lo que escribís -->
<link rel="stylesheet" href="css/index.css">

<!-- lo que el browser recibe -->
<link rel="stylesheet" href="css/index.css?v=a3f2c1b4">
```

### Sistema de reload automático por WebSocket

PulseDev notifica al navegador cuando el servidor se reinicia mediante una conexión **WebSocket** persistente. El flujo es:

```
archivo modificado → watcher detecta cambio → reloadServer()
    → closeAllConnections() cierra sockets WS
    → servidor HTTP se reinicia con nueva config
        → navegador detecta socket cerrado (onclose)
            → location.reload() actualiza la página
```

**Cliente WebSocket inyectado** (`socket-client.js`):

```javascript
let ws = new WebSocket("ws://localhost:" + location.port);
ws.onclose = () => location.reload();        // servidor reiniciado
ws.onerror = () => setTimeout(() => location.reload(), 500);  // error de conexión
```

**¿Por qué WebSocket en vez de SSE o polling?**

- **Bidireccional**: el servidor puede notificar al cliente al instante
- **Bajo overhead**: una sola conexión TCP abierta, no múltiples requests HTTP
- **Latencia cero**: no hay polling interval, la notificación es inmediata
- **Nativo en el browser**: no requiere dependencias adicionales
- **Persistente**: la conexión permanece abierta mientras el navegador esté en la página

## Sistema de logs

Por defecto, las peticiones HTTP se registran en `logs/requests.log`. Un Worker Thread
nativo se encarga de rotar el archivo cuando supera el límite configurado en `logLimit`,
sin bloquear el hilo principal:

```
servidor corriendo en http://localhost:3003
- watching for changes in /path/to/project
- log written to logs/requests.log
```

Si preferís ver los logs en terminal, cambiá `"outputPath"` a `"terminal"` en tu
`pulsedev.json`.

## Tipos de contenido soportados

El servidor reconoce y sirve correctamente más de 40 tipos de archivos:

| Categoría | Extensiones |
|-----------|-------------|
| Web | `html`, `css`, `js`, `mjs`, `json`, `xml`, `txt` |
| Imágenes | `png`, `jpg`, `gif`, `webp`, `avif`, `svg`, `ico`, `bmp`, `tiff` |
| Fuentes | `ttf`, `otf`, `woff`, `woff2`, `eot` |
| Audio | `mp3`, `wav`, `ogg`, `aac`, `flac`, `opus` |
| Video | `mp4`, `webm`, `avi`, `mov`, `mkv` |
| Documentos | `pdf`, `doc`, `docx`, `xls`, `xlsx`, `zip` |

## Arquitectura del proyecto

```
pulsedev/
├── bin/
│   └── cli.js                   ← Punto de entrada CLI (init / run / --help / --version)
├── core/
│   ├── init.js                  ← Genera la estructura del proyecto
│   ├── run.js                   ← Re-export de serverManager
│   └── serverManager.js         ← Servidor HTTP, estado y reload
├── helpers/
│   ├── watcher.js               ← File watcher con fs.watch y debounce
│   ├── hashFingerprint.js       ← Comparación MD5 y cache busting
│   ├── resourceHasher.js        ← Inyección de hashes en HTML
│   ├── mimeTypes.js             ← Tipos MIME y extensiones binarias
│   ├── writter.js               ← Lectura/escritura de archivos + Worker de logs
│   └── counterChar.js           ← Worker Thread para rotación de logs
└── web/
    ├── assets/
    │   ├── Arimo-VariableFont_wght.ttf
    │   ├── github.svg
    │   └── npm.svg
    └── templates/
        ├── pulsedev.json         ← Config por defecto
        ├── index.html            ← Página de bienvenida
        ├── index.css             ← Estilos base
        ├── index.js              ← Script principal
        └── socket-client.js      ← Cliente WebSocket
```

## Tecnologías utilizadas

PulseDev está construido **100% con módulos nativos de Node.js**. Sin dependencias de producción.

| Módulo | Uso |
|--------|-----|
| `node:http` | Servidor HTTP |
| `node:fs` / `node:fs/promises` | Lectura, escritura y vigilancia de archivos |
| `node:path` | Resolución de rutas |
| `node:os` | Hostname para logs |
| `node:crypto` | Hash MD5 para fingerprinting y cache busting |
| `node:worker_threads` | Worker Thread para rotación de logs |
| `node:util` → `styleText` | Colores en terminal |
| `node:url` | Resolución de `__dirname` en ESM |

---

## Autor

Desarrollado por **randomdev** · Licencia [ISC](https://opensource.org/licenses/ISC)
