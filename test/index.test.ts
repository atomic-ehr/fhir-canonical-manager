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
      packages: ["hl7.fhir.us.core@8.0.0"],
      workingDir: testWorkingDir,
      registry: "https://fs.get-ig.org/pkgs"
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

  test("should install multiple packages with US Core dependencies", async () => {
    const packages = await manager.packages();
    
    // US Core 8.0.0 should install multiple dependencies
    expect(packages.length).toBeGreaterThan(5);
    
    // Check for expected packages
    const packageNames = packages.map(p => p.name);
    
    // Core packages that should be installed
    expect(packageNames).toContain("hl7.fhir.us.core");
    expect(packageNames).toContain("hl7.fhir.r4.core");
    expect(packageNames).toContain("hl7.terminology.r4");
    expect(packageNames).toContain("hl7.fhir.uv.extensions.r4");
    
    // Log for debugging
    console.log(`Installed ${packages.length} packages:`, packageNames);
  });

  test("should find Patient resources from multiple packages", async () => {
    // First, let's see what StructureDefinitions we have
    const allEntries = await manager.searchEntries({});
    console.log(`Total entries indexed: ${allEntries.length}`);
    
    // Search for StructureDefinitions
    const structureDefinitions = allEntries.filter(e => e.resourceType === "StructureDefinition");
    console.log(`Total StructureDefinitions: ${structureDefinitions.length}`);
    
    // Filter for Patient resources
    const patientStructDefs = structureDefinitions.filter(sd => 
      sd.type === "Patient" && sd.kind === "resource"
    );
    console.log(`Patient StructureDefinitions found: ${patientStructDefs.length}`);
    if (patientStructDefs.length > 0) {
      console.log("Patient resources:", patientStructDefs.map(p => ({
        url: p.url,
        package: p.package?.name,
        type: p.type,
        kind: p.kind
      })));
    }
    
    // Should find at least the base Patient from hl7.fhir.r4.core
    expect(patientStructDefs.length).toBeGreaterThanOrEqual(1);
    
    const r4Patient = patientStructDefs.find(p => p.package?.name === "hl7.fhir.r4.core");
    if (r4Patient) {
      expect(r4Patient?.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
    }
    
    // Search for US Core Patient profile - filter by URL pattern
    const usCoreProfiles = structureDefinitions.filter(sd => 
      sd.url?.toLowerCase().includes("us-core-patient")
    );
    console.log(`US Core Patient profiles found: ${usCoreProfiles.length}`);
    
    if (usCoreProfiles.length > 0) {
      const usCorePatient = usCoreProfiles.find(p => p.package?.name === "hl7.fhir.us.core");
      expect(usCorePatient).toBeDefined();
      expect(usCorePatient?.package?.name).toBe("hl7.fhir.us.core");
    }
  });

  test("should search for resources across all packages", async () => {
    // Get all entries first
    const allEntries = await manager.searchEntries({});
    
    // Filter for Patient-related resources (any resource type with "patient" in URL)
    const patientRelated = allEntries.filter(e => 
      e.url?.toLowerCase().includes('patient')
    );
    
    console.log(`Total Patient-related resources found: ${patientRelated.length}`);
    
    // Should find multiple Patient-related resources
    expect(patientRelated.length).toBeGreaterThan(1);
    
    // Group by package to see distribution
    const byPackage = patientRelated.reduce((acc, entry) => {
      const pkgName = entry.package?.name || 'unknown';
      acc[pkgName] = (acc[pkgName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log("Patient-related resources by package:", byPackage);
    
    // Should have resources from multiple packages
    expect(Object.keys(byPackage).length).toBeGreaterThanOrEqual(2);
    
    // Log some examples of patient-related resources
    const examples = patientRelated.slice(0, 5).map(e => ({
      resourceType: e.resourceType,
      url: e.url,
      package: e.package?.name
    }));
    console.log("Example patient-related resources:", examples);
  });

  test("should resolve resources with package disambiguation", async () => {
    // The base Patient resource should exist in r4.core
    const r4Patient = await manager.resolveEntry(
      "http://hl7.org/fhir/StructureDefinition/Patient",
      { package: "hl7.fhir.r4.core" }
    );
    
    expect(r4Patient.package?.name).toBe("hl7.fhir.r4.core");
    
    // Without package hint, should still resolve (picks first match)
    const anyPatient = await manager.resolveEntry(
      "http://hl7.org/fhir/StructureDefinition/Patient"
    );
    
    expect(anyPatient).toBeDefined();
    expect(anyPatient.url).toBe("http://hl7.org/fhir/StructureDefinition/Patient");
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
      const cacheContent = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
      expect(cacheContent.packageLockHash).toBeDefined();
      const originalHash = cacheContent.packageLockHash;
      
      // Modify package-lock.json (simulate package change)
      const packageLockPath = path.join(testWorkingDir, "package-lock.json");
      const packageLockContent = JSON.parse(await fs.readFile(packageLockPath, 'utf-8'));
      
      // Make a minimal change to the lock file
      packageLockContent.modified = new Date().toISOString();
      await fs.writeFile(packageLockPath, JSON.stringify(packageLockContent, null, 2));
      
      // Clear console output
      consoleOutput.length = 0;
      
      // Create new manager - should detect change and rebuild
      // Use empty packages array to avoid installation attempts
      const manager3 = CanonicalManager({ 
        packages: [],
        workingDir: testWorkingDir
      });
      
      await manager3.init();
      
      // Should have logged about rebuilding
      expect(consoleOutput.some(msg => msg.includes("Package dependencies have changed"))).toBe(true);
      
      // Verify new cache has different hash
      const newCacheContent = JSON.parse(await fs.readFile(cacheFile, 'utf-8'));
      expect(newCacheContent.packageLockHash).toBeDefined();
      expect(newCacheContent.packageLockHash).not.toBe(originalHash);
      
      // Restore original package-lock for other tests
      delete packageLockContent.modified;
      await fs.writeFile(packageLockPath, JSON.stringify(packageLockContent, null, 2));
      
      await manager3.destroy();
    } finally {
      console.log = originalLog;
    }
  });
});