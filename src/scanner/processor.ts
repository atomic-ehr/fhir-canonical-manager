/**
 * Index processing functionality
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtendedCache } from "../cache.js";
import { fileExists } from "../fs/index.js";
import type { IndexEntry, PackageJson } from "../types/index.js";
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

/** Commit collected entries into the cache (reference manager + entry index). Returns the count. */
export const commitEntries = (cache: ExtendedCache, packageJson: PackageJson, entries: CollectedEntry[]): number => {
    for (const entry of entries) {
        const id = cache.referenceManager.generateId({
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            filePath: entry.filePath,
        });

        cache.referenceManager.set(id, {
            packageName: packageJson.name,
            packageVersion: packageJson.version,
            filePath: entry.filePath,
            resourceType: entry.resourceType,
            url: entry.url,
            version: entry.version,
        });

        const indexEntry: IndexEntry = {
            id,
            resourceType: entry.resourceType,
            indexVersion: entry.indexVersion,
            url: entry.url,
            version: entry.version,
            kind: entry.kind,
            type: entry.type,
            package: { name: packageJson.name, version: packageJson.version },
        };

        if (!cache.entries[entry.url]) {
            cache.entries[entry.url] = [];
        }
        cache.entries[entry.url]?.push(indexEntry);
    }
    return entries.length;
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
