/**
 * Index processing functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import { applyPatches } from "../patches.js";
import type { IndexEntry, PackageJson, Patches, PatchReportSink } from "../types/index.js";
import { parseIndex } from "./parser.js";

/** A resource discovered from an index or directory scan, not yet committed to the cache. */
export type CollectedEntry = {
    filePath: string;
    resourceType: string;
    url: string;
    version?: string;
    kind?: string;
    type?: string;
    indexVersion: number;
};

/** Outcome of reading a `.index.json`. `count` may be 0 for a legitimately resource-free index. */
export type IndexLoadResult = { ok: true; count: number } | { ok: false; reason: "unparseable" | "missing-files" };

/**
 * Read and validate a package `.index.json`, collecting entries **without** mutating the
 * cache. On `"missing-files"` the partial (resolvable) set is still returned, so callers
 * can choose to commit it (`"use"`) or discard it and fall back to a scan (`"recover"`).
 */
export const collectFromIndex = async (
    basePath: string,
): Promise<{ result: IndexLoadResult; entries: CollectedEntry[] }> => {
    const indexPath = path.join(basePath, ".index.json");

    let indexContent: string;
    try {
        indexContent = await fs.readFile(indexPath, "utf-8");
    } catch {
        return { result: { ok: false, reason: "unparseable" }, entries: [] };
    }

    const index = parseIndex(indexContent, indexPath);
    if (!index) return { result: { ok: false, reason: "unparseable" }, entries: [] };

    const entries: CollectedEntry[] = [];
    let missingCount = 0;
    for (const file of index.files) {
        if (!file.url) continue;

        const filePath = path.join(basePath, file.filename);
        if (!(await fileExists(filePath))) {
            missingCount++;
            continue;
        }

        entries.push({
            filePath,
            resourceType: file.resourceType,
            url: file.url,
            version: file.version,
            kind: file.kind,
            type: file.type,
            indexVersion: index["index-version"],
        });
    }

    if (missingCount > 0) return { result: { ok: false, reason: "missing-files" }, entries };
    return { result: { ok: true, count: entries.length }, entries };
};

/**
 * Read FHIR resources directly from a directory (no `.index.json`), collecting entries
 * **without** mutating the cache. Files without `resourceType`/`url` or that fail to
 * parse are skipped.
 */
export const collectFromDirectory = async (dirPath: string): Promise<CollectedEntry[]> => {
    const entries: CollectedEntry[] = [];

    try {
        const dirents = await fs.readdir(dirPath, { withFileTypes: true });
        for (const dirent of dirents) {
            if (!dirent.isFile() || !dirent.name.endsWith(".json")) continue;
            if (dirent.name === "package.json" || dirent.name === ".index.json") continue;

            const filePath = path.join(dirPath, dirent.name);
            try {
                const resource = JSON.parse(await fs.readFile(filePath, "utf-8"));
                if (!resource.resourceType || !resource.url) continue;
                entries.push({
                    filePath,
                    resourceType: resource.resourceType,
                    url: resource.url,
                    version: resource.version,
                    kind: resource.kind,
                    type: resource.type,
                    indexVersion: 0,
                });
            } catch {
                // Skip files that can't be parsed
            }
        }
    } catch {
        // Silently ignore directory scan errors
    }

    return entries;
};

/**
 * Commit collected entries into the cache (reference manager + entry index). Returns the
 * committed count. When `patches` is provided, it runs at the entry phase per candidate:
 * a `null` return excludes the canonical (never registered or indexed), and a returned
 * `entry` context replaces the index metadata that gets committed.
 */
export const commitEntries = (
    cache: ExtendedCache,
    packageJson: PackageJson,
    entries: CollectedEntry[],
    patches?: Patches,
    report?: PatchReportSink,
): number => {
    const pkg = { name: packageJson.name, version: packageJson.version };
    let committed = 0;
    for (const entry of entries) {
        const id = cache.referenceManager.generateId({
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            filePath: entry.filePath,
        });

        let indexEntry: IndexEntry = {
            id,
            resourceType: entry.resourceType,
            indexVersion: entry.indexVersion,
            url: entry.url,
            version: entry.version,
            kind: entry.kind,
            type: entry.type,
            package: pkg,
        };

        if (patches?.entry.length && report) {
            const result = applyPatches(patches.entry, pkg, indexEntry, report);
            if (result === null) continue; // excluded — never registered or indexed
            indexEntry = result;
        }

        // A url-less entry can't be resolved by canonical URL; if a transform cleared `url`,
        // skip the whole commit so we never register/count an entry absent from the url index.
        const url = indexEntry.url;
        if (!url) continue;

        cache.referenceManager.set(id, {
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            filePath: entry.filePath,
            resourceType: indexEntry.resourceType,
            url,
            version: indexEntry.version,
        });

        if (!cache.entries[url]) cache.entries[url] = [];
        cache.entries[url]?.push(indexEntry);
        committed++;
    }
    return committed;
};

/**
 * Committing wrapper over `collectFromIndex` — reads the index and commits its entries,
 * warning on partial corruption (files referenced but missing on disk).
 */
export const processIndex = async (basePath: string, packageJson: PackageJson, cache: ExtendedCache): Promise<void> => {
    const { result, entries } = await collectFromIndex(basePath);
    commitEntries(cache, packageJson, entries);
    if (!result.ok && result.reason === "missing-files") {
        console.warn(
            `Warning: ${packageJson.name}@${packageJson.version} .index.json references file(s) not found on disk — index may be corrupt`,
        );
    }
};
