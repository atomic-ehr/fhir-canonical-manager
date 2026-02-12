/**
 * npm package loading into cache
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import type { PreprocessPackageContext } from "../types/index.js";
import { loadPackage } from "./package.js";

export const loadPackagesIntoCache = async (
    cache: ExtendedCache,
    pwd: string,
    preprocessPackage?: (context: PreprocessPackageContext) => PreprocessPackageContext,
): Promise<void> => {
    const nodeModulesPath = path.join(pwd, "node_modules");
    const entries = await fs.readdir(nodeModulesPath, { withFileTypes: true });
    const warnings: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const packagePath = path.join(entry.parentPath, entry.name);

        if (entry.name.startsWith("@")) {
            const scopedEntries = await fs.readdir(packagePath, { withFileTypes: true });
            for (const scopedEntry of scopedEntries) {
                if (!scopedEntry.isDirectory()) continue;
                const w = await loadPackage(path.join(packagePath, scopedEntry.name), cache, preprocessPackage);
                if (w) warnings.push(w);
            }
        } else {
            const w = await loadPackage(packagePath, cache, preprocessPackage);
            if (w) warnings.push(w);
        }
    }

    if (warnings.length > 0) {
        console.warn(`Warnings:\n${warnings.map((w) => `  - ${w}`).join("\n")}`);
    }
};
