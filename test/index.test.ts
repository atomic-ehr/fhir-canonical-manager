/**
 * FHIR Canonical Manager Tests
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { CanonicalManager } from "../src";
import type { IndexEntry, Reference, Resource } from "../src";
import * as fs from 'fs/promises';
import * as path from 'path';

describe("CanonicalManager", () => {
  let manager: CanonicalManager;
  const testWorkingDir = "./tmp/test-fhir";

  beforeAll(async () => {
    // Clean up test directory
    await fs.rm(testWorkingDir, { recursive: true, force: true }).catch(() => {});

    manager = CanonicalManager({ 
      packages: ["hl7.fhir.r4.core"],
      workingDir: testWorkingDir,
      registry: "https://packages.simplifier.net"
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
    const packageJsonExists = await fs.access(path.join(testWorkingDir, "package.json")).then(() => true).catch(() => false);
    expect(packageJsonExists).toBe(true);
    
    const cacheExists = await fs.access(path.join(testWorkingDir, ".fcm", "cache")).then(() => true).catch(() => false);
    expect(cacheExists).toBe(true);
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
    const uninitializedManager = CanonicalManager({
      packages: ["hl7.fhir.r4.core"],
      workingDir: "./tmp/uninitialized"
    });
    await expect(uninitializedManager.packages()).rejects.toThrow(
      "CanonicalManager not initialized"
    );
  });

  test("should resolve canonical URL to IndexEntry using resolveEntry", async () => {
    const entry = await manager.resolveEntry(
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
  });

  test("should resolve canonical URL directly to Resource using resolve", async () => {
    const resource = await manager.resolve(
      "http://hl7.org/fhir/StructureDefinition/Patient"
    );
    
    expect(resource).toBeDefined();
    expect(resource.resourceType).toBe("StructureDefinition");
    expect(resource.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
  });

  test("should throw when canonical URL not found", async () => {
    await expect(
      manager.resolveEntry("http://example.com/non-existent-resource")
    ).rejects.toThrow("Cannot resolve canonical URL");
  });

  test("should read resource by reference", async () => {
    // First resolve to get a reference
    const entry = await manager.resolveEntry(
      "http://hl7.org/fhir/StructureDefinition/Patient"
    );
    
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
      resourceType: "StructureDefinition"
    };

    await expect(manager.read(invalidReference)).rejects.toThrow(
      "Invalid reference ID"
    );
  });

  test("should search for resources using searchEntries", async () => {
    // Search by resource type
    const results = await manager.searchEntries({
      type: "StructureDefinition"
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
      type: "StructureDefinition"
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
    expect(packages.length).toBeGreaterThan(0);
    
    const firstPackage = packages[0]!;
    
    // Find any resource URL from the first package
    const results = await manager.searchEntries({ package: firstPackage });
    expect(results.length).toBeGreaterThan(0);
    
    const firstResource = results.find(r => r.url);
    expect(firstResource).toBeDefined();
    expect(firstResource!.url).toBeDefined();
    
    // Resolve with package constraint (without version since it might not match)
    const entry = await manager.resolveEntry(firstResource!.url!, {
      package: firstPackage.name
    });

    expect(entry.package?.name).toBe(firstPackage.name);
    expect(entry.package?.version).toBe(firstPackage.version);
  });

  test("should use cached data on second init", async () => {
    // Create a new manager with same working directory
    const manager2 = CanonicalManager({ 
      packages: ["hl7.fhir.r4.core"],
      workingDir: testWorkingDir
    });
    
    // Should load from cache
    await manager2.init();
    
    // Should have same packages
    const packages1 = await manager.packages();
    const packages2 = await manager2.packages();
    
    expect(packages2.length).toBe(packages1.length);
    
    await manager2.destroy();
  });
});