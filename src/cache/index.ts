/**
 * Cache module exports
 */

export { createCache, type ExtendedCache } from './core.js';
export { saveCacheToDisk, loadCacheFromDisk } from './persistence.js';
export { computePackageLockHash } from './validation.js';