#!/usr/bin/env node
import { styleText } from "node:util";
import { argv, cwd } from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --- Guard de versión: PulseDev requiere Node.js 22+ por fs.watch recursive en Linux ---
const major = parseInt(process.versions.node.split(".")[0], 10);
if (Number.isNaN(major) || major < 22) {
    console.error(
        styleText("bgRed", " error ") +
        ` PulseDev requiere Node.js 22 o superior. Versión detectada: v${process.versions.node}`
    );
    process.exit(1);
}

const currentDirectory = cwd();

// --- Leer la versión desde el package.json de forma segura en ESM ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, "../package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;

// verificar que comando se ejecuto
let executeCommand = argv[2];
let helpCommands = `
${styleText("bold", "PulseDev - Vigilante de archivos para Node.js")}

${styleText("underline", "Uso:")}
  pulsedev <comando>

${styleText("underline", "Comandos disponibles:")}
  init               Genera el archivo de configuración "pulsedev.json"
  run                Ejecuta el servidor y vigila los cambios

${styleText("underline", "Opciones globales:")}
  --version, -v      Muestra la versión
  --help, -h         Muestra la ayuda

${styleText("underline", "Opciones de run:")}
  --list-flags       Muestra los flags disponibles (= claves de tu pulsedev.json)
  --persist          Si se usan flags, persiste el override al JSON
                     (por defecto los flags son override en memoria, no destructivo)
  --<clave> <valor>  Cualquier clave de tu pulsedev.json (ej: --port 4000)

${styleText("underline", "Ejemplos:")}
  pulsedev init                  Crea la configuración inicial
  pulsedev run                   Inicia el vigilante
  pulsedev run --list-flags      Muestra los flags disponibles
  pulsedev run --port 4000       Override en memoria (no toca el JSON)
  pulsedev run --port 4000 --persist   Override + escribe el JSON

${styleText("dim", "Documentación: https://github.com/pabloacisera/pulsedev_linux")}
    `;

// Estructura de control de comandos
if (executeCommand === "init") {
  import("../core/init.js").then(m => m.runInit(currentDirectory)).catch(e => { console.error(e); process.exit(1); });
} else if (executeCommand === "run") {
  import("../core/run.js").then(m => m.runCommand(currentDirectory)).catch(e => { console.error(e); process.exit(1); });
} else if (executeCommand === "--help" || executeCommand === "-h") {
  console.log(helpCommands);
} else if (executeCommand === "--version" || executeCommand === "-v") {
  // Mostramos la versión dinámica con un toque de estilo
  console.log(`v${version}`);
} else {
  console.log(
    styleText("bgMagenta", " Advertencia ") + 
    " No se ha ejecutado ningún comando válido. Usá " + 
    styleText("bold", "--help") + " para ver las opciones."
  );
}