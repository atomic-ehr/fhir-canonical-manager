import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { computePackageLockHash, createCache, loadCacheFromDisk, saveCacheToDisk } from "../../../src/cache";
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

    describe("createCache", () => {
        test("should create a cache with all required properties", () => {
            const cache = createCache();

            expect(cache.entries).toEqual({});
            expect(cache.packages).toEqual({});
            expect(cache.references).toEqual({});
            expect(cache.referenceManager).toBeDefined();
            expect(cache.referenceManager.generateId).toBeDefined();
        });

        test("should create independent cache instances", () => {
            const cache1 = createCache();
            const cache2 = createCache();

            cache1.entries.test = [];

            expect(cache2.entries.test).toBeUndefined();
        });
    });

    describe("computePackageLockHash", () => {
        test("should compute hash for package-lock.json", async () => {
            const packageLockContent = JSON.stringify({
                name: "test",
                version: "1.0.0",
                lockfileVersion: 2,
            });

            await fs.writeFile(path.join(tempDir, "package-lock.json"), packageLockContent);

            const hash = await computePackageLockHash(tempDir);

            expect(hash).toBeDefined();
            expect(typeof hash).toBe("string");
            expect(hash?.length).toBe(64); // SHA256 hex string length
        });

        test("should compute hash for bun.lock", async () => {
            const bunLockContent = "lockfileVersion: 5.2\n";

            await fs.writeFile(path.join(tempDir, "bun.lock"), bunLockContent);

            const hash = await computePackageLockHash(tempDir);

            expect(hash).toBeDefined();
            expect(typeof hash).toBe("string");
        });

        test("should prefer package-lock.json over bun.lock", async () => {
            const packageLockContent = "package-lock content";
            const bunLockContent = "bun.lock content";

            await fs.writeFile(path.join(tempDir, "package-lock.json"), packageLockContent);
            await fs.writeFile(path.join(tempDir, "bun.lock"), bunLockContent);

            const hash = await computePackageLockHash(tempDir);

            // Hash should be of package-lock.json content
            const expectedHash = require("node:crypto").createHash("sha256").update(packageLockContent).digest("hex");

            expect(hash).toBe(expectedHash);
        });

        test("should return null when no lock file exists", async () => {
            const hash = await computePackageLockHash(tempDir);
            expect(hash).toBeNull();
        });

        test("should return null for non-existent directory", async () => {
            const hash = await computePackageLockHash("/non/existent/path");
            expect(hash).toBeNull();
        });
    });

    describe("saveCacheToDisk", () => {
        test("should save cache to disk", async () => {
            const cache = createCache();
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

            await saveCacheToDisk(cache, cacheDir, tempDir);

            const cacheFile = path.join(cacheDir, "index.json");
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

        test("should include package lock hash when available", async () => {
            const cache = createCache();
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            // Create a package-lock.json
            await fs.writeFile(path.join(tempDir, "package-lock.json"), JSON.stringify({ version: "1.0.0" }));

            await saveCacheToDisk(cache, cacheDir, tempDir);

            const cacheFile = path.join(cacheDir, "index.json");
            const content = await fs.readFile(cacheFile, "utf-8");
            const data = JSON.parse(content);

            expect(data.packageLockHash).toBeDefined();
            expect(typeof data.packageLockHash).toBe("string");
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

            await fs.writeFile(path.join(cacheDir, "index.json"), JSON.stringify(cacheData, null, 2));

            const loaded = await loadCacheFromDisk(cacheDir);

            expect(loaded).toEqual(cacheData);
        });

        test("should return null when cache file does not exist", async () => {
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            const loaded = await loadCacheFromDisk(cacheDir);

            expect(loaded).toBeNull();
        });

        test("should return null for invalid JSON", async () => {
            const cacheDir = path.join(tempDir, "cache");
            await fs.mkdir(cacheDir, { recursive: true });

            await fs.writeFile(path.join(cacheDir, "index.json"), "invalid json content");

            const loaded = await loadCacheFromDisk(cacheDir);

            expect(loaded).toBeNull();
        });

        test("should return null when directory does not exist", async () => {
            const loaded = await loadCacheFromDisk("/non/existent/path");
            expect(loaded).toBeNull();
        });
    });

    describe("Cache integration", () => {
        test("should round-trip cache data", async () => {
            const cache = createCache();
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
            await saveCacheToDisk(cache, cacheDir, tempDir);

            // Load
            const loaded = await loadCacheFromDisk(cacheDir);

            expect(loaded).not.toBeNull();
            expect(loaded?.entries).toEqual(cache.entries);
            expect(loaded?.references.id1).toEqual(metadata1);
            expect(loaded?.references.id2).toEqual(metadata2);
        });
    });
});
