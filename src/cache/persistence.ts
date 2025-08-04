/**
 * Cache persistence functionality
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { CacheData } from '../types';
import type { ExtendedCache } from './core';
import { computePackageLockHash } from './validation';

export const saveCacheToDisk = async (
  cache: ExtendedCache,
  cacheDir: string,
  workingDir: string,
): Promise<void> => {
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

export const loadCacheFromDisk = async (
  cacheDir: string,
): Promise<CacheData | null> => {
  try {
    const cachePath = path.join(cacheDir, "index.json");
    const content = await fs.readFile(cachePath, "utf-8");
    return JSON.parse(content) as CacheData;
  } catch {
    return null;
  }
};