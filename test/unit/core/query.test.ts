import { describe, expect, test } from "bun:test";
import type { CanonicalQueryAdapter } from "../../../src/core/query.js";
import { createCanonicalQuery, filterEntryCandidates } from "../../../src/core/query.js";
import type { IndexEntry, Resource } from "../../../src/types/index.js";

const url = "http://example.org/StructureDefinition/Patient";
const entries: IndexEntry[] = [
    {
        id: "first",
        resourceType: "StructureDefinition",
        indexVersion: 1,
        url,
        version: "clinical-1",
        type: "Patient",
        kind: "resource",
        package: { name: "example.core", version: "4.0.1" },
    },
    {
        id: "second",
        resourceType: "StructureDefinition",
        indexVersion: 1,
        url,
        version: "clinical-2",
        type: "Patient",
        kind: "resource",
        package: { name: "example.ig", version: "2.0.0" },
    },
];

function createFixture(overrides: Partial<CanonicalQueryAdapter> = {}) {
    const reads: string[] = [];
    const query = createCanonicalQuery({
        async findEntriesByUrl(canonical) {
            return entries.filter((entry) => entry.url === canonical);
        },
        async findEntries(params) {
            const candidates = params.url ? entries.filter((entry) => entry.url === params.url) : entries;
            return filterEntryCandidates(candidates, params);
        },
        async read(reference) {
            reads.push(reference.id);
            return { ...reference, url };
        },
        ...overrides,
    });
    return { query, reads };
}

describe("shared canonical queries", () => {
    test("keeps resolution order, resource versions and exact package filters distinct", async () => {
        const { query, reads } = createFixture();
        expect((await query.resolveEntry(url)).id).toBe("first");
        expect((await query.resolveEntry(url, { version: "clinical-2" })).id).toBe("second");
        expect((await query.resolveEntry(url, { package: "example.ig" })).id).toBe("second");
        await expect(query.resolveEntry(url, { version: "2.0.0" })).rejects.toThrow("with given options");
        expect(await query.searchEntries({ package: { name: "example.ig", version: "2.0.0" } })).toEqual([
            entries[1] as IndexEntry,
        ]);
        expect(await query.searchEntries({ package: { name: "example.ig", version: "clinical-2" } })).toEqual([]);
        expect(reads).toEqual([]);
    });

    test("reads only selected resources and preserves smart-search filters", async () => {
        const { query, reads } = createFixture();
        expect(await query.smartSearch(["pat"], { resourceType: "StructureDefinition", type: "Patient" })).toEqual(
            entries,
        );
        expect(await query.smartSearch(["pat"], { resourceType: "ValueSet" })).toEqual([]);
        expect(reads).toEqual([]);
        await query.resolve(url, { package: "example.ig" });
        expect(reads).toEqual(["second"]);
        await query.search({ version: "clinical-1" });
        expect(reads).toEqual(["second", "first"]);
    });

    test("delegates context resolution and falls back only when the adapter returns null", async () => {
        const seen: string[] = [];
        const { query } = createFixture({
            async resolveWithContext(canonical, context, resolveEntry) {
                seen.push(context.id ?? "");
                return context.id === "local" ? resolveEntry(canonical, { package: "example.ig" }) : null;
            },
        });
        expect((await query.resolveEntry(url, { sourceContext: { id: "local" } })).id).toBe("second");
        expect((await query.resolveEntry(url, { sourceContext: { id: "missing" } })).id).toBe("first");
        expect(seen).toEqual(["local", "missing"]);
        await expect(query.resolveEntry("http://example.org/missing")).rejects.toThrow(
            "Cannot resolve canonical URL: http://example.org/missing",
        );
    });

    test("caches SearchParameters per type and invalidates them when the manager rebuilds", async () => {
        const resources: Resource[] = [
            { id: "z", resourceType: "SearchParameter", base: ["Patient"], code: "z" },
            { id: "a", resourceType: "SearchParameter", base: ["Patient", "Observation"], code: "a" },
            { id: "unrelated", resourceType: "SearchParameter", base: ["Encounter"], code: "e" },
        ];
        let reads = 0;
        const { query } = createFixture({
            async findEntries() {
                return resources.map((resource) => ({ ...resource, indexVersion: 1 }));
            },
            async read(reference) {
                reads++;
                return resources.find((resource) => resource.id === reference.id) as Resource;
            },
        });
        expect((await query.getSearchParametersForResource("Patient")).map((resource) => resource.code)).toEqual([
            "a",
            "z",
        ]);
        await query.getSearchParametersForResource("Patient");
        expect(reads).toBe(3);
        query.clearSearchParameterCache();
        await query.getSearchParametersForResource("Patient");
        expect(reads).toBe(6);
        expect((await query.getSearchParametersForResource("Observation")).map((resource) => resource.code)).toEqual([
            "a",
        ]);
    });
});
