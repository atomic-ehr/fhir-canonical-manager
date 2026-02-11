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

export interface Config {
    packages: string[];
    workingDir: string;
    registry?: string;
    dropCache?: boolean;
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

export interface PackageInfo {
    id: PackageId;
    path: string;
    canonical?: string;
    fhirVersions?: string[];
}

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
    packageJson(packageName: string): Promise<unknown>;
}
