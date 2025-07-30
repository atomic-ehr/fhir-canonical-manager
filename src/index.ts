/**
 * FHIR Canonical Manager - Functional Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';

// Types
export interface Reference {
  id: string;
  resourceType: string;
}

export interface PackageId {
  name: string;
  version: string;
}

export interface IndexEntry extends Reference {
  indexVersion: number;
  kind?: string;
  url?: string;
  type?: string;
  version?: string;
  package?: PackageId;
}

export interface Resource extends Reference {
  url?: string;
  version?: string;
  [key: string]: any;
}

export interface SourceContext {
  id?: string;
  package?: PackageId;
  url?: string;
  path?: string;
}

export interface Config {
  packagePaths?: string[];
}

export interface CanonicalManager {
  init(): Promise<void>;
  destroy(): Promise<void>;
  packages(): Promise<PackageId[]>;
  resolve(canonicalUrl: string, options?: {
    package?: string,
    version?: string,
    sourceContext?: SourceContext
  }): Promise<IndexEntry>;
  read(reference: Reference): Promise<Resource>;
  search(params: {
    kind?: string,
    url?: string,
    type?: string,
    version?: string,
    package?: PackageId
  }): Promise<IndexEntry[]>;
}

// Internal types
interface IndexFile {
  'index-version': number;
  files: IndexFileEntry[];
}

interface IndexFileEntry {
  filename: string;
  resourceType: string;
  id: string;
  url?: string;
  version?: string;
  kind?: string;
  type?: string;
}

interface PackageJson {
  name: string;
  version: string;
  fhirVersions?: string[];
  type?: string;
  canonical?: string;
  dependencies?: Record<string, string>;
}

interface PackageInfo {
  id: PackageId;
  path: string;
  canonical?: string;
  fhirVersions?: string[];
}

interface ReferenceMetadata {
  packageName: string;
  packageVersion: string;
  filePath: string;
  resourceType: string;
  url?: string;
  version?: string;
}

interface IndexCache {
  entries: Map<string, IndexEntry[]>;
  packages: Map<string, PackageInfo>;
  references: Map<string, ReferenceMetadata>;
}

// Reference management functions
export interface ReferenceStore {
  get(id: string): ReferenceMetadata | undefined;
  set(id: string, metadata: ReferenceMetadata): void;
  has(id: string): boolean;
  clear(): void;
  size(): number;
}

export type { ReferenceMetadata };

const generateReferenceId = (metadata: {
  packageName: string;
  packageVersion: string;
  filePath: string;
}): string => {
  const input = `${metadata.packageName}@${metadata.packageVersion}:${metadata.filePath}`;
  return createHash('sha256').update(input).digest('base64url');
};

export const ReferenceManager = (): ReferenceStore & {
  generateId: typeof generateReferenceId;
  getIdsByUrl: (url: string) => string[];
  createReference: (id: string, metadata: ReferenceMetadata) => Reference;
  getAllReferences: () => Array<[string, ReferenceMetadata]>;
} => {
  const references = new Map<string, ReferenceMetadata>();
  const urlToIds = new Map<string, Set<string>>();

  const set = (id: string, metadata: ReferenceMetadata): void => {
    references.set(id, metadata);
    if (metadata.url) {
      const ids = urlToIds.get(metadata.url) || new Set();
      ids.add(id);
      urlToIds.set(metadata.url, ids);
    }
  };

  const clear = (): void => {
    references.clear();
    urlToIds.clear();
  };

  return {
    generateId: generateReferenceId,
    get: (id: string) => references.get(id),
    set,
    has: (id: string) => references.has(id),
    clear,
    size: () => references.size,
    getIdsByUrl: (url: string) => {
      const ids = urlToIds.get(url);
      return ids ? Array.from(ids) : [];
    },
    createReference: (id: string, metadata: ReferenceMetadata): Reference => ({
      id,
      resourceType: metadata.resourceType
    }),
    getAllReferences: () => Array.from(references.entries())
  };
};

// Parser functions
const isValidFileEntry = (entry: any): boolean => {
  if (!entry || typeof entry !== 'object') return false;
  if (!entry.filename || typeof entry.filename !== 'string') return false;
  if (!entry.resourceType || typeof entry.resourceType !== 'string') return false;
  if (!entry.id || typeof entry.id !== 'string') return false;
  
  const optionalStringFields = ['url', 'version', 'kind', 'type'];
  for (const field of optionalStringFields) {
    if (entry[field] !== undefined && typeof entry[field] !== 'string') {
      return false;
    }
  }
  
  return true;
};

const isValidIndexFile = (data: any): boolean => {
  if (!data || typeof data !== 'object') return false;
  if (!data['index-version'] || typeof data['index-version'] !== 'number') return false;
  if (!Array.isArray(data.files)) return false;
  return data.files.every((file: any) => isValidFileEntry(file));
};

const parseIndex = (content: string, filePath: string): IndexFile | null => {
  try {
    const data = JSON.parse(content);
    if (!isValidIndexFile(data)) {
      return null;
    }
    return data as IndexFile;
  } catch {
    return null;
  }
};

// File system utilities
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const isFhirPackage = async (dirPath: string): Promise<boolean> => {
  const indexPath = path.join(dirPath, '.index.json');
  return fileExists(indexPath);
};

// Cache creation
const createCache = (): IndexCache & {
  referenceManager: ReturnType<typeof ReferenceManager>;
} => {
  const referenceManager = ReferenceManager();
  return {
    entries: new Map(),
    packages: new Map(),
    references: referenceManager,
    referenceManager
  };
};

// Package processing functions
const processIndex = async (
  basePath: string,
  packageJson: PackageJson,
  cache: ReturnType<typeof createCache>
): Promise<void> => {
  const indexPath = path.join(basePath, '.index.json');
  
  try {
    const indexContent = await fs.readFile(indexPath, 'utf-8');
    const index = parseIndex(indexContent, indexPath);
    
    if (!index) return;
    
    for (const file of index.files) {
      if (!file.url) continue;
      
      const filePath = path.join(basePath, file.filename);
      
      const id = cache.referenceManager.generateId({
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        filePath
      });
      
      cache.referenceManager.set(id, {
        packageName: packageJson.name,
        packageVersion: packageJson.version,
        filePath,
        resourceType: file.resourceType,
        url: file.url,
        version: file.version
      });
      
      const entry: IndexEntry = {
        id,
        resourceType: file.resourceType,
        indexVersion: index['index-version'],
        url: file.url,
        version: file.version,
        kind: file.kind,
        type: file.type,
        package: {
          name: packageJson.name,
          version: packageJson.version
        }
      };
      
      if (!cache.entries.has(file.url)) {
        cache.entries.set(file.url, []);
      }
      cache.entries.get(file.url)!.push(entry);
    }
  } catch {
    // Silently ignore index processing errors
  }
};

const scanPackage = async (
  packagePath: string,
  cache: ReturnType<typeof createCache>
): Promise<void> => {
  try {
    const packageJsonPath = path.join(packagePath, 'package.json');
    const packageJsonContent = await fs.readFile(packageJsonPath, 'utf-8');
    const packageJson: PackageJson = JSON.parse(packageJsonContent);
    
    const packageInfo: PackageInfo = {
      id: { name: packageJson.name, version: packageJson.version },
      path: packagePath,
      canonical: packageJson.canonical,
      fhirVersions: packageJson.fhirVersions
    };
    cache.packages.set(packageJson.name, packageInfo);
    
    await processIndex(packagePath, packageJson, cache);
    
    const examplesPath = path.join(packagePath, 'examples');
    if (await fileExists(path.join(examplesPath, '.index.json'))) {
      await processIndex(examplesPath, packageJson, cache);
    }
  } catch {
    // Silently ignore package scan errors
  }
};

const scanDirectory = async (
  dirPath: string,
  cache: ReturnType<typeof createCache>
): Promise<void> => {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.name.startsWith('@')) {
        const scopedEntries = await fs.readdir(fullPath, { withFileTypes: true });
        for (const scopedEntry of scopedEntries) {
          if (!scopedEntry.isDirectory()) continue;
          
          const scopedPath = path.join(fullPath, scopedEntry.name);
          if (await isFhirPackage(scopedPath)) {
            await scanPackage(scopedPath, cache);
          }
        }
      } else if (await isFhirPackage(fullPath)) {
        await scanPackage(fullPath, cache);
      }
    }
  } catch {
    // Silently ignore scan errors
  }
};

// Resolution functions
const resolveWithContext = async (
  url: string,
  context: SourceContext,
  cache: ReturnType<typeof createCache>,
  resolve: (url: string, options?: any) => Promise<IndexEntry>
): Promise<IndexEntry | null> => {
  if (context.package) {
    try {
      return await resolve(url, {
        package: context.package.name,
        version: context.package.version
      });
    } catch {
      // Fall through to global resolution
    }
  }
  return null;
};

// Main implementation
export const CanonicalManager = (config?: Config): CanonicalManager => {
  const finalConfig: Required<Config> = {
    packagePaths: config?.packagePaths || ['./node_modules']
  };
  
  let cache = createCache();
  let initialized = false;

  const ensureInitialized = (): void => {
    if (!initialized) {
      throw new Error('CanonicalManager not initialized. Call init() first.');
    }
  };

  const init = async (): Promise<void> => {
    if (initialized) return;
    
    for (const basePath of finalConfig.packagePaths) {
      await scanDirectory(basePath, cache);
    }
    
    initialized = true;
  };

  const destroy = async (): Promise<void> => {
    cache.entries.clear();
    cache.packages.clear();
    cache.referenceManager.clear();
    initialized = false;
  };

  const packages = async (): Promise<PackageId[]> => {
    ensureInitialized();
    return Array.from(cache.packages.values()).map(p => p.id);
  };

  const resolve = async (
    canonicalUrl: string,
    options?: {
      package?: string;
      version?: string;
      sourceContext?: SourceContext;
    }
  ): Promise<IndexEntry> => {
    ensureInitialized();

    if (options?.sourceContext) {
      const contextResolved = await resolveWithContext(
        canonicalUrl,
        options.sourceContext,
        cache,
        resolve
      );
      if (contextResolved) {
        return contextResolved;
      }
    }

    const entries = cache.entries.get(canonicalUrl) || [];
    
    if (entries.length === 0) {
      throw new Error(`Cannot resolve canonical URL: ${canonicalUrl}`);
    }

    let filtered = [...entries];
    
    if (options?.package) {
      filtered = filtered.filter(e => e.package?.name === options.package);
    }
    
    if (options?.version) {
      filtered = filtered.filter(e => e.version === options.version);
    }

    if (filtered.length === 0) {
      throw new Error(`No matching resource found for ${canonicalUrl} with given options`);
    }

    return filtered[0];
  };

  const read = async (reference: Reference): Promise<Resource> => {
    ensureInitialized();
    
    const metadata = cache.referenceManager.get(reference.id);
    if (!metadata) {
      throw new Error(`Invalid reference ID: ${reference.id}`);
    }

    try {
      const content = await fs.readFile(metadata.filePath, 'utf-8');
      const resource = JSON.parse(content);
      
      return {
        ...resource,
        id: reference.id,
        resourceType: reference.resourceType
      };
    } catch (err) {
      throw new Error(`Failed to read resource: ${err}`);
    }
  };

  const search = async (params: {
    kind?: string;
    url?: string;
    type?: string;
    version?: string;
    package?: PackageId;
  }): Promise<IndexEntry[]> => {
    ensureInitialized();
    
    let results: IndexEntry[] = [];
    
    if (params.url) {
      results = cache.entries.get(params.url) || [];
    } else {
      for (const entries of cache.entries.values()) {
        results.push(...entries);
      }
    }
    
    if (params.kind !== undefined) {
      results = results.filter(e => e.kind === params.kind);
    }
    
    if (params.type !== undefined) {
      results = results.filter(e => e.type === params.type);
    }
    
    if (params.version !== undefined) {
      results = results.filter(e => e.version === params.version);
    }
    
    if (params.package) {
      results = results.filter(e => 
        e.package?.name === params.package.name && 
        e.package?.version === params.package.version
      );
    }
    
    return results;
  };

  return {
    init,
    destroy,
    packages,
    resolve,
    read,
    search
  };
};

// Default export
export default CanonicalManager;