/**
 * Core public API types for FHIR Canonical Manager
 */

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

export interface SearchParameter {
    // Required fields
    url: string;
    name: string;
    code: string;
    base: string[];
    type: string;
    expression: string;

    // Optional commonly-used fields
    version?: string;
    target?: string[];
    multipleOr?: boolean;
    multipleAnd?: boolean;
    comparator?: Array<"eq" | "ne" | "gt" | "lt" | "ge" | "le" | "sa" | "eb" | "ap">;
    modifier?: Array<
        | "missing"
        | "exact"
        | "contains"
        | "not"
        | "text"
        | "in"
        | "not-in"
        | "below"
        | "above"
        | "type"
        | "identifier"
        | "ofType"
    >;

    // Open for all other FHIR SearchParameter fields
    [key: string]: any;
}

export interface SourceContext {
    id?: string;
    package?: PackageId;
    url?: string;
    path?: string;
}

/**
 * @deprecated Use `patches` (per-phase handlers). Kind-discriminated context for the legacy
 * `preprocessPackage` hook; only the package and resource phases are surfaced to it.
 */
export type PreprocessContext =
    | { kind: "package"; package: PackageId; packageJson: Record<string, unknown> }
    | { kind: "resource"; package: PackageId; resource: Resource };

/** A structured record of a defect-handling action CM took (returned by `report()`). */
export type ReportEntry =
    | {
          kind: "index-recovery";
          package: PackageId;
          reason: "unparseable" | "missing-files";
          recovered: number;
      }
    | { kind: "exclusion"; package: PackageId; url: string; reason: string }
    | { kind: "deprecation"; message: string };

/** Diagnostics sink passed to patches as their second argument. */
export type PatchReportSink = (entry: ReportEntry) => void;

/** Patch handler for the package phase: transform the package.json, or no-op (`undefined`). */
export type PackagePatch = (
    pkg: PackageId,
    packageJson: Record<string, unknown>,
    report: PatchReportSink,
) => Record<string, unknown> | undefined;

/** Patch handler for the index-entry phase: transform the entry, drop it (`null`), or no-op. */
export type EntryPatch = (pkg: PackageId, entry: IndexEntry, report: PatchReportSink) => IndexEntry | null | undefined;

/** Patch handler for the resource phase: transform the resource, or no-op (`undefined`). */
export type ResourcePatch = (pkg: PackageId, resource: Resource, report: PatchReportSink) => Resource | undefined;

/**
 * A composable set of transform/filter handlers applied to packages, index entries, and
 * resources. Each phase holds a list of handlers run left-to-right; each handler receives
 * its package id, the value being patched (`packageJson` / `entry` / `resource`), and a
 * diagnostics sink, and returns a transformed value or `undefined` for no-op. Drop (`null`)
 * is available **only** at the `entry` phase. This is the normalized form (every phase
 * present); `Config.patches` accepts a `Partial<Patches>`, so callers provide only the
 * phase(s) they care about.
 */
export type Patches = {
    package: PackagePatch[];
    entry: EntryPatch[];
    resource: ResourcePatch[];
};

export type PackageManager = "bun" | "npm";

/**
 * How to treat a package's shipped `.index.json`:
 * - `"use"` (default): trust the shipped index; scan the directory only if it is absent.
 *   A corrupt index is reported (warning) but not worked around.
 * - `"recover"`: use the index, but fall back to a directory scan per-package if the
 *   index is corrupt/incomplete (unparseable, or references files missing on disk).
 * - `"regenerate"`: ignore shipped indexes and always scan the directory.
 */
export type PackageIndexMode = "use" | "recover" | "regenerate";

export interface Config {
    packages: string[];
    workingDir: string;
    registry?: string;
    dropCache?: boolean;
    /** Force a specific package manager; auto-detected when omitted. */
    packageManager?: PackageManager;
    /** Hook to preprocess packages and resources. Receives a discriminated union with `kind` field. */
    preprocessPackage?: (context: PreprocessContext) => PreprocessContext;
    /** Composable patch handlers applied to packages, index entries, and resources (run before `preprocessPackage`). */
    patches?: Partial<Patches>;
    /** How to treat shipped `.index.json` files (default `"use"`). */
    packageIndex?: PackageIndexMode;
    /**
     * @deprecated Use `packageIndex` instead (`true` → `"regenerate"`, `false` → `"use"`).
     * Setting both `packageIndex` and `ignorePackageIndex` throws.
     */
    ignorePackageIndex?: boolean;
}

export interface TgzPackageConfig {
    /** Absolute path to the .tgz archive file */
    archivePath: string;
}

export interface LocalPackageConfig {
    /** Package name for the local package */
    name: string;
    /** Package version for the local package */
    version: string;
    /** Absolute path to the local package folder */
    path: string;
    /** Dependencies to install from registry */
    dependencies?: string[];
}

export type PackageJson = {
    name: string;
    version: string;
    /** Optional: not all packages declare FHIR version (e.g., hl7.fhir.r4.core lacks it) */
    fhirVersions?: string[];
    type?: string;
    canonical?: string;
    dependencies?: Record<string, string>;
    [key: string]: unknown;
};

export type PackageInfo = {
    id: PackageId;
    path: string;
    canonical?: string;
    fhirVersions?: string[];
    packageJson: PackageJson;
};

export interface CanonicalManager {
    init(): Promise<Record<string, PackageId>>;
    destroy(): Promise<void>;
    packages(): Promise<PackageId[]>;
    addPackages(...packageNames: string[]): Promise<Record<string, PackageId>>;
    addTgzPackage(config: TgzPackageConfig): Promise<PackageId>;
    addLocalPackage(config: LocalPackageConfig): Promise<PackageId>;
    flushCache(): Promise<void>;
    resolveEntry(
        canonicalUrl: string,
        options?: {
            package?: string;
            version?: string;
            sourceContext?: SourceContext;
        },
    ): Promise<IndexEntry>;
    resolve(
        canonicalUrl: string,
        options?: {
            package?: string;
            version?: string;
            sourceContext?: SourceContext;
        },
    ): Promise<Resource>;
    read(reference: Reference): Promise<Resource>;
    searchEntries(params: {
        kind?: string;
        url?: string;
        type?: string;
        version?: string;
        package?: PackageId;
    }): Promise<IndexEntry[]>;
    search(params: {
        kind?: string;
        url?: string;
        type?: string;
        version?: string;
        package?: PackageId;
    }): Promise<Resource[]>;
    smartSearch(
        searchTerms: string[],
        filters?: {
            resourceType?: string;
            type?: string;
            kind?: string;
            package?: PackageId;
        },
    ): Promise<IndexEntry[]>;
    getSearchParametersForResource(resourceType: string): Promise<SearchParameter[]>;
    packageJson(packageName: string): Promise<PackageJson>;
    /**
     * Structured record of defect-handling actions (index recoveries, exclusions, deprecation
     * notices). These are emitted only while **building** the index; on a cached run the actions
     * are already baked into the cache, so `report()` returns nothing for them — set
     * `dropCache: true` to rebuild and repopulate the report.
     */
    report(): ReportEntry[];
}
