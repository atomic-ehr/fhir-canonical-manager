import * as afs from "node:fs";
import * as Path from "node:path";
import { cacheRecordPaths } from "../src/cache";
import type { PackageManager } from "../src/types";

export const catchConsole = async (action: () => Promise<void>): Promise<string[]> => {
    const consoleOutput: string[] = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => consoleOutput.push(args.join(" "));
    console.error = (...args) => consoleOutput.push(`ERROR: ${args.join(" ")}`);
    try {
        await action();
    } finally {
        console.log = originalLog;
        console.error = originalError;
    }
    return consoleOutput;
};

export const changeWorkDir = async (dir: string, action: () => Promise<void>, removeDir: boolean = true) => {
    const originalCwd = process.cwd();
    try {
        afs.mkdirSync(dir, { recursive: true });
        process.chdir(dir);
        await action();
    } finally {
        process.chdir(originalCwd);
        if (removeDir && afs.existsSync(dir)) {
            afs.rmSync(dir, { recursive: true, force: true });
        }
    }
};

export const writePackage = async (content: any) => {
    afs.writeFileSync("package.json", JSON.stringify(content, null, 2));
};

export const writeNpmPackageJson = async (
    packages: string[],
    content: any,
    packageManager: PackageManager = "bun",
) => {
    const { npmPackagePath, npmRootPackageJsonFile } = cacheRecordPaths(process.cwd(), packageManager, packages);
    afs.mkdirSync(npmPackagePath, { recursive: true });
    afs.mkdirSync(Path.join(npmPackagePath, "node_modules"), { recursive: true });
    afs.writeFileSync(npmRootPackageJsonFile, JSON.stringify(content, null, 2));
};

export const writeCacheIndex = async (packages: string[], content: any, packageManager: PackageManager = "bun") => {
    const {
        cacheIndexFile: cacheIndex,
        cacheRecordPath,
        cacheKey,
    } = cacheRecordPaths(process.cwd(), packageManager, packages);
    content.packageLockHash = cacheKey;
    content.cacheKey = cacheKey; // Required for cache validation
    afs.mkdirSync(cacheRecordPath, { recursive: true });
    afs.writeFileSync(cacheIndex, JSON.stringify(content, null, 2));
};
