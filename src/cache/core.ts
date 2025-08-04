/**
 * Core cache functionality
 */

import type { IndexCache } from '../types';
import { createReferenceManager, type ReferenceManager } from '../reference';

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