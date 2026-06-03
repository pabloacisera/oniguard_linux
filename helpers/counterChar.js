/**
 * no podemos usar el metodo write porque apendea, y aqui necesitamos reescribir
 * y tampoco write por estariamos creando una referencia circular con el writter que ejecuta counter
 */
import { writeFile, readFile } from "node:fs/promises";
/**
 * vamos a crar un hilo de procesador que se ocupe especificamente de la tarea de leer, cortar y unir
 */
import { parentPort } from "node:worker_threads";

parentPort.on("message", async (data) => {
    const { path, logLimit } = data;

    try {
        let text = await readFile(path, "utf-8");
        if (!text) return;

        const MAX_CHARACTERS = (logLimit || 1) * 1000;

        if (text.length > MAX_CHARACTERS) {
            // 1. convertimos en array por salto de pagina
            let lines = text.split("\n");

            while (lines.join("\n").length > (MAX_CHARACTERS * 0.8)) {
                // 1.1 sistema FIFO(first in, first out)
                // los logs mas viejos son los primeros en entrar, y por ende los primeros en borrarse
                lines.shift();
            }

            // 2. volvemos a unir
            let cleanedText = lines.join("\n");

            await writeFile(path, cleanedText, "utf-8");
        }
    } catch (error) {
        console.error("[worker] - error: " + error.message);
    } finally {
        process.exit(0);
    }
});