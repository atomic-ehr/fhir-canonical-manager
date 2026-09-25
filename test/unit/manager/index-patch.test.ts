import { describe, expect, test } from "bun:test";
import { createCacheRecord, type ExtendedCache } from "../../../src/cache";
import { applyIndexEntryPatches } from "../../../src/manager/index-patch";
import { excludeCanonical } from "../../../src/patches";
import type { IndexEntry, ReportEntry } from "../../../src/types";

const PKG = { name: "test.package", version: "1.0.0" };

/** Populate a cache the way `commitEntries` does, so the fold sees a realistic index. */
const cacheWith = (...urls: string[]): ExtendedCache => {
    const cache = createCacheRecord();
    for (const url of urls) {
        const filePath = `/pkg/${url.split("/").pop()}.json`;
        const id = cache.referenceManager.generateId({
            packageName: PKG.name,
            packageVersion: PKG.version,
            filePath,
        });
        const entry: IndexEntry = {
            id,
            resourceType: "StructureDefinition",
            indexVersion: 1,
            url,
            version: "1.0.0",
            package: PKG,
        };
        (cache.entries[url] ??= []).push(entry);
        cache.referenceManager.set(id, {
            packageName: PKG.name,
            packageVersion: PKG.version,
            filePath,
            resourceType: "StructureDefinition",
            url,
            version: "1.0.0",
        });
    }
    return cache;
};

const noReport = () => {};

describe("applyIndexEntryPatches", () => {
    test("drops an excluded canonical from the index and the reference manager", () => {
        const cache = cacheWith("http://ex/Good", "http://ex/Bad");
        const reported: ReportEntry[] = [];

        applyIndexEntryPatches(cache, [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version" })], (e) =>
            reported.push(e),
        );

        expect(cache.entries["http://ex/Good"]).toHaveLength(1);
        expect(cache.entries["http://ex/Bad"]).toBeUndefined();
        expect(cache.referenceManager.size()).toBe(1);
        expect(cache.referenceManager.getIdsByUrl("http://ex/Bad")).toEqual([]);
        expect(reported.some((e) => e.kind === "exclusion" && e.url === "http://ex/Bad")).toBe(true);
    });

    test("re-keys a rewritten url in both the index and the reference metadata", () => {
        const cache = cacheWith("http://ex/Typo");
        const originalId = cache.referenceManager.getIdsByUrl("http://ex/Typo")[0] as string;

        applyIndexEntryPatches(
            cache,
            [(_pkg, entry) => (entry.url === "http://ex/Typo" ? { ...entry, url: "http://ex/Fixed" } : undefined)],
            noReport,
        );

        expect(cache.entries["http://ex/Fixed"]?.[0]?.url).toBe("http://ex/Fixed");
        expect(cache.entries["http://ex/Typo"]).toBeUndefined();

        // An id left in the old bucket would resolve to metadata pointing elsewhere.
        expect(cache.referenceManager.getIdsByUrl("http://ex/Fixed")).toEqual([originalId]);
        expect(cache.referenceManager.getIdsByUrl("http://ex/Typo")).toEqual([]);
        expect(cache.referenceManager.get(originalId)?.url).toBe("http://ex/Fixed");
        // `filePath` lives only in the metadata; losing it would make the resource unreadable.
        expect(cache.referenceManager.get(originalId)?.filePath).toBe("/pkg/Typo.json");
    });

    test("drops an entry whose url a patch cleared", () => {
        const cache = cacheWith("http://ex/Good", "http://ex/Cleared");

        applyIndexEntryPatches(
            cache,
            [(_pkg, entry) => (entry.url === "http://ex/Cleared" ? { ...entry, url: undefined } : undefined)],
            noReport,
        );

        expect(cache.entries["http://ex/Good"]).toHaveLength(1);
        expect(cache.entries["http://ex/Cleared"]).toBeUndefined();
        expect(cache.referenceManager.size()).toBe(1);
    });

    test("leaves the cache untouched when no handlers are configured", () => {
        const cache = cacheWith("http://ex/A", "http://ex/B");
        const before = structuredClone(cache.entries);
        const refsBefore = { ...cache.referenceManager.getAllReferences() };

        applyIndexEntryPatches(cache, [], noReport);
        applyIndexEntryPatches(cache, undefined, noReport);

        expect(cache.entries).toEqual(before);
        expect(cache.referenceManager.getAllReferences()).toEqual(refsBefore);
    });

    test("a no-op handler preserves the index, the references, and within-bucket order", () => {
        const cache = cacheWith("http://ex/A", "http://ex/B");
        // Two entries under one url — `resolveEntry` picks by position, so order matters.
        const first = (cache.entries["http://ex/A"] as IndexEntry[])[0] as IndexEntry;
        cache.entries["http://ex/A"]?.push({ ...first, id: "second" });
        cache.referenceManager.set("second", {
            packageName: PKG.name,
            packageVersion: PKG.version,
            filePath: "/pkg/A2.json",
            resourceType: "StructureDefinition",
            url: "http://ex/A",
            // The fold re-derives this from the entry, so the fixture must agree.
            version: first.version,
        });
        const before = structuredClone(cache.entries);
        const refsBefore = { ...cache.referenceManager.getAllReferences() };

        applyIndexEntryPatches(cache, [() => undefined], noReport);

        expect(cache.entries).toEqual(before);
        expect((cache.entries["http://ex/A"] as IndexEntry[]).map((e) => e.id)).toEqual([first.id, "second"]);
        expect(cache.referenceManager.getAllReferences()).toEqual(refsBefore);
    });

    test("scopes handlers by the stored reference identity, not the patchable entry.package", () => {
        const cache = cacheWith("http://ex/Good");
        const id = cache.referenceManager.getIdsByUrl("http://ex/Good")[0] as string;
        // `entry.package` is patchable; the metadata is what `read()` scopes by.
        const entry = (cache.entries["http://ex/Good"] as IndexEntry[])[0] as IndexEntry;
        entry.package = { name: "other.package", version: "9.9.9" };

        const seen: string[] = [];
        applyIndexEntryPatches(
            cache,
            [
                (pkg) => {
                    seen.push(`${pkg.name}@${pkg.version}`);
                    return undefined;
                },
            ],
            noReport,
        );

        expect(seen).toEqual(["test.package@1.0.0"]);
        expect(cache.referenceManager.get(id)?.packageName).toBe("test.package");
    });

    test("passes an entry through when neither the metadata nor the entry names a package", () => {
        const cache = createCacheRecord();
        // A cached index can predate `package` being written, and carry no matching reference.
        cache.entries["http://ex/Orphan"] = [
            { id: "orphan", resourceType: "StructureDefinition", indexVersion: 1, url: "http://ex/Orphan" },
        ];

        expect(() =>
            applyIndexEntryPatches(cache, [excludeCanonical({ url: "http://ex/Orphan", reason: "x" })], noReport),
        ).not.toThrow();
        expect(cache.entries["http://ex/Orphan"]).toHaveLength(1);
    });
});
