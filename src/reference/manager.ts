/**
 * Reference manager factory
 */

import type { Reference, ReferenceMetadata, ReferenceStore } from "../types/index.js";
import { generateReferenceId } from "./store.js";

export interface ReferenceManager extends ReferenceStore {
    generateId: typeof generateReferenceId;
    getIdsByUrl: (url: string) => string[];
    createReference: (id: string, metadata: ReferenceMetadata) => Reference;
    getAllReferences: () => Record<string, ReferenceMetadata>;
}

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
        Object.keys(references).forEach((key) => delete references[key]);
        Object.keys(urlToIds).forEach((key) => delete urlToIds[key]);
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
