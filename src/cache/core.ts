/**
 * Core cache functionality
 */

import type { IndexCache } from '../types/index.js';
import { createReferenceManager, type ReferenceManager } from '../reference/index.js';

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