/**
 * Cache module exports
 */

export { createCache, type ExtendedCache } from "./core.js";
export { loadCacheFromDisk, saveCacheToDisk } from "./persistence.js";
export { computePackageLockHash } from "./validation.js";
