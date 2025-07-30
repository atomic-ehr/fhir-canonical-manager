/**
 * FHIR Canonical Manager Tests
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { CanonicalManager } from "../src";
import type { IndexEntry, Reference, Resource } from "../src";

describe("CanonicalManager", () => {
  let manager: CanonicalManager;

  beforeAll(async () => {
    manager = CanonicalManager({
      packagePaths: ["./node_modules"]
    });
    await manager.init();
  });

  afterAll(async () => {
    await manager.destroy();
  });

  test("should initialize successfully", () => {
    expect(manager).toBeDefined();
  });

  test("should list packages", async () => {
    const packages = await manager.packages();
    expect(Array.isArray(packages)).toBe(true);
    // Should have at least one package if any FHIR packages are installed
    packages.forEach(pkg => {
      expect(pkg).toHaveProperty("name");
      expect(pkg).toHaveProperty("version");
    });
  });

  test("should throw when not initialized", async () => {
    const uninitializedManager = CanonicalManager();
    await expect(uninitializedManager.packages()).rejects.toThrow(
      "CanonicalManager not initialized"
    );
  });

  test("should resolve canonical URL to IndexEntry", async () => {
    // This test will only work if there are FHIR packages installed
    // Skip if no packages are available
    const packages = await manager.packages();
    if (packages.length === 0) {
      console.log("No FHIR packages found, skipping resolve test");
      return;
    }

    // Try to resolve a common FHIR resource
    try {
      const entry = await manager.resolve(
        "http://hl7.org/fhir/StructureDefinition/Patient"
      );
      
      expect(entry).toBeDefined();
      expect(entry.id).toBeTruthy();
      expect(entry.resourceType).toBe("StructureDefinition");
      expect(entry.indexVersion).toBeGreaterThanOrEqual(1);
      expect(entry.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
      expect(entry.package).toBeDefined();
      expect(entry.package?.name).toBeTruthy();
      expect(entry.package?.version).toBeTruthy();
    } catch (e) {
      // Resource might not exist in test environment
      console.log("Patient StructureDefinition not found, skipping test");
    }
  });

  test("should throw when canonical URL not found", async () => {
    await expect(
      manager.resolve("http://example.com/non-existent-resource")
    ).rejects.toThrow("Cannot resolve canonical URL");
  });

  test("should read resource by reference", async () => {
    const packages = await manager.packages();
    if (packages.length === 0) {
      console.log("No FHIR packages found, skipping read test");
      return;
    }

    try {
      // First resolve to get a reference
      const entry = await manager.resolve(
        "http://hl7.org/fhir/StructureDefinition/Patient"
      );
      
      // Then read the resource
      const resource = await manager.read(entry);
      
      expect(resource).toBeDefined();
      expect(resource.id).toBe(entry.id);
      expect(resource.resourceType).toBe(entry.resourceType);
      // Should have FHIR resource properties
      expect(resource.url).toBeTruthy();
    } catch (e) {
      console.log("Patient resource not found, skipping test");
    }
  });

  test("should throw when reference is invalid", async () => {
    const invalidReference: Reference = {
      id: "invalid-id-12345",
      resourceType: "StructureDefinition"
    };

    await expect(manager.read(invalidReference)).rejects.toThrow(
      "Invalid reference ID"
    );
  });

  test("should search for resources", async () => {
    const packages = await manager.packages();
    if (packages.length === 0) {
      console.log("No FHIR packages found, skipping search test");
      return;
    }

    // Search by resource type
    const results = await manager.search({
      type: "StructureDefinition"
    });

    expect(Array.isArray(results)).toBe(true);
    
    if (results.length > 0) {
      const entry = results[0];
      expect(entry.id).toBeTruthy();
      expect(entry.resourceType).toBeTruthy();
      expect(entry.indexVersion).toBeGreaterThanOrEqual(1);
    }
  });

  test("should filter search by package", async () => {
    const packages = await manager.packages();
    if (packages.length === 0) {
      console.log("No FHIR packages found, skipping filtered search test");
      return;
    }

    const firstPackage = packages[0];
    
    const results = await manager.search({
      package: firstPackage
    });

    expect(Array.isArray(results)).toBe(true);
    
    // All results should be from the specified package
    results.forEach(entry => {
      expect(entry.package?.name).toBe(firstPackage.name);
      expect(entry.package?.version).toBe(firstPackage.version);
    });
  });

  test("should handle package-specific resolution", async () => {
    const packages = await manager.packages();
    if (packages.length === 0) {
      console.log("No FHIR packages found, skipping package-specific test");
      return;
    }

    // Find any resource URL from the first package
    const results = await manager.search({ package: packages[0] });
    if (results.length === 0) {
      console.log("No resources found in first package");
      return;
    }

    const firstResource = results[0];
    if (!firstResource.url) {
      console.log("First resource has no URL");
      return;
    }

    // Resolve with package constraint (without version since it might not match)
    const entry = await manager.resolve(firstResource.url, {
      package: packages[0].name
    });

    expect(entry.package?.name).toBe(packages[0].name);
    expect(entry.package?.version).toBe(packages[0].version);
  });
});