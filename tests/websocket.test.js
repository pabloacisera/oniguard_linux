/**
 * ============================================================
 * TESTS: helpers/websocket.js — Sistema WebSocket (Integración)
 * ============================================================
 *
 * Tests básicos de handshake y cleanup. Patrón async/await
 * con Promises explícitas para evitar el callback `done` que
 * generaba tests cancelados por "Promise resolution is still
 * pending but the event loop has already resolved".
 * ============================================================
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Socket } from "node:net";
import crypto from "node:crypto";

import { initWebSocket, closeAllConnections } from "../helpers/websocket.js";

const PORT_BASE = 22000;
let portCounter = 0;
const getPort = () => PORT_BASE + (portCounter++);

function makeKey() {
    return crypto.randomBytes(16).toString("base64");
}

function makeAccept(key) {
    return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
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
            reject(new Error("socket cerrado antes de recibir datos"));
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

function buildRequest({ port, key } = {}) {
    const lines = [
        "GET / HTTP/1.1",
        `Host: localhost:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        "Sec-WebSocket-Version: 13",
    ];
    if (key) lines.push(`Sec-WebSocket-Key: ${key}`);
    lines.push("\r\n");
    return lines.join("\r\n");
}

function listen(server, port) {
    return new Promise((resolve) => server.listen(port, resolve));
}

function closeServer(server) {
    return new Promise((resolve) => {
        if (typeof server.closeAllConnections === "function") {
            server.closeAllConnections();
        }
        let settled = false;
        const finish = () => { if (!settled) { settled = true; resolve(); } };
        server.close(() => finish());
        setTimeout(finish, 100);
    });
}

// ============================================================
// TESTS
// ============================================================
describe("WebSocket handshake", () => {

    test("Conexión sin key es rechazada", async () => {
        const port = getPort();
        const server = createServer();
        initWebSocket(server);
        await listen(server, port);

        const client = await connectClient(port);
        client.write(buildRequest({ port }));

        await onceClose(client);

        await closeServer(server);
    });

    test("Handshake válido retorna 101", async () => {
        const port = getPort();
        const server = createServer();
        initWebSocket(server);
        await listen(server, port);

        const client = await connectClient(port);
        const key = makeKey();
        const accept = makeAccept(key);

        const handshakePromise = onceData(client, (buf) => buf.includes("101"));
        client.write(buildRequest({ port, key }));

        const response = await handshakePromise;
        const lower = response.toLowerCase();
        assert.ok(
            response.includes("101 Switching Protocols"),
            "Debe responder 101 Switching Protocols"
        );
        assert.ok(
            lower.includes(`sec-websocket-accept: ${accept.toLowerCase()}`),
            "Debe incluir el Sec-WebSocket-Accept correcto"
        );

        client.destroy();
        await closeServer(server);
    });
});

describe("WebSocket cleanup", () => {

    test("closeAllConnections() cierra sockets", async () => {
        const port = getPort();
        const server = createServer();
        initWebSocket(server);
        await listen(server, port);

        const client = await connectClient(port);
        const key = makeKey();

        const handshakePromise = onceData(client, (buf) => buf.includes("101"));
        client.write(buildRequest({ port, key }));

        await handshakePromise;

        closeAllConnections();

        await onceClose(client);

        await closeServer(server);
    });
});
