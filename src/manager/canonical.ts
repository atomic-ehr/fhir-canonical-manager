/**
 * Main CanonicalManager implementation
 */

import { createHash } from "node:crypto";
import * as afs from "node:fs/promises";
import * as Path from "node:path";
import {
    cacheRecordPaths,
    calculatePackageLockHash,
    createCacheRecord,
    flushCache as flushCacheFromDisk,
    loadCacheRecordFromDisk,
    saveCacheRecordToDisk,
} from "../cache.js";
import { DEFAULT_REGISTRY } from "../constants.js";
import { createCanonicalQuery, filterEntryCandidates } from "../core/query.js";
import { ensureDir, fileExists } from "../fs/index.js";
import { installLocalFolder, installTgzPackage } from "../local.js";
import { detectPackageManager, installPackages } from "../package.js";
import { applyPatches } from "../patches.js";
import { resolveWithContext } from "../resolver.js";
import { loadPackagesIntoCache } from "../scanner/index.js";
import type {
    CanonicalManager,
    Config,
    IndexEntry,
    LocalPackageConfig,
    PackageId,
    PackageIndexMode,
    PackageInfo,
    PackageJson,
    PackageName,
    Patches,
    PatchReportSink,
    Reference,
    ReportEntry,
    Resource,
    SearchParameter,
    SourceContext,
    TgzPackageConfig,
} from "../types/index.js";
import { applyIndexEntryPatches } from "./index-patch.js";
import { isPathSpec, normalizePackageSpec, parsePackageRef } from "./package-spec.js";

/**
 * Resolve the effective `packageIndex` mode, translating the deprecated
 * `ignorePackageIndex` boolean. Throws if both are set.
 */
const resolvePackageIndexMode = (config: Config): PackageIndexMode => {
    // No deprecated flag → just use packageIndex (default "use").
    if (config.ignorePackageIndex === undefined) return config.packageIndex ?? "use";

    if (config.packageIndex !== undefined) {
        throw new Error(
            "Cannot set both `packageIndex` and the deprecated `ignorePackageIndex`. Use `packageIndex` only.",
        );
    }
    console.warn(
        '`ignorePackageIndex` is deprecated; use `packageIndex` instead ("regenerate" replaces `true`, "use" replaces `false`).',
    );
    return config.ignorePackageIndex ? "regenerate" : "use";
};

/** A diagnostics sink plus the backing entries array exposed via `report()`. */
const createReportSink = (): { sink: PatchReportSink; entries: ReportEntry[] } => {
    const entries: ReportEntry[] = [];
    return {
        entries,
        sink: (entry) => {
            entries.push(entry);
        },
    };
};

/** Compose `config.patches` (and the deprecated `preprocessPackage`, last) into one effective patch. */
const resolveEffectivePatch = (config: Config): Patches => {
    const configured = config.patches ?? {};
    const patches: Patches = {
        packageJson: [...(configured.packageJson ?? [])],
        indexEntry: [...(configured.indexEntry ?? [])],
        fhirResource: [...(configured.fhirResource ?? [])],
    };
    if (config.preprocessPackage) {
        const legacy = config.preprocessPackage;
        // The legacy hook predates per-phase handlers: it takes a kind-tagged PreprocessContext
        // and only transforms packages/resources. Bridge it — add `kind` going in, strip it (and
        // guard against a wrong-kind return) coming out — as packageJson/fhirResource handlers.
        patches.packageJson.push((pkg, packageJson) => {
            const r = legacy({ kind: "package", package: pkg, packageJson });
            return r.kind === "package" ? r.packageJson : undefined;
        });
        patches.fhirResource.push((pkg, resource) => {
            const r = legacy({ kind: "resource", package: pkg, resource });
            return r.kind === "resource" ? r.resource : undefined;
        });
    }
    return patches;
};

interface LocalPackageEntry {
    config: LocalPackageConfig & { path: string };
    cacheKeyPart: string;
}

const hashLocalPackageSource = async (dirPath: string): Promise<string> => {
    const hash = createHash("sha256");

    const walk = async (currentPath: string) => {
        const entries = await afs.readdir(currentPath, { withFileTypes: true });
        entries.sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
            if (entry.name === "node_modules" || entry.name === ".git") {
                continue;
            }
            const fullPath = Path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                hash.update(`dir:${fullPath}`);
                await walk(fullPath);
            } else if (entry.isFile()) {
                hash.update(`file:${fullPath}`);
                const content = await afs.readFile(fullPath);
                hash.update(content);
            }
        }
    };

    await walk(dirPath);
    return hash.digest("hex");
};

const createLocalCacheKeyPart = async (config: LocalPackageConfig & { path: string }): Promise<string> => {
    const dependencies = config.dependencies ? [...config.dependencies].sort() : [];
    const sourceHash = await hashLocalPackageSource(config.path);
    return JSON.stringify({
        type: "local",
        name: config.name,
        version: config.version,
        path: config.path,
        dependencies,
        sourceHash,
    });
};

export const createCanonicalManager = (config: Config): CanonicalManager => {
    const workingDir = config.workingDir;
    const packageSpecs = [...(config.packages ?? [])].map(normalizePackageSpec);
    const localPackages = new Map<string, LocalPackageEntry>();
    const pathPackageMeta = new Map<string, PackageId>();
    const packageManager = config.packageManager ?? detectPackageManager();
    if (!packageManager) {
        throw new Error("No package manager found. Please install bun or npm, or set Config.packageManager.");
    }
    const getCacheKeyPackages = () => {
        const localParts = Array.from(localPackages.values()).map((entry) => entry.cacheKeyPart);
        return [...packageSpecs, ...localParts];
    };
    const refreshLocalPackageCacheKeys = async (): Promise<void> => {
        if (localPackages.size === 0) return;
        await Promise.all(
            Array.from(localPackages.values()).map(async (entry) => {
                entry.cacheKeyPart = await createLocalCacheKeyPart(entry.config);
            }),
        );
    };
    const localPackageTargetPath = (packageName: PackageName, npmPackagePath: string): string => {
        const segments = packageName.startsWith("@") ? packageName.split("/") : [packageName];
        return Path.join(npmPackagePath, "node_modules", ...segments);
    };
    const ensureLocalPackagesPresent = async (npmPackagePath: string): Promise<boolean> => {
        if (localPackages.size === 0) return true;
        for (const entry of localPackages.values()) {
            const targetPath = localPackageTargetPath(entry.config.name, npmPackagePath);
            if (!(await fileExists(targetPath))) {
                return false;
            }
        }
        return true;
    };
    const areCachedPackagePathsPresent = async (packagesRecord: Record<string, PackageInfo>): Promise<boolean> => {
        const packageInfos = Object.values(packagesRecord);
        if (packageInfos.length === 0) return true;
        const checks = await Promise.all(
            packageInfos.map(async (pkg) => {
                if (!pkg.path) return true;
                return fileExists(pkg.path);
            }),
        );
        return checks.every(Boolean);
    };

    // Ensure registry URL ends with /
    let registry = DEFAULT_REGISTRY;
    if (config.registry) {
        registry = config.registry.endsWith("/") ? config.registry : `${config.registry}/`;
    }

    const cache = createCacheRecord();
    let initialized = false;

    // Composed patch + de-duped diagnostics sink, built once and used at all three phases.
    const { sink: reportSink, entries: reportEntries } = createReportSink();
    const effectivePatches = resolveEffectivePatch(config);

    const installConfiguredLocalPackages = async (npmPackagePath: string): Promise<void> => {
        const skipDependencyInstall = process.env.FCM_SKIP_LOCAL_DEP_INSTALL === "1";
        for (const entry of localPackages.values()) {
            await installLocalFolder(entry.config, npmPackagePath);
            if (!skipDependencyInstall && entry.config.dependencies && entry.config.dependencies.length > 0) {
                await installPackages(entry.config.dependencies, npmPackagePath, packageManager, registry, {
                    patches: effectivePatches.packageJson,
                    report: reportSink,
                });
            }
        }
    };

    const ensureInitialized = (): void => {
        if (!initialized) {
            throw new Error("CanonicalManager not initialized. Call init() first.");
        }
    };

    const rebuildWithCurrentConfig = async (): Promise<void> => {
        if (initialized) {
            await destroy();
        }
        await init();
    };

    const packageRefToPackageMeta = async () => {
        ensureInitialized();
        const { npmRootPackageJsonFile } = cacheRecordPaths(workingDir, packageManager, getCacheKeyPackages());
        const rootPackageDeps =
            (
                JSON.parse(await afs.readFile(npmRootPackageJsonFile, "utf8")) as {
                    dependencies?: Record<string, string>;
                }
            ).dependencies ?? {};

        const res: Record<string, PackageId> = {};

        const resolveHttpSpec = (pkgRef: string): PackageId | undefined => {
            for (const [depName, depVersion] of Object.entries(rootPackageDeps)) {
                if (depVersion === pkgRef) {
                    const packageInfo = cache.packages[depName];
                    if (!packageInfo) throw new Error(`Package not found: ${depName}`);
                    return { name: packageInfo.id.name, version: packageInfo.id.version };
                }
            }
            return undefined;
        };

        const getMetaForRef = (pkgRef: string): PackageId | undefined => {
            if (pathPackageMeta.has(pkgRef)) {
                return pathPackageMeta.get(pkgRef);
            }

            if (pkgRef.startsWith("http://") || pkgRef.startsWith("https://")) {
                return resolveHttpSpec(pkgRef);
            }

            if (isPathSpec(pkgRef)) {
                const meta = pathPackageMeta.get(pkgRef);
                if (meta) return meta;
            }

            const parsed = parsePackageRef(pkgRef);
            const packageInfo = cache.packages[parsed.name];
            if (packageInfo) {
                return { name: packageInfo.id.name, version: packageInfo.id.version };
            }
            return parsed;
        };

        for (const pkgRef of packageSpecs) {
            const meta = getMetaForRef(pkgRef);
            if (meta) {
                res[pkgRef] = meta;
            }
        }

        for (const entry of localPackages.values()) {
            res[entry.config.path] = {
                name: entry.config.name,
                version: entry.config.version,
            };

            if (entry.config.dependencies) {
                for (const dependencyRef of entry.config.dependencies) {
                    if (res[dependencyRef]) continue;
                    const dependencyMeta = getMetaForRef(dependencyRef);
                    if (dependencyMeta) {
                        res[dependencyRef] = dependencyMeta;
                    }
                }
            }
        }

        return res;
    };

    const init = async (): Promise<Record<string, PackageId>> => {
        if (initialized) return packageRefToPackageMeta();

        // Validate + resolve up front so the both-set error / deprecation fires regardless of cache state.
        const packageIndexMode = resolvePackageIndexMode(config);
        if (config.ignorePackageIndex !== undefined) {
            reportSink({
                kind: "deprecation",
                message: "`ignorePackageIndex` is deprecated; use `packageIndex`.",
            });
        }

        await refreshLocalPackageCacheKeys();
        await ensureDir(workingDir);
        if (config.dropCache) {
            await flushCacheFromDisk(workingDir);
        }
        const { cacheKey, npmPackagePath } = cacheRecordPaths(workingDir, packageManager, getCacheKeyPackages());

        const cachedData = await loadCacheRecordFromDisk(workingDir, cacheKey);
        const nodeModulesPath = Path.join(npmPackagePath, "node_modules");
        const hasInstalledPackages = await fileExists(nodeModulesPath);

        let isCacheValid = false;

        if (cachedData !== undefined && hasInstalledPackages) {
            const cacheKeyMatches = cachedData.cacheKey === cacheKey;

            const currentLockHash = await calculatePackageLockHash(npmPackagePath);
            const lockHashMatches =
                currentLockHash === undefined ||
                cachedData.packageLockHash === undefined ||
                currentLockHash === cachedData.packageLockHash;

            const cachedPackagesPresent = await areCachedPackagePathsPresent(cachedData.packages);

            const localPackagesPresent = await ensureLocalPackagesPresent(npmPackagePath);

            isCacheValid = cacheKeyMatches && lockHashMatches && cachedPackagesPresent && localPackagesPresent;
        }

        if (isCacheValid && cachedData) {
            cache.entries = cachedData.entries;
            cache.packages = cachedData.packages;
            Object.entries(cachedData.references).forEach(([id, metadata]) => {
                cache.referenceManager.set(id, metadata);
            });
        } else {
            await installPackages(packageSpecs, npmPackagePath, packageManager, registry, {
                patches: effectivePatches.packageJson,
                report: reportSink,
            });
            await installConfiguredLocalPackages(npmPackagePath);
            await loadPackagesIntoCache(cache, npmPackagePath, {
                packageIndexMode,
                patches: effectivePatches,
                report: reportSink,
            });
            await saveCacheRecordToDisk(cache, workingDir, packageManager, getCacheKeyPackages());
        }

        applyIndexEntryPatches(cache, effectivePatches.indexEntry, reportSink);

        initialized = true;
        return packageRefToPackageMeta();
    };

    const destroy = async (): Promise<void> => {
        cache.entries = {};
        cache.packages = {};
        cache.referenceManager.clear();
        query.clearSearchParameterCache();
        // The report explains the index being torn down.
        reportEntries.length = 0;
        initialized = false;
    };

    const getPackages = async (): Promise<PackageId[]> => {
        ensureInitialized();
        return Object.values(cache.packages).map((p: PackageInfo) => p.id);
    };

    const addPackages = async (...newPackages: string[]): Promise<Record<string, PackageId>> => {
        if (newPackages.length === 0) return packageRefToPackageMeta();

        const normalized = newPackages.map(normalizePackageSpec);
        const packagesToAdd = normalized.filter((pkg) => !packageSpecs.includes(pkg));
        if (packagesToAdd.length !== 0) {
            packageSpecs.push(...packagesToAdd);
        }

        if (!initialized) {
            await init();
            return packageRefToPackageMeta();
        }

        if (packagesToAdd.length > 0) {
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
        return query.resolveEntry(canonicalUrl, options);
    };

    const resolve = async (
        canonicalUrl: string,
        options?: {
            package?: string;
            version?: string;
            sourceContext?: SourceContext;
        },
    ): Promise<Resource> => {
        ensureInitialized();
        return query.resolve(canonicalUrl, options);
    };

    const read = async (reference: Reference): Promise<Resource> => {
        ensureInitialized();

        const metadata = cache.referenceManager.get(reference.id);
        if (!metadata) {
            throw new Error(`Invalid reference ID: ${reference.id}`);
        }

        try {
            const content = await afs.readFile(metadata.filePath, "utf-8");
            const parsed = JSON.parse(content);

            let resource: Resource = {
                ...parsed,
                id: reference.id,
                resourceType: reference.resourceType,
            };

            const result = applyPatches(
                effectivePatches.fhirResource,
                { name: metadata.packageName, version: metadata.packageVersion },
                resource,
                reportSink,
            );
            if (result) resource = result;

            return resource;
        } catch (err) {
            throw new Error(`Failed to read resource: ${err}`);
        }
    };

    const query = createCanonicalQuery({
        async findEntriesByUrl(url) {
            return cache.entries[url] || [];
        },
        async findEntries(params) {
            const entries = params.url ? cache.entries[params.url] || [] : Object.values(cache.entries).flat();
            return filterEntryCandidates(entries, params);
        },
        read,
        resolveWithContext: (url, context, resolveEntry) => resolveWithContext(url, context, cache, resolveEntry),
    });

    const searchEntries = async (params: {
        kind?: string;
        url?: string;
        type?: string;
        version?: string;
        package?: PackageId;
    }): Promise<IndexEntry[]> => {
        ensureInitialized();
        return query.searchEntries(params);
    };

    const search = async (params: {
        kind?: string;
        url?: string;
        type?: string;
        version?: string;
        package?: PackageId;
    }): Promise<Resource[]> => {
        ensureInitialized();
        return query.search(params);
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
        return query.smartSearch(searchTerms, filters);
    };

    const getSearchParametersForResource = async (resourceType: string): Promise<SearchParameter[]> => {
        ensureInitialized();
        return query.getSearchParametersForResource(resourceType);
    };

    const packageJson = async (packageName: PackageName): Promise<PackageJson> => {
        ensureInitialized();
        const pkg = cache.packages[packageName];
        if (!pkg) throw new Error(`Package ${packageName} not found`);
        return pkg.packageJson;
    };

    const addTgzPackage = async (config: TgzPackageConfig): Promise<PackageId> => {
        const archivePath = Path.resolve(config.archivePath);
        const { npmPackagePath } = cacheRecordPaths(workingDir, packageManager, getCacheKeyPackages());
        await ensureDir(npmPackagePath);

        const { name, version } = await installTgzPackage(archivePath, npmPackagePath, packageManager, registry);

        pathPackageMeta.set(archivePath, { name, version });
        if (!packageSpecs.includes(archivePath)) {
            packageSpecs.push(archivePath);
        }

        await rebuildWithCurrentConfig();

        return { name, version };
    };

    const addLocalPackage = async (config: LocalPackageConfig): Promise<PackageId> => {
        const normalizedConfig = {
            ...config,
            path: Path.resolve(config.path),
        };

        const cacheKeyPart = await createLocalCacheKeyPart(normalizedConfig);
        const entry: LocalPackageEntry = {
            config: normalizedConfig,
            cacheKeyPart,
        };

        localPackages.set(normalizedConfig.path, entry);
        pathPackageMeta.set(normalizedConfig.path, {
            name: normalizedConfig.name,
            version: normalizedConfig.version,
        });

        await rebuildWithCurrentConfig();

        return { name: normalizedConfig.name, version: normalizedConfig.version };
    };

    const flushCache = async (): Promise<void> => {
        await flushCacheFromDisk(workingDir);
        if (initialized) {
            await destroy();
        }
    };

    return {
        init,
        destroy,
        packages: getPackages,
        addPackages,
        addTgzPackage,
        addLocalPackage,
        flushCache,
        resolveEntry,
        resolve,
        read,
        searchEntries,
        search,
        smartSearch,
        getSearchParametersForResource,
        packageJson,
        report: (): ReportEntry[] => [...reportEntries],
    };
};
