/**
 * ============================================================
 * TESTS: core/serverManager.js — Servidor HTTP (Integración real)
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * serverManager.js es el núcleo del servidor HTTP + watcher.
 * Contiene la lógica de:
 *   - Path traversal protection
 *   - Config runFile
 *   - MIME types
 *   - Binary file serving
 *   - Logging a archivo/terminal
 *   - reloadServer (WebSocket + restart)
 *
 * Testear con startServer real (no mocks) verifica el flujo
 * completo: request → handler → disco → response.
 *
 * ESTRATEGIA:
 * ----------
 * Cada suite usa un directorio temporal propio y un puerto
 * único (contador desde 40000). startServer se llama con
 * preloadedConfig para evitar leer pulsedev.json del disco.
 *
 * closeServer() + resetReloadCount() se exportan para testing
 * al final del módulo (misma convención que run.js).
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + fetch nativo
 * ----------------------------------------------------------
 * fetch está disponible desde Node 18+. No necesitamos http
 * para requests. Para WebSocket usamos net.Socket + crypto.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Socket } from "node:net";
import crypto from "node:crypto";

import { startServer, closeServer, getReloadCount, resetReloadCount } from "../core/serverManager.js";

// after global: cierra cualquier servidor que haya quedado vivo
after(async () => {
    await closeServer();
});

// ============================================================
// HELPERS
// ============================================================

let portCounter = 40000;
const getPort = () => portCounter++;

async function waitForServer(url, retries = 15, delay = 200) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await fetch(url);
            return res;
        } catch {
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error(`Server did not start at ${url}`);
}

function makeKey() {
    return crypto.randomBytes(16).toString("base64");
}

function makeAccept(key) {
    return crypto.createHash("sha1")
        .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
        .digest("base64");
}

function connectClient(port) {
    return new Promise((resolve, reject) => {
        const client = new Socket();
        client.once("error", reject);
        client.connect(port, "localhost", () => resolve(client));
    });
}

function onceData(client, predicate) {
    return new Promise((resolve, reject) => {
        let buffer = "";
        const onData = (chunk) => {
            buffer += chunk.toString();
            if (predicate(buffer)) {
                client.off("data", onData);
                client.off("error", onError);
                client.off("close", onClose);
                resolve(buffer);
            }
        };
        const onError = (err) => {
            client.off("data", onData);
            client.off("close", onClose);
            reject(err);
        };
        const onClose = () => {
            client.off("data", onData);
            client.off("error", onError);
            reject(new Error("socket closed before data"));
        };
        client.on("data", onData);
        client.once("error", onError);
        client.once("close", onClose);
    });
}

function onceClose(client) {
    return new Promise((resolve) => {
        if (client.destroyed) return resolve();
        client.once("close", () => resolve());
    });
}

/**
 * Envía un request HTTP raw (sin normalización de URL).
 * Necesario para probar path traversal porque fetch() normaliza
 * "/../" en la URL antes de enviarla.
 */
function sendRawRequest(port, method, path) {
    return new Promise((resolve, reject) => {
        const client = new Socket();
        let response = "";
        client.connect(port, "localhost", () => {
            client.write(
                `${method} ${path} HTTP/1.1\r\nHost: localhost:${port}\r\nConnection: close\r\n\r\n`
            );
        });
        client.on("data", (data) => { response += data.toString(); });
        client.on("close", () => resolve(response));
        client.on("error", reject);
    });
}

function buildWsRequest(port, key) {
    const lines = [
        "GET / HTTP/1.1",
        `Host: localhost:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13"
    ];
    if (key) lines.push(`Sec-WebSocket-Key: ${key}`);
    lines.push("\r\n");
    return lines.join("\r\n");
}


// ==============================================================
// SUITE: Path traversal
// ==============================================================
describe("path traversal", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-test-pt-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html><body>ok</body></html>", "utf-8");

        resetReloadCount?.();
        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            runFile: "index.html",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("GET /../etc/passwd → 403", async () => {
        /**
         * FLUJO: Se solicita `/../etc/passwd` via raw HTTP (porque
         * fetch() normaliza los ".." en la URL). El handler resuelve
         * la ruta con resolve() y verifica que no se escape de srcRoot.
         *
         * ESPERA: status 403, body es HTML.
         *
         * ¿POR QUÉ IMPORTA? Sin este guard, un atacante puede leer
         * cualquier archivo del sistema (path traversal clásico).
         *
         * SI FALLA: El servidor sirve archivos fuera de src/.
         */
        const raw = await sendRawRequest(PORT, "GET", "/../etc/passwd");
        const statusLine = raw.split("\r\n")[0];
        assert.ok(statusLine.includes("403"), `Debe responder 403, obtuvo: ${statusLine}`);
        assert.ok(raw.includes("<html"), "403 debe ser HTML");
    });

    test("GET /../../package.json → 403", async () => {
        /**
         * FLUJO: Doble traversal via raw HTTP.
         *
         * ESPERA: 403.
         *
         * ¿POR QUÉ IMPORTA? Doble ../ es el payload más común en
         * ataques de path traversal.
         *
         * SI FALLA: Un doble ../ elude el guard.
         */
        const raw = await sendRawRequest(PORT, "GET", "/../../package.json");
        const statusLine = raw.split("\r\n")[0];
        assert.ok(statusLine.includes("403"), `Debe responder 403, obtuvo: ${statusLine}`);
    });

    test("Respuesta 403 es HTML válido", async () => {
        /**
         * FLUJO: Se verifica el body de la respuesta 403.
         *
         * ESPERA: body contiene etiquetas HTML y el título 403.
         *
         * ¿POR QUÉ IMPORTA? Una página de error bien formada ayuda
         * al desarrollador a debuggear.
         *
         * SI FALLA: La página 403 está en blanco o es texto plano.
         */
        const raw = await sendRawRequest(PORT, "GET", "/../secret.txt");
        assert.ok(raw.includes("<html"), "Debe ser HTML");
        assert.ok(raw.includes("403") || raw.includes("Acceso denegado"), "Debe mencionar 403");
    });

});


// ==============================================================
// SUITE: Configuración runFile
// ==============================================================
describe("configuración runFile", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-test-rf-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "default index", "utf-8");
        await writeFile(join(suiteDir, "src", "app.html"), "app html content", "utf-8");
    });

    after(async () => {
        await rm(suiteDir, { recursive: true, force: true });
    });

    test('runFile: "app.html" → GET / sirve app.html', async () => {
        /**
         * FLUJO: Se configura runFile: "app.html". GET / debe
         * servir ese archivo en vez del default index.html.
         *
         * ESPERA: El body es "app html content".
         *
         * ¿POR QUÉ IMPORTA? El usuario puede querer un archivo de
         * entrada distinto. Si runFile no funciona, no puede
         * cambiar su entry point.
         *
         * SI FALLA: GET / siempre sirve index.html aunque se
         *           configure otro runFile.
         */
        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            runFile: "app.html",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);

        const res = await fetch(`http://localhost:${PORT}/`);
        const body = await res.text();
        assert.equal(body, "app html content");

        await closeServer();
    });

    test("runFile default es index.html", async () => {
        /**
         * FLUJO: Sin configurar runFile, el default es "index.html".
         *
         * ESPERA: GET / sirve src/index.html.
         *
         * ¿POR QUÉ IMPORTA? Es el comportamiento esperado por
         * cualquier desarrollador web.
         *
         * SI FALLA: Sin runFile configurado, GET / da 404.
         */
        const port2 = getPort();
        startServer(suiteDir, {
            port: port2,
            outputPath: "terminal",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${port2}/`);

        const res = await fetch(`http://localhost:${port2}/`);
        const body = await res.text();
        assert.equal(body, "default index");

        await closeServer();
    });

});


// ==============================================================
// SUITE: Archivos binarios
// ==============================================================
describe("archivos binarios", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-test-bin-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");

        // Crear un PNG mínimo (1x1 pixel rojo con firma válida)
        // Usamos un buffer pre-generado para evitar dependencias
        const pngSignature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
        const ihdr = Buffer.from([
            0x00, 0x00, 0x00, 0x0D, // length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width: 1
            0x00, 0x00, 0x00, 0x01, // height: 1
            0x08,                   // bit depth: 8
            0x02,                   // color type: RGB
            0x00,                   // compression
            0x00,                   // filter
            0x00,                   // interlace
        ]);
        // CRC for IHDR (pre-computed for 1x1 RGB)
        const ihdrCrc = Buffer.from([0xAE, 0x6E, 0xE1, 0xEF]);
        const iend = Buffer.from([
            0x00, 0x00, 0x00, 0x00, // length: 0
            0x49, 0x45, 0x4E, 0x44, // IEND
            0xAE, 0x42, 0x60, 0x82  // CRC for IEND
        ]);
        // IDAT: zlib-compressed raw image data for a 1x1 red pixel
        const rawRow = Buffer.from([0x00, 0xFF, 0x00, 0x00]); // filter byte 0, R=255, G=0, B=0
        const { deflateSync } = await import("node:zlib");
        const compressed = deflateSync(rawRow);
        const idatLen = Buffer.alloc(4);
        idatLen.writeUInt32BE(compressed.length);
        const idatType = Buffer.from([0x49, 0x44, 0x41, 0x54]); // IDAT
        // We'll skip CRC for IDAT for this test - the server doesn't validate

        const minimalPng = Buffer.concat([pngSignature, ihdr, ihdrCrc, idatLen, idatType, compressed, iend]);
        await writeFile(join(suiteDir, "src", "imagen.png"), minimalPng);

        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("PNG se sirve con Content-Type: image/png", async () => {
        /**
         * FLUJO: Se solicita src/imagen.png. El handler detecta
         * extensión .png y asigna contentTypes['png'].
         *
         * ESPERA: Content-Type: image/png
         *
         * ¿POR QUÉ IMPORTA? Los browsers usan Content-Type para
         * interpretar el recurso. Un tipo incorrecto (text/plain)
         * impide la renderización.
         *
         * SI FALLA: Las imágenes PNG se muestran rotas.
         */
        const res = await fetch(`http://localhost:${PORT}/imagen.png`);
        assert.equal(res.status, 200);
        assert.ok(
            res.headers.get("content-type").includes("image/png"),
            "Content-Type debe ser image/png"
        );
    });

    test("PNG se sirve con los primeros bytes del header PNG", async () => {
        /**
         * FLUJO: El archivo se lee como Buffer (isBinary=true).
         * El body debe ser un Buffer, no un string corrupto.
         *
         * ESPERA: Los primeros 4 bytes son la firma PNG: 89 50 4E 47.
         *
         * ¿POR QUÉ IMPORTA? Si el archivo binario se lee como string
         * (utf-8), los bytes no-UTF8 se corrompen. El PNG queda inválido.
         *
         * SI FALLA: Las imágenes PNG se sirven corruptas.
         */
        const res = await fetch(`http://localhost:${PORT}/imagen.png`);
        const buffer = await res.arrayBuffer();
        const header = new Uint8Array(buffer, 0, 4);
        assert.deepEqual(
            [header[0], header[1], header[2], header[3]],
            [0x89, 0x50, 0x4E, 0x47],
            "Los primeros 4 bytes deben ser la firma PNG"
        );
    });

});


// ==============================================================
// SUITE: Logging
// Cada test maneja su propio ciclo de vida (startServer → closeServer)
// para evitar servidores fantasma que mantengan el event loop vivo.
// ==============================================================
describe("logging", () => {

    let suiteDir;

    after(async () => {
        await closeServer();
        if (suiteDir) {
            await rm(suiteDir, { recursive: true, force: true }).catch(() => {});
        }
    });

    test('outputPath: "terminal" → NO crea carpeta logs/', async () => {
        /**
         * FLUJO: outputPath="terminal". Los logs van a la terminal
         * (console.log), no al disco.
         *
         * ESPERA: Después de un request, logs/ NO existe.
         *
         * ¿POR QUÉ IMPORTA? Si el usuario elige terminal, no debe
         * crearse basura en disco (carpeta logs/).
         *
         * SI FALLA: Aparece la carpeta logs/ aunque outputPath sea terminal.
         */
        const PORT = getPort();
        suiteDir = join(tmpdir(), `pulsedev-test-term-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");

        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);

        // Hacer un request para activar el logging
        await fetch(`http://localhost:${PORT}/`);
        await new Promise(r => setTimeout(r, 300));

        assert.ok(!existsSync(join(suiteDir, "logs")),
            "No debe existir carpeta logs/ con outputPath: terminal");

        await closeServer();
    });

    test('outputPath: "log" → crea logs/requests.log', async () => {
        /**
         * FLUJO: outputPath="log". Cada request escribe en
         * logs/requests.log.
         *
         * ESPERA: El archivo existe y contiene la URL del request.
         *
         * ¿POR QUÉ IMPORTA? Sin logs en disco, el usuario no puede
         * revisar el historial de requests posteriormente.
         *
         * SI FALLA: outputPath="log" no genera archivos de log.
         */
        const PORT = getPort();
        suiteDir = join(tmpdir(), `pulsedev-test-log-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");

        startServer(suiteDir, {
            port: PORT,
            outputPath: "log",
            watchPath: ["*"],
            debounceDelay: 10,
            logLimit: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);

        await fetch(`http://localhost:${PORT}/test-log`);
        await new Promise(r => setTimeout(r, 500));

        const logFile = join(suiteDir, "logs", "requests.log");
        assert.ok(existsSync(logFile), "logs/requests.log debe existir");

        const content = await readFile(logFile, "utf-8");
        assert.ok(content.includes("/test-log"), "El log debe contener la URL del request");

        await closeServer();
    });

    test("logLimit se pasa al worker", async () => {
        /**
         * FLUJO: Con logLimit pequeño, suficientes requests disparan
         * el worker de truncado. El worker aplica FIFO.
         *
         * ESPERA: El log no supera el límite configurado.
         *
         * ¿POR QUÉ IMPORTA? Sin logLimit, requests.log crece sin
         * control ocupando espacio en disco.
         *
         * SI FALLA: El log crece infinitamente o se trunca incorrectamente.
         */
        const PORT = getPort();
        suiteDir = join(tmpdir(), `pulsedev-test-limit-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");

        startServer(suiteDir, {
            port: PORT,
            outputPath: "log",
            watchPath: ["*"],
            debounceDelay: 10,
            logLimit: 1 // 1000 chars máximo
        });
        await waitForServer(`http://localhost:${PORT}/`);

        // Hacer suficientes requests para superar 1000 chars de log
        for (let i = 0; i < 15; i++) {
            await fetch(`http://localhost:${PORT}/page-${i}`);
        }

        // Esperar el timeout del worker (1000ms) + procesamiento
        await new Promise(r => setTimeout(r, 2500));

        const logFile = join(suiteDir, "logs", "requests.log");
        if (existsSync(logFile)) {
            const content = await readFile(logFile, "utf-8");
            // No debe exceder significativamente el límite
            assert.ok(content.length <= 1200,
                `El log (${content.length} chars) debe estar cerca del límite de 1000`);
        }

        await closeServer();
    });

});


// ==============================================================
// SUITE: MIME types
// ==============================================================
describe("MIME types", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-test-mime-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");
        await writeFile(join(suiteDir, "src", "archivo.xyz"), "test", "utf-8");
        await writeFile(join(suiteDir, "src", "grafico.svg"), "<svg></svg>", "utf-8");
        await writeFile(join(suiteDir, "src", "datos.json"), '{"a":1}', "utf-8");

        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("Extensión desconocida → text/plain", async () => {
        /**
         * FLUJO: .xyz no está en contentTypes → fallback text/plain.
         *
         * ESPERA: Content-Type: text/plain
         *
         * ¿POR QUÉ IMPORTA? Sin este fallback, una extensión no
         * mapeada devolvería undefined → header inválido.
         *
         * SI FALLA: Archivos con extensión rara no tienen Content-Type.
         */
        const res = await fetch(`http://localhost:${PORT}/archivo.xyz`);
        assert.ok(
            res.headers.get("content-type").includes("text/plain"),
            "Extensión desconocida debe ser text/plain"
        );
    });

    test(".svg → image/svg+xml", async () => {
        const res = await fetch(`http://localhost:${PORT}/grafico.svg`);
        assert.ok(
            res.headers.get("content-type").includes("image/svg+xml")
        );
    });

    test(".json → application/json", async () => {
        const res = await fetch(`http://localhost:${PORT}/datos.json`);
        assert.ok(
            res.headers.get("content-type").includes("application/json")
        );
    });

});


// ==============================================================
// SUITE: reloadServer
// ==============================================================
describe("reloadServer", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-test-reload-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html>before</html>", "utf-8");
        await writeFile(join(suiteDir, "pulsedev.json"), JSON.stringify({
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 10
        }), "utf-8");

        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 10
        });
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("reloadServer() cierra el servidor, envía frame WebSocket y levanta uno nuevo", async () => {
        /**
         * FLUJO: 1) Conectamos un WS al servidor. 2) Hacemos handshake.
         * 3) Llamamos reloadServer(). 4) El WS recibe frame "reload".
         * 5) El socket se cierra. 6) El nuevo servidor responde requests.
         *
         * ESPERA: El WS recibe "reload" y se cierra. Luego GET / es 200.
         *
         * ¿POR QUÉ IMPORTA? reloadServer es el corazón del hot reload:
         * mata el servidor viejo (enviando reload a los clientes) y
         * arranca uno nuevo.
         *
         * SI FALLA: El live reload no funciona, los clientes no se
         *           actualizan o el servidor nuevo no responde.
         */
        // Conectar WS
        const client = await connectClient(PORT);
        const key = makeKey();
        const handshakePromise = onceData(client, (buf) => buf.includes("101"));
        client.write(buildWsRequest(PORT, key));
        await handshakePromise;

        // Ahora el WS está conectado. Esperamos el frame "reload" cuando
        // llamemos a reloadServer.
        const framePromise = onceData(client, (buf) => buf.includes("reload"));

        // Llamar reloadServer
        const { reloadServer: rs } = await import("../core/serverManager.js");
        await rs();

        // El frame debe llegar
        const frameData = await framePromise;
        assert.ok(frameData.includes("reload"), "El frame debe contener 'reload'");

        // El socket debe cerrarse
        await onceClose(client);

        // El nuevo servidor debe estar funcionando
        const res = await fetch(`http://localhost:${PORT}/`);
        assert.equal(res.status, 200, "El nuevo servidor debe responder 200");
        const body = await res.text();
        assert.ok(body.includes("before"), "Debe servir el mismo contenido");
    });

    test("reloadServer() es idempotente si se llama dos veces rápido", async () => {
        /**
         * FLUJO: reloadServer() tiene isRestarting flag que previene
         * ejecución simultánea. Si se llama dos veces rápido, la
         * segunda debe retornar inmediatamente.
         *
         * ESPERA: La segunda llamada no lanza error.
         *
         * ¿POR QUÉ IMPORTA? El watcher puede disparar reloadServer
         * múltiples veces antes de que el primero termine (race condition).
         * Sin isRestarting, habría reloads anidados.
         *
         * SI FALLA: Dos llamadas rápidas a reloadServer causan error
         *           o servidor en estado inconsistente.
         */
        const { reloadServer: rs } = await import("../core/serverManager.js");
        resetReloadCount?.();

        // Llamar dos veces casi simultáneamente
        const p1 = rs();
        const p2 = rs();

        await Promise.all([p1, p2]);

        // El servidor debe seguir respondiendo
        const res = await fetch(`http://localhost:${PORT}/`);
        assert.equal(res.status, 200);
    });

});

