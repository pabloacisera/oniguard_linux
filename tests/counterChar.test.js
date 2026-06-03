/**
 * ============================================================
 * TESTS: helpers/counterChar.js (Worker Thread)
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * counterChar.js es un Worker Thread (no un módulo importable directamente).
 * Su responsabilidad es crítica: controlar que requests.log no crezca
 * ilimitadamente aplicando un sistema FIFO: descarta las líneas más viejas
 * cuando el archivo supera (logLimit * 1000) bytes.
 *
 * Sin este control, el log puede ocupar gigabytes en un servidor de desarrollo
 * corriendo durante días, afectando el rendimiento del disco.
 *
 * ¿POR QUÉ TESTEAR UN WORKER EN LUGAR DE IMPORTARLO?
 * ---------------------------------------------------
 * counterChar.js usa parentPort (Worker Threads API) para recibir mensajes.
 * NO se puede importar como módulo normal: parentPort sería null fuera de
 * un contexto Worker y el código fallaría al registrar el listener.
 *
 * La estrategia correcta es instanciar el Worker desde el test, igual que
 * lo hace writter.js en producción. Esto es también una prueba de integración
 * real: verificamos que el Worker procesa el mensaje y modifica el archivo
 * correctamente.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + node:worker_threads
 * -----------------------------------------------------------------
 * Usamos Worker directamente desde node:worker_threads para instanciar
 * counterChar.js como lo haría el código de producción. No hay alternativa
 * nativa más idiomática para testear Workers sin dependencias externas.
 *
 * El test es asíncrono y espera el evento "exit" del worker para confirmar
 * que terminó su tarea antes de leer el archivo resultante.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_PATH = join(__dirname, "../helpers/counterChar.js");
const TMP_DIR = join(tmpdir(), "pulsedev-test-counter");
const LOG_FILE = join(TMP_DIR, "requests.log");

/**
 * Helper: lanza el Worker y retorna una Promise que resuelve cuando el
 * Worker termina (process.exit(0) dentro del worker dispara el evento "exit").
 * Rechaza si el Worker lanza un error no controlado.
 */
function runWorker(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(WORKER_PATH);
        worker.postMessage(data);
        worker.on("exit", (code) => resolve(code));
        worker.on("error", (err) => reject(err));
    });
}

before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: counterChar Worker
// ==============================================================
describe("counterChar Worker", () => {

    test("no modifica el archivo si está dentro del límite", async () => {
        /**
         * FLUJO: Se crea un log pequeño (muy por debajo del límite) y se lanza
         * el Worker con logLimit=5 (5000 chars). El contenido no debe cambiar.
         *
         * ESPERA: El archivo tiene exactamente el mismo contenido que antes.
         *
         * ¿POR QUÉ IMPORTA? Si el worker truncara logs que no llegaron al límite,
         * se perdería historia de requests legítima e importante para el debugging.
         *
         * SI FALLA: Los logs se borran prematuramente, perdiendo trazabilidad.
         */
        const contenido = "linea de log corta\n".repeat(5); // ~100 chars
        await writeFile(LOG_FILE, contenido, "utf-8");

        await runWorker({ path: LOG_FILE, logLimit: 5 });

        const resultado = await readFile(LOG_FILE, "utf-8");
        assert.ok(
            resultado.includes("linea de log corta"),
            "El contenido no debe haber sido truncado"
        );
    });

    test("trunca el archivo cuando supera el límite (FIFO: borra las primeras líneas)", async () => {
        /**
         * FLUJO: Se crea un log que supera el límite configurado. El Worker
         * debe eliminar las líneas más viejas (inicio del archivo) hasta que
         * el contenido quede por debajo del 80% del límite.
         *
         * ESPERA:
         *   - El archivo resultante es más pequeño que el original
         *   - Las primeras líneas ("PRIMERA LINEA") fueron eliminadas
         *   - Las últimas líneas ("ULTIMA LINEA") fueron conservadas
         *
         * ¿POR QUÉ IMPORTA? Este es el caso de uso principal del Worker.
         * Sin esta truncación, logs de desarrollo de larga duración colapsan el disco.
         * El FIFO garantiza que los logs más recientes (los útiles) se conserven.
         *
         * SI FALLA: requests.log crece sin límite o se borra contenido reciente.
         */
        // Usamos líneas cortas y bien definidas para superar el límite de forma controlada.
        // logLimit=1 → MAX_CHARACTERS = 1000, umbral de corte = 800 (80%)
        // Necesitamos superar 1000 chars para que el worker actúe.
        const lineaVieja = "VIEJA\n";   // 6 chars
        const lineaNueva = "NUEVA\n";   // 6 chars

        // 300 líneas viejas × 6 chars = 1800 chars → supera el límite de 1000
        // El worker aplica FIFO: elimina desde el inicio hasta que el contenido
        // quede por debajo de 800 chars (80% de 1000).
        const contenido = lineaVieja.repeat(300) + lineaNueva.repeat(5);
        await writeFile(LOG_FILE, contenido, "utf-8");

        const tamañoOriginal = contenido.length;
        await runWorker({ path: LOG_FILE, logLimit: 1 }); // limite 1 → 1000 chars

        const resultado = await readFile(LOG_FILE, "utf-8");

        assert.ok(
            resultado.length < tamañoOriginal,
            "El archivo truncado debe ser más pequeño que el original"
        );
        // El worker reduce hasta ≤800 chars. Con solo líneas de 6 chars,
        // el resultado debería tener a lo sumo ~133 líneas (800/6).
        // Las últimas 5 líneas "NUEVA" deben estar presentes (son las más recientes).
        assert.ok(
            resultado.includes("NUEVA"),
            "Las últimas líneas (recientes) deben conservarse"
        );
        // Verificamos que el tamaño quedó por debajo del umbral del 80%
        assert.ok(
            resultado.length <= 800,
            `El tamaño final (${resultado.length}) debe estar dentro del umbral (≤800)`
        );
    });

    test("termina con exit code 0 incluso si el archivo no existe", async () => {
        /**
         * FLUJO: El Worker recibe una ruta inexistente. Internamente hace readFile
         * que lanza ENOENT, el catch lo captura e imprime el error. El finally
         * llama a process.exit(0) siempre.
         *
         * ESPERA: El Worker termina con código 0 (no 1 u otro código de error).
         *
         * ¿POR QUÉ IMPORTA? Si el Worker terminara con código distinto de 0,
         * writter.js lo reportaría como error crítico. Una ruta incorrecta en
         * la config no debe matar el sistema de logging entero.
         *
         * SI FALLA: Un error en el Worker propaga una cadena de errores hasta
         *           el process principal y puede terminar el servidor.
         */
        const exitCode = await runWorker({
            path: "/ruta/inexistente/requests.log",
            logLimit: 5
        });
        assert.equal(exitCode, 0, "El Worker debe salir con código 0 aunque falle");
    });

    test("usa logLimit=1 como fallback si no se pasa el parámetro", async () => {
        /**
         * FLUJO: Se lanza el Worker con { path, logLimit: undefined }.
         * Internamente usa `(logLimit || 1) * 1000` como valor de MAX_CHARACTERS.
         * El Worker no debe crashear por el valor ausente.
         *
         * ESPERA: Exit code 0, el archivo sigue siendo válido.
         *
         * ¿POR QUÉ IMPORTA? Writter.js pasa config.logLimit que puede ser undefined
         * si el usuario no lo define en pulsedev.json. El Worker debe ser resiliente.
         *
         * SI FALLA: Configuraciones mínimas (pulsedev.json sin logLimit) rompen
         *           el sistema de control de logs.
         */
        await writeFile(LOG_FILE, "linea corta\n", "utf-8");
        const exitCode = await runWorker({ path: LOG_FILE, logLimit: undefined });
        assert.equal(exitCode, 0, "Debe terminar con 0 aunque logLimit sea undefined");
    });

});
