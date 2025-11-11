import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
    parseIndex,
    isValidFileEntry,
    isValidIndexFile,
    processIndex,
    scanPackage,
    scanDirectory,
} from "../../../src/scanner";
import { createCache } from "../../../src/cache";
import type { PackageJson } from "../../../src/types";

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
            expect(result!["index-version"]).toBe(1);
            expect(result!.files).toHaveLength(1);
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
            const cache = createCache();
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
            const cache = createCache();
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
            const cache = createCache();
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

    describe("scanPackage", () => {
        test("should scan a complete FHIR package", async () => {
            const cache = createCache();
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

            await scanPackage(packagePath, cache);

            // Check package info
            expect(cache.packages["hl7.fhir.test"]).toBeDefined();
            expect(cache.packages["hl7.fhir.test"]?.id.version).toBe("1.0.0");
            expect(cache.packages["hl7.fhir.test"]?.canonical).toBe("http://hl7.org/fhir/test");

            // Check entries
            expect(cache.entries["http://hl7.org/fhir/StructureDefinition/Patient"]).toHaveLength(1);
        });

        test("should scan examples directory if present", async () => {
            const cache = createCache();
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

            await scanPackage(packagePath, cache);

            expect(cache.entries["http://example.com/Profile"]).toHaveLength(1);
            expect(cache.entries["http://example.com/Patient/example"]).toHaveLength(1);
        });

        test("should handle invalid package gracefully", async () => {
            const cache = createCache();
            const packagePath = path.join(tempDir, "invalid-package");

            // Should not throw
            await scanPackage(packagePath, cache);

            expect(Object.keys(cache.packages)).toHaveLength(0);
        });
    });

    describe("scanDirectory", () => {
        test("should scan directory with FHIR packages", async () => {
            const cache = createCache();
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

            // Package 2 - Regular package (no .index.json)
            await fs.writeFile(
                path.join(package2, "package.json"),
                JSON.stringify({ name: "regular.package", version: "1.0.0" }),
            );

            await scanDirectory(nodeModules, cache);

            expect(cache.packages["fhir.package1"]).toBeDefined();
            expect(cache.packages["regular.package"]).toBeUndefined();
            expect(cache.entries["http://example.com/Resource1"]).toHaveLength(1);
        });

        test("should scan scoped packages", async () => {
            const cache = createCache();
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

            await scanDirectory(nodeModules, cache);

            expect(cache.packages["@scope/package"]).toBeDefined();
            expect(cache.entries["http://example.com/Scoped"]).toHaveLength(1);
        });

        test("should handle empty directory", async () => {
            const cache = createCache();
            const emptyDir = path.join(tempDir, "empty");
            await fs.mkdir(emptyDir, { recursive: true });

            // Should not throw
            await scanDirectory(emptyDir, cache);

            expect(Object.keys(cache.packages)).toHaveLength(0);
        });

        test("should handle non-existent directory", async () => {
            const cache = createCache();

            // Should not throw
            await scanDirectory("/non/existent/directory", cache);

            expect(Object.keys(cache.packages)).toHaveLength(0);
        });
    });
});
