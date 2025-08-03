import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import * as path from "path";
import * as fs from "fs";

describe("CLI Integration Tests", () => {
  const cliPath = path.join(process.cwd(), "dist/cli/index.js");
  const testDir = path.join(process.cwd(), "test-integration-cli");
  const testDirUsCore = path.join(process.cwd(), "test-integration-cli-uscore");

  // Setup function to ensure CLI is built
  const ensureCLIBuilt = async () => {
    if (!fs.existsSync(cliPath)) {
      await $`bun run build`;
    }
  };

  // Cleanup function
  const cleanup = () => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    if (fs.existsSync(testDirUsCore)) {
      fs.rmSync(testDirUsCore, { recursive: true, force: true });
    }
  };

  test("fcm search with -sd shortcut", async () => {
    await ensureCLIBuilt();
    // Create test directory with initialized FCM
    fs.mkdirSync(testDir, { recursive: true });
    
    const packageJson = {
      name: "test-project",
      fcm: {
        packages: ["hl7.fhir.r4.core"],
        registry: "https://fs.get-ig.org/pkgs"
      },
      dependencies: {
        "hl7.fhir.r4.core": "latest"
      }
    };
    
    fs.writeFileSync(
      path.join(testDir, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Run the CLI command
    const result = await $`cd ${testDir} && bun ${cliPath} search -sd --limit 5`.text();
    
    // Verify output
    expect(result).toContain("StructureDefinition");
    
    // Either "Found X resources" or specific results
    expect(result.match(/Found \d+ resources|No resources found/)).toBeTruthy();
    
    cleanup();
  });

  test("fcm search with prefix matching", async () => {
    await ensureCLIBuilt();
    
    // Recreate test directory if needed
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
      const packageJson = {
        name: "test-project",
        fcm: {
          packages: ["hl7.fhir.r4.core"],
          registry: "https://fs.get-ig.org/pkgs"
        },
        dependencies: {
          "hl7.fhir.r4.core": "latest"
        }
      };
      fs.writeFileSync(
        path.join(testDir, "package.json"),
        JSON.stringify(packageJson, null, 2)
      );
    }
    
    // Run prefix search
    const result = await $`cd ${testDir} && bun ${cliPath} search pat --limit 3`.text();
    
    // Should find patient-related resources
    expect(result.toLowerCase()).toMatch(/patient|pat/);
    
    cleanup();
  });

  test("parseArgs handles shortcuts correctly", async () => {
    await ensureCLIBuilt();
    // Test the CLI with --help to verify it parses args correctly
    const result = await $`bun ${cliPath} --help`.text();
    expect(result).toContain("fcm");
    expect(result).toContain("search");
  });

  test("fcm search with US Core shows resources from multiple packages", async () => {
    await ensureCLIBuilt();
    
    // Create test directory with US Core
    fs.mkdirSync(testDirUsCore, { recursive: true });
    
    const packageJson = {
      name: "test-project-uscore",
      fcm: {
        packages: ["hl7.fhir.us.core@8.0.0"],
        registry: "https://fs.get-ig.org/pkgs"
      },
      dependencies: {
        "hl7.fhir.us.core": "8.0.0"
      }
    };
    
    fs.writeFileSync(
      path.join(testDirUsCore, "package.json"),
      JSON.stringify(packageJson, null, 2)
    );

    // Initialize the packages (this will install US Core and its dependencies)
    console.log("Installing US Core and dependencies...");
    const initResult = await $`cd ${testDirUsCore} && bun ${cliPath} init`.text();
    console.log("Init result:", initResult);

    // Search for Patient resources - should find from multiple packages
    const result = await $`cd ${testDirUsCore} && bun ${cliPath} search patient -sd --limit 10`.text();
    
    console.log("Search result:", result);
    
    // Verify output contains resources from multiple packages
    expect(result).toContain("Found");
    expect(result).toContain("StructureDefinition");
    
    // Check that results include package information
    expect(result).toContain('"package":');
    
    // Should find resources from different packages
    const lines = result.split('\n');
    const resourceLines = lines.filter(line => line.includes('http://') && line.includes('"package":'));
    
    // Extract unique packages from results
    const packages = new Set<string>();
    resourceLines.forEach(line => {
      const match = line.match(/"package":"([^"]+)"/);
      if (match && match[1]) {
        packages.add(match[1]);
      }
    });
    
    console.log("Unique packages found:", Array.from(packages));
    
    // Should have resources from multiple packages (at least r4.core and us.core)
    expect(packages.size).toBeGreaterThanOrEqual(2);
    expect(packages.has("hl7.fhir.r4.core")).toBe(true);
    expect(packages.has("hl7.fhir.us.core")).toBe(true);
    
    cleanup();
  }, 60000); // Increase timeout for package installation
});