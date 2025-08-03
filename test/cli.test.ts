import { test, expect, describe } from "bun:test";
import { parseArgs } from "../src/cli/index";
import { searchCommand } from "../src/cli/search";
import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

// Helper to create mock package-lock.json and calculate its hash
const createMockPackageLock = (testDir: string): string => {
  const packageLockContent = JSON.stringify({ lockfileVersion: 2, mockData: "test" }, null, 2);
  fs.writeFileSync(
    path.join(testDir, "package-lock.json"),
    packageLockContent
  );
  return createHash('sha256').update(packageLockContent).digest('hex');
};

describe("CLI parseArgs", () => {
  test("should parse short aliases for resource types", () => {
    const { options: sdOptions } = parseArgs(["-sd"]);
    expect(sdOptions.resourceType).toBe("StructureDefinition");

    const { options: csOptions } = parseArgs(["-cs"]);
    expect(csOptions.resourceType).toBe("CodeSystem");

    const { options: vsOptions } = parseArgs(["-vs"]);
    expect(vsOptions.resourceType).toBe("ValueSet");
  });

  test("should parse short aliases with other arguments", () => {
    const { positional, options } = parseArgs(["-sd", "patient", "--limit", "5"]);
    expect(options.resourceType).toBe("StructureDefinition");
    expect(positional).toEqual(["patient"]);
    expect(options.limit).toBe("5");
  });

  test("should handle multiple positional arguments for prefix search", () => {
    const { positional, options } = parseArgs(["str", "def", "pat"]);
    expect(positional).toEqual(["str", "def", "pat"]);
    expect(options).toEqual({});
  });

  test("should parse mixed arguments correctly", () => {
    const { positional, options } = parseArgs(["-sd", "str", "def", "pat", "--json"]);
    expect(options.resourceType).toBe("StructureDefinition");
    expect(positional).toEqual(["str", "def", "pat"]);
    expect(options.json).toBe(true);
  });

  test("should parse -t and -k options", () => {
    const { options: tOptions } = parseArgs(["-t", "Extension"]);
    expect(tOptions.t).toBe("Extension");

    const { options: kOptions } = parseArgs(["-k", "resource"]);
    expect(kOptions.k).toBe("resource");

    const { options: combinedOptions } = parseArgs(["-t", "Patient", "-k", "resource", "-sd"]);
    expect(combinedOptions.t).toBe("Patient");
    expect(combinedOptions.k).toBe("resource");
    expect(combinedOptions.resourceType).toBe("StructureDefinition");
  });
});

describe("CLI search output format", () => {
  test("should output results in single-line format", async () => {
    // Create a mock environment
    const testDir = path.join(process.cwd(), "tmp", "test-search-format-" + Date.now());
    const originalCwd = process.cwd();
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    
    // Mock console
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push("ERROR: " + args.join(" "));
    
    try {
      // Setup test directory with package.json
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          fcm: {
            packages: ["hl7.fhir.r4.core"]
          }
        }, null, 2)
      );
      
      // Create mock package-lock.json and get its hash
      const packageLockHash = createMockPackageLock(testDir);
      
      // Create mock .fcm cache directory with test data
      const fcmDir = path.join(testDir, ".fcm", "cache");
      fs.mkdirSync(fcmDir, { recursive: true });
      
      // Create a minimal index.json with test data
      const mockIndex = {
        packageLockHash, // Use calculated hash
        packages: [{
          name: "hl7.fhir.r4.core",
          version: "4.0.1"
        }],
        entries: {
          "http://hl7.org/fhir/StructureDefinition/Patient": [{
            url: "http://hl7.org/fhir/StructureDefinition/Patient",
            resourceType: "StructureDefinition",
            kind: "resource",
            type: "Patient",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-1"
          }],
          "http://hl7.org/fhir/StructureDefinition/patient-animal": [{
            url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
            resourceType: "StructureDefinition", 
            kind: "complex-type",
            type: "Extension",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-2"
          }]
        },
        references: {
          "test-id-1": {
            path: "StructureDefinition-Patient.json",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" }
          },
          "test-id-2": {
            path: "StructureDefinition-patient-animal.json",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" }
          }
        }
      };
      
      fs.writeFileSync(
        path.join(fcmDir, "index.json"),
        JSON.stringify(mockIndex, null, 2)
      );
      
      // Change to test directory
      process.chdir(testDir);
      
      // Run search command
      await searchCommand(["pat"]);
      
      // Verify output format
      const output = consoleOutput.join("\n");
      
      // Should contain the header
      expect(output).toContain('Found 2 resources matching "pat":');
      
      // Should have single-line format with JSON including package
      expect(output).toContain('http://hl7.org/fhir/StructureDefinition/Patient, {"resourceType":"StructureDefinition","kind":"resource","type":"Patient","package":"hl7.fhir.r4.core"}');
      expect(output).toContain('http://hl7.org/fhir/StructureDefinition/patient-animal, {"resourceType":"StructureDefinition","kind":"complex-type","type":"Extension","package":"hl7.fhir.r4.core"}');
      
      // Verify JSON structure is valid
      const lines = output.split("\n").filter(line => line.includes(", {"));
      lines.forEach(line => {
        const jsonPart = line.substring(line.indexOf(", {") + 2);
        expect(() => JSON.parse(jsonPart)).not.toThrow();
        const parsed = JSON.parse(jsonPart);
        expect(parsed).toHaveProperty("resourceType");
        expect(parsed).toHaveProperty("kind");
        expect(parsed).toHaveProperty("type");
        expect(parsed).toHaveProperty("package");
      });
      
    } finally {
      // Cleanup
      console.log = originalLog;
      console.error = originalError;
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  test("should handle empty results gracefully", async () => {
    const testDir = path.join(process.cwd(), "tmp", "test-empty-search-" + Date.now());
    const originalCwd = process.cwd();
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push("ERROR: " + args.join(" "));
    
    try {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          fcm: {
            packages: ["hl7.fhir.r4.core"]
          }
        }, null, 2)
      );
      
      // Create mock package-lock.json and get its hash
      const packageLockHash = createMockPackageLock(testDir);
      
      // Create empty index
      const fcmDir = path.join(testDir, ".fcm", "cache");
      fs.mkdirSync(fcmDir, { recursive: true });
      fs.writeFileSync(
        path.join(fcmDir, "index.json"),
        JSON.stringify({
          packageLockHash,
          packages: [{ name: "hl7.fhir.r4.core", version: "4.0.1" }],
          entries: {},
          references: {}
        }, null, 2)
      );
      
      process.chdir(testDir);
      
      // Search for something that won't match
      await searchCommand(["xyz"]);
      
      const output = consoleOutput.join("\n");
      expect(output).toContain("No resources found");
      
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  test("should filter by type using -t option", async () => {
    const testDir = path.join(process.cwd(), "tmp", "test-type-filter-" + Date.now());
    const originalCwd = process.cwd();
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push("ERROR: " + args.join(" "));
    
    try {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          fcm: {
            packages: ["hl7.fhir.r4.core"]
          }
        }, null, 2)
      );
      
      // Create mock package-lock.json and get its hash
      const packageLockHash = createMockPackageLock(testDir);
      
      // Create index with mixed types
      const fcmDir = path.join(testDir, ".fcm", "cache");
      fs.mkdirSync(fcmDir, { recursive: true });
      
      const mockIndex = {
        packageLockHash,
        packages: [{
          name: "hl7.fhir.r4.core",
          version: "4.0.1"
        }],
        entries: {
          "http://hl7.org/fhir/StructureDefinition/Patient": [{
            url: "http://hl7.org/fhir/StructureDefinition/Patient",
            resourceType: "StructureDefinition",
            kind: "resource",
            type: "Patient",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-1"
          }],
          "http://hl7.org/fhir/StructureDefinition/patient-animal": [{
            url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
            resourceType: "StructureDefinition",
            kind: "complex-type",
            type: "Extension",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-2"
          }],
          "http://hl7.org/fhir/StructureDefinition/patient-birthPlace": [{
            url: "http://hl7.org/fhir/StructureDefinition/patient-birthPlace",
            resourceType: "StructureDefinition",
            kind: "complex-type",
            type: "Extension",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-3"
          }]
        },
        references: {
          "test-id-1": { path: "StructureDefinition-Patient.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } },
          "test-id-2": { path: "StructureDefinition-patient-animal.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } },
          "test-id-3": { path: "StructureDefinition-patient-birthPlace.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } }
        }
      };
      
      fs.writeFileSync(
        path.join(fcmDir, "index.json"),
        JSON.stringify(mockIndex, null, 2)
      );
      
      process.chdir(testDir);
      
      // Search for Extensions only
      await searchCommand(["-t", "Extension"]);
      
      const output = consoleOutput.join("\n");
      expect(output).toContain("Found 2 resources");
      expect(output).toContain("patient-animal");
      expect(output).toContain("patient-birthPlace");
      expect(output).not.toContain("StructureDefinition/Patient,"); // Should not include Patient resource
      
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });

  test("should filter by kind using -k option", async () => {
    const testDir = path.join(process.cwd(), "tmp", "test-kind-filter-" + Date.now());
    const originalCwd = process.cwd();
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push("ERROR: " + args.join(" "));
    
    try {
      fs.mkdirSync(testDir, { recursive: true });
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify({
          name: "test-project",
          fcm: {
            packages: ["hl7.fhir.r4.core"]
          }
        }, null, 2)
      );
      
      // Create mock package-lock.json and get its hash
      const packageLockHash = createMockPackageLock(testDir);
      
      // Create index with mixed kinds
      const fcmDir = path.join(testDir, ".fcm", "cache");
      fs.mkdirSync(fcmDir, { recursive: true });
      
      const mockIndex = {
        packageLockHash,
        packages: [{
          name: "hl7.fhir.r4.core",
          version: "4.0.1"
        }],
        entries: {
          "http://hl7.org/fhir/StructureDefinition/Patient": [{
            url: "http://hl7.org/fhir/StructureDefinition/Patient",
            resourceType: "StructureDefinition",
            kind: "resource",
            type: "Patient",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-1"
          }],
          "http://hl7.org/fhir/StructureDefinition/HumanName": [{
            url: "http://hl7.org/fhir/StructureDefinition/HumanName",
            resourceType: "StructureDefinition",
            kind: "complex-type",
            type: "HumanName",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-2"
          }],
          "http://hl7.org/fhir/StructureDefinition/string": [{
            url: "http://hl7.org/fhir/StructureDefinition/string",
            resourceType: "StructureDefinition",
            kind: "primitive-type",
            type: "string",
            package: { name: "hl7.fhir.r4.core", version: "4.0.1" },
            id: "test-id-3"
          }]
        },
        references: {
          "test-id-1": { path: "StructureDefinition-Patient.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } },
          "test-id-2": { path: "StructureDefinition-HumanName.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } },
          "test-id-3": { path: "StructureDefinition-string.json", package: { name: "hl7.fhir.r4.core", version: "4.0.1" } }
        }
      };
      
      fs.writeFileSync(
        path.join(fcmDir, "index.json"),
        JSON.stringify(mockIndex, null, 2)
      );
      
      process.chdir(testDir);
      
      // Search for resources only
      await searchCommand(["-k", "resource"]);
      
      const output = consoleOutput.join("\n");
      expect(output).toContain("Found 1 resource");
      expect(output).toContain("Patient");
      expect(output).not.toContain("HumanName");
      expect(output).not.toContain("string");
      
    } finally {
      console.log = originalLog;
      console.error = originalError;
      process.chdir(originalCwd);
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    }
  });
});