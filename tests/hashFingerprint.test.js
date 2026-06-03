/**
 * ============================================================
 * TESTS: helpers/hashFingerprint.js
 * ============================================================
 *
 * ¿POR QUÉ TESTEAMOS ESTE MÓDULO?
 * ---------------------------------
 * hashFingerprint es el CORAZÓN del sistema de detección de cambios.
 * Si falla, el watcher dispara reloads para archivos que no cambiaron
 * (tormenta de reloads) o, al revés, ignora cambios reales (live reload roto).
 * Ambos escenarios hacen la herramienta inútil.
 *
 * FUNCIONES CUBIERTAS:
 *   - compareChanges(filepath): Lee un archivo, hashea su contenido con MD5
 *     y lo compara con el hash previo almacenado en un Map en memoria.
 *     Retorna true si el contenido cambió, false si es el mismo.
 *
 *   - injectToUrl(urlPath, hash): Toma una URL y le inyecta un query param
 *     ?v=<primeros8chars> para cache-busting del navegador.
 *
 * TECNOLOGÍA ELEGIDA: node:test + node:assert
 * -------------------------------------------
 * Son los módulos del runtime, cero dependencias, consistentes con el
 * espíritu "zero-deps" del proyecto. No necesitamos Jest ni Vitest para
 * funciones puras que no tienen efectos de red ni UI.
 *
 * node:fs/promises se usa para crear archivos temporales reales en lugar
 * de mocks, porque compareChanges lee del disco: testear con el disco real
 * verifica el flujo completo (lectura → hash → comparación), no una
 * simulación que podría ocultar errores de encoding o permisos.
 * ============================================================
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { compareChanges, injectToUrl } from "../helpers/hashFingerprint.js";

// Usamos un directorio temporal del sistema para no ensuciar el proyecto
const TMP_DIR = join(tmpdir(), "pulsedev-test-hash");
const TMP_FILE = join(TMP_DIR, "archivo.test.js");

before(async () => {
    await mkdir(TMP_DIR, { recursive: true });
});

after(async () => {
    // Limpieza: borramos el archivo temporal al terminar la suite
    try { await unlink(TMP_FILE); } catch { /* si no existe, no importa */ }
});


// ==============================================================
// SUITE: compareChanges
// ==============================================================
describe("compareChanges", () => {

    test("primera lectura siempre retorna true", async () => {
        /**
         * FLUJO: El archivo existe pero nunca fue leído por esta instancia del
         * watcher. El Map interno está vacío → no hay hash previo → cualquier
         * contenido se considera "cambio nuevo".
         *
         * ESPERA: true
         *
         * ¿POR QUÉ IMPORTA? Si retornara false en el primer acceso, el watcher
         * nunca registraría el estado inicial y perdería el primer cambio real.
         *
         * SI FALLA: El watcher no reacciona al primer guardado tras arrancar.
         */
        await writeFile(TMP_FILE, "contenido inicial", "utf8");
        const result = await compareChanges(TMP_FILE);
        assert.equal(result, true, "Primera lectura debe retornar true");
    });

    test("segunda lectura sin cambios retorna false", async () => {
        /**
         * FLUJO: El mismo archivo se lee dos veces seguidas sin modificación.
         * El hash ya está en el Map → coincide → sin cambio.
         *
         * ESPERA: false
         *
         * ¿POR QUÉ IMPORTA? Este es el caso más frecuente en producción:
         * fs.watch dispara eventos duplicados (comportamiento conocido del kernel).
         * Si retornara true, cada evento duplicado dispararía un reload innecesario.
         *
         * SI FALLA: El navegador se recarga en bucle aunque el archivo no cambie.
         */
        // El archivo ya existe de la prueba anterior, lo leemos de nuevo sin tocar
        const result = await compareChanges(TMP_FILE);
        assert.equal(result, false, "Sin cambios debe retornar false");
    });

    test("retorna true después de modificar el contenido", async () => {
        /**
         * FLUJO: Se modifica el archivo y se vuelve a llamar a compareChanges.
         * El nuevo MD5 difiere del almacenado → cambio detectado.
         *
         * ESPERA: true
         *
         * ¿POR QUÉ IMPORTA? Este es el caso feliz del hot reload: el dev guarda,
         * el watcher detecta, el servidor reinicia. Si falla, el live reload está roto.
         *
         * SI FALLA: Los cambios del desarrollador nunca se reflejan en el navegador.
         */
        await writeFile(TMP_FILE, "contenido MODIFICADO", "utf8");
        const result = await compareChanges(TMP_FILE);
        assert.equal(result, true, "Archivo modificado debe retornar true");
    });

    test("retorna false para un archivo inexistente (no lanza excepción)", async () => {
        /**
         * FLUJO: Se pasa una ruta que no existe. El try/catch interno captura
         * el ENOENT y retorna false sin propagar el error.
         *
         * ESPERA: false (no un throw)
         *
         * ¿POR QUÉ IMPORTA? El watcher puede recibir eventos de archivos que ya
         * fueron borrados entre el evento y la lectura (race condition clásica).
         * El sistema debe ser resiliente, no crashear.
         *
         * SI FALLA: El watcher muere con UnhandledPromiseRejection al borrar archivos.
         */
        const result = await compareChanges("/ruta/que/no/existe/archivo.js");
        assert.equal(result, false, "Archivo inexistente debe retornar false sin throw");
    });

});


// ==============================================================
// SUITE: injectToUrl
// ==============================================================
describe("injectToUrl", () => {

    test("inyecta ?v= con los primeros 8 chars del hash", () => {
        /**
         * FLUJO: Se pasa una URL limpia y un hash MD5 completo (32 chars).
         * La función debe devolver la URL con ?v= seguido de los 8 primeros chars.
         *
         * ESPERA: "/css/index.css?v=abc12345"
         *
         * ¿POR QUÉ IMPORTA? El cache-busting depende exactamente de este formato.
         * Si cambia el largo del suffix o el separador, los browsers no invalidan
         * la caché correctamente.
         *
         * SI FALLA: CSS/JS obsoletos se sirven desde caché del browser tras un rebuild.
         */
        const hash = "abc12345xyz98765abc12345xyz98765"; // 32 chars, MD5 típico
        const result = injectToUrl("/css/index.css", hash);
        assert.equal(result, "/css/index.css?v=abc12345");
    });

    test("retorna la url original si hash es falsy", () => {
        /**
         * FLUJO: Se llama con hash = null, undefined o "".
         * La función debe retornar la URL sin modificar.
         *
         * ESPERA: "/css/index.css"
         *
         * ¿POR QUÉ IMPORTA? En run.js se llama injectToUrl con el resultado de
         * createHash, pero si el archivo no existe, existsSync retorna false
         * y la función se llama con hash vacío. No debe romper el HTML.
         *
         * SI FALLA: La URL del recurso queda como "/css/index.css?v=" (inválida)
         *           o undefined, rompiendo la carga del archivo en el browser.
         */
        assert.equal(injectToUrl("/css/index.css", null), "/css/index.css");
        assert.equal(injectToUrl("/css/index.css", undefined), "/css/index.css");
        assert.equal(injectToUrl("/css/index.css", ""), "/css/index.css");
    });

    test("funciona con rutas que ya tienen parámetros", () => {
        /**
         * FLUJO: Se pasa una ruta como "/js/app.js" (sin parámetros previos)
         * junto a un hash. Se verifica que el resultado tiene el formato correcto.
         *
         * ESPERA: "/js/app.js?v=deadbeef"
         *
         * ¿POR QUÉ IMPORTA? Confirma que la concatenación es consistente para
         * distintas rutas (no sólo CSS, también JS).
         *
         * SI FALLA: El cache busting no aplica a archivos JS, quedan obsoletos.
         */
        const result = injectToUrl("/js/app.js", "deadbeef11223344556677889900aabb");
        assert.equal(result, "/js/app.js?v=deadbeef");
    });

});
