/**
 * Package scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import type { IndexEntry, PackageIndexMode, PackageJson, PreprocessContext } from "../types/index.js";
import { collectFromIndex, commitEntries } from "./processor.js";

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

/** Options for scanning a package into the cache. The mode is resolved by the caller. */
export type ScanOptions = {
    packageIndexMode: PackageIndexMode;
    preprocessPackage: (context: PreprocessContext) => PreprocessContext;
};

/**
 * Load a package's resources into the cache: use the shipped index, scan the directory,
 * or recover (scan when the index is corrupt). Returns the committed count and whether
 * the shipped index was used (drives the "no .index.json" diagnostic).
 */
const loadResources = async (
    packagePath: string,
    packageJson: PackageJson,
    cache: ExtendedCache,
    mode: PackageIndexMode,
): Promise<{ count: number; usedIndex: boolean }> => {
    const pkgId = `${packageJson.name}@${packageJson.version}`;

    // No usable shipped index → scan the directory.
    if (mode === "regenerate" || !(await fileExists(path.join(packagePath, ".index.json")))) {
        const count = await scanDirectoryForResources(packagePath, packageJson, cache);
        if (count > 0) {
            console.warn(`Warning: index generated for ${packageJson.name} (${count} resources)`);
        }
        return { count, usedIndex: false };
    }

    const { result, entries } = await collectFromIndex(packagePath);

    // Corrupt index: "recover" scans the directory; "use" keeps the partial set and warns.
    if (!result.ok) {
        if (mode === "recover") {
            console.warn(`Recovered ${pkgId}: .index.json is ${result.reason}; scanning directory instead.`);
            return { count: await scanDirectoryForResources(packagePath, packageJson, cache), usedIndex: false };
        }
        const count = commitEntries(cache, packageJson, entries);
        console.warn(
            `Warning: ${pkgId} .index.json is ${result.reason}; loaded ${count} resource(s). ` +
                `Set packageIndex: "recover" to fall back to a directory scan.`,
        );
        return { count, usedIndex: true };
    }

    // Usable shipped index (plus any examples index).
    let count = commitEntries(cache, packageJson, entries);
    const examplesPath = path.join(packagePath, "examples");
    if (await fileExists(path.join(examplesPath, ".index.json"))) {
        count += commitEntries(cache, packageJson, (await collectFromIndex(examplesPath)).entries);
    }
    return { count, usedIndex: true };
};

/**
 * Load a package into cache. Always registers. Scans resources if possible.
 * Returns a warning string if there's something to warn about, undefined otherwise.
 */
export const loadPackage = async (
    packagePath: string,
    cache: ExtendedCache,
    options: ScanOptions,
): Promise<string | undefined> => {
    const { packageIndexMode: mode, preprocessPackage } = options;

    const packageJsonPath = path.join(packagePath, "package.json");
    if (!(await fileExists(packageJsonPath))) return undefined;

    let packageJson: PackageJson;
    try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        let parsed = JSON.parse(content);
        const result = preprocessPackage({
            kind: "package",
            packageJson: parsed,
            package: { name: parsed.name, version: parsed.version },
        });
        if (result.kind === "package") parsed = result.packageJson;
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
        packageJson,
    };

    const { count, usedIndex } = await loadResources(packagePath, packageJson, cache, mode);

    // No resources = not a FHIR package, no warning needed
    if (count === 0) return undefined;

    // Collect issues
    const hasFhirVersions = Array.isArray(packageJson.fhirVersions) && packageJson.fhirVersions.length > 0;
    const hasCoreDep = isCorePackage(packageJson.name) || hasCorePackageDependency(packageJson.dependencies);
    const issues: string[] = [];
    if (!usedIndex) issues.push("no .index.json");
    if (!hasFhirVersions) issues.push("no fhirVersions");
    if (!hasCoreDep) issues.push("no core dependency");

    if (issues.length === 0) return undefined;
    return `${packageJson.name}: ${issues.join(", ")}`;
};
