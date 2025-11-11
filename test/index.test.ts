/**
 * FHIR Canonical Manager Tests
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { CanonicalManager } from "../src";
import type {
    IndexEntry,
    Reference,
    Resource,
    PackageId,
    SearchParameter,
    CanonicalManager as ICanonicalManager,
} from "../src/types";
import * as fs from "fs/promises";
import * as path from "path";

describe("CanonicalManager", () => {
    let manager: ICanonicalManager;
    const testWorkingDir = "./tmp/test-fhir";

    beforeAll(async () => {
        // Clean up test directory
        await fs.rm(testWorkingDir, { recursive: true, force: true }).catch(() => {});

        manager = CanonicalManager({
            packages: ["hl7.fhir.r4.core@4.0.1"],
            workingDir: testWorkingDir,
            registry: "https://fs.get-ig.org/pkgs/",
        });
        await manager.init();
    });

    afterAll(async () => {
        await manager.destroy();
    });

    test("should initialize successfully", () => {
        expect(manager).toBeDefined();
    });

    test("should create working directory and cache", async () => {
        const packageJsonExists = await fs
            .access(path.join(testWorkingDir, "package.json"))
            .then(() => true)
            .catch(() => false);
        expect(packageJsonExists).toBe(true);

        const cacheExists = await fs
            .access(path.join(testWorkingDir, ".fcm", "cache"))
            .then(() => true)
            .catch(() => false);
        expect(cacheExists).toBe(true);
    });

    test("should list packages", async () => {
        const packages = await manager.packages();
        expect(Array.isArray(packages)).toBe(true);
        // Should have at least one package if any FHIR packages are installed
        packages.forEach((pkg: PackageId) => {
            expect(pkg).toHaveProperty("name");
            expect(pkg).toHaveProperty("version");
        });
    });

    test("should throw when not initialized", async () => {
        const uninitializedManager = CanonicalManager({
            packages: ["hl7.fhir.r4.core@4.0.1"],
            workingDir: "./tmp/uninitialized",
        });
        await expect(uninitializedManager.packages()).rejects.toThrow("CanonicalManager not initialized");
    });

    test("should resolve canonical URL to IndexEntry using resolveEntry", async () => {
        const entry = await manager.resolveEntry("http://hl7.org/fhir/StructureDefinition/Patient");

        expect(entry).toBeDefined();
        expect(entry.id).toBeTruthy();
        expect(entry.resourceType).toBe("StructureDefinition");
        expect(entry.indexVersion).toBeGreaterThanOrEqual(1);
        expect(entry.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
        expect(entry.package).toBeDefined();
        expect(entry.package?.name).toBeTruthy();
        expect(entry.package?.version).toBeTruthy();
    });

    test("should resolve canonical URL directly to Resource using resolve", async () => {
        const resource = await manager.resolve("http://hl7.org/fhir/StructureDefinition/Patient");

        expect(resource).toBeDefined();
        expect(resource.resourceType).toBe("StructureDefinition");
        expect(resource.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
    });

    test("should throw when canonical URL not found", async () => {
        await expect(manager.resolveEntry("http://example.com/non-existent-resource")).rejects.toThrow(
            "Cannot resolve canonical URL",
        );
    });

    test("should read resource by reference", async () => {
        // First resolve to get a reference
        const entry = await manager.resolveEntry("http://hl7.org/fhir/StructureDefinition/Patient");

        // Then read the resource
        const resource = await manager.read(entry);

        expect(resource).toBeDefined();
        expect(resource.id).toBe(entry.id);
        expect(resource.resourceType).toBe(entry.resourceType);
        // Should have FHIR resource properties
        expect(resource.url).toBeTruthy();
    });

    test("should throw when reference is invalid", async () => {
        const invalidReference: Reference = {
            id: "invalid-id-12345",
            resourceType: "StructureDefinition",
        };

        await expect(manager.read(invalidReference)).rejects.toThrow("Invalid reference ID");
    });

    test("should search for resources using searchEntries", async () => {
        // Search by resource type
        const results = await manager.searchEntries({
            type: "StructureDefinition",
        });

        expect(Array.isArray(results)).toBe(true);

        if (results.length > 0) {
            const entry = results[0];
            expect(entry?.id).toBeTruthy();
            expect(entry?.resourceType).toBeTruthy();
            expect(entry?.indexVersion).toBeGreaterThanOrEqual(1);
        }
    });

    test("should search and return resources directly using search", async () => {
        // Search by resource type
        const resources = await manager.search({
            type: "StructureDefinition",
        });

        expect(Array.isArray(resources)).toBe(true);

        if (resources.length > 0) {
            const resource = resources[0];
            expect(resource?.resourceType).toBe("StructureDefinition");
            expect(resource?.url).toBeTruthy();
        }
    });

    test("should filter search by package", async () => {
        const packages = await manager.packages();
        expect(packages.length).toBeGreaterThan(0);

        const firstPackage = packages[0]!;

        const results = await manager.searchEntries({
            package: firstPackage,
        });

        expect(Array.isArray(results)).toBe(true);

        // All results should be from the specified package
        results.forEach((entry: IndexEntry) => {
            expect(entry.package?.name).toBe(firstPackage.name);
            expect(entry.package?.version).toBe(firstPackage.version);
        });
    });

    test("should perform smart search with abbreviations", async () => {
        // Test searching for StructureDefinition/Patient using abbreviations
        const results = await manager.smartSearch(["str", "def", "pati"]);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // Should find StructureDefinition resources with "patient" in the URL
        const patientStructDef = results.find(
            (r: IndexEntry) =>
                r.url === "http://hl7.org/fhir/StructureDefinition/Patient" && r.resourceType === "StructureDefinition",
        );
        expect(patientStructDef).toBeDefined();
    });

    test("should perform smart search for Observation", async () => {
        // Test abbreviation 'obs' for Observation
        const results = await manager.smartSearch(["obs"]);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // Should find Observation-related resources
        const hasObservation = results.some((r: IndexEntry) => r.url?.toLowerCase().includes("observation"));
        expect(hasObservation).toBe(true);
    });

    test("should perform smart search for ValueSet", async () => {
        // Test abbreviations for ValueSet
        const results = await manager.smartSearch(["val", "set"]);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // Should find ValueSet resources
        const hasValueSet = results.some(
            (r: IndexEntry) => r.resourceType === "ValueSet" || r.url?.toLowerCase().includes("valueset"),
        );
        expect(hasValueSet).toBe(true);
    });

    test("should perform smart search with filters", async () => {
        // Search for StructureDefinitions with 'patient'
        const results = await manager.smartSearch(["patient"], {
            resourceType: "StructureDefinition",
        });

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // All results should be StructureDefinitions
        results.forEach((entry) => {
            expect(entry.resourceType).toBe("StructureDefinition");
        });

        // Should have patient-related StructureDefinitions
        const hasPatient = results.some((r: IndexEntry) => r.url?.toLowerCase().includes("patient"));
        expect(hasPatient).toBe(true);
    });

    test("should perform smart search with type filter", async () => {
        // Search for resources of type 'Patient'
        const results = await manager.smartSearch([], {
            type: "Patient",
        });

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);

        // All results should have type 'Patient'
        results.forEach((entry) => {
            expect(entry.type).toBe("Patient");
        });
    });

    test("should perform smart search with kind filter", async () => {
        // Search for resources of kind 'resource'
        const results = await manager.smartSearch(["patient"], {
            kind: "resource",
        });

        expect(Array.isArray(results)).toBe(true);

        // All results should have kind 'resource'
        results.forEach((entry) => {
            expect(entry.kind).toBe("resource");
        });

        // Should include the main Patient resource
        const patientResource = results.find((r) => r.url === "http://hl7.org/fhir/StructureDefinition/Patient");
        expect(patientResource).toBeDefined();
    });

    test("should handle smart search with no matches", async () => {
        // Search for something that shouldn't exist
        const results = await manager.smartSearch(["xyz123", "nonexistent"]);

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(0);
    });

    test("should handle smart search with empty terms", async () => {
        // Search with no terms should return all resources (with optional filters)
        const allResults = await manager.smartSearch([]);
        const filteredResults = await manager.smartSearch([], {
            resourceType: "StructureDefinition",
        });

        expect(Array.isArray(allResults)).toBe(true);
        expect(Array.isArray(filteredResults)).toBe(true);
        expect(allResults.length).toBeGreaterThan(filteredResults.length);

        // Filtered results should all be StructureDefinitions
        filteredResults.forEach((entry) => {
            expect(entry.resourceType).toBe("StructureDefinition");
        });
    });

    test("should handle package-specific resolution", async () => {
        const packages = await manager.packages();
        expect(packages.length).toBeGreaterThan(0);

        const firstPackage = packages[0]!;

        // Find any resource URL from the first package
        const results = await manager.searchEntries({ package: firstPackage });
        expect(results.length).toBeGreaterThan(0);

        const firstResource = results.find((r) => r.url);
        expect(firstResource).toBeDefined();
        expect(firstResource!.url).toBeDefined();

        // Resolve with package constraint (without version since it might not match)
        const entry = await manager.resolveEntry(firstResource!.url!, {
            package: firstPackage.name,
        });

        expect(entry.package?.name).toBe(firstPackage.name);
        expect(entry.package?.version).toBe(firstPackage.version);
    });

    test("should install the specified package", async () => {
        const packages = await manager.packages();

        // Should have at least the core package
        expect(packages.length).toBeGreaterThanOrEqual(1);

        // Check for expected packages
        const packageNames = packages.map((p) => p.name);

        // Core package that should be installed
        expect(packageNames).toContain("hl7.fhir.r4.core");

        // Log for debugging
        console.log(`Installed ${packages.length} packages:`, packageNames);
    });

    test("should install package at runtime", async () => {
        await manager.addPackages("de.medizininformatikinitiative.kerndatensatz.person@2025.0.0");

        const packages = await manager.packages();

        // Should have at least the core package
        expect(packages.length).toBeGreaterThanOrEqual(2);

        // Check for expected packages
        const packageNames = packages.map((p) => p.name);

        // Core package that should be installed
        expect(packageNames).toContain("de.medizininformatikinitiative.kerndatensatz.person");
        // Dependent package that should be installed automatically
        expect(packageNames).toContain("de.basisprofil.r4");

        // Log for debugging
        console.log(`Installed ${packages.length} packages:`, packageNames);
    });

    test("should find Patient resources from multiple packages", async () => {
        // First, let's see what StructureDefinitions we have
        const allEntries = await manager.searchEntries({});
        console.log(`Total entries indexed: ${allEntries.length}`);

        // Search for StructureDefinitions
        const structureDefinitions = allEntries.filter((e) => e.resourceType === "StructureDefinition");
        console.log(`Total StructureDefinitions: ${structureDefinitions.length}`);

        // Filter for Patient resources
        const patientStructDefs = structureDefinitions.filter((sd) => sd.type === "Patient" && sd.kind === "resource");
        console.log(`Patient StructureDefinitions found: ${patientStructDefs.length}`);
        if (patientStructDefs.length > 0) {
            console.log(
                "Patient resources:",
                patientStructDefs.map((p) => ({
                    url: p.url,
                    package: p.package?.name,
                    type: p.type,
                    kind: p.kind,
                })),
            );
        }

        // Should find at least the base Patient from hl7.fhir.r4.core
        expect(patientStructDefs.length).toBeGreaterThanOrEqual(1);

        const r4Patient = patientStructDefs.find((p) => p.package?.name === "hl7.fhir.r4.core");
        if (r4Patient) {
            expect(r4Patient?.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
        }

        // Search for US Core Patient profile - filter by URL pattern
        const usCoreProfiles = structureDefinitions.filter((sd) => sd.url?.toLowerCase().includes("us-core-patient"));
        console.log(`US Core Patient profiles found: ${usCoreProfiles.length}`);

        if (usCoreProfiles.length > 0) {
            const usCorePatient = usCoreProfiles.find((p) => p.package?.name === "hl7.fhir.us.core");
            expect(usCorePatient).toBeDefined();
            expect(usCorePatient?.package?.name).toBe("hl7.fhir.us.core");
        }
    });

    test("should search for resources across the installed package", async () => {
        // Get all entries first
        const allEntries = await manager.searchEntries({});

        // Filter for Patient-related resources (any resource type with "patient" in URL)
        const patientRelated = allEntries.filter((e) => e.url?.toLowerCase().includes("patient"));

        console.log(`Total Patient-related resources found: ${patientRelated.length}`);

        // Should find multiple Patient-related resources
        expect(patientRelated.length).toBeGreaterThan(1);

        // Group by package to see distribution
        const byPackage = patientRelated.reduce(
            (acc, entry) => {
                const pkgName = entry.package?.name || "unknown";
                acc[pkgName] = (acc[pkgName] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>,
        );

        console.log("Patient-related resources by package:", byPackage);

        // Since we only installed hl7.fhir.r4.core, should have resources from 1 package
        expect(Object.keys(byPackage).length).toBe(1);
        expect(byPackage["hl7.fhir.r4.core"]).toBeGreaterThan(0);

        // Log some examples of patient-related resources
        const examples = patientRelated.slice(0, 5).map((e) => ({
            resourceType: e.resourceType,
            url: e.url,
            package: e.package?.name,
        }));
        console.log("Example patient-related resources:", examples);
    });

    test("should resolve resources with package disambiguation", async () => {
        // The base Patient resource should exist in r4.core
        const r4Patient = await manager.resolveEntry("http://hl7.org/fhir/StructureDefinition/Patient", {
            package: "hl7.fhir.r4.core",
        });

        expect(r4Patient.package?.name).toBe("hl7.fhir.r4.core");

        // Without package hint, should still resolve (picks first match)
        const anyPatient = await manager.resolveEntry("http://hl7.org/fhir/StructureDefinition/Patient");

        expect(anyPatient).toBeDefined();
        expect(anyPatient.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
    });

    test("should use cached data on second init", async () => {
        // Create a new manager with same working directory
        const manager2 = CanonicalManager({
            packages: ["hl7.fhir.r4.core@4.0.1"],
            workingDir: testWorkingDir,
            registry: "https://fs.get-ig.org/pkgs/",
        });

        // Should load from cache
        await manager2.init();

        // Should have same packages
        const packages1 = await manager.packages();
        const packages2 = await manager2.packages();

        expect(packages2.length).toBe(packages1.length);

        await manager2.destroy();
    });

    test("should get search parameters for Patient resource", async () => {
        const searchParams = await manager.getSearchParametersForResource("Patient");

        expect(Array.isArray(searchParams)).toBe(true);
        // Add more context to the error message
        if (searchParams.length === 0) {
            console.log("No search parameters found for Patient");
        }
        expect(searchParams.length).toBeGreaterThan(0); // Should have at least some search params

        // Check that results are SearchParameter resources
        searchParams.forEach((param: SearchParameter) => {
            expect(param.url).toBeTruthy();
            expect(typeof param.url).toBe("string");
            expect(param.name).toBeTruthy();
            expect(typeof param.name).toBe("string");
            expect(param.code).toBeTruthy();
            expect(typeof param.code).toBe("string");
            expect(param.base).toBeTruthy();
            expect(Array.isArray(param.base)).toBe(true);
            expect(param.base).toContain("Patient");
            expect(param.type).toBeTruthy();
            expect(typeof param.type).toBe("string");
        });

        // Check for common Patient search parameters by collecting all codes
        const codes = searchParams.map((p) => p.code);

        // Debug: log codes if test fails
        if (!codes.includes("identifier")) {
            console.log("Available codes:", codes.sort().join(", "));
            console.log("First param:", searchParams[0]);
        }

        expect(codes).toContain("identifier");
        expect(codes).toContain("name");
        expect(codes).toContain("family");
        expect(codes).toContain("gender");
        expect(codes).toContain("birthdate");

        // Verify types of specific parameters
        const paramsByCode = Object.fromEntries(searchParams.map((p) => [p.code, p]));
        expect(paramsByCode["identifier"]?.type).toBe("token");
        expect(paramsByCode["name"]?.type).toBe("string");
        expect(paramsByCode["family"]?.type).toBe("string");
        expect(paramsByCode["gender"]?.type).toBe("token");
        expect(paramsByCode["birthdate"]?.type).toBe("date");

        // Check results are sorted by code
        const sortedCodes = [...codes].sort((a, b) => a.localeCompare(b));
        expect(codes).toEqual(sortedCodes);
    });

    test("should get search parameters for Observation resource", async () => {
        const searchParams = await manager.getSearchParametersForResource("Observation");

        expect(Array.isArray(searchParams)).toBe(true);
        expect(searchParams.length).toBeGreaterThan(0);

        // Check for common Observation search parameters
        const codeParam = searchParams.find((p) => p.code === "code");
        expect(codeParam).toBeDefined();
        expect(codeParam?.type).toBe("token");

        const patientParam = searchParams.find((p) => p.code === "patient");
        expect(patientParam).toBeDefined();
        expect(patientParam?.type).toBe("reference");
        expect(patientParam?.target).toBeDefined();

        const dateParam = searchParams.find((p) => p.code === "date");
        expect(dateParam).toBeDefined();
        expect(dateParam?.type).toBe("date");
        expect(dateParam?.comparator).toBeDefined();
        expect(Array.isArray(dateParam?.comparator)).toBe(true);
    });

    test("should handle multi-base search parameters correctly", async () => {
        const patientParams = await manager.getSearchParametersForResource("Patient");
        const practitionerParams = await manager.getSearchParametersForResource("Practitioner");

        // Find a parameter that applies to both
        const patientAddressParam = patientParams.find((p) => p.code === "address");
        const practitionerAddressParam = practitionerParams.find((p) => p.code === "address");

        expect(patientAddressParam).toBeDefined();
        expect(practitionerAddressParam).toBeDefined();

        // Should be the same parameter (same URL)
        if (patientAddressParam && practitionerAddressParam) {
            expect(patientAddressParam.url).toBe(practitionerAddressParam.url);
            expect(patientAddressParam.base.length).toBeGreaterThan(1);
            expect(patientAddressParam.base).toContain("Patient");
            expect(patientAddressParam.base).toContain("Practitioner");
        }
    });

    test("should return empty array for unknown resource type", async () => {
        const searchParams = await manager.getSearchParametersForResource("UnknownResourceType");

        expect(Array.isArray(searchParams)).toBe(true);
        expect(searchParams.length).toBe(0);
    });

    test("should cache search parameters for performance", async () => {
        // First call - should hit the database
        const start1 = performance.now();
        const params1 = await manager.getSearchParametersForResource("Encounter");
        const time1 = performance.now() - start1;

        // Second call - should hit the cache
        const start2 = performance.now();
        const params2 = await manager.getSearchParametersForResource("Encounter");
        const time2 = performance.now() - start2;

        // Results should be identical
        expect(params1).toEqual(params2);

        // Second call should be faster (cache hit)
        // Just verify it's faster, not by a specific ratio
        expect(time2).toBeLessThanOrEqual(time1);

        // Cache should work for different resources too
        const start3 = performance.now();
        await manager.getSearchParametersForResource("Procedure");
        const time3 = performance.now() - start3;

        const start4 = performance.now();
        await manager.getSearchParametersForResource("Procedure");
        const time4 = performance.now() - start4;

        expect(time4).toBeLessThanOrEqual(time3);

        // Verify both are cached
        expect(params2.length).toBeGreaterThan(0);
    });

    test("should preserve all FHIR SearchParameter fields", async () => {
        const searchParams = await manager.getSearchParametersForResource("Patient");

        expect(searchParams.length).toBeGreaterThan(0);

        // Take the first parameter and check it has additional FHIR fields
        const firstParam = searchParams[0];

        if (firstParam) {
            // These fields are not in our simplified interface but should be present
            // because we return the full FHIR resource
            expect(firstParam).toHaveProperty("resourceType");
            expect(firstParam.resourceType).toBe("SearchParameter");

            // Check for other common FHIR fields that might be present
            if (firstParam.status) {
                expect(["draft", "active", "retired", "unknown"]).toContain(firstParam.status);
            }

            if (firstParam.experimental !== undefined) {
                expect(typeof firstParam.experimental).toBe("boolean");
            }

            if (firstParam.description) {
                expect(typeof firstParam.description).toBe("string");
            }

            if (firstParam.xpath) {
                expect(typeof firstParam.xpath).toBe("string");
            }
        }
    });

    test("should clear search parameter cache on destroy", async () => {
        // Populate cache
        await manager.getSearchParametersForResource("Patient");

        // Create a new manager with same working directory
        const manager2 = CanonicalManager({
            packages: ["hl7.fhir.r4.core@4.0.1"],
            workingDir: testWorkingDir,
            registry: "https://fs.get-ig.org/pkgs/",
        });

        await manager2.init();

        // This should rebuild the cache (not use the in-memory cache from manager1)
        const params = await manager2.getSearchParametersForResource("Patient");
        expect(params.length).toBeGreaterThan(0);

        await manager2.destroy();
    });

    test("should invalidate cache when package-lock.json changes", async () => {
        // Use the existing test directory that already has packages installed
        // This avoids the npm registry issue in the test
        const cacheFile = path.join(testWorkingDir, ".fcm", "cache", "index.json");

        // Capture console output
        const consoleOutput: string[] = [];
        const originalLog = console.log;
        console.log = (...args) => consoleOutput.push(args.join(" "));

        try {
            // Read the current cache to verify it has packageLockHash
            const cacheContent = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
            expect(cacheContent.packageLockHash).toBeDefined();
            const originalHash = cacheContent.packageLockHash;

            // Modify lock file (simulate package change)
            // Check which lock file exists
            const packageLockPath = path.join(testWorkingDir, "package-lock.json");
            const bunLockPath = path.join(testWorkingDir, "bun.lock");

            let lockFilePath: string;
            let lockFileContent: any;

            try {
                // Try package-lock.json first
                lockFileContent = JSON.parse(await fs.readFile(packageLockPath, "utf-8"));
                lockFilePath = packageLockPath;
            } catch {
                // Try bun.lock
                lockFileContent = await fs.readFile(bunLockPath, "utf-8");
                lockFilePath = bunLockPath;
            }

            // Make a minimal change to the lock file
            if (lockFilePath === packageLockPath) {
                lockFileContent.modified = new Date().toISOString();
                await fs.writeFile(lockFilePath, JSON.stringify(lockFileContent, null, 2));
            } else {
                // For bun.lock, just append a comment
                await fs.writeFile(lockFilePath, lockFileContent + "\n# Modified: " + new Date().toISOString());
            }

            // Clear console output
            consoleOutput.length = 0;

            // Create new manager - should detect change and rebuild
            // Use empty packages array to avoid installation attempts
            const manager3 = CanonicalManager({
                packages: [],
                workingDir: testWorkingDir,
            });

            await manager3.init();

            // Should have logged about rebuilding
            expect(consoleOutput.some((msg) => msg.includes("Package dependencies have changed"))).toBe(true);

            // Verify new cache has different hash
            const newCacheContent = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
            expect(newCacheContent.packageLockHash).toBeDefined();
            expect(newCacheContent.packageLockHash).not.toBe(originalHash);

            // Restore original lock file for other tests
            if (lockFilePath === packageLockPath) {
                delete lockFileContent.modified;
                await fs.writeFile(lockFilePath, JSON.stringify(lockFileContent, null, 2));
            } else {
                // For bun.lock, restore original content
                const originalContent = lockFileContent.toString().split("\n# Modified:")[0];
                await fs.writeFile(lockFilePath, originalContent);
            }

            await manager3.destroy();
        } finally {
            console.log = originalLog;
        }
    });
});
