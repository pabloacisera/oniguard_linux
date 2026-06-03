import { styleText } from "node:util";
import { write } from "../helpers/writter.js";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMPLATES_DIR = join(__dirname, "../web/templates");

const templates = {
    config: readFileSync(join(TEMPLATES_DIR, "pulsedev.json"), "utf-8"),
    html: readFileSync(join(TEMPLATES_DIR, "index.html"), "utf-8"),
    css: readFileSync(join(TEMPLATES_DIR, "index.css"), "utf-8"),
    js: readFileSync(join(TEMPLATES_DIR, "index.js"), "utf-8"),
    socket: readFileSync(join(TEMPLATES_DIR, "socket-client.js"), "utf-8"),
    docs: readFileSync(join(TEMPLATES_DIR, "documentation.html"), "utf-8"),
};

export async function runInit(currentDirectory) {
    console.log(styleText("bgBlue", " info ") + " ejecutando init...");

    const source = join(__dirname, "../web/assets");
    const destiny = join(currentDirectory, 'src', 'assets');

    mkdirSync(join(currentDirectory, 'src'), { recursive: true });
    mkdirSync(join(currentDirectory, 'src', 'js'), { recursive: true });
    mkdirSync(join(currentDirectory, 'src', 'css'), { recursive: true });

    cpSync(source, destiny, { recursive: true });

    const finalJs = templates.js.replace('__DOCUMENTATION_HTML__', JSON.stringify(templates.docs));

    try {
        console.log(styleText("bgMagentaBright", " execute ") + " Creando archivo de configuración.");
        await write(join(currentDirectory, 'pulsedev.json'), templates.config);

        console.log(styleText("bgMagentaBright", " execute ") + " Creando archivos basicos de servidor. ");
        await write(join(currentDirectory, 'src', 'index.html'), templates.html);
        await write(join(currentDirectory, 'src', 'js', 'index.js'), finalJs);
        await write(join(currentDirectory, 'src', 'js', 'socket-client.js'), templates.socket);
        await write(join(currentDirectory, 'src', 'css', 'index.css'), templates.css);
        console.log(styleText("bgGreenBright", " execute ") + " Revisar archivo de configuracion y ejecutar servidor con 'pulsedev run'. ");
    } catch (err) {
        console.error(styleText("bgRed", " error: ") + "Fallo al inicializar los archivos: " + err.message);
    }
}