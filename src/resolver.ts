/**
 * Resolver module - Context-aware resolution functionality
 * Merged from resolver/index.ts and resolver/context.ts
 */

import type { ExtendedCache } from "./cache.js";
import type { IndexEntry, SourceContext } from "./types/index.js";

/**
 * Resolve a canonical URL with context awareness
 *
 * Attempts to resolve a URL within a specific package context first,
 * then falls back to global resolution if the context-specific resolution fails.
 *
 * @param url - The canonical URL to resolve
 * @param context - The source context containing package information
 * @param _cache - The extended cache instance (currently unused but kept for future use)
 * @param resolveEntry - Function to resolve an entry by URL with optional package/version
 * @returns The resolved index entry or null if resolution fails
 */
export const resolveWithContext = async (
    url: string,
    context: SourceContext,
    _cache: ExtendedCache,
    resolveEntry: (url: string, options?: any) => Promise<IndexEntry>,
): Promise<IndexEntry | null> => {
    if (context.package) {
        try {
            return await resolveEntry(url, {
                package: context.package.name,
                version: context.package.version,
            });
        } catch {
            // Fall through to global resolution
        }
    }
    return null;
};
