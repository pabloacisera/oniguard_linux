import { styleText } from "node:util";
import { readFile, appendFile, mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

let pendingLogCheck = null;

export const write = async (pathFile, text, logLimit = 5) => {
    if (!pathFile || !text) {
        console.log(styleText("bgCyan", " advertencia: ") + "No se ha especificado ruta.");
        return;
    }

    try {
        const folder = dirname(pathFile);

        await mkdir(folder, { recursive: true });

        await appendFile(pathFile, text + "\n", "utf-8");

        if (pathFile.endsWith("requests.log")) {
            clearTimeout(pendingLogCheck);
            pendingLogCheck = setTimeout(() => {
                const workerPath = join(__dirname, "counterChar.js");
                const worker = new Worker(workerPath);
                worker.unref();

                worker.postMessage({
                    path: pathFile,
                    logLimit: logLimit
                });

                worker.on("error", (err) => {
                    console.error("Error de ejecución del worker de logs: ", err.message);
                });
            }, 1000);
            pendingLogCheck.unref();
        }

} catch (err) {
        console.error(styleText("bgRed", " error crítico de escritura: ") + err.message);
    }
}

/**
 * Sobrescribe un archivo con el contenido dado (NO append).
 * A diferencia de write():
 *   - No agrega "\n" al final (escribe el contenido tal cual)
 *   - No dispara el worker de logs
 *   - Crea la carpeta padre si no existe
 * Pensado para archivos de configuración completos (JSON, etc) que
 * se reescriben enteros.
 */
export const writeFile = async (pathFile, content) => {
    if (!pathFile || content === undefined || content === null) {
        console.log(styleText("bgCyan", " advertencia: ") + "No se ha especificado ruta o contenido.");
        return;
    }

    try {
        const folder = dirname(pathFile);
        await mkdir(folder, { recursive: true });
        await fsWriteFile(pathFile, content, "utf-8");
    } catch (err) {
        console.error(styleText("bgRed", " error crítico de escritura: ") + err.message);
    }
}

export const read = async (pathFile) => {
    if (!pathFile) {
        console.log(styleText("bgCyan", " advertencia: ") + "No se ha especificado ruta.");
        return null;
    }

    try {
        const file = await readFile(pathFile, "utf-8");
        return file;
    } catch (err) {
        // Si el archivo no existe al intentar leerlo, devolvemos null pacíficamente
        return null;
    }
}
