/**
 * ============================================================
 * TESTS: E2E Full Flow — init → run → hot reload → WebSocket
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS EL FLUJO COMPLETO?
 * ---------------------------------------
 * Los tests unitarios y de integración verifican partes aisladas.
 * Este archivo prueba la ORQUESTACIÓN COMPLETA: desde que el
 * usuario ejecuta pulsedev init hasta que el servidor sirve HTML
 * con cache-busting, el watcher detecta cambios, y el WebSocket
 * envía la señal de recarga al navegador.
 *
 * ESTRATEGIA:
 * ----------
 * Importamos runInit, startServer, reloadServer, closeServer
 * directamente. Cada test es autónomo: crea su temp dir, inicia
 * el servidor con su config, ejecuta la aserción, y limpia.
 *
 * Para el watcher usamos fs.writeFile real y esperamos tiempos
 * generosos para que fs.watch + debounce se completen.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + fetch + net.Socket
 * ----------------------------------------------------------------
 * Todo nativo. No hay dependencias externas.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Socket } from "node:net";
import crypto from "node:crypto";

import { runInit } from "../core/init.js";
import {
    startServer,
    closeServer,
    getReloadCount,
    resetReloadCount
} from "../core/serverManager.js";


// ============================================================
// HELPERS
// ============================================================

let portCounter = 50000;
const getPort = () => portCounter++;

async function waitForServer(url, retries = 20, delay = 250) {
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
// SUITE: Flujo completo init → servidor → requests
// ==============================================================
describe("flujo completo init -> servidor -> requests", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-e2e-full-${PORT}`);
        await mkdir(suiteDir, { recursive: true });
        await runInit(suiteDir);

        startServer(suiteDir, {
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            debounceDelay: 0.5
        });
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("runInit + startServer + GET / -> 200 con HTML", async () => {
        /**
         * FLUJO: runInit crea toda la estructura. startServer levanta
         * el servidor sobre esa estructura. GET / debe servir index.html.
         *
         * ESPERA: status 200, body contiene <!DOCTYPE html>.
         *
         * ¿POR QUÉ IMPORTA? Es el onboarding completo de un usuario nuevo.
         * Si esta cadena se rompe, la herramienta es inútil desde el start.
         *
         * SI FALLA: pulsedev init seguido de pulsedev run da error.
         */
        const res = await fetch(`http://localhost:${PORT}/`);
        assert.equal(res.status, 200);
        const body = await res.text();
        assert.ok(body.includes("<!DOCTYPE html>"), "Debe servir HTML válido");
    });

    test("GET /css/index.css retorna el CSS generado por init", async () => {
        /**
         * FLUJO: init genera src/css/index.css. El servidor lo sirve
         * con Content-Type: text/css.
         *
         * ESPERA: status 200, Content-Type text/css.
         *
         * ¿POR QUÉ IMPORTA? Los recursos del template deben servirse
         * correctamente. Si el CSS no se sirve, la página se ve sin estilos.
         *
         * SI FALLA: Los archivos generados por init no se sirven.
         */
        const res = await fetch(`http://localhost:${PORT}/css/index.css`);
        assert.equal(res.status, 200);
        assert.ok(
            res.headers.get("content-type").includes("text/css")
        );
    });

    test("El HTML de / tiene ?v= en los recursos", async () => {
        /**
         * FLUJO: El HTML servido por el servidor real debe tener
         * cache-busting (injectResourceHashes se llama en el handler).
         *
         * ESPERA: El body contiene "?v=".
         *
         * ¿POR QUÉ IMPORTA? Confirma que injectResourceHashes está
         * integrado en el pipeline del servidor.
         *
         * SI FALLA: El servidor sirve HTML sin cache-busting.
         */
        const res = await fetch(`http://localhost:${PORT}/`);
        const body = await res.text();
        assert.ok(body.includes("?v="), "El HTML debe contener ?v= (cache-busting)");
    });

});


// ==============================================================
// SUITE: Hot reload con watcher
// ==============================================================
describe("hot reload con watcher", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-e2e-hr-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html>original</html>", "utf-8");
        await writeFile(join(suiteDir, "pulsedev.json"), JSON.stringify({
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 0.2,
            recursive: true,
            ignoreExtensions: ["*.txt", "*.log", "*.env", "*.md"]
        }), "utf-8");
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("Modificar src/index.html -> watcher detecta -> servidor se reinicia", async () => {
        /**
         * FLUJO: Se inicia el servidor (que arranca el watcher).
         * Se modifica src/index.html. El watcher detecta el cambio,
         * llama a reloadServer, que cierra el viejo y arranca uno nuevo.
         *
         * ESPERA: Después de la recarga, GET / devuelve el nuevo contenido.
         *
         * ¿POR QUÉ IMPORTA? Es el caso de uso principal del hot reload.
         * Si falla, el desarrollador debe recargar manualmente el navegador.
         *
         * SI FALLA: Los cambios en archivos no se reflejan automáticamente.
         */
        // Iniciar server
        startServer(suiteDir);
        await waitForServer(`http://localhost:${PORT}/`);

        // Verificar contenido original
        let res = await fetch(`http://localhost:${PORT}/`);
        let body = await res.text();
        assert.ok(body.includes("original"), "Debe servir el contenido original");

        // Modificar el archivo
        await writeFile(join(suiteDir, "src", "index.html"), "<html>modificado</html>", "utf-8");

        // Esperar a que el watcher detecte, debounce, y reload
        await new Promise(r => setTimeout(r, 2000));

        // Verificar nuevo contenido
        res = await fetch(`http://localhost:${PORT}/`);
        body = await res.text();
        assert.ok(body.includes("modificado"), "Debe servir el contenido modificado tras el reload");

        await closeServer();
    });

    test("Debounce: 5 escrituras rápidas -> un solo reload", async () => {
        /**
         * FLUJO: Con debounceDelay=0.2s, se escriben 5 cambios
         * rápidos en 100ms. El watcher solo debe disparar 1 reload.
         *
         * ESPERA: getReloadCount() es 1 después de la ráfaga.
         *
         * ¿POR QUÉ IMPORTA? Sin debounce, cada evento de fs.watch
         * (que duplica eventos) dispararía un reload. El navegador
         * se recargaría en bucle.
         *
         * SI FALLA: Múltiples escrituras rápidas disparan múltiples
         *           reloads, causando una tormenta de recargas.
         */
        // Asegurar que el servidor está funcionando (el test anterior
        // puede haberlo dejado en un estado inconsistente)
        const port2 = getPort();
        const dir2 = join(tmpdir(), `pulsedev-e2e-deb-${port2}`);
        await mkdir(join(dir2, "src"), { recursive: true });
        await writeFile(join(dir2, "src", "index.html"), "<html>debounce</html>", "utf-8");
        await writeFile(join(dir2, "pulsedev.json"), JSON.stringify({
            port: port2,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 0.2,
            recursive: true,
            ignoreExtensions: ["*.txt", "*.log", "*.env", "*.md"]
        }), "utf-8");

        startServer(dir2);
        await waitForServer(`http://localhost:${port2}/`);

        // Esperar a que el watcher se estabilice
        await new Promise(r => setTimeout(r, 500));
        resetReloadCount?.();

        // Escribir 5 veces rápidamente
        for (let i = 0; i < 5; i++) {
            await writeFile(join(dir2, "src", "index.html"),
                `<html>version-${i}</html>`, "utf-8");
            await new Promise(r => setTimeout(r, 30));
        }

        // Esperar el debounce (200ms) + margen
        await new Promise(r => setTimeout(r, 1500));

        const count = getReloadCount?.() ?? 0;
        assert.equal(count, 1, `Debe haber exactamente 1 reload, no ${count}`);

        await closeServer();
        await rm(dir2, { recursive: true, force: true });
    });

    test('ignoreExtensions: ["*.txt"] -> cambio en .txt no dispara reload', async () => {
        /**
         * FLUJO: Config con ignoreExtensions: ["*.txt"]. El watcher
         * debe ignorar cambios en .txt.
         *
         * ESPERA: reloadCount no cambia después de escribir un .txt.
         *
         * ¿POR QUÉ IMPORTA? Los usuarios no quieren que cambios en
         * archivos de configuración, .env, o logs disparen un reload.
         *
         * SI FALLA: El watcher dispara reload para archivos ignorados.
         */
        const port3 = getPort();
        const dir3 = join(tmpdir(), `pulsedev-e2e-ign-${port3}`);
        await mkdir(join(dir3, "src"), { recursive: true });
        await writeFile(join(dir3, "src", "index.html"), "<html>ignore</html>", "utf-8");
        await writeFile(join(dir3, "pulsedev.json"), JSON.stringify({
            port: port3,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 0.2,
            recursive: true,
            ignoreExtensions: ["*.txt", "*.log", "*.env", "*.md"]
        }), "utf-8");

        startServer(dir3);
        await waitForServer(`http://localhost:${port3}/`);
        await new Promise(r => setTimeout(r, 500));
        resetReloadCount?.();

        // Escribir un .txt
        await writeFile(join(dir3, "src", "notas.txt"), "contenido de texto", "utf-8");

        await new Promise(r => setTimeout(r, 1500));

        const count = getReloadCount?.() ?? 0;
        assert.equal(count, 0, `No debe haber reloads para .txt, count=${count}`);

        await closeServer();
        await rm(dir3, { recursive: true, force: true });
    });

});


// ==============================================================
// SUITE: WebSocket live reload
// ==============================================================
describe("WebSocket live reload", () => {

    const PORT = getPort();
    let suiteDir;

    before(async () => {
        suiteDir = join(tmpdir(), `pulsedev-e2e-ws-${PORT}`);
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html>ws</html>", "utf-8");
        await writeFile(join(suiteDir, "pulsedev.json"), JSON.stringify({
            port: PORT,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 0.5
        }), "utf-8");

        startServer(suiteDir);
        await waitForServer(`http://localhost:${PORT}/`);
    });

    after(async () => {
        await closeServer();
        await rm(suiteDir, { recursive: true, force: true });
    });

    test("Cliente WebSocket conecta al servidor real de PulseDev", async () => {
        /**
         * FLUJO: Se conecta un socket TCP raw, se envía el handshake
         * WebSocket (upgrade request con Sec-WebSocket-Key).
         *
         * ESPERA: Respuesta 101 Switching Protocols con Accept correcto.
         *
         * ¿POR QUÉ IMPORTA? El live reload depende de WebSocket. Sin
         * handshake exitoso, el cliente no puede recibir señales de reload.
         *
         * SI FALLA: El cliente WebSocket no puede conectar.
         */
        const client = await connectClient(PORT);
        const key = makeKey();
        const accept = makeAccept(key);

        const handshakePromise = onceData(client, (buf) => buf.includes("101"));
        client.write(buildWsRequest(PORT, key));

        const response = await handshakePromise;
        assert.ok(response.includes("101 Switching Protocols"), "Debe responder 101");
        assert.ok(
            response.toLowerCase().includes(`sec-websocket-accept: ${accept.toLowerCase()}`),
            "Debe tener el Accept correcto"
        );

        client.destroy();
    });

    test("closeAllConnections() envía frame reload al cliente", async () => {
        /**
         * FLUJO: Cliente conectado via WS. Se llama a closeAllConnections
         * (lo mismo que hace reloadServer internamente).
         *
         * ESPERA: El cliente recibe "reload" en el frame y el socket se cierra.
         *
         * ¿POR QUÉ IMPORTA? El frame "reload" es la señal que hace que
         * el navegador ejecute location.reload(). Si no se envía, el
         * navegador no se recarga automáticamente.
         *
         * SI FALLA: closeAllConnections() no notifica a los clientes.
         */
        const { closeAllConnections } = await import("../helpers/websocket.js");

        const client = await connectClient(PORT);
        const key = makeKey();

        const handshakePromise = onceData(client, (buf) => buf.includes("101"));
        client.write(buildWsRequest(PORT, key));
        await handshakePromise;

        // Esperar el frame "reload"
        const framePromise = onceData(client, (buf) => buf.includes("reload"));

        closeAllConnections();

        const frameData = await framePromise;
        assert.ok(frameData.includes("reload"), "El frame debe contener 'reload'");

        await onceClose(client);
    });

    test("Después de reloadServer(), nuevo cliente puede reconectar", async () => {
        /**
         * FLUJO: 1) Conectar WS. 2) Llamar reloadServer. 3) Esperar
         * a que el nuevo servidor esté listo. 4) Conectar WS de nuevo.
         *
         * ESPERA: El nuevo handshake es exitoso (101).
         *
         * ¿POR QUÉ IMPORTA? Después de un reload, el servidor nuevo
         * debe tener WebSocket funcional. Si no, el live reload se
         * rompe hasta que el usuario recargue manualmente.
         *
         * SI FALLA: Después de reloadServer, los nuevos clientes WS
         *           no pueden conectar.
         */
        const { reloadServer: rs } = await import("../core/serverManager.js");

        // Primer WS
        const c1 = await connectClient(PORT);
        const k1 = makeKey();
        const h1 = onceData(c1, (buf) => buf.includes("101"));
        c1.write(buildWsRequest(PORT, k1));
        await h1;

        // Reload
        await rs();

        // Esperar a que el nuevo servidor esté listo
        await waitForServer(`http://localhost:${PORT}/`);
        await new Promise(r => setTimeout(r, 300));

        // Segundo WS (debe conectar al nuevo servidor)
        const c2 = await connectClient(PORT);
        const k2 = makeKey();
        const a2 = makeAccept(k2);
        const h2 = onceData(c2, (buf) => buf.includes("101"));
        c2.write(buildWsRequest(PORT, k2));

        const response2 = await h2;
        assert.ok(response2.includes("101 Switching Protocols"),
            "El nuevo servidor debe aceptar WS");
        assert.ok(
            response2.toLowerCase().includes(`sec-websocket-accept: ${a2.toLowerCase()}`),
            "Nuevo handshake debe tener Accept correcto"
        );

        c1.destroy();
        c2.destroy();
    });

});


// ==============================================================
// SUITE: Watcher modo no recursivo
// ==============================================================
describe("watcher modo no recursivo", () => {

    test("recursive: false + watchPath: ['./src/css'] -> cambio en src/js NO dispara reload", async () => {
        /**
         * FLUJO: Se configura watchPath: ["./src/css"] con recursive: false.
         * El watcher solo vigila la raíz de src/css/. Un cambio en src/js/
         * (otro directorio) no debe ser detectado.
         *
         * ESPERA: reloadCount es 0 después de escribir en src/js/.
         *
         * ¿POR QUÉ IMPORTA? El usuario debe poder restringir el watcher
         * a directorios específicos para evitar reloads innecesarios.
         *
         * SI FALLA: El watcher ignora watchPath y vigila todo el proyecto.
         */
        const port = getPort();
        const dir = join(tmpdir(), `pulsedev-e2e-nr-${port}`);
        await mkdir(join(dir, "src", "css"), { recursive: true });
        await mkdir(join(dir, "src", "js"), { recursive: true });
        await writeFile(join(dir, "src", "index.html"), "<html>nr</html>", "utf-8");
        await writeFile(join(dir, "src", "css", "styles.css"), "body {}", "utf-8");
        await writeFile(join(dir, "pulsedev.json"), JSON.stringify({
            port,
            outputPath: "terminal",
            watchPath: ["./src/css"],
            runFile: "index.html",
            debounceDelay: 0.2,
            recursive: false,
            ignoreExtensions: ["*.txt", "*.log", "*.env", "*.md"]
        }), "utf-8");

        startServer(dir);
        await waitForServer(`http://localhost:${port}/`);
        await new Promise(r => setTimeout(r, 500));
        resetReloadCount?.();

        // Escribir en src/js/ (directorio no vigilado)
        await writeFile(join(dir, "src", "js", "nuevo.js"), "console.log('nuevo');", "utf-8");

        await new Promise(r => setTimeout(r, 1500));

        const count = getReloadCount?.() ?? 0;
        assert.equal(count, 0, `No debe haber reloads para cambios fuera de watchPath, count=${count}`);

        await closeServer();
        await rm(dir, { recursive: true, force: true });
    });

    test("recursive: false + watchPath: ['*'] -> advertencia en consola y se fuerza recursivo", async () => {
        /**
         * FLUJO: Config con watchPath: ["*"] y recursive: false.
         * startWatcher detecta que wildcard + !recursive es inválido,
         * logea una advertencia, y fuerza recursive=true.
         *
         * ESPERA: console.log capturado contiene la advertencia.
         *
         * ¿POR QUÉ IMPORTA? El usuario podría configurar valores
         * incompatibles. El sistema debe advertir y corregir, no
         * fallar silenciosamente.
         *
         * SI FALLA: La combinación inválida no se detecta y el
         *           watcher no vigila correctamente.
         */
        const port = getPort();
        const dir = join(tmpdir(), `pulsedev-e2e-warn-${port}`);
        await mkdir(join(dir, "src"), { recursive: true });
        await writeFile(join(dir, "src", "index.html"), "<html>warn</html>", "utf-8");
        await writeFile(join(dir, "pulsedev.json"), JSON.stringify({
            port,
            outputPath: "terminal",
            watchPath: ["*"],
            runFile: "index.html",
            debounceDelay: 10,
            recursive: false // inválido con wildcard
        }), "utf-8");

        // Capturar console.log para ver la advertencia
        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(" "));

        startServer(dir);
        await waitForServer(`http://localhost:${port}/`);
        await new Promise(r => setTimeout(r, 500));

        console.log = origLog;

        const output = logs.join(" ");
        assert.ok(
            output.includes("advertencia") || output.includes("recursive"),
            "Debe haber una advertencia sobre recursive:false con wildcard. " +
            `Logs: ${output}`
        );

        await closeServer();
        await rm(dir, { recursive: true, force: true });
    });

});

