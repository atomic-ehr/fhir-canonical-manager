import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";
import type { api } from "./client.js";
import { patientUrl, registryFixture } from "./fixture.js";

declare global {
    var fcm: typeof api;
}

let appServer: Server;
let registryServer: Server;
let appUrl: string;
let registryUrl: string;
let offline = false;
let requests: string[];

async function listen(server: Server): Promise<string> {
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No fixture server address");
    return `http://127.0.0.1:${address.port}/`;
}

test.beforeAll(async () => {
    const fixture = await registryFixture([
        { name: "profile-a", version: "1.0.0", url: `${patientUrl}-a`, dependencies: { shared: "^1", core: "1.0.0" } },
        { name: "profile-b", version: "1.0.0", url: `${patientUrl}-b`, dependencies: { shared: "^1", core: "2.0.0" } },
        { name: "shared", version: "1.2.0", url: `${patientUrl}-shared` },
        { name: "core", version: "1.0.0" },
        { name: "core", version: "2.0.0" },
        { name: "cycle-a", version: "1.0.0", url: `${patientUrl}-cycle-a`, dependencies: { "cycle-b": "1.0.0" } },
        { name: "cycle-b", version: "1.0.0", url: `${patientUrl}-cycle-b`, dependencies: { "cycle-a": "1.0.0" } },
        { name: "multi-a", version: "1.0.0", url: `${patientUrl}-multi-a`, dependencies: { "multi-b": "2.0.0" } },
        { name: "multi-b", version: "2.0.0", url: `${patientUrl}-multi-b`, dependencies: { "multi-a": "2.0.0" } },
        { name: "multi-a", version: "2.0.0", url: `${patientUrl}-multi-a`, dependencies: { "multi-b": "1.0.0" } },
        { name: "multi-b", version: "1.0.0", url: `${patientUrl}-multi-b`, dependencies: { "multi-a": "1.0.0" } },
        {
            name: "optional-peer",
            version: "1.0.0",
            manifest: {
                peerDependencies: { missing: "1.0.0" },
                peerDependenciesMeta: { missing: { optional: true } },
            },
        },
        { name: "required-peer", version: "1.0.0", manifest: { peerDependencies: { missing: "1.0.0" } } },
        {
            name: "index-load",
            version: "1.0.0",
            files: {
                ...Object.fromEntries(
                    Array.from({ length: 1_200 }, (_value, i) => [
                        `Resource${i}.json`,
                        JSON.stringify({
                            resourceType: "StructureDefinition",
                            url: `${patientUrl}/load/${i}`,
                            type: "Patient",
                            padding: "x".repeat(1_024),
                        }),
                    ]),
                ),
                "Large.json": JSON.stringify({
                    resourceType: "StructureDefinition",
                    url: `${patientUrl}/large`,
                    type: "Patient",
                    padding: "x".repeat(10 * 1024 * 1024),
                }),
            },
        },
    ]);
    requests = fixture.requests;
    registryServer = createServer(async (request, response) => {
        if (request.method === "OPTIONS") {
            response.writeHead(204, {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "*",
                "access-control-allow-methods": "GET, OPTIONS",
            });
            response.end();
            return;
        }
        const result = offline
            ? new Response("offline", { status: 503 })
            : fixture.handle(new URL(request.url ?? "/", registryUrl));
        response.writeHead(result.status, {
            "access-control-allow-origin": "*",
            "content-type": result.headers.get("content-type") ?? "application/gzip",
        });
        response.end(new Uint8Array(await result.arrayBuffer()));
    });
    registryUrl = await listen(registryServer);
    const bundle = await readFile("tmp/browser-client.js");
    appServer = createServer((request, response) => {
        if (request.url === "/client.js") {
            response.writeHead(200, { "content-type": "text/javascript" });
            response.end(bundle);
        } else {
            response.writeHead(200, {
                "content-type": "text/html",
                "content-security-policy":
                    "default-src 'none'; script-src 'self'; worker-src blob:; connect-src http://127.0.0.1:* https://packages.simplifier.net;",
            });
            response.end(
                '<!doctype html><title>FCM browser test</title><script type="module" src="/client.js"></script>',
            );
        }
    });
    appUrl = await listen(appServer);
});

test.afterAll(async () => {
    await Promise.all(
        [appServer, registryServer].map((server) => new Promise<void>((resolve) => server?.close(() => resolve()))),
    );
});

test.beforeEach(async ({ page }) => {
    offline = false;
    requests.length = 0;
    await page.goto(appUrl);
    await page.waitForFunction(() => Boolean(globalThis.fcm));
});

test("shipped browser entry fetches a conflicting diamond and cycles over CORS without Node globals", async ({
    page,
}) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = await page.evaluate(
        async ({ registry, canonical }) => {
            const manager = globalThis.fcm.createCanonicalManager({
                packages: ["profile-a@1.0.0", "profile-b@1.0.0", "cycle-a@1.0.0"],
                registry,
            });
            await manager.init();
            const a = await manager.resolve(`${canonical}-a`);
            const b = await manager.resolve(`${canonical}-b`);
            const baseA = await manager.resolve(String(a.baseDefinition), { sourceContext: { id: a.id } });
            const baseB = await manager.resolve(String(b.baseDefinition), { sourceContext: { id: b.id } });
            const versioned = await manager.resolve(`${canonical}|clinical-2.0.0`, { sourceContext: { id: b.id } });
            const packages = await manager.packages();
            const processPresent = "process" in globalThis;
            const bufferPresent = "Buffer" in globalThis;
            await manager.destroy();
            return {
                baseA: baseA.marker,
                baseB: baseB.marker,
                versioned: versioned.marker,
                packages,
                processPresent,
                bufferPresent,
            };
        },
        { registry: registryUrl, canonical: patientUrl },
    );
    expect(result.baseA).toBe("core@1.0.0");
    expect(result.baseB).toBe("core@2.0.0");
    expect(result.versioned).toBe("core@2.0.0");
    expect(result.packages).toHaveLength(7);
    expect(result.processPresent).toBe(false);
    expect(result.bufferPresent).toBe(false);
    expect(requests.filter((url) => url.endsWith("shared/1.2.0"))).toHaveLength(1);
    expect(errors).toEqual([]);
});

test("IndexedDB survives a real page reload and resolves dependency context with the registry offline", async ({
    page,
}) => {
    const database = `fcm-pw-${randomUUID()}`;
    const initial = await page.evaluate(
        async ({ registry, databaseName, canonical }) => {
            const cache = await globalThis.fcm.createIndexedDbCache(databaseName);
            const manager = globalThis.fcm.createCanonicalManager({
                packages: ["profile-a@^1", "multi-a@1.0.0"],
                registry,
                cache,
            });
            await manager.init();
            const profile = await manager.resolve(`${canonical}-a`);
            const base = await manager.resolve(canonical, { sourceContext: { id: profile.id } });
            const a1 = await manager.resolve(`${canonical}-multi-a`);
            const b2 = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: a1.id } });
            const a2 = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: b2.id } });
            const b1 = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: a2.id } });
            const repeatedA = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: b1.id } });
            const linkedB = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: repeatedA.id } });
            const closesTo = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: linkedB.id } });
            await manager.destroy();
            cache.close();
            return {
                profileId: profile.id,
                baseId: base.id,
                marker: base.marker,
                cycleIds: [a1.id, b2.id, a2.id, b1.id, repeatedA.id, linkedB.id],
                closed: closesTo.id === a2.id,
            };
        },
        { registry: registryUrl, databaseName: database, canonical: patientUrl },
    );
    offline = true;
    const requestCount = requests.length;
    await page.reload();
    await page.waitForFunction(() => Boolean(globalThis.fcm));
    const reloaded = await page.evaluate(
        async ({ registry, databaseName, canonical }) => {
            const cache = await globalThis.fcm.createIndexedDbCache(databaseName);
            const manager = globalThis.fcm.createCanonicalManager({
                packages: ["profile-a@^1", "multi-a@1.0.0"],
                registry,
                cache,
            });
            await manager.init();
            const profile = await manager.resolve(`${canonical}-a`);
            const base = await manager.resolve(canonical, { sourceContext: { id: profile.id } });
            const a1 = await manager.resolve(`${canonical}-multi-a`);
            const b2 = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: a1.id } });
            const a2 = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: b2.id } });
            const b1 = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: a2.id } });
            const repeatedA = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: b1.id } });
            const linkedB = await manager.resolve(`${canonical}-multi-b`, { sourceContext: { id: repeatedA.id } });
            const closesTo = await manager.resolve(`${canonical}-multi-a`, { sourceContext: { id: linkedB.id } });
            await manager.destroy();
            cache.close();
            return {
                profileId: profile.id,
                baseId: base.id,
                marker: base.marker,
                cycleIds: [a1.id, b2.id, a2.id, b1.id, repeatedA.id, linkedB.id],
                closed: closesTo.id === a2.id,
            };
        },
        { registry: registryUrl, databaseName: database, canonical: patientUrl },
    );
    expect(reloaded).toEqual(initial);
    expect(reloaded.marker).toBe("core@1.0.0");
    expect(reloaded.closed).toBe(true);
    expect(new Set(reloaded.cycleIds).size).toBe(6);
    expect(requests).toHaveLength(requestCount);
});

test("shared persistent cache keeps manager indexes and exclusions isolated", async ({ page }) => {
    const result = await page.evaluate(
        async ({ registry, databaseName, canonical }) => {
            const cache = await globalThis.fcm.createIndexedDbCache(databaseName);
            const first = globalThis.fcm.createCanonicalManager({
                packages: ["profile-a@1.0.0"],
                registry,
                cache,
                patches: { indexEntry: [globalThis.fcm.excludeCanonical({ url: canonical, reason: "fixture" })] },
            });
            await first.init();
            const exclusions = first.report();
            const second = globalThis.fcm.createCanonicalManager({ packages: ["profile-b@1.0.0"], registry, cache });
            await second.init();
            const profile = await second.resolve(`${canonical}-b`);
            const base = await second.resolve(canonical, { sourceContext: { id: profile.id } });
            const leaked = await second.searchEntries({ url: `${canonical}-a` });
            const plain = globalThis.fcm.createCanonicalManager({ packages: ["profile-a@1.0.0"], registry, cache });
            await plain.init();
            const unexcluded = await plain.resolve(canonical);
            const packages = await second.packages();
            await Promise.all([first.destroy(), second.destroy(), plain.destroy()]);
            cache.close();
            return { exclusions, base: base.marker, leaked, unexcluded: unexcluded.marker, packages };
        },
        { registry: registryUrl, databaseName: `fcm-pw-${randomUUID()}`, canonical: patientUrl },
    );
    expect(result.exclusions).toHaveLength(1);
    expect(result.base).toBe("core@2.0.0");
    expect(result.leaked).toEqual([]);
    expect(result.unexcluded).toBe("core@1.0.0");
    expect(
        result.packages.some((pkg) => pkg.name === "profile-a" || (pkg.name === "core" && pkg.version === "1.0.0")),
    ).toBe(false);
});

test("packaged browser entry accepts an absent optional peer and rejects a missing required peer", async ({ page }) => {
    const result = await page.evaluate(async (registry) => {
        const optional = globalThis.fcm.createCanonicalManager({ packages: ["optional-peer@1.0.0"], registry });
        await optional.init();
        const packages = await optional.packages();
        const required = globalThis.fcm.createCanonicalManager({ packages: ["required-peer@1.0.0"], registry });
        let requiredError = "";
        try {
            await required.init();
        } catch (error) {
            requiredError = error instanceof Error ? error.message : String(error);
        }
        await Promise.all([optional.destroy(), required.destroy()]);
        return { packages, requiredError };
    }, registryUrl);
    expect(result.packages).toEqual([{ name: "optional-peer", version: "1.0.0" }]);
    expect(result.requiredError).toContain("404");
    expect(requests.filter((url) => url.endsWith("/missing"))).toHaveLength(1);
});

test("Worker ownership preserves custom closures, cache rollback and lifecycle under CSP", async ({ page }) => {
    const result = await page.evaluate(async (registry) => {
        const NativeWorker = globalThis.Worker;
        const live = new Set<Worker>();
        globalThis.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
                super(url, options);
                live.add(this);
            }
            override terminate() {
                live.delete(this);
                return super.terminate();
            }
        };
        const cache = globalThis.fcm.createMemoryCache();
        let failCommit = false;
        let fetches = 0;
        let reads = 0;
        let indexCallbacks = 0;
        let manifestCallbacks = 0;
        const closure = { marker: "first" };
        const manager = globalThis.fcm.createCanonicalManager({
            packages: ["profile-a@1.0.0"],
            registry,
            fetch: async (input, init) => {
                fetches++;
                return fetch(input, init);
            },
            cache: {
                ...cache,
                async putMany(entries, signal) {
                    if (failCommit) throw new Error("browser cache failure");
                    await cache.putMany?.(entries, signal);
                },
            },
            patches: {
                packageJson: [
                    (_pkg, manifest) => {
                        manifestCallbacks++;
                        return { ...manifest, closure: closure.marker };
                    },
                ],
                indexEntry: [
                    (_pkg, entry) => {
                        indexCallbacks++;
                        return { ...entry, kind: closure.marker };
                    },
                ],
                fhirResource: [
                    (_pkg, resource) => {
                        reads++;
                        return { ...resource, closure: closure.marker };
                    },
                ],
            },
        });
        try {
            await manager.init();
            const entry = await manager.resolveEntry("http://example.org/StructureDefinition/Patient");
            const first = await manager.read(entry);
            const workersAfterInit = live.size;
            failCommit = true;
            let failure = "";
            try {
                await manager.addPackages("profile-b@1.0.0");
            } catch (error) {
                failure = error instanceof Error ? error.message : String(error);
            }
            const workersAfterFailure = live.size;
            const old = await manager.read(entry);
            failCommit = false;
            closure.marker = "second";
            await Promise.all([manager.init(), manager.init()]);
            const second = await manager.read(entry);
            const manifest = await manager.packageJson("profile-a");
            const workersAfterReinit = live.size;
            await manager.destroy();
            return {
                workersAfterInit,
                workersAfterFailure,
                workersAfterReinit,
                workersAfterDestroy: live.size,
                failure,
                first: first.closure,
                old: old.closure,
                second: second.closure,
                manifest: manifest.closure,
                entryKind: entry.kind,
                callbacks: [fetches > 0, reads === 3, indexCallbacks > 0, manifestCallbacks > 0],
            };
        } finally {
            await manager.destroy();
            globalThis.Worker = NativeWorker;
        }
    }, registryUrl);
    expect(result).toEqual({
        workersAfterInit: 1,
        workersAfterFailure: 1,
        workersAfterReinit: 1,
        workersAfterDestroy: 0,
        failure: "browser cache failure",
        first: "first",
        old: "first",
        second: "second",
        manifest: "second",
        entryKind: "first",
        callbacks: [true, true, true, true],
    });
});

test("destroy settles while custom initialization and flush cache callbacks remain unresolved", async ({ page }) => {
    const result = await page.evaluate(async (registry) => {
        const NativeWorker = globalThis.Worker;
        const live = new Set<Worker>();
        globalThis.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: WorkerOptions) {
                super(url, options);
                live.add(this);
            }
            override terminate() {
                live.delete(this);
                return super.terminate();
            }
        };
        const results: {
            phase: "init" | "flush";
            closedImmediately: boolean;
            failure: boolean;
            closedAfterLateCompletion: boolean;
            fresh: unknown;
        }[] = [];
        try {
            for (const phase of ["init", "flush"] as const) {
                const cache = globalThis.fcm.createMemoryCache();
                let started: () => void = () => {};
                let release: () => void = () => {};
                let finished: () => void = () => {};
                const clearing = new Promise<void>((resolve) => {
                    started = resolve;
                });
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                const completed = new Promise<void>((resolve) => {
                    finished = resolve;
                });
                let clears = 0;
                const manager = globalThis.fcm.createCanonicalManager({
                    packages: ["profile-a@1.0.0"],
                    registry,
                    dropCache: phase === "init",
                    cache: {
                        ...cache,
                        async clear(prefix) {
                            if (++clears === (phase === "init" ? 2 : 1)) {
                                started();
                                await gate;
                                await cache.clear(prefix);
                                finished();
                            } else await cache.clear(prefix);
                        },
                    },
                });
                let timer: ReturnType<typeof setTimeout> | undefined;
                try {
                    await manager.init();
                    const blocked = (phase === "init" ? manager.init() : manager.flushCache()).then(
                        () => "stale publication",
                        (error) => String(error),
                    );
                    await clearing;
                    const destroying = manager.destroy();
                    const closedImmediately = live.size === 0;
                    const failure = await Promise.race([
                        Promise.all([destroying, blocked]).then(([, message]) => message),
                        new Promise<string>((resolve) => {
                            timer = setTimeout(() => resolve("blocked by callback"), 1_000);
                        }),
                    ]);
                    release();
                    await completed;
                    const closedAfterLateCompletion = live.size === 0;
                    await manager.init();
                    const fresh = await manager.resolve("http://example.org/StructureDefinition/Patient");
                    results.push({
                        phase,
                        closedImmediately,
                        failure: failure.includes("destroy"),
                        closedAfterLateCompletion,
                        fresh: fresh.marker,
                    });
                } finally {
                    if (timer) clearTimeout(timer);
                    release();
                    await manager.destroy();
                }
            }
            return { results, remainingWorkers: live.size };
        } finally {
            globalThis.Worker = NativeWorker;
        }
    }, registryUrl);
    expect(result).toEqual({
        results: ["init", "flush"].map((phase) => ({
            phase,
            closedImmediately: true,
            failure: true,
            closedAfterLateCompletion: true,
            fresh: "core@1.0.0",
        })),
        remainingWorkers: 0,
    });
});

test("preparation stays in the Worker while the page event loop continues", async ({ page }, testInfo) => {
    const result = await page.evaluate(async (registry) => {
        const decoder = globalThis.DecompressionStream;
        globalThis.DecompressionStream = class {
            constructor() {
                throw new Error("UI archive extraction is forbidden");
            }
        } as unknown as typeof DecompressionStream;
        const manager = globalThis.fcm.createCanonicalManager({ packages: ["index-load@1.0.0"], registry });
        const ticks: number[] = [performance.now()];
        const longTasks: number[] = [];
        const BrowserPerformanceObserver = globalThis.PerformanceObserver as unknown as {
            new (
                callback: (list: { getEntries(): { duration: number }[] }) => void,
            ): { observe(options: { type: string }): void; disconnect(): void };
            supportedEntryTypes: string[];
        };
        const observer = new BrowserPerformanceObserver((list) => {
            for (const entry of list.getEntries()) longTasks.push(entry.duration);
        });
        if (BrowserPerformanceObserver.supportedEntryTypes.includes("longtask")) observer.observe({ type: "longtask" });
        const timer = setInterval(() => ticks.push(performance.now()), 16);
        const started = performance.now();
        try {
            await manager.init();
            const entries = await manager.searchEntries({});
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            return {
                entries: entries.length,
                elapsedMs: performance.now() - started,
                heartbeats: ticks.length - 1,
                maxHeartbeatGapMs: Math.max(...ticks.slice(1).map((time, i) => time - (ticks[i] ?? time))),
                longTasksMs: longTasks,
            };
        } finally {
            clearInterval(timer);
            observer.disconnect();
            await manager.destroy();
            globalThis.DecompressionStream = decoder;
        }
    }, registryUrl);
    expect(result.entries).toBe(1_202);
    expect(result.heartbeats).toBeGreaterThan(0);
    await testInfo.attach("worker-preparation-event-loop", {
        body: JSON.stringify(result, null, 2),
        contentType: "application/json",
    });
    console.log(`Worker preparation event loop: ${JSON.stringify(result)}`);
});

test("public US Core verifies its archive and transitive dependencies in the packaged browser entry", async ({
    page,
}) => {
    test.skip(!process.env.FCM_BROWSER_LIVE, "Set FCM_BROWSER_LIVE=1 for the public registry smoke test");
    test.setTimeout(300_000);
    page.on("console", (message) => console.log(`[browser] ${message.text()}`));
    const result = await page.evaluate(async () => {
        const manager = globalThis.fcm.createCanonicalManager({
            packages: ["hl7.fhir.us.core@6.1.0"],
            graphTimeoutMs: 270_000,
            requestTimeoutMs: 120_000,
            archiveLimits: { maxBytes: 512 * 1024 * 1024, maxFiles: 50_000 },
            fetch: async (input, init) => {
                console.log(`Fetching ${input}`);
                const response = await fetch(input, init);
                console.log(`Registry response ${response.status}`);
                return response;
            },
        });
        await manager.init();
        const manifest = await manager.packageJson("hl7.fhir.us.core");
        const packages = await manager.packages();
        const profile = await manager.resolve("http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient");
        const base = await manager.resolve(String(profile.baseDefinition), { sourceContext: { id: profile.id } });
        const patient = await manager.resolve("http://hl7.org/fhir/StructureDefinition/Patient");
        const humanName = await manager.resolve("http://hl7.org/fhir/StructureDefinition/HumanName", {
            sourceContext: { id: patient.id },
        });
        await manager.destroy();
        return {
            type: patient.type,
            resourceType: patient.resourceType,
            humanName: humanName.type,
            directDependencies: Object.keys(manifest.dependencies ?? {}).length,
            packages: packages.length,
            baseType: base.type,
        };
    });
    expect(result).toEqual({
        type: "Patient",
        resourceType: "StructureDefinition",
        humanName: "HumanName",
        directDependencies: 9,
        packages: 11,
        baseType: "Patient",
    });
});
