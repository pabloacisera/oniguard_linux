/**
 * ============================================================
 * TESTS: helpers/writter.js
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * writter.js es la capa de I/O de logs. Toda la trazabilidad del servidor
 * (requests, errores) pasa por acá. Si write o read fallan silenciosamente,
 * el dev pierde visibilidad completa de lo que sucede en su servidor.
 *
 * Además, write tiene una lógica NO trivial:
 *   1. Crea la carpeta si no existe (mkdir recursive)
 *   2. Hace appendFile del texto
 *   3. Si el archivo termina en "requests.log", lanza un Worker para
 *      truncar el log cuando supera el logLimit
 *
 * Esta combinación mkdir + append + worker-condicional tiene múltiples
 * caminos de error que un test unitario expone con claridad.
 *
 * FUNCIONES CUBIERTAS:
 *   - write(pathFile, text, logLimit): Crea carpeta, escribe y controla límite
 *   - read(pathFile): Lee un archivo, retorna null si no existe
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + node:fs/promises
 * --------------------------------------------------------------
 * Igual que en hashFingerprint: testeo real en disco porque la función
 * hace I/O real. Mockear readFile/writeFile aquí sería testear los mocks,
 * no el código. El disco temporal es rápido y reproducible.
 *
 * NOTA SOBRE EL WORKER:
 * El Worker de counterChar.js se lanza de forma fire-and-forget dentro de write.
 * No lo testeamos directamente acá (tiene su propio test), pero sí verificamos
 * que write no lanza error al procesarlo (integración implícita).
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";

import { write, read } from "../helpers/writter.js";

const TMP_DIR = join(tmpdir(), "pulsedev-test-writter");
const LOG_FILE = join(TMP_DIR, "logs", "test.log");
const REQUEST_LOG = join(TMP_DIR, "logs", "requests.log");

before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
    // Borramos todo el directorio temporal al finalizar
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: write
// ==============================================================
describe("write", () => {

    test("crea la carpeta si no existe y escribe el archivo", async () => {
        /**
         * FLUJO: Se llama a write con una ruta que incluye un directorio que
         * todavía no existe en disco. write debe crear la carpeta y crear el archivo.
         *
         * ESPERA: El archivo existe y contiene el texto más un "\n" al final.
         *
         * ¿POR QUÉ IMPORTA? Si pulsedev se ejecuta en un proyecto nuevo sin carpeta
         * "logs/", write debe autoprovisionarla. Si no lo hiciera, el servidor
         * crashea en producción con ENOENT al primer request.
         *
         * SI FALLA: pulsedev run lanza error crítico al intentar loguear requests
         *           en proyectos sin carpeta logs/ preexistente.
         */
        const destFile = join(TMP_DIR, "subdir", "nested", "archivo.log");
        await write(destFile, "linea de prueba");

        const content = await readFile(destFile, "utf-8");
        assert.ok(
            content.includes("linea de prueba"),
            "El archivo debe contener el texto escrito"
        );
    });

    test("hace append: no sobreescribe contenido existente", async () => {
        /**
         * FLUJO: Se llama a write dos veces sobre el mismo archivo.
         * La segunda llamada debe AGREGAR al contenido, no reemplazarlo.
         *
         * ESPERA: El archivo contiene ambas líneas.
         *
         * ¿POR QUÉ IMPORTA? Si write sobreescribiera, cada request borraría el
         * log anterior. Los logs perderían historia y serían inútiles para debugging.
         *
         * SI FALLA: El log de requests solo tiene el último request registrado.
         */
        await write(LOG_FILE, "primera linea");
        await write(LOG_FILE, "segunda linea");

        const content = await readFile(LOG_FILE, "utf-8");
        assert.ok(content.includes("primera linea"), "Debe conservar la primera línea");
        assert.ok(content.includes("segunda linea"), "Debe agregar la segunda línea");
    });

    test("no lanza error cuando pathFile o text están vacíos", async () => {
        /**
         * FLUJO: Se llama a write con valores falsy. La función debe hacer
         * early return silencioso (con console.log de advertencia) pero SIN throw.
         *
         * ESPERA: No se lanza ninguna excepción.
         *
         * ¿POR QUÉ IMPORTA? Si un caller pasa un path vacío por error de
         * configuración, no queremos que el servidor entero crashee. La advertencia
         * visible en consola es suficiente.
         *
         * SI FALLA: Un path mal configurado en pulsedev.json mata el proceso completo.
         */
        await assert.doesNotReject(
            async () => await write("", "texto"),
            "write con path vacío no debe lanzar"
        );
        await assert.doesNotReject(
            async () => await write(LOG_FILE, ""),
            "write con texto vacío no debe lanzar"
        );
    });

    test("escribe en requests.log sin lanzar error (activa el worker internamente)", async () => {
        /**
         * FLUJO: Se escribe en un archivo llamado requests.log. Internamente,
         * write detecta el nombre y lanza un Worker para controlar el tamaño.
         * El test solo verifica que la operación completa sin error.
         *
         * ESPERA: No se lanza error y el contenido fue escrito.
         *
         * ¿POR QUÉ IMPORTA? La rama condicional del Worker es código de producción
         * activo. Si el path al worker (counterChar.js) está mal resuelto o el
         * postMessage falla, write lanzaría un error que mataría el request handler.
         *
         * SI FALLA: Los logs de requests no se escriben correctamente, o el servidor
         *           crashea al intentar gestionar el tamaño del log.
         */
        await assert.doesNotReject(
            async () => await write(REQUEST_LOG, "GET /index.html - Mozilla/5.0", 5),
            "write en requests.log no debe lanzar"
        );

        const content = await readFile(REQUEST_LOG, "utf-8");
        assert.ok(content.includes("GET /index.html"), "Contenido debe estar en el log");
    });

});


// ==============================================================
// SUITE: read
// ==============================================================
describe("read", () => {

    test("lee el contenido de un archivo existente", async () => {
        /**
         * FLUJO: Se crea un archivo manualmente y luego se lee con read().
         *
         * ESPERA: El string retornado es igual al contenido escrito.
         *
         * ¿POR QUÉ IMPORTA? read() se usa en run.js para cargar pulsedev.json
         * antes de cada restart. Si devuelve contenido incorrecto, el servidor
         * arranca con configuración corrupta.
         *
         * SI FALLA: pulsedev run falla al parsear el config en reloadServer().
         */
        const testFile = join(TMP_DIR, "lectura.txt");
        await writeFile(testFile, "contenido esperado", "utf-8");

        const result = await read(testFile);
        assert.equal(result, "contenido esperado");
    });

    test("retorna null para un archivo que no existe (no lanza)", async () => {
        /**
         * FLUJO: Se llama a read() con una ruta inexistente.
         * La función captura el ENOENT y retorna null.
         *
         * ESPERA: null (no un throw)
         *
         * ¿POR QUÉ IMPORTA? run.js hace JSON.parse(await read(...)).
         * Si read lanzara, el await no capturaría el error y el proceso moriría.
         * Retornar null permite que el caller decida cómo manejarlo.
         *
         * SI FALLA: Un archivo de config faltante crashea el servidor en vez
         *           de dar un mensaje de error legible.
         */
        const result = await read("/ruta/que/no/existe/config.json");
        assert.equal(result, null);
    });

    test("retorna null si pathFile es falsy", async () => {
        /**
         * FLUJO: Se llama a read() sin argumento o con null.
         *
         * ESPERA: null (con advertencia en consola, no throw)
         *
         * ¿POR QUÉ IMPORTA? Defensivo contra callers que construyen rutas
         * dinámicamente y pueden producir un path vacío.
         *
         * SI FALLA: read(null) lanza TypeError y puede romper run.js.
         */
        const result = await read(null);
        assert.equal(result, null);
    });

});
