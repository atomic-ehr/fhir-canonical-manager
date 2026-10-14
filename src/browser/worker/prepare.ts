import type { Cache } from "../cache.js";
import type { HostMethods, PrepareOptions, WorkerMethods } from "../protocol.js";
import type { createRpc } from "../rpc.js";
import { customFetch } from "./custom-fetch.js";
import { installGraph } from "./graph.js";
import { buildIndex } from "./index.js";
import { createProgress } from "./progress.js";
import { createRegistry } from "./registry.js";

export async function preparePackages(
    options: PrepareOptions,
    rpc: ReturnType<typeof createRpc<HostMethods, WorkerMethods>>,
) {
    const signal = AbortSignal.timeout(options.graphTimeoutMs ?? 180_000);
    const progress = options.progress
        ? createProgress((updates) => postMessage({ type: "progress", updates }), signal)
        : undefined;
    const cache: Cache = {
        get: <T>(key: string) => rpc.call("cacheGet", { key }, signal) as Promise<T | undefined>,
        async put(key, value) {
            await rpc.call("cachePut", { key, value }, signal);
        },
        async clear(prefix) {
            await rpc.call("cacheClear", { prefix }, signal);
        },
        ...(options.atomicCache
            ? {
                  async putMany(entries: [string, unknown][]) {
                      await rpc.call("cachePutMany", { entries }, signal);
                  },
              }
            : {}),
    };
    const session = createRegistry({
        ...options,
        fetch: options.customFetch ? customFetch(rpc) : undefined,
        cache,
        onProgress: progress?.report,
    }).session(signal);
    try {
        progress?.report({ phase: "resolve", done: false });
        const graph = await installGraph(options.specs, {
            ...session,
            signal,
            patch: (pkg, manifest) =>
                options.manifestPatches
                    ? rpc.call("patchManifest", { pkg, manifest }, signal)
                    : Promise.resolve({ manifest, reports: [] }),
        });
        signal.throwIfAborted();
        progress?.report({ phase: "resolve", done: true });
        const snapshot = await buildIndex(graph, options, progress?.report);
        signal.throwIfAborted();
        const locations = new Map(graph.nodes.map((node) => [node.scope, node]));
        return {
            snapshot,
            async commit() {
                signal.throwIfAborted();
                await session.commit();
                session.discard();
            },
            read(scope: string, filename: string, id: string) {
                const node = locations.get(scope);
                if (!node || !Object.hasOwn(node.files, filename))
                    throw new Error("Invalid FHIR Worker resource location");
                return { ...JSON.parse(node.files[filename] as string), id };
            },
        };
    } catch (error) {
        session.discard();
        throw error;
    } finally {
        progress?.flush();
        progress?.close();
    }
}
