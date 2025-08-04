/**
 * Cache validation utilities
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';

export const computePackageLockHash = async (
  workingDir: string,
): Promise<string | null> => {
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