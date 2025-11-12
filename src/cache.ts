import { createHash } from "node:crypto";
import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { createReferenceManager, type ReferenceManager } from "./reference/index.js";
import type { CacheData, CacheKey, IndexCache } from "./types/index.js";

export interface ExtendedCache extends IndexCache {
    referenceManager: ReferenceManager;
}

export const computeCacheKey = (packages: string[]): CacheKey => {
    const content = JSON.stringify(packages.toSorted());
    const hash = createHash("sha256").update(content).digest("hex");
    return hash as CacheKey;
};

export const cachePaths = (pwd: string, packages: string[]) => {
    const cacheKey = computeCacheKey(packages);
    const cacheRecordPath = Path.join(pwd, cacheKey);
    const npmPackagePath = Path.join(process.cwd(), cacheRecordPath, "node");
    const cacheIndex = Path.join(cacheRecordPath, "index.json");
    return { cacheKey, cacheRecordPath, cacheIndex, npmPackagePath };
};

export const createCache = (): ExtendedCache => {
    return {
        entries: {},
        packages: {},
        references: {},
        referenceManager: createReferenceManager(),
    };
};

export const loadCacheFromDisk = async (pwd: string, cacheKey: CacheKey): Promise<CacheData | undefined> => {
    try {
        const cacheIndexFile = Path.join(pwd, cacheKey, "index.json");
        const content = await afs.readFile(cacheIndexFile, "utf-8");
        return JSON.parse(content) as CacheData;
    } catch {
        return;
    }
};

export const saveCacheToDisk = async (cache: ExtendedCache, pwd: string, cacheKey: CacheKey): Promise<void> => {
    const cacheData: CacheData = {
        entries: cache.entries,
        packages: cache.packages,
        references: cache.referenceManager.getAllReferences(),
        packageLockHash: cacheKey,
    };
    const cachePath = Path.join(pwd, cacheKey, "index.json");
    await afs.mkdir(Path.dirname(cachePath), { recursive: true });
    await afs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
};
