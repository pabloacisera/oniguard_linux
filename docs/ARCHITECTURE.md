# PulseDev — Arquitectura

## Árbol del proyecto

```
pulsedev/
├── bin/
│   └── cli.js            ← Entry point CLI (shebang)
├── core/
│   ├── init.js            ← pulsedev init
│   ├── run.js             ← pulsedev run (flags, merging, arranque)
│   └── serverManager.js   ← Servidor HTTP + watcher + reload
├── helpers/
│   ├── counterChar.js     ← Worker thread: truncado FIFO de logs
│   ├── hashFingerprint.js ← MD5 + Map para detectar cambios
│   ├── mimeTypes.js       ← Mapa extensión → Content-Type
│   ├── resourceHasher.js  ← Cache-busting (?v=) en HTML
│   ├── watcher.js         ← fs.watch con abort, debounce, wildcard
│   ├── websocket.js       ← WebSocket server (upgrade → frame "reload")
│   └── writter.js         ← Logging a archivo (append + worker truncado)
├── web/
│   ├── assets/            ← Logo, fuentes, iconos
│   └── templates/         ← Archivos que init copia al proyecto
├── tests/                 ← node:test + node:assert (116 tests)
├── docs/
│   └── ARCHITECTURE.md    ← Este archivo
├── package.json
├── LICENSE
└── README.md
```

## Flujo de entrada

```
CLI (bin/cli.js)
  │
  ├── pulsedev init
  │     └── core/init.js
  │           └── crea src/, src/js/, src/css/, src/assets/,
  │               pulsedev.json, index.html, index.js, etc.
  │
  └── pulsedev run [--flags]
        └── core/run.js
              ├── parseFlags(args)
              ├── loadBaseConfig(pulsedev.json)
              ├── validateFlagsOrExit(flags, config)
              ├── mergeConfig(config, flags)
              ├── [--persist → writeFile JSON]
              └── startServer(config)
                    └── core/serverManager.js
                          ├── upServer(config)
                          │     ├── createServer(handler)
                          │     ├── initWebSocket(server)
                          │     └── server.listen(port)
                          └── startWatcher(config, path, reloadCallback)
                                └── helpers/watcher.js
```

## Módulos en detalle

### bin/cli.js — Entry point

- Guard de versión Node.js ≥ 22 (usa `process.versions.node`)
- Interpreta `init`, `run`, `--help/-h`, `--version/-v`
- Import dinámico de `core/init.js` o `core/run.js`
- Sin dependencias externas

### core/init.js — `pulsedev init`

- Lee templates desde `web/templates/`
- Crea estructura de directorios: `src/`, `src/js/`, `src/css/`
- Copia assets desde `web/assets/` a `src/assets/`
- Escribe `pulsedev.json`, `index.html`, `index.js`, `socket-client.js`, `index.css`, `documentation.html`

### core/run.js — `pulsedev run` + sistema de flags

**Responsabilidad**: manejar los flags de CLI, hacer merge con el config, y arrancar el servidor.

**Sistema de flags**:
- `parseFlags(args)` — Parsea `process.argv` en `{ flag: valor }`. Soporta `--key value`, `--key=value`, `--bool`
- `coerceValue(rawValue, original)` — Convierte el string de CLI al tipo del valor original en JSON (number, boolean, array, string)
- `mergeConfig(baseConfig, flags)` — Override en memoria sin mutar el original
- `findUnknownFlags(flags, config)` — Detecta flags que no existen en el JSON
- `RESERVED_FLAGS` — `list-flags`, `persist` (siempre disponibles)
- `validateFlagsOrExit()` — Si hay flags desconocidos, muestra error con la lista de flags válidos

**Si no hay flags de usuario**, pasa el config directamente a `startServer()`.
**Si hay `--persist`**, escribe el config mergeado al disco.

### core/serverManager.js — Núcleo del servidor

**Estado global** (`state`):
- `config` — Config actual
- `server` — Instancia de `http.createServer`
- `currentDirectory` — Directorio del proyecto
- `watcherAbortController` — `AbortController` para detener el watcher
- `isRestarting` — Flag antirrace para `reloadServer`
- `_reloadCount` — Contador exportado para testing

**Funciones**:

| Función | Rol |
|---------|-----|
| `upServer(config)` | Crea y arranca el HTTP server. Maneja cada request: path traversal guard, cache-busting, MIME types, logging, 404 |
| `startServer(dir, config?)` | Entry point público. Lee config si no se pasa, llama `upServer`, arranca `startWatcher` |
| `reloadServer()` | Cierra WS clients, cierra server viejo, lee config fresco, llama `upServer` |
| `closeServer()` | Testing: destruye WS clients, aborta watcher, cierra server |

**Handler de requests** (`createServer` callback):
1. Normaliza URL (`cleanURL = url.split("?")[0]`)
2. Resuelve path (`join(currentDirectory, 'src', targetResource)`)
3. **Path traversal guard**: si `resolve(filePath)` no empieza con `resolve(srcRoot)`, responde 403
4. Logging: terminal o archivo (según `outputPath`)
5. Detecta extensión → binary? (Buffer) | text? (utf-8)
6. Cache-busting: si es HTML, inyecta `?v=<hash>` en recursos JS/CSS
7. MIME type → respuesta

### helpers/watcher.js — Vigilante de archivos

- Usa `fs.promises.watch()` con `persistent: false` + `AbortSignal`
- Soporta `watchPath: ["*"]` (wildcard, vigila todo) o rutas específicas
- `recursive: false` + wildcard → se fuerza recursive=true con advertencia
- Filtra extensiones ignoradas (`ignoreExtensions`), archivos de log, ocultos
- **Debounce**: agrupa eventos múltiples en un solo reload (`debounceDelay`)
- **Change detection**: `compareChanges()` (MD5 + `Map`) evita reloads cuando el contenido no cambió realmente
- Tracking de watchers activos (`_activeWatchers`) para limpieza en tests

### helpers/websocket.js — Señal de live reload

- Escucha evento `upgrade` del HTTP server
- Handshake WebSocket (RFC 6455): valida `Sec-WebSocket-Key`, responde 101 con `Sec-WebSocket-Accept`
- `closeAllConnections()`: envía frame `"reload"` a todos los clientes y los destruye
- Clientes trackeados en un `Set<socket>`

### helpers/writter.js — Logging a archivo

- `write(path, text, logLimit)`: append + timeout 1s + Worker thread para truncado FIFO
- `writeFile(path, content)`: sobreescribe entero (para configs)
- `read(path)`: lee archivo o devuelve null
- El Worker usa `counterChar.js`: cuando el log excede `logLimit * 1000` chars, borra líneas viejas (FIFO)
- `.unref()` en setTimeout y Worker para no bloquear el event loop

### helpers/hashFingerprint.js — Detección de cambios

- `compareChanges(filepath)`: lee archivo, calcula MD5, lo compara con un `Map` interno. Retorna `true` si cambió
- `injectToUrl(url, hash)`: agrega `?v=<primeros 8 chars del hash>` a la URL

### helpers/resourceHasher.js — Cache-busting en HTML

- `injectResourceHashes(html, currentDirectory)`: busca `src` y `href` a `.js`/`.css`, calcula hash MD5 del archivo, inyecta `?v=<hash>` en el HTML servido

### helpers/mimeTypes.js — Mapa de Content-Type

- `contentTypes`: objeto plano con extensión → MIME type (~50 entradas)
- `binaryExtensions`: Set de extensiones que se sirven como Buffer (imágenes, fuentes, etc.)
- `noHashExtensions`: Set de extensiones que no reciben cache-busting

## Testing

- Framework: `node:test` + `node:assert/strict`
- Fixtures reales en disco (`fs.promises` con `os.tmpdir()` + cleanup en `after`)
- Requests reales con `fetch()` y `net.Socket`
- Sin mocks. Sin dependencias externas.
- 116 tests distribuidos en 10 archivos

```
tests/
├── cli.e2e.test.js               # E2E: child_process (flags, init, run)
├── counterChar.test.js           # Worker: truncado FIFO de logs
├── e2e.fullflow.test.js          # E2E full: init→server→reload→WS→no-recursivo
├── hashFingerprint.test.js       # compareChanges + injectToUrl
├── init.test.js                  # runInit: estructura, contenido, idempotencia
├── resourceHasher.test.js        # injectResourceHashes (?v=)
├── run.flags.test.js             # parseFlags, coerceValue, mergeConfig, etc.
├── server.test.js                # Servidor HTTP (respuestas, MIME, 404, cache-busting)
├── serverManager.integration.test.js  # Integración: path traversal, binarios, logging, reload
├── websocket.test.js             # WebSocket handshake + closeAllConnections
└── writter.test.js               # write, writeFile, read
```

## Seguridad

- **Path traversal**: toda request se resuelve con `path.resolve()` y se verifica contra `srcRoot` antes de tocar el disco
- **Flags desconocidos**: `validateFlagsOrExit()` termina con error si un flag no existe en el JSON
- **WebSocket**: sin key → `socket.destroy()`
- **Sin dependencias**: zero npm dependencias → superficie de ataque mínima

## Ciclo de vida del watcher

```
startServer()
  └── startWatcher(config, dir, reloadCallback, signal)
        └── fs.promises.watch(target, { recursive, persistent: false, signal })
              └── for await (event of watcher)
                    ├── ignorar directorios, extensiones ignoradas, logs, ocultos
                    ├── compareChanges(absolutePath) → ¿cambió realmente?
                    └── triggerReload() [debounced]
                          └── reloadServer()
                                ├── closeAllConnections() [WS frame "reload"]
                                ├── server.close()
                                ├── read(pulsedev.json)
                                └── upServer(config)

closeServer() / abortSignal.abort()
  └── for await arroja AbortError → catch → return
  └── _closeActiveWatchers() → watcher.close()
```

## Convenciones

- ESM (`"type": "module"`) en todos los archivos
- Zero dependencias de npm
- Funciones internas exportadas para testing con comentario `// exported for testing`
- Comentarios de documentación JSDoc en funciones públicas
- Tests en español (bloques `FLUJO / ESPERA / ¿POR QUÉ IMPORTA? / SI FALLA`)
