import { applyIndexEntryPatches, type CanonicalIndex, type IndexReference } from "../core/index-patch.js";
import { createCanonicalQuery, filterEntryCandidates, type ResolveOptions } from "../core/query.js";
import { applyPatches } from "../patches.js";
import type {
    CanonicalManager,
    Config as NodeConfig,
    PackageId,
    PackageJson,
    Patches,
    Reference,
    ReportEntry,
    Resource,
    SourceContext,
} from "../types/index.js";
import { type Cache, createMemoryCache } from "./cache.js";
import type { Fetch } from "./fetch.js";
import { dependencyLevels, type PackageNode, restoreGraph } from "./graph.js";
import { cachePrefix, normalizeRegistry, parsePackageSpec } from "./package-spec.js";
import { notifyProgress } from "./progress.js";
import type { ArchiveLimits, Progress } from "./protocol.js";
import { createWorkerClient, type WorkerClient } from "./worker-client.js";

export interface Config extends Omit<NodeConfig, "workingDir" | "packageManager"> {
    cache?: Cache;
    fetch?: Fetch;
    archiveLimits?: ArchiveLimits;
    signal?: AbortSignal;
    requestTimeoutMs?: number;
    graphTimeoutMs?: number;
    /** Initialization/addition progress. Callback failures never interrupt preparation. */
    onProgress?: (progress: Progress) => void | Promise<void>;
}

interface Metadata extends IndexReference {
    node: PackageNode;
    filename: string;
}

interface State {
    graph: ReturnType<typeof restoreGraph>;
    client: WorkerClient;
    index: CanonicalIndex<Metadata>;
    references: Record<string, Metadata>;
}

export function createCanonicalManager(config: Config): CanonicalManager {
    const specs = [...config.packages];
    if (
        config.graphTimeoutMs !== undefined &&
        (!Number.isSafeInteger(config.graphTimeoutMs) || config.graphTimeoutMs < 1)
    )
        throw new Error("graphTimeoutMs must be a positive integer");
    specs.forEach(parsePackageSpec);
    const registry = normalizeRegistry(config.registry);
    const cache = config.cache ?? createMemoryCache();
    if (
        config.requestTimeoutMs !== undefined &&
        (!Number.isSafeInteger(config.requestTimeoutMs) || config.requestTimeoutMs < 1)
    )
        throw new Error("requestTimeoutMs must be a positive integer");
    const patches: Patches = {
        packageJson: [...(config.patches?.packageJson ?? [])],
        indexEntry: [...(config.patches?.indexEntry ?? [])],
        fhirResource: [...(config.patches?.fhirResource ?? [])],
    };
    if (config.preprocessPackage) {
        const legacy = config.preprocessPackage;
        patches.packageJson.push((pkg, packageJson) => {
            const result = legacy({ kind: "package", package: pkg, packageJson });
            return result.kind === "package" ? result.packageJson : undefined;
        });
        patches.fhirResource.push((pkg, resource) => {
            const result = legacy({ kind: "resource", package: pkg, resource });
            return result.kind === "resource" ? result.resource : undefined;
        });
    }
    if (config.packageIndex !== undefined && config.ignorePackageIndex !== undefined) {
        throw new Error("Cannot set both packageIndex and ignorePackageIndex. Use packageIndex only.");
    }
    const mode = config.packageIndex ?? (config.ignorePackageIndex ? "regenerate" : "use");
    let state: State | undefined;
    let activeOperation: AbortController | undefined;
    const clients = new Set<WorkerClient>();
    let generation = 0;
    let reports: ReportEntry[] = [];
    let reportKeys = new Set<string>();
    let pending: Promise<unknown> = Promise.resolve();
    function serialize<T>(operation: () => Promise<T>): Promise<T> {
        const next = pending.then(operation, operation);
        pending = next.catch(() => undefined);
        return next;
    }
    function initialized(): State {
        if (!state) throw new Error("CanonicalManager not initialized. Call init() first.");
        return state;
    }
    function report(entry: ReportEntry): void {
        const key = JSON.stringify(entry);
        if (!reportKeys.has(key)) {
            reportKeys.add(key);
            reports.push(entry);
        }
    }

    async function runOperation<T>(
        expectedGeneration: number,
        operation: (signal: AbortSignal) => Promise<T>,
        callerSignal?: AbortSignal,
    ): Promise<T> {
        if (expectedGeneration !== generation) throw new Error("Manager operation cancelled by destroy");
        const controller = new AbortController();
        activeOperation = controller;
        const signal = AbortSignal.any([
            controller.signal,
            ...(callerSignal ? [callerSignal] : []),
            AbortSignal.timeout(config.graphTimeoutMs ?? 180_000),
        ]);
        try {
            signal.throwIfAborted();
            return await operation(signal);
        } finally {
            if (activeOperation === controller) activeOperation = undefined;
            controller.abort();
        }
    }
    function releaseState(): void {
        for (const client of clients) client.close();
        state = undefined;
        reports = [];
        reportKeys.clear();
        query.clearSearchParameterCache();
    }

    async function build(expectedGeneration: number): Promise<Record<string, PackageId>> {
        return runOperation(
            expectedGeneration,
            async (signal) => {
                const nextReports: ReportEntry[] = [];
                const nextKeys = new Set<string>();
                const reportNext = (entry: ReportEntry) => {
                    const key = JSON.stringify(entry);
                    if (!nextKeys.has(key)) {
                        nextKeys.add(key);
                        nextReports.push(entry);
                    }
                };
                if (config.dropCache) {
                    notifyProgress(config.onProgress, { phase: "cache", action: "clear", done: false }, signal);
                    signal.throwIfAborted();
                    await awaitCancellation(cache.clear(cachePrefix(registry)), signal);
                    notifyProgress(config.onProgress, { phase: "cache", action: "clear", done: true }, signal);
                }
                signal.throwIfAborted();
                const nextClient: WorkerClient = createWorkerClient(
                    {
                        cache,
                        fetch: config.fetch,
                        requestTimeoutMs: config.requestTimeoutMs,
                        onProgress: config.onProgress,
                        onClose: () => {
                            clients.delete(nextClient);
                        },
                        ...(patches.packageJson.length
                            ? {
                                  patchManifest({ pkg, manifest }: { pkg: PackageId; manifest: PackageJson }) {
                                      const entries: ReportEntry[] = [];
                                      return {
                                          manifest:
                                              (applyPatches(patches.packageJson, pkg, manifest, (entry) =>
                                                  entries.push(entry),
                                              ) as PackageJson | null) ?? manifest,
                                          reports: entries,
                                      };
                                  },
                              }
                            : {}),
                    },
                    signal,
                );
                clients.add(nextClient);
                try {
                    const snapshot = await nextClient.prepare({
                        specs,
                        registry,
                        archiveLimits: config.archiveLimits,
                        requestTimeoutMs: config.requestTimeoutMs,
                        graphTimeoutMs: config.graphTimeoutMs,
                        mode,
                        deprecatedIndexOption: config.ignorePackageIndex !== undefined,
                    });
                    for (const entry of snapshot.reports) reportNext(entry);
                    const graph = restoreGraph(snapshot);
                    const locations = new Map(graph.nodes.map((node) => [node.scope, node]));
                    const references: Record<string, Metadata> = Object.create(null);
                    for (const [id, metadata] of Object.entries(snapshot.references)) {
                        const node = locations.get(metadata.scope);
                        if (!node) throw new Error(`Invalid FHIR snapshot reference location ${metadata.scope}`);
                        references[id] = { ...metadata, node };
                    }
                    const index: CanonicalIndex<Metadata> = {
                        entries: snapshot.entries,
                        referenceManager: {
                            getAllReferences: () => references,
                            clear() {
                                for (const id of Object.keys(references)) delete references[id];
                            },
                            set(id, metadata) {
                                references[id] = metadata;
                            },
                        },
                    };
                    // Arbitrary closures stay in their caller's realm; the raw index is already built.
                    applyIndexEntryPatches(index, patches.indexEntry, reportNext);
                    signal.throwIfAborted();
                    notifyProgress(config.onProgress, { phase: "cache", action: "commit", done: false }, signal);
                    signal.throwIfAborted();
                    await nextClient.commit();
                    notifyProgress(config.onProgress, { phase: "cache", action: "commit", done: true }, signal);
                    signal.throwIfAborted();
                    const previous = state;
                    state = { graph, index, references, client: nextClient };
                    reports = nextReports;
                    reportKeys = nextKeys;
                    query.clearSearchParameterCache();
                    previous?.client.retire();
                    if (config.onProgress)
                        notifyProgress(
                            config.onProgress,
                            {
                                phase: "ready",
                                packages: new Set(
                                    graph.nodes.map((node) => JSON.stringify([node.pkg.name, node.pkg.version])),
                                ).size,
                                resources: Object.values(index.entries).reduce(
                                    (count, entries) => count + entries.length,
                                    0,
                                ),
                            },
                            signal,
                        );
                    return graph.installed;
                } catch (error) {
                    nextClient.close(error instanceof Error ? error : new Error(String(error)));
                    throw error;
                }
            },
            config.signal,
        );
    }

    const read = async (reference: Reference): Promise<Resource> => {
        const active = initialized();
        const metadata = active.references[reference.id];
        if (!metadata) throw new Error(`Invalid reference ID: ${reference.id}`);
        try {
            const resource = {
                ...(await active.client.read(metadata.node.scope, metadata.filename, reference.id)),
                resourceType: reference.resourceType,
            };
            return applyPatches(patches.fhirResource, metadata.node.pkg, resource, report) ?? resource;
        } catch (error) {
            throw new Error(`Failed to read resource: ${error}`);
        }
    };

    function contextNode(context: SourceContext): PackageNode | undefined {
        const active = initialized();
        if (context.id) {
            const metadata = active.references[context.id];
            if (!metadata) throw new Error(`Invalid source context ID: ${context.id}`);
            return metadata.node;
        }
        let nodes: PackageNode[];
        if (context.package) {
            const pkg = context.package;
            nodes = active.graph.nodes.filter((node) => node.pkg.name === pkg.name && node.pkg.version === pkg.version);
        } else if (context.url) {
            nodes = (active.index.entries[context.url] ?? [])
                .map((entry) => active.references[entry.id]?.node)
                .filter((node): node is PackageNode => node !== undefined);
        } else if (context.path) {
            nodes = Object.values(active.references)
                .filter((metadata) => metadata.filename === context.path)
                .map((metadata) => metadata.node);
        } else {
            return undefined;
        }
        const unique = [...new Set(nodes)];
        if (unique.length !== 1)
            throw new Error("Source context is missing or ambiguous; use the resolved resource's id.");
        return unique[0];
    }

    const query = createCanonicalQuery({
        async findEntriesByUrl(url) {
            return initialized().index.entries[url] ?? [];
        },
        async findEntries(params) {
            const index = initialized().index;
            const entries = params.url ? (index.entries[params.url] ?? []) : Object.values(index.entries).flat();
            return filterEntryCandidates(entries, params);
        },
        read,
        async resolveWithContext(url, context, _resolveEntry, options) {
            const node = contextNode(context);
            if (!node) return null;
            const active = initialized();
            const candidates = active.index.entries[url] ?? [];
            for (const level of dependencyLevels(node)) {
                for (const dependency of level) {
                    const entry = candidates.find(
                        (candidate) =>
                            active.references[candidate.id]?.node === dependency &&
                            (!options?.package || candidate.package?.name === options.package) &&
                            (!options?.version || candidate.version === options.version),
                    );
                    if (entry) return entry;
                }
            }
            throw new Error(`Cannot resolve canonical URL: ${url} from ${node.pkg.name}@${node.pkg.version}`);
        },
    });

    function resolveOptions(url: string, options?: ResolveOptions): [string, ResolveOptions | undefined] {
        const separator = url.indexOf("|");
        if (separator < 0) return [url, options];
        const version = url.slice(separator + 1);
        if (!version || (options?.version && options.version !== version))
            throw new Error("Invalid or conflicting canonical resource version");
        return [url.slice(0, separator), { ...options, version }];
    }

    return {
        init: () => {
            const requested = generation;
            return serialize(() => build(requested));
        },
        destroy: () => {
            generation++;
            const reason = new Error("Manager operation cancelled by destroy");
            activeOperation?.abort(reason);
            // Resource ownership ends immediately, even while a custom callback is unresolved.
            releaseState();
            return serialize(async () => {});
        },
        async packages() {
            const packages = initialized().graph.nodes.map((node) => node.pkg);
            return [...new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, { ...pkg }])).values()];
        },
        addPackages: (...added) => {
            const requested = generation;
            return serialize(async () => {
                added.forEach(parsePackageSpec);
                const previous = specs.length;
                for (const spec of added) if (!specs.includes(spec)) specs.push(spec);
                try {
                    return await build(requested);
                } catch (error) {
                    specs.splice(previous);
                    throw error;
                }
            });
        },
        async addLocalPackage() {
            throw new Error("Filesystem paths are unavailable in the browser entry point");
        },
        async addTgzPackage() {
            throw new Error("Filesystem paths are unavailable in the browser entry point");
        },
        flushCache: () => {
            const requested = generation;
            return serialize(() =>
                runOperation(requested, async (signal) => {
                    await awaitCancellation(cache.clear(cachePrefix(registry)), signal);
                    signal.throwIfAborted();
                    releaseState();
                }),
            );
        },
        resolveEntry: async (url, options) => query.resolveEntry(...resolveOptions(url, options)),
        resolve: async (url, options) => query.resolve(...resolveOptions(url, options)),
        read,
        searchEntries: query.searchEntries,
        search: query.search,
        smartSearch: query.smartSearch,
        getSearchParametersForResource: query.getSearchParametersForResource,
        async packageJson(name) {
            const node = initialized().graph.nodes.find((candidate) => candidate.pkg.name === name);
            if (!node) throw new Error(`Package ${name} not found`);
            return structuredClone(node.packageJson);
        },
        report: () => [...reports],
    };
}

/** Cancellation stops waiting; a custom callback's eventual side effects remain its own. */
function awaitCancellation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
        const cleanup = () => signal.removeEventListener("abort", abort);
        const abort = () => {
            cleanup();
            reject(signal.reason);
        };
        signal.addEventListener("abort", abort, { once: true });
        operation.then(
            (value) => {
                cleanup();
                if (signal.aborted) reject(signal.reason);
                else resolve(value);
            },
            (error) => {
                cleanup();
                reject(error);
            },
        );
        if (signal.aborted) abort();
    });
}
