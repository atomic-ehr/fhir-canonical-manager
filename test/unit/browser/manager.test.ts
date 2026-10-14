import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "bun:test";
import {
    createIndexedDbCache,
    createCanonicalManager as createManager,
    createMemoryCache,
} from "../../../src/browser/index.js";
import { ensureDependency, excludeCanonical, renamePackage } from "../../../src/patches.js";
import { patientUrl, registryFixture } from "../../browser/fixture.js";

const managers: ReturnType<typeof createManager>[] = [];
function createCanonicalManager(config: Parameters<typeof createManager>[0]) {
    const manager = createManager(config);
    managers.push(manager);
    return manager;
}
afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
});

describe("browser manager", () => {
    test("installs a conflicting diamond, reuses compatible versions, and resolves from each parent", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", dependencies: { shared: "^1.0.0", core: "1.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "1.0.0", dependencies: { shared: "^1.0.0", core: "2.0.0" }, url: `${patientUrl}-b` },
            { name: "shared", version: "1.5.0", url: `${patientUrl}-shared` },
            { name: "core", version: "1.0.0" },
            { name: "core", version: "2.0.0" },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0", "b@1.0.0"], fetch: fixture.fetch });
        await manager.init();
        expect((await manager.packages()).filter((pkg) => pkg.name === "core")).toHaveLength(2);
        expect(fixture.requests.filter((url) => url.endsWith("shared/1.5.0"))).toHaveLength(1);
        const profileA = await manager.resolve(`${patientUrl}-a`);
        const profileB = await manager.resolve(`${patientUrl}-b`);
        expect((await manager.resolve(patientUrl, { sourceContext: { id: profileA.id } })).marker).toBe("core@1.0.0");
        expect((await manager.resolve(patientUrl, { sourceContext: { id: profileB.id } })).marker).toBe("core@2.0.0");
        expect(
            (
                await manager.resolve(`${patientUrl}|clinical-2.0.0`, {
                    sourceContext: { package: { name: "b", version: "1.0.0" } },
                })
            ).marker,
        ).toBe("core@2.0.0");
        await expect(
            manager.resolve(patientUrl, { version: "2.0.0", sourceContext: { id: profileB.id } }),
        ).rejects.toThrow("from b@1.0.0");
        await expect(manager.resolve(patientUrl, { sourceContext: { id: "invalid" } })).rejects.toThrow(
            "Invalid source context",
        );
    });

    test("keeps the compatible explicit binding when npm also examines a newer candidate", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", dependencies: { core: "^1.0.0" }, url: `${patientUrl}-a` },
            { name: "core", version: "1.2.5" },
            { name: "core", version: "1.3.7" },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0", "core@1.2.5"], fetch: fixture.fetch });
        await manager.init();
        expect(
            (await manager.resolve(patientUrl, { sourceContext: { package: { name: "a", version: "1.0.0" } } })).marker,
        ).toBe("core@1.2.5");
        expect((await manager.packages()).some((pkg) => pkg.name === "core" && pkg.version === "1.3.7")).toBe(false);
        expect(fixture.requests.filter((url) => url.endsWith("/core"))).toHaveLength(1);
    });

    test("supports cyclic manifests and multiple explicitly configured package versions", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", dependencies: { b: "1.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "1.0.0", dependencies: { a: "1.0.0" }, url: `${patientUrl}-b` },
            { name: "core", version: "1.0.0" },
            { name: "core", version: "2.0.0" },
        ]);
        const manager = createCanonicalManager({
            packages: ["a@1.0.0", "core@1.0.0", "core@2.0.0"],
            fetch: fixture.fetch,
        });
        await manager.init();
        expect(await manager.packages()).toHaveLength(4);
        expect(fixture.requests).toHaveLength(7); // Three packuments plus four verified archives.
        expect(
            (await manager.resolve(patientUrl, { sourceContext: { package: { name: "core", version: "2.0.0" } } }))
                .marker,
        ).toBe("core@2.0.0");
    });

    test("keeps distinct installation contexts when a nearer incompatible binding shadows a root", async () => {
        const fixture = await registryFixture([
            { name: "core", version: "1.0.0" },
            { name: "core", version: "2.0.0" },
            { name: "helper", version: "2.0.0", url: `${patientUrl}-helper-2` },
            {
                name: "helper",
                version: "1.0.0",
                dependencies: { core: "1.0.0" },
                url: `${patientUrl}-helper-1`,
            },
            {
                name: "b",
                version: "1.0.0",
                dependencies: { core: "2.0.0", helper: "1.0.0" },
                url: `${patientUrl}-b`,
            },
        ]);
        const manager = createCanonicalManager({
            packages: ["core@1.0.0", "helper@2.0.0", "b@1.0.0"],
            fetch: fixture.fetch,
        });
        await manager.init();
        const rootCore = await manager.resolve(patientUrl);
        const b = await manager.resolve(`${patientUrl}-b`);
        const helper = await manager.resolve(`${patientUrl}-helper-1`, { sourceContext: { id: b.id } });
        const nestedCore = await manager.resolve(patientUrl, { sourceContext: { id: helper.id } });
        expect(nestedCore.marker).toBe("core@1.0.0");
        expect(nestedCore.id).not.toBe(rootCore.id);
        expect((await manager.resolve(patientUrl, { sourceContext: { id: b.id } })).marker).toBe("core@2.0.0");
        expect(fixture.requests.filter((url) => url.endsWith("core/1.0.0"))).toHaveLength(1);
        await expect(
            manager.resolve(patientUrl, { sourceContext: { package: { name: "core", version: "1.0.0" } } }),
        ).rejects.toThrow("ambiguous");
    });

    test("preserves Arborist's repeated locations and explicit link when closing a multiversion cycle", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", dependencies: { b: "2.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "2.0.0", dependencies: { a: "2.0.0" }, url: `${patientUrl}-b` },
            { name: "a", version: "2.0.0", dependencies: { b: "1.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "1.0.0", dependencies: { a: "1.0.0" }, url: `${patientUrl}-b` },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
        await manager.init();
        const a1 = await manager.resolve(`${patientUrl}-a`);
        const b2 = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: a1.id } });
        const a2 = await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: b2.id } });
        const b1 = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: a2.id } });
        const cycle = await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: b1.id } });
        expect([a1.marker, b2.marker, a2.marker, b1.marker]).toEqual(["a@1.0.0", "b@2.0.0", "a@2.0.0", "b@1.0.0"]);
        expect(cycle.marker).toBe("a@1.0.0");
        expect(cycle.id).not.toBe(a1.id); // npm installs this occurrence separately.
        const linkedB = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: cycle.id } });
        expect(linkedB.id).not.toBe(b2.id);
        expect((await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: linkedB.id } })).id).toBe(a2.id);
        expect(await manager.searchEntries({})).toHaveLength(6);
        expect(fixture.requests).toHaveLength(6); // Two packuments; four archives, shared across occurrences.
    });

    test("closes repeated multiversion cycles inside each branch without reusing a sibling's context", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "3.0.0", url: `${patientUrl}-a` },
            { name: "b", version: "3.0.0", url: `${patientUrl}-b` },
            { name: "one", version: "1.0.0", dependencies: { a: "1.0.0" }, url: `${patientUrl}-one` },
            { name: "two", version: "1.0.0", dependencies: { a: "1.0.0" }, url: `${patientUrl}-two` },
            { name: "a", version: "1.0.0", dependencies: { b: "2.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "2.0.0", dependencies: { a: "2.0.0" }, url: `${patientUrl}-b` },
            { name: "a", version: "2.0.0", dependencies: { b: "1.0.0" }, url: `${patientUrl}-a` },
            { name: "b", version: "1.0.0", dependencies: { a: "1.0.0" }, url: `${patientUrl}-b` },
        ]);
        const manager = createCanonicalManager({
            packages: ["a@3.0.0", "b@3.0.0", "one@1.0.0", "two@1.0.0"],
            fetch: fixture.fetch,
        });
        await manager.init();
        const starts: string[] = [];
        for (const root of ["one", "two"]) {
            const parent = await manager.resolve(`${patientUrl}-${root}`);
            const a1 = await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: parent.id } });
            const b2 = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: a1.id } });
            const a2 = await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: b2.id } });
            const b1 = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: a2.id } });
            const repeatedA = await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: b1.id } });
            const linkedB = await manager.resolve(`${patientUrl}-b`, { sourceContext: { id: repeatedA.id } });
            expect(repeatedA.marker).toBe("a@1.0.0");
            expect(repeatedA.id).not.toBe(a1.id);
            expect((await manager.resolve(`${patientUrl}-a`, { sourceContext: { id: linkedB.id } })).id).toBe(a2.id);
            starts.push(a1.id);
            await expect(
                manager.resolve(`${patientUrl}-${root === "one" ? "two" : "one"}`, { sourceContext: { id: b1.id } }),
            ).rejects.toThrow("Cannot resolve");
        }
        expect(starts[0]).not.toBe(starts[1]);
        expect(await manager.searchEntries({})).toHaveLength(16);
        expect(fixture.requests).toHaveLength(12); // Four packuments and eight unique archives.
    });

    test("renames package metadata on fresh and cached loads while keeping the requested transport identity", async () => {
        const fixture = await registryFixture([{ name: "typo", version: "1.0.0" }]);
        const cache = createMemoryCache();
        const patches = {
            packageJson: [renamePackage("typo", "correct")],
            indexEntry: [
                (_pkg: { name: string }, entry: import("../../../src/types/index.js").IndexEntry) =>
                    _pkg.name === "correct" ? { ...entry, kind: "renamed" } : undefined,
            ],
            fhirResource: [
                (_pkg: { name: string }, resource: import("../../../src/types/index.js").Resource) => ({
                    ...resource,
                    patchedPackage: _pkg.name,
                }),
            ],
        };
        const fresh = createCanonicalManager({ packages: ["typo@1.0.0"], fetch: fixture.fetch, cache, patches });
        expect(await fresh.init()).toEqual({ "typo@1.0.0": { name: "correct", version: "1.0.0" } });
        const original = await fresh.resolveEntry(patientUrl);
        expect(original.package).toEqual({ name: "correct", version: "1.0.0" });
        expect(original.kind).toBe("renamed");
        const reloaded = createCanonicalManager({
            packages: ["typo@1.0.0"],
            cache,
            patches,
            fetch: async () => {
                throw new Error("offline");
            },
        });
        await reloaded.init();
        expect(await reloaded.packages()).toEqual([{ name: "correct", version: "1.0.0" }]);
        expect((await reloaded.packageJson("correct")).name).toBe("correct");
        expect((await reloaded.resolveEntry(patientUrl)).id).toBe(original.id);
        const resource = await reloaded.resolve(patientUrl, {
            package: "correct",
            sourceContext: { package: { name: "correct", version: "1.0.0" } },
        });
        expect(resource.patchedPackage).toBe("correct");
        const plain = createCanonicalManager({ packages: ["typo@1.0.0"], fetch: fixture.fetch, cache });
        await plain.init();
        expect((await plain.packageJson("typo")).name).toBe("typo");
        expect((await plain.resolveEntry(patientUrl)).kind).toBe("resource");
        expect(fixture.requests).toHaveLength(2); // Packument and archive; reloads use raw verified cache.
    });

    test("rejects incorrect raw manifest identities before a patch can disguise them, including cached data", async () => {
        for (const manifest of [{ name: "wrong" }, { version: "2.0.0" }]) {
            const fixture = await registryFixture([{ name: "a", version: "1.0.0", manifest }]);
            const cache = createMemoryCache();
            let patchCalls = 0;
            for (let attempt = 0; attempt < 2; attempt++) {
                const manager = createCanonicalManager({
                    packages: ["a@1.0.0"],
                    cache,
                    fetch: fixture.fetch,
                    patches: {
                        packageJson: [
                            (pkg, raw) => {
                                patchCalls++;
                                return { ...raw, name: pkg.name, version: pkg.version };
                            },
                        ],
                    },
                });
                await expect(manager.init()).rejects.toThrow("does not match a@1.0.0");
            }
            expect(patchCalls).toBe(0);
            expect(fixture.requests).toHaveLength(4); // Rejected identities are never committed to cache.
        }
    });

    test("does not expose previously cached packages, unrelated roots, or another registry", async () => {
        const cache = createMemoryCache();
        const one = await registryFixture([{ name: "a", version: "1.0.0", marker: "registry-one" }]);
        const two = await registryFixture([
            { name: "a", version: "1.0.0", marker: "registry-two" },
            { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
        ]);
        const first = createCanonicalManager({
            packages: ["a@1.0.0"],
            registry: "https://one.test/",
            cache,
            fetch: one.fetch,
        });
        await first.init();
        const second = createCanonicalManager({
            packages: ["a@1.0.0", "b@1.0.0"],
            registry: "https://two.test/",
            cache,
            fetch: two.fetch,
        });
        await second.init();
        expect((await second.resolve(patientUrl)).marker).toBe("registry-two");
        await expect(
            second.resolve(patientUrl, { sourceContext: { package: { name: "b", version: "1.0.0" } } }),
        ).rejects.toThrow("from b@1.0.0");
        const isolated = createCanonicalManager({
            packages: ["b@1.0.0"],
            registry: "https://two.test/",
            cache,
            fetch: two.fetch,
        });
        await isolated.init();
        expect(await isolated.packages()).toEqual([{ name: "b", version: "1.0.0" }]);
        await expect(isolated.resolve(patientUrl)).rejects.toThrow("Cannot resolve");
        expect((await first.resolve(patientUrl)).marker).toBe("registry-one");
    });

    test("applies manifest patches before dependencies, and resource/index patches per manager load", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", dependencies: { core: "1.0.0" }, url: `${patientUrl}-a` },
            { name: "core", version: "1.0.0" },
            { name: "core", version: "2.0.0" },
        ]);
        const cache = createMemoryCache();
        const patched = createCanonicalManager({
            packages: ["a@1.0.0"],
            cache,
            fetch: fixture.fetch,
            patches: {
                packageJson: [ensureDependency({ core: "2.0.0" })],
                indexEntry: [excludeCanonical({ url: patientUrl, reason: "fixture" })],
            },
        });
        await patched.init();
        expect((await patched.packages()).some((pkg) => pkg.name === "core" && pkg.version === "2.0.0")).toBe(true);
        await expect(patched.resolve(patientUrl)).rejects.toThrow("Cannot resolve");
        expect(patched.report()).toHaveLength(1);
        await patched.init();
        expect(patched.report()).toHaveLength(1);
        const plain = createCanonicalManager({
            packages: ["a@1.0.0"],
            cache,
            fetch: fixture.fetch,
            patches: { fhirResource: [(_pkg, resource) => ({ ...resource, patched: true })] },
        });
        await plain.init();
        expect((await plain.resolve(patientUrl)).marker).toBe("core@1.0.0");
        expect((await plain.resolve(patientUrl)).patched).toBe(true);
        await patched.destroy();
        expect(patched.report()).toEqual([]);
    });

    test("recovers malformed/incomplete indexes and reports recovery", async () => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0", files: { ".index.json": "invalid" } }]);
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: fixture.fetch,
            packageIndex: "recover",
        });
        await manager.init();
        expect((await manager.resolve(patientUrl)).marker).toBe("a@1.0.0");
        expect(manager.report()).toEqual([
            { kind: "index-recovery", package: { name: "a", version: "1.0.0" }, reason: "unparseable", recovered: 1 },
        ]);
    });

    test("persists raw packages and range selections in IndexedDB for offline reload", async () => {
        const database = `fcm-test-${crypto.randomUUID()}`;
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const cache = await createIndexedDbCache(database);
        const manager = createCanonicalManager({ packages: ["a@^1"], cache, fetch: fixture.fetch });
        await manager.init();
        const resource = await manager.resolve(patientUrl);
        await manager.destroy();
        cache.close();
        const reloadedCache = await createIndexedDbCache(database);
        const reloaded = createCanonicalManager({
            packages: ["a@^1"],
            cache: reloadedCache,
            fetch: async () => {
                throw new Error("offline");
            },
        });
        await reloaded.init();
        expect((await reloaded.resolve(patientUrl)).id).toBe(resource.id);
        await reloaded.destroy();
        reloadedCache.close();
    });

    test("serializes concurrent initialization/additions and keeps a usable graph after failure", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0" },
            { name: "b", version: "1.0.0", url: `${patientUrl}-b` },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
        await Promise.all([manager.init(), manager.addPackages("b@1.0.0")]);
        expect(await manager.packages()).toHaveLength(2);
        await expect(manager.addPackages("missing@1.0.0")).rejects.toThrow("404");
        expect((await manager.resolve(patientUrl)).marker).toBe("a@1.0.0");
        await manager.init();
        expect(await manager.packages()).toHaveLength(2);
        await manager.flushCache();
        await expect(manager.packages()).rejects.toThrow("not initialized");
        await manager.init();
        expect(await manager.packages()).toHaveLength(2);
    });
});
