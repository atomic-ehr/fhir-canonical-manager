/**
 * Core cache functionality
 */

import { createReferenceManager, type ReferenceManager } from "../reference/index.js";
import type { IndexCache } from "../types/index.js";

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
