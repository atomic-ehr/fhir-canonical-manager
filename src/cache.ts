import { createHash } from "node:crypto";
import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { createReferenceManager, type ReferenceManager } from "./reference.js";
import type { CacheData, CacheKey, IndexCache, PackageInfo, PackageManager } from "./types/index.js";

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
    const npmRootPackageJsonFile = Path.join(npmPackagePath, "package.json");
    const cacheIndexFile = Path.join(cacheRecordPath, "index.json");
    return { cacheKey, cacheRecordPath, cacheIndexFile, npmPackagePath, npmRootPackageJsonFile };
};

export const cacheRecordPaths = (pwd: string, packages: string[]) => {
    const cacheKey = computeCacheKey(packages);
    return cacheRecordPathsFromKey(pwd, cacheKey);
};

export const calculatePackageLockHash = async (npmPackagePath: string): Promise<string | undefined> => {
    const lockFiles = ["package-lock.json", "bun.lock", "bun.lockb"];
    for (const lockFile of lockFiles) {
        const lockPath = Path.join(npmPackagePath, lockFile);
        try {
            const content = await afs.readFile(lockPath);
            return createHash("sha256").update(content).digest("hex");
        } catch {
            // Ignore missing files and try the next option
        }
    }
    return undefined;
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

export const writeCacheReadme = async (
    pwd: string,
    cacheKey: CacheKey,
    packages: PackageInfo[],
    packageManager: PackageManager,
): Promise<void> => {
    const readmePath = Path.join(pwd, "README.md");
    let existing = "";
    try {
        existing = await afs.readFile(readmePath, "utf-8");
    } catch {}

    if (existing.includes(`\`${cacheKey}\``)) return;

    const lines: string[] = [];
    if (existing === "") {
        lines.push("# FHIR Canonical Manager Cache", "");
    }
    lines.push(`- \`${cacheKey}\` (${packageManager})`);
    const sorted = packages.map((p) => `${p.id.name}@${p.id.version}`).toSorted();
    if (sorted.length === 0) {
        lines.push("    - _no packages_");
    } else {
        for (const pkg of sorted) {
            lines.push(`    - ${pkg}`);
        }
    }

    const prefix = existing === "" ? "" : existing.replace(/\n*$/, "\n");
    await afs.writeFile(readmePath, prefix + lines.join("\n") + "\n");
};

export const saveCacheRecordToDisk = async (
    cache: ExtendedCache,
    pwd: string,
    packages: string[],
    packageManager: PackageManager,
): Promise<void> => {
    const cacheKey = computeCacheKey(packages);
    const cacheData: CacheData = {
        entries: cache.entries,
        packages: cache.packages,
        references: cache.referenceManager.getAllReferences(),
    };
    const { cacheIndexFile, cacheRecordPath, npmPackagePath } = cacheRecordPathsFromKey(pwd, cacheKey);
    cacheData.packageLockHash = await calculatePackageLockHash(npmPackagePath);
    cacheData.cacheKey = cacheKey;
    await afs.mkdir(cacheRecordPath, { recursive: true });
    await writeCacheReadme(pwd, cacheKey, Object.values(cache.packages), packageManager);
    await afs.writeFile(cacheIndexFile, JSON.stringify(cacheData, null, 2));
};

export const flushCache = async (workingDir: string): Promise<void> => {
    try {
        const entries = await afs.readdir(workingDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory() && /^[a-f0-9]{64}$/i.test(entry.name)) {
                await afs.rm(Path.join(workingDir, entry.name), { recursive: true, force: true });
            }
        }
        await afs.rm(Path.join(workingDir, "README.md"), { force: true });
    } catch {}
};
