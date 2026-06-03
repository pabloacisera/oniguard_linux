/**
 * ============================================================
 * TESTS: core/init.js — Scaffolding del proyecto
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * init.js genera la estructura inicial del proyecto del usuario:
 * directorios src/, src/js/, src/css/, archivos de template,
 * y el pulsedev.json. Es la primera experiencia del usuario.
 *
 * Si init falla, el usuario no puede empezar a usar la herramienta.
 * Si los archivos generados tienen contenido incorrecto, los
 * templates de documentación embebida se rompen.
 *
 * ESTRATEGIA:
 * ----------
 * Se ejecuta runInit sobre un directorio temporal (tmpdir).
 * Luego se verifica con existsSync, readFileSync y readFile
 * que cada archivo y directorio esperado existe y tiene contenido válido.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + node:fs
 * ------------------------------------------------------
 * I/O real en disco es necesario porque runInit escribe archivos.
 * Usar mocks ocultaría errores de encoding o permisos.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runInit } from "../core/init.js";

const TMP_DIR = join(tmpdir(), "pulsedev-test-init");
const SRC_DIR = join(TMP_DIR, "src");

before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: runInit
// ==============================================================
describe("runInit", () => {

    before(async () => {
        await runInit(TMP_DIR);
    });

    test("Crea src/, src/js/, src/css/", () => {
        /**
         * FLUJO: runInit ejecuta mkdirSync para src/, src/js/, src/css/.
         *
         * ESPERA: Los 3 directorios existen en disco.
         *
         * ¿POR QUÉ IMPORTA? La estructura del proyecto es el contrato
         * mínimo para que pulsedev run funcione. Sin src/, el servidor
         * no tiene archivos que servir.
         *
         * SI FALLA: pulsedev init crea directorios incompletos, el
         *           usuario debe crearlos manualmente.
         */
        assert.ok(existsSync(SRC_DIR), "src/ debe existir");
        assert.ok(existsSync(join(SRC_DIR, "js")), "src/js/ debe existir");
        assert.ok(existsSync(join(SRC_DIR, "css")), "src/css/ debe existir");
    });

    test("Copia assets a src/assets/", () => {
        /**
         * FLUJO: runInit copia el directorio web/assets/ a src/assets/
         * mediante cpSync con recursive:true.
         *
         * ESPERA: La carpeta src/assets/ existe.
         *
         * ¿POR QUÉ IMPORTA? Los assets (logo, favicon, fuentes) son
         * referenciados desde index.html. Si no se copian, el navegador
         * muestra errores 404 para esos recursos.
         *
         * SI FALLA: La página principal se ve sin logo, favicon ni fuentes.
         */
        assert.ok(existsSync(join(SRC_DIR, "assets")), "src/assets/ debe existir");
    });

    test("Crea pulsedev.json con JSON parseable", () => {
        /**
         * FLUJO: runInit escribe pulsedev.json en la raíz del proyecto.
         *
         * ESPERA: JSON.parse del contenido no lanza error.
         *
         * ¿POR QUÉ IMPORTA? pulsedev run lee y parsea este archivo al
         * arrancar. Si el JSON es inválido, el servidor no arranca.
         *
         * SI FALLA: pulsedev run falla con "JSON inválido" justo después
         *           de haber ejecutado pulsedev init.
         */
        const configPath = join(TMP_DIR, "pulsedev.json");
        assert.ok(existsSync(configPath), "pulsedev.json debe existir");
        const content = readFileSync(configPath, "utf-8");
        assert.doesNotThrow(() => JSON.parse(content), "Debe ser JSON válido");
    });

    test("pulsedev.json tiene las claves esperadas", () => {
        /**
         * FLUJO: Se parsea el JSON y se verifican las claves.
         *
         * ESPERA: Todas las claves del schema están presentes.
         *
         * ¿POR QUÉ IMPORTA? El servidor referencia estas claves por
         * nombre. Si falta alguna, el comportamiento por defecto se
         * aplica pero puede sorprender al usuario.
         *
         * SI FALLA: Una clave faltante hace que el servidor use un default
         *           invisible que el usuario no puede configurar.
         */
        const raw = readFileSync(join(TMP_DIR, "pulsedev.json"), "utf-8");
        const config = JSON.parse(raw);
        const expectedKeys = [
            "watchPath", "runFile", "port", "outputPath",
            "ignoreExtensions", "debounceDelay", "recursive", "logLimit"
        ];
        for (const key of expectedKeys) {
            assert.ok(Object.prototype.hasOwnProperty.call(config, key),
                `pulsedev.json debe tener la clave "${key}"`);
        }
    });

    test("Crea src/index.html", () => {
        /**
         * FLUJO: runInit escribe el template HTML.
         *
         * ESPERA: El archivo existe y contiene <!DOCTYPE html>.
         *
         * ¿POR QUÉ IMPORTA? Es la página principal del proyecto.
         *
         * SI FALLA: pulsedev run sirve un 404 para la raíz.
         */
        const indexPath = join(SRC_DIR, "index.html");
        assert.ok(existsSync(indexPath), "src/index.html debe existir");
        const content = readFileSync(indexPath, "utf-8");
        assert.ok(content.includes("<!DOCTYPE html>"), "Debe contener DOCTYPE");
    });

    test("Crea src/js/index.js y NO contiene el placeholder", async () => {
        /**
         * FLUJO: runInit escribe el JS con la documentación embebida.
         *
         * ESPERA: El archivo existe y NO contiene el placeholder.
         *
         * ¿POR QUÉ IMPORTA? El placeholder __DOCUMENTATION_HTML__ debe
         * ser reemplazado por el HTML de documentación real.
         *
         * SI FALLA: El JS contiene el string literal "__DOCUMENTATION_HTML__"
         *           que rompe la sintaxis JS.
         */
        const jsPath = join(SRC_DIR, "js", "index.js");
        assert.ok(existsSync(jsPath), "src/js/index.js debe existir");
        const content = await readFile(jsPath, "utf-8");
        assert.ok(!content.includes("__DOCUMENTATION_HTML__"),
            "No debe contener el placeholder");
    });

    test("src/js/index.js contiene el HTML de documentación embebido", async () => {
        /**
         * FLUJO: runInit reemplaza __DOCUMENTATION_HTML__ con el contenido
         * serializado de documentation.html.
         *
         * ESPERA: El JS contiene algo del contenido de la documentación.
         *
         * ¿POR QUÉ IMPORTA? Sin la documentación embebida, el toggle
         * "Ver Documentación" en el HTML no muestra nada.
         *
         * SI FALLA: La documentación en la UI está vacía.
         */
        const content = await readFile(join(SRC_DIR, "js", "index.js"), "utf-8");
        assert.ok(content.length > 100, "El JS debe tener contenido sustancial");
        assert.ok(content.includes("PulseDev"), "Debe mencionar PulseDev");
    });

    test("Crea src/js/socket-client.js", async () => {
        /**
         * FLUJO: runInit escribe el cliente WebSocket.
         *
         * ESPERA: El archivo existe y contiene WebSocket.
         *
         * ¿POR QUÉ IMPORTA? El live reload depende de este script.
         * Sin él, los cambios no se reflejan automáticamente.
         *
         * SI FALLA: El live reload no funciona, el usuario debe recargar
         *           manualmente el navegador.
         */
        const socketPath = join(SRC_DIR, "js", "socket-client.js");
        assert.ok(existsSync(socketPath), "src/js/socket-client.js debe existir");
        const content = await readFile(socketPath, "utf-8");
        assert.ok(content.includes("WebSocket"), "Debe contener WebSocket");
    });

    test("Crea src/css/index.css", async () => {
        /**
         * FLUJO: runInit escribe el template CSS.
         *
         * ESPERA: El archivo existe y no está vacío.
         *
         * ¿POR QUÉ IMPORTA? Sin CSS, la página se ve sin estilos.
         *
         * SI FALLA: La aplicación se ve sin estilos.
         */
        const cssPath = join(SRC_DIR, "css", "index.css");
        assert.ok(existsSync(cssPath), "src/css/index.css debe existir");
        const content = await readFile(cssPath, "utf-8");
        assert.ok(content.length > 0, "El CSS no debe estar vacío");
    });

    test("Idempotente: segunda llamada no explota", async () => {
        /**
         * FLUJO: Se llama a runInit DOS veces sobre el mismo directorio.
         * La segunda llamada encuentra los directorios ya creados y los
         * archivos ya escritos. mkdir con recursive:true no falla si
         * el directorio ya existe, y write sobreescribe sin error.
         *
         * ESPERA: No se lanza ninguna excepción.
         *
         * ¿POR QUÉ IMPORTA? El usuario puede ejecutar pulsedev init
         * accidentalmente en un proyecto ya inicializado. No debe
         * perder su configuración ni crashear.
         *
         * SI FALLA: pulsedev init en proyecto existente lanza error
         *           o sobreescribe archivos del usuario.
         */
        await assert.doesNotReject(
            () => runInit(TMP_DIR),
            "Segunda llamada a runInit no debe lanzar"
        );
    });

});

