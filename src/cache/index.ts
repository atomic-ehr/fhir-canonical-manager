/**
 * Cache module exports
 */

export { createCache, type ExtendedCache } from './core';
export { saveCacheToDisk, loadCacheFromDisk } from './persistence';
export { computePackageLockHash } from './validation';