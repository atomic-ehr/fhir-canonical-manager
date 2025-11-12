/**
 * Package installation functionality
 */

import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { ensureDir, fileExists } from "../fs/index.js";
import { detectPackageManager } from "./detector.js";

const execAsync = promisify(exec);

export const installPackages = async (packages: string[], pwd: string, registry?: string): Promise<void> => {
    await ensureDir(pwd);

    const packageJsonPath = path.join(pwd, "package.json");
    if (!(await fileExists(packageJsonPath))) {
        const minimalPackageJson = {
            name: "fhir-canonical-manager-workspace",
            version: "1.0.0",
            private: true,
            dependencies: {},
        };
        await fs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2));
    }

    // Detect available package manager
    const packageManager = await detectPackageManager();
    if (!packageManager) {
        throw new Error("No package manager found. Please install bun or npm.");
    }

    // Install packages
    for (const pkg of packages) {
        try {
            if (packageManager === "bun") {
                // Use bun with auth bypass trick for FHIR registry
                const env = {
                    ...process.env,
                    HOME: pwd, // Prevent reading user's .npmrc
                    NPM_CONFIG_USERCONFIG: "/dev/null", // Extra safety
                };

                const cmd = registry
                    ? `bun add ${pkg} --cwd='${pwd}' --registry='${registry}'`
                    : `bun add --cwd='${pwd}' ${pkg}`;
                await execAsync(cmd, {
                    env,
                    maxBuffer: 10 * 1024 * 1024, // 10MB buffer
                });
            } else {
                // Use npm (handles auth correctly)
                const cmd = registry ? `cd ${pwd} && npm add ${pkg} --registry=${registry}` : `npm add ${pkg}`;
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
