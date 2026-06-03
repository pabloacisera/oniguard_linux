/**
 * ============================================================
 * TESTS: helpers/resourceHasher.js — Cache-busting en HTML
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * resourceHasher.js inyecta hashes MD5 en las URLs de recursos
 * (CSS/JS) dentro del HTML servido. Esto fuerza al navegador a
 * invalidar su caché cuando el contenido del recurso cambia.
 *
 * Si injectResourceHashes falla:
 *   - Falso negativo: el HTML se sirve sin ?v= → el browser usa
 *     CSS/JS viejos aunque el desarrollador haya modificado los archivos.
 *   - Falso positivo: el hash cambia sin motivo → el browser descarga
 *     recursos que no cambiaron (rendimiento degradado).
 *
 * ESTRATEGIA:
 * ----------
 * Creamos un directorio temporal con archivos CSS y JS reales.
 * Llamamos a injectResourceHashes con HTML que referencia esos
 * recursos y verificamos que las URLs contengan ?v=<hash8chars>.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert + node:fs/promises
 * --------------------------------------------------------------
 * I/O real porque la función lee del disco (readFile dentro del
 * reemplazo asíncrono). Mocks de readFile no verificarían que la
 * ruta se construye correctamente.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { injectResourceHashes } from "../helpers/resourceHasher.js";

const TMP_DIR = join(tmpdir(), "pulsedev-test-resource-hasher");
const SRC_DIR = join(TMP_DIR, "src");
const CSS_CONTENT = "body { color: red; }";
const JS_CONTENT = "console.log('app');";

before(async () => {
    await mkdir(join(SRC_DIR, "css"), { recursive: true });
    await mkdir(join(SRC_DIR, "js"), { recursive: true });
    await writeFile(join(SRC_DIR, "css", "index.css"), CSS_CONTENT, "utf-8");
    await writeFile(join(SRC_DIR, "js", "app.js"), JS_CONTENT, "utf-8");
});

after(async () => {
    await rm(TMP_DIR, { recursive: true, force: true });
});


// ==============================================================
// SUITE: injectResourceHashes
// ==============================================================
describe("injectResourceHashes", () => {

    test("Inyecta ?v= en href de CSS existente", async () => {
        /**
         * FLUJO: HTML con <link href="css/index.css">. La función
         * detecta el href, verifica que el archivo existe, lo hashea
         * con MD5 y reemplaza la URL por "css/index.css?v=<8chars>".
         *
         * ESPERA: El resultado contiene "href=\"css/index.css?v=".
         *
         * ¿POR QUÉ IMPORTA? El CSS es el recurso más común para
         * cache-busting. Si no se cachea bien, el usuario ve estilos
         * viejos tras un cambio.
         *
         * SI FALLA: Los estilos no se actualizan sin hard refresh.
         */
        const html = '<link rel="stylesheet" href="css/index.css">';
        const result = await injectResourceHashes(html, TMP_DIR);
        assert.ok(result.includes('href="css/index.css?v='),
            "Debe inyectar ?v= en el href del CSS");
    });

    test("Inyecta ?v= en src de JS existente", async () => {
        /**
         * FLUJO: HTML con <script src="js/app.js">. Misma lógica.
         *
         * ESPERA: El resultado contiene "src=\"js/app.js?v=".
         *
         * ¿POR QUÉ IMPORTA? El JS es igual de crítico. Los módulos
         * ES tienen caché agresiva en el navegador.
         *
         * SI FALLA: Los cambios en JS no se reflejan sin hard refresh.
         */
        const html = '<script src="js/app.js"></script>';
        const result = await injectResourceHashes(html, TMP_DIR);
        assert.ok(result.includes('src="js/app.js?v='),
            "Debe inyectar ?v= en el src del JS");
    });

    test("El hash tiene exactamente 8 chars", async () => {
        /**
         * FLUJO: Se extrae el valor de ?v= de la URL modificada.
         *
         * ESPERA: El valor después de ?v= tiene longitud 8.
         *
         * ¿POR QUÉ IMPORTA? El navegador interpreta cualquier cambio
         * en la query string como recurso nuevo. Pero por consistencia
         * y legibilidad en logs, usamos exactamente 8 chars (primeros
         * 8 del MD5). Si la longitud cambia, es sospechoso de bug.
         *
         * SI FALLA: La URL tiene ?v= con longitud incorrecta (o vacío).
         */
        const html = '<link rel="stylesheet" href="css/index.css">';
        const result = await injectResourceHashes(html, TMP_DIR);
        const match = result.match(/v=([a-f0-9]+)/);
        assert.ok(match, "Debe existir un valor de hash");
        assert.equal(match[1].length, 8, "El hash debe tener exactamente 8 caracteres");
    });

    test("No modifica src/href de recurso inexistente", async () => {
        /**
         * FLUJO: El HTML referencia un archivo que no existe en disco.
         * existsSync retorna false → se retorna el match original sin
         * modificar.
         *
         * ESPERA: La URL queda exactamente como estaba (sin ?v=).
         *
         * ¿POR QUÉ IMPORTA? Si un recurso no existe (aún no creado,
         * typo en la ruta), no debemos agregar un hash vacío que
         * genere una URL como "file.css?v=" (inválida).
         *
         * SI FALLA: El HTML contiene URLs rotas con ?v= sin hash.
         */
        const html = '<link rel="stylesheet" href="css/noexiste.css">';
        const result = await injectResourceHashes(html, TMP_DIR);
        assert.equal(result, html, "La URL del recurso inexistente no debe modificarse");
    });

    test("HTML sin recursos JS/CSS queda idéntico", async () => {
        /**
         * FLUJO: HTML plano sin src= ni href= que matcheen .js/.css.
         *
         * ESPERA: El output es exactamente el mismo string.
         *
         * ¿POR QUÉ IMPORTA? La función usa replaceAsync con regex.
         * Si el regex matchea algo que no debería (ej: href en un <a>),
         * podría modificar URLs incorrectamente.
         *
         * SI FALLA: Enlaces <a href="..."> se modifican con hashes.
         */
        const html = "<p>hola mundo</p>";
        const result = await injectResourceHashes(html, TMP_DIR);
        assert.equal(result, html, "HTML sin recursos debe quedar idéntico");
    });

    test("Múltiples recursos reciben hash individual", async () => {
        /**
         * FLUJO: HTML con 2 CSS y 1 JS.
         *
         * ESPERA: Las 3 URLs contienen ?v=.
         *
         * ¿POR QUÉ IMPORTA? Una página real tiene múltiples recursos.
         * Si solo el primero recibe hash, los demás quedan cacheados.
         *
         * SI FALLA: Solo algunos recursos se cache-bustean.
         */
        const html = [
            '<link rel="stylesheet" href="css/index.css">',
            '<link rel="stylesheet" href="css/noexiste.css">',
            '<script src="js/app.js"></script>'
        ].join("\n");
        const result = await injectResourceHashes(html, TMP_DIR);
        // Solo los existentes deben tener ?v=
        const vCount = (result.match(/\?v=/g) || []).length;
        assert.equal(vCount, 2, "Solo los 2 recursos existentes deben tener ?v=");
    });

    test("Hash es determinista: mismo contenido → mismo hash", async () => {
        /**
         * FLUJO: Se llama a injectResourceHashes dos veces con el
         * mismo HTML y los mismos archivos.
         *
         * ESPERA: Ambos resultados son idénticos.
         *
         * ¿POR QUÉ IMPORTA? Si el hash no fuera determinista, el
         * navegador descargaría recursos idénticos en cada request.
         *
         * SI FALLA: El hash cambia sin modificar el archivo → pérdida
         *           de caché del browser innecesaria.
         */
        const html = '<link rel="stylesheet" href="css/index.css">';
        const result1 = await injectResourceHashes(html, TMP_DIR);
        const result2 = await injectResourceHashes(html, TMP_DIR);
        assert.equal(result1, result2, "Mismo HTML + mismos archivos debe dar mismo resultado");
    });

    test("Hash cambia si cambia el contenido del recurso", async () => {
        /**
         * FLUJO: Se modifica el contenido de un CSS y se vuelve a
         * llamar a injectResourceHashes.
         *
         * ESPERA: El hash en la URL es diferente al original.
         *
         * ¿POR QUÉ IMPORTA? Este es el caso de uso real: el dev
         * modifica un CSS, el hash cambia, el browser descarga el
         * nuevo recurso.
         *
         * SI FALLA: El hash no cambia al modificar el archivo → el
         *           browser no descarga la nueva versión.
         */
        const html = '<link rel="stylesheet" href="css/index.css">';
        const resultBefore = await injectResourceHashes(html, TMP_DIR);

        // Modificar el contenido del CSS
        await writeFile(join(SRC_DIR, "css", "index.css"), "body { color: blue; }", "utf-8");

        const resultAfter = await injectResourceHashes(html, TMP_DIR);

        assert.notEqual(resultBefore, resultAfter,
            "El hash debe cambiar cuando el contenido del recurso cambia");

        // Restaurar para no afectar otros tests
        await writeFile(join(SRC_DIR, "css", "index.css"), CSS_CONTENT, "utf-8");
    });

});

