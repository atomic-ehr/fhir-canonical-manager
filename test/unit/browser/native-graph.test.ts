import { expect, test } from "bun:test";
import { createMemoryCache } from "../../../src/browser/cache.js";
import { createWorkerClient } from "../../../src/browser/worker-client.js";

import { type FixturePackage, registryFixture } from "../../browser/fixture.js";

test("integrated browser graph copies native Arborist locations, edges and cycle links", async () => {
    const cycle: FixturePackage[] = [
        { name: "a", version: "1.0.0", dependencies: { b: "2.0.0" } },
        { name: "b", version: "2.0.0", dependencies: { a: "2.0.0" } },
        { name: "a", version: "2.0.0", dependencies: { b: "1.0.0" } },
        { name: "b", version: "1.0.0", dependencies: { a: "1.0.0" } },
    ];
    const cases: { roots: Record<string, string>; packages: FixturePackage[] }[] = [
        {
            roots: { one: "1.0.0", two: "1.0.0" },
            packages: [
                { name: "one", version: "1.0.0", dependencies: { core: "1.0.0" } },
                { name: "two", version: "1.0.0", dependencies: { core: "2.0.0" } },
                { name: "core", version: "1.0.0" },
                { name: "core", version: "2.0.0" },
            ],
        },
        { roots: { a: "1.0.0" }, packages: cycle },
        {
            roots: { a: "1.0.0" },
            packages: [
                {
                    name: "a",
                    version: "1.0.0",
                    manifest: {
                        peerDependencies: { missing: "1.0.0" },
                        peerDependenciesMeta: { missing: { optional: true } },
                    },
                },
            ],
        },
        {
            roots: { a: "3.0.0", b: "3.0.0", one: "1.0.0", two: "1.0.0" },
            packages: [
                ...cycle,
                { name: "a", version: "3.0.0" },
                { name: "b", version: "3.0.0" },
                { name: "one", version: "1.0.0", dependencies: { a: "1.0.0" } },
                { name: "two", version: "1.0.0", dependencies: { a: "1.0.0" } },
            ],
        },
    ];
    for (const fixtureCase of cases) {
        const fixture = await registryFixture(fixtureCase.packages);
        const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            async fetch(request) {
                const response = fixture.handle(new URL(request.url));
                if (!response.headers.get("content-type")?.includes("application/json")) return response;
                // Native pacote receives complete fixture metadata; browser hydration
                // independently verifies and reads the same archive manifests.
                const metadata = (await response.json()) as {
                    versions: Record<string, { name: string; version: string; dependencies?: Record<string, string> }>;
                };
                for (const manifest of Object.values(metadata.versions)) {
                    const original = fixtureCase.packages.find(
                        (pkg) => pkg.name === manifest.name && pkg.version === manifest.version,
                    );
                    Object.assign(manifest, original?.manifest, { dependencies: original?.dependencies });
                }
                return Response.json(metadata);
            },
        });
        try {
            const registry = `http://127.0.0.1:${server.port}/`;
            const native = Bun.spawn(
                ["node", "test/browser/native-engine.ts", registry, JSON.stringify(fixtureCase.roots)],
                { stdout: "pipe", stderr: "pipe" },
            );
            const [stdout, stderr, exit] = await Promise.all([
                new Response(native.stdout).text(),
                new Response(native.stderr).text(),
                native.exited,
            ]);
            expect(stderr).not.toContain("Error");
            expect(exit).toBe(0);
            const expected = JSON.parse(stdout) as { nodeVersion: string; graph: unknown[]; absentEdges: unknown[] };
            expect(expected.nodeVersion).toMatch(/^v(22|24|26)\./);
            if (fixtureCase.packages.some((pkg) => pkg.manifest?.peerDependenciesMeta))
                expect(expected.absentEdges).toEqual([{ name: "missing", optional: true, valid: true, error: null }]);
            const client = createWorkerClient({ cache: createMemoryCache() });
            let snapshot: import("../../../src/browser/protocol.js").Snapshot;
            try {
                snapshot = await client.prepare({
                    registry,
                    specs: Object.entries(fixtureCase.roots).map(([name, version]) => `${name}@${version}`),
                    mode: "regenerate",
                    deprecatedIndexOption: false,
                });
            } finally {
                client.close();
            }
            const graph = snapshot.nodes
                .map((node) => ({
                    scope: node.scope,
                    name: node.transport.name,
                    version: node.transport.version,
                    linkTarget: node.linkTarget,
                    dependencies: node.dependencies.toSorted((a, b) => a.name.localeCompare(b.name)),
                }))
                .sort((a, b) => a.scope.localeCompare(b.scope));
            expect(JSON.parse(JSON.stringify(graph))).toEqual(expected.graph);
        } finally {
            server.stop(true);
        }
    }
}, 20_000);
