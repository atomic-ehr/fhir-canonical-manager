/** Node directory adapter for shared resource collection and index commitment. */
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import {
    type CollectedResource,
    collectFromSource,
    collectFromIndex as collectSourceIndex,
    type IndexLoadResult,
} from "../core/resource-index.js";
import type { IndexEntry, PackageJson } from "../types/index.js";
import { createDirectoryResourceSource } from "./source.js";

export type CollectedEntry = Omit<CollectedResource, "filename"> & { filePath: string };
export type { IndexLoadResult } from "../core/resource-index.js";

function locateEntries(basePath: string, entries: CollectedResource[]): CollectedEntry[] {
    return entries.map(({ filename, ...entry }) => ({ filePath: path.join(basePath, filename), ...entry }));
}

export async function collectFromIndex(
    basePath: string,
): Promise<{ result: IndexLoadResult; entries: CollectedEntry[] }> {
    const { result, entries } = await collectSourceIndex(createDirectoryResourceSource(basePath));
    return { result, entries: locateEntries(basePath, entries) };
}

export async function collectFromDirectory(dirPath: string): Promise<CollectedEntry[]> {
    return locateEntries(dirPath, await collectFromSource(createDirectoryResourceSource(dirPath)));
}

/**
 * Commit collected entries into the cache (reference manager + entry index). Returns the
 * committed count — what was indexed, not what a manager resolves: the index is raw, and
 * `indexEntry` patches run per manager in `applyIndexEntryPatches`.
 */
export const commitEntries = (cache: ExtendedCache, packageJson: PackageJson, entries: CollectedEntry[]): number => {
    const pkg = { name: packageJson.name, version: packageJson.version };
    let committed = 0;
    for (const entry of entries) {
        const id = cache.referenceManager.generateId({
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            filePath: entry.filePath,
        });

        const indexEntry: IndexEntry = {
            id,
            resourceType: entry.resourceType,
            indexVersion: entry.indexVersion,
            url: entry.url,
            version: entry.version,
            kind: entry.kind,
            type: entry.type,
            package: pkg,
        };

        // A url-less entry can't be resolved by canonical URL, so skip the whole commit
        // rather than register/count an entry absent from the url index.
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
