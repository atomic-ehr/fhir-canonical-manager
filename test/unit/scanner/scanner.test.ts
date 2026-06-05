import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createCacheRecord } from "../../../src/cache";
import { excludeCanonical } from "../../../src/patches";
import {
    isValidFileEntry,
    isValidIndexFile,
    loadPackage,
    loadPackagesIntoCache,
    parseIndex,
    processIndex,
    type ScanOptions,
} from "../../../src/scanner";
import type { PackageIndexMode, PackageJson, Patches, PatchReportSink, ReportEntry } from "../../../src/types";

/** Write an empty stub file so processIndex's fileExists check passes. */
const touchFile = (filePath: string) => fs.writeFile(filePath, "{}");

/** ScanOptions with a no-op patch + no-op report; override per test. Patches are normalized
 *  from a partial (every phase defaults to an empty handler list). */
const mkScanOptions = (
    overrides: { packageIndexMode?: PackageIndexMode; patches?: Partial<Patches>; report?: PatchReportSink } = {},
): ScanOptions => ({
    packageIndexMode: overrides.packageIndexMode ?? "use",
    report: overrides.report ?? (() => {}),
    patches: {
        package: overrides.patches?.package ?? [],
        entry: overrides.patches?.entry ?? [],
        resource: overrides.patches?.resource ?? [],
    },
});

describe("Scanner Module", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scanner-test-"));
    });

    afterEach(async () => {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    });

    describe("isValidFileEntry", () => {
        test("should validate correct file entry", () => {
            const entry = {
                filename: "Patient.json",
                resourceType: "StructureDefinition",
                id: "Patient",
                url: "http://hl7.org/fhir/StructureDefinition/Patient",
                version: "4.0.1",
                kind: "resource",
                type: "Patient",
            };

            expect(isValidFileEntry(entry)).toBe(true);
        });

        test("should validate minimal file entry", () => {
            const entry = {
                filename: "Patient.json",
                resourceType: "StructureDefinition",
                id: "Patient",
            };

            expect(isValidFileEntry(entry)).toBe(true);
        });

        test("should reject entry without required fields", () => {
            expect(isValidFileEntry({})).toBe(false);
            expect(isValidFileEntry({ filename: "test.json" })).toBe(false);
            expect(isValidFileEntry({ filename: "test.json", resourceType: "Test" })).toBe(false);
        });

        test("should reject entry with wrong field types", () => {
            const entry = {
                filename: 123, // Should be string
                resourceType: "StructureDefinition",
                id: "Patient",
            };

            expect(isValidFileEntry(entry)).toBe(false);
        });

        test("should reject null or undefined", () => {
            expect(isValidFileEntry(null)).toBe(false);
            expect(isValidFileEntry(undefined)).toBe(false);
        });

        test("should accept null values in optional fields (UK Core compatibility)", () => {
            // UK Core packages have entries with "kind": null
            const entry = {
                filename: "UKCore-Patient.json",
                resourceType: "StructureDefinition",
                id: "UKCore-Patient",
                url: "https://fhir.hl7.org.uk/StructureDefinition/UKCore-Patient",
                version: "2.0.0",
                kind: null,
                type: null,
            };

            expect(isValidFileEntry(entry)).toBe(true);
        });
    });

    describe("isValidIndexFile", () => {
        test("should validate correct index file", () => {
            const index = {
                "index-version": 1,
                files: [
                    {
                        filename: "Patient.json",
                        resourceType: "StructureDefinition",
                        id: "Patient",
                    },
                ],
            };

            expect(isValidIndexFile(index)).toBe(true);
        });

        test("should validate empty files array", () => {
            const index = {
                "index-version": 1,
                files: [],
            };

            expect(isValidIndexFile(index)).toBe(true);
        });

        test("should reject missing index-version", () => {
            const index = {
                files: [],
            };

            expect(isValidIndexFile(index)).toBe(false);
        });

        test("should reject non-numeric index-version", () => {
            const index = {
                "index-version": "1",
                files: [],
            };

            expect(isValidIndexFile(index)).toBe(false);
        });

        test("should reject invalid file entries", () => {
            const index = {
                "index-version": 1,
                files: [{ filename: "valid.json", resourceType: "Test", id: "test" }, { invalid: "entry" }],
            };

            expect(isValidIndexFile(index)).toBe(false);
        });

        test("should accept index-version 0 (UK Core compatibility)", () => {
            // UK Core packages use index-version: 0
            const index = {
                "index-version": 0,
                files: [
                    {
                        filename: "UKCore-Patient.json",
                        resourceType: "StructureDefinition",
                        id: "UKCore-Patient",
                    },
                ],
            };

            expect(isValidIndexFile(index)).toBe(true);
        });
    });

    describe("parseIndex", () => {
        test("should parse valid JSON index", () => {
            const indexContent = JSON.stringify({
                "index-version": 1,
                files: [
                    {
                        filename: "Patient.json",
                        resourceType: "StructureDefinition",
                        id: "Patient",
                        url: "http://hl7.org/fhir/StructureDefinition/Patient",
                    },
                ],
            });

            const result = parseIndex(indexContent, "test.json");

            expect(result).not.toBeNull();
            expect(result?.["index-version"]).toBe(1);
            expect(result?.files).toHaveLength(1);
        });

        test("should return null for invalid JSON", () => {
            const result = parseIndex("not valid json", "test.json");
            expect(result).toBeNull();
        });

        test("should return null for invalid index structure", () => {
            const indexContent = JSON.stringify({
                version: 1,
                items: [],
            });

            const result = parseIndex(indexContent, "test.json");
            expect(result).toBeNull();
        });
    });

    describe("processIndex", () => {
        test("should process index file and populate cache", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "package");
            await fs.mkdir(packagePath, { recursive: true });

            const indexContent = {
                "index-version": 1,
                files: [
                    {
                        filename: "Patient.json",
                        resourceType: "StructureDefinition",
                        id: "Patient",
                        url: "http://hl7.org/fhir/StructureDefinition/Patient",
                        version: "4.0.1",
                        kind: "resource",
                        type: "Patient",
                    },
                    {
                        filename: "Observation.json",
                        resourceType: "StructureDefinition",
                        id: "Observation",
                        url: "http://hl7.org/fhir/StructureDefinition/Observation",
                        version: "4.0.1",
                        kind: "resource",
                        type: "Observation",
                    },
                ],
            };

            await fs.writeFile(path.join(packagePath, ".index.json"), JSON.stringify(indexContent));
            await touchFile(path.join(packagePath, "Patient.json"));
            await touchFile(path.join(packagePath, "Observation.json"));

            const packageJson: PackageJson = {
                name: "test.package",
                version: "1.0.0",
            };

            await processIndex(packagePath, packageJson, cache);

            // Check cache entries
            expect(cache.entries["http://hl7.org/fhir/StructureDefinition/Patient"]).toHaveLength(1);
            expect(cache.entries["http://hl7.org/fhir/StructureDefinition/Observation"]).toHaveLength(1);

            // Check reference manager
            expect(cache.referenceManager.size()).toBe(2);
        });

        test("should skip entries without URLs", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "package");
            await fs.mkdir(packagePath, { recursive: true });

            const indexContent = {
                "index-version": 1,
                files: [
                    {
                        filename: "Example.json",
                        resourceType: "Patient",
                        id: "example",
                        // No URL
                    },
                ],
            };

            await fs.writeFile(path.join(packagePath, ".index.json"), JSON.stringify(indexContent));

            const packageJson: PackageJson = {
                name: "test.package",
                version: "1.0.0",
            };

            await processIndex(packagePath, packageJson, cache);

            expect(Object.keys(cache.entries)).toHaveLength(0);
            expect(cache.referenceManager.size()).toBe(0);
        });

        test("should handle missing index file gracefully", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "package");
            await fs.mkdir(packagePath, { recursive: true });

            const packageJson: PackageJson = {
                name: "test.package",
                version: "1.0.0",
            };

            // Should not throw
            await processIndex(packagePath, packageJson, cache);

            expect(Object.keys(cache.entries)).toHaveLength(0);
        });
    });

    describe("loadPackage", () => {
        test("should scan a complete FHIR package", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "test-package");
            await fs.mkdir(packagePath, { recursive: true });

            // Create package.json
            const packageJson = {
                name: "hl7.fhir.test",
                version: "1.0.0",
                canonical: "http://hl7.org/fhir/test",
                fhirVersions: ["4.0.1"],
            };

            await fs.writeFile(path.join(packagePath, "package.json"), JSON.stringify(packageJson));

            // Create .index.json
            const indexContent = {
                "index-version": 1,
                files: [
                    {
                        filename: "Patient.json",
                        resourceType: "StructureDefinition",
                        id: "Patient",
                        url: "http://hl7.org/fhir/StructureDefinition/Patient",
                    },
                ],
            };

            await fs.writeFile(path.join(packagePath, ".index.json"), JSON.stringify(indexContent));
            await touchFile(path.join(packagePath, "Patient.json"));

            await loadPackage(packagePath, cache, mkScanOptions());

            // Check package info
            expect(cache.packages["hl7.fhir.test"]).toBeDefined();
            expect(cache.packages["hl7.fhir.test"]?.id.version).toBe("1.0.0");
            expect(cache.packages["hl7.fhir.test"]?.canonical).toBe("http://hl7.org/fhir/test");

            // Check entries
            expect(cache.entries["http://hl7.org/fhir/StructureDefinition/Patient"]).toHaveLength(1);
        });

        test("should scan examples directory if present", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "test-package");
            const examplesPath = path.join(packagePath, "examples");

            await fs.mkdir(packagePath, { recursive: true });
            await fs.mkdir(examplesPath, { recursive: true });

            // Package files
            await fs.writeFile(
                path.join(packagePath, "package.json"),
                JSON.stringify({ name: "test.package", version: "1.0.0" }),
            );

            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Profile.json",
                            resourceType: "StructureDefinition",
                            id: "profile",
                            url: "http://example.com/Profile",
                        },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Profile.json"));

            // Examples files
            await fs.writeFile(
                path.join(examplesPath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "example.json",
                            resourceType: "Patient",
                            id: "example",
                            url: "http://example.com/Patient/example",
                        },
                    ],
                }),
            );
            await touchFile(path.join(examplesPath, "example.json"));

            await loadPackage(packagePath, cache, mkScanOptions());

            expect(cache.entries["http://example.com/Profile"]).toHaveLength(1);
            expect(cache.entries["http://example.com/Patient/example"]).toHaveLength(1);
        });

        test("should handle invalid package gracefully", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "invalid-package");

            // Should not throw
            await loadPackage(packagePath, cache, mkScanOptions());

            expect(Object.keys(cache.packages)).toHaveLength(0);
        });
    });

    describe("loadPackage packageIndex modes", () => {
        const writeResource = (filePath: string, url: string) =>
            fs.writeFile(filePath, JSON.stringify({ resourceType: "StructureDefinition", url, kind: "resource" }));

        const writePackageJson = (packagePath: string) =>
            fs.writeFile(
                path.join(packagePath, "package.json"),
                JSON.stringify({ name: "test.package", version: "1.0.0" }),
            );

        test('"regenerate" ignores the shipped index and scans the directory', async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);

            // Valid index that points at Ghost.json; plus a real on-disk resource not in the index.
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Ghost.json",
                            resourceType: "StructureDefinition",
                            id: "g",
                            url: "http://ex/Ghost",
                        },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Ghost.json"));
            await writeResource(path.join(packagePath, "Real.json"), "http://ex/Real");

            await loadPackage(packagePath, cache, mkScanOptions({ packageIndexMode: "regenerate" }));

            expect(cache.entries["http://ex/Real"]).toHaveLength(1); // scanned from disk
            expect(cache.entries["http://ex/Ghost"]).toBeUndefined(); // shipped index ignored
        });

        test('"recover" falls back to a directory scan when the index is corrupt', async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);

            // Index references a file that does not exist on disk → "missing-files" corruption.
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Missing.json",
                            resourceType: "StructureDefinition",
                            id: "m",
                            url: "http://ex/Missing",
                        },
                    ],
                }),
            );
            await writeResource(path.join(packagePath, "Real.json"), "http://ex/Real");

            await loadPackage(packagePath, cache, mkScanOptions({ packageIndexMode: "recover" }));

            expect(cache.entries["http://ex/Real"]).toHaveLength(1); // recovered via scan
            expect(cache.entries["http://ex/Missing"]).toBeUndefined();
        });

        test('"use" (default) does not recover a corrupt index and warns', async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);

            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Missing.json",
                            resourceType: "StructureDefinition",
                            id: "m",
                            url: "http://ex/Missing",
                        },
                    ],
                }),
            );
            await writeResource(path.join(packagePath, "Real.json"), "http://ex/Real");

            const warnings: string[] = [];
            const original = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
            try {
                await loadPackage(packagePath, cache, mkScanOptions());
            } finally {
                console.warn = original;
            }

            expect(cache.entries["http://ex/Real"]).toBeUndefined(); // no fallback scan in "use"
            expect(warnings.some((w) => w.includes("missing-files"))).toBe(true); // but it warns
        });

        test("valid empty index (files: []) is not treated as corruption", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);

            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({ "index-version": 1, files: [] }),
            );
            await writeResource(path.join(packagePath, "Real.json"), "http://ex/Real");

            await loadPackage(packagePath, cache, mkScanOptions({ packageIndexMode: "recover" }));

            // Empty-but-valid index → ok/count:0 → no recover, so the on-disk file is NOT scanned in.
            expect(cache.entries["http://ex/Real"]).toBeUndefined();
        });
    });

    describe("loadPackage entry-phase patches", () => {
        const writePackageJson = (packagePath: string) =>
            fs.writeFile(
                path.join(packagePath, "package.json"),
                JSON.stringify({ name: "test.package", version: "1.0.0" }),
            );
        const writeResource = (filePath: string, url: string) =>
            fs.writeFile(filePath, JSON.stringify({ resourceType: "StructureDefinition", url }));

        test("excludes a canonical via the index path", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        { filename: "Good.json", resourceType: "StructureDefinition", id: "g", url: "http://ex/Good" },
                        { filename: "Bad.json", resourceType: "StructureDefinition", id: "b", url: "http://ex/Bad" },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Good.json"));
            await touchFile(path.join(packagePath, "Bad.json"));

            const entries: ReportEntry[] = [];
            await loadPackage(
                packagePath,
                cache,
                mkScanOptions({
                    patches: { entry: [excludeCanonical({ url: "http://ex/Bad", reason: "cross-version" })] },
                    report: (e) => entries.push(e),
                }),
            );

            expect(cache.entries["http://ex/Good"]).toHaveLength(1);
            expect(cache.entries["http://ex/Bad"]).toBeUndefined();
            expect(entries.some((e) => e.kind === "exclusion" && e.url === "http://ex/Bad")).toBe(true);
        });

        test("excludes a canonical via the scan path (regenerate)", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);
            await writeResource(path.join(packagePath, "Good.json"), "http://ex/Good");
            await writeResource(path.join(packagePath, "Bad.json"), "http://ex/Bad");

            await loadPackage(
                packagePath,
                cache,
                mkScanOptions({
                    patches: { entry: [excludeCanonical({ url: "http://ex/Bad", reason: "x" })] },
                    packageIndexMode: "regenerate",
                }),
            );

            expect(cache.entries["http://ex/Good"]).toHaveLength(1);
            expect(cache.entries["http://ex/Bad"]).toBeUndefined();
        });

        test("commits the transformed entry when a patch returns a new entry context", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        { filename: "Typo.json", resourceType: "StructureDefinition", id: "t", url: "http://ex/Typo" },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Typo.json"));

            await loadPackage(
                packagePath,
                cache,
                mkScanOptions({
                    patches: {
                        entry: [
                            (_pkg, entry) =>
                                entry.url === "http://ex/Typo" ? { ...entry, url: "http://ex/Fixed" } : undefined,
                        ],
                    },
                }),
            );

            // The transformed url is indexed; the original is not.
            expect(cache.entries["http://ex/Fixed"]).toHaveLength(1);
            expect(cache.entries["http://ex/Fixed"]?.[0]?.url).toBe("http://ex/Fixed");
            expect(cache.entries["http://ex/Typo"]).toBeUndefined();
        });

        test("skips an entry whose url a patch cleared (not registered or indexed)", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "pkg");
            await fs.mkdir(packagePath, { recursive: true });
            await writePackageJson(packagePath);
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        { filename: "Good.json", resourceType: "StructureDefinition", id: "g", url: "http://ex/Good" },
                        { filename: "Cl.json", resourceType: "StructureDefinition", id: "c", url: "http://ex/Cleared" },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Good.json"));
            await touchFile(path.join(packagePath, "Cl.json"));

            await loadPackage(
                packagePath,
                cache,
                mkScanOptions({
                    patches: {
                        entry: [
                            (_pkg, entry) =>
                                entry.url === "http://ex/Cleared" ? { ...entry, url: undefined } : undefined,
                        ],
                    },
                }),
            );

            // The url-less entry is neither indexed nor registered; the other is committed.
            expect(cache.entries["http://ex/Good"]).toHaveLength(1);
            expect(cache.entries["http://ex/Cleared"]).toBeUndefined();
            expect(cache.referenceManager.size()).toBe(1);
        });
    });

    describe("loadPackage with preprocessPackage hook", () => {
        test("should apply preprocessPackage hook to modify package.json in memory", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "test-package");
            await fs.mkdir(packagePath, { recursive: true });

            // Create package.json with a typo in name
            await fs.writeFile(
                path.join(packagePath, "package.json"),
                JSON.stringify({
                    name: "test.packge", // typo
                    version: "1.0.0",
                    fhirVersions: ["4.0.1"],
                    dependencies: { "hl7.fhir.r4.core": "4.0.1" },
                }),
            );

            // Create .index.json
            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Patient.json",
                            resourceType: "StructureDefinition",
                            id: "Patient",
                            url: "http://example.com/Patient",
                        },
                    ],
                }),
            );

            // Patch that fixes the typo at the package phase
            const preprocessPackage: Partial<Patches> = {
                package: [
                    (_pkg, packageJson) =>
                        packageJson.name === "test.packge" ? { ...packageJson, name: "test.package" } : undefined,
                ],
            };

            await loadPackage(packagePath, cache, mkScanOptions({ patches: preprocessPackage }));

            // Check that cache uses the fixed name
            expect(cache.packages["test.package"]).toBeDefined();
            expect(cache.packages["test.packge"]).toBeUndefined();
            expect(cache.packages["test.package"]?.id.name).toBe("test.package");
            // Check that packageJson in cache contains preprocessed data
            expect(cache.packages["test.package"]?.packageJson?.name).toBe("test.package");
        });

        test("should not modify original file on disk", async () => {
            const cache = createCacheRecord();
            const packagePath = path.join(tempDir, "test-package");
            await fs.mkdir(packagePath, { recursive: true });

            const originalContent = {
                name: "original.name",
                version: "1.0.0",
                fhirVersions: ["4.0.1"],
                dependencies: { "hl7.fhir.r4.core": "4.0.1" },
            };

            await fs.writeFile(path.join(packagePath, "package.json"), JSON.stringify(originalContent));

            await fs.writeFile(
                path.join(packagePath, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Resource.json",
                            resourceType: "StructureDefinition",
                            id: "Resource",
                            url: "http://example.com/Resource",
                        },
                    ],
                }),
            );
            await touchFile(path.join(packagePath, "Resource.json"));

            const preprocessPackage: Partial<Patches> = {
                package: [(_pkg, packageJson) => ({ ...packageJson, name: "modified.name" })],
            };

            await loadPackage(packagePath, cache, mkScanOptions({ patches: preprocessPackage }));

            // Cache should have modified name
            expect(cache.packages["modified.name"]).toBeDefined();
            // packageJson in cache should have preprocessed data
            expect(cache.packages["modified.name"]?.packageJson?.name).toBe("modified.name");

            // File on disk should remain unchanged
            const fileContent = JSON.parse(await fs.readFile(path.join(packagePath, "package.json"), "utf-8"));
            expect(fileContent.name).toBe("original.name");
        });
    });

    describe("loadPackagesIntoCache", () => {
        test("should scan directory with FHIR packages", async () => {
            const cache = createCacheRecord();
            const nodeModules = path.join(tempDir, "node_modules");
            const package1 = path.join(nodeModules, "package1");
            const package2 = path.join(nodeModules, "package2");

            await fs.mkdir(package1, { recursive: true });
            await fs.mkdir(package2, { recursive: true });

            // Package 1 - FHIR package
            await fs.writeFile(
                path.join(package1, "package.json"),
                JSON.stringify({ name: "fhir.package1", version: "1.0.0" }),
            );
            await fs.writeFile(
                path.join(package1, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Resource1.json",
                            resourceType: "StructureDefinition",
                            id: "Resource1",
                            url: "http://example.com/Resource1",
                        },
                    ],
                }),
            );
            await touchFile(path.join(package1, "Resource1.json"));

            // Package 2 - Regular package (no .index.json)
            await fs.writeFile(
                path.join(package2, "package.json"),
                JSON.stringify({ name: "regular.package", version: "1.0.0" }),
            );

            await loadPackagesIntoCache(cache, tempDir, mkScanOptions());

            expect(cache.packages["fhir.package1"]).toBeDefined();
            expect(cache.packages["regular.package"]).toBeDefined(); // All packages are registered now
            expect(cache.entries["http://example.com/Resource1"]).toHaveLength(1);
        });

        test("should scan scoped packages", async () => {
            const cache = createCacheRecord();
            const nodeModules = path.join(tempDir, "node_modules");
            const scopeDir = path.join(nodeModules, "@scope");
            const packageDir = path.join(scopeDir, "package");

            await fs.mkdir(packageDir, { recursive: true });

            await fs.writeFile(
                path.join(packageDir, "package.json"),
                JSON.stringify({ name: "@scope/package", version: "1.0.0" }),
            );
            await fs.writeFile(
                path.join(packageDir, ".index.json"),
                JSON.stringify({
                    "index-version": 1,
                    files: [
                        {
                            filename: "Scoped.json",
                            resourceType: "StructureDefinition",
                            id: "Scoped",
                            url: "http://example.com/Scoped",
                        },
                    ],
                }),
            );
            await touchFile(path.join(packageDir, "Scoped.json"));

            await loadPackagesIntoCache(cache, tempDir, mkScanOptions());

            expect(cache.packages["@scope/package"]).toBeDefined();
            expect(cache.entries["http://example.com/Scoped"]).toHaveLength(1);
        });
    });
});
