import { afterEach, describe, expect, test } from "bun:test";
import { createMemoryCache } from "../../../src/browser/cache.js";
import { createCanonicalManager as createManager } from "../../../src/browser/manager.js";
import { parsePackageSpec } from "../../../src/browser/package-spec.js";
import { packageArchive, registryFixture } from "../../browser/fixture.js";

const managers: ReturnType<typeof createManager>[] = [];
function createCanonicalManager(config: Parameters<typeof createManager>[0]) {
    const manager = createManager(config);
    managers.push(manager);
    return manager;
}
afterEach(async () => {
    await Promise.all(managers.splice(0).map((manager) => manager.destroy()));
});

describe("verified FHIR registry adapter", () => {
    test("accepts a valid absent optional peer without adding a dependency binding", async () => {
        const fixture = await registryFixture([
            {
                name: "a",
                version: "1.0.0",
                manifest: {
                    peerDependencies: { missing: "1.0.0" },
                    peerDependenciesMeta: { missing: { optional: true } },
                },
            },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
        await manager.init();
        expect(await manager.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
        expect(await manager.packageJson("a")).toMatchObject({
            peerDependencies: { missing: "1.0.0" },
            peerDependenciesMeta: { missing: { optional: true } },
        });
        expect(fixture.requests.some((url) => url.endsWith("/missing"))).toBe(false);
        await manager.destroy();
    });

    test("rejects a missing required peer and does not commit provisional cache entries", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", manifest: { peerDependencies: { missing: "1.0.0" } } },
        ]);
        const cache = createMemoryCache();
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
        });
        await expect(manager.init()).rejects.toThrow("404");
        await expect(manager.packages()).rejects.toThrow("not initialized");
        expect(commits).toBe(0);
        expect(fixture.requests.some((url) => url.endsWith("/missing"))).toBe(true);
    });

    test("checks cached raw identity before a rename patch can disguise it", async () => {
        const pkg = { name: "a", version: "1.0.0", manifest: { name: "wrong" } };
        const fixture = await registryFixture([pkg]);
        const bytes = await packageArchive(pkg);
        const cache = createMemoryCache();
        let patches = 0;
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: fixture.fetch,
            cache: {
                ...cache,
                async get<T>(key: string) {
                    return (key.includes("|archive:") ? bytes : undefined) as T | undefined;
                },
            },
            patches: {
                packageJson: [
                    (id, raw) => {
                        patches++;
                        return { ...raw, name: id.name };
                    },
                ],
            },
        });
        await expect(manager.init()).rejects.toThrow("does not match a@1.0.0");
        expect(patches).toBe(0);
        expect(fixture.requests).toHaveLength(1); // Signed archive came from cache.
    });

    test("does not silently omit an optional package with invalid integrity", async () => {
        const fixture = await registryFixture([
            { name: "a", version: "1.0.0", manifest: { optionalDependencies: { bad: "1.0.0" } } },
            { name: "bad", version: "1.0.0" },
        ]);
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: async (...args) => {
                const response = await fixture.fetch(...args);
                if (!String(args[0]).endsWith("bad/1.0.0")) return response;
                return new Response(new Uint8Array([1, 2, 3]));
            },
        });
        await expect(manager.init()).rejects.toThrow("EINTEGRITY");
        await expect(manager.packages()).rejects.toThrow("not initialized");
    });

    test("treats lifecycle scripts as data and never sends their requested HTTP traffic", async () => {
        const fixture = await registryFixture([
            {
                name: "a",
                version: "1.0.0",
                manifest: {
                    scripts: { preinstall: "node -e \"fetch('https://registry.npmjs.org/EXECUTED')\"" },
                },
            },
        ]);
        const manager = createCanonicalManager({ packages: ["a@1.0.0"], fetch: fixture.fetch });
        await manager.init();
        expect(await manager.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
        expect(fixture.requests.some((url) => url.includes("registry.npmjs.org"))).toBe(false);
    });
    test("delegates range, tag and prerelease selection to npm", async () => {
        const fixture = await registryFixture(
            ["1.0.0-alpha.2", "1.0.0-alpha.10", "1.0.0", "1.9.0", "2.0.0"].map((version) => ({ name: "a", version })),
        );
        for (const [selector, version] of [
            [">=1.0.0-alpha.0 <1.0.0", "1.0.0-alpha.10"],
            ["^1", "1.9.0"],
            ["latest", "2.0.0"],
            ["1.0.0-alpha.2", "1.0.0-alpha.2"],
        ] as [string, string][]) {
            const manager = createCanonicalManager({ packages: [`a@${selector}`], fetch: fixture.fetch });
            expect(await manager.init()).toEqual({ [`a@${selector}`]: { name: "a", version } });
        }
        expect(parsePackageSpec("@example/core@^1")).toEqual({ name: "@example/core", version: "^1" });
        for (const spec of [
            "a@https://registry.npmjs.org/a.tgz",
            "a@file:../a",
            "a@npm:b@1",
            "../a@1",
            ".@1",
            "..@1",
            "a#current",
            "a@",
            "a@>=1 || http://evil.test",
        ])
            expect(() => parsePackageSpec(spec)).toThrow();
    });

    test("retries a failed initialization without committing provisional metadata or falling back", async () => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        let calls = 0;
        const manager = createCanonicalManager({
            packages: ["a@latest"],
            registry: "https://registry.test/fhir/",
            cache: createMemoryCache(),
            fetch: async (...args) =>
                calls++ === 0 ? new Response("temporary", { status: 503 }) : fixture.fetch(...args),
        });
        await expect(manager.init()).rejects.toThrow("503");
        expect(await manager.init()).toEqual({ "a@latest": { name: "a", version: "1.0.0" } });
        await expect(manager.addPackages("missing@1.0.0")).rejects.toThrow("404");
        expect(await manager.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
        expect(fixture.requests.every((url) => url.startsWith("https://registry.test/fhir/"))).toBe(true);
    });

    test("rejects archive checksum failures before patches or cache commit", async () => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const cache = createMemoryCache();
        let commits = 0;
        let patches = 0;
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
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
                        patches++;
                        return undefined;
                    },
                ],
            },
            fetch: async (...args) => {
                const response = await fixture.fetch(...args);
                if (!String(args[0]).endsWith("/1.0.0")) return response;
                const bytes = new Uint8Array(await response.arrayBuffer());
                bytes[20] = (bytes[20] ?? 0) ^ 1;
                return new Response(bytes);
            },
        });
        await expect(manager.init()).rejects.toThrow("EINTEGRITY");
        expect(commits).toBe(0);
        expect(patches).toBe(0);
        await expect(manager.packages()).rejects.toThrow("not initialized");
    });

    test("rejects cross-origin tarballs without contacting them", async () => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            fetch: async (...args) => {
                const response = await fixture.fetch(...args);
                const data = (await response.json()) as { versions: Record<string, { dist: { tarball: string } }> };
                const version = data.versions["1.0.0"];
                if (!version) throw new Error("Fixture version missing");
                version.dist.tarball = "https://registry.npmjs.org/a.tgz";
                return Response.json(data);
            },
        });
        await expect(manager.init()).rejects.toThrow("outside configured registry origin");
        expect(fixture.requests).toHaveLength(1);
    });

    test("cancels pending fetches and leaves existing state and cache usable", async () => {
        const fixture = await registryFixture([{ name: "a", version: "1.0.0" }]);
        const abort = new AbortController();
        const cache = createMemoryCache();
        let pendingStarted: (() => void) | undefined;
        const pending = new Promise<void>((resolve) => {
            pendingStarted = resolve;
        });
        const manager = createCanonicalManager({
            packages: ["a@1.0.0"],
            cache,
            signal: abort.signal,
            fetch: async (input, init) => {
                if (!String(input).endsWith("/missing")) return fixture.fetch(input, init);
                pendingStarted?.();
                return new Promise((_resolve, reject) =>
                    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }),
                );
            },
        });
        await manager.init();
        const adding = manager.addPackages("missing@1.0.0");
        await pending;
        abort.abort(new Error("user cancelled"));
        await expect(adding).rejects.toThrow("user cancelled");
        expect(await manager.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
        const reloaded = createCanonicalManager({
            packages: ["a@1.0.0"],
            cache,
            fetch: async () => {
                throw new Error("offline");
            },
        });
        await reloaded.init();
        expect(await reloaded.packages()).toEqual([{ name: "a", version: "1.0.0" }]);
    });
});
