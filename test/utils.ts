import * as afs from "node:fs";
import { cacheRecordPaths } from "../src/cache";

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

export const changeWorkDir = async (dir: string, action: () => Promise<void>) => {
    const originalCwd = process.cwd();
    try {
        afs.mkdirSync(dir, { recursive: true });
        process.chdir(dir);
        await action();
    } finally {
        // if (afs.existsSync(testDir)) {
        //     afs.rmSync(testDir, { recursive: true, force: true });
        // }

        process.chdir(originalCwd);
    }
};

export const writePackage = async (content: any) => {
    afs.writeFileSync("package.json", JSON.stringify(content, null, 2));
};

export const writeCacheIndex = async (packages: string[], content: any) => {
    const { cacheIndexFile: cacheIndex, cacheRecordPath, cacheKey } = cacheRecordPaths(process.cwd(), packages);
    content.packageLockHash = cacheKey;
    afs.mkdirSync(cacheRecordPath, { recursive: true });
    afs.writeFileSync(cacheIndex, JSON.stringify(content, null, 2));
};
