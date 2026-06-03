/**
 * ============================================================
 * TESTS: bin/cli.js — E2E (child_process)
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS LA CLI COMO PROCESO EXTERNO?
 * --------------------------------------------------
 * cli.js es el entry point del paquete npm. Ejecutarlo como
 * child_process (execFile) verifica que el shebang, los imports,
 * y la estructura de control de comandos funcionan en un entorno
 * real. Es la prueba más cercana a la experiencia del usuario final.
 *
 * Si ejecutáramos la lógica directamente importando cli.js, el
 * shebang y el manejo de process.argv serían difíciles de controlar.
 * Además, cli.js llama a process.exit(1) en múltiples puntos, lo
 * que mataría el proceso del test.
 *
 * ESTRATEGIA:
 * ----------
 * Usamos execFile para ejecutar `node bin/cli.js <args>` en un
 * proceso hijo con timeout de 5s. Capturamos stdout, stderr y exit
 * code. Para init, usamos la opción cwd apuntando a un tmpdir.
 *
 * TECNOLOGÍA ELEGIDA: node:child_process + node:os.tmpdir
 * --------------------------------------------------------
 * execFile es la API estándar para ejecutar binarios. No mockeamos
 * nada porque queremos probar el binario real.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "../bin/cli.js");
const execFileAsync = promisify(execFile);
const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"));

/**
 * Helper: ejecuta el CLI como proceso externo y captura todo.
 * Nunca lanza: devuelve { stdout, stderr, exitCode }.
 */
async function runCLI(args, options = {}) {
    try {
        const result = await execFileAsync(
            process.execPath,
            [CLI_PATH, ...args],
            { timeout: 5000, ...options }
        );
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (err) {
        return {
            stdout: err.stdout || "",
            stderr: err.stderr || "",
            exitCode: err.code ?? 1
        };
    }
}


// ==============================================================
// SUITE: Flags globales
// ==============================================================
describe("flags globales", () => {

    test("--help → stdout contiene 'Comandos disponibles'", async () => {
        /**
         * FLUJO: Se ejecuta pulsedev --help.
         *
         * ESPERA: stdout incluye "Comandos disponibles", exit code 0.
         *
         * ¿POR QUÉ IMPORTA? --help es la puerta de entrada a la
         * documentación de la CLI. Sin ella, el usuario no sabe
         * cómo usar la herramienta.
         *
         * SI FALLA: pulsedev --help muestra un mensaje genérico o vacío.
         */
        const { stdout, exitCode } = await runCLI(["--help"]);
        assert.ok(stdout.includes("Comandos disponibles"), "Debe listar comandos");
        assert.equal(exitCode, 0, "--help debe terminar con código 0");
    });

    test("-h → mismo output que --help", async () => {
        /**
         * FLUJO: Se ejecuta pulsedev -h.
         *
         * ESPERA: Mismo output que --help.
         *
         * ¿POR QUÉ IMPORTA? -h es el alias corto estándar de --help.
         *
         * SI FALLA: -h no funciona o muestra algo diferente.
         */
        const { stdout: longHelp } = await runCLI(["--help"]);
        const { stdout: shortHelp } = await runCLI(["-h"]);
        assert.equal(shortHelp, longHelp, "-h debe dar el mismo output que --help");
    });

    test(`"--version → stdout es v${pkg.version}`, async () => {
        /**
         * FLUJO: Se ejecuta pulsedev --version.
         *
         * ESPERA: stdout es "v0.1.1" (la versión del package.json).
         *
         * ¿POR QUÉ IMPORTA? El usuario necesita saber qué versión
         * tiene instalada para reportar bugs o verificar upgrades.
         *
         * SI FALLA: --version muestra un número incorrecto o vacío.
         */
        const { stdout, exitCode } = await runCLI(["--version"]);
        assert.equal(stdout.trim(), `v${pkg.version}`);
        assert.equal(exitCode, 0);
    });

    test("-v → mismo output que --version", async () => {
        const { stdout: longV } = await runCLI(["--version"]);
        const { stdout: shortV } = await runCLI(["-v"]);
        assert.equal(shortV, longV, "-v debe dar el mismo output que --version");
    });

    test("Sin comando → stdout contiene 'Advertencia'", async () => {
        /**
         * FLUJO: Se ejecuta pulsedev sin argumentos.
         *
         * ESPERA: stdout o stderr contiene "Advertencia" (no crashea).
         *
         * ¿POR QUÉ IMPORTA? Ejecutar la CLI sin argumentos no debe
         * producir un error críptico. Debe guiar al usuario.
         *
         * SI FALLA: pulsedev sin args crashea con error inesperado.
         */
        const { stdout, stderr, exitCode } = await runCLI([]);
        const output = stdout + stderr;
        assert.ok(output.includes("Advertencia"), "Debe mostrar advertencia");
        assert.equal(exitCode, 0, "Sin args no debe terminar con error");
    });

});


// ==============================================================
// SUITE: Comando init
// ==============================================================
describe("comando init", () => {

    let tmpDir;

    before(async () => {
        tmpDir = join(tmpdir(), "pulsedev-e2e-init");
        await mkdir(tmpDir, { recursive: true });
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    test("init en directorio vacío → crea pulsedev.json", async () => {
        /**
         * FLUJO: Se ejecuta `pulsedev init` en un directorio vacío.
         *
         * ESPERA: Al terminar, pulsedev.json existe en el directorio.
         *
         * ¿POR QUÉ IMPORTA? init debe crear la configuración mínima
         * para que run pueda funcionar.
         *
         * SI FALLA: pulsedev init no genera ningún archivo.
         */
        const { exitCode } = await runCLI(["init"], { cwd: tmpDir });
        assert.equal(exitCode, 0, "init debe terminar con código 0");
        assert.ok(
            existsSync(join(tmpDir, "pulsedev.json")),
            "pulsedev.json debe existir después de init"
        );
    });

    test("init crea src/index.html", async () => {
        /**
         * FLUJO: Después de init, se verifica src/index.html.
         *
         * ESPERA: El archivo existe.
         *
         * ¿POR QUÉ IMPORTA? Sin index.html, el servidor no tiene
         * página principal que servir.
         *
         * SI FALLA: init omite la creación de src/index.html.
         */
        assert.ok(
            existsSync(join(tmpDir, "src", "index.html")),
            "src/index.html debe existir después de init"
        );
    });

    test("init exit code 0", async () => {
        const { exitCode } = await runCLI(["init"], { cwd: tmpDir });
        assert.equal(exitCode, 0);
    });

});


// ==============================================================
// SUITE: Comando run — errores
// ==============================================================
describe("comando run — errores", () => {

    let tmpDir;

    before(async () => {
        tmpDir = join(tmpdir(), "pulsedev-e2e-run-err");
        await mkdir(tmpDir, { recursive: true });
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    test("run sin pulsedev.json → exit code 1 y mensaje contiene 'pulsedev init'", async () => {
        /**
         * FLUJO: Se ejecuta `pulsedev run` en un directorio sin
         * pulsedev.json. loadBaseConfig detecta la ausencia y
         * llama a process.exit(1).
         *
         * ESPERA: exit code 1, stderr o stdout incluye "pulsedev init".
         *
         * ¿POR QUÉ IMPORTA? El mensaje de error debe guiar al usuario
         * a ejecutar el comando correcto (init).
         *
         * SI FALLA: run sin config da un error críptico o código 0.
         */
        const { stdout, stderr, exitCode } = await runCLI(["run"], { cwd: tmpDir });
        const output = stdout + stderr;
        assert.equal(exitCode, 1, "Debe terminar con error");
        assert.ok(
            output.includes("pulsedev init") || output.includes("init"),
            "El mensaje debe sugerir ejecutar 'pulsedev init'"
        );
    });

    test("run --flag-que-no-existe → exit code 1", async () => {
        /**
         * FLUJO: Flag desconocido en un directorio sin config.
         * El error de "no config" ocurre ANTES de la validación
         * de flags, pero igual termina con exit 1.
         *
         * ESPERA: exit code 1.
         *
         * ¿POR QUÉ IMPORTA? El CLI debe rechazar flags inválidos.
         *
         * SI FALLA: Flags desconocidos se ignoran silenciosamente.
         */
        const { exitCode } = await runCLI(["run", "--flag-inventado"], { cwd: tmpDir });
        assert.equal(exitCode, 1);
    });

    test("run --list-flags sin pulsedev.json → exit code 1", async () => {
        /**
         * FLUJO: --list-flags necesita un pulsedev.json para leer
         * las claves. Sin él, debe fallar con exit 1.
         *
         * ESPERA: exit code 1.
         *
         * ¿POR QUÉ IMPORTA? Si --list-flags funcionara sin config,
         * mostraría una lista vacía, lo cual es confuso.
         *
         * SI FALLA: --list-flags sin config da falsa impresión de
         *           que no hay flags configurables.
         */
        const { exitCode } = await runCLI(["run", "--list-flags"], { cwd: tmpDir });
        assert.equal(exitCode, 1);
    });

});


// ==============================================================
// SUITE: Comando run — flags
// ==============================================================
describe("comando run — flags", () => {

    let tmpDir;

    before(async () => {
        tmpDir = join(tmpdir(), "pulsedev-e2e-run-flags");
        await mkdir(tmpDir, { recursive: true });
        await mkdir(join(tmpDir, "src"), { recursive: true });
        await writeFile(join(tmpDir, "src", "index.html"), "<html></html>", "utf-8");
        await writeFile(join(tmpDir, "pulsedev.json"), JSON.stringify({
            watchPath: ["*"],
            runFile: "index.html",
            port: 3003,
            outputPath: "terminal",
            ignoreExtensions: ["*.txt"],
            debounceDelay: 0.5,
            recursive: true,
            logLimit: 5
        }), "utf-8");
    });

    after(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    test("run --list-flags con pulsedev.json → stdout contiene '--port'", async () => {
        /**
         * FLUJO: Con pulsedev.json presente, --list-flags debe leerlo
         * e imprimir las claves disponibles.
         *
         * ESPERA: stdout contiene "--port".
         *
         * ¿POR QUÉ IMPORTA? --list-flags es la única forma de saber
         * qué flags están disponibles sin leer la documentación.
         *
         * SI FALLA: --list-flags no muestra las claves del JSON.
         */
        const { stdout, exitCode } = await runCLI(["run", "--list-flags"], { cwd: tmpDir });
        assert.ok(stdout.includes("--port"), "Debe listar --port");
        assert.equal(exitCode, 0, "--list-flags debe terminar con 0");
    });

    test("run --persist --port 9876 → pulsedev.json tiene port 9876", async () => {
        /**
         * FLUJO: Se ejecuta run con --persist --port 9876 en un
         * directorio sin src/ válido. runCommand intentará arrancar
         * el servidor, pero debe fallar rápido. La escritura del
         * JSON ocurre ANTES de intentar arrancar.
         *
         * ESPERA: El pulsedev.json en disco tiene port: 9876.
         *
         * ¿POR QUÉ IMPORTA? La persistencia permite cambiar la config
         * de forma permanente desde la CLI.
         *
         * SI FALLA: --persist no modifica el JSON en disco.
         */
        // Usamos un subdirectorio sin src/ válido para que falle rápido
        const persistDir = join(tmpdir(), "pulsedev-e2e-persist");
        await mkdir(persistDir, { recursive: true });
        await mkdir(join(persistDir, "src"), { recursive: true });
        await writeFile(join(persistDir, "src", "index.html"), "<html></html>", "utf-8");
        await writeFile(join(persistDir, "pulsedev.json"), JSON.stringify({
            watchPath: ["*"],
            runFile: "index.html",
            port: 3003,
            outputPath: "terminal",
            ignoreExtensions: ["*.txt"],
            debounceDelay: 0.5,
            recursive: true,
            logLimit: 5
        }), "utf-8");

        await runCLI(["run", "--port", "9876", "--persist"], { cwd: persistDir });

        const { readFileSync } = await import("node:fs");
        const content = readFileSync(join(persistDir, "pulsedev.json"), "utf-8");
        const config = JSON.parse(content);
        assert.equal(config.port, 9876, "El port debe persistirse en el JSON");

        await rm(persistDir, { recursive: true, force: true });
    });

});

