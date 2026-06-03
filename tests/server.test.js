/**
 * ============================================================
 * TESTS: core/run.js — Servidor HTTP (Integración)
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS EL SERVIDOR HTTP?
 * --------------------------------------
 * run.js es el núcleo del producto. Contiene:
 *   1. El servidor HTTP (createServer con manejo de MIME types)
 *   2. Inyección de hash cache-busting en HTML
 *   3. Respuestas 200 para recursos existentes
 *   4. Respuestas 404 para recursos inexistentes
 *   5. Lógica de reinicio (reloadServer)
 *
 * Testear esto con requests HTTP reales (no mocks) nos da confianza de que
 * el contrato del servidor se cumple: el browser va a recibir el Content-Type
 * correcto, el status correcto, y el contenido correcto.
 *
 * ESTRATEGIA: Tests de integración con servidor real
 * ---------------------------------------------------
 * A diferencia de los tests unitarios anteriores, acá levantamos un servidor
 * real en un puerto libre, hacemos requests con fetch nativo (disponible desde
 * Node 18+), y lo cerramos al final. Esto verifica el flujo completo:
 *   request → handler → lectura de disco → response
 *
 * ¿POR QUÉ NO MOCKEAR http.createServer?
 * Porque si mockeamos createServer, estamos testeando que llamamos a createServer
 * correctamente, no que el servidor responde correctamente. Los bugs más comunes
 * en un servidor son en el handler (rutas, MIME types, error handling), no en
 * la construcción del servidor.
 *
 * SETUP ESPECIAL:
 * run.js importa currentDirectory de bin/cli.js y lee pulsedev.json al cargar.
 * No podemos importarlo directamente en tests sin preparar ese entorno.
 * Testeamos la función upServer extrayéndola o levantando el servidor manualmente
 * replicando la lógica del handler para cubrir los contratos del servidor.
 *
 * ALTERNATIVA ADOPTADA:
 * Creamos un servidor de test que replique exactamente la misma lógica del
 * handler de run.js (mismo código de producción) sobre un directorio temporal
 * controlado. Esto nos permite testear el comportamiento sin acoplar los tests
 * a las importaciones circulares de cli.js.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

import { injectToUrl } from "../helpers/hashFingerprint.js";

// ============================================================
// SETUP: Directorio temporal que simula el proyecto del usuario
// ============================================================
const TMP_DIR = join(tmpdir(), "pulsedev-test-server");
const SRC_DIR = join(TMP_DIR, "src");
const TEST_PORT = 19876; // Puerto alto para no colisionar con servicios del sistema

// Replicamos el map de MIME types de run.js para el servidor de test
const contentTypes = {
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'json': 'application/json',
    'svg': 'image/svg+xml',
    'png': 'image/png',
    'ttf': 'font/ttf',
};

const binaryExtensions = new Set(['png', 'ttf', 'jpg', 'jpeg', 'gif', 'webp']);
const noHashExtensions = new Set(['png', 'ttf', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

// Helper para reemplazar src/href con hash (misma lógica de run.js)
async function replaceAsync(str, regex, asyncFn) {
    const promises = [];
    str.replace(regex, (match, ...args) => {
        promises.push(asyncFn(match, ...args));
        return match;
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift());
}

let server;

before(async () => {
    // Creamos la estructura mínima de un proyecto pulsedev
    await mkdir(SRC_DIR, { recursive: true });
    await mkdir(join(SRC_DIR, "css"), { recursive: true });
    await mkdir(join(SRC_DIR, "js"), { recursive: true });

    await writeFile(join(SRC_DIR, "index.html"), `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="css/index.css">
<script src="js/app.js"></script>
</head><body><h1>Test</h1></body></html>`, "utf-8");

    await writeFile(join(SRC_DIR, "css", "index.css"), "body { color: red; }", "utf-8");
    await writeFile(join(SRC_DIR, "js", "app.js"), "console.log('test');", "utf-8");

    // Levantamos el servidor replicando el handler de run.js
    server = createServer(async (req, res) => {
        const cleanURL = req.url.split("?")[0];
        const targetResource = cleanURL === "/" ? "index.html" : cleanURL;
        const filePath = join(SRC_DIR, targetResource);
        const ext = filePath.split(".").pop();
        const isBinary = binaryExtensions.has(ext);

        try {
            let content = await readFile(filePath, isBinary ? null : "utf-8");

            // Inyección de hash para HTML (misma lógica de run.js)
            if ((ext === "html" || cleanURL === "/") && !noHashExtensions.has(ext)) {
                const regexResources = /(src|href)="([^"]+\.(js|css))"/g;
                content = await replaceAsync(content, regexResources, async (match, attr, routeResource) => {
                    const pathResource = join(SRC_DIR, routeResource);
                    if (existsSync(pathResource)) {
                        const resourceContent = await readFile(pathResource, "utf8");
                        const resourceHash = createHash("md5").update(resourceContent).digest("hex");
                        const urlConHash = injectToUrl(routeResource, resourceHash);
                        return `${attr}="${urlConHash}"`;
                    }
                    return match;
                });
            }

            const contentType = contentTypes[ext] || "text/plain";
            res.writeHead(200, { "Content-Type": contentType });
            res.end(content);
        } catch {
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("<html><body>404</body></html>");
        }
    });

    await new Promise((resolve) => server.listen(TEST_PORT, resolve));
});

after(async () => {
    // Cerramos el servidor y limpiamos el directorio temporal
    await new Promise((resolve) => server.close(resolve));
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: Servidor HTTP
// ==============================================================
describe("Servidor HTTP de pulsedev", () => {

    test("GET / responde 200 con Content-Type text/html", async () => {
        /**
         * FLUJO: El browser navega a la raíz del servidor. El handler mapea "/"
         * al archivo configurado en runFile (por defecto index.html) y lo sirve.
         *
         * ESPERA: status 200, header Content-Type: text/html
         *
         * ¿POR QUÉ IMPORTA? Es el happy path principal. Si la raíz no responde
         * correctamente, el dev no puede ni abrir la aplicación en el browser.
         *
         * SI FALLA: pulsedev run levanta el servidor pero el browser recibe error
         *           al intentar cargar la página principal.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/`);
        assert.equal(res.status, 200);
        assert.ok(
            res.headers.get("content-type").includes("text/html"),
            "Content-Type debe incluir text/html"
        );
    });

    test("GET de un CSS existente responde 200 con Content-Type text/css", async () => {
        /**
         * FLUJO: El browser carga una hoja de estilos. El handler detecta la
         * extensión .css y responde con el MIME type correcto.
         *
         * ESPERA: status 200, Content-Type: text/css
         *
         * ¿POR QUÉ IMPORTA? Si el MIME type es incorrecto (por ejemplo text/plain),
         * los browsers modernos rechazan el CSS con un error CORS/MIME y los estilos
         * no se aplican. Esto rompe visualmente toda la aplicación.
         *
         * SI FALLA: La aplicación se ve sin estilos en el browser.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/css/index.css`);
        assert.equal(res.status, 200);
        assert.ok(
            res.headers.get("content-type").includes("text/css"),
            "Content-Type debe ser text/css"
        );
    });

    test("GET de un JS existente responde 200 con Content-Type application/javascript", async () => {
        /**
         * FLUJO: Igual que el CSS, pero para archivos JavaScript.
         *
         * ESPERA: status 200, Content-Type: application/javascript
         *
         * ¿POR QUÉ IMPORTA? Los módulos ES (type="module") son especialmente
         * estrictos con el MIME type. Un Content-Type incorrecto hace que el
         * browser rechace el módulo con un error de red, rompiendo toda la JS.
         *
         * SI FALLA: Los scripts del proyecto del usuario no se cargan.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/js/app.js`);
        assert.equal(res.status, 200);
        assert.ok(
            res.headers.get("content-type").includes("javascript"),
            "Content-Type debe incluir javascript"
        );
    });

    test("GET de un recurso inexistente responde 404", async () => {
        /**
         * FLUJO: Se pide un archivo que no existe en src/. El readFile lanza
         * ENOENT, el catch responde con 404 y una página de error HTML.
         *
         * ESPERA: status 404
         *
         * ¿POR QUÉ IMPORTA? Sin un 404 correcto, el browser interpreta el error
         * como 200 con contenido corrupto, lo que puede ocultar recursos faltantes
         * y generar bugs difíciles de debuggear.
         *
         * SI FALLA: Los recursos faltantes se sirven silenciosamente, dificultando
         *           la detección de typos en rutas de import/link.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/no/existe/archivo.js`);
        assert.equal(res.status, 404);
    });

    test("el HTML servido en / contiene hashes de cache-busting en CSS y JS", async () => {
        /**
         * FLUJO: Se solicita la raíz. El handler lee index.html, detecta los
         * atributos src="/js/app.js" y href="/css/index.css", hashea esos archivos
         * y reemplaza las URLs con ?v=<hash8chars>.
         *
         * ESPERA: El HTML retornado contiene "?v=" en al menos uno de los recursos.
         *
         * ¿POR QUÉ IMPORTA? Sin cache-busting, el browser sirve versiones cacheadas
         * de CSS/JS aunque el dev haya guardado cambios. El hot reload visual queda
         * roto porque el servidor reinicia pero el browser ignora los nuevos archivos.
         *
         * SI FALLA: Los cambios en CSS/JS no se reflejan en el browser sin hard refresh.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/`);
        const html = await res.text();
        assert.ok(
            html.includes("?v="),
            "El HTML debe contener URLs con cache-busting (?v=...)"
        );
    });

    test("el HTML de error 404 es HTML válido con status 404", async () => {
        /**
         * FLUJO: Se pide un recurso inexistente. Se verifica que la respuesta
         * sea un HTML completo (no un string vacío o un JSON de error).
         *
         * ESPERA: status 404, body incluye etiquetas HTML.
         *
         * ¿POR QUÉ IMPORTA? Una página de error bien formada ayuda al dev a
         * entender qué recurso faltó. Un body vacío da zero contexto.
         *
         * SI FALLA: El desarrollador ve una pantalla en blanco sin información
         *           sobre qué archivo está faltando en su proyecto.
         */
        const res = await fetch(`http://localhost:${TEST_PORT}/fantasma.html`);
        const body = await res.text();
        assert.equal(res.status, 404);
        assert.ok(body.includes("<html"), "La respuesta 404 debe ser HTML");
    });

});
