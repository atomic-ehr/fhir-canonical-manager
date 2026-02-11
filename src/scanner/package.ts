/**
 * Package scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import type { IndexEntry, PackageInfo, PackageJson } from "../types/index.js";
import { processIndex } from "./processor.js";

const scanDirectoryForResources = async (
    dirPath: string,
    packageJson: PackageJson,
    cache: ExtendedCache,
): Promise<void> => {
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            if (entry.name === "package.json" || entry.name === ".index.json") continue;

            const filePath = path.join(dirPath, entry.name);

            try {
                const content = await fs.readFile(filePath, "utf-8");
                const resource = JSON.parse(content);

                // Check if it's a FHIR resource with resourceType
                if (!resource.resourceType) continue;

                const url = resource.url;
                if (!url) continue; // Only index resources with canonical URLs

                const id = cache.referenceManager.generateId({
                    packageName: packageJson.name,
                    packageVersion: packageJson.version,
                    filePath,
                });

                cache.referenceManager.set(id, {
                    packageName: packageJson.name,
                    packageVersion: packageJson.version,
                    filePath,
                    resourceType: resource.resourceType,
                    url,
                    version: resource.version,
                });

                const indexEntry: IndexEntry = {
                    id,
                    resourceType: resource.resourceType,
                    indexVersion: 0, // No index version for manually scanned resources
                    url,
                    version: resource.version,
                    kind: resource.kind,
                    type: resource.type,
                    package: {
                        name: packageJson.name,
                        version: packageJson.version,
                    },
                };

                if (!cache.entries[url]) {
                    cache.entries[url] = [];
                }
                cache.entries[url]?.push(indexEntry);
            } catch {
                // Skip files that can't be parsed
            }
        }
    } catch {
        // Silently ignore directory scan errors
    }
};

export const scanPackage = async (packagePath: string, cache: ExtendedCache): Promise<void> => {
    try {
        const packageJsonPath = path.join(packagePath, "package.json");
        const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
        const packageJson: PackageJson = JSON.parse(packageJsonContent);

        const packageInfo: PackageInfo = {
            id: { name: packageJson.name, version: packageJson.version },
            path: packagePath,
            canonical: packageJson.canonical,
            fhirVersions: packageJson.fhirVersions,
        };
        cache.packages[packageJson.name] = packageInfo;

        const indexPath = path.join(packagePath, ".index.json");
        const hasIndex = await fileExists(indexPath);

        if (hasIndex) {
            await processIndex(packagePath, packageJson, cache);
        } else {
            await scanDirectoryForResources(packagePath, packageJson, cache);
        }

        const examplesPath = path.join(packagePath, "examples");
        if (await fileExists(path.join(examplesPath, ".index.json"))) {
            await processIndex(examplesPath, packageJson, cache);
        }
    } catch {
        // Silently ignore package scan errors
    }
};
