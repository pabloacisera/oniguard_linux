import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { injectToUrl } from "./hashFingerprint.js";

async function replaceAsync(str, regex, asyncFn) {
    const promises = [];
    str.replace(regex, (match, ...args) => {
        promises.push(asyncFn(match, ...args));
        return match;
    });
    const data = await Promise.all(promises);
    return str.replace(regex, () => data.shift());
}

export async function injectResourceHashes(htmlContent, currentDirectory) {
    const regexResources = /(src|href)="([^"]+\.(js|css))"/g;

    const result = await replaceAsync(htmlContent, regexResources, async (match, attr, routeResource) => {
        const pathResource = join(currentDirectory, "src", routeResource);

        if (existsSync(pathResource)) {
            const resourceContent = await readFile(pathResource, "utf8");
            const resourceHash = createHash("md5").update(resourceContent).digest("hex");
            const urlConHash = injectToUrl(routeResource, resourceHash);
            return `${attr}="${urlConHash}"`;
        }
        return match;
    });

    return result;
}