import * as fs from 'fs';
import * as path from 'path';
import { $ } from '../compat.js';
import { parseArgs, loadPackageJson, savePackageJson } from './index.js';
import { CanonicalManager } from '../index.js';

export async function initCommand(args: string[]): Promise<void> {
  const { positional, options } = parseArgs(args);
  const packages = positional;
  const registry = options.registry as string | undefined;

  // Load or create package.json
  let packageJson = await loadPackageJson();
  const isNewPackageJson = !packageJson;
  
  if (!packageJson) {
    // Create minimal package.json
    packageJson = {
      name: path.basename(process.cwd()),
      version: "1.0.0",
      type: "module"
    };
  }

  // Initialize fcm config
  if (!packageJson.fcm) {
    packageJson.fcm = {
      packages: [],
      registry: registry || "https://fs.get-ig.org/pkgs"
    };
  }

  // If no packages specified, use packages from config
  const packagesToInstall = packages.length > 0 ? packages : packageJson.fcm.packages;
  
  if (packagesToInstall.length === 0) {
    console.error("Error: No packages specified");
    console.error("Usage: fcm init [packages...]");
    console.error("Example: fcm init hl7.fhir.r4.core hl7.fhir.us.core@5.0.1");
    process.exit(1);
  }

  // Update fcm packages list (merge with existing)
  const existingPackages = new Set(packageJson.fcm.packages);
  packagesToInstall.forEach((pkg: string) => {
    existingPackages.add(pkg);
  });
  packageJson.fcm.packages = Array.from(existingPackages);

  // Update registry if provided
  if (registry) {
    packageJson.fcm.registry = registry;
  }

  // Initialize dependencies if not present
  if (!packageJson.dependencies) {
    packageJson.dependencies = {};
  }

  // Save package.json
  await savePackageJson(packageJson);
  
  if (isNewPackageJson) {
    console.log("Created package.json");
  }

  // Install packages using npm
  console.log("Installing FHIR packages...");
  
  for (const pkg of packagesToInstall) {
    console.log(`Installing ${pkg}...`);
    try {
      if (packageJson.fcm.registry) {
        await $`npm install ${pkg} --registry ${packageJson.fcm.registry}`.quiet();
      } else {
        await $`npm install ${pkg}`.quiet();
      }
    } catch (error) {
      console.error(`Failed to install ${pkg}`);
      throw error;
    }
  }

  // Initialize CanonicalManager to build cache
  console.log("Building package index...");
  const manager = CanonicalManager({
    packages: packageJson.fcm.packages,
    workingDir: process.cwd(),
    registry: packageJson.fcm.registry
  });

  await manager.init();
  
  // Show summary
  const installedPackages = await manager.packages();
  console.log("\nInstalled packages:");
  installedPackages.forEach(pkg => {
    console.log(`  ${pkg.name}@${pkg.version}`);
  });

  await manager.destroy();
  console.log("\nInitialization complete!");
}