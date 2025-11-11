/**
 * Index processing functionality
 */

import * as fs from "fs/promises";
import * as path from "path";
import type { PackageJson, IndexEntry } from "../types/index.js";
import type { ExtendedCache } from "../cache/core.js";
import { parseIndex } from "./parser.js";

export const processIndex = async (basePath: string, packageJson: PackageJson, cache: ExtendedCache): Promise<void> => {
    const indexPath = path.join(basePath, ".index.json");

    try {
        const indexContent = await fs.readFile(indexPath, "utf-8");
        const index = parseIndex(indexContent, indexPath);

        if (!index) return;

        for (const file of index.files) {
            if (!file.url) continue;

            const filePath = path.join(basePath, file.filename);

            const id = cache.referenceManager.generateId({
                packageName: packageJson.name,
                packageVersion: packageJson.version,
                filePath,
            });

            cache.referenceManager.set(id, {
                packageName: packageJson.name,
                packageVersion: packageJson.version,
                filePath,
                resourceType: file.resourceType,
                url: file.url,
                version: file.version,
            });

            const entry: IndexEntry = {
                id,
                resourceType: file.resourceType,
                indexVersion: index["index-version"],
                url: file.url,
                version: file.version,
                kind: file.kind,
                type: file.type,
                package: {
                    name: packageJson.name,
                    version: packageJson.version,
                },
            };

            if (!cache.entries[file.url]) {
                cache.entries[file.url] = [];
            }
            const entries = cache.entries[file.url];
            if (entries) {
                entries.push(entry);
            }
        }
    } catch {
        // Silently ignore index processing errors
    }
};
