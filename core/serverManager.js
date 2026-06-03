import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { styleText } from "node:util";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { read, write } from "../helpers/writter.js";
import { hostname } from "node:os";
import { contentTypes, binaryExtensions, noHashExtensions } from "../helpers/mimeTypes.js";
import { injectResourceHashes } from "../helpers/resourceHasher.js";
import { startWatcher, _closeActiveWatchers } from "../helpers/watcher.js";
import { initWebSocket, closeAllConnections } from "../helpers/websocket.js";

const state = {
    config: null,
    server: null,
    isRestarting: false,
    currentDirectory: null,
    watcherAbortController: null
};

// exported for testing
let _reloadCount = 0;

async function upServer(config) {
    try {
        const server = createServer(async (req, res) => {
            let cleanURL = req.url.split("?")[0];

            let targetResource = cleanURL === '/' ? (config.runFile || 'index.html') : cleanURL;
            let filePath = join(state.currentDirectory, 'src', targetResource);

            /**
             * Guard contra path traversal:
             * Si la ruta resuelta se escapa del directorio src/ del proyecto,
             * respondemos 403 sin tocar el disco.
             */
            const srcRoot = resolve(join(state.currentDirectory, 'src'));
            const resolvedFilePath = resolve(filePath);
            if (!resolvedFilePath.startsWith(srcRoot)) {
                res.writeHead(403, { 'Content-Type': 'text/html' });
                res.end(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>403 - Acceso Denegado</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            color: #f8fafc;
                        }
                        .error-card {
                            background: #1e293b;
                            border: 1px solid #334155;
                            border-radius: 12px;
                            padding: 2.5rem;
                            text-align: center;
                            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                            max-width: 450px;
                            width: 90%;
                        }
                        .error-code {
                            font-size: 5rem;
                            font-weight: 800;
                            background: linear-gradient(135deg, #f87171 0%, #fb923c 100%);
                            -webkit-background-clip: text;
                            background-clip: text;
                            color: transparent;
                            line-height: 1;
                            margin-bottom: 0.5rem;
                        }
                        h1 { font-size: 1.5rem; font-weight: 600; color: #f1f5f9; margin-bottom: 0.75rem; }
                        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
                        .btn-back {
                            display: inline-block;
                            background: linear-gradient(135deg, #f87171 0%, #fb923c 100%);
                            color: #ffffff;
                            text-decoration: none;
                            font-weight: 500;
                            font-size: 0.9rem;
                            padding: 0.75rem 1.5rem;
                            border-radius: 6px;
                            transition: transform 0.2s, opacity 0.2s;
                        }
                        .btn-back:hover { transform: translateY(-1px); opacity: 0.95; }
                    </style>
                </head>
                <body>
                    <div class="error-card">
                        <div class="error-code">403</div>
                        <h1>Acceso denegado</h1>
                        <p>La ruta solicitada está fuera del directorio permitido.</p>
                        <a href="/" class="btn-back">Volver al inicio</a>
                    </div>
                </body>
                </html>
                `);
                return;
            }

            let requestMessage = `- ${new Date().toLocaleString()} : ${req.method} : ${req.url} - ${req.headers['user-agent'] || 'unknown'}`;

            if (config.outputPath && config.outputPath === "terminal") {
                console.log(
                    styleText("dim", `- ${new Date().toLocaleString()} : `) +
                    styleText("green", req.method) +
                    styleText("dim", ` : ${req.url} - ${req.headers['user-agent'] || 'unknown'}`)
                );
            } else {
                if (!existsSync(join(state.currentDirectory, 'logs'))) {
                    mkdirSync(join(state.currentDirectory, 'logs'), { recursive: true });
                }
                await write(join(state.currentDirectory, 'logs', 'requests.log'), requestMessage, config.logLimit || 5);
            }

            const ext = filePath.split('.').pop();

            const isBinary = binaryExtensions.has(ext);

            try {
                let content = await readFile(filePath, isBinary ? null : 'utf-8');

                if ((ext === "html" || cleanURL === "/") && !noHashExtensions.has(ext)) {
                    content = await injectResourceHashes(content, state.currentDirectory);
                }

                const contentType = contentTypes[ext] || 'text/plain';
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content);
            } catch {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>404 - Archivo No Encontrado</title>
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
                            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                            min-height: 100vh;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            color: #f8fafc;
                        }
                        .error-card {
                            background: #1e293b;
                            border: 1px solid #334155;
                            border-radius: 12px;
                            padding: 2.5rem;
                            text-align: center;
                            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
                            max-width: 450px;
                            width: 90%;
                        }
                        .error-code {
                            font-size: 5rem;
                            font-weight: 800;
                            background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
                            -webkit-background-clip: text;
                            background-clip: text;
                            color: transparent;
                            line-height: 1;
                            margin-bottom: 0.5rem;
                        }
                        h1 { font-size: 1.5rem; font-weight: 600; color: #f1f5f9; margin-bottom: 0.75rem; }
                        p { color: #94a3b8; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
                        .btn-back {
                            display: inline-block;
                            background: linear-gradient(135deg, #38bdf8 0%, #6366f1 100%);
                            color: #ffffff;
                            text-decoration: none;
                            font-weight: 500;
                            font-size: 0.9rem;
                            padding: 0.75rem 1.5rem;
                            border-radius: 6px;
                            transition: transform 0.2s, opacity 0.2s;
                        }
                        .btn-back:hover { transform: translateY(-1px); opacity: 0.95; }
                    </style>
                </head>
                <body>
                    <div class="error-card">
                        <div class="error-code">404</div>
                        <h1>Archivo no encontrado</h1>
                        <p>El recurso que estás intentando cargar no existe en el directorio local o la ruta es incorrecta.</p>
                        <a href="/" class="btn-back">Volver al inicio</a>
                    </div>
                </body>
                </html>
                `);
            }
        });

        initWebSocket(server);

        state.server = server;
        server.listen(config.port || 3003);
        console.log(styleText("bgGreen", " servidor ") + ` corriendo en http://localhost:${config.port || 3003}`);
    } catch (error) {
        if (config.outputPath === "log") {
            if (!existsSync(join(state.currentDirectory, 'logs'))) {
                mkdirSync(join(state.currentDirectory, 'logs'), { recursive: true });
            }
            let messageError = `${Date.now()} - ${hostname()}/${state.currentDirectory}: ${error.message}`;
            await write(join(state.currentDirectory, 'logs', 'errors.log'), messageError);
        }
        console.log(styleText("bgRed", " error: ") + error.message);
        process.exit(1);
    }
}

async function reloadServer() {
    if (state.isRestarting) return;
    state.isRestarting = true;

    console.log(styleText("bgYellow", " reseteando ") + " Reiniciando PulseDev...");

    _reloadCount++;

    closeAllConnections();

    if (state.server) {
        await new Promise((resolve) => state.server.close(() => resolve()));
    }

    try {
        const rawConfig = await read(join(state.currentDirectory, 'pulsedev.json'));
        if (!rawConfig) {
            console.log(styleText("bgRed", " error ") + " No se pudo leer pulsedev.json al reiniciar.");
            return;
        }
        state.config = JSON.parse(rawConfig);
        await upServer(state.config);
    } catch (error) {
        console.error("Error al reiniciar el servidor:", error.message);
    } finally {
        state.isRestarting = false;
    }
}

export async function startServer(currentDirectory, preloadedConfig = null) {
    state.currentDirectory = currentDirectory;

    if (preloadedConfig) {
        state.config = preloadedConfig;
    } else {
        if (!existsSync(join(currentDirectory, 'pulsedev.json'))) {
            console.log(styleText("bgRed", " warning: ") + "El archivo pulsedev.json no existe en el directorio.");
            process.exit(1);
        }

        state.config = JSON.parse(await read(join(currentDirectory, 'pulsedev.json')));
    }
    await upServer(state.config);

    // Abortar watchers previos antes de crear nuevos (evita fugas de event loop)
    if (state.watcherAbortController) {
        state.watcherAbortController.abort();
        state.watcherAbortController = null;
    }
    await _closeActiveWatchers();
    state.watcherAbortController = new AbortController();
    startWatcher(state.config, currentDirectory, reloadServer, state.watcherAbortController.signal);
}

export { reloadServer };

// exported for testing
export async function closeServer() {
    closeAllConnections();

    if (state.watcherAbortController) {
        state.watcherAbortController.abort();
        state.watcherAbortController = null;
    }
    await _closeActiveWatchers();
    return new Promise((resolve) => {
        if (state.server) {
            state.server.closeAllConnections?.();
            state.server.close(() => resolve());
        } else {
            resolve();
        }
    });
}
export function getReloadCount() { return _reloadCount; }
export function resetReloadCount() { _reloadCount = 0; }