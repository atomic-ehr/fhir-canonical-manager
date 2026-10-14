import { afterEach, expect, test } from "bun:test";
import { createCanonicalManager, createMemoryCache, type Progress } from "../../../src/browser/index.js";
import type { DownloadProgress, SelectedManifest } from "../../../src/browser/protocol.js";
import { createProgress, downloadReporter } from "../../../src/browser/worker/progress.js";
import { createRegistry } from "../../../src/browser/worker/registry.js";
import { excludeCanonical } from "../../../src/patches.js";
import { patientUrl, registryFixture } from "../../browser/fixture.js";

const managers: ReturnType<typeof createCanonicalManager>[] = [];
afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
});

test("batches concurrent downloads and cancels pending notifications", async () => {
    const batches: Progress[][] = [];
    const controller = new AbortController();
    const progress = createProgress((updates) => batches.push(updates), controller.signal);
    for (let i = 0; i < 2_000; i++)
        for (const name of ["a", "b"])
            progress.report({ phase: "download", package: { name, version: "1.0.0" }, receivedBytes: i, done: false });
    expect(batches).toHaveLength(0);
    await Bun.sleep(120);
    expect(batches).toHaveLength(1);
    expect(
        batches[0]?.map((update) => [
            "package" in update ? update.package.name : "",
            "receivedBytes" in update ? update.receivedBytes : 0,
        ]),
    ).toEqual([
        ["a", 1_999],
        ["b", 1_999],
    ]);
    progress.report({ phase: "download", package: { name: "a", version: "1.0.0" }, receivedBytes: 2_000, done: true });
    controller.abort();
    progress.flush();
    await Bun.sleep(120);
    expect(batches).toHaveLength(1);
    progress.close();
});

test.each([
    { length: "100", type: "default", encoding: undefined, expected: 100 },
    { length: "100", type: "cors", encoding: "identity", expected: 100 },
    { length: "100", type: "cors", encoding: undefined, expected: undefined },
    { length: "10", type: "default", encoding: "gzip", expected: undefined },
    { length: undefined, type: "default", encoding: undefined, expected: undefined },
    { length: "-1", type: "default", encoding: undefined, expected: undefined },
    { length: "9007199254740992", type: "default", encoding: undefined, expected: undefined },
])("only reports a body-comparable total: %j", ({ length, type, encoding, expected }) => {
    const headers = new Headers();
    if (length !== undefined) headers.set("content-length", length);
    if (encoding !== undefined) headers.set("content-encoding", encoding);
    const response = new Response("body", { headers });
    Object.defineProperty(response, "type", { value: type });
    const updates: DownloadProgress[] = [];
    const report = downloadReporter(response, { name: "a", version: "1.0.0" }, (update) => updates.push(update));
    report(10, false);
    if (expected === undefined) expect(updates[0]?.totalBytes).toBeUndefined();
    else expect(updates[0]?.totalBytes).toBe(expected);
    expect(updates[0]).toMatchObject({ receivedBytes: 10, done: false });
});

test("drops a length that disagrees with delivered body bytes", () => {
    for (const delivered of [50, 150]) {
        const updates: DownloadProgress[] = [];
        const report = downloadReporter(
            new Response("body", { headers: { "content-length": "100" } }),
            { name: "a", version: "1.0.0" },
            (update) => updates.push(update),
        );
        report(delivered, true);
        expect(updates[0]).toEqual({
            phase: "download",
            package: { name: "a", version: "1.0.0" },
            receivedBytes: delivered,
            done: true,
        });
    }
});

test("reports independent streamed byte counts for concurrent verified archives", async () => {
    const fixture = await registryFixture([
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0" },
    ]);
    const updates: DownloadProgress[] = [];
    const lengths = new Map<string, number>();
    let active = 0;
    let maxActive = 0;
    const registry = createRegistry({
        cache: createMemoryCache(),
        onProgress: (update) => {
            if (update.phase === "download") updates.push(update);
        },
        fetch: async (...args) => {
            const response = await fixture.fetch(...args);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const name = String(args[0]).split("/").at(-2) ?? "";
            lengths.set(name, bytes.length);
            active++;
            maxActive = Math.max(maxActive, active);
            let offset = 0;
            return new Response(
                new ReadableStream({
                    async pull(controller) {
                        await Bun.sleep(10);
                        if (offset === bytes.length) {
                            active--;
                            controller.close();
                        } else {
                            const end = Math.min(offset + 30, bytes.length);
                            controller.enqueue(bytes.slice(offset, end));
                            offset = end;
                        }
                    },
                }),
                { headers: { "content-length": String(bytes.length) } },
            );
        },
    });
    const manifests = await Promise.all(
        ["a", "b"].map(async (name) => {
            const response = await fixture.fetch(`https://packages.simplifier.net/${name}`);
            const manifest = ((await response.json()) as { versions: Record<string, SelectedManifest> }).versions[
                "1.0.0"
            ];
            if (!manifest) throw new Error("Missing fixture manifest");
            return manifest;
        }),
    );
    const session = registry.session();
    await Promise.all(manifests.map((manifest) => session.hydrate(manifest, new AbortController().signal)));
    session.discard();
    expect(maxActive).toBe(2);
    for (const name of ["a", "b"]) {
        const length = lengths.get(name);
        if (length === undefined) throw new Error("Missing archive length");
        const events = updates.filter((update) => update.package.name === name);
        expect(events[0]).toMatchObject({ receivedBytes: 0, done: false });
        expect(events.at(-1)).toEqual({
            phase: "download",
            package: { name, version: "1.0.0" },
            receivedBytes: length,
            totalBytes: length,
            done: true,
        });
        expect(events.map((update) => update.receivedBytes)).toEqual(
            events.map((update) => update.receivedBytes).sort((a, b) => a - b),
        );
    }
});

test.each(["throw", "reject", "pending"] as const)(
    "a %s progress observer cannot interrupt initialization",
    async (mode) => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const events: DownloadProgress[] = [];
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: fixture.fetch,
            onProgress(update) {
                if (update.phase === "download") events.push(update);
                if (mode === "throw") throw new Error("observer failed");
                return mode === "reject" ? Promise.reject(new Error("observer rejected")) : new Promise<void>(() => {});
            },
        });
        managers.push(manager);
        await manager.init();
        expect(events.at(-1)).toMatchObject({ package: { name: "a", version: "1.0.0" }, done: true });
        expect((await manager.resolve(patientUrl)).type).toBe("Patient");
        const count = events.length;
        await manager.init();
        expect(events).toHaveLength(count); // Verified archive and packument came from cache.
    },
);

test("download EOF does not claim integrity or graph success", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const events: DownloadProgress[] = [];
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        onProgress: (update) => {
            if (update.phase === "download") events.push(update);
        },
        fetch: async (...args) => {
            const response = await fixture.fetch(...args);
            return String(args[0]).endsWith("/1.0.0") ? new Response(new Uint8Array([1, 2, 3])) : response;
        },
    });
    managers.push(manager);
    const failure = await manager.init().catch((error: unknown) => error);
    expect(failure).toHaveProperty("message", expect.stringContaining("EINTEGRITY"));
    expect(events.at(-1)).toMatchObject({ receivedBytes: 3, done: true });
    await expect(manager.packages()).rejects.toThrow("not initialized");
});

test("the archive byte limit rejects a body without emitting download completion", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const events: DownloadProgress[] = [];
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        archiveLimits: { maxBytes: 2 },
        fetch: fixture.fetch,
        onProgress: (update) => {
            if (update.phase === "download") events.push(update);
        },
    });
    managers.push(manager);
    const error = await manager.init().catch((failure: unknown) => failure);
    expect(error).toHaveProperty("message", expect.stringContaining("exceeds 2 bytes"));
    expect(events.some((event) => event.done)).toBe(false);
});

function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve: () => resolve() };
}

test("reports interleaved package phases, final counts, and ready only after commit/publication", async () => {
    const fixture = await registryFixture([
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
    ]);
    const events: Progress[] = [];
    const started = deferred();
    const release = deferred();
    const cache = createMemoryCache();
    let hold = true;
    const readyReads: Promise<unknown>[] = [];
    const manager = createCanonicalManager({
        packages: ["a@1.0.0", "b@1.0.0"],
        fetch: fixture.fetch,
        cache: {
            ...cache,
            async putMany(entries, signal) {
                if (hold) {
                    started.resolve();
                    await release.promise;
                }
                await cache.putMany?.(entries, signal);
            },
        },
        patches: { indexEntry: [excludeCanonical({ url: patientUrl, reason: "progress count" })] },
        onProgress(event) {
            events.push(event);
            if (event.phase === "ready") readyReads.push(manager.resolve(`${patientUrl}-b`));
        },
    });
    managers.push(manager);
    const initializing = manager.init();
    await started.promise;
    expect(events.at(-1)).toEqual({ phase: "cache", action: "commit", done: false });
    expect(events.some((event) => event.phase === "ready")).toBe(false);
    release.resolve();
    await initializing;
    await Promise.all(readyReads);
    expect(events.at(-1)).toEqual({ phase: "ready", packages: 2, resources: 1 });
    expect(events.find((event) => event.phase === "index" && event.done)).toEqual({
        phase: "index",
        resources: 2,
        done: true,
    });
    for (const name of ["a", "b"]) {
        const phases = events.filter((event) => "package" in event && event.package.name === name);
        const completedDownload = phases.findIndex((event) => event.phase === "download" && event.done);
        const verifying = phases.findIndex((event) => event.phase === "verify" && !event.done);
        const verified = phases.findIndex((event) => event.phase === "verify" && event.done);
        const extracting = phases.findIndex((event) => event.phase === "extract" && !event.done);
        const extracted = phases.findIndex((event) => event.phase === "extract" && event.done);
        expect(completedDownload).toBeGreaterThanOrEqual(0);
        expect(verifying).toBeGreaterThan(completedDownload);
        expect(verified).toBeGreaterThan(verifying);
        expect(extracting).toBeGreaterThan(verified);
        expect(extracted).toBeGreaterThan(extracting);
    }
    expect(events[0]).toEqual({ phase: "resolve", done: false });
    const marker = events.length;
    hold = false;
    await manager.init();
    await Promise.all(readyReads);
    const reloaded = events.slice(marker);
    expect(reloaded.some((event) => event.phase === "download")).toBe(false);
    expect(reloaded.some((event) => event.phase === "verify")).toBe(true);
    expect(reloaded.some((event) => event.phase === "extract")).toBe(true);
    expect(reloaded.at(-1)).toEqual({ phase: "ready", packages: 2, resources: 1 });
});

test("a failed candidate commit never emits ready and leaves the old manager queryable", async () => {
    const fixture = await registryFixture([
        { name: "a", version: "1.0.0" },
        { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
    ]);
    const events: Progress[] = [];
    const cache = createMemoryCache();
    let fail = false;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        onProgress: (event) => {
            events.push(event);
        },
        cache: {
            ...cache,
            async putMany(entries, signal) {
                if (fail) throw new Error("commit failed");
                await cache.putMany?.(entries, signal);
            },
        },
    });
    managers.push(manager);
    await manager.init();
    const marker = events.length;
    fail = true;
    const failure = await manager.addPackages("b@1.0.0").catch((error: unknown) => error);
    expect(failure).toHaveProperty("message", expect.stringContaining("commit failed"));
    expect(events.slice(marker).some((event) => event.phase === "ready")).toBe(false);
    expect(events.at(-1)).toEqual({ phase: "cache", action: "commit", done: false });
    expect((await manager.resolve(patientUrl)).type).toBe("Patient");
    const count = events.length;
    await Bun.sleep(150);
    expect(events).toHaveLength(count);
});

test("destroy during cache clearing suppresses late progress and a fresh init has its own ready event", async () => {
    const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
    const cache = createMemoryCache();
    const events: Progress[] = [];
    const started = deferred();
    const release = deferred();
    const finished = deferred();
    let clears = 0;
    const manager = createCanonicalManager({
        packages: ["a@1.0.0"],
        fetch: fixture.fetch,
        dropCache: true,
        onProgress: (event) => {
            events.push(event);
        },
        cache: {
            ...cache,
            async clear(prefix) {
                if (++clears === 2) {
                    started.resolve();
                    await release.promise;
                }
                await cache.clear(prefix);
                if (clears === 2) finished.resolve();
            },
        },
    });
    managers.push(manager);
    await manager.init();
    const marker = events.length;
    const failed = manager.init().catch((error: unknown) => error);
    await started.promise;
    await manager.destroy();
    expect(await failed).toHaveProperty("message", expect.stringContaining("destroy"));
    expect(events.slice(marker)).toEqual([{ phase: "cache", action: "clear", done: false }]);
    release.resolve();
    await finished.promise;
    await Bun.sleep(150);
    expect(events.slice(marker)).toHaveLength(1);
    await manager.init();
    expect(events.at(-1)).toEqual({ phase: "ready", packages: 1, resources: 1 });
});

test("resolution failure has no completed resolution or ready event", async () => {
    const fixture = await registryFixture([]);
    const events: Progress[] = [];
    const manager = createCanonicalManager({
        packages: ["missing@1.0.0"],
        fetch: fixture.fetch,
        onProgress: (event) => {
            events.push(event);
        },
    });
    managers.push(manager);
    const failure = await manager.init().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(events).toEqual([{ phase: "resolve", done: false }]);
});
