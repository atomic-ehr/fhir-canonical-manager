/**
 * Package management functionality
 * Merged from package/detector.ts, package/installer.ts, and package/index.ts
 */

import { exec } from "node:child_process";
import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { promisify } from "node:util";
import { ensureDir, fileExists } from "./fs/index.js";

const execAsync = promisify(exec);

export type PackageManager = "bun" | "npm";

export const detectPackageManager = async (): Promise<PackageManager | undefined> => {
    try {
        await execAsync("bun --version");
        return "bun";
    } catch {
        try {
            await execAsync("npm --version");
            return "npm";
        } catch {
            return;
        }
    }
};

const ensurePackageJson = async (pwd: string) => {
    const packageJsonPath = Path.join(pwd, "package.json");
    if (!(await fileExists(packageJsonPath))) {
        const minimalPackageJson = {
            name: "fhir-canonical-manager-workspace",
            version: "1.0.0",
            private: true,
            dependencies: {},
        };
        await afs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2));
    }
};

export const installPackages = async (packages: string[], pwd: string, registry?: string): Promise<void> => {
    await ensureDir(pwd);
    ensurePackageJson(pwd);

    const packageManager = await detectPackageManager();
    if (!packageManager) throw new Error("No package manager found. Please install bun or npm.");

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
