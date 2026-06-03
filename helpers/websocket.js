import crypto from "node:crypto";

const clients = new Set();

export function initWebSocket(httpServer) {

    /**
     * - "upgrade" es el evento que permite cambiar el modo de comunicación del servidor
     */

    httpServer.on("upgrade", (req, socket) => {
        // verificar que el cliente haya enviado una key
        const key = req.headers['sec-websocket-key'];
        if (!key) {
            socket.destroy();
            return;
        }

        /* hasheamos la key, le damos un secret(GUID - identificador unico global) reconocible para cualquier navegador y la escribimos en el socket
        *  - el digest convierte el binario en ASCII
        *  - se escribe en socket para secuestrar la conexion tcp, y convertilo en un canal bidireccional
        */
        const acceptKey = crypto
            .createHash("sha1")
            .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
            .digest('base64')

        socket.write(
            [
                "HTTP/1.1 101 Switching Protocols",
                "Upgrade: websocket",
                "Connection: Upgrade",
                `Sec-Websocket-Accept: ${acceptKey}`,
                "\r\n"
            ].join("\r\n")
        );

        /**
         * agregar el cliente al set
         */
        clients.add(socket);

        socket.on("close", () => clients.delete(socket));
        socket.on("error", () => clients.delete(socket));
    });
}

export function closeAllConnections() {
    /**
     * Frame WebSocket de texto con payload "reload" (6 bytes).
     * Construido manualmente:
     *   - byte 1: 0x81 (FIN=1, opcode=1 = texto)
     *   - byte 2: longitud del payload (sin máscara, <126)
     *   - resto:  payload
     * El cliente lo lee en onmessage y dispara location.reload().
     */
    const payload = "reload";
    const payloadBuffer = Buffer.from(payload, "utf-8");
    const reloadFrame = Buffer.concat([
        Buffer.from([0x81, payloadBuffer.length]),
        payloadBuffer
    ]);

    for (const c of clients) {
        try {
            c.write(reloadFrame);
        } catch (e) {
            // el socket puede estar ya cerrado o en estado inválido: lo destruimos igual
        }
        try {
            c.destroy();
        } catch (e) {
            console.error("WebSocket: error al cerrar conexión:", e.message);
        }
    }
    /**
     * Limpiar el Set como garantía extra. Si un destroy() falla silenciosamente
     * (catch vacío), el socket muerto quedaría en clients indefinidamente.
     * clients.clear() asegura que el Set queda vacío sin importar qué.
     */
    clients.clear();
}
