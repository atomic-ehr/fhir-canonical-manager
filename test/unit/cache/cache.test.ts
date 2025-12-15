import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { computeCacheKey, createCacheRecord, loadCacheRecordFromDisk, saveCacheRecordToDisk } from "../../../src/cache";
import type { CacheData, ReferenceMetadata } from "../../../src/types";

describe("Cache Module", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cache-test-"));
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe("computeCacheKey", () => {
        test("should compute consistent hash for same packages", () => {
            const hash1 = computeCacheKey(["foo", "bar"]);
            const hash2 = computeCacheKey(["bar", "foo"]);

            expect(hash1).toBeDefined();
            expect(typeof hash1).toBe("string");
            expect(hash1.length).toBe(64); // SHA256 hex string length
            expect(hash1).toBe(hash2);
        });

        test("should compute different hashes for different package lists", () => {
            const hash1 = computeCacheKey(["package-lock-test", "bun-lock-test"]);
            const hash2 = computeCacheKey(["different-package"]);

            expect(hash1).not.toBe(hash2);
        });

        test("should handle empty package list", () => {
            const hash = computeCacheKey([]);

            expect(hash).toBeDefined();
            expect(typeof hash).toBe("string");
        });
    });

    describe("saveCacheToDisk", () => {
        test("should save cache to disk", async () => {
            const cache = createCacheRecord();
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            // Add some data to cache
            cache.entries["http://example.com/Patient"] = [
                {
                    id: "test-id",
                    resourceType: "Patient",
                    indexVersion: 1,
                    url: "http://example.com/Patient",
                },
            ];

            cache.packages["test.package"] = {
                id: { name: "test.package", version: "1.0.0" },
                path: "/path/to/package",
            };

            const metadata: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/file.json",
                resourceType: "Patient",
            };
            cache.referenceManager.set("ref-id", metadata);

            const cacheKey = computeCacheKey(["test.package"]);
            await saveCacheRecordToDisk(cache, cacheDir, cacheKey);

            const cacheFile = path.join(cacheDir, cacheKey, "index.json");
            const exists = await fs
                .access(cacheFile)
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(true);

            const content = await fs.readFile(cacheFile, "utf-8");
            const data = JSON.parse(content);

            expect(data.entries).toBeDefined();
            expect(data.packages).toBeDefined();
            expect(data.references).toBeDefined();
            expect(data.references["ref-id"]).toEqual(metadata);
        });

        test("should include cache key in saved data", async () => {
            const cache = createCacheRecord();
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            const cacheKey = computeCacheKey(["test.package"]);
            await saveCacheRecordToDisk(cache, cacheDir, cacheKey);

            const cacheFile = path.join(cacheDir, cacheKey, "index.json");
            const content = await fs.readFile(cacheFile, "utf-8");
            const data = JSON.parse(content);

            // cacheKey is now stored explicitly for validation
            expect(data.cacheKey).toBe(cacheKey);
            // packageLockHash is undefined when no lock file exists (no fallback to cacheKey)
            expect(data.packageLockHash).toBeUndefined();
        });
    });

    describe("loadCacheFromDisk", () => {
        test("should load cache from disk", async () => {
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            const cacheData: CacheData = {
                entries: {
                    "http://example.com/Patient": [
                        {
                            id: "test-id",
                            resourceType: "Patient",
                            indexVersion: 1,
                            url: "http://example.com/Patient",
                        },
                    ],
                },
                packages: {
                    "test.package": {
                        id: { name: "test.package", version: "1.0.0" },
                        path: "/path/to/package",
                    },
                },
                references: {
                    "ref-id": {
                        packageName: "test.package",
                        packageVersion: "1.0.0",
                        filePath: "/path/to/file.json",
                        resourceType: "Patient",
                    },
                },
                packageLockHash: "abc123",
            };

            const cacheKey = computeCacheKey(["test-package"]);
            const cacheSubdir = path.join(cacheDir, cacheKey);
            await fs.mkdir(cacheSubdir, { recursive: true });
            await fs.writeFile(path.join(cacheSubdir, "index.json"), JSON.stringify(cacheData, null, 2));

            const loaded = await loadCacheRecordFromDisk(cacheDir, cacheKey);

            expect(loaded).toEqual(cacheData);
        });

        test("should return undefined when cache file does not exist", async () => {
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            const cacheKey = computeCacheKey(["test-package"]);
            const loaded = await loadCacheRecordFromDisk(cacheDir, cacheKey);

            expect(loaded).toBeUndefined();
        });

        test("should return undefined for invalid JSON", async () => {
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            const cacheKey = computeCacheKey(["test-package"]);
            const cacheSubdir = path.join(cacheDir, cacheKey);
            await fs.mkdir(cacheSubdir, { recursive: true });
            await fs.writeFile(path.join(cacheSubdir, "index.json"), "invalid json content");

            const loaded = await loadCacheRecordFromDisk(cacheDir, cacheKey);

            expect(loaded).toBeUndefined();
        });

        test("should return undefined when directory does not exist", async () => {
            const cacheKey = computeCacheKey(["test-package"]);
            const loaded = await loadCacheRecordFromDisk("/non/existent/path", cacheKey);
            expect(loaded).toBeUndefined();
        });
    });

    describe("Cache integration", () => {
        test("should round-trip cache data", async () => {
            const cache = createCacheRecord();
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            // Add complex data
            cache.entries["http://example.com/Patient"] = [
                {
                    id: "id1",
                    resourceType: "Patient",
                    indexVersion: 1,
                    url: "http://example.com/Patient",
                    kind: "resource",
                    type: "Patient",
                    version: "1.0.0",
                    package: {
                        name: "test.package",
                        version: "1.0.0",
                    },
                },
                {
                    id: "id2",
                    resourceType: "Patient",
                    indexVersion: 1,
                    url: "http://example.com/Patient",
                    kind: "resource",
                    type: "Patient",
                    version: "2.0.0",
                    package: {
                        name: "test.package",
                        version: "2.0.0",
                    },
                },
            ];

            const metadata1: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "1.0.0",
                filePath: "/path/to/v1/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
                version: "1.0.0",
            };

            const metadata2: ReferenceMetadata = {
                packageName: "test.package",
                packageVersion: "2.0.0",
                filePath: "/path/to/v2/file.json",
                resourceType: "Patient",
                url: "http://example.com/Patient",
                version: "2.0.0",
            };

            cache.referenceManager.set("id1", metadata1);
            cache.referenceManager.set("id2", metadata2);

            // Save
            const cacheKey = computeCacheKey(["test.package"]);
            await saveCacheRecordToDisk(cache, cacheDir, cacheKey);

            // Load
            const loaded = await loadCacheRecordFromDisk(cacheDir, cacheKey);

            expect(loaded).not.toBeUndefined();
            expect(loaded?.entries).toEqual(cache.entries);
            expect(loaded?.references.id1).toEqual(metadata1);
            expect(loaded?.references.id2).toEqual(metadata2);
        });
    });
});
