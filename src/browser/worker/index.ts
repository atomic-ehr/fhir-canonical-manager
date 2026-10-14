import {
    type CollectedResource,
    collectFromIndex,
    collectFromSource,
    type ResourceSource,
} from "../../core/resource-index.js";
import type { IndexEntry, ReportEntry } from "../../types/index.js";
import type { PrepareOptions, Progress, ReferenceMetadata, Snapshot } from "../protocol.js";
import type { installGraph } from "./graph.js";

export async function buildIndex(
    graph: Awaited<ReturnType<typeof installGraph>>,
    options: PrepareOptions,
    progress?: (event: Progress) => void,
): Promise<Snapshot> {
    let resources = 0;
    progress?.({ phase: "index", resources, done: false });
    const reports: ReportEntry[] = [];
    if (options.deprecatedIndexOption)
        reports.push({ kind: "deprecation", message: "ignorePackageIndex is deprecated; use packageIndex instead." });
    const entries: Record<string, IndexEntry[]> = Object.create(null);
    const references: Record<string, ReferenceMetadata> = Object.create(null);
    for (const node of graph.nodes) reports.push(...node.reports);
    for (const node of graph.nodes) {
        const source = resourceSource(node.files);
        let collected: CollectedResource[];
        if (options.mode === "regenerate" || !(await source.has(".index.json")))
            collected = await collectFromSource(source);
        else {
            const loaded = await collectFromIndex(source);
            collected = loaded.entries;
            if (!loaded.result.ok && options.mode === "recover") {
                collected = await collectFromSource(source);
                reports.push({
                    kind: "index-recovery",
                    package: node.pkg,
                    reason: loaded.result.reason,
                    recovered: collected.length,
                });
            } else if (loaded.result.ok && Object.hasOwn(node.files, "examples/.index.json")) {
                const examples = await collectFromIndex(resourceSource(node.files, "examples/"));
                collected.push(
                    ...examples.entries.map((entry) => ({ ...entry, filename: `examples/${entry.filename}` })),
                );
            }
        }
        for (const entry of collected) {
            const id = await referenceId(options.registry, node.scope, entry.filename);
            const record: IndexEntry = {
                id,
                resourceType: entry.resourceType,
                indexVersion: entry.indexVersion,
                url: entry.url,
                version: entry.version,
                kind: entry.kind,
                type: entry.type,
                package: node.pkg,
            };
            (entries[entry.url] ??= []).push(record);
            if (++resources % 128 === 0) progress?.({ phase: "index", resources, done: false });
            references[id] = {
                packageName: node.pkg.name,
                packageVersion: node.pkg.version,
                resourceType: entry.resourceType,
                url: entry.url,
                version: entry.version,
                scope: node.scope,
                filename: entry.filename,
            };
        }
    }
    progress?.({ phase: "index", resources, done: true });
    return {
        entries,
        references,
        reports,
        nodes: graph.nodes.map((node) => ({
            scope: node.scope,
            pkg: node.pkg,
            transport: node.transport,
            packageJson: node.packageJson,
            linkTarget: node.linkTarget?.scope,
            dependencies: [...node.dependencies].map(([name, target]) => ({ name, target: target.scope })),
        })),
        roots: graph.roots.map((node) => node.scope),
        installed: graph.installed,
    };
}

function resourceSource(files: Record<string, string>, prefix = ""): ResourceSource {
    return {
        async read(filename) {
            const key = prefix + filename;
            if (!Object.hasOwn(files, key)) throw new Error(`Missing package resource: ${key}`);
            return files[key] as string;
        },
        async has(filename) {
            return Object.hasOwn(files, prefix + filename);
        },
        async listFiles() {
            return Object.keys(files)
                .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes("/"))
                .map((name) => name.slice(prefix.length));
        },
    };
}
async function referenceId(registry: string, scope: string, filename: string): Promise<string> {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify([registry, scope, filename])),
    );
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}
