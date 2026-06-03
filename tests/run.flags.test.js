/**
 * ============================================================
 * TESTS: core/run.js — Flags, Merge, Coerción de tipos
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * run.js contiene la lógica de parseo de flags CLI, coerción de tipos,
 * merge con la config base, y validación de flags desconocidos. Es el
 * entry point del comando `pulsedev run`.
 *
 * Si parseFlags falla, los flags --port, --debounceDelay, etc. no se
 * aplican correctamente. Si coerceValue falla, los tipos se desincronizan
 * (string en vez de number, etc.) y el servidor recibe config corrupta.
 *
 * ESTRATEGIA:
 * ----------
 * Las funciones parseFlags, coerceValue, mergeConfig y findUnknownFlags
 * son exportadas con la marca "// exported for testing" al final del módulo.
 *
 * Para runCommand (integración con disco), se usa un directorio temporal
 * con un pulsedev.json válido.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + node:os.tmpdir
 * -------------------------------------------------------------
 * Consistente con el resto del proyecto. Las pruebas de integración con
 * runCommand requieren I/O real en disco para verificar persistencia.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
    parseFlags,
    coerceValue,
    mergeConfig,
    findUnknownFlags,
    runCommand,
    RESERVED_FLAGS
} from "../core/run.js";

import { closeServer } from "../core/serverManager.js";

const TMP_DIR = join(tmpdir(), "pulsedev-test-flags");

// Config base de ejemplo para todos los tests de merge/coerce
const BASE_CONFIG = {
    watchPath: ["*"],
    runFile: "index.html",
    port: 3003,
    outputPath: "log",
    ignoreExtensions: ["*.txt", "*.log", "*.env", "*.md"],
    debounceDelay: 0.5,
    recursive: true,
    logLimit: 5
};

before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: parseFlags
// ==============================================================
describe("parseFlags", () => {

    test("--key value (separado por espacio)", () => {
        /**
         * FLUJO: Se pasan `["--port", "4000"]`. El parser detecta "--port",
         * mira el siguiente argumento, no empieza con "--" → lo usa como valor.
         *
         * ESPERA: { port: "4000" }
         *
         * ¿POR QUÉ IMPORTA? Es el formato más común (--flag valor). Si falla,
         * todos los flags con valor se rompen.
         *
         * SI FALLA: pulsedev run --port 4000 ignora el puerto y usa el default.
         */
        const result = parseFlags(["--port", "4000"]);
        assert.deepEqual(result, { port: "4000" });
    });

    test("--key=value (con igual)", () => {
        /**
         * FLUJO: `["--port=4000"]`. El parser detecta "=" y parte por ahí.
         *
         * ESPERA: { port: "4000" }
         *
         * ¿POR QUÉ IMPORTA? Es el formato secundario soportado. Algunos
         * usuarios prefieren --key=value por claridad en scripts.
         *
         * SI FALLA: --port=4000 se interpreta como flag booleano "--port=true".
         */
        const result = parseFlags(["--port=4000"]);
        assert.deepEqual(result, { port: "4000" });
    });

    test("--bool (flag booleano por presencia)", () => {
        /**
         * FLUJO: `["--persist"]`. No hay valor después, no tiene "=" →
         * true.
         *
         * ESPERA: { persist: true }
         *
         * ¿POR QUÉ IMPORTA? Los flags booleanos (--persist, --list-flags)
         * son el mecanismo de flags sin valor. Si fallan, no se puede activar
         * persistencia ni listar flags.
         *
         * SI FALLA: --persist no tiene efecto, los flags nunca se persisten.
         */
        const result = parseFlags(["--persist"]);
        assert.deepEqual(result, { persist: true });
    });

    test("Args sin -- son ignorados", () => {
        /**
         * FLUJO: `["run", "--port", "4000"]`. "run" no empieza con "--" →
         * se ignora.
         *
         * ESPERA: { port: "4000" }
         *
         * ¿POR QUÉ IMPORTA? process.argv contiene el comando ("run") como
         * primer argumento. Si no lo ignoramos, contaminaría el objeto flags.
         *
         * SI FALLA: Aparece una clave "run" en el objeto flags.
         */
        const result = parseFlags(["run", "--port", "4000"]);
        assert.deepEqual(result, { port: "4000" });
    });

    test("-- vacío es ignorado", () => {
        /**
         * FLUJO: `["--"]`. El key después de "--" es vacío → continue.
         *
         * ESPERA: {}
         *
         * ¿POR QUÉ IMPORTA? -- puede aparecer en argv para separar opciones.
         * No debe crashear ni agregar claves basura.
         *
         * SI FALLA: Aparece una clave vacía en el objeto flags.
         */
        const result = parseFlags(["--"]);
        assert.deepEqual(result, {});
    });

    test("Mix de formatos", () => {
        /**
         * FLUJO: Una mezcla de --key=value, --bool, y --key value.
         *
         * ESPERA: objeto con los 3 flags correctamente parseados.
         *
         * ¿POR QUÉ IMPORTA? La CLI real recibe combinaciones de flags.
         * Si una combinación falla, cascada de errores.
         *
         * SI FALLA: Algunos flags se ignoran o se interpretan mal.
         */
        const result = parseFlags(["--port=9000", "--persist", "--debounceDelay", "1"]);
        assert.deepEqual(result, { port: "9000", persist: true, debounceDelay: "1" });
    });

});


// ==============================================================
// SUITE: coerceValue
// ==============================================================
describe("coerceValue", () => {

    test("number válido", () => {
        const result = coerceValue("4000", 3003);
        assert.equal(result, 4000);
        assert.equal(typeof result, "number");
    });

    test("number inválido lanza Error", () => {
        assert.throws(() => coerceValue("abc", 3003), /numérico/);
    });

    test("boolean flag true", () => {
        const result = coerceValue(true, false);
        assert.equal(result, true);
    });

    test('boolean string "true"', () => {
        const result = coerceValue("true", false);
        assert.equal(result, true);
    });

    test('boolean string "false"', () => {
        const result = coerceValue("false", true);
        assert.equal(result, false);
    });

    test('boolean string "1"', () => {
        const result = coerceValue("1", false);
        assert.equal(result, true);
    });

    test('boolean string inválido lanza Error', () => {
        assert.throws(() => coerceValue("quizas", false), /booleano/);
    });

    test("array JSON válido", () => {
        const result = coerceValue('["./src/css"]', []);
        assert.ok(Array.isArray(result));
        assert.equal(result[0], "./src/css");
    });

    test("array JSON inválido lanza Error", () => {
        assert.throws(() => coerceValue("no-es-json", []), /array/);
    });

    test("array con flag booleano lanza Error", () => {
        assert.throws(() => coerceValue(true, []), /array/);
    });

    test("null original → string", () => {
        const result = coerceValue("algo", null);
        assert.equal(result, "algo");
        assert.equal(typeof result, "string");
    });

    test("string original → string", () => {
        const result = coerceValue("terminal", "log");
        assert.equal(result, "terminal");
        assert.equal(typeof result, "string");
    });

});


// ==============================================================
// SUITE: mergeConfig
// ==============================================================
describe("mergeConfig", () => {

    test("override de una clave", () => {
        const merged = mergeConfig(BASE_CONFIG, { port: "4000" });
        assert.equal(merged.port, 4000); // coercionado a number
        assert.equal(merged.runFile, "index.html"); // resto intacto
    });

    test("no muta el config original", () => {
        const original = { ...BASE_CONFIG };
        const copyBefore = JSON.stringify(original);
        mergeConfig(original, { port: "9999" });
        assert.equal(JSON.stringify(original), copyBefore);
    });

    test("RESERVED_FLAGS ignorados", () => {
        const merged = mergeConfig(BASE_CONFIG, { persist: true, "list-flags": true, port: "5000" });
        assert.equal(Object.prototype.hasOwnProperty.call(merged, "persist"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(merged, "list-flags"), false);
        assert.equal(merged.port, 5000);
    });

    test("clave inexistente en config es ignorada (no explota)", () => {
        const merged = mergeConfig(BASE_CONFIG, { flagInexistente: "valor" });
        assert.equal(Object.prototype.hasOwnProperty.call(merged, "flagInexistente"), false);
        // merged debe tener exactamente las claves de BASE_CONFIG
        assert.deepEqual(Object.keys(merged).sort(), Object.keys(BASE_CONFIG).sort());
    });

});


// ==============================================================
// SUITE: findUnknownFlags
// ==============================================================
describe("findUnknownFlags", () => {

    test("flag desconocido detectado", () => {
        const unknown = findUnknownFlags({ flagRaro: true }, BASE_CONFIG);
        assert.deepEqual(unknown, ["flagRaro"]);
    });

    test("flags reservados no son desconocidos", () => {
        const unknown = findUnknownFlags({ persist: true, "list-flags": true }, BASE_CONFIG);
        assert.deepEqual(unknown, []);
    });

    test("flags válidos no aparecen", () => {
        const unknown = findUnknownFlags({ port: "4000" }, BASE_CONFIG);
        assert.deepEqual(unknown, []);
    });

});


// ==============================================================
// SUITE: runCommand (integración con disco)
// ==============================================================
describe("runCommand", () => {

    let suiteDir;

    before(async () => {
        suiteDir = join(TMP_DIR, "runCommand-suite");
        await mkdir(suiteDir, { recursive: true });
        await mkdir(join(suiteDir, "src"), { recursive: true });
        await writeFile(join(suiteDir, "src", "index.html"), "<html></html>", "utf-8");
        await writeFile(join(suiteDir, "pulsedev.json"), JSON.stringify(BASE_CONFIG, null, 2), "utf-8");
    });

    after(async () => {
        await closeServer();
    });

    test('--list-flags imprime y retorna sin levantar servidor', async () => {
        /**
         * FLUJO: Se llama a runCommand con --list-flags. La función debe
         * imprimir los flags disponibles y retornar (sin arrancar el servidor).
         *
         * ESPERA: console.log capturado contiene claves del JSON.
         *         runCommand retorna (undefined) sin timeout.
         *
         * ¿POR QUÉ IMPORTA? --list-flags es una operación de solo lectura.
         * Si levantara el servidor, el usuario no podría listar flags sin
         * que el servidor arranque y ocupe el puerto.
         *
         * SI FALLA: --list-flags lanza error de puerto ocupado o timeout.
         */
        const logs = [];
        const origLog = console.log;
        console.log = (...args) => logs.push(args.join(" "));

        const result = await runCommand(suiteDir, { argv: ["--list-flags"], silent: true });

        console.log = origLog;

        const output = logs.join(" ");
        assert.ok(output.includes("--port"), "Debe listar --port");
        assert.ok(output.includes("Flags disponibles"), "Debe tener el encabezado");
        assert.equal(result, undefined, "No debe retornar un servidor");
    });

    test('flag desconocido → process.exit(1)', async () => {
        /**
         * FLUJO: Se pasa un flag que no existe en el JSON ni es reservado.
         * validateFlagsOrExit llama a process.exit(1).
         *
         * ESPERA: process.exit se llama con código 1.
         *
         * ¿POR QUÉ IMPORTA? Flags desconocidos son errores de tipeo del
         * usuario. El sistema debe rechazarlos explícitamente, no ignorarlos.
         *
         * SI FALLA: Flags mal tipeados se ignoran silenciosamente, el usuario
         *           cree que configuró algo que no se aplicó.
         */
        let exitCode = null;
        const origExit = process.exit;
        process.exit = (code) => { exitCode = code; throw new Error(`exit ${code}`); };

        try {
            await runCommand(suiteDir, { argv: ["--flagInexistente"], silent: true });
        } catch {
            // esperado
        }

        process.exit = origExit;
        assert.equal(exitCode, 1);
    });

    test('--port=PUERTO --persist escribe el JSON', async () => {
        /**
         * FLUJO: Se usan flags con --persist. runCommand debe escribir el
         * JSON al disco ANTES de intentar arrancar el servidor.
         *
         * ESPERA: El pulsedev.json en disco contiene el nuevo port.
         *
         * ¿POR QUÉ IMPORTA? La persistencia es opt-in explícito (--persist).
         * Si no se persiste, los flags son solo en memoria. El usuario confía
         * en --persist para modificar su config de forma permanente.
         *
         * SI FALLA: --persist no escribe el JSON, el usuario pierde la config.
         */
        // Usamos un puerto alto para evitar colisiones
        const newPort = 41234;

        let exitCode = null;
        const origExit = process.exit;
        process.exit = (code) => { exitCode = code; };

        await runCommand(suiteDir, { argv: [`--port=${newPort}`, "--persist"], silent: true });

        process.exit = origExit;

        // Leer el JSON del disco
        const raw = await import("node:fs/promises").then(m => m.readFile(join(suiteDir, "pulsedev.json"), "utf-8"));
        const configReloaded = JSON.parse(raw);
        assert.equal(configReloaded.port, newPort, "El port debe persistirse en el JSON");
    });

});

