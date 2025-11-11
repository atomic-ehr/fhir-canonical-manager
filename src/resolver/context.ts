/**
 * Context-aware resolution functionality
 */

import type { SourceContext, IndexEntry } from "../types/index.js";
import type { ExtendedCache } from "../cache/core.js";

export const resolveWithContext = async (
    url: string,
    context: SourceContext,
    cache: ExtendedCache,
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
