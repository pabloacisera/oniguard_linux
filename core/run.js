/**
 * core/run.js — Entry point del comando `pulsedev run`
 *
 * Responsabilidad: orquestar todo lo concerniente al comando `run`,
 * separado del state machine HTTP que vive en serverManager.js.
 *
 * ============================================================================
 * SISTEMA DE FLAGS
 * ============================================================================
 *
 * CONVENCIÓN DE FLAGS
 * --------------------
 *   - Formato long: --nombre o --nombre=valor
 *   - Formato con valor: --port 4000 | --port=4000
 *   - Booleanos: presencia = true
 *   - Un flag desconocido (que no sea reservado ni clave del JSON) es error fatal
 *   - El schema de flags válidos = claves de tu pulsedev.json
 *
 * FLAGS RESERVADOS (siempre disponibles, no requieren clave en JSON)
 * -------------------------------------------------------------------
 *   --list-flags       Muestra los flags disponibles (= claves de tu JSON)
 *   --persist          Si se usan flags, persiste el override al JSON en vez
 *                      de solo override en memoria (opt-in, no destructivo
 *                      por defecto)
 *
 * EJEMPLOS DE USO
 * ---------------
 *   pulsedev run
 *   pulsedev run --list-flags
 *   pulsedev run --port 4000                       # override en memoria
 *   pulsedev run --port 4000 --persist             # override + escribe JSON
 *   pulsedev run --debounceDelay 1 --port 4000
 *   pulsedev run --outputPath=terminal
 *
 * COERCIÓN DE TIPOS
 * -----------------
 * Los flags llegan como string desde la CLI. Se coercionan al tipo del valor
 * original en el JSON:
 *   - JSON boolean → "true"/"1" = true, todo lo demás = false
 *   - JSON number  → Number(value) (NaN si inválido → error)
 *   - JSON array   → JSON.parse(value) (si falla, queda como string)
 *   - JSON string  → string
 *   - JSON null    → string
 *
 * PRECEDENCIA (de mayor a menor)
 * ------------------------------
 *   1. Flag CLI (este sistema)
 *   2. pulsedev.json (base)
 *   3. Defaults internos de serverManager
 *
 * ============================================================================
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { styleText } from "node:util";

import { read, writeFile } from "../helpers/writter.js";
import {
    startServer as _startServer,
    reloadServer as _reloadServer
} from "./serverManager.js";

const RESERVED_FLAGS = new Set(["list-flags", "persist"]);

/**
 * Parsea argumentos tipo process.argv en un objeto { flag: valor }.
 * Soporta: --key value, --key=value, --boolean (presencia = true).
 * Args que no empiezan con -- se ignoran.
 */
function parseFlags(args) {
    const flags = {};
    const list = Array.isArray(args) ? args : [];

    for (let i = 0; i < list.length; i++) {
        const arg = list[i];
        if (typeof arg !== "string" || !arg.startsWith("--")) continue;

        const eqIdx = arg.indexOf("=");
        if (eqIdx !== -1) {
            const key = arg.slice(2, eqIdx);
            const value = arg.slice(eqIdx + 1);
            if (key) flags[key] = value;
            continue;
        }

        const key = arg.slice(2);
        if (!key) continue;

        const next = list[i + 1];
        if (typeof next === "string" && !next.startsWith("--")) {
            flags[key] = next;
            i++;
        } else {
            flags[key] = true;
        }
    }

    return flags;
}

/**
 * Convierte un valor crudo de la CLI al tipo del valor original del JSON.
 * Lanza Error descriptivo si la coerción es imposible.
 */
function coerceValue(rawValue, original) {
    const isBoolFlag = rawValue === true;

    if (typeof original === "boolean") {
        if (isBoolFlag) return true;
        const v = String(rawValue).toLowerCase();
        if (v === "true" || v === "1" || v === "yes") return true;
        if (v === "false" || v === "0" || v === "no") return false;
        throw new Error(`valor booleano inválido: ${rawValue}`);
    }

    if (typeof original === "number") {
        const n = Number(rawValue);
        if (Number.isNaN(n)) throw new Error(`valor numérico inválido: ${rawValue}`);
        return n;
    }

    if (Array.isArray(original)) {
        if (isBoolFlag) {
            throw new Error("se esperaba un array (ej: '[\"*\"]'), se recibió flag booleano");
        }
        try {
            return JSON.parse(rawValue);
        } catch {
            throw new Error(`valor de array inválido (debe ser JSON válido): ${rawValue}`);
        }
    }

    if (original === null) {
        return String(rawValue);
    }

    return String(rawValue);
}

/**
 * Devuelve la lista de flags (no reservados) que NO existen como clave en config.
 */
function findUnknownFlags(flags, config) {
    const configKeys = new Set(Object.keys(config));
    return Object.keys(flags).filter(
        (k) => !RESERVED_FLAGS.has(k) && !configKeys.has(k)
    );
}

/**
 * Construye un config mergeado a partir del config base y los flags parseados.
 * No muta el config base. No toca el disco.
 */
function mergeConfig(baseConfig, flags) {
    const merged = { ...baseConfig };
    for (const [key, rawValue] of Object.entries(flags)) {
        if (RESERVED_FLAGS.has(key)) continue;
        if (!(key in merged)) continue;
        merged[key] = coerceValue(rawValue, merged[key]);
    }
    return merged;
}

/**
 * Lee el pulsedev.json del directorio y muestra las claves con sus valores
 * actuales. Cada clave listada es un flag válido para `pulsedev run`.
 */
async function listFlags(currentDirectory) {
    const configPath = join(currentDirectory, "pulsedev.json");

    if (!existsSync(configPath)) {
        console.error(
            styleText("bgRed", " error ") +
            " No se encontró pulsedev.json. Ejecutá `pulsedev init` primero."
        );
        process.exit(1);
    }

    const raw = await read(configPath);
    if (!raw) {
        console.error(
            styleText("bgRed", " error ") +
            " No se pudo leer pulsedev.json (archivo vacío o ilegible)."
        );
        process.exit(1);
    }

    let config;
    try {
        config = JSON.parse(raw);
    } catch (err) {
        console.error(
            styleText("bgRed", " error ") +
            ` pulsedev.json tiene JSON inválido: ${err.message}`
        );
        process.exit(1);
    }

    const keys = Object.keys(config);
    if (keys.length === 0) {
        console.log("pulsedev.json no tiene claves configurables.");
        return;
    }

    console.log(
        styleText("bold", "Flags disponibles (= claves de tu pulsedev.json):")
    );
    const maxLen = Math.max(...keys.map((k) => k.length));
    for (const key of keys) {
        const current = JSON.stringify(config[key]);
        const label = `--${key}`.padEnd(maxLen + 3);
        console.log(`  ${label} (actual: ${current})`);
    }
    console.log("");
    console.log(
        styleText("dim", "  Flags reservados (no requieren clave en JSON):")
    );
    console.log("    --list-flags    Muestra esta lista");
    console.log("    --persist       Persiste el override al JSON (opt-in)");
}

/**
 * Carga el pulsedev.json o termina con error descriptivo.
 */
async function loadBaseConfig(currentDirectory) {
    const configPath = join(currentDirectory, "pulsedev.json");

    if (!existsSync(configPath)) {
        console.error(
            styleText("bgRed", " error ") +
            " No se encontró pulsedev.json. Ejecutá `pulsedev init` primero."
        );
        process.exit(1);
    }

    const raw = await read(configPath);
    if (!raw) {
        console.error(
            styleText("bgRed", " error ") +
            " No se pudo leer pulsedev.json (archivo vacío o ilegible)."
        );
        process.exit(1);
    }

    try {
        return JSON.parse(raw);
    } catch (err) {
        console.error(
            styleText("bgRed", " error ") +
            ` pulsedev.json tiene JSON inválido: ${err.message}`
        );
        process.exit(1);
    }
}

/**
 * Valida los flags contra el schema del config. Termina con error si hay
 * flags desconocidos. Lanza Error si algún valor no se puede coercionar.
 */
function validateFlagsOrExit(flags, baseConfig) {
    const unknown = findUnknownFlags(flags, baseConfig);
    if (unknown.length === 0) return;

    const available = Object.keys(baseConfig)
        .map((k) => `--${k}`)
        .join(", ");
    console.error(
        styleText("bgRed", " error ") +
        ` Flag(s) desconocido(s): ${unknown.map((f) => `--${f}`).join(", ")}\n` +
        ` Flags disponibles (= claves de tu pulsedev.json): ${available}\n` +
        ` Ejecutá \`pulsedev run --list-flags\` para ver el detalle de los valores actuales.`
    );
    process.exit(1);
}

/**
 * Entry point del comando `pulsedev run`.
 *
 * @param {string} currentDirectory - cwd donde está el proyecto del usuario
 * @param {object} [options]
 * @param {string[]} [options.argv] - args a parsear (default: process.argv.slice(3))
 * @param {boolean} [options.silent] - suprime el banner
 */
export const runCommand = async (currentDirectory, options = {}) => {
    const argv = Array.isArray(options.argv)
        ? options.argv
        : process.argv.slice(3);
    const flags = parseFlags(argv);

    if (flags["list-flags"]) {
        await listFlags(currentDirectory);
        return;
    }

    const baseConfig = await loadBaseConfig(currentDirectory);
    validateFlagsOrExit(flags, baseConfig);

    let mergedConfig = baseConfig;
    const hasUserFlags = Object.keys(flags).some((k) => !RESERVED_FLAGS.has(k));

    if (hasUserFlags) {
        try {
            mergedConfig = mergeConfig(baseConfig, flags);
        } catch (err) {
            console.error(
                styleText("bgRed", " error ") +
                ` No se pudo aplicar el flag: ${err.message}`
            );
            process.exit(1);
        }
    }

    if (hasUserFlags && flags["persist"]) {
        const configPath = join(currentDirectory, "pulsedev.json");
        const serialized = JSON.stringify(mergedConfig, null, 2);
        await writeFile(configPath, serialized);
        console.log(
            styleText("bgYellow", " persist ") +
            " Configuración sobrescrita en pulsedev.json"
        );
    } else if (hasUserFlags) {
        console.log(
            styleText("dim", " ⓘ Flags aplicados en memoria (no se modificó el JSON). Usá --persist para persistir.")
        );
    }

    if (!options.silent) {
        const ts = new Date().toISOString();
        console.log(styleText("dim", `▶ PulseDev ${ts} · ${hostname()}`));
    }

    return _startServer(currentDirectory, mergedConfig);
};

export { _startServer as startServer, _reloadServer as reloadServer };

// exported for testing
export { parseFlags, coerceValue, mergeConfig, findUnknownFlags, RESERVED_FLAGS };
export { listFlags, loadBaseConfig, validateFlagsOrExit };
