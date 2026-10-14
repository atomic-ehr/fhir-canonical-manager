import type { IndexFileEntry } from "../types/index.js";
import { parseIndex } from "./index-file.js";

/** Names are relative to one resource source; the adapter decides how to access its bytes. */
export interface ResourceSource {
    read(filename: string): Promise<string>;
    has(filename: string): Promise<boolean>;
    /** Immediate regular files, in source order; nested sources are scanned separately. */
    listFiles(): Promise<string[]>;
}

export type CollectedResource = Omit<IndexFileEntry, "id"> & { url: string; indexVersion: number };
export type IndexLoadResult = { ok: true; count: number } | { ok: false; reason: "unparseable" | "missing-files" };

export async function collectFromIndex(
    source: ResourceSource,
): Promise<{ result: IndexLoadResult; entries: CollectedResource[] }> {
    let content: string;
    try {
        content = await source.read(".index.json");
    } catch {
        return { result: { ok: false, reason: "unparseable" }, entries: [] };
    }
    const index = parseIndex(content, ".index.json");
    if (!index) return { result: { ok: false, reason: "unparseable" }, entries: [] };

    const entries: CollectedResource[] = [];
    let missingCount = 0;
    for (const file of index.files) {
        if (!file.url) continue;
        if (!(await source.has(file.filename))) {
            missingCount++;
            continue;
        }
        entries.push({
            filename: file.filename,
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
}

export async function collectFromSource(source: ResourceSource): Promise<CollectedResource[]> {
    const entries: CollectedResource[] = [];
    try {
        for (const filename of await source.listFiles()) {
            if (!filename.endsWith(".json") || filename === "package.json" || filename === ".index.json") continue;
            try {
                const resource = JSON.parse(await source.read(filename));
                if (!resource.resourceType || !resource.url) continue;
                entries.push({
                    filename,
                    resourceType: resource.resourceType,
                    url: resource.url,
                    version: resource.version,
                    kind: resource.kind,
                    type: resource.type,
                    indexVersion: 0,
                });
            } catch {
                // Skip individual resources that cannot be read or parsed.
            }
        }
    } catch {
        // Preserve the scanner's tolerance of unavailable sources.
    }
    return entries;
}
