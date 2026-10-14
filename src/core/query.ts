import { filterBySmartSearch } from "../search/index.js";
import type { IndexEntry, PackageId, Reference, Resource, SearchParameter, SourceContext } from "../types/index.js";

export interface EntrySearchParams {
    kind?: string;
    url?: string;
    type?: string;
    version?: string;
    package?: PackageId;
    resourceType?: string;
}

export interface ResolveOptions {
    package?: string;
    version?: string;
    sourceContext?: SourceContext;
}

export interface CanonicalQueryAdapter {
    findEntriesByUrl(url: string): Promise<IndexEntry[]>;
    findEntries(params: EntrySearchParams): Promise<IndexEntry[]>;
    read(reference: Reference): Promise<Resource>;
    resolveWithContext?: (
        url: string,
        context: SourceContext,
        resolveEntry: (url: string, options?: ResolveOptions) => Promise<IndexEntry>,
        options?: ResolveOptions,
    ) => Promise<IndexEntry | null>;
}

/** URL selection belongs to the adapter, which can look up a bucket without loading every entry. */
export function filterEntryCandidates(entries: IndexEntry[], params: EntrySearchParams): IndexEntry[] {
    let results = entries;
    if (params.kind !== undefined) results = results.filter((entry) => entry.kind === params.kind);
    if (params.type !== undefined) results = results.filter((entry) => entry.type === params.type);
    if (params.version !== undefined) results = results.filter((entry) => entry.version === params.version);
    if (params.resourceType !== undefined) {
        results = results.filter((entry) => entry.resourceType === params.resourceType);
    }
    if (params.package) {
        const pkg = params.package;
        results = results.filter((entry) => entry.package?.name === pkg.name && entry.package?.version === pkg.version);
    }
    return results;
}

export function createCanonicalQuery(adapter: CanonicalQueryAdapter) {
    const searchParamsCache = new Map<string, SearchParameter[]>();

    const resolveEntry = async (canonicalUrl: string, options?: ResolveOptions): Promise<IndexEntry> => {
        if (options?.sourceContext && adapter.resolveWithContext) {
            const resolved = await adapter.resolveWithContext(
                canonicalUrl,
                options.sourceContext,
                resolveEntry,
                options,
            );
            if (resolved) return resolved;
        }

        const entries = await adapter.findEntriesByUrl(canonicalUrl);
        if (entries.length === 0) throw new Error(`Cannot resolve canonical URL: ${canonicalUrl}`);

        let filtered = [...entries];
        if (options?.package) filtered = filtered.filter((entry) => entry.package?.name === options.package);
        if (options?.version) filtered = filtered.filter((entry) => entry.version === options.version);
        if (filtered.length === 0) {
            throw new Error(`No matching resource found for ${canonicalUrl} with given options`);
        }

        const result = filtered[0];
        if (!result) throw new Error(`No matching resource found for ${canonicalUrl}`);
        return result;
    };

    const resolve = async (canonicalUrl: string, options?: ResolveOptions): Promise<Resource> =>
        adapter.read(await resolveEntry(canonicalUrl, options));

    const searchEntries = async (params: EntrySearchParams): Promise<IndexEntry[]> => adapter.findEntries(params);

    const search = async (params: EntrySearchParams): Promise<Resource[]> => {
        const entries = await searchEntries(params);
        return Promise.all(entries.map((entry) => adapter.read(entry)));
    };

    const smartSearch = async (
        searchTerms: string[],
        filters?: { resourceType?: string; type?: string; kind?: string; package?: PackageId },
    ): Promise<IndexEntry[]> => {
        let results = await searchEntries({ kind: filters?.kind, package: filters?.package });
        if (filters?.resourceType) results = results.filter((entry) => entry.resourceType === filters.resourceType);
        if (filters?.type) results = results.filter((entry) => entry.type === filters.type);
        return filterBySmartSearch(results, searchTerms);
    };

    const getSearchParametersForResource = async (resourceType: string): Promise<SearchParameter[]> => {
        const cached = searchParamsCache.get(resourceType);
        if (cached) return cached;

        const allEntries = await searchEntries({});
        const entries = allEntries.filter((entry) => entry.resourceType === "SearchParameter");
        const results: SearchParameter[] = [];
        for (const entry of entries) {
            const resource = await adapter.read(entry);
            const bases = resource.base || [];
            if (Array.isArray(bases) && bases.includes(resourceType)) {
                results.push(resource as unknown as SearchParameter);
            }
        }
        results.sort((a, b) => (a.code || "").localeCompare(b.code || ""));
        searchParamsCache.set(resourceType, results);
        return results;
    };

    return {
        resolveEntry,
        resolve,
        searchEntries,
        search,
        smartSearch,
        getSearchParametersForResource,
        clearSearchParameterCache: (): void => searchParamsCache.clear(),
    };
}
