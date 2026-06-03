/**
 * Debemos comparar el hash existe en un archivo con el nuevo creado
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const fileHashes = new Map();

export async function compareChanges(filepath) {
    try {
        const content = await readFile(filepath, "utf8");

        const currentHash = createHash("md5").update(content).digest("hex");
        // ver si el mismo archivo ya existe en map
        const previousHash = fileHashes.get(filepath);

        // si son iguales se retorna false
        if(currentHash === previousHash) {
            return false;
        }

        // si no lo son guardamos el hash en el map y retornamos verdadero
        fileHashes.set(filepath, currentHash);
        return true
    } catch {
        return false;
    }
}

/**
 * inyectamos el hash a la url del archivo
 */

export function injectToUrl(urlPath, hash){
    if(!hash)  return urlPath;

    return `${urlPath}?v=${hash.substring(0,8)}`;
}