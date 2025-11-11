/**
 * Directory scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { isFhirPackage } from "../fs/index.js";
import { scanPackage } from "./package.js";

export const scanDirectory = async (dirPath: string, cache: ExtendedCache): Promise<void> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const fullPath = path.join(dirPath, entry.name);

            if (entry.name.startsWith("@")) {
                const scopedEntries = await fs.readdir(fullPath, {
                    withFileTypes: true,
                });
                for (const scopedEntry of scopedEntries) {
                    if (!scopedEntry.isDirectory()) continue;

                    const scopedPath = path.join(fullPath, scopedEntry.name);
                    if (await isFhirPackage(scopedPath)) {
                        await scanPackage(scopedPath, cache);
                    }
                }
            } else if (await isFhirPackage(fullPath)) {
                await scanPackage(fullPath, cache);
            }
        }
    } catch {
        // Silently ignore scan errors
    }
};
