/**
 * Reference management module
 * Merged from reference/index.ts, reference/manager.ts, and reference/store.ts
 */

import { createHash } from "node:crypto";
import type { Reference, ReferenceMetadata, ReferenceStore } from "./types/index.js";

/**
 * Generate a unique reference ID from metadata
 */
export const generateReferenceId = (metadata: {
    packageName: string;
    packageVersion: string;
    filePath: string;
}): string => {
    const input = `${metadata.packageName}@${metadata.packageVersion}:${metadata.filePath}`;
    return createHash("sha256").update(input).digest("base64url");
};

/**
 * Reference manager interface
 */
export interface ReferenceManager extends ReferenceStore {
    generateId: typeof generateReferenceId;
    getIdsByUrl: (url: string) => string[];
    createReference: (id: string, metadata: ReferenceMetadata) => Reference;
    getAllReferences: () => Record<string, ReferenceMetadata>;
}

/**
 * Create a reference manager instance
 */
export const createReferenceManager = (): ReferenceManager => {
    const references: Record<string, ReferenceMetadata> = {};
    const urlToIds: Record<string, string[]> = {};

    const set = (id: string, metadata: ReferenceMetadata): void => {
        references[id] = metadata;
        if (metadata.url) {
            if (!urlToIds[metadata.url]) {
                urlToIds[metadata.url] = [];
            }
            const ids = urlToIds[metadata.url];
            if (ids && !ids.includes(id)) {
                ids.push(id);
            }
        }
    };

    const clear = (): void => {
        Object.keys(references).forEach((key) => {
            delete references[key];
        });
        Object.keys(urlToIds).forEach((key) => {
            delete urlToIds[key];
        });
    };

    return {
        generateId: generateReferenceId,
        get: (id: string) => references[id],
        set,
        has: (id: string) => id in references,
        clear,
        size: () => Object.keys(references).length,
        getIdsByUrl: (url: string) => urlToIds[url] || [],
        createReference: (id: string, metadata: ReferenceMetadata): Reference => ({
            id,
            resourceType: metadata.resourceType,
        }),
        getAllReferences: () => references,
    };
};

// For backward compatibility - function alias (will be deprecated)
export { createReferenceManager as ReferenceManagerFactory };
