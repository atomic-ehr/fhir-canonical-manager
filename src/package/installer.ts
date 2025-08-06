/**
 * Package installation functionality
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ensureDir, fileExists } from '../fs/index.js';
import { detectPackageManager } from './detector.js';

const execAsync = promisify(exec);

export const installPackages = async (
  packages: string[],
  workingDir: string,
  registry?: string,
): Promise<void> => {
  await ensureDir(workingDir);

  // Check if package.json exists
  const packageJsonPath = path.join(workingDir, "package.json");
  if (!(await fileExists(packageJsonPath))) {
    // Create minimal package.json
    const minimalPackageJson = {
      name: "fhir-canonical-manager-workspace",
      version: "1.0.0",
      private: true,
      dependencies: {},
    };
    await fs.writeFile(
      packageJsonPath,
      JSON.stringify(minimalPackageJson, null, 2),
    );
  }

  // Detect available package manager
  const packageManager = await detectPackageManager();
  if (!packageManager) {
    throw new Error("No package manager found. Please install npm or bun.");
  }

  // Install packages
  for (const pkg of packages) {
    try {
      if (packageManager === "bun") {
        // Use bun with auth bypass trick for FHIR registry
        const env = {
          ...process.env,
          HOME: workingDir, // Prevent reading user's .npmrc
          NPM_CONFIG_USERCONFIG: "/dev/null", // Extra safety
        };

        const cmd = registry
          ? `cd ${workingDir} && bun add ${pkg} --registry ${registry}`
          : `cd ${workingDir} && bun add ${pkg}`;

        await execAsync(cmd, {
          env,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
      } else {
        // Use npm (handles auth correctly)
        const cmd = registry
          ? `cd ${workingDir} && npm add ${pkg} --registry ${registry}`
          : `cd ${workingDir} && npm add ${pkg}`;

        await execAsync(cmd, {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        });
      }
    } catch (err) {
      console.error(`Failed to install package ${pkg}:`, err);
      throw err;
    }
  }
};