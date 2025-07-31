/**
 * FHIR Canonical Manager - Functional Implementation
 * A package manager for FHIR resources with canonical URL resolution
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash } from 'crypto';
import { $, ShellError } from './compat';

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
  packages: string[];
  workingDir: string;
  registry?: string;
}

export interface CanonicalManager {
  init(): Promise<void>;
  destroy(): Promise<void>;
  packages(): Promise<PackageId[]>;
  resolveEntry(canonicalUrl: string, options?: {
    package?: string,
    version?: string,
    sourceContext?: SourceContext
  }): Promise<IndexEntry>;
  resolve(canonicalUrl: string, options?: {
    package?: string,
    version?: string,
    sourceContext?: SourceContext
  }): Promise<Resource>;
  read(reference: Reference): Promise<Resource>;
  searchEntries(params: {
    kind?: string,
    url?: string,
    type?: string,
    version?: string,
    package?: PackageId
  }): Promise<IndexEntry[]>;
  search(params: {
    kind?: string,
    url?: string,
    type?: string,
    version?: string,
    package?: PackageId
  }): Promise<Resource[]>;
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

export interface PackageInfo {
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
  entries: Record<string, IndexEntry[]>;
  packages: Record<string, PackageInfo>;
  references: Record<string, ReferenceMetadata>;
}

interface CacheData {
  entries: Record<string, IndexEntry[]>;
  packages: Record<string, PackageInfo>;
  references: Record<string, ReferenceMetadata>;
  packageLockHash?: string; // Hash of package-lock.json to detect changes
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
  getAllReferences: () => Record<string, ReferenceMetadata>;
} => {
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
    Object.keys(references).forEach(key => delete references[key]);
    Object.keys(urlToIds).forEach(key => delete urlToIds[key]);
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
      resourceType: metadata.resourceType
    }),
    getAllReferences: () => references
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

const ensureDir = async (dirPath: string): Promise<void> => {
  try {
    await fs.mkdir(dirPath, { recursive: true });
  } catch {
    // Ignore errors
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
    entries: {},
    packages: {},
    references: {},
    referenceManager
  };
};

// Compute hash of package-lock.json for cache validation
const computePackageLockHash = async (workingDir: string): Promise<string | null> => {
  try {
    const packageLockPath = path.join(workingDir, 'package-lock.json');
    const content = await fs.readFile(packageLockPath, 'utf-8');
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
};

// Cache persistence functions
const saveCacheToDisk = async (cache: ReturnType<typeof createCache>, cacheDir: string, workingDir: string): Promise<void> => {
  const packageLockHash = await computePackageLockHash(workingDir);
  
  const cacheData: CacheData = {
    entries: cache.entries,
    packages: cache.packages,
    references: cache.referenceManager.getAllReferences(),
    packageLockHash: packageLockHash || undefined
  };
  
  const cachePath = path.join(cacheDir, 'index.json');
  await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2));
};

const loadCacheFromDisk = async (cacheDir: string): Promise<CacheData | null> => {
  try {
    const cachePath = path.join(cacheDir, 'index.json');
    const content = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(content) as CacheData;
  } catch {
    return null;
  }
};

// Package management functions
const installPackages = async (packages: string[], workingDir: string, registry?: string): Promise<void> => {
  await ensureDir(workingDir);
  
  // Check if package.json exists
  const packageJsonPath = path.join(workingDir, 'package.json');
  if (!(await fileExists(packageJsonPath))) {
    // Create minimal package.json
    const minimalPackageJson = {
      name: "fhir-canonical-manager-workspace",
      version: "1.0.0",
      private: true,
      dependencies: {}
    };
    await fs.writeFile(packageJsonPath, JSON.stringify(minimalPackageJson, null, 2));
  }
  
  // Install packages
  for (const pkg of packages) {
    try {
      if (registry) {
        await Bun.$`cd ${workingDir} && npm add ${pkg} --registry ${registry}`;
      } else {
        await Bun.$`cd ${workingDir} && npm add ${pkg}`;
      }
    } catch (err) {
      console.error(`Failed to install package ${pkg}:`, err);
      throw err;
    }
  }
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
      
      if (!cache.entries[file.url]) {
        cache.entries[file.url] = [];
      }
      const entries = cache.entries[file.url];
      if (entries) {
        entries.push(entry);
      }
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
    cache.packages[packageJson.name] = packageInfo;
    
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
  resolveEntry: (url: string, options?: any) => Promise<IndexEntry>
): Promise<IndexEntry | null> => {
  if (context.package) {
    try {
      return await resolveEntry(url, {
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
export const CanonicalManager = (config: Config): CanonicalManager => {
  const { packages, workingDir, registry } = config;
  const nodeModulesPath = path.join(workingDir, 'node_modules');
  const cacheDir = path.join(workingDir, '.fcm', 'cache');
  
  let cache = createCache();
  let initialized = false;

  const ensureInitialized = (): void => {
    if (!initialized) {
      throw new Error('CanonicalManager not initialized. Call init() first.');
    }
  };

  const init = async (): Promise<void> => {
    if (initialized) return;
    
    // Ensure directories exist
    await ensureDir(workingDir);
    await ensureDir(cacheDir);
    
    // Get current package-lock.json hash
    const currentPackageLockHash = await computePackageLockHash(workingDir);
    
    // Try to load cache from disk
    const cachedData = await loadCacheFromDisk(cacheDir);
    
    // Check if cache is valid (exists and package-lock.json hasn't changed)
    const cacheValid = cachedData && 
      cachedData.packageLockHash === currentPackageLockHash &&
      currentPackageLockHash !== null;
    
    if (cacheValid) {
      // Restore cache from disk
      cache.entries = cachedData.entries;
      cache.packages = cachedData.packages;
      Object.entries(cachedData.references).forEach(([id, metadata]) => {
        cache.referenceManager.set(id, metadata);
      });
    } else {
      // Cache is invalid or doesn't exist - rebuild it
      if (cachedData && cachedData.packageLockHash !== currentPackageLockHash) {
        console.log('Package dependencies have changed, rebuilding index...');
      }
      
      // Install packages if needed
      await installPackages(packages, workingDir, registry);
      
      // Clear cache before scanning
      cache = createCache();
      
      // Scan installed packages
      await scanDirectory(nodeModulesPath, cache);
      
      // Save cache to disk with current package-lock hash
      await saveCacheToDisk(cache, cacheDir, workingDir);
    }
    
    initialized = true;
  };

  const destroy = async (): Promise<void> => {
    cache.entries = {};
    cache.packages = {};
    cache.referenceManager.clear();
    initialized = false;
  };

  const getPackages = async (): Promise<PackageId[]> => {
    ensureInitialized();
    return Object.values(cache.packages).map(p => p.id);
  };

  const resolveEntry = async (
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
        resolveEntry
      );
      if (contextResolved) {
        return contextResolved;
      }
    }

    const entries = cache.entries[canonicalUrl] || [];
    
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

    return filtered[0]!;
  };

  const resolve = async (
    canonicalUrl: string,
    options?: {
      package?: string;
      version?: string;
      sourceContext?: SourceContext;
    }
  ): Promise<Resource> => {
    const entry = await resolveEntry(canonicalUrl, options);
    return read(entry);
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

  const searchEntries = async (params: {
    kind?: string;
    url?: string;
    type?: string;
    version?: string;
    package?: PackageId;
  }): Promise<IndexEntry[]> => {
    ensureInitialized();
    
    let results: IndexEntry[] = [];
    
    if (params.url) {
      results = cache.entries[params.url] || [];
    } else {
      for (const entries of Object.values(cache.entries)) {
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
      const pkg = params.package;
      results = results.filter(e => 
        e.package?.name === pkg.name && 
        e.package?.version === pkg.version
      );
    }
    
    return results;
  };

  const search = async (params: {
    kind?: string;
    url?: string;
    type?: string;
    version?: string;
    package?: PackageId;
  }): Promise<Resource[]> => {
    const entries = await searchEntries(params);
    const resources = await Promise.all(entries.map(entry => read(entry)));
    return resources;
  };

  return {
    init,
    destroy,
    packages: getPackages,
    resolveEntry,
    resolve,
    read,
    searchEntries,
    search
  };
};

// Default export
export default CanonicalManager;