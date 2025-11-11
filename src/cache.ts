import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createReferenceManager, type ReferenceManager } from "./reference/index.js";
import type { CacheData, IndexCache } from "./types/index.js";

export interface ExtendedCache extends IndexCache {
    referenceManager: ReferenceManager;
}

export const createCache = (): ExtendedCache => {
    const referenceManager = createReferenceManager();
    return {
        entries: {},
        packages: {},
        references: {},
        referenceManager,
    };
};

export const computePackageLockHash = async (workingDir: string): Promise<string | null> => {
    try {
        // Try package-lock.json first
        const packageLockPath = path.join(workingDir, "package-lock.json");
        try {
            const content = await fs.readFile(packageLockPath, "utf-8");
            return createHash("sha256").update(content).digest("hex");
        } catch {
            // Try bun.lock if package-lock.json doesn't exist
            const bunLockPath = path.join(workingDir, "bun.lock");
            const content = await fs.readFile(bunLockPath, "utf-8");
            return createHash("sha256").update(content).digest("hex");
        }
    } catch {
        return null;
    }
};

export const saveCacheToDisk = async (cache: ExtendedCache, cacheDir: string, workingDir: string): Promise<void> => {
    const packageLockHash = await computePackageLockHash(workingDir);

    const cacheData: CacheData = {
        entries: cache.entries,
        packages: cache.packages,
        references: cache.referenceManager.getAllReferences(),
        packageLockHash: packageLockHash || undefined,
    };

    const cachePath = path.join(cacheDir, "index.json");
    await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
};

export const loadCacheFromDisk = async (cacheDir: string): Promise<CacheData | null> => {
    try {
        const cachePath = path.join(cacheDir, "index.json");
        const content = await fs.readFile(cachePath, "utf-8");
        return JSON.parse(content) as CacheData;
    } catch {
        return null;
    }
};
