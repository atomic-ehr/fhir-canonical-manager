/**
 * Package management functionality
 * Merged from package/detector.ts, package/installer.ts, and package/index.ts
 */

import { type ExecOptions, exec } from "node:child_process";
import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { promisify } from "node:util";
import { ensureDir, fileExists } from "./fs/index.js";

const execAsync = promisify(exec);

export type PackageManager = "bun" | "npm";

const isValidPackageRef = (pkg: string): boolean => {
    if (pkg.startsWith("http://") || pkg.startsWith("https://")) {
        return true;
    }
    if (pkg.startsWith("/") || pkg.startsWith("./") || pkg.startsWith("../")) {
        return /^[a-zA-Z0-9_./@-]+$/.test(pkg);
    }
    return /^(@[a-zA-Z0-9_-]+\/)?[a-zA-Z0-9._-]+(@[a-zA-Z0-9._-]+)?$/.test(pkg);
};

const shellEscape = (str: string): string => {
    return str.replace(/'/g, "'\\''");
};

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
    await ensurePackageJson(pwd);

    const packageManager = await detectPackageManager();
    if (!packageManager) throw new Error("No package manager found. Please install bun or npm.");

    for (const pkg of packages) {
        if (!isValidPackageRef(pkg)) {
            throw new Error(`Invalid package reference: ${pkg}`);
        }

        try {
            const safePkg = shellEscape(pkg);
            const safePwd = shellEscape(pwd);
            const safeRegistry = registry ? shellEscape(registry) : undefined;

            let cmd: string;
            const opt: ExecOptions = {
                maxBuffer: 10 * 1024 * 1024,
            };
            if (packageManager === "bun") {
                cmd = safeRegistry
                    ? `bun add '${safePkg}' --cwd='${safePwd}' --registry='${safeRegistry}'`
                    : `bun add --cwd='${safePwd}' '${safePkg}'`;
                opt.env = {
                    ...process.env,
                    HOME: pwd, // Prevent reading user's .npmrc
                    NPM_CONFIG_USERCONFIG: "/dev/null", // Extra safety
                };
            } else {
                cmd = safeRegistry
                    ? `cd '${safePwd}' && npm add '${safePkg}' --registry='${safeRegistry}'`
                    : `cd '${safePwd}' && npm add '${safePkg}'`;
            }
            await execAsync(cmd, opt);
        } catch (err) {
            console.error(`Failed to install package ${pkg}:`, err);
            throw err;
        }
    }
};
