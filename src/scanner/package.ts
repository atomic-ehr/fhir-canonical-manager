/**
 * Package scanning functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import { applyPatches } from "../patches.js";
import type { PackageIndexMode, PackageJson, Patches, PatchReportSink } from "../types/index.js";
import { collectFromDirectory, collectFromIndex, commitEntries } from "./processor.js";

const CORE_PACKAGE_PATTERN = /^hl7\.fhir\.r\d+\.core$/;

const isCorePackage = (name: string): boolean => CORE_PACKAGE_PATTERN.test(name);

const hasCorePackageDependency = (dependencies: Record<string, string> | undefined): boolean => {
    if (!dependencies) return false;
    return Object.keys(dependencies).some(isCorePackage);
};

/** Options for scanning a package into the cache. The mode and composed patches are resolved by the caller. */
export type ScanOptions = {
    packageIndexMode: PackageIndexMode;
    /** Composed patches (transforms + exclusions), applied at the package, entry, and resource phases. */
    patches: Patches;
    /** Diagnostics sink for patch/recovery/exclusion reasons. */
    report: PatchReportSink;
};

/**
 * Load a package's resources into the cache: use the shipped index, scan the directory,
 * or recover (scan when the index is corrupt). Returns the committed count and whether
 * the shipped index was used (drives the "no .index.json" diagnostic). `patches` runs at the
 * entry phase per candidate (a `null` return excludes it).
 */
const loadResources = async (
    packagePath: string,
    packageJson: PackageJson,
    cache: ExtendedCache,
    mode: PackageIndexMode,
    patches: Patches,
    report: PatchReportSink,
): Promise<{ count: number; usedIndex: boolean }> => {
    const pkgId = `${packageJson.name}@${packageJson.version}`;

    // No usable shipped index → scan the directory.
    if (mode === "regenerate" || !(await fileExists(path.join(packagePath, ".index.json")))) {
        const count = commitEntries(cache, packageJson, await collectFromDirectory(packagePath), patches, report);
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
            const count = commitEntries(cache, packageJson, await collectFromDirectory(packagePath), patches, report);
            report({
                kind: "index-recovery",
                package: { name: packageJson.name, version: packageJson.version },
                reason: result.reason,
                recovered: count,
            });
            return { count, usedIndex: false };
        }
        const count = commitEntries(cache, packageJson, entries, patches, report);
        console.warn(
            `Warning: ${pkgId} .index.json is ${result.reason}; loaded ${count} resource(s). ` +
                `Set packageIndex: "recover" to fall back to a directory scan.`,
        );
        return { count, usedIndex: true };
    }

    // Usable shipped index (plus any examples index).
    let count = commitEntries(cache, packageJson, entries, patches, report);
    const examplesPath = path.join(packagePath, "examples");
    if (await fileExists(path.join(examplesPath, ".index.json"))) {
        count += commitEntries(cache, packageJson, (await collectFromIndex(examplesPath)).entries, patches, report);
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
    const { packageIndexMode: mode, patches, report } = options;

    const packageJsonPath = path.join(packagePath, "package.json");
    if (!(await fileExists(packageJsonPath))) return undefined;

    let packageJson: PackageJson;
    try {
        const content = await fs.readFile(packageJsonPath, "utf-8");
        let parsed = JSON.parse(content);
        const result = applyPatches(
            patches.packageJson,
            { name: parsed.name, version: parsed.version },
            parsed,
            report,
        );
        if (result) parsed = result;
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

    const { count, usedIndex } = await loadResources(packagePath, packageJson, cache, mode, patches, report);

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
