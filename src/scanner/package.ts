/**
 * Package scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import type { IndexEntry, PackageJson, PreprocessPackageContext } from "../types/index.js";
import { processIndex } from "./processor.js";

const scanDirectoryForResources = async (
    dirPath: string,
    packageJson: PackageJson,
    cache: ExtendedCache,
): Promise<number> => {
    let count = 0;
    try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
            if (entry.name === "package.json" || entry.name === ".index.json") continue;

            const filePath = path.join(dirPath, entry.name);

            try {
                const content = await fs.readFile(filePath, "utf-8");
                const resource = JSON.parse(content);

                if (!resource.resourceType || !resource.url) continue;

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
                    url: resource.url,
                    version: resource.version,
                });

                const indexEntry: IndexEntry = {
                    id,
                    resourceType: resource.resourceType,
                    indexVersion: 0,
                    url: resource.url,
                    version: resource.version,
                    kind: resource.kind,
                    type: resource.type,
                    package: {
                        name: packageJson.name,
                        version: packageJson.version,
                    },
                };

                if (!cache.entries[resource.url]) {
                    cache.entries[resource.url] = [];
                }
                cache.entries[resource.url]?.push(indexEntry);
                count++;
            } catch {
                // Skip files that can't be parsed
            }
        }
    } catch {
        // Silently ignore directory scan errors
    }
    return count;
};

const CORE_PACKAGE_PATTERN = /^hl7\.fhir\.r\d+\.core$/;

const isCorePackage = (name: string): boolean => CORE_PACKAGE_PATTERN.test(name);

const hasCorePackageDependency = (dependencies: Record<string, string> | undefined): boolean => {
    if (!dependencies) return false;
    return Object.keys(dependencies).some(isCorePackage);
};

/**
 * Load a package into cache. Always registers. Scans resources if possible.
 * Returns a warning string if there's something to warn about, undefined otherwise.
 */
export const loadPackage = async (
    packagePath: string,
    cache: ExtendedCache,
    preprocessPackage?: (context: PreprocessPackageContext) => PreprocessPackageContext,
): Promise<string | undefined> => {
    const packageJsonPath = path.join(packagePath, "package.json");
    if (!(await fileExists(packageJsonPath))) return undefined;

    let packageJson: PackageJson;
    try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        let parsed = JSON.parse(content);
        if (preprocessPackage) {
            parsed = preprocessPackage({ packageJson: parsed }).packageJson;
        }
        packageJson = parsed as PackageJson;
    } catch {
        return undefined;
    }

    // Always register
    cache.packages[packageJson.name] = {
        id: { name: packageJson.name, version: packageJson.version },
        path: packagePath,
        canonical: packageJson.canonical,
        fhirVersions: packageJson.fhirVersions,
        packageJson: packageJson as unknown as Record<string, unknown>,
    };

    const hasIndex = await fileExists(path.join(packagePath, ".index.json"));
    const hasFhirVersions = Array.isArray(packageJson.fhirVersions) && packageJson.fhirVersions.length > 0;
    const hasCoreDep = isCorePackage(packageJson.name) || hasCorePackageDependency(packageJson.dependencies);

    let resourceCount = 0;
    if (hasIndex) {
        await processIndex(packagePath, packageJson, cache);
        const examplesPath = path.join(packagePath, "examples");
        if (await fileExists(path.join(examplesPath, ".index.json"))) {
            await processIndex(examplesPath, packageJson, cache);
        }
        resourceCount = 1; // Has index, assume it has resources
    } else {
        resourceCount = await scanDirectoryForResources(packagePath, packageJson, cache);
        if (resourceCount > 0) {
            console.warn(`Warning: index generated for ${packageJson.name} (${resourceCount} resources)`);
        }
    }

    // No resources = not a FHIR package, no warning needed
    if (resourceCount === 0) return undefined;

    // Collect issues
    const issues: string[] = [];
    if (!hasIndex) issues.push("no .index.json");
    if (!hasFhirVersions) issues.push("no fhirVersions");
    if (!hasCoreDep) issues.push("no core dependency");

    if (issues.length === 0) return undefined;
    return `${packageJson.name}: ${issues.join(", ")}`;
};
