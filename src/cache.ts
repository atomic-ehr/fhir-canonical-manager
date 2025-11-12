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

const cacheRecordPathsFromKey = (pwd: string, cacheKey: CacheKey) => {
    const cacheRecordPath = Path.join(pwd, cacheKey);
    const npmPackagePath = Path.join(process.cwd(), cacheRecordPath, "node");
    const cacheIndexFile = Path.join(cacheRecordPath, "index.json");
    return { cacheKey, cacheRecordPath, cacheIndexFile, npmPackagePath };
};

export const cacheRecordPaths = (pwd: string, packages: string[]) => {
    const cacheKey = computeCacheKey(packages);
    return cacheRecordPathsFromKey(pwd, cacheKey);
};

export const createCacheRecord = (): ExtendedCache => {
    return {
        entries: {},
        packages: {},
        references: {},
        referenceManager: createReferenceManager(),
    };
};

export const loadCacheRecordFromDisk = async (pwd: string, cacheKey: CacheKey): Promise<CacheData | undefined> => {
    try {
        const { cacheIndexFile } = cacheRecordPathsFromKey(pwd, cacheKey);
        const content = await afs.readFile(cacheIndexFile, "utf-8");
        return JSON.parse(content) as CacheData;
    } catch {
        return;
    }
};

export const saveCacheRecordToDisk = async (cache: ExtendedCache, pwd: string, cacheKey: CacheKey): Promise<void> => {
    const cacheData: CacheData = {
        entries: cache.entries,
        packages: cache.packages,
        references: cache.referenceManager.getAllReferences(),
        packageLockHash: cacheKey,
    };
    const { cacheIndexFile, cacheRecordPath } = cacheRecordPathsFromKey(pwd, cacheKey);
    await afs.mkdir(cacheRecordPath, { recursive: true });
    await afs.writeFile(cacheIndexFile, JSON.stringify(cacheData, null, 2));
};
