import { workerSource } from "virtual:fcm-worker";
import type { Cache } from "./cache.js";
import type { Fetch } from "./fetch.js";
import { notifyProgress } from "./progress.js";
import {
    deserializeError,
    type HostMethods,
    type PrepareOptions,
    type Progress,
    type WorkerMethods,
} from "./protocol.js";
import { createRpc } from "./rpc.js";

export interface ClientConfig {
    cache: Cache;
    fetch?: Fetch;
    requestTimeoutMs?: number;
    onClose?: () => void;
    onProgress?: (progress: Progress) => void | Promise<void>;
    patchManifest?: (input: HostMethods["patchManifest"]["input"]) => HostMethods["patchManifest"]["output"];
}

/** A candidate becomes the resource owner only after its cache commit succeeds. */
export function createWorkerClient(config: ClientConfig, signal?: AbortSignal) {
    const url = URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" }));
    let worker: Worker;
    try {
        worker = new Worker(url);
    } catch (error) {
        URL.revokeObjectURL(url);
        throw error;
    }
    // Bun's test host supports unref; browsers keep their ordinary Worker lifetime.
    (worker as Worker & { unref?(): void }).unref?.();
    const lifetime = new AbortController();
    const active = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]);
    type BodyReader = {
        read(): Promise<{ done: boolean; value?: Uint8Array }>;
        cancel(reason?: unknown): Promise<void>;
        releaseLock(): void;
    };
    const readers = new Map<number, BodyReader>();
    let responseId = 0;
    let closed = false;
    let retired = false;
    let reads = 0;
    let resolveReady: () => void;
    let rejectReady: (error: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // A constructor failure may arrive before the caller starts prepare().
    ready.catch(() => undefined);
    const check = () => active.throwIfAborted();
    const rpc = createRpc<WorkerMethods, HostMethods>(worker, {
        async cacheGet({ key }) {
            check();
            const value = await config.cache.get(key);
            check();
            return value;
        },
        async cachePut({ key, value }) {
            check();
            await config.cache.put(key, value);
            check();
        },
        async cachePutMany({ entries }) {
            check();
            if (!config.cache.putMany) throw new Error("Cache does not support atomic putMany");
            await config.cache.putMany(entries, active);
            check();
        },
        async cacheClear({ prefix }) {
            check();
            await config.cache.clear(prefix);
            check();
        },
        async patchManifest(input) {
            check();
            const result = config.patchManifest?.(input) ?? { manifest: input.manifest, reports: [] };
            check();
            return result;
        },
        async fetchOpen(request) {
            check();
            if (!config.fetch) throw new Error("No custom fetch callback is configured");
            const requestSignal = AbortSignal.any([active, AbortSignal.timeout(config.requestTimeoutMs ?? 60_000)]);
            const response = await config.fetch(request.url, {
                method: request.method,
                headers: request.headers,
                signal: requestSignal,
                credentials: "omit",
                redirect: "error",
            });
            requestSignal.throwIfAborted();
            const id = ++responseId;
            if (response.body) readers.set(id, response.body.getReader());
            return {
                id,
                status: response.status,
                statusText: response.statusText,
                headers: [...response.headers.entries()],
                url: response.url,
                redirected: response.redirected,
                type: response.type,
                hasBody: Boolean(response.body),
            };
        },
        async fetchRead({ id }) {
            check();
            const reader = readers.get(id);
            if (!reader) return null;
            try {
                const result = await reader.read();
                check();
                if (!result.done) {
                    if (!result.value) throw new Error("Custom fetch body returned no byte chunk");
                    return result.value;
                }
                readers.delete(id);
                reader.releaseLock();
                return null;
            } catch (error) {
                readers.delete(id);
                await reader.cancel().catch(() => undefined);
                reader.releaseLock();
                throw error;
            }
        },
        async fetchCancel({ id }) {
            const reader = readers.get(id);
            if (!reader) return;
            readers.delete(id);
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
        },
    });
    const close = (reason = new Error("FHIR Worker is closed")) => {
        if (closed) return;
        closed = true;
        lifetime.abort(reason);
        rejectReady(reason);
        rpc.close(reason);
        worker.removeEventListener("message", startup);
        for (const reader of readers.values())
            void reader
                .cancel()
                .catch(() => undefined)
                .finally(() => reader.releaseLock());
        readers.clear();
        worker.terminate();
        worker.onerror = null;
        URL.revokeObjectURL(url);
        config.onClose?.();
    };
    const startup = ({ data }: MessageEvent) => {
        if (data.type === "ready") {
            URL.revokeObjectURL(url);
            resolveReady();
        } else if (data.type === "fatal") close(deserializeError(data.error));
        else if (data.type === "progress") {
            for (const progress of data.updates as Progress[]) {
                if (closed || active.aborted) break;
                notifyProgress(config.onProgress, progress, active);
            }
        }
    };
    worker.addEventListener("message", startup);
    worker.onerror = (event) => close(new Error(`FHIR Worker failed: ${event.message}`));
    return {
        async prepare(options: Omit<PrepareOptions, "customFetch" | "manifestPatches" | "atomicCache" | "progress">) {
            check();
            const abort = () => rejectReady(active.reason);
            active.addEventListener("abort", abort, { once: true });
            try {
                await ready;
            } finally {
                active.removeEventListener("abort", abort);
            }
            check();
            return rpc.call(
                "prepare",
                {
                    ...options,
                    customFetch: Boolean(config.fetch),
                    manifestPatches: Boolean(config.patchManifest),
                    atomicCache: Boolean(config.cache.putMany),
                    progress: Boolean(config.onProgress),
                },
                active,
            );
        },
        commit: () => rpc.call("commit", undefined, active),
        // Reads remain usable even if a later initialization's signal is cancelled.
        read: (scope: string, filename: string, id: string) => {
            if (retired) return Promise.reject(new Error("FHIR Worker is retired"));
            reads++;
            return rpc.call("read", { scope, filename, id }).finally(() => {
                reads--;
                if (retired && !reads) close();
            });
        },
        retire() {
            retired = true;
            if (!reads) close();
        },
        close,
    };
}
export type WorkerClient = ReturnType<typeof createWorkerClient>;
