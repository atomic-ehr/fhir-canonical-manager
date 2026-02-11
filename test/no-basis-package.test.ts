/**
 * Tests for packages without .index.json files (e.g., hl7.fhir.no.basis)
 * This tests the directory scanning fallback functionality
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { CanonicalManager } from "../src/index.js";
import type { CanonicalManager as ICanonicalManager } from "../src/types/index.js";

describe("CanonicalManager - Packages without .index.json", () => {
    let manager: ICanonicalManager;
    const testWorkingDir = "./tmp/test-no-basis";

    beforeAll(async () => {
        // Clean up test directory
        await fs.rm(testWorkingDir, { recursive: true, force: true }).catch(() => {});

        manager = CanonicalManager({
            packages: ["hl7.fhir.no.basis@2.2.2"],
            workingDir: testWorkingDir,
            registry: "https://fs.get-ig.org/pkgs/",
        });
        await manager.init();
    });

    afterAll(async () => {
        await manager.destroy();
        // Clean up test directory
        await fs.rm(testWorkingDir, { recursive: true, force: true }).catch(() => {});
    });

    test("should initialize successfully with package without .index.json", () => {
        expect(manager).toBeDefined();
    });

    test("should find resources in package without .index.json", async () => {
        const entries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        expect(entries.length).toBeGreaterThan(0);
        expect(entries.length).toBeGreaterThanOrEqual(40); // Should have at least 40 resources
    });

    test("should have entries with canonical URLs", async () => {
        const entries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        const entriesWithUrls = entries.filter((e) => e.url);
        expect(entriesWithUrls.length).toBe(entries.length); // All entries should have URLs

        // Check that most URLs are properly formatted (some may be relative like ImplementationGuide URLs)
        const httpUrls = entriesWithUrls.filter((entry) => entry.url?.startsWith("http"));
        expect(httpUrls.length).toBeGreaterThan(40); // Most should be absolute URLs
    });

    test("should resolve specific Norwegian base profile", async () => {
        const entry = await manager.resolveEntry("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");

        expect(entry).toBeDefined();
        expect(entry.resourceType).toBe("StructureDefinition");
        expect(entry.url).toBe("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");
        expect(entry.package?.name).toBe("hl7.fhir.no.basis");
        expect(entry.package?.version).toBe("2.2.2");
    });

    test("should read full resource from scanned package", async () => {
        const resource = await manager.resolve("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");

        expect(resource).toBeDefined();
        expect(resource.resourceType).toBe("StructureDefinition");
        expect(resource.url).toBe("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");
        expect(resource.name).toBeDefined();
        expect(resource.type).toBeDefined();
    });

    test("should find different resource types", async () => {
        const allEntries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        const resourceTypes = new Set(allEntries.map((e) => e.resourceType));

        // Should have multiple resource types
        expect(resourceTypes.size).toBeGreaterThan(1);

        // Should have at least StructureDefinitions
        expect(resourceTypes.has("StructureDefinition")).toBe(true);
    });

    test("should find CodeSystem resources", async () => {
        const allEntries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        const codeSystems = allEntries.filter((e) => e.resourceType === "CodeSystem");

        expect(codeSystems.length).toBeGreaterThan(0);

        codeSystems.forEach((entry) => {
            expect(entry.resourceType).toBe("CodeSystem");
            expect(entry.url).toMatch(/^http/);
        });
    });

    test("should find ValueSet resources", async () => {
        const allEntries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        const valueSets = allEntries.filter((e) => e.resourceType === "ValueSet");

        expect(valueSets.length).toBeGreaterThan(0);

        valueSets.forEach((entry) => {
            expect(entry.resourceType).toBe("ValueSet");
            expect(entry.url).toMatch(/^http/);
        });
    });

    test("should search by URL pattern", async () => {
        const patientResources = await manager.searchEntries({
            url: "http://hl7.no/fhir/StructureDefinition/no-basis-Patient",
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        expect(patientResources.length).toBe(1);
        expect(patientResources[0]?.url).toBe("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");
    });

    test("should list all canonical URLs from package", async () => {
        const entries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        const canonicalUrls = entries.filter((e) => e.url).map((e) => e.url);

        // Should have a reasonable number of resources
        expect(canonicalUrls.length).toBeGreaterThanOrEqual(40);

        // All should be unique
        const uniqueUrls = new Set(canonicalUrls);
        expect(uniqueUrls.size).toBe(canonicalUrls.length);

        // Check some expected URLs exist
        expect(canonicalUrls).toContain("http://hl7.no/fhir/StructureDefinition/no-basis-Patient");
        expect(canonicalUrls).toContain("http://hl7.no/fhir/StructureDefinition/no-basis-Address");
    });

    test("should handle indexVersion for scanned resources", async () => {
        const entries = await manager.searchEntries({
            package: { name: "hl7.fhir.no.basis", version: "2.2.2" },
        });

        // Resources scanned from directory should have indexVersion 0
        entries.forEach((entry) => {
            expect(entry.indexVersion).toBe(0);
        });
    });
});
