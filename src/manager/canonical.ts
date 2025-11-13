/**
 * Main CanonicalManager implementation
 */

import * as afs from "node:fs/promises";
import * as Path from "node:path";
import { cacheRecordPaths, createCacheRecord, loadCacheRecordFromDisk, saveCacheRecordToDisk } from "../cache.js";
import { DEFAULT_REGISTRY } from "../constants.js";
import { ensureDir } from "../fs/index.js";
import { installPackages } from "../package.js";
import { resolveWithContext } from "../resolver.js";
import { scanDirectory } from "../scanner/index.js";
import { filterBySmartSearch } from "../search/index.js";
import type {
    CanonicalManager,
    Config,
    IndexEntry,
    PackageId,
    PackageInfo,
    Reference,
    Resource,
    SearchParameter,
    SourceContext,
} from "../types/index.js";

export const createCanonicalManager = (config: Config): CanonicalManager => {
    const { packages = [], workingDir } = config;
    // Ensure registry URL ends with /
    let registry = DEFAULT_REGISTRY;
    if (config.registry) {
        registry = config.registry.endsWith("/") ? config.registry : `${config.registry}/`;
    }

    const cache = createCacheRecord();
    let initialized = false;
    const searchParamsCache = new Map<string, SearchParameter[]>();

    const ensureInitialized = (): void => {
        if (!initialized) {
            throw new Error("CanonicalManager not initialized. Call init() first.");
        }
    };

    const packageRefToPackageMeta = async () => {
        ensureInitialized();
        const { npmRootPackageJsonFile } = cacheRecordPaths(workingDir, packages);
        const rootPackageDeps =
            (
                JSON.parse(await afs.readFile(npmRootPackageJsonFile, "utf8")) as {
                    dependencies?: Record<string, string>;
                }
            ).dependencies ?? {};
        const res: Record<string, PackageId> = {};
        for (const pkgRef of packages) {
            if (pkgRef.startsWith("http://") || pkgRef.startsWith("https://")) {
                for (const [depName, depVersion] of Object.entries(rootPackageDeps)) {
                    if (depVersion === pkgRef) {
                        const packageInfo = cache.packages[depName];
                        if (!packageInfo) throw new Error(`Package not found: ${depName}`);
                        res[pkgRef] = { name: packageInfo.id.name, version: packageInfo.id.version };
                        break;
                    }
                }
            } else {
                const [name, version] = pkgRef.split("@");
                if (!name) throw new Error(`Invalid FHIR package meta: ${pkgRef}`);
                res[pkgRef] = { name, version: version ?? "latest" };
            }
        }
        return res;
    };

    const init = async (): Promise<Record<string, PackageId>> => {
        if (initialized) return packageRefToPackageMeta();

        await ensureDir(workingDir);
        const { cacheKey, npmPackagePath } = cacheRecordPaths(workingDir, packages);

        const cachedData = await loadCacheRecordFromDisk(workingDir, cacheKey);
        const isCacheValid = cachedData && cachedData.packageLockHash === cacheKey;
        if (isCacheValid) {
            // Restore cache from disk
            cache.entries = cachedData.entries;
            cache.packages = cachedData.packages;
            Object.entries(cachedData.references).forEach(([id, metadata]) => {
                cache.referenceManager.set(id, metadata);
            });
        } else {
            await installPackages(packages, npmPackagePath, registry);
            await scanDirectory(cache, npmPackagePath);
            await saveCacheRecordToDisk(cache, workingDir, cacheKey);
        }

        initialized = true;
        return packageRefToPackageMeta();
    };

    const destroy = async (): Promise<void> => {
        cache.entries = {};
        cache.packages = {};
        cache.referenceManager.clear();
        searchParamsCache.clear();
        initialized = false;
    };

    const getPackages = async (): Promise<PackageId[]> => {
        ensureInitialized();
        return Object.values(cache.packages).map((p: PackageInfo) => p.id);
    };

    const addPackages = async (...newPackages: string[]): Promise<Record<string, PackageId>> => {
        if (newPackages.length === 0) return packageRefToPackageMeta();

        // Check if packages already exists in packages
        const packagesToAdd = newPackages.filter((pkg) => !packages.includes(pkg));
        if (packagesToAdd.length !== 0) {
            packages.push(...packagesToAdd);
        }

        if (!initialized) {
            await init();
            return packageRefToPackageMeta();
        }

        if (packagesToAdd.length > 0) {
            // TODO: very expensive, we can just copy/paste old cache to avoid reinstalling packages
            await destroy();
            await init();
        }
        return packageRefToPackageMeta();
    };

    const resolveEntry = async (
        canonicalUrl: string,
        options?: {
            package?: string;
            version?: string;
            sourceContext?: SourceContext;
        },
    ): Promise<IndexEntry> => {
        ensureInitialized();

        if (options?.sourceContext) {
            const contextResolved = await resolveWithContext(canonicalUrl, options.sourceContext, cache, resolveEntry);
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
            filtered = filtered.filter((e) => e.package?.name === options.package);
        }

        if (options?.version) {
            filtered = filtered.filter((e) => e.version === options.version);
        }

        if (filtered.length === 0) {
            throw new Error(`No matching resource found for ${canonicalUrl} with given options`);
        }

        const result = filtered[0];
        if (!result) {
            throw new Error(`No matching resource found for ${canonicalUrl}`);
        }
        return result;
    };

    const resolve = async (
        canonicalUrl: string,
        options?: {
            package?: string;
            version?: string;
            sourceContext?: SourceContext;
        },
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
            const content = await afs.readFile(metadata.filePath, "utf-8");
            const resource = JSON.parse(content);

            return {
                ...resource,
                id: reference.id,
                resourceType: reference.resourceType,
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
            results = results.filter((e) => e.kind === params.kind);
        }

        if (params.type !== undefined) {
            results = results.filter((e) => e.type === params.type);
        }

        if (params.version !== undefined) {
            results = results.filter((e) => e.version === params.version);
        }

        if (params.package) {
            const pkg = params.package;
            results = results.filter((e) => e.package?.name === pkg.name && e.package?.version === pkg.version);
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
        const resources = await Promise.all(entries.map((entry) => read(entry)));
        return resources;
    };

    const smartSearch = async (
        searchTerms: string[],
        filters?: {
            resourceType?: string;
            type?: string;
            kind?: string;
            package?: PackageId;
        },
    ): Promise<IndexEntry[]> => {
        ensureInitialized();

        // Start with base search using filters
        let results = await searchEntries({
            kind: filters?.kind,
            package: filters?.package,
        });

        // Apply resourceType filter
        if (filters?.resourceType) {
            results = results.filter((entry) => entry.resourceType === filters.resourceType);
        }

        // Apply type filter
        if (filters?.type) {
            results = results.filter((entry) => entry.type === filters.type);
        }

        // Apply smart search filtering
        return filterBySmartSearch(results, searchTerms);
    };

    const getSearchParametersForResource = async (resourceType: string): Promise<SearchParameter[]> => {
        ensureInitialized();

        // Check cache first
        if (searchParamsCache.has(resourceType)) {
            const cached = searchParamsCache.get(resourceType);
            if (cached) {
                return cached;
            }
        }

        // Query all SearchParameter resources
        // Note: We search by resourceType, not type, because for SearchParameter resources,
        // 'type' refers to the search parameter type (token, string, etc.)
        const allEntries = await searchEntries({});
        const searchParamEntries = allEntries.filter((entry) => entry.resourceType === "SearchParameter");

        const results: SearchParameter[] = [];

        for (const entry of searchParamEntries) {
            const resource = await read(entry);

            // Check if this parameter applies to the requested resource
            const bases = resource.base || [];
            if (Array.isArray(bases) && bases.includes(resourceType)) {
                // Return the full original resource - it already contains all fields
                // Cast through unknown to satisfy TypeScript
                results.push(resource as unknown as SearchParameter);
            }
        }

        // Sort by code for consistent output
        results.sort((a, b) => {
            const codeA = a.code || "";
            const codeB = b.code || "";
            return codeA.localeCompare(codeB);
        });

        // Cache the results
        searchParamsCache.set(resourceType, results);

        return results;
    };

    const packageJson = async (packageName: string) => {
        ensureInitialized();
        const fn = cache.packages[packageName]?.path;
        if (!fn) throw new Error(`Package ${packageName} not found`);
        const packageJSON = JSON.parse(await afs.readFile(Path.join(fn, "package.json"), "utf8"));
        return packageJSON;
    };

    return {
        init,
        destroy,
        packages: getPackages,
        addPackages,
        resolveEntry,
        resolve,
        read,
        searchEntries,
        search,
        smartSearch,
        getSearchParametersForResource,
        packageJson,
    };
};
