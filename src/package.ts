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

/**
 * Parse package reference to extract name (without version)
 */
const parsePackageName = (pkg: string): string => {
    // Handle URLs
    if (pkg.startsWith("http://") || pkg.startsWith("https://")) {
        return pkg;
    }
    // Handle scoped packages @scope/name@version
    if (pkg.startsWith("@")) {
        const match = pkg.match(/^(@[^/]+\/[^@]+)(?:@.*)?$/);
        return match?.[1] ? match[1] : pkg;
    }
    // Handle regular packages name@version
    const atIndex = pkg.indexOf("@");
    return atIndex > 0 ? pkg.substring(0, atIndex) : pkg;
};

/**
 * Get installed package path in node_modules
 */
const getInstalledPackagePath = (packageName: string, pwd: string): string => {
    const name = parsePackageName(packageName);
    return Path.join(pwd, "node_modules", name);
};

/**
 * Read dependencies from an installed package's package.json
 */
const getPackageDependencies = async (packagePath: string): Promise<Record<string, string>> => {
    const packageJsonPath = Path.join(packagePath, "package.json");
    if (!(await fileExists(packageJsonPath))) {
        return {};
    }
    try {
        const content = await afs.readFile(packageJsonPath, "utf8");
        const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };
        return pkg.dependencies ?? {};
    } catch {
        return {};
    }
};

/**
 * Install a single package using the package manager
 */
const installSinglePackage = async (
    pkg: string,
    pwd: string,
    packageManager: PackageManager,
    registry?: string,
): Promise<void> => {
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
};

export const installPackages = async (packages: string[], pwd: string, registry?: string): Promise<void> => {
    await ensureDir(pwd);
    await ensurePackageJson(pwd);

    const packageManager = await detectPackageManager();
    if (!packageManager) throw new Error("No package manager found. Please install bun or npm.");

    // Build a map of user-specified package names to their full refs
    // User-specified versions take precedence over transitive dependency versions
    const userSpecifiedVersions = new Map<string, string>();
    for (const pkg of packages) {
        const name = parsePackageName(pkg);
        userSpecifiedVersions.set(name, pkg);
    }

    // Track installed packages to avoid circular dependencies
    const installed = new Set<string>();

    const installWithDependencies = async (pkg: string): Promise<void> => {
        const packageName = parsePackageName(pkg);

        // Skip if already installed
        if (installed.has(packageName)) {
            return;
        }

        if (!isValidPackageRef(pkg)) {
            throw new Error(`Invalid package reference: ${pkg}`);
        }

        try {
            await installSinglePackage(pkg, pwd, packageManager, registry);
            installed.add(packageName);

            // Read dependencies from installed package and install them recursively
            // This is needed because some registries (like Simplifier) don't expose
            // dependencies in their npm metadata
            const packagePath = getInstalledPackagePath(packageName, pwd);
            const dependencies = await getPackageDependencies(packagePath);

            for (const [depName, depVersion] of Object.entries(dependencies)) {
                if (!installed.has(depName)) {
                    // Prefer user-specified version over transitive dependency version
                    const depRef = userSpecifiedVersions.get(depName) ?? `${depName}@${depVersion}`;
                    await installWithDependencies(depRef);
                }
            }
        } catch (err) {
            console.error(`Failed to install package ${pkg}:`, err);
            throw err;
        }
    };

    for (const pkg of packages) {
        await installWithDependencies(pkg);
    }
};
