/**
 * Main CanonicalManager implementation
 */

import * as path from "path";
import * as fs from "fs/promises";
import type {
    Config,
    CanonicalManager,
    PackageId,
    IndexEntry,
    Resource,
    Reference,
    SourceContext,
    SearchParameter,
} from "../types/index.js";
import { DEFAULT_REGISTRY } from "../constants.js";
import { ensureDir } from "../fs/index.js";
import { installPackages } from "../package/index.js";
import {
    createCache,
    saveCacheToDisk,
    loadCacheFromDisk,
    computePackageLockHash,
    type ExtendedCache,
} from "../cache/index.js";
import { scanDirectory } from "../scanner/index.js";
import { resolveWithContext } from "../resolver/index.js";
import { filterBySmartSearch } from "../search/index.js";

export const createCanonicalManager = (config: Config): CanonicalManager => {
    const { packages = [], workingDir } = config;
    // Ensure registry URL ends with /
    const registry = config.registry
        ? config.registry.endsWith("/")
            ? config.registry
            : `${config.registry}/`
        : DEFAULT_REGISTRY;
    const nodeModulesPath = path.join(workingDir, "node_modules");
    const cacheDir = path.join(workingDir, ".fcm", "cache");

    let cache = createCache();
    let initialized = false;
    const searchParamsCache = new Map<string, SearchParameter[]>();

    const ensureInitialized = (): void => {
        if (!initialized) {
            throw new Error("CanonicalManager not initialized. Call init() first.");
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
        const cacheValid =
            cachedData && cachedData.packageLockHash === currentPackageLockHash && currentPackageLockHash !== null;

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
                console.log("Package dependencies have changed, rebuilding index...");
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
        searchParamsCache.clear();
        initialized = false;
    };

    const getPackages = async (): Promise<PackageId[]> => {
        ensureInitialized();
        return Object.values(cache.packages).map((p) => p.id);
    };

    const addPackages = async (...newPackages: string[]): Promise<void> => {
        if (newPackages.length === 0) return;

        // Check if packages already exists in packages
        const packagesToAdd = newPackages.filter((pkg) => !packages.includes(pkg));
        if (packagesToAdd.length !== 0) {
            // Update config packages
            packages.push(...packagesToAdd);
        }

        // If not initialized yet, init will handle installation
        if (!initialized) {
            await init();
            return;
        }

        // If it is initialized and there are no new packages, do nothing
        if (packagesToAdd.length === 0) {
            return;
        }

        // Install new packages
        await installPackages(packages, workingDir, registry);

        // Re-scan node_modules to update cache
        await scanDirectory(nodeModulesPath, cache);

        // Update cache on disk
        await saveCacheToDisk(cache, cacheDir, workingDir);
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

        return filtered[0]!;
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
            const content = await fs.readFile(metadata.filePath, "utf-8");
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
            return searchParamsCache.get(resourceType)!;
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
    };
};
