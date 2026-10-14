import { afterEach, beforeEach, expect, test } from "bun:test";
import { createCanonicalManager as createManager, createMemoryCache } from "../../../src/browser/index.js";
import { patientUrl, registryFixture } from "../../browser/fixture.js";

const NativeWorker = globalThis.Worker;
const live = new Set<Worker>();
const managers: ReturnType<typeof createManager>[] = [];
let pauseReads = false;
let releaseRead: (() => void) | undefined;
class TrackedWorker extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        live.add(this);
    }
    override terminate() {
        live.delete(this);
        return super.terminate();
    }
    override postMessage(message: unknown) {
        if (
            pauseReads &&
            typeof message === "object" &&
            message !== null &&
            "method" in message &&
            message.method === "read"
        ) {
            releaseRead = () => super.postMessage(message);
            return;
        }
        super.postMessage(message);
    }
}
beforeEach(() => {
    globalThis.Worker = TrackedWorker;
    pauseReads = false;
    releaseRead = undefined;
});
afterEach(async () => {
    try {
        await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
        expect(live.size).toBe(0);
    } finally {
        for (const worker of live) worker.terminate();
        live.clear();
        globalThis.Worker = NativeWorker;
    }
});
function createCanonicalManager(config: Parameters<typeof createManager>[0]) {
    const manager = createManager(config);
    managers.push(manager);
    return manager;
}
function deferred() {
    let resolve: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve: () => resolve() };
}

test("prepares archives and reference hashes off the host, and parses fresh resources before local closure patches", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const decoder = globalThis.DecompressionStream;
    const digest = crypto.subtle.digest;
    const parse = JSON.parse;
    let reads = 0;
    const marker = { value: "closure" };
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        patches: {
            fhirResource: [
                (_pkg, resource) => {
                    reads++;
                    resource.marker = `${marker.value}-${reads}`;
                    return resource;
                },
            ],
        },
    });
    try {
        globalThis.DecompressionStream = class {
            constructor() {
                throw new Error("Host extraction is forbidden");
            }
        } as unknown as typeof DecompressionStream;
        crypto.subtle.digest = (() => {
            throw new Error("Host verification/reference hashing is forbidden");
        }) as typeof digest;
        JSON.parse = (() => {
            throw new Error("Host metadata/index/resource parsing is forbidden");
        }) as typeof parse;
        await manager.init();
        expect((await manager.resolve(patientUrl)).marker).toBe("closure-1");
        marker.value = "changed";
        expect((await manager.resolve(patientUrl)).marker).toBe("changed-2");
        expect(live.size).toBe(1);
    } finally {
        globalThis.DecompressionStream = decoder;
        crypto.subtle.digest = digest;
        JSON.parse = parse;
    }
});

test("a failed cache commit preserves the old Worker, references and resource access", async () => {
    const fixture = await registryFixture([
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
    ]);
    const cache = createMemoryCache();
    let fail = false;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        cache: {
            ...cache,
            async putMany(entries, signal) {
                if (fail) throw new Error("cache commit failed");
                await cache.putMany?.(entries, signal);
            },
        },
    });
    await manager.init();
    const before = await manager.resolve(patientUrl);
    fail = true;
    await expect(manager.addPackages("b@1.0.0")).rejects.toThrow("cache commit failed");
    expect(live.size).toBe(1);
    expect((await manager.read(before)).id).toBe(before.id);
    expect(await manager.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
    fail = false;
    await manager.addPackages("b@1.0.0");
    expect(await manager.packages()).toHaveLength(2);
    expect(live.size).toBe(1);
});

test("waits for cache commit before publishing the compact snapshot, while old resources remain readable", async () => {
    const fixture = await registryFixture([
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
    ]);
    const cache = createMemoryCache();
    const started = deferred();
    const release = deferred();
    let commits = 0;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        cache: {
            ...cache,
            async putMany(entries, signal) {
                if (++commits === 2) {
                    started.resolve();
                    await release.promise;
                }
                await cache.putMany?.(entries, signal);
            },
        },
    });
    await manager.init();
    const before = await manager.resolve(patientUrl);
    const adding = manager.addPackages("b@1.0.0");
    await started.promise;
    expect(live.size).toBe(2);
    expect(await manager.packages()).toHaveLength(1);
    expect((await manager.read(before)).marker).toBe("a@1.0.0");
    release.resolve();
    await adding;
    expect(await manager.packages()).toHaveLength(2);
    expect(live.size).toBe(1);
});

test("retires a replaced Worker after its in-flight resource RPC finishes", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
    await manager.init();
    const entry = await manager.resolveEntry(patientUrl);
    pauseReads = true;
    const reading = manager.read(entry);
    expect(releaseRead).toBeDefined();
    await manager.init();
    expect(live.size).toBe(2);
    pauseReads = false;
    releaseRead?.();
    expect((await reading).marker).toBe("a@1.0.0");
    expect(live.size).toBe(1);
    expect((await manager.read(entry)).id).toBe(entry.id);
});

test("callback failures preserve the committed state and never publish or cache their candidate", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const cache = createMemoryCache();
    let phase = "";
    let commits = 0;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        cache: {
            ...cache,
            async putMany(entries, signal) {
                commits++;
                await cache.putMany?.(entries, signal);
            },
        },
        patches: {
            packageJson: [
                () => {
                    if (phase === "manifest") throw new Error("manifest closure failed");
                    return undefined;
                },
            ],
            indexEntry: [
                () => {
                    if (phase === "index") throw new Error("index closure failed");
                    return undefined;
                },
            ],
            fhirResource: [
                () => {
                    if (phase === "resource") throw new Error("resource closure failed");
                    return undefined;
                },
            ],
        },
    });
    await manager.init();
    const entry = await manager.resolveEntry(patientUrl);
    for (const failing of ["manifest", "index"]) {
        phase = failing;
        await expect(manager.init()).rejects.toThrow(`${failing} closure failed`);
        expect(live.size).toBe(1);
        expect(commits).toBe(1);
        expect((await manager.read(entry)).marker).toBe("a@1.0.0");
    }
    phase = "resource";
    // Bun 1.4.2's rejects.toThrow stalls Worker messages; await the RPC before asserting.
    const readError = await manager.read(entry).catch((error: unknown) => error);
    expect(readError).toBeInstanceOf(Error);
    expect(readError).toHaveProperty("message", expect.stringContaining("resource closure failed"));
    expect(await manager.searchEntries({})).toHaveLength(1);
    phase = "";
    expect((await manager.read(entry)).marker).toBe("a@1.0.0");
});

test("destroy also terminates a retired Worker whose read has not completed", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
    await manager.init();
    const entry = await manager.resolveEntry(patientUrl);
    pauseReads = true;
    const reading = manager.read(entry).catch((error) => error as Error);
    await manager.init();
    expect(live.size).toBe(2);
    await manager.destroy();
    expect(live.size).toBe(0);
    expect((await reading).message).toContain("Worker is closed");
});

test("cancels an active candidate and host fetch while keeping committed resources readable", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const controller = new AbortController();
    const started = deferred();
    let fetchAborted = false;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        signal: controller.signal,
        fetch: async (input, init) => {
            if (!String(input).endsWith("/missing")) return fixture.fetch(input, init);
            started.resolve();
            return new Promise((_resolve, reject) =>
                init?.signal?.addEventListener(
                    "abort",
                    () => {
                        fetchAborted = true;
                        reject(init.signal?.reason);
                    },
                    { once: true },
                ),
            );
        },
    });
    await manager.init();
    const before = await manager.resolve(patientUrl);
    const adding = manager.addPackages("missing@1.0.0");
    await started.promise;
    controller.abort(new Error("user cancelled"));
    await expect(adding).rejects.toThrow("user cancelled");
    expect(fetchAborted).toBe(true);
    expect(live.size).toBe(1);
    expect((await manager.read(before)).id).toBe(before.id);
});

test("destroy aborts pending initialization, closes Workers, and permits a clean later initialization", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const started = deferred();
    let hold = true;
    let aborted = false;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: async (input, init) => {
            if (!hold) return fixture.fetch(input, init);
            started.resolve();
            return new Promise((_resolve, reject) =>
                init?.signal?.addEventListener(
                    "abort",
                    () => {
                        aborted = true;
                        reject(init.signal?.reason);
                    },
                    { once: true },
                ),
            );
        },
    });
    const initializing = manager.init();
    const failure = initializing.catch((error) => error as Error);
    await started.promise;
    await manager.destroy();
    expect((await failure).message).toContain("destroy");
    expect(aborted).toBe(true);
    expect(live.size).toBe(0);
    await expect(manager.resolve(patientUrl)).rejects.toThrow("not initialized");
    hold = false;
    await manager.init();
    expect((await manager.resolve(patientUrl)).marker).toBe("a@1.0.0");
    expect(live.size).toBe(1);
});

test("serializes concurrent init calls and cancels queued generations on destroy", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
    await Promise.all([manager.init(), manager.init()]);
    expect(live.size).toBe(1);
    const queued = manager.init().catch((error) => error as Error);
    await manager.destroy();
    expect((await queued).message).toContain("destroy");
    expect(live.size).toBe(0);
    await manager.init();
    expect(live.size).toBe(1);
});

test("destroy settles during stalled initialization/flush cache clearing and ignores late completion", async () => {
    for (const phase of ["init", "flush"] as const) {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const cache = createMemoryCache();
        const started = deferred();
        const release = deferred();
        const finished = deferred();
        let clears = 0;
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: fixture.fetch,
            dropCache: phase === "init",
            cache: {
                ...cache,
                async clear(prefix) {
                    if (++clears === (phase === "init" ? 2 : 1)) {
                        started.resolve();
                        await release.promise;
                        await cache.clear(prefix);
                        finished.resolve();
                    } else await cache.clear(prefix);
                },
            },
        });
        await manager.init();
        expect(live.size).toBe(1);
        const requests = fixture.requests.length;
        const blocked = (phase === "init" ? manager.init() : manager.flushCache()).then(
            () => "published stale state",
            (error) => String(error),
        );
        await started.promise;
        const destroying = manager.destroy();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result = await Promise.race([
                Promise.all([destroying, blocked]).then(([, failure]) => failure),
                new Promise<string>((resolve) => {
                    timer = setTimeout(() => resolve("blocked by cache callback"), 1_000);
                }),
            ]);
            expect(result).toContain("destroy");
            expect(live.size).toBe(0);
            await expect(manager.packages()).rejects.toThrow("not initialized");
            release.resolve();
            await finished.promise;
            await Promise.resolve();
            expect(live.size).toBe(0);
            expect(fixture.requests).toHaveLength(requests);
            await manager.init();
            expect(live.size).toBe(1);
            expect((await manager.resolve(patientUrl)).marker).toBe("a@1.0.0");
            await manager.destroy();
        } finally {
            if (timer) clearTimeout(timer);
            release.resolve();
            await Promise.allSettled([destroying, blocked]);
        }
    }
});

test("caller cancellation during pre-Worker cache clearing preserves committed resource access", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const cache = createMemoryCache();
    const controller = new AbortController();
    const started = deferred();
    const release = deferred();
    let clears = 0;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        signal: controller.signal,
        dropCache: true,
        cache: {
            ...cache,
            async clear(prefix) {
                if (++clears === 2) {
                    started.resolve();
                    await release.promise;
                }
                await cache.clear(prefix);
            },
        },
    });
    await manager.init();
    const before = await manager.resolve(patientUrl);
    const blocked = manager.init();
    const failure = blocked.catch((error) => error as Error);
    try {
        await started.promise;
        controller.abort(new Error("cancelled cache phase"));
        expect((await failure).message).toContain("cancelled cache phase");
        expect(live.size).toBe(1);
        expect((await manager.read(before)).id).toBe(before.id);
        release.resolve();
        await Promise.resolve();
        expect(live.size).toBe(1);
    } finally {
        release.resolve();
        await Promise.allSettled([blocked]);
    }
});
