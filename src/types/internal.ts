/**
 * Internal implementation types for FHIR Canonical Manager
 */
import type { IndexEntry, PackageInfo } from "./core.js";

export interface IndexFile {
    "index-version": number;
    files: IndexFileEntry[];
}

export interface IndexFileEntry {
    filename: string;
    resourceType: string;
    id: string;
    url?: string;
    version?: string;
    kind?: string;
    type?: string;
}

export interface ReferenceMetadata {
    packageName: string;
    packageVersion: string;
    filePath: string;
    resourceType: string;
    url?: string;
    version?: string;
}

export type CacheKey = string & { readonly __brand: unique symbol };

export interface IndexCache {
    entries: Record<string, import("./core").IndexEntry[]>;
    packages: Record<string, import("./core").PackageInfo>;
    references: Record<string, ReferenceMetadata>;
}

export interface CacheData {
    entries: Record<string, IndexEntry[]>;
    packages: Record<string, PackageInfo>;
    references: Record<string, ReferenceMetadata>;
    packageLockHash?: string; // Hash of package-lock.json to detect changes
    cacheKey?: string; // Cache key used to build this cache - for validation
}

export interface ReferenceStore {
    get(id: string): ReferenceMetadata | undefined;
    set(id: string, metadata: ReferenceMetadata): void;
    has(id: string): boolean;
    clear(): void;
    size(): number;
}
