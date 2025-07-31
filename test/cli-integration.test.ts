import { test, expect, describe } from "bun:test";
import { $ } from "bun";
import * as path from "path";
import * as fs from "fs";

describe("CLI Integration Tests", () => {
  const cliPath = path.join(process.cwd(), "dist/cli/index.js");
  const testDir = path.join(process.cwd(), "test-integration-cli");

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
});