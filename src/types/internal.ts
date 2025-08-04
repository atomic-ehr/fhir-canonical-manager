/**
 * Internal implementation types for FHIR Canonical Manager
 */

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

export interface PackageJson {
  name: string;
  version: string;
  fhirVersions?: string[];
  type?: string;
  canonical?: string;
  dependencies?: Record<string, string>;
}

export interface ReferenceMetadata {
  packageName: string;
  packageVersion: string;
  filePath: string;
  resourceType: string;
  url?: string;
  version?: string;
}

export interface IndexCache {
  entries: Record<string, import('./core').IndexEntry[]>;
  packages: Record<string, import('./core').PackageInfo>;
  references: Record<string, ReferenceMetadata>;
}

export interface CacheData {
  entries: Record<string, import('./core').IndexEntry[]>;
  packages: Record<string, import('./core').PackageInfo>;
  references: Record<string, ReferenceMetadata>;
  packageLockHash?: string; // Hash of package-lock.json to detect changes
}

export interface ReferenceStore {
  get(id: string): ReferenceMetadata | undefined;
  set(id: string, metadata: ReferenceMetadata): void;
  has(id: string): boolean;
  clear(): void;
  size(): number;
}