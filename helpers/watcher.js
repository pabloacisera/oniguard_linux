import { watch, stat } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { hostname } from "node:os";
import { styleText } from "node:util";
import { compareChanges } from "./hashFingerprint.js";
import { write } from "./writter.js";

// Almacena referencias a watchers activos para poder cerrarlos desde tests
const _activeWatchers = [];

/**
 * Cierra todos los watchers activos. Exportado para testing.
 */
export async function _closeActiveWatchers() {
    const closers = [..._activeWatchers];
    _activeWatchers.length = 0;
    await Promise.allSettled(closers.map(c => { try { return c(); } catch {} }));
}

export const startWatcher = async (config, currentDirectory, reloadServer, abortSignal) => {
    if (!Array.isArray(config.watchPath)) {
        console.log(styleText("bgRed", " error ") +
            ' watchPath debe ser un array en pulsedev.json. Ejemplo: ["*"] o ["./src/css", "./src/js"]');
        process.exit(1);
    }

    const extensionesIgnoradas = (Array.isArray(config.ignoreExtensions)
        ? config.ignoreExtensions
        : []
    ).map(ext => ext.replace("*", ""));

    const isWildcard = config.watchPath.includes("*");

    /**
     * VALIDACIÓN DE CONFIGURACIÓN DE ESCUCHA (RECURSIVE)
     * 
     * Determinamos si el watcher debe ser recursivo basándonos en la configuración
     * y el tipo de ruta (comodín o rutas específicas).
     */
    let isRecursive = config.recursive ?? true;

    /**
     * Caso 1: watchPath es wildcard ["*"] y recursive es false
     * → Configuración inválida: el watcher solo escucharía la raíz (pulsedev.json).
     *   Forzamos recursive: true para que detecte cambios en /src y subcarpetas.
     */
    if (isWildcard && config.recursive === false) {
        console.log(
            styleText("bgYellow", " advertencia ") +
            " recursive: false no tiene efecto cuando watchPath es [\"*\"]." +
            " El watcher solo escucharía la raíz del proyecto y nunca detectaría" +
            " cambios en src/. Se usará recursive: true automáticamente." +
            " Para usar recursive: false definí rutas específicas en watchPath," +
            " por ejemplo: [\"./src/css\", \"./src/js\"]."
        );
        isRecursive = true;
    }

    /**
     * Caso 2: watchPath tiene rutas propias y recursive es false
     * → Configuración válida: el usuario elige vigilar solo la raíz de carpetas específicas.
     *   Informamos al usuario que el modo no recursivo está activo.
     */
    if (!isWildcard && config.recursive === false) {
        console.log(
            styleText("bgCyan", " info ") +
            " Modo de escucha no recursivo activo." +
            " Solo se vigilarán los archivos en la raíz de cada ruta configurada en watchPath." +
            " Los subdirectorios no serán vigilados."
        );
    }

    /**
     * Definimos las rutas absolutas a vigilar.
     * Si es wildcard, vigilamos el directorio actual (raíz).
     */
    const pathToWatch = isWildcard
        ? [currentDirectory]
        : config.watchPath.map(p => join(currentDirectory, p));

    // debounce: esperamos el tiempo configurado antes de ejecutar el reload
    // si llegan multiples eventos seguidos, solo se ejecuta una vez al final
    let debounceTimer = null;
    const debounceDelay = (config.debounceDelay || 0.5) * 1000;

    const triggerReload = () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            reloadServer();
        }, debounceDelay);
    };

    for (const target of pathToWatch) {
        // IIFE correctamente invocada con () al final
        (async () => {
            try {
                // Iniciamos el watcher con el flag de recursividad validado previamente
                // y la señal de aborto para poder cerrarlo desde tests sin dejar el event loop colgado
                const watchOptions = { recursive: isRecursive, persistent: false };
                if (abortSignal) watchOptions.signal = abortSignal;
                const watcher = watch(target, watchOptions);

                // Guardamos referencia para poder cerrarlo desde tests
                _activeWatchers.push(async () => { try { await watcher.close(); } catch {} });

                // Generador Asíncrono, "escupe" promesas en cada iteración del bucle
                for await (const event of watcher) {
                    const { filename } = event;
                    if (!filename) continue;

                    let absolutePath = join(target, filename);

                    /**
                     * si la ruta que formamos es un carpeta el fingerprint intentara leerla y fallará
                     * debemos evitar que intente hacerlo, solo se puede leer archivos
                     */
                    try {
                        const stats = await stat(absolutePath);
                        if (stats.isDirectory()) continue;
                    } catch (error) {
                        continue;
                    }

                    let ext = extname(absolutePath);
                    let name = basename(absolutePath);

                    // ignorar extensiones configuradas
                    if (extensionesIgnoradas.includes(ext)) continue;

                    // ignorar archivos de log propios y archivos ocultos
                    if (name === "requests.log" || name === "errors.log" || name.startsWith(".")) continue;

                    // solo recargar si el contenido realmente cambio
                    let hasChange = await compareChanges(absolutePath);

                    if (hasChange) {
                        console.log(styleText("bgCyan", " watcher ") + ` archivo modificado: ${filename}`);
                        triggerReload();
                    }
                }

            } catch (err) {
                if (err.code === 'ENOENT' || err.name === 'AbortError') return;

                if (config.outputPath === "log") {
                    if (!existsSync(`${currentDirectory}/logs`)) {
                        mkdirSync(join(currentDirectory, 'logs'), { recursive: true });
                    }
                    let messageError = `${Date.now()} - ${hostname()}/${currentDirectory}: ${err.message}`;
                    await write(`${currentDirectory}/logs/errors.log`, messageError);
                } else {
                    console.error(`Error en el watcher sobre la ruta ${target}:`, err.message);
                }
            }
        })(); // <- () que faltaba
    }
};
